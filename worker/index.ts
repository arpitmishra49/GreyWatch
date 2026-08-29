import "dotenv/config";
import { prisma } from "../lib/prisma";
import { captureScreenshot, evaluateThreshold, queryMetricValue, resolveSiteGrafanaConfig } from "../lib/grafana";
import { notifyCreatorOfFailure, postBreach } from "../lib/slack";
import { emailProvider } from "../lib/email";
import { renderReportEmail, type ReportMetricData } from "../lib/emailTemplate";
import type { Operator } from "../lib/types";
import { assertAllEnv } from "../lib/env";
import { slackEnv } from "../lib/env";
import { aggregateInsights } from "./insightsAggregator";

// Fail loudly on startup rather than the first time a tick happens to touch
// a missing var.
assertAllEnv();

const TICK_INTERVAL_MS = 30_000;
// Coarser than the monitoring tick — aggregation reads history, it doesn't
// need 30s freshness, and this bounds how often the (bounded, batched)
// aggregation pass runs.
const AGGREGATION_INTERVAL_MS = 5 * 60_000;

async function tick(): Promise<void> {
  const now = new Date();
  const dueTasks = await prisma.monitorTask.findMany({
    where: { status: "active", nextCheckAt: { lte: now } },
    include: {
      site: true,
      recipients: true,
      metrics: { include: { recipientThreads: true } },
    },
  });

  if (dueTasks.length > 0) {
    console.log(`[worker] ${dueTasks.length} task(s) due at ${now.toISOString()}`);
  }

  for (const task of dueTasks) {
    await processTask(task, now);
  }
}

type DueTask = Awaited<ReturnType<typeof prisma.monitorTask.findMany>>[number] & {
  site: { name: string; grafanaBaseUrl: string; grafanaApiToken: string | null };
  dashboardUid: string;
  recipients: { id: string; slackUserId: string }[];
  metrics: {
    id: string;
    panelId: number;
    panelTitle: string;
    operator: string;
    threshold: number;
    lastAlertAt: Date | null;
    threadTs: string | null;
    recipientThreads: { recipientId: string; threadTs: string }[];
  }[];
};

type DueMetric = DueTask["metrics"][number];

async function processTask(task: DueTask, now: Date): Promise<void> {
  if (task.expiresAt <= now) {
    await prisma.monitorTask.update({
      where: { id: task.id },
      data: { status: "expired" },
    });
    console.log(`[worker] task ${task.id} expired`);
    return;
  }

  // Each metric gets its own try/catch — one panel failing to query must
  // not stop the task's other metrics from being checked this tick.
  for (const metric of task.metrics) {
    await processMetric(task, metric, now);
  }

  await prisma.monitorTask.update({
    where: { id: task.id },
    data: { nextCheckAt: new Date(now.getTime() + task.pollIntervalMin * 60_000) },
  });
}

async function processMetric(task: DueTask, metric: DueMetric, now: Date): Promise<void> {
  const grafanaConfig = resolveSiteGrafanaConfig(task.site);
  try {
    const value = await queryMetricValue(grafanaConfig, task.dashboardUid, metric.panelId);
    const breached = evaluateThreshold(value, metric.operator as Operator, metric.threshold);

    const event = await prisma.taskEvent.create({
      data: { metricId: metric.id, success: true, capturedValue: value, breached },
    });

    let threadTs = metric.threadTs ?? undefined;
    let lastAlertAt = metric.lastAlertAt;
    let lastStatus: string = "ok";

    if (breached) {
      const cooldownOk =
        !lastAlertAt || now.getTime() - lastAlertAt.getTime() >= task.cooldownMin * 60_000;

      if (cooldownOk) {
        const screenshot = await captureScreenshot(grafanaConfig, task.dashboardUid, metric.panelId);
        const secondsSinceLastAlert = lastAlertAt
          ? (now.getTime() - lastAlertAt.getTime()) / 1000
          : undefined;
        const isFirstAlert = !metric.threadTs;

        threadTs = await postBreach(slackEnv.L3_CHANNEL_ID, threadTs, screenshot, {
          siteName: task.site.name,
          panelTitle: metric.panelTitle,
          operator: metric.operator,
          threshold: metric.threshold,
          value,
          isFirstAlert,
          secondsSinceLastAlert,
        });

        // Per-recipient DMs, each fully isolated from the L3 post above and
        // from each other — a broken DM for one recipient must not undo the
        // channel alert (already saved) or block any other recipient's DM.
        // Each recipient has their own independent thread, since cooldown
        // is one shared clock per metric but each person has a separate DM
        // conversation with the bot.
        for (const recipient of task.recipients) {
          try {
            const existingThread = metric.recipientThreads.find((rt) => rt.recipientId === recipient.id);
            const recipientThreadTs = await postBreach(recipient.slackUserId, existingThread?.threadTs, screenshot, {
              siteName: task.site.name,
              panelTitle: metric.panelTitle,
              operator: metric.operator,
              threshold: metric.threshold,
              value,
              isFirstAlert: !existingThread,
              secondsSinceLastAlert,
            });
            await prisma.recipientAlertThread.upsert({
              where: { metricId_recipientId: { metricId: metric.id, recipientId: recipient.id } },
              update: { threadTs: recipientThreadTs },
              create: { metricId: metric.id, recipientId: recipient.id, threadTs: recipientThreadTs },
            });
          } catch (dmErr) {
            console.error(
              `[worker] task ${task.id} metric ${metric.id} recipient ${recipient.id} breach DM failed:`,
              dmErr instanceof Error ? dmErr.message : dmErr,
            );
          }
        }

        lastAlertAt = now;
        await prisma.taskEvent.update({
          where: { id: event.id },
          data: { alerted: true },
        });
      }
      lastStatus = "breached";
    }

    await prisma.taskMetric.update({
      where: { id: metric.id },
      data: { threadTs, lastAlertAt, lastStatus },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] task ${task.id} metric ${metric.id} (${metric.panelTitle}) failed:`, message);

    await prisma.taskEvent.create({
      data: { metricId: metric.id, success: false, errorMessage: message },
    });

    // Every configured recipient gets the failure DM — there's no single
    // "creator" identity to fall back to under the shared login, and this
    // is the closest faithful translation of "a broken tool is the
    // requester's problem, not L3's" to a multi-recipient world. Isolated
    // per recipient so one failing DM doesn't stop the others.
    for (const recipient of task.recipients) {
      try {
        await notifyCreatorOfFailure(recipient.slackUserId, `${task.site.name} / ${metric.panelTitle}`, message);
      } catch (notifyErr) {
        console.error(
          `[worker] failed to notify recipient ${recipient.id} of metric ${metric.id} failure:`,
          notifyErr,
        );
      }
    }

    await prisma.taskMetric.update({
      where: { id: metric.id },
      data: { lastStatus: "error" },
    });
  }
}

// ---------- Email reports ----------
// A second, independent due-query alongside the Slack tick above — same
// DB-driven nextSendAt pattern as nextCheckAt, so scheduling survives a
// worker restart without any in-memory state.

async function emailTick(): Promise<void> {
  const now = new Date();
  const dueEmailTasks = await prisma.emailTask.findMany({
    where: { status: "active", nextSendAt: { lte: now } },
    include: { site: true, metrics: true, recipients: true },
  });

  if (dueEmailTasks.length > 0) {
    console.log(`[worker] ${dueEmailTasks.length} email task(s) due at ${now.toISOString()}`);
  }

  for (const task of dueEmailTasks) {
    await processEmailTask(task, now);
  }
}

type DueEmailTask = Awaited<ReturnType<typeof prisma.emailTask.findMany>>[number] & {
  site: { name: string; grafanaBaseUrl: string; grafanaApiToken: string | null };
  metrics: { panelId: number; panelTitle: string; operator: string | null; threshold: number | null }[];
  recipients: { email: string; kind: string }[];
};

// One task failing (bad Grafana config, email send rejected, etc.) must not
// stop any other email task, or any Slack task, from being processed in
// the same tick — this whole function is the isolation boundary. Within
// it, one metric failing to read degrades gracefully into an error row in
// the report rather than aborting the entire send.
async function processEmailTask(task: DueEmailTask, now: Date): Promise<void> {
  if (task.expiresAt <= now) {
    await prisma.emailTask.update({ where: { id: task.id }, data: { status: "expired" } });
    console.log(`[worker] email task ${task.id} expired`);
    return;
  }

  try {
    const grafanaConfig = resolveSiteGrafanaConfig(task.site);
    const metricData: ReportMetricData[] = [];

    for (const metric of task.metrics) {
      try {
        const value = await queryMetricValue(grafanaConfig, task.dashboardUid, metric.panelId);
        let screenshot: Buffer | undefined;
        try {
          screenshot = await captureScreenshot(grafanaConfig, task.dashboardUid, metric.panelId);
        } catch {
          // Screenshot is a nice-to-have for the report — a renderer hiccup
          // shouldn't turn a perfectly good value into an error row.
        }
        metricData.push({
          panelTitle: metric.panelTitle,
          value,
          operator: metric.operator,
          threshold: metric.threshold,
          screenshot,
        });
      } catch (err) {
        metricData.push({
          panelTitle: metric.panelTitle,
          value: null,
          errorMessage: err instanceof Error ? err.message : String(err),
          operator: null,
          threshold: null,
        });
      }
    }

    const { html, attachments } = renderReportEmail({ siteName: task.site.name, generatedAt: now, metrics: metricData });

    const toEmails = task.recipients.filter((r) => r.kind === "to").map((r) => r.email);
    const ccEmails = task.recipients.filter((r) => r.kind === "cc").map((r) => r.email);

    const result = await emailProvider.send({
      to: toEmails,
      cc: ccEmails.length > 0 ? ccEmails : undefined,
      subject: `GreyWatch report: ${task.site.name}`,
      html,
      attachments,
    });

    await prisma.emailSendEvent.create({
      data: { emailTaskId: task.id, success: true, recipientCount: toEmails.length + ccEmails.length },
    });
    console.log(
      `[worker] email task ${task.id} sent to ${toEmails.length + ccEmails.length} recipient(s)` +
        (result.previewUrl ? ` — preview: ${result.previewUrl}` : ""),
    );

    await prisma.emailTask.update({
      where: { id: task.id },
      data: { lastSentAt: now, nextSendAt: new Date(now.getTime() + task.intervalMin * 60_000) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] email task ${task.id} failed:`, message);

    await prisma.emailSendEvent.create({
      data: { emailTaskId: task.id, success: false, errorMessage: message, recipientCount: 0 },
    });

    await prisma.emailTask.update({
      where: { id: task.id },
      data: { nextSendAt: new Date(now.getTime() + task.intervalMin * 60_000) },
    });
  }
}

async function main() {
  console.log(`[worker] starting, tick interval ${TICK_INTERVAL_MS / 1000}s`);
  await tick();
  await emailTick();
  // Insights aggregation is fully isolated from the two ticks above — its
  // own interval, its own try/catch. If it throws, monitoring and email
  // keep running exactly as before; this can never block either.
  await aggregateInsights().catch((err) => console.error("[worker] insights aggregation failed:", err));

  setInterval(() => {
    tick().catch((err) => console.error("[worker] tick failed:", err));
    emailTick().catch((err) => console.error("[worker] email tick failed:", err));
  }, TICK_INTERVAL_MS);

  setInterval(() => {
    aggregateInsights().catch((err) => console.error("[worker] insights aggregation failed:", err));
  }, AGGREGATION_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});

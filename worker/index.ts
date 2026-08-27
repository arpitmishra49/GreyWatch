import "dotenv/config";
import { prisma } from "../lib/prisma";
import { captureScreenshot, evaluateThreshold, queryMetricValue } from "../lib/grafana";
import { notifyCreatorOfFailure, postBreach } from "../lib/slack";
import type { Operator } from "../lib/types";
import { assertAllEnv } from "../lib/env";
import { slackEnv } from "../lib/env";

// Fail loudly on startup rather than the first time a tick happens to touch
// a missing var.
assertAllEnv();

const TICK_INTERVAL_MS = 30_000;

async function tick(): Promise<void> {
  const now = new Date();
  const dueTasks = await prisma.monitorTask.findMany({
    where: { status: "active", nextCheckAt: { lte: now } },
    include: { site: true, createdBy: true, metrics: true },
  });

  if (dueTasks.length > 0) {
    console.log(`[worker] ${dueTasks.length} task(s) due at ${now.toISOString()}`);
  }

  for (const task of dueTasks) {
    await processTask(task, now);
  }
}

type DueTask = Awaited<ReturnType<typeof prisma.monitorTask.findMany>>[number] & {
  site: { name: string; dashboardUid: string };
  createdBy: { slackUserId: string; username: string };
  metrics: {
    id: string;
    panelId: number;
    panelTitle: string;
    operator: string;
    threshold: number;
    lastAlertAt: Date | null;
    threadTs: string | null;
    creatorThreadTs: string | null;
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
  try {
    const value = await queryMetricValue(task.site.dashboardUid, metric.panelId);
    const breached = evaluateThreshold(value, metric.operator as Operator, metric.threshold);

    const event = await prisma.taskEvent.create({
      data: { metricId: metric.id, success: true, capturedValue: value, breached },
    });

    let threadTs = metric.threadTs ?? undefined;
    let creatorThreadTs = metric.creatorThreadTs ?? undefined;
    let lastAlertAt = metric.lastAlertAt;
    let lastStatus: string = "ok";

    if (breached) {
      const cooldownOk =
        !lastAlertAt || now.getTime() - lastAlertAt.getTime() >= task.cooldownMin * 60_000;

      if (cooldownOk) {
        const screenshot = await captureScreenshot(task.site.dashboardUid, metric.panelId);
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

        // Isolated from the L3 post above: a broken/missing DM scope must
        // not undo an alert that already succeeded in the shared channel,
        // and must not be reported as a Grafana/poll failure (it isn't one)
        // — it's just logged so it's visible without derailing this metric.
        if (task.notifyCreator) {
          try {
            creatorThreadTs = await postBreach(task.createdBy.slackUserId, creatorThreadTs, screenshot, {
              siteName: task.site.name,
              panelTitle: metric.panelTitle,
              operator: metric.operator,
              threshold: metric.threshold,
              value,
              isFirstAlert: !metric.creatorThreadTs,
              secondsSinceLastAlert,
            });
          } catch (dmErr) {
            console.error(
              `[worker] task ${task.id} metric ${metric.id} (${metric.panelTitle}) breach DM failed:`,
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
      data: { threadTs, creatorThreadTs, lastAlertAt, lastStatus },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] task ${task.id} metric ${metric.id} (${metric.panelTitle}) failed:`, message);

    await prisma.taskEvent.create({
      data: { metricId: metric.id, success: false, errorMessage: message },
    });

    try {
      await notifyCreatorOfFailure(
        task.createdBy.slackUserId,
        `${task.site.name} / ${metric.panelTitle}`,
        message,
      );
    } catch (notifyErr) {
      console.error(`[worker] failed to notify creator of metric ${metric.id} failure:`, notifyErr);
    }

    await prisma.taskMetric.update({
      where: { id: metric.id },
      data: { lastStatus: "error" },
    });
  }
}

async function main() {
  console.log(`[worker] starting, tick interval ${TICK_INTERVAL_MS / 1000}s`);
  await tick();
  setInterval(() => {
    tick().catch((err) => console.error("[worker] tick failed:", err));
  }, TICK_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});

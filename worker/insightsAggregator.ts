import { prisma } from "../lib/prisma";

// Turns the existing TaskEvent log (already written by the critical
// monitoring path in worker/index.ts — untouched by this file) into the
// two tables Insights actually reads from:
//   - BreachIncident: one row per breach lifecycle (open on breached
//     false->true, close on true->false).
//   - DailyMetricStat: one row per metric per UTC day, so "last 30 days"
//     is a sum over ~30 rows instead of a scan over thousands of events.
//
// Runs as an independent tick from a separate worker/index.ts interval.
// A failure here is caught by the caller and never touches monitoring,
// Slack, or email — see the try/catch around this call in main().

const BATCH_SIZE = 2000;
const MAX_BATCHES_PER_RUN = 5; // bounds a single invocation even with a large backlog

function truncateToUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function aggregateInsights(): Promise<void> {
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const processed = await processOneBatch();
    if (processed < BATCH_SIZE) break; // caught up — no need to keep looping
  }
}

async function processOneBatch(): Promise<number> {
  const checkpoint = await prisma.reportingCheckpoint.findUnique({ where: { id: "singleton" } });

  const resumeWhere =
    checkpoint?.lastProcessedAt && checkpoint.lastProcessedEventId
      ? {
          OR: [
            { checkedAt: { gt: checkpoint.lastProcessedAt } },
            { checkedAt: checkpoint.lastProcessedAt, id: { gt: checkpoint.lastProcessedEventId } },
          ],
        }
      : {};

  const events = await prisma.taskEvent.findMany({
    where: resumeWhere,
    orderBy: [{ checkedAt: "asc" }, { id: "asc" }],
    take: BATCH_SIZE,
    include: { metric: { select: { id: true, task: { select: { pollIntervalMin: true } } } } },
  });

  if (events.length === 0) return 0;

  // Group in order-preserving buckets per metric — events are already
  // globally ordered by (checkedAt, id) above, so each per-metric bucket
  // stays correctly ordered too.
  const byMetric = new Map<string, typeof events>();
  for (const event of events) {
    const list = byMetric.get(event.metricId) ?? [];
    list.push(event);
    byMetric.set(event.metricId, list);
  }

  await prisma.$transaction(async (tx) => {
    for (const [metricId, metricEvents] of byMetric) {
      const pollIntervalMin = metricEvents[0].metric.task.pollIntervalMin;

      // Continue an incident opened in a previous run, if any.
      let openIncident = await tx.breachIncident.findFirst({ where: { metricId, endedAt: null } });

      // Seed "previous check" from history before this batch, so the very
      // first event in this batch gets an accurate coverage delta instead
      // of being mistaken for the metric's first-ever check.
      const priorEvent = await tx.taskEvent.findFirst({
        where: { metricId, checkedAt: { lt: metricEvents[0].checkedAt } },
        orderBy: { checkedAt: "desc" },
      });
      let prevCheckedAt: Date | null = priorEvent?.checkedAt ?? null;

      for (const event of metricEvents) {
        // Coverage window this check represents: time since the previous
        // check, capped at 2x the poll interval so a long gap (worker
        // downtime, a stopped task later restarted, etc.) shows up as
        // unmonitored time rather than being silently absorbed as healthy
        // or breached. The very first check ever for a metric is credited
        // exactly one poll interval, by convention — there's no prior
        // check to measure a real delta against.
        const capSeconds = pollIntervalMin * 60 * 2;
        const deltaSeconds = prevCheckedAt
          ? Math.min((event.checkedAt.getTime() - prevCheckedAt.getTime()) / 1000, capSeconds)
          : pollIntervalMin * 60;
        prevCheckedAt = event.checkedAt;

        let justOpenedIncident = false;

        if (event.success && event.breached === true) {
          if (!openIncident) {
            openIncident = await tx.breachIncident.create({
              data: {
                metricId,
                startedAt: event.checkedAt,
                maxValue: event.capturedValue,
                alerted: event.alerted,
                startEventId: event.id,
              },
            });
            justOpenedIncident = true;
          } else {
            const nextMax =
              event.capturedValue !== null && (openIncident.maxValue === null || event.capturedValue > openIncident.maxValue)
                ? event.capturedValue
                : openIncident.maxValue;
            openIncident = await tx.breachIncident.update({
              where: { id: openIncident.id },
              data: { maxValue: nextMax, alerted: openIncident.alerted || event.alerted },
            });
          }
        } else if (event.success && event.breached === false && openIncident) {
          const durationSec = Math.round((event.checkedAt.getTime() - openIncident.startedAt.getTime()) / 1000);
          await tx.breachIncident.update({
            where: { id: openIncident.id },
            data: { endedAt: event.checkedAt, endEventId: event.id, durationSec },
          });
          openIncident = null;
        }
        // A failed check (event.success === false) proves nothing about
        // recovery — it neither opens nor closes an incident. It's still
        // counted below via errorCount/checkCount.

        const day = truncateToUTCDay(event.checkedAt);
        const rounded = Math.round(deltaSeconds);
        await tx.dailyMetricStat.upsert({
          where: { metricId_date: { metricId, date: day } },
          create: {
            metricId,
            date: day,
            checkCount: 1,
            errorCount: event.success ? 0 : 1,
            monitoredSeconds: event.success ? rounded : 0,
            healthySeconds: event.success && event.breached === false ? rounded : 0,
            breachedSeconds: event.success && event.breached === true ? rounded : 0,
            breachCount: justOpenedIncident ? 1 : 0,
          },
          update: {
            checkCount: { increment: 1 },
            errorCount: { increment: event.success ? 0 : 1 },
            monitoredSeconds: { increment: event.success ? rounded : 0 },
            healthySeconds: { increment: event.success && event.breached === false ? rounded : 0 },
            breachedSeconds: { increment: event.success && event.breached === true ? rounded : 0 },
            breachCount: { increment: justOpenedIncident ? 1 : 0 },
          },
        });
      }
    }

    const last = events[events.length - 1];
    await tx.reportingCheckpoint.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", lastProcessedEventId: last.id, lastProcessedAt: last.checkedAt },
      update: { lastProcessedEventId: last.id, lastProcessedAt: last.checkedAt },
    });
  });

  return events.length;
}

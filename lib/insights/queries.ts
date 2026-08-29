import { prisma } from "@/lib/prisma";
import { truncateToUTCDay } from "./dateRange";

// ---------- shared scoping helper ----------

// Every Insights query is scoped by a list of metric IDs rather than by
// site/task directly — BreachIncident and DailyMetricStat only carry
// metricId (no denormalized siteId/taskId column, deliberately, to avoid
// duplicating data that's one join away). This resolves whatever filter
// combination the caller passed into the concrete metric ID list once, up
// front, so every downstream query is a plain `metricId IN (...)` lookup.
export async function resolveMetricIds(filter: { siteId?: string; taskId?: string }): Promise<string[]> {
  const metrics = await prisma.taskMetric.findMany({
    where: {
      ...(filter.taskId ? { taskId: filter.taskId } : {}),
      ...(filter.siteId ? { task: { siteId: filter.siteId } } : {}),
    },
    select: { id: true },
  });
  return metrics.map((m) => m.id);
}

// ---------- summary ----------

export interface InsightsSummary {
  metricCount: number;
  activeTaskCount: number;
  totalBreaches: number;
  healthySeconds: number;
  breachedSeconds: number;
  monitoredSeconds: number;
  unmonitoredSeconds: number;
  totalPeriodSeconds: number;
  // Of the time we actually watched each metric, what fraction was healthy.
  // Excludes unmonitored time from the denominator — this is "how well did
  // the system behave while we were looking."
  healthPercentage: number | null;
  // Of the *entire* period, what fraction was proven healthy — unmonitored
  // time counts against this figure. This is the conservative,
  // customer-facing compliance number: a monitoring gap is not compliance.
  slaCompliancePercentage: number | null;
  avgBreachDurationSec: number | null;
  longestBreachSec: number | null;
  avgRecoverySec: number | null; // same figure as avgBreachDurationSec — see note below
}

export async function getSummary(params: { metricIds: string[]; from: Date; to: Date }): Promise<InsightsSummary> {
  const { metricIds, from, to } = params;

  if (metricIds.length === 0) {
    return {
      metricCount: 0,
      activeTaskCount: 0,
      totalBreaches: 0,
      healthySeconds: 0,
      breachedSeconds: 0,
      monitoredSeconds: 0,
      unmonitoredSeconds: 0,
      totalPeriodSeconds: 0,
      healthPercentage: null,
      slaCompliancePercentage: null,
      avgBreachDurationSec: null,
      longestBreachSec: null,
      avgRecoverySec: null,
    };
  }

  const dayFrom = truncateToUTCDay(from);
  const dayTo = truncateToUTCDay(to);

  const [dailyAgg, breachAgg, activeTaskCount] = await Promise.all([
    prisma.dailyMetricStat.aggregate({
      where: { metricId: { in: metricIds }, date: { gte: dayFrom, lte: dayTo } },
      _sum: { healthySeconds: true, breachedSeconds: true, monitoredSeconds: true },
    }),
    prisma.breachIncident.aggregate({
      where: { metricId: { in: metricIds }, startedAt: { gte: from, lte: to } },
      _count: { _all: true },
      _avg: { durationSec: true },
      _max: { durationSec: true },
    }),
    prisma.monitorTask.count({
      where: { status: "active", metrics: { some: { id: { in: metricIds } } } },
    }),
  ]);

  const healthySeconds = dailyAgg._sum.healthySeconds ?? 0;
  const breachedSeconds = dailyAgg._sum.breachedSeconds ?? 0;
  const monitoredSeconds = dailyAgg._sum.monitoredSeconds ?? 0;

  const periodSeconds = Math.max(0, (to.getTime() - from.getTime()) / 1000);
  const totalPeriodSeconds = periodSeconds * metricIds.length;
  const unmonitoredSeconds = Math.max(0, totalPeriodSeconds - monitoredSeconds);

  const healthPercentage =
    healthySeconds + breachedSeconds > 0 ? (healthySeconds / (healthySeconds + breachedSeconds)) * 100 : null;
  const slaCompliancePercentage = totalPeriodSeconds > 0 ? (healthySeconds / totalPeriodSeconds) * 100 : null;

  return {
    metricCount: metricIds.length,
    activeTaskCount,
    totalBreaches: breachAgg._count._all,
    healthySeconds,
    breachedSeconds,
    monitoredSeconds,
    unmonitoredSeconds,
    totalPeriodSeconds,
    healthPercentage,
    slaCompliancePercentage,
    avgBreachDurationSec: breachAgg._avg.durationSec,
    longestBreachSec: breachAgg._max.durationSec,
    // "Recovery time" and "breach duration" are the same measurement (how
    // long from breach start to recovery) — exposed under both names since
    // both showed up as separate requested KPIs, but there is only one
    // underlying number. Documented here rather than inventing a second,
    // differently-defined metric with no clear meaning.
    avgRecoverySec: breachAgg._avg.durationSec,
  };
}

// ---------- per-metric breakdown ----------

export interface MetricBreakdownRow {
  metricId: string;
  panelTitle: string;
  siteName: string;
  taskId: string;
  currentStatus: string | null;
  breachCount: number;
  healthySeconds: number;
  breachedSeconds: number;
  healthyPercentage: number | null;
  avgBreachDurationSec: number | null;
  longestBreachSec: number | null;
  shortestBreachSec: number | null;
  lastBreachAt: Date | null;
}

export async function getMetricBreakdown(params: {
  metricIds: string[];
  from: Date;
  to: Date;
}): Promise<MetricBreakdownRow[]> {
  const { metricIds, from, to } = params;
  if (metricIds.length === 0) return [];

  const dayFrom = truncateToUTCDay(from);
  const dayTo = truncateToUTCDay(to);

  const [metrics, dailyGroups, breachGroups] = await Promise.all([
    prisma.taskMetric.findMany({
      where: { id: { in: metricIds } },
      select: { id: true, panelTitle: true, lastStatus: true, taskId: true, task: { select: { site: { select: { name: true } } } } },
    }),
    prisma.dailyMetricStat.groupBy({
      by: ["metricId"],
      where: { metricId: { in: metricIds }, date: { gte: dayFrom, lte: dayTo } },
      _sum: { healthySeconds: true, breachedSeconds: true },
    }),
    prisma.breachIncident.groupBy({
      by: ["metricId"],
      where: { metricId: { in: metricIds }, startedAt: { gte: from, lte: to } },
      _count: { _all: true },
      _avg: { durationSec: true },
      _max: { durationSec: true, startedAt: true },
      _min: { durationSec: true },
    }),
  ]);

  const dailyByMetric = new Map(dailyGroups.map((g) => [g.metricId, g]));
  const breachByMetric = new Map(breachGroups.map((g) => [g.metricId, g]));

  return metrics.map((m) => {
    const daily = dailyByMetric.get(m.id);
    const breach = breachByMetric.get(m.id);
    const healthySeconds = daily?._sum.healthySeconds ?? 0;
    const breachedSeconds = daily?._sum.breachedSeconds ?? 0;

    return {
      metricId: m.id,
      panelTitle: m.panelTitle,
      siteName: m.task.site.name,
      taskId: m.taskId,
      currentStatus: m.lastStatus,
      breachCount: breach?._count._all ?? 0,
      healthySeconds,
      breachedSeconds,
      healthyPercentage: healthySeconds + breachedSeconds > 0 ? (healthySeconds / (healthySeconds + breachedSeconds)) * 100 : null,
      avgBreachDurationSec: breach?._avg.durationSec ?? null,
      longestBreachSec: breach?._max.durationSec ?? null,
      shortestBreachSec: breach?._min.durationSec ?? null,
      lastBreachAt: breach?._max.startedAt ?? null,
    };
  });
}

// ---------- breach incident table ----------

export interface BreachIncidentRow {
  id: string;
  siteName: string;
  panelTitle: string;
  operator: string;
  threshold: number;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  maxValue: number | null;
  alerted: boolean;
}

export async function getBreachIncidents(params: {
  metricIds: string[];
  from: Date;
  to: Date;
  status?: "open" | "closed";
  page: number;
  pageSize: number;
}): Promise<{ items: BreachIncidentRow[]; total: number }> {
  const { metricIds, from, to, status, page, pageSize } = params;
  if (metricIds.length === 0) return { items: [], total: 0 };

  const where = {
    metricId: { in: metricIds },
    startedAt: { gte: from, lte: to },
    ...(status === "open" ? { endedAt: null } : {}),
    ...(status === "closed" ? { endedAt: { not: null } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.breachIncident.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        metric: {
          select: {
            panelTitle: true,
            operator: true,
            threshold: true,
            task: { select: { site: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.breachIncident.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      siteName: r.metric.task.site.name,
      panelTitle: r.metric.panelTitle,
      operator: r.metric.operator,
      threshold: r.metric.threshold,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationSec: r.durationSec,
      maxValue: r.maxValue,
      alerted: r.alerted,
    })),
    total,
  };
}

// ---------- peak period analysis ----------

export interface PeakAnalysis {
  peakWindowDescription: string;
  peakBreachCount: number;
  offPeakBreachCount: number;
  peakDurationSec: number; // sum of closed incidents' durations
  offPeakDurationSec: number;
  bySite: {
    siteId: string;
    siteName: string;
    peakBreachCount: number;
    offPeakBreachCount: number;
    metSlaDuringPeak: boolean; // zero peak breaches in range
  }[];
  topProblematicMetrics: { metricId: string; panelTitle: string; siteName: string; peakBreachCount: number }[];
}

interface PeakConfig {
  startHour: number;
  endHour: number;
  daysOfWeek: Set<number>;
}

function isWithinPeak(date: Date, config: PeakConfig): boolean {
  // No per-site timezone concept exists anywhere in the schema today, so
  // peak hours are evaluated in UTC — a documented limitation, not a
  // silent assumption. Revisit if/when Site gains a timezone field.
  const hour = date.getUTCHours();
  const day = date.getUTCDay();
  return config.daysOfWeek.has(day) && hour >= config.startHour && hour < config.endHour;
}

export async function getPeakAnalysis(params: { metricIds: string[]; from: Date; to: Date }): Promise<PeakAnalysis> {
  const { metricIds, from, to } = params;

  const configs = await prisma.peakPeriodConfig.findMany();
  const globalConfig = configs.find((c) => c.siteId === null);
  const configBySite = new Map(configs.filter((c) => c.siteId !== null).map((c) => [c.siteId as string, c]));

  const fallback: PeakConfig = { startHour: 9, endHour: 18, daysOfWeek: new Set([1, 2, 3, 4, 5]) };
  const globalPeak: PeakConfig = globalConfig
    ? { startHour: globalConfig.startHour, endHour: globalConfig.endHour, daysOfWeek: new Set(globalConfig.daysOfWeek.split(",").map(Number)) }
    : fallback;

  function peakConfigFor(siteId: string): PeakConfig {
    const override = configBySite.get(siteId);
    if (!override) return globalPeak;
    return { startHour: override.startHour, endHour: override.endHour, daysOfWeek: new Set(override.daysOfWeek.split(",").map(Number)) };
  }

  if (metricIds.length === 0) {
    return {
      peakWindowDescription: `${globalPeak.startHour}:00-${globalPeak.endHour}:00 UTC, weekdays`,
      peakBreachCount: 0,
      offPeakBreachCount: 0,
      peakDurationSec: 0,
      offPeakDurationSec: 0,
      bySite: [],
      topProblematicMetrics: [],
    };
  }

  const incidents = await prisma.breachIncident.findMany({
    where: { metricId: { in: metricIds }, startedAt: { gte: from, lte: to } },
    include: {
      metric: {
        select: {
          panelTitle: true,
          task: { select: { site: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  let peakBreachCount = 0;
  let offPeakBreachCount = 0;
  let peakDurationSec = 0;
  let offPeakDurationSec = 0;

  const siteStats = new Map<string, { siteName: string; peakBreachCount: number; offPeakBreachCount: number }>();
  const metricPeakCounts = new Map<string, { panelTitle: string; siteName: string; count: number }>();

  for (const incident of incidents) {
    const site = incident.metric.task.site;
    const config = peakConfigFor(site.id);
    const peak = isWithinPeak(incident.startedAt, config);

    if (peak) {
      peakBreachCount++;
      peakDurationSec += incident.durationSec ?? 0;
    } else {
      offPeakBreachCount++;
      offPeakDurationSec += incident.durationSec ?? 0;
    }

    const siteEntry = siteStats.get(site.id) ?? { siteName: site.name, peakBreachCount: 0, offPeakBreachCount: 0 };
    if (peak) siteEntry.peakBreachCount++;
    else siteEntry.offPeakBreachCount++;
    siteStats.set(site.id, siteEntry);

    if (peak) {
      const metricEntry = metricPeakCounts.get(incident.metricId) ?? { panelTitle: incident.metric.panelTitle, siteName: site.name, count: 0 };
      metricEntry.count++;
      metricPeakCounts.set(incident.metricId, metricEntry);
    }
  }

  const bySite = Array.from(siteStats.entries()).map(([siteId, s]) => ({
    siteId,
    siteName: s.siteName,
    peakBreachCount: s.peakBreachCount,
    offPeakBreachCount: s.offPeakBreachCount,
    metSlaDuringPeak: s.peakBreachCount === 0,
  }));

  const topProblematicMetrics = Array.from(metricPeakCounts.entries())
    .map(([metricId, v]) => ({ metricId, panelTitle: v.panelTitle, siteName: v.siteName, peakBreachCount: v.count }))
    .sort((a, b) => b.peakBreachCount - a.peakBreachCount)
    .slice(0, 5);

  return {
    peakWindowDescription: `${globalPeak.startHour}:00-${globalPeak.endHour}:00 UTC, weekdays`,
    peakBreachCount,
    offPeakBreachCount,
    peakDurationSec,
    offPeakDurationSec,
    bySite,
    topProblematicMetrics,
  };
}

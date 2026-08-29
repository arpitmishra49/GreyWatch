import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getRedZoneStatusForSites } from "@/lib/status/redZone";
import { getF90StatusForSites } from "@/lib/status/f90";

const SORTS = ["name-asc", "name-desc", "tasks-desc", "breached-desc"] as const;

const querySchema = z.object({
  search: z.string().trim().optional(),
  redZone: z.enum(["true", "false"]).optional(),
  f90: z.enum(["true", "false"]).optional(),
  slackActive: z.enum(["true", "false"]).optional(),
  emailActive: z.enum(["true", "false"]).optional(),
  sort: z.enum(SORTS).default("name-asc"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { search, redZone, f90, slackActive, emailActive, sort, cursor, limit } = parsed.data;

  const sites = await prisma.site.findMany({
    where: {
      isActive: true,
      ...(search ? { name: { contains: search } } : {}),
    },
  });

  // One query for every active task + its metrics' statuses, aggregated
  // in memory into per-site counts — avoids an N+1 query per site. At this
  // scale (tens of sites, not thousands) an in-memory reduce over one
  // query is simpler and just as correct as a raw-SQL groupBy across the
  // Site -> MonitorTask -> TaskMetric relation chain.
  const activeTasks = await prisma.monitorTask.findMany({
    where: { status: "active" },
    select: { siteId: true, metrics: { select: { lastStatus: true } } },
  });

  const taskCountBySite = new Map<string, number>();
  const breachedCountBySite = new Map<string, number>();
  for (const task of activeTasks) {
    taskCountBySite.set(task.siteId, (taskCountBySite.get(task.siteId) ?? 0) + 1);
    const breached = task.metrics.filter((m) => m.lastStatus === "breached").length;
    if (breached > 0) {
      breachedCountBySite.set(task.siteId, (breachedCountBySite.get(task.siteId) ?? 0) + breached);
    }
  }

  const activeEmailTasks = await prisma.emailTask.findMany({
    where: { status: "active" },
    select: { siteId: true },
  });
  const emailTaskCountBySite = new Map<string, number>();
  for (const task of activeEmailTasks) {
    emailTaskCountBySite.set(task.siteId, (emailTaskCountBySite.get(task.siteId) ?? 0) + 1);
  }

  const siteIds = sites.map((s) => s.id);
  const [redZoneBySite, f90BySite] = await Promise.all([
    getRedZoneStatusForSites(siteIds),
    getF90StatusForSites(siteIds),
  ]);

  let cards = sites.map((site) => ({
    id: site.id,
    name: site.name,
    slug: site.slug,
    activeTaskCount: taskCountBySite.get(site.id) ?? 0,
    breachedCount: breachedCountBySite.get(site.id) ?? 0,
    activeEmailTaskCount: emailTaskCountBySite.get(site.id) ?? 0,
    redZone: redZoneBySite[site.id] ?? false,
    f90: f90BySite[site.id] ?? false,
  }));

  if (redZone) cards = cards.filter((c) => c.redZone === (redZone === "true"));
  if (f90) cards = cards.filter((c) => c.f90 === (f90 === "true"));
  if (slackActive) cards = cards.filter((c) => (c.activeTaskCount > 0) === (slackActive === "true"));
  if (emailActive) cards = cards.filter((c) => (c.activeEmailTaskCount > 0) === (emailActive === "true"));

  cards.sort((a, b) => {
    switch (sort) {
      case "name-desc":
        return b.name.localeCompare(a.name);
      case "tasks-desc":
        return b.activeTaskCount - a.activeTaskCount || a.name.localeCompare(b.name);
      case "breached-desc":
        return b.breachedCount - a.breachedCount || a.name.localeCompare(b.name);
      case "name-asc":
      default:
        return a.name.localeCompare(b.name);
    }
  });

  const startIndex = cursor ? cards.findIndex((c) => c.id === cursor) + 1 : 0;
  const page = cards.slice(startIndex, startIndex + limit);
  const nextCursor = startIndex + limit < cards.length ? page[page.length - 1]?.id ?? null : null;

  return NextResponse.json({ items: page, nextCursor, total: cards.length });
}

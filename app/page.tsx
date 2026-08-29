import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRedZoneStatusForSites } from "@/lib/status/redZone";
import { SiteDirectory } from "./SiteDirectory";
import { StatSummary } from "./StatSummary";

async function loadSummary() {
  const sites = await prisma.site.findMany({ where: { isActive: true }, select: { id: true } });
  const siteIds = sites.map((s) => s.id);

  const activeTasks = await prisma.monitorTask.findMany({
    where: { status: "active" },
    select: { siteId: true, metrics: { select: { lastStatus: true } } },
  });
  const activeEmailTasks = await prisma.emailTask.findMany({
    where: { status: "active" },
    select: { siteId: true },
  });

  const monitoringSiteIds = new Set(activeTasks.map((t) => t.siteId));
  const emailSiteIds = new Set(activeEmailTasks.map((t) => t.siteId));
  const breachedMetrics = activeTasks.reduce(
    (sum, t) => sum + t.metrics.filter((m) => m.lastStatus === "breached").length,
    0,
  );

  const redZoneBySite = await getRedZoneStatusForSites(siteIds);
  const redZoneSites = siteIds.filter((id) => redZoneBySite[id]).length;

  return {
    totalSites: sites.length,
    activeMonitoring: monitoringSiteIds.size,
    activeEmail: emailSiteIds.size,
    breachedMetrics,
    redZoneSites,
  };
}

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const summary = await loadSummary();

  return (
    <div>
      <span className="eyebrow">
        <span className="dot" aria-hidden="true"></span>
        {user.username}
      </span>
      <h1>
        Sites<span className="accent-dot">.</span>
      </h1>
      <p className="subtitle">Monitor, manage, and investigate operational activity across all locations.</p>
      <StatSummary data={summary} />
      <SiteDirectory />
    </div>
  );
}

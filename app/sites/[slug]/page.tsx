import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRedZoneStatus } from "@/lib/status/redZone";
import { getF90Status } from "@/lib/status/f90";
import { BoltIcon, MailIcon } from "@/app/icons";

export default async function SiteDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const site = await prisma.site.findUnique({ where: { slug } });
  if (!site) notFound();

  const activeTasks = await prisma.monitorTask.findMany({
    where: { siteId: site.id, status: "active" },
    include: { metrics: true },
  });
  const watchedMetricCount = activeTasks.reduce((sum, t) => sum + t.metrics.length, 0);
  const breachedCount = activeTasks.reduce(
    (sum, t) => sum + t.metrics.filter((m) => m.lastStatus === "breached").length,
    0,
  );

  const [redZone, f90] = await Promise.all([getRedZoneStatus(site.id), getF90Status(site.id)]);

  const activeEmailTasks = await prisma.emailTask.findMany({
    where: { siteId: site.id, status: "active" },
    include: { recipients: true },
    orderBy: { nextSendAt: "asc" },
  });
  const emailRecipientCount = activeEmailTasks.reduce((sum, t) => sum + t.recipients.length, 0);
  const nextSend = activeEmailTasks[0]?.nextSendAt ?? null;

  return (
    <div className="shell-md">
      <span className="eyebrow">
        <span className="dot" aria-hidden="true"></span>
        <Link href="/">Sites</Link> / {site.name}
      </span>
      <div className="page-head">
        <div>
          <h1>
            {site.name}
            <span className="accent-dot">.</span>
          </h1>
          <p className="subtitle">Operational overview for this site.</p>
        </div>
        <div className="site-card-flags">
          {redZone && (
            <span className="badge badge-redzone">
              <span className="dot" aria-hidden="true"></span>
              Red Zone
            </span>
          )}
          {f90 && <span className="badge badge-f90">F90</span>}
        </div>
      </div>

      <div className="overview-grid">
        <div className="card">
          <div className="overview-card-head">
            <span className="overview-card-title">
              <BoltIcon />
              <h2>Slack Monitoring</h2>
            </span>
            <span className={`badge badge-${breachedCount > 0 ? "breached" : activeTasks.length > 0 ? "active" : "stopped"}`}>
              <span className="dot" aria-hidden="true"></span>
              {breachedCount > 0 ? "breached" : activeTasks.length > 0 ? "active" : "idle"}
            </span>
          </div>
          <div className="overview-stat-list">
            <div className="stat-row">
              <span>Active tasks</span>
              <span className="stat-value">{activeTasks.length}</span>
            </div>
            <div className="stat-row">
              <span>Panels watched</span>
              <span className="stat-value">{watchedMetricCount}</span>
            </div>
            <div className="stat-row">
              <span>Currently breached</span>
              <span className={`stat-value${breachedCount > 0 ? " breach" : ""}`}>{breachedCount}</span>
            </div>
          </div>
          <div className="overview-actions">
            <Link href={`/sites/${site.slug}/slack-tasks`}>
              <button type="button">View all</button>
            </Link>
            <Link href={`/sites/${site.slug}/slack-tasks/new`}>
              <button type="button" className="primary">
                Create new
              </button>
            </Link>
          </div>
        </div>

        <div className="card">
          <div className="overview-card-head">
            <span className="overview-card-title">
              <MailIcon />
              <h2>Email Monitoring</h2>
            </span>
            <span className={`badge badge-${activeEmailTasks.length > 0 ? "email" : "stopped"}`}>
              <span className="dot" aria-hidden="true"></span>
              {activeEmailTasks.length > 0 ? "active" : "idle"}
            </span>
          </div>
          <div className="overview-stat-list">
            <div className="stat-row">
              <span>Active tasks</span>
              <span className="stat-value">{activeEmailTasks.length}</span>
            </div>
            <div className="stat-row">
              <span>Recipients</span>
              <span className="stat-value">{emailRecipientCount || "—"}</span>
            </div>
            <div className="stat-row">
              <span>Next send</span>
              <span className="stat-value">{nextSend ? nextSend.toLocaleString() : "—"}</span>
            </div>
          </div>
          <div className="overview-actions">
            <Link href={`/sites/${site.slug}/email-tasks`}>
              <button type="button">View all</button>
            </Link>
            <Link href={`/sites/${site.slug}/email-tasks/new`}>
              <button type="button" className="primary">
                Create new
              </button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

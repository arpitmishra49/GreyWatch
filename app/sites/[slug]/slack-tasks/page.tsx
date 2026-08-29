import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AutoRefresh } from "@/app/tasks/AutoRefresh";
import { TaskList } from "@/app/tasks/TaskList";

export default async function SiteSlackTasksPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const site = await prisma.site.findUnique({ where: { slug } });
  if (!site) notFound();

  const tasks = await prisma.monitorTask.findMany({
    where: { siteId: site.id },
    include: {
      site: true,
      createdBy: { select: { username: true } },
      metrics: { orderBy: { panelTitle: "asc" } },
      recipients: true,
    },
    orderBy: { startedAt: "desc" },
    take: 100,
  });

  return (
    <div className="shell-lg">
      <AutoRefresh />
      <span className="eyebrow">
        <span className="dot" aria-hidden="true"></span>
        <Link href="/">Sites</Link> / <Link href={`/sites/${site.slug}`}>{site.name}</Link> / Slack tasks
      </span>
      <div className="page-head">
        <div>
          <h1>
            {site.name} Slack tasks<span className="accent-dot">.</span>
          </h1>
          <p className="subtitle">Monitor tasks for this site only — expand for the panels behind each one.</p>
        </div>
        <Link href={`/sites/${site.slug}/slack-tasks/new`}>
          <button className="primary">New task</button>
        </Link>
      </div>

      <TaskList tasks={tasks} showSiteName={false} emptyCtaHref={`/sites/${site.slug}/slack-tasks/new`} />
    </div>
  );
}

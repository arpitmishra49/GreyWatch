import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EmailTaskList } from "@/app/email-tasks/EmailTaskList";

export default async function SiteEmailTasksPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const site = await prisma.site.findUnique({ where: { slug } });
  if (!site) notFound();

  const tasks = await prisma.emailTask.findMany({
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
      <span className="eyebrow">
        <span className="dot" aria-hidden="true"></span>
        <Link href="/">Sites</Link> / <Link href={`/sites/${site.slug}`}>{site.name}</Link> / Email tasks
      </span>
      <div className="page-head">
        <div>
          <h1>
            {site.name} email tasks<span className="accent-dot">.</span>
          </h1>
          <p className="subtitle">Scheduled reports for this site only.</p>
        </div>
        <Link href={`/sites/${site.slug}/email-tasks/new`}>
          <button className="primary">New email task</button>
        </Link>
      </div>

      <EmailTaskList tasks={tasks} showSiteName={false} emptyCtaHref={`/sites/${site.slug}/email-tasks/new`} />
    </div>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NewTaskForm } from "@/app/tasks/NewTaskForm";

export default async function NewSiteSlackTaskPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const site = await prisma.site.findUnique({ where: { slug } });
  if (!site) notFound();

  return (
    <div className="shell-form">
      <span className="eyebrow">
        <span className="dot" aria-hidden="true"></span>
        <Link href="/">Sites</Link> / <Link href={`/sites/${site.slug}`}>{site.name}</Link> / New task
      </span>
      <h1>
        New task for {site.name}
        <span className="accent-dot">.</span>
      </h1>
      <p className="subtitle">
        Pick a dashboard, then one or more panels on it — each gets its own condition. You&apos;ll
        get a Slack alert (with a screenshot), per panel, only when it&apos;s breached.
      </p>
      <NewTaskForm siteId={site.id} siteSlug={site.slug} />
    </div>
  );
}

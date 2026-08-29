import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NewEmailTaskForm } from "@/app/email-tasks/NewEmailTaskForm";

export default async function NewSiteEmailTaskPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const site = await prisma.site.findUnique({ where: { slug } });
  if (!site) notFound();

  return (
    <div className="shell-form">
      <span className="eyebrow">
        <span className="dot" aria-hidden="true"></span>
        <Link href="/">Sites</Link> / <Link href={`/sites/${site.slug}`}>{site.name}</Link> / New email task
      </span>
      <h1>
        New email task for {site.name}
        <span className="accent-dot">.</span>
      </h1>
      <p className="subtitle">
        Pick a dashboard and the panels to report on, a sending interval, and who gets it. This is a
        scheduled report, not an alert — it sends whether or not anything looks unusual.
      </p>
      <NewEmailTaskForm siteId={site.id} siteSlug={site.slug} />
    </div>
  );
}

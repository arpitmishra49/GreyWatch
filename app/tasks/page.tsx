import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AutoRefresh } from "./AutoRefresh";
import { TaskList } from "./TaskList";

export default async function TasksPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const tasks = await prisma.monitorTask.findMany({
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
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <span className="dot" aria-hidden="true"></span>
            All sites
          </span>
          <h1>
            Tasks<span className="accent-dot">.</span>
          </h1>
          <p className="subtitle">Every monitor task across every site — expand for the panels behind each one.</p>
        </div>
        <Link href="/tasks/new">
          <button className="primary">New task</button>
        </Link>
      </div>

      <TaskList tasks={tasks} showSiteName />
    </div>
  );
}

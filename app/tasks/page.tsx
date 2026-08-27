import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { StopButton } from "./StopButton";
import { AutoRefresh } from "./AutoRefresh";

const OPERATOR_SYMBOLS: Record<string, string> = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  eq: "=",
};

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const hours = min / 60;
  return `${hours}h`;
}

export default async function TasksPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const tasks = await prisma.monitorTask.findMany({
    include: {
      site: true,
      createdBy: { select: { username: true } },
      metrics: { orderBy: { panelTitle: "asc" } },
    },
    orderBy: { startedAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <AutoRefresh />
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <span className="dot" aria-hidden="true"></span>
            Site A &middot; live monitoring
          </span>
          <h1>
            Tasks<span className="accent-dot">.</span>
          </h1>
          <p className="subtitle">Active and recent monitor tasks — expand for the panels behind each one.</p>
        </div>
        <Link href="/tasks/new">
          <button className="primary">New task</button>
        </Link>
      </div>

      {tasks.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span>
              No tasks yet<span className="accent-dot">.</span>
            </span>
            <span className="empty-sub">Create one to start watching a Grafana panel.</span>
          </div>
        </div>
      ) : (
        <div className="table-card">
          {tasks.map((task) => (
            <div className="task-group" key={task.id}>
              <div className="task-head">
                <div className="task-head-main">
                  <span className="site-name">{task.site.name}</span>
                  <span className={`badge badge-${task.status}`}>
                    <span className="dot"></span>
                    {task.status}
                  </span>
                  <div className="task-meta">
                    <span className="mono">
                      poll {formatMinutes(task.pollIntervalMin)} &middot; cooldown {formatMinutes(task.cooldownMin)}
                    </span>
                    <span>by {task.createdBy.username}</span>
                    <span>expires {task.expiresAt.toLocaleString()}</span>
                  </div>
                </div>
                {task.status === "active" && <StopButton taskId={task.id} />}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="metrics-table">
                  <thead>
                    <tr>
                      <th>Panel</th>
                      <th>Condition</th>
                      <th>Status</th>
                      <th>Last alert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {task.metrics.map((metric) => (
                      <tr key={metric.id}>
                        <td>{metric.panelTitle}</td>
                        <td className="mono">
                          value {OPERATOR_SYMBOLS[metric.operator] ?? metric.operator} {metric.threshold}
                        </td>
                        <td>
                          {metric.lastStatus ? (
                            <span className={`badge badge-${metric.lastStatus}`}>
                              <span className="dot"></span>
                              {metric.lastStatus}
                            </span>
                          ) : (
                            <span className="mono" style={{ color: "var(--slate-soft)" }}>
                              not checked yet
                            </span>
                          )}
                        </td>
                        <td className="mono">
                          {metric.lastAlertAt ? metric.lastAlertAt.toLocaleTimeString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

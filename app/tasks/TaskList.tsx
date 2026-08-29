"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StopButton } from "./StopButton";
import { TaskCard } from "./TaskCard";
import { TaskMetadata } from "./TaskMetadata";
import { MetricStatusBadge } from "./MetricStatusBadge";

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

export interface TaskListMetric {
  id: string;
  panelTitle: string;
  operator: string;
  threshold: number;
  lastStatus: string | null;
  lastAlertAt: Date | null;
}

export interface TaskListTask {
  id: string;
  status: string;
  pollIntervalMin: number;
  cooldownMin: number;
  expiresAt: Date;
  site: { name: string };
  createdBy: { username: string };
  metrics: TaskListMetric[];
  recipients?: { id: string; slackUserId: string }[];
}

type FilterTab = "all" | "active" | "breached" | "stopped" | "expired";

function hasBreach(task: TaskListTask): boolean {
  return task.metrics.some((m) => m.lastStatus === "breached");
}

// Purely a display order — the server's own ordering (by startedAt) is
// preserved within each bucket since Array.sort is stable. Doesn't touch
// how tasks are actually queried or how monitoring/cooldown logic works.
function priority(task: TaskListTask): number {
  if (task.status === "active") return hasBreach(task) ? 0 : 1;
  if (task.status === "stopped") return 2;
  if (task.status === "expired") return 3;
  return 4;
}

export function TaskList({
  tasks,
  showSiteName = true,
  emptyCtaHref,
  emptyCtaLabel = "Create Monitoring Task",
}: {
  tasks: TaskListTask[];
  showSiteName?: boolean;
  emptyCtaHref?: string;
  emptyCtaLabel?: string;
}) {
  const [tab, setTab] = useState<FilterTab>("all");

  const counts = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter((t) => t.status === "active").length,
      breached: tasks.filter((t) => t.status === "active" && hasBreach(t)).length,
      stopped: tasks.filter((t) => t.status === "stopped").length,
      expired: tasks.filter((t) => t.status === "expired").length,
    }),
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    const filtered =
      tab === "all"
        ? tasks
        : tab === "breached"
          ? tasks.filter((t) => t.status === "active" && hasBreach(t))
          : tasks.filter((t) => t.status === tab);
    return [...filtered].sort((a, b) => priority(a) - priority(b));
  }, [tasks, tab]);

  if (tasks.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <span>
            No active monitoring tasks<span className="accent-dot">.</span>
          </span>
          <span className="empty-sub">Create one to start watching a Grafana panel.</span>
          {emptyCtaHref && (
            <Link href={emptyCtaHref} className="empty-cta">
              <button type="button" className="primary">
                {emptyCtaLabel}
              </button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="task-filter-bar">
        {(
          [
            ["all", "All", counts.all],
            ["active", "Running", counts.active],
            ["breached", "Breached", counts.breached],
            ["stopped", "Stopped", counts.stopped],
            ["expired", "Expired", counts.expired],
          ] as [FilterTab, string, number][]
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            className={`filter-chip${tab === value ? " active" : ""}`}
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      <div className="task-list">
        {visibleTasks.map((task) => {
          const breached = hasBreach(task);
          const metaItems = [
            <span className="mono" key="poll">
              poll {formatMinutes(task.pollIntervalMin)} &middot; cooldown {formatMinutes(task.cooldownMin)}
            </span>,
            <span key="by">by {task.createdBy.username}</span>,
            <span key="expires">expires {task.expiresAt.toLocaleString()}</span>,
          ];
          if (task.recipients && task.recipients.length > 0) {
            metaItems.push(
              <span key="recipients">
                {task.recipients.length} DM recipient{task.recipients.length === 1 ? "" : "s"}
              </span>,
            );
          }

          return (
            <TaskCard
              key={task.id}
              siteName={task.site.name}
              showSiteName={showSiteName}
              status={task.status}
              hasBreach={breached}
              metadata={<TaskMetadata items={metaItems} />}
              actions={task.status === "active" && <StopButton taskId={task.id} />}
            >
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
                          <MetricStatusBadge status={metric.lastStatus} />
                        </td>
                        <td className="mono">
                          {metric.lastAlertAt ? metric.lastAlertAt.toLocaleTimeString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TaskCard>
          );
        })}
      </div>
    </div>
  );
}

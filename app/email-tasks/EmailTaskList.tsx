"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StopButton } from "@/app/tasks/StopButton";
import { TaskCard } from "@/app/tasks/TaskCard";
import { TaskMetadata } from "@/app/tasks/TaskMetadata";

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

export interface EmailTaskListMetric {
  id: string;
  panelTitle: string;
  operator: string | null;
  threshold: number | null;
}

export interface EmailTaskListRecipient {
  id: string;
  email: string;
  kind: string;
}

export interface EmailTaskListTask {
  id: string;
  status: string;
  intervalMin: number;
  expiresAt: Date;
  lastSentAt: Date | null;
  site: { name: string };
  createdBy: { username: string };
  metrics: EmailTaskListMetric[];
  recipients: EmailTaskListRecipient[];
}

type FilterTab = "all" | "active" | "stopped" | "expired";

// Purely a display order — the server's own ordering (by startedAt) is
// preserved within each bucket since Array.sort is stable.
function priority(task: EmailTaskListTask): number {
  if (task.status === "active") return 0;
  if (task.status === "stopped") return 1;
  if (task.status === "expired") return 2;
  return 3;
}

export function EmailTaskList({
  tasks,
  showSiteName = true,
  emptyCtaHref,
  emptyCtaLabel = "Create Email Task",
}: {
  tasks: EmailTaskListTask[];
  showSiteName?: boolean;
  emptyCtaHref?: string;
  emptyCtaLabel?: string;
}) {
  const [tab, setTab] = useState<FilterTab>("all");

  const counts = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter((t) => t.status === "active").length,
      stopped: tasks.filter((t) => t.status === "stopped").length,
      expired: tasks.filter((t) => t.status === "expired").length,
    }),
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    const filtered = tab === "all" ? tasks : tasks.filter((t) => t.status === tab);
    return [...filtered].sort((a, b) => priority(a) - priority(b));
  }, [tasks, tab]);

  if (tasks.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <span>
            No active email reports<span className="accent-dot">.</span>
          </span>
          <span className="empty-sub">Create one to start sending scheduled reports.</span>
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
          const toCount = task.recipients.filter((r) => r.kind === "to").length;
          const ccCount = task.recipients.filter((r) => r.kind === "cc").length;
          const metaItems = [
            <span className="mono" key="interval">
              every {formatMinutes(task.intervalMin)}
            </span>,
            <span key="by">by {task.createdBy.username}</span>,
            <span key="expires">expires {task.expiresAt.toLocaleString()}</span>,
            <span key="recipients">
              {toCount} to{ccCount > 0 ? `, ${ccCount} cc` : ""}
            </span>,
            <span key="lastSent">
              {task.lastSentAt ? `last sent ${task.lastSentAt.toLocaleString()}` : "not sent yet"}
            </span>,
          ];

          return (
            <TaskCard
              key={task.id}
              siteName={task.site.name}
              showSiteName={showSiteName}
              status={task.status}
              metadata={<TaskMetadata items={metaItems} />}
              actions={task.status === "active" && <StopButton taskId={task.id} kind="email-tasks" />}
            >
              <div style={{ overflowX: "auto" }}>
                <table className="metrics-table">
                  <thead>
                    <tr>
                      <th>Panel</th>
                      <th>Threshold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {task.metrics.map((metric) => (
                      <tr key={metric.id}>
                        <td>{metric.panelTitle}</td>
                        <td className="mono">
                          {metric.operator && metric.threshold !== null
                            ? `value ${OPERATOR_SYMBOLS[metric.operator] ?? metric.operator} ${metric.threshold}`
                            : "—"}
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

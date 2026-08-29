import type { ReactNode } from "react";
import { TaskStatusBadge } from "./TaskStatusBadge";

// Shared shell for one task's card — used by both Slack tasks (TaskList) and
// email tasks (EmailTaskList) so the two page types stay visually identical
// apart from what's actually different (their metadata line and body table).
export function TaskCard({
  siteName,
  showSiteName,
  status,
  hasBreach = false,
  metadata,
  actions,
  children,
}: {
  siteName: string;
  showSiteName: boolean;
  status: string;
  hasBreach?: boolean;
  metadata: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const isInactive = status !== "active";

  return (
    <div className={`task-card${isInactive ? " is-inactive" : ""}${hasBreach ? " has-breach" : ""}`}>
      <div className="task-card-header">
        <div>
          <div className="task-card-heading">
            {showSiteName && <span className="task-card-site-name">{siteName}</span>}
            <TaskStatusBadge status={status} />
          </div>
          {metadata}
        </div>
        {actions}
      </div>
      <div className="task-card-body">{children}</div>
    </div>
  );
}

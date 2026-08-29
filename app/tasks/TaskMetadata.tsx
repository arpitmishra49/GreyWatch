import type { ReactNode } from "react";

// Compact secondary metadata line under a task card's heading — poll/cooldown,
// creator, expiry, recipients, whatever's relevant. Shared between Slack and
// email task cards so the two stay visually identical for this part.
export function TaskMetadata({ items }: { items: ReactNode[] }) {
  return (
    <div className="task-card-meta">
      {items.map((item, i) => (
        <span key={i}>{item}</span>
      ))}
    </div>
  );
}

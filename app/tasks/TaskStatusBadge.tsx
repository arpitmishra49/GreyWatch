const STATUS_LABELS: Record<string, string> = {
  active: "Running",
  stopped: "Stopped",
  expired: "Expired",
};

export function TaskStatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="dot" aria-hidden="true"></span>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

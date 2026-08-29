const STATUS_LABELS: Record<string, string> = {
  breached: "Breached",
  ok: "Healthy",
  error: "Error",
};

export function MetricStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <span className="mono metric-status-pending">not checked yet</span>;
  }
  return (
    <span className={`badge badge-${status}`}>
      <span className="dot" aria-hidden="true"></span>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

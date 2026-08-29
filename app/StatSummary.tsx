export interface StatSummaryData {
  totalSites: number;
  activeMonitoring: number;
  activeEmail: number;
  breachedMetrics: number;
  redZoneSites: number;
}

export function StatSummary({ data }: { data: StatSummaryData }) {
  return (
    <div className="stat-summary">
      <div className="stat-summary-item">
        <span className="stat-summary-value">{data.totalSites}</span>
        <span className="stat-summary-label">Sites</span>
      </div>
      <div className="stat-summary-item">
        <span className="stat-summary-value">{data.activeMonitoring}</span>
        <span className="stat-summary-label">Monitoring</span>
      </div>
      <div className="stat-summary-item">
        <span className="stat-summary-value">{data.activeEmail}</span>
        <span className="stat-summary-label">Email active</span>
      </div>
      <div className="stat-summary-item">
        <span className={`stat-summary-value${data.breachedMetrics > 0 ? " danger" : ""}`}>
          {data.breachedMetrics}
        </span>
        <span className="stat-summary-label">Breached</span>
      </div>
      <div className="stat-summary-item">
        <span className={`stat-summary-value${data.redZoneSites > 0 ? " danger" : ""}`}>{data.redZoneSites}</span>
        <span className="stat-summary-label">Red zone</span>
      </div>
    </div>
  );
}

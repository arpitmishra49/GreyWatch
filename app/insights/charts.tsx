// Deliberately hand-rolled with plain divs/CSS, not SVG or a charting
// library — three small, purpose-built visualizations, matching this app's
// existing pattern of avoiding dependencies for things this simple.
import { formatDuration, formatPercent } from "./format";

export function BarList({ items }: { items: { id: string; label: string; value: number }[] }) {
  if (items.length === 0) return <p className="chart-empty">No data for this range.</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="bar-list">
      {items.map((item) => (
        <div className="bar-list-row" key={item.id}>
          <span className="bar-list-label" title={item.label}>
            {item.label}
          </span>
          <span className="bar-list-track">
            <span className="bar-list-fill" style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
          <span className="bar-list-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export function HealthBar({ healthySeconds, breachedSeconds }: { healthySeconds: number; breachedSeconds: number }) {
  const total = healthySeconds + breachedSeconds;
  if (total === 0) return <p className="chart-empty">No monitored time in this range.</p>;
  const healthyPct = (healthySeconds / total) * 100;
  const breachedPct = 100 - healthyPct;

  return (
    <div>
      <div className="health-bar">
        {healthyPct > 0 && <div className="health-bar-segment healthy" style={{ width: `${healthyPct}%` }} />}
        {breachedPct > 0 && <div className="health-bar-segment breached" style={{ width: `${breachedPct}%` }} />}
      </div>
      <div className="health-bar-legend">
        <span>
          <span className="swatch healthy" aria-hidden="true"></span>
          Healthy — {formatDuration(healthySeconds)} ({formatPercent(healthyPct)})
        </span>
        <span>
          <span className="swatch breached" aria-hidden="true"></span>
          Breached — {formatDuration(breachedSeconds)} ({formatPercent(breachedPct)})
        </span>
      </div>
    </div>
  );
}

export function PeakCompare({
  peakCount,
  offPeakCount,
  peakDurationSec,
  offPeakDurationSec,
}: {
  peakCount: number;
  offPeakCount: number;
  peakDurationSec: number;
  offPeakDurationSec: number;
}) {
  return (
    <div className="peak-compare">
      <div className="peak-compare-col">
        <div className="peak-compare-value">{peakCount}</div>
        <div className="peak-compare-label">Peak breaches</div>
        <div className="chart-empty" style={{ padding: 0, marginTop: 4 }}>
          {formatDuration(peakDurationSec)} total
        </div>
      </div>
      <div className="peak-compare-col">
        <div className="peak-compare-value">{offPeakCount}</div>
        <div className="peak-compare-label">Off-peak breaches</div>
        <div className="chart-empty" style={{ padding: 0, marginTop: 4 }}>
          {formatDuration(offPeakDurationSec)} total
        </div>
      </div>
    </div>
  );
}

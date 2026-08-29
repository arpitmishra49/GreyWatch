"use client";

import { useEffect, useMemo, useState } from "react";
import { BarList, HealthBar, PeakCompare } from "./charts";
import { formatDuration, formatPercent } from "./format";

type RangePreset = "today" | "last24h" | "last7d" | "last30d";

interface SiteOption {
  id: string;
  name: string;
}

interface Summary {
  metricCount: number;
  activeTaskCount: number;
  totalBreaches: number;
  healthySeconds: number;
  breachedSeconds: number;
  unmonitoredSeconds: number;
  healthPercentage: number | null;
  slaCompliancePercentage: number | null;
  avgBreachDurationSec: number | null;
  longestBreachSec: number | null;
  avgRecoverySec: number | null;
}

interface MetricRow {
  metricId: string;
  panelTitle: string;
  siteName: string;
  currentStatus: string | null;
  breachCount: number;
  healthyPercentage: number | null;
  avgBreachDurationSec: number | null;
  longestBreachSec: number | null;
  lastBreachAt: string | null;
}

interface BreachRow {
  id: string;
  siteName: string;
  panelTitle: string;
  operator: string;
  threshold: number;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  maxValue: number | null;
}

interface PeakAnalysis {
  peakWindowDescription: string;
  peakBreachCount: number;
  offPeakBreachCount: number;
  peakDurationSec: number;
  offPeakDurationSec: number;
  bySite: { siteId: string; siteName: string; peakBreachCount: number; offPeakBreachCount: number; metSlaDuringPeak: boolean }[];
  topProblematicMetrics: { metricId: string; panelTitle: string; siteName: string; peakBreachCount: number }[];
}

const OPERATOR_SYMBOLS: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=" };

export function InsightsDashboard() {
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [range, setRange] = useState<RangePreset>("last7d");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [peak, setPeak] = useState<PeakAnalysis | null>(null);
  const [breaches, setBreaches] = useState<{ items: BreachRow[]; total: number }>({ items: [], total: 0 });
  const [breachStatus, setBreachStatus] = useState<"all" | "open" | "closed">("all");
  const [breachPage, setBreachPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sites?limit=50&sort=name-asc")
      .then((res) => res.json())
      .then((data: { items: { id: string; name: string }[] }) => setSites(data.items));
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (siteId) params.set("siteId", siteId);
    return params.toString();
  }, [siteId, range]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/insights/summary?${query}`).then((r) => r.json()),
      fetch(`/api/insights/metrics?${query}`).then((r) => r.json()),
      fetch(`/api/insights/peak?${query}`).then((r) => r.json()),
    ]).then(([summaryData, metricsData, peakData]) => {
      if (cancelled) return;
      setSummary(summaryData);
      setMetrics(metricsData.items);
      setPeak(peakData);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(query);
    params.set("page", String(breachPage));
    params.set("pageSize", "10");
    if (breachStatus !== "all") params.set("status", breachStatus);
    fetch(`/api/insights/breaches?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setBreaches(data);
      });
    return () => {
      cancelled = true;
    };
  }, [query, breachStatus, breachPage]);

  // Page/loading resets happen right where the user action originates
  // (below), not reactively via an effect watching derived state.
  function handleSiteChange(value: string) {
    setSiteId(value);
    setLoading(true);
    setBreachPage(1);
  }

  function handleRangeChange(value: RangePreset) {
    setRange(value);
    setLoading(true);
    setBreachPage(1);
  }

  function handleBreachStatusChange(value: "all" | "open" | "closed") {
    setBreachStatus(value);
    setBreachPage(1);
  }

  const breachByMetricBars = useMemo(
    () =>
      [...metrics]
        .sort((a, b) => b.breachCount - a.breachCount)
        .filter((m) => m.breachCount > 0)
        .slice(0, 8)
        .map((m) => ({ id: m.metricId, label: `${m.siteName} — ${m.panelTitle}`, value: m.breachCount })),
    [metrics],
  );

  const totalPages = Math.max(1, Math.ceil(breaches.total / 10));

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-sort" style={{ marginLeft: 0 }}>
          <label htmlFor="insights-site">Site</label>
          <select id="insights-site" value={siteId} onChange={(e) => handleSiteChange(e.target.value)}>
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar-sort">
          <label htmlFor="insights-range">Range</label>
          <select id="insights-range" value={range} onChange={(e) => handleRangeChange(e.target.value as RangePreset)}>
            <option value="today">Today</option>
            <option value="last24h">Last 24 hours</option>
            <option value="last7d">Last 7 days</option>
            <option value="last30d">Last 30 days</option>
          </select>
        </div>
        <a
          href={`/api/insights/report/pdf?${query}`}
          style={{ marginLeft: "auto" }}
        >
          <button type="button" className="primary">
            Download PDF
          </button>
        </a>
      </div>

      {loading || !summary ? (
        <div className="empty-state">
          <span>Loading insights…</span>
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-card-label">Health</div>
              <div className="kpi-card-value">{formatPercent(summary.healthPercentage)}</div>
              <div className="kpi-card-sub">of monitored time</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card-label">SLA Compliance</div>
              <div className={`kpi-card-value${(summary.slaCompliancePercentage ?? 100) < 99 ? " danger" : " success"}`}>
                {formatPercent(summary.slaCompliancePercentage)}
              </div>
              <div className="kpi-card-sub">of full period</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card-label">Total Breaches</div>
              <div className={`kpi-card-value${summary.totalBreaches > 0 ? " danger" : ""}`}>{summary.totalBreaches}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card-label">Avg Breach Duration</div>
              <div className="kpi-card-value">{formatDuration(summary.avgBreachDurationSec)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card-label">Longest Breach</div>
              <div className="kpi-card-value">{formatDuration(summary.longestBreachSec)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card-label">Unmonitored Time</div>
              <div className="kpi-card-value">{formatDuration(summary.unmonitoredSeconds)}</div>
              <div className="kpi-card-sub">{summary.metricCount} metric(s) in scope</div>
            </div>
          </div>

          <div className="chart-grid">
            <div className="chart-card">
              <div className="chart-card-title">Healthy vs. Breached Time</div>
              <HealthBar healthySeconds={summary.healthySeconds} breachedSeconds={summary.breachedSeconds} />
            </div>
            <div className="chart-card">
              <div className="chart-card-title">Breaches by Metric</div>
              <BarList items={breachByMetricBars} />
            </div>
            {peak && (
              <div className="chart-card">
                <div className="chart-card-title">Peak vs. Off-Peak Breaches</div>
                <p className="chart-empty" style={{ marginBottom: 8 }}>
                  Peak window: {peak.peakWindowDescription}
                </p>
                <PeakCompare
                  peakCount={peak.peakBreachCount}
                  offPeakCount={peak.offPeakBreachCount}
                  peakDurationSec={peak.peakDurationSec}
                  offPeakDurationSec={peak.offPeakDurationSec}
                />
              </div>
            )}
            {peak && peak.bySite.length > 0 && (
              <div className="chart-card">
                <div className="chart-card-title">Peak Breach Frequency by Site</div>
                <BarList
                  items={[...peak.bySite]
                    .sort((a, b) => b.peakBreachCount - a.peakBreachCount)
                    .map((s) => ({
                      id: s.siteId,
                      label: s.metSlaDuringPeak ? `${s.siteName} (SLA met)` : s.siteName,
                      value: s.peakBreachCount,
                    }))}
                />
              </div>
            )}
            {peak && peak.topProblematicMetrics.length > 0 && (
              <div className="chart-card">
                <div className="chart-card-title">Most Problematic Metrics (Peak Hours)</div>
                <BarList
                  items={peak.topProblematicMetrics.map((m) => ({
                    id: m.metricId,
                    label: `${m.siteName} — ${m.panelTitle}`,
                    value: m.peakBreachCount,
                  }))}
                />
              </div>
            )}
          </div>

          <h2 className="insights-section-title">Metric Breakdown</h2>
          <div className="table-card" style={{ marginBottom: 24 }}>
            <div style={{ overflowX: "auto" }}>
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Panel</th>
                    <th>Current</th>
                    <th>Breaches</th>
                    <th>Healthy %</th>
                    <th>Avg Duration</th>
                    <th>Longest</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="mono" style={{ color: "var(--slate-soft)" }}>
                        No metrics in scope for this range.
                      </td>
                    </tr>
                  ) : (
                    metrics.map((m) => (
                      <tr key={m.metricId}>
                        <td>{m.siteName}</td>
                        <td>{m.panelTitle}</td>
                        <td>
                          {m.currentStatus ? (
                            <span className={`badge badge-${m.currentStatus}`}>
                              <span className="dot" aria-hidden="true"></span>
                              {m.currentStatus}
                            </span>
                          ) : (
                            <span className="mono" style={{ color: "var(--slate-soft)" }}>
                              —
                            </span>
                          )}
                        </td>
                        <td className="mono">{m.breachCount}</td>
                        <td className="mono">{formatPercent(m.healthyPercentage)}</td>
                        <td className="mono">{formatDuration(m.avgBreachDurationSec)}</td>
                        <td className="mono">{formatDuration(m.longestBreachSec)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="page-head" style={{ marginBottom: 12 }}>
            <h2 className="insights-section-title" style={{ marginBottom: 0 }}>
              Breach Incidents
            </h2>
            <div className="toolbar-filters">
              {(["all", "open", "closed"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`filter-chip${breachStatus === s ? " active" : ""}`}
                  onClick={() => handleBreachStatusChange(s)}
                >
                  {s === "all" ? "All" : s === "open" ? "Ongoing" : "Recovered"}
                </button>
              ))}
            </div>
          </div>

          <div className="table-card">
            <div style={{ overflowX: "auto" }}>
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Metric</th>
                    <th>Condition</th>
                    <th>Started</th>
                    <th>Recovered</th>
                    <th>Duration</th>
                    <th>Max Value</th>
                  </tr>
                </thead>
                <tbody>
                  {breaches.items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="mono" style={{ color: "var(--slate-soft)" }}>
                        No breach incidents for this range.
                      </td>
                    </tr>
                  ) : (
                    breaches.items.map((b) => (
                      <tr key={b.id}>
                        <td>{b.siteName}</td>
                        <td>{b.panelTitle}</td>
                        <td className="mono">
                          value {OPERATOR_SYMBOLS[b.operator] ?? b.operator} {b.threshold}
                        </td>
                        <td className="mono">{new Date(b.startedAt).toLocaleString()}</td>
                        <td className="mono">
                          {b.endedAt ? (
                            new Date(b.endedAt).toLocaleString()
                          ) : (
                            <span className="badge badge-breached">
                              <span className="dot" aria-hidden="true"></span>
                              ongoing
                            </span>
                          )}
                        </td>
                        <td className="mono">{formatDuration(b.durationSec)}</td>
                        <td className="mono">{b.maxValue ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {breaches.total > 10 && (
            <div className="load-more-status" style={{ display: "flex", justifyContent: "center", gap: 16, alignItems: "center" }}>
              <button type="button" className="ghost" disabled={breachPage <= 1} onClick={() => setBreachPage((p) => p - 1)}>
                ← Prev
              </button>
              <span>
                Page {breachPage} of {totalPages}
              </span>
              <button type="button" className="ghost" disabled={breachPage >= totalPages} onClick={() => setBreachPage((p) => p + 1)}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

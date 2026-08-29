"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  COOLDOWN_PRESETS_MIN,
  DURATION_PRESETS_MIN,
  POLL_INTERVAL_PRESETS_MIN,
  type GrafanaDashboard,
  type GrafanaPanel,
} from "@/lib/types";
import { MetricPicker, type SelectedMetric } from "./MetricPicker";
import { RecipientPicker } from "./RecipientPicker";

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const hours = min / 60;
  return `${hours} hr${hours === 1 ? "" : "s"}`;
}

export function NewTaskForm({ siteId, siteSlug }: { siteId: string; siteSlug: string }) {
  const router = useRouter();

  const [dashboards, setDashboards] = useState<GrafanaDashboard[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(true);
  const [dashboardsError, setDashboardsError] = useState<string | null>(null);
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [dashboardUid, setDashboardUid] = useState("");

  const [panels, setPanels] = useState<GrafanaPanel[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [panelsError, setPanelsError] = useState<string | null>(null);

  const [selectedMetrics, setSelectedMetrics] = useState<Record<number, SelectedMetric>>({});
  const [recipients, setRecipients] = useState<string[]>([]);

  const [pollIntervalMin, setPollIntervalMin] = useState(POLL_INTERVAL_PRESETS_MIN[1]);
  const [cooldownMin, setCooldownMin] = useState(COOLDOWN_PRESETS_MIN[1]);
  const [durationMin, setDurationMin] = useState(DURATION_PRESETS_MIN[2]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: discover every dashboard on this site's Grafana instance.
  useEffect(() => {
    let cancelled = false;
    async function loadDashboards() {
      setDashboardsLoading(true);
      setDashboardsError(null);
      try {
        const res = await fetch(`/api/sites/${siteId}/dashboards`);
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load dashboards");
        const data: GrafanaDashboard[] = await res.json();
        if (cancelled) return;
        setDashboards(data);
        if (data.length > 0) setDashboardUid(data[0].uid);
      } catch (err) {
        if (!cancelled) setDashboardsError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setDashboardsLoading(false);
      }
    }
    loadDashboards();
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  // Step 2: once a dashboard is picked, discover its panels.
  useEffect(() => {
    if (!dashboardUid) return;
    let cancelled = false;
    async function loadPanels() {
      setPanelsLoading(true);
      setPanelsError(null);
      setSelectedMetrics({});
      try {
        const res = await fetch(`/api/sites/${siteId}/dashboards/${dashboardUid}/panels`);
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load panels");
        const data: GrafanaPanel[] = await res.json();
        if (cancelled) return;
        setPanels(data);
      } catch (err) {
        if (!cancelled) setPanelsError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setPanelsLoading(false);
      }
    }
    loadPanels();
    return () => {
      cancelled = true;
    };
  }, [siteId, dashboardUid]);

  const filteredDashboards = useMemo(() => {
    if (!dashboardSearch.trim()) return dashboards;
    const q = dashboardSearch.toLowerCase();
    return dashboards.filter((d) => d.title.toLowerCase().includes(q));
  }, [dashboards, dashboardSearch]);

  const selectedCount = Object.keys(selectedMetrics).length;
  const hasIncompleteThreshold = Object.values(selectedMetrics).some((m) => m.threshold.trim() === "");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const metrics = Object.entries(selectedMetrics).map(([panelId, metric]) => {
      const panel = panels.find((p) => p.id === Number(panelId));
      const thresholdNum = Number(metric.threshold);
      return {
        panelId: Number(panelId),
        panelTitle: panel?.title ?? `Panel ${panelId}`,
        operator: metric.operator,
        threshold: thresholdNum,
      };
    });

    if (!dashboardUid) {
      setError("Pick a dashboard");
      return;
    }
    if (metrics.length === 0) {
      setError("Pick at least one panel to watch");
      return;
    }
    if (metrics.some((m) => Number.isNaN(m.threshold))) {
      setError("Every selected panel needs a numeric threshold");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          dashboardUid,
          metrics,
          pollIntervalMin,
          cooldownMin,
          durationMin,
          recipientSlackIds: recipients,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create task");
      router.push(`/sites/${siteSlug}/slack-tasks`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const selectedDashboard = dashboards.find((d) => d.uid === dashboardUid);
  const selectedMetricList = Object.entries(selectedMetrics).map(([panelId, metric]) => {
    const panel = panels.find((p) => p.id === Number(panelId));
    return { title: panel?.title ?? `Panel ${panelId}`, operator: metric.operator, threshold: metric.threshold };
  });

  return (
    <div className="task-form-grid">
      <form onSubmit={handleSubmit} className="card">
        <div className="form-section">
          <div className="form-section-head">
            <span className="form-section-number">1</span>
            <span className="form-section-title">Dashboard</span>
          </div>
          <p className="form-section-desc">Select the Grafana dashboard to monitor.</p>
          {dashboardsLoading && <span className="field-hint">Discovering dashboards from Grafana...</span>}
          {dashboardsError && <span className="error-text">{dashboardsError}</span>}
          {!dashboardsLoading && !dashboardsError && (
            <>
              <input
                id="dashboardSearch"
                type="text"
                placeholder="Search dashboards..."
                value={dashboardSearch}
                onChange={(e) => setDashboardSearch(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <select
                value={dashboardUid}
                onChange={(e) => setDashboardUid(e.target.value)}
                size={Math.min(6, Math.max(3, filteredDashboards.length))}
              >
                {filteredDashboards.map((d) => (
                  <option key={d.uid} value={d.uid}>
                    {d.title}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <div className="form-section">
          <div className="form-section-head">
            <span className="form-section-number">2</span>
            <span className="form-section-title">Panels to watch</span>
            {selectedCount > 0 && <span className="field-hint">{selectedCount} selected</span>}
          </div>
          <p className="form-section-desc">Pick one or more panels — each gets its own condition.</p>
          {panelsLoading && <span className="field-hint">Loading panels from Grafana...</span>}
          {panelsError && <span className="error-text">{panelsError}</span>}
          {!panelsLoading && !panelsError && (
            <MetricPicker panels={panels} selected={selectedMetrics} onChange={setSelectedMetrics} />
          )}
        </div>

        <div className="form-section">
          <div className="form-section-head">
            <span className="form-section-number">3</span>
            <span className="form-section-title">Monitoring schedule</span>
          </div>
          <p className="form-section-desc">How often to check, how long to wait between repeat alerts, and when to stop.</p>
          <div className="field-row">
            <div className="field">
              <label htmlFor="pollInterval">Poll interval</label>
              <select
                id="pollInterval"
                value={pollIntervalMin}
                onChange={(e) => setPollIntervalMin(Number(e.target.value))}
              >
                {POLL_INTERVAL_PRESETS_MIN.map((min) => (
                  <option key={min} value={min}>
                    {formatMinutes(min)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cooldown">Cooldown</label>
              <select id="cooldown" value={cooldownMin} onChange={(e) => setCooldownMin(Number(e.target.value))}>
                {COOLDOWN_PRESETS_MIN.map((min) => (
                  <option key={min} value={min}>
                    {formatMinutes(min)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="duration">Duration</label>
            <select id="duration" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
              {DURATION_PRESETS_MIN.map((min) => (
                <option key={min} value={min}>
                  {formatMinutes(min)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-head">
            <span className="form-section-number">4</span>
            <span className="form-section-title">Alert recipients</span>
          </div>
          <p className="form-section-desc">Optional — DM specific teammates in addition to the L3 channel.</p>
          <RecipientPicker recipients={recipients} onChange={setRecipients} />
        </div>

        {error && <p className="error-text">{error}</p>}

        <button
          type="submit"
          className="primary"
          disabled={submitting || selectedCount === 0 || hasIncompleteThreshold}
        >
          {submitting ? "Starting..." : `Start task${selectedCount > 1 ? ` (${selectedCount} panels)` : ""}`}
        </button>
      </form>

      <aside className="card config-summary">
        <span className="config-summary-head">Configuration summary</span>

        <div className="config-summary-row">
          <span className="config-summary-label">Dashboard</span>
          <span className={`config-summary-value${selectedDashboard ? "" : " muted"}`}>
            {selectedDashboard?.title ?? "Not selected yet"}
          </span>
        </div>

        <div className="config-summary-row">
          <span className="config-summary-label">Panels ({selectedMetricList.length})</span>
          {selectedMetricList.length === 0 ? (
            <span className="config-summary-value muted">No panels selected</span>
          ) : (
            <div className="config-summary-list">
              {selectedMetricList.map((m, i) => (
                <div className="config-summary-list-item" key={i}>
                  <span>{m.title}</span>
                  <span className="mono">
                    {m.operator} {m.threshold || "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="config-summary-row">
          <span className="config-summary-label">Schedule</span>
          <span className="config-summary-value">
            poll {formatMinutes(pollIntervalMin)} &middot; cooldown {formatMinutes(cooldownMin)}
          </span>
          <span className="config-summary-value" style={{ fontSize: 12.5, color: "var(--slate-soft)" }}>
            runs for {formatMinutes(durationMin)}
          </span>
        </div>

        <div className="config-summary-row">
          <span className="config-summary-label">Recipients</span>
          <span className={`config-summary-value${recipients.length === 0 ? " muted" : ""}`}>
            {recipients.length === 0 ? "L3 channel only" : `L3 channel + ${recipients.length} DM recipient(s)`}
          </span>
        </div>
      </aside>
    </div>
  );
}

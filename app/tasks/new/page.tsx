"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  COOLDOWN_PRESETS_MIN,
  DURATION_PRESETS_MIN,
  POLL_INTERVAL_PRESETS_MIN,
  type GrafanaPanel,
} from "@/lib/types";
import { MetricPicker, type SelectedMetric } from "../MetricPicker";

interface Site {
  id: string;
  name: string;
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const hours = min / 60;
  return `${hours} hr${hours === 1 ? "" : "s"}`;
}

export default function NewTaskPage() {
  const router = useRouter();

  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState("");
  const [panels, setPanels] = useState<GrafanaPanel[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [panelsError, setPanelsError] = useState<string | null>(null);

  const [selectedMetrics, setSelectedMetrics] = useState<Record<number, SelectedMetric>>({});

  const [pollIntervalMin, setPollIntervalMin] = useState(POLL_INTERVAL_PRESETS_MIN[1]);
  const [cooldownMin, setCooldownMin] = useState(COOLDOWN_PRESETS_MIN[1]);
  const [durationMin, setDurationMin] = useState(DURATION_PRESETS_MIN[2]);
  const [notifyCreator, setNotifyCreator] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sites")
      .then((res) => res.json())
      .then((data: Site[]) => {
        setSites(data);
        if (data.length > 0) setSiteId(data[0].id);
      });
  }, []);

  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;

    async function loadPanels() {
      setPanelsLoading(true);
      setPanelsError(null);
      setSelectedMetrics({});
      try {
        const res = await fetch(`/api/sites/${siteId}/panels`);
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
  }, [siteId]);

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
          metrics,
          pollIntervalMin,
          cooldownMin,
          durationMin,
          notifyCreator,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create task");
      router.push("/tasks");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <span className="eyebrow">
        <span className="dot" aria-hidden="true"></span>
        New watch
      </span>
      <h1>
        New task<span className="accent-dot">.</span>
      </h1>
      <p className="subtitle">
        Watch one or more panels on a site at once — each gets its own condition. You&apos;ll
        get a Slack alert (with a screenshot), per panel, only when it&apos;s breached.
      </p>

      <form onSubmit={handleSubmit} className="card">
        <div className="field">
          <label htmlFor="site">Site</label>
          <select id="site" value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Panels to watch {selectedCount > 0 && `(${selectedCount} selected)`}</label>
          {panelsLoading && (
            <span className="field-hint">Loading panels from Grafana...</span>
          )}
          {panelsError && <span className="error-text">{panelsError}</span>}
          {!panelsLoading && !panelsError && (
            <MetricPicker panels={panels} selected={selectedMetrics} onChange={setSelectedMetrics} />
          )}
        </div>

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

        <div className="field">
          <label htmlFor="duration">Duration</label>
          <select id="duration" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
            {DURATION_PRESETS_MIN.map((min) => (
              <option key={min} value={min}>
                {formatMinutes(min)}
              </option>
            ))}
          </select>
        </div>

        <div className="field checkbox-field">
          <input
            id="notifyCreator"
            type="checkbox"
            checked={notifyCreator}
            onChange={(e) => setNotifyCreator(e.target.checked)}
          />
          <label htmlFor="notifyCreator" style={{ marginBottom: 0, textTransform: "none", fontWeight: 400, color: "var(--ink)" }}>
            Also DM me on breach (in addition to the L3 channel)
          </label>
        </div>

        {error && <p className="error-text">{error}</p>}

        <button type="submit" className="primary" disabled={submitting || selectedCount === 0 || hasIncompleteThreshold}>
          {submitting ? "Starting..." : `Start task${selectedCount > 1 ? ` (${selectedCount} panels)` : ""}`}
        </button>
      </form>
    </div>
  );
}

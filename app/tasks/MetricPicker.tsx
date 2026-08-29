import { OPERATORS, type GrafanaPanel, type Operator } from "@/lib/types";

export interface SelectedMetric {
  operator: Operator;
  threshold: string;
}

interface MetricPickerProps {
  panels: GrafanaPanel[];
  selected: Record<number, SelectedMetric>;
  onChange: (next: Record<number, SelectedMetric>) => void;
  // Slack tasks always alert on a condition, so a threshold is required.
  // Email reports can just state a value with no condition at all — set
  // this false to make the threshold field optional (e.g. for reports).
  thresholdRequired?: boolean;
}

export function MetricPicker({ panels, selected, onChange, thresholdRequired = true }: MetricPickerProps) {
  function toggle(panelId: number) {
    const next = { ...selected };
    if (next[panelId]) {
      delete next[panelId];
    } else {
      next[panelId] = { operator: "gt", threshold: "" };
    }
    onChange(next);
  }

  function updateMetric(panelId: number, patch: Partial<SelectedMetric>) {
    onChange({ ...selected, [panelId]: { ...selected[panelId], ...patch } });
  }

  return (
    <div className="metric-list">
      {panels.map((panel) => {
        const isSelected = Boolean(selected[panel.id]);
        const metric = selected[panel.id];
        return (
          <div key={panel.id} className={`metric-row${isSelected ? " selected" : ""}`}>
            <label className="metric-row-head">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggle(panel.id)}
              />
              <span className="panel-title">{panel.title}</span>
            </label>
            {isSelected && metric && (
              <div className="metric-row-body">
                <div className="field">
                  <label htmlFor={`operator-${panel.id}`}>Condition</label>
                  <select
                    id={`operator-${panel.id}`}
                    value={metric.operator}
                    onChange={(e) => updateMetric(panel.id, { operator: e.target.value as Operator })}
                  >
                    {OPERATORS.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`threshold-${panel.id}`}>
                    Threshold{!thresholdRequired && " (optional)"}
                  </label>
                  <input
                    id={`threshold-${panel.id}`}
                    type="number"
                    step="any"
                    value={metric.threshold}
                    onChange={(e) => updateMetric(panel.id, { threshold: e.target.value })}
                    placeholder="e.g. 20"
                    required={thresholdRequired}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

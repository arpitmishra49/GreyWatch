export type Operator = "gt" | "lt" | "gte" | "lte" | "eq";

export const OPERATORS: { value: Operator; label: string }[] = [
  { value: "gt", label: "> greater than" },
  { value: "gte", label: ">= greater than or equal" },
  { value: "lt", label: "< less than" },
  { value: "lte", label: "<= less than or equal" },
  { value: "eq", label: "= equal to" },
];

// Preset dropdown values (minutes). See context.md "Preset Values".
export const POLL_INTERVAL_PRESETS_MIN = [1, 5, 15, 30];
export const COOLDOWN_PRESETS_MIN = [5, 15, 30, 60];
export const DURATION_PRESETS_MIN = [60, 120, 240, 480, 1440];

export interface GrafanaPanel {
  id: number;
  title: string;
}

export interface MetricInput {
  panelId: number;
  panelTitle: string;
  operator: Operator;
  threshold: number;
}

export interface CreateTaskInput {
  siteId: string;
  metrics: MetricInput[];
  pollIntervalMin: number;
  cooldownMin: number;
  durationMin: number;
  notifyCreator: boolean;
}

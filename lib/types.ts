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

// Email reports are read by a person, not a machine reacting in real time —
// presets are deliberately coarse so a report task can't be configured to
// spam an inbox every minute. `1` is a deliberate exception: a fast option
// for verifying real SMTP delivery end-to-end without waiting an hour.
// Worth removing (or gating some other way) before wider real-world use.
export const EMAIL_INTERVAL_PRESETS_MIN = [1, 60, 240, 720, 1440];

export interface GrafanaPanel {
  id: number;
  title: string;
}

export interface GrafanaDashboard {
  uid: string;
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
  dashboardUid: string;
  metrics: MetricInput[];
  pollIntervalMin: number;
  cooldownMin: number;
  durationMin: number;
  recipientSlackIds: string[];
}

export interface EmailMetricInput {
  panelId: number;
  panelTitle: string;
  operator: Operator | null;
  threshold: number | null;
}

export interface CreateEmailTaskInput {
  siteId: string;
  dashboardUid: string;
  metrics: EmailMetricInput[];
  intervalMin: number;
  durationMin: number;
  toEmails: string[];
  ccEmails: string[];
}

import { grafanaEnv } from "./env";
import type { GrafanaPanel, Operator } from "./types";

export function evaluateThreshold(value: number, operator: Operator, threshold: number): boolean {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
  }
}

export interface GrafanaConfig {
  baseUrl: string;
  token: string;
}

export interface GrafanaDashboard {
  uid: string;
  title: string;
}

/**
 * Resolves which Grafana instance/credential a site actually uses. A site's
 * own grafanaApiToken is a per-site override — null means "use the shared
 * sandbox/org-wide token from env," which is what every site does today
 * (31 sites don't need 31 duplicate credentials until real per-site tokens
 * exist).
 */
export function resolveSiteGrafanaConfig(site: {
  grafanaBaseUrl: string;
  grafanaApiToken: string | null;
}): GrafanaConfig {
  return {
    baseUrl: site.grafanaBaseUrl,
    token: site.grafanaApiToken ?? grafanaEnv.GRAFANA_API_TOKEN,
  };
}

interface DsQueryFrame {
  schema: { fields: { name: string; type: string }[] };
  data: { values: number[][] };
}

interface DsQueryResponse {
  results: Record<string, { status: number; frames?: DsQueryFrame[]; error?: string }>;
}

async function grafanaFetch(config: GrafanaConfig, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...init?.headers,
    },
  });
  return res;
}

/**
 * Lists every dashboard on a Grafana instance, for the dashboard-discovery
 * step of task creation (a site is a Grafana instance, which can host many
 * dashboards — not a fixed 1:1 mapping).
 */
export async function listDashboards(config: GrafanaConfig): Promise<GrafanaDashboard[]> {
  const res = await grafanaFetch(config, `/api/search?type=dash-db`);
  if (!res.ok) {
    throw new Error(`Grafana dashboard search failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { uid: string; title: string }[];
  return body
    .filter((d) => typeof d.uid === "string" && typeof d.title === "string")
    .map((d) => ({ uid: d.uid, title: d.title }));
}

/**
 * Returns the panel list for a dashboard, used to populate the panel dropdown.
 * Panels are read live from Grafana every time — the pilot does not cache them.
 */
export async function getPanels(config: GrafanaConfig, dashboardUid: string): Promise<GrafanaPanel[]> {
  const res = await grafanaFetch(config, `/api/dashboards/uid/${dashboardUid}`);
  if (!res.ok) {
    throw new Error(`Grafana dashboard lookup failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  const panels = (body.dashboard?.panels ?? []) as { id: number; title: string }[];
  return panels
    .filter((p) => typeof p.id === "number" && typeof p.title === "string")
    .map((p) => ({ id: p.id, title: p.title }));
}

/**
 * Reads the current numeric value of a panel via /api/ds/query — never OCRs
 * the screenshot. We don't hardcode a query shape here: instead we look up
 * the panel's own target definition from the dashboard JSON (whatever it
 * is — a testdata scenario for the sandbox, an InfluxDB query for the real
 * org dashboards) and re-issue that exact target against /api/ds/query with
 * a fresh time range. This is what makes the tool work against any panel
 * type without per-datasource logic.
 */
export async function queryMetricValue(
  config: GrafanaConfig,
  dashboardUid: string,
  panelId: number,
): Promise<number> {
  const res = await grafanaFetch(config, `/api/dashboards/uid/${dashboardUid}`);
  if (!res.ok) {
    throw new Error(`Grafana dashboard lookup failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  const panels = (body.dashboard?.panels ?? []) as {
    id: number;
    datasource?: { type: string; uid: string };
    targets?: Record<string, unknown>[];
  }[];
  const panel = panels.find((p) => p.id === panelId);
  if (!panel || !panel.targets?.length) {
    throw new Error(`Panel ${panelId} not found on dashboard ${dashboardUid}, or has no query`);
  }
  const target = panel.targets[0];
  const datasource = (target.datasource as { type: string; uid: string } | undefined) ?? panel.datasource;
  if (!datasource) {
    throw new Error(`Panel ${panelId} has no datasource attached to its query`);
  }

  const queryRes = await grafanaFetch(config, `/api/ds/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queries: [{ ...target, refId: "A", datasource }],
      from: "now-5m",
      to: "now",
    }),
  });

  if (!queryRes.ok) {
    throw new Error(`Grafana query failed: ${queryRes.status} ${await queryRes.text()}`);
  }

  const queryBody: DsQueryResponse = await queryRes.json();
  const result = queryBody.results["A"];
  if (!result || result.status !== 200 || !result.frames?.length) {
    throw new Error(`Grafana query returned no data: ${result?.error ?? "unknown error"}`);
  }

  const frame = result.frames[0];
  const valueFieldIndex = frame.schema.fields.findIndex((f) => f.type === "number");
  const values = frame.data.values[valueFieldIndex];
  if (!values?.length) {
    throw new Error("Grafana query returned an empty series");
  }

  return values[values.length - 1];
}

/**
 * Captures a PNG screenshot of a single panel via Grafana's /render endpoint.
 * Requires the grafana-image-renderer sidecar to be reachable — configured
 * via GF_RENDERING_SERVER_URL on the Grafana container.
 */
export async function captureScreenshot(
  config: GrafanaConfig,
  dashboardUid: string,
  panelId: number,
): Promise<Buffer> {
  const res = await grafanaFetch(
    config,
    `/render/d-solo/${dashboardUid}?panelId=${panelId}&width=1000&height=500&from=now-1h&to=now`,
  );
  if (!res.ok) {
    throw new Error(`Grafana render failed: ${res.status} ${await res.text()}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

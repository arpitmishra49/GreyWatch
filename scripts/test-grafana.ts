import "dotenv/config";
import { writeFileSync } from "node:fs";
import { captureScreenshot, evaluateThreshold, getPanels, listDashboards, queryMetricValue } from "../lib/grafana";
import { grafanaEnv } from "../lib/env";

// Standalone connectivity check — run with `npm run test:grafana` before
// anything else depends on lib/grafana.ts. Exercises every Grafana
// integration point against the sandbox, using the shared env credential
// directly (as if it were a site with no per-site token override).
async function main() {
  const config = { baseUrl: grafanaEnv.GRAFANA_BASE_URL, token: grafanaEnv.GRAFANA_API_TOKEN };
  const dashboardUid = "site-a";

  console.log("1. Listing dashboards...");
  const dashboards = await listDashboards(config);
  if (!dashboards.length) throw new Error("No dashboards returned — check GRAFANA_BASE_URL/GRAFANA_API_TOKEN");
  console.log(`   OK — ${dashboards.length} dashboard(s):`, dashboards.map((d) => `${d.uid}:${d.title}`).join(", "));

  console.log(`\n2. Fetching panels for dashboard "${dashboardUid}"...`);
  const panels = await getPanels(config, dashboardUid);
  if (!panels.length) throw new Error("No panels returned");
  console.log(`   OK — ${panels.length} panels:`, panels.map((p) => `${p.id}:${p.title}`).join(", "));

  const panel = panels[0];
  console.log(`\n3. Querying current value of panel "${panel.title}" (id ${panel.id})...`);
  const value = await queryMetricValue(config, dashboardUid, panel.id);
  console.log(`   OK — value = ${value}`);
  console.log(`   evaluateThreshold(value, "gt", 20) = ${evaluateThreshold(value, "gt", 20)}`);

  console.log(`\n4. Capturing screenshot of panel ${panel.id}...`);
  const png = await captureScreenshot(config, dashboardUid, panel.id);
  const outPath = "/tmp/grafana-test-screenshot.png";
  writeFileSync(outPath, png);
  console.log(`   OK — ${png.length} bytes written to ${outPath}`);

  console.log("\nAll Grafana checks passed.");
}

main().catch((err) => {
  console.error("\nGrafana connectivity check FAILED:", err.message);
  process.exit(1);
});

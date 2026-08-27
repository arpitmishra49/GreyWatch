import "dotenv/config";
import { writeFileSync } from "node:fs";
import { captureScreenshot, evaluateThreshold, getPanels, queryMetricValue } from "../lib/grafana";

// Standalone connectivity check — run with `npm run test:grafana` before
// anything else depends on lib/grafana.ts. Exercises all three Grafana
// integration points against the seeded "site-a" dashboard.
async function main() {
  const dashboardUid = "site-a";

  console.log(`1. Fetching panels for dashboard "${dashboardUid}"...`);
  const panels = await getPanels(dashboardUid);
  if (!panels.length) throw new Error("No panels returned — check GRAFANA_BASE_URL/GRAFANA_API_TOKEN");
  console.log(`   OK — ${panels.length} panels:`, panels.map((p) => `${p.id}:${p.title}`).join(", "));

  const panel = panels[0];
  console.log(`\n2. Querying current value of panel "${panel.title}" (id ${panel.id})...`);
  const value = await queryMetricValue(dashboardUid, panel.id);
  console.log(`   OK — value = ${value}`);
  console.log(`   evaluateThreshold(value, "gt", 20) = ${evaluateThreshold(value, "gt", 20)}`);

  console.log(`\n3. Capturing screenshot of panel ${panel.id}...`);
  const png = await captureScreenshot(dashboardUid, panel.id);
  const outPath = "/tmp/grafana-test-screenshot.png";
  writeFileSync(outPath, png);
  console.log(`   OK — ${png.length} bytes written to ${outPath}`);

  console.log("\nAll Grafana checks passed.");
}

main().catch((err) => {
  console.error("\nGrafana connectivity check FAILED:", err.message);
  process.exit(1);
});

import "dotenv/config";
import { readFileSync } from "node:fs";
import { emailProvider } from "../lib/email";
import { renderReportEmail } from "../lib/emailTemplate";

// Standalone connectivity check — run with `npm run test:email`. Sends one
// real (test) email through Ethereal and prints the preview URL — nothing
// is ever actually delivered, Ethereal just captures it for viewing.
async function main() {
  let screenshot: Buffer | undefined;
  try {
    screenshot = readFileSync("/tmp/grafana-test-screenshot.png");
    console.log("Using screenshot from a prior `npm run test:grafana` run.");
  } catch {
    console.log("No Grafana test screenshot found — sending without one.");
  }

  const { html, attachments } = renderReportEmail({
    siteName: "Site A (test)",
    generatedAt: new Date(),
    metrics: [
      { panelTitle: "Rack to Rack Time - Pick (Seconds)", value: 22.4, operator: "gt", threshold: 20, screenshot },
      { panelTitle: "Orderline Throughput (Lines/Hr)", value: 512, operator: null, threshold: null },
      { panelTitle: "Per-Unit OWT (ms)", value: null, errorMessage: "Grafana request timed out", operator: null, threshold: null },
    ],
  });

  console.log("Sending test report email via Ethereal...");
  const result = await emailProvider.send({
    to: ["engineer@example.com"],
    cc: ["shift-lead@example.com"],
    subject: "GreyWatch report: Site A (test)",
    html,
    attachments,
  });

  console.log("OK — sent. messageId:", result.messageId);
  console.log("Preview URL (open this to see the actual email):", result.previewUrl);
}

main().catch((err) => {
  console.error("\nEmail connectivity check FAILED:", err.message);
  process.exit(1);
});

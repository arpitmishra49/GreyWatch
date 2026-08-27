import "dotenv/config";
import { readFileSync } from "node:fs";
import { postBreach } from "../lib/slack";
import { slackEnv } from "../lib/env";

// Standalone connectivity check — run with `npm run test:slack`. Posts a
// fake breach (with a real or placeholder screenshot) into L3_CHANNEL_ID to
// confirm chat.postMessage + files.uploadV2 both work, including the
// files:read scope that files.uploadV2 silently requires.
async function main() {
  let screenshot: Buffer;
  try {
    screenshot = readFileSync("/tmp/grafana-test-screenshot.png");
    console.log("Using screenshot from a prior `npm run test:grafana` run.");
  } catch {
    console.log("No Grafana test screenshot found — using a 1x1 placeholder PNG instead.");
    screenshot = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
  }

  console.log(`Posting a test breach message to channel ${slackEnv.L3_CHANNEL_ID}...`);
  const threadTs = await postBreach(slackEnv.L3_CHANNEL_ID, undefined, screenshot, {
    siteName: "Site A (test)",
    panelTitle: "Rack to Rack Time - Pick (Seconds)",
    operator: "gt",
    threshold: 20,
    value: 27.3,
    isFirstAlert: true,
  });
  console.log(`OK — posted message + screenshot, thread_ts = ${threadTs}`);

  console.log("\nPosting a follow-up (repeat) breach in the same thread...");
  await postBreach(slackEnv.L3_CHANNEL_ID, threadTs, screenshot, {
    siteName: "Site A (test)",
    panelTitle: "Rack to Rack Time - Pick (Seconds)",
    operator: "gt",
    threshold: 20,
    value: 28.1,
    isFirstAlert: false,
    secondsSinceLastAlert: 300,
  });
  console.log("OK — repeat breach threaded correctly.");

  console.log("\nAll Slack checks passed. Go check #your-test-channel in Slack.");
}

main().catch((err) => {
  console.error("\nSlack connectivity check FAILED:", err.message);
  if (err.data) console.error(JSON.stringify(err.data, null, 2));
  process.exit(1);
});

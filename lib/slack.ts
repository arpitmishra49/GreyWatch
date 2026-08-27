import { WebClient } from "@slack/web-api";
import { slackEnv } from "./env";

const slack = new WebClient(slackEnv.SLACK_BOT_TOKEN);

export interface BreachInfo {
  siteName: string;
  panelTitle: string;
  operator: string;
  threshold: number;
  value: number;
  isFirstAlert: boolean;
  secondsSinceLastAlert?: number;
}

/**
 * Resolves a Slack target to a real channel ID. `chat.postMessage` quietly
 * accepts a bare user ID (U...) and auto-opens the DM for you — but
 * `files.uploadV2`'s `channel_id` does NOT do that same auto-open, and fails
 * with `invalid_arguments` on `/channel_id` if given a user ID instead of an
 * actual conversation ID. Resolving explicitly up front, for every call,
 * avoids relying on that inconsistency. Requires the `im:write` bot scope.
 */
async function resolveChannelId(target: string): Promise<string> {
  if (!target.startsWith("U") && !target.startsWith("W")) return target; // already a channel/group ID
  const opened = await slack.conversations.open({ users: target });
  const dmId = opened.channel?.id;
  if (!dmId) throw new Error(`Could not open a DM with Slack user ${target}`);
  return dmId;
}

/**
 * Posts a breach alert with the panel screenshot attached. The first breach
 * for a task creates a new top-level message and returns its `ts`, which the
 * caller stores as MonitorTask.threadTs; every later breach for the same
 * task should call this again with that same threadTs so repeats thread
 * together instead of spamming the channel.
 *
 * Uses files.uploadV2, the current SDK helper for uploads. Unlike the old
 * files.upload method, uploadV2 needs BOTH files:write AND files:read scopes
 * — it reads the file back to confirm the upload completed before returning.
 * Missing files:read fails silently in confusing ways, so it's easy to miss
 * during app setup.
 */
export async function postBreach(
  target: string,
  threadTs: string | undefined,
  screenshot: Buffer,
  info: BreachInfo,
): Promise<string> {
  const channelId = await resolveChannelId(target);

  const headline = info.isFirstAlert
    ? "🚨 Threshold breached"
    : `🚨 Still breached — ${formatDuration(info.secondsSinceLastAlert ?? 0)} since last alert`;

  const comment = [
    `${headline}`,
    `*Site:* ${info.siteName}`,
    `*Panel:* ${info.panelTitle}`,
    `*Condition:* value ${operatorSymbol(info.operator)} ${info.threshold}`,
    `*Current value:* ${info.value}`,
  ].join("\n");

  if (!threadTs) {
    const posted = await slack.chat.postMessage({
      channel: channelId,
      text: comment,
    });
    threadTs = posted.ts as string;
  }

  await slack.files.uploadV2({
    channel_id: channelId,
    thread_ts: threadTs,
    file: screenshot,
    filename: `breach-${Date.now()}.png`,
    initial_comment: comment,
  });

  return threadTs;
}

/**
 * DMs the task's creator directly (channel = their Slack member ID) rather
 * than posting anywhere shared. A poll/API failure means "the tool is
 * broken," which is the creator's problem to fix, not L3's.
 */
export async function notifyCreatorOfFailure(
  creatorSlackId: string,
  taskDescription: string,
  error: string,
): Promise<void> {
  const channelId = await resolveChannelId(creatorSlackId);
  await slack.chat.postMessage({
    channel: channelId,
    text: `⚠️ Monitor task failed: *${taskDescription}*\n\`\`\`${error}\`\`\`\nThis means the tool couldn't reach Grafana — the underlying metric may be fine. The task will retry on its next poll.`,
  });
}

function operatorSymbol(operator: string): string {
  switch (operator) {
    case "gt":
      return ">";
    case "gte":
      return ">=";
    case "lt":
      return "<";
    case "lte":
      return "<=";
    case "eq":
      return "=";
    default:
      return operator;
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

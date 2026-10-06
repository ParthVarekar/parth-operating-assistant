import { getEnv } from "../config/env.js";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";

export interface SlackField {
  title: string;
  value: string;
  short?: boolean;
}

export interface SlackMessageOptions {
  title: string;
  text: string;
  color?: string; // hex string e.g. "#4A154B" (Slack Aubergine) or "#36A64F" (Green)
  fields?: SlackField[];
}

/**
 * Gets configured Slack Webhook URL.
 */
export function getSlackWebhookUrl(): string {
  const custom = getUserProfile<string>("slack_webhook_url");
  if (custom !== undefined && custom !== null) {
    return custom.trim();
  }
  const env = getEnv();
  return env.SLACK_WEBHOOK_URL || "";
}

/**
 * Sets Slack Webhook URL in user profile.
 */
export function setSlackWebhookUrl(url: string): void {
  setUserProfile("slack_webhook_url", url.trim());
}

/**
 * Checks if Slack webhook integration is configured.
 */
export function isSlackConfigured(): boolean {
  return getSlackWebhookUrl().length > 0;
}

/**
 * Sends a formatted notification attachment to the Slack webhook channel.
 */
export async function sendSlackNotification(options: SlackMessageOptions): Promise<boolean> {
  const webhookUrl = getSlackWebhookUrl();
  if (!webhookUrl) {
    return false;
  }

  const payload = {
    username: "Antigravity Assistant",
    icon_emoji: ":robot_face:",
    attachments: [
      {
        color: options.color ?? "#4A154B",
        title: options.title,
        text: options.text,
        fields: options.fields?.map((f) => ({
          title: f.title,
          value: f.value,
          short: f.short ?? true,
        })),
        footer: "Antigravity Personal Operating Assistant",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

/**
 * Broadcasts evening operating plan to Slack.
 */
export async function broadcastPlanToSlack(planDigest: string, taskCount: number): Promise<boolean> {
  return sendSlackNotification({
    title: "📋 Evening Operating Plan & Schedule",
    text: planDigest,
    color: "#2B6CB0",
    fields: [
      { title: "Scheduled Tasks", value: `${taskCount}` },
      { title: "Dinner Anchor", value: "9:30 PM (Protected)" },
      { title: "Deep-Work Block", value: "11:00 PM – 4:30 AM" },
    ],
  });
}

/**
 * Broadcasts sprint completion to Slack.
 */
export async function broadcastTaskDoneToSlack(
  taskTitle: string,
  category: string,
  minutes: number
): Promise<boolean> {
  return sendSlackNotification({
    title: "✅ Sprint Task Completed!",
    text: `*${taskTitle}* (${minutes}m)`,
    color: "#36A64F",
    fields: [
      { title: "Category", value: category },
      { title: "Logged Duration", value: `${minutes} mins` },
    ],
  });
}

/**
 * Formats a clean Telegram markdown digest of the Slack connection status.
 */
export function formatSlackStatusDigest(): string {
  const webhookUrl = getSlackWebhookUrl();

  const lines: string[] = [`🟡 *Slack Workspace & Channel Integration*\n`];

  if (!webhookUrl) {
    lines.push(`🔴 *Status:* Not Connected\n`);
    lines.push(
      `Connect Slack to broadcast your daily operating plan, sprint milestones, and standups to your project or club channels!\n\n` +
      `⚡ *How to Connect in 20 Seconds:*\n` +
      `1️⃣ Open [api.slack.com/apps](https://api.slack.com/apps) or your workspace settings.\n` +
      `2️⃣ Enable *Incoming Webhooks* on your desired channel (e.g. \`#standup\` or \`#tasks\`).\n` +
      `3️⃣ Send here: \`/slack_webhook <paste_url_here>\``
    );
    return lines.join("\n");
  }

  lines.push(`🟢 *Status:* Connected`);
  lines.push(`🔗 *Webhook Channel:* Active`);
  lines.push(`\n📢 *Broadcasting Features:*`);
  lines.push(`• Evening Operating Plan auto-posts`);
  lines.push(`• Sprint velocity & completion alerts`);
  lines.push(`• Critical physical submission reminders`);

  return lines.join("\n");
}

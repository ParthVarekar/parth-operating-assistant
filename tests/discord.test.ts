import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  broadcastPlanToDiscord,
  broadcastTaskDoneToDiscord,
  formatDiscordStatusDigest,
  getDiscordBotToken,
  getDiscordWebhookUrl,
  isDiscordConfigured,
  sendDiscordEmbed,
  setDiscordBotToken,
  setDiscordWebhookUrl,
} from "../src/services/discordService.js";

describe("Discord Integration & Notification Broadcaster Suite", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
  });

  it("handles unconfigured state with clean help instructions", () => {
    setDiscordWebhookUrl("");
    setDiscordBotToken("");

    expect(isDiscordConfigured()).toBe(false);
    expect(getDiscordWebhookUrl()).toBe("");
    expect(getDiscordBotToken()).toBe("");

    const digest = formatDiscordStatusDigest();
    expect(digest).toContain("Discord Server & Channel Integration");
    expect(digest).toContain("Not Connected");
    expect(digest).toContain("/discord_webhook");
  });

  it("saves and retrieves Discord webhook and bot token in profile", () => {
    setDiscordWebhookUrl("https://discord.com/api/webhooks/123456789/abcdef");
    setDiscordBotToken("MOCK_DISCORD_BOT_TOKEN_XYZ");

    expect(isDiscordConfigured()).toBe(true);
    expect(getDiscordWebhookUrl()).toBe("https://discord.com/api/webhooks/123456789/abcdef");
    expect(getDiscordBotToken()).toBe("MOCK_DISCORD_BOT_TOKEN_XYZ");

    const digest = formatDiscordStatusDigest();
    expect(digest).toContain("Connected");
    expect(digest).toContain("*Webhook Channel:* Active");
    expect(digest).toContain("Bot Gateway");
  });

  it("handles broadcast helper formatting gracefully without throwing", async () => {
    // Should return false because webhook is mock/invalid, but must handle gracefully
    const planResult = await broadcastPlanToDiscord("1. Task A (45m)\n2. Task B (30m)", 2);
    expect(typeof planResult).toBe("boolean");

    const taskResult = await broadcastTaskDoneToDiscord("Code: Susurrus sprint", "coding", 45);
    expect(typeof taskResult).toBe("boolean");
  });

  it("clears Discord credentials properly", () => {
    setDiscordWebhookUrl("");
    setDiscordBotToken("");

    expect(isDiscordConfigured()).toBe(false);
    expect(getDiscordWebhookUrl()).toBe("");
    expect(getDiscordBotToken()).toBe("");
  });
});

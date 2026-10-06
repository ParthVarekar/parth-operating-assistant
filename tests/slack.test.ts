import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  broadcastPlanToSlack,
  broadcastTaskDoneToSlack,
  formatSlackStatusDigest,
  getSlackWebhookUrl,
  isSlackConfigured,
  sendSlackNotification,
  setSlackWebhookUrl,
} from "../src/services/slackService.js";

describe("Slack Workspace Integration Suite", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles unconfigured state with setup instructions", () => {
    setSlackWebhookUrl("");
    expect(isSlackConfigured()).toBe(false);
    expect(getSlackWebhookUrl()).toBe("");

    const digest = formatSlackStatusDigest();
    expect(digest).toContain("Slack Workspace & Channel Integration");
    expect(digest).toContain("Not Connected");
    expect(digest).toContain("/slack_webhook");
  });

  it("saves and retrieves Slack webhook URL in user profile", () => {
    setSlackWebhookUrl("https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX");
    expect(isSlackConfigured()).toBe(true);
    expect(getSlackWebhookUrl()).toContain("hooks.slack.com");

    const digest = formatSlackStatusDigest();
    expect(digest).toContain("Connected");
    expect(digest).toContain("*Webhook Channel:* Active");
  });

  it("handles notification delivery failure gracefully without crashing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network connection refused"));

    const res = await sendSlackNotification({
      title: "Test",
      text: "Test body",
    });
    expect(res).toBe(false);

    const planRes = await broadcastPlanToSlack("1. Task A\n2. Task B", 2);
    expect(planRes).toBe(false);

    const taskRes = await broadcastTaskDoneToSlack("Task X", "study", 30);
    expect(taskRes).toBe(false);
  });

  it("handles successful notification delivery", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await sendSlackNotification({
      title: "Test Success",
      text: "All clear",
    });
    expect(res).toBe(true);
  });

  it("clears Slack configuration cleanly", () => {
    setSlackWebhookUrl("");
    expect(isSlackConfigured()).toBe(false);
  });
});

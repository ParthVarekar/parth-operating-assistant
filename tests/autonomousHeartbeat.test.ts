import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { setUserProfile } from "../src/db/repositories/habitRepository.js";
import {
  registerTelegramBotForOutreach,
  sendTelegramProactiveMessage,
  startAutonomousHeartbeat,
  stopAutonomousHeartbeat,
  tickAutonomousHeartbeat,
} from "../src/scheduler/autonomousHeartbeat.js";
import { seedInitialCuratedHackathons } from "../src/db/repositories/hackathonRepository.js";
import * as githubService from "../src/services/githubService.js";

describe("Autonomous Multi-Cadence Heartbeat Suite", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
    seedInitialCuratedHackathons();
  });

  beforeEach(() => {
    vi.spyOn(githubService, "getGitHubActivitySummary").mockResolvedValue({
      username: "ParthVarekar",
      htmlUrl: "https://github.com/ParthVarekar",
      publicRepos: 12,
      commitsToday: 1,
      streakDays: 5,
      recentRepos: [],
      recentCommits: [],
      lastActiveAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    stopAutonomousHeartbeat();
    vi.restoreAllMocks();
  });

  it("handles unconfigured Telegram chat ID gracefully without errors", async () => {
    setUserProfile("telegram_chat_id", "");
    registerTelegramBotForOutreach(null);

    const sent = await sendTelegramProactiveMessage("Test proactive alert");
    expect(sent).toBe(false);
  });

  it("dispatches proactive Telegram message when mock bot and chat ID are registered", async () => {
    setUserProfile("telegram_chat_id", "123456789");

    const sendMessageMock = vi.fn().mockResolvedValue({ message_id: 101 });
    const mockBot = {
      api: {
        sendMessage: sendMessageMock,
      },
    };

    registerTelegramBotForOutreach(mockBot);

    const sent = await sendTelegramProactiveMessage("🚀 Standup alert: Night Deep-Work sprint active!");
    expect(sent).toBe(true);
    expect(sendMessageMock).toHaveBeenCalledWith(
      "123456789",
      "🚀 Standup alert: Night Deep-Work sprint active!",
      expect.objectContaining({ parse_mode: "Markdown" })
    );
  });

  it("executes heartbeat tick cycle cleanly without throwing", async () => {
    await expect(tickAutonomousHeartbeat()).resolves.not.toThrow();
  });

  it("starts and stops autonomous heartbeat timer cleanly", () => {
    expect(() => {
      startAutonomousHeartbeat(10000);
      stopAutonomousHeartbeat();
    }).not.toThrow();
  });
});

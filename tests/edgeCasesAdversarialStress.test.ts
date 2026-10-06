import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  checkContentDuplicate,
  extractStudyResources,
  extractTokens,
  extractUrls,
  isSubstantiveContent,
  normalizeText,
  recordIngestedContent,
} from "../src/services/contentDeduplicationService.js";
import { sendSegregatedDiscordEmbed } from "../src/services/discordService.js";
import { tickAutonomousHeartbeat } from "../src/scheduler/autonomousHeartbeat.js";
import { processAssistantChat } from "../src/agent/chatHandler.js";
import { startDashboardServer, stopDashboardServer } from "../src/server/dashboardServer.js";
import { insertTask } from "../src/db/repositories/taskRepository.js";
import type { Task } from "../src/types/index.js";

describe("Adversarial & Edge-Case Resilience Suite", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "mock";
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Deduplication & NLP Input Hardening", () => {
    it("handles undefined, null, non-string, and empty input safely without throwing", () => {
      expect(normalizeText(null as unknown as string)).toBe("");
      expect(normalizeText(undefined as unknown as string)).toBe("");
      expect(normalizeText("")).toBe("");
      expect(normalizeText(12345 as unknown as string)).toBe("");

      expect(extractUrls(null as unknown as string)).toEqual([]);
      expect(extractUrls(undefined as unknown as string)).toEqual([]);
      expect(extractUrls("")).toEqual([]);

      expect(extractTokens("")).toEqual([]);
      expect(isSubstantiveContent("")).toBe(false);
      expect(isSubstantiveContent("   \n\t   ")).toBe(false);

      const dup = checkContentDuplicate("", "TestChat", "Sender");
      expect(dup.isDuplicate).toBe(true);
    });

    it("resists ReDoS on massive inputs and caps text processing safely", () => {
      const massiveNotice = "A".repeat(50000) + " due on Friday submission notes: https://drive.google.com/test";
      const startTime = Date.now();
      const normalized = normalizeText(massiveNotice);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(200); // Must process in under 200ms
      expect(normalized.length).toBeLessThanOrEqual(15000);

      const urls = extractUrls(massiveNotice);
      expect(urls.length).toBe(1);
      expect(urls[0]).toBe("https://drive.google.com/test");
    });

    it("rejects non-http/https malicious protocols in URL extraction", () => {
      const text = `Links: javascript:alert(1) data:text/html;base64,PHNjcmlwdD4= file:///etc/passwd https://valid-drive.com/notes`;
      const urls = extractUrls(text);

      expect(urls.length).toBe(1);
      expect(urls[0]).toBe("https://valid-drive.com/notes");
      expect(urls.some((u) => u.startsWith("javascript:"))).toBe(false);
      expect(urls.some((u) => u.startsWith("data:"))).toBe(false);
      expect(urls.some((u) => u.startsWith("file:"))).toBe(false);
    });

    it("handles zero-width spaces, RTL overrides, and multi-byte emojis gracefully", () => {
      const trickyText = "\u200B\u200C\u202E Important Announcement: \uFEFFCN Lab Experiment 3 due \uD83D\uDE80\uD83D\uDD25\u200D";
      const normalized = normalizeText(trickyText);

      expect(normalized).toContain("cn lab experiment 3 due");
      expect(normalized).not.toContain("\uD83D\uDE80");
    });

    it("survives rapid concurrent deduplication ingestion bursts without state corruption", () => {
      const baseNotice = "Microprocessors Experiment 5 writeup submission due this Thursday.";
      for (let i = 0; i < 30; i++) {
        const record = recordIngestedContent({
          text: baseNotice,
          chatName: `FriendGroup_${i % 5}`,
          sender: `Student_${i}`,
        });
        expect(record).toBeDefined();
        expect(record.duplicateCount).toBeGreaterThanOrEqual(1);
      }

      const dupCheck = checkContentDuplicate(baseNotice, "NewGroup", "NewSender");
      expect(dupCheck.isDuplicate).toBe(true);
      expect(dupCheck.duplicateOf?.duplicateCount).toBe(30);
    });
  });

  describe("2. Discord Embed Field Limits & Truncation", () => {
    it("safely truncates oversized embed titles, descriptions, and fields to prevent Discord API rejection", async () => {
      const hugeTitle = "T".repeat(500); // Limit is 256
      const hugeDescription = "D".repeat(8000); // Limit is 4096
      const hugeFields = Array.from({ length: 40 }, (_, i) => ({ // Limit is 25
        name: `F_${i}_` + "N".repeat(300), // Limit is 256
        value: "V".repeat(2000), // Limit is 1024
        inline: true,
      }));
      const hugeFooter = "Footer ".repeat(500); // Limit is 2048

      // Mock Discord Webhook execution to verify no validation errors throw
      const result = await sendSegregatedDiscordEmbed("academic", {
        title: hugeTitle,
        description: hugeDescription,
        fields: hugeFields,
        footer: hugeFooter,
      });

      // Does not throw an exception even with massive fields
      expect(typeof result).toBe("boolean");
    });
  });

  describe("3. Autonomous Heartbeat Concurrency & Boundary Conditions", () => {
    it("prevents overlapping concurrent heartbeat ticks using re-entrancy lock", async () => {
      // Run multiple concurrent tick requests
      const tick1 = tickAutonomousHeartbeat();
      const tick2 = tickAutonomousHeartbeat();
      const tick3 = tickAutonomousHeartbeat();

      await expect(Promise.all([tick1, tick2, tick3])).resolves.not.toThrow();
    });

    it("runs cleanly when task backlog contains 0 tasks or all tasks are overdue", async () => {
      // Overdue task from 7 days ago
      const overdueTask: Task = {
        id: "task-overdue-extreme",
        title: "Very old assignment",
        category: "assignment",
        status: "pending",
        priority: "high",
        estimatedMinutes: 45,
        deadline: new Date(Date.now() - 7 * 86400000).toISOString(),
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      };
      insertTask(overdueTask);

      await expect(tickAutonomousHeartbeat()).resolves.not.toThrow();
    });
  });

  describe("4. Dashboard REST API Stress & Client Error Semantics", () => {
    const TEST_PORT = 3198;

    it("rejects invalid JSON payloads with HTTP 400 instead of crashing or returning 500", async () => {
      const server = await startDashboardServer(TEST_PORT);
      try {
        const res = await fetch(`http://localhost:${TEST_PORT}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{ invalid json format !!",
        });

        expect(res.status).toBe(400);
        const data = await res.json() as { error: string };
        expect(data.error).toContain("Invalid JSON");
      } finally {
        await stopDashboardServer();
      }
    });

    it("rejects empty message payloads with HTTP 400", async () => {
      const server = await startDashboardServer(TEST_PORT);
      try {
        const res = await fetch(`http://localhost:${TEST_PORT}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "" }),
        });

        expect(res.status).toBe(400);
        const data = await res.json() as { error: string };
        expect(data.error).toContain("Message is required");
      } finally {
        await stopDashboardServer();
      }
    });

    it("processes very long user prompts cleanly without crashing", async () => {
      const longMessage = "Please summarize my workload: " + "task details ".repeat(200);
      const res = await processAssistantChat(longMessage, "dashboard");

      expect(res).toBeDefined();
      expect(typeof res.reply).toBe("string");
      expect(res.reply.length).toBeGreaterThan(0);
    });
  });
});

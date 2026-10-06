import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { seedInitialCuratedHackathons } from "../src/db/repositories/hackathonRepository.js";
import { getChatHistory, processAssistantChat } from "../src/agent/chatHandler.js";
import { findPendingTasks } from "../src/db/repositories/taskRepository.js";
import { findActiveSubmissions } from "../src/db/repositories/submissionRepository.js";
import { getDailyFitnessSummary } from "../src/services/fitnessService.js";

describe("Assistant Chat & Natural Language Processor Suite", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "mock";
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
    seedInitialCuratedHackathons();
  });

  it("initializes chat history with default greeting if empty", () => {
    const history = getChatHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]?.role).toBe("assistant");
    expect(history[0]?.text).toContain("Hi Parth");
  });

  it("processes empty message gracefully", async () => {
    const res = await processAssistantChat("   ", "dashboard");
    expect(res.reply).toContain("How can I help you operate today, Parth?");
    expect(res.actionsTaken.length).toBe(0);
  });

  it("processes task creation intent and inserts into backlog", async () => {
    const res = await processAssistantChat("Add a new task: Complete DSP Lab Experiment 4", "dashboard");
    expect(res.reply).toContain("DSP Lab Experiment 4");
    expect(res.actionsTaken.length).toBeGreaterThan(0);

    const pending = findPendingTasks();
    const created = pending.find((t) => t.title.toLowerCase().includes("dsp"));
    expect(created).toBeDefined();
  });

  it("processes physical submission intent and creates submission with print requirements", async () => {
    const res = await processAssistantChat("Need Xerox spiral print submission for Database Systems due next Monday", "discord");
    expect(res.reply).toContain("Physical submission flagged");
    expect(res.actionsTaken.some((a) => a.toLowerCase().includes("physical"))).toBe(true);

    const submissions = findActiveSubmissions();
    const created = submissions.find((s) => s.subject.toLowerCase().includes("database"));
    expect(created).toBeDefined();
  });

  it("processes fitness and nutrition logging intent", async () => {
    const res = await processAssistantChat("Log breakfast: 3 boiled eggs and whey protein", "telegram");
    expect(res.reply).toContain("Protein");

    const summary = getDailyFitnessSummary();
    expect(summary.totalProtein).toBeGreaterThan(0);
  });

  it("handles hackathon search queries via chat", async () => {
    const res = await processAssistantChat("Show me upcoming hackathons in Mumbai", "dashboard");
    expect(res.reply).toContain("Regional Hackathons");
    expect(res.actionsTaken.some((a) => a.includes("hackathons"))).toBe(true);
  });

  it("handles schedule queries via chat", async () => {
    const res = await processAssistantChat("What should I do next?", "dashboard");
    expect(res.reply).toContain("CURRENT FOCUS");
  });

  it("retains chat history with channel attribution", () => {
    const history = getChatHistory();
    expect(history.length).toBeGreaterThan(3);

    const dashboardMsg = history.find((m) => m.channel === "dashboard");
    expect(dashboardMsg).toBeDefined();

    const discordMsg = history.find((m) => m.channel === "discord");
    expect(discordMsg).toBeDefined();
  });
});

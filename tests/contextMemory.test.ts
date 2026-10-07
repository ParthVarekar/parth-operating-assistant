import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { seedInitialCuratedHackathons } from "../src/db/repositories/hackathonRepository.js";
import {
  getActiveContext,
  updateActiveContext,
  getContextMemorySnapshot,
} from "../src/agent/contextMemory.js";
import { processAssistantChat } from "../src/agent/chatHandler.js";
import { getRecentMemories, searchMemories } from "../src/db/repositories/memoryRepository.js";

describe("Conversational Context Memory & Multi-Turn Association Suite", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "mock";
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
    seedInitialCuratedHackathons();
  });

  it("initializes active conversation context with default values", () => {
    const ctx = getActiveContext("test-channel");
    expect(ctx).toBeDefined();
    expect(ctx.rollingSummary).toBeDefined();
    expect(Array.isArray(ctx.recentTopics)).toBe(true);
  });

  it("extracts entities and updates active context on hackathon discussions", async () => {
    const userMsg = "Which hackathon has the lowest prize pool?";
    const assistantMsg =
      "Looking through our regional database, Cognition Hackathon 2026 at SIES GST (Nerul) has the lowest listed cash prize pool at ₹75,000.";

    const updated = await updateActiveContext(userMsg, assistantMsg, [], "test-channel");
    expect(updated.activeSubject).toContain("Cognition");
    expect(updated.activeCategory).toBe("hackathon");
    expect(updated.recentTopics.length).toBeGreaterThan(0);
    expect(updated.lastTurnUser).toBe(userMsg);
    expect(updated.rollingSummary).toContain("Cognition");

    // Verifies episodic memory was persisted into SQLite
    const memories = searchMemories("Cognition", 5);
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0]?.category).toBe("conversation");
  });

  it("extracts academic coursework context and updates rolling memory", async () => {
    const userMsg = "I need to complete my DSP Lab Experiment 4 report for college";
    const assistantMsg = "Added coursework task: DSP Lab Experiment 4 (45m, Priority: high).";

    const updated = await updateActiveContext(userMsg, assistantMsg, ["Created task"], "discord");
    expect(updated.activeSubject).toContain("DSP");
    expect(updated.activeCategory).toBe("coursework");
    expect(updated.recentTopics).toContain("DSP");
  });

  it("extracts nutrition signals and maintains recent topics", async () => {
    const userMsg = "Log my evening whey protein shake";
    const assistantMsg = "Logged Whey Protein Shake (+26g P, 140 kcal).";

    const updated = await updateActiveContext(userMsg, assistantMsg, ["Logged nutrition"], "telegram");
    expect(updated.activeSubject).toContain("Whey");
    expect(updated.activeCategory).toBe("nutrition");
  });

  it("produces rich context memory snapshot with working memory and past memories", () => {
    const snapshot = getContextMemorySnapshot("hackathon deadline", "test-channel");
    expect(snapshot.activeContext).toBeDefined();
    expect(snapshot.promptBlock).toContain("ACTIVE CONVERSATION WORKING MEMORY");
    expect(snapshot.promptBlock).toContain("Cognition");
    expect(snapshot.promptBlock).toContain("PAST CONVERSATIONS & EXTRACTED MEMORIES");
  });

  it("resolves multi-turn follow-up pronouns ('when is it?', 'what is the deadline?') using context memory", async () => {
    // Turn 1: Ask about the earliest hackathon
    const turn1 = await processAssistantChat("Which is the most earliest hackathon?", "discord");
    expect(turn1.reply).toContain("Earliest Upcoming Regional Hackathon");
    expect(turn1.reply).toContain("HackSPIT");

    // Context should now focus on HackSPIT Hackathon
    const ctx = getActiveContext("discord");
    expect(ctx.activeSubject).toContain("HackSPIT");

    // Turn 2: Follow-up using pronoun "it" for deadline
    const turn2 = await processAssistantChat("when is the registration deadline for it?", "discord");
    expect(turn2.reply).toContain("HackSPIT 2026");
    expect(turn2.reply).toContain("registration deadline");
    expect(turn2.actionsTaken.some((a) => a.toLowerCase().includes("deadline"))).toBe(true);

    // Turn 3: Follow-up using pronoun "it" for prize
    const turn3 = await processAssistantChat("what is the prize for it?", "discord");
    expect(turn3.reply).toContain("HackSPIT 2026");
    expect(turn3.reply).toContain("1,50,000");

    // Turn 4: Follow-up for venue
    const turn4 = await processAssistantChat("where is it located?", "discord");
    expect(turn4.reply).toContain("HackSPIT 2026");
    expect(turn4.reply).toContain("SPIT Campus");
  });
});

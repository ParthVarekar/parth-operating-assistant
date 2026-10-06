import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  findBookmarkedHackathons,
  findHackathonById,
  findHackathonsByCity,
  seedInitialCuratedHackathons,
  toggleBookmark,
} from "../src/db/repositories/hackathonRepository.js";
import {
  convertHackathonToTask,
  formatHackathonCard,
  formatHackathonListDigest,
  listUpcomingHackathons,
  toggleHackathonSaved,
} from "../src/services/hackathonService.js";
import { parseUserIntent } from "../src/agent/intentParser.js";
import { findPendingTasks } from "../src/db/repositories/taskRepository.js";

describe("Hackathon Finder & Regional Integration Suite", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "mock";
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
    seedInitialCuratedHackathons();
  });

  it("seeds regional curated hackathons covering Mumbai, Thane, Navi Mumbai, and Pune", () => {
    const all = listUpcomingHackathons("all");
    expect(all.length).toBeGreaterThanOrEqual(8);

    const zones = new Set(all.map((h) => h.cityZone));
    expect(zones.has("mumbai")).toBe(true);
    expect(zones.has("navimumbai")).toBe(true);
    expect(zones.has("thane")).toBe(true);
    expect(zones.has("pune")).toBe(true);
  });

  it("filters hackathons by specific target zones correctly", () => {
    const mumbaiHacks = listUpcomingHackathons("mumbai");
    expect(mumbaiHacks.length).toBeGreaterThan(0);
    expect(mumbaiHacks.every((h) => h.cityZone === "mumbai")).toBe(true);

    const puneHacks = listUpcomingHackathons("pune");
    expect(puneHacks.length).toBeGreaterThan(0);
    expect(puneHacks.every((h) => h.cityZone === "pune")).toBe(true);

    const thaneHacks = listUpcomingHackathons("thane");
    expect(thaneHacks.length).toBeGreaterThan(0);
    expect(thaneHacks.every((h) => h.cityZone === "thane")).toBe(true);

    const naviMumbaiHacks = listUpcomingHackathons("navimumbai");
    expect(naviMumbaiHacks.length).toBeGreaterThan(0);
    expect(naviMumbaiHacks.every((h) => h.cityZone === "navimumbai")).toBe(true);
  });

  it("toggles bookmarks and queries saved hackathons", () => {
    const spit = findHackathonById("hack-spit-2026");
    expect(spit).not.toBeNull();
    expect(spit?.isBookmarked).toBe(false);

    // Save
    const state1 = toggleHackathonSaved("hack-spit-2026");
    expect(state1).toBe(true);

    const saved = listUpcomingHackathons("all", true);
    expect(saved.some((h) => h.id === "hack-spit-2026")).toBe(true);

    // Unsave
    const state2 = toggleHackathonSaved("hack-spit-2026");
    expect(state2).toBe(false);

    const savedAfter = listUpcomingHackathons("all", true);
    expect(savedAfter.some((h) => h.id === "hack-spit-2026")).toBe(false);
  });

  it("formats detailed hackathon cards with venue, mode, prizes, and links", () => {
    const spit = findHackathonById("hack-spit-2026");
    expect(spit).not.toBeNull();
    const card = formatHackathonCard(spit!);

    expect(card).toContain("HackSPIT 2026");
    expect(card).toContain("Sardar Patel Institute of Technology");
    expect(card).toContain("Andheri West");
    expect(card).toContain("OFFLINE");
    expect(card).toContain("₹1,50,000");
    expect(card).toContain("https://devfolio.co/hackspit2026");
  });

  it("formats summary digests with multiple entries", () => {
    const hacks = listUpcomingHackathons("mumbai");
    const digest = formatHackathonListDigest(hacks, "Mumbai Hackathons");

    expect(digest).toContain("Mumbai Hackathons");
    expect(digest).toContain("HackSPIT");
    expect(digest).toContain("VJTI");
  });

  it("converts a hackathon into an actionable scheduled task in the OS", () => {
    const createdTask = convertHackathonToTask("hack-spit-2026");
    expect(createdTask).not.toBeNull();
    expect(createdTask?.title).toContain("HackSPIT 2026");
    expect(createdTask?.category).toBe("coding");
    expect(createdTask?.priority).toBe("high");
    expect(createdTask?.estimatedMinutes).toBe(45);

    const pending = findPendingTasks();
    expect(pending.some((t) => t.id === createdTask?.id)).toBe(true);
  });

  it("parses natural language hackathon queries and detects city filters", async () => {
    const q1 = await parseUserIntent("find hackathons in pune");
    expect(q1.intentType).toBe("FIND_HACKATHONS");
    expect(q1.cityFilter).toBe("pune");

    const q2 = await parseUserIntent("show hackathons around mumbai or thane");
    expect(q2.intentType).toBe("FIND_HACKATHONS");
    // Should match one of the regional zones
    expect(["mumbai", "thane"]).toContain(q2.cityFilter);

    const q3 = await parseUserIntent("are there any hackathons in navi mumbai?");
    expect(q3.intentType).toBe("FIND_HACKATHONS");
    expect(q3.cityFilter).toBe("navimumbai");

    const q4 = await parseUserIntent("any upcoming hackathons?");
    expect(q4.intentType).toBe("FIND_HACKATHONS");
  });
});

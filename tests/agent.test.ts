import { describe, expect, it } from "vitest";
import { parseUserIntent } from "../src/agent/intentParser.js";
import { decomposeMonolith } from "../src/agent/taskDecomposer.js";

describe("Agent Intent & Decomposition Layer", () => {
  it("parses assignment and printable submission intents with heuristics", async () => {
    const raw = "I have an OS lab submission due this Friday, needs 6 pages handwritten and code printout";
    const parsed = await parseUserIntent(raw);

    expect(parsed.intentType).toBe("CREATE_SUBMISSION");
    expect(parsed.isPrintable).toBe(true);
    expect(parsed.category).toBe("assignment");
  });

  it("parses slippage reports and extracts slip minutes", async () => {
    const raw = "I'm running late, task slipped by 30 mins";
    const parsed = await parseUserIntent(raw);

    expect(parsed.intentType).toBe("REPORT_SLIP");
    expect(parsed.slipMinutes).toBe(30);
  });

  it("parses completion signals", async () => {
    const raw = "Done with Question 1 and 2!";
    const parsed = await parseUserIntent(raw);

    expect(parsed.intentType).toBe("REPORT_DONE");
  });

  it("decomposes monolithic assignments guaranteeing Step 1 is an activation step", async () => {
    const steps = await decomposeMonolith("Huge Computer Networks Project", "assignment");

    expect(steps.length).toBeGreaterThanOrEqual(3);
    // Crucial requirement: Step 1 must be an ultra-low-friction activation step!
    expect(steps[0]?.toLowerCase()).toContain("activation");
  });
});

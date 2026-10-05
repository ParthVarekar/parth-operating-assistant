import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  generateLearnedProfileSummary,
  getOptimismMultiplier,
  recordTaskCompletionVelocity,
} from "../src/services/learningService.js";
import { insertMeal } from "../src/db/repositories/mealRepository.js";

describe("Behavioral Learning Engine", () => {
  beforeAll(() => {
    initDatabase(":memory:");
  });

  it("updates category optimism multiplier when tasks consistently overrun estimates", () => {
    // Initial multiplier is default 1.0
    expect(getOptimismMultiplier("coding")).toBe(1.0);

    // Record that 30 min estimate took 60 mins (2.0x ratio)
    recordTaskCompletionVelocity("coding", 30, 60);

    const updatedMultiplier = getOptimismMultiplier("coding");
    // Should be smoothly updated above 1.0
    expect(updatedMultiplier).toBeGreaterThan(1.0);
    expect(updatedMultiplier).toBeLessThanOrEqual(3.0);
  });

  it("detects repeated missed meals and includes warning in learned profile summary", () => {
    insertMeal({
      id: "m1",
      date: "2026-10-04",
      mealType: "snack",
      scheduledTime: "18:30",
      status: "missed",
    });
    insertMeal({
      id: "m2",
      date: "2026-10-05",
      mealType: "snack",
      scheduledTime: "18:30",
      status: "missed",
    });

    const summary = generateLearnedProfileSummary();
    expect(summary).toContain("Pattern detected: You have missed");
  });
});

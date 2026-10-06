import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  generateLearnedProfileSummary,
  getOptimismMultiplier,
  inspectMealRoutineHealth,
  recordTaskCompletionVelocity,
} from "../src/services/learningService.js";
import { scheduleEveningPlan } from "../src/planner/intervalScheduler.js";
import { insertMeal } from "../src/db/repositories/mealRepository.js";
import type { Task } from "../src/types/index.js";

describe("Behavioral Learning Engine Convergence & Boundary Tests", () => {
  beforeAll(() => {
    initDatabase(":memory:");
  });

  it("smoothly converges the optimism multiplier upwards when user repeatedly underestimates duration", () => {
    // Baseline multiplier is 1.0
    expect(getOptimismMultiplier("assignment")).toBe(1.0);

    // Iteration 1: Estimated 30m, took 60m (2.0x)
    recordTaskCompletionVelocity("assignment", 30, 60);
    const m1 = getOptimismMultiplier("assignment");
    expect(m1).toBeGreaterThan(1.0);

    // Iteration 2: Estimated 40m, took 80m (2.0x)
    recordTaskCompletionVelocity("assignment", 40, 80);
    const m2 = getOptimismMultiplier("assignment");
    expect(m2).toBeGreaterThan(m1);

    // Iteration 3: Estimated 50m, took 100m (2.0x)
    recordTaskCompletionVelocity("assignment", 50, 100);
    const m3 = getOptimismMultiplier("assignment");
    expect(m3).toBeGreaterThan(m2);

    // Iteration 4: Extreme outlier: estimated 10m, took 100m (10.0x ratio)
    // Must be strictly clamped to <= 3.0 maximum
    recordTaskCompletionVelocity("assignment", 10, 100);
    const clampedM = getOptimismMultiplier("assignment");
    expect(clampedM).toBeLessThanOrEqual(3.0);
  });

  it("applies the learned multiplier to automatically expand scheduled block durations", () => {
    const task: Task = {
      id: "learn-task-1",
      title: "Handwritten Assignment Pages",
      category: "assignment",
      status: "pending",
      priority: "high",
      estimatedMinutes: 30,
      createdAt: "2026-10-06T00:00:00Z",
      updatedAt: "2026-10-06T00:00:00Z",
    };

    // Schedule without multiplier: 30m allocated
    const unadjustedPlan = scheduleEveningPlan([task], "2026-10-06", "23:00", { assignment: 1.0 });
    expect(unadjustedPlan.totalAllocatedMinutes).toBe(30);

    // Schedule with learned multiplier (e.g. 1.8x): 30 * 1.8 = 54m allocated
    const adjustedPlan = scheduleEveningPlan([task], "2026-10-06", "23:00", { assignment: 1.8 });
    expect(adjustedPlan.totalAllocatedMinutes).toBe(54);
  });

  it("identifies recurring meal routine failure and provides actionable advice", () => {
    // Clear baseline
    expect(inspectMealRoutineHealth()).toBeNull();

    // Log 2 missed afternoon meals
    insertMeal({
      id: "missed-1",
      date: "2026-10-04",
      mealType: "snack",
      scheduledTime: "18:00",
      status: "missed",
    });

    insertMeal({
      id: "missed-2",
      date: "2026-10-05",
      mealType: "snack",
      scheduledTime: "18:00",
      status: "missed",
    });

    const alert = inspectMealRoutineHealth();
    expect(alert).not.toBeNull();
    expect(alert).toContain("Pattern detected: You have missed 2 scheduled meals recently");
    expect(alert).toContain("shifting pre-dinner snack earlier");

    const profileSummary = generateLearnedProfileSummary();
    expect(profileSummary).toContain("Pattern detected");
  });
});

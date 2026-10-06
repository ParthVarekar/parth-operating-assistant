import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  formatFitnessDigest,
  getDailyFitnessSummary,
  logCustomMeal,
  logQuickPresetMeal,
  logWorkoutSession,
  MEAL_PRESETS,
} from "../src/services/fitnessService.js";

describe("Gym & Nutrition Tracker Suite", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
  });

  it("logs quick meal presets with accurate protein and calorie macros", () => {
    const entry = logQuickPresetMeal("eggs_toast", "2026-10-06");
    expect(entry.mealName).toContain("Eggs");
    expect(entry.proteinGrams).toBe(28);
    expect(entry.calories).toBe(350);

    const whey = logQuickPresetMeal("whey_shake", "2026-10-06");
    expect(whey.proteinGrams).toBe(26);
  });

  it("logs custom meals and updates daily totals", () => {
    logCustomMeal("Chicken Biryani & Salad", 800, 40, "dinner", "2026-10-06");
    const summary = getDailyFitnessSummary("2026-10-06");

    expect(summary.totalProtein).toBeGreaterThanOrEqual(94); // 28 + 26 + 40
    expect(summary.totalCalories).toBeGreaterThanOrEqual(1370);
    expect(summary.meals.length).toBe(3);
  });

  it("logs workouts and includes session in daily digest", () => {
    logWorkoutSession("Push Day (Chest, Shoulders, Triceps)", 50, "Heavy Bench 75kg", "2026-10-06");
    const summary = getDailyFitnessSummary("2026-10-06");

    expect(summary.workout).toBeDefined();
    expect(summary.workout?.workoutType).toContain("Push Day");
    expect(summary.workout?.durationMinutes).toBe(50);
  });

  it("formats visual progress bars and digest for Telegram", () => {
    const summary = getDailyFitnessSummary("2026-10-06");
    const digest = formatFitnessDigest(summary);

    expect(digest).toContain("Gym & Nutrition Tracker");
    expect(digest).toContain("Protein:");
    expect(digest).toContain("Calories:");
    expect(digest).toContain("Push Day");
  });
});

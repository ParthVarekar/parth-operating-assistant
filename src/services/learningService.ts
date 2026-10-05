import {
  findFrictionLogs,
  getHabitValue,
  setHabitValue,
} from "../db/repositories/habitRepository.js";
import { findRecentMissedMeals } from "../db/repositories/mealRepository.js";
import type { TaskCategory } from "../types/index.js";

interface CategoryStats {
  totalEstimated: number;
  totalActual: number;
  count: number;
  multiplier: number;
}

/**
 * Updates the empirical optimism multiplier for a task category.
 * Formula: beta_c = sum(actual) / sum(estimated), smoothed.
 * @param category Task category.
 * @param estimatedMinutes Estimated time.
 * @param actualMinutes Actual time spent.
 */
export function recordTaskCompletionVelocity(
  category: TaskCategory,
  estimatedMinutes: number,
  actualMinutes: number
): void {
  const key = `optimism_${category}`;
  const existing = getHabitValue<CategoryStats>(key) ?? {
    totalEstimated: 0,
    totalActual: 0,
    count: 0,
    multiplier: 1.0,
  };

  const newEstimated = existing.totalEstimated + estimatedMinutes;
  const newActual = existing.totalActual + actualMinutes;
  const newCount = existing.count + 1;

  // Compute raw ratio and clamp to safe bounds [1.0, 3.0]
  let rawRatio = newActual / Math.max(1, newEstimated);
  if (rawRatio < 1.0) rawRatio = 1.0;
  if (rawRatio > 3.0) rawRatio = 3.0;

  // Smoothing with previous estimate
  const smoothedMultiplier = Number((0.7 * rawRatio + 0.3 * existing.multiplier).toFixed(2));

  setHabitValue(
    key,
    {
      totalEstimated: newEstimated,
      totalActual: newActual,
      count: newCount,
      multiplier: smoothedMultiplier,
    },
    Math.min(1.0, newCount / 10),
    newCount
  );
}

/**
 * Retrieves the current learned optimism multiplier for a category.
 * @param category Task category.
 * @returns Multiplier float (e.g. 1.0 to 2.5).
 */
export function getOptimismMultiplier(category: TaskCategory): number {
  const key = `optimism_${category}`;
  const stats = getHabitValue<CategoryStats>(key);
  return stats?.multiplier ?? 1.0;
}

/**
 * Checks for behavioral patterns in missed meals and returns an adaptation recommendation.
 * @returns Human-readable recommendation string or null.
 */
export function inspectMealRoutineHealth(): string | null {
  const missed = findRecentMissedMeals(5);
  if (missed.length >= 2) {
    return (
      `Pattern detected: You have missed ${missed.length} scheduled meals recently. ` +
      `Your evening schedule may be too tight before dinner. Recommend shifting pre-dinner snack earlier.`
    );
  }
  return null;
}

/**
 * Summarizes learned user habits for transparent inspection.
 * @returns Diagnostic habit profile text.
 */
export function generateLearnedProfileSummary(): string {
  const categories: TaskCategory[] = ["assignment", "coding", "submission", "study"];
  const lines: string[] = ["📊 **Learned Behavioral Metrics & Velocity:**"];

  for (const cat of categories) {
    const mult = getOptimismMultiplier(cat);
    lines.push(`• ${cat}: ${mult.toFixed(2)}x time multiplier`);
  }

  const mealAlert = inspectMealRoutineHealth();
  if (mealAlert) {
    lines.push(`\n⚠️ ${mealAlert}`);
  }

  const recentFriction = findFrictionLogs(5);
  if (recentFriction.length > 0) {
    lines.push(`\n📌 Recent Friction Triggers: ${recentFriction.length} logged skips`);
  }

  return lines.join("\n");
}

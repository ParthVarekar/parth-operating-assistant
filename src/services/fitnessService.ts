import { getDb } from "../db/database.js";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { insertMeal } from "../db/repositories/mealRepository.js";

export interface NutritionEntry {
  id: string;
  date: string;
  mealName: string;
  mealType: string;
  calories: number;
  proteinGrams: number;
  loggedAt: string;
}

export interface WorkoutEntry {
  id: string;
  date: string;
  workoutType: string;
  durationMinutes: number;
  notes?: string;
  loggedAt: string;
}

export interface DailyFitnessSummary {
  date: string;
  totalCalories: number;
  targetCalories: number;
  totalProtein: number;
  targetProtein: number;
  meals: NutritionEntry[];
  workout?: WorkoutEntry;
}

export const MEAL_PRESETS: Record<string, { name: string; type: string; calories: number; protein: number }> = {
  eggs_toast: {
    name: "4 Boiled Eggs + 2 Toast",
    type: "snack",
    calories: 350,
    protein: 28,
  },
  whey_shake: {
    name: "1 Scoop Whey + Milk",
    type: "snack",
    calories: 220,
    protein: 26,
  },
  solid_dinner: {
    name: "Solid Dinner (Roti, Dal, Rice, Protein)",
    type: "dinner",
    calories: 750,
    protein: 34,
  },
  quick_snack: {
    name: "Peanut Butter Toast / Chana / Sprout",
    type: "snack",
    calories: 300,
    protein: 14,
  },
  night_fuel: {
    name: "Late-Night Milk + Nuts",
    type: "snack",
    calories: 250,
    protein: 12,
  },
};

/**
 * Logs a quick meal from presets into the database.
 * @param presetKey Key from MEAL_PRESETS.
 * @param customDate Optional date override (YYYY-MM-DD).
 * @returns Logged NutritionEntry.
 */
export function logQuickPresetMeal(presetKey: string, customDate?: string): NutritionEntry {
  const preset = MEAL_PRESETS[presetKey];
  if (!preset) {
    throw new Error(`Unknown meal preset: ${presetKey}`);
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const date = customDate ?? new Date().toISOString().slice(0, 10);
  const loggedAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO nutrition_logs (id, date, meal_name, meal_type, calories, protein_grams, logged_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, date, preset.name, preset.type, preset.calories, preset.protein, loggedAt);

  // Also mirror into meals table for scheduler awareness
  insertMeal({
    id,
    date,
    mealType: preset.type as any,
    scheduledTime: new Date().toTimeString().slice(0, 5),
    loggedAt,
    status: "completed",
    notes: `${preset.name} (${preset.calories} kcal, ${preset.protein}g P)`,
  });

  return {
    id,
    date,
    mealName: preset.name,
    mealType: preset.type,
    calories: preset.calories,
    proteinGrams: preset.protein,
    loggedAt,
  };
}

/**
 * Logs a custom meal entry with calories and protein.
 */
export function logCustomMeal(
  mealName: string,
  calories: number,
  proteinGrams: number,
  mealType = "snack",
  customDate?: string
): NutritionEntry {
  const db = getDb();
  const id = crypto.randomUUID();
  const date = customDate ?? new Date().toISOString().slice(0, 10);
  const loggedAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO nutrition_logs (id, date, meal_name, meal_type, calories, protein_grams, logged_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, date, mealName, mealType, calories, proteinGrams, loggedAt);

  insertMeal({
    id,
    date,
    mealType: mealType as any,
    scheduledTime: new Date().toTimeString().slice(0, 5),
    loggedAt,
    status: "completed",
    notes: `${mealName} (${calories} kcal, ${proteinGrams}g P)`,
  });

  return {
    id,
    date,
    mealName,
    mealType,
    calories,
    proteinGrams,
    loggedAt,
  };
}

/**
 * Logs a completed gym workout.
 */
export function logWorkoutSession(
  workoutType: string,
  durationMinutes = 45,
  notes?: string,
  customDate?: string
): WorkoutEntry {
  const db = getDb();
  const id = crypto.randomUUID();
  const date = customDate ?? new Date().toISOString().slice(0, 10);
  const loggedAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO workout_logs (id, date, workout_type, duration_minutes, notes, logged_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, date, workoutType, durationMinutes, notes ?? null, loggedAt);

  return {
    id,
    date,
    workoutType,
    durationMinutes,
    notes,
    loggedAt,
  };
}

/**
 * Retrieves today's full nutrition and workout summary.
 */
export function getDailyFitnessSummary(customDate?: string): DailyFitnessSummary {
  const db = getDb();
  const date = customDate ?? new Date().toISOString().slice(0, 10);

  const mealStmt = db.prepare("SELECT * FROM nutrition_logs WHERE date = ? ORDER BY logged_at ASC");
  const mealRows = (mealStmt.all(date) as unknown) as Array<{
    id: string;
    date: string;
    meal_name: string;
    meal_type: string;
    calories: number;
    protein_grams: number;
    logged_at: string;
  }>;

  const meals: NutritionEntry[] = mealRows.map((r) => ({
    id: r.id,
    date: r.date,
    mealName: r.meal_name,
    mealType: r.meal_type,
    calories: r.calories,
    proteinGrams: r.protein_grams,
    loggedAt: r.logged_at,
  }));

  const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0);
  const totalProtein = meals.reduce((sum, m) => sum + m.proteinGrams, 0);

  const targetCalories = getUserProfile<number>("target_calories") ?? 2500;
  const targetProtein = getUserProfile<number>("target_protein") ?? 130;

  const workoutStmt = db.prepare("SELECT * FROM workout_logs WHERE date = ? ORDER BY logged_at DESC LIMIT 1");
  const workoutRow = (workoutStmt.get(date) as unknown) as
    | {
        id: string;
        date: string;
        workout_type: string;
        duration_minutes: number;
        notes: string | null;
        logged_at: string;
      }
    | undefined;

  let workout: WorkoutEntry | undefined;
  if (workoutRow) {
    workout = {
      id: workoutRow.id,
      date: workoutRow.date,
      workoutType: workoutRow.workout_type,
      durationMinutes: workoutRow.duration_minutes,
      notes: workoutRow.notes ?? undefined,
      loggedAt: workoutRow.logged_at,
    };
  }

  return {
    date,
    totalCalories,
    targetCalories,
    totalProtein,
    targetProtein,
    meals,
    workout,
  };
}

function makeProgressBar(current: number, target: number, length = 10): string {
  const ratio = Math.min(1, Math.max(0, current / target));
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${Math.round(ratio * 100)}%`;
}

/**
 * Formats a clean, encouraging Telegram Markdown digest of fitness progress.
 */
export function formatFitnessDigest(summary: DailyFitnessSummary): string {
  const calBar = makeProgressBar(summary.totalCalories, summary.targetCalories);
  const protBar = makeProgressBar(summary.totalProtein, summary.targetProtein);

  const lines = [
    `🏋️ *Gym & Nutrition Tracker*`,
    `📅 *Date:* \`${summary.date}\`\n`,
    `🥩 *Protein:* *${summary.totalProtein}g* / ${summary.targetProtein}g`,
    `${protBar}\n`,
    `⚡ *Calories:* *${summary.totalCalories} kcal* / ${summary.targetCalories} kcal`,
    `${calBar}\n`,
  ];

  if (summary.workout) {
    lines.push(`💪 *Workout:* *${summary.workout.workoutType}* (${summary.workout.durationMinutes} mins) ✅`);
    if (summary.workout.notes) {
      lines.push(`   _${summary.workout.notes}_`);
    }
    lines.push("");
  } else {
    lines.push(`💤 *Workout:* No workout logged yet today.\n`);
  }

  if (summary.meals.length > 0) {
    lines.push(`🍱 *Meals Logged (${summary.meals.length}):*`);
    for (const m of summary.meals) {
      const timeStr = new Date(m.loggedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      lines.push(`• \`${timeStr}\` *${m.mealName}* (${m.calories} kcal, ${m.proteinGrams}g P)`);
    }
  } else {
    lines.push(`⚠️ *No meals logged yet today!* Tap quick buttons below to fuel up.`);
  }

  return lines.join("\n");
}

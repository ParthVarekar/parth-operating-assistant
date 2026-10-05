import { getDb } from "../database.js";
import type { MealRecord, MealStatus, MealType } from "../../types/index.js";

interface MealRow {
  id: string;
  date: string;
  meal_type: string;
  scheduled_time: string;
  logged_at: string | null;
  status: string;
  notes: string | null;
}

function mapRowToMeal(row: MealRow): MealRecord {
  return {
    id: row.id,
    date: row.date,
    mealType: row.meal_type as MealType,
    scheduledTime: row.scheduled_time,
    loggedAt: row.logged_at ?? undefined,
    status: row.status as MealStatus,
    notes: row.notes ?? undefined,
  };
}

/**
 * Inserts a scheduled meal record.
 * @param meal Meal record details.
 * @returns Populated MealRecord.
 */
export function insertMeal(meal: MealRecord): MealRecord {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO meals (id, date, meal_type, scheduled_time, logged_at, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    meal.id,
    meal.date,
    meal.mealType,
    meal.scheduledTime,
    meal.loggedAt ?? null,
    meal.status,
    meal.notes ?? null
  );

  return meal;
}

/**
 * Retrieves meals scheduled for a given date.
 * @param date ISO date string (YYYY-MM-DD).
 * @returns List of meals for the date.
 */
export function findMealsForDate(date: string): MealRecord[] {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM meals WHERE date = ? ORDER BY scheduled_time ASC");
  const rows = (stmt.all(date) as unknown) as MealRow[];
  return rows.map(mapRowToMeal);
}

/**
 * Updates status of a meal (e.g. marked completed or missed).
 * @param id Meal record identifier.
 * @param status Target status.
 */
export function updateMealStatus(id: string, status: MealStatus): void {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare("UPDATE meals SET status = ?, logged_at = ? WHERE id = ?");
  stmt.run(status, now, id);
}

/**
 * Counts consecutive or recent missed meals across dates.
 * @param limit Max entries to inspect.
 * @returns Array of recent missed meal records.
 */
export function findRecentMissedMeals(limit = 10): MealRecord[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM meals
    WHERE status = 'missed'
    ORDER BY date DESC, scheduled_time DESC
    LIMIT ?
  `);
  const rows = (stmt.all(limit) as unknown) as MealRow[];
  return rows.map(mapRowToMeal);
}

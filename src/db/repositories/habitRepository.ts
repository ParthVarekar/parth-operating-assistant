import { getDb } from "../database.js";
import type { FrictionLog } from "../../types/index.js";

interface HabitRow {
  key: string;
  value_json: string;
  confidence: number;
  sample_count: number;
  updated_at: string;
}

interface FrictionRow {
  id: string;
  task_id: string | null;
  reason: string;
  category: string;
  logged_at: string;
}

/**
 * Retrieves a stored habit or behavioral parameter.
 * @param key Habit identifier.
 * @returns Parsed JSON value or null.
 */
export function getHabitValue<T>(key: string): T | null {
  const db = getDb();
  const stmt = db.prepare("SELECT value_json FROM habits WHERE key = ?");
  const row = stmt.get(key) as HabitRow | undefined;
  if (!row) {
    return null;
  }
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}

/**
 * Saves or updates a behavioral parameter.
 * @param key Habit identifier.
 * @param value Object value to store.
 * @param confidence Confidence score (0.0 to 1.0).
 * @param sampleCount Observation count.
 */
export function setHabitValue(
  key: string,
  value: Record<string, unknown>,
  confidence: number,
  sampleCount: number
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO habits (key, value_json, confidence, sample_count, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      confidence = excluded.confidence,
      sample_count = excluded.sample_count,
      updated_at = excluded.updated_at
  `);
  stmt.run(key, JSON.stringify(value), confidence, sampleCount, now);
}

/**
 * Logs a friction occurrence when a task is skipped or postponed.
 * @param log Friction log entry.
 */
export function insertFrictionLog(log: FrictionLog): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO friction_logs (id, task_id, reason, category, logged_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(log.id, log.taskId ?? null, log.reason, log.category, log.loggedAt);
}

/**
 * Retrieves recent friction logs to diagnose procrastination patterns.
 * @param limit Max entries.
 * @returns Array of friction logs.
 */
export function findFrictionLogs(limit = 20): FrictionLog[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM friction_logs
    ORDER BY logged_at DESC
    LIMIT ?
  `);
  const rows = (stmt.all(limit) as unknown) as FrictionRow[];
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id ?? undefined,
    reason: r.reason,
    category: r.category,
    loggedAt: r.logged_at,
  }));
}

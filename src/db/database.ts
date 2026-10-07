import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getEnv } from "../config/env.js";

let dbInstance: DatabaseSync | null = null;

/**
 * Initializes the SQLite database with WAL mode and runs table migrations.
 * @param customPath Optional custom database path (for tests).
 * @returns Initialized DatabaseSync instance.
 */
export function initDatabase(customPath?: string): DatabaseSync {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const env = getEnv();
  const dbPath = customPath || env.DATABASE_PATH;

  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // Enable WAL mode, foreign key enforcement, and busy timeout
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  // Create core schema tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      estimated_minutes INTEGER NOT NULL,
      actual_minutes INTEGER,
      deadline TEXT,
      parent_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      stage TEXT NOT NULL,
      print_deadline TEXT,
      hard_deadline TEXT,
      materials_needed TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS schedule_blocks (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      zone_type TEXT NOT NULL,
      task_id TEXT,
      task_title TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS meals (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      meal_type TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      logged_at TEXT,
      status TEXT NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS habits (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      sample_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friction_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      reason TEXT NOT NULL,
      category TEXT NOT NULL,
      logged_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_events (
      id TEXT PRIMARY KEY,
      trigger_at TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hackathons (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      organizer TEXT NOT NULL,
      location TEXT NOT NULL,
      city_zone TEXT NOT NULL,
      venue TEXT NOT NULL,
      mode TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      registration_deadline TEXT NOT NULL,
      prize_pool TEXT,
      url TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      is_bookmarked INTEGER DEFAULT 0,
      discovered_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hackathons_city ON hackathons(city_zone);
    CREATE INDEX IF NOT EXISTS idx_hackathons_deadline ON hackathons(registration_deadline);

    CREATE TABLE IF NOT EXISTS nutrition_logs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      meal_name TEXT NOT NULL,
      meal_type TEXT NOT NULL,
      calories INTEGER NOT NULL,
      protein_grams INTEGER NOT NULL,
      logged_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workout_logs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      workout_type TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      notes TEXT,
      logged_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_nutrition_date ON nutrition_logs(date);
    CREATE INDEX IF NOT EXISTS idx_workout_date ON workout_logs(date);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      key TEXT,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
  `);

  dbInstance = db;
  return db;
}

/**
 * Retrieves the active database instance.
 * @returns Active DatabaseSync instance.
 */
export function getDb(): DatabaseSync {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

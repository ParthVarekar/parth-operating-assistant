import { getDb } from "../database.js";
import type { Task, TaskCategory, TaskPriority, TaskStatus } from "../../types/index.js";

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  priority: string;
  estimated_minutes: number;
  actual_minutes: number | null;
  deadline: string | null;
  parent_task_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    category: row.category as TaskCategory,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    estimatedMinutes: row.estimated_minutes,
    actualMinutes: row.actual_minutes ?? undefined,
    deadline: row.deadline ?? undefined,
    parentTaskId: row.parent_task_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Inserts a new task into the database.
 * @param task Task data without timestamps.
 * @returns Fully populated Task entity.
 */
export function insertTask(task: Omit<Task, "createdAt" | "updatedAt">): Task {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO tasks (
      id, title, description, category, status, priority,
      estimated_minutes, actual_minutes, deadline, parent_task_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    task.id,
    task.title,
    task.description ?? null,
    task.category,
    task.status,
    task.priority,
    task.estimatedMinutes,
    task.actualMinutes ?? null,
    task.deadline ?? null,
    task.parentTaskId ?? null,
    now,
    now
  );

  return {
    ...task,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Retrieves a task by its unique ID.
 * @param id Task ID.
 * @returns Task entity or null.
 */
export function findTaskById(id: string): Task | null {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM tasks WHERE id = ?");
  const row = (stmt.get(id) as unknown) as TaskRow | undefined;
  return row ? mapRowToTask(row) : null;
}

/**
 * Retrieves all currently actionable or pending tasks.
 * @returns Array of active tasks.
 */
export function findPendingTasks(): Task[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM tasks
    WHERE status IN ('pending', 'in_progress')
    ORDER BY CASE priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      ELSE 4
    END, deadline ASC
  `);
  const rows = (stmt.all() as unknown) as TaskRow[];
  return rows.map(mapRowToTask);
}

/**
 * Updates status and optional actual duration for a task.
 * @param id Task ID.
 * @param status Target task status.
 * @param actualMinutes Recorded actual completion time.
 */
export function updateTaskStatus(id: string, status: TaskStatus, actualMinutes?: number): void {
  const db = getDb();
  const now = new Date().toISOString();

  if (actualMinutes !== undefined) {
    const stmt = db.prepare(`
      UPDATE tasks
      SET status = ?, actual_minutes = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, actualMinutes, now, id);
  } else {
    const stmt = db.prepare(`
      UPDATE tasks
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, now, id);
  }
}

/**
 * Retrieves tasks completed on a specific ISO date (YYYY-MM-DD).
 * @param dateStr ISO date string.
 * @returns Array of completed tasks.
 */
export function findCompletedTasksForDate(dateStr: string): Task[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM tasks
    WHERE status IN ('completed', 'done') AND updated_at LIKE ?
    ORDER BY updated_at DESC
  `);
  const rows = (stmt.all(`${dateStr}%`) as unknown) as TaskRow[];
  return rows.map(mapRowToTask);
}

/**
 * Updates properties of an existing task.
 * @param id Task ID.
 * @param updates Partial task fields to update.
 * @returns Updated Task entity or null if not found.
 */
export function updateTask(
  id: string,
  updates: Partial<Omit<Task, "id" | "createdAt">>
): Task | null {
  const existing = findTaskById(id);
  if (!existing) return null;

  const db = getDb();
  const now = new Date().toISOString();

  const title = updates.title ?? existing.title;
  const description = updates.description !== undefined ? updates.description : existing.description;
  const category = updates.category ?? existing.category;
  const status = updates.status ?? existing.status;
  const priority = updates.priority ?? existing.priority;
  const estimatedMinutes = updates.estimatedMinutes ?? existing.estimatedMinutes;
  const actualMinutes = updates.actualMinutes !== undefined ? updates.actualMinutes : existing.actualMinutes;
  const deadline = updates.deadline !== undefined ? updates.deadline : existing.deadline;

  const stmt = db.prepare(`
    UPDATE tasks
    SET title = ?, description = ?, category = ?, status = ?, priority = ?,
        estimated_minutes = ?, actual_minutes = ?, deadline = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    title,
    description ?? null,
    category,
    status,
    priority,
    estimatedMinutes,
    actualMinutes ?? null,
    deadline ?? null,
    now,
    id
  );

  return findTaskById(id);
}

/**
 * Permanently removes a task from the database.
 * @param id Task ID.
 * @returns True if deleted, false if not found.
 */
export function deleteTask(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM tasks WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

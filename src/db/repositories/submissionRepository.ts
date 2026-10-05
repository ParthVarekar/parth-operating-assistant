import { getDb } from "../database.js";
import type { Submission, SubmissionStage } from "../../types/index.js";

interface SubmissionRow {
  id: string;
  task_id: string;
  subject: string;
  stage: string;
  print_deadline: string | null;
  hard_deadline: string | null;
  materials_needed: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToSubmission(row: SubmissionRow): Submission {
  return {
    id: row.id,
    taskId: row.task_id,
    subject: row.subject,
    stage: row.stage as SubmissionStage,
    printDeadline: row.print_deadline ?? undefined,
    hardDeadline: row.hard_deadline ?? undefined,
    materialsNeeded: row.materials_needed ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Inserts a new submission pipeline record.
 * @param submission Submission details.
 * @returns Fully populated Submission record.
 */
export function insertSubmission(submission: Omit<Submission, "createdAt" | "updatedAt">): Submission {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO submissions (
      id, task_id, subject, stage, print_deadline, hard_deadline,
      materials_needed, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    submission.id,
    submission.taskId,
    submission.subject,
    submission.stage,
    submission.printDeadline ?? null,
    submission.hardDeadline ?? null,
    submission.materialsNeeded ?? null,
    submission.notes ?? null,
    now,
    now
  );

  return {
    ...submission,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Retrieves all active (unsubmitted) submissions.
 * @returns List of active submissions.
 */
export function findActiveSubmissions(): Submission[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM submissions
    WHERE stage != 'submitted'
    ORDER BY hard_deadline ASC
  `);
  const rows = (stmt.all() as unknown) as SubmissionRow[];
  return rows.map(mapRowToSubmission);
}

/**
 * Retrieves a submission by its unique ID.
 * @param id Submission identifier.
 * @returns Submission or null.
 */
export function findSubmissionById(id: string): Submission | null {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM submissions WHERE id = ?");
  const row = (stmt.get(id) as unknown) as SubmissionRow | undefined;
  return row ? mapRowToSubmission(row) : null;
}

/**
 * Retrieves a submission associated with a specific task ID.
 * @param taskId Foreign task identifier.
 * @returns Submission or null.
 */
export function findSubmissionByTaskId(taskId: string): Submission | null {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM submissions WHERE task_id = ?");
  const row = (stmt.get(taskId) as unknown) as SubmissionRow | undefined;
  return row ? mapRowToSubmission(row) : null;
}

/**
 * Updates the physical or digital pipeline stage of a submission.
 * @param id Submission ID.
 * @param stage Target stage.
 */
export function updateSubmissionStage(id: string, stage: SubmissionStage): void {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE submissions
    SET stage = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(stage, now, id);
}

import { getDb } from "../database.js";
import type { BlockStatus, ScheduleBlock, ZoneType } from "../../types/index.js";

interface ScheduleBlockRow {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  zone_type: string;
  task_id: string | null;
  task_title: string | null;
  status: string;
  created_at: string;
}

function mapRowToBlock(row: ScheduleBlockRow): ScheduleBlock {
  return {
    id: row.id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    zoneType: row.zone_type as ZoneType,
    taskId: row.task_id ?? undefined,
    taskTitle: row.task_title ?? undefined,
    status: row.status as BlockStatus,
    createdAt: row.created_at,
  };
}

/**
 * Saves a scheduled timeline block.
 * @param block Schedule block data.
 * @returns Populated ScheduleBlock.
 */
export function insertScheduleBlock(block: Omit<ScheduleBlock, "createdAt">): ScheduleBlock {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO schedule_blocks (
      id, date, start_time, end_time, zone_type, task_id, task_title, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    block.id,
    block.date,
    block.startTime,
    block.endTime,
    block.zoneType,
    block.taskId ?? null,
    block.taskTitle ?? null,
    block.status,
    now
  );

  return {
    ...block,
    createdAt: now,
  };
}

/**
 * Retrieves all scheduled blocks for a specific date in chronological order.
 * @param date ISO date string (YYYY-MM-DD).
 * @returns Ordered list of schedule blocks.
 */
export function findBlocksByDate(date: string): ScheduleBlock[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM schedule_blocks
    WHERE date = ?
    ORDER BY start_time ASC
  `);
  const rows = (stmt.all(date) as unknown) as ScheduleBlockRow[];
  return rows.map(mapRowToBlock);
}

/**
 * Updates status of an existing schedule block.
 * @param id Block identifier.
 * @param status Target status.
 */
export function updateBlockStatus(id: string, status: BlockStatus): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE schedule_blocks SET status = ? WHERE id = ?");
  stmt.run(status, id);
}

/**
 * Clears future or planned blocks for a specific date during replanning.
 * @param date ISO date string (YYYY-MM-DD).
 */
export function clearPlannedBlocksForDate(date: string): void {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM schedule_blocks WHERE date = ? AND status = 'planned'");
  stmt.run(date);
}

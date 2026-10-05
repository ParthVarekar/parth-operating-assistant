import { getDb } from "../database.js";
import type { ScheduledEvent, ScheduledEventType } from "../../types/index.js";

interface EventRow {
  id: string;
  trigger_at: string;
  event_type: string;
  payload_json: string;
  status: string;
  retry_count: number;
  created_at: string;
}

function mapRowToEvent(row: EventRow): ScheduledEvent {
  let parsedPayload: Record<string, unknown> = {};
  try {
    parsedPayload = JSON.parse(row.payload_json);
  } catch {
    parsedPayload = {};
  }

  return {
    id: row.id,
    triggerAt: row.trigger_at,
    eventType: row.event_type as ScheduledEventType,
    payload: parsedPayload,
    status: row.status as "pending" | "processed" | "cancelled",
    retryCount: row.retry_count,
    createdAt: row.created_at,
  };
}

/**
 * Inserts a persistent scheduled event into the database.
 * @param event Scheduled event properties.
 * @returns Fully populated ScheduledEvent.
 */
export function insertEvent(event: Omit<ScheduledEvent, "createdAt">): ScheduledEvent {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO scheduled_events (id, trigger_at, event_type, payload_json, status, retry_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    event.id,
    event.triggerAt,
    event.eventType,
    JSON.stringify(event.payload),
    event.status,
    event.retryCount,
    now
  );

  return {
    ...event,
    createdAt: now,
  };
}

/**
 * Fetches events that are due to execute at or before the given timestamp.
 * @param currentTimeIso ISO timestamp comparison ceiling.
 * @param limit Max events to return per tick.
 * @returns Array of due events.
 */
export function findDueEvents(currentTimeIso: string, limit = 10): ScheduledEvent[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM scheduled_events
    WHERE trigger_at <= ? AND status = 'pending'
    ORDER BY trigger_at ASC
    LIMIT ?
  `);
  const rows = (stmt.all(currentTimeIso, limit) as unknown) as EventRow[];
  return rows.map(mapRowToEvent);
}

/**
 * Marks a scheduled event as successfully processed.
 * @param id Event identifier.
 */
export function markEventProcessed(id: string): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE scheduled_events SET status = 'processed' WHERE id = ?");
  stmt.run(id);
}

/**
 * Increments retry count or marks event failed with backoff.
 * @param id Event identifier.
 */
export function markEventFailed(id: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE scheduled_events
    SET retry_count = retry_count + 1
    WHERE id = ?
  `);
  stmt.run(id);
}

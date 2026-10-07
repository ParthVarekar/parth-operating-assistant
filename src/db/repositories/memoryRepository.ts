import { initDatabase } from "../database.js";
import type { MemoryEntry, MemoryCategory } from "../../types/index.js";

/**
 * Inserts or updates a memory entry in the database.
 */
export function insertMemory(entry: MemoryEntry): void {
  const db = initDatabase();
  const stmt = db.prepare(`
    INSERT INTO memories (
      id, category, key, content, source, importance, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category,
      key = excluded.key,
      content = excluded.content,
      source = excluded.source,
      importance = excluded.importance,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    entry.id,
    entry.category,
    entry.key || null,
    entry.content,
    entry.source,
    entry.importance,
    entry.metadata ? JSON.stringify(entry.metadata) : null,
    entry.createdAt,
    entry.updatedAt
  );
}

/**
 * Finds memories by category, sorted by importance and recency.
 */
export function findMemoriesByCategory(
  category: MemoryCategory,
  limit: number = 20
): MemoryEntry[] {
  const db = initDatabase();
  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE category = ?
    ORDER BY importance DESC, created_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(category, limit) as any[];
  return rows.map(mapRowToMemory);
}

/**
 * Retrieves the most recent memories across all categories.
 */
export function getRecentMemories(limit: number = 20): MemoryEntry[] {
  const db = initDatabase();
  const stmt = db.prepare(`
    SELECT * FROM memories
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(limit) as any[];
  return rows.map(mapRowToMemory);
}

/**
 * Searches memories for text matches in content or key.
 */
export function searchMemories(query: string, limit: number = 10): MemoryEntry[] {
  const db = initDatabase();
  const searchPattern = `%${query.toLowerCase()}%`;
  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE LOWER(content) LIKE ? OR LOWER(COALESCE(key, '')) LIKE ?
    ORDER BY importance DESC, created_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(searchPattern, searchPattern, limit) as any[];
  return rows.map(mapRowToMemory);
}

/**
 * Finds a memory entry by exact key.
 */
export function findMemoryByKey(key: string): MemoryEntry | null {
  const db = initDatabase();
  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE key = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `);

  const row = stmt.get(key) as any;
  return row ? mapRowToMemory(row) : null;
}

/**
 * Deletes a memory by ID.
 */
export function deleteMemory(id: string): void {
  const db = initDatabase();
  const stmt = db.prepare(`DELETE FROM memories WHERE id = ?`);
  stmt.run(id);
}

function mapRowToMemory(row: any): MemoryEntry {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json);
    } catch {
      metadata = undefined;
    }
  }

  return {
    id: row.id,
    category: row.category as MemoryCategory,
    key: row.key ?? undefined,
    content: row.content,
    source: row.source,
    importance: Number(row.importance || 1),
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

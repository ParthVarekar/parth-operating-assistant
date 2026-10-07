import crypto from "node:crypto";
import {
  insertMemory,
  getRecentMemories,
  searchMemories,
  findMemoriesByCategory,
  findMemoryByKey,
} from "../db/repositories/memoryRepository.js";
import { saveMemoryToNotion, isNotionConfigured } from "./notionService.js";
import { logMemoryToSlack, isSlackConfigured } from "./slackService.js";
import type { MemoryCategory, MemoryEntry } from "../types/index.js";

export { searchMemories } from "../db/repositories/memoryRepository.js";

/**
 * Records a new memory, insight, user preference, or decision into the assistant's brain.
 * Persists locally to SQLite, and synchronizes to Notion and Slack if configured.
 */
export async function recordMemory(
  category: MemoryCategory,
  content: string,
  source: MemoryEntry["source"] = "chat",
  options?: {
    key?: string;
    importance?: number;
    metadata?: Record<string, unknown>;
    title?: string;
  }
): Promise<MemoryEntry> {
  const now = new Date().toISOString();
  const entry: MemoryEntry = {
    id: crypto.randomUUID(),
    category,
    key: options?.key,
    content: content.trim(),
    source,
    importance: options?.importance ?? 2,
    metadata: options?.metadata,
    createdAt: now,
    updatedAt: now,
  };

  // 1. Primary local persistence (SQLite)
  insertMemory(entry);

  const title = options?.title || `${category.toUpperCase()}: ${content.slice(0, 40)}...`;

  // 2. Persistent Brain: Sync to Notion
  if (isNotionConfigured()) {
    saveMemoryToNotion(title, content, category).catch((err) =>
      console.warn("Could not sync memory to Notion:", err?.message || err)
    );
  }

  // 3. Persistent Brain: Sync to Slack
  if (isSlackConfigured()) {
    logMemoryToSlack(title, content, category).catch((err) =>
      console.warn("Could not sync memory to Slack:", err?.message || err)
    );
  }

  return entry;
}

/**
 * Retrieves the most relevant contextual memories for a user prompt
 * to inject into the LLM conversational reasoning context.
 */
export function retrieveContextualMemories(userText: string, maxItems: number = 6): MemoryEntry[] {
  const query = userText.trim();
  const matched = new Map<string, MemoryEntry>();

  // Extract key search terms (ignoring small common words)
  const stopWords = new Set(["the", "and", "is", "in", "to", "of", "a", "an", "i", "my", "me", "you", "for", "with", "on", "at", "it", "do", "how", "what", "which", "when", "where", "can"]);
  const terms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  // Search by each substantive term
  for (const term of terms.slice(0, 4)) {
    const results = searchMemories(term, 3);
    for (const r of results) {
      matched.set(r.id, r);
    }
  }

  // Also include top recent high-importance memories to maintain continuity
  const recent = getRecentMemories(5);
  for (const r of recent) {
    if (r.importance >= 3 || matched.size < maxItems) {
      matched.set(r.id, r);
    }
  }

  return Array.from(matched.values()).slice(0, maxItems);
}

/**
 * Formats contextual memories into a clean prompt block for the LLM.
 */
export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) {
    return "No prior conversational memory retrieved.";
  }

  return memories
    .map(
      (m, i) =>
        `${i + 1}. [${m.category.toUpperCase()}] ${m.content} (Source: ${m.source}, Date: ${m.createdAt.slice(0, 10)})`
    )
    .join("\n");
}

/**
 * Gets high-level summary of the brain's knowledge store.
 */
export function getBrainStatus(): {
  totalMemories: number;
  recentEntries: MemoryEntry[];
  notionConnected: boolean;
  slackConnected: boolean;
} {
  const recent = getRecentMemories(10);
  return {
    totalMemories: recent.length,
    recentEntries: recent,
    notionConnected: isNotionConfigured(),
    slackConnected: isSlackConfigured(),
  };
}

import { getEnv } from "../config/env.js";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

/**
 * Gets configured Notion API Key.
 */
export function getNotionApiKey(): string {
  const custom = getUserProfile<string>("notion_api_key");
  if (custom && custom.trim().length > 0) {
    return custom.trim();
  }
  const env = getEnv();
  return env.NOTION_API_KEY || "";
}

/**
 * Sets Notion API Key in user profile.
 */
export function setNotionApiKey(key: string): void {
  setUserProfile("notion_api_key", key.trim());
}

/**
 * Gets configured Notion Database or Page ID.
 */
export function getNotionDatabaseId(): string {
  const custom = getUserProfile<string>("notion_database_id");
  if (custom && custom.trim().length > 0) {
    return custom.trim();
  }
  const env = getEnv();
  return env.NOTION_DATABASE_ID || "";
}

/**
 * Sets Notion Database ID in user profile.
 */
export function setNotionDatabaseId(id: string): void {
  setUserProfile("notion_database_id", id.trim());
}

/**
 * Checks if Notion integration is fully configured with an API Key.
 */
export function isNotionConfigured(): boolean {
  return getNotionApiKey().length > 0;
}

/**
 * Makes an authenticated request to the Notion API.
 */
async function notionFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
  const apiKey = getNotionApiKey();
  if (!apiKey) {
    throw new Error("NOTION_API_KEY is not configured.");
  }

  const url = endpoint.startsWith("http") ? endpoint : `${NOTION_API_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Notion API error (${res.status}): ${errorBody}`);
  }

  return res.json();
}

/**
 * Saves a memory note or operational log to Notion.
 * If a database ID is configured, creates a database item.
 * Otherwise, can append to parent page or gracefully fallback.
 */
export async function saveMemoryToNotion(
  title: string,
  content: string,
  category: string = "Memory",
  tags: string[] = []
): Promise<boolean> {
  if (!isNotionConfigured()) {
    return false;
  }

  const databaseId = getNotionDatabaseId();
  if (!databaseId) {
    console.warn("Notion API Key is present, but NOTION_DATABASE_ID is not configured. Set NOTION_DATABASE_ID to persist notes to Notion.");
    return false;
  }

  try {
    const payload = {
      parent: { database_id: databaseId },
      properties: {
        Name: {
          title: [
            {
              text: { content: title.slice(0, 100) },
            },
          ],
        },
        Category: {
          select: { name: category.slice(0, 50) },
        },
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                text: { content: content.slice(0, 2000) },
              },
            ],
          },
        },
      ],
    };

    await notionFetch("/pages", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    console.log(`🧠 Persisted memory note to Notion: "${title}"`);
    return true;
  } catch (err: any) {
    console.warn(`Failed to persist memory to Notion:`, err?.message || err);
    return false;
  }
}

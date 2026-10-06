import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { findPendingTasks, insertTask, updateTaskStatus } from "../db/repositories/taskRepository.js";
import { registerSubmission } from "./submissionService.js";
import type { Task } from "../types/index.js";

const CLIENT_ID = process.env.TRELLO_CLIENT_ID || "UomOc5kOvoxpgi1NFcDtu2Z835YP2irO";

export interface TrelloBoard {
  id: string;
  name: string;
  desc?: string;
  url: string;
}

export interface TrelloList {
  id: string;
  name: string;
  idBoard: string;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  due: string | null;
  idList: string;
  url: string;
  labels: Array<{ id: string; name: string; color: string }>;
}

/**
 * Retrieves the active Trello access token from DB or environment.
 */
export function getTrelloAccessToken(): string | null {
  const dbToken = getUserProfile<string>("trello_access_token");
  if (dbToken) return dbToken;
  return process.env.TRELLO_ACCESS_TOKEN ?? null;
}

/**
 * Refreshes an expired Trello access token using the stored refresh token.
 */
export async function refreshTrelloAccessToken(): Promise<string | null> {
  const refreshToken =
    getUserProfile<string>("trello_refresh_token") ?? process.env.TRELLO_REFRESH_TOKEN;
  if (!refreshToken) return null;

  try {
    const res = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) {
      console.error("Failed to refresh Trello token:", await res.text());
      return null;
    }

    const data = (await res.json()) as { access_token: string; refresh_token?: string };
    setUserProfile("trello_access_token", data.access_token);
    if (data.refresh_token) {
      setUserProfile("trello_refresh_token", data.refresh_token);
    }
    return data.access_token;
  } catch (err) {
    console.error("Error refreshing Trello token:", err);
    return null;
  }
}

async function trelloFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let token = getTrelloAccessToken();
  if (!token) {
    throw new Error("No Trello access token available. Please run npm run auth:trello first.");
  }

  const url = endpoint.startsWith("http") ? endpoint : `https://api.trello.com/1${endpoint}`;
  let res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  // If unauthorized, attempt token refresh once
  if (res.status === 401) {
    const newToken = await refreshTrelloAccessToken();
    if (newToken) {
      res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${newToken}`,
          Accept: "application/json",
          ...(options.headers || {}),
        },
      });
    }
  }

  if (!res.ok) {
    throw new Error(`Trello API error (${res.status}): ${await res.text()}`);
  }

  return (await res.json()) as T;
}

/**
 * Fetches all Trello boards for the authenticated user.
 */
export async function getTrelloBoards(): Promise<TrelloBoard[]> {
  return trelloFetch<TrelloBoard[]>("/members/me/boards?filter=open&fields=id,name,desc,url");
}

/**
 * Fetches all lists on a specific Trello board.
 */
export async function getBoardLists(boardId: string): Promise<TrelloList[]> {
  return trelloFetch<TrelloList[]>(`/boards/${boardId}/lists`);
}

/**
 * Fetches all cards on a specific Trello board.
 */
export async function getBoardCards(boardId: string): Promise<TrelloCard[]> {
  return trelloFetch<TrelloCard[]>(
    `/boards/${boardId}/cards?filter=open&fields=id,name,desc,due,idList,url,labels`
  );
}

/**
 * Moves a Trello card to another list (e.g. to "Done").
 */
export async function moveCardToList(cardId: string, targetListId: string): Promise<void> {
  await trelloFetch(`/cards/${cardId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idList: targetListId }),
  });
}

/**
 * Synchronizes cards from a Trello board into the assistant's tasks and submission pipeline.
 * @param specificBoardId Optional specific board ID. Defaults to first board if omitted.
 * @returns Summary of synced tasks.
 */
export async function syncTrelloBoard(specificBoardId?: string): Promise<{
  boardName: string;
  syncedTasksCount: number;
  completedTasksCount: number;
  newSubmissionsCount: number;
}> {
  const boards = await getTrelloBoards();
  if (boards.length === 0) {
    throw new Error("No open Trello boards found on this account.");
  }

  const board = specificBoardId ? boards.find((b) => b.id === specificBoardId) ?? boards[0]! : boards[0]!;
  setUserProfile("active_trello_board_id", board.id);
  setUserProfile("active_trello_board_name", board.name);

  const lists = await getBoardLists(board.id);
  const cards = await getBoardCards(board.id);

  const doneListIds = new Set(
    lists
      .filter((l) => {
        const lower = l.name.toLowerCase();
        return lower.includes("done") || lower.includes("completed") || lower.includes("finished");
      })
      .map((l) => l.id)
  );

  let synced = 0;
  let completed = 0;
  let newSubmissions = 0;

  for (const card of cards) {
    const isDone = doneListIds.has(card.idList);
    const existingTasks = findPendingTasks();
    const existing = existingTasks.find((t) => t.id === card.id || t.title === card.name);

    if (isDone) {
      if (existing && existing.status !== "completed") {
        updateTaskStatus(existing.id, "completed", 45);
        completed++;
      }
      continue;
    }

    const isSubmission =
      card.name.toLowerCase().includes("assignment") ||
      card.name.toLowerCase().includes("submission") ||
      card.name.toLowerCase().includes("print") ||
      card.desc.toLowerCase().includes("print") ||
      card.labels.some((l) => l.name.toLowerCase().includes("submission"));

    const deadline = card.due ? new Date(card.due).toISOString() : undefined;

    if (!existing) {
      const newTask: Task = {
        id: card.id,
        title: card.name,
        description: card.desc || `Imported from Trello (${board.name})`,
        category: isSubmission ? "assignment" : "coding",
        status: "pending",
        priority: card.due ? "high" : "medium",
        estimatedMinutes: 45,
        deadline,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      insertTask(newTask);
      synced++;

      if (isSubmission) {
        registerSubmission(card.id, card.name, deadline, true);
        newSubmissions++;
      }
    }
  }

  return {
    boardName: board.name,
    syncedTasksCount: synced,
    completedTasksCount: completed,
    newSubmissionsCount: newSubmissions,
  };
}

/**
 * Formats a clean markdown digest of Trello integration status for Telegram.
 */
export async function formatTrelloStatusDigest(): Promise<string> {
  const token = getTrelloAccessToken();
  if (!token) {
    return (
      `📌 *Trello Connectivity: Disconnected*\n\n` +
      `To link your Trello boards, run the authorization helper on your machine:\n` +
      `\`npm run auth:trello\`\n\n` +
      `The assistant will automatically open your browser and connect!`
    );
  }

  try {
    const boards = await getTrelloBoards();
    const activeBoardName = getUserProfile<string>("active_trello_board_name") ?? boards[0]?.name ?? "None";

    const lines: string[] = [
      `📌 *Trello Connected* ✅\n`,
      `📋 *Active Board:* ${activeBoardName}`,
      `📂 *Total Boards Found:* ${boards.length}`,
    ];

    if (boards.length > 0) {
      lines.push("\n*Your Boards:*");
      for (const b of boards.slice(0, 5)) {
        lines.push(`• [${b.name}](${b.url})`);
      }
    }

    lines.push("\n💡 _Tap Sync below to pull all cards and deadlines into your daily OS plan._");
    return lines.join("\n");
  } catch (err) {
    return `⚠️ *Trello Connection Error:* ${String(err)}`;
  }
}

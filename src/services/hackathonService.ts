import {
  findHackathonsByCity,
  findBookmarkedHackathons,
  findHackathonById,
  toggleBookmark,
} from "../db/repositories/hackathonRepository.js";
import { insertTask } from "../db/repositories/taskRepository.js";
import type { CityZone, HackathonRecord, Task } from "../types/index.js";

/**
 * Lists upcoming hackathons filtered by optional city zone or bookmark status.
 * @param zone Optional city zone to filter by ('mumbai', 'thane', 'navimumbai', 'pune', 'online', or undefined for all).
 * @param bookmarkedOnly If true, returns only user bookmarked hackathons.
 * @returns Array of HackathonRecord objects.
 */
export function listUpcomingHackathons(
  zone?: CityZone | "all",
  bookmarkedOnly = false
): HackathonRecord[] {
  if (bookmarkedOnly) {
    return findBookmarkedHackathons();
  }

  const zonesToQuery: CityZone[] =
    !zone || zone === "all"
      ? ["mumbai", "thane", "navimumbai", "pune", "online"]
      : [zone];

  return findHackathonsByCity(zonesToQuery, true);
}

/**
 * Formats a single hackathon into a detailed Telegram markdown card.
 * @param h HackathonRecord object.
 * @returns Formatted markdown string.
 */
export function formatHackathonCard(h: HackathonRecord): string {
  const bookmarkIcon = h.isBookmarked ? "⭐ [Saved]" : "☆ [Unsaved]";
  const tagsStr = h.tags.map((t) => `#${t.replace(/\s+/g, "")}`).join(" ");
  const conductionStr =
    h.startDate === h.endDate ? h.startDate : `${h.startDate} → ${h.endDate}`;

  return (
    `🚀 *${h.title}*\n` +
    `🏛 *Organizer:* ${h.organizer}\n` +
    `📍 *Location:* ${h.location} (${h.cityZone.toUpperCase()})\n` +
    `🏢 *Venue:* ${h.venue}\n` +
    `🌐 *Mode:* ${h.mode.toUpperCase()}\n` +
    `🗓️ *Conduction Dates:* ${conductionStr}\n` +
    `🚨 *Registration Deadline:* ${h.registrationDeadline}\n` +
    (h.prizePool ? `💰 *Prize Pool:* ${h.prizePool}\n` : "") +
    `🏷 *Tags:* ${tagsStr}\n` +
    `🔗 [Registration Link](${h.url})\n` +
    `📌 *Bookmark Status:* ${bookmarkIcon}`
  );
}

/**
 * Formats a list of hackathons into a clean digest message.
 * @param hackathons Array of HackathonRecord items.
 * @param headerTitle Custom heading title.
 * @returns Formatted markdown message string.
 */
export function formatHackathonListDigest(
  hackathons: HackathonRecord[],
  headerTitle = "Regional Hackathons (Mumbai & Vicinity)"
): string {
  if (hackathons.length === 0) {
    return (
      `🔍 *${headerTitle}*\n\n` +
      `No upcoming hackathons found for this filter. Check back soon or try another city zone!`
    );
  }

  const lines: string[] = [`🎯 *${headerTitle}* (${hackathons.length} events)\n`];

  for (let i = 0; i < hackathons.length; i++) {
    const h = hackathons[i]!;
    const mark = h.isBookmarked ? " ⭐" : "";
    const conductionStr =
      h.startDate === h.endDate ? h.startDate : `${h.startDate} → ${h.endDate}`;

    lines.push(
      `${i + 1}. *${h.title}*${mark}\n` +
      `   📍 ${h.location} | \`${h.mode.toUpperCase()}\`\n` +
      `   🗓️ *Conducted On:* ${conductionStr}\n` +
      `   🚨 *Reg Deadline:* ${h.registrationDeadline}` +
      (h.prizePool ? ` | 💰 ${h.prizePool}` : "") +
      `\n   🔗 ${h.url}`
    );
  }

  lines.push("\n💡 _Tap below or use buttons to inspect details, bookmark, or add as a task._");
  return lines.join("\n");
}

/**
 * Toggles the bookmark status for a hackathon.
 * @param hackathonId ID of hackathon to toggle.
 * @returns Updated boolean bookmark status, or null if not found.
 */
export function toggleHackathonSaved(hackathonId: string): boolean | null {
  const current = findHackathonById(hackathonId);
  if (!current) return null;
  return toggleBookmark(hackathonId);
}

/**
 * Converts a hackathon into an actionable preparation & registration task in the daily schedule.
 * @param hackathonId ID of hackathon.
 * @returns Created Task record or null if hackathon not found.
 */
export function convertHackathonToTask(hackathonId: string): Task | null {
  const hack = findHackathonById(hackathonId);
  if (!hack) return null;

  const taskId = crypto.randomUUID();
  const taskTitle = `Register & Team Formation: ${hack.title}`;
  const now = new Date().toISOString();
  const conductionStr =
    hack.startDate === hack.endDate ? hack.startDate : `${hack.startDate} → ${hack.endDate}`;

  const newTask: Task = {
    id: taskId,
    title: taskTitle,
    description: `Conduction Dates: ${conductionStr}. Venue: ${hack.venue}. Mode: ${hack.mode}. Portal: ${hack.url}. Prize: ${hack.prizePool ?? "N/A"}.`,
    category: "coding",
    status: "pending",
    priority: "high",
    estimatedMinutes: 45,
    deadline: `${hack.registrationDeadline}T23:59:00.000Z`,
    createdAt: now,
    updatedAt: now,
  };

  insertTask(newTask);
  return newTask;
}

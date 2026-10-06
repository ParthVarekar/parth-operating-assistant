import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { findPendingTasks, insertTask } from "../db/repositories/taskRepository.js";
import { registerSubmission } from "./submissionService.js";
import type { Task } from "../types/index.js";

export interface ClassroomAssignment {
  id: string;
  title: string;
  courseName?: string;
  description?: string;
  dueDate?: string;
  url?: string;
  isPrintable: boolean;
}

/**
 * Parses raw iCalendar (.ics) format into structured Classroom assignments.
 * RFC 5545 compliant parser handling line unfolding and standard date formats.
 * @param icsText Raw .ics string.
 * @returns Array of parsed ClassroomAssignment objects.
 */
export function parseIcsFeed(icsText: string): ClassroomAssignment[] {
  // Step 1: Unfold lines (RFC 5545 specifies lines starting with space/tab are continuations)
  const unfolded = icsText.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  const assignments: ClassroomAssignment[] = [];
  let inEvent = false;
  let currentEvent: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      currentEvent = {};
      continue;
    }

    if (line === "END:VEVENT") {
      inEvent = false;
      const summary = currentEvent["SUMMARY"] || "Untitled Assignment";
      const description = currentEvent["DESCRIPTION"] || "";
      const uid = currentEvent["UID"] || crypto.randomUUID();
      const dtEnd = currentEvent["DTEND"] || currentEvent["DTSTART"];

      let isoDueDate: string | undefined;
      if (dtEnd) {
        // Formats: YYYYMMDDTHHMMSSZ or YYYYMMDD
        const match = dtEnd.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?/);
        if (match) {
          const [, y, m, d, hh = "23", mm = "59", ss = "00"] = match;
          isoDueDate = new Date(Date.UTC(+y!, +m! - 1, +d!, +hh, +mm, +ss)).toISOString();
        }
      }

      // Extract course name if formatted like "Assignment Name (Course Name)" or "[Course] Assignment"
      let title = summary;
      let courseName = "College Course";
      const parenMatch = summary.match(/^(.*?)\s*\((.*?)\)$/);
      if (parenMatch && parenMatch[1] && parenMatch[2]) {
        title = parenMatch[1].trim();
        courseName = parenMatch[2].trim();
      } else {
        const bracketMatch = summary.match(/^\[(.*?)\]\s*(.*)$/);
        if (bracketMatch && bracketMatch[1] && bracketMatch[2]) {
          courseName = bracketMatch[1].trim();
          title = bracketMatch[2].trim();
        }
      }

      // Check if it requires printing or physical submission
      const combined = `${summary} ${description}`.toLowerCase();
      const isPrintable =
        combined.includes("print") ||
        combined.includes("handwritten") ||
        combined.includes("hard copy") ||
        combined.includes("lab manual") ||
        combined.includes("lab record") ||
        combined.includes("write ") ||
        combined.includes("pages") ||
        combined.includes("sheet");

      // Extract URL if present
      const urlMatch = description.match(/https?:\/\/[^\s]+/);
      const url = currentEvent["URL"] || (urlMatch ? urlMatch[0] : undefined);

      assignments.push({
        id: `gc-${uid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)}`,
        title,
        courseName,
        description,
        dueDate: isoDueDate,
        url,
        isPrintable,
      });
      continue;
    }

    if (inEvent) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).split(";")[0]?.toUpperCase() ?? "";
        const val = line.slice(colonIdx + 1);
        currentEvent[key] = val;
      }
    }
  }

  return assignments;
}

/**
 * Fetches assignments from an iCal URL or stored feed URL.
 */
export async function fetchAssignmentsFromFeed(feedUrl: string): Promise<ClassroomAssignment[]> {
  const res = await fetch(feedUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch iCal feed: HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseIcsFeed(text);
}

/**
 * Synchronizes Google Classroom assignments from configured feeds into tasks and submissions pipeline.
 * @param customUrl Optional specific feed URL to sync.
 */
export async function syncClassroomAssignments(customUrl?: string): Promise<{
  syncedTasksCount: number;
  newSubmissionsCount: number;
  assignments: ClassroomAssignment[];
}> {
  const urlToUse = customUrl ?? getUserProfile<string>("classroom_feed_url") ?? process.env.CLASSROOM_FEED_URL;
  if (!urlToUse) {
    throw new Error("No Google Classroom feed URL configured.");
  }

  // Save active feed URL if new
  if (customUrl) {
    setUserProfile("classroom_feed_url", customUrl);
  }

  const assignments = await fetchAssignmentsFromFeed(urlToUse);
  const existingTasks = findPendingTasks();

  let synced = 0;
  let newSubmissions = 0;

  for (const a of assignments) {
    const existing = existingTasks.find((t) => t.id === a.id || t.title.toLowerCase() === a.title.toLowerCase());

    if (!existing) {
      const newTask: Task = {
        id: a.id,
        title: a.courseName ? `[${a.courseName}] ${a.title}` : a.title,
        description: a.description || `Imported from Google Classroom (${a.courseName ?? "College"})`,
        category: a.isPrintable ? "submission" : "assignment",
        status: "pending",
        priority: a.dueDate ? "high" : "medium",
        estimatedMinutes: 60,
        deadline: a.dueDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      insertTask(newTask);
      synced++;

      if (a.isPrintable) {
        registerSubmission(a.id, a.courseName ?? "Engineering", a.dueDate, true);
        newSubmissions++;
      }
    }
  }

  setUserProfile("classroom_last_synced_at", new Date().toISOString());

  return {
    syncedTasksCount: synced,
    newSubmissionsCount: newSubmissions,
    assignments,
  };
}

/**
 * Generates a status digest for Google Classroom in Telegram.
 */
export async function formatClassroomStatusDigest(): Promise<string> {
  const feedUrl = getUserProfile<string>("classroom_feed_url") ?? process.env.CLASSROOM_FEED_URL;
  const lastSync = getUserProfile<string>("classroom_last_synced_at");

  if (!feedUrl) {
    return (
      `🎓 *Google Classroom: Not Connected*\n\n` +
      `You can sync your assignments with *zero developer setup* using your calendar feed:\n\n` +
      `1️⃣ Open [Google Calendar](https://calendar.google.com) on your computer.\n` +
      `2️⃣ On the left sidebar under *My calendars* or *Other calendars*, find your Classroom course.\n` +
      `3️⃣ Click the 3 dots (⋮) ➔ *Settings and sharing*.\n` +
      `4️⃣ Scroll to *Integrate calendar* and copy the **Secret address in iCal format**.\n` +
      `5️⃣ Send it to this bot by replying with:\n` +
      `\`/classroom_feed <paste_url_here>\``
    );
  }

  const syncTimeStr = lastSync ? new Date(lastSync).toLocaleTimeString("en-IN") : "Never";

  return (
    `🎓 *Google Classroom Connected* ✅\n\n` +
    `🔗 *Active Feed:* Connected\n` +
    `⏱️ *Last Synced:* ${syncTimeStr}\n\n` +
    `Tap *Sync Now* below to pull new coursework and update your evening operating schedule.`
  );
}

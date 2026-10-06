import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { insertTask } from "../db/repositories/taskRepository.js";

export interface CollegeEmailCircular {
  id: string;
  sender: string;
  subject: string;
  receivedAt: string;
  isUrgent: boolean;
  category: "exam" | "submission" | "admin" | "timetable" | "fee" | "general";
  snippet: string;
  inferredDeadline?: string;
  taskCreatedId?: string;
}

const URGENT_CIRCULAR_KEYWORDS = [
  "exam form",
  "hall ticket",
  "internal assessment",
  "ia-1",
  "ia-2",
  "unit test",
  "practical exam",
  "viva voce",
  "revaluation",
  "photocopy",
  "fee payment",
  "defaulter list",
  "mumbai university circular",
  "convocation",
  "kt exam",
];

let emailNoticeListeners: Array<(circular: CollegeEmailCircular) => Promise<void>> = [];

/**
 * Gets configured college student email.
 */
export function getCollegeEmailAddress(): string {
  const custom = getUserProfile<string>("college_email_address");
  if (custom && typeof custom === "string" && custom.trim().length > 0) {
    return custom.trim();
  }
  return "ce24.parth.varekar@kccemsr.edu.in";
}

/**
 * Sets custom college student email.
 */
export function setCollegeEmailAddress(email: string): void {
  setUserProfile("college_email_address", email.trim());
}

/**
 * Registers an event listener when an urgent college email circular is captured.
 */
export function onCollegeEmailNotice(
  listener: (circular: CollegeEmailCircular) => Promise<void>
): void {
  emailNoticeListeners.push(listener);
}

/**
 * Analyzes and ingests an incoming college email.
 */
export async function ingestCollegeEmail(
  sender: string,
  subject: string,
  body: string,
  receivedAt?: string
): Promise<CollegeEmailCircular | null> {
  const combined = `${subject} ${body}`.toLowerCase();
  const isUrgent = URGENT_CIRCULAR_KEYWORDS.some((kw) => combined.includes(kw));

  let category: CollegeEmailCircular["category"] = "general";
  if (combined.includes("exam") || combined.includes("hall ticket") || combined.includes("kt")) {
    category = "exam";
  } else if (combined.includes("submission") || combined.includes("journal") || combined.includes("practical")) {
    category = "submission";
  } else if (combined.includes("timetable") || combined.includes("schedule")) {
    category = "timetable";
  } else if (combined.includes("fee") || combined.includes("payment")) {
    category = "fee";
  } else if (combined.includes("circular") || combined.includes("notice")) {
    category = "admin";
  }

  // Check deadline inference (e.g., "before 15th October", "by 20-10-2026")
  let inferredDeadline: string | undefined;
  const dateMatch = combined.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dateMatch) {
    inferredDeadline = `${dateMatch[3]}-${dateMatch[2]?.padStart(2, "0")}-${dateMatch[1]?.padStart(2, "0")}`;
  }

  let taskCreatedId: string | undefined;
  if (isUrgent || category === "exam" || category === "submission") {
    const today = new Date().toISOString().slice(0, 10);
    const taskId = crypto.randomUUID();
    const task = insertTask({
      id: taskId,
      title: `College: ${subject.slice(0, 50)}`,
      description: `Official administrative notice from ${sender}. ${body.slice(0, 200)}`,
      category: "admin",
      status: "pending",
      priority: isUrgent ? "urgent" : "high",
      estimatedMinutes: 30,
      deadline: inferredDeadline ? `${inferredDeadline}T23:59:00Z` : `${today}T23:59:00Z`,
    });
    taskCreatedId = task.id;
  }

  const circular: CollegeEmailCircular = {
    id: crypto.randomUUID(),
    sender,
    subject,
    receivedAt: receivedAt || new Date().toISOString(),
    isUrgent,
    category,
    snippet: body.length > 140 ? `${body.slice(0, 140)}...` : body,
    inferredDeadline,
    taskCreatedId,
  };

  const existing = getUserProfile<CollegeEmailCircular[]>("college_recent_emails") ?? [];
  const updated = [circular, ...existing.slice(0, 19)];
  setUserProfile("college_recent_emails", updated);

  // Broadcast to Telegram alert listeners
  for (const listener of emailNoticeListeners) {
    try {
      await listener(circular);
    } catch (err) {
      console.error("Error in college email notice listener:", err);
    }
  }

  return circular;
}

/**
 * Formats a clean Telegram markdown digest of the college email monitor.
 */
export function formatCollegeEmailStatusDigest(): string {
  const email = getCollegeEmailAddress();
  const recent = getUserProfile<CollegeEmailCircular[]>("college_recent_emails") ?? [];

  const lines: string[] = [
    `📬 *KCCEMSR College Email & Circular Monitor*\n`,
    `🎓 *Monitored Inbox:* \`${email}\``,
    `🟢 *Status:* Active & Monitoring for Official MU Circulars`,
  ];

  lines.push(`\n🔍 *High-Priority Keywords:*`);
  lines.push(`\`exam form\`, \`hall ticket\`, \`internal assessment\`, \`viva\`, \`fee\`, \`defaulter\``);

  if (recent.length > 0) {
    lines.push(`\n📑 *Recent Official Circulars (${recent.length}):*`);
    for (let i = 0; i < Math.min(recent.length, 3); i++) {
      const c = recent[i]!;
      const dateStr = new Date(c.receivedAt).toLocaleDateString("en-IN");
      const badge = c.isUrgent ? "🚨 *[URGENT]*" : "📌";
      lines.push(`${i + 1}. ${badge} *${c.subject}* (${dateStr})`);
      lines.push(`   Sender: _${c.sender}_`);
      lines.push(`   "${c.snippet}"`);
      if (c.taskCreatedId) {
        lines.push(`   👉 Registered action item in operating queue!`);
      }
    }
  } else {
    lines.push(`\n✨ *No urgent circulars in inbox.* All exam & fee obligations are clear.`);
  }

  return lines.join("\n");
}

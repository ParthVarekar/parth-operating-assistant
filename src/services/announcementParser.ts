import { generateCompletion } from "../agent/modelClient.js";
import { insertTask } from "../db/repositories/taskRepository.js";
import { registerSubmission } from "./submissionService.js";
import type { Task } from "../types/index.js";

export interface ExtractedCollegeTask {
  subject: string;
  title: string;
  description: string;
  isPhysicalSubmission: boolean;
  requiresPrint: boolean;
  requiresHandwritten: boolean;
  materialsNeeded: string;
  estimatedMinutes: number;
  inferredDeadlineDays: number;
}

const SYSTEM_ANNOUNCEMENT_PARSER_PROMPT = `
You are an expert academic assistant for an Indian engineering student (Computer Engineering).
College professors frequently post unorganized announcements, notices, and messages on Google Classroom or WhatsApp without explicit deadline fields.

Analyze the professor's announcement and extract all actionable academic tasks.
For each task, output a JSON object in an array matching this schema:
[
  {
    "subject": string (e.g. "AOA", "OS", "DWM", "AISC", "CN", "Microprocessors", "OE"),
    "title": string (actionable title, e.g. "Write Lab Experiment 4: Paging", "Module 2 Question Bank Solutions"),
    "description": string (clear summary of what professor expects),
    "isPhysicalSubmission": boolean (true if requires lab journal, hard copy, submission in practical turn),
    "requiresPrint": boolean (true if mentions printout, code print, screenshots),
    "requiresHandwritten": boolean (true if mentions handwritten, write in journal, A4 sheets),
    "materialsNeeded": string (e.g. "Lab Journal, A4 Sheets, Code Printouts"),
    "estimatedMinutes": number (realistic engineering estimate, e.g. 45-90),
    "inferredDeadlineDays": number (if mentions next week/practical turn, infer 5-7 days; if mentions day like Friday, infer days until Friday; default 5)
  }
]

Only output a valid JSON array. If no actionable task is found, output [].
`;

/**
 * Parses unstructured professor announcements/notices using LLM with deterministic heuristics fallback.
 * @param announcementText Raw text from Google Classroom stream or WhatsApp notice.
 * @returns Array of extracted actionable tasks.
 */
export async function parseProfessorAnnouncement(
  announcementText: string
): Promise<ExtractedCollegeTask[]> {
  try {
    const rawJson = await generateCompletion({
      systemPrompt: SYSTEM_ANNOUNCEMENT_PARSER_PROMPT,
      userPrompt: announcementText,
      responseFormat: "json_object",
    });

    const parsed = JSON.parse(rawJson);
    const tasksArray: ExtractedCollegeTask[] = Array.isArray(parsed)
      ? parsed
      : parsed.tasks || parsed.assignments || [];

    if (tasksArray.length > 0) {
      return tasksArray;
    }
  } catch (err) {
    console.warn("LLM announcement parser fallback to heuristic:", err);
  }

  // Heuristic Fallback
  const lower = announcementText.toLowerCase();
  const isPhysical =
    lower.includes("handwritten") ||
    lower.includes("print") ||
    lower.includes("journal") ||
    lower.includes("submission") ||
    lower.includes("hard copy") ||
    lower.includes("write");

  // Subject detection heuristic
  let subject = "Engineering";
  if (lower.includes("aoa") || lower.includes("algorithm")) subject = "AOA";
  else if (lower.includes("os") || lower.includes("operating system")) subject = "Operating Systems";
  else if (lower.includes("dwm") || lower.includes("data warehouse") || lower.includes("mining")) subject = "DWM";
  else if (lower.includes("aisc") || lower.includes("soft computing")) subject = "AISC";
  else if (lower.includes("cn") || lower.includes("network")) subject = "Computer Networks";
  else if (lower.includes("microprocessor")) subject = "Microprocessors";

  return [
    {
      subject,
      title: `Coursework: ${announcementText.slice(0, 50).trim()}...`,
      description: announcementText,
      isPhysicalSubmission: isPhysical,
      requiresPrint:
        lower.includes("print") ||
        lower.includes("hard copy") ||
        lower.includes("screenshot") ||
        lower.includes("output"),
      requiresHandwritten: lower.includes("handwritten") || lower.includes("journal") || lower.includes("write"),
      materialsNeeded: isPhysical ? "Journal / Printouts" : "Digital Document",
      estimatedMinutes: 60,
      inferredDeadlineDays: 5,
    },
  ];
}

/**
 * Ingests a professor's announcement, parses it, and adds all extracted tasks
 * directly into the assistant's tasks database and 8-stage physical submission pipeline.
 * @param announcementText Raw announcement text.
 * @returns Array of created tasks.
 */
export async function ingestProfessorAnnouncement(
  announcementText: string
): Promise<{ tasksCreated: Task[]; physicalSubmissionsCount: number }> {
  const extracted = await parseProfessorAnnouncement(announcementText);
  const tasksCreated: Task[] = [];
  let physicalCount = 0;

  for (const item of extracted) {
    const taskId = crypto.randomUUID();
    const deadlineDate = new Date();
    deadlineDate.setDate(deadlineDate.getDate() + (item.inferredDeadlineDays || 5));
    deadlineDate.setHours(23, 59, 0, 0);
    const deadlineIso = deadlineDate.toISOString();

    const newTask: Task = {
      id: taskId,
      title: `[${item.subject}] ${item.title}`,
      description: item.description,
      category: item.isPhysicalSubmission ? "submission" : "assignment",
      status: "pending",
      priority: "high",
      estimatedMinutes: item.estimatedMinutes || 60,
      deadline: deadlineIso,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    insertTask(newTask);
    tasksCreated.push(newTask);

    if (item.isPhysicalSubmission) {
      registerSubmission(taskId, item.subject, deadlineIso, item.requiresPrint);
      physicalCount++;
    }
  }

  return { tasksCreated, physicalSubmissionsCount: physicalCount };
}

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
  const normalizedForMatching = announcementText.replace(/[_.\-\/]/g, " ");
  const lowerNormalized = normalizedForMatching.toLowerCase();

  // 1. Immediately reject commercial deals, shopping, coupons, and sales
  const isCommercial =
    lower.includes("amazon.") ||
    lower.includes("flipkart.") ||
    lower.includes("bitli.in") ||
    lower.includes("fktr.in") ||
    lower.includes("coupon") ||
    lower.includes("discount") ||
    lower.includes("sale") ||
    lower.includes("price :") ||
    lower.includes("reg price") ||
    lower.includes("buy qnty") ||
    lower.includes("cashback") ||
    lower.includes("off -");

  if (isCommercial) {
    return [];
  }

  // 2. Strict Academic / Coursework check
  const hasAcademicCourseworkIndicators =
    lowerNormalized.includes("assignment") ||
    lowerNormalized.includes("submission") ||
    lowerNormalized.includes("journal") ||
    lowerNormalized.includes("experiment") ||
    lowerNormalized.includes("lab manual") ||
    lowerNormalized.includes("practical turn") ||
    lowerNormalized.includes("practical") ||
    lowerNormalized.includes("writeup") ||
    lowerNormalized.includes("black book") ||
    lowerNormalized.includes("synopsis") ||
    lowerNormalized.includes("question bank") ||
    lowerNormalized.includes("qb") ||
    lowerNormalized.includes("solution") ||
    lowerNormalized.includes("exam ready") ||
    lowerNormalized.includes("exam") ||
    lowerNormalized.includes("defaulter") ||
    lowerNormalized.includes("unit test") ||
    lowerNormalized.includes("ia1") ||
    lowerNormalized.includes("ia2") ||
    lowerNormalized.includes("viva") ||
    lowerNormalized.includes("due date") ||
    lowerNormalized.includes("submit by") ||
    lowerNormalized.includes("submit before");

  if (!hasAcademicCourseworkIndicators) {
    return [];
  }

  const isPhysical =
    lower.includes("handwritten") ||
    lower.includes("print") ||
    lower.includes("journal") ||
    lower.includes("submission") ||
    lower.includes("hard copy");

  // Subject detection using strict word boundaries over normalized text
  let subject = "Engineering";
  if (/\b(aoa|algorithms?)\b/i.test(normalizedForMatching)) subject = "AOA";
  else if (/\b(os|operating\s+systems?)\b/i.test(normalizedForMatching)) subject = "Operating Systems";
  else if (/\b(dwm|data\s+warehouse|data\s+mining)\b/i.test(normalizedForMatching)) subject = "DWM";
  else if (/\b(aisc|soft\s+computing|artificial\s+intelligence)\b/i.test(normalizedForMatching)) subject = "AISC";
  else if (/\b(cn|computer\s+networks?|networking)\b/i.test(normalizedForMatching)) subject = "Computer Networks";
  else if (/\b(wireless|mobile\s+communication|wmc)\b/i.test(normalizedForMatching)) subject = "Wireless & Mobile Communication";
  else if (/\b(microprocessors?|mp)\b/i.test(normalizedForMatching)) subject = "Microprocessors";
  else if (/\b(dbms|database)\b/i.test(normalizedForMatching)) subject = "Database Systems";
  else if (/\b(cloud|cloud\s+computing)\b/i.test(normalizedForMatching)) subject = "Cloud Computing";

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

import { generateCompletion } from "./modelClient.js";
import type { TaskCategory } from "../types/index.js";

const DECOMPOSITION_PROMPT = `
You are a cognitive friction reducer for a procrastinating engineering student.
Break down the provided daunting task into 3 to 5 micro-steps of 15-20 minutes each.
CRITICAL RULE: Step 1 MUST be an ultra-low-friction activation step taking less than 3 minutes (e.g., "Open document and read prompt", "Create repo and write one function skeleton").
Respond with a JSON array of strings: ["Step 1", "Step 2", ...]
`;

const DEFAULT_DECOMPOSITIONS: Record<TaskCategory, string[]> = {
  assignment: [
    "Open assignment PDF and read Question 1 only (3m activation)",
    "Draft Question 1 & 2 answers (20m)",
    "Draft Question 3 & diagrams (20m)",
    "Proofread and export PDF for print (15m)",
  ],
  coding: [
    "Open IDE, create branch, and review requirements (3m activation)",
    "Implement core interface/function signature (20m)",
    "Write primary logic and test basic case (20m)",
    "Refactor and run tests (15m)",
  ],
  submission: [
    "Locate lab record / assignment sheets (3m activation)",
    "Write first two pages of handwritten entry (20m)",
    "Complete remaining pages and staple (20m)",
    "Pack in college bag immediately (5m)",
  ],
  admin: [
    "Open email/portal and locate form (2m activation)",
    "Fill required details and attach documents (15m)",
    "Submit and confirm receipt (5m)",
  ],
  study: [
    "Open textbook/slides to target chapter heading (2m activation)",
    "Read first section and take 3 bullet notes (20m)",
    "Work through 1 sample problem (20m)",
  ],
  fitness: [
    "Drink water, eat pre-workout snack, put on gym shoes (5m activation)",
    "Head to gym and complete warm-up (15m)",
  ],
  misc: [
    "Define the single smallest immediate physical action (2m activation)",
    "Work on first segment for 15 minutes",
  ],
};

/**
 * Decomposes a monolithic task into small, low-friction micro-actions.
 * @param title Task title.
 * @param category Task category.
 * @returns Array of micro-step strings with Step 1 as the activation trigger.
 */
export async function decomposeMonolith(title: string, category: TaskCategory): Promise<string[]> {
  try {
    const raw = await generateCompletion({
      systemPrompt: DECOMPOSITION_PROMPT,
      userPrompt: `Task: "${title}" (Category: ${category})`,
      responseFormat: "json_object",
    });

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((s) => String(s));
    }
    if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
      return parsed.steps.map((s: unknown) => String(s));
    }
  } catch {
    // Graceful fallback to category template
  }

  return DEFAULT_DECOMPOSITIONS[category] ?? DEFAULT_DECOMPOSITIONS.misc;
}

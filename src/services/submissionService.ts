import {
  findActiveSubmissions,
  findSubmissionById,
  findSubmissionByTaskId,
  insertSubmission,
  updateSubmissionStage,
} from "../db/repositories/submissionRepository.js";
import type { Submission, SubmissionStage } from "../types/index.js";

const VALID_STAGE_TRANSITIONS: Record<SubmissionStage, SubmissionStage[]> = {
  discovered: ["decomposed", "in_progress"],
  decomposed: ["in_progress"],
  in_progress: ["digital_done", "needs_printing"],
  digital_done: ["needs_printing", "printed_physical", "submitted"],
  needs_printing: ["printed_physical"],
  printed_physical: ["packed_in_bag"],
  packed_in_bag: ["submitted"],
  submitted: [],
};

/**
 * Registers a new academic or college submission linked to a task.
 * @param taskId Primary task ID.
 * @param subject Subject / Course name.
 * @param hardDeadline Final submission deadline string.
 * @param isPrintable Whether physical printing is required.
 * @param materials Needed materials (e.g. "Record book, graph paper").
 * @returns Created Submission record.
 */
export function registerSubmission(
  taskId: string,
  subject: string,
  hardDeadline?: string,
  isPrintable = true,
  materials?: string
): Submission {
  const initialStage: SubmissionStage = "discovered";
  return insertSubmission({
    id: crypto.randomUUID(),
    taskId,
    subject,
    stage: initialStage,
    hardDeadline,
    materialsNeeded: materials ?? (isPrintable ? "Physical printout / signed pages" : undefined),
    notes: isPrintable ? "Requires campus print shop or home printing" : undefined,
  });
}

/**
 * Transitions a submission to a next pipeline stage with validation.
 * @param submissionId Submission ID.
 * @param targetStage Destination stage.
 * @returns Updated submission or error.
 */
export function advanceStage(submissionId: string, targetStage: SubmissionStage): Submission {
  const activeList = findActiveSubmissions();
  const current = activeList.find((s) => s.id === submissionId);

  if (!current) {
    throw new Error(`Submission ${submissionId} not found or already submitted`);
  }

  const allowedTransitions = VALID_STAGE_TRANSITIONS[current.stage];
  if (!allowedTransitions.includes(targetStage)) {
    throw new Error(
      `Invalid transition from "${current.stage}" to "${targetStage}". Allowed: ${allowedTransitions.join(", ")}`
    );
  }

  updateSubmissionStage(submissionId, targetStage);
  return {
    ...current,
    stage: targetStage,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Identifies submissions requiring physical action (printing or packing).
 * @returns Object categorizing pending physical steps.
 */
export function inspectPhysicalSubmissionRequirements(): {
  needsPrinting: Submission[];
  needsPacking: Submission[];
} {
  const allActive = findActiveSubmissions();
  return {
    needsPrinting: allActive.filter((s) => s.stage === "needs_printing"),
    needsPacking: allActive.filter((s) => s.stage === "printed_physical"),
  };
}

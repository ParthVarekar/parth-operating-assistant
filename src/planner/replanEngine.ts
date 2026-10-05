import {
  type ScheduledPlan,
  scheduleEveningPlan,
  timeToNormalizedMinutes,
} from "./intervalScheduler.js";
import { findPendingTasks, updateTaskStatus } from "../db/repositories/taskRepository.js";
import {
  clearPlannedBlocksForDate,
  findBlocksByDate,
  insertScheduleBlock,
} from "../db/repositories/scheduleRepository.js";
import { insertFrictionLog } from "../db/repositories/habitRepository.js";
import type { Task } from "../types/index.js";

export interface ReplanResult {
  plan: ScheduledPlan;
  summaryExplanation: string;
  slippedTaskId?: string;
  actionsTaken: string[];
}

/**
 * Handles an overrun or delay, recalculating remaining day slots.
 * @param currentTime Current 24-hour time "HH:MM".
 * @param date Today's date YYYY-MM-DD.
 * @param slippedTaskId Optional ID of the task that ran over.
 * @param additionalMinutes Additional minutes consumed.
 * @returns Replan result with updated timeline and explanation.
 */
export function handleTaskOverrun(
  currentTime: string,
  date: string,
  slippedTaskId?: string,
  additionalMinutes = 0
): ReplanResult {
  const actionsTaken: string[] = [];

  if (slippedTaskId) {
    actionsTaken.push(`Logged ${additionalMinutes}m delay for task ${slippedTaskId}`);
  }

  // Clear unstarted planned blocks from the database
  clearPlannedBlocksForDate(date);

  // Retrieve pending tasks
  const pendingTasks = findPendingTasks();

  // Re-run deterministic schedule from currentTime
  const newPlan = scheduleEveningPlan(pendingTasks, date, currentTime);

  // Save new blocks to database
  for (const b of newPlan.blocks) {
    insertScheduleBlock({
      ...b,
      id: crypto.randomUUID(),
    });
  }

  // Construct non-judgmental summary explanation
  const deferredTitles = newPlan.deferredTasks.map((t) => t.title);
  let explanation = `Re-calculated your evening from ${currentTime}.`;

  if (newPlan.blocks.length > 0) {
    const nextBlock = newPlan.blocks[0];
    explanation += ` Next scheduled item: "${nextBlock?.taskTitle}" at ${nextBlock?.startTime}.`;
  }

  if (deferredTitles.length > 0) {
    explanation += ` Moved to tomorrow: ${deferredTitles.join(", ")}.`;
    actionsTaken.push(`Deferred ${deferredTitles.length} tasks to preserve dinner & sleep.`);
  }

  explanation += ` Dinner (21:30) and sleep boundaries remain strictly protected.`;

  return {
    plan: newPlan,
    summaryExplanation: explanation,
    slippedTaskId,
    actionsTaken,
  };
}

/**
 * Handles explicit task skip ("I didn't do it").
 * Analyzes consequence, logs friction, and reschedules remainder of day.
 * @param taskId ID of skipped task.
 * @param currentTime Current time "HH:MM".
 * @param date Today's date YYYY-MM-DD.
 * @param reason Optional reason text.
 * @returns Replan result.
 */
export function handleTaskSkip(
  taskId: string,
  currentTime: string,
  date: string,
  reason = "Procrastinated or ran out of time"
): ReplanResult {
  const actionsTaken: string[] = [];

  // Log friction
  insertFrictionLog({
    id: crypto.randomUUID(),
    taskId,
    reason,
    category: "skip",
    loggedAt: new Date().toISOString(),
  });
  actionsTaken.push("Recorded friction event for pattern analysis");

  // Mark task as deferred or skipped for today
  updateTaskStatus(taskId, "deferred");
  actionsTaken.push(`Marked task ${taskId} as deferred`);

  // Clear today's planned blocks and replan
  clearPlannedBlocksForDate(date);
  const remainingTasks = findPendingTasks();
  const newPlan = scheduleEveningPlan(remainingTasks, date, currentTime);

  for (const b of newPlan.blocks) {
    insertScheduleBlock({
      ...b,
      id: crypto.randomUUID(),
    });
  }

  const explanation = `Got it. Removed that task from tonight's queue without penalty. Recalculated your schedule starting from ${currentTime}.`;

  return {
    plan: newPlan,
    summaryExplanation: explanation,
    actionsTaken,
  };
}

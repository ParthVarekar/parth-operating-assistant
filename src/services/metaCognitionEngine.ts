import crypto from "node:crypto";
import {
  findCompletedTasksForDate,
  findPendingTasks,
} from "../db/repositories/taskRepository.js";
import {
  findBlocksByDate,
  clearPlannedBlocksForDate,
  insertScheduleBlock,
} from "../db/repositories/scheduleRepository.js";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import {
  recordTaskCompletionVelocity,
  getOptimismMultiplier,
} from "./learningService.js";
import {
  scheduleEveningPlan,
  timeToNormalizedMinutes,
} from "../planner/intervalScheduler.js";
import { recordMemory } from "./memoryService.js";
import { sendSegregatedDiscordEmbed } from "./discordService.js";
import { generateCompletion } from "../agent/modelClient.js";
import type { TaskCategory, Task } from "../types/index.js";

export interface VelocityAudit {
  completedTaskCount: number;
  pendingTaskCount: number;
  totalPlannedMinutes: number;
  totalActualMinutes: number;
  ratio: number;
  categoryBiases: Record<string, number>;
}

export interface BiologicalAnchorAudit {
  dinnerAnchorRespected: boolean;
  sleepAnchorRespected: boolean;
  deepWorkMinutes: number;
  violations: string[];
}

export interface TomorrowDraftSummary {
  targetDate: string;
  blocksScheduled: number;
  totalAllocatedMinutes: number;
  availableMinutes: number;
  deferredCount: number;
}

export interface DailyMetaCognitionReport {
  id: string;
  auditDate: string;
  executedAt: string;
  velocityMetrics: VelocityAudit;
  anchorAudit: BiologicalAnchorAudit;
  tomorrowDraft: TomorrowDraftSummary;
  reflectionSummary: string;
  recommendations: string[];
}

const PROFILE_KEY = "meta_cognition_reports";
const CORE_CATEGORIES: TaskCategory[] = [
  "assignment",
  "coding",
  "submission",
  "study",
  "admin",
  "fitness",
  "misc",
];

/**
 * Calculates yesterday's ISO date string (YYYY-MM-DD) relative to an anchor date.
 */
function getOffsetDate(baseDate: Date, offsetDays: number): string {
  const d = new Date(baseDate.getTime() + offsetDays * 86400000);
  return d.toISOString().split("T")[0]!;
}

/**
 * Audits task execution velocity and updates category optimism biases in the learning model.
 */
function auditVelocity(dateStr: string): VelocityAudit {
  const completed = findCompletedTasksForDate(dateStr);
  const pending = findPendingTasks();

  let plannedMins = 0;
  let actualMins = 0;

  for (const task of completed) {
    const est = task.estimatedMinutes;
    const act = task.actualMinutes ?? task.estimatedMinutes;
    plannedMins += est;
    actualMins += act;

    // Calibrate category multiplier
    recordTaskCompletionVelocity(task.category, est, act);
  }

  const categoryBiases: Record<string, number> = {};
  for (const cat of CORE_CATEGORIES) {
    categoryBiases[cat] = getOptimismMultiplier(cat);
  }

  const ratio = plannedMins > 0 ? Number((actualMins / plannedMins).toFixed(2)) : 1.0;

  return {
    completedTaskCount: completed.length,
    pendingTaskCount: pending.length,
    totalPlannedMinutes: plannedMins,
    totalActualMinutes: actualMins,
    ratio,
    categoryBiases,
  };
}

/**
 * Checks whether dinner (21:30 - 22:30) and sleep (04:30 - 10:30) anchors were preserved.
 */
function auditAnchors(dateStr: string): BiologicalAnchorAudit {
  const blocks = findBlocksByDate(dateStr);
  let dinnerViolations = 0;
  let sleepViolations = 0;
  let deepWorkMinutes = 0;
  const violations: string[] = [];

  const dinnerStart = timeToNormalizedMinutes("21:30");
  const dinnerEnd = timeToNormalizedMinutes("22:30");
  const sleepStart = timeToNormalizedMinutes("04:30");
  const sleepEnd = timeToNormalizedMinutes("10:30");

  for (const b of blocks) {
    const bStart = timeToNormalizedMinutes(b.startTime);
    const bEnd = timeToNormalizedMinutes(b.endTime);

    if (b.zoneType === "deep_work") {
      deepWorkMinutes += Math.max(0, bEnd - bStart);
    }

    // Check Dinner overlap
    if (bStart < dinnerEnd && bEnd > dinnerStart) {
      dinnerViolations++;
      violations.push(`Dinner collision: "${b.taskTitle ?? "Task"}" from ${b.startTime} to ${b.endTime}`);
    }

    // Check Sleep overlap
    if (bStart < sleepEnd && bEnd > sleepStart) {
      sleepViolations++;
      violations.push(`Sleep collision: "${b.taskTitle ?? "Task"}" from ${b.startTime} to ${b.endTime}`);
    }
  }

  return {
    dinnerAnchorRespected: dinnerViolations === 0,
    sleepAnchorRespected: sleepViolations === 0,
    deepWorkMinutes,
    violations,
  };
}

/**
 * Automatically creates tomorrow's schedule blocks using learned multipliers.
 */
function draftTomorrowSchedule(targetDate: string, pendingTasks: Task[]): TomorrowDraftSummary {
  const multipliers: Record<string, number> = {};
  for (const cat of CORE_CATEGORIES) {
    multipliers[cat] = getOptimismMultiplier(cat);
  }

  // Clear stale planned blocks
  clearPlannedBlocksForDate(targetDate);

  const plan = scheduleEveningPlan(pendingTasks, targetDate, "19:30", multipliers);

  for (const block of plan.blocks) {
    insertScheduleBlock({
      id: crypto.randomUUID(),
      date: targetDate,
      startTime: block.startTime,
      endTime: block.endTime,
      zoneType: block.zoneType,
      taskId: block.taskId,
      taskTitle: block.taskTitle,
      status: "planned",
    });
  }

  return {
    targetDate,
    blocksScheduled: plan.blocks.length,
    totalAllocatedMinutes: plan.totalAllocatedMinutes,
    availableMinutes: plan.availableMinutes,
    deferredCount: plan.deferredTasks.length,
  };
}

/**
 * Formulates tactical recommendations based on velocity ratios and anchor compliance.
 */
function formulateRecommendations(vel: VelocityAudit, anchors: BiologicalAnchorAudit): string[] {
  const recs: string[] = [];

  if (vel.ratio > 1.25) {
    recs.push(
      `Velocity drift detected (${vel.ratio}x actual vs estimated). Planning engine calibrated multipliers up.`
    );
  } else if (vel.ratio < 0.85 && vel.completedTaskCount > 0) {
    recs.push("High execution velocity today! Pacing was faster than estimated.");
  }

  if (!anchors.dinnerAnchorRespected) {
    recs.push("Dinner anchor (9:30 PM - 10:30 PM) had intrusions. Defend the buffer tomorrow.");
  }

  if (!anchors.sleepAnchorRespected) {
    recs.push("Sleep anchor (4:30 AM - 10:30 AM) had intrusions. Enforce hard wind-down at 03:30 AM.");
  }

  if (anchors.deepWorkMinutes >= 180) {
    recs.push(`Deep work powerhouse: ${Math.round(anchors.deepWorkMinutes / 60)}h of focused zone 4 execution.`);
  }

  if (recs.length === 0) {
    recs.push("Rhythm is well-balanced. Continue executing on planned schedule blocks.");
  }

  return recs;
}

/**
 * Dispatches meta-cognition debrief embed to Discord schedule planner channel.
 */
function dispatchDiscordDebrief(report: DailyMetaCognitionReport): void {
  sendSegregatedDiscordEmbed("schedule", {
    title: `🧠 Nightly Meta-Cognition & Velocity Debrief (${report.auditDate})`,
    description:
      `**Autonomous Nightly Review**\n\n` +
      `• ⚡ **Tasks Completed:** ${report.velocityMetrics.completedTaskCount} (${report.velocityMetrics.totalActualMinutes}m actual vs ${report.velocityMetrics.totalPlannedMinutes}m est)\n` +
      `• 🎯 **Velocity Ratio:** ${report.velocityMetrics.ratio}x multiplier\n` +
      `• 🍽️ **Dinner Anchor (9:30 PM):** ${report.anchorAudit.dinnerAnchorRespected ? "✅ Protected" : "⚠️ Intrusion"}\n` +
      `• 💤 **Sleep Anchor (4:30 AM):** ${report.anchorAudit.sleepAnchorRespected ? "✅ Protected" : "⚠️ Intrusion"}\n` +
      `• 📅 **Tomorrow's Schedule:** ${report.tomorrowDraft.blocksScheduled} blocks drafted (${report.tomorrowDraft.totalAllocatedMinutes}m allocated)\n\n` +
      `**Summary:**\n${report.reflectionSummary}`,
    fields: [
      {
        name: "Learned Multipliers",
        value: Object.entries(report.velocityMetrics.categoryBiases)
          .slice(0, 4)
          .map(([c, m]) => `• ${c}: ${m.toFixed(2)}x`)
          .join("\n"),
        inline: true,
      },
      {
        name: "Recommendations",
        value: report.recommendations.map((r) => `• ${r}`).join("\n"),
        inline: false,
      },
    ],
  }).catch(console.warn);
}

/**
 * Retrieves past meta-cognition reports from persistent profile storage.
 */
export function listMetaCognitionReports(): DailyMetaCognitionReport[] {
  return getUserProfile<DailyMetaCognitionReport[]>(PROFILE_KEY) || [];
}

/**
 * Retrieves the latest recorded meta-cognition reflection report.
 */
export function getLatestMetaCognitionReport(): DailyMetaCognitionReport | null {
  const reports = listMetaCognitionReports();
  return reports[0] ?? null;
}

/**
 * Executes nightly meta-cognition reflection at 04:00 AM IST (or on-demand).
 * Audits daily velocity, calibrates multipliers, consolidates episodic memory,
 * verifies biological anchors, and drafts tomorrow's schedule blocks.
 * @param specificDate Optional specific date to audit (defaults to yesterday if run in early morning).
 * @returns Fully compiled meta-cognition report.
 */
export async function runNightlyMetaCognitionReflection(
  specificDate?: string
): Promise<DailyMetaCognitionReport> {
  const now = new Date();
  const currentHour = Number(
    now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false })
  );

  // If running before 06:00 AM IST, audit yesterday's full day cycle
  const auditDate = specificDate ?? (currentHour < 6 ? getOffsetDate(now, -1) : getOffsetDate(now, 0));
  const tomorrowDate = getOffsetDate(new Date(auditDate), 1);

  // 1. Audit Velocity & Anchor Integrity
  const velocity = auditVelocity(auditDate);
  const anchors = auditAnchors(auditDate);
  const recommendations = formulateRecommendations(velocity, anchors);

  // 2. Draft Tomorrow's Schedule
  const pendingTasks = findPendingTasks();
  const tomorrowDraft = draftTomorrowSchedule(tomorrowDate, pendingTasks);

  // 3. Synthesize Reflection Summary
  let reflectionSummary =
    `Completed ${velocity.completedTaskCount} tasks on ${auditDate}. ` +
    `Overall pace was ${velocity.ratio}x estimated duration. ` +
    `Dinner anchor was ${anchors.dinnerAnchorRespected ? "honored" : "encroached"}. ` +
    `Drafted ${tomorrowDraft.blocksScheduled} schedule blocks for ${tomorrowDate}.`;

  try {
    const prompt = `You are PARTH.OS Autonomous Meta-Cognition Engine.
Analyze yesterday's performance on ${auditDate}:
- Completed tasks: ${velocity.completedTaskCount}
- Time planned: ${velocity.totalPlannedMinutes} mins, Time spent: ${velocity.totalActualMinutes} mins (Ratio: ${velocity.ratio}x)
- Deep work accumulated: ${anchors.deepWorkMinutes} mins
- Dinner anchor protected (9:30-10:30 PM): ${anchors.dinnerAnchorRespected}
- Sleep anchor protected (4:30-10:30 AM): ${anchors.sleepAnchorRespected}
- Drafted for tomorrow (${tomorrowDate}): ${tomorrowDraft.blocksScheduled} blocks, ${tomorrowDraft.totalAllocatedMinutes} mins

Write a concise 2-sentence executive reflection for Parth with actionable insights.`;

    const llmSummary = await generateCompletion({
      systemPrompt: "You are PARTH.OS Autonomous Meta-Cognition Engine.",
      userPrompt: prompt,
    });
    if (llmSummary && llmSummary.trim().length > 10) {
      reflectionSummary = llmSummary.trim();
    }
  } catch {
    // Graceful deterministic fallback
  }

  // 4. Consolidate into Episodic Long-Term Memory
  recordMemory(
    "decision",
    `Meta-Cognition Reflection (${auditDate}): Completed ${velocity.completedTaskCount} tasks. Velocity ratio: ${velocity.ratio}x. ${reflectionSummary}`,
    "autonomous_heartbeat",
    {
      importance: 4,
      title: `Reflection: ${auditDate}`,
      metadata: { auditDate, ratio: velocity.ratio, completedCount: velocity.completedTaskCount },
    }
  ).catch(console.warn);

  const report: DailyMetaCognitionReport = {
    id: crypto.randomUUID(),
    auditDate,
    executedAt: new Date().toISOString(),
    velocityMetrics: velocity,
    anchorAudit: anchors,
    tomorrowDraft,
    reflectionSummary,
    recommendations,
  };

  // 5. Persist Report & Dispatch Debrief
  const existingReports = listMetaCognitionReports();
  setUserProfile(PROFILE_KEY, [report, ...existingReports].slice(0, 30));
  dispatchDiscordDebrief(report);

  return report;
}

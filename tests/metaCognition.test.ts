import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { insertTask, updateTaskStatus } from "../src/db/repositories/taskRepository.js";
import { insertScheduleBlock, findBlocksByDate } from "../src/db/repositories/scheduleRepository.js";
import {
  runNightlyMetaCognitionReflection,
  listMetaCognitionReports,
  getLatestMetaCognitionReport,
} from "../src/services/metaCognitionEngine.js";
import { getOptimismMultiplier } from "../src/services/learningService.js";

describe("Nightly Meta-Cognition & Velocity Learning Suite", () => {
  beforeEach(() => {
    initDatabase(":memory:");
  });

  it("audits completed task velocity and calibrates category optimism multiplier", async () => {
    const today = new Date().toISOString().split("T")[0]!;

    // Create and complete tasks with an intentional estimation overrun (60m est, 90m act)
    const task1 = insertTask({
      id: "task-meta-1",
      title: "Complete DSP FFT Implementation",
      category: "coding",
      status: "pending",
      priority: "high",
      estimatedMinutes: 60,
    });

    updateTaskStatus(task1.id, "done", 90);

    const report = await runNightlyMetaCognitionReflection(today);

    expect(report.auditDate).toBe(today);
    expect(report.velocityMetrics.completedTaskCount).toBe(1);
    expect(report.velocityMetrics.totalPlannedMinutes).toBe(60);
    expect(report.velocityMetrics.totalActualMinutes).toBe(90);
    expect(report.velocityMetrics.ratio).toBe(1.5);

    // Multiplier for coding should now be calibrated upwards (> 1.0)
    const multiplier = getOptimismMultiplier("coding");
    expect(multiplier).toBeGreaterThan(1.0);
  });

  it("verifies dinner (9:30 PM) and sleep (4:30 AM) anchor integrity", async () => {
    const today = new Date().toISOString().split("T")[0]!;

    // Case 1: Healthy schedule respecting anchors
    insertScheduleBlock({
      id: "block-safe-1",
      date: today,
      startTime: "19:30",
      endTime: "21:00",
      zoneType: "trough",
      status: "completed",
    });

    const safeReport = await runNightlyMetaCognitionReflection(today);
    expect(safeReport.anchorAudit.dinnerAnchorRespected).toBe(true);
    expect(safeReport.anchorAudit.sleepAnchorRespected).toBe(true);

    // Case 2: Schedule block illegally encroaching into dinner window (21:30 - 22:30)
    insertScheduleBlock({
      id: "block-dinner-violation",
      date: today,
      startTime: "21:45",
      endTime: "22:15",
      zoneType: "deep_work",
      taskTitle: "Late coding session",
      status: "completed",
    });

    const violationReport = await runNightlyMetaCognitionReflection(today);
    expect(violationReport.anchorAudit.dinnerAnchorRespected).toBe(false);
    expect(violationReport.recommendations.some((r) => r.includes("Dinner"))).toBe(true);
  });

  it("auto-drafts non-overlapping blocks for tomorrow defending anchors", async () => {
    const today = new Date().toISOString().split("T")[0]!;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0]!;

    // Seed pending backlog
    insertTask({
      id: "task-backlog-1",
      title: "Write Computer Networks Lab 5 Journal",
      category: "submission",
      status: "pending",
      priority: "high",
      estimatedMinutes: 45,
    });

    insertTask({
      id: "task-backlog-2",
      title: "Build Agentic Dynamic Registry",
      category: "coding",
      status: "pending",
      priority: "urgent",
      estimatedMinutes: 60,
    });

    const report = await runNightlyMetaCognitionReflection(today);

    expect(report.tomorrowDraft.blocksScheduled).toBeGreaterThanOrEqual(1);

    const blocksTomorrow = findBlocksByDate(tomorrow);
    expect(blocksTomorrow.length).toBeGreaterThanOrEqual(1);

    // Verify no drafted block starts during protected dinner (21:30 to 22:30)
    for (const b of blocksTomorrow) {
      expect(b.startTime !== "21:30" && b.startTime !== "22:00").toBe(true);
    }
  });

  it("persists reflection history in profile storage", async () => {
    const today = new Date().toISOString().split("T")[0]!;
    await runNightlyMetaCognitionReflection(today);

    const history = listMetaCognitionReports();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]?.auditDate).toBe(today);

    const latest = getLatestMetaCognitionReport();
    expect(latest?.id).toBe(history[0]?.id);
  });
});

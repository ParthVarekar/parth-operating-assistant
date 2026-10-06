import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { findPendingTasks, insertTask, updateTaskStatus } from "../src/db/repositories/taskRepository.js";
import { scheduleEveningPlan, timeToNormalizedMinutes } from "../src/planner/intervalScheduler.js";
import { handleTaskOverrun, handleTaskSkip } from "../src/planner/replanEngine.js";
import { insertMeal } from "../src/db/repositories/mealRepository.js";
import {
  advanceStage,
  inspectPhysicalSubmissionRequirements,
  registerSubmission,
} from "../src/services/submissionService.js";
import {
  getOptimismMultiplier,
  recordTaskCompletionVelocity,
} from "../src/services/learningService.js";

describe("24-Hour Student Lifecycle Simulation", () => {
  const date = "2026-10-06";

  beforeAll(() => {
    initDatabase(":memory:");
  });

  it("executes the full realistic evening and night cycle without schedule breakdown", () => {
    // -------------------------------------------------------------
    // PHASE 1: 19:30 - Return from college with messy pending tasks
    // -------------------------------------------------------------
    const taskAdmin = insertTask({
      id: "task-unpack",
      title: "Unpack bag & verify tomorrow's printouts",
      category: "admin",
      status: "pending",
      priority: "high",
      estimatedMinutes: 20,
    });

    const taskQuickReview = insertTask({
      id: "task-review",
      title: "Read OS Assignment question 1",
      category: "assignment",
      status: "pending",
      priority: "medium",
      estimatedMinutes: 25,
    });

    const taskHeavyCoding = insertTask({
      id: "task-os-code",
      title: "Implement OS Page Replacement Algorithm",
      category: "coding",
      status: "pending",
      priority: "urgent",
      estimatedMinutes: 90,
      deadline: "2026-10-07T10:00:00Z",
    });

    const sub = registerSubmission(
      taskHeavyCoding.id,
      "Operating Systems",
      "2026-10-07T10:00:00Z",
      true,
      "Printed code + output charts"
    );

    // Initial Plan computed at 19:30
    const initialPlan = scheduleEveningPlan(findPendingTasks(), date, "19:30");

    // Must have scheduled blocks
    expect(initialPlan.blocks.length).toBeGreaterThanOrEqual(2);

    // Verify Zone 2 (Trough) received the light tasks before dinner at 21:30
    const troughBlocks = initialPlan.blocks.filter((b) => b.zoneType === "trough");
    for (const block of troughBlocks) {
      const endMins = timeToNormalizedMinutes(block.endTime);
      expect(endMins).toBeLessThanOrEqual(timeToNormalizedMinutes("21:30"));
    }

    // -------------------------------------------------------------
    // PHASE 2: 20:15 - Procrastination & Phone Scrolling Slippage
    // The student scrolled reels until 20:15 without finishing task 1!
    // -------------------------------------------------------------
    const replanTrough = handleTaskOverrun("20:15", date, taskAdmin.id, 45);

    // Verifies dinner at 21:30 is still strictly protected after slippage
    expect(replanTrough.summaryExplanation).toContain("Dinner (21:30) and sleep boundaries remain strictly protected");
    for (const block of replanTrough.plan.blocks) {
      if (block.zoneType === "trough") {
        expect(timeToNormalizedMinutes(block.endTime)).toBeLessThanOrEqual(timeToNormalizedMinutes("21:30"));
      }
    }

    // Mark admin task complete at 21:00
    updateTaskStatus(taskAdmin.id, "completed", 45);

    // -------------------------------------------------------------
    // PHASE 3: 21:30 - Dinner Anchor (Protected Nutrition)
    // -------------------------------------------------------------
    const dinnerMeal = insertMeal({
      id: "dinner-06",
      date,
      mealType: "dinner",
      scheduledTime: "21:30",
      status: "completed",
      loggedAt: "2026-10-06T21:45:00Z",
    });
    expect(dinnerMeal.status).toBe("completed");

    // -------------------------------------------------------------
    // PHASE 4: 23:00 - Deep Work Window Kickoff
    // -------------------------------------------------------------
    const deepPlan = scheduleEveningPlan(findPendingTasks(), date, "23:00");
    const deepBlocks = deepPlan.blocks.filter((b) => b.zoneType === "deep_work");
    expect(deepBlocks.length).toBeGreaterThanOrEqual(1);

    // Verify start is at or after 23:00
    expect(timeToNormalizedMinutes(deepBlocks[0]!.startTime)).toBeGreaterThanOrEqual(
      timeToNormalizedMinutes("23:00")
    );

    // -------------------------------------------------------------
    // PHASE 5: 01:30 - Deep Work Overrun & Adaptive Triage
    // OS Coding took 120 mins instead of 90 mins!
    // -------------------------------------------------------------
    recordTaskCompletionVelocity("coding", 90, 120);
    updateTaskStatus(taskHeavyCoding.id, "completed", 120);

    // Advance submission stage: digital code is complete, now needs physical printing!
    advanceStage(sub.id, "in_progress");
    advanceStage(sub.id, "digital_done");
    const subNeedsPrint = advanceStage(sub.id, "needs_printing");
    expect(subNeedsPrint.stage).toBe("needs_printing");

    // Recalculate remaining night at 01:30
    const replanNight = handleTaskOverrun("01:30", date);
    for (const block of replanNight.plan.blocks) {
      // Must not breach 04:30 sleep boundary
      expect(timeToNormalizedMinutes(block.endTime)).toBeLessThanOrEqual(timeToNormalizedMinutes("04:30"));
    }

    // -------------------------------------------------------------
    // PHASE 6: 03:30 - Wind-Down & Physical Submissions Audit
    // -------------------------------------------------------------
    const physicalAudit = inspectPhysicalSubmissionRequirements();
    expect(physicalAudit.needsPrinting.length).toBe(1);
    expect(physicalAudit.needsPrinting[0]!.subject).toBe("Operating Systems");

    // Student prints the document at desk/dorm and packs it in backpack
    advanceStage(sub.id, "printed_physical");
    const subPacked = advanceStage(sub.id, "packed_in_bag");
    expect(subPacked.stage).toBe("packed_in_bag");

    // Now physical printing requirement is resolved
    const postPackAudit = inspectPhysicalSubmissionRequirements();
    expect(postPackAudit.needsPrinting.length).toBe(0);
    expect(postPackAudit.needsPacking.length).toBe(0);

    // -------------------------------------------------------------
    // PHASE 7: Long-Term Velocity & Multiplier Verification
    // -------------------------------------------------------------
    const updatedMultiplier = getOptimismMultiplier("coding");
    // Coding took 120m vs 90m (1.33x ratio) -> Multiplier must adapt upwards!
    expect(updatedMultiplier).toBeGreaterThan(1.0);
  });
});

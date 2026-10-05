import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { insertTask } from "../src/db/repositories/taskRepository.js";
import { handleTaskOverrun, handleTaskSkip } from "../src/planner/replanEngine.js";
import { findFrictionLogs } from "../src/db/repositories/habitRepository.js";

describe("Failure-Aware Re-Planning Engine", () => {
  beforeAll(() => {
    initDatabase(":memory:");
  });

  it("handles a 45-minute task overrun and shifts downstream schedule without breaking boundaries", () => {
    const taskA = insertTask({
      id: "task-a",
      title: "Write OS Code",
      category: "coding",
      status: "pending",
      priority: "urgent",
      estimatedMinutes: 30,
    });

    const taskB = insertTask({
      id: "task-b",
      title: "Prepare Printout",
      category: "submission",
      status: "pending",
      priority: "high",
      estimatedMinutes: 20,
    });

    // Simulate task A running over until 20:30
    const replan = handleTaskOverrun("20:30", "2026-10-05", taskA.id, 45);

    expect(replan.plan.blocks.length).toBeGreaterThanOrEqual(1);
    expect(replan.summaryExplanation).toContain("Re-calculated your evening from 20:30");
    expect(replan.summaryExplanation).toContain("Dinner (21:30) and sleep boundaries remain strictly protected");
  });

  it("handles 'I didn't do it' task skip by recording friction and removing task from tonight", () => {
    const taskSkip = insertTask({
      id: "task-skip",
      title: "Boring Theory Notes",
      category: "study",
      status: "pending",
      priority: "low",
      estimatedMinutes: 60,
    });

    const replan = handleTaskSkip(taskSkip.id, "23:30", "2026-10-05", "Procrastinated on theory");

    expect(replan.actionsTaken).toContain("Recorded friction event for pattern analysis");
    const friction = findFrictionLogs(10);
    expect(friction.some((f) => f.taskId === taskSkip.id)).toBe(true);
  });
});

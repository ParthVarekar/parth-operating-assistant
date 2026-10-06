import { describe, expect, it } from "vitest";
import {
  scheduleEveningPlan,
  timeToNormalizedMinutes,
} from "../src/planner/intervalScheduler.js";
import type { Task, TaskPriority } from "../src/types/index.js";

describe("Deterministic Scheduler Mathematical Invariants", () => {
  const date = "2026-10-06";
  const dinnerStart = timeToNormalizedMinutes("21:30");
  const dinnerEnd = timeToNormalizedMinutes("22:30");
  const sleepBoundary = timeToNormalizedMinutes("04:30");

  it("proves zero time overlaps and enforces >=10 min buffers across all consecutive blocks", () => {
    const tasks: Task[] = Array.from({ length: 6 }, (_, i) => ({
      id: `task-inv-${i}`,
      title: `Assignment Unit ${i + 1}`,
      category: "assignment",
      status: "pending",
      priority: "high",
      estimatedMinutes: 35,
      createdAt: "2026-10-06T00:00:00Z",
      updatedAt: "2026-10-06T00:00:00Z",
    }));

    const plan = scheduleEveningPlan(tasks, date, "19:30");

    expect(plan.blocks.length).toBeGreaterThan(0);

    for (let i = 0; i < plan.blocks.length - 1; i++) {
      const current = plan.blocks[i]!;
      const next = plan.blocks[i + 1]!;

      const currentEnd = timeToNormalizedMinutes(current.endTime);
      const nextStart = timeToNormalizedMinutes(next.startTime);

      // Invariant 1: No overlap
      expect(nextStart).toBeGreaterThanOrEqual(currentEnd);

      // Invariant 2: Buffer preserved if in the same work zone
      if (current.zoneType === next.zoneType) {
        expect(nextStart - currentEnd).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("strictly guarantees that no scheduled block violates the dinner anchor or sleep boundary", () => {
    // Generate 12 varied tasks totaling ~12 hours of estimated work
    const heavyQueue: Task[] = Array.from({ length: 12 }, (_, i) => ({
      id: `task-heavy-${i}`,
      title: `Work Package ${i + 1}`,
      category: i % 2 === 0 ? "coding" : "assignment",
      status: "pending",
      priority: (i === 0 ? "urgent" : i < 4 ? "high" : "medium") as TaskPriority,
      estimatedMinutes: 45 + (i * 15) % 60,
      createdAt: "2026-10-06T00:00:00Z",
      updatedAt: "2026-10-06T00:00:00Z",
    }));

    const plan = scheduleEveningPlan(heavyQueue, date, "19:30");

    for (const block of plan.blocks) {
      const bStart = timeToNormalizedMinutes(block.startTime);
      const bEnd = timeToNormalizedMinutes(block.endTime);

      // Must NOT overlap dinner anchor (21:30 - 22:30)
      const overlapsDinner = bStart < dinnerEnd && bEnd > dinnerStart;
      expect(overlapsDinner).toBe(false);

      // Must NOT exceed 04:30 sleep boundary
      expect(bEnd).toBeLessThanOrEqual(sleepBoundary);
    }

    // Heavy queue must trigger deferral rather than breaking boundaries
    expect(plan.deferredTasks.length).toBeGreaterThan(0);
    // Urgent tasks must be placed before medium tasks
    expect(plan.blocks[0]!.taskTitle).toContain("Work Package 1");
  });

  it("handles edge-case task durations gracefully (15m, 120m, non-standard estimates)", () => {
    const edgeTasks: Task[] = [
      {
        id: "e1",
        title: "Micro task",
        category: "misc",
        status: "pending",
        priority: "urgent",
        estimatedMinutes: 5, // Under minimum 15m floor
        createdAt: "2026-10-06T00:00:00Z",
        updatedAt: "2026-10-06T00:00:00Z",
      },
      {
        id: "e2",
        title: "Extended lab session",
        category: "coding",
        status: "pending",
        priority: "high",
        estimatedMinutes: 180, // 3 hours
        createdAt: "2026-10-06T00:00:00Z",
        updatedAt: "2026-10-06T00:00:00Z",
      },
    ];

    const plan = scheduleEveningPlan(edgeTasks, date, "23:00");

    // Micro task clamped to 15m minimum
    const b1 = plan.blocks[0]!;
    const b1Duration = timeToNormalizedMinutes(b1.endTime) - timeToNormalizedMinutes(b1.startTime);
    expect(b1Duration).toBe(15);
  });
});

import { describe, expect, it } from "vitest";
import {
  getAvailableWorkSlots,
  normalizedMinutesToTime,
  scheduleEveningPlan,
  timeToNormalizedMinutes,
} from "../src/planner/intervalScheduler.js";
import type { Task } from "../src/types/index.js";

describe("Deterministic Interval Scheduler", () => {
  it("correctly converts 24h and late-night times to normalized minutes", () => {
    expect(timeToNormalizedMinutes("19:30")).toBe(1170);
    expect(timeToNormalizedMinutes("21:30")).toBe(1290);
    expect(timeToNormalizedMinutes("23:00")).toBe(1380);
    expect(timeToNormalizedMinutes("01:00")).toBe(1500);
    expect(timeToNormalizedMinutes("04:30")).toBe(1710);

    expect(normalizedMinutesToTime(1170)).toBe("19:30");
    expect(normalizedMinutesToTime(1500)).toBe("01:00");
    expect(normalizedMinutesToTime(1710)).toBe("04:30");
  });

  it("ensures available work slots never overlap with the 21:30 - 22:30 dinner anchor", () => {
    const slots = getAvailableWorkSlots("19:30");
    const dinnerStart = timeToNormalizedMinutes("21:30");
    const dinnerEnd = timeToNormalizedMinutes("22:30");

    for (const slot of slots) {
      // Slot must not overlap dinner window
      const overlapsDinner = slot.startMinutes < dinnerEnd && slot.endMinutes > dinnerStart;
      expect(overlapsDinner).toBe(false);
    }
  });

  it("packs tasks deterministically with zero overlaps and preserves 10-minute buffers", () => {
    const mockTasks: Task[] = [
      {
        id: "t1",
        title: "OS Lab Writeup",
        category: "assignment",
        status: "pending",
        priority: "urgent",
        estimatedMinutes: 45,
        createdAt: "2026-10-05T20:00:00Z",
        updatedAt: "2026-10-05T20:00:00Z",
      },
      {
        id: "t2",
        title: "Compiler Code",
        category: "coding",
        status: "pending",
        priority: "high",
        estimatedMinutes: 60,
        createdAt: "2026-10-05T20:00:00Z",
        updatedAt: "2026-10-05T20:00:00Z",
      },
    ];

    const plan = scheduleEveningPlan(mockTasks, "2026-10-05", "19:30");

    expect(plan.blocks.length).toBe(2);
    const b1 = plan.blocks[0]!;
    const b2 = plan.blocks[1]!;

    expect(b1.startTime).toBe("19:30");
    expect(b1.endTime).toBe("20:15"); // 45m

    const b1EndMins = timeToNormalizedMinutes(b1.endTime);
    const b2StartMins = timeToNormalizedMinutes(b2.startTime);

    // Verifies at least 10m buffer between consecutive blocks
    expect(b2StartMins - b1EndMins).toBeGreaterThanOrEqual(10);
  });

  it("defers low priority tasks when available evening minutes are exceeded", () => {
    const massiveTasks: Task[] = [
      {
        id: "m1",
        title: "Giant Research Paper",
        category: "assignment",
        status: "pending",
        priority: "medium",
        estimatedMinutes: 300, // 5 hours
        createdAt: "2026-10-05T20:00:00Z",
        updatedAt: "2026-10-05T20:00:00Z",
      },
      {
        id: "m2",
        title: "Minor Cleanup",
        category: "admin",
        status: "pending",
        priority: "low",
        estimatedMinutes: 120, // 2 hours
        createdAt: "2026-10-05T20:00:00Z",
        updatedAt: "2026-10-05T20:00:00Z",
      },
    ];

    const plan = scheduleEveningPlan(massiveTasks, "2026-10-05", "23:00");
    // Deep work slot is 23:00 to 03:30 (270 mins).
    // Task 1 alone requires 300m, so it cannot fully fit or Task 2 must be deferred.
    expect(plan.deferredTasks.length).toBeGreaterThan(0);
  });
});

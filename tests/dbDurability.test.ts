import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { existsSync, unlinkSync } from "node:fs";
import { initDatabase } from "../src/db/database.js";
import { findTaskById, insertTask, updateTaskStatus } from "../src/db/repositories/taskRepository.js";
import { findActiveSubmissions } from "../src/db/repositories/submissionRepository.js";
import { registerSubmission } from "../src/services/submissionService.js";
import { insertMeal, findMealsForDate } from "../src/db/repositories/mealRepository.js";
import { getHabitValue, setHabitValue } from "../src/db/repositories/habitRepository.js";

describe("SQLite On-Disk Durability & Reload Test", () => {
  const testDbPath = "./data/test_durability_run.db";

  beforeAll(() => {
    // Clean up if left from previous aborted run
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    initDatabase(testDbPath);
  });

  afterAll(() => {
    // Clean up test file and wal logs
    for (const file of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
      if (existsSync(file)) {
        try {
          unlinkSync(file);
        } catch {
          // Ignore Windows file lock during test runner exit
        }
      }
    }
  });

  it("persists tasks, submissions, meals, and habits across a complete database process restart", () => {
    // 1. Write entities to disk database
    const task = insertTask({
      id: "disk-task-1",
      title: "Embedded Systems Hardware Lab",
      category: "assignment",
      status: "pending",
      priority: "urgent",
      estimatedMinutes: 50,
      deadline: "2026-10-08T09:00:00Z",
    });

    const sub = registerSubmission(task.id, "Embedded Systems", task.deadline, true, "Circuit diagrams");

    insertMeal({
      id: "disk-meal-1",
      date: "2026-10-06",
      mealType: "lunch",
      scheduledTime: "14:00",
      status: "completed",
    });

    setHabitValue("test_velocity", { pagesPerHour: 1.5 }, 0.9, 12);

    // Verify written to memory/disk
    expect(findTaskById("disk-task-1")?.title).toBe("Embedded Systems Hardware Lab");
    expect(findActiveSubmissions().some((s) => s.id === sub.id)).toBe(true);

    // 2. Simulate complete restart by re-initializing connection to same disk path
    initDatabase(testDbPath);

    // 3. Verify 100% of persisted data is cleanly intact
    const reloadedTask = findTaskById("disk-task-1");
    expect(reloadedTask).not.toBeNull();
    expect(reloadedTask?.title).toBe("Embedded Systems Hardware Lab");
    expect(reloadedTask?.estimatedMinutes).toBe(50);

    const reloadedSubs = findActiveSubmissions();
    const targetSub = reloadedSubs.find((s) => s.id === sub.id);
    expect(targetSub).toBeDefined();
    expect(targetSub?.subject).toBe("Embedded Systems");
    expect(targetSub?.materialsNeeded).toBe("Circuit diagrams");

    const reloadedMeals = findMealsForDate("2026-10-06");
    expect(reloadedMeals.some((m) => m.id === "disk-meal-1")).toBe(true);

    const reloadedHabit = getHabitValue<{ pagesPerHour: number }>("test_velocity");
    expect(reloadedHabit?.pagesPerHour).toBe(1.5);

    // 4. Update task status on reloaded connection
    updateTaskStatus(task.id, "completed", 55);
    const updatedTask = findTaskById(task.id);
    expect(updatedTask?.status).toBe("completed");
    expect(updatedTask?.actualMinutes).toBe(55);
  });
});

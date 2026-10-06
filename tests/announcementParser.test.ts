import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  ingestProfessorAnnouncement,
  parseProfessorAnnouncement,
} from "../src/services/announcementParser.js";
import { findPendingTasks } from "../src/db/repositories/taskRepository.js";

const RAW_PROFESSOR_NOTICE = `
Dear students,
Please complete Experiment 4 on Paging and Segmentation in your Operating Systems lab journal.
Draw all architectural memory diagrams cleanly and attach the verified code outputs and screenshots.
Bring hard copy for submission during your scheduled practical turn next Friday.
`.trim();

describe("Professor Announcement & Deadlineless Ingestion Suite", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = ":memory:";
    process.env.AI_PROVIDER = "mock";
    initDatabase(":memory:");
  });

  it("extracts coursework, physical submission, and print requirements from unstructured professor notice", async () => {
    const tasks = await parseProfessorAnnouncement(RAW_PROFESSOR_NOTICE);
    expect(tasks.length).toBeGreaterThanOrEqual(1);

    const first = tasks[0]!;
    expect(first.isPhysicalSubmission).toBe(true);
    expect(first.requiresPrint).toBe(true);
    expect(first.requiresHandwritten).toBe(true);
    expect(first.subject).toBe("Operating Systems");
  });

  it("ingests professor announcements directly into active tasks and pipeline", async () => {
    const result = await ingestProfessorAnnouncement(RAW_PROFESSOR_NOTICE);
    expect(result.tasksCreated.length).toBeGreaterThanOrEqual(1);
    expect(result.physicalSubmissionsCount).toBeGreaterThanOrEqual(1);

    const pending = findPendingTasks();
    expect(pending.some((t) => t.category === "submission")).toBe(true);
  });
});

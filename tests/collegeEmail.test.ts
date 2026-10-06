import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { findPendingTasks } from "../src/db/repositories/taskRepository.js";
import {
  formatCollegeEmailStatusDigest,
  getCollegeEmailAddress,
  ingestCollegeEmail,
  onCollegeEmailNotice,
  setCollegeEmailAddress,
  type CollegeEmailCircular,
} from "../src/services/collegeEmailService.js";

describe("College Official Email & Circular Monitor Suite", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
  });

  it("retrieves default college student email address and allows custom update", () => {
    expect(getCollegeEmailAddress()).toBe("ce24.parth.varekar@kccemsr.edu.in");

    setCollegeEmailAddress("custom.student@kccemsr.edu.in");
    expect(getCollegeEmailAddress()).toBe("custom.student@kccemsr.edu.in");

    setCollegeEmailAddress("ce24.parth.varekar@kccemsr.edu.in");
  });

  it("identifies urgent exam circulars, extracts deadlines, and creates tasks", async () => {
    let capturedAlert: CollegeEmailCircular | null = null;
    onCollegeEmailNotice(async (c) => {
      capturedAlert = c;
    });

    const circular = await ingestCollegeEmail(
      "examcell@kccemsr.edu.in",
      "URGENT: Semester V Examination Form Filling Notice",
      "Students must submit the online exam form before 25-10-2026. Hall tickets will only be released after clearance.",
      "2026-10-06T10:00:00Z"
    );

    expect(circular).not.toBeNull();
    expect(circular?.isUrgent).toBe(true);
    expect(circular?.category).toBe("exam");
    expect(circular?.inferredDeadline).toBe("2026-10-25");
    expect(circular?.taskCreatedId).toBeDefined();

    // Verify task created in database
    const tasks = findPendingTasks();
    const task = tasks.find((t) => t.id === circular?.taskCreatedId);
    expect(task).toBeDefined();
    expect(task?.title).toContain("Semester V Examination Form");
    expect(task?.priority).toBe("urgent");
    expect(capturedAlert).not.toBeNull();
  });

  it("formats college email status digest properly", () => {
    const digest = formatCollegeEmailStatusDigest();
    expect(digest).toContain("KCCEMSR College Email & Circular Monitor");
    expect(digest).toContain("ce24.parth.varekar@kccemsr.edu.in");
    expect(digest).toContain("Recent Official Circulars");
    expect(digest).toContain("Semester V Examination Form");
  });
});

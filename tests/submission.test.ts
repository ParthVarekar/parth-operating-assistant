import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { insertTask } from "../src/db/repositories/taskRepository.js";
import {
  advanceStage,
  inspectPhysicalSubmissionRequirements,
  registerSubmission,
} from "../src/services/submissionService.js";

describe("8-Stage Physical Submission Pipeline", () => {
  beforeAll(() => {
    initDatabase(":memory:");
  });

  it("registers submission in 'discovered' stage and tracks physical print requirements", () => {
    const task = insertTask({
      id: "sub-task-1",
      title: "Microprocessors Lab Record",
      category: "submission",
      status: "pending",
      priority: "high",
      estimatedMinutes: 45,
    });

    const submission = registerSubmission(
      task.id,
      "Microprocessors",
      "2026-10-06T10:00:00Z",
      true,
      "Signed index page, printed assembly code"
    );

    expect(submission.stage).toBe("discovered");
    expect(submission.materialsNeeded).toContain("Signed index page");
  });

  it("advances sequentially through valid stages and rejects invalid jumps", () => {
    const task = insertTask({
      id: "sub-task-2",
      title: "Computer Networks Lab",
      category: "submission",
      status: "pending",
      priority: "urgent",
      estimatedMinutes: 60,
    });

    const sub = registerSubmission(task.id, "Networks", "2026-10-07T12:00:00Z", true);

    // Valid: discovered -> in_progress
    const s1 = advanceStage(sub.id, "in_progress");
    expect(s1.stage).toBe("in_progress");

    // Valid: in_progress -> needs_printing
    const s2 = advanceStage(sub.id, "needs_printing");
    expect(s2.stage).toBe("needs_printing");

    // Check physical requirement detection
    const physical = inspectPhysicalSubmissionRequirements();
    expect(physical.needsPrinting.some((p) => p.id === sub.id)).toBe(true);

    // Valid: needs_printing -> printed_physical
    const s3 = advanceStage(sub.id, "printed_physical");
    expect(s3.stage).toBe("printed_physical");

    // Valid: printed_physical -> packed_in_bag
    const s4 = advanceStage(sub.id, "packed_in_bag");
    expect(s4.stage).toBe("packed_in_bag");

    // Valid: packed_in_bag -> submitted
    const s5 = advanceStage(sub.id, "submitted");
    expect(s5.stage).toBe("submitted");

    // Invalid: submitted cannot advance further
    expect(() => advanceStage(sub.id, "in_progress")).toThrowError();
  });
});

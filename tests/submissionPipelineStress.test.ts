import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { insertTask } from "../src/db/repositories/taskRepository.js";
import {
  advanceStage,
  inspectPhysicalSubmissionRequirements,
  registerSubmission,
} from "../src/services/submissionService.js";
import type { SubmissionStage } from "../src/types/index.js";

describe("8-Stage Physical Submission Pipeline Stress & Invariants", () => {
  beforeAll(() => {
    initDatabase(":memory:");
  });

  it("handles multiple concurrent submissions across subjects without cross-contamination", () => {
    const t1 = insertTask({
      id: "sub-stress-1",
      title: "Microprocessors Assembly Record",
      category: "submission",
      status: "pending",
      priority: "urgent",
      estimatedMinutes: 60,
    });

    const t2 = insertTask({
      id: "sub-stress-2",
      title: "Computer Networks Wireshark Analysis",
      category: "submission",
      status: "pending",
      priority: "high",
      estimatedMinutes: 45,
    });

    const t3 = insertTask({
      id: "sub-stress-3",
      title: "Database System SQL Schema Submission",
      category: "submission",
      status: "pending",
      priority: "medium",
      estimatedMinutes: 30,
    });

    const s1 = registerSubmission(t1.id, "Microprocessors", "2026-10-07T10:00:00Z", true);
    const s2 = registerSubmission(t2.id, "Networks", "2026-10-08T14:00:00Z", true);
    const s3 = registerSubmission(t3.id, "Databases", "2026-10-09T17:00:00Z", false);

    expect(s1.stage).toBe("discovered");
    expect(s2.stage).toBe("discovered");
    expect(s3.stage).toBe("discovered");

    // Advance s1 to needs_printing
    advanceStage(s1.id, "in_progress");
    advanceStage(s1.id, "digital_done");
    advanceStage(s1.id, "needs_printing");

    // Advance s2 to printed_physical
    advanceStage(s2.id, "in_progress");
    advanceStage(s2.id, "digital_done");
    advanceStage(s2.id, "needs_printing");
    advanceStage(s2.id, "printed_physical");

    // s3 is still in progress
    advanceStage(s3.id, "in_progress");

    // Verify inspectPhysicalSubmissionRequirements isolates exactly s1 for printing and s2 for packing
    const audit = inspectPhysicalSubmissionRequirements();
    expect(audit.needsPrinting.map((s) => s.id)).toEqual([s1.id]);
    expect(audit.needsPacking.map((s) => s.id)).toEqual([s2.id]);

    // Advance s2 to packed_in_bag and then submitted
    advanceStage(s2.id, "packed_in_bag");
    advanceStage(s2.id, "submitted");

    // s2 is completely submitted and must no longer appear in any pending list
    const postAudit = inspectPhysicalSubmissionRequirements();
    expect(postAudit.needsPacking.some((s) => s.id === s2.id)).toBe(false);
  });

  it("strictly rejects illegal state jumps and preserves state integrity", () => {
    const task = insertTask({
      id: "sub-stress-illegal",
      title: "Algorithms Dynamic Programming Record",
      category: "submission",
      status: "pending",
      priority: "urgent",
      estimatedMinutes: 50,
    });

    const sub = registerSubmission(task.id, "Algorithms", "2026-10-10T10:00:00Z", true);

    // Cannot jump directly from discovered to submitted
    expect(() => advanceStage(sub.id, "submitted")).toThrowError(/Invalid transition/);

    // Cannot jump from discovered to printed_physical without doing digital work
    expect(() => advanceStage(sub.id, "printed_physical")).toThrowError(/Invalid transition/);

    // Valid path
    advanceStage(sub.id, "in_progress");
    advanceStage(sub.id, "digital_done");
    advanceStage(sub.id, "needs_printing");
    advanceStage(sub.id, "printed_physical");
    advanceStage(sub.id, "packed_in_bag");
    advanceStage(sub.id, "submitted");

    // Once submitted, no further transitions are allowed
    const illegalAfterSubmitted: SubmissionStage[] = [
      "discovered",
      "decomposed",
      "in_progress",
      "digital_done",
      "needs_printing",
      "printed_physical",
      "packed_in_bag",
    ];

    for (const target of illegalAfterSubmitted) {
      expect(() => advanceStage(sub.id, target)).toThrowError();
    }
  });
});

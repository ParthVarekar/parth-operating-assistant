import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { insertTask } from "../src/db/repositories/taskRepository.js";
import { registerSubmission, advanceStage } from "../src/services/submissionService.js";
import {
  formatPrintDigest,
  generateCoverPageHtml,
  generatePrintBundle,
  getPendingPrintItems,
  markAllAsPackedInBag,
  markAllAsPhysicallyPrinted,
} from "../src/services/printBundlerService.js";
import { existsSync, readFileSync } from "node:fs";

describe("Print-Ready Xerox Bundler & Physical Pipeline Bridge", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
  });

  it("retrieves pending print items with correct page estimates", () => {
    const task1 = insertTask({
      id: "task-print-1",
      title: "Analysis of Algorithms Lab Exp 4 Code",
      category: "submission",
      status: "pending",
      priority: "high",
      estimatedMinutes: 60,
    });
    const sub1 = registerSubmission(task1.id, "AOA", "2026-10-10T10:00:00Z", true);
    advanceStage(sub1.id, "in_progress");
    advanceStage(sub1.id, "needs_printing");

    const task2 = insertTask({
      id: "task-print-2",
      title: "Operating Systems Assignment 2",
      category: "submission",
      status: "pending",
      priority: "medium",
      estimatedMinutes: 45,
    });
    const sub2 = registerSubmission(task2.id, "OS", "2026-10-12T10:00:00Z", true);
    advanceStage(sub2.id, "in_progress");
    advanceStage(sub2.id, "digital_done");

    const pending = getPendingPrintItems();
    expect(pending.length).toBeGreaterThanOrEqual(2);

    const aoaItem = pending.find((p) => p.subject === "AOA");
    expect(aoaItem).toBeDefined();
    expect(aoaItem?.estimatedPages).toBe(6); // Code / Lab = 6 pages
    expect(aoaItem?.printMode).toBe("B&W Single-Sided");

    const osItem = pending.find((p) => p.subject === "OS");
    expect(osItem).toBeDefined();
    expect(osItem?.estimatedPages).toBe(4); // Standard assignment = 4 pages
  });

  it("generates standardized KCCEMSR Mumbai University cover page HTML", () => {
    const item = {
      submissionId: "sub-test-cover",
      taskId: "task-test-cover",
      subject: "Data Warehousing & Mining",
      title: "DWM Experiment 5 Clustering Algorithms",
      deadline: "2026-10-15T10:00:00Z",
      stage: "needs_printing",
      estimatedPages: 6,
      printMode: "B&W Single-Sided" as const,
    };

    const html = generateCoverPageHtml(item);
    expect(html).toContain("K.C. College of Engineering & Management Studies & Research");
    expect(html).toContain("Parth Varekar");
    expect(html).toContain("Computer Engineering");
    expect(html).toContain("Semester V");
    expect(html).toContain("Data Warehousing & Mining");
    expect(html).toContain("DWM Experiment 5 Clustering Algorithms");
    expect(html).toContain("Assessment Parameter");
    expect(html).toContain("Total Marks");
  });

  it("generates physical bundle directory, manifest, and cover sheets", () => {
    const bundle = generatePrintBundle();

    expect(bundle.bundleDir).toBeDefined();
    expect(bundle.coverPagesCount).toBeGreaterThan(0);
    expect(bundle.totalEstimatedPages).toBeGreaterThan(0);
    expect(existsSync(bundle.manifestPath)).toBe(true);

    const manifestContent = readFileSync(bundle.manifestPath, "utf-8");
    expect(manifestContent).toContain("Xerox & Print Shop Manifest");
    expect(manifestContent).toContain("KCCEMSR");
    expect(manifestContent).toContain("AOA");
    expect(manifestContent).toContain("Total Estimated Pages to Print");
  });

  it("advances pipeline stages from needs_printing -> printed_physical -> packed_in_bag", () => {
    // 1. Mark printed
    const printedCount = markAllAsPhysicallyPrinted();
    expect(printedCount).toBeGreaterThan(0);

    let digest = formatPrintDigest();
    expect(digest).toContain("Printed but NOT YET IN BACKPACK");

    // 2. Mark packed in bag
    const packedCount = markAllAsPackedInBag();
    expect(packedCount).toBe(printedCount);

    digest = formatPrintDigest();
    expect(digest).toContain("Safely in Backpack");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  autoSolveAcademicProblem,
  generatePrintReadyJournalHtml,
  listSolvedAcademicReports,
  type SolvedExperimentReport,
} from "../src/services/academicAutoSolverService.js";

describe("Academic Pre-Computation Auto-Solver Suite", () => {
  beforeEach(() => {
    initDatabase(":memory:");
  });

  it("auto-solves Digital Signal Processing (DSP) laboratory assignments", async () => {
    const report = await autoSolveAcademicProblem(
      "Perform N-point DFT and Fast Fourier Transform DIT-FFT in Python and compute frequency spectrum.",
      "Digital Signal Processing"
    );

    expect(report.id).toBeDefined();
    expect(report.subject).toContain("Digital Signal Processing");
    expect(report.aim).toContain("Discrete Fourier Transform");
    expect(report.sourceCode.language).toBe("python");
    expect(report.sourceCode.code).toContain("compute_fft_dit");
    expect(report.executionOutput).toContain("100% spectral match");
    expect(report.vivaQuestions.length).toBeGreaterThanOrEqual(2);
    expect(report.htmlReportPath).toContain(".html");
  });

  it("auto-solves Database Management Systems (DBMS) assignments", async () => {
    const report = await autoSolveAcademicProblem(
      "Write SQL schema with audit trigger procedure for college student marks revisions.",
      "DBMS"
    );

    expect(report.id).toBeDefined();
    expect(report.subject).toContain("Database Management Systems");
    expect(report.aim).toContain("normalized relational schema");
    expect(report.softwareOrApparatus).toContain("PostgreSQL");
    expect(report.sourceCode.language).toBe("sql");
    expect(report.sourceCode.code).toContain("CREATE TRIGGER");
    expect(report.executionOutput).toContain("audit_log");
    expect(report.vivaQuestions.some((q) => q.question.includes("Trigger"))).toBe(true);
  });

  it("generates standardized Mumbai University / KCCEMSR print-ready journal HTML", async () => {
    const report = await autoSolveAcademicProblem(
      "Compute DFT and Radix-2 FFT",
      "DSP"
    );

    const html = generatePrintReadyJournalHtml(report);
    expect(html).toContain("K.C. College of Engineering");
    expect(html).toContain("Department of Computer Engineering");
    expect(html).toContain("Parth Varekar");
    expect(html).toContain("1. Aim");
    expect(html).toContain("5. Source Code");
    expect(html).toContain("6. Verified Execution Output");
    expect(html).toContain("Teacher's Signature");
    expect(html).toContain("Assessment Rubric");
  });

  it("retrieves cached pre-computed reports from profile store", async () => {
    await autoSolveAcademicProblem("Lab assignment for database triggers", "DBMS");
    const reports = listSolvedAcademicReports();
    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(reports[0]?.subject).toContain("Database Management Systems");
  });
});

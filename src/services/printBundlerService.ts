import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findActiveSubmissions, updateSubmissionStage } from "../db/repositories/submissionRepository.js";
import { findPendingTasks } from "../db/repositories/taskRepository.js";
import type { Submission } from "../types/index.js";

export interface PrintItem {
  submissionId: string;
  taskId: string;
  subject: string;
  title: string;
  deadline?: string;
  stage: string;
  estimatedPages: number;
  printMode: "B&W Single-Sided" | "B&W Back-to-Back" | "Color";
}

export interface PrintBundleResult {
  bundleDir: string;
  manifestPath: string;
  coverPagesCount: number;
  items: PrintItem[];
  totalEstimatedPages: number;
}

/**
 * Retrieves all submissions that require physical printing or are in preparation.
 */
export function getPendingPrintItems(): PrintItem[] {
  const activeSubs = findActiveSubmissions();
  const tasks = findPendingTasks();

  const printables = activeSubs.filter(
    (s) => s.stage === "needs_printing" || s.stage === "digital_done" || s.stage === "in_progress"
  );

  return printables.map((s) => {
    const task = tasks.find((t) => t.id === s.taskId);
    const title = task?.title ?? s.subject;
    const isCode = title.toLowerCase().includes("code") || title.toLowerCase().includes("lab");

    return {
      submissionId: s.id,
      taskId: s.taskId,
      subject: s.subject,
      title,
      deadline: s.hardDeadline,
      stage: s.stage,
      estimatedPages: isCode ? 6 : 4,
      printMode: "B&W Single-Sided",
    };
  });
}

/**
 * Generates clean, ready-to-print HTML cover page for an assignment.
 */
export function generateCoverPageHtml(item: PrintItem): string {
  const dateStr = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Submission Cover Sheet - ${item.subject}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    body {
      font-family: 'Times New Roman', Times, serif;
      margin: 0;
      padding: 30px;
      color: #000;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #000;
      padding-bottom: 15px;
      margin-bottom: 30px;
    }
    .header h1 {
      font-size: 20pt;
      margin: 0 0 5px 0;
      text-transform: uppercase;
      font-weight: bold;
    }
    .header h2 {
      font-size: 14pt;
      margin: 0 0 5px 0;
      font-weight: normal;
    }
    .header h3 {
      font-size: 13pt;
      margin: 0;
      font-style: italic;
    }
    .meta-box {
      border: 1px solid #000;
      padding: 20px;
      margin: 40px 0;
      line-height: 2;
      font-size: 12pt;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
    }
    .title-box {
      text-align: center;
      margin: 30px 0;
      padding: 15px;
      background: #f8f8f8;
      border: 1px dashed #666;
    }
    .title-box h2 {
      margin: 0;
      font-size: 16pt;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 40px;
    }
    th, td {
      border: 1px solid #000;
      padding: 10px;
      text-align: center;
      font-size: 11pt;
    }
    .signature-area {
      margin-top: 60px;
      display: flex;
      justify-content: space-between;
      font-size: 12pt;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>K.C. College of Engineering & Management Studies & Research</h1>
    <h2>Department of Computer Engineering</h2>
    <h3>Academic Year 2025–2026 | Semester V</h3>
  </div>

  <div class="title-box">
    <h2>ACADEMIC SUBMISSION DOSSIER</h2>
    <p style="margin: 5px 0 0 0; font-size: 13pt;"><strong>Course:</strong> ${item.subject}</p>
  </div>

  <div class="meta-box">
    <div class="meta-row">
      <span><strong>Student Name:</strong> Parth Varekar</span>
      <span><strong>Branch:</strong> Computer Engineering</span>
    </div>
    <div class="meta-row">
      <span><strong>Roll / Student ID:</strong> ce24.parth.varekar</span>
      <span><strong>Semester:</strong> Sem 5</span>
    </div>
    <div class="meta-row">
      <span><strong>Assignment / Lab Title:</strong> ${item.title}</span>
    </div>
    <div class="meta-row">
      <span><strong>Date of Submission:</strong> ${item.deadline ? new Date(item.deadline).toLocaleDateString("en-IN") : dateStr}</span>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Sr. No.</th>
        <th>Assessment Parameter</th>
        <th>Max Marks</th>
        <th>Marks Obtained</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td>
        <td>Lab Performance / Execution & Accuracy</td>
        <td>10</td>
        <td></td>
      </tr>
      <tr>
        <td>2</td>
        <td>Journal Documentation / Writeup & Code</td>
        <td>10</td>
        <td></td>
      </tr>
      <tr>
        <td>3</td>
        <td>Oral / Viva-Voce Understanding</td>
        <td>10</td>
        <td></td>
      </tr>
      <tr>
        <td colspan="2"><strong>Total Marks</strong></td>
        <td><strong>30</strong></td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <div class="signature-area">
    <div>
      <p style="margin-top: 40px;">_______________________<br><strong>Student Signature</strong></p>
    </div>
    <div>
      <p style="margin-top: 40px;">_______________________<br><strong>Faculty In-Charge Signature</strong></p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Creates a complete dated print bundle with cover pages and a Xerox manifest checklist.
 * @param bundleDate Optional date string (YYYY-MM-DD).
 */
export function generatePrintBundle(bundleDate?: string): PrintBundleResult {
  const date = bundleDate ?? new Date().toISOString().slice(0, 10);
  const items = getPendingPrintItems();

  const bundleDir = resolve(process.cwd(), "data", "print_bundles", `bundle_${date}`);
  const coverPagesDir = resolve(bundleDir, "cover_pages");
  mkdirSync(coverPagesDir, { recursive: true });

  let totalPages = 0;
  const manifestLines: string[] = [
    `# 🖨️ Xerox & Print Shop Manifest (${date})`,
    `**Student:** Parth Varekar | **College:** KCCEMSR (Computer Engineering)\n`,
    `Total Files to Print: **${items.length}**\n`,
    `| Sr. | Subject | Assignment / Experiment | Est. Pages | Print Mode | Status |`,
    `|---|---|---|---|---|---|`,
  ];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    totalPages += item.estimatedPages;

    manifestLines.push(
      `| ${i + 1} | ${item.subject} | ${item.title} | ${item.estimatedPages} | ${item.printMode} | [ ] Ready |`
    );

    // Write cover page HTML
    const coverHtml = generateCoverPageHtml(item);
    const sanitizedTitle = item.subject.replace(/[^a-zA-Z0-9_-]/g, "_");
    writeFileSync(resolve(coverPagesDir, `cover_${sanitizedTitle}_${item.submissionId.slice(0, 8)}.html`), coverHtml, "utf-8");

    // Advance to needs_printing if not already
    if (item.stage === "digital_done") {
      updateSubmissionStage(item.submissionId, "needs_printing");
    }
  }

  manifestLines.push(`\n**Total Estimated Pages to Print:** ~${totalPages} pages (Single-Sided A4)`);
  manifestLines.push(`\n### Next Physical Steps:`);
  manifestLines.push(`1. Open cover pages in browser and hit \`Ctrl + P\` ➔ Save as PDF / Print.`);
  manifestLines.push(`2. Take to campus Xerox shop or station.`);
  manifestLines.push(`3. Tap \`[ ✅ Mark All Printed ]\` on Telegram once collected.`);
  manifestLines.push(`4. Put into backpack immediately to prevent morning forgetting!`);

  const manifestPath = resolve(bundleDir, "MANIFEST.md");
  writeFileSync(manifestPath, manifestLines.join("\n"), "utf-8");

  return {
    bundleDir,
    manifestPath,
    coverPagesCount: items.length,
    items,
    totalEstimatedPages: totalPages,
  };
}

/**
 * Marks all pending printable submissions as physically printed.
 * Advances pipeline from needs_printing to printed_physical.
 */
export function markAllAsPhysicallyPrinted(): number {
  const active = findActiveSubmissions();
  const toPrint = active.filter((s) => s.stage === "needs_printing");

  for (const s of toPrint) {
    updateSubmissionStage(s.id, "printed_physical");
  }

  return toPrint.length;
}

/**
 * Marks all physically printed submissions as packed in backpack.
 * Advances pipeline from printed_physical to packed_in_bag.
 */
export function markAllAsPackedInBag(): number {
  const active = findActiveSubmissions();
  const toPack = active.filter((s) => s.stage === "printed_physical");

  for (const s of toPack) {
    updateSubmissionStage(s.id, "packed_in_bag");
  }

  return toPack.length;
}

/**
 * Formats a clean Telegram markdown digest of physical submissions & print queue.
 */
export function formatPrintDigest(): string {
  const items = getPendingPrintItems();
  const active = findActiveSubmissions();
  const inBag = active.filter((s) => s.stage === "packed_in_bag");
  const printedNeedsPack = active.filter((s) => s.stage === "printed_physical");

  const lines: string[] = [`📑 *Physical Submission & Print Queue*\n`];

  if (items.length === 0 && inBag.length === 0 && printedNeedsPack.length === 0) {
    lines.push("✨ *Zero pending printables!* All assignments are either submitted or digital-only.");
    return lines.join("\n");
  }

  if (items.length > 0) {
    lines.push(`🖨️ *Awaiting Printing (${items.length} items):*`);
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      lines.push(`${i + 1}. *[${it.subject}]* ${it.title} (~${it.estimatedPages} pages)`);
      if (it.deadline) {
        lines.push(`   🚨 Due: ${new Date(it.deadline).toLocaleDateString("en-IN")}`);
      }
    }
    lines.push("");
  }

  if (printedNeedsPack.length > 0) {
    lines.push(`⚠️ *Printed but NOT YET IN BACKPACK (${printedNeedsPack.length}):*`);
    for (const p of printedNeedsPack) {
      lines.push(`• *${p.subject}* — Put in bag before sleep!`);
    }
    lines.push("");
  }

  if (inBag.length > 0) {
    lines.push(`🎒 *Safely in Backpack (${inBag.length}):*`);
    for (const b of inBag) {
      lines.push(`• *${b.subject}* ready for tomorrow.`);
    }
  }

  return lines.join("\n");
}

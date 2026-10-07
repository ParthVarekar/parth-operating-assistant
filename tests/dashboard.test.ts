import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  startDashboardServer,
  stopDashboardServer,
  getISTDateTime,
  getCurrentRoutinePhase,
  getDashboardPayload,
  getDashboardHtml,
} from "../src/server/dashboardServer.js";
import http from "node:http";

const TEST_PORT = 3199;

describe("Dashboard Server & Hanzo Web GUI", () => {
  let server: http.Server;

  beforeAll(async () => {
    initDatabase(":memory:");
    server = startDashboardServer(TEST_PORT);
  });

  afterAll(async () => {
    await stopDashboardServer();
  });

  it("calculates IST datetime correctly with UTC+5:30 offset", () => {
    const ist = getISTDateTime();
    expect(ist.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ist.timeStr).toMatch(/^\d{2}:\d{2}$/);
    expect(ist.hours).toBeGreaterThanOrEqual(0);
    expect(ist.hours).toBeLessThanOrEqual(23);
  });

  it("identifies routine phases accurately based on hour triggers", () => {
    const deepWork = getCurrentRoutinePhase(23, 30);
    expect(deepWork.phase).toBe("DEEP_WORK");

    const sleep = getCurrentRoutinePhase(6, 0);
    expect(sleep.phase).toBe("SLEEP");

    const campus = getCurrentRoutinePhase(12, 0);
    expect(campus.phase).toBe("CAMPUS");

    const gymTrough = getCurrentRoutinePhase(19, 0);
    expect(gymTrough.phase).toBe("TROUGH_GYM");

    const dinner = getCurrentRoutinePhase(22, 0);
    expect(dinner.phase).toBe("DINNER_BUFFER");
  });

  it("generates complete dashboard payload with all systems aggregated", () => {
    const payload = getDashboardPayload();
    expect(payload).toHaveProperty("ist");
    expect(payload).toHaveProperty("routinePhase");
    expect(payload).toHaveProperty("schedule");
    expect(payload).toHaveProperty("fitness");
    expect(payload).toHaveProperty("hackathons");
    expect(payload).toHaveProperty("printQueue");
    expect(payload).toHaveProperty("ecosystem");
    expect(payload.ecosystem.whatsapp.readOnly).toBe(true);
    expect(payload.ecosystem.whatsapp.guard).toContain("neutered");
  });

  it("generates Hanzo-styled HTML markup with typography and bento elements", () => {
    const html = getDashboardHtml();
    expect(html).toContain("PARTH.OS");
    expect(html).toContain("Operating Assistant");
    expect(html).toContain("Instrument Serif");
    expect(html).toContain("Fragment Mono");
    expect(html).toContain("bento-grid");
    expect(html).toContain("K.C. COLLEGE OF ENGINEERING");
  });

  it("responds 200 OK on /health for Render health checks", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("uptime");
  });

  it("responds 200 OK on /api/status with operational telemetry", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("operational");
    expect(body.whatsappReadOnly).toBe(true);
  });

  it("responds 200 OK on /api/dashboard-data with full state", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/dashboard-data`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.schedule).toBeDefined();
    expect(body.fitness.protein.target).toBe(130);
  });

  it("creates a new task via POST /api/tasks", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Distributed Systems Lab Turn 3",
        category: "submission",
        priority: "high",
        estimatedMinutes: 45,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.task.title).toBe("Distributed Systems Lab Turn 3");

    const createdId = body.task.id;

    // Test PATCH /api/tasks/:id
    const patchRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/tasks/${createdId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Read MDM Question Bank Solution",
        category: "study",
        priority: "urgent",
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as any;
    expect(patchBody.success).toBe(true);
    expect(patchBody.task.title).toBe("Read MDM Question Bank Solution");
    expect(patchBody.task.category).toBe("study");

    // Test DELETE /api/tasks/:id
    const delRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/tasks/${createdId}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as any;
    expect(delBody.success).toBe(true);
  });

  it("logs meal via POST /api/fitness/meal with preset", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/fitness/meal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetKey: "whey_shake" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.entry.proteinGrams).toBe(26);
  });

  it("triggers night replanning via POST /api/replan", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/replan`, {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
  });

  it("serves HTML on GET /", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<!DOCTYPE html>");
    expect(text).toContain("PARTH.OS");
  });

  it("responds 200 OK to HEAD requests on / and /health", async () => {
    const resRoot = await fetch(`http://127.0.0.1:${TEST_PORT}/`, { method: "HEAD" });
    expect(resRoot.status).toBe(200);

    const resHealth = await fetch(`http://127.0.0.1:${TEST_PORT}/health`, { method: "HEAD" });
    expect(resHealth.status).toBe(200);
  });

  it("responds 200 OK on GET /api/ai-news with curated radar breakthroughs", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/ai-news`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.count).toBeGreaterThan(0);
    expect(Array.isArray(body.news)).toBe(true);
  });

  it("responds 200 OK on GET /api/memory with persistent assistant memories", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/memory`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.memories)).toBe(true);
  });

  it("handles academic auto-solving endpoints (/api/academic/solve and /api/academic/solutions)", async () => {
    const solveRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/academic/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Solve DSP FFT experiment in Python",
        subject: "DSP",
      }),
    });
    expect(solveRes.status).toBe(200);
    const solveData = (await solveRes.json()) as any;
    expect(solveData.success).toBe(true);
    expect(solveData.report.subject).toContain("Digital Signal Processing");

    const solutionsRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/academic/solutions`);
    expect(solutionsRes.status).toBe(200);
    const solutionsData = (await solutionsRes.json()) as any;
    expect(solutionsData.success).toBe(true);
    expect(Array.isArray(solutionsData.solutions)).toBe(true);
  });

  it("handles dynamic tool synthesis and execution endpoints (/api/tools/*)", async () => {
    const synthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/tools/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "hex_encoder",
        description: "Encodes string to hex format",
        code: `async function run(args) { return { hex: Buffer.from(args.text).toString("hex") }; }`,
      }),
    });
    expect(synthRes.status).toBe(201);
    const synthData = (await synthRes.json()) as any;
    expect(synthData.success).toBe(true);
    expect(synthData.tool.name).toBe("hex_encoder");

    const execRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/tools/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nameOrId: "hex_encoder",
        args: { text: "antigravity" },
      }),
    });
    expect(execRes.status).toBe(200);
    const execData = (await execRes.json()) as any;
    expect(execData.success).toBe(true);
    expect(execData.result.hex).toBe(Buffer.from("antigravity").toString("hex"));

    const listRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/tools/synthesized`);
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as any;
    expect(listData.tools.some((t: any) => t.name === "hex_encoder")).toBe(true);

    const deleteRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/tools/synthesized/hex_encoder`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);
  });

  it("handles nightly meta-cognition reflection endpoints (/api/meta-cognition/*)", async () => {
    const runRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/meta-cognition/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-10-07" }),
    });
    expect(runRes.status).toBe(200);
    const runData = (await runRes.json()) as any;
    expect(runData.success).toBe(true);
    expect(runData.report.auditDate).toBe("2026-10-07");

    const reportsRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/meta-cognition/reports`);
    expect(reportsRes.status).toBe(200);
    const reportsData = (await reportsRes.json()) as any;
    expect(reportsData.success).toBe(true);
    expect(Array.isArray(reportsData.reports)).toBe(true);
    expect(reportsData.latest).toBeDefined();
  });

  it("returns 404 on invalid route", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/unknown-route`);
    expect(res.status).toBe(404);
  });
});

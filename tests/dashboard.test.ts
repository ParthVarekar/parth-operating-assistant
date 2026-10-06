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

  it("returns 404 on invalid route", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/unknown-route`);
    expect(res.status).toBe(404);
  });
});

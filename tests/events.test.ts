import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  registerEventHandler,
  scheduleProactiveEvent,
  tickScheduledEvents,
} from "../src/scheduler/eventHeartbeat.js";

describe("Persistent Scheduled Events Queue", () => {
  beforeAll(() => {
    initDatabase(":memory:");
  });

  it("schedules an event and processes it when due timestamp arrives", async () => {
    let handlerFired = false;
    registerEventHandler("DAY_REVIEW", async () => {
      handlerFired = true;
    });

    const pastIso = new Date(Date.now() - 5000).toISOString();
    scheduleProactiveEvent("DAY_REVIEW", pastIso, { note: "test" });

    const processedCount = await tickScheduledEvents();
    expect(processedCount).toBeGreaterThanOrEqual(1);
    expect(handlerFired).toBe(true);
  });
});

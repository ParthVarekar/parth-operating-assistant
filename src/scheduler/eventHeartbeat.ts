import {
  findDueEvents,
  insertEvent,
  markEventFailed,
  markEventProcessed,
} from "../db/repositories/eventRepository.js";
import type { ScheduledEvent } from "../types/index.js";

type EventHandler = (event: ScheduledEvent) => Promise<void>;

let heartbeatTimer: NodeJS.Timeout | null = null;
const eventHandlers = new Map<string, EventHandler>();

/**
 * Registers a handler callback for a specific scheduled event type.
 * @param eventType Type identifier string.
 * @param handler Asynchronous execution function.
 */
export function registerEventHandler(eventType: string, handler: EventHandler): void {
  eventHandlers.set(eventType, handler);
}

/**
 * Schedules a new proactive event into the persistent queue.
 * @param eventType Type of event.
 * @param triggerAt ISO date-time string.
 * @param payload Event payload dictionary.
 * @returns Created ScheduledEvent.
 */
export function scheduleProactiveEvent(
  eventType: ScheduledEvent["eventType"],
  triggerAt: string,
  payload: Record<string, unknown>
): ScheduledEvent {
  return insertEvent({
    id: crypto.randomUUID(),
    triggerAt,
    eventType,
    payload,
    status: "pending",
    retryCount: 0,
  });
}

/**
 * Ticks the persistent event queue, processing any events whose trigger time has passed.
 */
export async function tickScheduledEvents(): Promise<number> {
  const now = new Date().toISOString();
  const dueEvents = findDueEvents(now);

  for (const event of dueEvents) {
    const handler = eventHandlers.get(event.eventType);
    if (!handler) {
      markEventProcessed(event.id);
      continue;
    }

    try {
      await handler(event);
      markEventProcessed(event.id);
    } catch {
      markEventFailed(event.id);
    }
  }

  return dueEvents.length;
}

/**
 * Starts the background heartbeat poller loop.
 * @param intervalMs Polling frequency in milliseconds (default 15000ms).
 */
export function startHeartbeat(intervalMs = 15000): void {
  if (heartbeatTimer) return;

  heartbeatTimer = setInterval(async () => {
    try {
      await tickScheduledEvents();
    } catch {
      // Prevent unhandled rejection from killing loop
    }
  }, intervalMs);
}

/**
 * Stops the background heartbeat poller.
 */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

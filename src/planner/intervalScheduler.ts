import type { ScheduleBlock, Task, ZoneType } from "../types/index.js";

export interface TimeSlot {
  startMinutes: number;
  endMinutes: number;
  zoneType: ZoneType;
}

export interface ScheduledPlan {
  blocks: Omit<ScheduleBlock, "id" | "createdAt">[];
  deferredTasks: Task[];
  totalAllocatedMinutes: number;
  availableMinutes: number;
}

/**
 * Converts HH:MM string to normalized minutes from previous morning.
 * Times from 00:00 to 06:00 are treated as post-midnight extensions (+1440).
 * @param timeStr Time in "HH:MM" format.
 * @returns Normalized minute count.
 */
export function timeToNormalizedMinutes(timeStr: string): number {
  const [hStr, mStr] = timeStr.split(":");
  const hours = Number.parseInt(hStr ?? "0", 10);
  const minutes = Number.parseInt(mStr ?? "0", 10);

  if (hours < 7) {
    return (hours + 24) * 60 + minutes;
  }
  return hours * 60 + minutes;
}

/**
 * Converts normalized minutes back to "HH:MM" 24-hour format.
 * @param totalMinutes Normalized minutes.
 * @returns "HH:MM" string.
 */
export function normalizedMinutesToTime(totalMinutes: number): string {
  let minutes = totalMinutes % (24 * 60);
  if (minutes < 0) {
    minutes += 24 * 60;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hStr = h.toString().padStart(2, "0");
  const mStr = m.toString().padStart(2, "0");
  return `${hStr}:${mStr}`;
}

/**
 * Computes default evening and night time slots respecting anchors:
 * - Zone 2 (Trough): 19:30 to 21:30
 * - Dinner Anchor: 21:30 to 22:30 (Protected, no work)
 * - Post-Dinner Transition: 22:30 to 23:00 (Buffer)
 * - Zone 4 (Deep Work): 23:00 to 03:30 (Next morning)
 * - Zone 5 (Wind-down): 03:30 to 04:30
 * @param startFromTime Optional time to begin scheduling from.
 * @returns List of available work intervals.
 */
export function getAvailableWorkSlots(startFromTime = "19:30"): TimeSlot[] {
  const currentNorm = timeToNormalizedMinutes(startFromTime);

  const rawSlots: TimeSlot[] = [
    {
      startMinutes: timeToNormalizedMinutes("19:30"),
      endMinutes: timeToNormalizedMinutes("21:30"),
      zoneType: "trough",
    },
    {
      startMinutes: timeToNormalizedMinutes("23:00"),
      endMinutes: timeToNormalizedMinutes("03:30"),
      zoneType: "deep_work",
    },
  ];

  const usableSlots: TimeSlot[] = [];

  for (const slot of rawSlots) {
    if (slot.endMinutes <= currentNorm) {
      continue;
    }
    const effectiveStart = Math.max(slot.startMinutes, currentNorm);
    if (effectiveStart < slot.endMinutes) {
      usableSlots.push({
        startMinutes: effectiveStart,
        endMinutes: slot.endMinutes,
        zoneType: slot.zoneType,
      });
    }
  }

  return usableSlots;
}

/**
 * Deterministically packs tasks into available time slots.
 * Guarantees zero time-overlaps, 10-minute buffers, and strict boundary adherence.
 * @param tasks Tasks to schedule.
 * @param date Target date string (YYYY-MM-DD).
 * @param startTime Starting time for the plan (e.g. "19:30" or "22:00").
 * @param optimismMultipliers Optional category multipliers.
 * @returns Scheduled plan containing non-overlapping blocks and deferred tasks.
 */
export function scheduleEveningPlan(
  tasks: Task[],
  date: string,
  startTime = "19:30",
  optimismMultipliers: Record<string, number> = {}
): ScheduledPlan {
  const slots = getAvailableWorkSlots(startTime);
  const blocks: Omit<ScheduleBlock, "id" | "createdAt">[] = [];
  const deferredTasks: Task[] = [];

  // Sort tasks: Urgent > High > Medium > Low, then by deadline
  const sortedTasks = [...tasks].sort((a, b) => {
    const priorityWeight: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    const pDiff = (priorityWeight[a.priority] ?? 2) - (priorityWeight[b.priority] ?? 2);
    if (pDiff !== 0) return pDiff;
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    return a.deadline ? -1 : 1;
  });

  let currentSlotIndex = 0;
  let slotPointer = slots[0]?.startMinutes ?? 0;
  let totalAllocatedMinutes = 0;

  let totalAvailableMinutes = 0;
  for (const s of slots) {
    totalAvailableMinutes += s.endMinutes - s.startMinutes;
  }

  for (const task of sortedTasks) {
    const multiplier = optimismMultipliers[task.category] ?? 1.0;
    const requiredMinutes = Math.max(15, Math.round(task.estimatedMinutes * multiplier));
    const transitionBuffer = 10;
    const neededWithBuffer = requiredMinutes + transitionBuffer;

    let placed = false;

    while (currentSlotIndex < slots.length) {
      const activeSlot = slots[currentSlotIndex];
      if (!activeSlot) break;

      const remainingInSlot = activeSlot.endMinutes - slotPointer;

      if (remainingInSlot >= requiredMinutes) {
        const blockStart = slotPointer;
        const blockEnd = blockStart + requiredMinutes;

        blocks.push({
          date,
          startTime: normalizedMinutesToTime(blockStart),
          endTime: normalizedMinutesToTime(blockEnd),
          zoneType: activeSlot.zoneType,
          taskId: task.id,
          taskTitle: task.title,
          status: "planned",
        });

        totalAllocatedMinutes += requiredMinutes;
        slotPointer = blockEnd + transitionBuffer;
        placed = true;
        break;
      }

      // Not enough space in this slot, advance to next slot
      currentSlotIndex++;
      if (currentSlotIndex < slots.length) {
        const nextSlot = slots[currentSlotIndex];
        if (nextSlot) {
          slotPointer = nextSlot.startMinutes;
        }
      }
    }

    if (!placed) {
      deferredTasks.push(task);
    }
  }

  return {
    blocks,
    deferredTasks,
    totalAllocatedMinutes,
    availableMinutes: totalAvailableMinutes,
  };
}

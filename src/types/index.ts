export type TaskCategory =
  | "assignment"
  | "coding"
  | "submission"
  | "admin"
  | "study"
  | "fitness"
  | "misc";

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "skipped"
  | "deferred";

export type TaskPriority = "urgent" | "high" | "medium" | "low";

export interface Task {
  id: string;
  title: string;
  description?: string;
  category: TaskCategory;
  status: TaskStatus;
  priority: TaskPriority;
  estimatedMinutes: number;
  actualMinutes?: number;
  deadline?: string;
  parentTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

export type SubmissionStage =
  | "discovered"
  | "decomposed"
  | "in_progress"
  | "digital_done"
  | "needs_printing"
  | "printed_physical"
  | "packed_in_bag"
  | "submitted";

export interface Submission {
  id: string;
  taskId: string;
  subject: string;
  stage: SubmissionStage;
  printDeadline?: string;
  hardDeadline?: string;
  materialsNeeded?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ZoneType =
  | "college"
  | "trough"
  | "dinner"
  | "deep_work"
  | "sleep"
  | "flexible";

export type BlockStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "slipped"
  | "dropped";

export interface ScheduleBlock {
  id: string;
  date: string;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  zoneType: ZoneType;
  taskId?: string;
  taskTitle?: string;
  status: BlockStatus;
  createdAt: string;
}

export type MealType = "lunch" | "snack" | "dinner" | "pre_workout" | "post_workout";
export type MealStatus = "scheduled" | "completed" | "missed";

export interface MealRecord {
  id: string;
  date: string;
  mealType: MealType;
  scheduledTime: string;
  loggedAt?: string;
  status: MealStatus;
  notes?: string;
}

export interface FrictionLog {
  id: string;
  taskId?: string;
  reason: string;
  category: string;
  loggedAt: string;
}

export type ScheduledEventType =
  | "TASK_CHECKIN"
  | "MEAL_REMINDER"
  | "PRINT_WARNING"
  | "DAY_REVIEW"
  | "TROUGH_CHECKIN";

export interface ScheduledEvent {
  id: string;
  triggerAt: string;
  eventType: ScheduledEventType;
  payload: Record<string, unknown>;
  status: "pending" | "processed" | "cancelled";
  retryCount: number;
  createdAt: string;
}

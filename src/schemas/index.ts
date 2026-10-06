import { z } from "zod";

export const TaskCategorySchema = z.enum([
  "assignment",
  "coding",
  "submission",
  "admin",
  "study",
  "fitness",
  "misc",
]);

export const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "skipped",
  "deferred",
]);

export const TaskPrioritySchema = z.enum(["urgent", "high", "medium", "low"]);

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  category: TaskCategorySchema.default("misc"),
  status: TaskStatusSchema.default("pending"),
  priority: TaskPrioritySchema.default("medium"),
  estimatedMinutes: z.number().int().positive(),
  actualMinutes: z.number().int().positive().optional(),
  deadline: z.string().optional(),
  parentTaskId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const SubmissionStageSchema = z.enum([
  "discovered",
  "decomposed",
  "in_progress",
  "digital_done",
  "needs_printing",
  "printed_physical",
  "packed_in_bag",
  "submitted",
]);

export const SubmissionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  subject: z.string().min(1),
  stage: SubmissionStageSchema.default("discovered"),
  printDeadline: z.string().optional(),
  hardDeadline: z.string().optional(),
  materialsNeeded: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ZoneTypeSchema = z.enum([
  "college",
  "trough",
  "dinner",
  "deep_work",
  "sleep",
  "flexible",
]);

export const BlockStatusSchema = z.enum([
  "planned",
  "in_progress",
  "completed",
  "slipped",
  "dropped",
]);

export const ScheduleBlockSchema = z.object({
  id: z.string(),
  date: z.string(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  zoneType: ZoneTypeSchema,
  taskId: z.string().optional(),
  taskTitle: z.string().optional(),
  status: BlockStatusSchema.default("planned"),
  createdAt: z.string(),
});

export const CityZoneSchema = z.enum(["mumbai", "thane", "navimumbai", "pune", "online"]);
export const HackathonModeSchema = z.enum(["offline", "online", "hybrid"]);

export const ParsedIntentSchema = z.object({
  intentType: z.enum([
    "CREATE_TASK",
    "CREATE_SUBMISSION",
    "REPORT_SLIP",
    "REPORT_DONE",
    "QUERY_NEXT",
    "QUERY_DAY",
    "LOG_MEAL",
    "PLAN_TONIGHT",
    "FIND_HACKATHONS",
    "CHAT",
  ]),
  taskTitle: z.string().optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  category: TaskCategorySchema.optional(),
  priority: TaskPrioritySchema.optional(),
  deadline: z.string().optional(),
  subject: z.string().optional(),
  isPrintable: z.boolean().optional(),
  slipMinutes: z.number().int().positive().optional(),
  cityFilter: CityZoneSchema.optional(),
  responseMessage: z.string(),
});

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>;

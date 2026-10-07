import crypto from "node:crypto";
import type OpenAI from "openai";
import { findPendingTasks, insertTask, updateTaskStatus } from "../db/repositories/taskRepository.js";
import { registerSubmission } from "../services/submissionService.js";
import { getSavedAiNews, runAiIntelligenceScan } from "../services/aiNewsService.js";
import { listUpcomingHackathons } from "../services/hackathonService.js";
import {
  getDailyFitnessSummary,
  logQuickPresetMeal,
  logCustomMeal,
  type DailyFitnessSummary,
} from "../services/fitnessService.js";
import { scheduleEveningPlan } from "../planner/intervalScheduler.js";
import { handleTaskOverrun } from "../planner/replanEngine.js";
import {
  delegateTaskToTrello,
  syncTrelloTaskCompletions,
  getTrelloAccessToken,
} from "../services/trelloService.js";
import { searchMemories, retrieveContextualMemories, recordMemory } from "../services/memoryService.js";
import { getISTDateTime, getCurrentRoutinePhase } from "../server/dashboardServer.js";
import { solveAcademicProblem } from "../services/academicAutoSolverService.js";
import {
  synthesizeTool,
  executeSynthesizedTool,
  getSynthesizedTool,
  convertSynthesizedToolsToAgentTools,
} from "../services/toolSynthesizer.js";
import { runNightlyMetaCognitionReflection } from "../services/metaCognitionEngine.js";
import type { CityZone, MemoryCategory, Task, TaskCategory, TaskPriority } from "../types/index.js";

/**
 * OpenAI-compatible tool specifications available to the assistant LLM.
 * Equips the model with full autonomous agency to query data or execute operational state changes.
 */
export const AGENT_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_ai_news",
      description:
        "Retrieves the latest artificial intelligence, machine learning, and frontier tech breakthroughs and research news from the intelligence radar.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of news articles to return (default: 4)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_hackathons",
      description:
        "Retrieves upcoming regional hackathons in Mumbai, Navi Mumbai, Thane, Pune, or online with prize pools, dates, venues, deadlines, and registration URLs. Supports filtering by city zone and sorting by date, prize, or deadline.",
      parameters: {
        type: "object",
        properties: {
          cityFilter: {
            type: "string",
            enum: ["all", "mumbai", "navimumbai", "thane", "pune", "online"],
            description: "City zone filter (default: 'all')",
          },
          sortBy: {
            type: "string",
            enum: ["date", "prize", "deadline"],
            description:
              "Sorting order: 'date' (earliest starting date first), 'prize' (largest prize first), or 'deadline' (soonest deadline first)",
          },
          bookmarkedOnly: {
            type: "boolean",
            description: "If true, only returns hackathons bookmarked by Parth",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description:
        "Creates and queues a new coursework, assignment, lab experiment, coding task, or study sprint in Parth's operating backlog.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Title or description of the task",
          },
          estimatedMinutes: {
            type: "number",
            description: "Estimated duration in minutes (default: 45)",
          },
          category: {
            type: "string",
            enum: ["assignment", "coding", "submission", "admin", "study", "fitness", "misc"],
            description: "Category of the task (default: 'assignment')",
          },
          priority: {
            type: "string",
            enum: ["urgent", "high", "medium", "low"],
            description: "Priority tier (default: 'high')",
          },
          deadline: {
            type: "string",
            description: "ISO date string or human readable deadline",
          },
          isPhysicalSubmission: {
            type: "boolean",
            description:
              "Set to true if this task requires physical xerox printing or lab manual turn-in",
          },
          subject: {
            type: "string",
            description: "College subject or module name (e.g. DSP, AI, DBMS)",
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description:
        "Marks a task as completed in Parth's backlog. If taskTitle is omitted, completes the top pending task.",
      parameters: {
        type: "object",
        properties: {
          taskTitle: {
            type: "string",
            description: "Full or partial title of the task to complete",
          },
          minutesSpent: {
            type: "number",
            description: "Actual minutes spent completing the task",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pending_tasks",
      description:
        "Retrieves all pending/active tasks currently queued in Parth's backlog, ordered by priority.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_evening_schedule",
      description:
        "Generates an optimized schedule for tonight's routine and pending tasks, strictly protecting dinner (9:30 PM) and sleep (4:30 AM) anchors.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "report_slip_and_replan",
      description:
        "Recalculates and rebalances the schedule when Parth is running late, behind schedule, or experienced a task overrun, preserving dinner and sleep anchors.",
      parameters: {
        type: "object",
        properties: {
          delayReason: {
            type: "string",
            description: "Context or reason for the delay/overrun",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_nutrition",
      description:
        "Logs food, meals, shakes, or snacks towards Parth's daily nutrition target (130g protein, 2500 kcal).",
      parameters: {
        type: "object",
        properties: {
          preset: {
            type: "string",
            enum: ["whey_shake", "eggs_toast", "solid_dinner", "quick_snack", "night_fuel"],
            description:
              "Quick meal preset: whey_shake (+26g P), eggs_toast (+28g P), solid_dinner (+34g P), quick_snack (+14g P), night_fuel (+12g P)",
          },
          mealName: {
            type: "string",
            description: "Custom meal description if not using a preset",
          },
          proteinGrams: {
            type: "number",
            description: "Protein in grams for custom meal",
          },
          calories: {
            type: "number",
            description: "Calories in kcal for custom meal",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_fitness_summary",
      description:
        "Gets today's current nutritional intake (total protein logged, target 130g, total calories, target 2500 kcal, logged meals).",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trello_action",
      description:
        "Interacts with Parth's linked Trello board to delegate tasks or synchronize completions.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["delegate", "sync"],
            description: "'delegate' pushes a task card to Trello; 'sync' pulls completed cards from Trello",
          },
          taskTitle: {
            type: "string",
            description: "Title of the task to delegate (optional, defaults to top pending)",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memory",
      description:
        "Searches the assistant's long-term memory for Parth's stored preferences, facts, or past interactions.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search keyword or topic",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "Persists a new insight, preference, goal, or important fact about Parth into long-term memory.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["preference", "goal", "project", "fact"],
            description: "Category of the memory entry",
          },
          content: {
            type: "string",
            description: "The fact, preference, or goal to remember",
          },
          importance: {
            type: "number",
            description: "Importance tier from 1 to 5 (default: 3)",
          },
        },
        required: ["category", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "solve_academic_problem",
      description:
        "Decomposes, auto-solves, generates verified code, simulates terminal output, and compiles Mumbai University / KCCEMSR print-ready journal HTML bundles into the print queue for academic lab assignments or question banks.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The assignment brief, question bank problem, or lab manual experiment prompt.",
          },
          subject: {
            type: "string",
            description: "Optional subject name (e.g., 'Digital Signal Processing', 'DBMS', 'Operating Systems').",
          },
          taskId: {
            type: "string",
            description: "Optional existing task ID to associate and link with the submission pipeline.",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "synthesize_custom_tool",
      description:
        "Dynamically synthesizes, compiles, and registers a brand-new custom tool on the fly with safe sandboxed JavaScript execution.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Identifier name for the tool (alphanumeric and underscores, e.g. 'calculate_gpa').",
          },
          description: {
            type: "string",
            description: "What the custom tool does.",
          },
          requirements: {
            type: "string",
            description: "Functional requirements and logic for the tool code generator.",
          },
          code: {
            type: "string",
            description: "Optional explicit JavaScript code implementing an async run(args) function.",
          },
        },
        required: ["name", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_custom_tool",
      description:
        "Executes an existing dynamically synthesized tool inside a secure, time-bounded node:vm sandbox and returns the result.",
      parameters: {
        type: "object",
        properties: {
          toolName: {
            type: "string",
            description: "The name or ID of the synthesized tool to execute.",
          },
          args: {
            type: "object",
            description: "Key-value argument dictionary to pass to the tool.",
          },
        },
        required: ["toolName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_nightly_reflection",
      description:
        "Audits daily task execution velocity, updates estimation multipliers, validates dinner (9:30 PM) and sleep (4:30 AM) anchors, consolidates episodic memory, and auto-drafts tomorrow's schedule blocks.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Optional ISO date (YYYY-MM-DD) to audit. Defaults to yesterday/today cycle.",
          },
        },
      },
    },
  },
];

/**
 * Returns static agent tools combined with all dynamically synthesized active tools.
 */
export function getAvailableAgentTools(): OpenAI.ChatCompletionTool[] {
  return [...AGENT_TOOLS, ...convertSynthesizedToolsToAgentTools()];
}

export interface ToolExecutionResult {
  success: boolean;
  result: unknown;
  actionSummary: string;
}

/**
 * Extracts numeric prize value for hackathon sorting.
 */
function parsePrizeNumeric(prizeStr: string | undefined): number {
  if (!prizeStr) return 0;
  const cleaned = prizeStr.replace(/,/g, "");
  const match = cleaned.match(/₹?\s*(\d+)/);
  return match && match[1] ? parseInt(match[1], 10) : 0;
}

/**
 * Executes a tool requested by the assistant LLM and returns the structured result and action summary.
 * @param toolName Name of the function called by the model.
 * @param args Structured arguments provided by the model.
 * @returns Result payload for LLM reasoning and human-readable action summary.
 */
export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<ToolExecutionResult> {
  const ist = getISTDateTime();

  switch (toolName) {
    case "get_ai_news": {
      const limit = typeof args.limit === "number" ? Math.max(1, args.limit) : 4;
      const saved = getSavedAiNews();
      const items = saved.length >= 2 ? saved : (await runAiIntelligenceScan()).items;
      const top = items.slice(0, limit);
      return {
        success: true,
        result: {
          count: top.length,
          articles: top.map((a) => ({
            title: a.title,
            summary: a.summary,
            url: a.url,
            source: a.source,
            category: a.category,
          })),
        },
        actionSummary: `Retrieved ${top.length} frontier AI & tech radar intelligence items`,
      };
    }

    case "get_hackathons": {
      const cityFilter = (args.cityFilter as CityZone | "all") || "all";
      const sortBy = (args.sortBy as "date" | "prize" | "deadline") || "date";
      const bookmarkedOnly = Boolean(args.bookmarkedOnly);

      let hackathons = listUpcomingHackathons(cityFilter, bookmarkedOnly);

      if (sortBy === "date") {
        hackathons = [...hackathons].sort((a, b) => a.startDate.localeCompare(b.startDate));
      } else if (sortBy === "prize") {
        hackathons = [...hackathons].sort(
          (a, b) => parsePrizeNumeric(b.prizePool) - parsePrizeNumeric(a.prizePool)
        );
      } else if (sortBy === "deadline") {
        hackathons = [...hackathons].sort((a, b) =>
          a.registrationDeadline.localeCompare(b.registrationDeadline)
        );
      }

      return {
        success: true,
        result: {
          count: hackathons.length,
          hackathons: hackathons.map((h) => ({
            id: h.id,
            title: h.title,
            startDate: h.startDate,
            endDate: h.endDate,
            registrationDeadline: h.registrationDeadline,
            prizePool: h.prizePool || "Certificates / Mentorship",
            cityZone: h.cityZone,
            mode: h.mode,
            venue: h.venue,
            url: h.url,
            isBookmarked: h.isBookmarked,
          })),
        },
        actionSummary: `Queried upcoming hackathons (filter: ${cityFilter}, sorted by: ${sortBy})`,
      };
    }

    case "create_task": {
      const title = String(args.title || "Coursework Task").trim();
      const est = typeof args.estimatedMinutes === "number" ? args.estimatedMinutes : 45;
      const category = (args.category as TaskCategory) || "assignment";
      const priority = (args.priority as TaskPriority) || "high";
      const deadline =
        typeof args.deadline === "string" && args.deadline.trim()
          ? args.deadline.trim()
          : new Date(Date.now() + 5 * 86400000).toISOString();
      const isSub = Boolean(args.isPhysicalSubmission) || category === "submission";
      const subject = typeof args.subject === "string" ? args.subject : "Coursework";

      const newTask: Task = {
        id: crypto.randomUUID(),
        title,
        category,
        status: "pending",
        priority,
        estimatedMinutes: est,
        deadline,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      insertTask(newTask);

      if (isSub) {
        registerSubmission(newTask.id, subject, deadline, true);
      }

      if (getTrelloAccessToken()) {
        delegateTaskToTrello(newTask).catch(console.warn);
      }

      recordMemory(
        "task_log",
        `Created coursework task: "${title}" (${est}m, Priority: ${priority})`,
        "chat"
      ).catch(console.warn);

      return {
        success: true,
        result: {
          task: newTask,
          physicalSubmissionFlagged: isSub,
        },
        actionSummary: `Created task "${title}" (${est}m, Priority: ${priority})`,
      };
    }

    case "complete_task": {
      const pending = findPendingTasks();
      let targetTask = pending[0];

      if (args.taskTitle && typeof args.taskTitle === "string") {
        const query = args.taskTitle.toLowerCase();
        const found = pending.find((t) => t.title.toLowerCase().includes(query));
        if (found) {
          targetTask = found;
        }
      }

      if (!targetTask) {
        return {
          success: false,
          result: { message: "No active pending tasks found to mark completed." },
          actionSummary: "Attempted to complete task, but backlog is empty",
        };
      }

      const minutes =
        typeof args.minutesSpent === "number" ? args.minutesSpent : targetTask.estimatedMinutes;
      updateTaskStatus(targetTask.id, "completed", minutes);

      recordMemory(
        "task_log",
        `Completed task "${targetTask.title}" (${minutes}m)`,
        "chat"
      ).catch(console.warn);

      return {
        success: true,
        result: {
          completedTask: targetTask,
          minutesSpent: minutes,
        },
        actionSummary: `Marked task completed: "${targetTask.title}"`,
      };
    }

    case "list_pending_tasks": {
      const pending = findPendingTasks();
      return {
        success: true,
        result: {
          count: pending.length,
          tasks: pending.map((t) => ({
            id: t.id,
            title: t.title,
            category: t.category,
            priority: t.priority,
            estimatedMinutes: t.estimatedMinutes,
            deadline: t.deadline,
          })),
        },
        actionSummary: `Retrieved ${pending.length} pending tasks`,
      };
    }

    case "plan_evening_schedule": {
      const tasks = findPendingTasks();
      const plan = scheduleEveningPlan(tasks, ist.dateStr, ist.timeStr);
      return {
        success: true,
        result: {
          date: ist.dateStr,
          currentPhase: getCurrentRoutinePhase(ist.hours, ist.minutes),
          blockCount: plan.blocks.length,
          blocks: plan.blocks.map((b) => ({
            startTime: b.startTime,
            endTime: b.endTime,
            zoneType: b.zoneType,
            taskTitle: b.taskTitle,
            status: b.status,
          })),
        },
        actionSummary: `Generated evening schedule plan (${plan.blocks.length} blocks)`,
      };
    }

    case "report_slip_and_replan": {
      const result = handleTaskOverrun(ist.timeStr, ist.dateStr);
      return {
        success: true,
        result: {
          summaryExplanation: result.summaryExplanation,
          protectedDinner: "21:30",
          protectedSleep: "04:30",
        },
        actionSummary: "Rebalanced schedule due to slip while protecting anchors",
      };
    }

    case "log_nutrition": {
      let loggedDescription = "";
      if (args.preset && typeof args.preset === "string") {
        logQuickPresetMeal(args.preset, ist.dateStr);
        loggedDescription = `Preset: ${args.preset}`;
      } else {
        const mealName = String(args.mealName || "Nutritious Meal");
        const calories = typeof args.calories === "number" ? args.calories : 350;
        const protein = typeof args.proteinGrams === "number" ? args.proteinGrams : 25;
        logCustomMeal(mealName, calories, protein, "snack", ist.dateStr);
        loggedDescription = `${mealName} (+${protein}g P, ${calories} kcal)`;
      }

      const updatedSummary: DailyFitnessSummary = getDailyFitnessSummary(ist.dateStr);
      return {
        success: true,
        result: {
          logged: loggedDescription,
          totalProteinToday: updatedSummary.totalProtein,
          proteinTarget: 130,
          totalCaloriesToday: updatedSummary.totalCalories,
          caloriesTarget: 2500,
        },
        actionSummary: `Logged nutrition (${loggedDescription})`,
      };
    }

    case "get_fitness_summary": {
      const summary = getDailyFitnessSummary(ist.dateStr);
      return {
        success: true,
        result: {
          date: summary.date,
          totalProtein: summary.totalProtein,
          targetProtein: 130,
          proteinRemaining: Math.max(0, 130 - summary.totalProtein),
          totalCalories: summary.totalCalories,
          targetCalories: 2500,
          mealCount: summary.meals.length,
          meals: summary.meals.map((m) => ({
            name: m.mealName,
            protein: m.proteinGrams,
            calories: m.calories,
            time: m.loggedAt,
          })),
        },
        actionSummary: "Retrieved daily fitness & macro summary",
      };
    }

    case "trello_action": {
      const action = String(args.action || "sync");
      if (action === "delegate") {
        const pending = findPendingTasks();
        let taskToDelegate = pending[0];
        if (args.taskTitle && typeof args.taskTitle === "string") {
          const found = pending.find((t) =>
            t.title.toLowerCase().includes(String(args.taskTitle).toLowerCase())
          );
          if (found) taskToDelegate = found;
        }

        if (!taskToDelegate) {
          return {
            success: false,
            result: { message: "No task available in backlog to delegate to Trello." },
            actionSummary: "Attempted Trello delegation but backlog is empty",
          };
        }

        const card = await delegateTaskToTrello(taskToDelegate);
        return {
          success: Boolean(card),
          result: {
            taskTitle: taskToDelegate.title,
            cardCreated: Boolean(card),
            cardId: card?.id,
          },
          actionSummary: `Delegated "${taskToDelegate.title}" to Trello board`,
        };
      } else {
        const syncRes = await syncTrelloTaskCompletions();
        return {
          success: true,
          result: syncRes,
          actionSummary: "Synchronized completed tasks from Trello",
        };
      }
    }

    case "search_memory": {
      const query = String(args.query || "").trim();
      const memories = searchMemories(query, 5);
      const contextual = retrieveContextualMemories(query, 5);
      const combined = Array.from(new Set([...memories, ...contextual])).slice(0, 6);
      return {
        success: true,
        result: {
          count: combined.length,
          memories: combined.map((m) => ({
            category: m.category,
            content: m.content,
            importance: m.importance,
            createdAt: m.createdAt,
          })),
        },
        actionSummary: `Searched memory for "${query}"`,
      };
    }

    case "save_memory": {
      const category = (args.category as MemoryCategory) || "fact";
      const content = String(args.content || "").trim();
      const importance = typeof args.importance === "number" ? args.importance : 3;

      if (!content) {
        return {
          success: false,
          result: { message: "Memory content cannot be empty." },
          actionSummary: "Skipped empty memory save",
        };
      }

      const saved = await recordMemory(category, content, "chat", { importance });
      return {
        success: true,
        result: {
          id: saved.id,
          category: saved.category,
          content: saved.content,
        },
        actionSummary: `Saved new memory: "${content.slice(0, 35)}..."`,
      };
    }

    case "solve_academic_problem": {
      const content = String(args.content || "").trim();
      const subject = args.subject ? String(args.subject).trim() : undefined;
      const taskId = args.taskId ? String(args.taskId).trim() : undefined;

      if (!content) {
        return {
          success: false,
          result: { error: "Content / assignment prompt cannot be empty." },
          actionSummary: "Failed to solve problem: empty content",
        };
      }

      const report = await solveAcademicProblem(content, subject, taskId);
      return {
        success: true,
        result: {
          reportId: report.id,
          subject: report.subject,
          experimentNumber: report.experimentNumber,
          title: report.title,
          sourceCodeLanguage: report.sourceCode.language,
          htmlReportPath: report.htmlReportPath,
          vivaQuestionsCount: report.vivaQuestions.length,
        },
        actionSummary: `Auto-solved [${report.subject}] Exp ${report.experimentNumber}: "${report.title}"`,
      };
    }

    case "synthesize_custom_tool": {
      const name = String(args.name || "").trim();
      const description = String(args.description || "").trim();
      const requirements = args.requirements ? String(args.requirements).trim() : undefined;
      const code = args.code ? String(args.code).trim() : undefined;

      if (!name || !description) {
        return {
          success: false,
          result: { error: "Tool name and description are required." },
          actionSummary: "Failed to synthesize tool: missing name or description",
        };
      }

      const synthesized = await synthesizeTool({
        name,
        description,
        requirements,
        code,
        author: "autonomous_agent",
      });

      return {
        success: true,
        result: {
          id: synthesized.id,
          name: synthesized.name,
          description: synthesized.description,
          parameters: synthesized.parameters,
        },
        actionSummary: `Synthesized dynamic custom tool "${synthesized.name}"`,
      };
    }

    case "execute_custom_tool": {
      const targetTool = String(args.toolName || "").trim();
      const toolArgs = (args.args as Record<string, unknown>) || {};

      if (!targetTool) {
        return {
          success: false,
          result: { error: "toolName is required." },
          actionSummary: "Failed to execute custom tool: missing toolName",
        };
      }

      const execResult = await executeSynthesizedTool(targetTool, toolArgs);
      return {
        success: execResult.success,
        result: execResult.result ?? { error: execResult.error },
        actionSummary: execResult.success
          ? `Executed synthesized tool "${targetTool}" in ${execResult.durationMs}ms`
          : `Failed executing custom tool "${targetTool}": ${execResult.error}`,
      };
    }

    case "run_nightly_reflection": {
      const date = args.date ? String(args.date).trim() : undefined;
      const reflection = await runNightlyMetaCognitionReflection(date);
      return {
        success: true,
        result: {
          auditDate: reflection.auditDate,
          tasksCompleted: reflection.velocityMetrics.completedTaskCount,
          velocityRatio: reflection.velocityMetrics.ratio,
          dinnerRespected: reflection.anchorAudit.dinnerAnchorRespected,
          sleepRespected: reflection.anchorAudit.sleepAnchorRespected,
          tomorrowBlocks: reflection.tomorrowDraft.blocksScheduled,
          summary: reflection.reflectionSummary,
        },
        actionSummary: `Executed nightly meta-cognition audit for ${reflection.auditDate}`,
      };
    }

    default: {
      // Dynamic fallback for synthesized tools invoked directly
      const cleanName = toolName.replace(/^dyn_/, "");
      const dynamicTool = getSynthesizedTool(cleanName);
      if (dynamicTool) {
        const dynExec = await executeSynthesizedTool(dynamicTool.id, args);
        return {
          success: dynExec.success,
          result: dynExec.result ?? { error: dynExec.error },
          actionSummary: dynExec.success
            ? `Executed dynamic tool "${dynamicTool.name}"`
            : `Dynamic tool "${dynamicTool.name}" error: ${dynExec.error}`,
        };
      }

      return {
        success: false,
        result: { error: `Unknown tool: ${toolName}` },
        actionSummary: `Tool call failed: Unknown tool ${toolName}`,
      };
    }
  }
}

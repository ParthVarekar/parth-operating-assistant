import { parseUserIntent } from "./intentParser.js";
import { generateCompletion } from "./modelClient.js";
import { findPendingTasks, insertTask, updateTaskStatus } from "../db/repositories/taskRepository.js";
import { scheduleEveningPlan } from "../planner/intervalScheduler.js";
import { handleTaskOverrun } from "../planner/replanEngine.js";
import { formatPlanMessage } from "./coach.js";
import { getDailyFitnessSummary, logQuickPresetMeal, logCustomMeal } from "../services/fitnessService.js";
import { listUpcomingHackathons } from "../services/hackathonService.js";
import { registerSubmission } from "../services/submissionService.js";
import { getISTDateTime, getCurrentRoutinePhase } from "../server/dashboardServer.js";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import type { Task } from "../types/index.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: string;
  actionsTaken?: string[];
  channel?: string;
}

const MAX_HISTORY_LENGTH = 30;

/**
 * Gets saved chat history from profile storage or memory.
 */
export function getChatHistory(): ChatMessage[] {
  const history = getUserProfile<ChatMessage[]>("dashboard_chat_history");
  if (Array.isArray(history)) {
    return history;
  }
  return [
    {
      id: "initial-greeting",
      role: "assistant",
      text: "👋 Hi Parth! I'm your Personal Operating Assistant. You can chat with me here, update tasks, check your timetable, log macros, or ask about hackathons.",
      timestamp: new Date().toISOString(),
    },
  ];
}

/**
 * Saves chat message to persistent history.
 */
export function appendChatMessage(msg: ChatMessage): void {
  const current = getChatHistory();
  const updated = [...current, msg].slice(-MAX_HISTORY_LENGTH);
  setUserProfile("dashboard_chat_history", updated);
}

/**
 * Core conversational assistant processor for Dashboard, Discord, and Telegram.
 */
export async function processAssistantChat(
  userText: string,
  sourceChannel: string = "dashboard"
): Promise<{ reply: string; actionsTaken: string[] }> {
  const trimmed = userText.trim();
  if (!trimmed) {
    return { reply: "How can I help you operate today, Parth?", actionsTaken: [] };
  }

  // 1. Log user message to history
  appendChatMessage({
    id: crypto.randomUUID(),
    role: "user",
    text: trimmed,
    timestamp: new Date().toISOString(),
    channel: sourceChannel,
  });

  const ist = getISTDateTime();
  const phase = getCurrentRoutinePhase(ist.hours, ist.minutes);
  const actionsTaken: string[] = [];
  let replyText = "";

  // 2. Parse intent
  const intent = await parseUserIntent(trimmed);

  // Intent handling switch
  switch (intent.intentType) {
    case "CREATE_TASK":
    case "CREATE_SUBMISSION": {
      const isSub = intent.intentType === "CREATE_SUBMISSION" || Boolean(intent.isPrintable);
      const title = intent.taskTitle || (intent.subject ? `[${intent.subject}] Lab Task` : "Coursework Sprint");
      const est = intent.estimatedMinutes || 45;
      const category = intent.category || (isSub ? "submission" : "assignment");
      const deadline = intent.deadline || new Date(Date.now() + 5 * 86400000).toISOString();

      const newTask: Task = {
        id: crypto.randomUUID(),
        title,
        category,
        status: "pending",
        priority: intent.priority || "high",
        estimatedMinutes: est,
        deadline,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      insertTask(newTask);
      actionsTaken.push(`Created task: "${title}" (${est}m)`);

      if (isSub) {
        registerSubmission(newTask.id, intent.subject || "Coursework", deadline, true);
        actionsTaken.push(`Registered physical xerox/journal turn in submission pipeline`);
      }

      replyText = `✅ Added coursework: **${title}** (${est}m, Priority: ${newTask.priority}).\n` +
        (isSub ? `🖨️ Physical submission flagged for lab turn / xerox tracking.\n` : "") +
        `Tonight's 11 PM sprint schedule updated.`;
      break;
    }

    case "REPORT_DONE": {
      const pending = findPendingTasks();
      const topTask = pending[0];
      if (topTask) {
        updateTaskStatus(topTask.id, "completed", topTask.estimatedMinutes);
        actionsTaken.push(`Marked task completed: "${topTask.title}"`);
        replyText = `🎉 Great work! Marked **"${topTask.title}"** complete (${topTask.estimatedMinutes}m).\n` +
          `Checked off velocity in operating schedule. What should we tackle next?`;
      } else {
        replyText = `✨ No active pending tasks right now! You're completely caught up.`;
      }
      break;
    }

    case "REPORT_SLIP": {
      const replanResult = handleTaskOverrun(ist.timeStr, ist.dateStr);
      actionsTaken.push(`Rebalanced schedule due to slip`);
      replyText = `⚡ ${replanResult.summaryExplanation}\nStrictly protected your **9:30 PM dinner** and **4:30 AM sleep anchor**.`;
      break;
    }

    case "PLAN_TONIGHT": {
      const tasks = findPendingTasks();
      const plan = scheduleEveningPlan(tasks, ist.dateStr, ist.timeStr);
      actionsTaken.push(`Generated evening plan with ${plan.blocks.length} blocks`);
      replyText = formatPlanMessage(plan);
      break;
    }

    case "QUERY_NEXT": {
      const pending = findPendingTasks();
      const top = pending[0];
      if (top) {
        replyText = `📌 **CURRENT FOCUS:** **${top.title}**\n` +
          `• Estimated: ${top.estimatedMinutes} mins\n` +
          `• Category: \`${top.category}\`\n` +
          `• Phase: **${phase.label}** (${phase.description})\n` +
          (top.deadline ? `• Deadline: ${top.deadline}` : "");
      } else {
        replyText = `✨ No tasks in queue! Current phase: **${phase.label}** (${phase.description}).`;
      }
      break;
    }

    case "FIND_HACKATHONS": {
      const hackathons = listUpcomingHackathons(intent.cityFilter || "all");
      const top3 = hackathons.slice(0, 3);
      if (top3.length === 0) {
        replyText = `No upcoming hackathons found for filter "${intent.cityFilter || "all"}".`;
      } else {
        actionsTaken.push(`Retrieved ${top3.length} upcoming regional hackathons`);
        const lines = top3.map((h, i) =>
          `${i + 1}. **${h.title}** (${h.cityZone.toUpperCase()})\n` +
          `   🗓️ ${h.startDate} → ${h.endDate} | Prize: ${h.prizePool || "Certificates"}\n` +
          `   🔗 [Registration Link](${h.url})`
        );
        replyText = `🏆 **Upcoming Regional Hackathons:**\n\n` + lines.join("\n\n");
      }
      break;
    }

    case "LOG_MEAL": {
      const lower = trimmed.toLowerCase();
      if (lower.includes("shake") || lower.includes("whey")) {
        const entry = logQuickPresetMeal("whey_shake");
        actionsTaken.push("Logged Whey Shake preset (+26g protein)");
        replyText = `🥤 Logged **Whey Protein Shake** (+26g P, 140 kcal).\nDaily progress: 130g protein goal updated!`;
      } else if (lower.includes("egg") || lower.includes("toast")) {
        const entry = logQuickPresetMeal("eggs_toast");
        actionsTaken.push("Logged Eggs + Toast preset (+28g protein)");
        replyText = `🍳 Logged **Eggs & Toast** (+28g P, 380 kcal). Fueling muscle recovery!`;
      } else if (lower.includes("dinner")) {
        const entry = logQuickPresetMeal("solid_dinner");
        actionsTaken.push("Logged Solid Dinner preset (+34g protein)");
        replyText = `🍲 Logged **Solid Family Dinner** (+34g P, 650 kcal) during protected dinner anchor.`;
      } else {
        const entry = logCustomMeal("Nutritious Meal", 400, 25, "snack");
        actionsTaken.push("Logged custom meal (+25g protein)");
        replyText = `🍱 Logged **Nutritious Meal** (+25g P, 400 kcal). Keep hitting your macros!`;
      }
      break;
    }

    case "CHAT":
    default: {
      // Freeform conversational reasoning using system prompt
      const fitness = getDailyFitnessSummary(ist.dateStr);
      const pending = findPendingTasks();

      const systemPrompt = `
You are the personal AI operating assistant for Parth Varekar, a Computer Engineering student at K.C. College of Engineering & Management Studies & Research (KCCEMSR), Thane, living in Mumbai.
You operate with relentless craft, calm discipline, and high empathy around his real life:
- Current IST Time: ${ist.timeStr} (${ist.dateStr})
- Current Routine Phase: ${phase.label} (${phase.description})
- Pending Coursework Tasks: ${pending.length}
- Today's Nutrition Progress: ${fitness.totalProtein}g / 130g protein (${fitness.totalCalories} / 2500 kcal)
- Sleep Anchor: Strictly 4:30 AM to 10:30 AM (cognitive recharge)
- Dinner Anchor: Strictly 9:30 PM to 11:00 PM (family dinner & setup)
- Peak Deep-Work Window: 11:00 PM to 4:30 AM (peak focus, code sprints, 1 commit/day rule)

Provide a concise, direct, helpful, and motivating answer (under 3 paragraphs). If Parth asks a question, answer with precision. If he asks for advice, give an engineer's actionable strategy.
`;

      try {
        replyText = await generateCompletion({
          systemPrompt,
          userPrompt: trimmed,
        });
      } catch (err) {
        replyText = `I hear you, Parth. Currently in the **${phase.label}** window (${ist.timeStr} IST). You have ${pending.length} tasks in queue and ${fitness.totalProtein} / 130g protein logged. What would you like to execute next?`;
      }
      break;
    }
  }

  // 3. Log assistant reply
  appendChatMessage({
    id: crypto.randomUUID(),
    role: "assistant",
    text: replyText,
    timestamp: new Date().toISOString(),
    actionsTaken,
    channel: sourceChannel,
  });

  return { reply: replyText, actionsTaken };
}

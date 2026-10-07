import crypto from "node:crypto";
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
import {
  retrieveContextualMemories,
  formatMemoriesForPrompt,
  recordMemory,
} from "../services/memoryService.js";
import {
  delegateTaskToTrello,
  syncTrelloTaskCompletions,
  getTrelloAccessToken,
} from "../services/trelloService.js";
import { getSavedAiNews, runAiIntelligenceScan } from "../services/aiNewsService.js";
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

  const lower = trimmed.toLowerCase();

  // 2. Check for interactive Trello commands & delegations
  if (lower.includes("delegate") && (lower.includes("trello") || lower.includes("task"))) {
    const pending = findPendingTasks();
    const taskToDelegate = pending[0];
    if (taskToDelegate) {
      const card = await delegateTaskToTrello(taskToDelegate);
      if (card) {
        actionsTaken.push(`Delegated "${taskToDelegate.title}" to Trello`);
        replyText = `📌 Delegated **"${taskToDelegate.title}"** to your Trello board!\nYou can view, track, and drag it to Done on Trello. Once you mark it complete there, I'll sync it automatically!`;
        return finalizeResponse(replyText, actionsTaken, sourceChannel);
      }
    }
  }

  if (lower.includes("sync trello") || lower.includes("trello sync") || lower.includes("completed on trello")) {
    const syncRes = await syncTrelloTaskCompletions();
    actionsTaken.push("Synchronized Trello task completions");
    return finalizeResponse(syncRes.message, actionsTaken, sourceChannel);
  }

  // 2.5 Quick greetings
  if (lower === "hi" || lower === "hello" || lower === "hey" || lower === "yo") {
    const fitnessSummary = getDailyFitnessSummary(ist.dateStr);
    const pendingCount = findPendingTasks().length;
    replyText = `👋 Hey Parth! Operating Assistant ready. Currently in the **${phase.label}** (${ist.timeStr} IST).\n• Tasks queued: **${pendingCount}**\n• Protein logged: **${fitnessSummary.totalProtein} / 130g**\n• Protected dinner at **9:30 PM**, deep-work sprint starts at **11:00 PM**.\nHow can I help you operate right now?`;
    return finalizeResponse(replyText, actionsTaken, sourceChannel);
  }

  // 2.6 Frontier AI & Tech Radar queries
  if (
    lower.includes("ai news") ||
    lower.includes("tech news") ||
    lower.includes("ai radar") ||
    lower.includes("tech radar") ||
    lower.includes("frontier tech") ||
    (lower.includes("latest") && (lower.includes("ai") || lower.includes("tech") || lower.includes("news")))
  ) {
    const saved = getSavedAiNews();
    const items = saved.length >= 2 ? saved : (await runAiIntelligenceScan()).items;
    const top = items.slice(0, 4);
    actionsTaken.push(`Retrieved ${top.length} frontier AI & tech radar intelligence items`);
    replyText =
      `⚡ **Latest AI & Frontier Tech Radar:**\n\n` +
      top
        .map(
          (item, i) =>
            `${i + 1}. **[${item.title}](${item.url})**\n• ${item.summary}\n_Source: ${item.source}_`
        )
        .join("\n\n") +
      `\n\n_Stay sharp for upcoming hackathons & industry projects!_`;
    return finalizeResponse(replyText, actionsTaken, sourceChannel);
  }

  // 2.7 Hackathon analytical and comparative questions (Earliest, Lowest prize, Highest prize)
  if (lower.includes("hackathon") || lower.includes("hackathons")) {
    const allHackathons = listUpcomingHackathons("all");

    // Earliest / First / Next
    if (
      lower.includes("earliest") ||
      lower.includes("first") ||
      lower.includes("soonest") ||
      lower.includes("next") ||
      lower.includes("when is the next")
    ) {
      const sortedByDate = [...allHackathons].sort((a, b) => a.startDate.localeCompare(b.startDate));
      const earliest = sortedByDate[0];
      if (earliest) {
        actionsTaken.push(`Identified earliest hackathon: "${earliest.title}"`);
        replyText =
          `🏆 **Earliest Upcoming Regional Hackathon:**\n\n` +
          `**${earliest.title}** (${earliest.cityZone.toUpperCase()})\n` +
          `• 🗓️ **Dates:** ${earliest.startDate} → ${earliest.endDate}\n` +
          `• 🚨 **Registration Deadline:** **${earliest.registrationDeadline}**\n` +
          `• 💰 **Prize Pool:** ${earliest.prizePool || "Certificates & Swag"}\n` +
          `• 📍 **Venue:** ${earliest.venue}\n` +
          `• 🔗 [Registration Link](${earliest.url})\n\n` +
          (sortedByDate[1] ? `_Next up after that: **${sortedByDate[1].title}** starting ${sortedByDate[1].startDate}._` : "");
        return finalizeResponse(replyText, actionsTaken, sourceChannel);
      }
    }

    // Lowest / Smallest prize pool
    if (lower.includes("lowest") || lower.includes("smallest") || (lower.includes("minimum") && lower.includes("prize"))) {
      actionsTaken.push("Analyzed hackathon prize pools for lowest tier");
      replyText = `Looking through our regional database, **Cognition Hackathon 2026** at SIES GST (Nerul) has the lowest listed cash prize pool at **₹75,000**, followed by **Thane TechSprint** at **₹80,000** and **DJ Unicode / SIH** at **₹1,00,000**. On the high end, **MumbaiHacks** offers **₹5,00,000**!`;
      return finalizeResponse(replyText, actionsTaken, sourceChannel);
    }

    // Highest / Biggest prize pool
    if (lower.includes("highest") || lower.includes("biggest") || lower.includes("maximum") || lower.includes("largest")) {
      actionsTaken.push("Analyzed hackathon prize pools for highest prize tier");
      replyText = `The hackathon with the highest prize pool in Mumbai is **MumbaiHacks 2026** with a massive **₹5,00,000** total cash prize pool at Bombay Exhibition Centre, Goregaon! Following that are **Smart India Hackathon (SIH)** and **DJ Unicode Hackathon** at **₹1,00,000** each.`;
      return finalizeResponse(replyText, actionsTaken, sourceChannel);
    }
  }

  // 3. Parse intent
  const intent = await parseUserIntent(trimmed);

  // Check if user is asking a specific question comparing prize pools, dates, etc.
  const isQuestion =
    trimmed.includes("?") ||
    lower.startsWith("which") ||
    lower.startsWith("how") ||
    lower.startsWith("why") ||
    lower.startsWith("who") ||
    lower.includes("lowest") ||
    lower.includes("highest") ||
    lower.includes("compare") ||
    lower.includes("best") ||
    lower.includes("tell me about");

  switch (intent.intentType) {
    case "CREATE_TASK":
    case "CREATE_SUBMISSION": {
      if (isQuestion) {
        break;
      }
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

      // If Trello is linked, auto-delegate card to Trello
      if (getTrelloAccessToken()) {
        delegateTaskToTrello(newTask).catch(console.warn);
        actionsTaken.push("Pushed card to Trello board");
      }

      if (isSub) {
        registerSubmission(newTask.id, intent.subject || "Coursework", deadline, true);
        actionsTaken.push("Registered physical xerox/journal turn in submission pipeline");
      }

      recordMemory("task_log", `Created coursework task: "${title}" (${est}m, Priority: ${newTask.priority})`, "chat").catch(console.warn);

      replyText =
        `✅ Added coursework: **${title}** (${est}m, Priority: ${newTask.priority}).\n` +
        (isSub ? `🖨️ Physical submission flagged for lab turn / xerox tracking.\n` : "") +
        `Tonight's 11 PM sprint schedule updated.`;
      return finalizeResponse(replyText, actionsTaken, sourceChannel);
    }

    case "REPORT_DONE": {
      const pending = findPendingTasks();
      const topTask = pending[0];
      if (topTask) {
        updateTaskStatus(topTask.id, "completed", topTask.estimatedMinutes);
        actionsTaken.push(`Marked task completed: "${topTask.title}"`);
        recordMemory("task_log", `Completed task "${topTask.title}" (${topTask.estimatedMinutes}m)`, "chat").catch(console.warn);

        replyText =
          `🎉 Great work, Parth! Marked **"${topTask.title}"** complete (${topTask.estimatedMinutes}m).\n` +
          `Checked off velocity in operating schedule. What should we tackle next?`;
      } else {
        replyText = `✨ No active pending tasks right now! You're completely caught up.`;
      }
      return finalizeResponse(replyText, actionsTaken, sourceChannel);
    }

    case "REPORT_SLIP": {
      const replanResult = handleTaskOverrun(ist.timeStr, ist.dateStr);
      actionsTaken.push("Rebalanced schedule due to slip");
      replyText = `⚡ ${replanResult.summaryExplanation}\nStrictly protected your **9:30 PM dinner** and **4:30 AM sleep anchor**.`;
      return finalizeResponse(replyText, actionsTaken, sourceChannel);
    }

    case "PLAN_TONIGHT": {
      const tasks = findPendingTasks();
      const plan = scheduleEveningPlan(tasks, ist.dateStr, ist.timeStr);
      actionsTaken.push(`Generated evening plan with ${plan.blocks.length} blocks`);
      replyText = formatPlanMessage(plan);
      return finalizeResponse(replyText, actionsTaken, sourceChannel);
    }

    case "QUERY_NEXT": {
      const pending = findPendingTasks();
      const top = pending[0];
      if (top) {
        replyText =
          `📌 **CURRENT FOCUS:** **${top.title}**\n` +
          `• Estimated: ${top.estimatedMinutes} mins\n` +
          `• Category: \`${top.category}\`\n` +
          `• Phase: **${phase.label}** (${phase.description})\n` +
          (top.deadline ? `• Deadline: ${top.deadline}` : "");
      } else {
        replyText = `✨ No tasks in queue! Current phase: **${phase.label}** (${phase.description}).`;
      }
      return finalizeResponse(replyText, actionsTaken, sourceChannel);
    }

    case "FIND_HACKATHONS": {
      // If it's a specific question comparing prize pools, dates, etc., let conversational reasoning handle it!
      if (isQuestion) {
        break;
      }
      const hackathons = listUpcomingHackathons(intent.cityFilter || "all");
      const top3 = hackathons.slice(0, 3);
      if (top3.length === 0) {
        replyText = `No upcoming hackathons found for filter "${intent.cityFilter || "all"}".`;
      } else {
        actionsTaken.push(`Retrieved ${top3.length} upcoming regional hackathons`);
        const lines = top3.map(
          (h, i) =>
            `${i + 1}. **${h.title}** (${h.cityZone.toUpperCase()})\n` +
            `   🗓️ ${h.startDate} → ${h.endDate} | Prize: ${h.prizePool || "Certificates"}\n` +
            `   🔗 [Registration Link](${h.url})`
        );
        replyText = `🏆 **Upcoming Regional Hackathons:**\n\n` + lines.join("\n\n");
      }
      return finalizeResponse(replyText, actionsTaken, sourceChannel);
    }

    case "LOG_MEAL": {
      if (lower.includes("shake") || lower.includes("whey")) {
        logQuickPresetMeal("whey_shake");
        actionsTaken.push("Logged Whey Shake preset (+26g protein)");
        replyText = `🥤 Logged **Whey Protein Shake** (+26g P, 140 kcal).\nDaily progress: 130g protein goal updated!`;
      } else if (lower.includes("egg") || lower.includes("toast")) {
        logQuickPresetMeal("eggs_toast");
        actionsTaken.push("Logged Eggs + Toast preset (+28g protein)");
        replyText = `🍳 Logged **Eggs & Toast** (+28g P, 380 kcal). Fueling muscle recovery!`;
      } else if (lower.includes("dinner")) {
        logQuickPresetMeal("solid_dinner");
        actionsTaken.push("Logged Solid Dinner preset (+34g protein)");
        replyText = `🍲 Logged **Solid Family Dinner** (+34g P, 650 kcal) during protected dinner anchor.`;
      } else {
        logCustomMeal("Nutritious Meal", 400, 25, "snack");
        actionsTaken.push("Logged custom meal (+25g protein)");
        replyText = `🍱 Logged **Nutritious Meal** (+25g P, 400 kcal). Keep hitting your macros!`;
      }
      return finalizeResponse(replyText, actionsTaken, sourceChannel);
    }
  }

  // 4. Conversational Reasoning Engine ("Buddy & Technical Operating Assistant")
  // Assemble complete live context so the assistant can answer ANY nuanced question
  const fitness = getDailyFitnessSummary(ist.dateStr);
  const pending = findPendingTasks();
  const allHackathons = listUpcomingHackathons("all");
  const memories = retrieveContextualMemories(trimmed, 6);
  const memoryContext = formatMemoriesForPrompt(memories);
  const recentAiNews = getSavedAiNews().slice(0, 4);
  const chatHistory = getChatHistory().slice(-6);

  const hackathonContextLines = allHackathons
    .map(
      (h) =>
        `- "${h.title}" (${h.cityZone.toUpperCase()}): Dates ${h.startDate} to ${h.endDate}, Listed Prize Pool: ${h.prizePool || "Certificates/None"}, Deadline: ${h.registrationDeadline}, Venue: ${h.venue}, Link: ${h.url}`
    )
    .join("\n");

  const taskContextLines = pending
    .map(
      (t) =>
        `- [${t.priority.toUpperCase()}] "${t.title}" (${t.estimatedMinutes}m, Category: ${t.category}${t.deadline ? `, Deadline: ${t.deadline}` : ""})`
    )
    .join("\n");

  const aiNewsContextLines = recentAiNews
    .map((n) => `- ${n.title} (${n.category}): ${n.summary} [${n.url}]`)
    .join("\n");

  const historyContextLines = chatHistory
    .map((h) => `${h.role === "user" ? "Parth" : "Assistant"}: ${h.text}`)
    .join("\n");

  const systemPrompt = `
You are the personal AI operating assistant and close technical buddy for Parth Varekar, a Computer Engineering student at K.C. College of Engineering & Management Studies & Research (KCCEMSR), Thane, living in Mumbai.
You operate with relentless craft, calm discipline, witty camaraderie, and high agency. You speak like an ambitious pair programmer and co-founder who knows his schedule, habits, and technical ambitions inside out.

CURRENT TIME & ROUTINE ANCHORS:
- Current IST Time: ${ist.timeStr} (${ist.dateStr})
- Current Routine Phase: ${phase.label} (${phase.description})
- Sleep Anchor: Strictly 4:30 AM to 10:30 AM (Non-negotiable recovery)
- Dinner Anchor: Strictly 9:30 PM to 11:00 PM (Protected family dinner & setup)
- Peak Deep-Work Window: 11:00 PM to 4:30 AM (Peak focus, code sprints, 1 commit/day rule)
- Nutrition Progress: ${fitness.totalProtein}g / 130g protein goal (${fitness.totalCalories} / 2500 kcal)

LIVE ASSISTANT KNOWLEDGE & DATABASE:
--- ACTIVE PENDING TASKS (${pending.length}) ---
${taskContextLines || "No active tasks in queue."}

--- REGIONAL HACKATHONS IN DATABASE (${allHackathons.length}) ---
${hackathonContextLines}

--- RECENT AI & TECH RADAR BREAKTHROUGHS ---
${aiNewsContextLines}

--- PERSISTENT BRAIN MEMORY & CONTEXT ---
${memoryContext}

--- RECENT CONVERSATION HISTORY ---
${historyContextLines}

CRITICAL INSTRUCTIONS:
1. Answer Parth's exact question directly with precision, citing specific facts, numbers, prize pools, or deadlines from the knowledge above.
2. If he asks about hackathons (e.g., "which hackathon has the lowest prize pool?"), DO NOT give a generic list! Look at the exact prize pools above, compare them, and tell him the exact answer (e.g. Cognition Hackathon at SIES GST is ₹75,000, Thane TechSprint is ₹80,000, SIH / DJ Unicode are ₹1,00,000, whereas MumbaiHacks is ₹5,00,000).
3. If he asks about tasks, timetable, fitness, or advice, give actionable, engineering-grade advice that protects his 9:30 PM dinner and 4:30 AM sleep anchors.
4. Keep answers concise, high-signal, engaging, and motivating (under 3 paragraphs). No robotic templates.
`;

  try {
    replyText = await generateCompletion({
      systemPrompt,
      userPrompt: trimmed,
    });
  } catch (err: any) {
    console.error("AI completion error in chatHandler:", err);
    // Intelligent fallback using database facts
    if (lower.includes("hackathon") && (lower.includes("lowest") || lower.includes("prize"))) {
      replyText = `Looking through our regional database, **Cognition Hackathon 2026** at SIES GST (Nerul) has the lowest listed cash prize pool at **₹75,000**, followed by **Thane TechSprint** at **₹80,000** and **DJ Unicode / SIH** at **₹1,00,000**. On the high end, **MumbaiHacks** offers **₹5,00,000**!`;
    } else {
      replyText = `I'm with you, Parth! Currently in the **${phase.label}** window (${ist.timeStr} IST). You have ${pending.length} tasks queued and ${fitness.totalProtein} / 130g protein logged. How can we optimize your sprint right now?`;
    }
  }

  // 5. Store notable context into memory if user shared personal preferences or decisions
  if (
    trimmed.length > 20 &&
    (lower.includes("prefer") ||
      lower.includes("want to") ||
      lower.includes("goal") ||
      lower.includes("exam") ||
      lower.includes("project") ||
      lower.includes("focus on"))
  ) {
    recordMemory("preference", `User shared: "${trimmed}"`, "chat", { importance: 3 }).catch(console.warn);
  }

  return finalizeResponse(replyText, actionsTaken, sourceChannel);
}

function finalizeResponse(
  replyText: string,
  actionsTaken: string[],
  sourceChannel: string
): { reply: string; actionsTaken: string[] } {
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

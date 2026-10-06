import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import { getEnv } from "../config/env.js";
import { findPendingTasks, insertTask, updateTaskStatus } from "../db/repositories/taskRepository.js";
import { advanceStage, inspectPhysicalSubmissionRequirements, registerSubmission } from "../services/submissionService.js";
import { scheduleEveningPlan } from "../planner/intervalScheduler.js";
import { handleTaskOverrun, handleTaskSkip } from "../planner/replanEngine.js";
import { formatPlanMessage, formatReplanNotice } from "../agent/coach.js";
import { parseUserIntent } from "../agent/intentParser.js";
import { decomposeMonolith } from "../agent/taskDecomposer.js";
import { generateLearnedProfileSummary, recordTaskCompletionVelocity } from "../services/learningService.js";
import { insertMeal } from "../db/repositories/mealRepository.js";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { registerEventHandler } from "../scheduler/eventHeartbeat.js";
import {
  findHackathonById,
  seedInitialCuratedHackathons,
} from "../db/repositories/hackathonRepository.js";
import {
  listUpcomingHackathons,
  formatHackathonCard,
  formatHackathonListDigest,
  toggleHackathonSaved,
  convertHackathonToTask,
} from "../services/hackathonService.js";
import {
  formatTrelloStatusDigest,
  getTrelloAccessToken,
  syncTrelloBoard,
  getTrelloBoards,
} from "../services/trelloService.js";
import {
  formatClassroomStatusDigest,
  syncClassroomAssignments,
} from "../services/googleClassroomService.js";
import type { CityZone, SubmissionStage } from "../types/index.js";

/**
 * Creates and configures the Grammy Telegram bot instance.
 * @returns Configured Bot instance.
 */
export function createTelegramBot(): Bot {
  seedInitialCuratedHackathons();
  const env = getEnv();
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  const mainKeyboard = new Keyboard()
    .text("📋 What's Next?").text("🍱 Log Meal")
    .row()
    .text("⚠️ Slipped/Late").text("🔄 Plan Tonight")
    .row()
    .text("🚀 Hackathons").text("📌 Trello Sync")
    .row()
    .text("🎓 Classroom")
    .resized();

  // Authentication Guard Middleware
  bot.use(async (ctx, next) => {
    const allowedId = env.TELEGRAM_ALLOWED_USER_ID;
    if (allowedId !== "0" && ctx.from && ctx.from.id.toString() !== allowedId) {
      return; // Ignore unauthorized messages silently
    }
    // Auto-bind chat ID for proactive push notifications
    if (ctx.from) {
      setUserProfile("telegram_chat_id", ctx.from.id.toString());
    }
    await next();
  });

  // /start Command
  bot.command("start", async (ctx) => {
    await ctx.reply(
      `👋 **Personal AI Operating Assistant Ready**\n\n` +
      `I operate around your real habits: 4:30 AM sleep, 9:30 PM dinner, and physical submission tracking.\n\n` +
      `Talk to me naturally or tap any shortcut below:`,
      { reply_markup: mainKeyboard, parse_mode: "Markdown" }
    );
  });

  // /plan Command & "Plan Tonight"
  const handlePlanCommand = async (ctx: { reply: (text: string, options?: object) => Promise<unknown> }) => {
    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toTimeString().slice(0, 5);
    const tasks = findPendingTasks();
    const plan = scheduleEveningPlan(tasks, today, nowTime);
    const text = formatPlanMessage(plan);
    await ctx.reply(text, { parse_mode: "Markdown" });
  };

  bot.command("plan", handlePlanCommand);
  bot.hears("🔄 Plan Tonight", handlePlanCommand);

  // /next Command & "What's Next?"
  const handleNextCommand = async (ctx: { reply: (text: string, options?: object) => Promise<unknown> }) => {
    const tasks = findPendingTasks();
    const activeTask = tasks[0];

    if (!activeTask) {
      await ctx.reply("✨ All tasks complete! Dinner and sleep slots are protected.", {
        reply_markup: mainKeyboard,
      });
      return;
    }

    const inlineKb = new InlineKeyboard()
      .text("✅ Done", `task_done:${activeTask.id}`)
      .text("⏳ +15m Slip", `task_slip:${activeTask.id}:15`)
      .row()
      .text("⏭️ Skip", `task_skip:${activeTask.id}`)
      .text("🔨 Split Task", `task_split:${activeTask.id}`);

    await ctx.reply(
      `📌 **CURRENT TASK:** ${activeTask.title}\n` +
      `⏳ **Estimated:** ${activeTask.estimatedMinutes} mins | Category: \`${activeTask.category}\`\n` +
      (activeTask.deadline ? `🚨 **Deadline:** ${activeTask.deadline}\n` : ""),
      { reply_markup: inlineKb, parse_mode: "Markdown" }
    );
  };

  bot.command("next", handleNextCommand);
  bot.hears("📋 What's Next?", handleNextCommand);

  // /habits Command
  bot.command("habits", async (ctx) => {
    const summary = generateLearnedProfileSummary();
    await ctx.reply(summary, { parse_mode: "Markdown" });
  });

  // /submissions Command
  bot.command("submissions", async (ctx) => {
    const physical = inspectPhysicalSubmissionRequirements();
    const lines: string[] = ["📑 **Physical Submissions Status:**\n"];

    if (physical.needsPrinting.length === 0 && physical.needsPacking.length === 0) {
      lines.push("No physical printing or packing steps pending!");
    } else {
      for (const p of physical.needsPrinting) {
        lines.push(`🖨️ **Needs Print:** ${p.subject} (Deadline: ${p.hardDeadline ?? "TBD"})`);
      }
      for (const p of physical.needsPacking) {
        lines.push(`🎒 **In Backpack Needed:** ${p.subject}`);
      }
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  // Helper to build hackathon filter keyboard
  const buildHackathonFilterKeyboard = (activeZone?: string): InlineKeyboard => {
    return new InlineKeyboard()
      .text(activeZone === "all" ? "• 🌐 All •" : "🌐 All", "hack_zone:all")
      .text(activeZone === "mumbai" ? "• 📍 Mumbai •" : "📍 Mumbai", "hack_zone:mumbai")
      .row()
      .text(activeZone === "thane" ? "• 📍 Thane •" : "📍 Thane", "hack_zone:thane")
      .text(activeZone === "navimumbai" ? "• 📍 Navi Mumbai •" : "📍 Navi Mumbai", "hack_zone:navimumbai")
      .row()
      .text(activeZone === "pune" ? "• 📍 Pune •" : "📍 Pune", "hack_zone:pune")
      .text(activeZone === "saved" ? "• ⭐ Saved •" : "⭐ Saved", "hack_zone:saved");
  };

  const displayHackathonList = async (
    ctx: Context,
    zoneStr: string = "all",
    isEdit = false
  ) => {
    const isSaved = zoneStr === "saved";
    const zone = isSaved ? undefined : (zoneStr as CityZone | "all");
    const hackathons = listUpcomingHackathons(zone, isSaved);

    const title =
      isSaved
        ? "Your Bookmarked Hackathons"
        : zone && zone !== "all"
        ? `Upcoming Hackathons in ${zone.toUpperCase()}`
        : "Regional Hackathons (Mumbai, Thane, Navi Mumbai, Pune)";

    const text = formatHackathonListDigest(hackathons, title);
    const kb = buildHackathonFilterKeyboard(zoneStr);

    if (hackathons.length > 0) {
      kb.row();
      for (let i = 0; i < Math.min(hackathons.length, 5); i++) {
        const h = hackathons[i]!;
        kb.text(`🔍 #${i + 1}`, `hack_view:${h.id}`);
      }
    }

    if (isEdit && ctx.callbackQuery) {
      await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
    } else {
      await ctx.reply(text, { reply_markup: kb, parse_mode: "Markdown" });
    }
  };

  const displayHackathonCard = async (ctx: Context, hackId: string, isEdit = false) => {
    const hack = findHackathonById(hackId);
    if (!hack) {
      if (isEdit && ctx.callbackQuery) {
        await ctx.editMessageText("Hackathon record not found.");
      } else {
        await ctx.reply("Hackathon record not found.");
      }
      return;
    }

    const text = formatHackathonCard(hack);
    const kb = new InlineKeyboard()
      .text(hack.isBookmarked ? "⭐ Unsave" : "☆ Save", `hack_star:${hack.id}`)
      .text("➕ Add to Schedule", `hack_task:${hack.id}`)
      .row()
      .text("⬅️ Back to List", `hack_zone:${hack.cityZone}`);

    if (isEdit && ctx.callbackQuery) {
      await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
    } else {
      await ctx.reply(text, { reply_markup: kb, parse_mode: "Markdown" });
    }
  };

  // /hackathons Command & "🚀 Hackathons"
  bot.command("hackathons", async (ctx) => {
    await displayHackathonList(ctx, "all");
  });
  bot.hears("🚀 Hackathons", async (ctx) => {
    await displayHackathonList(ctx, "all");
  });

  // /trello Command & "📌 Trello Sync"
  const handleTrelloCommand = async (ctx: Context) => {
    const text = await formatTrelloStatusDigest();
    const token = getTrelloAccessToken();
    const kb = new InlineKeyboard();
    if (token) {
      kb.text("🔄 Sync Cards Now", "trello_sync")
        .row()
        .text("📂 Select Board", "trello_select_board");
    } else {
      kb.text("🔑 How to Connect", "trello_auth_help");
    }
    await ctx.reply(text, { reply_markup: kb, parse_mode: "Markdown" });
  };

  bot.command("trello", handleTrelloCommand);
  bot.hears("📌 Trello Sync", handleTrelloCommand);

  bot.callbackQuery("trello_sync", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Syncing with Trello..." });
    try {
      const result = await syncTrelloBoard();
      await ctx.reply(
        `✅ *Trello Sync Complete!*\n` +
        `• *Board:* ${result.boardName}\n` +
        `• *Tasks Synced:* ${result.syncedTasksCount}\n` +
        `• *Submissions Registered:* ${result.newSubmissionsCount}\n` +
        `• *Completed Tasks:* ${result.completedTasksCount}\n\n` +
        `Your evening schedule and 8-stage pipeline have been updated!`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await ctx.reply(`⚠️ *Trello Sync Failed:* ${String(err)}`);
    }
  });

  bot.callbackQuery("trello_select_board", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const boards = await getTrelloBoards();
      if (boards.length === 0) {
        await ctx.reply("No open Trello boards found on your account.");
        return;
      }
      const kb = new InlineKeyboard();
      for (const b of boards.slice(0, 8)) {
        kb.text(`📋 ${b.name}`, `trello_set_board:${b.id}`).row();
      }
      await ctx.reply("Select the active board to sync with your schedule:", {
        reply_markup: kb,
      });
    } catch (err) {
      await ctx.reply(`⚠️ Could not fetch boards: ${String(err)}`);
    }
  });

  bot.callbackQuery(/^trello_set_board:(.+)$/, async (ctx) => {
    const boardId = ctx.match[1]!;
    await ctx.answerCallbackQuery({ text: "Board selected!" });
    try {
      const result = await syncTrelloBoard(boardId);
      await ctx.reply(
        `✅ *Active Board Set:* ${result.boardName}\n` +
        `Synced ${result.syncedTasksCount} tasks into your schedule!`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await ctx.reply(`⚠️ Error syncing board: ${String(err)}`);
    }
  });

  bot.callbackQuery("trello_auth_help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `🔑 *Connecting Trello:*\n\n` +
      `Run this single command in your terminal:\n` +
      `\`npm run auth:trello\`\n\n` +
      `It will automatically open your browser to authorize your account. Once done, tap *📌 Trello Sync* again!`,
      { parse_mode: "Markdown" }
    );
  });

  // /classroom Command & "🎓 Classroom"
  const handleClassroomCommand = async (ctx: Context) => {
    const text = await formatClassroomStatusDigest();
    const kb = new InlineKeyboard()
      .text("🔄 Sync Coursework Now", "classroom_sync")
      .row()
      .text("ℹ️ How to Connect Feed", "classroom_help");
    await ctx.reply(text, { reply_markup: kb, parse_mode: "Markdown" });
  };

  bot.command("classroom", handleClassroomCommand);
  bot.hears("🎓 Classroom", handleClassroomCommand);

  bot.command("classroom_feed", async (ctx) => {
    const url = ctx.message?.text?.replace(/^\/classroom_feed\s*/, "").trim();
    if (!url || !url.startsWith("http")) {
      await ctx.reply(
        "⚠️ Please provide a valid calendar feed URL:\n`/classroom_feed https://calendar.google.com/.../basic.ics`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    await ctx.reply("🔄 Fetching and parsing Classroom assignments from feed...");
    try {
      const result = await syncClassroomAssignments(url);
      await ctx.reply(
        `✅ *Google Classroom Linked & Synced!*\n\n` +
        `• *Assignments Synced:* ${result.syncedTasksCount}\n` +
        `• *Physical Submissions Identified:* ${result.newSubmissionsCount}\n\n` +
        `Deadlines and printable tasks have been registered into your operating schedule!`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await ctx.reply(`❌ *Failed to sync Classroom feed:* ${String(err)}`);
    }
  });

  bot.callbackQuery("classroom_sync", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Syncing Google Classroom..." });
    try {
      const result = await syncClassroomAssignments();
      await ctx.reply(
        `✅ *Classroom Sync Complete!*\n` +
        `• *Assignments Synced:* ${result.syncedTasksCount}\n` +
        `• *Physical Submissions Added:* ${result.newSubmissionsCount}\n\n` +
        `Schedule updated to protect submission deadlines!`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await ctx.reply(`⚠️ *Classroom Sync Notice:* ${String(err)}`);
    }
  });

  bot.callbackQuery("classroom_help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `🎓 *Connecting Google Classroom (Zero Developer Setup):*\n\n` +
      `1️⃣ Open [Google Calendar](https://calendar.google.com) on your computer.\n` +
      `2️⃣ On the left sidebar under *Other calendars* or *My calendars*, locate your Classroom course.\n` +
      `3️⃣ Click the 3 dots (⋮) ➔ *Settings and sharing*.\n` +
      `4️⃣ Scroll down to *Integrate calendar* and copy the **Secret address in iCal format**.\n` +
      `5️⃣ Simply send that link to this chat or use:\n` +
      `\`/classroom_feed <paste_link_here>\``,
      { parse_mode: "Markdown" }
    );
  });

  // Inline Button Callbacks
  bot.callbackQuery(/^hack_zone:(.+)$/, async (ctx) => {
    const zoneStr = ctx.match[1] ?? "all";
    await ctx.answerCallbackQuery();
    await displayHackathonList(ctx, zoneStr, true);
  });

  bot.callbackQuery(/^hack_view:(.+)$/, async (ctx) => {
    const hackId = ctx.match[1]!;
    await ctx.answerCallbackQuery();
    await displayHackathonCard(ctx, hackId, true);
  });

  bot.callbackQuery(/^hack_star:(.+)$/, async (ctx) => {
    const hackId = ctx.match[1]!;
    const newStatus = toggleHackathonSaved(hackId);
    await ctx.answerCallbackQuery({
      text: newStatus ? "Saved to your bookmarks! ⭐" : "Removed from bookmarks.",
    });
    await displayHackathonCard(ctx, hackId, true);
  });

  bot.callbackQuery(/^hack_task:(.+)$/, async (ctx) => {
    const hackId = ctx.match[1]!;
    const task = convertHackathonToTask(hackId);
    if (task) {
      await ctx.answerCallbackQuery({ text: "Added to your schedule!" });
      await ctx.reply(
        `✅ *Hackathon Task Scheduled!*\n` +
        `Added "*${task.title}*" (45 mins) to your queue.\n` +
        `Deadline locked for *${task.deadline}*. Evening schedule updated!`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.answerCallbackQuery({ text: "Hackathon not found." });
    }
  });
  bot.callbackQuery(/^task_done:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    if (taskId) {
      updateTaskStatus(taskId, "completed", 45);
      recordTaskCompletionVelocity("assignment", 45, 45);
    }
    await ctx.answerCallbackQuery({ text: "Marked done!" });
    await ctx.editMessageText("🎉 Task completed! Recalculating next priority...");
  });

  bot.callbackQuery(/^task_slip:(.+):(\d+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const mins = Number.parseInt(ctx.match[2] ?? "15", 10);
    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toTimeString().slice(0, 5);

    const replan = handleTaskOverrun(nowTime, today, taskId, mins);
    await ctx.answerCallbackQuery({ text: `Added ${mins}m buffer` });
    await ctx.editMessageText(formatReplanNotice(replan.summaryExplanation, replan.plan), {
      parse_mode: "Markdown",
    });
  });

  bot.callbackQuery(/^task_skip:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toTimeString().slice(0, 5);

    if (taskId) {
      const replan = handleTaskSkip(taskId, nowTime, today);
      await ctx.answerCallbackQuery({ text: "Task skipped" });
      await ctx.editMessageText(formatReplanNotice(replan.summaryExplanation, replan.plan), {
        parse_mode: "Markdown",
      });
    }
  });

  bot.callbackQuery(/^task_split:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    await ctx.answerCallbackQuery();
    const tasks = findPendingTasks();
    const target = tasks.find((t) => t.id === taskId);
    if (!target) return;

    const steps = await decomposeMonolith(target.title, target.category);
    const lines = [`🔨 **Decomposition for:** ${target.title}\n`];
    for (let i = 0; i < steps.length; i++) {
      lines.push(`${i + 1}. ${steps[i]}`);
    }
    lines.push(`\n👉 Start with Step 1 right now.`);
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  // Natural Language Messages
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;

    // Ignore unhandled slash commands so they don't get accidentally added as tasks
    if (text.startsWith("/")) {
      return;
    }

    // Handle quick buttons
    if (text === "⚠️ Slipped/Late") {
      const today = new Date().toISOString().slice(0, 10);
      const nowTime = new Date().toTimeString().slice(0, 5);
      const replan = handleTaskOverrun(nowTime, today, undefined, 30);
      await ctx.reply(formatReplanNotice(replan.summaryExplanation, replan.plan), {
        parse_mode: "Markdown",
      });
      return;
    }

    if (text === "🍱 Log Meal") {
      const today = new Date().toISOString().slice(0, 10);
      const nowTime = new Date().toTimeString().slice(0, 5);
      insertMeal({
        id: crypto.randomUUID(),
        date: today,
        mealType: "dinner",
        scheduledTime: nowTime,
        status: "completed",
        loggedAt: new Date().toISOString(),
      });
      await ctx.reply("🍱 Meal logged! Keep fueling your gym recovery.", { reply_markup: mainKeyboard });
      return;
    }

    // Auto-detect pasted Google Classroom iCal feed URLs
    if (text.includes("calendar.google.com/calendar/ical/") || (text.includes("http") && text.includes(".ics"))) {
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        const feedUrl = urlMatch[0];
        await ctx.reply("🔄 Detected Google Classroom calendar feed! Fetching coursework and submissions...");
        try {
          const result = await syncClassroomAssignments(feedUrl);
          await ctx.reply(
            `✅ *Google Classroom Linked & Synced!*\n\n` +
            `• *Assignments Synced:* ${result.syncedTasksCount}\n` +
            `• *Physical Submissions Added:* ${result.newSubmissionsCount}\n\n` +
            `Your daily operating schedule has been updated!`,
            { reply_markup: mainKeyboard, parse_mode: "Markdown" }
          );
          return;
        } catch (err) {
          await ctx.reply(`❌ Could not sync feed: ${String(err)}`);
          return;
        }
      }
    }

    // Process natural language through Intent Parser
    const parsed = await parseUserIntent(text);

    if (parsed.intentType === "CREATE_SUBMISSION") {
      const taskId = crypto.randomUUID();
      insertTask({
        id: taskId,
        title: parsed.taskTitle ?? text,
        category: "submission",
        status: "pending",
        priority: parsed.priority ?? "high",
        estimatedMinutes: parsed.estimatedMinutes ?? 60,
        deadline: parsed.deadline,
      });
      registerSubmission(
        taskId,
        parsed.subject ?? "Engineering Coursework",
        parsed.deadline,
        parsed.isPrintable ?? true
      );
      await ctx.reply(
        `📑 **Submission Registered in 8-Stage Pipeline:**\n` +
        `• **Title:** ${parsed.taskTitle ?? text}\n` +
        `• **Initial Stage:** \`discovered\`\n` +
        `• **Requires Print:** ${parsed.isPrintable ? "Yes 🖨️" : "No"}\n` +
        `\nSchedule updated to protect submission deadline.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (parsed.intentType === "CREATE_TASK") {
      insertTask({
        id: crypto.randomUUID(),
        title: parsed.taskTitle ?? text,
        category: parsed.category ?? "misc",
        status: "pending",
        priority: parsed.priority ?? "medium",
        estimatedMinutes: parsed.estimatedMinutes ?? 45,
        deadline: parsed.deadline,
      });
      await ctx.reply(`✅ **Task Added:** ${parsed.taskTitle ?? text} (${parsed.estimatedMinutes ?? 45}m)`, {
        parse_mode: "Markdown",
      });
      return;
    }

    if (parsed.intentType === "FIND_HACKATHONS") {
      await displayHackathonList(ctx, parsed.cityFilter ?? "all");
      return;
    }

    if (parsed.intentType === "REPORT_SLIP") {
      const today = new Date().toISOString().slice(0, 10);
      const nowTime = new Date().toTimeString().slice(0, 5);
      const replan = handleTaskOverrun(nowTime, today, undefined, parsed.slipMinutes ?? 30);
      await ctx.reply(formatReplanNotice(replan.summaryExplanation, replan.plan), {
        parse_mode: "Markdown",
      });
      return;
    }

    await ctx.reply(parsed.responseMessage, { parse_mode: "Markdown" });
  });

  const getTargetChatId = (): string | null => {
    if (env.TELEGRAM_ALLOWED_USER_ID !== "0") {
      return env.TELEGRAM_ALLOWED_USER_ID;
    }
    return getUserProfile<string>("telegram_chat_id");
  };

  // Register scheduler proactive event push to Telegram
  registerEventHandler("TROUGH_CHECKIN", async () => {
    const targetId = getTargetChatId();
    if (targetId) {
      await bot.api.sendMessage(
        targetId,
        "👋 **Post-College Transition:** You have ~2 hours before dinner at 9:30 PM. Rest or review printable submissions.",
        { reply_markup: mainKeyboard, parse_mode: "Markdown" }
      );
    }
  });

  registerEventHandler("PRINT_WARNING", async () => {
    const targetId = getTargetChatId();
    if (targetId) {
      await bot.api.sendMessage(
        targetId,
        "🖨️ **Print Alert:** You have an assignment that requires printing before college tomorrow! Don't leave it until the morning rush.",
        { parse_mode: "Markdown" }
      );
    }
  });

  return bot;
}

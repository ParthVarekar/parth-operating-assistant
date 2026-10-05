import { Bot, InlineKeyboard, Keyboard } from "grammy";
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
import { registerEventHandler } from "../scheduler/eventHeartbeat.js";
import type { SubmissionStage } from "../types/index.js";

/**
 * Creates and configures the Grammy Telegram bot instance.
 * @returns Configured Bot instance.
 */
export function createTelegramBot(): Bot {
  const env = getEnv();
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  const mainKeyboard = new Keyboard()
    .text("📋 What's Next?").text("🍱 Log Meal")
    .row()
    .text("⚠️ Slipped/Late").text("🔄 Plan Tonight")
    .resized();

  // Authentication Guard Middleware
  bot.use(async (ctx, next) => {
    const allowedId = env.TELEGRAM_ALLOWED_USER_ID;
    if (allowedId !== "0" && ctx.from && ctx.from.id.toString() !== allowedId) {
      return; // Ignore unauthorized messages silently
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

  // Inline Button Callbacks
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

  // Register scheduler proactive event push to Telegram
  registerEventHandler("TROUGH_CHECKIN", async (event) => {
    const allowedId = env.TELEGRAM_ALLOWED_USER_ID;
    if (allowedId !== "0") {
      await bot.api.sendMessage(
        allowedId,
        "👋 **Post-College Transition:** You have ~2 hours before dinner at 9:30 PM. Rest or review printable submissions.",
        { reply_markup: mainKeyboard, parse_mode: "Markdown" }
      );
    }
  });

  registerEventHandler("PRINT_WARNING", async (event) => {
    const allowedId = env.TELEGRAM_ALLOWED_USER_ID;
    if (allowedId !== "0") {
      await bot.api.sendMessage(
        allowedId,
        "🖨️ **Print Alert:** You have an assignment that requires printing before college tomorrow! Don't leave it until the morning rush.",
        { parse_mode: "Markdown" }
      );
    }
  });

  return bot;
}

import { getISTDateTime, getCurrentRoutinePhase } from "../server/dashboardServer.js";
import { findBlocksByDate } from "../db/repositories/scheduleRepository.js";
import { findPendingTasks } from "../db/repositories/taskRepository.js";
import { handleTaskOverrun } from "../planner/replanEngine.js";
import { findHackathonsByCity } from "../db/repositories/hackathonRepository.js";
import { getDailyFitnessSummary } from "../services/fitnessService.js";
import { getGitHubActivitySummary, getActiveGitHubUsername } from "../services/githubService.js";
import {
  sendSegregatedDiscordEmbed,
  broadcastProactiveRemarkToDiscord,
} from "../services/discordService.js";
import { appendChatMessage } from "../agent/chatHandler.js";
import { getUserProfile } from "../db/repositories/habitRepository.js";

// Global reference for active Telegram Bot to enable autonomous outreach
let telegramBotInstance: any = null;

export function registerTelegramBotForOutreach(bot: any): void {
  telegramBotInstance = bot;
}

/**
 * Sends a proactive message to Parth on Telegram if a chat ID is registered.
 */
export async function sendTelegramProactiveMessage(markdownText: string): Promise<boolean> {
  const chatId = getUserProfile<string>("telegram_chat_id");
  if (!chatId || !telegramBotInstance) {
    return false;
  }

  try {
    await telegramBotInstance.api.sendMessage(chatId, markdownText, {
      parse_mode: "Markdown",
    });
    return true;
  } catch (err) {
    console.warn("Could not dispatch proactive Telegram message:", err);
    return false;
  }
}

// Track timestamps of last periodic executions
let lastHackathonCheckEpoch = 0;
let lastScheduleCheckEpoch = 0;
let lastGitHubCheckEpoch = 0;
let lastMacroNotifiedKey = "";

// Keep track of blocks already notified to prevent duplicate spamming
const notifiedUpcomingBlockIds = new Set<string>();
const notifiedOverrunBlockIds = new Set<string>();

let autonomousTimer: NodeJS.Timeout | null = null;

/**
 * Main autonomous heartbeat tick executed periodically (every 30 seconds).
 */
export async function tickAutonomousHeartbeat(): Promise<void> {
  const now = Date.now();
  const ist = getISTDateTime();
  const phase = getCurrentRoutinePhase(ist.hours, ist.minutes);

  // -------------------------------------------------------------
  // 1. Task Scheduler & Timetable Check (Every 15s - 15 mins)
  // -------------------------------------------------------------
  try {
    const blocks = findBlocksByDate(ist.dateStr);
    const pendingTasks = findPendingTasks();
    const currentMinutes = ist.hours * 60 + ist.minutes;

    for (const block of blocks) {
      const [sh, sm] = block.startTime.split(":").map(Number);
      const [eh, em] = block.endTime.split(":").map(Number);
      if (sh === undefined || sm === undefined || eh === undefined || em === undefined) continue;

      const blockStartMinutes = sh * 60 + sm;
      const blockEndMinutes = eh * 60 + em;

      // Check upcoming block (starts in <= 15 minutes)
      const diffToStart = blockStartMinutes - currentMinutes;
      if (diffToStart > 0 && diffToStart <= 15 && !notifiedUpcomingBlockIds.has(block.id)) {
        notifiedUpcomingBlockIds.add(block.id);

        const title = `⏳ Focus Sprint Approaching in ${diffToStart}m`;
        const desc = `**${block.taskTitle || "Scheduled Sprint"}** (${block.startTime} – ${block.endTime})\n` +
          `Phase: *${phase.label}*. Prepare your workspace and materials.`;

        // Dispatch to Discord #schedule-planner
        await sendSegregatedDiscordEmbed("schedule", {
          title,
          description: desc,
        });

        // Dispatch to Telegram
        await sendTelegramProactiveMessage(`⏳ *Focus Sprint in ${diffToStart}m*\n**${block.taskTitle}** (${block.startTime} – ${block.endTime})\nPrepare Casio FX-991CW and journal sheets.`);

        // Append to Dashboard Chat
        appendChatMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: `⏳ **Upcoming Sprint in ${diffToStart}m:** ${block.taskTitle || "Focus Sprint"} (${block.startTime} – ${block.endTime})`,
          timestamp: new Date().toISOString(),
          channel: "schedule",
        });
      }

      // Check task overrun (block has passed but task is not completed)
      if (
        currentMinutes > blockEndMinutes + 5 &&
        block.status !== "completed" &&
        !notifiedOverrunBlockIds.has(block.id)
      ) {
        notifiedOverrunBlockIds.add(block.id);

        // Run replan engine
        const replanResult = handleTaskOverrun(ist.timeStr, ist.dateStr);

        const title = "⚠️ Schedule Drift / Overrun Detected";
        const desc =
          `Block **"${block.taskTitle || "Sprint"}"** exceeded its window (${block.startTime} – ${block.endTime}).\n` +
          `⚡ **Automatic Replan Triggered:** ${replanResult.summaryExplanation}`;

        // Dispatch to Discord #schedule-planner
        await sendSegregatedDiscordEmbed("schedule", {
          title,
          description: desc,
        });

        // Dispatch to Telegram
        await sendTelegramProactiveMessage(
          `⚠️ *Schedule Drift Detected*\nTask *${block.taskTitle}* ran over.\n${replanResult.summaryExplanation}`
        );

        // Append to Dashboard Chat
        appendChatMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: `⚠️ **Task Overrun Rebalanced:** ${replanResult.summaryExplanation}`,
          timestamp: new Date().toISOString(),
          channel: "schedule",
        });
      }
    }
  } catch (schedErr) {
    console.error("Error in timetable heartbeat check:", schedErr);
  }

  // -------------------------------------------------------------
  // 2. Hackathon Ingestion & Countdown Monitor (Every 2 hours)
  // -------------------------------------------------------------
  if (now - lastHackathonCheckEpoch > 2 * 3600000) {
    lastHackathonCheckEpoch = now;
    try {
      const hackathons = findHackathonsByCity(["mumbai", "thane", "navimumbai", "pune"]);
      const urgentDeadlines = hackathons.filter((h) => {
        const deadlineDate = new Date(h.registrationDeadline).getTime();
        const diffDays = (deadlineDate - now) / 86400000;
        return diffDays > 0 && diffDays <= 3;
      });

      if (urgentDeadlines.length > 0) {
        const topUrgent = urgentDeadlines[0]!;
        const title = `🚨 Hackathon Registration Closes Soon: ${topUrgent.title}`;
        const desc =
          `**Circuit:** ${topUrgent.cityZone.toUpperCase()}\n` +
          `**Registration Deadline:** **${topUrgent.registrationDeadline}**\n` +
          `**Prizes:** ${topUrgent.prizePool || "Cash & Swag"}\n\n` +
          `👉 [Register Now](${topUrgent.url})`;

        await sendSegregatedDiscordEmbed("hackathons", {
          title,
          description: desc,
        });

        await sendTelegramProactiveMessage(`🚨 *Hackathon Alert*\n*${topUrgent.title}* closes registration on *${topUrgent.registrationDeadline}*!\n[Register here](${topUrgent.url})`);
      }
    } catch (hackErr) {
      console.error("Error in hackathon heartbeat monitor:", hackErr);
    }
  }

  // -------------------------------------------------------------
  // 3. GitHub History & Deep-Work Streak Checker (Every 30 mins)
  // -------------------------------------------------------------
  if (now - lastGitHubCheckEpoch > 30 * 60000) {
    lastGitHubCheckEpoch = now;
    try {
      const ghUsername = getActiveGitHubUsername();
      // Only check during evening / night deep-work (18:00 - 04:30)
      const isEveningOrNight = ist.hours >= 18 || ist.hours < 5;

      if (ghUsername && isEveningOrNight) {
        const gh = await getGitHubActivitySummary(ghUsername);

        // If in deep-work (after 23:30) and 0 commits today
        if ((ist.hours >= 23 || ist.hours < 4) && gh.commitsToday === 0) {
          const key = `gh_alert_${ist.dateStr}`;
          if (lastMacroNotifiedKey !== key) {
            lastMacroNotifiedKey = key;

            const title = "🐙 Night Sprint: Daily Commit Check";
            const desc =
              `No commits recorded today for **${ghUsername}**.\n` +
              `Remember your **1-commit-a-day streak rule** for tonight's 45m deep-work repository block!`;

            await sendSegregatedDiscordEmbed("github", {
              title,
              description: desc,
            });

            await sendTelegramProactiveMessage(`🐙 *Night Sprint Commit Check*\nNo commits yet today for ${ghUsername}. Keep your daily commit streak alive tonight!`);
          }
        }
      }
    } catch (ghErr) {
      console.error("Error in GitHub heartbeat monitor:", ghErr);
    }
  }

  // -------------------------------------------------------------
  // 4. Daily Nutrition Checkpoints (18:30, 21:30, 23:00)
  // -------------------------------------------------------------
  try {
    const fitness = getDailyFitnessSummary(ist.dateStr);

    // 6:30 PM (Gym & Trough window)
    if (ist.hours === 18 && ist.minutes >= 30 && ist.minutes <= 45) {
      const key = `nutrition_gym_${ist.dateStr}`;
      if (lastMacroNotifiedKey !== key) {
        lastMacroNotifiedKey = key;
        await sendSegregatedDiscordEmbed("fitness", {
          title: "🏋️ Gym & Commute Window Active",
          description: `Current protein: **${fitness.totalProtein} / 130g** (${fitness.totalCalories} kcal).\nFuel up for evening gym split!`,
        });
      }
    }

    // 9:30 PM (Dinner Anchor)
    if (ist.hours === 21 && ist.minutes >= 30 && ist.minutes <= 45) {
      const key = `nutrition_dinner_${ist.dateStr}`;
      if (lastMacroNotifiedKey !== key) {
        lastMacroNotifiedKey = key;
        await sendSegregatedDiscordEmbed("fitness", {
          title: "🍲 Protected Dinner Anchor (9:30 PM)",
          description: `Enjoy family dinner! Remember to log your solid meal for the 130g protein target.\nCurrent: **${fitness.totalProtein}g P**.`,
        });
      }
    }

    // 11:00 PM (Night Deep-Work setup)
    if (ist.hours === 23 && ist.minutes <= 15) {
      const key = `deepwork_start_${ist.dateStr}`;
      if (lastMacroNotifiedKey !== key) {
        lastMacroNotifiedKey = key;

        await broadcastProactiveRemarkToDiscord(
          "🌙 Night Deep-Work Protocol Initiated",
          `11:00 PM – 4:30 AM focus sprint window is active.\n` +
          `• Tasks in backlog: ${findPendingTasks().length}\n` +
          `• Daily Protein: ${fitness.totalProtein} / 130g (Have you had your whey shake?)\n` +
          `• All notifications muted. Build relentlessly.`
        );

        await sendTelegramProactiveMessage(
          `🌙 *Night Deep-Work Protocol Initiated*\n11:00 PM – 4:30 AM peak focus window is live.\nHave you taken your whey shake? Build relentlessly!`
        );
      }
    }
  } catch (nutrErr) {
    console.error("Error in nutrition heartbeat monitor:", nutrErr);
  }
}

/**
 * Starts the autonomous multi-cadence heartbeat loop.
 * @param intervalMs Heartbeat cycle frequency (default 30000ms / 30 seconds).
 */
export function startAutonomousHeartbeat(intervalMs = 30000): void {
  if (autonomousTimer) return;

  // Run initial tick immediately on startup
  tickAutonomousHeartbeat().catch(console.error);

  autonomousTimer = setInterval(() => {
    tickAutonomousHeartbeat().catch(console.error);
  }, intervalMs);

  console.log(`⏱️ Autonomous Heartbeat active (cycling every ${intervalMs / 1000}s). Multi-cadence ingestion & proactive outreach ready.`);
}

/**
 * Stops the autonomous heartbeat loop.
 */
export function stopAutonomousHeartbeat(): void {
  if (autonomousTimer) {
    clearInterval(autonomousTimer);
    autonomousTimer = null;
  }
}

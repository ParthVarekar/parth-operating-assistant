import http from "node:http";
import { getEnv } from "../config/env.js";
import {
  findPendingTasks,
  insertTask,
  updateTaskStatus,
} from "../db/repositories/taskRepository.js";
import {
  findBlocksByDate,
  updateBlockStatus,
} from "../db/repositories/scheduleRepository.js";
import {
  getDailyFitnessSummary,
  logQuickPresetMeal,
  logCustomMeal,
  logWorkoutSession,
  MEAL_PRESETS,
} from "../services/fitnessService.js";
import {
  findHackathonsByCity,
  toggleBookmark,
  seedInitialCuratedHackathons,
} from "../db/repositories/hackathonRepository.js";
import { getPendingPrintItems } from "../services/printBundlerService.js";
import { handleTaskOverrun } from "../planner/replanEngine.js";
import { isWhatsAppConfigured } from "../services/whatsappService.js";
import { getDiscordWebhookUrl } from "../services/discordService.js";
import { getActiveGitHubUsername } from "../services/githubService.js";
import { getTrelloAccessToken } from "../services/trelloService.js";
import { getUserProfile } from "../db/repositories/habitRepository.js";
import type { Task, BlockStatus, CityZone } from "../types/index.js";

const startTimeEpoch = Date.now();

/**
 * Gets current Indian Standard Time (UTC+5:30) date & time information.
 */
export function getISTDateTime(): {
  dateStr: string;
  timeStr: string;
  hours: number;
  minutes: number;
} {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const istOffset = 5.5 * 3600000;
  const ist = new Date(utc + istOffset);

  const year = ist.getFullYear();
  const month = (ist.getMonth() + 1).toString().padStart(2, "0");
  const day = ist.getDate().toString().padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;

  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const timeStr = `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}`;

  return { dateStr, timeStr, hours, minutes };
}

/**
 * Calculates current active routine phase for Parth based on IST time.
 */
export function getCurrentRoutinePhase(hours: number, minutes: number): {
  phase: string;
  label: string;
  description: string;
  icon: string;
  color: string;
} {
  const currentTotal = hours * 60 + minutes;

  // 23:00 (1380) to 04:30 (270)
  if (currentTotal >= 23 * 60 || currentTotal < 4 * 60 + 30) {
    return {
      phase: "DEEP_WORK",
      label: "Night Deep-Work Protocol",
      description: "11:00 PM – 4:30 AM • Peak focus sprint & code building",
      icon: "🌙",
      color: "#10B981",
    };
  }

  // 04:30 to 10:30
  if (currentTotal >= 4 * 60 + 30 && currentTotal < 10 * 60 + 30) {
    return {
      phase: "SLEEP",
      label: "Rest & Recovery Window",
      description: "4:30 AM – 10:30 AM • Sleep anchor & cognitive recharge",
      icon: "💤",
      color: "#6366F1",
    };
  }

  // 10:30 to 18:00
  if (currentTotal >= 10 * 60 + 30 && currentTotal < 18 * 60) {
    return {
      phase: "CAMPUS",
      label: "College & Commute Window",
      description: "KCCEMSR Thane • Lectures, practicals & turn submissions",
      icon: "🏛️",
      color: "#3B82F6",
    };
  }

  // 18:00 to 21:30
  if (currentTotal >= 18 * 60 && currentTotal < 21 * 60 + 30) {
    return {
      phase: "TROUGH_GYM",
      label: "Commute Return, Gym & Trough",
      description: "Local commute, 130g protein fuel & gym workout split",
      icon: "🏋️",
      color: "#F59E0B",
    };
  }

  // 21:30 to 23:00
  return {
    phase: "DINNER_BUFFER",
    label: "Dinner Anchor & Night Setup",
    description: "9:30 PM – 11:00 PM • Family dinner & night workspace prep",
    icon: "🍲",
    color: "#EC4899",
  };
}

/**
 * Parses JSON request bodies with safety limits.
 */
async function parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error("Request payload too large (max 1MB)"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : ({} as T));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Aggregates all live dashboard state for Parth's Operating System.
 */
export function getDashboardPayload() {
  seedInitialCuratedHackathons();

  const ist = getISTDateTime();
  const phase = getCurrentRoutinePhase(ist.hours, ist.minutes);

  const scheduleBlocks = findBlocksByDate(ist.dateStr);
  const pendingTasks = findPendingTasks();
  const fitness = getDailyFitnessSummary(ist.dateStr);
  const hackathons = findHackathonsByCity(
    ["mumbai", "thane", "navimumbai", "pune"],
    false
  );
  const printItems = getPendingPrintItems();

  const isWaLinked = isWhatsAppConfigured();
  const discordWebhook = getDiscordWebhookUrl();
  const isDiscordActive = Boolean(discordWebhook && discordWebhook.length > 10);
  const ghUsername = getActiveGitHubUsername();
  const isTrelloLinked = Boolean(getTrelloAccessToken());

  const mem = process.memoryUsage();

  return {
    ist: {
      date: ist.dateStr,
      time: ist.timeStr,
      iso: new Date().toISOString(),
    },
    routinePhase: phase,
    schedule: {
      date: ist.dateStr,
      blocksCount: scheduleBlocks.length,
      blocks: scheduleBlocks,
    },
    tasks: {
      totalPending: pendingTasks.length,
      items: pendingTasks,
    },
    fitness: {
      date: fitness.date,
      calories: {
        current: fitness.totalCalories,
        target: fitness.targetCalories,
        percent: Math.min(
          100,
          Math.round((fitness.totalCalories / fitness.targetCalories) * 100)
        ),
      },
      protein: {
        current: fitness.totalProtein,
        target: fitness.targetProtein,
        percent: Math.min(
          100,
          Math.round((fitness.totalProtein / fitness.targetProtein) * 100)
        ),
      },
      mealsCount: fitness.meals.length,
      meals: fitness.meals,
      workout: fitness.workout ?? null,
      presets: Object.entries(MEAL_PRESETS).map(([key, p]) => ({
        key,
        name: p.name,
        calories: p.calories,
        protein: p.protein,
        type: p.type,
      })),
    },
    hackathons: {
      total: hackathons.length,
      items: hackathons.slice(0, 8),
    },
    printQueue: {
      totalItems: printItems.length,
      items: printItems,
      backpackChecklist: [
        { item: "Casio FX-991CW Scientific Calculator", packed: true },
        { item: "KCCEMSR Student ID Card & Lanyard", packed: true },
        { item: "Lab Journal / Assignment Writeup Sheets", packed: true },
        { item: "Xerox Printouts & Code Submissions", packed: printItems.length === 0 },
        { item: "Emergency Stationeries & Blue/Black Pens", packed: true },
      ],
    },
    ecosystem: {
      whatsapp: {
        status: isWaLinked ? "connected" : "ready",
        readOnly: true,
        guard: "ACTIVE (sock.sendMessage neutered)",
        description: "Monitors academic WhatsApp groups; auto-detects assignment turns",
      },
      discord: {
        status: isDiscordActive ? "connected" : "ready",
        webhookConfigured: isDiscordActive,
        description: "Permanent broadcast channel for nightly plans & circulars",
      },
      telegram: {
        status: "active",
        bot: "@parth_assistant_bot",
        description: "Interactive command console & inline callback controller",
      },
      trello: {
        status: isTrelloLinked ? "connected" : "ready",
        description: "Bi-directional academic board & turn sync",
      },
      github: {
        username: ghUsername,
        status: "active",
        description: "Tracks daily commits and 45m deep-work repositories",
      },
    },
    system: {
      nodeVersion: process.version,
      uptimeSeconds: Math.floor((Date.now() - startTimeEpoch) / 1000),
      memoryRssMb: Math.round(mem.rss / 1024 / 1024),
      memoryHeapMb: Math.round(mem.heapUsed / 1024 / 1024),
      platform: "Render Cloud / Free Web Service",
    },
  };
}

/**
 * Builds the Hanzo-inspired Single Page Dashboard HTML.
 */
export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Parth Varekar — Operating Assistant</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fragment+Mono:ital@0;1&family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #FAF7F2;
      --bg-card: #FFFFFF;
      --bg-card-hover: #FCFBF9;
      --bg-card-subtle: #F4EFE6;
      --border: #E8E2D8;
      --border-hover: #D8D0C3;
      --border-accent: #C4B9A7;
      --text: #1C1917;
      --text-muted: #78716C;
      --text-dim: #A8A29E;
      --emerald: #15803D;
      --emerald-glow: rgba(21, 128, 61, 0.12);
      --amber: #D97706;
      --amber-glow: rgba(217, 119, 6, 0.12);
      --terracotta: #C2410C;
      --radius: 12px;
      --shadow-sm: 0 1px 2px rgba(60, 45, 30, 0.04);
      --shadow-card: 0 1px 3px rgba(60, 45, 30, 0.04), 0 8px 24px -4px rgba(60, 45, 30, 0.04);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      background-image: 
        radial-gradient(circle at 50% 0%, #FFFDF9 0%, #FAF7F2 85%),
        linear-gradient(to right, rgba(120, 100, 80, 0.035) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(120, 100, 80, 0.035) 1px, transparent 1px);
      background-size: 100% 100%, 36px 36px, 36px 36px;
    }

    .container {
      max-width: 1320px;
      margin: 0 auto;
      padding: 36px 24px 64px 24px;
    }

    /* Top Nav / Identity Bar */
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 36px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
      gap: 20px;
    }

    .brand-title {
      font-size: 21px;
      font-weight: 600;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text);
    }

    .brand-title .serif-flair {
      font-family: 'Instrument Serif', Georgia, serif;
      font-style: italic;
      font-size: 27px;
      font-weight: 400;
      color: #92400E;
    }

    .brand-sub {
      font-family: 'Fragment Mono', monospace;
      font-size: 11px;
      color: var(--text-muted);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-top: 4px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 9999px;
      font-family: 'Fragment Mono', monospace;
      font-size: 11px;
      color: var(--text);
      box-shadow: var(--shadow-sm);
    }

    .pulse-dot {
      width: 7px;
      height: 7px;
      background: var(--emerald);
      border-radius: 50%;
      box-shadow: 0 0 8px rgba(21, 128, 61, 0.4);
      animation: pulse 2s infinite ease-in-out;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .clock-display {
      font-family: 'Fragment Mono', monospace;
      font-size: 13px;
      color: #44403C;
      background: #F4EFE6;
      padding: 6px 14px;
      border-radius: 6px;
      border: 1px solid var(--border);
      font-weight: 500;
    }

    /* Actions Bar */
    .action-bar {
      display: flex;
      gap: 10px;
      margin-bottom: 28px;
      flex-wrap: wrap;
    }

    .btn {
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
      text-decoration: none;
      box-shadow: var(--shadow-sm);
    }

    .btn:hover {
      background: #FDFCF9;
      border-color: var(--border-hover);
      transform: translateY(-1px);
      box-shadow: 0 3px 8px rgba(60, 45, 30, 0.06);
    }

    .btn-primary {
      background: #1C1917;
      color: #FAF7F2;
      border-color: #1C1917;
      font-weight: 600;
      box-shadow: 0 2px 6px rgba(28, 25, 23, 0.15);
    }

    .btn-primary:hover {
      background: #292524;
      border-color: #292524;
      color: #FAF7F2;
    }

    /* Phase Banner */
    .phase-banner {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 28px;
      position: relative;
      overflow: hidden;
      box-shadow: var(--shadow-card);
    }

    .phase-banner::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background: var(--amber);
    }

    .phase-info h2 {
      font-size: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text);
    }

    .phase-info p {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* Bento Grid */
    .bento-grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 20px;
    }

    .col-12 { grid-column: span 12; }
    .col-8 { grid-column: span 8; }
    .col-6 { grid-column: span 6; }
    .col-4 { grid-column: span 4; }

    @media (max-width: 1024px) {
      .col-8, .col-6, .col-4 { grid-column: span 12; }
    }

    /* Card Styling */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-card);
    }

    .card:hover {
      border-color: var(--border-hover);
      box-shadow: 0 4px 12px rgba(60, 45, 30, 0.06), 0 12px 28px -6px rgba(60, 45, 30, 0.05);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .card-title {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #78716C;
      font-family: 'Fragment Mono', monospace;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card-badge {
      font-family: 'Fragment Mono', monospace;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--bg-card-subtle);
      border: 1px solid var(--border);
      color: #57534E;
    }

    /* Schedule Blocks list */
    .schedule-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
    }

    .schedule-block {
      background: #FDFBF8;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      transition: all 0.15s ease;
    }

    .schedule-block:hover {
      border-color: var(--border-hover);
      background: #FFFFFF;
      box-shadow: var(--shadow-sm);
    }

    .schedule-time {
      font-family: 'Fragment Mono', monospace;
      font-size: 12px;
      color: #92400E;
      font-weight: 600;
      white-space: nowrap;
      min-width: 96px;
    }

    .schedule-desc {
      font-size: 13px;
      font-weight: 500;
      flex: 1;
      color: var(--text);
    }

    .schedule-status {
      font-family: 'Fragment Mono', monospace;
      font-size: 11px;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: 4px;
      background: #F4EFE6;
      color: var(--text-muted);
    }

    .schedule-status.completed {
      background: rgba(22, 163, 74, 0.1);
      color: #15803D;
      border: 1px solid rgba(22, 163, 74, 0.3);
    }

    /* Fitness Meters */
    .meter-container {
      margin-bottom: 18px;
    }

    .meter-header {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 6px;
    }

    .meter-title {
      color: var(--text-muted);
      font-family: 'Fragment Mono', monospace;
    }

    .meter-val {
      font-weight: 600;
      color: var(--text);
    }

    .meter-bar {
      height: 8px;
      background: #EDE6DA;
      border-radius: 9999px;
      overflow: hidden;
      position: relative;
    }

    .meter-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.4s ease;
    }

    .fill-protein {
      background: linear-gradient(90deg, #15803D, #22C55E);
      box-shadow: 0 0 10px rgba(22, 163, 74, 0.25);
    }

    .fill-calories {
      background: linear-gradient(90deg, #D97706, #F59E0B);
      box-shadow: 0 0 10px rgba(217, 119, 6, 0.25);
    }

    .presets-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      margin-top: 16px;
    }

    .preset-btn {
      background: #FAF7F2;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
      text-align: left;
      cursor: pointer;
      color: var(--text);
      transition: all 0.15s ease;
    }

    .preset-btn:hover {
      background: #FFFFFF;
      border-color: var(--border-hover);
      box-shadow: var(--shadow-sm);
    }

    .preset-btn .p-name {
      font-size: 11px;
      font-weight: 500;
      display: block;
      color: var(--text);
    }

    .preset-btn .p-sub {
      font-family: 'Fragment Mono', monospace;
      font-size: 10px;
      color: #15803D;
      font-weight: 600;
    }

    /* Hubs Grid */
    .hub-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .hub-item {
      background: #FDFBF8;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      transition: all 0.15s ease;
    }

    .hub-item:hover {
      border-color: var(--border-hover);
      background: #FFFFFF;
    }

    .hub-item .hub-name {
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
    }

    .hub-item .hub-desc {
      font-size: 11px;
      color: var(--text-muted);
    }

    .hub-tag {
      font-family: 'Fragment Mono', monospace;
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .tag-active {
      background: rgba(22, 163, 74, 0.1);
      color: #15803D;
      border: 1px solid rgba(22, 163, 74, 0.3);
      font-weight: 600;
    }

    .tag-neutral {
      background: #F4EFE6;
      color: var(--text-muted);
      border: 1px solid var(--border);
    }

    /* Hackathons */
    .hackathon-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .hackathon-item {
      background: #FDFBF8;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      transition: all 0.15s ease;
    }

    .hackathon-item:hover {
      border-color: var(--border-hover);
      background: #FFFFFF;
    }

    .hack-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
    }

    .hack-meta {
      font-family: 'Fragment Mono', monospace;
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* Tasks table */
    .task-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .task-row {
      background: #FDFBF8;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      transition: all 0.15s ease;
    }

    .task-row:hover {
      border-color: var(--border-hover);
      background: #FFFFFF;
    }

    .task-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
    }

    .task-meta {
      font-family: 'Fragment Mono', monospace;
      font-size: 11px;
      color: var(--text-muted);
    }

    .priority-badge {
      font-family: 'Fragment Mono', monospace;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      font-weight: 600;
    }

    .pri-urgent { background: rgba(220, 38, 38, 0.1); color: #B91C1C; border: 1px solid rgba(220, 38, 38, 0.3); }
    .pri-high { background: rgba(217, 119, 6, 0.1); color: #B45309; border: 1px solid rgba(217, 119, 6, 0.3); }
    .pri-medium { background: rgba(79, 70, 229, 0.1); color: #4338CA; border: 1px solid rgba(79, 70, 229, 0.3); }

    /* Modal Form */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(50, 40, 30, 0.45);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal {
      background: #FFFFFF;
      border: 1px solid var(--border);
      border-radius: 14px;
      width: 90%;
      max-width: 480px;
      padding: 28px;
      box-shadow: 0 20px 40px -10px rgba(60, 45, 30, 0.15);
    }

    .modal-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--text);
    }

    .form-group {
      margin-bottom: 14px;
    }

    .form-label {
      display: block;
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 6px;
      font-family: 'Fragment Mono', monospace;
    }

    .form-input, .form-select {
      width: 100%;
      background: #FAF8F5;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 9px 12px;
      color: var(--text);
      font-size: 13px;
      transition: all 0.15s ease;
    }

    .form-input:focus, .form-select:focus {
      outline: none;
      border-color: #A8A29E;
      background: #FFFFFF;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
    }

    /* Toast */
    #toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1C1917;
      border: 1px solid #44403C;
      color: #FAF7F2;
      padding: 10px 18px;
      border-radius: 6px;
      font-size: 12px;
      font-family: 'Fragment Mono', monospace;
      display: none;
      z-index: 2000;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <div class="brand-title">
          <span>PARTH.OS</span>
          <span class="serif-flair">Operating Assistant</span>
        </div>
        <div class="brand-sub">
          CE24 • K.C. COLLEGE OF ENGINEERING, THANE • MUMBAI
        </div>
      </div>
      <div class="header-right">
        <div class="status-pill">
          <div class="pulse-dot"></div>
          <span>DAEMON ONLINE (24/7 CLOUD)</span>
        </div>
        <div class="clock-display" id="clock-display">
          --:--:-- IST
        </div>
      </div>
    </header>

    <div class="action-bar">
      <button class="btn btn-primary" onclick="openTaskModal()">+ Add Academic Task</button>
      <button class="btn" onclick="triggerReplan()">⚡ Replan Night Protocol</button>
      <button class="btn" onclick="openCustomMealModal()">🍱 Custom Meal Log</button>
      <button class="btn" onclick="refreshDashboard(true)">🔄 Sync Telemetry</button>
      <a href="/api/dashboard-data" target="_blank" class="btn">JSON API</a>
      <a href="/health" target="_blank" class="btn">Health Check</a>
    </div>

    <div class="phase-banner" id="phase-banner">
      <div class="phase-info">
        <h2 id="phase-title">🌙 Loading Current Protocol...</h2>
        <p id="phase-desc">Determining active routine window...</p>
      </div>
      <div class="card-badge" id="date-badge">YYYY-MM-DD</div>
    </div>

    <div class="bento-grid">
      <!-- Tonight's Deep Work Plan -->
      <div class="card col-8">
        <div class="card-header">
          <div class="card-title">
            <span>🌙 Tonight's Deep Work Plan</span>
            <span style="font-family:'Instrument Serif',serif;font-style:italic;font-size:16px;color:#92400E;text-transform:none;">(11:00 PM – 4:30 AM)</span>
          </div>
          <div class="card-badge" id="blocks-count">0 Blocks Scheduled</div>
        </div>
        <div class="schedule-list" id="schedule-list">
          <div style="color:var(--text-muted);font-size:13px;padding:12px;">No schedule blocks generated yet. Click "⚡ Replan Night Protocol" above to deterministically schedule your pending coursework.</div>
        </div>
      </div>

      <!-- Gym & Nutrition Macro Tracker -->
      <div class="card col-4">
        <div class="card-header">
          <div class="card-title">🏋️ Gym & Protein Engine</div>
          <div class="card-badge">Daily Target</div>
        </div>

        <div class="meter-container">
          <div class="meter-header">
            <span class="meter-title">PROTEIN TARGET (130g)</span>
            <span class="meter-val" id="protein-val">0 / 130g (0%)</span>
          </div>
          <div class="meter-bar">
            <div class="meter-fill fill-protein" id="protein-bar" style="width: 0%;"></div>
          </div>
        </div>

        <div class="meter-container">
          <div class="meter-header">
            <span class="meter-title">CALORIES TARGET (2500 kcal)</span>
            <span class="meter-val" id="calories-val">0 / 2500 kcal (0%)</span>
          </div>
          <div class="meter-bar">
            <div class="meter-fill fill-calories" id="calories-bar" style="width: 0%;"></div>
          </div>
        </div>

        <div style="font-size: 11px; color: var(--text-muted); margin-top: 10px; font-family: 'Fragment Mono', monospace;">
          ⚡ 1-TAP MEAL PRESETS:
        </div>
        <div class="presets-row">
          <button class="preset-btn" onclick="logPreset('whey_shake')">
            <span class="p-name">Whey Shake</span>
            <span class="p-sub">+26g Protein</span>
          </button>
          <button class="preset-btn" onclick="logPreset('eggs_toast')">
            <span class="p-name">Eggs + Toast</span>
            <span class="p-sub">+28g Protein</span>
          </button>
          <button class="preset-btn" onclick="logPreset('solid_dinner')">
            <span class="p-name">Solid Dinner</span>
            <span class="p-sub">+34g Protein</span>
          </button>
          <button class="preset-btn" onclick="logPreset('quick_snack')">
            <span class="p-name">PB / Sprout Snack</span>
            <span class="p-sub">+14g Protein</span>
          </button>
        </div>
      </div>

      <!-- Print-Ready Xerox Bundler & Backpack -->
      <div class="card col-4">
        <div class="card-header">
          <div class="card-title">🖨️ Physical Xerox & Backpack</div>
          <div class="card-badge" id="print-count">0 Turns Pending</div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">
          KCCEMSR Lab Turn Submission & Xerox Prints Queue:
        </div>
        <div id="print-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
          <div style="font-size:12px;color:var(--text-dim);">All submissions printed and submitted.</div>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; font-family: 'Fragment Mono', monospace;">
          🎒 COMMUTE BACKPACK CHECKLIST:
        </div>
        <div id="backpack-list" style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
        </div>
      </div>

      <!-- Regional Hackathon Radar -->
      <div class="card col-4">
        <div class="card-header">
          <div class="card-title">🏆 Regional Hackathon Radar</div>
          <div class="card-badge">Mumbai / Thane / Pune</div>
        </div>
        <div class="hackathon-list" id="hackathon-list">
          <div style="color:var(--text-muted);font-size:12px;">Loading curated competitions...</div>
        </div>
      </div>

      <!-- Connected Hubs Grid -->
      <div class="card col-4">
        <div class="card-header">
          <div class="card-title">🌐 Connected Ecosystem</div>
          <div class="card-badge">Permanent Bridge</div>
        </div>
        <div class="hub-grid" id="hub-grid">
          <div class="hub-item">
            <div>
              <div class="hub-name">WhatsApp Academic Bridge</div>
              <div class="hub-desc">Strict Read-Only Mode (sock.sendMessage neutered)</div>
            </div>
            <div class="hub-tag tag-active" id="hub-wa-tag">ACTIVE</div>
          </div>
          <div class="hub-item">
            <div>
              <div class="hub-name">Discord Broadcaster</div>
              <div class="hub-desc">Permanent Webhook Channel Connected</div>
            </div>
            <div class="hub-tag tag-active" id="hub-dc-tag">ACTIVE</div>
          </div>
          <div class="hub-item">
            <div>
              <div class="hub-name">Telegram Bot Gateway</div>
              <div class="hub-desc">@parth_assistant_bot Long Polling Daemon</div>
            </div>
            <div class="hub-tag tag-active">ACTIVE</div>
          </div>
          <div class="hub-item">
            <div>
              <div class="hub-name">Atlassian Trello Sync</div>
              <div class="hub-desc">PKCE OAuth Board Integration</div>
            </div>
            <div class="hub-tag tag-active" id="hub-trello-tag">SYNCED</div>
          </div>
          <div class="hub-item">
            <div>
              <div class="hub-name">GitHub Commit Tracker</div>
              <div class="hub-desc">ParthVarekar (27 Repositories)</div>
            </div>
            <div class="hub-tag tag-active">ACTIVE</div>
          </div>
        </div>
      </div>

      <!-- Active Pending Tasks Backlog -->
      <div class="card col-8">
        <div class="card-header">
          <div class="card-title">📋 Active Pending Tasks</div>
          <div class="card-badge" id="tasks-count">0 Tasks</div>
        </div>
        <div class="task-list" id="task-list">
          <div style="color:var(--text-muted);font-size:13px;padding:12px;">No active tasks pending. Add one using the button above!</div>
        </div>
      </div>

      <!-- Render Cloud Telemetry -->
      <div class="card col-4">
        <div class="card-header">
          <div class="card-title">☁️ Render Cloud Telemetry</div>
          <div class="card-badge">24/7 Daemon</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;font-family:'Fragment Mono',monospace;font-size:12px;">
          <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:6px;">
            <span style="color:var(--text-muted)">PLATFORM</span>
            <span style="color:var(--emerald)" id="sys-platform">Render Free Web Service</span>
          </div>
          <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:6px;">
            <span style="color:var(--text-muted)">HEARTBEAT TICK</span>
            <span style="color:var(--text)">15s Proactive Scheduler</span>
          </div>
          <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:6px;">
            <span style="color:var(--text-muted)">DATABASE</span>
            <span style="color:var(--text)">SQLite (WAL Mode)</span>
          </div>
          <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:6px;">
            <span style="color:var(--text-muted)">NODE RUNTIME</span>
            <span style="color:var(--text)" id="sys-node">-</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:var(--text-muted)">UPTIME</span>
            <span style="color:var(--text)" id="sys-uptime">-</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Task Modal -->
  <div class="modal-overlay" id="task-modal">
    <div class="modal">
      <div class="modal-title">
        <span>Add New Coursework / Task</span>
        <button class="btn" onclick="closeModals()" style="padding:2px 8px;">✕</button>
      </div>
      <form id="task-form" onsubmit="submitTask(event)">
        <div class="form-group">
          <label class="form-label">TITLE</label>
          <input type="text" class="form-input" id="t-title" required placeholder="e.g. Distributed Systems Lab 3 Turn" />
        </div>
        <div class="form-group">
          <label class="form-label">CATEGORY</label>
          <select class="form-select" id="t-category">
            <option value="assignment">Assignment / Writeup</option>
            <option value="submission">Practical Turn / Submission</option>
            <option value="coding">Coding Sprint</option>
            <option value="study">Study / Exam Prep</option>
            <option value="fitness">Fitness</option>
            <option value="misc">Misc</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">PRIORITY</label>
          <select class="form-select" id="t-priority">
            <option value="urgent">Urgent (Immediate print/turn)</option>
            <option value="high" selected>High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">ESTIMATED DURATION (MINUTES)</label>
          <input type="number" class="form-input" id="t-est" value="45" min="15" max="300" />
        </div>
        <div class="form-actions">
          <button type="button" class="btn" onclick="closeModals()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Task</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Custom Meal Modal -->
  <div class="modal-overlay" id="meal-modal">
    <div class="modal">
      <div class="modal-title">
        <span>Log Custom Nutrition</span>
        <button class="btn" onclick="closeModals()" style="padding:2px 8px;">✕</button>
      </div>
      <form id="meal-form" onsubmit="submitCustomMeal(event)">
        <div class="form-group">
          <label class="form-label">MEAL NAME</label>
          <input type="text" class="form-input" id="m-name" required placeholder="e.g. Chicken Biryani / Paneer Wrap" />
        </div>
        <div class="form-group">
          <label class="form-label">CALORIES (KCAL)</label>
          <input type="number" class="form-input" id="m-cals" required value="400" min="10" />
        </div>
        <div class="form-group">
          <label class="form-label">PROTEIN (GRAMS)</label>
          <input type="number" class="form-input" id="m-protein" required value="25" min="0" />
        </div>
        <div class="form-actions">
          <button type="button" class="btn" onclick="closeModals()">Cancel</button>
          <button type="submit" class="btn btn-primary">Log Meal</button>
        </div>
      </form>
    </div>
  </div>

  <div id="toast"></div>

  <script>
    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 3000);
    }

    function updateClock() {
      const now = new Date();
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const ist = new Date(utc + 5.5 * 3600000);
      const h = String(ist.getHours()).padStart(2, '0');
      const m = String(ist.getMinutes()).padStart(2, '0');
      const s = String(ist.getSeconds()).padStart(2, '0');
      document.getElementById('clock-display').innerText = h + ':' + m + ':' + s + ' IST';
    }
    setInterval(updateClock, 1000);
    updateClock();

    function closeModals() {
      document.getElementById('task-modal').style.display = 'none';
      document.getElementById('meal-modal').style.display = 'none';
    }

    function openTaskModal() {
      document.getElementById('task-modal').style.display = 'flex';
    }

    function openCustomMealModal() {
      document.getElementById('meal-modal').style.display = 'flex';
    }

    async function refreshDashboard(showNotification = false) {
      try {
        const res = await fetch('/api/dashboard-data');
        if (!res.ok) return;
        const data = await res.json();
        renderDashboard(data);
        if (showNotification) showToast('Telemetry Synced');
      } catch (err) {
        console.error('Error refreshing dashboard:', err);
      }
    }

    function renderDashboard(data) {
      // Phase banner
      document.getElementById('phase-title').innerText = data.routinePhase.icon + ' ' + data.routinePhase.label;
      document.getElementById('phase-desc').innerText = data.routinePhase.description;
      document.getElementById('date-badge').innerText = data.ist.date;

      // Schedule blocks
      const sContainer = document.getElementById('schedule-list');
      document.getElementById('blocks-count').innerText = data.schedule.blocksCount + ' Blocks Scheduled';
      if (data.schedule.blocks.length === 0) {
        sContainer.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:12px;">No schedule blocks active. Click "⚡ Replan Night Protocol" above to auto-pack your pending tasks into deep-work intervals.</div>';
      } else {
        sContainer.innerHTML = data.schedule.blocks.map(b => {
          const isDone = b.status === 'completed';
          return '<div class="schedule-block">' +
            '<div class="schedule-time">' + b.startTime + ' – ' + b.endTime + '</div>' +
            '<div class="schedule-desc">' + (b.taskTitle || 'Deep Work Sprint') + '</div>' +
            '<div class="schedule-status ' + (isDone ? 'completed' : '') + '">' + b.status + '</div>' +
            (!isDone ? '<button class="btn" style="padding:4px 8px;font-size:11px;" onclick="completeBlock(\\'' + b.id + '\\')">✓ Done</button>' : '') +
          '</div>';
        }).join('');
      }

      // Fitness
      const p = data.fitness.protein;
      const c = data.fitness.calories;
      document.getElementById('protein-val').innerText = p.current + ' / ' + p.target + 'g (' + p.percent + '%)';
      document.getElementById('protein-bar').style.width = p.percent + '%';
      document.getElementById('calories-val').innerText = c.current + ' / ' + c.target + ' kcal (' + c.percent + '%)';
      document.getElementById('calories-bar').style.width = c.percent + '%';

      // Print Queue
      document.getElementById('print-count').innerText = data.printQueue.totalItems + ' Turns Pending';
      const printContainer = document.getElementById('print-list');
      if (data.printQueue.items.length === 0) {
        printContainer.innerHTML = '<div style="font-size:12px;color:var(--emerald);">✓ All coursework printed and submitted.</div>';
      } else {
        printContainer.innerHTML = data.printQueue.items.map(p => {
          return '<div style="background:#FDFBF8;padding:8px 10px;border-radius:4px;border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">' +
            '<div><div style="font-size:12px;font-weight:500;">' + p.title + '</div><div style="font-size:10px;color:var(--text-muted);">' + p.subject + ' • ' + p.estimatedPages + ' pgs Xerox</div></div>' +
            '<span class="card-badge" style="color:var(--amber);">' + p.stage + '</span>' +
          '</div>';
        }).join('');
      }

      // Backpack
      const bpContainer = document.getElementById('backpack-list');
      bpContainer.innerHTML = data.printQueue.backpackChecklist.map(b => {
        return '<div style="font-size:12px;display:flex;align-items:center;gap:8px;">' +
          '<span style="color:' + (b.packed ? 'var(--emerald)' : 'var(--amber)') + '">' + (b.packed ? '✓' : '○') + '</span>' +
          '<span>' + b.item + '</span>' +
        '</div>';
      }).join('');

      // Hackathons
      const hackContainer = document.getElementById('hackathon-list');
      hackContainer.innerHTML = data.hackathons.items.map(h => {
        return '<div class="hackathon-item">' +
          '<div>' +
            '<div class="hack-title">' + h.title + '</div>' +
            '<div class="hack-meta">' + h.location + ' • Reg: ' + h.registrationDeadline + '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:11px;font-weight:600;color:var(--emerald);">' + (h.prizePool || 'Certificates') + '</div>' +
            '<button class="btn" style="padding:2px 8px;font-size:10px;margin-top:4px;" onclick="toggleHackBookmark(\\'' + h.id + '\\')">' + (h.isBookmarked ? '★ Saved' : '☆ Save') + '</button>' +
          '</div>' +
        '</div>';
      }).join('');

      // Tasks
      document.getElementById('tasks-count').innerText = data.tasks.totalPending + ' Pending';
      const taskContainer = document.getElementById('task-list');
      if (data.tasks.items.length === 0) {
        taskContainer.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:12px;">No pending tasks! All caught up.</div>';
      } else {
        taskContainer.innerHTML = data.tasks.items.map(t => {
          const priClass = t.priority === 'urgent' ? 'pri-urgent' : (t.priority === 'high' ? 'pri-high' : 'pri-medium');
          return '<div class="task-row">' +
            '<div>' +
              '<div class="task-title">' + t.title + '</div>' +
              '<div class="task-meta">' + t.category.toUpperCase() + ' • ' + t.estimatedMinutes + ' mins' + (t.deadline ? ' • Due ' + t.deadline : '') + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
              '<span class="priority-badge ' + priClass + '">' + t.priority + '</span>' +
              '<button class="btn" style="padding:4px 8px;font-size:11px;" onclick="completeTask(\\'' + t.id + '\\')">✓ Done</button>' +
            '</div>' +
          '</div>';
        }).join('');
      }

      // Hubs
      document.getElementById('hub-wa-tag').innerText = data.ecosystem.whatsapp.status === 'connected' ? 'READ-ONLY ACTIVE' : 'READY';
      document.getElementById('hub-dc-tag').innerText = data.ecosystem.discord.status === 'connected' ? 'WEBHOOK ACTIVE' : 'READY';
      document.getElementById('hub-trello-tag').innerText = data.ecosystem.trello.status === 'connected' ? 'SYNCED' : 'READY';

      // Telemetry
      document.getElementById('sys-node').innerText = data.system.nodeVersion;
      const uptimeMins = Math.floor(data.system.uptimeSeconds / 60);
      document.getElementById('sys-uptime').innerText = uptimeMins + 'm (' + data.system.uptimeSeconds + 's)';
    }

    async function logPreset(presetKey) {
      try {
        const res = await fetch('/api/fitness/meal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ presetKey })
        });
        if (res.ok) {
          showToast('Macro preset logged successfully!');
          refreshDashboard();
        }
      } catch (err) {
        console.error(err);
      }
    }

    async function submitCustomMeal(e) {
      e.preventDefault();
      const name = document.getElementById('m-name').value;
      const calories = parseInt(document.getElementById('m-cals').value, 10);
      const protein = parseInt(document.getElementById('m-protein').value, 10);

      try {
        const res = await fetch('/api/fitness/meal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, calories, protein })
        });
        if (res.ok) {
          closeModals();
          showToast('Meal logged: ' + name);
          refreshDashboard();
        }
      } catch (err) {
        console.error(err);
      }
    }

    async function submitTask(e) {
      e.preventDefault();
      const title = document.getElementById('t-title').value;
      const category = document.getElementById('t-category').value;
      const priority = document.getElementById('t-priority').value;
      const estimatedMinutes = parseInt(document.getElementById('t-est').value, 10);

      try {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, category, priority, estimatedMinutes })
        });
        if (res.ok) {
          closeModals();
          document.getElementById('task-form').reset();
          showToast('Task added: ' + title);
          refreshDashboard();
        }
      } catch (err) {
        console.error(err);
      }
    }

    async function completeTask(id) {
      try {
        const res = await fetch('/api/tasks/' + id + '/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' })
        });
        if (res.ok) {
          showToast('Task marked completed');
          refreshDashboard();
        }
      } catch (err) {
        console.error(err);
      }
    }

    async function completeBlock(id) {
      try {
        const res = await fetch('/api/schedule/' + id + '/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' })
        });
        if (res.ok) {
          showToast('Block marked completed');
          refreshDashboard();
        }
      } catch (err) {
        console.error(err);
      }
    }

    async function triggerReplan() {
      try {
        const res = await fetch('/api/replan', { method: 'POST' });
        if (res.ok) {
          showToast('Night protocol regenerated!');
          refreshDashboard();
        }
      } catch (err) {
        console.error(err);
      }
    }

    async function toggleHackBookmark(id) {
      try {
        const res = await fetch('/api/hackathons/' + id + '/bookmark', { method: 'POST' });
        if (res.ok) {
          refreshDashboard();
        }
      } catch (err) {
        console.error(err);
      }
    }

    // Initial load and periodic refresh
    refreshDashboard();
    setInterval(refreshDashboard, 8000);
  </script>
</body>
</html>`;
}

let activeServer: http.Server | null = null;

/**
 * Creates and starts the HTTP Dashboard and API Server.
 * @param customPort Optional port override (falls back to env or 3000).
 * @returns Running http.Server instance.
 */
export function startDashboardServer(customPort?: number): http.Server {
  const env = getEnv();
  const port = customPort ?? env.PORT ?? 3000;

  const server = http.createServer(async (req, res) => {
    // Enable CORS for external dashboard or API consumers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    try {
      // 1. Health check (Render requirement)
      if (pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - startTimeEpoch) / 1000),
            nodeVersion: process.version,
          })
        );
        return;
      }

      // 2. High-level status API
      if (pathname === "/api/status" && req.method === "GET") {
        const ist = getISTDateTime();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "operational",
            time: ist.timeStr,
            date: ist.dateStr,
            whatsappLinked: isWhatsAppConfigured(),
            whatsappReadOnly: true,
            discordConfigured: Boolean(getDiscordWebhookUrl()),
            uptimeSeconds: Math.floor((Date.now() - startTimeEpoch) / 1000),
          })
        );
        return;
      }

      // 3. Full Dashboard JSON Feed
      if (pathname === "/api/dashboard-data" && req.method === "GET") {
        const payload = getDashboardPayload();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }

      // 4. Create Task
      if (pathname === "/api/tasks" && req.method === "POST") {
        const body = await parseJsonBody<any>(req);
        if (!body.title || typeof body.title !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Title is required" }));
          return;
        }

        const task = insertTask({
          id: crypto.randomUUID(),
          title: body.title.trim(),
          description: body.description?.trim(),
          category: body.category || "assignment",
          status: "pending",
          priority: body.priority || "high",
          estimatedMinutes: Number(body.estimatedMinutes) || 45,
          deadline: body.deadline,
        });

        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, task }));
        return;
      }

      // 5. Update Task Status
      const taskStatusMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/status$/);
      if (taskStatusMatch && req.method === "POST") {
        const taskId = taskStatusMatch[1];
        if (!taskId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid task ID" }));
          return;
        }
        const body = await parseJsonBody<any>(req);
        const status = body.status || "completed";
        updateTaskStatus(taskId, status, body.actualMinutes);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, taskId, status }));
        return;
      }

      // 6. Update Schedule Block Status
      const blockStatusMatch = pathname.match(/^\/api\/schedule\/([^/]+)\/status$/);
      if (blockStatusMatch && req.method === "POST") {
        const blockId = blockStatusMatch[1];
        if (!blockId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid block ID" }));
          return;
        }
        const body = await parseJsonBody<any>(req);
        const status = (body.status || "completed") as BlockStatus;
        updateBlockStatus(blockId, status);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, blockId, status }));
        return;
      }

      // 7. Log Nutrition (Preset or Custom)
      if (pathname === "/api/fitness/meal" && req.method === "POST") {
        const body = await parseJsonBody<any>(req);
        if (body.presetKey) {
          const entry = logQuickPresetMeal(body.presetKey);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, entry }));
          return;
        }

        if (body.name && body.calories !== undefined && body.protein !== undefined) {
          const entry = logCustomMeal(
            body.name,
            Number(body.calories),
            Number(body.protein),
            body.type || "snack"
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, entry }));
          return;
        }

        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Provide presetKey or name, calories, and protein" }));
        return;
      }

      // 8. Log Workout
      if (pathname === "/api/fitness/workout" && req.method === "POST") {
        const body = await parseJsonBody<any>(req);
        if (!body.workoutType) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "workoutType is required" }));
          return;
        }

        const entry = logWorkoutSession(
          body.workoutType,
          Number(body.durationMinutes) || 45,
          body.notes
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, entry }));
        return;
      }

      // 9. Replan Night Schedule
      if (pathname === "/api/replan" && req.method === "POST") {
        const ist = getISTDateTime();
        const result = handleTaskOverrun(ist.timeStr, ist.dateStr);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, result }));
        return;
      }

      // 10. Toggle Hackathon Bookmark
      const hackBookmarkMatch = pathname.match(/^\/api\/hackathons\/([^/]+)\/bookmark$/);
      if (hackBookmarkMatch && req.method === "POST") {
        const hackId = hackBookmarkMatch[1];
        if (!hackId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid hackathon ID" }));
          return;
        }
        const isBookmarked = toggleBookmark(hackId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, hackId, isBookmarked }));
        return;
      }

      // 11. Serve Root GUI Dashboard
      if (pathname === "/" && req.method === "GET") {
        const html = getDashboardHtml();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      // 404 Fallback
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found", path: pathname }));
    } catch (err: any) {
      console.error("Dashboard server request error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error", message: err?.message }));
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`🌐 Hanzo-styled Web Dashboard & API active at: http://0.0.0.0:${port}`);
  });

  activeServer = server;
  return server;
}

/**
 * Stops the running Dashboard HTTP server gracefully.
 */
export async function stopDashboardServer(): Promise<void> {
  if (activeServer) {
    return new Promise((resolve) => {
      activeServer?.close(() => {
        activeServer = null;
        resolve();
      });
    });
  }
}

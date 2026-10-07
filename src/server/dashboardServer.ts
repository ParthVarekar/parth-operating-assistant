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
import {
  getDiscordWebhookUrl,
  getDiscordGatewayStatus,
  provisionAllDiscordGuilds,
} from "../services/discordService.js";
import { getActiveGitHubUsername } from "../services/githubService.js";
import { getTrelloAccessToken } from "../services/trelloService.js";
import { getUserProfile } from "../db/repositories/habitRepository.js";
import { processAssistantChat, getChatHistory } from "../agent/chatHandler.js";
import { getSavedAiNews, runAiIntelligenceScan } from "../services/aiNewsService.js";
import { getRecentMemories } from "../db/repositories/memoryRepository.js";
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
    aiNews: {
      count: getSavedAiNews().length,
      items: getSavedAiNews().slice(0, 6),
    },
    memories: {
      count: getRecentMemories(50).length,
      recent: getRecentMemories(6),
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
  <link href="https://fonts.googleapis.com/css2?family=Fragment+Mono:ital@0;1&family=Instrument+Serif:ital@0;1&family=Inter+Tight:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #FAF7F2;
      --bg-card: #FFFFFF;
      --bg-card-hover: #FCFAF6;
      --bg-surface: #F5F1E8;
      --bg-surface-elevated: #FAF6EF;
      --border: #E8E2D6;
      --border-subtle: #F0EAE0;
      --border-hover: #D7CEBF;
      --border-accent: #C2B6A6;
      --text-main: #181614;
      --text-secondary: #57524D;
      --text-muted: #78716A;
      --text-dim: #A8A199;
      --emerald: #15803D;
      --emerald-bg: rgba(21, 128, 61, 0.07);
      --emerald-border: rgba(21, 128, 61, 0.22);
      --amber: #B45309;
      --amber-dark: #92400E;
      --amber-bg: rgba(180, 83, 9, 0.07);
      --amber-border: rgba(180, 83, 9, 0.22);
      --indigo: #4F46E5;
      --indigo-bg: rgba(79, 70, 229, 0.07);
      --radius-sm: 6px;
      --radius-md: 9px;
      --radius-lg: 12px;
      --shadow-sm: 0 1px 2px rgba(40, 30, 20, 0.02);
      --shadow-card: 0 1px 3px rgba(40, 30, 20, 0.03), 0 4px 14px rgba(40, 30, 20, 0.02);
      --shadow-hover: 0 4px 18px rgba(40, 30, 20, 0.05), 0 1px 3px rgba(40, 30, 20, 0.02);
      --shadow-modal: 0 20px 40px -10px rgba(40, 25, 10, 0.18);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      line-height: 1.45;
      font-size: 13px;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      background-image: 
        radial-gradient(ellipse at 50% 0%, #FFFDF8 0%, #FAF7F2 80%),
        linear-gradient(to right, rgba(140, 115, 95, 0.035) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(140, 115, 95, 0.035) 1px, transparent 1px);
      background-size: 100% 100%, 32px 32px, 32px 32px;
    }

    /* Custom Sleek Scrollbar */
    .scroll-box::-webkit-scrollbar { width: 4px; height: 4px; }
    .scroll-box::-webkit-scrollbar-track { background: transparent; }
    .scroll-box::-webkit-scrollbar-thumb { background: #DDD6CB; border-radius: 4px; }
    .scroll-box::-webkit-scrollbar-thumb:hover { background: #BDB2A1; }

    .container {
      max-width: 1260px;
      margin: 0 auto;
      padding: 24px 20px 48px 20px;
    }

    /* Header & Navigation */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
      gap: 16px;
    }

    .brand-group {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
    }

    .brand-mark {
      width: 32px;
      height: 32px;
      background: var(--text-main);
      color: #FAF7F2;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      font-family: 'Inter Tight', sans-serif;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: -0.02em;
    }

    .brand-title-wrap {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .brand-title {
      font-family: 'Inter Tight', sans-serif;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-main);
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .brand-title .serif-flair {
      font-family: 'Instrument Serif', Georgia, serif;
      font-style: italic;
      font-size: 20px;
      font-weight: 400;
      color: var(--amber-dark);
      letter-spacing: 0;
    }

    .brand-meta {
      font-family: 'Fragment Mono', monospace;
      font-size: 10px;
      color: var(--text-muted);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .header-indicators {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      font-family: 'Fragment Mono', monospace;
      font-size: 10.5px;
      color: var(--text-main);
      box-shadow: var(--shadow-sm);
    }

    .pulse-dot {
      width: 6px;
      height: 6px;
      background: var(--emerald);
      border-radius: 50%;
      box-shadow: 0 0 6px rgba(21, 128, 61, 0.4);
      animation: pulse 2s infinite ease-in-out;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.35; transform: scale(0.85); }
    }

    .clock-chip {
      font-family: 'Fragment Mono', monospace;
      font-size: 11px;
      color: var(--text-secondary);
      background: var(--bg-surface);
      border: 1px solid var(--border);
      padding: 4px 10px;
      border-radius: var(--radius-sm);
      font-weight: 500;
    }

    /* Actions Bar */
    .action-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .btn-group {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn {
      background: var(--bg-card);
      color: var(--text-main);
      border: 1px solid var(--border);
      padding: 6px 13px;
      border-radius: var(--radius-sm);
      font-family: 'Inter Tight', sans-serif;
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
      background: var(--bg-card-hover);
      border-color: var(--border-hover);
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(40, 30, 20, 0.05);
    }

    .btn svg {
      stroke: currentColor;
    }

    .btn-primary {
      background: var(--text-main);
      color: #FAF7F2;
      border-color: var(--text-main);
      font-weight: 600;
    }

    .btn-primary:hover {
      background: #2E2A27;
      border-color: #2E2A27;
      color: #FAF7F2;
    }

    /* ScaleStudio / Framo Reference Metric KPI Strip */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 18px;
    }

    @media (max-width: 900px) {
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 540px) {
      .kpi-grid { grid-template-columns: 1fr; }
    }

    .kpi-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 12px 14px;
      box-shadow: var(--shadow-card);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: all 0.15s ease;
    }

    .kpi-card:hover {
      border-color: var(--border-hover);
      box-shadow: var(--shadow-hover);
    }

    .kpi-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .kpi-label {
      font-family: 'Fragment Mono', monospace;
      font-size: 10px;
      font-weight: 500;
      color: var(--text-muted);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .kpi-badge {
      font-family: 'Fragment Mono', monospace;
      font-size: 9.5px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
    }

    .kpi-val {
      font-family: 'Inter Tight', sans-serif;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--text-main);
      line-height: 1.15;
      margin-bottom: 4px;
    }

    .kpi-sub {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Active Routine Phase Banner */
    .phase-banner {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-left: 3px solid var(--amber);
      border-radius: var(--radius-md);
      padding: 10px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
      box-shadow: var(--shadow-card);
      gap: 12px;
    }

    .phase-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .phase-icon-badge {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: var(--amber-bg);
      border: 1px solid var(--amber-border);
      color: var(--amber-dark);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }

    .phase-title {
      font-family: 'Inter Tight', sans-serif;
      font-size: 13.5px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--text-main);
    }

    .phase-desc {
      font-size: 11.5px;
      color: var(--text-muted);
    }

    /* Bento Grid */
    .bento-grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 16px;
    }

    .col-12 { grid-column: span 12; }
    .col-8  { grid-column: span 8; }
    .col-7  { grid-column: span 7; }
    .col-5  { grid-column: span 5; }
    .col-4  { grid-column: span 4; }

    @media (max-width: 1024px) {
      .col-8, .col-7, .col-5, .col-4 { grid-column: span 12; }
      .fixed-tier-1, .fixed-tier-2, .fixed-tier-3 { height: auto !important; }
    }

    /* Standard Card */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-card);
      transition: all 0.15s ease;
    }

    .card:hover {
      border-color: var(--border-hover);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 10px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border-subtle);
    }

    .card-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-family: 'Fragment Mono', monospace;
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .card-title svg {
      stroke: var(--text-secondary);
    }

    .card-badge {
      font-family: 'Fragment Mono', monospace;
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 4px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
    }

    /* Height Lock Classes for Crisp Alignment */
    .fixed-tier-1 { height: 330px; }
    .fixed-tier-2 { height: 280px; }
    .fixed-tier-3 { height: 340px; }

    /* Timeline / Schedule Blocks */
    .timeline-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
      overflow-y: auto;
      padding-right: 2px;
    }

    .timeline-row {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      transition: all 0.15s ease;
    }

    .timeline-row:hover {
      background: #FFFFFF;
      border-color: var(--border-hover);
    }

    .time-slot {
      font-family: 'Fragment Mono', monospace;
      font-size: 11px;
      font-weight: 600;
      color: var(--amber-dark);
      min-width: 90px;
    }

    .time-title {
      font-family: 'Inter Tight', sans-serif;
      font-size: 12.5px;
      font-weight: 500;
      color: var(--text-main);
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .status-tag {
      font-family: 'Fragment Mono', monospace;
      font-size: 9.5px;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--bg-surface);
      color: var(--text-muted);
      border: 1px solid transparent;
    }

    .status-tag.completed {
      background: var(--emerald-bg);
      color: var(--emerald);
      border-color: var(--emerald-border);
    }

    /* Fitness Meters */
    .fitness-container {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100%;
    }

    .meter-item {
      margin-bottom: 11px;
    }

    .meter-label {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      margin-bottom: 5px;
      font-family: 'Fragment Mono', monospace;
    }

    .meter-track {
      height: 6px;
      background: #EAE3D7;
      border-radius: 9999px;
      overflow: hidden;
    }

    .meter-bar {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.3s ease;
    }

    .meter-bar.protein {
      background: linear-gradient(90deg, #15803D, #22C55E);
    }

    .meter-bar.calories {
      background: linear-gradient(90deg, #B45309, #F59E0B);
    }

    .preset-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      margin-top: 8px;
    }

    .preset-chip {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 6px 9px;
      text-align: left;
      cursor: pointer;
      color: var(--text-main);
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.15s ease;
    }

    .preset-chip:hover {
      background: #FFFFFF;
      border-color: var(--border-hover);
      transform: translateY(-1px);
    }

    .preset-chip .p-name {
      font-family: 'Inter Tight', sans-serif;
      font-size: 11.5px;
      font-weight: 500;
    }

    .preset-chip .p-val {
      font-family: 'Fragment Mono', monospace;
      font-size: 10px;
      color: var(--emerald);
      font-weight: 600;
    }

    /* Print & Backpack */
    .sub-section-title {
      font-family: 'Fragment Mono', monospace;
      font-size: 10px;
      color: var(--text-muted);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .checklist-row {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11.5px;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }

    /* Hackathons */
    .hackathon-row {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 7px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      transition: all 0.15s ease;
    }

    .hackathon-row:hover {
      background: #FFFFFF;
      border-color: var(--border-hover);
    }

    .hack-name {
      font-family: 'Inter Tight', sans-serif;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-main);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 190px;
    }

    .hack-sub {
      font-family: 'Fragment Mono', monospace;
      font-size: 10px;
      color: var(--text-muted);
    }

    /* Hubs */
    .hub-row {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 5px;
    }

    .hub-title {
      font-family: 'Inter Tight', sans-serif;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-main);
    }

    .hub-sub {
      font-family: 'Fragment Mono', monospace;
      font-size: 10px;
      color: var(--text-muted);
    }

    /* Task Manager */
    .task-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      gap: 8px;
      flex-wrap: wrap;
    }

    .filter-tabs {
      display: flex;
      gap: 4px;
    }

    .filter-tab {
      background: transparent;
      border: 1px solid transparent;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      color: var(--text-muted);
      font-family: 'Fragment Mono', monospace;
      transition: all 0.1s ease;
    }

    .filter-tab.active {
      background: var(--bg-surface);
      border-color: var(--border);
      color: var(--text-main);
      font-weight: 600;
    }

    .task-search-input {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 11px;
      color: var(--text-main);
      width: 140px;
      font-family: 'Inter', sans-serif;
    }

    .task-search-input:focus {
      outline: none;
      border-color: var(--border-hover);
      background: #FFFFFF;
    }

    .task-row {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 5px;
      transition: all 0.15s ease;
    }

    .task-row:hover {
      background: #FFFFFF;
      border-color: var(--border-hover);
    }

    .task-main {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }

    .priority-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .pri-urgent { background: #DC2626; box-shadow: 0 0 4px rgba(220, 38, 38, 0.4); }
    .pri-high   { background: #D97706; }
    .pri-medium { background: #4F46E5; }
    .pri-low    { background: #9CA3AF; }

    .task-name {
      font-family: 'Inter Tight', sans-serif;
      font-size: 12.5px;
      font-weight: 500;
      color: var(--text-main);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .task-meta-tag {
      font-family: 'Fragment Mono', monospace;
      font-size: 10px;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    /* Telemetry Table */
    .telemetry-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid var(--border-subtle);
      font-family: 'Fragment Mono', monospace;
      font-size: 11px;
    }

    .telemetry-row:last-child {
      border-bottom: none;
    }

    .telemetry-key {
      color: var(--text-muted);
    }

    .telemetry-val {
      font-weight: 500;
      color: var(--text-main);
    }

    /* Modal Form */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(30, 24, 18, 0.45);
      backdrop-filter: blur(6px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal {
      background: #FFFFFF;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      width: 90%;
      max-width: 440px;
      padding: 22px;
      box-shadow: var(--shadow-modal);
    }

    .modal-title {
      font-family: 'Inter Tight', sans-serif;
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--text-main);
    }

    .form-group {
      margin-bottom: 12px;
    }

    .form-label {
      display: block;
      font-size: 10.5px;
      color: var(--text-muted);
      margin-bottom: 4px;
      font-family: 'Fragment Mono', monospace;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .form-input, .form-select {
      width: 100%;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 7px 10px;
      color: var(--text-main);
      font-size: 12.5px;
      font-family: 'Inter', sans-serif;
    }

    .form-input:focus, .form-select:focus {
      outline: none;
      border-color: #A8A29E;
      background: #FFFFFF;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }

    #toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: var(--text-main);
      color: #FAF7F2;
      border: 1px solid #44403C;
      padding: 8px 14px;
      border-radius: var(--radius-sm);
      font-size: 11.5px;
      font-family: 'Fragment Mono', monospace;
      display: none;
      z-index: 2000;
      box-shadow: 0 8px 20px rgba(0,0,0,0.2);
    }

    /* Floating Chat Action Button */
    .chat-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--text-main);
      color: #FAF7F2;
      border: 1px solid var(--border-accent);
      border-radius: 9999px;
      padding: 10px 18px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: 'Inter Tight', sans-serif;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(25, 20, 15, 0.22);
      z-index: 2100;
      transition: all 0.15s ease;
    }
    .chat-fab:hover {
      transform: translateY(-2px);
      background: #2E2A27;
      box-shadow: 0 8px 24px rgba(25, 20, 15, 0.28);
    }
    .chat-fab svg {
      stroke: currentColor;
    }

    /* Sliding Chat Drawer */
    .chat-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(30, 24, 18, 0.4);
      backdrop-filter: blur(4px);
      display: none;
      z-index: 2400;
    }
    .chat-backdrop.open {
      display: block;
    }

    .chat-drawer {
      position: fixed;
      right: -440px;
      top: 0;
      bottom: 0;
      width: 420px;
      max-width: 92vw;
      background: #FFFFFF;
      border-left: 1px solid var(--border);
      box-shadow: -10px 0 35px rgba(40, 30, 20, 0.12);
      z-index: 2500;
      display: flex;
      flex-direction: column;
      transition: right 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .chat-drawer.open {
      right: 0;
    }

    .chat-drawer-header {
      padding: 16px 18px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--bg-surface-elevated);
    }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .chat-bubble {
      max-width: 86%;
      padding: 9px 13px;
      font-size: 12.5px;
      line-height: 1.45;
      word-break: break-word;
    }

    .chat-bubble.user {
      align-self: flex-end;
      background: var(--text-main);
      color: #FAF7F2;
      border-radius: 12px 12px 2px 12px;
    }

    .chat-bubble.assistant {
      align-self: flex-start;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      color: var(--text-main);
      border-radius: 12px 12px 12px 2px;
    }

    .chat-bubble.system {
      align-self: center;
      width: 100%;
      background: var(--amber-bg);
      border: 1px solid var(--amber-border);
      color: var(--amber-dark);
      border-radius: 8px;
      font-family: 'Fragment Mono', monospace;
      font-size: 11px;
      padding: 7px 10px;
    }

    .chat-quick-chips {
      padding: 8px 14px;
      border-top: 1px solid var(--border-subtle);
      background: #FAF8F5;
      display: flex;
      gap: 6px;
      overflow-x: auto;
      white-space: nowrap;
    }

    .quick-chip {
      background: #FFFFFF;
      border: 1px solid var(--border);
      border-radius: 9999px;
      padding: 3px 9px;
      font-size: 11px;
      color: var(--text-main);
      cursor: pointer;
      font-family: 'Inter Tight', sans-serif;
      transition: all 0.1s ease;
      flex-shrink: 0;
    }
    .quick-chip:hover {
      background: var(--bg-surface);
      border-color: var(--border-hover);
    }

    .chat-input-bar {
      padding: 12px 14px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 8px;
      background: #FFFFFF;
    }

    .chat-input {
      flex: 1;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 7px 11px;
      font-size: 12.5px;
      color: var(--text-main);
      font-family: 'Inter', sans-serif;
    }
    .chat-input:focus {
      outline: none;
      border-color: #A8A29E;
      background: #FFFFFF;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header>
      <div class="brand-group">
        <div class="brand-mark">P</div>
        <div class="brand-title-wrap">
          <div class="brand-title">
            <span>PARTH.OS</span>
            <span class="serif-flair">Operating Assistant</span>
          </div>
          <div class="brand-meta">K.C. COLLEGE OF ENGINEERING • THANE (MUMBAI)</div>
        </div>
      </div>
      <div class="header-indicators">
        <div class="chip">
          <div class="pulse-dot"></div>
          <span>LIVE DAEMON ACTIVE</span>
        </div>
        <div class="clock-chip" id="clock-display">--:--:-- IST</div>
      </div>
    </header>

    <!-- Controls Ribbon -->
    <div class="action-bar">
      <div class="btn-group">
        <button class="btn btn-primary" onclick="openTaskModal()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Add Coursework
        </button>
        <button class="btn" style="background:#FAF6EF;border-color:var(--amber-border);color:var(--amber-dark);font-weight:600;" onclick="toggleChatDrawer()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          Chat with Assistant
        </button>
        <button class="btn" onclick="triggerReplan()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
          Replan Night
        </button>
        <button class="btn" onclick="openCustomMealModal()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          Log Nutrition
        </button>
        <button class="btn" onclick="refreshDashboard(true)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Sync State
        </button>
      </div>
      <div class="btn-group">
        <a href="/api/dashboard-data" target="_blank" class="btn">JSON API</a>
        <a href="/health" target="_blank" class="btn">Health Check</a>
      </div>
    </div>

    <!-- ScaleStudio Inspired Metric KPI Strip -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-label">DEEP WORK FOCUS</span>
          <span class="kpi-badge">11PM – 4:30AM</span>
        </div>
        <div class="kpi-val">5h 30m</div>
        <div class="kpi-sub">Peak cognitive sprint window</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-label">DAILY PROTEIN</span>
          <span class="kpi-badge" id="kpi-protein-badge">0% Goal</span>
        </div>
        <div class="kpi-val" id="kpi-protein">0 / 130g</div>
        <div class="kpi-sub" id="kpi-calories">0 / 2500 kcal • Fuel target</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-label">ACADEMIC BACKLOG</span>
          <span class="kpi-badge" id="kpi-tasks-badge">0 Pending</span>
        </div>
        <div class="kpi-val" id="kpi-tasks">0 Items</div>
        <div class="kpi-sub">KCCEMSR practical turns & lab sheets</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-label">REGIONAL CIRCUIT</span>
          <span class="kpi-badge">MUMBAI / PUNE</span>
        </div>
        <div class="kpi-val" id="kpi-hacks">10 Active</div>
        <div class="kpi-sub">Curated hackathons & prize pools</div>
      </div>
    </div>

    <!-- Active Routine Phase Banner -->
    <div class="phase-banner" id="phase-banner">
      <div class="phase-left">
        <div class="phase-icon-badge" id="phase-icon">🌙</div>
        <div>
          <div class="phase-title" id="phase-title-text">Loading Protocol...</div>
          <div class="phase-desc" id="phase-desc">Determining active routine window...</div>
        </div>
      </div>
      <span class="card-badge" style="background:#FFFFFF;">IST PROTOCOL</span>
    </div>

    <!-- Bento Grid -->
    <div class="bento-grid">
      <!-- Row 1: Deep Work Plan (Col 7) + Fitness (Col 5) -->
      <div class="card col-7 fixed-tier-1">
        <div class="card-header">
          <div class="card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            <span>Deep Work Timeline</span>
            <span style="font-family:'Instrument Serif',serif;font-style:italic;font-size:15px;color:var(--amber-dark);text-transform:none;letter-spacing:0;">(11:00 PM – 4:30 AM)</span>
          </div>
          <div class="card-badge" id="blocks-count">0 Blocks</div>
        </div>
        <div class="timeline-list scroll-box" id="schedule-list">
          <div style="color:var(--text-muted);font-size:12px;padding:12px;text-align:center;">No timeline blocks scheduled. Tap "Replan Night" to pack your coursework.</div>
        </div>
      </div>

      <div class="card col-5 fixed-tier-1">
        <div class="card-header">
          <div class="card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 5v14M18 5v14M2 9v6M22 9v6M6 12h12"/></svg>
            <span>Macro & Gym Engine</span>
          </div>
          <div class="card-badge">Target: 130g P • 2500 kcal</div>
        </div>
        <div class="fitness-container">
          <div>
            <div class="meter-item">
              <div class="meter-label">
                <span style="color:var(--text-muted);">PROTEIN PROGRESS</span>
                <span id="protein-val" style="font-weight:600;">0 / 130g (0%)</span>
              </div>
              <div class="meter-track">
                <div class="meter-bar protein" id="protein-bar" style="width: 0%;"></div>
              </div>
            </div>

            <div class="meter-item">
              <div class="meter-label">
                <span style="color:var(--text-muted);">ENERGY CALORIES</span>
                <span id="calories-val" style="font-weight:600;">0 / 2500 kcal (0%)</span>
              </div>
              <div class="meter-track">
                <div class="meter-bar calories" id="calories-bar" style="width: 0%;"></div>
              </div>
            </div>
          </div>

          <div>
            <div class="sub-section-title">1-TAP MACRO PRESETS</div>
            <div class="preset-grid">
              <button class="preset-chip" onclick="logPreset('whey_shake')">
                <span class="p-name">Whey Shake</span>
                <span class="p-val">+26g</span>
              </button>
              <button class="preset-chip" onclick="logPreset('eggs_toast')">
                <span class="p-name">Eggs + Toast</span>
                <span class="p-val">+28g</span>
              </button>
              <button class="preset-chip" onclick="logPreset('solid_dinner')">
                <span class="p-name">Solid Dinner</span>
                <span class="p-val">+34g</span>
              </button>
              <button class="preset-chip" onclick="logPreset('quick_snack')">
                <span class="p-name">PB / Sprout</span>
                <span class="p-val">+14g</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Row 2: Print Bundler (Col 4) + Hackathons (Col 4) + Ecosystem (Col 4) -->
      <div class="card col-4 fixed-tier-2">
        <div class="card-header">
          <div class="card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
            <span>Physical Xerox & Bag</span>
          </div>
          <div class="card-badge" id="print-count">0 Turns</div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;">
          <div class="scroll-box" id="print-list" style="max-height:105px;overflow-y:auto;margin-bottom:8px;">
            <div style="font-size:11.5px;color:var(--emerald);">✓ All lab submissions printed and packed.</div>
          </div>
          <div>
            <div class="sub-section-title">COMMUTE BACKPACK SAFETY</div>
            <div id="backpack-list"></div>
          </div>
        </div>
      </div>

      <div class="card col-4 fixed-tier-2">
        <div class="card-header">
          <div class="card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.45 1-1 1H7v4h10v-4h-2c-.55 0-1-.45-1-1v-2.34"></path><path d="M6 4h12v7a6 6 0 0 1-12 0V4z"></path></svg>
            <span>Regional Hackathons</span>
          </div>
          <div class="card-badge">Mumbai / Thane / Pune</div>
        </div>
        <div class="scroll-box" id="hackathon-list" style="flex:1;overflow-y:auto;">
          <div style="color:var(--text-muted);font-size:11.5px;">Loading curated competitions...</div>
        </div>
      </div>

      <div class="card col-4 fixed-tier-2">
        <div class="card-header">
          <div class="card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            <span>Connected Ecosystem</span>
          </div>
          <div class="card-badge">Permanent Bridge</div>
        </div>
        <div class="scroll-box" style="flex:1;overflow-y:auto;">
          <div class="hub-row">
            <div>
              <div class="hub-title">WhatsApp Academic Bridge</div>
              <div class="hub-sub">Strict Read-Only Guard (Active)</div>
            </div>
            <span class="status-tag completed" id="hub-wa-tag">ACTIVE</span>
          </div>
          <div class="hub-row">
            <div>
              <div class="hub-title">Discord Broadcaster</div>
              <div class="hub-sub">Permanent Webhook Channel</div>
            </div>
            <span class="status-tag completed" id="hub-dc-tag">ACTIVE</span>
          </div>
          <div class="hub-row">
            <div>
              <div class="hub-title">Telegram Bot Gateway</div>
              <div class="hub-sub">@parth_assistant_bot Polling</div>
            </div>
            <span class="status-tag completed">ACTIVE</span>
          </div>
          <div class="hub-row">
            <div>
              <div class="hub-title">Atlassian Trello Sync</div>
              <div class="hub-sub">Academic Boards & Turns PKCE</div>
            </div>
            <span class="status-tag completed" id="hub-trello-tag">SYNCED</span>
          </div>
          <div class="hub-row">
            <div>
              <div class="hub-title">GitHub Commit Tracker</div>
              <div class="hub-sub">ParthVarekar (27 Repositories)</div>
            </div>
            <span class="status-tag completed">ACTIVE</span>
          </div>
        </div>
      </div>

      <!-- Row 3: Task Manager (Col 8) + Cloud Telemetry (Col 4) -->
      <div class="card col-8 fixed-tier-3">
        <div class="card-header" style="margin-bottom:8px;padding-bottom:8px;">
          <div class="card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
            <span>Coursework & Task Backlog</span>
          </div>
          <div class="card-badge" id="tasks-count">0 Tasks</div>
        </div>
        <div class="task-controls">
          <div class="filter-tabs">
            <button class="filter-tab active" data-filter="all" onclick="setTaskFilter('all')">All</button>
            <button class="filter-tab" data-filter="submission" onclick="setTaskFilter('submission')">Turns</button>
            <button class="filter-tab" data-filter="coding" onclick="setTaskFilter('coding')">Coding</button>
            <button class="filter-tab" data-filter="assignment" onclick="setTaskFilter('assignment')">Assignments</button>
          </div>
          <input type="text" class="task-search-input" id="task-search" placeholder="Filter tasks..." oninput="renderTasksList()" />
        </div>
        <div class="scroll-box" id="task-list" style="flex:1;overflow-y:auto;padding-right:2px;">
          <div style="color:var(--text-muted);font-size:12px;padding:12px;text-align:center;">No pending tasks! All caught up.</div>
        </div>
      </div>

      <div class="card col-4 fixed-tier-3">
        <div class="card-header" style="margin-bottom:8px;padding-bottom:8px;">
          <div class="card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>
            <span>Render Telemetry</span>
          </div>
          <div class="card-badge">Zero-Downtime</div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div class="telemetry-row">
              <span class="telemetry-key">HOST PLATFORM</span>
              <span class="telemetry-val" style="color:var(--emerald);">Render Web Service</span>
            </div>
            <div class="telemetry-row">
              <span class="telemetry-key">SCHEDULER TICK</span>
              <span class="telemetry-val">15s Proactive Pulse</span>
            </div>
            <div class="telemetry-row">
              <span class="telemetry-key">DATABASE</span>
              <span class="telemetry-val">SQLite (WAL Mode)</span>
            </div>
            <div class="telemetry-row">
              <span class="telemetry-key">NODE RUNTIME</span>
              <span class="telemetry-val" id="sys-node">-</span>
            </div>
            <div class="telemetry-row">
              <span class="telemetry-key">MEMORY (RSS)</span>
              <span class="telemetry-val" id="sys-mem">-</span>
            </div>
            <div class="telemetry-row">
              <span class="telemetry-key">SYSTEM UPTIME</span>
              <span class="telemetry-val" id="sys-uptime">-</span>
            </div>
          </div>
          <div style="padding-top:10px;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;color:var(--text-muted);font-family:'Fragment Mono',monospace;">STATUS: HEALTHY</span>
            <button class="btn" style="padding:3px 8px;font-size:10.5px;" onclick="refreshDashboard(true)">Ping Telemetry</button>
          </div>
        </div>
      </div>

      <!-- Row 4: AI & Deep-Tech Radar (Col 8) + Persistent Brain Memory (Col 4) -->
      <div class="card col-8 fixed-tier-2">
        <div class="card-header" style="margin-bottom:8px;padding-bottom:8px;">
          <div class="card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>
            <span>AI & Deep-Tech Radar</span>
            <span style="font-family:'Instrument Serif',serif;font-style:italic;font-size:15px;color:var(--amber-dark);text-transform:none;letter-spacing:0;">(Frontier Models, GPU Systems & Papers)</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button class="btn" style="padding:2px 7px;font-size:10px;" onclick="triggerAiScan()">Scan Radar</button>
            <div class="card-badge" id="ai-news-count">0 Insights</div>
          </div>
        </div>
        <div class="scroll-box" id="ai-news-list" style="flex:1;overflow-y:auto;padding-right:2px;">
          <div style="color:var(--text-muted);font-size:12px;padding:12px;text-align:center;">Scanning frontier AI & GPU research...</div>
        </div>
      </div>

      <div class="card col-4 fixed-tier-2">
        <div class="card-header" style="margin-bottom:8px;padding-bottom:8px;">
          <div class="card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1 2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            <span>Persistent Brain Memory</span>
          </div>
          <div class="card-badge" id="memory-count">0 Notes</div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;">
          <div class="scroll-box" id="memory-list" style="flex:1;overflow-y:auto;margin-bottom:8px;">
            <div style="color:var(--text-muted);font-size:11.5px;">Notion & Slack Brain active.</div>
          </div>
          <div style="padding-top:6px;border-top:1px solid var(--border-subtle);font-size:10px;color:var(--text-muted);font-family:'Fragment Mono',monospace;">
            SYNC: SQLite ⇄ Notion ⇄ Slack
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Task Modal -->
  <div class="modal-overlay" id="task-modal">
    <div class="modal">
      <div class="modal-title">
        <span>Add Coursework Task</span>
        <button class="btn" onclick="closeModals()" style="padding:1px 6px;">✕</button>
      </div>
      <form id="task-form" onsubmit="submitTask(event)">
        <div class="form-group">
          <label class="form-label">TASK TITLE</label>
          <input type="text" class="form-input" id="t-title" required placeholder="e.g. Distributed Systems Lab Turn 3" />
        </div>
        <div class="form-group">
          <label class="form-label">CATEGORY</label>
          <select class="form-select" id="t-category">
            <option value="submission">Practical Turn / Xerox Submission</option>
            <option value="coding">Coding Sprint</option>
            <option value="assignment">Assignment / Writeup</option>
            <option value="study">Study / Exam Prep</option>
            <option value="fitness">Fitness</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">PRIORITY</label>
          <select class="form-select" id="t-priority">
            <option value="urgent">Urgent</option>
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

  <!-- Meal Modal -->
  <div class="modal-overlay" id="meal-modal">
    <div class="modal">
      <div class="modal-title">
        <span>Log Custom Nutrition</span>
        <button class="btn" onclick="closeModals()" style="padding:1px 6px;">✕</button>
      </div>
      <form id="meal-form" onsubmit="submitCustomMeal(event)">
        <div class="form-group">
          <label class="form-label">MEAL NAME</label>
          <input type="text" class="form-input" id="m-name" required placeholder="e.g. Paneer Wrap / Boiled Eggs" />
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

  <!-- Floating Chat Action Button -->
  <button class="chat-fab" onclick="toggleChatDrawer()">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
    <span>Chat with AI</span>
  </button>

  <!-- Sliding Chat Backdrop & Drawer -->
  <div class="chat-backdrop" id="chat-backdrop" onclick="toggleChatDrawer()"></div>
  <div class="chat-drawer" id="chat-drawer">
    <div class="chat-drawer-header">
      <div style="display:flex;align-items:center;gap:9px;">
        <div class="pulse-dot"></div>
        <div>
          <div style="font-family:'Inter Tight',sans-serif;font-weight:700;font-size:14px;color:var(--text-main);">PARTH.OS Assistant Brain</div>
          <div style="font-family:'Fragment Mono',monospace;font-size:10px;color:var(--text-muted);">24/7 CLOUD REASONING ENGINE</div>
        </div>
      </div>
      <button class="btn" style="padding:2px 8px;font-size:11px;" onclick="toggleChatDrawer()">✕</button>
    </div>
    <div class="chat-messages scroll-box" id="chat-messages">
      <div class="chat-bubble assistant">
        👋 Hi Parth! I'm your Personal Operating Assistant. You can chat with me here, update tasks, check your timetable, log macros, or ask about hackathons.
      </div>
    </div>
    <div class="chat-quick-chips">
      <button class="quick-chip" onclick="sendQuickPrompt('What should I do next?')">What's next?</button>
      <button class="quick-chip" onclick="sendQuickPrompt('Replan night schedule')">⚡ Replan</button>
      <button class="quick-chip" onclick="sendQuickPrompt('Log Whey Shake')">🥤 Whey Shake</button>
      <button class="quick-chip" onclick="sendQuickPrompt('Show upcoming hackathons')">🏆 Hackathons</button>
      <button class="quick-chip" onclick="sendQuickPrompt('What lab prints are pending?')">🖨️ Prints</button>
    </div>
    <form class="chat-input-bar" onsubmit="submitChatMessage(event)">
      <input type="text" id="chat-input" class="chat-input" placeholder="Type message, add task, replan, log food..." autocomplete="off" />
      <button type="submit" class="btn btn-primary" style="padding:6px 14px;" id="chat-send-btn">Send</button>
    </form>
  </div>

  <div id="toast"></div>

  <script>
    let allTasks = [];
    let currentTaskFilter = 'all';
    let isChatOpen = false;

    function toggleChatDrawer() {
      isChatOpen = !isChatOpen;
      document.getElementById('chat-drawer').classList.toggle('open', isChatOpen);
      document.getElementById('chat-backdrop').classList.toggle('open', isChatOpen);
      if (isChatOpen) {
        document.getElementById('chat-input').focus();
        loadChatHistory();
      }
    }

    async function loadChatHistory() {
      try {
        const res = await fetch('/api/chat/history');
        if (!res.ok) return;
        const data = await res.json();
        if (data.history) renderChatHistory(data.history);
      } catch (err) {
        console.error(err);
      }
    }

    function renderChatHistory(history) {
      const container = document.getElementById('chat-messages');
      if (!container) return;
      container.innerHTML = history.map(m => {
        const roleClass = m.role === 'user' ? 'user' : (m.role === 'system' ? 'system' : 'assistant');
        return '<div class="chat-bubble ' + roleClass + '">' +
          m.text.replace(/\\n/g, '<br/>') +
        '</div>';
      }).join('');
      container.scrollTop = container.scrollHeight;
    }

    async function submitChatMessage(e) {
      if (e) e.preventDefault();
      const input = document.getElementById('chat-input');
      const text = input.value.trim();
      if (!text) return;

      input.value = '';
      const sendBtn = document.getElementById('chat-send-btn');
      sendBtn.disabled = true;
      sendBtn.innerText = '...';

      // Optimistic append
      const container = document.getElementById('chat-messages');
      container.innerHTML += '<div class="chat-bubble user">' + text + '</div>';
      container.scrollTop = container.scrollHeight;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.history) {
            renderChatHistory(data.history);
          } else if (data.reply) {
            container.innerHTML += '<div class="chat-bubble assistant">' + data.reply.replace(/\\n/g, '<br/>') + '</div>';
            container.scrollTop = container.scrollHeight;
          }
          if (data.actionsTaken && data.actionsTaken.length > 0) {
            showToast(data.actionsTaken[0]);
          }
          refreshDashboard();
        }
      } catch (err) {
        container.innerHTML += '<div class="chat-bubble system">Error communicating with assistant brain.</div>';
      } finally {
        sendBtn.disabled = false;
        sendBtn.innerText = 'Send';
      }
    }

    function sendQuickPrompt(promptText) {
      document.getElementById('chat-input').value = promptText;
      submitChatMessage();
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 2800);
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
      if (isChatOpen) toggleChatDrawer();
    }

    function openTaskModal() {
      document.getElementById('task-modal').style.display = 'flex';
    }

    function openCustomMealModal() {
      document.getElementById('meal-modal').style.display = 'flex';
    }

    function setTaskFilter(filter) {
      currentTaskFilter = filter;
      document.querySelectorAll('.filter-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
      });
      renderTasksList();
    }

    function renderTasksList() {
      const container = document.getElementById('task-list');
      const search = (document.getElementById('task-search')?.value || '').toLowerCase().trim();

      const filtered = allTasks.filter(t => {
        const matchesFilter = currentTaskFilter === 'all' || t.category === currentTaskFilter;
        const matchesSearch = !search || t.title.toLowerCase().includes(search);
        return matchesFilter && matchesSearch;
      });

      document.getElementById('tasks-count').innerText = filtered.length + ' of ' + allTasks.length;

      if (filtered.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:11.5px;padding:16px;text-align:center;">No tasks matching current filter.</div>';
        return;
      }

      container.innerHTML = filtered.map(t => {
        const dotClass = t.priority === 'urgent' ? 'pri-urgent' : (t.priority === 'high' ? 'pri-high' : 'pri-medium');
        return '<div class="task-row">' +
          '<div class="task-main">' +
            '<div class="priority-dot ' + dotClass + '"></div>' +
            '<span class="task-name" title="' + t.title + '">' + t.title + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:6px;">' +
            '<span class="task-meta-tag">' + t.category.slice(0, 4).toUpperCase() + ' • ' + t.estimatedMinutes + 'm</span>' +
            '<button class="btn" style="padding:2px 7px;font-size:10px;" onclick="completeTask(\\'' + t.id + '\\')">✓</button>' +
          '</div>' +
        '</div>';
      }).join('');
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
      document.getElementById('phase-icon').innerText = data.routinePhase.icon;
      document.getElementById('phase-title-text').innerText = data.routinePhase.label;
      document.getElementById('phase-desc').innerText = data.routinePhase.description;

      // Schedule blocks
      const sContainer = document.getElementById('schedule-list');
      document.getElementById('blocks-count').innerText = data.schedule.blocksCount + ' Blocks';
      if (data.schedule.blocks.length === 0) {
        sContainer.innerHTML = '<div style="color:var(--text-muted);font-size:11.5px;padding:12px;text-align:center;">No blocks active. Tap "Replan Night" above.</div>';
      } else {
        sContainer.innerHTML = data.schedule.blocks.map(b => {
          const isDone = b.status === 'completed';
          return '<div class="timeline-row">' +
            '<div class="time-slot">' + b.startTime + ' – ' + b.endTime + '</div>' +
            '<div class="time-title">' + (b.taskTitle || 'Deep Work Sprint') + '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
              '<span class="status-tag ' + (isDone ? 'completed' : '') + '">' + b.status + '</span>' +
              (!isDone ? '<button class="btn" style="padding:2px 6px;font-size:10px;" onclick="completeBlock(\\'' + b.id + '\\')">✓</button>' : '') +
            '</div>' +
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

      // ScaleStudio KPI Strip updates
      const kpiProt = document.getElementById('kpi-protein');
      if (kpiProt) kpiProt.innerText = p.current + ' / ' + p.target + 'g';
      const kpiProtBadge = document.getElementById('kpi-protein-badge');
      if (kpiProtBadge) kpiProtBadge.innerText = p.percent + '% P';
      const kpiCal = document.getElementById('kpi-calories');
      if (kpiCal) kpiCal.innerText = c.current + ' / ' + c.target + ' kcal • Fuel target';

      const kpiTasks = document.getElementById('kpi-tasks');
      if (kpiTasks) kpiTasks.innerText = data.tasks.totalPending + ' Items';
      const kpiTasksBadge = document.getElementById('kpi-tasks-badge');
      if (kpiTasksBadge) kpiTasksBadge.innerText = data.tasks.totalPending + ' Pending';

      const kpiHacks = document.getElementById('kpi-hacks');
      if (kpiHacks) kpiHacks.innerText = data.hackathons.total + ' Active';

      // Print Queue
      document.getElementById('print-count').innerText = data.printQueue.totalItems + ' Turns';
      const printContainer = document.getElementById('print-list');
      if (data.printQueue.items.length === 0) {
        printContainer.innerHTML = '<div style="font-size:11px;color:var(--emerald);">✓ All coursework printed & submitted.</div>';
      } else {
        printContainer.innerHTML = data.printQueue.items.map(p => {
          return '<div style="background:var(--bg-surface-elevated);border:1px solid var(--border);border-radius:4px;padding:5px 8px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">' +
            '<div style="font-size:11px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;">' + p.title + '</div>' +
            '<span class="card-badge">' + p.estimatedPages + ' pgs</span>' +
          '</div>';
        }).join('');
      }

      // Backpack
      const bpContainer = document.getElementById('backpack-list');
      bpContainer.innerHTML = data.printQueue.backpackChecklist.slice(0, 4).map(b => {
        return '<div class="checklist-row">' +
          '<span style="color:' + (b.packed ? 'var(--emerald)' : 'var(--amber)') + ';font-size:11px;">' + (b.packed ? '✓' : '○') + '</span>' +
          '<span>' + b.item + '</span>' +
        '</div>';
      }).join('');

      // Hackathons
      const hackContainer = document.getElementById('hackathon-list');
      hackContainer.innerHTML = data.hackathons.items.map(h => {
        return '<div class="hackathon-row">' +
          '<div>' +
            '<div class="hack-name">' + h.title + '</div>' +
            '<div class="hack-sub">' + h.cityZone.toUpperCase() + ' • ' + h.registrationDeadline.slice(5) + '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:10px;font-weight:600;color:var(--emerald);">' + (h.prizePool || 'Cert') + '</div>' +
            '<button class="btn" style="padding:1px 5px;font-size:9.5px;margin-top:2px;" onclick="toggleHackBookmark(\\'' + h.id + '\\')">' + (h.isBookmarked ? '★' : '☆') + '</button>' +
          '</div>' +
        '</div>';
      }).join('');

      // Tasks
      allTasks = data.tasks.items || [];
      renderTasksList();

      // Telemetry
      document.getElementById('sys-node').innerText = data.system.nodeVersion;
      document.getElementById('sys-mem').innerText = data.system.memoryRssMb + ' MB';
      const uptimeMins = Math.floor(data.system.uptimeSeconds / 60);
      document.getElementById('sys-uptime').innerText = uptimeMins + 'm ' + (data.system.uptimeSeconds % 60) + 's';

      // AI News Radar
      if (data.aiNews) {
        const countBadge = document.getElementById('ai-news-count');
        if (countBadge) countBadge.innerText = data.aiNews.count + ' Insights';
        const aiContainer = document.getElementById('ai-news-list');
        if (aiContainer && data.aiNews.items && data.aiNews.items.length > 0) {
          aiContainer.innerHTML = data.aiNews.items.map(n => {
            return '<div class="task-row" style="margin-bottom:6px;padding:8px 10px;">' +
              '<div style="flex:1;min-width:0;margin-right:8px;">' +
                '<div style="font-size:12px;font-weight:600;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
                  '<a href="' + n.url + '" target="_blank" style="color:inherit;text-decoration:none;">' + n.title + '</a>' +
                '</div>' +
                '<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + n.summary + '</div>' +
              '</div>' +
              '<span class="task-meta-tag" style="background:#FAF6EF;color:var(--amber-dark);">' + n.category.replace('_', ' ').toUpperCase() + '</span>' +
            '</div>';
          }).join('');
        }
      }

      // Memory Brain
      if (data.memories) {
        const memCount = document.getElementById('memory-count');
        if (memCount) memCount.innerText = data.memories.count + ' Entries';
        const memContainer = document.getElementById('memory-list');
        if (memContainer && data.memories.recent && data.memories.recent.length > 0) {
          memContainer.innerHTML = data.memories.recent.map(m => {
            return '<div style="background:var(--bg-surface-elevated);border:1px solid var(--border);border-radius:4px;padding:5px 8px;margin-bottom:4px;">' +
              '<div style="font-size:10px;font-family:\'Fragment Mono\',monospace;color:var(--text-muted);text-transform:uppercase;">' + m.category + ' • ' + (m.source || 'chat') + '</div>' +
              '<div style="font-size:11px;color:var(--text-main);margin-top:2px;">' + m.content + '</div>' +
            '</div>';
          }).join('');
        }
      }
    }

    async function triggerAiScan() {
      showToast('Scanning AI Radar...');
      try {
        const res = await fetch('/api/ai-news/scan', { method: 'POST' });
        if (res.ok) {
          showToast('Radar updated!');
          refreshDashboard();
        }
      } catch (err) {
        console.error(err);
      }
    }

    async function logPreset(presetKey) {
      try {
        const res = await fetch('/api/fitness/meal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ presetKey })
        });
        if (res.ok) {
          showToast('Macro logged');
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
          showToast('Task added');
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
          showToast('Task completed');
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
          showToast('Block completed');
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
          showToast('Night schedule updated');
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
      if (pathname === "/health" && (req.method === "GET" || req.method === "HEAD")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
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

      // 11. Assistant Chat API (Process message)
      if (pathname === "/api/chat" && req.method === "POST") {
        const body = await parseJsonBody<any>(req);
        if (!body.message || typeof body.message !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Message is required" }));
          return;
        }

        const result = await processAssistantChat(body.message, "dashboard");
        const history = getChatHistory();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, reply: result.reply, actionsTaken: result.actionsTaken, history }));
        return;
      }

      // 12. Assistant Chat History API
      if (pathname === "/api/chat/history" && req.method === "GET") {
        const history = getChatHistory();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, history }));
        return;
      }

      // 13. AI Tech Radar API
      if (pathname === "/api/ai-news" && req.method === "GET") {
        const news = getSavedAiNews();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, count: news.length, news }));
        return;
      }

      if (pathname === "/api/ai-news/scan" && req.method === "POST") {
        const scanResult = await runAiIntelligenceScan();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, count: scanResult.totalRadarItems, news: scanResult.items }));
        return;
      }

      // 14. Assistant Memory & Brain API
      if (pathname === "/api/memory" && req.method === "GET") {
        const memories = getRecentMemories(50);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, count: memories.length, memories }));
        return;
      }

      // 15. Discord Gateway Status API
      if (pathname === "/api/discord/status" && req.method === "GET") {
        const status = getDiscordGatewayStatus();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, ...status }));
        return;
      }

      // 16. Trigger Discord Guild Provisioning API
      if (pathname === "/api/discord/setup" && req.method === "POST") {
        const prov = await provisionAllDiscordGuilds();
        const code = prov.success ? 200 : 400;
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(prov));
        return;
      }

      // 15. Serve Root GUI Dashboard
      if (pathname === "/" && (req.method === "GET" || req.method === "HEAD")) {
        const html = getDashboardHtml();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(html);
        return;
      }

      // 404 Fallback
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found", path: pathname }));
    } catch (err: any) {
      console.error("Dashboard server request error:", err);
      const isTooLarge = err?.message?.includes("too large");
      const isInvalidJson = err?.message?.includes("Invalid JSON");
      const statusCode = isTooLarge ? 413 : isInvalidJson ? 400 : 500;
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err?.message || "Internal Server Error" }));
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

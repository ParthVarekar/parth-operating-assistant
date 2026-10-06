import { initDatabase } from "./db/database.js";
import { getEnv } from "./config/env.js";
import { createTelegramBot } from "./telegram/bot.js";
import { startHeartbeat, stopHeartbeat } from "./scheduler/eventHeartbeat.js";
import {
  isWhatsAppConfigured,
  startWhatsAppClient,
  stopWhatsAppClient,
} from "./services/whatsappService.js";
import {
  getDiscordBotToken,
  startDiscordBot,
  stopDiscordBot,
} from "./services/discordService.js";
import {
  startDashboardServer,
  stopDashboardServer,
} from "./server/dashboardServer.js";
import { seedInitialCuratedHackathons } from "./db/repositories/hackathonRepository.js";

async function main() {
  console.log("==================================================");
  console.log("🤖 Starting Personal AI Operating Assistant (Daemon)");
  console.log("==================================================");

  // 1. Initialize SQLite Database with WAL mode
  console.log("📦 Initializing SQLite database...");
  initDatabase();
  seedInitialCuratedHackathons();
  console.log("✅ Database initialized and hackathons seeded.");

  // 1.5 Start Hanzo-styled Web Dashboard & REST API Server
  console.log("🌐 Starting Hanzo Web Dashboard & REST API Server...");
  startDashboardServer();

  // 2. Start Proactive Event Heartbeat
  console.log("⏱️ Starting proactive scheduler heartbeat (15s tick)...");
  startHeartbeat(15000);
  console.log("✅ Scheduler heartbeat active.");

  // 2.5 Start WhatsApp background listener if linked
  if (isWhatsAppConfigured()) {
    console.log("📲 Initializing WhatsApp background listener...");
    const started = await startWhatsAppClient();
    if (started) {
      console.log("✅ WhatsApp background listener connected.");
    }
  }

  // 2.6 Start Discord bot gateway if configured
  if (getDiscordBotToken()) {
    console.log("🤖 Starting Discord bot gateway...");
    await startDiscordBot();
  }

  // 3. Start Telegram Bot
  const env = getEnv();
  if (env.TELEGRAM_BOT_TOKEN === "MOCK_BOT_TOKEN" || !env.TELEGRAM_BOT_TOKEN) {
    console.log("⚠️ Running in LOCAL DAEMON / TEST MODE (No real Telegram token provided).");
    console.log("💡 To connect to live Telegram, set TELEGRAM_BOT_TOKEN in your .env file.");
    console.log("🚀 All core planning, database, and learning engines are active.");
  } else {
    console.log("📡 Connecting to Telegram via Asynchronous Long Polling...");
    const bot = createTelegramBot();
    await bot.start();
  }
}

// Graceful shutdown handling
process.on("SIGINT", async () => {
  console.log("\n🛑 Received SIGINT. Shutting down gracefully...");
  await stopDashboardServer();
  stopHeartbeat();
  stopWhatsAppClient();
  stopDiscordBot();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM. Shutting down gracefully...");
  await stopDashboardServer();
  stopHeartbeat();
  stopWhatsAppClient();
  stopDiscordBot();
  process.exit(0);
});

main().catch((err) => {
  console.error("❌ Fatal error during assistant startup:", err);
  process.exit(1);
});

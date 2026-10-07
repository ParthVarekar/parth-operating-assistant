import { processAssistantChat } from "../agent/chatHandler.js";
import { initDatabase } from "../db/database.js";
import { seedInitialCuratedHackathons } from "../db/repositories/hackathonRepository.js";
import { getDailyFitnessSummary } from "../services/fitnessService.js";
import { findPendingTasks } from "../db/repositories/taskRepository.js";
import { getPendingPrintItems } from "../services/printBundlerService.js";
import { getSavedAiNews } from "../services/aiNewsService.js";
import { scheduleEveningPlan } from "../planner/intervalScheduler.js";

async function main() {
  process.env.DATABASE_PATH = ":memory:";
  process.env.AI_PROVIDER = "mock";
  initDatabase(":memory:");
  seedInitialCuratedHackathons();

  console.log("==================================================");
  console.log("🧪 TESTING PARTH.OS BOT CAPABILITIES");
  console.log("==================================================");

  // 1. Natural Language Intent & Conversational Reasoning
  console.log("\n[TEST 1: CONVERSATIONAL REASONING & COMPARISON]");
  const chat1 = await processAssistantChat("which hackathon has the lowest prize pool?", "dashboard");
  console.log("Reply:", chat1.reply);

  // 2. Coursework Creation & Physical Xerox Pipeline
  console.log("\n[TEST 2: COURSEWORK CREATION & PHYSICAL XEROX TURN]");
  const chat2 = await processAssistantChat("Need Xerox spiral print submission for Database Systems due next Monday", "discord");
  console.log("Reply:", chat2.reply);
  console.log("Actions:", chat2.actionsTaken);
  const printItems = getPendingPrintItems();
  console.log("Print Queue Count:", printItems.length);
  if (printItems[0]) {
    console.log("Top Print Item:", printItems[0].title, "| Pages:", printItems[0].estimatedPages, "| Mode:", printItems[0].printMode);
  }

  // 3. Nutrition & Macro Tracking
  console.log("\n[TEST 3: MACRO & FITNESS LOGGING]");
  const chat3 = await processAssistantChat("Log meal: 3 eggs and toast with whey shake", "telegram");
  console.log("Reply:", chat3.reply);
  const fit = getDailyFitnessSummary();
  console.log("Current Protein:", fit.totalProtein + "g / 130g", "| Calories:", fit.totalCalories + " kcal");

  // 4. Night Planner (11 PM - 4:30 AM deep work)
  console.log("\n[TEST 4: SCHEDULE & ROUTINE PLANNER]");
  const tasks = findPendingTasks();
  const plan = scheduleEveningPlan(tasks, "2026-10-07", "22:00");
  console.log("Planned Blocks:", plan.blocks.length);
  plan.blocks.slice(0, 3).forEach((b) => {
    console.log(`• ${b.startTime} - ${b.endTime}: ${b.taskTitle}`);
  });

  // 5. AI & Deep-Tech Radar
  console.log("\n[TEST 5: AI & DEEP-TECH RADAR]");
  const news = getSavedAiNews();
  console.log("Radar Items Cached:", news.length);
  if (news[0]) {
    console.log(`Top Insight: [${news[0].category.toUpperCase()}] ${news[0].title}`);
    console.log(`Summary: ${news[0].summary}`);
  }

  console.log("\n==================================================");
  console.log("✅ ALL CAPABILITY TESTS COMPLETED SUCCESSFULLY");
  console.log("==================================================");
}

main().catch(console.error);

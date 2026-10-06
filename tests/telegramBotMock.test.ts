import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { createTelegramBot } from "../src/telegram/bot.js";
import { insertTask } from "../src/db/repositories/taskRepository.js";
import { findActiveSubmissions } from "../src/db/repositories/submissionRepository.js";
import { findMealsForDate } from "../src/db/repositories/mealRepository.js";
import type { Update } from "grammy/types";

describe("Telegram Gateway Full Mock Interaction Suite", () => {
  const authorizedUserId = 12345678;

  beforeAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = "TEST_TOKEN";
    process.env.TELEGRAM_ALLOWED_USER_ID = authorizedUserId.toString();
    initDatabase(":memory:");
  });

  function setupMockBot() {
    const bot = createTelegramBot();
    const sentMessages: Array<{ method: string; payload: Record<string, unknown> }> = [];

    bot.botInfo = {
      id: 999999,
      is_bot: true,
      first_name: "AssistantBot",
      username: "assistant_bot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    } as any;

    // Intercept all outgoing Telegram API calls (zero external network requests)
    bot.api.config.use(async (_prev, method, payload) => {
      sentMessages.push({ method, payload: payload as Record<string, unknown> });
      return {
        ok: true,
        result: {
          message_id: 999,
          date: Math.floor(Date.now() / 1000),
          chat: { id: authorizedUserId, type: "private", first_name: "Parth" },
          text: "mocked",
        },
      } as any;
    });

    return { bot, sentMessages };
  }

  it("responds to /start with operating philosophy and quick reply keyboards", async () => {
    const { bot, sentMessages } = setupMockBot();

    const update: Update = {
      update_id: 1,
      message: {
        message_id: 101,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: "private", first_name: "Parth" },
        from: { id: authorizedUserId, is_bot: false, first_name: "Parth" },
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    };

    await bot.handleUpdate(update);

    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    const startReply = sentMessages[0]!;
    expect(startReply.payload.text).toContain("Personal AI Operating Assistant Ready");
    expect(startReply.payload.text).toContain("4:30 AM sleep");
  });

  it("handles natural language submission intake and registers in 8-stage pipeline", async () => {
    const { bot, sentMessages } = setupMockBot();

    const update: Update = {
      update_id: 2,
      message: {
        message_id: 102,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: "private", first_name: "Parth" },
        from: { id: authorizedUserId, is_bot: false, first_name: "Parth" },
        text: "I have a Compiler Design submission due Friday, needs 10 pages handwritten and printout",
      },
    };

    await bot.handleUpdate(update);

    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    const reply = sentMessages[0]!;
    expect(reply.payload.text).toContain("Submission Registered in 8-Stage Pipeline");

    // Verify database record was created
    const activeSubs = findActiveSubmissions();
    expect(activeSubs.some((s) => s.subject.includes("Coursework") || s.notes?.includes("print"))).toBe(true);
  });

  it("handles '🍱 Log Meal' quick button press and persists meal record", async () => {
    const { bot, sentMessages } = setupMockBot();

    const update: Update = {
      update_id: 3,
      message: {
        message_id: 103,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: "private", first_name: "Parth" },
        from: { id: authorizedUserId, is_bot: false, first_name: "Parth" },
        text: "🍱 Log Meal",
      },
    };

    await bot.handleUpdate(update);

    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    expect(sentMessages[0]!.payload.text).toContain("Meal logged! Keep fueling your gym recovery.");

    const today = new Date().toISOString().slice(0, 10);
    const meals = findMealsForDate(today);
    expect(meals.some((m) => m.mealType === "dinner" && m.status === "completed")).toBe(true);
  });

  it("handles inline button click 'task_slip:id:15' and updates schedule in-place", async () => {
    const { bot, sentMessages } = setupMockBot();

    const task = insertTask({
      id: "bot-slip-task",
      title: "Microprocessors Code",
      category: "coding",
      status: "pending",
      priority: "urgent",
      estimatedMinutes: 45,
    });

    const update: Update = {
      update_id: 4,
      callback_query: {
        id: "cb_1",
        from: { id: authorizedUserId, is_bot: false, first_name: "Parth" },
        chat_instance: "inst_1",
        data: `task_slip:${task.id}:15`,
        message: {
          message_id: 200,
          date: Math.floor(Date.now() / 1000),
          chat: { id: authorizedUserId, type: "private", first_name: "Parth" },
          text: "Current task...",
        },
      },
    };

    await bot.handleUpdate(update);

    // Verifies editMessageText or answerCallbackQuery was called
    const editCall = sentMessages.find((m) => m.method === "editMessageText");
    expect(editCall).toBeDefined();
    expect(editCall?.payload.text).toContain("Schedule Recalibrated");
    expect(editCall?.payload.text).toContain("Dinner (21:30) and sleep boundaries remain strictly protected");
  });

  it("silently discards updates from unauthorized user IDs", async () => {
    const { bot, sentMessages } = setupMockBot();
    const maliciousAttackerId = 99999999;

    const update: Update = {
      update_id: 5,
      message: {
        message_id: 300,
        date: Math.floor(Date.now() / 1000),
        chat: { id: maliciousAttackerId, type: "private", first_name: "Stranger" },
        from: { id: maliciousAttackerId, is_bot: false, first_name: "Stranger" },
        text: "/plan",
      },
    };

    await bot.handleUpdate(update);

    // Must drop message with ZERO outgoing responses
    expect(sentMessages.length).toBe(0);
  });
});

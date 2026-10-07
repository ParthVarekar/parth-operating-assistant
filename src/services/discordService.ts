import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  WebhookClient,
  ChannelType,
  PermissionFlagsBits,
  type TextChannel,
  type Guild,
} from "discord.js";
import { getEnv } from "../config/env.js";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { findPendingTasks, insertTask, updateTaskStatus } from "../db/repositories/taskRepository.js";
import { scheduleEveningPlan } from "../planner/intervalScheduler.js";
import { handleTaskOverrun } from "../planner/replanEngine.js";
import { formatPlanMessage } from "../agent/coach.js";
import { getDailyFitnessSummary, formatFitnessDigest, logQuickPresetMeal } from "./fitnessService.js";
import { listUpcomingHackathons } from "./hackathonService.js";
import { processAssistantChat } from "../agent/chatHandler.js";
import { runAiIntelligenceScan } from "./aiNewsService.js";
import { syncTrelloTaskCompletions } from "./trelloService.js";

export type DiscordChannelCategory =
  | "schedule"
  | "hackathons"
  | "academic"
  | "fitness"
  | "github"
  | "ai_news"
  | "chat"
  | "general";

export interface DiscordEmbedOptions {
  title: string;
  description: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
  timestamp?: boolean;
}

const CATEGORY_COLORS: Record<DiscordChannelCategory, number> = {
  schedule: 0x3498db, // Crisp Blue
  hackathons: 0x9b59b6, // Royal Purple
  academic: 0xd97706, // Warm Amber / Terracotta
  fitness: 0x2ecc71, // Vibrant Green
  github: 0x24292e, // Obsidian / Dark
  ai_news: 0x0052cc, // Frontier Blue
  chat: 0x5865f2, // Blurple
  general: 0x5865f2,
};

const CATEGORY_CHANNEL_HINTS: Record<DiscordChannelCategory, string[]> = {
  schedule: ["schedule", "planner", "timetable", "sprint"],
  hackathons: ["hackathon", "hackathons", "competitions"],
  academic: ["announcement", "announcements", "college", "academic", "turns", "xerox"],
  fitness: ["fitness", "gym", "macros", "nutrition", "meals"],
  github: ["github", "commits", "code", "dev"],
  ai_news: ["ai-tech-news", "ai-news", "tech-news", "research", "radar"],
  chat: ["chat", "assistant", "bot", "general"],
  general: ["general", "bot-commands", "assistant"],
};

let activeDiscordClient: Client | null = null;
let isBotLoggedIn = false;

/**
 * Gets configured Discord Webhook URL for a specific category or default.
 */
export function getDiscordWebhookUrl(category?: DiscordChannelCategory): string {
  if (category && category !== "general") {
    const categorySpecific = getUserProfile<string>(`discord_webhook_url_${category}`);
    if (categorySpecific && categorySpecific.trim().length > 0) {
      return categorySpecific.trim();
    }
  }

  const custom = getUserProfile<string>("discord_webhook_url");
  if (custom !== undefined && custom !== null && custom.trim().length > 0) {
    return custom.trim();
  }

  const env = getEnv();
  return env.DISCORD_WEBHOOK_URL || "";
}

/**
 * Sets Discord Webhook URL in profile (optionally for a specific channel category).
 */
export function setDiscordWebhookUrl(url: string, category?: DiscordChannelCategory): void {
  if (category && category !== "general") {
    setUserProfile(`discord_webhook_url_${category}`, url.trim());
    return;
  }
  setUserProfile("discord_webhook_url", url.trim());
}

/**
 * Gets configured Discord Bot Token.
 */
export function getDiscordBotToken(): string {
  const custom = getUserProfile<string>("discord_bot_token");
  if (custom !== undefined && custom !== null && custom.trim().length > 0) {
    return custom.trim();
  }
  const env = getEnv();
  return env.DISCORD_BOT_TOKEN || "";
}

/**
 * Sets Discord Bot Token in profile.
 */
export function setDiscordBotToken(token: string): void {
  setUserProfile("discord_bot_token", token.trim());
}

/**
 * Checks if Discord is configured with either a webhook or bot token.
 */
export function isDiscordConfigured(): boolean {
  return getDiscordWebhookUrl().length > 0 || getDiscordBotToken().length > 0;
}

/**
 * Sends a rich embed message to a segregated Discord channel (via dedicated webhook or bot channel dispatch).
 */
export async function sendSegregatedDiscordEmbed(
  category: DiscordChannelCategory,
  options: DiscordEmbedOptions
): Promise<boolean> {
  const color = options.color ?? CATEGORY_COLORS[category] ?? 0x5865f2;

  // 1. If active Discord Bot Client is connected, try to find the matching guild text channel
  if (activeDiscordClient && isBotLoggedIn) {
    try {
      const channelHints = CATEGORY_CHANNEL_HINTS[category] || [];
      for (const guild of activeDiscordClient.guilds.cache.values()) {
        const targetChannel = guild.channels.cache.find(
          (c) =>
            c.isTextBased() &&
            channelHints.some((hint) => c.name.toLowerCase().includes(hint))
        ) as TextChannel | undefined;

        if (targetChannel) {
          const embed = new EmbedBuilder()
            .setTitle(options.title)
            .setDescription(options.description)
            .setColor(color);

          if (options.fields && options.fields.length > 0) {
            embed.addFields(options.fields);
          }
          if (options.footer) {
            embed.setFooter({ text: options.footer });
          }
          if (options.timestamp !== false) {
            embed.setTimestamp();
          }

          await targetChannel.send({ embeds: [embed] });
          return true;
        }
      }
    } catch (botErr) {
      console.warn("Could not post embed via Discord Bot channel search, falling back to webhook:", botErr);
    }
  }

  // 2. Fall back to Webhook delivery
  const webhookUrl = getDiscordWebhookUrl(category);
  if (!webhookUrl) {
    return false;
  }

  try {
    const isDedicated = getUserProfile<string>(`discord_webhook_url_${category}`);
    const channelTag = isDedicated ? "" : `[#${category}] `;

    const rawTitle = `${channelTag}${options.title}`.trim();
    const safeTitle = rawTitle.length > 256 ? `${rawTitle.slice(0, 253)}...` : rawTitle;

    const rawFooter = options.footer || `Antigravity • Channel: #${category}`;
    const safeFooter = rawFooter.length > 2048 ? `${rawFooter.slice(0, 2045)}...` : rawFooter;

    // Discord has a strict 6,000 total character limit across title, desc, fields, footer.
    // We cap description budget dynamically to leave room for fields and footer.
    const rawDesc = (options.description || "").trim();
    const maxDescLen = Math.min(3800, Math.max(500, 5600 - safeTitle.length - safeFooter.length));
    const safeDesc = rawDesc.length > maxDescLen ? `${rawDesc.slice(0, maxDescLen - 3)}...` : rawDesc;

    const embed = new EmbedBuilder()
      .setTitle(safeTitle)
      .setDescription(safeDesc)
      .setColor(color);

    let totalChars = safeTitle.length + safeDesc.length + safeFooter.length;
    if (options.fields && options.fields.length > 0) {
      const finalFields: { name: string; value: string; inline?: boolean }[] = [];
      for (const f of options.fields.slice(0, 25)) {
        const name = f.name.length > 256 ? `${f.name.slice(0, 253)}...` : f.name;
        const value = f.value.length > 1024 ? `${f.value.slice(0, 1020)}...` : f.value;
        if (totalChars + name.length + value.length > 5800) {
          break; // Stop adding fields before hitting Discord's 6000 limit
        }
        totalChars += name.length + value.length;
        finalFields.push({ name, value, inline: f.inline });
      }
      if (finalFields.length > 0) {
        embed.addFields(finalFields);
      }
    }

    embed.setFooter({ text: safeFooter });

    if (options.timestamp !== false) {
      embed.setTimestamp();
    }

    const webhookClient = new WebhookClient({ url: webhookUrl });
    await webhookClient.send({
      username: `Antigravity [${category.toUpperCase()}]`,
      avatarURL: "https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f916.png",
      embeds: [embed],
    });

    return true;
  } catch (err) {
    console.error(`Error sending Discord embed for #${category}:`, err);
    return false;
  }
}

/**
 * Standard backward-compatible embed dispatcher.
 */
export async function sendDiscordEmbed(options: DiscordEmbedOptions): Promise<boolean> {
  return sendSegregatedDiscordEmbed("general", options);
}

/**
 * Broadcasts daily evening plan to Discord #schedule-planner channel.
 */
export async function broadcastPlanToDiscord(planDigest: string, taskCount: number): Promise<boolean> {
  return sendSegregatedDiscordEmbed("schedule", {
    title: "📋 Evening Operating Plan & Schedule",
    description: planDigest,
    fields: [
      { name: "Total Tasks Scheduled", value: `${taskCount}`, inline: true },
      { name: "Dinner Anchor", value: "9:30 PM (Protected)", inline: true },
      { name: "Deep-Work Block", value: "11:00 PM – 4:30 AM", inline: true },
    ],
    footer: "Antigravity • #schedule-planner",
  });
}

/**
 * Broadcasts completed task to Discord #schedule-planner channel.
 */
export async function broadcastTaskDoneToDiscord(
  taskTitle: string,
  category: string,
  minutes: number
): Promise<boolean> {
  return sendSegregatedDiscordEmbed("schedule", {
    title: "✅ Sprint Task Completed!",
    description: `**${taskTitle}** (${minutes}m)`,
    fields: [
      { name: "Category", value: `\`${category}\``, inline: true },
      { name: "Logged Time", value: `${minutes} mins`, inline: true },
    ],
    footer: "Velocity recorded in operating schedule",
  });
}

/**
 * Broadcasts hackathon notice to Discord #hackathons channel.
 */
export async function broadcastHackathonToDiscord(hackathon: {
  title: string;
  cityZone: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  prizePool?: string;
  url: string;
}): Promise<boolean> {
  return sendSegregatedDiscordEmbed("hackathons", {
    title: `🚀 Regional Hackathon: ${hackathon.title}`,
    description:
      `**Location/Circuit:** ${hackathon.cityZone.toUpperCase()}\n` +
      `**Dates:** ${hackathon.startDate} → ${hackathon.endDate}\n` +
      `**Registration Closes:** **${hackathon.registrationDeadline}**\n` +
      `**Prizes:** ${hackathon.prizePool || "Certificates & Swag"}\n\n` +
      `👉 [Register on Devfolio / Unstop](${hackathon.url})`,
    footer: "Antigravity • #hackathons",
  });
}

/**
 * Broadcasts academic notice or study resource (from any WhatsApp chat, group or friend DM) to Discord #college-announcements.
 */
export async function broadcastAcademicNoticeToDiscord(alert: {
  sender: string;
  chatName: string;
  text: string;
  tasksCount: number;
  physicalSubmissionsCount: number;
  studyResourcesCount?: number;
  isDirectMessage?: boolean;
}): Promise<boolean> {
  const fields = [
    { name: "Source", value: alert.chatName, inline: true },
    { name: "Sender", value: alert.sender, inline: true },
    { name: "Tasks Added", value: `${alert.tasksCount}`, inline: true },
    {
      name: "Physical Submissions",
      value: alert.physicalSubmissionsCount > 0 ? `🚨 ${alert.physicalSubmissionsCount} Journal/Xerox` : "Digital",
      inline: true,
    },
  ];

  if (alert.studyResourcesCount && alert.studyResourcesCount > 0) {
    fields.push({
      name: "Study Resources",
      value: `📚 ${alert.studyResourcesCount} Material Link(s)`,
      inline: true,
    });
  }

  return sendSegregatedDiscordEmbed("academic", {
    title: alert.isDirectMessage
      ? `📩 Study Resource / Coursework from ${alert.sender}`
      : `📢 Academic Announcement (${alert.chatName})`,
    description: `"${alert.text}"`,
    fields,
    footer: "Antigravity • #college-announcements",
  });
}

/**
 * Broadcasts fitness/macro status to Discord #nutrition-fitness channel.
 */
export async function broadcastFitnessToDiscord(digestText: string): Promise<boolean> {
  return sendSegregatedDiscordEmbed("fitness", {
    title: "🏋️ Daily Macro & Fitness Fuel Status",
    description: digestText,
    footer: "Antigravity • #nutrition-fitness",
  });
}

/**
 * Broadcasts GitHub commit update to Discord #github-activity channel.
 */
export async function broadcastGitHubToDiscord(messageText: string): Promise<boolean> {
  return sendSegregatedDiscordEmbed("github", {
    title: "🐙 GitHub Activity & Deep-Work Streak",
    description: messageText,
    footer: "Antigravity • #github-activity",
  });
}

/**
 * Broadcasts spontaneous autonomous reminder to Discord #assistant-chat channel.
 */
export async function broadcastProactiveRemarkToDiscord(title: string, remark: string): Promise<boolean> {
  return sendSegregatedDiscordEmbed("chat", {
    title: `💡 ${title}`,
    description: remark,
    footer: "Autonomous Operational Agent",
  });
}

/**
 * Broadcasts an AI & Tech Intelligence breakthrough to Discord #ai-tech-news channel.
 */
export async function broadcastAiNewsToDiscord(item: {
  title: string;
  summary: string;
  url: string;
  source: string;
  category: string;
}): Promise<boolean> {
  return sendSegregatedDiscordEmbed("ai_news", {
    title: `⚡ [${item.category.toUpperCase()}] ${item.title}`,
    description: `${item.summary}\n\n🔗 [Read Breakthrough Source](${item.url})`,
    fields: [
      { name: "Source", value: item.source, inline: true },
      { name: "Category", value: item.category, inline: true },
    ],
    footer: "Antigravity • #ai-tech-news Radar",
  });
}

/**
 * Automatically provisions segregated channels and categories on Parth's Discord server
 * if the bot has Manage Channels permission.
 */
export async function autoProvisionDiscordGuild(guild: Guild): Promise<{
  created: string[];
  alreadyPresent: string[];
  error?: string;
}> {
  const me = guild.members.me;
  if (me && !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return {
      created: [],
      alreadyPresent: [],
      error: "Bot lacks 'Manage Channels' permission. Please grant the bot 'Manage Channels' permission in Server Settings -> Roles.",
    };
  }

  const existingChannels = await guild.channels.fetch();
  const created: string[] = [];
  const alreadyPresent: string[] = [];

  // Find or create Category: "PARTH.OS ASSISTANT"
  let categoryChannel = existingChannels.find(
    (c) => c?.type === ChannelType.GuildCategory && c.name.toUpperCase().includes("PARTH.OS")
  );

  if (!categoryChannel) {
    categoryChannel = await guild.channels.create({
      name: "📁 PARTH.OS ASSISTANT",
      type: ChannelType.GuildCategory,
    });
    created.push("📁 PARTH.OS ASSISTANT (Category)");
  }

  const targetChannels: Array<{
    name: string;
    topic: string;
    categoryKey: DiscordChannelCategory;
    introTitle: string;
    introDesc: string;
  }> = [
    {
      name: "schedule",
      topic: "Daily operating schedule, evening replans, 9:30 PM dinner & 4:30 AM sleep anchors",
      categoryKey: "schedule",
      introTitle: "📅 #schedule Channel Active",
      introDesc: "Your daily timetable, deep-work sprints, and evening replan engine broadcasts will stream here.",
    },
    {
      name: "hackathons",
      topic: "Curated regional hackathons in Mumbai, Thane, Navi Mumbai, and Pune with deadlines & prize pools",
      categoryKey: "hackathons",
      introTitle: "🏆 #hackathons Radar Active",
      introDesc: "Autonomous hackathon scouting updates and bookmark digests will be posted here.",
    },
    {
      name: "academics",
      topic: "WhatsApp class notices, laboratory turns, journals, printouts, and professor deadlines",
      categoryKey: "academic",
      introTitle: "📚 #academics Broadcast Active",
      introDesc: "Verified coursework submissions and Xerox/printout checklists detected from WhatsApp will alert here.",
    },
    {
      name: "fitness",
      topic: "Daily 130g protein macro tracking, meal presets, and workout logs",
      categoryKey: "fitness",
      introTitle: "💪 #fitness Tracking Active",
      introDesc: "Whey shake reminders, meal logging, and macro velocity digests stream to this channel.",
    },
    {
      name: "github",
      topic: "Daily commit history, streak counter, and 45m deep-work repository tracker",
      categoryKey: "github",
      introTitle: "🐙 #github Activity Active",
      introDesc: "Daily commit progress and 1-commit-a-day rule monitoring stream here.",
    },
    {
      name: "ai-tech-news",
      topic: "Frontier AI research papers, Hacker News breakthroughs, systems GPU architectures, and tech radar",
      categoryKey: "ai_news",
      introTitle: "⚡ #ai-tech-news Radar Active",
      introDesc: "Deep-niche AI breakthroughs, Hugging Face daily papers, and top systems news stream here to keep you ahead of the industry.",
    },
    {
      name: "assistant-chat",
      topic: "Direct conversation interface with your Personal AI Operating Assistant",
      categoryKey: "chat",
      introTitle: "💬 #assistant-chat Ready",
      introDesc: "Chat directly with your assistant, delegate tasks, replan your schedule, or ask any question here!",
    },
  ];

  for (const ch of targetChannels) {
    const existing = existingChannels.find(
      (c) => c?.type === ChannelType.GuildText && c.name.toLowerCase() === ch.name
    );

    if (existing) {
      alreadyPresent.push(`#${ch.name}`);
      setUserProfile(`discord_channel_id_${ch.categoryKey}`, existing.id);
    } else {
      const newChan = await guild.channels.create({
        name: ch.name,
        type: ChannelType.GuildText,
        parent: categoryChannel.id,
        topic: ch.topic,
      });
      created.push(`#${ch.name}`);
      setUserProfile(`discord_channel_id_${ch.categoryKey}`, newChan.id);

      // Post welcome embed
      newChan
        .send({
          embeds: [
            new EmbedBuilder()
              .setTitle(ch.introTitle)
              .setDescription(ch.introDesc)
              .setColor(CATEGORY_COLORS[ch.categoryKey])
              .setFooter({ text: "PARTH.OS • Autonomous Personal Assistant" })
              .setTimestamp(),
          ],
        })
        .catch(console.warn);
    }
  }

  return { created, alreadyPresent };
}

/**
 * Starts the live Discord bot gateway if a bot token is provided.
 */
export async function startDiscordBot(): Promise<boolean> {
  const token = getDiscordBotToken();
  if (!token) {
    return false;
  }

  if (activeDiscordClient && isBotLoggedIn) {
    return true;
  }

  try {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    client.on("ready", async () => {
      isBotLoggedIn = true;
      activeDiscordClient = client;
      console.log(`🤖 Discord Bot logged in as ${client.user?.tag}! Ready across segregated channels.`);

      // Auto-provision server channels if server is blank / has only default channels
      for (const guild of client.guilds.cache.values()) {
        try {
          const textChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText);
          if (textChannels.size <= 2) {
            console.log(`⚡ Auto-provisioning channels on server "${guild.name}"...`);
            await autoProvisionDiscordGuild(guild);
          }
        } catch (err: any) {
          console.warn(`Could not auto-provision channels on guild ${guild.name}:`, err?.message || err);
        }
      }
    });

    client.on("messageCreate", async (message) => {
      if (message.author.bot) return;

      const content = message.content.trim();
      const channelName = "name" in message.channel ? (message.channel.name as string).toLowerCase() : "";

      // 1. Natural Language Conversation in #assistant-chat or when @mentioned
      const isMentioned = client.user ? message.mentions.has(client.user) : false;
      const isChatChannel = channelName.includes("chat") || channelName.includes("assistant") || isMentioned;

      if (isChatChannel && !content.startsWith("!")) {
        // Strip bot mention
        const cleanContent = content.replace(/<@!?\d+>/g, "").trim();
        if (cleanContent.length > 0) {
          const { reply } = await processAssistantChat(cleanContent, "discord");
          await message.reply(reply);
          return;
        }
      }

      // 2. Command Processing
      if (!content.startsWith("!")) return;

      const [command, ...args] = content.slice(1).split(/\s+/);
      const cmd = command?.toLowerCase();

      if (cmd === "ping") {
        await message.reply("🏓 Pong! Antigravity Assistant is active and listening 24/7 in the cloud.");
        return;
      }

      if (cmd === "plan" || cmd === "today") {
        const today = new Date().toISOString().slice(0, 10);
        const nowTime = new Date().toTimeString().slice(0, 5);
        const tasks = findPendingTasks();
        const plan = scheduleEveningPlan(tasks, today, nowTime);
        const text = formatPlanMessage(plan);
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🔄 Evening Operating Plan")
              .setDescription(text)
              .setColor(0x3498db),
          ],
        });
        return;
      }

      if (cmd === "next") {
        const tasks = findPendingTasks();
        const activeTask = tasks[0];
        if (!activeTask) {
          await message.reply("✨ All tasks complete! Dinner and sleep slots are protected.");
          return;
        }
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`📌 CURRENT TASK: ${activeTask.title}`)
              .setDescription(
                `⏳ **Estimated:** ${activeTask.estimatedMinutes} mins\n` +
                `📦 **Category:** \`${activeTask.category}\`\n` +
                (activeTask.deadline ? `🚨 **Deadline:** ${activeTask.deadline}` : "")
              )
              .setColor(0xf1c40f),
          ],
        });
        return;
      }

      if (cmd === "done") {
        const tasks = findPendingTasks();
        const activeTask = tasks[0];
        if (!activeTask) {
          await message.reply("No active task to mark done.");
          return;
        }
        updateTaskStatus(activeTask.id, "completed", activeTask.estimatedMinutes);
        await message.reply(`🎉 Completed "**${activeTask.title}**"! Schedule updating...`);
        return;
      }

      if (cmd === "replan") {
        const today = new Date().toISOString().slice(0, 10);
        const nowTime = new Date().toTimeString().slice(0, 5);
        const result = handleTaskOverrun(nowTime, today);
        await message.reply(
          `⚡ Rebalanced schedule. ${result.summaryExplanation}`
        );
        return;
      }

      if (cmd === "tasks") {
        const tasks = findPendingTasks();
        if (tasks.length === 0) {
          await message.reply("Zero pending tasks in queue!");
          return;
        }
        const lines = tasks
          .slice(0, 10)
          .map((t, i) => `${i + 1}. **${t.title}** (${t.estimatedMinutes}m) [${t.category}]`);
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`📋 Pending Tasks (${tasks.length})`)
              .setDescription(lines.join("\n"))
              .setColor(0x5865f2),
          ],
        });
        return;
      }

      if (cmd === "sprint") {
        const repoName = args.join(" ") || "Engineering Sprint";
        const today = new Date().toISOString().slice(0, 10);
        const task = insertTask({
          id: crypto.randomUUID(),
          title: `Code: ${repoName}`,
          category: "coding",
          status: "pending",
          priority: "high",
          estimatedMinutes: 45,
          deadline: `${today}T23:59:00Z`,
        });
        await message.reply(`✅ Added sprint task "**${task.title}**" (45m) for tonight's 11 PM deep-work block!`);
        return;
      }

      if (cmd === "gym" || cmd === "macros") {
        const summary = getDailyFitnessSummary();
        const text = formatFitnessDigest(summary);
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🍱 Gym & Macro Tracker (130g Protein Goal)")
              .setDescription(text)
              .setColor(0xe67e22),
          ],
        });
        return;
      }

      if (cmd === "meal") {
        const preset = args[0]?.toLowerCase() || "whey_shake";
        try {
          const entry = logQuickPresetMeal(preset);
          await message.reply(`🥤 Logged meal preset **${entry.mealName}** (+${entry.proteinGrams}g protein, ${entry.calories} kcal)!`);
        } catch {
          await message.reply(`Available presets: \`whey_shake\`, \`eggs_toast\`, \`solid_dinner\`, \`quick_snack\``);
        }
        return;
      }

      if (cmd === "hackathons") {
        const list = listUpcomingHackathons("all");
        const lines = list
          .slice(0, 5)
          .map(
            (h, i) =>
              `${i + 1}. **${h.title}** (${h.cityZone.toUpperCase()})\n` +
              `   🗓️ ${h.startDate} → ${h.endDate} | Closes: **${h.registrationDeadline}**\n` +
              `   💰 Prize: ${h.prizePool || "Certificates"} | [Link](${h.url})`
          );
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🚀 Regional Hackathons (Mumbai / Thane / Pune)")
              .setDescription(lines.join("\n\n"))
              .setColor(0x9b59b6),
          ],
        });
        return;
      }

      if (cmd === "setup") {
        if (!message.guild) {
          await message.reply("Please run `!setup` inside a Discord server channel.");
          return;
        }
        await message.reply("⚙️ Scanning server and provisioning segregated channels for PARTH.OS...");
        const result = await autoProvisionDiscordGuild(message.guild);
        if (result.error) {
          await message.reply(`⚠️ **Setup Incomplete**: ${result.error}`);
        } else {
          await message.reply(
            `🎉 **Discord Auto-Configuration Complete!**\n` +
            (result.created.length > 0 ? `• **Created:** ${result.created.join(", ")}\n` : "") +
            (result.alreadyPresent.length > 0 ? `• **Configured:** ${result.alreadyPresent.join(", ")}\n` : "") +
            `All segregated channels are active and mapped to autonomous broadcasts!`
          );
        }
        return;
      }

      if (cmd === "news" || cmd === "tech" || cmd === "radar") {
        const scan = await runAiIntelligenceScan();
        const top = scan.items.slice(0, 4);
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⚡ Latest AI & Frontier Tech Radar")
              .setDescription(
                top
                  .map(
                    (item, i) =>
                      `${i + 1}. **[${item.title}](${item.url})**\n• ${item.summary}\n_Source: ${item.source}_`
                  )
                  .join("\n\n")
              )
              .setColor(0x0052cc)
              .setFooter({ text: "PARTH.OS • Frontier Industry Intel" })
              .setTimestamp(),
          ],
        });
        return;
      }

      if (cmd === "trello" || cmd === "sync") {
        const syncResult = await syncTrelloTaskCompletions();
        await message.reply(syncResult.message);
        return;
      }

      if (cmd === "help") {
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🤖 Antigravity Assistant Commands")
              .setDescription(
                "**Primary Channel Ecosystem:**\n" +
                "• `#schedule-planner`: `!plan`, `!next`, `!done`, `!replan`\n" +
                "• `#hackathons`: `!hackathons` (Mumbai, Thane, Pune)\n" +
                "• `#nutrition-fitness`: `!gym`, `!meal <preset>` (130g protein target)\n" +
                "• `#github-activity`: Daily commit & deep-work streak tracker\n" +
                "• `#assistant-chat`: Talk naturally with the assistant (no ! required)\n\n" +
                "**Quick Shortcuts:**\n" +
                "`!plan` - Today's evening schedule\n" +
                "`!sprint <name>` - Schedule 45m deep-work sprint\n" +
                "`!tasks` - View pending task list\n" +
                "`!ping` - Connection check"
              )
              .setColor(0x5865f2),
          ],
        });
      }
    });

    await client.login(token);
    return true;
  } catch (err) {
    console.error("Error starting Discord bot:", err);
    return false;
  }
}

/**
 * Stops the live Discord bot gateway cleanly.
 */
export function stopDiscordBot(): void {
  if (activeDiscordClient) {
    try {
      activeDiscordClient.destroy();
    } catch {
      // Ignore cleanup error
    }
    activeDiscordClient = null;
    isBotLoggedIn = false;
  }
}

/**
 * Formats a clean Telegram markdown digest of the Discord connection status.
 */
export function formatDiscordStatusDigest(): string {
  const webhookUrl = getDiscordWebhookUrl();
  const botToken = getDiscordBotToken();

  const lines: string[] = [`🟣 *Discord Server & Channel Integration*\n`];

  if (!webhookUrl && !botToken) {
    lines.push(`🔴 *Status:* Not Connected\n`);
    lines.push(
      `Connect Discord to broadcast your operating plans, sprint standups, and hackathon alerts to your team channels!\n\n` +
      `⚡ *Option 1 (Instant 15-second Webhook):*\n` +
      `1️⃣ In your Discord server, go to any channel ➔ *Edit Channel* (⚙️).\n` +
      `2️⃣ Select *Integrations* ➔ *Webhooks* ➔ *New Webhook* ➔ *Copy Webhook URL*.\n` +
      `3️⃣ Send here: \`/discord_webhook <paste_url_here>\`\n\n` +
      `🤖 *Option 2 (Interactive Discord Bot):*\n` +
      `Create a bot on [Discord Developer Portal](https://discord.com/developers/applications) and send:\n` +
      `\`/discord_token <your_bot_token>\``
    );
    return lines.join("\n");
  }

  lines.push(`🟢 *Status:* Connected`);
  if (webhookUrl) {
    lines.push(`🔗 *Webhook Channel:* Active (Multi-channel segregation enabled)`);
  }
  if (botToken) {
    lines.push(`🤖 *Bot Gateway:* ${isBotLoggedIn ? "🟢 Online" : "🟡 Token Configured"}`);
    lines.push(`💬 *Available Prefix Commands:* \`!plan\`, \`!next\`, \`!done\`, \`!sprint\`, \`!gym\`, \`!hackathons\``);
  }

  lines.push(`\n📢 *Segregated Channel Ecosystem:*`);
  lines.push(`• \`#schedule-planner\` - Evening plan & timetable overruns`);
  lines.push(`• \`#hackathons\` - Curated Mumbai/Pune competitions`);
  lines.push(`• \`#college-announcements\` - WhatsApp group notice extractions`);
  lines.push(`• \`#nutrition-fitness\` - 130g protein & calorie logs`);
  lines.push(`• \`#github-activity\` - Daily commits & 45m code sprints`);
  lines.push(`• \`#assistant-chat\` - Conversational brain & autonomous prompts`);

  return lines.join("\n");
}

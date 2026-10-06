import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  WebhookClient,
} from "discord.js";
import { getEnv } from "../config/env.js";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { findPendingTasks, insertTask, updateTaskStatus } from "../db/repositories/taskRepository.js";
import { scheduleEveningPlan } from "../planner/intervalScheduler.js";
import { formatPlanMessage } from "../agent/coach.js";
import { getDailyFitnessSummary, formatFitnessDigest } from "./fitnessService.js";
import { listUpcomingHackathons } from "./hackathonService.js";

export interface DiscordEmbedOptions {
  title: string;
  description: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
  timestamp?: boolean;
}

let activeDiscordClient: Client | null = null;
let isBotLoggedIn = false;

/**
 * Gets configured Discord Webhook URL.
 */
export function getDiscordWebhookUrl(): string {
  const custom = getUserProfile<string>("discord_webhook_url");
  if (custom && typeof custom === "string" && custom.trim().length > 0) {
    return custom.trim();
  }
  const env = getEnv();
  return env.DISCORD_WEBHOOK_URL || "";
}

/**
 * Sets Discord Webhook URL in profile.
 */
export function setDiscordWebhookUrl(url: string): void {
  setUserProfile("discord_webhook_url", url.trim());
}

/**
 * Gets configured Discord Bot Token.
 */
export function getDiscordBotToken(): string {
  const custom = getUserProfile<string>("discord_bot_token");
  if (custom && typeof custom === "string" && custom.trim().length > 0) {
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
 * Sends a rich embed message to the configured Discord webhook channel.
 */
export async function sendDiscordEmbed(options: DiscordEmbedOptions): Promise<boolean> {
  const webhookUrl = getDiscordWebhookUrl();
  if (!webhookUrl) {
    return false;
  }

  try {
    const embed = new EmbedBuilder()
      .setTitle(options.title)
      .setDescription(options.description)
      .setColor(options.color ?? 0x5865F2); // Discord Blurple default

    if (options.fields && options.fields.length > 0) {
      embed.addFields(options.fields);
    }

    if (options.footer) {
      embed.setFooter({ text: options.footer });
    }

    if (options.timestamp !== false) {
      embed.setTimestamp();
    }

    const webhookClient = new WebhookClient({ url: webhookUrl });
    await webhookClient.send({
      username: "Antigravity Assistant",
      avatarURL: "https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f916.png",
      embeds: [embed],
    });

    return true;
  } catch (err) {
    console.error("Error sending Discord embed:", err);
    return false;
  }
}

/**
 * Broadcasts daily evening plan to Discord.
 */
export async function broadcastPlanToDiscord(planDigest: string, taskCount: number): Promise<boolean> {
  return sendDiscordEmbed({
    title: "📋 Evening Operating Plan & Schedule",
    description: planDigest,
    color: 0x3498DB, // Blue
    fields: [
      { name: "Total Tasks Scheduled", value: `${taskCount}`, inline: true },
      { name: "Dinner Anchor", value: "9:30 PM (Protected)", inline: true },
      { name: "Deep-Work Block", value: "11:00 PM – 4:30 AM", inline: true },
    ],
    footer: "Antigravity Personal Operating Assistant",
  });
}

/**
 * Broadcasts completed task to Discord.
 */
export async function broadcastTaskDoneToDiscord(
  taskTitle: string,
  category: string,
  minutes: number
): Promise<boolean> {
  return sendDiscordEmbed({
    title: "✅ Sprint Task Completed!",
    description: `**${taskTitle}** (${minutes}m)`,
    color: 0x2ECC71, // Green
    fields: [
      { name: "Category", value: `\`${category}\``, inline: true },
      { name: "Logged Time", value: `${minutes} mins`, inline: true },
    ],
    footer: "Velocity recorded in operating schedule",
  });
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

    client.on("ready", () => {
      isBotLoggedIn = true;
      activeDiscordClient = client;
      console.log(`🤖 Discord Bot logged in as ${client.user?.tag}!`);
    });

    client.on("messageCreate", async (message) => {
      if (message.author.bot) return;

      const content = message.content.trim();
      if (!content.startsWith("!")) return;

      const [command, ...args] = content.slice(1).split(/\s+/);
      const cmd = command?.toLowerCase();

      if (cmd === "ping") {
        await message.reply("🏓 Pong! Antigravity Assistant is active and listening.");
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
              .setColor(0x3498DB),
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
              .setColor(0xF1C40F),
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

      if (cmd === "tasks") {
        const tasks = findPendingTasks();
        if (tasks.length === 0) {
          await message.reply("Zero pending tasks in queue!");
          return;
        }
        const lines = tasks.slice(0, 7).map((t, i) => `${i + 1}. **${t.title}** (${t.estimatedMinutes}m) [${t.category}]`);
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`📋 Pending Tasks (${tasks.length})`)
              .setDescription(lines.join("\n"))
              .setColor(0x5865F2),
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

      if (cmd === "gym") {
        const summary = getDailyFitnessSummary();
        const text = formatFitnessDigest(summary);
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🍱 Gym & Macro Tracker")
              .setDescription(text)
              .setColor(0xE67E22),
          ],
        });
        return;
      }

      if (cmd === "hackathons") {
        const list = listUpcomingHackathons("all");
        const lines = list.slice(0, 4).map((h, i) => `${i + 1}. **${h.title}** (${h.cityZone.toUpperCase()})\n   🗓️ Dates: ${h.startDate} → ${h.endDate} | [Link](${h.url})`);
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🚀 Regional Hackathons (Mumbai / Thane / Pune)")
              .setDescription(lines.join("\n\n"))
              .setColor(0x9B59B6),
          ],
        });
        return;
      }

      if (cmd === "help") {
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🤖 Antigravity Assistant Commands")
              .setDescription(
                "`!plan` - View today's evening schedule\n" +
                "`!next` - View current priority task\n" +
                "`!done` - Mark active task complete\n" +
                "`!tasks` - View pending task list\n" +
                "`!sprint <name>` - Schedule 45m deep-work sprint\n" +
                "`!gym` - View daily protein & calories\n" +
                "`!hackathons` - View Mumbai-Pune hackathons\n" +
                "`!ping` - Bot connection check"
              )
              .setColor(0x5865F2),
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
    lines.push(`🔗 *Webhook Channel:* Active (Ready for rich embeds)`);
  }
  if (botToken) {
    lines.push(`🤖 *Bot Gateway:* ${isBotLoggedIn ? "🟢 Online" : "🟡 Token Configured"}`);
    lines.push(`💬 *Available Prefix Commands:* \`!plan\`, \`!next\`, \`!done\`, \`!sprint\`, \`!gym\`, \`!hackathons\``);
  }

  lines.push(`\n📢 *Broadcasting Features:*`);
  lines.push(`• Evening Operating Plan auto-posts`);
  lines.push(`• Completed task velocity updates`);
  lines.push(`• Hackathon & physical print reminders`);

  return lines.join("\n");
}

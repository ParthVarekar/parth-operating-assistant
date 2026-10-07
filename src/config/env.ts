import { config } from "dotenv";
import { z } from "zod";

config();

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().default("MOCK_BOT_TOKEN"),
  TELEGRAM_ALLOWED_USER_ID: z.string().default("0"),
  AI_PROVIDER: z.enum(["gemini", "groq", "openrouter", "ollama", "mock"]).default("mock"),
  AI_API_KEY: z.string().default(""),
  AI_BASE_URL: z.string().default("https://generativelanguage.googleapis.com/v1beta/openai/"),
  AI_MODEL: z.string().default("gemini-2.0-flash"),
  DATABASE_PATH: z.string().default("./data/assistant.db"),
  USER_DINNER_TIME: z.string().default("21:30"),
  USER_SLEEP_TIME: z.string().default("04:30"),
  USER_DEEP_WORK_START: z.string().default("23:00"),
  USER_COLLEGE_RETURN_TIME: z.string().default("19:30"),
  GITHUB_USERNAME: z.string().default("ParthVarekar"),
  GITHUB_TOKEN: z.string().default(""),
  DISCORD_WEBHOOK_URL: z.string().default(""),
  DISCORD_BOT_TOKEN: z.string().default(""),
  DISCORD_API_BASE_URL: z.string().default("https://discord.com/api"),
  DISCORD_CHANNEL_ID: z.string().default(""),
  SLACK_WEBHOOK_URL: z.string().default(""),
  NOTION_API_KEY: z.string().default(""),
  NOTION_DATABASE_ID: z.string().default(""),
  TRELLO_ACCESS_TOKEN: z.string().default(""),
  TRELLO_REFRESH_TOKEN: z.string().default(""),
  TRELLO_CLIENT_ID: z.string().default(""),
  PORT: z.coerce.number().default(3050),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

let cachedEnv: EnvConfig | null = null;

/**
 * Loads and validates environment variables.
 * @returns Validated environment configuration object.
 */
export function getEnv(): EnvConfig {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const errorDetails = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new Error(`Invalid environment configuration: ${errorDetails}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

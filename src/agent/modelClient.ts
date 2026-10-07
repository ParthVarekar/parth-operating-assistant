import OpenAI from "openai";
import { getEnv } from "../config/env.js";

let clientInstance: OpenAI | null = null;

/**
 * Initializes and returns an OpenAI-compatible API client.
 * Works seamlessly with Google Gemini (via OpenAI-compatible endpoint), Groq, OpenRouter, and Ollama.
 * @returns OpenAI client instance.
 */
export function getModelClient(): OpenAI {
  if (clientInstance) {
    return clientInstance;
  }

  const env = getEnv();
  const apiKey = env.AI_API_KEY || "mock-key";

  clientInstance = new OpenAI({
    apiKey,
    baseURL: env.AI_BASE_URL,
    timeout: 10000, // 10s max timeout so user never waits a minute for slow free endpoints
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/Parth/personal-assistant",
      "X-Title": "Personal AI Operating Assistant",
    },
  });

  return clientInstance;
}

export interface CompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: "json_object" | "text";
}

/**
 * Dispatches a completion request with graceful fallback.
 * @param request Prompt and options.
 * @returns Generated text or parsed JSON.
 */
export async function generateCompletion(request: CompletionRequest): Promise<string> {
  const env = getEnv();

  if (env.AI_PROVIDER === "mock" || !env.AI_API_KEY) {
    // Return deterministic mock JSON or text for offline execution
    if (request.responseFormat === "json_object") {
      return JSON.stringify({
        intentType: "CHAT",
        responseMessage: "Offline mode active. Intent processed deterministically.",
      });
    }

    const lower = request.userPrompt.toLowerCase();
    if (lower.includes("lowest") && (lower.includes("prize") || lower.includes("hackathon"))) {
      return "In our regional hackathon database, **Cognition Hackathon 2026** at SIES GST (Nerul) has the lowest listed prize pool at **₹75,000**, followed by **Thane TechSprint** at **₹80,000** and **DJ Unicode / SIH** at **₹1,00,000**. On the high end, **MumbaiHacks** offers **₹5,00,000**!";
    }

    return "Operating in offline mode. What would you like to plan?";
  }

  const client = getModelClient();
  const response = await client.chat.completions.create(
    {
      model: env.AI_MODEL,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      response_format: request.responseFormat === "json_object" ? { type: "json_object" } : undefined,
      temperature: 0.2,
    },
    { timeout: 10000 }
  );

  return response.choices[0]?.message.content ?? "";
}

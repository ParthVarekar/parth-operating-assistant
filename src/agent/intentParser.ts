import { generateCompletion } from "./modelClient.js";
import { type ParsedIntent, ParsedIntentSchema } from "../schemas/index.js";
import { getEnv } from "../config/env.js";

const SYSTEM_INTENT_PROMPT = `
You are the natural language intent parser for an engineering student's personal operating assistant.
Parse the user's message into JSON with the following schema:
{
  "intentType": "CREATE_TASK" | "CREATE_SUBMISSION" | "REPORT_SLIP" | "REPORT_DONE" | "QUERY_NEXT" | "QUERY_DAY" | "LOG_MEAL" | "PLAN_TONIGHT" | "FIND_HACKATHONS" | "CHAT",
  "taskTitle": string (optional),
  "estimatedMinutes": number (optional, default 45),
  "category": "assignment" | "coding" | "submission" | "admin" | "study" | "fitness" | "misc" (optional),
  "priority": "urgent" | "high" | "medium" | "low" (optional),
  "deadline": string (optional ISO timestamp or text),
  "subject": string (optional, course name),
  "isPrintable": boolean (optional, true if mentions print/physical/handwritten),
  "slipMinutes": number (optional, if reporting delay),
  "cityFilter": "mumbai" | "thane" | "navimumbai" | "pune" | "online" (optional),
  "responseMessage": string (brief, empathetic confirmation)
}
Only output valid JSON matching this schema.
`;

function parseFallbackHeuristics(text: string): ParsedIntent {
  const lower = text.toLowerCase();

  // Check for hackathons query
  if (
    lower.includes("hackathon") ||
    lower.includes("hackathons") ||
    lower.includes("hack ") ||
    lower.startsWith("hack") ||
    lower.includes("hackspit") ||
    lower.includes("mumbaihacks")
  ) {
    let zone: "mumbai" | "thane" | "navimumbai" | "pune" | "online" | undefined;
    if (lower.includes("navi mumbai") || lower.includes("navimumbai") || lower.includes("panvel") || lower.includes("nerul") || lower.includes("vashi")) {
      zone = "navimumbai";
    } else if (lower.includes("thane")) {
      zone = "thane";
    } else if (lower.includes("pune")) {
      zone = "pune";
    } else if (lower.includes("mumbai")) {
      zone = "mumbai";
    } else if (lower.includes("online") || lower.includes("virtual")) {
      zone = "online";
    }

    return {
      intentType: "FIND_HACKATHONS",
      cityFilter: zone,
      responseMessage: "Fetching upcoming hackathons for you.",
    };
  }

  // Check for slip or skip
  if (lower.includes("didn't do") || lower.includes("skipped") || lower.includes("late") || lower.includes("slipped")) {
    return {
      intentType: "REPORT_SLIP",
      slipMinutes: 30,
      responseMessage: "Understood. Adjusting remaining schedule to keep dinner and sleep safe.",
    };
  }

  // Check for completion
  if (lower.includes("done") || lower.includes("finished") || lower.includes("completed")) {
    return {
      intentType: "REPORT_DONE",
      responseMessage: "Task marked done! Recalculating what makes sense next.",
    };
  }

  // Check for plan requests
  if (lower.includes("plan tonight") || lower.includes("plan today") || lower === "/plan") {
    return {
      intentType: "PLAN_TONIGHT",
      responseMessage: "Building your evening plan based on available work zones.",
    };
  }

  // Check for next query
  if (lower.includes("what should i do") || lower.includes("what's next") || lower.includes("what next")) {
    return {
      intentType: "QUERY_NEXT",
      responseMessage: "Checking your current schedule block.",
    };
  }

  // Check for meal logging
  if (
    lower.includes("dinner") ||
    lower.includes("ate") ||
    lower.includes("meal") ||
    lower.includes("lunch") ||
    lower.includes("breakfast") ||
    lower.includes("eggs") ||
    lower.includes("protein") ||
    lower.includes("shake") ||
    lower.includes("whey")
  ) {
    return {
      intentType: "LOG_MEAL",
      responseMessage: "Meal recorded. Keeping your nutrition on track.",
    };
  }

  // Check for assignment/submission creation
  const isSubmission = lower.includes("submission") || lower.includes("assignment") || lower.includes("print");
  const minuteMatch = text.match(/(\d+)\s*(mins?|minutes?|m|hours?|hrs?|h)/i);
  let estimated = 45;
  if (minuteMatch && minuteMatch[1]) {
    const val = Number.parseInt(minuteMatch[1], 10);
    const unit = minuteMatch[2]?.toLowerCase() ?? "m";
    estimated = unit.startsWith("h") ? val * 60 : val;
  }

  const subjectMatch = text.match(/(?:for|in)\s+([A-Za-z0-9\s]+?)(?:\s+(?:due|by|before|on|needs|need|next)|$)/i);
  const subject = subjectMatch ? subjectMatch[1]?.trim() : undefined;

  return {
    intentType: isSubmission ? "CREATE_SUBMISSION" : "CREATE_TASK",
    taskTitle: text.slice(0, 60),
    estimatedMinutes: estimated,
    category: isSubmission ? "assignment" : "coding",
    subject,
    isPrintable: lower.includes("print") || lower.includes("handwritten"),
    responseMessage: `Added "${text.slice(0, 30)}..." to your active queue.`,
  };
}

/**
 * Parses user input using LLM JSON completion with deterministic heuristic fallback.
 * @param userMessage Raw message from Telegram.
 * @returns Validated ParsedIntent object.
 */
export async function parseUserIntent(userMessage: string): Promise<ParsedIntent> {
  const env = getEnv();
  if (env.AI_PROVIDER !== "mock" && env.AI_API_KEY) {
    try {
      const rawJson = await generateCompletion({
        systemPrompt: SYSTEM_INTENT_PROMPT,
        userPrompt: userMessage,
        responseFormat: "json_object",
      });

      const parsed = JSON.parse(rawJson);
      const validated = ParsedIntentSchema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
    } catch {
      // Graceful fallback to heuristic extraction
    }
  }

  return parseFallbackHeuristics(userMessage);
}

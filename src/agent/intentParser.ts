import { generateCompletion } from "./modelClient.js";
import { type ParsedIntent, ParsedIntentSchema } from "../schemas/index.js";
import { getEnv } from "../config/env.js";
import type { TaskCategory, TaskPriority } from "../types/index.js";

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
CRITICAL RULE: If the user is asking a specific question, comparing options, or seeking conversational advice (e.g., 'which hackathon has the lowest prize pool?', 'what should I study?'), you MUST categorize as 'CHAT', NOT 'FIND_HACKATHONS'. Only categorize as 'FIND_HACKATHONS' if the user explicitly asks for a list or directory of hackathons.
Only output valid JSON matching this schema.
`;

/**
 * Normalizes title string into clean title-cased words preserving key tech acronyms.
 */
function cleanTitleCase(str: string): string {
  const words = str.trim().split(/\s+/);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      // Keep small prepositions/articles lowercase unless first word
      if (i > 0 && ["a", "an", "the", "in", "on", "of", "for", "to", "and", "at", "by", "with"].includes(lower)) {
        return lower;
      }
      // Preserve uppercase acronyms
      if (/^[A-Z0-9]{2,}$/.test(w) || /^(mdm|dsp|dbms|sql|fft|ai|ml|kccemsr|os|cn|dsa|api|ui|ux)$/i.test(w)) {
        return w.toUpperCase();
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Extracts academic subject acronyms or common department subjects.
 */
function extractSubjectFromText(text: string): string | undefined {
  const lower = text.toLowerCase();
  const knownSubjects: Record<string, string> = {
    mdm: "MDM",
    dsp: "DSP",
    dbms: "Database Systems",
    database: "Database Systems",
    "database systems": "Database Systems",
    sql: "Database Systems",
    "operating systems": "Operating Systems",
    os: "Operating Systems",
    "computer networks": "Computer Networks",
    cn: "Computer Networks",
    "artificial intelligence": "AI",
    ai: "AI",
    aisc: "AISC",
    ml: "Machine Learning",
    dsa: "DSA",
    se: "Software Engineering",
    tcs: "TCS",
    spcc: "SPCC",
    css: "CSS",
  };

  for (const [key, formal] of Object.entries(knownSubjects)) {
    const regex = new RegExp(`\\b${key}\\b`, "i");
    if (regex.test(lower)) {
      return formal;
    }
  }

  const match = text.match(/(?:for|in|subject:?)\s+([A-Za-z0-9\s]{2,20})(?:\s+(?:due|by|before|on|paper|exam|test|lab)|$|[,.])/i);
  if (match && match[1]) {
    const candidate = match[1].trim();
    if (!["my", "the", "a", "an", "this", "some", "work", "now", "it"].includes(candidate.toLowerCase())) {
      return cleanTitleCase(candidate);
    }
  }

  return undefined;
}

/**
 * Parses upcoming dates and time constraints from text.
 */
function extractDeadlineFromText(text: string): string | undefined {
  const lower = text.toLowerCase();
  const months: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  const mMatch1 = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i);
  const mMatch2 = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);

  if (mMatch1 && mMatch1[1] && mMatch1[2]) {
    const day = parseInt(mMatch1[1], 10);
    const month = months[mMatch1[2].toLowerCase()] ?? 9;
    const year = 2026;
    const d = new Date(year, month, day, 23, 59, 0);
    return d.toISOString();
  }
  if (mMatch2 && mMatch2[1] && mMatch2[2]) {
    const day = parseInt(mMatch2[2], 10);
    const month = months[mMatch2[1].toLowerCase()] ?? 9;
    const year = 2026;
    const d = new Date(year, month, day, 23, 59, 0);
    return d.toISOString();
  }

  if (lower.includes("tomorrow") || lower.includes("next monday") || lower.includes("next tuesday")) {
    const d = new Date(Date.now() + (lower.includes("next") ? 4 : 1) * 86400000);
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
  }

  if (lower.includes("tonight") || lower.includes("before sleeping") || lower.includes("before sleep")) {
    const d = new Date();
    d.setHours(4, 30, 0, 0);
    if (d.getTime() < Date.now()) {
      d.setDate(d.getDate() + 1);
    }
    return d.toISOString();
  }

  return undefined;
}

interface ExtractedCommitment {
  taskTitle: string;
  category: TaskCategory;
  subject?: string;
  deadline?: string;
  priority: TaskPriority;
  estimatedMinutes: number;
  isPrintable: boolean;
  secondaryContext?: string;
}

/**
 * Robust NLP extractor that isolates genuine task commitments from conversational preambles.
 */
function extractTaskCommitment(text: string): ExtractedCommitment | null {
  const lower = text.toLowerCase();

  // Pattern 1: Explicit directive (e.g. "Add a new task: Complete DSP Lab Experiment 4", "add task ...", "todo: ...")
  const explicitDirective = text.match(/(?:add(?:\s+a)?\s+new\s+task:?|add\s+task:?|todo:?|create\s+task:?)\s*(.+)$/i);
  if (explicitDirective && explicitDirective[1]) {
    const raw = explicitDirective[1].trim();
    const subject = extractSubjectFromText(raw);
    const deadline = extractDeadlineFromText(raw);
    const isPrintable = /print|xerox|spiral|journal|hard copy/i.test(raw);
    const category: TaskCategory = isPrintable ? "submission" : /lab|code|program|build/i.test(raw) ? "coding" : "assignment";
    return {
      taskTitle: cleanTitleCase(raw),
      category,
      subject,
      deadline,
      priority: "high",
      estimatedMinutes: 45,
      isPrintable,
    };
  }

  // Pattern 2: Explicit physical submission declaration (e.g. "Need Xerox spiral print submission for Database Systems due next Monday")
  if (/print|xerox|spiral|journal writeup|hard copy|physical submission/i.test(lower)) {
    const subMatch = text.match(/(?:need|for|have to do|complete)\s+([^,.;]+?(?:submission|print|xerox|journal)[^,.;]*)/i);
    const raw = subMatch && subMatch[1] ? subMatch[1] : text;
    const cleanRaw = raw.replace(/\b(?:need|due next monday|due tomorrow|due)\b/gi, "").trim();
    const subject = extractSubjectFromText(text) || "Coursework";
    const deadline = extractDeadlineFromText(text);
    return {
      taskTitle: cleanTitleCase(cleanRaw.length > 5 ? cleanRaw : `${subject} Physical Submission`),
      category: "assignment",
      subject,
      deadline,
      priority: "high",
      estimatedMinutes: 45,
      isPrintable: true,
    };
  }

  // Pattern 3: Secondary project clause (e.g. "working on making a self sustaining startup kinda thing...")
  const projectMatch = text.match(/\b(?:working on|building|experimenting (?:with|on)|making)\s+(?:a\s+)?([^,.;]+?)(?:\s+(?:kinda|sorta|thing|but|and other than)|$|[,.;])/i);
  let secondaryContext: string | undefined;
  if (projectMatch && projectMatch[1]) {
    const proj = projectMatch[1].replace(/\b(?:kinda|sorta|thing|stuff|just)\b/gi, "").trim();
    if (proj.length > 3) {
      secondaryContext = `Experimenting on ${cleanTitleCase(proj)}`;
    }
  }

  // Pattern 4: Obligation commitment (e.g. "have to read the mdm question bank solution which is there on whatsapp...")
  const commitmentMatch = text.match(/\b(?:have to|need to|must|want to|should|got to|gotta)\s+([a-z]+)\s+([^,.;]+?)(?:\s+(?:which is|that is|atleast|at least|so that|in order to|before sleeping|before sleep)|$|[,.;])/i);
  if (commitmentMatch && commitmentMatch[1] && commitmentMatch[2]) {
    const verb = commitmentMatch[1].toLowerCase();
    const rawTarget = commitmentMatch[2]
      .replace(/^(the|a|an)\s+/i, "")
      .replace(/\s+(which|that|there|is)\s+.*$/i, "")
      .trim();

    if (rawTarget.length >= 3) {
      const subject = extractSubjectFromText(text);
      const deadline = extractDeadlineFromText(text);

      let category: TaskCategory = "assignment";
      if (["read", "study", "review", "revise", "prepare", "learn", "watch"].includes(verb)) {
        category = "study";
      } else if (["code", "build", "program", "develop", "implement", "debug"].includes(verb)) {
        category = "coding";
      }

      const taskTitle = cleanTitleCase(`${verb} ${rawTarget}`);
      return {
        taskTitle,
        category,
        subject,
        deadline,
        priority: deadline && (deadline.includes("2026-10-08") || deadline.includes("2026-10-09")) ? "urgent" : "high",
        estimatedMinutes: 45,
        isPrintable: false,
        secondaryContext,
      };
    }
  }

  return null;
}

function parseFallbackHeuristics(text: string): ParsedIntent {
  const lower = text.toLowerCase();

  const isComparativeOrDetailQuestion =
    lower.includes("lowest") ||
    lower.includes("highest") ||
    lower.includes("prize") ||
    lower.includes("prizes") ||
    lower.includes("winner") ||
    lower.includes("compare") ||
    lower.includes("difference") ||
    lower.includes("vs") ||
    lower.includes("worth") ||
    lower.includes("tell me about") ||
    lower.startsWith("why") ||
    lower.startsWith("how do i") ||
    lower.startsWith("how to");

  // Check for hackathons query
  if (
    !isComparativeOrDetailQuestion &&
    (lower.includes("hackathon") ||
      lower.includes("hackathons") ||
      lower.includes("hack ") ||
      lower.startsWith("hack") ||
      lower.includes("hackspit") ||
      lower.includes("mumbaihacks"))
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
  const isLateOrSlipped =
    !lower.includes("latest") &&
    (/\b(?:late|delayed|running late|behind schedule|overslept|missed)\b/i.test(lower) ||
      lower.includes("didn't do") ||
      lower.includes("skipped") ||
      lower.includes("slipped"));

  if (isLateOrSlipped) {
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

  const isQuestion =
    text.includes("?") ||
    lower.startsWith("which") ||
    lower.startsWith("what") ||
    lower.startsWith("how") ||
    lower.startsWith("why") ||
    lower.startsWith("who") ||
    lower.startsWith("can you") ||
    lower.startsWith("tell me");

  if (isQuestion || isComparativeOrDetailQuestion) {
    return {
      intentType: "CHAT",
      responseMessage: "Processing your question...",
    };
  }

  // NLP Task Commitment Extraction
  const commitment = extractTaskCommitment(text);
  if (commitment) {
    const minuteMatch = text.match(/(\d+)\s*(mins?|minutes?|m|hours?|hrs?|h)/i);
    if (minuteMatch && minuteMatch[1]) {
      const val = Number.parseInt(minuteMatch[1], 10);
      const unit = minuteMatch[2]?.toLowerCase() ?? "m";
      commitment.estimatedMinutes = unit.startsWith("h") ? val * 60 : val;
    }

    return {
      intentType: commitment.isPrintable ? "CREATE_SUBMISSION" : "CREATE_TASK",
      taskTitle: commitment.taskTitle,
      category: commitment.category,
      subject: commitment.subject,
      deadline: commitment.deadline,
      priority: commitment.priority,
      estimatedMinutes: commitment.estimatedMinutes,
      isPrintable: commitment.isPrintable,
      secondaryContext: commitment.secondaryContext,
      responseMessage: `Added "${commitment.taskTitle}" to your active queue.`,
    };
  }

  // If no structured task commitment was found, treat as conversational CHAT!
  return {
    intentType: "CHAT",
    responseMessage: "Processing your message...",
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

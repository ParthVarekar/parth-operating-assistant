import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { recordMemory, retrieveContextualMemories, formatMemoriesForPrompt } from "../services/memoryService.js";
import { listUpcomingHackathons } from "../services/hackathonService.js";
import type { MemoryEntry } from "../types/index.js";

export interface ConversationContext {
  activeSubject?: string;
  activeCategory?: "hackathon" | "coursework" | "task" | "nutrition" | "schedule" | "general";
  recentTopics: string[];
  rollingSummary: string;
  lastTurnUser?: string;
  lastTurnAssistant?: string;
  updatedAt: string;
}

const DEFAULT_CONTEXT: ConversationContext = {
  recentTopics: [],
  rollingSummary: "Fresh conversation session. Ready to assist with operating schedule, coursework, and hackathons.",
  updatedAt: new Date().toISOString(),
};

/**
 * Retrieves the currently active conversational context from persistent profile store.
 * @param channel Optional channel identifier (e.g., 'discord', 'telegram', 'dashboard').
 * @returns Active conversation context state.
 */
export function getActiveContext(channel: string = "default"): ConversationContext {
  const channelKey = `active_context_${channel}`;
  const saved = getUserProfile<ConversationContext>(channelKey);
  if (saved && typeof saved === "object") {
    return saved;
  }

  // Fallback to global active context if channel context is empty
  const globalSaved = getUserProfile<ConversationContext>("active_conversation_context");
  if (globalSaved && typeof globalSaved === "object") {
    return globalSaved;
  }

  return { ...DEFAULT_CONTEXT, updatedAt: new Date().toISOString() };
}

/**
 * Heuristically extracts subject, entity, and topic signals from an exchange.
 */
function extractContextSignals(
  userText: string,
  assistantReply: string
): { subject?: string; category?: ConversationContext["activeCategory"]; topic?: string } {
  const combined = `${userText} \n ${assistantReply}`.toLowerCase();

  // 1. Hackathon detection
  try {
    const allHackathons = listUpcomingHackathons("all");
    const foundHackathon = allHackathons.find((h) => combined.includes(h.title.toLowerCase()));
    if (foundHackathon) {
      return { subject: foundHackathon.title, category: "hackathon", topic: foundHackathon.title };
    }
  } catch {
    // Database might not be initialized yet in early imports
  }

  if (combined.includes("hackathon") || combined.includes("hackathons")) {
    let subject = "Regional Hackathons";
    if (combined.includes("cognition")) subject = "Cognition Hackathon 2026 (SIES GST)";
    else if (combined.includes("mumbaihacks")) subject = "MumbaiHacks 2026";
    else if (combined.includes("sih") || combined.includes("smart india")) subject = "Smart India Hackathon (SIH)";
    else if (combined.includes("hackspit")) subject = "HackSPIT 2026";
    else if (combined.includes("thane techsprint")) subject = "Thane TechSprint";
    else if (combined.includes("dj unicode")) subject = "DJ Unicode Hackathon";
    return { subject, category: "hackathon", topic: subject };
  }

  // 2. Coursework / Lab / Academic Task detection
  const academicMatch = combined.match(/\b(dsp|dbms|operating systems|computer networks|ai|experiment\s*\d+|lab\s*\d+|assignment\s*\d+)\b/i);
  if (academicMatch && academicMatch[0]) {
    const raw = academicMatch[0].toUpperCase();
    const subject = `${raw} Coursework / Lab`;
    return { subject, category: "coursework", topic: raw };
  }

  // 3. Nutrition / Fitness detection
  if (combined.includes("protein") || combined.includes("whey") || combined.includes("shake") || combined.includes("egg") || combined.includes("macro") || combined.includes("calorie")) {
    let subject = "Nutrition & Protein Intake";
    if (combined.includes("whey")) subject = "Whey Protein Shake";
    else if (combined.includes("egg")) subject = "Eggs & Breakfast";
    else if (combined.includes("dinner")) subject = "Protected Family Dinner";
    return { subject, category: "nutrition", topic: subject };
  }

  // 4. Schedule & Replan detection
  if (combined.includes("schedule") || combined.includes("dinner anchor") || combined.includes("sleep anchor") || combined.includes("deep-work") || combined.includes("replan") || combined.includes("running late")) {
    return { subject: "Operating Schedule & Routine", category: "schedule", topic: "schedule" };
  }

  return { category: "general" };
}

/**
 * Updates the active conversation context with the latest turn, updates rolling summary,
 * and records an episodic conversation memory in SQLite for long-term associative recall.
 * @param userText What the user said.
 * @param assistantReply The assistant's response.
 * @param actionsTaken List of operational actions executed.
 * @param channel The communication channel.
 * @returns Updated conversation context.
 */
export async function updateActiveContext(
  userText: string,
  assistantReply: string,
  actionsTaken: string[] = [],
  channel: string = "default"
): Promise<ConversationContext> {
  const current = getActiveContext(channel);
  const signals = extractContextSignals(userText, assistantReply);

  const activeSubject = signals.subject || current.activeSubject;
  const activeCategory = signals.category || current.activeCategory || "general";

  const newTopics = [...current.recentTopics];
  if (signals.topic && !newTopics.includes(signals.topic)) {
    newTopics.unshift(signals.topic);
  }
  const recentTopics = newTopics.slice(0, 6);

  // Generate a concise rolling summary of this turn
  const cleanUser = userText.trim().replace(/\s+/g, " ");
  const cleanReplySummary = assistantReply.trim().replace(/\s+/g, " ").slice(0, 140);
  const rollingSummary = `Recently discussed: ${activeSubject ? activeSubject + " - " : ""}"${cleanUser}" -> Assistant: "${cleanReplySummary}..."`;

  const updated: ConversationContext = {
    activeSubject,
    activeCategory,
    recentTopics,
    rollingSummary,
    lastTurnUser: cleanUser,
    lastTurnAssistant: cleanReplySummary,
    updatedAt: new Date().toISOString(),
  };

  // 1. Save per-channel and global context state in SQLite user_profile
  setUserProfile(`active_context_${channel}`, updated);
  setUserProfile("active_conversation_context", updated);

  // 2. Persist episodic memory in SQLite long-term memories table
  // Only persist substantial exchanges (longer than trivial greetings)
  if (userText.trim().length > 6 && !["hi", "hello", "hey", "ping", "test"].includes(userText.trim().toLowerCase())) {
    try {
      const memoryContent = `[Exchange] User: "${cleanUser}" | Assistant: "${cleanReplySummary}"${
        actionsTaken.length > 0 ? ` | Actions: ${actionsTaken.join(", ")}` : ""
      }`;
      await recordMemory("conversation", memoryContent, "chat", {
        importance: activeSubject ? 3 : 2,
        title: activeSubject ? `Chat: ${activeSubject}` : `Chat: ${cleanUser.slice(0, 30)}`,
        metadata: {
          channel,
          activeSubject,
          activeCategory,
          userText: cleanUser,
        },
      });
    } catch (err) {
      console.warn("Failed to persist conversation episodic memory:", err);
    }
  }

  return updated;
}

/**
 * Retrieves the combined working context and relevant long-term memories for a given user query.
 * @param userText Current user query.
 * @param channel Communication channel.
 * @returns Formatted context prompt block and retrieved raw memory entries.
 */
export function getContextMemorySnapshot(
  userText: string,
  channel: string = "default"
): {
  activeContext: ConversationContext;
  retrievedMemories: MemoryEntry[];
  promptBlock: string;
} {
  const activeContext = getActiveContext(channel);

  // Search associative memories matching current query or active subject
  const queryToSearch = activeContext.activeSubject
    ? `${userText} ${activeContext.activeSubject}`
    : userText;

  const retrievedMemories = retrieveContextualMemories(queryToSearch, 6);
  const memoryLines = formatMemoriesForPrompt(retrievedMemories);

  const promptBlock = `
--- ACTIVE CONVERSATION WORKING MEMORY ---
- Entity Currently in Focus: ${activeContext.activeSubject || "None (Fresh discussion)"}
- Topic Category: ${activeContext.activeCategory || "General"}
- Recent Discussion Topics: ${activeContext.recentTopics.length > 0 ? activeContext.recentTopics.join(", ") : "None"}
- Ongoing Context Summary: ${activeContext.rollingSummary}
${
  activeContext.lastTurnUser
    ? `- Previous Turn User Said: "${activeContext.lastTurnUser}"\n- Previous Assistant Reply: "${activeContext.lastTurnAssistant}..."`
    : ""
}

--- RELEVANT PAST CONVERSATIONS & EXTRACTED MEMORIES ---
${memoryLines}
`.trim();

  return {
    activeContext,
    retrievedMemories,
    promptBlock,
  };
}

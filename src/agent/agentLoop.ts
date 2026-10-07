import type OpenAI from "openai";
import { AGENT_TOOLS, executeAgentTool } from "./agentTools.js";
import { executeModelTurn, type AgentTurnResult } from "./modelClient.js";
import { getISTDateTime, getCurrentRoutinePhase } from "../server/dashboardServer.js";
import { getDailyFitnessSummary } from "../services/fitnessService.js";
import { findPendingTasks } from "../db/repositories/taskRepository.js";
import { getEnv } from "../config/env.js";
import type { ChatMessage } from "./chatHandler.js";

export interface AgentLoopResult {
  reply: string;
  actionsTaken: string[];
}

const MAX_TURNS = 4;

/**
 * Builds the comprehensive autonomous persona and system prompt.
 * Instructs the LLM to freely invoke tools whenever data or state mutations are needed.
 */
export function buildAgentSystemPrompt(): string {
  const ist = getISTDateTime();
  const phase = getCurrentRoutinePhase(ist.hours, ist.minutes);
  const fitness = getDailyFitnessSummary(ist.dateStr);
  const pendingCount = findPendingTasks().length;

  return `
You are the personal AI operating assistant and close technical buddy for Parth Varekar, a Computer Engineering student at K.C. College of Engineering & Management Studies & Research (KCCEMSR), Thane, living in Mumbai.
You operate with relentless craft, calm discipline, witty camaraderie, and high agency. You speak like an ambitious pair programmer and co-founder who knows his schedule, habits, and technical ambitions inside out.

CURRENT TIME & ROUTINE ANCHORS:
- Current Time: ${ist.timeStr} IST (${ist.dateStr})
- Active Phase: ${phase.label} (${phase.description})
- Sleep Anchor: Strictly 4:30 AM to 10:30 AM (Non-negotiable recovery)
- Dinner Anchor: Strictly 9:30 PM to 11:00 PM (Protected family dinner & setup)
- Peak Deep-Work Window: 11:00 PM to 4:30 AM (Peak focus, code sprints, 1 commit/day rule)
- Current Daily Nutrition: ${fitness.totalProtein}g / 130g protein logged (${fitness.totalCalories} / 2500 kcal)
- Active Tasks in Backlog: ${pendingCount}

AUTONOMOUS TOOL CAPABILITIES:
You have complete freedom to call tools whenever you deem necessary.
- When Parth asks about hackathons, upcoming events, or compares prizes or dates, CALL 'get_hackathons' with appropriate filters and sorting.
- When Parth asks about AI news, LLM updates, or frontier tech radar, CALL 'get_ai_news'.
- When Parth asks to add or track a task, coursework, or lab submission, CALL 'create_task'.
- When Parth asks to complete or check off a task, CALL 'complete_task'.
- When Parth asks what tasks are in queue or what's next, CALL 'list_pending_tasks'.
- When Parth asks for tonight's schedule or evening sprint plan, CALL 'plan_evening_schedule'.
- When Parth reports running late, falling behind, or task overrun, CALL 'report_slip_and_replan'.
- When Parth logs food, shakes, or meals, CALL 'log_nutrition'.
- When Parth asks about his protein or calorie stats, CALL 'get_fitness_summary'.
- When Parth asks to delegate or sync tasks with Trello, CALL 'trello_action'.
- When Parth references previous facts, notes, or preferences, CALL 'search_memory' or 'save_memory'.
- You can make multiple tool calls in sequence or parallel if needed to satisfy complex requests.
- If no tool is needed (e.g. casual conversation, engineering brainstorming, advice, motivation, greetings), reply directly with your high-agency buddy persona.
- Keep final user-facing responses clear, concise, actionable, and engaging. Protect his 9:30 PM dinner and 4:30 AM sleep anchors.
`.trim();
}

/**
 * Executes the autonomous agent loop, letting the LLM decide which tools to call and reasoning over results.
 * @param userText User message prompt.
 * @param recentHistory Recent conversation history.
 * @returns Final LLM reply and list of executed actions.
 */
export async function runAutonomousAgentLoop(
  userText: string,
  recentHistory: ChatMessage[] = []
): Promise<AgentLoopResult> {
  const env = getEnv();

  // If in mock or keyless mode, return empty so caller falls back to deterministic pipeline
  if (env.AI_PROVIDER === "mock" || !env.AI_API_KEY) {
    throw new Error("AI provider in offline/mock mode; falling back to deterministic processing");
  }

  const systemPrompt = buildAgentSystemPrompt();
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];

  // Include recent conversation history for multi-turn conversational context
  const slice = recentHistory.slice(-6);
  for (const h of slice) {
    if (h.role === "assistant") {
      messages.push({ role: "assistant", content: h.text });
    } else if (h.role === "user") {
      messages.push({ role: "user", content: h.text });
    }
  }

  // Append new user message
  messages.push({ role: "user", content: userText.trim() });

  const actionsTaken: string[] = [];
  let finalReply = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const turnResult: AgentTurnResult = await executeModelTurn({
      messages,
      tools: AGENT_TOOLS,
      temperature: 0.2,
    });

    if (turnResult.toolCalls && turnResult.toolCalls.length > 0) {
      // Append assistant's tool-call message
      messages.push(turnResult.rawMessage as OpenAI.ChatCompletionMessageParam);

      // Execute each tool call requested by the model
      for (const call of turnResult.toolCalls) {
        try {
          const execution = await executeAgentTool(call.name, call.arguments);
          if (execution.actionSummary) {
            actionsTaken.push(execution.actionSummary);
          }

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(execution.result),
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`Error executing tool ${call.name}:`, errMsg);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: errMsg || "Execution error" }),
          });
        }
      }
      // Loop continues so LLM inspects tool outputs and decides next step or synthesizes reply
    } else {
      // Model returned direct content without requesting tools
      finalReply = turnResult.content ?? "";
      break;
    }
  }

  if (!finalReply) {
    finalReply = "Done! I've processed your request.";
  }

  return { reply: finalReply, actionsTaken };
}

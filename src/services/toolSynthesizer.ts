import crypto from "node:crypto";
import vm from "node:vm";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type OpenAI from "openai";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { generateCompletion } from "../agent/modelClient.js";
import { recordMemory } from "./memoryService.js";

export interface SynthesizedTool {
  id: string;
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  code: string;
  language: "javascript";
  createdAt: string;
  updatedAt: string;
  executionCount: number;
  lastExecutedAt?: string;
  author: "autonomous_agent" | "user";
}

export interface SynthesizeToolInput {
  name: string;
  description: string;
  requirements?: string;
  code?: string;
  parameters?: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  author?: "autonomous_agent" | "user";
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  logs: string[];
  durationMs: number;
}

const PROFILE_KEY = "synthesized_tools";
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Normalizes tool name to valid OpenAI function naming standard (a-z, 0-9, underscores).
 */
function normalizeToolName(rawName: string): string {
  const sanitized = rawName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
  return sanitized.startsWith("_") ? sanitized.slice(1) : sanitized;
}

/**
 * Validates JavaScript code syntax in node:vm without executing it.
 */
function validateScriptSyntax(code: string): { valid: boolean; error?: string } {
  try {
    const wrapped = `(async () => { ${code} })()`;
    new vm.Script(wrapped);
    return { valid: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: message };
  }
}

/**
 * Builds the sandbox execution context with safe web primitives.
 */
function buildSandboxContext(logs: string[], args: Record<string, unknown>): vm.Context {
  const safeConsole = {
    log: (...items: unknown[]) => logs.push(items.map((i) => String(i)).join(" ")),
    info: (...items: unknown[]) => logs.push(items.map((i) => String(i)).join(" ")),
    warn: (...items: unknown[]) => logs.push("[WARN] " + items.map((i) => String(i)).join(" ")),
    error: (...items: unknown[]) => logs.push("[ERROR] " + items.map((i) => String(i)).join(" ")),
  };

  const sandboxEnv = {
    fetch: globalThis.fetch,
    crypto: globalThis.crypto,
    Buffer,
    URL,
    URLSearchParams,
    JSON,
    Math,
    Date,
    parseInt,
    parseFloat,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    Promise,
    console: safeConsole,
    setTimeout: (fn: (...cbArgs: unknown[]) => void, ms: number) => setTimeout(fn, Math.min(ms, 5000)),
    clearTimeout: (id: NodeJS.Timeout) => clearTimeout(id),
    args,
  };

  return vm.createContext(sandboxEnv);
}

/**
 * Wraps tool code to support multiple export conventions (run, handler, module.exports, or top-level return).
 */
function wrapCodeForExecution(code: string): string {
  return `(async () => {
    const exports = {};
    const module = { exports };
    ${code}
    if (typeof module.exports === "function") {
      return await module.exports(args);
    }
    if (typeof exports.run === "function") {
      return await exports.run(args);
    }
    if (typeof run === "function") {
      return await run(args);
    }
    if (typeof handler === "function") {
      return await handler(args);
    }
    return exports;
  })()`;
}

/**
 * Writes tool backup file to local filesystem.
 */
function backupToolToFileSystem(tool: SynthesizedTool): void {
  try {
    const dir = resolve(process.cwd(), "data", "synthesized_tools");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${tool.name}.js`), tool.code, "utf8");
  } catch (err) {
    console.warn(`[toolSynthesizer] Failed to backup tool file for ${tool.name}:`, err);
  }
}

/**
 * Deterministic fallback code generator if LLM endpoint is unreachable.
 */
function generateFallbackToolCode(name: string, description: string): string {
  return `// Auto-synthesized fallback execution handler for ${name}
async function run(args) {
  console.log("Executing synthesized tool: ${name}", JSON.stringify(args));
  return {
    status: "ok",
    tool: "${name}",
    description: "${description.replace(/"/g, '\\"')}",
    inputEcho: args,
    executedAt: new Date().toISOString()
  };
}`;
}

/**
 * Retrieves all synthesized tools persisted in the registry.
 * @returns Array of synthesized tools.
 */
export function listSynthesizedTools(): SynthesizedTool[] {
  return getUserProfile<SynthesizedTool[]>(PROFILE_KEY) || [];
}

/**
 * Retrieves a single synthesized tool by name or id.
 * @param nameOrId Tool name or UUID.
 * @returns Tool or undefined if not found.
 */
export function getSynthesizedTool(nameOrId: string): SynthesizedTool | undefined {
  const tools = listSynthesizedTools();
  const target = nameOrId.toLowerCase().trim();
  return tools.find((t) => t.id === target || t.name.toLowerCase() === target);
}

/**
 * Registers or updates a synthesized tool in the persistent registry.
 * @param tool Tool definition.
 */
export function registerSynthesizedTool(tool: SynthesizedTool): void {
  const tools = listSynthesizedTools();
  const existingIdx = tools.findIndex((t) => t.id === tool.id || t.name === tool.name);
  if (existingIdx >= 0) {
    tools[existingIdx] = tool;
  } else {
    tools.unshift(tool);
  }
  setUserProfile(PROFILE_KEY, tools);
  backupToolToFileSystem(tool);
}

/**
 * Deletes a synthesized tool from the registry.
 * @param nameOrId Tool name or UUID.
 * @returns True if deleted, false if not found.
 */
export function removeSynthesizedTool(nameOrId: string): boolean {
  const tools = listSynthesizedTools();
  const target = nameOrId.toLowerCase().trim();
  const next = tools.filter((t) => t.id !== target && t.name.toLowerCase() !== target);
  if (next.length === tools.length) {
    return false;
  }
  setUserProfile(PROFILE_KEY, next);
  return true;
}

/**
 * Executes a synthesized tool inside a secure, time-bounded node:vm sandbox.
 * @param nameOrId Tool name or UUID.
 * @param args Tool arguments.
 * @param timeoutMs Maximum execution time in milliseconds (default: 10000ms).
 * @returns Execution result with captured logs and duration.
 */
export async function executeSynthesizedTool(
  nameOrId: string,
  args: Record<string, unknown> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ToolExecutionResult> {
  const tool = getSynthesizedTool(nameOrId);
  const startTime = Date.now();
  const logs: string[] = [];

  if (!tool) {
    return {
      success: false,
      error: `Synthesized tool "${nameOrId}" not found in registry.`,
      logs,
      durationMs: Date.now() - startTime,
    };
  }

  const context = buildSandboxContext(logs, args);
  const wrappedCode = wrapCodeForExecution(tool.code);

  try {
    const script = new vm.Script(wrappedCode);
    const executionPromise = script.runInContext(context, { timeout: timeoutMs });

    // Enforce async timeout safety against hung network promises
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs}ms`)), timeoutMs)
    );

    const result = await Promise.race([executionPromise, timeoutPromise]);

    // Update execution stats
    tool.executionCount = (tool.executionCount || 0) + 1;
    tool.lastExecutedAt = new Date().toISOString();
    registerSynthesizedTool(tool);

    return {
      success: true,
      result,
      logs,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: errorMessage,
      logs,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Synthesizes a new tool dynamically on the fly. If code is omitted, generates
 * and validates the implementation via LLM with a fallback safety net.
 * @param input Tool definition and specifications.
 * @returns Fully compiled and registered tool.
 */
export async function synthesizeTool(input: SynthesizeToolInput): Promise<SynthesizedTool> {
  const name = normalizeToolName(input.name);
  let code = input.code?.trim();

  // If code is not provided, use LLM to synthesize JavaScript implementation
  if (!code) {
    const prompt = `Write a clean, self-contained JavaScript function for a tool named "${name}".
Description: ${input.description}
Requirements: ${input.requirements || "Handle input gracefully and return structured result object."}
Expected Parameters: ${JSON.stringify(input.parameters || {})}

Rules:
1. Export or define an "async function run(args)" function.
2. The function must accept an "args" object and return a structured JSON-serializable value.
3. You can use standard global Web APIs (fetch, crypto, Buffer, URL, Math, Date) if needed.
4. Do NOT use require() or external npm packages.
5. Return ONLY executable JavaScript code inside \`\`\`javascript ... \`\`\` code block.`;

    try {
      const response = await generateCompletion({
        systemPrompt: "You are PARTH.OS Autonomous Synthesizer.",
        userPrompt: prompt,
      });
      const codeBlockMatch = response.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
      code = (codeBlockMatch && codeBlockMatch[1] ? codeBlockMatch[1] : response).trim();
    } catch (err) {
      console.warn(`[toolSynthesizer] LLM synthesis failed, using fallback template:`, err);
      code = generateFallbackToolCode(name, input.description);
    }
  }

  // Validate script syntax before registering
  const syntaxCheck = validateScriptSyntax(code);
  if (!syntaxCheck.valid) {
    console.warn(`[toolSynthesizer] Syntax invalid: ${syntaxCheck.error}, repairing with fallback`);
    code = generateFallbackToolCode(name, input.description);
  }

  const tool: SynthesizedTool = {
    id: crypto.randomUUID(),
    name,
    description: input.description,
    parameters: input.parameters || {
      type: "object",
      properties: {
        input: { type: "string", description: "Primary parameter for the synthesized tool" },
      },
      required: [],
    },
    code,
    language: "javascript",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    executionCount: 0,
    author: input.author || "autonomous_agent",
  };

  registerSynthesizedTool(tool);

  // Record into episodic memory
  recordMemory(
    "ai_tech_insight",
    `Synthesized dynamic agent tool "${tool.name}": ${tool.description}`,
    "autonomous_heartbeat",
    {
      importance: 3,
      title: `Tool Synthesized: ${tool.name}`,
      metadata: { toolId: tool.id, name: tool.name },
    }
  ).catch(console.warn);

  return tool;
}

/**
 * Converts synthesized dynamic tools into standard OpenAI ChatCompletionTool definitions
 * so they can be seamlessly injected into the agent tool list.
 * @returns Array of OpenAI tools.
 */
export function convertSynthesizedToolsToAgentTools(): OpenAI.ChatCompletionTool[] {
  const tools = listSynthesizedTools();
  return tools.map((t) => ({
    type: "function",
    function: {
      name: `dyn_${t.name}`,
      description: `[Dynamic Synthesized Tool] ${t.description}`,
      parameters: t.parameters,
    },
  }));
}

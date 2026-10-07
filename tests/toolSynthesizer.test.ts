import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  synthesizeTool,
  executeSynthesizedTool,
  listSynthesizedTools,
  getSynthesizedTool,
  removeSynthesizedTool,
  convertSynthesizedToolsToAgentTools,
} from "../src/services/toolSynthesizer.js";

describe("Dynamic Tool Synthesizer & Sandbox Execution Suite", () => {
  beforeEach(() => {
    initDatabase(":memory:");
  });

  it("synthesizes and executes custom JavaScript tool in node:vm sandbox", async () => {
    const tool = await synthesizeTool({
      name: "calculate_cgpa",
      description: "Calculates cumulative grade point average from credit points and grades.",
      code: `
        async function run(args) {
          console.log("Processing grades for", args.studentName);
          const points = args.grades.reduce((acc, g) => acc + g.credits * g.pointer, 0);
          const totalCredits = args.grades.reduce((acc, g) => acc + g.credits, 0);
          const cgpa = totalCredits > 0 ? (points / totalCredits).toFixed(2) : "0.00";
          return { student: args.studentName, cgpa: Number(cgpa) };
        }
      `,
    });

    expect(tool.name).toBe("calculate_cgpa");
    expect(tool.language).toBe("javascript");

    const execResult = await executeSynthesizedTool("calculate_cgpa", {
      studentName: "Parth",
      grades: [
        { subject: "DSP", credits: 4, pointer: 9.5 },
        { subject: "DBMS", credits: 4, pointer: 10.0 },
      ],
    });

    expect(execResult.success).toBe(true);
    expect(execResult.result).toEqual({ student: "Parth", cgpa: 9.75 });
    expect(execResult.logs).toContain("Processing grades for Parth");
    expect(execResult.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("safely enforces timeout limits against infinite loops in synthesized tools", async () => {
    await synthesizeTool({
      name: "infinite_hang_tool",
      description: "Tests sandbox timeout protection.",
      code: `
        async function run() {
          while (true) {}
        }
      `,
    });

    const execResult = await executeSynthesizedTool("infinite_hang_tool", {}, 500);
    expect(execResult.success).toBe(false);
    expect(execResult.error).toBeDefined();
  });

  it("synthesizes tools with automatic fallback when explicit code is omitted", async () => {
    const tool = await synthesizeTool({
      name: "weather_converter",
      description: "Converts temperature between Celsius and Fahrenheit.",
      requirements: "Convert temp values accurately.",
    });

    expect(tool.name).toBe("weather_converter");
    expect(tool.code).toBeDefined();

    const execResult = await executeSynthesizedTool(tool.id, { celsius: 25 });
    expect(execResult.success).toBe(true);
  });

  it("converts dynamic tools into OpenAI-compatible tool definitions", async () => {
    await synthesizeTool({
      name: "crypto_hasher",
      description: "Computes SHA-256 hashes of input payload.",
      parameters: {
        type: "object",
        properties: {
          payload: { type: "string", description: "Text to hash" },
        },
        required: ["payload"],
      },
    });

    const agentTools = convertSynthesizedToolsToAgentTools();
    const found = agentTools.find((t) => t.type === "function" && t.function.name === "dyn_crypto_hasher");
    expect(found).toBeDefined();
    if (found && found.type === "function") {
      expect(found.function.description).toContain("[Dynamic Synthesized Tool]");
      expect(found.function.parameters).toHaveProperty("properties");
    }
  });

  it("supports deletion of synthesized tools", async () => {
    const tool = await synthesizeTool({
      name: "temporary_test_tool",
      description: "Short lived test tool.",
    });

    expect(getSynthesizedTool("temporary_test_tool")).toBeDefined();
    const removed = removeSynthesizedTool(tool.id);
    expect(removed).toBe(true);
    expect(getSynthesizedTool("temporary_test_tool")).toBeUndefined();
  });
});

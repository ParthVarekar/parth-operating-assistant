import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { seedInitialCuratedHackathons } from "../src/db/repositories/hackathonRepository.js";
import { AGENT_TOOLS, getAvailableAgentTools, executeAgentTool } from "../src/agent/agentTools.js";
import { buildAgentSystemPrompt } from "../src/agent/agentLoop.js";
import { findPendingTasks } from "../src/db/repositories/taskRepository.js";
import { getDailyFitnessSummary } from "../src/services/fitnessService.js";

describe("Autonomous Agent Tools & Function Calling Suite", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "mock";
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
    seedInitialCuratedHackathons();
  });

  it("exports valid OpenAI-compatible tool specifications", () => {
    expect(AGENT_TOOLS.length).toBeGreaterThanOrEqual(10);
    for (const tool of AGENT_TOOLS) {
      expect(tool.type).toBe("function");
      if (tool.type === "function") {
        expect(tool.function.name).toBeDefined();
        expect(typeof tool.function.name).toBe("string");
        expect(tool.function.description).toBeDefined();
        expect(tool.function.parameters).toBeDefined();
      }
    }

    const toolNames = AGENT_TOOLS.map((t) => (t.type === "function" ? t.function.name : ""));
    expect(toolNames).toContain("get_ai_news");
    expect(toolNames).toContain("get_hackathons");
    expect(toolNames).toContain("create_task");
    expect(toolNames).toContain("complete_task");
    expect(toolNames).toContain("list_pending_tasks");
    expect(toolNames).toContain("plan_evening_schedule");
    expect(toolNames).toContain("report_slip_and_replan");
    expect(toolNames).toContain("log_nutrition");
    expect(toolNames).toContain("get_fitness_summary");
    expect(toolNames).toContain("trello_action");
    expect(toolNames).toContain("search_memory");
    expect(toolNames).toContain("save_memory");
  });

  it("executes get_ai_news tool and returns intelligence items", async () => {
    const res = await executeAgentTool("get_ai_news", { limit: 3 });
    expect(res.success).toBe(true);
    expect(res.actionSummary).toContain("frontier AI & tech radar");
    const payload = res.result as { count: number; articles: any[] };
    expect(payload.articles.length).toBeGreaterThanOrEqual(1);
    expect(payload.articles[0].title).toBeDefined();
  });

  it("executes get_hackathons tool with date and prize sorting", async () => {
    // 1. Sort by date
    const dateRes = await executeAgentTool("get_hackathons", {
      cityFilter: "all",
      sortBy: "date",
    });
    expect(dateRes.success).toBe(true);
    const datePayload = dateRes.result as { hackathons: any[] };
    expect(datePayload.hackathons.length).toBeGreaterThan(0);
    // Verify first hackathon starts before or at second
    if (datePayload.hackathons.length >= 2) {
      expect(
        datePayload.hackathons[0].startDate <= datePayload.hackathons[1].startDate
      ).toBe(true);
    }

    // 2. Sort by prize (MumbaiHacks should be at top with ₹5,00,000)
    const prizeRes = await executeAgentTool("get_hackathons", {
      cityFilter: "all",
      sortBy: "prize",
    });
    expect(prizeRes.success).toBe(true);
    const prizePayload = prizeRes.result as { hackathons: any[] };
    expect(prizePayload.hackathons[0].title).toContain("MumbaiHacks");
  });

  it("executes create_task and complete_task tools sequentially", async () => {
    // 1. Create a task via tool
    const createRes = await executeAgentTool("create_task", {
      title: "Design Compiler Lab Parser",
      estimatedMinutes: 50,
      priority: "high",
      category: "assignment",
      subject: "Compiler Construction",
    });
    expect(createRes.success).toBe(true);
    expect(createRes.actionSummary).toContain("Design Compiler Lab Parser");

    const pending = findPendingTasks();
    const created = pending.find((t) => t.title.includes("Design Compiler Lab Parser"));
    expect(created).toBeDefined();

    // 2. Query list_pending_tasks tool
    const listRes = await executeAgentTool("list_pending_tasks", {});
    expect(listRes.success).toBe(true);
    const listPayload = listRes.result as { count: number; tasks: any[] };
    expect(listPayload.count).toBeGreaterThanOrEqual(1);

    // 3. Complete task via tool
    const completeRes = await executeAgentTool("complete_task", {
      taskTitle: "Design Compiler Lab Parser",
      minutesSpent: 45,
    });
    expect(completeRes.success).toBe(true);
    expect(completeRes.actionSummary).toContain("Marked task completed");
  });

  it("executes log_nutrition and get_fitness_summary tools", async () => {
    const logRes = await executeAgentTool("log_nutrition", {
      preset: "whey_shake",
    });
    expect(logRes.success).toBe(true);
    expect(logRes.actionSummary).toContain("Logged nutrition");

    const summaryRes = await executeAgentTool("get_fitness_summary", {});
    expect(summaryRes.success).toBe(true);
    const summaryPayload = summaryRes.result as {
      totalProtein: number;
      targetProtein: number;
    };
    expect(summaryPayload.targetProtein).toBe(130);
    expect(summaryPayload.totalProtein).toBeGreaterThanOrEqual(26);
  });

  it("executes plan_evening_schedule and report_slip_and_replan tools", async () => {
    await executeAgentTool("create_task", {
      title: "Operating Systems Assignment",
      estimatedMinutes: 45,
      priority: "high",
    });

    const planRes = await executeAgentTool("plan_evening_schedule", {});
    expect(planRes.success).toBe(true);
    const planPayload = planRes.result as { blockCount: number; blocks: any[] };
    expect(planPayload.blockCount).toBeGreaterThanOrEqual(0);

    const replanRes = await executeAgentTool("report_slip_and_replan", {
      delayReason: "College lab ran overtime by 30 mins",
    });
    expect(replanRes.success).toBe(true);
    expect(replanRes.actionSummary).toContain("Rebalanced schedule");
  });

  it("executes save_memory and search_memory tools", async () => {
    const saveRes = await executeAgentTool("save_memory", {
      category: "preference",
      content: "Parth prefers dark theme and uses Neovim keybindings",
      importance: 4,
    });
    expect(saveRes.success).toBe(true);

    const searchRes = await executeAgentTool("search_memory", {
      query: "Neovim",
    });
    expect(searchRes.success).toBe(true);
    const searchPayload = searchRes.result as { memories: any[] };
    expect(searchPayload.memories.length).toBeGreaterThan(0);
    expect(searchPayload.memories[0].content).toContain("Neovim");
  });

  it("builds comprehensive system prompt with routine anchors and autonomy instructions", () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain("Parth Varekar");
    expect(prompt).toContain("KCCEMSR");
    expect(prompt).toContain("Sleep Anchor");
    expect(prompt).toContain("Dinner Anchor");
    expect(prompt).toContain("AUTONOMOUS TOOL CAPABILITIES");
    expect(prompt).toContain("get_hackathons");
    expect(prompt).toContain("get_ai_news");
  });

  it("executes solve_academic_problem tool and returns solved experiment", async () => {
    const res = await executeAgentTool("solve_academic_problem", {
      content: "DFT FFT Radix-2 spectrum",
      subject: "DSP",
    });
    expect(res.success).toBe(true);
    expect(res.actionSummary).toContain("Auto-solved");
    const payload = res.result as any;
    expect(payload.subject).toContain("Digital Signal Processing");
    expect(payload.htmlReportPath).toBeDefined();
  });

  it("executes synthesize_custom_tool and dynamically invokes execute_custom_tool", async () => {
    const synthRes = await executeAgentTool("synthesize_custom_tool", {
      name: "base64_encode",
      description: "Encodes string to base64",
      code: `async function run(args) { return { encoded: Buffer.from(args.text).toString("base64") }; }`,
    });
    expect(synthRes.success).toBe(true);
    expect(synthRes.actionSummary).toContain("Synthesized dynamic custom tool");

    const execRes = await executeAgentTool("execute_custom_tool", {
      toolName: "base64_encode",
      args: { text: "Hello World" },
    });
    expect(execRes.success).toBe(true);
    expect((execRes.result as any).encoded).toBe(Buffer.from("Hello World").toString("base64"));

    // Also verify getAvailableAgentTools includes the synthesized tool
    const allTools = getAvailableAgentTools();
    expect(allTools.some((t) => t.type === "function" && t.function.name === "dyn_base64_encode")).toBe(true);
  });

  it("executes run_nightly_reflection tool and returns audit report", async () => {
    const res = await executeAgentTool("run_nightly_reflection", {
      date: "2026-10-07",
    });
    expect(res.success).toBe(true);
    expect(res.actionSummary).toContain("Executed nightly meta-cognition audit");
    const payload = res.result as any;
    expect(payload.auditDate).toBe("2026-10-07");
    expect(payload.velocityRatio).toBeDefined();
  });
});

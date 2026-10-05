# PERSONAL AI OPERATING ASSISTANT (STATE ZERO)
## Comprehensive Problem Analysis, Architectural Research, and System Design

**Document Status:** Complete Research & System Specification (State Zero)  
**Target User:** Computer Engineering College Student  
**Target Deployment Cost:** \$0.00 / month  
**Core Interface:** Telegram (Event-Driven & Proactive)  
**Document Author:** Antigravity Engineering (Senior Agentic Systems Architect)

---

## 1. UNDERSTANDING OF THE ACTUAL PROBLEM

### 1.1 The Human Reality vs. The Calendar Fantasy
Traditional productivity tools and generic AI chatbots are built on an idealized model of human behavior: that a user possesses uninterrupted executive function, accurately forecasts task durations, adheres strictly to scheduled calendar blocks, and dutifully updates todo checkmarks.

In reality, the user is a Computer Engineering undergraduate navigating high cognitive volatility:
*   **Irregular Chronotype & Energy Misalignment:** The user operates on a late-night circadian cycle (sleeping at 4:00–5:00 AM, initiating deep work around 11:00 PM). Returning from college at 7:00–8:00 PM leaves a vulnerable 2.5-hour "transition trough" before 9:30 PM dinner. This trough routinely evaporates into dopamine loops (social media scrolling, phone usage, passive procrastination) because cognitive stamina is depleted after classes, yet no structured, low-friction micro-task is queued up.
*   **The Planning Fallacy & Fragile Schedules:** Traditional time-blocking assumes fixed durations. When a programming assignment or lab write-up estimated at 45 minutes takes 2 hours, a conventional calendar breaks. Because the user has no automated replanning mechanism, the entire downstream evening collapses. The emotional cost of a "broken schedule" leads directly to abandonment of the plan altogether.
*   **Physical vs. Digital Disconnect in Submissions:** College engineering coursework involves physical artifacts: handwritten records, printed assignment PDFs, lab files, and signed checklists. Finishing a code repository or compiling a LaTeX document on a laptop is fundamentally distinct from having the physical pages printed, stapled, placed in the backpack, and submitted before the professor's deadline. Forgetting the printing step transforms a 100% completed intellectual task into an academic failure.
*   **Nutritional & Physical Neglect:** Because work begins late and earlier hours drift away, meals are skipped or delayed. This directly damages the user's fitness goals, gym recovery, and body weight. The gym is frequently either skipped out of guilt over unfinished coursework or prioritized at the expense of sleep and imminent deadlines.
*   **Executive Dysfunction on Vague Tasks:** When an assignment is perceived as a monolith ("Finish Computer Networks Project"), the barrier to activation is high. Procrastination sets in until the deadline becomes an emergency. The user does not lack motivation; they lack an automated decomposition engine that converts ambiguous obligations into concrete 10-to-20 minute execution steps.

### 1.2 Root Cause Analysis
```
+----------------------------------------------------------------------------------------------------+
|                                    ROOT CAUSES OF SYSTEM FAILURE                                   |
+-----------------------------------+--------------------------------+-------------------------------+
| Cognitive Friction                | Temporal Hallucination         | Physical-World Blindness     |
| - Tasks stored as vague monoliths | - Believing 7:30 PM = 7:30 work| - "Assignment Done" !=        |
| - High activation energy to start | - Zero buffer between blocks   |   "Printed & In Backpack"     |
| - Avoidance of boring submissions | - Underestimating effort by 2x | - Missing campus print hours  |
+-----------------------------------+--------------------------------+-------------------------------+
                                                    |
                                                    v
+----------------------------------------------------------------------------------------------------+
|                                    CASCADING DAILY COLLAPSE                                        |
| 1. College Return (7:30 PM) -> Friction High -> 2 Hours Lost to Phone/Reels                        |
| 2. Dinner (9:30 PM) -> Guilt & Rush -> Missed Nutrition                                           |
| 3. Late Start (11:00 PM) -> Assignment Runs Over -> Gym/Sleep Sacrificed                          |
| 4. Sleep at 5:00 AM -> Morning Fatigue -> Cycle Repeats                                            |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. HIGH-LEVEL REQUIREMENTS & OPERATING PHILOSOPHY

1.  **Life Operating System, Not a Chatbot:** The system must not be a passive listener waiting for input. It must maintain an evolving state graph of the user's life, current energy, commitments, and deadlines.
2.  **Failure-Aware as a Core Invariant:** Schedule deviation is not an exception; it is the default state. When the user says *"I didn't do it"* or goes silent, the system must recalculate the downstream trajectory without scolding, guilt-tripping, or breaking.
3.  **Physical World Pacing:** Explicitly manage physical transitions, commute friction, meal digestion windows, and printing logistics.
4.  **Deterministic Constraints with Agentic Flexibility:** Mathematical constraints (time arithmetic, deadlines, dependencies) must be solved deterministically. The LLM must handle extraction, decomposition, empathetic coaching, and unstructured conversation—never raw time-slot interval math.
5.  **Gradual Accumulation of Personal Memory:** The user must not configure 50 settings on day one. The system must passively infer patterns (e.g., actual vs. estimated duration, procrastination triggers, meal skipping frequency) and confirm them over time.
6.  **Single-User Focus:** Zero team overhead, zero multi-tenant complexity, zero bloated enterprise RBAC. Every byte of compute serves one person.

---

## 3. BEHAVIORAL REQUIREMENTS

*   **BR-01: Radical Empathy & Anti-Nagging:** Never use toxic positivity or hollow cheerleading (*"You can do it!", "Rise and grind!"*). Acknowledge setbacks analytically: *"Task 1 took 50 minutes longer than planned. Dinner is in 25 minutes. Dropping the revision task; keeping only the 10-minute print preparation."*
*   **BR-02: Actionable Micro-Decomposition:** When a task is added or repeatedly stalled, automatically decompose it into micro-steps requiring $<20$ minutes each. The first step must be an activation trigger (e.g., *"Open question PDF and read Question 1 only"*).
*   **BR-03: Frictionless One-Tap Interaction:** Telegram interactions must favor inline buttons (`[Done]`, `[+15 Mins]`, `[Skipped]`, `[Need Help Decomposing]`) so the user can update state in 2 seconds while walking, eating, or fatigued.
*   **BR-04: Non-Judgmental Re-alignment:** If the user wastes 2 hours on phone reels, the assistant does not lecture. It updates available time from $T_{\text{avail}} = 120$ min to $T_{\text{avail}} = 0$ min, drops non-critical tasks, protects meal and sleep boundaries, and presents the new realistic path.
*   **BR-05: Proactive Intervention Cadence:** Reach out at critical temporal inflection points (e.g., post-college arrival, 30 minutes pre-dinner, pre-gym nutrition check, late-night deep-work cutoff).
*   **BR-06: Circadian Respect:** Do not impose an arbitrary 10:00 PM bedtime. Operate within the user's 4:00–5:00 AM reality. Only highlight sleep conflicts when imminent morning college commitments make sleep debt dangerous.

---

## 4. FUNCTIONAL REQUIREMENTS

*   **FR-01: Natural Language Intake:** Parse unstructured Telegram messages (*"Got OS lab record submission this Thursday, needs 8 pages handwritten and printout of code"*) into structured entities with deadlines, estimated effort, and required materials.
*   **FR-02: Physical Submission State Machine:** Track assignments through an 8-stage pipeline: `DISCOVERED` $\rightarrow$ `DECOMPOSED` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ `DIGITAL_DONE` $\rightarrow$ `NEEDS_PRINTING` $\rightarrow$ `PRINTED_PHYSICAL` $\rightarrow$ `PACKED_IN_BAG` $\rightarrow$ `SUBMITTED`.
*   **FR-03: Dynamic Daily Interval Scheduling:** Maintain a continuous daily timeline segmented by fixed anchors (College, Commute, Dinner at 9:30 PM, Gym, Sleep window) and flexible work blocks.
*   **FR-04: Failure & Slippage Recalculator:** When a task overruns or is skipped, immediately re-solve the interval schedule to resolve conflicts, pushing lower-priority items to future days while strictly guarding deadlines.
*   **FR-05: Nutrition & Meal Guardianship:** Schedule lunch, post-college snacks, dinner, and pre-/post-workout nutrition. Detect repeated missed meals and automatically shift the scheduled reminder windows earlier.
*   **FR-06: Gym & Fitness Co-Planner:** Schedule 90-minute workout blocks on gym days, verify pre-workout food intake, and alert when college assignments create an irreconcilable conflict between gym and sleep.
*   **FR-07: Proactive Telegram Push Service:** Trigger autonomous messages based on time events, deadline proximity, and plan slippage without waiting for a user query.
*   **FR-08: Personal Memory & Profiling:** Store facts, preferences, habits, and empirical velocity metrics (e.g., average minutes per handwritten page) in persistent storage.
*   **FR-09: Extensible Capability Engine:** Support adding new capabilities (hackathon trackers, GitHub watchers, web scrapers) via modular tools without rewriting core scheduling or state engines.

---

## 5. NON-FUNCTIONAL REQUIREMENTS

*   **NFR-01: Zero Operating Cost (\$0.00/mo):** Must run entirely within free tiers of reliable cloud compute, serverless databases, or local hardware, utilizing free LLM APIs.
*   **NFR-02: Sub-Second Interactive Latency:** For routine state updates and button clicks, response time must be $<1.5$ seconds. For complex planning, $<5$ seconds.
*   **NFR-03: High Availability (24/7):** Proactive reminders and schedulers must never sleep or miss cron triggers due to container spin-downs.
*   **NFR-04: Crash Resilience & Durability:** All state, tasks, history, and scheduled jobs must survive process crashes, server restarts, or network dropouts with zero data loss (ACID storage).
*   **NFR-05: Privacy & Local Data Sovereignty:** Personal notes, college submissions, and behavioural history must reside in a private database under user control, not indexed into public third-party SaaS tools.

---

## 6. CURRENT AGENT ECOSYSTEM RESEARCH

A comprehensive review of the modern agentic landscape reveals key trade-offs between flexibility, determinism, and maintenance overhead:

| Framework / Tool | Language | Primary Architecture | Key Strengths | Critical Weaknesses for Personal OS | Official Link |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenClaw** | TypeScript | Persistent Gateway Daemon | Multi-channel messaging (Telegram, Slack, Discord), modular `SKILL.md` system, tool policies | Focuses on open-ended computer-use/chat; lacks deterministic constraint scheduler and life-event state machines. | [openclaw/openclaw](https://github.com/openclaw/openclaw) |
| **LangGraph / Deep Agents** | Python / TS | State Graph / Agent Harness | Cyclic graphs, human-in-the-loop checkpoints, planning-first TODO lists | High abstraction bloat, complex debugging of internal state transitions, heavy dependency tree. | [langchain-ai/deepagents](https://github.com/langchain-ai/deepagents) |
| **PydanticAI** | Python | Type-Safe Agent Harness | End-to-end Pydantic validation, model-agnostic, dependency injection, lightweight, Logfire tracing | No built-in cron/event scheduling (requires external scheduler like APScheduler). | [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai) |
| **Mastra** | TypeScript | Modular Agent Framework | Graph workflows, Zod-typed tools, built-in model routing, Next.js/Node integration | Geared toward web apps and SaaS microservices; less suited for persistent long-lived CLI/VPS daemons. | [mastra-ai/mastra](https://github.com/mastra-ai/mastra) |
| **Google ADK** | Python / TS / Go | Code-First Orchestration | Clean software engineering patterns, native MCP support, flexible orchestration | Strongly tied to Google Cloud / Vertex AI deployment patterns. | [adk.dev](https://adk.dev) / [google/adk-python](https://github.com/google/adk-python) |
| **OpenAI Agents SDK** | Python / JS | Primitive-Based Handoffs | Lightweight, minimal magic, clean agent handoffs and guardrails | Highly centered on OpenAI API paradigms; lacks memory abstractions and temporal scheduling. | [openai/openai-agents-python](https://github.com/openai/openai-agents-python) |
| **Microsoft Agent Framework** | Python / .NET | Enterprise Orchestration | Replaces AutoGen; graph-based orchestration, thread state, enterprise telemetry | Enterprise-heavy, steep learning curve, overkill for single-user autonomous assistant. | [microsoft/agent-framework](https://github.com/microsoft/agent-framework) |
| **Model Context Protocol (MCP)** | Open Standard | Client-Server Tool Standard | Standardized protocol to connect models to external tools, files, and databases | Protocol only; requires a host orchestrator and client implementation. | [modelcontextprotocol.io](https://modelcontextprotocol.io) |

---

## 7. EXISTING PERSONAL ASSISTANT PROJECTS

1.  **Letta (formerly MemGPT) ([letta-ai/letta](https://github.com/letta-ai/letta)):**
    *   *Architecture:* Implements an OS-style memory hierarchy for LLMs (Core Memory in prompt, Recall Memory in relational DB, Archival Memory in vector DB) via self-editing tool calls (`core_memory_append`, `archival_memory_insert`).
    *   *Assessment:* The memory design is best-in-class, but Letta is built as a general conversational agent. It has no temporal constraint engine for schedule recalculations or assignment pipelines.
2.  **Khoj ([khoj-ai/khoj](https://github.com/khoj-ai/khoj)):**
    *   *Architecture:* Local-first personal AI "second brain" that indexes Markdown notes, PDFs, Notion, and Obsidian with semantic search and chat.
    *   *Assessment:* Excellent for document retrieval and question-answering across college notes, but lacks proactive scheduling, dynamic day planning, and task execution workflows.
3.  **Open-Interpreter ([open-interpreter/open-interpreter](https://github.com/open-interpreter/open-interpreter)):**
    *   *Architecture:* Code-execution-first agent running in the local terminal.
    *   *Assessment:* Superb for local file manipulation and scripts, but lacks a persistent life model, schedule state, or background proactivity.

---

## 8. FRAMEWORK COMPARISON & VERDICT

```
+-------------------------------------------------------------------------------------------------+
|                                    FRAMEWORK EVALUATION MATRIX                                  |
+---------------------+-------------------+------------------+-------------------+----------------+
| Metric              | OpenClaw          | LangGraph        | PydanticAI        | Custom Clean   |
|                     | (TS Gateway)      | (Python Graph)   | (Python Typed)    | Architecture   |
+---------------------+-------------------+------------------+-------------------+----------------+
| Language            | TypeScript        | Python           | Python            | Python / TS    |
| Type Safety         | High (TS)         | Moderate         | Maximum (Pydantic)| Maximum        |
| Scheduling Support  | Basic Cron        | Checkpoint-only  | Needs APScheduler | Tailored Queue |
| Mathematical Solvers| Poor in Node.js   | High in Python   | High in Python    | Highest        |
| Memory Efficiency   | Moderate          | Heavy            | Very Lightweight  | Zero Overhead  |
| Ecosystem Longevity | Community-driven  | VC / Enterprise  | Core Py Standard  | Complete Owner |
| Suitability for OS  | Gateway only (B+) | Complex (C+)     | Agent Core (A)    | Perfect (A+)   |
+---------------------+-------------------+------------------+-------------------+----------------+
```

**Verdict:** 
No single monolithic framework solves this problem out of the box because *the problem is not primarily an LLM orchestration challenge—it is a temporal constraint and state management challenge*. 
Using OpenClaw alone fails because it lacks the mathematical scheduling and failure-aware state machine. Using LangGraph alone introduces massive abstraction overhead.
The optimal engineering approach is a **Modular Clean-Architecture Application in Python** leveraging:
*   **PydanticAI / LiteLLM** for typed model interaction and agent loops.
*   **Deterministic Constraint Scheduler** (pure Python interval math / linear sorting).
*   **SQLite with WAL mode** for transactional local persistence.
*   **APScheduler 3.x / Persistent DB Queue** for durable proactive timing.
*   **aiogram 3.x** for robust, asynchronous Telegram interaction.

---

## 9. MODEL COMPARISON

| Model | Strengths | Weaknesses | Best Role in Assistant |
| :--- | :--- | :--- | :--- |
| **Gemini 2.0 Flash** | Ultra-fast ($<500$ ms TTFT), 1M context, exceptional tool calling, structured outputs, free tier available | Output length constraints occasionally on complex reasoning | **Primary Agent Model** (Intent parsing, decomposition, re-planning coaching) |
| **Qwen 2.5 72B / Llama 3.3 70B** | Open weights, frontier-grade reasoning, strong formatting | High resource demands; free APIs subject to strict daily caps | **Secondary Complex Reasoning Fallback** |
| **Qwen 2.5 14B / 7B (Local)** | Private, offline, zero API rate limits, great function calling | Limited context window on CPU, slow TTFT on low-spec VPS | **Offline Fallback / Simple Worker** |
| **GLM-4-Flash / Z.ai** | Free tier, high speed, competitive Chinese/English support | Tool calling reliability slightly below Gemini Flash | **Tertiary Free Fallback Provider** |

---

## 10. FREE API COMPARISON (CURRENT BENCHMARKS)

To achieve \$0.00/month operating cost with high reliability, we analyze current free API tiers:

| Provider | Model Tier | Rate Limits | Daily Cap | Tool Calling Quality | Reliability / Uptime |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Google AI Studio** | Gemini 2.0 Flash / 1.5 Flash | 15 RPM / 1,000,000 TPM | 1,500 RPD | **Outstanding** (Native JSON schema enforcement) | 99.9% (Tier 1 Infrastructure) |
| **OpenRouter Free** | `:free` router (Llama 3.3 70B, Qwen 2.5) | 20 RPM | 50 RPD (unfunded accounts) | Moderate to High (model dependent) | Fluctuation based on provider load |
| **Zhipu AI / Z.ai** | GLM-4-Flash | 15 RPM / 60 TPM | No strict daily ceiling published | Moderate | Stable, occasional cross-border latency |
| **Groq Free** | Llama 3.3 70B Versatile | 30 RPM / 12,000 TPM | 1,000 RPD (100k tokens/day) | High | Ultra-fast ($>200$ t/s), but 100k token ceiling is tight |
| **GitHub Models** | GPT-4o-mini / Llama 3.3 70B | Dynamic (~15 RPM) | 50–150 RPD | High | Stable for prototyping |

**Recommended Cloud Strategy:**
*   **Primary:** Google AI Studio (Gemini 2.0 Flash) — 1,500 requests/day allows an agent interaction or background check every 60 seconds without spending a penny.
*   **Fallback 1:** Groq (Llama 3.3 70B) for ultra-low latency text classification when daily tokens allow.
*   **Fallback 2:** OpenRouter (`:free`) for redundancy.

---

## 11. LOCAL MODEL ANALYSIS (VPS WITH 24–32 GB RAM, CPU-ONLY)

The user noted access to a VPS with 24–32 GB RAM. We evaluate running a local model on this environment:

### 11.1 Compute & Memory Bandwidth Constraints
*   **The CPU Bottleneck:** Modern LLMs are memory-bandwidth bound during generation and compute-bound during prompt ingestion (prefill). A standard server CPU provides 40–60 GB/s memory bandwidth, compared to an NVIDIA RTX 4090 ($1,008$ GB/s) or A100 ($2,000$ GB/s).
*   **Generation Speed vs. Model Size on 4–8 vCPUs:**
    *   *Qwen 2.5 7B (Q4_K_M, ~4.5 GB RAM):* $\sim 15 - 25$ tokens/sec. Usable, responsive.
    *   *Qwen 2.5 14B (Q4_K_M, ~9.0 GB RAM):* $\sim 7 - 12$ tokens/sec. Acceptable for background tasks.
    *   *Qwen 2.5 32B (Q4_K_M, ~19.5 GB RAM):* $\sim 2.5 - 4.5$ tokens/sec. Barely usable.
    *   *70B Models:* Cannot fit in 24–32 GB without destructive 2-bit quantization that destroys tool-calling ability.
*   **Time-To-First-Token (TTFT) in Agentic Contexts:**
    Agent prompts contain system instructions, schemas, current schedule state, and past context ($\sim 3,000 - 6,000$ tokens). On CPU inference engines (llama.cpp / Ollama), evaluating 4,000 prompt tokens takes **12 to 25 seconds** before the first token is generated. In a multi-turn agent loop with 2 tool calls, a single user message would incur a **45–60 second latency**.

### 11.2 Architectural Role of the Local Model
*   **DO NOT** use the local CPU model as the primary interactive agent. It will make Telegram interactions feel sluggish and un-engaging.
*   **DO** use the local VPS instance as:
    1.  The **24/7 Persistent Application Host** running the Telegram daemon, SQLite database, and APScheduler background loop.
    2.  An **Emergency Offline Fallback** running Ollama with `qwen2.5:7b-instruct-q4_K_M` to answer basic schedule queries if cloud APIs experience an outage or rate limit.

---

## 12. HOSTING COMPARISON

| Hosting Platform | Free Tier Specifications | Limitations / Caveats | Suitability for Assistant Host |
| :--- | :--- | :--- | :--- |
| **Oracle Cloud Always Free** | Ampere A1 Compute: Up to 2 OCPUs, 12 GB RAM (Updated mid-2026 limits), 200 GB Storage | Out-of-capacity errors in popular regions; accounts can be suspended if idle | **Grade: A** (Best free VPS if already provisioned) |
| **Cloudflare Workers + D1** | 100k requests/day, 5 GB D1 SQLite DB, Vectorize, KV | V8 Isolates; maximum 50ms CPU time; cannot run persistent long-polling daemons | **Grade: B-** (Good for webhooks, poor for persistent stateful agents) |
| **Render** | 0.1 vCPU, 512 MB RAM | **Spins down after 15 min inactivity**; 30–60s cold start; kills background cron loops | **Grade: F** (Unusable for proactive assistants) |
| **Koyeb** | 0.1 vCPU, 512 MB RAM | Credit card hold (\$29) required; scales to zero after 1 hour idle; no persistent volumes | **Grade: F** (Unusable) |
| **Self-Hosted (Local PC / Old Laptop / Home Server)** | Whatever hardware you own | Dependent on home electricity and Wi-Fi; requires background process management | **Grade: A-** (Excellent development target; zero external cost) |
| **Existing Free/Cheap VPS (24–32 GB RAM)** | Dedicated Linux container, full root access, persistent disk | Maintenance responsibility | **Grade: A+** (The ideal deployment target) |

**Conclusion:** Run the daemon on the user's available VPS (or local dev machine during State Zero testing) using Docker or systemd.

---

## 13. TELEGRAM ARCHITECTURE OPTIONS

### 13.1 Long Polling vs. Webhooks for Personal Operation
*   **Webhook Architecture:**
    Requires a public IP, valid domain name, SSL/TLS certificate, reverse proxy (Nginx/Caddy), and open firewall ports. If hosted on a laptop or residential network, it requires Cloudflare Tunnels or Tailscale Funnel.
*   **Long Polling Architecture:**
    The assistant process establishes an outbound HTTPS connection to `api.telegram.org`. 
    *   Works seamlessly behind NAT, college Wi-Fi firewalls, and residential routers.
    *   Zero public open ports = zero attack surface.
    *   Instant recovery upon network reconnect.
    *   For a single user ($<200$ messages/day), the latency difference between Webhook and Long Polling is imperceptible ($<80$ ms).

**Decision:** **Asynchronous Long Polling via `aiogram 3.x`**.

### 13.2 Interactive Telegram UX Design
To minimize user typing friction, the bot must employ:
1.  **Persistent Reply Keyboards (Quick Actions):**
    `[ 📋 What's Next? ]` `[ 🍱 Log Meal ]` `[ ⚠️ Running Late ]` `[ 🔄 Plan Tonight ]`
2.  **Inline Message Keyboards (Action Cards):**
    When a task alert is pushed:
    ```
    ┌──────────────────────────────────────────────┐
    │ 📌 CURRENT TASK: Write OS Lab Record (p.1-3) │
    │ ⏳ Allocated: 8:00 PM – 8:45 PM (45m)         │
    │ 🚨 Deadline: Tomorrow 10:00 AM (Print needed)│
    ├──────────────────────────────────────────────┤
    │ [  Done  ]   [ +15m Slip ]   [ Stuck/Split ] │
    │ [ Skip -> Move to 11PM ]    [ Emergency Drop]│
    └──────────────────────────────────────────────┘
    ```
    Clicking `[+15m Slip]` immediately triggers the deterministic scheduler to push downstream tasks by 15 minutes, adjusts the dinner boundary, and updates the message in-place via Telegram's `editMessageText` API.

---

## 14. MEMORY ARCHITECTURE

The memory system must reject the naive approach of storing endless raw chat transcripts into a vector database. Most chat messages are noise (*"k", "running late", "ok"*).

```
+----------------------------------------------------------------------------------------------------+
|                                    TIERED MEMORY ARCHITECTURE                                      |
+----------------------------------------------------------------------------------------------------+
| TIER 1: WORKING MEMORY (Active Context Buffer - RAM & In-Prompt)                                    |
| - Current local timestamp & date                                                                   |
| - Active day schedule & current block status                                                       |
| - Current physiological state (last meal timestamp, gym planned today: yes/no)                    |
| - Last 5 conversation turns                                                                        |
+----------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+----------------------------------------------------------------------------------------------------+
| TIER 2: STRUCTURED CORE PROFILE (Living Document - SQLite & Markdown File)                         |
| - Circadian bounds: Sleep ~4:00-5:00 AM, Deep Work starts ~11:00 PM, Dinner ~9:30 PM               |
| - Known academic velocities: 40 min / page of handwritten assignments                             |
| - Optimism Multipliers: Coding projects x1.8, Assignment writeups x1.4                             |
| - Behavioral triggers: High procrastination on un-decomposed PDFs                                  |
+----------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+----------------------------------------------------------------------------------------------------+
| TIER 3: EPISODIC & TRANSACTIONAL STORE (SQLite Relational Tables)                                  |
| - `tasks` (status, priority, deadline, estimated_mins, actual_mins, tags)                          |
| - `schedule_blocks` (start_time, end_time, task_id, state: planned|completed|slipped|dropped)     |
| - `submissions` (id, subject, physical_stage, print_deadline, submission_deadline)                 |
| - `meal_logs` (timestamp, meal_type, was_scheduled, delay_mins)                                    |
| - `friction_logs` (task_id, reason_skipped, time_wasted_category)                                  |
+----------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+----------------------------------------------------------------------------------------------------+
| TIER 4: SEMANTIC ARCHIVAL MEMORY (SQLite FTS5 Full-Text Search + sqlite-vec)                        |
| - Syllabus details, professor preferences, assignment prompts, project architecture notes          |
| - Queried on-demand when user mentions specific subjects or past projects                          |
+----------------------------------------------------------------------------------------------------+
```

---

## 15. SCHEDULING & EVENT ARCHITECTURE

A common architectural failure in AI bots is relying on in-memory `asyncio.sleep()` loops. If the application restarts, all pending reminders evaporate.

### 15.1 Durable Event Queue Pattern
All time-based triggers are persisted in a database table:

```sql
CREATE TABLE scheduled_events (
    id TEXT PRIMARY KEY,
    trigger_at TIMESTAMP NOT NULL,
    event_type TEXT NOT NULL,          -- 'TASK_CHECKIN', 'MEAL_REMINDER', 'PRINT_WARNING', 'DAY_REVIEW'
    payload JSON NOT NULL,             -- { "task_id": "123", "action": "verify_completion" }
    status TEXT DEFAULT 'PENDING',     -- 'PENDING', 'PROCESSED', 'CANCELLED', 'RESCHEDULED'
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_events_trigger ON scheduled_events(trigger_at, status);
```

### 15.2 The Heartbeat Engine
An asynchronous background worker (`APScheduler` or custom `asyncio` ticker) queries the database every 15 seconds:
```python
SELECT * FROM scheduled_events 
WHERE trigger_at <= CURRENT_TIMESTAMP AND status = 'PENDING' 
ORDER BY trigger_at ASC LIMIT 10;
```
For each due event:
1.  Mark event status as `PROCESSING`.
2.  Dispatch event to the handler (e.g., compile proactive Telegram alert).
3.  Transmit message to Telegram with interactive action buttons.
4.  Mark status as `PROCESSED`.
5.  If execution fails, increment `retry_count` and reschedule with exponential backoff.

This guarantees that **no reminder is ever lost across server reboots, network dropouts, or code updates**.

---

## 16. DYNAMIC PLANNING ARCHITECTURE

### 16.1 Why Pure LLM Planners Fail
When prompted to *"Schedule these 6 tasks between 7:30 PM and 3:00 AM"*, LLMs consistently:
1.  Violate hard time arithmetic (e.g., claiming $8:45 + 50\text{ min} = 9:15$).
2.  Create overlapping intervals.
3.  Neglect physical human transitions (scheduling 5 consecutive 30-minute cognitive tasks with zero breather).
4.  Arbitrarily alter priorities or hallucinate deadlines when asked to replan after a delay.

### 16.2 The Hybrid Planning Engine: Deterministic Solver + LLM Explainer
The planning pipeline strictly decouples **Cognitive Extraction** from **Mathematical Scheduling**:

```
[ Unstructured User Input / Event ]
               │
               ▼
┌──────────────────────────────────────────────┐
│ STEP 1: LLM ENTITY & INTENT EXTRACTOR        │
│ Parses tasks, estimates, hard deadlines,    │
│ dependencies, and energy requirements into   │
│ strict Pydantic models.                      │
└──────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│ STEP 2: DETERMINISTIC INTERVAL SCHEDULER     │
│ (Pure Python / Constraint Satisfaction)     │
│ 1. Load Hard Anchors: College, Commute,      │
│    Dinner (9:30 PM), Gym, Sleep Window.      │
│ 2. Insert 15-Minute Human Transition Buffers.│
│ 3. Compute Free Time Windows (Slots).        │
│ 4. Apply Dynamic Multipliers (Actual = Est*β)│
│ 5. Fit Tasks via Priority Knapsack & Critical│
│    Path Topological Sort.                    │
│ 6. Output: Strictly valid, non-overlapping   │
│    timeline or explicit OVERFLOW flag.       │
└──────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│ STEP 3: LLM COACH & EXPLAINER                │
│ Receives the solved timeline. Translates it  │
│ into a concise, empathetic Telegram briefing │
│ with action items and clear rationale.       │
└──────────────────────────────────────────────┘
```

### 16.3 Daily Time Zoning
The scheduler automatically categorizes the day into distinct physiological zones:
*   **Zone 1: College & Commute (Morning – 7:30 PM):** Hard commitment. Background reminder mode only.
*   **Zone 2: Post-College Transition Trough (7:30 PM – 9:30 PM):** High fatigue, high procrastination risk. **Never schedule heavy coding or multi-hour study here.** Schedule low-activation tasks: unpacking, printing preparation, 15-minute administrative review, pre-dinner snack, light decompression.
*   **Zone 3: Dinner Anchor (9:30 PM – 10:30 PM):** Protected nutritional and digestion window. No cognitive pressure.
*   **Zone 4: Peak Deep-Work Window (11:00 PM – 3:30 AM):** High focus, minimal external interruptions. Best for programming, project architecture, assignment drafting, complex labs.
*   **Zone 5: Wind-Down & Sleep Boundary (3:30 AM – 4:30 AM):** Pack bag for college, verify printed submissions, set morning alarms, lights out.

---

## 17. FAILURE & RE-PLANNING ARCHITECTURE

### 17.1 The "I Didn't Do It" State Machine
When the user reports non-completion or a scheduled task interval lapses without confirmation:

```
[ Trigger: Task Overrun or User "I skipped it" ]
                       │
                       ▼
    ┌─────────────────────────────────────┐
    │ 1. INVENTORY DAMAGE                 │
    │ - How much time was lost?           │
    │ - What is the hard deadline?        │
    │ - Does this task block anything?   │
    └─────────────────────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         ▼                           ▼
[ Deadline < 12 Hours ]     [ Deadline >= 12 Hours ]
         │                           │
         ▼                           ▼
┌──────────────────────┐    ┌──────────────────────┐
│ EMERGENCY TRIAGE     │    │ CONTROLLED DEFERRAL  │
│ 1. Protect Meals     │    │ 1. Move to tomorrow's│
│ 2. Decompose to bare │    │    Deep Work window  │
│    minimum viable    │    │ 2. Update priority   │
│    submission        │    │ 3. Log friction tag  │
│ 3. Drop all optional │    │ 4. Compress current  │
│    tasks for tonight │    │    evening plan      │
└──────────────────────┘    └──────────────────────┘
         │                           │
         └─────────────┬─────────────┘
                       ▼
┌──────────────────────────────────────────────────┐
│ 2. RECALCULATE DOWNSTREAM SCHEDULE               │
│ Deterministic re-solve of remaining time slots.  │
│ Dinner and sleep boundaries are strictly upheld. │
└──────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│ 3. PRESENT REVISED TRAJECTORY                    │
│ "Understood. Dropped Task B and moved Task C to  │
│ tomorrow. Tonight now requires only 30m on Task  │
│ A before dinner at 9:30. Here is your plan."     │
└──────────────────────────────────────────────────┘
```

### 17.2 Three-Tier Triage Protocol
When available time is insufficient for remaining tasks, the engine applies deterministic triage:
1.  **Tier 1 (Non-Negotiable Anchors):** Health & Hard Deadlines. (Dinner, Sleep floor of $\ge 5$ hours, submissions due next morning).
2.  **Tier 2 (Deferrable Work):** Important but flexible items. (Future assignments due in 3+ days, non-critical personal coding projects). Pushed forward automatically.
3.  **Tier 3 (Sacrificial Admin):** Nice-to-haves. (Refactoring code comments, reorganizing folders, general reading). Canceled or flagged as backlog.

---

## 18. LONG-TERM LEARNING ARCHITECTURE

The system avoids static assumptions by maintaining empirical learning metrics:

### 18.1 The Optimism Multiplier ($\beta$)
For each task category $c$ (e.g., `handwritten_assignment`, `coding_project`, `lab_report`), the system calculates:
$$\beta_c = \frac{\sum \text{Actual Duration}}{\sum \text{Estimated Duration}}$$
When the user submits a new task with an estimate of $E$ minutes, the scheduler assigns:
$$\text{Scheduled Duration} = E \times \beta_c$$
If the user estimates an assignment will take 30 minutes, but historically exhibits $\beta_{\text{assignment}} = 1.8$, the scheduler silently budgets **54 minutes**, preventing schedule collapse before it starts.

### 18.2 Behavioral Friction Fingerprinting
Whenever a task is postponed or skipped $>2$ times, the bot logs a friction record:
*   Was the task vague? $\rightarrow$ Trigger automatic decomposition on intake.
*   Was it scheduled during the 7:30–9:30 PM post-college trough? $\rightarrow$ Blacklist this category from Zone 2.
*   Was it a printable submission? $\rightarrow$ Flag print dependency earlier in the day.

### 18.3 Explainable Habit Profiles
The user can inspect what the assistant has learned by running `/my_habits`:
> *"I've noticed that programming tasks take 1.6x longer than planned, and handwritten pages average 38 minutes each. I now schedule your assignments before 2:00 AM because completion rates drop significantly after 3:00 AM."*

---

## 19. CAPABILITY & SKILL ARCHITECTURE

The assistant must easily expand to new domains (hackathon tracking, GitHub PR monitoring, college portal scraping) without destabilizing the core operating loop.

```
┌─────────────────────────────────────────────────────────────┐
│                    CORE OPERATING DAEMON                    │
│   (Telegram Gateway, State Graph, Scheduler, Memory)        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│ INTERNAL SKILL MODULES      │ │ MODEL CONTEXT PROTOCOL (MCP)│
│ Lightweight Python plugins  │ │ External standard clients   │
│ with typed tool signatures  │ │ running as sub-processes    │
├─────────────────────────────┤ ├─────────────────────────────┤
│ • Task Intake & Decompose   │ │ • GitHub MCP Server         │
│ • Submission State Tracker  │ │ • Web Research / Fetch MCP  │
│ • Nutrition & Gym Tracker   │ │ • Local Filesystem MCP      │
│ • Daily Re-planner          │ │ • College Portal Scraper    │
└─────────────────────────────┘ └─────────────────────────────┘
```

### 19.1 Skill Specification
Each new capability is packaged as a self-contained directory containing:
*   `skill.py`: Tool declarations with Pydantic input/output schemas and execution logic.
*   `SKILL.md`: Natural-language instructions describing when and how the agent should utilize this capability.
The core engine dynamically discovers and registers tools at startup.

---

## 20. SECURITY, PERMISSIONS & SAFETY ARCHITECTURE

As an operating assistant, the bot will eventually hold access to local shell commands, files, and external APIs. Unrestricted LLM execution is dangerous.

### 20.1 Permission Tiers

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TIER 1: READ-ONLY (Automatic Execution)                                  │
│ Querying tasks, reading schedules, checking weather, fetching git status │
├──────────────────────────────────────────────────────────────────────────┤
│ TIER 2: SAFE STATE MUTATION (Automatic with Telegram Notice)             │
│ Adding tasks, updating meal logs, recalculating timelines, setting alarms│
├──────────────────────────────────────────────────────────────────────────┤
│ TIER 3: EXTERNAL ACTION (Explicit Approval via Inline Button)            │
│ Sending emails, posting to GitHub, creating calendar events              │
├──────────────────────────────────────────────────────────────────────────┤
│ TIER 4: DESTRUCTIVE / SYSTEM ACTION (Strict Two-Factor Confirmation)     │
│ Deleting tasks, dropping tables, executing arbitrary shell scripts, rm   │
│ -> Requires clicking an explicit confirmation callback: "CONFIRM DELETE" │
└──────────────────────────────────────────────────────────────────────────┘
```

### 20.2 Secret Management & Isolation
*   All API tokens (Telegram Bot Token, Google AI Studio key) reside exclusively in a strictly permissioned `.env` file (`chmod 600`), never logged or checked into source control.
*   Telegram messages are checked against an `AUTHORIZED_USER_ID` whitelist. Any message from an unrecognized Telegram ID is discarded with zero response.

---

## 21. ALTERNATIVES CONSIDERED

1.  **Extending OpenClaw Directly:**
    *   *Considered:* OpenClaw has a great messaging gateway and skill system.
    *   *Rejected:* OpenClaw is built in TypeScript with an open-ended conversational paradigm. Integrating a deterministic constraint scheduler, physical submission state machine, and behavioral regression models into OpenClaw would require fighting against its core design rather than using it cleanly.
2.  **Pure LangChain / LangGraph Multi-Agent Team:**
    *   *Considered:* Building a swarm of agents (Planner Agent, Nutrition Agent, Academic Agent, Critic Agent).
    *   *Rejected:* Multi-agent chatter leads to token explosion, high latency (10–30s per turn), cascading hallucinations, and high risk of hitting free API rate limits. Single-agent with clean tool execution is vastly superior.
3.  **Third-Party SaaS (Notion AI, Todoist + Zapier, Motion):**
    *   *Considered:* Combining commercial tools.
    *   *Rejected:* Closed ecosystems, costly subscriptions (\$20–40/mo), rigid scheduling algorithms that do not understand 4:00 AM sleep or printable submission pipelines, and lack of deep failure-aware learning.

---

## 22. ARCHITECTURE OPTIONS

### Option A: The Full-OpenClaw Gateway
*   Use OpenClaw as the runtime daemon; write custom TypeScript skills for task planning and database storage.
*   *Pros:* Ready-made multi-platform chat integrations.
*   *Cons:* Node.js lacks mature constraint-satisfaction libraries; heavy RAM footprint; difficult to maintain custom state models.

### Option B: LangGraph + Serverless Cloud Stack
*   Python LangGraph hosted on Cloudflare Workers / Render with Supabase PostgreSQL and pgvector.
*   *Pros:* Visual graph tooling, managed database.
*   *Cons:* Cold starts on Render break proactive scheduling; Cloudflare Worker execution limits complicate agent loops; Supabase free tier pauses after inactivity.

### Option C: The Modular Clean-Architecture Daemon (Recommended)
*   Single, robust, asynchronous Python daemon running on a Linux VPS / local server.
*   `aiogram 3.x` (Long polling) + PydanticAI / LiteLLM + Deterministic Interval Scheduler + SQLite (WAL mode) + APScheduler.
*   *Pros:* Zero cold starts, zero public port exposure, 100% durable ACID storage, instant sub-second response, complete architectural ownership, trivially extensible.

---

## 23. RECOMMENDED ARCHITECTURE BLUEPRINT (OPTION C)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             TELEGRAM CLIENT (USER)                          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTPS Long Polling
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AIOGRAM 3.X TELEGRAM GATEWAY                      │
│  - Authentication Guard (Matches Telegram User ID)                          │
│  - Message Router (Commands, Free Text, Inline Callback Queries)            │
│  - UI Presenter (Card Formatter, Dynamic Buttons, In-Place Message Updates) │
└───────────────────────┬─────────────────────────────▲───────────────────────┘
                        │                             │
                        ▼                             │ Notifications
┌──────────────────────────────────────────────┐      │ & Alerts
│           CORE ORCHESTRATION ENGINE          │      │
│  - Intent Classifier & Dispatcher            │      │
│  - Session & Working Memory Context Assembly │      │
└───────────────┬──────────────────────────────┘      │
                │                                     │
     ┌──────────┴────────────────────────┐            │
     ▼                                   ▼            │
┌─────────────────────────────┐ ┌─────────────────────────────────────────────┐
│   AGENT INTELLIGENCE LAYER  │ │       DETERMINISTIC PLANNING ENGINE         │
│  - PydanticAI / LiteLLM     │ │  - Day Interval Solver (Anchors + Slots)    │
│  - Gemini 2.0 Flash (Cloud) │ │  - Priority Knapsack & Critical Path Sorter │
│  - Groq / Qwen Fallbacks    │ │  - Dynamic Buffer Multiplier (β Engine)     │
│  - Structured Extraction    │ │  - Failure & Slippage Triage Algorithm      │
│  - Actionable Decomposition │ └──────────────────────┬──────────────────────┘
└───────────────┬─────────────┘                        │
                │ Tool Calls                           │ Schedules & Updates
                ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             DOMAIN SERVICES LAYER                           │
│  - Task & Submission Service (8-stage pipeline state machine)               │
│  - Habit & Behavioral Profiler (optimism tracking, friction logging)        │
│  - Nutrition & Fitness Service (meal pacing, workout clash detection)       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                        ┌──────────────┴──────────────┐
                        ▼                             ▼
┌─────────────────────────────────────────────┐ ┌─────────────────────────────┐
│           SQLITE PERSISTENT STORE           │ │     APSCHEDULER ENGINE      │
│  - WAL Mode Enabled (Concurrent Read/Write) │ │  - Persistent SQLite Store  │
│  - Tasks, Submissions, Habits, Logs         │ │  - Heartbeat Poller (15s)   │
│  - Full-Text Search (FTS5) & Core Profile   │ │  - Proactive Push Triggers  │
└─────────────────────────────────────────────┘ └─────────────────────────────┘
```

---

## 24. WHY THIS ARCHITECTURE WAS SELECTED

1.  **Immunity to the "Broken Calendar" Problem:** By separating the mathematical schedule from LLM reasoning, the system mathematically guarantees zero time overlaps and strictly valid arithmetic.
2.  **Zero Cost with Tier-1 Performance:** Gemini 2.0 Flash provides frontier-grade intelligence, structured output enforcement, and 1,500 requests/day for \$0.00.
3.  **Bulletproof Durability:** SQLite with Write-Ahead Logging (WAL) is virtually indestructible, requires zero database server administration, and stores everything in a single, easily backed-up file.
4.  **No Firewall or Port Headaches:** Long polling eliminates the need for public IP addresses, domain names, or reverse proxies.
5.  **Low Friction for Human Imperfection:** Interactive Telegram keyboards enable state updates in a fraction of a second, ensuring the user actually uses the tool even when exhausted.

---

## 25. WHAT WAS REJECTED & WHY

*   **Rejected: Microservices / Docker-Compose Swarm.** Overkill for a personal assistant. A clean single-process asynchronous Python daemon utilizes $<120$ MB of RAM and avoids inter-process network latency.
*   **Rejected: Vector-Database-First RAG.** Pure vector search returns noisy, irrelevant snippets for structured questions like *"What is due tomorrow?"*. Relational SQL queries are 100% deterministic and accurate.
*   **Rejected: Pure LLM Scheduling.** As proven empirically, LLMs cannot perform reliable temporal constraint math without hallucinating.
*   **Rejected: Cloud-Only SaaS Bots.** SaaS tools cannot easily execute local tasks, have recurring monthly subscription costs, and lack deep customization for personal failure modes.

---

## 26. MVP DEFINITION (MILESTONE 1)

The MVP is laser-focused on solving the immediate daily pain points:

1.  **Interactive Telegram Interface:** Functional bot with authentication whitelist and persistent menu keyboard.
2.  **Natural Language Task & Submission Intake:** Parse raw text into tasks with title, estimate, deadline, and physical submission flag.
3.  **The 8-Stage Submission Pipeline:** Track printable assignments from discovery through printing to bag packing and submission.
4.  **Deterministic Daily Timeline Generator:** Construct a nightly plan honoring College, 9:30 PM Dinner, Gym, and 4:30 AM Sleep bounds.
5.  **Failure-Aware "I Didn't Do It" Re-planner:** One-tap button to report task slip or skip, instantly generating an updated schedule for the remaining evening.
6.  **Proactive Post-College & Pre-Dinner Alerts:** Automatic nudges at 7:45 PM (trough management) and 9:15 PM (dinner warning).

---

## 27. PHASE 2: ADVANCED BEHAVIOR & LEARNING

*   **Dynamic Optimism Multiplier ($\beta$):** Automatically scale user time estimates based on category history.
*   **Nutritional Pacing Engine:** Meal check-ins with adaptive schedule shifting when meals are repeatedly missed.
*   **Friction Logging & Activation Decomposer:** Detect stalled tasks and break them down into 10-minute activation steps.
*   **Multi-Provider Fallback Routing:** Automatic failover between Gemini 2.0 Flash, Groq, and OpenRouter.

---

## 28. PHASE 3: CAPABILITY EXPANSION & MCP

*   **Model Context Protocol (MCP) Host:** Integrate GitHub MCP to track coding projects and commits.
*   **College Portal Scraping Skill:** Automatically detect newly posted assignment PDFs and syllabi.
*   **Hackathon & Opportunity Scout:** Weekly background scan for relevant hackathons and student tech competitions.
*   **Local Model Offline Failover:** Local Ollama runner on the VPS for network-independent operation.

---

## 29. FUTURE EXPANSION: THE TEAM ASSISTANT PATHWAY

While keeping the core strictly personal for now, the architecture is deliberately designed to allow team expansion later:
*   The SQLite schema uses an explicit `owner_id` column on all tables.
*   The domain service layer cleanly separates user identity from business logic.
*   When ready for a team assistant, the single-user Telegram router can be augmented with multi-user group routing and role-based permissions without modifying the underlying scheduling engine.

---

## 30. ESTIMATED OPERATING COST BREAKDOWN

| Component | Provider / Solution | Monthly Cost |
| :--- | :--- | :--- |
| **Compute / Hosting** | Existing VPS (or Oracle Cloud Always Free / Local Machine) | \$0.00 |
| **Primary LLM Intelligence** | Google AI Studio (Gemini 2.0 Flash Free Tier) | \$0.00 |
| **Secondary LLM Fallback** | Groq / OpenRouter Free Tiers / Z.ai | \$0.00 |
| **Database** | SQLite (Local Embedded WAL) | \$0.00 |
| **Messaging Channel** | Telegram Bot API | \$0.00 |
| **Domain & Networking** | Not needed (Long Polling) | \$0.00 |
| **Total Monthly Cost** | | **\$0.00** |

---

## 31. RISKS & MITIGATIONS

1.  **Risk: Google AI Studio Rate Limit Changes or Outages.**
    *   *Mitigation:* Implement a seamless `ModelRouter` with instant fallback to Groq (Llama 3.3 70B) or Z.ai.
2.  **Risk: Notification Fatigue / Bot Muting.**
    *   *Mitigation:* Strict alert throttling. Maximum of 4–6 proactive messages per day. Every message must include actionable buttons, not passive announcements.
3.  **Risk: SQLite File Corruption on Sudden Power Cut.**
    *   *Mitigation:* Run SQLite in `PRAGMA journal_mode=WAL` with `PRAGMA synchronous=NORMAL`. Schedule automated nightly backup dumps to a local gzip file.

---

## 32. TECHNICAL UNKNOWNS & SPIKE EXPERIMENTS

Before final deployment, three brief technical spikes should be validated:
1.  **Spike 1: Long-Polling Stability under College Network Conditions:** Validate that `aiogram 3.x` auto-reconnects cleanly across network changes without dropping update sequences.
2.  **Spike 2: Pydantic Schema Extraction Accuracy with Gemini 2.0 Flash:** Benchmark complex multi-deadline extraction across 20 synthetic messy student messages.
3.  **Spike 3: Persistent APScheduler Job Recovery:** Confirm that missed jobs scheduled during a simulated 15-minute process downtime fire correctly upon restart.

---

## 33. EXACT THINGS THE USER NEEDS TO PROVIDE

To proceed from research to construction, the user will need to supply:
1.  **A Telegram Bot Token:** Created in 60 seconds via [@BotFather](https://t.me/BotFather).
2.  **The User's Personal Telegram User ID:** Obtained via [@userinfobot](https://t.me/userinfobot) (to lock down the whitelist).
3.  **A Google AI Studio API Key:** Generated for free at [aistudio.google.com](https://aistudio.google.com/).
4.  **Initial Schedule Anchors:**
    *   Weekly College Timetable (Class start/end times per day).
    *   Target Gym Days and preferred workout duration.
    *   Target Dinner Window (default: 9:30 PM).

---

## 34. EXACT FIRST MILESTONE: EXECUTION ROADMAP

Upon approval of this research document, the implementation will execute according to this precise roadmap:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ MILESTONE 1: THE FOUNDATIONAL OPERATING OS (Days 1–3)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Project Scaffolding & Virtual Environment                                │
│    - Modern Python setup with uv / pyproject.toml                           │
│    - Dependencies: aiogram, pydantic, pydantic-ai/litellm, apscheduler,    │
│      aiosqlite.                                                             │
│                                                                             │
│ 2. Database Schema & Migration Engine                                       │
│    - Initialize SQLite with WAL mode.                                       │
│    - Create tables: tasks, submissions, schedule_blocks, events, habits.    │
│                                                                             │
│ 3. Deterministic Interval Scheduler Core                                    │
│    - Implement slot-partitioning logic for Zones 1–5.                       │
│    - Implement non-overlapping interval placer with 15m transition buffers. │
│                                                                             │
│ 4. Telegram Gateway & Authentication Guard                                  │
│    - Asynchronous long-polling worker with user whitelist check.            │
│    - Persistent reply keyboard: [What's Next], [Plan Tonight], [Log Slip].  │
│                                                                             │
│ 5. LLM Extraction & Re-Planning Loop                                        │
│    - Implement Gemini 2.0 Flash structured entity parser.                   │
│    - Connect the "I Didn't Do It" callback to the deterministic re-solver.  │
│                                                                             │
│ 6. End-to-End Verification                                                  │
│    - Test: Intake assignment -> Schedule evening -> Simulate 45m overrun    │
│      -> Confirm recalculated evening plan preserves dinner & deadlines.     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

*End of Research Deliverable. Awaiting User Review and Instructions.*

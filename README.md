# 🤖 Personal AI Operating Assistant

> An adaptive, failure-aware Personal Operating Assistant engineered specifically around the real habits, irregular chronotypes, cognitive friction, and physical submission deadlines of an engineering student.

---

## ⚡ Core Highlights & Architectural Distinctions

1. **Not a Chatbot, Not a Todo App:**
   Maintains a persistent, evolving state graph of your life. It operates proactively over Telegram, helping you answer:
   * *"What should I do right now?"*
   * *"What printable submissions do I need to prepare?"*
   * *"What am I behind on?"*
   * *"What happens when I didn't do today's plan?"*

2. **Deterministic Interval Scheduler (No Calendar Hallucinations):**
   * Decouples natural-language extraction from mathematical scheduling.
   * Pure deterministic constraint solver calculates non-overlapping timelines with 10-minute buffers.
   * Strictly protects your **9:30 PM Dinner Anchor**, **Post-College Transition Trough**, and **4:30 AM Sleep Boundary**.

3. **8-Stage Physical Submission Pipeline:**
   Differentiates between finishing a PDF on your laptop and actually submitting it to college:
   $$\text{DISCOVERED} \rightarrow \text{DECOMPOSED} \rightarrow \text{IN\_PROGRESS} \rightarrow \text{DIGITAL\_DONE} \rightarrow \mathbf{NEEDS\_PRINTING} \rightarrow \mathbf{PRINTED\_PHYSICAL} \rightarrow \mathbf{PACKED\_IN\_BAG} \rightarrow \text{SUBMITTED}$$
   Alerts you about campus print shop deadlines and packing requirements before you leave home.

4. **Failure-Aware Dynamic Re-Planning:**
   * Expects that you will occasionally fail to follow plans or run over by 45 minutes.
   * Tapping `[+15m Slip]` or saying *"I didn't do it"* immediately recalculates the remainder of the evening, defers flexible work to tomorrow, protects dinner and sleep, and presents a realistic adjusted trajectory.

5. **Behavioral Learning & Velocity Tracking:**
   * Learns your empirical Category Optimism Multiplier:
     $$\beta_c = \frac{\sum \text{Actual Minutes}}{\sum \text{Estimated Minutes}}$$
   * Silently scales task durations so your schedule matches your real work speed.
   * Detects repeated missed meals and recommends shifting reminder windows earlier.

6. **\$0.00 / Month Architecture:**
   * **Primary LLM:** Google AI Studio (Gemini 2.0 Flash) free tier (1,500 requests/day, sub-second latency).
   * **Database:** SQLite with Write-Ahead Logging (WAL mode), embedded and ACID-compliant.
   * **Messaging:** Telegram Asynchronous Long Polling via `grammy` (zero open ports, works anywhere).

---

## 📁 Project Architecture

```
bot/
├── src/
│   ├── agent/                 # AI & LLM Intelligence
│   │   ├── coach.ts           # Non-judgmental plan formatter and explainer
│   │   ├── intentParser.ts    # Natural language intent extraction (with heuristic fallback)
│   │   ├── modelClient.ts     # Unified OpenAI-compatible client (Gemini/Groq/Ollama/Mock)
│   │   └── taskDecomposer.ts  # Breaks monoliths into <20m steps (Step 1 = Activation)
│   ├── config/
│   │   └── env.ts             # Strict Zod environment variable validation
│   ├── db/
│   │   ├── database.ts        # SQLite with WAL mode & busy timeout
│   │   └── repositories/      # Type-safe, parameterized database repositories
│   │       ├── eventRepository.ts
│   │       ├── habitRepository.ts
│   │       ├── mealRepository.ts
│   │       ├── scheduleRepository.ts
│   │       ├── submissionRepository.ts
│   │       └── taskRepository.ts
│   ├── planner/               # Deterministic Planning Engine
│   │   ├── intervalScheduler.ts # Zone partitioning, buffer math, priority knapsack
│   │   └── replanEngine.ts      # Failure recovery, slippage, and skip triage
│   ├── scheduler/
│   │   └── eventHeartbeat.ts  # 15s persistent database event heartbeat
│   ├── services/
│   │   ├── learningService.ts   # Optimism multipliers & habit drift
│   │   └── submissionService.ts # 8-stage physical submission state machine
│   ├── telegram/
│   │   └── bot.ts             # Grammy Telegram bot with persistent & inline keyboards
│   ├── types/                 # Domain types & interfaces
│   ├── schemas/               # Zod validation schemas
│   └── index.ts               # Main daemon entrypoint
├── tests/                     # 15 unit & integration tests
│   ├── agent.test.ts
│   ├── events.test.ts
│   ├── learning.test.ts
│   ├── replan.test.ts
│   ├── scheduler.test.ts
│   └── submission.test.ts
├── PERSONAL_ASSISTANT_RESEARCH.md # Comprehensive 34-section research deliverable
├── package.json
└── tsconfig.json
```

---

## 🚀 Getting Started

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v22+) or [Bun](https://bun.sh/) (v1.2+)

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your credentials:
1. `TELEGRAM_BOT_TOKEN`: From [@BotFather](https://t.me/BotFather) on Telegram.
2. `TELEGRAM_ALLOWED_USER_ID`: From [@userinfobot](https://t.me/userinfobot) (to lock the bot to your account).
3. `AI_API_KEY`: Free key from [Google AI Studio](https://aistudio.google.com/).

*(Note: The system also runs out of the box in offline/mock mode if no keys are provided!)*

### 3. Run Automated Tests
```bash
npm test
```
All 15 unit and integration tests execute across all subsystems in $<500$ ms.

### 4. Start the Assistant Daemon
```bash
npm start
```
Or for development with auto-reloading:
```bash
npm run dev
```

---

## 💬 Interacting via Telegram

* **Start Session:** Send `/start`
* **Plan Evening:** Tap `[ 🔄 Plan Tonight ]` or send `/plan`
* **Current Task:** Tap `[ 📋 What's Next? ]` or send `/next`
* **Report Overrun:** Tap `[ ⚠️ Slipped/Late ]` or click `[ ⏳ +15m Slip ]` on any task card
* **Track Submissions:** Send `/submissions`
* **View Habits & Multipliers:** Send `/habits`
* **Natural Language:**
  * *"I have an OS lab submission due this Friday, needs 6 pages handwritten and code printout"*
  * *"I didn't do the theory assignment tonight"*
  * *"I just ate dinner"*
  * *"Split task Computer Networks"*

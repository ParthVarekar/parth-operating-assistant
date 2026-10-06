# 🚀 Deploying Personal AI Operating Assistant to Render (24/7 Free Cloud)

This guide walks you through deploying your Assistant to **Render** so that it runs continuously in the cloud—even when your laptop is turned off or offline.

---

## 🌟 What You Get on Render

1. **24/7 Cloud Daemon:** Telegram bot long-polling, Discord auto-broadcasting, proactive 15s scheduler heartbeat, and college circular parsers run non-stop.
2. **Hanzo-Styled Web GUI & Dashboard:** Access your interactive dashboard anywhere (phone, tablet, laptop) styled after `https://hanzo.framer.website/#work`.
3. **Integrated REST API & Health Checks:** `/health` endpoint for Render zero-downtime deployment and uptime monitors.

---

## 📋 Prerequisites

- A free account on [Render](https://render.com).
- Your GitHub repository containing this codebase (`ParthVarekar/...`).

---

## 🛠️ Step-by-Step Deployment

### Step 1: Push Code to GitHub

Commit and push all changes to your GitHub repository:
```bash
git add .
git commit -m "feat(deploy): add render cloud configuration and hanzo web dashboard"
git push origin main
```

---

### Step 2: Create a New Web Service on Render

1. Log in to [dashboard.render.com](https://dashboard.render.com).
2. Click **New +** in the top navigation bar and select **Web Service**.
3. Choose **Build and deploy from a Git repository** and connect your GitHub repository.
4. Configure the service settings:
   - **Name:** `parth-operating-assistant` (or your preferred name)
   - **Region:** `Singapore` (lowest latency to Mumbai/India)
   - **Branch:** `main`
   - **Root Directory:** *(leave blank)*
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free` ($0/month)

---

### Step 3: Configure Environment Variables

Under the **Environment Variables** section on Render, add the following keys from your local `.env`:

| Variable Key | Recommended Value | Notes |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Production mode |
| `PORT` | `10000` | Render assigns this automatically |
| `TELEGRAM_BOT_TOKEN` | `<your-bot-token>` | From BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | `<your-telegram-id>` | Restricts bot commands to you |
| `DISCORD_WEBHOOK_URL` | `<your-discord-webhook>` | Permanent Discord broadcast channel |
| `AI_PROVIDER` | `gemini` | Gemini 2.0 Flash |
| `AI_API_KEY` | `<your-gemini-key>` | Google AI Studio key |
| `AI_MODEL` | `gemini-2.0-flash` | Ultra-fast model |
| `DATABASE_PATH` | `./data/assistant.db` | Embedded SQLite database |
| `GITHUB_USERNAME` | `ParthVarekar` | Commit tracker username |
| `USER_DINNER_TIME` | `21:30` | 9:30 PM Dinner anchor |
| `USER_SLEEP_TIME` | `04:30` | 4:30 AM Sleep anchor |
| `USER_DEEP_WORK_START` | `23:00` | 11:00 PM Night sprint anchor |
| `USER_COLLEGE_RETURN_TIME`| `19:30` | 7:30 PM Commute return |

---

### Step 4: Health Check Configuration

Under **Advanced Settings**:
- **Health Check Path:** `/health`

Render will ping `/health` every 10 seconds to verify your assistant is healthy before routing live traffic.

---

### Step 5: Click "Create Web Service"

Render will build and start your service. In ~2 minutes, your service will display:
```
==> Your service is live 🎉
==> Available at: https://parth-operating-assistant.onrender.com
```

---

## ⚡ Pro-Tip: Keeping Free Tier Awake 24/7 (Preventing Sleep)

Render's free tier spins down web services after 15 minutes of inactivity. To keep your assistant active **24/7/365 with 0 sleep**:

1. Sign up for a free monitor at [UptimeRobot](https://uptimerobot.com) or [cron-job.org](https://cron-job.org).
2. Add a new **HTTP(s) Monitor**:
   - **URL:** `https://parth-operating-assistant.onrender.com/health`
   - **Monitoring Interval:** Every `5 minutes` or `10 minutes`.
3. That's it! The recurring ping keeps the service warm and responsive around the clock at **$0 cost**.

---

## 📱 Adding Dashboard to Your Phone Home Screen

1. Open `https://parth-operating-assistant.onrender.com` in Chrome or Safari on your phone.
2. Tap the browser menu (`⋮` or Share icon) -> **Add to Home screen**.
3. Now you have a native-feeling app icon on your phone that opens your Hanzo-styled Operating System in full-screen anytime!

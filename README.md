# 🤖 Tony Stark — Discord AI Bot

A production-ready Discord bot that listens for mentions, forwards the message to an
[n8n](https://n8n.io) AI Agent webhook, and replies in Discord with the AI's response.

Supports **English, Khasi, and Hinglish** (language handling is done by your n8n AI Agent).

```
User:  @TonyStark hello
Bot:   Hey! Tony Stark here — how can I help you today? 🦾
```

---

## ✨ Features

- Detects mentions of the bot and **ignores other bots** (no loops)
- Reads message content via the `MessageContent` intent
- Replies in the **same channel** (as a threaded reply)
- **Typing indicator** stays alive while the AI thinks
- **Webhook retries** with exponential backoff + jitter
- **Per-user rate limiting** (sliding window)
- **Graceful error handling** — users always get a friendly message
- **Structured logging** with ISO timestamps
- Automatically **chunks long replies** to respect Discord's 2000-char limit
- Clean shutdown on `SIGINT` / `SIGTERM` (Railway-friendly)

---

## 📁 Project Structure

```
TONY STARK/
├── index.js          # Main bot logic (Discord client, n8n integration, retries)
├── package.json      # Dependencies and scripts
├── .env              # Your real secrets (git-ignored — never commit)
├── .env.example      # Template for environment variables
├── .gitignore        # Keeps node_modules and .env out of git
└── README.md         # This file
```

---

## 🔧 Prerequisites

- [Node.js](https://nodejs.org) **18 or newer** (`node -v` to check)
- A Discord application + bot token ([Developer Portal](https://discord.com/developers/applications))
- An n8n workflow with a **Webhook** node and a **Respond to Webhook** node

---

## 🔑 Environment Variables

| Variable             | Required | Description                                                        |
| -------------------- | :------: | ------------------------------------------------------------------ |
| `DISCORD_TOKEN`      |   ✅     | Your Discord bot token                                             |
| `N8N_WEBHOOK_URL`    |   ✅     | The n8n webhook URL that returns `{ "reply": "..." }`              |
| `CLIENT_ID`          |   ➖     | Discord application ID (used for the invite link / logging)        |
| `WEBHOOK_TIMEOUT_MS` |   ➖     | Webhook timeout in ms (default `30000`)                            |
| `WEBHOOK_MAX_RETRIES`|   ➖     | Retry attempts for failed webhook calls (default `3`)              |
| `RATE_LIMIT_MAX`     |   ➖     | Max messages per user per window (default `5`)                     |
| `RATE_LIMIT_WINDOW_MS`|  ➖     | Rate-limit window in ms (default `15000`)                          |
| `DEBUG`              |   ➖     | Set to `true` for verbose logs                                     |

---

## 🚀 Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Create your .env from the template (skip if you already have one)
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env

# 3. Fill in DISCORD_TOKEN and N8N_WEBHOOK_URL in .env

# 4. Start the bot
npm start

# Or with auto-reload while developing:
npm run dev
```

You should see:

```
2026-06-03T12:00:00.000Z [INFO] Starting Tony Stark…
2026-06-03T12:00:01.000Z [INFO] ✅ Tony Stark is online as TonyStark#0001 (id: …)
```

> **Important:** In the [Discord Developer Portal](https://discord.com/developers/applications)
> → your app → **Bot**, enable the **MESSAGE CONTENT INTENT** toggle. Without it the bot
> cannot read message text.

---

## 🔌 Discord Setup (Intents & Invite)

1. Go to the **Discord Developer Portal** → your application → **Bot**.
2. Under **Privileged Gateway Intents**, enable **MESSAGE CONTENT INTENT**.
   (The code requests `Guilds`, `GuildMessages`, and `MessageContent`.)
3. Invite the bot using a link like (replace `CLIENT_ID`):

   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=274877975552&scope=bot%20applications.commands
   ```

   The bot also prints a ready-to-use invite link in the console on startup if `CLIENT_ID` is set.

---

## 🧠 n8n Integration

The bot sends a `POST` to `N8N_WEBHOOK_URL` with this JSON payload:

```json
{
  "message": "user message (mention stripped)",
  "userId": "discord user id",
  "username": "discord username",
  "channelId": "discord channel id"
}
```

It expects this JSON back:

```json
{
  "reply": "AI response"
}
```

> The bot is forgiving about the response shape: it also accepts an array
> `[{ "reply": "..." }]`, or `output` / `text` / `message` keys, or a raw string.

### Suggested n8n workflow

```
Webhook (POST /discord-bot-webhook)
   → AI Agent / LLM node  (system prompt: "You are Tony Stark. Reply in the
                            user's language — English, Khasi, or Hinglish.")
   → Respond to Webhook   (Response Body: { "reply": "{{ $json.output }}" })
```

Make sure the Webhook node's **Respond** option is set to **"Using 'Respond to Webhook' node"**,
and that the final node returns a `reply` field.

---

## 🐙 GitHub — Push the Project

From the `TONY STARK` folder:

```bash
# Initialise the repository
git init
git add .
git commit -m "Initial commit: Tony Stark Discord AI bot"

# Create the repo on GitHub first, then connect it (HTTPS example):
git branch -M main
git remote add origin https://github.com/<your-username>/tony-stark-discord-bot.git
git push -u origin main
```

> ✅ `.gitignore` already excludes `.env` and `node_modules`, so your token stays private.
> If you prefer the GitHub CLI: `gh repo create tony-stark-discord-bot --source=. --private --push`.

---

## 🚂 Railway — Deploy to Production

### A. Set up the project

1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. Click **New Project → Deploy from GitHub repo**.
3. Select your `tony-stark-discord-bot` repository and authorize Railway.
4. Railway auto-detects Node.js and runs `npm install` then `npm start`.

### B. Add environment variables

In your Railway project → **Variables**, add:

| Key               | Value                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| `DISCORD_TOKEN`   | *your Discord bot token*                                              |
| `N8N_WEBHOOK_URL` | `https://banshanborwellkshiar.app.n8n.cloud/webhook/discord-bot-webhook` |
| `CLIENT_ID`       | *your Discord application ID*                                         |

> You can paste them in **Raw Editor** mode using the same `KEY=VALUE` format as `.env`.

### C. Deploy

- Railway deploys automatically on every `git push` to `main`.
- To deploy manually: project → **Deployments → Deploy** (or **Redeploy** the latest).
- This bot is a **worker** (no web server / port needed). Railway keeps it running 24/7.

### D. Restart the bot

- **Railway dashboard:** project → **Deployments → ⋮ (kebab menu) → Restart**.
- **Via redeploy:** click **Redeploy** on the latest deployment.
- **Railway CLI:**

  ```bash
  npm i -g @railway/cli
  railway login
  railway link            # select your project
  railway up              # deploy current folder
  railway logs            # stream live logs
  railway restart         # restart the running service
  ```

---

## 🧪 Test It

1. Make sure the bot shows as **online** in your server.
2. In any channel the bot can see, type: `@TonyStark hello`
3. Watch the typing indicator, then the AI reply appears.
4. Check the console / `railway logs` for structured log output.

---

## 🛠️ Troubleshooting

| Symptom                                   | Fix                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Bot online but never replies              | Enable **MESSAGE CONTENT INTENT** in the Developer Portal.                 |
| `Missing required environment variable`   | Set `DISCORD_TOKEN` and `N8N_WEBHOOK_URL` in `.env` / Railway Variables.   |
| `Failed to log in to Discord`             | Token is wrong or was reset — regenerate it and update the variable.       |
| Replies are empty / "didn't get response" | Your n8n `Respond to Webhook` node isn't returning a `reply` field.        |
| Webhook timeouts                          | Increase `WEBHOOK_TIMEOUT_MS`; check the n8n workflow runs within budget.  |

---

## 📜 License

MIT — do whatever you like. Built with [discord.js](https://discord.js.org) + [n8n](https://n8n.io).

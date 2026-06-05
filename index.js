'use strict';

/**
 * Tony Stark — Discord AI Bot
 * --------------------------------------------------------------------------
 * Flow:
 *   1. A user mentions the bot:  @TonyStark hello
 *   2. The bot reads the message and shows a typing indicator.
 *   3. The message is forwarded to an n8n webhook (AI Agent).
 *   4. n8n replies with { "reply": "..." }.
 *   5. The bot posts that reply back in the same Discord channel.
 *
 * Production features: structured logging, graceful error handling,
 * webhook retries with exponential backoff, per-user rate limiting,
 * request timeouts, message chunking, and clean shutdown handling.
 */

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionsBitField,
} = require('discord.js');
const axios = require('axios');
const { handleTournamentCommand, isTournamentCommand } = require('./tournament');
const { handleAdminCommand, isAdminCommand } = require('./admin');
const { handleTeachCommand, isTeachCommand } = require('./teach');
const { getImageAttachment, describeImage } = require('./vision');
const { handleImageCommand, isImageCommand } = require('./image');
const { isDocCommand, handleDocCommand } = require('./doc');
const { handleApprovalReaction } = require('./autolearn');
const { retrieve, buildContext, logConversation } = require('./rag');
const config = require('./config');

// ---------------------------------------------------------------------------
// Configuration & environment validation
// ---------------------------------------------------------------------------

const CONFIG = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL,
  CLIENT_ID: process.env.CLIENT_ID, // optional, used for invite link / logging

  // Optional: restrict Tony to members who have this role (by name). Admins
  // are always allowed. Leave unset to let everyone use Tony.
  TONY_ALLOWED_ROLE: process.env.TONY_ALLOWED_ROLE,

  // Webhook behaviour
  WEBHOOK_TIMEOUT_MS: parseInt(process.env.WEBHOOK_TIMEOUT_MS || '30000', 10),
  WEBHOOK_MAX_RETRIES: parseInt(process.env.WEBHOOK_MAX_RETRIES || '3', 10),
  WEBHOOK_RETRY_BASE_MS: parseInt(process.env.WEBHOOK_RETRY_BASE_MS || '800', 10),

  // Per-user rate limiting (sliding window)
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '15000', 10),
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '5', 10),

  // Discord hard limit for a single message
  DISCORD_MAX_MESSAGE_LENGTH: 2000,
};

// ---------------------------------------------------------------------------
// Logger — tiny structured logger with ISO timestamps
// ---------------------------------------------------------------------------

const log = {
  info: (msg, meta) => write('INFO', msg, meta),
  warn: (msg, meta) => write('WARN', msg, meta),
  error: (msg, meta) => write('ERROR', msg, meta),
  debug: (msg, meta) => {
    if (process.env.DEBUG === 'true') write('DEBUG', msg, meta);
  },
};

function write(level, msg, meta) {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  const target = level === 'ERROR' ? console.error : console.log;
  if (meta !== undefined) {
    target(line, safeMeta(meta));
  } else {
    target(line);
  }
}

function safeMeta(meta) {
  try {
    return typeof meta === 'string' ? meta : JSON.stringify(meta);
  } catch {
    return '[unserialisable meta]';
  }
}

// ---------------------------------------------------------------------------
// Validate required environment variables before doing anything else
// ---------------------------------------------------------------------------

function validateEnv() {
  const missing = [];
  if (!CONFIG.DISCORD_TOKEN) missing.push('DISCORD_TOKEN');
  if (!CONFIG.N8N_WEBHOOK_URL) missing.push('N8N_WEBHOOK_URL');

  if (missing.length > 0) {
    log.error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Set them in your .env file (local) or in Railway → Variables (production).'
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Rate limiter — simple per-user sliding window stored in memory
// ---------------------------------------------------------------------------

/** @type {Map<string, number[]>} userId -> array of request timestamps (ms) */
const rateLimitStore = new Map();

function isRateLimited(userId) {
  const now = Date.now();
  const windowStart = now - CONFIG.RATE_LIMIT_WINDOW_MS;

  const hits = (rateLimitStore.get(userId) || []).filter((ts) => ts > windowStart);
  hits.push(now);
  rateLimitStore.set(userId, hits);

  return hits.length > CONFIG.RATE_LIMIT_MAX;
}

// Periodically clean up stale rate-limit entries so the Map cannot grow forever.
setInterval(() => {
  const windowStart = Date.now() - CONFIG.RATE_LIMIT_WINDOW_MS;
  for (const [userId, hits] of rateLimitStore.entries()) {
    const fresh = hits.filter((ts) => ts > windowStart);
    if (fresh.length === 0) rateLimitStore.delete(userId);
    else rateLimitStore.set(userId, fresh);
  }
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Access control — optionally restrict Tony to members with a specific role
// ---------------------------------------------------------------------------

const deniedAt = new Map(); // userId -> last "you can't use me" notice (ms)

// The lock role can be set by command (per-guild, in config.json) or via the
// TONY_ALLOWED_ROLE env var as a fallback default.
function getAllowedRoleName(message) {
  return (
    (message.guild && config.getAllowedRole(message.guild.id)) ||
    CONFIG.TONY_ALLOWED_ROLE ||
    null
  );
}

function canUseTony(message) {
  const allowed = getAllowedRoleName(message);
  if (!allowed) return true; // no lock set (default)
  if (!message.guild) return true; // DMs aren't gated
  const member = message.member;
  if (!member) return false;
  if (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  ) {
    return true; // admins/mods always allowed
  }
  const allowedLc = allowed.trim().toLowerCase();
  return member.roles.cache.some((r) => r.name.toLowerCase() === allowedLc);
}

function notifyDenied(message) {
  const now = Date.now();
  if (now - (deniedAt.get(message.author.id) || 0) < 300_000) return; // once / 5 min
  deniedAt.set(message.author.id, now);
  const allowed = getAllowedRoleName(message);
  message
    .reply(`🔒 You need the **${allowed}** role to use me. Ask an admin.`)
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Info channel — read a #info / #rules channel as live grounding
// ---------------------------------------------------------------------------

// Matches "info"/"rules"/etc. anywhere in the name (e.g. "server-info", "📌-rules").
const INFO_NAME_RE = /\b(?:info|information|rules|about|guide|details)\b/i;
const infoCache = new Map(); // channelId -> { text, name, ts }

async function getInfoChannelText(message) {
  // Strict: only read an info channel that is in the SAME category as the
  // current channel. No category, or no info channel in it -> no grounding.
  if (!message.guild || !message.channel?.parentId) return null;
  const infoCh = message.guild.channels.cache.find(
    (c) =>
      typeof c.isTextBased === 'function' &&
      c.isTextBased() &&
      c.parentId === message.channel.parentId &&
      INFO_NAME_RE.test(c.name)
  );
  if (!infoCh) return null;

  const cached = infoCache.get(infoCh.id);
  if (cached && Date.now() - cached.ts < 60_000) return cached.text ? cached : null;

  try {
    const msgs = await infoCh.messages.fetch({ limit: 20 });
    const text = [...msgs.values()]
      .reverse()
      .filter((m) => !m.author.bot && m.content && m.content.trim())
      .map((m) => m.content.trim())
      .join('\n')
      .slice(0, 2500);
    const entry = { text, name: infoCh.name, ts: Date.now() };
    infoCache.set(infoCh.id, entry);
    if (text) log.info(`Grounding in #${infoCh.name} (${text.length} chars).`);
    return text ? entry : null;
  } catch (err) {
    log.warn(`Couldn't read info channel #${infoCh.name}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// n8n webhook caller — POST with timeout + exponential-backoff retries
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends the payload to the n8n webhook and returns the AI reply text.
 * Retries on network errors and 5xx / 429 responses with exponential backoff.
 *
 * @param {{ message: string, userId: string, username: string, channelId: string }} payload
 * @returns {Promise<string>} the AI reply text
 */
async function callN8nWebhook(payload) {
  let lastError;

  for (let attempt = 1; attempt <= CONFIG.WEBHOOK_MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(CONFIG.N8N_WEBHOOK_URL, payload, {
        timeout: CONFIG.WEBHOOK_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
        // Treat only <500 as resolved; 5xx falls through to the retry path.
        validateStatus: (status) => status >= 200 && status < 500,
      });

      if (response.status === 429 || response.status >= 500) {
        throw new HttpRetryableError(`n8n responded with status ${response.status}`);
      }
      if (response.status >= 400) {
        // 4xx (other than 429) is a client error — do not retry.
        throw new Error(`n8n responded with status ${response.status}`);
      }

      return extractReply(response.data);
    } catch (err) {
      lastError = err;

      const retryable = isRetryableError(err);
      log.warn(
        `Webhook attempt ${attempt}/${CONFIG.WEBHOOK_MAX_RETRIES} failed` +
          `${retryable ? '' : ' (non-retryable)'}: ${err.message}`
      );

      if (!retryable || attempt === CONFIG.WEBHOOK_MAX_RETRIES) break;

      // Exponential backoff with jitter: base * 2^(attempt-1) + random(0..250)
      const backoff =
        CONFIG.WEBHOOK_RETRY_BASE_MS * 2 ** (attempt - 1) +
        Math.floor(Math.random() * 250);
      await sleep(backoff);
    }
  }

  throw lastError || new Error('Webhook call failed for an unknown reason.');
}

class HttpRetryableError extends Error {}

function isRetryableError(err) {
  if (err instanceof HttpRetryableError) return true;
  // axios network/timeout errors have no response object.
  if (err.code === 'ECONNABORTED') return true; // timeout
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return true;
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return true;
  if (!err.response) return true; // generic network failure
  return false;
}

/**
 * Normalises the n8n response into a plain reply string.
 * Accepts: { reply: "..." }, [{ reply: "..." }], or a raw string.
 */
function extractReply(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data.trim();

  // n8n "Respond to Webhook" sometimes wraps output in an array.
  const obj = Array.isArray(data) ? data[0] : data;
  if (obj && typeof obj === 'object') {
    const reply = obj.reply ?? obj.output ?? obj.text ?? obj.message;
    if (typeof reply === 'string') return reply.trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

/**
 * Strips every mention of the bot from the message content so the AI sees
 * only the user's actual words (e.g. "@TonyStark hello" -> "hello").
 */
function cleanContent(message, botUserId) {
  return message.content
    .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits long text into Discord-safe chunks (<= 2000 chars), preferring newlines. */
function chunkMessage(text, max = CONFIG.DISCORD_MAX_MESSAGE_LENGTH) {
  if (text.length <= max) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > max) {
    let slice = remaining.slice(0, max);
    // Try to break on the last newline or space for cleaner splits.
    const breakAt = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
    if (breakAt > max * 0.5) slice = slice.slice(0, breakAt);
    chunks.push(slice.trim());
    remaining = remaining.slice(slice.length);
  }
  if (remaining.trim().length > 0) chunks.push(remaining.trim());
  return chunks;
}

/** Sends one or more messages back to the channel, respecting the 2000-char limit. */
async function replyInChannel(message, text) {
  const chunks = chunkMessage(text);
  // Reply to the original message for the first chunk, then plain sends after.
  await message.reply({
    content: chunks[0],
    allowedMentions: { repliedUser: true },
  });
  for (let i = 1; i < chunks.length; i++) {
    await message.channel.send(chunks[i]);
  }
}

/**
 * Keeps the "Bot is typing…" indicator alive while we wait for the AI.
 * Discord typing lasts ~10s, so we refresh it on an interval and stop on cleanup.
 */
function startTyping(channel) {
  const send = () => channel.sendTyping().catch(() => {});
  send();
  const interval = setInterval(send, 8000);
  return () => clearInterval(interval);
}

// ---------------------------------------------------------------------------
// Discord client
// ---------------------------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

client.once(Events.ClientReady, (c) => {
  log.info(`✅ Tony Stark is online as ${c.user.tag} (id: ${c.user.id})`);
  if (CONFIG.CLIENT_ID) {
    const invite =
      `https://discord.com/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}` +
      '&permissions=274877975552&scope=bot%20applications.commands';
    log.info(`Invite link: ${invite}`);
  }
  c.user.setActivity('mentions • @TonyStark', { type: 0 /* Playing */ });
});

client.on(Events.MessageCreate, async (message) => {
  try {
    // 1. Ignore bots (and our own messages) to prevent loops.
    if (message.author.bot) return;

    // 2. Only respond when the bot is actually mentioned (not @everyone/@here).
    if (!message.mentions.has(client.user) || message.mentions.everyone) return;

    // 2b. Access control — if a role is configured, only those members (and
    // admins) may use Tony. Prevents misuse of his powerful commands.
    if (!canUseTony(message)) {
      notifyDenied(message);
      return;
    }

    // 3. Extract the real user message.
    const userText = cleanContent(message, client.user.id);

    // 3a. Vision: if the message includes an image, look at it (Groq Llama 4).
    const imageAtt = getImageAttachment(message);
    if (imageAtt) {
      const stopTyping = startTyping(message.channel);
      try {
        const answer = await describeImage(imageAtt, userText);
        await replyInChannel(message, answer || "Hmm — I couldn't make out that image.");
        log.info(`Described an image for ${message.author.tag}.`);
      } catch (err) {
        log.error(`Vision failed: ${err.message}`);
        await message.reply("⚠️ I couldn't read that image right now. Try again in a bit.");
      } finally {
        stopTyping();
      }
      return;
    }

    // 3a2. Knowledge upload: an admin attaches a .md/.txt to teach this channel.
    if (isDocCommand(message, userText)) {
      await handleDocCommand(message, userText);
      return;
    }

    if (!userText) {
      await message.reply(
        "👋 Hi, I'm Tony Stark. Mention me with a message and I'll respond — " +
          'English, Khasi, or Hinglish all work.'
      );
      return;
    }

    // 3b. Tournament commands are handled in code (not by the AI) so that
    // player lists and brackets are always exact and reliable.
    if (isTournamentCommand(userText)) {
      if (!message.guild) {
        await message.reply('🏆 Tournaments only work inside a server channel.');
        return;
      }
      await handleTournamentCommand(message, userText);
      return;
    }

    // 3c. Admin actions (create channel/voice/category/role) — handled in code.
    if (isAdminCommand(userText)) {
      await handleAdminCommand(message, userText);
      return;
    }

    // 3d. Community "teach Tony Khasi" — adds real Khasi to the knowledge base.
    if (isTeachCommand(userText)) {
      await handleTeachCommand(message, userText);
      return;
    }

    // 3e. Image generation (Cloudflare Workers AI) — handled in code.
    if (isImageCommand(userText)) {
      await handleImageCommand(message, userText);
      return;
    }

    // 4. Rate limit per user.
    if (isRateLimited(message.author.id)) {
      log.warn(`Rate limited user ${message.author.tag} (${message.author.id})`);
      await message.reply(
        "⏳ Easy there — you're sending messages too fast. Give me a few seconds."
      );
      return;
    }

    log.info(
      `Message from ${message.author.tag} in #${message.channel?.name ?? message.channelId}: "${userText}"`
    );

    // 5. Show typing while we call the AI.
    const stopTyping = startTyping(message.channel);

    try {
      // RAG: pull relevant bilingual Khasi knowledge and prepend it as context.
      // Returns [] (no change) when RAG isn't configured, so this is always safe.
      const docs = await retrieve(userText, {
        k: 5,
        scopes: [message.channel?.parentId, message.channelId].filter(Boolean),
      });
      const context = buildContext(docs);

      // Ground replies in, in priority order:
      //  (a) the #info / #rules channel's content (read live, no file needed),
      //  (b) the channel's Topic/Description,
      //  (c) any uploaded category .md.
      const info = await getInfoChannelText(message);
      const channelInfo = (message.channel?.topic || '').trim();
      const knowledgeParts = [];
      if (info) knowledgeParts.push(`SERVER INFO (from #${info.name} channel):\n${info.text}`);
      if (channelInfo) knowledgeParts.push(`THIS CHANNEL'S INFO / RULES:\n${channelInfo}`);
      if (context) knowledgeParts.push(`CATEGORY GUIDE:\n${context}`);
      const knowledge = knowledgeParts.join('\n\n');

      const messageForAi = knowledge
        ? `You are replying inside a specific Discord channel/category. Below is the INFO and ` +
          `RULES for it — follow the rules and answer using this information. If the user asks ` +
          `about events, scrims, tournaments, schedules, or rules that this info does NOT cover, ` +
          `say you don't have that info here — do NOT make up details. Reply in the user's language.\n\n` +
          `${knowledge}\n\n=== USER MESSAGE ===\n${userText}`
        : userText;

      const payload = {
        message: messageForAi,
        userId: message.author.id,
        username: message.author.username,
        channelId: message.channelId,
      };

      const reply = await callN8nWebhook(payload);

      if (!reply) {
        log.warn('n8n returned an empty reply.', { payload });
        await message.reply(
          "🤔 I didn't get a response from my brain just now. Try again in a moment."
        );
        return;
      }

      await replyInChannel(message, reply);
      log.info(`Replied to ${message.author.tag} (${reply.length} chars).`);

      // Log the turn for analytics + a future Khasi fine-tuning dataset (no-op if RAG off).
      logConversation({
        userId: message.author.id,
        username: message.author.username,
        channelId: message.channelId,
        userMessage: userText,
        retrievedIds: docs.map((d) => d.id),
        reply,
      });
    } finally {
      stopTyping();
    }
  } catch (err) {
    log.error(`Failed to handle message: ${err.message}`, { stack: err.stack });
    // Best-effort user-facing error; never throw out of the handler.
    try {
      await message.reply(
        '⚠️ Something went wrong on my end. Please try again shortly.'
      );
    } catch (replyErr) {
      log.error(`Could not send error reply: ${replyErr.message}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Client-level error handling & graceful shutdown
// ---------------------------------------------------------------------------

// 👍 auto-learn: approving one of Tony's replies saves it to the knowledge base.
client.on(Events.MessageReactionAdd, (reaction, user) => {
  handleApprovalReaction(reaction, user, client);
});

client.on(Events.Error, (err) => log.error(`Discord client error: ${err.message}`));
client.on(Events.Warn, (info) => log.warn(`Discord warning: ${info}`));

process.on('unhandledRejection', (reason) => {
  log.error(`Unhandled promise rejection: ${reason}`);
});
process.on('uncaughtException', (err) => {
  log.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
});

async function shutdown(signal) {
  log.info(`Received ${signal}. Shutting down gracefully…`);
  try {
    await client.destroy();
  } catch (err) {
    log.error(`Error during shutdown: ${err.message}`);
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

validateEnv();
log.info('Starting Tony Stark…');
client.login(CONFIG.DISCORD_TOKEN).catch((err) => {
  log.error(`Failed to log in to Discord: ${err.message}`);
  process.exit(1);
});

'use strict';

/**
 * Image generation for the Tony Stark bot via Cloudflare Workers AI
 * (FLUX-1-schnell). Free tier, reliable.
 *
 * Needs two env vars:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN   (token with "Workers AI" permission)
 *
 * Usage in Discord:
 *   @TonyStark image <description>
 *   @TonyStark draw  <description>
 */

const { AttachmentBuilder } = require('discord.js');

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const TRIGGERS = ['image', 'draw'];

const IMAGE_ON = Boolean(
  process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN
);

/** True when the (mention-stripped) text is an image command. */
function isImageCommand(text) {
  const t = text.trim().toLowerCase();
  return TRIGGERS.some((w) => t === w || t.startsWith(w + ' '));
}

function extractPrompt(text) {
  return text.trim().split(/\s+/).slice(1).join(' ').trim();
}

/** Generates an image and returns a JPEG Buffer. */
async function generateImage(prompt) {
  const acc = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${MODEL}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, steps: 4 }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`cloudflare ${res.status}: ${t.slice(0, 200)}`);
  }

  const json = await res.json();
  const b64 = json?.result?.image;
  if (!b64) throw new Error('no image returned by Cloudflare');
  return Buffer.from(b64, 'base64'); // FLUX schnell returns a base64 JPEG
}

/**
 * @param {import('discord.js').Message} message
 * @param {string} text - message with the bot mention already removed
 */
async function handleImageCommand(message, text) {
  if (!IMAGE_ON) {
    await message.reply(
      "🎨 Image generation isn't set up yet (missing Cloudflare keys)."
    );
    return;
  }

  const prompt = extractPrompt(text);
  if (!prompt) {
    await message.reply(
      '🎨 Tell me what to draw — e.g. `@TonyStark image a red Iron Man suit flying over Mumbai`'
    );
    return;
  }

  const typing = setInterval(
    () => message.channel.sendTyping().catch(() => {}),
    8000
  );
  message.channel.sendTyping().catch(() => {});

  try {
    const buffer = await generateImage(prompt);
    const file = new AttachmentBuilder(buffer, { name: 'tony-art.jpg' });
    await message.reply({
      content: `🎨 **"${prompt}"** — fresh out of the workshop:`,
      files: [file],
    });
  } catch (err) {
    console.error('Image generation failed:', err.message);
    await message.reply(
      '⚠️ My image generator hiccuped. Give it another shot in a moment.'
    );
  } finally {
    clearInterval(typing);
  }
}

module.exports = { isImageCommand, handleImageCommand };

'use strict';

/**
 * Image understanding ("read images") for the Tony Stark bot.
 *
 * Uses Groq's multimodal Llama 4 Scout (reuses your GROQ_API_KEY). When a user
 * posts an image and mentions Tony, the bot downloads it, sends it to Groq with
 * the user's question, and replies in Tony's voice.
 */

const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

const SYSTEM_PROMPT =
  'You are Tony Stark (Iron Man): witty, confident, helpful. You are looking at ' +
  "an image a user shared in Discord. Answer their question about it. Reply in the " +
  "user's language (English, Hinglish, or Khasi). Keep it short (1-3 sentences) with " +
  'light Tony Stark flair.';

/** Returns the first image attachment on a message, or null. */
function getImageAttachment(message) {
  if (!message.attachments || message.attachments.size === 0) return null;
  return (
    message.attachments.find(
      (a) =>
        (a.contentType && a.contentType.startsWith('image/')) ||
        /\.(png|jpe?g|gif|webp)$/i.test(a.name || '')
    ) || null
  );
}

/**
 * Downloads an image and asks Groq's vision model about it.
 * @param {import('discord.js').Attachment} attachment
 * @param {string} question - the user's text (may be empty)
 * @returns {Promise<string>} Tony's answer
 */
async function describeImage(attachment, question) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set');

  // Prefer Discord's media proxy with a size cap, so large phone photos get
  // shrunk server-side and stay under the vision API's request-size limit.
  let fetchUrl = attachment.url;
  if (attachment.proxyURL) {
    const sep = attachment.proxyURL.includes('?') ? '&' : '?';
    fetchUrl = `${attachment.proxyURL}${sep}width=768&height=768`;
  }

  const imgRes = await fetch(fetchUrl, { signal: AbortSignal.timeout(20000) });
  if (!imgRes.ok) throw new Error(`couldn't fetch image (${imgRes.status})`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const mime =
    imgRes.headers.get('content-type') || attachment.contentType || 'image/png';
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

  const body = {
    model: VISION_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: question && question.trim() ? question : 'What is in this image?' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.6,
    max_tokens: 500,
  };

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`vision request failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || '';
}

module.exports = { getImageAttachment, describeImage };

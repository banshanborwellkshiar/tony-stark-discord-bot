'use strict';

/**
 * Channel/category knowledge from uploaded .md files.
 *
 * An admin/organizer uploads a markdown (or .txt) file in a channel and says
 * "learn". Tony chunks it, embeds it, and stores it scoped to that channel's
 * CATEGORY (so it applies across the whole tournament category) — or the
 * channel itself if it has no category. He then answers questions there using
 * that knowledge, grounded (no made-up details).
 *
 * Admins/organizers only.
 */

const { PermissionsBitField } = require('discord.js');
const { insertKnowledge, RAG_ON } = require('./rag');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isAdmin(member) {
  if (!member) return false;
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

/** Returns the first .md/.txt/text attachment on the message, or null. */
function getDocAttachment(message) {
  if (!message.attachments || message.attachments.size === 0) return null;
  return (
    message.attachments.find(
      (a) =>
        /\.(md|markdown|txt)$/i.test(a.name || '') ||
        (a.contentType && a.contentType.startsWith('text/'))
    ) || null
  );
}

/** True when the message has a doc attachment + a "learn"-style instruction. */
function isDocCommand(message, text) {
  if (!getDocAttachment(message)) return false;
  const t = (text || '').trim().toLowerCase();
  return t === '' || /\b(learn|remember|knowledge|study|setup|read)\b/.test(t);
}

/** Splits markdown into ~700-char chunks on blank lines (capped at 40). */
function chunkText(md, maxChars = 700) {
  const blocks = md.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const b of blocks) {
    if (cur && (cur + '\n\n' + b).length > maxChars) {
      chunks.push(cur);
      cur = b;
    } else {
      cur = cur ? `${cur}\n\n${b}` : b;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.slice(0, 40);
}

async function handleDocCommand(message, text) {
  if (!RAG_ON) {
    await message.reply("📚 My knowledge base isn't connected yet.");
    return;
  }
  if (!isAdmin(message.member)) {
    await message.reply('🔒 Only admins/organizers can teach me channel knowledge.');
    return;
  }

  const att = getDocAttachment(message);
  if (!att) {
    await message.reply('Attach a `.md` or `.txt` file along with the word **learn**.');
    return;
  }

  await message.channel.sendTyping().catch(() => {});

  let md;
  try {
    const res = await fetch(att.url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`download ${res.status}`);
    md = await res.text();
  } catch (err) {
    await message.reply(`⚠️ Couldn't read that file: ${err.message}`);
    return;
  }

  const chunks = chunkText(md);
  if (chunks.length === 0) {
    await message.reply('That file looks empty.');
    return;
  }

  // Scope to the category if the channel has one, else the channel itself.
  const scopeId = message.channel.parentId || message.channelId;
  const scopeLabel = message.channel.parentId
    ? `the **${message.channel.parent?.name ?? 'category'}** category`
    : 'this channel';

  let n = 0;
  for (const chunk of chunks) {
    const r = await insertKnowledge({
      khasi: '',
      english: chunk,
      sourceType: 'doc',
      title: att.name,
      guildId: message.guild.id,
      scopeId,
      metadata: { file: att.name, added_by: message.author.id, channel: message.channelId },
    });
    if (r.ok) n++;
    await sleep(800); // pace embeds for the free rate limit
  }

  await message.reply(
    `📚 Learned **${n}** section${n === 1 ? '' : 's'} from \`${att.name}\` for ${scopeLabel}. ` +
      `Ask me about it here and I'll answer from the file — no made-up details.`
  );
}

module.exports = { isDocCommand, handleDocCommand };

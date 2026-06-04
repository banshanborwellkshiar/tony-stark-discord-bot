'use strict';

/**
 * Community "teach Tony Khasi" command.
 *
 * Lets native Khasi speakers add real, natural Khasi straight into the RAG
 * knowledge base. Tony retrieves and copies this Khasi, so the more the
 * community teaches, the better his Khasi gets.
 *
 * Usage:
 *   @TonyStark teach <Khasi message> => <ideal Khasi reply>   (a reply example)
 *   @TonyStark teach <Khasi sentence/fact>                    (a phrase/fact)
 *   @TonyStark unteach <id>                                   (admin: remove an entry)
 */

const { PermissionsBitField } = require('discord.js');
const { insertKnowledge, deleteKnowledge, RAG_ON } = require('./rag');

function isAdmin(member) {
  if (!member) return false;
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

/** True when the (mention-stripped) text is a teach/unteach command. */
function isTeachCommand(text) {
  const t = text.trim().toLowerCase();
  return t === 'teach' || t.startsWith('teach ') || t.startsWith('unteach ');
}

async function handleTeachCommand(message, text) {
  if (!RAG_ON) {
    await message.reply(
      "📚 My knowledge base isn't connected yet, so I can't learn right now."
    );
    return;
  }

  const trimmed = text.trim();

  // ---- unteach <id> (admin moderation) ----
  if (/^unteach\b/i.test(trimmed)) {
    if (!isAdmin(message.member)) {
      await message.reply('🔒 Only admins/mods can remove taught knowledge.');
      return;
    }
    const id = parseInt(trimmed.split(/\s+/)[1], 10);
    if (!id) {
      await message.reply('Usage: `@TonyStark unteach <id>`');
      return;
    }
    const res = await deleteKnowledge(id);
    await message.reply(res.ok ? `🗑️ Forgot entry #${id}.` : `⚠️ ${res.error}`);
    return;
  }

  // ---- teach <content> ----
  const content = trimmed.replace(/^teach\s*/i, '').trim();
  if (!content) {
    await message.reply(
      "📚 Teach me Khasi! Two ways:\n" +
        '• Reply example: `@TonyStark teach <Khasi message> => <ideal Khasi reply>`\n' +
        '• Phrase / fact: `@TonyStark teach <Khasi sentence>`'
    );
    return;
  }

  let khasi;
  let title;
  if (content.includes('=>')) {
    const [msg, reply] = content.split('=>').map((s) => s.trim());
    if (!msg || !reply) {
      await message.reply(
        'Usage: `@TonyStark teach <Khasi message> => <ideal Khasi reply>`'
      );
      return;
    }
    khasi = `User: ${msg}\nTony: ${reply}`;
    title = 'reply example';
  } else {
    khasi = content;
    title = 'phrase';
  }

  await message.channel.sendTyping().catch(() => {});

  const res = await insertKnowledge({
    khasi,
    english: '',
    sourceType: 'community',
    title,
    metadata: {
      taught_by: message.author.id,
      taught_by_name: message.author.username,
    },
  });

  if (res.ok) {
    await message.reply(
      `✅ Khublei! I learned that (entry #${res.id}). I'll start using this Khasi. 🧠`
    );
  } else {
    await message.reply(`⚠️ Couldn't save that: ${res.error}. Try again in a moment.`);
  }
}

module.exports = { isTeachCommand, handleTeachCommand };

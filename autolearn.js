'use strict';

/**
 * Auto-learn: when someone reacts 👍 to one of Tony's replies, the
 * (user message → Tony reply) pair is saved to the RAG knowledge base as an
 * "approved" example. Tony then retrieves and reuses it — so good Khasi replies
 * compound over time, hands-free. Admins can remove bad ones with `unteach`.
 *
 * Safe by design: only replies people explicitly approve get saved.
 */

const { insertKnowledge, RAG_ON } = require('./rag');

const APPROVE_EMOJI = '👍';
const LEARNED_EMOJI = '🧠';

// Avoid saving the same reply twice within a run.
const saved = new Set();

async function handleApprovalReaction(reaction, user, client) {
  try {
    if (!RAG_ON || user.bot) return;

    // Resolve partials (reactions on uncached messages arrive partial).
    if (reaction.partial) await reaction.fetch();
    if (reaction.emoji.name !== APPROVE_EMOJI) return;

    const msg = reaction.message.partial
      ? await reaction.message.fetch()
      : reaction.message;

    // Only learn from Tony's own replies that responded to a user message.
    if (msg.author.id !== client.user.id) return;
    if (!msg.reference?.messageId) return;
    if (saved.has(msg.id)) return;

    const original = await msg.channel.messages
      .fetch(msg.reference.messageId)
      .catch(() => null);
    if (!original) return;

    // Strip the bot mention from the user's original message.
    const userText = original.content
      .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
      .replace(/\s+/g, ' ')
      .trim();
    const tonyReply = (msg.content || '').trim();
    if (!userText || !tonyReply) return;

    const res = await insertKnowledge({
      khasi: `User: ${userText}\nTony: ${tonyReply}`,
      english: '',
      sourceType: 'approved',
      title: 'approved reply',
      metadata: {
        approved_by: user.id,
        approved_by_name: user.username,
        original_author: original.author?.id ?? null,
      },
    });

    if (res.ok) {
      saved.add(msg.id);
      await msg.react(LEARNED_EMOJI).catch(() => {});
      console.log(
        `${new Date().toISOString()} [INFO] Auto-learned approved reply #${res.id} ` +
          `(👍 by ${user.username}).`
      );
    }
  } catch (err) {
    console.error('autolearn error:', err.message);
  }
}

module.exports = { handleApprovalReaction };

'use strict';

/**
 * RAG retrieval for the Tony Stark bot.
 *
 * Embeds the user's question (Google text-embedding-004) and pulls the most
 * relevant bilingual chunks from Supabase via the `match_kb` function. The
 * retrieved Khasi text is then handed to the LLM so it copies correct Khasi
 * instead of guessing.
 *
 * RAG is OPTIONAL and self-disabling: if SUPABASE_URL / a Supabase key /
 * GEMINI_API_KEY are not set, retrieve() simply returns [] and the bot behaves
 * exactly as before. Nothing breaks if RAG isn't configured yet.
 */

const { embed } = require('./embed');

const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

const RAG_ON = Boolean(
  process.env.SUPABASE_URL && SUPABASE_KEY && process.env.GEMINI_API_KEY
);

let supabase = null;
if (RAG_ON) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(process.env.SUPABASE_URL, SUPABASE_KEY);
}

/** Retrieves the top-k bilingual chunks relevant to `query`. Returns [] if RAG is off. */
async function retrieve(query, { k = 5, minSim = 0.5 } = {}) {
  if (!RAG_ON) return [];
  try {
    // Fail fast at query time: 1 attempt. If embeddings throttle, we skip RAG
    // and answer without context rather than making the user wait.
    const query_embedding = await embed(query, 'RETRIEVAL_QUERY', { maxAttempts: 1 });
    const { data, error } = await supabase.rpc('match_kb', {
      query_embedding,
      match_count: k,
    });
    if (error) {
      console.error('match_kb error:', error.message);
      return [];
    }
    return (data || []).filter((d) => d.similarity >= minSim);
  } catch (err) {
    console.error('retrieve failed:', err.message);
    return [];
  }
}

/** Formats retrieved docs into a bilingual context block for the prompt. */
function buildContext(docs) {
  if (!docs || docs.length === 0) return '';
  return docs
    .map(
      (d, i) =>
        `[${i + 1}] (${d.source_type}) sim=${Number(d.similarity).toFixed(2)}\n` +
        `Khasi: ${d.khasi_text}\nEnglish: ${d.english_text}`
    )
    .join('\n\n');
}

/** Logs a conversation turn to Supabase (no-op if RAG is off). Fire-and-forget. */
async function logConversation(c) {
  if (!RAG_ON) return;
  try {
    await supabase.from('conversations').insert({
      user_id: c.userId,
      username: c.username,
      channel_id: c.channelId,
      user_message: c.userMessage,
      retrieved_ids: c.retrievedIds ?? null,
      bot_reply: c.reply,
    });
  } catch (err) {
    console.error('logConversation failed:', err.message);
  }
}

module.exports = { retrieve, buildContext, logConversation, RAG_ON };

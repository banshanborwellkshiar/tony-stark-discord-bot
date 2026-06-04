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
    .map((d, i) => {
      let s =
        `[${i + 1}] (${d.source_type}) sim=${Number(d.similarity).toFixed(2)}\n` +
        `Khasi: ${d.khasi_text}`;
      if (d.english_text && d.english_text.trim()) s += `\nEnglish: ${d.english_text}`;
      return s;
    })
    .join('\n\n');
}

/** Adds a knowledge entry (e.g. community-taught Khasi). Embeds the Khasi text. */
async function insertKnowledge({ khasi, english = '', sourceType = 'community', title = null, metadata = {} }) {
  if (!RAG_ON) return { ok: false, error: 'knowledge base not configured' };
  try {
    const textToEmbed = khasi || english;
    if (!textToEmbed) return { ok: false, error: 'nothing to learn' };
    const embedding = await embed(textToEmbed, 'RETRIEVAL_DOCUMENT', {
      maxAttempts: 3,
      baseDelayMs: 8000,
    });
    const { data, error } = await supabase
      .from('kb_documents')
      .insert({
        source_type: sourceType,
        title,
        khasi_text: khasi || '',
        english_text: english || '',
        metadata,
        embedding,
      })
      .select('id')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Removes a knowledge entry by id (admin moderation). */
async function deleteKnowledge(id) {
  if (!RAG_ON) return { ok: false, error: 'knowledge base not configured' };
  const { error } = await supabase.from('kb_documents').delete().eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
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

module.exports = {
  retrieve,
  buildContext,
  logConversation,
  insertKnowledge,
  deleteKnowledge,
  RAG_ON,
};

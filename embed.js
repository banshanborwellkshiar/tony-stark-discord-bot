'use strict';

/**
 * Text embeddings via Google's `text-embedding-004` (768-dim, multilingual).
 *
 * Free tier, and reuses your existing Gemini API key (GEMINI_API_KEY) — no new
 * signup. 768 dimensions match the `vector(768)` column in Supabase.
 *
 * taskType improves retrieval quality:
 *   - 'RETRIEVAL_DOCUMENT' when embedding stored documents (ingestion)
 *   - 'RETRIEVAL_QUERY'    when embedding a user's question (query time)
 */

const MODEL = 'text-embedding-004';

async function embed(text, taskType = 'RETRIEVAL_QUERY') {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${MODEL}`,
        content: { parts: [{ text }] },
        taskType,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`embedding request failed (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  return json.embedding.values; // array of 768 floats
}

module.exports = { embed };

'use strict';

/**
 * Text embeddings via Gemini `gemini-embedding-001` (multilingual).
 *
 * Output is truncated to 768 dims to match the vector(768) column in Supabase.
 * Reuses your GEMINI_API_KEY. Retries on rate limits (429) and transient 5xx
 * with exponential backoff, since the free embedding tier throttles quickly.
 *
 * taskType: 'RETRIEVAL_DOCUMENT' for stored docs, 'RETRIEVAL_QUERY' for queries.
 */

const MODEL = 'gemini-embedding-001';
const OUTPUT_DIMS = 768; // must match the vector(768) column in Supabase

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// maxAttempts: ingest uses many (slow OK); query time uses 1 (fail fast so the
// bot never hangs — it just answers without RAG context if embeddings throttle).
async function embed(text, taskType = 'RETRIEVAL_QUERY', { maxAttempts = 2, baseDelayMs = 10000 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${key}`;
  const body = JSON.stringify({
    model: `models/${MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: OUTPUT_DIMS,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    // Rate limit / transient server error -> back off and retry.
    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxAttempts) {
        throw new Error(`embedding rate-limited (${res.status}) after ${attempt} attempt(s)`);
      }
      await sleep(attempt * baseDelayMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`embedding request failed (${res.status}): ${await res.text()}`);
    }

    const json = await res.json();
    return json.embedding.values; // 768 floats
  }
}

module.exports = { embed };

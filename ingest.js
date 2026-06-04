'use strict';

/**
 * One-time ingestion: load bilingual Khasi/English knowledge from khasi_kb.json,
 * chunk it, embed the English text (robust cross-lingual retrieval), and store
 * everything in Supabase `kb_documents`.
 *
 * Run on your PC:
 *   1. Fill in khasi_kb.json with your real Khasi + English content.
 *   2. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY in .env
 *   3. node ingest.js
 */

require('dotenv').config();
const fs = require('node:fs');
const { createClient } = require('@supabase/supabase-js');
const { embed } = require('./embed');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

/** Splits aligned Khasi/English text into paragraph chunks (keeps them paired). */
function chunkPairs(khasi, english, maxChars = 600) {
  const paras = (t) =>
    (t || '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const k = paras(khasi);
  const e = paras(english);
  const out = [];
  const n = Math.max(k.length, e.length, 1);
  for (let i = 0; i < n; i++) {
    out.push({
      khasi: (k[i] ?? khasi ?? '').slice(0, maxChars),
      english: (e[i] ?? english ?? '').slice(0, maxChars),
    });
  }
  return out;
}

(async () => {
  if (!fs.existsSync('./khasi_kb.json')) {
    console.error('khasi_kb.json not found. Create it first.');
    process.exit(1);
  }
  const items = JSON.parse(fs.readFileSync('./khasi_kb.json', 'utf8'));
  let inserted = 0;

  for (const item of items) {
    const chunks = chunkPairs(item.khasi, item.english);
    for (let idx = 0; idx < chunks.length; idx++) {
      const c = chunks[idx];
      if (!c.english) continue;

      // Embed the ENGLISH text for robust cross-lingual retrieval.
      // Many retries here: ingestion is one-time, so waiting out throttling is fine.
      const embedding = await embed(c.english, 'RETRIEVAL_DOCUMENT', {
        maxAttempts: 5,
        baseDelayMs: 12000,
      });

      const { error } = await supabase.from('kb_documents').insert({
        source_type: item.source_type,
        title: item.title ?? null,
        khasi_text: c.khasi,
        english_text: c.english,
        chunk_index: idx,
        embedding,
      });

      if (error) console.error('insert failed:', error.message);
      else {
        inserted++;
        console.log(`✓ ${item.source_type} [${idx}] ${item.title ?? ''}`);
      }
      await sleep(4000); // pace requests to stay under the free embedding rate limit
    }
  }

  console.log(`\nDone. Inserted ${inserted} chunk(s).`);
  process.exit(0);
})();

'use strict';

/**
 * Quick retrieval test (run on your PC AFTER ingest.js).
 * Lets you confirm RAG works before wiring it into the bot.
 *
 *   node query-test.js "kumno ban ïok ha ka tournament?"
 *   node query-test.js "how do players join a tournament?"
 */

require('dotenv').config();
const { retrieve, buildContext, RAG_ON } = require('./rag');

(async () => {
  if (!RAG_ON) {
    console.error(
      'RAG is OFF — set SUPABASE_URL, SUPABASE_ANON_KEY (or SERVICE), and GEMINI_API_KEY in .env'
    );
    process.exit(1);
  }
  const q = process.argv.slice(2).join(' ') || 'How do players join a tournament?';
  const docs = await retrieve(q, { k: 5, minSim: 0 }); // minSim 0 = show everything
  console.log('Query   :', q);
  console.log('Matches :', docs.length, '\n');
  console.log(buildContext(docs) || '(no documents found — did you run ingest.js?)');
  process.exit(0);
})();

/**
 * Tier 2 RAG offline ingestion — one-shot knowledge indexer.
 *
 *   npx tsx scripts/reindex-knowledge.ts [--dry-run]
 *
 * Builds one chunk per inventory item / BusinessRule / SmsTemplate, embeds
 * each with Gemini text-embedding-004, and upserts into `knowledge_chunks`.
 * Requires the Tier 2 DDL first:
 *   psql "$DIRECT_URL" -f prisma/rag_pgvector.sql
 * (DIRECT_URL = direct :5432 host — never the :6543 pooler, which hangs DDL.)
 *
 * Async/offline by design: run from cron or POST /api/ai/reindex (Admin).
 * A failed embed keeps the old embedding (dead-letter, retry next tick) —
 * ingestion never fails inventory or settings saves (it isn't wired into them).
 */

import { runReindex } from '../src/services/reindex.service.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Reindexing knowledge chunks${dryRun ? ' (dry run — no writes)' : ''}...`);
  const result = await runReindex({ dryRun });
  console.log(`chunks=${result.chunks} indexed=${result.indexed} skipped=${result.skipped} ${result.detail}`);
  if (result.chunks === 0 && result.detail.startsWith('read failed')) process.exit(1);
}

main()
  .catch((err) => {
    console.error('reindex failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import('../src/config/database.js');
    await prisma.$disconnect();
  });

import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { buildChunkForItem, buildChunksForRules, embedQuery } from './rag.service.js';

// ─── Offline knowledge ingestion (Tier 2) ───────────────────────────────
// Async only — a failed embed never fails an inventory/settings save.
// Dead-letter rule: keep the old embedding, count as skipped, retry next tick.
// Uses raw SQL so it works whether or not `prisma generate` has picked up the
// KnowledgeChunk model yet (Tier 2 DDL is additive).

export interface ReindexResult {
  chunks: number;
  indexed: number;
  skipped: number;
  detail: string;
}

type RawDb = {
  $queryRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown[]>;
  $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown>;
};

function db(): RawDb {
  return prisma as unknown as RawDb;
}

export async function runReindex(opts: { dryRun?: boolean } = {}): Promise<ReindexResult> {
  const dryRun = opts.dryRun === true;
  const empty: ReindexResult = { chunks: 0, indexed: 0, skipped: 0, detail: '' };

  // 1. Assemble chunks: one per item (name+category+occasions+desc+size),
  //    one per BusinessRule row, one per SmsTemplate.
  let items: { id: number; name: string; category: string; occasions: string[]; colors: string[]; description: string | null; size: string | null; price: number }[] = [];
  let rules: { key: string; value: string }[] = [];
  let templates: { id: string; name: string; content: string }[] = [];
  try {
    [items, rules, templates] = await Promise.all([
      prisma.inventoryItem.findMany({
        select: { id: true, name: true, category: true, occasions: true, colors: true, description: true, size: true, price: true },
      }) as unknown as Promise<typeof items>,
      prisma.businessRule.findMany({ select: { key: true, value: true } }) as unknown as Promise<typeof rules>,
      prisma.smsTemplate.findMany({ select: { id: true, name: true, content: true } }) as unknown as Promise<typeof templates>,
    ]);
  } catch (err) {
    return { ...empty, detail: `read failed: ${(err as Error)?.message ?? err}` };
  }

  const docs = [
    ...items.map(buildChunkForItem),
    ...buildChunksForRules(rules),
    ...templates.map((t) => ({
      source: 'template' as const,
      sourceId: t.id,
      chunk: `SMS template ${t.name}: ${t.content}`,
      metadata: { name: t.name } as Record<string, unknown>,
    })),
  ];

  if (!env.GEMINI_API_KEY) {
    return { chunks: docs.length, indexed: 0, skipped: docs.length, detail: 'no embedding key (GEMINI_API_KEY unset) — dry inventory of chunks only' };
  }

  let indexed = 0;
  let skipped = 0;
  for (const doc of docs) {
    const vector = await embedQuery(doc.chunk);
    if (!vector) { skipped++; continue; }
    if (dryRun) { indexed++; continue; }
    try {
      await db().$executeRawUnsafe(
        `INSERT INTO knowledge_chunks (source, source_id, chunk, embedding, metadata, updated_at)
         VALUES ($1, $2, $3, $4::vector, $5::jsonb, now())
         ON CONFLICT DO NOTHING`,
        doc.source, doc.sourceId, doc.chunk,
        `[${vector.join(',')}]`,
        JSON.stringify(doc.metadata ?? {}),
      );
      // Refresh the embedding when the chunk text changed since last index.
      await db().$executeRawUnsafe(
        `UPDATE knowledge_chunks SET chunk = $3, embedding = $4::vector, metadata = $5::jsonb, updated_at = now()
         WHERE source = $1 AND source_id = $2 AND chunk IS DISTINCT FROM $3`,
        doc.source, doc.sourceId, doc.chunk,
        `[${vector.join(',')}]`,
        JSON.stringify(doc.metadata ?? {}),
      );
      indexed++;
    } catch {
      // Dead-letter: keep the old embedding, retry next tick.
      skipped++;
    }
  }
  return { chunks: docs.length, indexed, skipped, detail: dryRun ? 'dry run — no writes' : 'ok' };
}

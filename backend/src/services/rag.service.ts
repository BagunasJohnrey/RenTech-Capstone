import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import * as inventoryService from './inventory.service.js';

// ─── RAG retrieval service ────────────────────────────────────────────────
// Tier 1 (ships first, no new infra): deterministic structured retrieval over
// live Postgres — occasion→category pre-filter, availability filter, SQL-rank
// scoring, top-k cap. Replaces the naive `slice(0, 60)` prompt-stuffing in
// ai.controller.ts: a 60-item prompt (~3-4k tokens) becomes ≤8 chunks
// (~800-1.2k tokens), strictly faster since LLM time dominates.
//
// Tier 2 (pgvector semantic, additive): dense retrieval via Gemini
// text-embedding-004 + `knowledge_chunks` cosine search, hybrid-scored
// (0.6×vector + 0.4×keyword) with the Tier 1 signal. Every vector step is
// best-effort with an instant Tier 1 fallback — the boutique never bricks
// when providers are rate-limited or the index is missing.

export interface StylistItem {
  id?: number;
  name: string;
  category: string;
  price: number;
  onSale?: boolean | null;
  salePrice?: number | null;
  occasions?: string[];
  // Staff-only color tags — never rendered on cards, but matched here so
  // "green theme gowns" ranks green-tagged items first.
  colors?: string[];
  description?: string | null;
}

export interface PolicyChunk {
  key: string;
  value: string;
}

export interface StylistContext {
  items: StylistItem[];
  policies: PolicyChunk[];
  /** Which retrieval path produced this context. */
  retrieval: 'keyword' | 'hybrid' | 'vector';
  /** Item count actually injected into the prompt (≤ RAG_TOP_K). */
  groundedIn: number;
}

export const RAG_TOP_K = env.RAG_TOP_K;
export const RAG_ENABLED = env.RAG_ENABLED;

// Occasion→category map. Mirrors EVENT_KEYWORDS in
// frontend/src/components/ChatbotModal.jsx — keep the two in sync.
export const EVENT_TO_CATEGORIES: Record<string, string[]> = {
  wedding: ['gown', 'filipiniana'],
  bridal: ['gown'],
  bride: ['gown'],
  debut: ['gown', 'formal'],
  birthday: ['gown', 'formal', 'suit'],
  party: ['gown', 'formal', 'suit'],
  gala: ['gown', 'formal'],
  prom: ['gown', 'formal'],
  graduation: ['suit', 'barong', 'formal'],
  corporate: ['suit', 'formal'],
  business: ['suit', 'formal'],
  interview: ['suit'],
  filipiniana: ['filipiniana'],
  barong: ['barong'],
  suit: ['suit'],
  gown: ['gown'],
  formal: ['formal', 'suit', 'gown'],
  costume: ['costume'],
  halloween: ['costume'],
  christmas: ['costume'],
  themed: ['costume'],
  beach: ['gown', 'barong'],
};

/** Lowercase word tokens (len ≥ 3) for keyword scoring. */
export function normalizeQuery(query: string): string[] {
  return (query || '').toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
}

/** Categories implied by occasion keywords in the query. */
export function targetCategoriesFor(query: string): Set<string> {
  const lower = (query || '').toLowerCase();
  const out = new Set<string>();
  for (const [keyword, cats] of Object.entries(EVENT_TO_CATEGORIES)) {
    if (lower.includes(keyword)) cats.forEach((c) => out.add(c));
  }
  return out;
}

// Score = 3×category hit + 2×occasion hit + 2×color hit + 1×word hit
//        + 1×preference hit + 0.5×onSale boost (§5 of the RAG plan).
export function scoreItem(
  item: StylistItem,
  words: string[],
  targetCats: Set<string>,
  preferences: string[] = [],
): number {
  const name = (item.name || '').toLowerCase();
  const category = (item.category || '').toLowerCase();
  const desc = (item.description || '').toLowerCase();
  const occasions = (item.occasions || []).map((o) => String(o).toLowerCase());
  const colors = (item.colors || []).map((c) => String(c).toLowerCase());
  const prefs = new Set(preferences.map((p) => String(p).toLowerCase()));
  let score = 0;
  if (targetCats.has(category)) score += 3;
  for (const o of occasions) {
    if (targetCats.has(o)) { score += 2; break; }
  }
  // Color-tag hit: a query word matching a staff color tag ("green theme
  // gowns" → green-tagged items). One bonus max, like occasions.
  for (const w of words) {
    if (colors.some((c) => c === w || c.includes(w) || w.includes(c))) { score += 2; break; }
  }
  for (const w of words) {
    if (name.includes(w) || category.includes(w) || desc.includes(w)) score += 1;
    else if (occasions.some((o) => o.includes(w))) score += 1;
  }
  if (prefs.has(category)) score += 1;
  if (item.onSale) score += 0.5;
  return score;
}

// ─── Tier 2: embeddings (best-effort, cached) ─────────────────────────────

interface EmbedCacheEntry { vector: number[]; at: number; }
const embedCache = new Map<string, EmbedCacheEntry>();

function embedCacheTtlMs(): number {
  return Math.max(1, env.EMBED_CACHE_MIN) * 60 * 1000;
}

export function clearEmbedCache(): void {
  embedCache.clear();
}

/**
 * Embed a query with Gemini text-embedding-004 (768-dim). Cached
 * EMBED_CACHE_MIN minutes. Returns null when unconfigured or on ANY failure
 * — callers must fall back to Tier 1 keyword retrieval instantly.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  const query = (text || '').trim();
  if (!query || !env.GEMINI_API_KEY) return null;
  const cached = embedCache.get(query);
  if (cached && Date.now() - cached.at < embedCacheTtlMs()) return cached.vector;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.EMBED_MODEL}:embedContent`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        // gemini-embedding-001 defaults to 3072 dims — truncate to the
        // knowledge_chunks vector(768) width (Matryoshka).
        body: JSON.stringify({ content: { parts: [{ text: query }] }, outputDimensionality: 768 }),
      },
    );
    if (!response.ok) return null;
    const data = await response.json() as { embedding?: { values?: number[] } };
    const vector = data?.embedding?.values;
    if (!Array.isArray(vector) || vector.length === 0) return null;
    embedCache.set(query, { vector, at: Date.now() });
    return vector;
  } catch {
    return null;
  }
}

/** Cosine-search `knowledge_chunks` (inventory source) via the match_chunks RPC. */
async function tryVectorItemScores(vector: number[], k: number): Promise<Map<string, number> | null> {
  try {
    const rows = await (prisma as unknown as {
      $queryRawUnsafe: (sql: string, ...args: unknown[]) => Promise<{ source_id: string | null; score: number }[]>;
    }).$queryRawUnsafe(
      'SELECT source_id, 1 - (embedding <=> $1::vector) AS score FROM knowledge_chunks WHERE source = $2 AND embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT $3',
      `[${vector.join(',')}]`,
      'inventory',
      k,
    );
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const out = new Map<string, number>();
    for (const r of rows) {
      if (r.source_id != null) out.set(String(r.source_id), Number(r.score));
    }
    return out.size ? out : null;
  } catch {
    // Table/RPC missing (Tier 2 DDL not run) or pgvector absent → Tier 1.
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ─── Policy context (top-3 BusinessRules relevant to the query) ────────────

const POLICY_BOOST_KEYS = ['rental_period', 'downpayment', 'min_downpayment', 'late', 'return', 'damage', 'cancel'];

export async function retrievePolicies(query: string, k = 3): Promise<PolicyChunk[]> {
  try {
    const rules = await prisma.businessRule.findMany();
    if (!Array.isArray(rules) || rules.length === 0) return [];
    const words = normalizeQuery(query);
    const lower = (query || '').toLowerCase();
    const scored = rules.map((r) => {
      const hay = `${r.key} ${r.value}`.toLowerCase();
      let s = 0;
      for (const w of words) if (hay.includes(w)) s += 1;
      if (POLICY_BOOST_KEYS.some((bk) => r.key.toLowerCase().includes(bk) && lower.includes(bk.split('_')[0]))) s += 2;
      return { rule: r, score: s };
    });
    scored.sort((a, b) => b.score - a.score);
    const ranked = scored.some((s) => s.score > 0) ? scored.filter((s) => s.score > 0) : scored;
    return ranked.slice(0, k).map((s) => ({ key: s.rule.key, value: s.rule.value }));
  } catch {
    return [];
  }
}

// ─── Tier 1: stylist context ───────────────────────────────────────────────

export interface RetrieveOpts {
  topK?: number;
  preferences?: string[];
  /** Optional rental window — items overlapping it are excluded when tx dates are present. */
  from?: string;
  to?: string;
}

/**
 * Retrieve the grounded context for a stylist chat turn: top-k Available
 * items by keyword relevance + top-3 policy rules. Never throws — on any
 * failure returns an empty-items context so the chat falls through to the
 * FAQ/LLM chain with general styling guidance.
 */
export async function retrieveStylistContext(query: string, opts: RetrieveOpts = {}): Promise<StylistContext> {
  const topK = Math.min(Math.max(opts.topK ?? RAG_TOP_K, 1), 20);
  const empty: StylistContext = { items: [], policies: [], retrieval: 'keyword', groundedIn: 0 };
  try {
    const [available, policies] = await Promise.all([
      inventoryService.listItems('Available'),
      retrievePolicies(query, 3),
    ]);
    if (!Array.isArray(available) || available.length === 0) return { ...empty, policies };

    // Availability filter: only transaction-free Available items. listItems
    // already derives effective status; belt-and-braces on the raw status too.
    // When a rental window is supplied AND rows carry tx dates, exclude overlaps.
    const from = opts.from ? new Date(opts.from).getTime() : NaN;
    const to = opts.to ? new Date(opts.to).getTime() : NaN;
    const hasWindow = !Number.isNaN(from) && !Number.isNaN(to);
    const bookable = (available as (StylistItem & { effectiveStatus?: string; status?: string; transactions?: { rentalDate: Date; dueDate: Date }[] })[])
      .filter((i) => (i.effectiveStatus ?? i.status) === 'Available')
      .filter((i) => {
        if (!hasWindow || !Array.isArray(i.transactions)) return true;
        return !i.transactions.some((t) => {
          const s = new Date(t.rentalDate).getTime();
          const e = new Date(t.dueDate).getTime();
          return s <= to && e >= from;
        });
      });

    const words = normalizeQuery(query);
    const targetCats = targetCategoriesFor(query);
    const preferences = (opts.preferences ?? []).map((p) => String(p).toLowerCase());

    const ranked = bookable
      .map((i) => ({
        item: {
          id: (i as { id?: number }).id,
          name: i.name,
          category: i.category,
          price: i.price,
          onSale: i.onSale,
          salePrice: i.salePrice,
          occasions: (i as { occasions?: string[] }).occasions,
          colors: (i as { colors?: string[] }).colors,
          description: i.description,
        } as StylistItem,
        score: scoreItem(i as StylistItem, words, targetCats, preferences),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    // No keyword signal (generic greeting/Q&A) → still ground in a small
    // slice so the model knows real categories, but prefer on-sale items.
    let picked = ranked.slice(0, topK);
    let retrieval: StylistContext['retrieval'] = 'keyword';
    if (picked.length === 0) {
      picked = bookable
        .map((i) => ({
          item: {
            id: (i as { id?: number }).id,
            name: i.name,
            category: i.category,
            price: i.price,
            onSale: i.onSale,
            salePrice: i.salePrice,
            occasions: (i as { occasions?: string[] }).occasions,
            colors: (i as { colors?: string[] }).colors,
            description: i.description,
          } as StylistItem,
          score: (i.onSale ? 0.5 : 0),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.min(topK, 4));
    }

    // Tier 2 hybrid: when embeddings + index are live, blend 0.6×vector +
    // 0.4×keyword. Bounded at 1.5s total — on miss/timeout keep Tier 1.
    if (RAG_ENABLED && env.GEMINI_API_KEY && picked.length > 0) {
      const vector = await withTimeout(embedQuery(query), 1200, null);
      if (vector) {
        const vecScores = await withTimeout(tryVectorItemScores(vector, topK), 800, null);
        if (vecScores) {
          const maxKw = Math.max(1, ...picked.map((p) => p.score));
          const merged = picked.map((p) => {
            const v = vecScores.get(String(p.item.id)) ?? 0;
            return { ...p, score: 0.6 * v + 0.4 * (p.score / maxKw) };
          });
          merged.sort((a, b) => b.score - a.score);
          picked = merged;
          retrieval = 'hybrid';
        }
      }
    }

    const items = picked.slice(0, topK).map((p) => p.item);
    return { items, policies, retrieval, groundedIn: items.length };
  } catch {
    return empty;
  }
}

// ─── Structured RAG for promos: top-20 by rental-count signal ──────────────
// Numbers must be exact — no vectors here. Dead stock (0 rentals) first so
// the promo engine always sees clearance candidates instead of an arbitrary
// slice(0, 80) of newest items.

export interface PromoInventoryRow {
  id: number;
  name: string;
  category: string;
  price: number;
  rentalCount: number;
  onSale: boolean;
  status: string;
}

export async function retrievePromoContext(limit = 20): Promise<PromoInventoryRow[]> {
  try {
    const items = await inventoryService.listItems();
    const rows = (items as (PromoInventoryRow & { rentalCount?: number })[])
      .filter((i) => i.status === 'Available' || i.status === 'Rented')
      .map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        price: i.price,
        rentalCount: i.rentalCount ?? 0,
        onSale: !!i.onSale,
        status: i.status,
      }));
    rows.sort((a, b) => {
      if ((a.rentalCount === 0) !== (b.rentalCount === 0)) return a.rentalCount === 0 ? -1 : 1;
      return a.rentalCount - b.rentalCount;
    });
    return rows.slice(0, Math.min(Math.max(limit, 1), 50));
  } catch {
    return [];
  }
}

// ─── Health probe for GET /api/ai/rag-health ───────────────────────────────

export async function getRagHealth() {
  let vectorIndex = { reachable: false, detail: 'not checked' };
  try {
    await (prisma as unknown as { $queryRawUnsafe: (sql: string) => Promise<unknown> })
      .$queryRawUnsafe('SELECT 1 FROM knowledge_chunks LIMIT 1');
    vectorIndex = { reachable: true, detail: 'OK' };
  } catch (err) {
    vectorIndex = { reachable: false, detail: (err as Error)?.message?.slice(0, 120) || 'knowledge_chunks unavailable (Tier 2 DDL not run?)' };
  }
  return {
    enabled: RAG_ENABLED,
    topK: RAG_TOP_K,
    tier: vectorIndex.reachable ? 'hybrid' : 'keyword',
    embedModel: env.EMBED_MODEL,
    embedConfigured: !!env.GEMINI_API_KEY,
    vectorIndex,
  };
}

// ─── Chunk builders for the offline ingestion script ───────────────────────

export function buildChunkForItem(item: {
  id: number; name: string; category: string; occasions?: string[];
  colors?: string[]; description?: string | null; size?: string | null; price: number;
}): { source: string; sourceId: string; chunk: string; metadata: Record<string, unknown> } {
  const occasions = (item.occasions || []).join(', ');
  const colors = (item.colors || []).join(', ');
  const chunk = [
    item.name,
    `Category: ${item.category}`,
    occasions ? `Occasions: ${occasions}` : '',
    colors ? `Colors: ${colors}` : '',
    item.size ? `Size: ${item.size}` : '',
    `Price: ${item.price}`,
    item.description ? `Description: ${item.description}` : '',
  ].filter(Boolean).join(' | ');
  return {
    source: 'inventory',
    sourceId: String(item.id),
    chunk,
    metadata: { category: item.category, occasions: item.occasions ?? [], colors: item.colors ?? [], price: item.price },
  };
}

export function buildChunksForRules(rules: { key: string; value: string }[]): { source: string; sourceId: string; chunk: string; metadata: Record<string, unknown> }[] {
  return rules.map((r) => ({
    source: 'rule',
    sourceId: r.key,
    chunk: `Policy ${r.key}: ${r.value}`,
    metadata: { key: r.key },
  }));
}

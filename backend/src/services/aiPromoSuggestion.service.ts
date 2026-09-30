import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../config/supabase.js';
import type { PromoSuggestion } from './gemini.service.js';

// Saved AI promotion suggestions — same dual-write pattern as aiReport.service.
// Local JSON files under backend/data/ai-promo-suggestions/ AND in the private
// `rentech-ai-promo-suggestions` Supabase bucket.

export interface PromoSuggestionMeta {
  id: string;
  createdAt: string;
  createdBy: string | null;
  source: string;
  provider: string | null;
  model: string | null;
  currentMonth: string;
  itemCount: number;
  voucherCount: number;
  excerpt: string;
  uploaded: boolean;
  origin: 'local' | 'cloud' | 'both';
}

export interface PromoSuggestionFull extends PromoSuggestionMeta {
  suggestions: PromoSuggestion;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-_]*$/;
const MAX_SAVED = 20;

export const PROMO_SUGGESTIONS_BUCKET = process.env.STORAGE_PROMO_SUGGESTIONS_BUCKET || 'rentech-ai-promo-suggestions';
const META_SUFFIX = '.meta.json';

type StorageApi = {
  list?: (prefix: string, opts?: unknown) => Promise<{ data?: { name: string }[] | null; error?: { message?: string } | null }>;
  upload?: (path: string, body: unknown, opts?: unknown) => Promise<{ error?: { message?: string } | null }>;
  download?: (path: string) => Promise<{ data?: Blob | Buffer | null; error?: { message?: string } | null }>;
  remove?: (paths: string[]) => Promise<{ error?: { message?: string } | null }>;
};

function cloudApi(): StorageApi | null {
  try {
    const api = (supabaseAdmin as unknown as { storage?: { from?: (b: string) => StorageApi } })
      ?.storage?.from?.(PROMO_SUGGESTIONS_BUCKET);
    return api && typeof api.list === 'function' ? api : null;
  } catch {
    return null;
  }
}

export async function ensurePromoSuggestionsBucket(): Promise<void> {
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const names = new Set((buckets || []).map((b) => b.name));
    if (!names.has(PROMO_SUGGESTIONS_BUCKET)) {
      const { error } = await supabaseAdmin.storage.createBucket(PROMO_SUGGESTIONS_BUCKET, {
        public: false,
        allowedMimeTypes: ['application/json'],
        fileSizeLimit: 10 * 1024 * 1024,
      });
      if (error) console.warn(`[promo-suggestions] createBucket(${PROMO_SUGGESTIONS_BUCKET}) failed:`, error.message);
      else console.log(`[promo-suggestions] bucket "${PROMO_SUGGESTIONS_BUCKET}" created (private)`);
    }
  } catch (err) {
    console.warn('[promo-suggestions] ensurePromoSuggestionsBucket error:', (err as Error)?.message ?? err);
  }
}

function getSuggestionsDir(): string {
  if (process.env.AI_PROMO_SUGGESTIONS_DIR) return process.env.AI_PROMO_SUGGESTIONS_DIR;
  return path.join(process.cwd(), 'data', 'ai-promo-suggestions');
}

function suggestionFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = crypto.randomBytes(3).toString('hex');
  return `promo-${stamp}-${rand}`;
}

function excerptOf(suggestions: PromoSuggestion): string {
  const parts: string[] = [];
  if (suggestions.itemSuggestions?.length) {
    parts.push(`${suggestions.itemSuggestions.length} item sale idea(s)`);
  }
  if (suggestions.voucherSuggestions?.length) {
    parts.push(`${suggestions.voucherSuggestions.length} voucher code(s)`);
  }
  return parts.join(', ') || 'No suggestions';
}

export async function savePromoSuggestion(input: {
  suggestions: PromoSuggestion;
  source?: string;
  provider?: string | null;
  model?: string | null;
  createdBy?: string | null;
  currentMonth?: string;
}): Promise<PromoSuggestionMeta> {
  const dir = getSuggestionsDir();
  await fs.mkdir(dir, { recursive: true });
  const id = suggestionFilename();
  const createdAt = new Date().toISOString();
  const full: PromoSuggestionFull = {
    id,
    createdAt,
    createdBy: input.createdBy ?? null,
    source: input.source ?? 'ai',
    provider: input.provider ?? null,
    model: input.model ?? null,
    currentMonth: input.currentMonth ?? '',
    itemCount: input.suggestions.itemSuggestions?.length ?? 0,
    voucherCount: input.suggestions.voucherSuggestions?.length ?? 0,
    excerpt: excerptOf(input.suggestions),
    uploaded: false,
    origin: 'local',
    suggestions: input.suggestions,
  };
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(full, null, 2), 'utf8');
  await pruneSuggestions(dir);
  const { suggestions: _omit, ...meta } = full;
  meta.uploaded = await uploadToCloud(meta, full.suggestions);
  if (meta.uploaded) meta.origin = 'both';
  const finalFull = { ...full, uploaded: meta.uploaded, origin: meta.origin };
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(finalFull, null, 2), 'utf8').catch(() => {});
  return meta;
}

async function readSuggestion(dir: string, filename: string, withBody: boolean): Promise<PromoSuggestionFull | PromoSuggestionMeta | null> {
  if (!filename.endsWith('.json')) return null;
  const id = filename.slice(0, -5);
  if (!ID_RE.test(id)) return null;
  try {
    const raw = await fs.readFile(path.join(dir, filename), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PromoSuggestionFull>;
    if (!parsed.suggestions && !parsed.excerpt) return null;
    const meta: PromoSuggestionMeta = {
      id,
      createdAt: String(parsed.createdAt ?? ''),
      createdBy: (parsed.createdBy as string | null) ?? null,
      source: String(parsed.source ?? 'ai'),
      provider: (parsed.provider as string | null) ?? null,
      model: (parsed.model as string | null) ?? null,
      currentMonth: String(parsed.currentMonth ?? ''),
      itemCount: Number(parsed.itemCount ?? 0) || 0,
      voucherCount: Number(parsed.voucherCount ?? 0) || 0,
      excerpt: String(parsed.excerpt ?? ''),
      uploaded: false,
      origin: 'local',
    };
    if (!meta.createdAt) return null;
    return withBody ? { ...meta, suggestions: (parsed.suggestions as PromoSuggestion) ?? { itemSuggestions: [], voucherSuggestions: [] } } : meta;
  } catch {
    return null;
  }
}

export function mergeSuggestionLists(local: PromoSuggestionMeta[], cloud: PromoSuggestionMeta[]): PromoSuggestionMeta[] {
  const byId = new Map(local.map((m) => [m.id, m]));
  for (const c of cloud) {
    const existing = byId.get(c.id);
    if (existing) {
      existing.uploaded = true;
      existing.origin = 'both';
    } else {
      byId.set(c.id, c);
    }
  }
  const metas = [...byId.values()];
  metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return metas;
}

export async function listPromoSuggestions(limit = 20): Promise<PromoSuggestionMeta[]> {
  const dir = getSuggestionsDir();
  let local: PromoSuggestionMeta[] = [];
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    local = (
      await Promise.all(files.map((f) => readSuggestion(dir, f, false)))
    ).filter((m): m is PromoSuggestionMeta => m !== null);
  } catch {
    local = [];
  }
  return mergeSuggestionLists(local, await listCloudMetas()).slice(0, limit);
}

export async function getPromoSuggestion(id: string): Promise<PromoSuggestionFull> {
  if (!ID_RE.test(id)) throw new AppError(400, 'Invalid suggestion id');
  try {
    const raw = await fs.readFile(path.join(getSuggestionsDir(), `${id}.json`), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PromoSuggestionFull>;
    if (parsed.suggestions) return toFull(id, parsed);
  } catch {
    // fall through to cloud
  }
  const api = cloudApi();
  if (api?.download) {
    try {
      const { data, error } = await api.download(`${id}.json`);
      if (!error && data) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(await (data as Blob).arrayBuffer());
        const parsed = JSON.parse(buf.toString('utf8')) as Partial<PromoSuggestionFull>;
        if (parsed.suggestions) return toFull(id, parsed);
      }
    } catch {
      // fall through to 404
    }
  }
  throw new AppError(404, 'Suggestion not found');
}

function toFull(id: string, parsed: Partial<PromoSuggestionFull>): PromoSuggestionFull {
  return {
    id,
    createdAt: String(parsed.createdAt ?? ''),
    createdBy: (parsed.createdBy as string | null) ?? null,
    source: String(parsed.source ?? 'ai'),
    provider: (parsed.provider as string | null) ?? null,
    model: (parsed.model as string | null) ?? null,
    currentMonth: String(parsed.currentMonth ?? ''),
    itemCount: Number(parsed.itemCount ?? 0) || 0,
    voucherCount: Number(parsed.voucherCount ?? 0) || 0,
    excerpt: String(parsed.excerpt ?? ''),
    uploaded: Boolean((parsed as Partial<PromoSuggestionMeta>).uploaded),
    origin: (parsed as Partial<PromoSuggestionMeta>).origin === 'cloud' ? 'cloud'
      : (parsed as Partial<PromoSuggestionMeta>).origin === 'both' ? 'both' : 'local',
    suggestions: (parsed.suggestions as PromoSuggestion) ?? { itemSuggestions: [], voucherSuggestions: [] },
  };
}

export async function deletePromoSuggestion(id: string): Promise<boolean> {
  if (!ID_RE.test(id)) throw new AppError(400, 'Invalid suggestion id');
  let removed = false;
  await fs.unlink(path.join(getSuggestionsDir(), `${id}.json`)).then(
    () => { removed = true; },
    () => {}
  );
  const api = cloudApi();
  if (api?.remove) {
    try {
      const { error } = await api.remove([`${id}.json`, `${id}${META_SUFFIX}`]);
      if (!error) removed = true;
    } catch {
      // local delete already decides the outcome
    }
  }
  return removed;
}

async function pruneSuggestions(dir: string): Promise<void> {
  try {
    const all = await listPromoSuggestions(Number.MAX_SAFE_INTEGER);
    for (const extra of all.slice(MAX_SAVED)) {
      await fs.unlink(path.join(dir, `${extra.id}.json`)).catch(() => {});
    }
  } catch {
    // pruning is best-effort
  }
}

async function uploadToCloud(meta: PromoSuggestionMeta, suggestions: PromoSuggestion): Promise<boolean> {
  const api = cloudApi();
  if (!api?.upload) return false;
  try {
    const full = JSON.stringify({ ...meta, suggestions, uploaded: true, origin: 'both' });
    const sidecar = JSON.stringify({ ...meta, uploaded: true, origin: 'both' });
    const deadline = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30000));
    const run = (async () => {
      let a = await api.upload!(`${meta.id}.json`, Buffer.from(full, 'utf8'), {
        contentType: 'application/json', upsert: false,
      });
      if (a?.error && /bucket not found/i.test(a.error.message ?? '')) {
        await ensurePromoSuggestionsBucket();
        a = await api.upload!(`${meta.id}.json`, Buffer.from(full, 'utf8'), {
          contentType: 'application/json', upsert: false,
        });
      }
      if (a?.error) return false;
      const b = await api.upload!(`${meta.id}${META_SUFFIX}`, Buffer.from(sidecar, 'utf8'), {
        contentType: 'application/json', upsert: true,
      });
      return !b?.error;
    })();
    const ok = await Promise.race([run, deadline]);
    if (ok === true) {
      await pruneCloudSuggestions(MAX_SAVED);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function listCloudMetas(): Promise<PromoSuggestionMeta[]> {
  const api = cloudApi();
  if (!api?.list || !api?.download) return [];
  try {
    const deadline = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 15000));
    const run = (async (): Promise<PromoSuggestionMeta[]> => {
      const { data, error } = await api.list!('', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
      if (error || !data) return [];
      const sidecars = data
        .map((f) => f.name)
        .filter((n) => typeof n === 'string' && n.endsWith(META_SUFFIX))
        .slice(0, MAX_SAVED);
      const metas: PromoSuggestionMeta[] = [];
      for (const name of sidecars) {
        try {
          const dl = await api.download!(name);
          if (dl?.error || !dl?.data) continue;
          const buf = Buffer.isBuffer(dl.data) ? dl.data : Buffer.from(await (dl.data as Blob).arrayBuffer());
          const parsed = JSON.parse(buf.toString('utf8')) as Partial<PromoSuggestionMeta> & { id?: string };
          if (!parsed || typeof parsed.id !== 'string' || !ID_RE.test(parsed.id)) continue;
          if (!parsed.createdAt) continue;
          metas.push({
            id: parsed.id,
            createdAt: String(parsed.createdAt),
            createdBy: (parsed.createdBy as string | null) ?? null,
            source: String(parsed.source ?? 'ai'),
            provider: (parsed.provider as string | null) ?? null,
            model: (parsed.model as string | null) ?? null,
            currentMonth: String(parsed.currentMonth ?? ''),
            itemCount: Number(parsed.itemCount ?? 0) || 0,
            voucherCount: Number(parsed.voucherCount ?? 0) || 0,
            excerpt: String(parsed.excerpt ?? ''),
            uploaded: true,
            origin: 'cloud',
          });
        } catch {
          continue;
        }
      }
      return metas;
    })();
    const result = await Promise.race([run, deadline]);
    return result === 'timeout' ? [] : result;
  } catch {
    return [];
  }
}

async function pruneCloudSuggestions(keep: number): Promise<void> {
  const api = cloudApi();
  if (!api?.list || !api?.remove) return;
  try {
    const { data, error } = await api.list('', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
    if (error || !data) return;
    const dataFiles = data
      .map((f) => f.name)
      .filter((n) => typeof n === 'string' && n.endsWith('.json') && !n.endsWith(META_SUFFIX));
    for (const name of dataFiles.slice(keep)) {
      const id = name.slice(0, -5);
      await api.remove([name, `${id}${META_SUFFIX}`]).catch(() => {});
    }
  } catch {
    // pruning is best-effort
  }
}

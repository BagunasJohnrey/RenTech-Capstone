import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../config/supabase.js';

// History of generated AI business reports for the admin "Data & Backups"
// settings tab + the Business Intelligence page. generateReport() auto-saves
// successful reports here (best-effort); the list endpoints read them back.
// Files live under backend/data/ai-reports/ (overridable via AI_REPORTS_DIR
// so tests can point at a temp dir) AND in the private `rentech-ai-reports`
// cloud bucket (the copy that survives ephemeral disks).

export interface AiReportMeta {
  id: string;
  createdAt: string;
  createdBy: string | null;
  source: string;
  provider: string | null;
  model: string | null;
  excerpt: string;
  length: number;
  // Cloud copy (private `rentech-ai-reports` bucket).
  uploaded: boolean;
  origin: 'local' | 'cloud' | 'both';
}

export interface AiReportFull extends AiReportMeta {
  report: string;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-_]*$/;
const MAX_SAVED = 20;

// Private bucket holding full reports + tiny `.meta.json` sidecars (the
// sidecars let the history lists render without downloading every report).
export const AI_REPORTS_BUCKET = process.env.STORAGE_AI_REPORTS_BUCKET || 'rentech-ai-reports';
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
      ?.storage?.from?.(AI_REPORTS_BUCKET);
    return api && typeof api.list === 'function' ? api : null;
  } catch {
    return null;
  }
}

// Creates the private reports bucket on startup (called from index.ts).
// Best-effort — a failure only logs; local reports still work.
export async function ensureAiReportsBucket(): Promise<void> {
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const names = new Set((buckets || []).map((b) => b.name));
    if (!names.has(AI_REPORTS_BUCKET)) {
      const { error } = await supabaseAdmin.storage.createBucket(AI_REPORTS_BUCKET, {
        public: false,
        allowedMimeTypes: ['application/json'],
        fileSizeLimit: 25 * 1024 * 1024,
      });
      if (error) console.warn(`[reports] createBucket(${AI_REPORTS_BUCKET}) failed:`, error.message);
      else console.log(`[reports] bucket "${AI_REPORTS_BUCKET}" created (private)`);
    }
  } catch (err) {
    console.warn('[reports] ensureAiReportsBucket error:', (err as Error)?.message ?? err);
  }
}

export function getReportsDir(): string {
  if (process.env.AI_REPORTS_DIR) return process.env.AI_REPORTS_DIR;
  return path.join(process.cwd(), 'data', 'ai-reports');
}

export function reportFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = crypto.randomBytes(3).toString('hex');
  return `rpt-${stamp}-${rand}`;
}

function excerptOf(report: string): string {
  const first = String(report || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
  return first.slice(0, 220);
}

export async function saveAiReport(input: {
  report: string;
  source?: string;
  provider?: string | null;
  model?: string | null;
  createdBy?: string | null;
}): Promise<AiReportMeta> {
  const dir = getReportsDir();
  await fs.mkdir(dir, { recursive: true });
  const id = reportFilename();
  const createdAt = new Date().toISOString();
  const full: AiReportFull = {
    id,
    createdAt,
    createdBy: input.createdBy ?? null,
    source: input.source ?? 'ai',
    provider: input.provider ?? null,
    model: input.model ?? null,
    excerpt: excerptOf(input.report),
    length: String(input.report || '').length,
    report: String(input.report || ''),
    uploaded: false,
    origin: 'local',
  };
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(full, null, 2), 'utf8');
  await pruneReports(dir);
  const { report: _omit, ...meta } = full;
  // Cloud copy (the one that survives ephemeral disks). Best-effort — a
  // storage blip leaves uploaded:false, never fails the save. The final
  // flags are written back to both copies so list/detail stay accurate.
  meta.uploaded = await uploadReportToCloud(meta, full.report);
  if (meta.uploaded) meta.origin = 'both';
  const finalFull = { ...full, uploaded: meta.uploaded, origin: meta.origin };
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(finalFull, null, 2), 'utf8').catch(() => {});
  return meta;
}

async function readReport(dir: string, filename: string, withBody: boolean): Promise<AiReportFull | AiReportMeta | null> {
  if (!filename.endsWith('.json')) return null;
  const id = filename.slice(0, -5);
  if (!ID_RE.test(id)) return null;
  try {
    const raw = await fs.readFile(path.join(dir, filename), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AiReportFull>;
    if (!parsed.report && !parsed.excerpt) return null;
    const meta: AiReportMeta = {
      id,
      createdAt: String(parsed.createdAt ?? ''),
      createdBy: (parsed.createdBy as string | null) ?? null,
      source: String(parsed.source ?? 'ai'),
      provider: (parsed.provider as string | null) ?? null,
      model: (parsed.model as string | null) ?? null,
      excerpt: String(parsed.excerpt ?? excerptOf(String(parsed.report ?? ''))),
      length: Number(parsed.length ?? String(parsed.report ?? '').length) || 0,
      uploaded: false,
      origin: 'local',
    };
    if (!meta.createdAt) return null;
    return withBody ? { ...meta, report: String((parsed as AiReportFull).report ?? '') } : meta;
  } catch {
    return null;
  }
}

// Merges local + cloud history: cloud-only entries appear with origin
// 'cloud', entries present in both become 'both'. Exported for unit tests.
export function mergeReportLists(local: AiReportMeta[], cloud: AiReportMeta[]): AiReportMeta[] {
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

export async function listAiReports(limit = 20): Promise<AiReportMeta[]> {
  const dir = getReportsDir();
  let local: AiReportMeta[] = [];
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    local = (
      await Promise.all(files.map((f) => readReport(dir, f, false)))
    ).filter((m): m is AiReportMeta => m !== null);
  } catch {
    local = [];
  }
  // Merge the cloud copies (source of truth on ephemeral disks).
  return mergeReportLists(local, await listCloudReportMetas()).slice(0, limit);
}

export async function getAiReport(id: string): Promise<AiReportFull> {
  if (!ID_RE.test(id)) throw new AppError(400, 'Invalid report id');
  // Local file first (fast path); cloud copy as fallback so reopening keeps
  // working after a restart on ephemeral disks.
  try {
    const raw = await fs.readFile(path.join(getReportsDir(), `${id}.json`), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AiReportFull>;
    if (parsed.report) return toFull(id, parsed);
  } catch {
    // fall through to cloud
  }
  const api = cloudApi();
  if (api?.download) {
    try {
      const { data, error } = await api.download(`${id}.json`);
      if (!error && data) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(await (data as Blob).arrayBuffer());
        const parsed = JSON.parse(buf.toString('utf8')) as Partial<AiReportFull>;
        if (parsed.report) return toFull(id, parsed);
      }
    } catch {
      // fall through to 404
    }
  }
  throw new AppError(404, 'Report not found');
}

function toFull(id: string, parsed: Partial<AiReportFull>): AiReportFull {
  return {
    id,
    createdAt: String(parsed.createdAt ?? ''),
    createdBy: (parsed.createdBy as string | null) ?? null,
    source: String(parsed.source ?? 'ai'),
    provider: (parsed.provider as string | null) ?? null,
    model: (parsed.model as string | null) ?? null,
    excerpt: String(parsed.excerpt ?? excerptOf(String(parsed.report))),
    length: Number(parsed.length ?? String(parsed.report).length) || 0,
    report: String(parsed.report),
    uploaded: Boolean((parsed as Partial<AiReportMeta>).uploaded),
    origin: (parsed as Partial<AiReportMeta>).origin === 'cloud' ? 'cloud'
      : (parsed as Partial<AiReportMeta>).origin === 'both' ? 'both' : 'local',
  };
}

// Re-uploads an existing local report to the cloud (retry for rows stuck at
// "server only", e.g. saved while the backend ran a non-service key).
// Mirrors uploadExistingBackup: 404 when there is no local copy, 502 when
// the cloud copy still won't land.
export async function uploadExistingReport(id: string): Promise<AiReportMeta> {
  if (!ID_RE.test(id)) throw new AppError(400, 'Invalid report id');
  let full: AiReportFull;
  try {
    const raw = await fs.readFile(path.join(getReportsDir(), `${id}.json`), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AiReportFull>;
    if (!parsed.report) throw new Error('empty');
    full = toFull(id, parsed);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(404, 'No local copy to upload');
  }
  const { report, ...meta } = full;
  if (meta.uploaded) return { ...meta, origin: 'both' as const };
  const ok = await uploadReportToCloud(meta, report);
  if (!ok) throw new AppError(502, 'Cloud upload failed — check the server logs and try again');
  const finalFull = { ...full, uploaded: true, origin: 'both' as const };
  await fs.writeFile(path.join(getReportsDir(), `${id}.json`), JSON.stringify(finalFull, null, 2), 'utf8').catch(() => {});
  return { ...meta, uploaded: true, origin: 'both' as const };
}

async function pruneReports(dir: string): Promise<void> {
  try {
    const all = await listAiReports(Number.MAX_SAFE_INTEGER);
    for (const extra of all.slice(MAX_SAVED)) {
      await fs.unlink(path.join(dir, `${extra.id}.json`)).catch(() => {});
    }
  } catch {
    // pruning is best-effort
  }
}

// Uploads one report (full + meta sidecar) to the private bucket. Returns
// whether the cloud copy landed — never throws.
async function uploadReportToCloud(meta: AiReportMeta, reportBody: string): Promise<boolean> {
  const api = cloudApi();
  if (!api?.upload) return false;
  try {
    const full = JSON.stringify({ ...meta, report: reportBody, uploaded: true, origin: 'both' });
    const sidecar = JSON.stringify({ ...meta, uploaded: true, origin: 'both' });
    const deadline = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30000));
    const run = (async () => {
      let a = await api.upload!(`${meta.id}.json`, Buffer.from(full, 'utf8'), {
        contentType: 'application/json', upsert: false,
      });
      if (a?.error && /bucket not found/i.test(a.error.message ?? '')) {
        // Bucket vanished (or startup ensure hadn't run yet) — create it and
        // retry the data file once before giving up.
        await ensureAiReportsBucket();
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
      await pruneCloudReports(MAX_SAVED);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Lists cloud history via the tiny meta sidecars (no full downloads).
// Never throws — storage trouble yields an empty list.
async function listCloudReportMetas(): Promise<AiReportMeta[]> {
  const api = cloudApi();
  if (!api?.list || !api?.download) return [];
  try {
    const deadline = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 15000));
    const run = (async (): Promise<AiReportMeta[]> => {
      const { data, error } = await api.list!('', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
      if (error || !data) return [];
      const sidecars = data
        .map((f) => f.name)
        .filter((n) => typeof n === 'string' && n.endsWith(META_SUFFIX))
        .slice(0, MAX_SAVED);
      const metas: AiReportMeta[] = [];
      for (const name of sidecars) {
        try {
          const dl = await api.download!(name);
          if (dl?.error || !dl?.data) continue;
          const buf = Buffer.isBuffer(dl.data) ? dl.data : Buffer.from(await (dl.data as Blob).arrayBuffer());
          const parsed = JSON.parse(buf.toString('utf8')) as Partial<AiReportMeta> & { id?: string };
          if (!parsed || typeof parsed.id !== 'string' || !ID_RE.test(parsed.id)) continue;
          if (!parsed.createdAt) continue;
          metas.push({
            id: parsed.id,
            createdAt: String(parsed.createdAt),
            createdBy: (parsed.createdBy as string | null) ?? null,
            source: String(parsed.source ?? 'ai'),
            provider: (parsed.provider as string | null) ?? null,
            model: (parsed.model as string | null) ?? null,
            excerpt: String(parsed.excerpt ?? ''),
            length: Number(parsed.length ?? 0) || 0,
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

// Deletes a saved report everywhere: local file plus both cloud objects
// (full + sidecar). Missing pieces are skipped, never fail the delete —
// returns true when anything was removed, false when nothing existed.
export async function deleteAiReport(id: string): Promise<boolean> {
  if (!ID_RE.test(id)) throw new AppError(400, 'Invalid report id');
  let removed = false;
  await fs.unlink(path.join(getReportsDir(), `${id}.json`)).then(
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

async function pruneCloudReports(keep: number): Promise<void> {
  const api = cloudApi();
  if (!api?.list || !api?.remove) return;
  try {
    const { data, error } = await api.list('', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
    if (error || !data) return;
    // Names embed a timestamp stamp, so descending name order ≈ newest first.
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

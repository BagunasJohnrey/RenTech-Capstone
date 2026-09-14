import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { collectStorageManifest } from './storage.service.js';
import { supabaseAdmin } from '../config/supabase.js';

// On-disk JSON backups for the admin "Data & Backups" settings tab.
// Supabase PITR remains the disaster-recovery story (see docs/BACKUPS.md);
// this is the one-click "download everything as JSON" + visible history that
// admins asked for. Files live under backend/data/backups/ (overridable via
// BACKUP_DATA_DIR so tests can point at a temp dir).

export interface BackupMeta {
  id: string;
  createdAt: string;
  createdBy: string | null;
  totalRows: number;
  tables: Record<string, number>;
  storageFiles: number;
  storageBytes: number;
  storageIncomplete: boolean;
  sizeBytes: number;
  filename: string;
  // Cloud copy (private `rentech-backups` bucket): the copy that survives
  // server restarts on hosts with ephemeral disks.
  uploaded: boolean;
  source: 'local' | 'cloud' | 'both';
}

// Private bucket holding backup JSON files + tiny `.meta.json` sidecars (the
// sidecars let the history list render without downloading every backup).
export const BACKUP_BUCKET = process.env.STORAGE_BACKUP_BUCKET || 'rentech-backups';
const META_SUFFIX = '.meta.json';
const CLOUD_KEEP = 30;

type StorageApi = {
  list?: (prefix: string, opts?: unknown) => Promise<{ data?: { name: string }[] | null; error?: { message?: string } | null }>;
  upload?: (path: string, body: unknown, opts?: unknown) => Promise<{ error?: { message?: string } | null }>;
  download?: (path: string) => Promise<{ data?: Blob | Buffer | null; error?: { message?: string } | null }>;
  remove?: (paths: string[]) => Promise<{ error?: { message?: string } | null }>;
};

function cloudApi(): StorageApi | null {
  try {
    const api = (supabaseAdmin as unknown as { storage?: { from?: (b: string) => StorageApi } })
      ?.storage?.from?.(BACKUP_BUCKET);
    return api && typeof api.list === 'function' ? api : null;
  } catch {
    return null;
  }
}

// Creates the private backups bucket on startup (called from index.ts).
// Best-effort — a failure only logs; local backups still work.
export async function ensureBackupBucket(): Promise<void> {
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const names = new Set((buckets || []).map((b) => b.name));
    if (!names.has(BACKUP_BUCKET)) {
      const { error } = await supabaseAdmin.storage.createBucket(BACKUP_BUCKET, {
        public: false,
        allowedMimeTypes: ['application/json'],
        fileSizeLimit: 25 * 1024 * 1024,
      });
      if (error) console.warn(`[backups] createBucket(${BACKUP_BUCKET}) failed:`, error.message);
      else console.log(`[backups] bucket "${BACKUP_BUCKET}" created (private)`);
    }
  } catch (err) {
    console.warn('[backups] ensureBackupBucket error:', (err as Error)?.message ?? err);
  }
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-_]*$/;

export function getBackupDir(): string {
  if (process.env.BACKUP_DATA_DIR) return process.env.BACKUP_DATA_DIR;
  return path.join(process.cwd(), 'data', 'backups');
}

export function backupFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = crypto.randomBytes(3).toString('hex');
  return `backup-${stamp}-${rand}`;
}

async function safeFind<T>(fn: () => Promise<T[] | null | undefined>): Promise<T[]> {
  try {
    const rows = await fn();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// Collects every user-data table via Prisma models (mock-friendly — each
// table is best-effort so a missing mock/table never fails the whole backup).
export async function collectBackupData() {
  const p = prisma as unknown as Record<string, { findMany?: (args?: unknown) => Promise<unknown[]> } | undefined>;
  const [smsTemplates, businessRules, profiles, inventoryItems, promoCodes, transactions, payments, notifications, sentSms, auditLogs] =
    await Promise.all([
      safeFind(() => p.smsTemplate?.findMany?.({}) ?? Promise.resolve([])),
      safeFind(() => p.businessRule?.findMany?.({}) ?? Promise.resolve([])),
      safeFind(() => p.profile?.findMany?.({}) ?? Promise.resolve([])),
      safeFind(() => p.inventoryItem?.findMany?.({}) ?? Promise.resolve([])),
      safeFind(() => (p.promoCode as { findMany?: (args?: unknown) => Promise<unknown[]> } | undefined)?.findMany?.({}) ?? Promise.resolve([])),
      safeFind(() => p.transaction?.findMany?.({}) ?? Promise.resolve([])),
      safeFind(() => p.payment?.findMany?.({}) ?? Promise.resolve([])),
      safeFind(() => p.notification?.findMany?.({}) ?? Promise.resolve([])),
      safeFind(() => p.sentSms?.findMany?.({}) ?? Promise.resolve([])),
      safeFind(() => p.auditLog?.findMany?.({}) ?? Promise.resolve([])),
    ]);
  return {
    sms_templates: smsTemplates,
    business_rules: businessRules,
    profiles,
    inventory_items: inventoryItems,
    promo_codes: promoCodes,
    transactions,
    payments,
    notifications,
    sent_sms: sentSms,
    audit_logs: auditLogs,
  };
}

function toJsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))
  );
}

export async function createBackup(createdBy: string | null = null): Promise<BackupMeta> {
  const dir = getBackupDir();
  await fs.mkdir(dir, { recursive: true });
  const tables = toJsonSafe(await collectBackupData()) as Record<string, unknown[]>;
  const counts: Record<string, number> = {};
  let totalRows = 0;
  for (const [k, v] of Object.entries(tables)) {
    counts[k] = Array.isArray(v) ? v.length : 0;
    totalRows += counts[k];
  }
  // Storage manifest (both buckets, metadata only — never binary bytes).
  // Best-effort: a storage blip yields an incomplete manifest, never a
  // failed backup.
  const storage = await collectStorageManifest();
  const id = backupFilename();
  const createdAt = new Date().toISOString();
  const payload = { version: 2 as const, id, createdAt, createdBy, tables, storage };
  const filename = `${id}.json`;
  const filePath = path.join(dir, filename);
  const body = JSON.stringify(payload, null, 2);
  await fs.writeFile(filePath, body, 'utf8');
  const stat = await fs.stat(filePath);
  // Keep history bounded — last 20 backups; prune oldest first.
  await pruneBackups(dir, 20);
  const meta: BackupMeta = {
    id, createdAt, createdBy, totalRows, tables: counts,
    storageFiles: storage.fileCount, storageBytes: storage.totalBytes,
    storageIncomplete: storage.incomplete, sizeBytes: stat.size, filename,
    uploaded: false, source: 'local',
  };
  // Cloud copy (the one that survives ephemeral disks). Best-effort — a
  // storage blip leaves uploaded:false, never fails the backup.
  meta.uploaded = await uploadBackupToCloud(meta, body);
  if (meta.uploaded) {
    meta.source = 'both';
    await markUploaded(dir, meta.id);
  } else {
    console.warn(`[backups] ${meta.id} kept on server only (cloud upload failed)`);
  }
  return meta;
}

async function readMeta(dir: string, filename: string, uploadedIds?: Set<string>): Promise<BackupMeta | null> {
  if (!filename.endsWith('.json')) return null;
  const id = filename.slice(0, -5);
  if (!ID_RE.test(id)) return null;
  try {
    const [stat, raw] = await Promise.all([
      fs.stat(path.join(dir, filename)),
      fs.readFile(path.join(dir, filename), 'utf8'),
    ]);
    const parsed = JSON.parse(raw) as {
      id?: string;
      createdAt?: string;
      createdBy?: string | null;
      tables?: Record<string, unknown[]>;
      storage?: { fileCount?: number; totalBytes?: number; incomplete?: boolean };
    };
    const tables = parsed.tables && typeof parsed.tables === 'object' ? parsed.tables : {};
    const counts: Record<string, number> = {};
    let totalRows = 0;
    for (const [k, v] of Object.entries(tables)) {
      counts[k] = Array.isArray(v) ? v.length : 0;
      totalRows += counts[k];
    }
    // v1 backups predate the storage manifest — default to zeros.
    const storageFiles = Number(parsed.storage?.fileCount ?? 0) || 0;
    const storageBytes = Number(parsed.storage?.totalBytes ?? 0) || 0;
    const uploaded = uploadedIds?.has(id) ?? false;
    return {
      id,
      createdAt: parsed.createdAt ?? stat.mtime.toISOString(),
      createdBy: parsed.createdBy ?? null,
      totalRows,
      tables: counts,
      storageFiles,
      storageBytes,
      storageIncomplete: Boolean(parsed.storage?.incomplete),
      sizeBytes: stat.size,
      filename,
      uploaded,
      source: uploaded ? 'both' : 'local',
    };
  } catch {
    return null;
  }
}

// Merges local + cloud history: cloud-only entries appear with source
// 'cloud', entries present in both become 'both'. Exported for unit tests.
export function mergeBackupLists(local: BackupMeta[], cloud: BackupMeta[]): BackupMeta[] {
  const byId = new Map(local.map((m) => [m.id, m]));
  for (const c of cloud) {
    const existing = byId.get(c.id);
    if (existing) {
      existing.uploaded = true;
      existing.source = 'both';
    } else {
      byId.set(c.id, c);
    }
  }
  const metas = [...byId.values()];
  metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return metas;
}

export async function listBackups(limit = 20): Promise<BackupMeta[]> {
  const dir = getBackupDir();
  let local: BackupMeta[] = [];
  try {
    await fs.mkdir(dir, { recursive: true });
    const uploadedIds = await readUploadRegistry(dir);
    const files = await fs.readdir(dir);
    local = (
      await Promise.all(files.map((f) => readMeta(dir, f, uploadedIds)))
    ).filter((m): m is BackupMeta => m !== null);
  } catch {
    local = [];
  }
  // Merge the cloud copies (source of truth on ephemeral disks): cloud-only
  // entries appear with source 'cloud', entries present in both become 'both'.
  const metas = mergeBackupLists(local, await listCloudBackupMetas());
  return metas.slice(0, limit);
}

async function pruneBackups(dir: string, keep: number): Promise<void> {
  try {
    const all = await listBackups(Number.MAX_SAFE_INTEGER);
    for (const extra of all.slice(keep)) {
      await fs.unlink(path.join(dir, extra.filename)).catch(() => {});
    }
  } catch {
    // pruning is best-effort — never fail a backup because of it
  }
}

export function assertBackupId(id: string): void {
  if (!ID_RE.test(id)) throw new AppError(400, 'Invalid backup id');
}

export async function getBackupPath(id: string): Promise<string> {
  assertBackupId(id);
  const filePath = path.join(getBackupDir(), `${id}.json`);
  try {
    await fs.stat(filePath);
  } catch {
    throw new AppError(404, 'Backup not found');
  }
  return filePath;
}

// Reads backup bytes for download: local file first, cloud copy as fallback
// (covers restarts on ephemeral disks). Throws 404 when found nowhere.
export async function getBackupBytes(id: string): Promise<Buffer> {
  assertBackupId(id);
  try {
    return await fs.readFile(path.join(getBackupDir(), `${id}.json`));
  } catch {
    // fall through to cloud
  }
  const api = cloudApi();
  if (api?.download) {
    try {
      const { data, error } = await api.download(`${id}.json`);
      if (!error && data) {
        if (Buffer.isBuffer(data)) return data;
        if (data instanceof Uint8Array) return Buffer.from(data);
        const buf = Buffer.from(await (data as Blob).arrayBuffer());
        if (buf.length > 0) return buf;
      }
    } catch {
      // fall through to 404
    }
  }
  throw new AppError(404, 'Backup not found');
}

// Uploads one backup (data + meta sidecar) to the private bucket. Returns
// whether the cloud copy landed — never throws.
async function uploadBackupToCloud(meta: BackupMeta, jsonBody: string): Promise<boolean> {
  const api = cloudApi();
  if (!api?.upload) return false;
  try {
    const sidecar = JSON.stringify({ ...meta, uploaded: true, source: 'both' });
    const deadline = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30000));
    const run = (async () => {
      let a = await api.upload!(`${meta.id}.json`, Buffer.from(jsonBody, 'utf8'), {
        contentType: 'application/json', upsert: false,
      });
      if (a?.error && /bucket not found/i.test(a.error.message ?? '')) {
        // Bucket vanished (or startup ensure hadn't run yet) — create it and
        // retry the data file once before giving up.
        await ensureBackupBucket();
        a = await api.upload!(`${meta.id}.json`, Buffer.from(jsonBody, 'utf8'), {
          contentType: 'application/json', upsert: false,
        });
      }
      if (a?.error) return `data: ${a.error.message ?? 'unknown'}`;
      // The sidecar may be rewritten (re-uploads) — upsert allowed.
      const b = await api.upload!(`${meta.id}${META_SUFFIX}`, Buffer.from(sidecar, 'utf8'), {
        contentType: 'application/json', upsert: true,
      });
      if (b?.error) return `sidecar: ${b.error.message ?? 'unknown'}`;
      return true;
    })();
    const ok = await Promise.race([run, deadline]);
    if (ok === true) {
      await pruneCloudBackups(CLOUD_KEEP);
      return true;
    }
    console.warn(`[backups] cloud upload of ${meta.id} did not complete (${ok})`);
    return false;
  } catch (err) {
    console.warn(`[backups] cloud upload of ${meta.id} failed:`, (err as Error)?.message ?? err);
    return false;
  }
}

// Re-uploads an existing local backup file to the cloud (retry for rows stuck
// at "server only"). Returns the updated meta; throws 404 when the local file
// is gone, 502 when the cloud copy still won't land (reason is logged).
// Successful uploads are recorded in a local registry (`.uploads.json`) so
// the row keeps rendering "cloud ✓" without mutating the backup file itself.
export async function uploadExistingBackup(id: string): Promise<BackupMeta> {
  assertBackupId(id);
  const dir = getBackupDir();
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, `${id}.json`), 'utf8');
  } catch {
    throw new AppError(404, 'Backup not found on this server');
  }
  const local = await readMeta(dir, `${id}.json`, await readUploadRegistry(dir));
  if (!local) throw new AppError(404, 'Backup not found on this server');
  if (local.uploaded) return { ...local, source: 'both' as const };
  const ok = await uploadBackupToCloud(local, raw);
  if (!ok) throw new AppError(502, 'Cloud upload failed — check the server logs and try again');
  await markUploaded(dir, id);
  return { ...local, uploaded: true, source: 'both' as const };
}

const REGISTRY_FILE = '.uploads.json';

async function readUploadRegistry(dir: string): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(path.join(dir, REGISTRY_FILE), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((v): v is string => typeof v === 'string'));
    if (parsed && typeof parsed === 'object') {
      return new Set(Object.keys(parsed as Record<string, unknown>));
    }
  } catch {
    // missing/corrupt registry — treat as empty
  }
  return new Set();
}

async function markUploaded(dir: string, id: string): Promise<void> {
  try {
    const ids = await readUploadRegistry(dir);
    ids.add(id);
    await fs.writeFile(path.join(dir, REGISTRY_FILE), JSON.stringify([...ids]), 'utf8');
  } catch {
    // registry is cosmetic — the cloud copy already landed
  }
}

// Lists cloud history via the tiny meta sidecars (no full downloads).
// Never throws — storage trouble yields an empty list.
async function listCloudBackupMetas(): Promise<BackupMeta[]> {
  const api = cloudApi();
  if (!api?.list || !api?.download) return [];
  try {
    const deadline = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 15000));
    const run = (async (): Promise<BackupMeta[]> => {
      const { data, error } = await api.list!('', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
      if (error || !data) return [];
      const sidecars = data
        .map((f) => f.name)
        .filter((n) => typeof n === 'string' && n.endsWith(META_SUFFIX))
        .slice(0, CLOUD_KEEP);
      const metas: BackupMeta[] = [];
      for (const name of sidecars) {
        try {
          const dl = await api.download!(name);
          if (dl?.error || !dl?.data) continue;
          const buf = Buffer.isBuffer(dl.data)
            ? dl.data
            : Buffer.from(await (dl.data as Blob).arrayBuffer());
          const parsed = JSON.parse(buf.toString('utf8')) as Partial<BackupMeta> & { id?: string };
          if (!parsed || typeof parsed.id !== 'string' || !ID_RE.test(parsed.id)) continue;
          metas.push({
            id: parsed.id,
            createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
            createdBy: (parsed.createdBy as string | null) ?? null,
            totalRows: Number(parsed.totalRows ?? 0) || 0,
            tables: parsed.tables && typeof parsed.tables === 'object' ? parsed.tables : {},
            storageFiles: Number(parsed.storageFiles ?? 0) || 0,
            storageBytes: Number(parsed.storageBytes ?? 0) || 0,
            storageIncomplete: Boolean(parsed.storageIncomplete),
            sizeBytes: Number(parsed.sizeBytes ?? 0) || 0,
            filename: `${parsed.id}.json`,
            uploaded: true,
            source: 'cloud',
          });
        } catch {
          continue;
        }
      }
      return metas.filter((m) => m.createdAt !== '');
    })();
    const result = await Promise.race([run, deadline]);
    return result === 'timeout' ? [] : result;
  } catch {
    return [];
  }
}

async function pruneCloudBackups(keep: number): Promise<void> {
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

const AUTO_BACKUP_RULE = 'auto_backup_last_run';
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Daily automatic backup (run from the index.ts scheduler). Skips when the
// last successful run was within 24h (persisted in BusinessRule so restarts
// don't double-run). Never throws — failures only log.
export async function runAutoBackup(): Promise<{ skipped: boolean; id?: string }> {
  try {
    const db = prisma as unknown as {
      businessRule?: {
        findUnique?: (args: unknown) => Promise<{ value?: string } | null>;
        upsert?: (args: unknown) => Promise<unknown>;
      };
    };
    const last = await db.businessRule?.findUnique?.({ where: { key: AUTO_BACKUP_RULE } });
    const lastAt = last?.value ? Date.parse(last.value) : NaN;
    if (Number.isFinite(lastAt) && Date.now() - lastAt < AUTO_BACKUP_INTERVAL_MS) {
      return { skipped: true };
    }
    const meta = await createBackup(null);
    await db.businessRule?.upsert?.({
      where: { key: AUTO_BACKUP_RULE },
      update: { value: meta.createdAt },
      create: { key: AUTO_BACKUP_RULE, value: meta.createdAt, description: 'Last successful automatic daily backup' },
    });
    try {
      const { createAuditLog } = await import('../utils/audit.js');
      await createAuditLog({
        action: 'backup.auto', entity: 'backup', entityId: meta.id, performedById: null,
        newValue: { totalRows: meta.totalRows, storageFiles: meta.storageFiles, uploaded: meta.uploaded },
      });
    } catch {
      // audit is best-effort
    }
    console.log(`[AutoBackup] saved ${meta.id} (${meta.totalRows} rows, cloud ${meta.uploaded ? 'OK' : 'FAILED'})`);
    return { skipped: false, id: meta.id };
  } catch (err) {
    console.error('[AutoBackup] failed:', (err as Error)?.message ?? err);
    return { skipped: true };
  }
}

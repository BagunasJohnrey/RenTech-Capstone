import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/errorHandler.js';
import { compressImage, coerceExtension, makeThumb, thumbKeyFor } from '../utils/imageCompress.js';

// Object keys are unique per upload (Date.now()/uuid/seed-stable content),
// so a long browser/CDN cache lifetime is safe — a replaced photo always
// lands under a new key (upsert is false everywhere below).
const CACHE_CONTROL = '2592000'; // 30 days in seconds

// Two-bucket split (Sept 2026 optimization):
//   - CATALOG_BUCKET (public): item/catalog photos — `seed/`, `catalog/`,
//     `thumbs/`, and legacy flat upload keys. Served via stable public URLs
//     (zero signing round-trips, browser + service-worker cacheable).
//   - BUCKET_NAME (private): `rental/` condition shots (release/return
//     evidence) — signed-URL-only, never public.
// Routing is by key prefix so no caller or DB change was needed.
const BUCKET_NAME = process.env.STORAGE_BUCKET || 'rentech-images';
const CATALOG_BUCKET = process.env.STORAGE_CATALOG_BUCKET || 'rentech-catalog';

// Condition evidence lives here; everything else is catalog content.
export function isConditionPath(path: string): boolean {
  return path.startsWith('rental/');
}

export function bucketFor(path: string): string {
  return isConditionPath(path) ? BUCKET_NAME : CATALOG_BUCKET;
}
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const FILE_SIZE_LIMIT = 20 * 1024 * 1024; // 20MB

// Only these extensions are acceptable — every upload is an image.
const ALLOWED_EXT = /\.(jpe?g|png|webp)$/i;
// Allowed object keys: alnum, - _ . / separators (e.g. "1734...-gown.jpg"
// or "rental/<uuid>/return-....jpg"). Relative traversal is rejected.
const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

export function assertSafeUploadPath(fileName: string): void {
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 220) {
    throw new AppError(400, 'Invalid file name');
  }
  if (!SAFE_KEY.test(fileName)) {
    throw new AppError(400, 'Invalid file name');
  }
  // Reject path traversal and hidden/control entries outright.
  if (fileName.includes('..') || fileName.includes('\\') || fileName.includes('\u0000')) {
    throw new AppError(400, 'Invalid file name');
  }
  for (const seg of fileName.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') throw new AppError(400, 'Invalid file name');
  }
  if (!ALLOWED_EXT.test(fileName)) {
    throw new AppError(400, 'Only jpeg/png/webp images are allowed');
  }
}

export async function ensureBucket() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const names = new Set((buckets || []).map((b) => b.name));
  try {
    await ensureOneBucket(names.has(BUCKET_NAME), BUCKET_NAME, false);
    await ensureOneBucket(names.has(CATALOG_BUCKET), CATALOG_BUCKET, true);
  } catch (err) {
    console.warn('[storage] ensureBucket error:', err);
  }
}

async function ensureOneBucket(exists: boolean, name: string, isPublic: boolean) {
  if (!exists) {
    const { error } = await supabaseAdmin.storage.createBucket(name, {
      public: isPublic,
      allowedMimeTypes: ALLOWED_MIME,
      fileSizeLimit: FILE_SIZE_LIMIT,
    });
    if (error) console.warn(`[storage] createBucket(${name}) failed:`, error.message);
  } else {
    // Re-apply limits in case the bucket predates the current config
    // (e.g. an older 5MB cap that rejects normal phone photos).
    const { error } = await supabaseAdmin.storage.updateBucket(name, {
      public: isPublic,
      allowedMimeTypes: ALLOWED_MIME,
      fileSizeLimit: FILE_SIZE_LIMIT,
    });
    if (error) console.warn(`[storage] updateBucket(${name}) failed:`, error.message);
  }
}

// Stable public URL for catalog objects — pure string concat (exactly what
// storage-js getPublicUrl builds), no Supabase call, safe to hand to <img>
// (long cache headers are set at upload; keys are unique per upload).
export function getPublicUrl(path: string): string {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${CATALOG_BUCKET}/${path}`;
}

// Server-side upload: the browser sends the file bytes (base64) to our API,
// and we write them to Supabase Storage using the service-role client. This
// avoids the fragile browser->Supabase signed-upload-URL + CORS flow.
export async function uploadFile(fileName: string, contentType: string, buffer: Buffer) {
  // M4: enforce the server-side allowlist on every upload (the caller-side
  // zod schema alone is not a guarantee — this is the last line of defense).
  assertSafeUploadPath(fileName);

  if (!ALLOWED_MIME.includes(contentType)) {
    throw new AppError(400, 'Only jpeg/png/webp images are allowed');
  }
  if (!Number.isInteger(buffer.length) || buffer.length === 0 || buffer.length > FILE_SIZE_LIMIT) {
    throw new AppError(400, 'Image file is empty or exceeds the 20MB limit');
  }

  // Server-side compression (defense in depth): the client downsizes via
  // canvas before upload, but a direct API call, a canvas failure, or a
  // future client would otherwise land a full-size image in the bucket.
  // Everything is auto-rotated, EXIF-stripped, bounded to IMAGE_MAX_DIM, and
  // normalized to WebP; already-compliant client WebPs skip the re-encode.
  const compressed = await compressImage(buffer, contentType);
  buffer = compressed.buffer;
  contentType = compressed.contentType;
  fileName = coerceExtension(fileName, compressed.ext);

  // Safety net — compression always shrinks, but never trust it blindly.
  if (buffer.length === 0 || buffer.length > FILE_SIZE_LIMIT) {
    throw new AppError(400, 'Image file is empty or exceeds the 20MB limit');
  }

  // Supabase's storage API occasionally fails a request transiently (network
  // blip, cold pooler, 5xx) — a single attempt surfaces that as a hard 500 to
  // the user (e.g. the release-photo upload failing on Render). Retry up to 2
  // extra times before giving up.
  //
  // "The resource already exists" is treated as SUCCESS: object keys are
  // unique per attempt (Date.now()/uuid paths), so a collision can only mean
  // this same logical upload previously landed but its follow-up request
  // (e.g. PUT /transactions/:id/release) failed — the user retried and the
  // bytes are already in the bucket. Returning the path makes the retry
  // idempotent instead of stranding the flow with a 500.
  const bucket = bucketFor(fileName);
  let data: { path: string } | null = null;
  let lastError: { message?: string; statusCode?: string | number } | null = null;
  for (let attempt = 0; attempt < 3 && !data; attempt++) {
    let result: { data: { path: string } | null; error: { message?: string; statusCode?: string | number } | null };
    try {
      result = await supabaseAdmin.storage
        .from(bucket)
        .upload(fileName, buffer, { contentType, upsert: false, cacheControl: CACHE_CONTROL });
    } catch (err) {
      // Transport-level THROW (fetch failed, timeout, socket reset — e.g. a
      // pooler blip): storage-js throws instead of returning { error }, which
      // used to escape the retry loop as an instant generic 500. Classify and
      // retry 503-class failures like the returned-error path below.
      const message = (err as Error)?.message ?? String(err);
      lastError = { message };
      if (storageErrorStatus({ message }) === 503 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      console.error('[storage] upload threw:', message, { fileName, bytes: buffer.length });
      throw new AppError(
        storageErrorStatus({ message }) === 503 ? 503 : 500,
        storageErrorStatus({ message }) === 503
          ? 'Image service temporarily unavailable — please try again'
          : 'Failed to upload image — please try again',
        // Dev-only detail (errorHandler strips `details` outside development)
        // so the client Preview shows the underlying storage reason.
        { supabaseMessage: message, fileName, bytes: buffer.length }
      );
    }
    if (result.error) {
      lastError = result.error;
      if (/already exists|duplicate/i.test(result.error.message ?? '')) {
        data = { path: fileName };
        break;
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    } else {
      data = result.data;
    }
  }

  if (!data) {
    // C6: static message — the Supabase error may echo internal bucket/object
    // details; log the full detail server-side only.
    console.error('[storage] upload failed:', lastError?.message, {
      statusCode: lastError?.statusCode,
      fileName,
      bytes: buffer.length,
    });
    throw new AppError(500, 'Failed to upload image — please try again',
      // Dev-only detail (errorHandler strips `details` outside development)
      // so the client Preview shows the underlying storage reason.
      { supabaseMessage: lastError?.message, statusCode: lastError?.statusCode, fileName, bytes: buffer.length });
  }

  // Grid-thumbnail derivative (`thumbs/<path>.webp`). Best-effort: grids
  // fall back to the full image when the thumb is absent, so a thumb failure
  // must never fail the item photo itself — it is logged for ops instead.
  let thumbPath: string | null = null;
  try {
    const thumbBytes = await makeThumb(buffer);
    const thumbKey = thumbKeyFor(data.path);
    const { error: thumbError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(thumbKey, thumbBytes, { contentType: 'image/webp', upsert: false, cacheControl: CACHE_CONTROL });
    if (thumbError) {
      if (/already exists|duplicate/i.test(thumbError.message ?? '')) {
        thumbPath = thumbKey; // idempotent retry — bytes already landed
      } else {
        console.warn('[storage] thumb upload failed:', thumbError.message, { thumbKey });
      }
    } else {
      thumbPath = thumbKey;
    }
  } catch (err) {
    console.warn('[storage] thumb generation failed:', (err as Error)?.message ?? err, { fileName });
  }

  return { path: data.path, thumbPath };
}

export async function getDownloadUrl(path: string) {
  // Catalog objects are public — hand out the stable URL with no Supabase
  // round-trip. Only `rental/` condition shots go through signing.
  if (!isConditionPath(path)) {
    return { url: getPublicUrl(path), public: true as const };
  }
  let data: { signedUrl: string } | null;
  let error: unknown;
  try {
    ({ data, error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .createSignedUrl(path, 3600));
  } catch (err) {
    // Transport-level failure (DNS, connection reset, timeout, paused
    // project): storage-js throws instead of returning { error }.
    // The bucket is logged so a wrong-bucket misconfiguration (e.g. a stale
    // STORAGE_BUCKET in a long-lived dev process) is distinguishable from a
    // genuinely missing object without a second debugging round.
    console.error(`[storage] createSignedUrl threw for "${path}" in bucket "${BUCKET_NAME}":`, (err as Error)?.message ?? err);
    throw new AppError(503, 'Image service temporarily unavailable — please try again');
  }

  if (error) {
    // Log the real Supabase error so ops can distinguish "file missing" from
    // "auth failure" / "bucket not found" / network issues. The bucket is
    // included for the same stale-env reason as above.
    const errRec = error as { message?: unknown; status?: unknown; statusCode?: unknown };
    const message = typeof errRec?.message === 'string' ? errRec.message : String(errRec?.message ?? '');
    console.error(`[storage] createSignedUrl failed for "${path}" in bucket "${BUCKET_NAME}":`, message, error);
    const status = storageErrorStatus(errRec);
    if (status === 503) {
      throw new AppError(503, 'Image service temporarily unavailable — please try again');
    }
    if (status === 500) {
      throw new AppError(500, 'Image storage is not configured');
    }
    throw new AppError(404, 'File not found');
  }

  return { url: data!.signedUrl };
}

// Supabase storage-js funnels BOTH genuine misses ("Object not found") and
// transport/upstream failures through the same { error } channel — and the
// old code mapped everything to 404, which twice sent debugging down the
// wrong path (missing-file vs unreachable-storage look identical from the
// client). Classify so the status tells ops which one it is:
//   503 — transient: 5xx / 429 / network errors (retryable, do NOT reseed)
//   500 — bucket-level misconfiguration (wrong project / bucket deleted)
//   404 — the object genuinely isn't in this bucket
// Exported for unit tests.
export function storageErrorStatus(error: {
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
}): 404 | 500 | 503 {
  const toNum = (v: unknown): number | null => {
    const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const status = toNum((error as { status?: unknown })?.status)
    ?? toNum((error as { statusCode?: unknown })?.statusCode);
  if (status !== null && (status === 429 || (status >= 500 && status <= 599))) return 503;
  const msg = typeof error?.message === 'string' ? error.message : String(error?.message ?? '');
  if (/fetch failed|network|socket|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timed out|timeout|temporarily unavailable|Bad Gateway|Service Unavailable|Gateway Timeout/i.test(msg)) {
    return 503;
  }
  if (/bucket not found|invalid bucket|bucket.*does not exist/i.test(msg)) {
    return 500;
  }
  return 404;
}

// ── Backup manifest ───────────────────────────────────────────────────────
// Recursive file inventory of both buckets for the admin one-click backup.
// Returns best-effort metadata (bucket/path/size/updatedAt) — NEVER the
// binary bytes (those would explode the JSON and time out the download).
// Binaries stay covered by Supabase PITR + backend/backup-storage.cjs.
// This never throws: any failure yields an empty/incomplete manifest so a
// storage blip can never fail the whole backup.
export interface StorageManifestFile {
  bucket: string;
  path: string;
  size: number | null;
  updatedAt: string | null;
}

export interface StorageManifest {
  files: StorageManifestFile[];
  fileCount: number;
  totalBytes: number;
  incomplete: boolean;
}

type StorageListEntry = {
  name: string;
  id?: string | null;
  updated_at?: string | null;
  metadata?: { size?: number | null } | null;
};

async function listBucketRecursive(bucket: string, prefix: string, out: StorageManifestFile[]): Promise<void> {
  const client = supabaseAdmin as unknown as {
    storage?: { from?: (b: string) => { list?: (p: string, opts?: unknown) => Promise<{ data?: StorageListEntry[] | null; error?: { message?: string } | null }> } };
  };
  const api = client?.storage?.from?.(bucket);
  if (!api?.list) return;
  let offset = 0;
  const pageSize = 100;
  for (;;) {
    let data: StorageListEntry[] | null | undefined;
    let error: { message?: string } | null | undefined;
    try {
      ({ data, error } = await api.list(prefix, {
        limit: pageSize,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }));
    } catch {
      return; // transport failure — keep whatever was collected so far
    }
    if (error || !data || data.length === 0) return;
    for (const entry of data) {
      if (!entry || typeof entry.name !== 'string' || entry.name.length === 0) continue;
      const fullPath = prefix ? `${prefix}${entry.name}` : entry.name;
      if (entry.id == null) {
        // Folder placeholder — descend (guard against pathological depth).
        if (fullPath.split('/').length < 12) {
          await listBucketRecursive(bucket, `${fullPath}/`, out);
        }
        continue;
      }
      out.push({
        bucket,
        path: fullPath,
        size: typeof entry.metadata?.size === 'number' ? entry.metadata.size : null,
        updatedAt: entry.updated_at ?? null,
      });
    }
    if (data.length < pageSize) return;
    offset += pageSize;
    if (offset > 10000) return; // sanity cap — ~10k objects per bucket
  }
}

// Collects the manifest for both buckets with an overall deadline so a slow
// storage API can't hold the backup request open. Buckets are attempted
// independently — one failing still returns the other's files.
export async function collectStorageManifest(timeoutMs = 15000): Promise<StorageManifest> {
  const files: StorageManifestFile[] = [];
  let incomplete = false;
  const buckets = [CATALOG_BUCKET, BUCKET_NAME];
  const run = (async () => {
    await Promise.all(
      buckets.map(async (bucket) => {
        try {
          await listBucketRecursive(bucket, '', files);
        } catch {
          incomplete = true;
        }
      })
    );
  })();
  const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
  const result = await Promise.race([run.then(() => 'done' as const), timer]);
  if (result === 'timeout') incomplete = true;
  // Deterministic order for stable diffs.
  files.sort((a, b) => (a.bucket === b.bucket ? (a.path < b.path ? -1 : 1) : a.bucket < b.bucket ? -1 : 1));
  const totalBytes = files.reduce((s, f) => s + (typeof f.size === 'number' ? f.size : 0), 0);
  return { files, fileCount: files.length, totalBytes, incomplete };
}

// Remove a stored object. Best-effort — a missing/bogus path must not fail the
// caller's delete flow, so errors are logged and swallowed.
export async function removeObject(path: string) {
  try {
    if (!path || /^https?:\/\//.test(path)) return; // absolute URLs aren't bucket objects
    const bucket = bucketFor(path);
    const { error } = await supabaseAdmin.storage.from(bucket).remove([path]);
    if (error) {
      console.warn('[storage] removeObject failed:', error.message);
      return;
    }
    // Best-effort thumb cleanup alongside the full image (catalog only —
    // condition shots have no thumbs served, but removing a stale one is
    // harmless, so attempt uniformly).
    const { error: thumbError } = await supabaseAdmin.storage.from(bucket).remove([thumbKeyFor(path)]);
    if (thumbError) console.warn('[storage] removeObject thumb failed:', thumbError.message);
  } catch (err) {
    console.warn('[storage] removeObject error:', err);
  }
}

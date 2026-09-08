import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/errorHandler.js';
import { compressImage, coerceExtension } from '../utils/imageCompress.js';

const BUCKET_NAME = process.env.STORAGE_BUCKET || 'rentech-images';
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
  const exists = buckets?.some((b) => b.name === BUCKET_NAME);
  try {
    if (!exists) {
      const { error } = await supabaseAdmin.storage.createBucket(BUCKET_NAME, {
        public: false,
        allowedMimeTypes: ALLOWED_MIME,
        fileSizeLimit: FILE_SIZE_LIMIT,
      });
      if (error) console.warn('[storage] createBucket failed:', error.message);
    } else {
      // Re-apply limits in case the bucket predates the current config
      // (e.g. an older 5MB cap that rejects normal phone photos).
      const { error } = await supabaseAdmin.storage.updateBucket(BUCKET_NAME, {
        public: false,
        allowedMimeTypes: ALLOWED_MIME,
        fileSizeLimit: FILE_SIZE_LIMIT,
      });
      if (error) console.warn('[storage] updateBucket failed:', error.message);
    }
  } catch (err) {
    console.warn('[storage] ensureBucket error:', err);
  }
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
  // normalized to JPEG; already-compliant client JPEGs skip the re-encode.
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
  let data: { path: string } | null = null;
  let lastError: { message?: string; statusCode?: string | number } | null = null;
  for (let attempt = 0; attempt < 3 && !data; attempt++) {
    const result = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, { contentType, upsert: false });
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
    throw new AppError(500, 'Failed to upload image — please try again');
  }

  return { path: data.path };
}

export async function getDownloadUrl(path: string) {
  let data: { signedUrl: string } | null;
  let error: unknown;
  try {
    ({ data, error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .createSignedUrl(path, 3600));
  } catch (err) {
    // Transport-level failure (DNS, connection reset, timeout, paused
    // project): storage-js throws instead of returning { error }.
    console.error(`[storage] createSignedUrl threw for "${path}":`, (err as Error)?.message ?? err);
    throw new AppError(503, 'Image service temporarily unavailable — please try again');
  }

  if (error) {
    // Log the real Supabase error so ops can distinguish "file missing" from
    // "auth failure" / "bucket not found" / network issues.
    const errRec = error as { message?: unknown; status?: unknown; statusCode?: unknown };
    const message = typeof errRec?.message === 'string' ? errRec.message : String(errRec?.message ?? '');
    console.error(`[storage] createSignedUrl failed for "${path}":`, message, error);
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

// Remove a stored object. Best-effort — a missing/bogus path must not fail the
// caller's delete flow, so errors are logged and swallowed.
export async function removeObject(path: string) {
  try {
    if (!path || /^https?:\/\//.test(path)) return; // absolute URLs aren't bucket objects
    const { error } = await supabaseAdmin.storage.from(BUCKET_NAME).remove([path]);
    if (error) console.warn('[storage] removeObject failed:', error.message);
  } catch (err) {
    console.warn('[storage] removeObject error:', err);
  }
}

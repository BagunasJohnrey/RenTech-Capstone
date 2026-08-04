import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/errorHandler.js';

const BUCKET_NAME = 'rentech-images';
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

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(fileName, buffer, { contentType, upsert: false });

  if (error) {
    // upsert:false — a key collision now reports cleanly instead of silently
    // overwriting someone else's file (overwrite allowed only via the
    // explicit update flow, which we don't expose on purpose).
    // C6: static message — the Supabase error text may echo internal
    // bucket/object details; log it server-side only.
    console.error('[storage] upload failed:', error.message);
    throw new AppError(500, 'Failed to upload image');
  }

  return { path: data.path };
}

export async function getDownloadUrl(path: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, 3600);

  if (error) {
    throw new AppError(404, 'File not found');
  }

  return { url: data.signedUrl };
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

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/errorHandler.js';

const BUCKET_NAME = 'rentech-images';
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const FILE_SIZE_LIMIT = 20 * 1024 * 1024; // 20MB

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
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(fileName, buffer, { contentType, upsert: true });

  if (error) {
    throw new AppError(500, `Failed to upload image: ${error.message}`);
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

import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

// Server-side image normalization. Every upload is transcode-checked here so
// the bucket only ever holds bounded, privacy-safe derivatives:
//   - auto-rotated via the EXIF orientation tag, then EXIF fully stripped
//     (removes GPS coords + device identifiers)
//   - downscaled to at most IMAGE_MAX_DIM px on the longest edge
//     (withoutEnlargement — small images are never upscaled)
//   - re-encoded as JPEG (mozjpeg) at IMAGE_JPEG_QUALITY
//
// The client already downsizes via canvas (frontend/src/utils/file.js) for
// fast uploads; this is the server-side safety net that catches direct API
// calls, canvas failures, and future clients.

export interface CompressResult {
  buffer: Buffer;
  contentType: 'image/jpeg';
  ext: '.jpg';
}

// Skip the lossy re-encode when the input is already a JPEG within bounds —
// the client-side canvas pass (q85) already produced a compliant derivative,
// and re-encoding would only add generational quality loss for no size win.
function isAlreadyCompliant(info: Metadata, contentType: string): boolean {
  return (
    contentType === 'image/jpeg' &&
    (info.width ?? 0) <= env.IMAGE_MAX_DIM &&
    (info.height ?? 0) <= env.IMAGE_MAX_DIM
  );
}

export async function compressImage(buffer: Buffer, contentType: string): Promise<CompressResult> {
  let meta: Metadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    // Undecodable bytes (corrupt header, HEIC without libvips HEIF support,
    // or a non-image payload that lied about its content type).
    throw new AppError(400, 'Unsupported image format — upload a valid jpeg/png/webp image');
  }

  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) {
    throw new AppError(400, 'Unsupported image format — upload a valid jpeg/png/webp image');
  }

  // Already-small JPEGs (typical client-compressed output) skip the
  // transcode — sharp still would have stripped EXIF, but re-encoding is
  // pure quality loss. EXIF on these is rare and bounded by our own client.
  if (isAlreadyCompliant(meta, contentType)) {
    return { buffer, contentType: 'image/jpeg', ext: '.jpg' };
  }

  try {
    const { data } = await sharp(buffer)
      .rotate() // auto-rotate via EXIF orientation, then strip EXIF
      .resize({
        width: env.IMAGE_MAX_DIM,
        height: env.IMAGE_MAX_DIM,
        fit: 'inside', // preserve aspect ratio, bound the longest edge
        withoutEnlargement: true, // never upscale small images
      })
      .jpeg({ quality: env.IMAGE_JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return { buffer: data, contentType: 'image/jpeg', ext: '.jpg' };
  } catch {
    throw new AppError(400, 'Unsupported image format — upload a valid jpeg/png/webp image');
  }
}

// Rewrite the object key's extension to match the transcoded bytes (a
// `.png` name holding JPEG bytes confuses caches and Content-Type sniffers;
// Supabase serves the stored contentType header, but the key should agree).
export function coerceExtension(fileName: string, ext: '.jpg'): string {
  return fileName.replace(/\.[^.]+$/, ext);
}

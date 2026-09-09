import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

// Server-side image normalization. Every upload is transcode-checked here so
// the bucket only ever holds bounded, privacy-safe WebP derivatives:
//   - auto-rotated via the EXIF orientation tag, then EXIF fully stripped
//     (removes GPS coords + device identifiers)
//   - downscaled to at most IMAGE_MAX_DIM px on the longest edge
//     (withoutEnlargement — small images are never upscaled)
//   - re-encoded as WebP at IMAGE_WEBP_QUALITY (~30% smaller than the old
//     mozjpeg output at comparable quality)
//
// The client already downsizes via canvas (frontend/src/utils/file.js) for
// fast uploads; this is the server-side safety net that catches direct API
// calls, canvas failures, and future clients.

export interface CompressResult {
  buffer: Buffer;
  contentType: 'image/webp';
  ext: '.webp';
}

// Skip the lossy re-encode when the input is already a WebP within bounds —
// re-encoding would only add generational quality loss for no size win.
// (Client canvas output is JPEG, so it still takes the one-time WebP
// transcode below; that single generation is the price of the format move.)
function isAlreadyCompliant(info: Metadata, contentType: string): boolean {
  return (
    contentType === 'image/webp' &&
    metaFormatIsWebp(info) &&
    (info.width ?? 0) <= env.IMAGE_MAX_DIM &&
    (info.height ?? 0) <= env.IMAGE_MAX_DIM
  );
}

function metaFormatIsWebp(info: Metadata): boolean {
  return info.format === 'webp';
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

  // Already-small WebPs within bounds skip the transcode — re-encoding is
  // pure quality loss. (EXIF on these is stripped by whoever encoded them;
  // our own client sends JPEG, which always takes the transcode below and
  // gets its EXIF stripped there.)
  if (isAlreadyCompliant(meta, contentType)) {
    return { buffer, contentType: 'image/webp', ext: '.webp' };
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
      .webp({ quality: env.IMAGE_WEBP_QUALITY, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    return { buffer: data, contentType: 'image/webp', ext: '.webp' };
  } catch {
    throw new AppError(400, 'Unsupported image format — upload a valid jpeg/png/webp image');
  }
}

// Small grid-thumbnail derivative of an already-normalized full image:
// IMAGE_THUMB_DIM px on the longest edge, WebP at IMAGE_THUMB_QUALITY.
// Never throws for valid image bytes — failures surface as AppError 400.
export async function makeThumb(buffer: Buffer): Promise<Buffer> {
  try {
    const { data } = await sharp(buffer)
      .rotate()
      .resize({
        width: env.IMAGE_THUMB_DIM,
        height: env.IMAGE_THUMB_DIM,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: env.IMAGE_THUMB_QUALITY, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return data;
  } catch {
    throw new AppError(400, 'Unsupported image format — upload a valid jpeg/png/webp image');
  }
}

// Thumbnail object key for a stored full-image key: `thumbs/<path>` with a
// `.webp` extension. Mirrored by the frontend (utils/images.js) — keep the
// two implementations identical; the formula is deliberately trivial.
export function thumbKeyFor(path: string): string {
  const webp = path.replace(/\.[^.]+$/, '.webp');
  return `thumbs/${webp}`;
}

// Rewrite the object key's extension to match the transcoded bytes (a
// `.png` name holding WebP bytes confuses caches and Content-Type sniffers;
// Supabase serves the stored contentType header, but the key should agree).
export function coerceExtension(fileName: string, ext: '.webp'): string {
  return fileName.replace(/\.[^.]+$/, ext);
}

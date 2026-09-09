import { describe, it, expect } from 'vitest';
import sharp from 'sharp';

// Real-sharp unit tests for the server-side image compression pipeline —
// no Supabase / Express involved, just the transcode helper.

// 1x1 transparent PNG.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const tinyPng = Buffer.from(TINY_PNG_BASE64, 'base64');

async function jpegOf(width: number, height: number, quality = 95): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 30, b: 60 },
    },
  })
    .jpeg({ quality })
    .toBuffer();
}

describe('compressImage (server-side image normalization)', () => {
  it('downscales an oversized JPEG to at most IMAGE_MAX_DIM and re-encodes as WebP', async () => {
    const { compressImage } = await import('../src/utils/imageCompress.js');
    const big = await jpegOf(4000, 3000); // 4000x3000 phone photo
    const out = await compressImage(big, 'image/jpeg');

    expect(out.contentType).toBe('image/webp');
    expect(out.ext).toBe('.webp');

    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeLessThanOrEqual(1280);
    expect(meta.height).toBeLessThanOrEqual(1280);
    // Aspect ratio preserved (fit: 'inside').
    expect(Math.abs(meta.width! / meta.height! - 4000 / 3000)).toBeLessThan(0.02);
    // WebP output must be far smaller than the q95 JPEG original.
    expect(out.buffer.length).toBeLessThan(big.length);
  });

  it('normalizes an oversized PNG to WebP', async () => {
    const { compressImage } = await import('../src/utils/imageCompress.js');
    const bigPng = await sharp({
      create: { width: 2000, height: 2000, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();

    const out = await compressImage(bigPng, 'image/png');
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(1280);
  });

  it('transcodes an already-small client JPEG to WebP (one generation, format move)', async () => {
    const { compressImage } = await import('../src/utils/imageCompress.js');
    const small = await jpegOf(800, 600);
    const out = await compressImage(small, 'image/jpeg');
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  it('passes through an already-compliant WebP without re-encoding (no generational loss)', async () => {
    const { compressImage } = await import('../src/utils/imageCompress.js');
    const smallWebp = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 30, b: 60 } },
    })
      .webp({ quality: 80 })
      .toBuffer();
    const out = await compressImage(smallWebp, 'image/webp');
    // Byte-identical pass-through — already a compliant derivative.
    expect(out.buffer.equals(smallWebp)).toBe(true);
  });

  it('rejects corrupt/non-image bytes with a 400', async () => {
    const { compressImage } = await import('../src/utils/imageCompress.js');
    const bogus = Buffer.from('definitely not an image', 'utf8');
    await expect(compressImage(bogus, 'image/jpeg')).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('Unsupported image format'),
    });
  });

  it('rejects a supported MIME that decodes to an unsupported format', async () => {
    const { compressImage } = await import('../src/utils/imageCompress.js');
    // A TIFF buffer lying about being image/png.
    const tiff = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .tiff()
      .toBuffer();
    await expect(compressImage(tiff, 'image/png')).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('coerceExtension', () => {
  it('rewrites any extension to .webp', async () => {
    const { coerceExtension } = await import('../src/utils/imageCompress.js');
    expect(coerceExtension('photo.PNG', '.webp')).toBe('photo.webp');
    expect(coerceExtension('rental/abc/return-123.jpg', '.webp')).toBe('rental/abc/return-123.webp');
    expect(coerceExtension('1734123-gown.jpeg', '.webp')).toBe('1734123-gown.webp');
  });
});

describe('makeThumb + thumbKeyFor (grid thumbnails)', () => {
  it('produces a bounded WebP derivative of a full-size image', async () => {
    const { makeThumb } = await import('../src/utils/imageCompress.js');
    const big = await jpegOf(2000, 1500);
    const thumb = await makeThumb(big);
    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeLessThanOrEqual(480);
    expect(meta.height).toBeLessThanOrEqual(480);
    expect(thumb.length).toBeLessThan(big.length);
  });

  it('derives the thumb key deterministically (mirrored by frontend utils/images.js)', async () => {
    const { thumbKeyFor } = await import('../src/utils/imageCompress.js');
    expect(thumbKeyFor('seed/gown-01-x.jpg')).toBe('thumbs/seed/gown-01-x.webp');
    expect(thumbKeyFor('seed/suit-20-y.webp')).toBe('thumbs/seed/suit-20-y.webp');
    expect(thumbKeyFor('rental/abc/return-123.webp')).toBe('thumbs/rental/abc/return-123.webp');
  });
});

describe('sharp sanity (tiny PNG fixture decodes)', () => {
  it('tiny PNG metadata is readable', async () => {
    const meta = await sharp(tinyPng).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1);
    expect(meta.height).toBe(1);
  });
});

describe('bucket routing (public catalog vs private condition shots)', () => {
  it('routes rental/ condition paths to the private bucket, everything else public', async () => {
    const { isConditionPath, bucketFor } = await import('../src/services/storage.service.js');
    expect(isConditionPath('rental/abc/release-1.jpg')).toBe(true);
    expect(isConditionPath('seed/gown-01-x.jpg')).toBe(false);
    expect(isConditionPath('1757-photo.jpg')).toBe(false);
    expect(bucketFor('rental/abc/return-1.jpg')).toBe(process.env.STORAGE_BUCKET || 'rentech-images');
    expect(bucketFor('seed/gown-01-x.jpg')).toBe(process.env.STORAGE_CATALOG_BUCKET || 'rentech-catalog');
  });

  it('builds a stable public URL for catalog paths (offline, no Supabase call)', async () => {
    const { getPublicUrl } = await import('../src/services/storage.service.js');
    const url = getPublicUrl('seed/gown-01-x.jpg');
    expect(url).toContain('/storage/v1/object/public/');
    expect(url).toContain('seed/gown-01-x.jpg');
  });
});

describe('storageErrorStatus (signed-URL error classification)', () => {
  it('genuine miss -> 404', async () => {
    const { storageErrorStatus } = await import('../src/services/storage.service.js');
    // Shape of the real StorageApiError seen in production logs.
    expect(storageErrorStatus({ message: 'Object not found', status: 400, statusCode: '404' })).toBe(404);
    expect(storageErrorStatus({ message: 'Object not found' })).toBe(404);
  });

  it('transport / upstream failures -> 503 (never misreported as missing file)', async () => {
    const { storageErrorStatus } = await import('../src/services/storage.service.js');
    expect(storageErrorStatus({ message: 'fetch failed' })).toBe(503);
    expect(storageErrorStatus({ message: 'connect ENOTFOUND db.supabase.co' })).toBe(503);
    expect(storageErrorStatus({ message: 'socket hang up', status: 500 })).toBe(503);
    expect(storageErrorStatus({ message: 'Service Unavailable', status: 503, statusCode: '503' })).toBe(503);
    expect(storageErrorStatus({ message: 'Too many requests', status: 429, statusCode: '429' })).toBe(503);
    expect(storageErrorStatus({ message: 'The request timed out', status: 504 })).toBe(503);
  });

  it('bucket-level misconfiguration -> 500 (not a missing file)', async () => {
    const { storageErrorStatus } = await import('../src/services/storage.service.js');
    expect(storageErrorStatus({ message: 'Bucket not found', status: 400 })).toBe(500);
    expect(storageErrorStatus({ message: 'Invalid bucket name' })).toBe(500);
  });
});

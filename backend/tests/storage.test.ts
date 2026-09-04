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
  it('downscales an oversized JPEG to at most IMAGE_MAX_DIM and re-encodes as JPEG', async () => {
    const { compressImage } = await import('../src/utils/imageCompress.js');
    const big = await jpegOf(4000, 3000); // 4000x3000 phone photo
    const out = await compressImage(big, 'image/jpeg');

    expect(out.contentType).toBe('image/jpeg');
    expect(out.ext).toBe('.jpg');

    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBeLessThanOrEqual(1280);
    expect(meta.height).toBeLessThanOrEqual(1280);
    // Aspect ratio preserved (fit: 'inside').
    expect(Math.abs(meta.width! / meta.height! - 4000 / 3000)).toBeLessThan(0.02);
    // A 4000x3000 flat-color JPEG at q82 must come out far smaller than the
    // q95 original.
    expect(out.buffer.length).toBeLessThan(big.length);
  });

  it('normalizes an oversized PNG to JPEG', async () => {
    const { compressImage } = await import('../src/utils/imageCompress.js');
    const bigPng = await sharp({
      create: { width: 2000, height: 2000, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();

    const out = await compressImage(bigPng, 'image/png');
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(1280);
  });

  it('passes through an already-compliant JPEG without re-encoding (no generational loss)', async () => {
    const { compressImage } = await import('../src/utils/imageCompress.js');
    const small = await jpegOf(800, 600);
    const out = await compressImage(small, 'image/jpeg');
    // Byte-identical pass-through — the client canvas pass already produced
    // a compliant derivative, so the server leaves it untouched.
    expect(out.buffer.equals(small)).toBe(true);
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
  it('rewrites any extension to .jpg', async () => {
    const { coerceExtension } = await import('../src/utils/imageCompress.js');
    expect(coerceExtension('photo.PNG', '.jpg')).toBe('photo.jpg');
    expect(coerceExtension('rental/abc/return-123.webp', '.jpg')).toBe('rental/abc/return-123.jpg');
    expect(coerceExtension('1734123-gown.jpeg', '.jpg')).toBe('1734123-gown.jpg');
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    expect(meta.width).toBeLessThanOrEqual(768);
    expect(meta.height).toBeLessThanOrEqual(768);
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
    // Condition-photo previews stay private (signed), unlike catalog thumbs.
    expect(isConditionPath('thumbs/rental/abc/release-1.webp')).toBe(true);
    expect(isConditionPath('thumbs/seed/gown-01-x.webp')).toBe(false);
    expect(bucketFor('thumbs/rental/abc/release-1.webp')).toBe(process.env.STORAGE_BUCKET || 'rentech-images');
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

describe('uploadFile (transport-throw retry)', () => {
  // storage-js THROWS (instead of returning { error }) on transport failures
  // — DNS, reset, timeout, pooler blips. The retry loop must survive those
  // like it does returned errors, or one blip becomes an instant generic 500
  // (seen on the release-photo upload during a Supabase connectivity window).
  const uploadMock = vi.fn();

  beforeEach(async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    uploadMock.mockReset().mockResolvedValue({ data: { path: 'probe.webp' }, error: null });
    (supabaseAdmin as any).storage = {
      from: vi.fn(() => ({ upload: uploadMock })),
    };
  });

  it('retries a transport throw and succeeds', async () => {
    const { uploadFile } = await import('../src/services/storage.service.js');
    uploadMock
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue({ data: { path: 'probe-t.webp' }, error: null });
    const buf = await jpegOf(200, 150);
    const res = await uploadFile('probe-t.jpg', 'image/jpeg', buf);
    expect(res.path).toBe('probe-t.webp');
    // 1 throw + 1 full upload + 1 thumb upload.
    expect(uploadMock).toHaveBeenCalledTimes(3);
  });

  it('maps repeated transport throws to 503 after exhausting retries', async () => {
    const { uploadFile } = await import('../src/services/storage.service.js');
    uploadMock.mockRejectedValue(new Error('fetch failed'));
    const buf = await jpegOf(200, 150);
    await expect(uploadFile('probe-t2.jpg', 'image/jpeg', buf)).rejects.toMatchObject({ statusCode: 503 });
    // Full-upload attempts only — the thumb never runs when the main fails.
    expect(uploadMock).toHaveBeenCalledTimes(3);
  });

  it('fails fast with 500 on a non-transient throw', async () => {
    const { uploadFile } = await import('../src/services/storage.service.js');
    uploadMock.mockRejectedValue(new Error('Bucket not found'));
    const buf = await jpegOf(200, 150);
    await expect(uploadFile('probe-t3.jpg', 'image/jpeg', buf)).rejects.toMatchObject({ statusCode: 500 });
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });
});

describe('Cloudflare R2 provider', () => {
  const R2 = {
    R2_ACCOUNT_ID: 'acct123',
    R2_ACCESS_KEY_ID: 'AKIATEST',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_CATALOG_BUCKET: 'r2-catalog',
    R2_PRIVATE_BUCKET: 'r2-private',
    R2_PUBLIC_URL: 'https://img.example.com/',
  };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const [k, v] of Object.entries(R2)) { saved[k] = process.env[k]; process.env[k] = v; } });
  afterEach(() => { for (const k of Object.keys(R2)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('routes buckets and public URLs to R2 when credentials are set', async () => {
    const svc = await import('../src/services/storage.service.js');
    expect(svc.storageProvider()).toBe('r2');
    expect(svc.bucketFor('rental/abc/return-1.webp')).toBe('r2-private');
    expect(svc.bucketFor('seed/gown.webp')).toBe('r2-catalog');
    expect(svc.getPublicUrl('seed/gown.webp')).toBe('https://img.example.com/seed/gown.webp');
  });

  it('presigns private condition photos locally and keeps catalog URLs public', async () => {
    const svc = await import('../src/services/storage.service.js');
    const signed = await svc.getDownloadUrl('rental/abc/return-1.webp');
    expect(signed.url).toContain('acct123.r2.cloudflarestorage.com');
    expect(signed.url).toContain('X-Amz-Signature=');
    const pub = await svc.getDownloadUrl('seed/gown.webp');
    expect(pub).toEqual({ url: 'https://img.example.com/seed/gown.webp', public: true });
  });

  it('STORAGE_PROVIDER=supabase forces the Supabase driver', async () => {
    process.env.STORAGE_PROVIDER = 'supabase';
    try {
      const svc = await import('../src/services/storage.service.js');
      expect(svc.storageProvider()).toBe('supabase');
    } finally { delete process.env.STORAGE_PROVIDER; }
  });
});

describe('r2BucketApi (backup/report facade on R2, S3 client mocked)', () => {
  it('lists names under the prefix, sorts desc, maps write-once collisions and downloads', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
    const spy = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (cmd: any) => {
      const name = cmd.constructor.name as string;
      sent.push({ name, input: cmd.input });
      if (name === 'ListObjectsV2Command') {
        return { Contents: [{ Key: 'backups/a.json' }, { Key: 'backups/c.json' }, { Key: 'backups/sub/x.json' }, { Key: 'backups/b.meta.json' }] } as any;
      }
      if (name === 'PutObjectCommand' && cmd.input.Key === 'backups/dup.json') {
        throw Object.assign(new Error('precondition'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
      }
      if (name === 'GetObjectCommand') {
        return { Body: { transformToByteArray: async () => new TextEncoder().encode('{"ok":true}') } } as any;
      }
      return {} as any;
    });
    try {
      process.env.R2_PRIVATE_BUCKET = 'priv';
      const { r2BucketApi } = await import('../src/services/r2.client.js');
      const api = r2BucketApi('backups/');

      const listed = await api.list('', { limit: 2, sortBy: { order: 'desc' } });
      expect(listed.data?.map((f) => f.name)).toEqual(['c.json', 'b.meta.json']);
      expect(sent[0].input).toMatchObject({ Bucket: 'priv', Prefix: 'backups/' });

      expect((await api.upload('new.json', Buffer.from('{}'), { contentType: 'application/json' })).error).toBeNull();
      expect(sent.at(-1)!.input).toMatchObject({ Key: 'backups/new.json', IfNoneMatch: '*' });
      // upsert:true (meta sidecars) must not send the write-once header.
      await api.upload('s.meta.json', Buffer.from('{}'), { upsert: true });
      expect(sent.at(-1)!.input.IfNoneMatch).toBeUndefined();
      expect((await api.upload('dup.json', Buffer.from('{}'))).error?.message).toMatch(/already exists/);

      const dl = await api.download('a.json');
      expect(dl.data?.toString()).toBe('{"ok":true}');
    } finally {
      spy.mockRestore();
      process.env.R2_PRIVATE_BUCKET = 'rentech-private';
    }
  });
});

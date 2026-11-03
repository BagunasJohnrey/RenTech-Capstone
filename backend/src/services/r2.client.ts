// Cloudflare R2 storage driver (S3-compatible API, zero egress fees).
//
// Enabled when R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY are all
// set (or STORAGE_PROVIDER=r2). Without them storage.service.ts keeps using
// Supabase Storage, so dev/tests and a half-configured deploy keep working.
//
// Bucket layout mirrors the Supabase split:
//   R2_CATALOG_BUCKET (public — r2.dev URL or custom domain in R2_PUBLIC_URL):
//     item photos, thumbs/, avatars/, qrcodes/
//   R2_PRIVATE_BUCKET (no public access): rental/ condition shots + payment
//     proofs, served only via short-lived presigned GET URLs.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export function isR2Enabled(): boolean {
  const forced = (process.env.STORAGE_PROVIDER || '').toLowerCase();
  if (forced === 'supabase') return false;
  const configured = !!((process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT) && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
  if (forced === 'r2' && !configured) {
    console.warn('[storage] STORAGE_PROVIDER=r2 but R2_* credentials are missing — falling back to Supabase');
  }
  return configured;
}

export const r2CatalogBucket = () => process.env.R2_CATALOG_BUCKET || 'rentech-catalog';
export const r2PrivateBucket = () => process.env.R2_PRIVATE_BUCKET || 'rentech-private';

export function r2PublicBase(): string {
  return (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
}

let client: S3Client | null = null;
export function getR2Client(): S3Client {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      // R2_ENDPOINT = the S3 API URL shown in the Cloudflare dashboard (needed
      // for jurisdiction buckets, e.g. https://<id>.eu.r2.cloudflarestorage.com).
      // Any trailing /<bucket> path is stripped — buckets are passed per call.
      endpoint: process.env.R2_ENDPOINT
        ? new URL(process.env.R2_ENDPOINT).origin
        : `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return client;
}

type S3ErrorLike = { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
const httpStatus = (err: unknown) => (err as S3ErrorLike)?.$metadata?.httpStatusCode;

/**
 * Write-once PUT (`If-None-Match: *`) — same semantics as Supabase
 * `upsert:false`. Returns 'exists' when the key is already taken (412), which
 * callers treat as an idempotent retry success.
 */
export async function r2PutObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
  cacheControl: string,
): Promise<'created' | 'exists'> {
  try {
    await getR2Client().send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
      IfNoneMatch: '*',
    }));
    return 'created';
  } catch (err) {
    if (httpStatus(err) === 412 || (err as S3ErrorLike)?.name === 'PreconditionFailed') return 'exists';
    throw err;
  }
}

export async function r2PresignGet(bucket: string, key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(getR2Client(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

export async function r2ObjectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getR2Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (httpStatus(err) === 404 || (err as S3ErrorLike)?.name === 'NotFound') return false;
    throw err;
  }
}

export async function r2DeleteObject(bucket: string, key: string): Promise<void> {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export interface R2ListedObject { key: string; size: number | null; updatedAt: string | null }

export async function r2ListAll(bucket: string, prefix = '', cap = 10000): Promise<R2ListedObject[]> {
  const out: R2ListedObject[] = [];
  let token: string | undefined;
  do {
    const res = await getR2Client().send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      ContinuationToken: token,
      MaxKeys: Math.min(1000, Math.max(1, cap - out.length)),
    }));
    for (const o of res.Contents ?? []) {
      if (!o.Key) continue;
      out.push({ key: o.Key, size: o.Size ?? null, updatedAt: o.LastModified ? o.LastModified.toISOString() : null });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token && out.length < cap);
  return out.slice(0, cap);
}

/** Map an S3/R2 SDK error onto the same 404/500/503 classes as Supabase. */
export function r2ErrorStatus(err: unknown): 404 | 500 | 503 {
  const status = httpStatus(err);
  const name = (err as S3ErrorLike)?.name ?? '';
  if (status === 429 || (status !== undefined && status >= 500)) return 503;
  if (name === 'NoSuchBucket') return 500;
  if (status === 401 || status === 403 || /InvalidAccessKeyId|SignatureDoesNotMatch|AccessDenied/.test(name)) return 500;
  if (status === 404 || name === 'NoSuchKey' || name === 'NotFound') return 404;
  // Transport failures carry no HTTP status.
  return status === undefined ? 503 : 404;
}

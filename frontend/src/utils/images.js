import { storageService } from '../services/storage';
import { imageCache } from './imageCache';

export const isAbsoluteUrl = (p) =>
  typeof p === 'string' && (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:'));

// `rental/` keys are condition evidence (release/return photos) in the
// PRIVATE bucket — they must go through backend signing. Everything else is
// a catalog photo in the PUBLIC bucket (stable URL, no signing round-trip).
// Mirrors backend isConditionPath() in storage.service.ts.
export const isPrivatePath = (p) =>
  typeof p === 'string' && (p.startsWith('rental/') || p.startsWith('blob:'));

const publicBase = () => {
  const host = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const bucket = import.meta.env.VITE_STORAGE_BUCKET || 'rentech-catalog';
  return `${host}/storage/v1/object/public/${bucket}`;
};

// Stable, cacheable URL for a catalog object — pure string build, zero
// network. Safe for <img src> directly.
export const publicUrlFor = (path) => `${publicBase()}/${path}`;

export const thumbKeyFor = (path) => `thumbs/${path.replace(/\.[^.]+$/, '.webp')}`;

export const thumbUrlFor = (path) => publicUrlFor(thumbKeyFor(path));

// Profile photos (`avatars/` keys) live in the PUBLIC catalog bucket like
// item photos — stable URL, no signing. Absolute URLs pass through.
export const resolveAvatarUrl = (p) => {
  if (!p) return null;
  if (isAbsoluteUrl(p)) return p;
  return publicUrlFor(p);
};

// Single entry point for display URLs:
//   absolute/blob/empty -> as-is (caller handles placeholders)
//   catalog path        -> stable public URL (sync, no fetch)
//   rental/ path        -> signed URL via the shared signed-URL cache
export async function resolveDisplayUrl(path) {
  if (!path || isAbsoluteUrl(path)) return path || null;
  if (isPrivatePath(path)) {
    if (path.startsWith('blob:')) return null;
    return imageCache.resolve(path, async () => {
      const res = await storageService.getDownloadUrl(path);
      return res?.url || null;
    });
  }
  return publicUrlFor(path);
}

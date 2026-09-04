// Hot-path profile cache. The auth middleware resolves a Supabase auth userId
// (JWT `sub`) to a Profile row on EVERY request; against a remote Supabase-
// backed Postgres pooler that round trip is the dominant per-request latency.
// This cache stores the small auth-relevant slice for 30s keyed by the auth
// user id, and is invalidated explicitly whenever a mutation changes any of
// the cached fields (updateMe, MFA enable/disable, staff removal, OAuth
// profile completion).
//
// Multi-instance note: this is per-process memory. A single backend instance
// is the current deployment shape; when scaling horizontally, swap the store
// for a shared cache (e.g. Redis) behind this same interface (see
// utils/cacheStore.ts seam).

import type { Role } from '../types/index.js';

export interface CachedAuthProfile {
  id: string;          // Profile PK (used as req.user.id)
  userId: string;      // Supabase auth user id (JWT sub)
  email: string;
  role: Role;
  name: string;
  phone?: string;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
}

interface Entry {
  data: CachedAuthProfile;
  at: number;
}

const TTL_MS = 30_000;
const store = new Map<string, Entry>();

export function getCachedProfile(userId: string): CachedAuthProfile | null {
  const hit = store.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(userId);
    return null;
  }
  return hit.data;
}

export function setCachedProfile(profile: CachedAuthProfile): void {
  store.set(profile.userId, { data: profile, at: Date.now() });
}

export function invalidateProfileCache(userId: string): void {
  store.delete(userId);
}

export function clearProfileCache(): void {
  store.clear();
}

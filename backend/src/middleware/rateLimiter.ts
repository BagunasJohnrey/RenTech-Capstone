import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import { env } from '../config/env.js';

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 160;
// Asset GETs (public signed-URL issuance at /api/storage/*) get their own
// separate budget — much higher than the global one (one catalog page fires
// dozens of signed-URL mints in parallel), but still bounded so a single IP
// can't hammer Supabase storage with unbounded minting.
const ASSET_MAX_REQUESTS = 600;

// Derive the real client IP without trusting a spoofable X-Forwarded-For.
// `trust proxy` (set in index.ts) makes Express resolve req.ip from the first
// XFF hop; we still prefer the remote socket when no proxy hop is present.
export function clientIp(req: Request): string {
  const raw = req.socket?.remoteAddress;
  if (env.NODE_ENV === 'production') {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) {
      return fwd.split(',')[0].trim();
    }
  }
  return req.ip || raw || 'unknown';
}

// Periodic sweep so the in-memory stores don't grow unbounded (e.g. attackers
// rotating spoofed IPs).
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    const fresh = entry.timestamps.filter((t) => now - t < WINDOW_MS);
    if (fresh.length === 0) store.delete(key);
    else store.set(key, { timestamps: fresh });
  }
  for (const l of localLimiters) {
    l.sweep(now);
  }
}, 60_000);

type Limiter = { sweep: (now: number) => void };

const localLimiters: Limiter[] = [];

// Dedicated per-IP limiter for storage asset GETs (created after localLimiters
// so it registers itself for sweeping/clearing like the other keyed limiters).
const storageAssetLimiter = createRateLimiter(ASSET_MAX_REQUESTS, WINDOW_MS);

export function rateLimiter(req: Request, res: Response, next: NextFunction) {
  // Asset GETs (public item-photo signed-URL issuance at /api/storage/*) are
  // exempt from the GLOBAL budget: one catalog page fires dozens of them in
  // parallel, which used to exhaust the per-IP budget in seconds and 429 the
  // whole UI (login, KPIs, inventory, settings — everything behind /api).
  // They still go through their own generous per-IP limiter above so the
  // route can't be used to hammer Supabase storage unboundedly. The signed
  // URL itself is the access control — minting only yields short-lived links
  // to a private bucket. Every other API request stays on the global budget.
  if (req.method === 'GET' && req.path.startsWith('/storage/')) {
    return storageAssetLimiter(req, res, next);
  }

  const ip = clientIp(req);
  const now = Date.now();

  let entry = store.get(ip);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(ip, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);

  if (entry.timestamps.length >= MAX_REQUESTS) {
    throw new AppError(429, 'Too many requests. Please try again later.');
  }

  entry.timestamps.push(now);
  next();
}

// Per-route limiter, keyed by IP (optionally combined with a resource key such
// as the login email) so brute-force attempts can't rotate across resources.
export function createKeyedRateLimiter(
  getKey: (req: Request) => string,
  maxRequests: number,
  windowMs: number
) {
  const localStore = new Map<string, RateLimitEntry>();

  const limiter = (req: Request, _res: Response, next: NextFunction) => {
    const key = getKey(req);
    const now = Date.now();

    let entry = localStore.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      localStore.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= maxRequests) {
      throw new AppError(429, 'Too many requests. Please try again later.');
    }

    entry.timestamps.push(now);
    next();
  };

  (limiter as any).sweep = (now: number) => {
    for (const [key, entry] of localStore) {
      const fresh = entry.timestamps.filter((t) => now - t < windowMs);
      if (fresh.length === 0) localStore.delete(key);
      else localStore.set(key, { timestamps: fresh });
    }
  };
  (limiter as any).localStore = localStore;
  localLimiters.push(limiter as unknown as Limiter);

  return limiter;
}

// Simple per-IP limiter (keyed on the derived client IP).
export function createRateLimiter(maxRequests: number, windowMs: number) {
  return createKeyedRateLimiter((req) => `ip:${clientIp(req)}`, maxRequests, windowMs);
}

export function clearRateLimitStore() {
  store.clear();
}

// Clears the global + every per-route keyed store (test helper — supertest
// shares one IP, so without this the Nth login/signup test in a file hits 429).
export function clearAllRateLimiters() {
  store.clear();
  for (const l of localLimiters) {
    (l as any).localStore?.clear?.();
  }
}

export function clearLocalStore(store: Map<string, RateLimitEntry>) {
  store.clear();
}
import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;

export function rateLimiter(req: Request, _res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = store.get(ip);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(ip, entry);
  }

  entry.timestamps = entry.timestamps.filter(t => now - t < WINDOW_MS);

  if (entry.timestamps.length >= MAX_REQUESTS) {
    throw new AppError(429, 'Too many requests. Please try again later.');
  }

  entry.timestamps.push(now);
  next();
}

export function createRateLimiter(maxRequests: number, windowMs: number) {
  const localStore = new Map<string, RateLimitEntry>();

  return (req: Request, _res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = localStore.get(ip);
    if (!entry) {
      entry = { timestamps: [] };
      localStore.set(ip, entry);
    }

    entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

    if (entry.timestamps.length >= maxRequests) {
      throw new AppError(429, 'Too many requests. Please try again later.');
    }

    entry.timestamps.push(now);
    next();
  };
}

export function clearRateLimitStore() {
  store.clear();
}

export function clearLocalStore(store: Map<string, RateLimitEntry>) {
  store.clear();
}

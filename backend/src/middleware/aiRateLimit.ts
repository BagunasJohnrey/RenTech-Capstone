import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

// Sliding-window rate limiter for the AI chat endpoint, keyed by user id (or IP
// when unauthenticated). Keeps the free-form LLM call bounded per customer.
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 12;

const hits = new Map<string, number[]>();

// Best-effort sweep so the in-memory map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, arr] of hits) {
    const fresh = arr.filter((t) => now - t < WINDOW_MS);
    if (fresh.length === 0) hits.delete(key);
    else hits.set(key, fresh);
  }
}, 5 * 60 * 1000);

export function aiChatRateLimit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const key = req.user?.id || req.ip || 'anonymous';
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);

  if (arr.length >= MAX_PER_WINDOW) {
    const oldest = arr[0];
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
    res.set('Retry-After', String(retryAfter));
    return next(new AppError(429, `Too many messages. Please wait ${retryAfter}s before sending another.`));
  }

  arr.push(now);
  hits.set(key, arr);
  next();
}

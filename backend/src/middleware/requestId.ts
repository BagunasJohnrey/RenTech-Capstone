import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Attach/expose a correlation id so a client error response can be matched to
// the server log line. Honors a caller-supplied x-request-id (proxy/CDN) and
// generates one otherwise.
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  (req as unknown as { requestId: string }).requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

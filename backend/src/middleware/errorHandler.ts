import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Map well-known Prisma error codes + oversized-payload errors to the right
// HTTP status instead of a blanket 500.
function mapKnownError(err: unknown): { status: number; message: string } | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { type?: unknown; status?: unknown; statusCode?: unknown; code?: unknown };
  if (e.type === 'entity.too.large' || e.status === 413 || e.statusCode === 413) {
    return { status: 413, message: 'Request payload too large' };
  }
  // Malformed JSON bodies (body-parser SyntaxError, type entity.parse.failed)
  // are a client bug, not a server crash — answer 400 instead of 500.
  if (e.type === 'entity.parse.failed') {
    return { status: 400, message: 'Invalid request payload' };
  }
  switch (e.code) {
    case 'P2002': return { status: 409, message: 'A record with that unique value already exists' };
    case 'P2003': return { status: 400, message: 'Invalid reference (foreign key constraint failed)' };
    case 'P2025': return { status: 404, message: 'Record not found' };
    default: return null;
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (req as unknown as { requestId?: string }).requestId;
  if (requestId) res.setHeader('x-request-id', requestId);
  if (requestId) console.error(`[${requestId}]`, err.message ?? 'error');
  if (err instanceof AppError) {
    // L7: never echo internal details (upstream API bodies, stack traces, etc.)
    // to clients. Details are dev-only; production sends the sanitized message.
    // Details appear ONLY in development — env.ts defaults NODE_ENV to
    // 'development', so any staging/preview deploy that forgets to set
    // NODE_ENV=production would otherwise leak raw validation/upstream bodies.
    const showDetails = process.env.NODE_ENV === 'development';
    res.status(err.statusCode).json(
      showDetails && err.details !== undefined
        ? { error: err.message, details: err.details }
        : { error: err.message }
    );
    return;
  }

  console.error('Unhandled error:', err);

  const known = mapKnownError(err);
  if (known) {
    res.status(known.status).json({ error: known.message });
    return;
  }

  res.status(500).json({
    error: 'Internal server error',
  });
}

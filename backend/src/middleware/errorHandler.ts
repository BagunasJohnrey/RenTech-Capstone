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

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
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
  res.status(500).json({
    error: 'Internal server error',
  });
}

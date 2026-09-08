import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from './errorHandler.js';

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      req.body = parsed.body;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        // Log the Zod error details + a snapshot of the incoming body (no
        // secrets) so production 400s are self-diagnosing.
        const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : typeof req.body;
        console.error('[validate] Zod errors:', JSON.stringify(err.errors), '| body keys:', bodyKeys);
        throw new AppError(400, 'Validation error', err.errors);
      }
      throw err;
    }
  };
}

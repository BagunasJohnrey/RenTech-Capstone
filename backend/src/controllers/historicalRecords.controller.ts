import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as recordsService from '../services/historicalRecords.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const importSchema = z.object({
  body: z.object({
    fileName: z.string().min(1).max(120),
    // Base64 file bytes (same shape as the storage upload endpoint; the
    // 25mb JSON body limit applies, but imports are capped at 2MB anyway).
    data: z.string().min(1),
  }),
});

export const listSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  }),
});

export async function importRecords(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { fileName, data } = req.body;
    const buffer = Buffer.from(data, 'base64');
    const result = await recordsService.importRecords({ fileName, buffer, importedById: req.user!.id });
    res.status(201).json(result);
  } catch (err) {
    // Row-level validation errors are the staffer's own file data echoed
    // back (row numbers + which column failed) — safe to return in every
    // env so the file can be fixed in one round trip. errorHandler strips
    // generic `details` in production, so this case answers directly.
    if (
      err instanceof AppError && err.statusCode === 400 &&
      err.details !== null && typeof err.details === 'object' && 'errors' in (err.details as Record<string, unknown>)
    ) {
      res.status(400).json({ error: err.message, errors: (err.details as { errors: unknown }).errors });
      return;
    }
    next(err);
  }
}

export async function listRecords(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const result = await recordsService.listRecords({
      limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
      offset: req.query.offset === undefined ? undefined : Number(req.query.offset),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getRecordStats(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await recordsService.getRecordStats());
  } catch (err) {
    next(err);
  }
}

export async function deleteRecord(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await recordsService.deleteRecord(String(req.params.id), req.user!.id));
  } catch (err) {
    next(err);
  }
}

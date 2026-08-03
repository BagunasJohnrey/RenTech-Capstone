import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as storageService from '../services/storage.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const uploadSchema = z.object({
  body: z.object({
    fileName: z.string().min(1),
    contentType: z.string().min(1),
    data: z.string().min(1),
  }),
});

export async function upload(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { fileName, contentType, data } = req.body;
    const buffer = Buffer.from(data, 'base64');
    const result = await storageService.uploadFile(fileName, contentType, buffer);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getDownloadUrl(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // Express 5 named wildcard: params.path is an array of segments.
    // e.g. GET /storage/rental/abc/file.jpg → params.path = ['rental','abc','file.jpg']
    const raw = req.params.path as unknown;
    const path = Array.isArray(raw) ? raw.join('/') : (typeof raw === 'string' ? raw : '');

    // Browser blob URLs are client-only — never storeable; reject them early.
    if (path.startsWith('blob:')) {
      return next(new AppError(400, 'Blob preview URLs cannot be served from storage. Re-upload the file.'));
    }
    if (!path) {
      return next(new AppError(404, 'Missing file path'));
    }

    const result = await storageService.getDownloadUrl(path);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as storageService from '../services/storage.service.js';
import { AuthenticatedRequest } from '../types/index.js';

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
    const path = req.params.path as string;
    const result = await storageService.getDownloadUrl(path);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

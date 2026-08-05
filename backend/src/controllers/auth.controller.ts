import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../config/supabase.js';
import { prisma } from '../config/database.js';

export const signupSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    phone: z.string().optional(),
    address: z.string().optional(),
    preferences: z.array(z.string()).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    preferences: z.array(z.string()).optional(),
    notifyPrefs: z.record(z.boolean()).optional(),
    styleNotes: z.string().max(500).nullable().optional(),
  }),
});

export const createStaffSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    phone: z.string().optional(),
  }),
});

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.signupCustomer(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const result = await authService.loginUser(email, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function logout(_req: Request, res: Response) {
  res.json({ message: 'Logged out successfully' });
}

export async function getMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const profile = await authService.getProfile(req.user.id);
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const profile = await authService.updateProfile(req.user.id, req.body);
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

export async function createStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const profile = await authService.createStaffAccount(req.user.id, req.body);
    res.status(201).json(profile);
  } catch (err) {
    next(err);
  }
}

export const oauthSchema = z.object({
  body: z.object({
    accessToken: z.string().min(1),
    details: z
      .object({
        name: z.string().min(1),
        phone: z.string().min(1),
        address: z.string().min(1),
        preferences: z.array(z.string()).optional(),
      })
      .optional(),
  }),
});

export const oauthCancelSchema = z.object({
  body: z.object({
    accessToken: z.string().min(1),
  }),
});

export async function oauth(req: Request, res: Response, next: NextFunction) {
  try {
    const { accessToken, details } = req.body;
    const result = await authService.oauthGetOrCreateProfile(accessToken, details);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function oauthCancel(req: Request, res: Response, next: NextFunction) {
  try {
    const { accessToken } = req.body;
    await authService.oauthCancel(accessToken);
    res.json({ message: 'OAuth sign-up cancelled' });
  } catch (err) {
    next(err);
  }
}

export const verifyAdminSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export async function verifyAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new AppError(401, 'Invalid credentials');
    const profile = await prisma.profile.findUnique({ where: { userId: data.user.id } });
    if (!profile || profile.role !== 'Admin') throw new AppError(403, 'Not an admin account');
    res.json({ verified: true, admin: { name: profile.name, email: profile.email } });
  } catch (err) {
    next(err);
  }
}

export async function listStaff(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const staff = await authService.listStaffAccounts();
    res.json(staff);
  } catch (err) {
    next(err);
  }
}

export async function removeStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const staffId = req.params.id as string;
    await authService.removeStaffAccount(req.user.id, staffId);
    res.json({ message: 'Staff account removed' });
  } catch (err) {
    next(err);
  }
}

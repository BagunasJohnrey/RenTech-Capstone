import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import * as transactionService from '../services/transactions.service.js';
import { AuthenticatedRequest, Role } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

// L6: clamp pagination but keep the default high enough to cover every month
// the dashboard chart needs — Mar–Jun were disappearing from Admin's Revenue
// Trend because a limit of 50 dropped all but the newest 50 transactions and the
// dashboard needs the past 6 months to render month-on-month.
function clampLimit(raw: unknown, def = 500, max = 500): number {
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}
function clampOffset(raw: unknown, def = 0): number {
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.floor(n);
}

export const createRentalSchema = z.object({
  body: z.object({
    itemId: z.number().int().positive(),
    rentalDate: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid rental date'),
    dueDate: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid due date'),
    // SECURITY: rentalFee is deliberately NOT accepted — the fee is always
    // derived server-side from the item (sale-aware). Downpayment may be
    // supplied by staff (0 allowed for walk-ins) but is capped server-side.
    downpayment: z.number().min(0).optional(),
    customerId: z.string().optional(),
    customerName: z.string().optional(),
    contact: z.string().optional(),
    address: z.string().optional(),
    notes: z.string().optional(),
    conditionPhoto: z.string().optional(),
  }),
});

export const returnSchema = z.object({
  body: z.object({
    returnDate: z.string().optional(),     // server falls back to "now" if omitted
    isDamaged: z.boolean().optional().default(false),
    isLate: z.boolean().optional(),        // informational; late fee computed by date anyway
    returnPhoto: z.string().optional(),
    conditionPhoto: z.string().optional(), // legacy alias
    notes: z.string().optional(),
    damageReason: z.string().optional(),
  }),
});

export async function createRental(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    let customerId = req.user.role === Role.Customer
      ? req.user.id
      : req.body.customerId;

    if (!customerId && req.body.customerName) {
      // C5: strip LIKE wildcards before the Prisma `contains` search —
      // an untrimmed `%`/`_` would match every customer and corrupt the
      // lookup (e.g. searching "%" returns the first profile in the DB).
      const customerName = String(req.body.customerName).replace(/[%_]/g, '').trim();
      const profile = await prisma.profile.findFirst({
        where: { name: { contains: customerName, mode: 'insensitive' } },
      });
      if (profile) {
        customerId = profile.id;
      } else {
        // Walk-in with no existing profile: auto-create a customer record so
        // the rental can be linked. The profile has no auth account (synthetic
        // userId/email), so the walk-in can't log in — it just carries their
        // name/phone/address for history, SMS, and the call button.
        const walkInId = crypto.randomUUID();
        const created = await prisma.profile.create({
          data: {
            userId: `walkin_${walkInId}`,
            email: `walkin_${walkInId}@rentech.invalid`,
            name: customerName,
            phone: req.body.contact ?? null,
            address: req.body.address ?? null,
            role: 'Customer',
          },
        });
        customerId = created.id;
      }
    }

    if (!customerId) {
      throw new AppError(400, 'customerId or customerName is required for staff-created rentals');
    }

    // Persist the contact number/address staff typed at booking time onto the
    // customer's profile (only when provided) so SMS + the call button work.
    if (req.body.contact || req.body.address) {
      await prisma.profile.update({
        where: { id: customerId },
        data: {
          phone: req.body.contact ?? undefined,
          address: req.body.address ?? undefined,
        },
      });
    }

    const tx = await transactionService.createRental(
      { ...req.body, customerId },
      req.user.role !== Role.Customer ? req.user.id : undefined
    );

    res.status(201).json(tx);
  } catch (err) {
    next(err);
  }
}

export async function getTransaction(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const tx = await transactionService.getTransaction(String(req.params.id));

    if (req.user?.role === Role.Customer && tx.customerId !== req.user.id) {
      throw new AppError(403, 'You can only view your own transactions');
    }

    res.json(tx);
  } catch (err) {
    next(err);
  }
}

export async function listTransactions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    const result = await transactionService.listTransactions({
      role: req.user.role,
      profileId: req.user.id,
      status: req.query.status as string | undefined,
      limit: clampLimit(req.query.limit),
      offset: clampOffset(req.query.offset),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function processReturn(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    const result = await transactionService.processReturn(
      String(req.params.id),
      req.user.id,
      req.body.returnDate || new Date().toISOString(), // honor client's date; else now
      req.body.isDamaged ?? false,
      req.body.returnPhoto ?? req.body.conditionPhoto,
      req.body.notes,
      req.body.damageReason
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export const releaseSchema = z.object({
  body: z.object({
    conditionPhoto: z.string().optional(),
    releasePhoto: z.string().optional(),
    notes: z.string().optional(),
  }),
});

export const updateTransactionSchema = z.object({
  body: z.object({
    rentalDate: z.string().optional(),
    dueDate: z.string().optional(),
    notes: z.string().optional(),
  }).refine((d) => d.rentalDate || d.dueDate || d.notes !== undefined, {
    message: 'At least one of rentalDate, dueDate, or notes must be provided',
  }),
});

export async function updateTransaction(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const updated = await transactionService.updateTransaction(
      String(req.params.id),
      req.user.id,
      { rentalDate: req.body.rentalDate, dueDate: req.body.dueDate, notes: req.body.notes }
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function releaseRental(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const result = await transactionService.releaseRental(
      String(req.params.id),
      req.user.id,
      req.body.releasePhoto ?? req.body.conditionPhoto,
      req.body.notes
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function cancelTransaction(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    const tx = await transactionService.getTransaction(String(req.params.id));

    if (req.user.role === Role.Customer && tx.customerId !== req.user.id) {
      throw new AppError(403, 'You can only cancel your own transactions');
    }

    // SECURITY: a customer may not cancel a rental once the item has been
    // picked up — that would free the item while it is still in their
    // possession. Only staff/admin can cancel Active/Overdue rentals.
    if (
      req.user.role === Role.Customer &&
      (tx.status === 'Active' || tx.status === 'Overdue')
    ) {
      throw new AppError(400, 'Item already picked up — contact the boutique to arrange a return');
    }

    const result = await transactionService.cancelTransaction(String(req.params.id), req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function deleteTransaction(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const result = await transactionService.deleteTransaction(String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getUpcomingReturns(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const result = await transactionService.getUpcomingReturns();
    res.json(result);
  } catch (err) {
    next(err);
  }
}

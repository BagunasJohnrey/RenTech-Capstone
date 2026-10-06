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
    // Staff-only: cash physically collected with the booking (written as a
    // completed Payment row). Forced false for customers — their downpayment
    // is a promise until the gateway webhook credits it.
    downpaymentCash: z.boolean().optional(),
    customerId: z.string().optional(),
    customerName: z.string().min(2).max(50, 'Name must be 50 characters or fewer')
      .regex(/^\D+$/, 'Name must not contain numbers').optional(),
    contact: z.string().regex(/^\d{11}$/, 'Phone must be exactly 11 digits').optional(),
    address: z.string().max(100, 'Address must be 100 characters or fewer').optional(),
    notes: z.string().max(300, 'Notes must be 300 characters or fewer').optional(),
    conditionPhoto: z.string().optional(),
    size: z.string().optional(),
    measurements: z.record(z.unknown()).optional(),
  }),
});

export const returnSchema = z.object({
  body: z.object({
    // Validate the date shape so a bad string is a 400, not a 500 from new Date().
    returnDate: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid return date').optional(),     // server falls back to "now" if omitted
    isDamaged: z.boolean().optional().default(false),
    isLate: z.boolean().optional(),        // legacy informational flag, ignored (late fees removed)
    damageFee: z.coerce.number().min(0).max(1000000).optional(), // per-return override; omit for the default
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
      {
        ...req.body,
        customerId,
        // This route is staff/admin-only, but force the flag off for any
        // customer-shaped call so a crafted body can't fake a cash payment.
        downpaymentCash: req.user.role !== Role.Customer ? (req.body.downpaymentCash ?? false) : false,
      },
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

// Staff activity timeline for one transaction (who assisted / released /
// returned / edited / cancelled it). Staff/Admin only; the service resolves
// staff names so the frontend can render "Assisted by X · Released by Y".
export async function getTransactionAudits(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const tx = await transactionService.getTransaction(String(req.params.id));
    if (req.user?.role === Role.Customer && tx.customerId !== req.user.id) {
      throw new AppError(403, 'You can only view your own transactions');
    }
    const audits = await transactionService.getTransactionAudits(String(req.params.id));
    res.json(audits);
  } catch (err) {
    next(err);
  }
}

// Staff QR scan lookup: accepts `RT-XXXXXXXX`, the raw 8-char code, or a full
// shareable URL carrying `?tx=RT-XXXXXXXX`. Staff/Admin only (route-guarded) so
// customer QR payloads can't be enumerated by other customers.
export async function scanTransaction(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    let raw = String(req.params.id || '');
    // Accept a full URL payload (e.g. https://app/rentals?tx=RT-XXXX) as well.
    const m = raw.match(/(?:tx=)?(RT-[0-9A-Fa-f]{6,8})/i);
    if (m) raw = m[1];
    const tx = await transactionService.getTransactionByBookingCode(raw);
    res.json(tx);
  } catch (err) {
    next(err);
  }
}

const TX_STATUSES = ['Active', 'Reserved', 'Overdue', 'Returned', 'Late', 'Cancelled', 'Completed'] as const;

export async function listTransactions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    const status = req.query.status as string | undefined;
    if (status !== undefined && !TX_STATUSES.includes(status as (typeof TX_STATUSES)[number])) {
      throw new AppError(400, `Invalid status filter: ${status}`);
    }

    const result = await transactionService.listTransactions({
      role: req.user.role,
      profileId: req.user.id,
      status,
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
      req.body.damageReason,
      req.body.damageFee ?? null
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
    needsAlteration: z.boolean().optional(),
  }),
});

export const updateTransactionSchema = z.object({
  body: z.object({
    rentalDate: z.string().optional(),
    dueDate: z.string().optional(),
    notes: z.string().optional(),
    alterationStatus: z.enum(['pending', 'ready']).nullable().optional(),
  }).refine((d) => d.rentalDate || d.dueDate || d.notes !== undefined || d.alterationStatus !== undefined, {
    message: 'At least one of rentalDate, dueDate, notes, or alterationStatus must be provided',
  }),
});

export async function updateTransaction(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const updated = await transactionService.updateTransaction(
      String(req.params.id),
      req.user.id,
      { rentalDate: req.body.rentalDate, dueDate: req.body.dueDate, notes: req.body.notes, alterationStatus: req.body.alterationStatus }
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export const swapItemSchema = z.object({
  body: z.object({
    // SECURITY: only the replacement item is accepted — the fee is always
    // re-derived server-side from the item (sale-aware), the promo is voided,
    // and the downpayment is never touched (no refunds).
    newItemId: z.number().int().positive(),
  }),
});

export async function swapBookingItem(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const result = await transactionService.swapBookingItem(
      String(req.params.id),
      req.user.id,
      req.body.newItemId
    );
    res.json(result);
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
      req.body.notes,
      req.body.needsAlteration
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function cancelTransaction(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    // Customers never reach here — the route is staff/admin-only, because a
    // customer cancellation is a REQUEST (message + staff decision), not an
    // action. The service enforces the remaining state rules.
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

export const recordPaymentSchema = z.object({
  body: z.object({
    amount: z.number().positive(),
    method: z.enum(['cash', 'gcash', 'card']),
    notes: z.string().optional(),
  }),
});

export async function recordPayment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const result = await transactionService.recordPayment(
      String(req.params.id),
      req.user.id,
      req.body.amount,
      req.body.method,
      req.body.notes,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

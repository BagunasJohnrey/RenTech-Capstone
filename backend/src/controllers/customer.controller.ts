import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import * as inventoryService from '../services/inventory.service.js';
import * as transactionService from '../services/transactions.service.js';
import * as customerService from '../services/customer.service.js';
import * as storageService from '../services/storage.service.js';
import { MAX_PROOF_BYTES } from '../services/paymentProofs.service.js';
import { sendEmail, isSendableEmail } from '../services/brevo.service.js';
import { createAuditLog } from '../utils/audit.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const createBookingSchema = z.object({
  body: z.object({
    itemId: z.number().int().positive(),
    rentalDate: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid rental date'),
    dueDate: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid due date'),
    downpayment: z.number().min(0).optional(),
    notes: z.string().max(300, 'Notes must be 300 characters or fewer').optional(),
    promoCode: z.string().optional(),
    size: z.string().optional(),
    measurements: z.record(z.any()).optional(),
    // Address typed in the booking form. Persisted to the customer's profile
    // with the booking so staff (and later bookings) see the delivery address.
    address: z.string().trim().min(5, 'Address must be at least 5 characters').max(100).optional(),
    paymentPath: z.enum(['manual']).optional(),
    // Manual-QR checkouts must carry the screenshot in the same request as the
    // booking — the server uploads it FIRST and only then creates the booking.
    paymentProof: z.object({
      // ~7.1M chars ≈ 5MB decoded; the exact byte cap is enforced on the buffer.
      data: z.string().min(1).max(7_100_000),
      contentType: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
      reference: z.string().max(40).optional(),
      channel: z.string().max(40).optional(),
    }).optional(),
  }).superRefine((val, ctx) => {
    if (val.paymentPath === 'manual' && !val.paymentProof) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['paymentProof'],
        message: 'A payment screenshot is required to book with manual QR payment',
      });
    }
  }),
});

export async function getCatalog(req: Request, res: Response, next: NextFunction) {
  try {
    const category = req.query.category as string | undefined;
    const occasion = req.query.occasion as string | undefined;
    const search = req.query.search as string | undefined;
    const items = await inventoryService.listItems('Available', category, search, { occasion });
    res.json(items);
  } catch (err) {
    next(err);
  }
}

export async function getCatalogItem(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Invalid item id');
    const item = await inventoryService.getItem(id);
    res.json(item);
  } catch (err) {
    next(err);
  }
}

export async function createBooking(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    // SECURITY: the rental price is NEVER taken from the client. It is derived
    // server-side from the item (sale-aware) in transactions.service.createRental;
    // only an optional promo code is accepted, and it is resolved server-side.
    const { itemId, rentalDate, dueDate, downpayment, notes, promoCode, size, measurements, address, paymentProof } = req.body;

    // Manual-QR: upload the screenshot BEFORE creating the booking. If storage
    // fails, the request fails and NO booking exists to clean up — the old
    // create-then-upload order is what left unpaid bookings needing proof.
    // Every booking now uses this path (the boutique's static QR is the only
    // payment method), so the proof is always required.
    const requiresProof = true;
    let uploadedProofPath: string | undefined;
    let proofInput: { imagePath: string; reference?: string; channel?: string } | undefined;
    if (requiresProof) {
      if (!paymentProof) {
        throw new AppError(400, 'A payment screenshot is required to book with manual QR payment');
      }
      const buffer = Buffer.from(paymentProof.data, 'base64');
      if (buffer.length === 0) throw new AppError(400, 'Empty image data');
      if (buffer.length > MAX_PROOF_BYTES) throw new AppError(400, 'Screenshot must be 5 MB or smaller');
      const { path } = await storageService.uploadFile(
        `rental/${req.user.id}/proof-${Date.now()}.jpg`,
        paymentProof.contentType,
        buffer,
      );
      uploadedProofPath = path;
      proofInput = {
        imagePath: path,
        reference: paymentProof.reference,
        channel: paymentProof.channel,
      };
    }

    try {
      const tx = await transactionService.createRental({
        customerId: req.user.id,
        itemId,
        rentalDate,
        dueDate,
        downpayment,
        notes,
        promoCode,
        size,
        measurements,
        customerAddress: address,
        paymentPath: 'manual',
        paymentProof: proofInput,
        requireMinimumDownpayment: true, // customers must pay the flat minimum downpayment (default ₱200)
      });

      res.status(201).json(tx);
    } catch (err) {
      // Booking (and its proof row) rolled back — remove the already-uploaded
      // image so a rejected booking can't leave an orphaned screenshot.
      if (uploadedProofPath) {
        try {
          await storageService.removeObject(uploadedProofPath);
        } catch { /* best effort — never mask the booking error */ }
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

const TX_STATUSES = ['Active', 'Reserved', 'Overdue', 'Returned', 'Late', 'Cancelled', 'Completed'] as const;

export async function getBookings(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    const status = req.query.status as string | undefined;
    if (status !== undefined && !TX_STATUSES.includes(status as (typeof TX_STATUSES)[number])) {
      throw new AppError(400, `Invalid status filter: ${status}`);
    }

    const result = await transactionService.listTransactions({
      role: 'Customer',
      profileId: req.user.id,
      status,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getBookingDetail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    const tx = await transactionService.getTransaction(String(req.params.id));

    if (tx.customerId !== req.user.id) {
      throw new AppError(403, 'You can only view your own bookings');
    }

    res.json(tx);
  } catch (err) {
    next(err);
  }
}

// Admin/Staff: update a customer's contact details (name/phone/address/prefs).
// Scoped to non-fee contact fields only — item/fee changes stay cancel+rebook.
export const updateCustomerSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(50, 'Name must be 50 characters or fewer')
      .regex(/^\D+$/, 'Name must not contain numbers').optional(),
    phone: z.string().regex(/^\d{11}$/, 'Phone must be exactly 11 digits').optional().nullable(),
    address: z.string().max(100, 'Address must be 100 characters or fewer').optional().nullable(),
    preferences: z.array(z.string()).optional().nullable(),
  }),
});

export async function updateCustomer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const customer = await customerService.updateCustomer(String(req.params.id), req.body);
    // Audit: who/what changed (performedById = the staff/admin making the edit)
    try {
      await createAuditLog({
        action: 'update',
        entity: 'customer',
        entityId: customer.id,
        performedById: req.user.id,
        newValue: req.body,
      });
    } catch { /* audit is non-critical */ }
    res.json(customer);
  } catch (err) {
    next(err);
  }
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const contactAdminSchema = z.object({
  body: z.object({
    transactionId: z.string().min(1).max(64).optional(),
    message: z
      .string()
      .min(10, 'Message must be at least 10 characters')
      .max(1000, 'Message is too long (max 1000 characters)'),
  }),
});

// Customer → admin message (e.g. "please cancel my booking").
// Primary channel is an in-app notification to admins only — repeat
// messages must NOT be deduped, so this writes directly instead of reusing
// notifyStaffMembers. Admin email is best-effort and never fails the request.
export async function contactAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const { transactionId, message } = req.body as { transactionId?: string; message: string };
    const clean = String(message).trim();

    const customer = await prisma.profile.findUnique({ where: { id: req.user.id } });
    const customerName = customer?.name || req.user.email || 'A customer';

    let tx: { id: string; customerId: string; txNumber?: unknown } | null = null;
    if (transactionId) {
      tx = await transactionService.getTransaction(String(transactionId));
      if (tx.customerId !== req.user.id) {
        throw new AppError(403, 'You can only message about your own bookings');
      }
    }

    const ref = tx ? ` (booking ${String((tx as { txNumber?: unknown }).txNumber ?? tx.id)})` : '';
    const admins = await prisma.profile.findMany({
      where: { role: 'Admin' },
      select: { id: true, email: true },
    });
    if (admins.length) {
      await prisma.notification.createMany({
        data: admins.map((s: { id: string }) => ({
          profileId: s.id,
          transactionId: tx ? tx.id : null,
          type: 'customer_message',
          title: `Message from ${customerName}${ref}`,
          message: clean.slice(0, 500),
        })),
      });
    }

    let emailed = false;
    try {
      const itemRef = tx ? `<p style="color:#6b7280">Booking: ${escapeHtml(String((tx as { txNumber?: unknown }).txNumber ?? tx.id))}</p>` : '';
      for (const a of admins as { email: string }[]) {
        if (!isSendableEmail(a.email)) continue;
        try {
          const r = await sendEmail({
            to: a.email,
            subject: `Customer message${ref} — RenTech`,
            html: `<p><strong>${escapeHtml(customerName)}</strong> wrote:</p><p>${escapeHtml(clean).replace(/\n/g, '<br>')}</p>${itemRef}`,
            text: `${customerName} wrote:\n\n${clean}`,
          });
          if (r.delivered) emailed = true;
        } catch (err) {
          console.error('[contact] admin email skipped:', (err as Error)?.message);
        }
      }
    } catch (err) {
      console.error('[contact] admin email lookup skipped:', (err as Error)?.message);
    }

    try {
      await createAuditLog({
        action: 'contact_admin',
        entity: 'transaction',
        entityId: transactionId ?? req.user.id,
        performedById: req.user.id,
        newValue: { message: clean.slice(0, 500) },
      });
    } catch { /* audit is non-critical */ }

    res.json({ message: 'Message sent to the boutique team', emailed });
  } catch (err) {
    next(err);
  }
}

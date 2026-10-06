import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import authRoutes from './auth.routes.js';
import inventoryRoutes from './inventory.routes.js';
import storageRoutes from './storage.routes.js';
import transactionRoutes from './transactions.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import { catalogRouter, bookingRouter, customerRouter } from './customer.routes.js';
import aiRoutes from './ai.routes.js';
import paymentRoutes from './payments.routes.js';
import smsRoutes from './sms.routes.js';
import notificationRoutes from './notifications.routes.js';
import settingsRoutes from './settings.routes.js';
import promoCodesRoutes from './promoCodes.routes.js';
import exportRoutes from './export.routes.js';

const router = Router();

// Storage self-check: verifies the LIVE backend's own credentials can list
// the configured private bucket. Catches the stale-env class of bug fast:
// the file objects may exist in the bucket while this process signs against
// a wrong/stale bucket (or with a stale key) and 404s every download.
// e.g. GET /api/health?check=storage → { status:'ok', storage:{…} }
router.get('/health', async (req, res) => {
  const base: Record<string, unknown> = { status: 'ok', timestamp: new Date().toISOString() };
  if (String(req.query.check ?? '') !== 'storage') {
    res.json(base);
    return;
  }
  try {
    const [{ supabaseAdmin }, storageService] = await Promise.all([
      import('../config/supabase.js'),
      import('../services/storage.service.js'),
    ]);
    const probePath = 'rental/';
    // Private bucket for `rental/` keys per bucketFor() routing.
    const probeBucket = storageService.bucketFor(probePath);
    const { data, error } = await supabaseAdmin.storage.from(probeBucket).list('rental', { limit: 1 });
    // Key identity WITHOUT leaking the secret: decode the JWT ref/role
    // claims only. Distinguishes "running with .env values" from "shell
    // exports overrode dotenv" (dotenv never overrides existing env vars).
    let keyRef: string | null = null;
    let keyRole: string | null = null;
    try {
      const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
      const claims = JSON.parse(Buffer.from(rawKey.split('.')[1] || '', 'base64').toString());
      keyRef = claims.ref ?? null;
      keyRole = claims.role ?? null;
    } catch { /* unreadable key */ }
    const info = {
      bucket: probeBucket,
      configuredBucket: process.env.STORAGE_BUCKET || '(default rentech-images)',
      supabaseUrl: process.env.SUPABASE_URL || null,
      keyRef,
      keyRole,
      listError: error ? String((error as { message?: unknown }).message ?? error) : null,
      sampleEntries: Array.isArray(data) ? data.length : 0,
    };
    res.json({ ...base, storage: info });
  } catch (err) {
    res.json({ ...base, storage: { error: (err as Error)?.message ?? String(err) } });
  }
});

router.use('/auth', authRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/catalog', catalogRouter);
router.use('/bookings', bookingRouter);
router.use('/customers', customerRouter);
// Storage download is intentionally public (signed URL is the access control)
// so guest catalog browsers can resolve item photos. Upload stays protected
// by its own authMiddleware + requireRole inside storage.routes.ts.
router.use('/storage', storageRoutes);
router.use('/transactions', transactionRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/ai', aiRoutes);
router.use('/payments', paymentRoutes);
router.use('/sms', smsRoutes);
router.use('/notifications', notificationRoutes);
router.use('/settings', settingsRoutes);
router.use('/promo-codes', promoCodesRoutes);
router.use('/export', exportRoutes);

export default router;

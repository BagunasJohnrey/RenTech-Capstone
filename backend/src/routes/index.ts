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

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

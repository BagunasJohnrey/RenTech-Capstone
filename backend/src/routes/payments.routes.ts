import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as paymentsController from '../controllers/payments.controller.js';

const router = Router();

router.post('/create-intent', authMiddleware, requireRole(Role.Customer), validate(paymentsController.createIntentSchema), paymentsController.createPaymentIntent);
// Registered before `/:id` so the literal 'transaction' segment can never be
// read as a payment id. Three segments, so it cannot collide either way.
router.get('/transaction/:transactionId/status', authMiddleware, paymentsController.getPaymentStatus);
router.get('/:id', authMiddleware, paymentsController.getPayment);

export default router;

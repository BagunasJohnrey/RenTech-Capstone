import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as paymentProofsController from '../controllers/paymentProofs.controller.js';

const router = Router();

router.get('/proofs', authMiddleware, requireRole(Role.Admin, Role.Staff), paymentProofsController.listProofs);
router.post('/proofs/:id/approve', authMiddleware, requireRole(Role.Admin, Role.Staff), validate(paymentProofsController.approveProofSchema), paymentProofsController.approveProof);
router.post('/proofs/:id/reject', authMiddleware, requireRole(Role.Admin, Role.Staff), validate(paymentProofsController.rejectProofSchema), paymentProofsController.rejectProof);

export default router;

import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as promoCodesController from '../controllers/promoCodes.controller.js';

const router = Router();

router.use(authMiddleware);

router.get('/', requireRole(Role.Admin, Role.Staff), promoCodesController.listPromoCodes);
router.get('/:id', requireRole(Role.Admin, Role.Staff), promoCodesController.getPromoCode);
router.post('/', requireRole(Role.Admin), validate(promoCodesController.createPromoCodeSchema), promoCodesController.createPromoCode);
router.put('/:id', requireRole(Role.Admin), validate(promoCodesController.updatePromoCodeSchema), promoCodesController.updatePromoCode);
router.delete('/:id', requireRole(Role.Admin), promoCodesController.deletePromoCode);

router.post('/validate', requireRole(Role.Admin, Role.Staff, Role.Customer), validate(promoCodesController.validatePromoCodeSchema), promoCodesController.validatePromoCode);

export default router;

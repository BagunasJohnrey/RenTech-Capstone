import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as dashboardController from '../controllers/dashboard.controller.js';

const router = Router();

router.use(authMiddleware);

router.get('/kpis', requireRole(Role.Admin, Role.Staff), dashboardController.getKpis);
router.get('/today', requireRole(Role.Admin, Role.Staff), dashboardController.getTodayTasks);
// Freshness fingerprint for cross-device polling (staff/admin). Static
// segment — registered before no params, no conflict with /:id (none here).
router.get('/version', requireRole(Role.Admin, Role.Staff), dashboardController.getDataVersion);
// Static segment first so "years" is never parsed as a sub-resource id.
router.get('/years', requireRole(Role.Admin), dashboardController.getAvailableYears);
router.get('/forecast', requireRole(Role.Admin), dashboardController.getForecast);
router.get('/insights', requireRole(Role.Admin), dashboardController.getInsights);
router.get('/bundle', requireRole(Role.Admin), dashboardController.getBundle);

export default router;

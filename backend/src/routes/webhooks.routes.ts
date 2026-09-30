import { Router } from 'express';
import * as webhooksController from '../controllers/webhooks.controller.js';

const router = Router();

router.post('/paymongo', webhooksController.handlePayMongoWebhook);
router.post('/maya', webhooksController.handleMayaWebhook);

export default router;

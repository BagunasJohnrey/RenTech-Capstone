import { Router } from 'express';
import * as webhooksController from '../controllers/webhooks.controller.js';

const router = Router();

router.post('/paymongo', webhooksController.handlePayMongoWebhook);

export default router;

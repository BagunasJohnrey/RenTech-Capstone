import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

describe('SMS routes', () => {
  beforeAll(() => {
    global.fetch = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ message_id: 'sms-mock-id' }]),
    });
  });

  describe('POST /api/sms/send', () => {
    it('should send SMS to a customer', async () => {
      const res = await request(app)
        .post('/api/sms/send')
        .set('Authorization', 'Bearer admin-token')
        .send({ profileId: 'customer-id-111', message: 'Your item is ready for pickup!' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('status', 'sent');
    });

    it('should reject when profile has no phone', async () => {
      const res = await request(app)
        .post('/api/sms/send')
        .set('Authorization', 'Bearer admin-token')
        .send({ profileId: 'no-phone-id', message: 'Test' });

      expect(res.status).toBe(400);
    });

    it('should reject for customer', async () => {
      const res = await request(app)
        .post('/api/sms/send')
        .set('Authorization', 'Bearer customer-token')
        .send({ profileId: 'customer-id-111', message: 'Test' });

      expect(res.status).toBe(403);
    });

    it('should reject when unauthenticated', async () => {
      const res = await request(app)
        .post('/api/sms/send')
        .send({ profileId: 'customer-id-111', message: 'Test' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/sms/history', () => {
    it('should list SMS history for staff', async () => {
      const res = await request(app)
        .get('/api/sms/history')
        .set('Authorization', 'Bearer staff-token');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should reject for customer', async () => {
      const res = await request(app)
        .get('/api/sms/history')
        .set('Authorization', 'Bearer customer-token');

      expect(res.status).toBe(403);
    });
  });
});

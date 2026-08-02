import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

describe('GET /api/notifications', () => {
  it('should list notifications for authenticated user', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should reject unauthenticated', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/notifications/:id/read', () => {
  it('should mark notification as read', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.notification.findUnique.mockResolvedValueOnce({
      id: 'notif-1', profileId: 'profile-id-123', isRead: false,
    });

    const res = await request(app)
      .put('/api/notifications/notif-1/read')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('isRead', true);
  });

  it('should reject for another user\'s notification', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.notification.findUnique.mockResolvedValueOnce({
      id: 'notif-2', profileId: 'other-user-id', isRead: false,
    });

    const res = await request(app)
      .put('/api/notifications/notif-2/read')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
  });

  it('should reject unauthenticated', async () => {
    const res = await request(app).put('/api/notifications/notif-1/read');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/notifications/read-all', () => {
  it('should mark all as read', async () => {
    const res = await request(app)
      .put('/api/notifications/read-all')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(200);
  });
});

describe('GET /api/notifications/unread-count', () => {
  it('should return unread count', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.notification.count.mockResolvedValueOnce(3);

    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('count', 3);
  });
});

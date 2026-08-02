import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

describe('POST /api/auth/signup', () => {
  it('should create a new customer account', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'new@test.com', password: 'password123', name: 'New User' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('session');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe('new@test.com');
  });

  it('should reject invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'notanemail', password: 'password123', name: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should reject short password', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'test@test.com', password: '123', name: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should reject missing name', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'test@test.com', password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /api/auth/login', () => {
  it('should login successfully and return session + profile', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('session');
    expect(res.body).toHaveProperty('user');
    expect(res.body.session.access_token).toBe('mock-access-token-xyz');
  });

  it('should reject missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  it('should return profile when authenticated', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('email', 'test@example.com');
    expect(res.body).toHaveProperty('name', 'Test User');
  });

  it('should return 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  it('should return 401 with malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Invalid');

    expect(res.status).toBe(401);
  });
});

describe('PUT /api/auth/me', () => {
  it('should update profile when authenticated', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', 'Bearer valid-token')
      .send({ name: 'Updated Name', phone: '09180000000' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'Updated Name');
    expect(res.body).toHaveProperty('phone', '09180000000');
  });

  it('should reject empty name', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', 'Bearer valid-token')
      .send({ name: '' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  it('should return success message', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Logged out successfully');
  });
});

describe('Admin: Staff Management', () => {
  const adminAuth = { Authorization: 'Bearer admin-token' };

  describe('POST /api/auth/staff', () => {
    it('should create staff account when admin', async () => {
      const res = await request(app)
        .post('/api/auth/staff')
        .set(adminAuth)
        .send({ email: 'staff@test.com', password: 'staffpass123', name: 'Staff User' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('role', 'Staff');
    });

    it('should reject without admin role', async () => {
      const res = await request(app)
        .post('/api/auth/staff')
        .set('Authorization', 'Bearer customer-token')
        .send({ email: 'staff@test.com', password: 'staffpass123', name: 'Staff User' });

      expect(res.status).toBe(403);
    });

    it('should reject when not authenticated', async () => {
      const res = await request(app)
        .post('/api/auth/staff')
        .send({ email: 'staff@test.com', password: 'staffpass123', name: 'Staff User' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/staff', () => {
    it('should list staff when admin', async () => {
      const res = await request(app)
        .get('/api/auth/staff')
        .set(adminAuth);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should reject non-admin', async () => {
      const res = await request(app)
        .get('/api/auth/staff')
        .set('Authorization', 'Bearer customer-token');

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/auth/staff/:id', () => {
    it('should remove staff when admin', async () => {
      const res = await request(app)
        .delete('/api/auth/staff/staff-id-456')
        .set(adminAuth);

      expect(res.status).toBe(200);
    });

    it('should reject non-admin', async () => {
      const res = await request(app)
        .delete('/api/auth/staff/staff-id-456')
        .set('Authorization', 'Bearer customer-token');

      expect(res.status).toBe(403);
    });

    it('should return 404 for non-existent staff', async () => {
      const res = await request(app)
        .delete('/api/auth/staff/staff-id-404')
        .set(adminAuth);

      expect(res.status).toBe(404);
    });
  });
});

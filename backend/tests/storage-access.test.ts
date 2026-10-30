import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { supabaseAdmin } from '../src/config/supabase.js';
import { prisma } from '../src/config/database.js';

// Who may get a link to a private photo (release/return condition shots and
// payment screenshots under `rental/`, plus their `thumbs/rental/` previews).
// Catalog photos stay public for guests.

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

const createSignedUrl = vi.fn();

beforeEach(() => {
  createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo' }, error: null });
  (supabaseAdmin as any).storage = { from: () => ({ createSignedUrl }) };
});

const OWN_TX = 'tx-own-1';
const OTHER_TX = 'tx-other-2';

describe('GET /api/storage/* private photo access', () => {
  it('lets guests resolve catalog photos without signing in', async () => {
    const res = await request(app).get('/api/storage/seed/gown-01.webp');
    expect(res.status).toBe(200);
    expect(res.body.public).toBe(true);
  });

  it('refuses private photos to guests', async () => {
    const res = await request(app).get(`/api/storage/rental/${OWN_TX}/release-1.webp`);
    expect(res.status).toBe(401);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses private photo previews to guests', async () => {
    const res = await request(app).get(`/api/storage/thumbs/rental/${OWN_TX}/release-1.webp`);
    expect(res.status).toBe(401);
  });

  it('lets a customer see photos of their own booking', async () => {
    prisma.transaction.findUnique.mockResolvedValueOnce({ customerId: 'customer-id-111' });
    const res = await request(app)
      .get(`/api/storage/rental/${OWN_TX}/return-1.webp`)
      .set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://signed.example/photo');
  });

  it('lets a customer see payment screenshots filed under their own id', async () => {
    const res = await request(app)
      .get('/api/storage/rental/customer-id-111/proof-1.webp')
      .set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(200);
  });

  it("hides another customer's booking photos (404, never signed)", async () => {
    prisma.transaction.findUnique.mockResolvedValueOnce({ customerId: 'someone-else' });
    const res = await request(app)
      .get(`/api/storage/thumbs/rental/${OTHER_TX}/release-1.webp`)
      .set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('rejects malformed private paths for customers', async () => {
    const res = await request(app)
      .get('/api/storage/rental/customer-id-111')
      .set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('lets staff see any booking photo', async () => {
    const res = await request(app)
      .get(`/api/storage/rental/${OTHER_TX}/release-1.webp`)
      .set('Authorization', 'Bearer staff-token');
    expect(res.status).toBe(200);
    expect(prisma.transaction.findUnique).not.toHaveBeenCalled();
  });
});

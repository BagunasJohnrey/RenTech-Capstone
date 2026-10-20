import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

// Tiny body limit to exercise the 413 path deterministically.
const smallBodyApp = express();
smallBodyApp.use(express.json({ limit: '1kb' }));
smallBodyApp.use('/api', routes);
smallBodyApp.use(errorHandler);

describe('Error handler: 413', () => {
  it('oversized JSON body → 413 (not 500)', async () => {
    const big = 'x'.repeat(2048);
    const res = await request(smallBodyApp)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send({ notes: big });
    expect(res.status).toBe(413);
  });
});

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

const now = new Date();

// Item 1 never rented (zero-rental dead stock); item 2 has 2 rentals.
const mockItems = [
  { id: 1, name: 'Emerald Gown', category: 'Gown', price: 3500, status: 'Available', onSale: false, transactions: [], _count: { transactions: 0 }, createdAt: now, updatedAt: now },
  { id: 2, name: 'Navy Suit', category: 'Suit', price: 2900, status: 'Available', onSale: false, transactions: [], _count: { transactions: 2 }, createdAt: now, updatedAt: now },
];

const validPayload = {
  itemSuggestions: [
    { itemId: 1, itemName: 'Emerald Gown', discountPct: 25, suggestedExpiryDays: 30, rationale: 'Zero rentals so it needs a pricing push to move dead stock.' },
  ],
  voucherSuggestions: [
    { code: 'BER20', discountPct: 20, maxUses: 50, expiresInDays: 30, rationale: 'BER months early-bird promo to drive advance bookings.' },
  ],
};
const VALID_JSON = JSON.stringify(validPayload);

function geminiReply(text: string) {
  return {
    ok: true,
    json: () => Promise.resolve({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
  };
}

describe('POST /api/ai/suggest-promos', () => {
  beforeAll(async () => {
    // Route suggestPromos past the no-keys fallback into the Gemini path
    // (setup.ts blanks all provider keys so tests never hit live APIs).
    const { env } = await import('../src/config/env.js');
    env.GEMINI_API_KEY = 'test-key';
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findMany.mockResolvedValue(mockItems);
    global.fetch = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(geminiReply(VALID_JSON));
  });

  afterAll(async () => {
    const { env } = await import('../src/config/env.js');
    env.GEMINI_API_KEY = '';
  });

  it('parses preamble-wrapped JSON as source=ai and saves history', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      geminiReply(`Here are your suggestions for this month:\n\`\`\`json\n${VALID_JSON}\n\`\`\`\nGood luck with the promos!`)
    );

    const res = await request(app)
      .post('/api/ai/suggest-promos')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('ai');
    expect(res.body.suggestions.itemSuggestions[0]).toMatchObject({ itemId: 1, discountPct: 25 });
    expect(res.body.suggestions.voucherSuggestions[0]).toMatchObject({ code: 'BER20' });
    expect(res.body).toHaveProperty('suggestionId');
  });

  it('retries a truncated first reply and succeeds', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(geminiReply('{"itemSuggestions": [{"itemId": 1, "itemName": "Emerald'));
    fetchMock.mockResolvedValueOnce(geminiReply(VALID_JSON));

    const res = await request(app)
      .post('/api/ai/suggest-promos')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('ai');
    expect(res.body.suggestions.itemSuggestions).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('drops hallucinated itemIds and backfills zero-rental stock', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      geminiReply(JSON.stringify({
        itemSuggestions: [
          { itemId: 999, itemName: 'Ghost Gown', discountPct: 30, suggestedExpiryDays: 14, rationale: 'An invented item that is not in the inventory list at all.' },
        ],
        voucherSuggestions: validPayload.voucherSuggestions,
      }))
    );

    const res = await request(app)
      .post('/api/ai/suggest-promos')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('ai');
    const ids = res.body.suggestions.itemSuggestions.map((s: { itemId: number }) => s.itemId);
    expect(ids).not.toContain(999);
    // Item 1 (0 rentals) is backfilled so the list is never empty.
    expect(ids).toContain(1);
  });

  it('clamps absurd discountPct values', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      geminiReply(JSON.stringify({
        itemSuggestions: [
          { itemId: 1, itemName: 'Emerald Gown', discountPct: 90, suggestedExpiryDays: 30, rationale: 'An absurd discount that must never reach the Apply button.' },
        ],
        voucherSuggestions: [],
      }))
    );

    const res = await request(app)
      .post('/api/ai/suggest-promos')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('ai');
    expect(res.body.suggestions.itemSuggestions[0].discountPct).toBeLessThanOrEqual(50);
  });

  it('falls back to rule-based suggestions when both attempts are unparseable', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(geminiReply('definitely not json {{{'));
    fetchMock.mockResolvedValueOnce(geminiReply('still not json }}}'));

    const res = await request(app)
      .post('/api/ai/suggest-promos')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('error');
    // Rule-based fallback still returns usable suggestions (dead stock first).
    expect(res.body.suggestions.itemSuggestions.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('suggestionId');
  });

  it('rejects non-admins', async () => {
    const res = await request(app)
      .post('/api/ai/suggest-promos')
      .set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(403);
  });
});

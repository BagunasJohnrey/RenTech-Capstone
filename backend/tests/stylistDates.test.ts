import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';

const chatSpy = vi.fn();
vi.mock('../src/services/gemini.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/gemini.service.js')>();
  return {
    ...actual,
    findFaqAnswerWithAi: () => null,
    chatWithAi: (...args: unknown[]) => { chatSpy(...args); return Promise.resolve({ reply: 'Try the White Gown.', source: 'ai', provider: 'groq', model: 'test' }); },
  };
});
vi.mock('../src/services/rag.service.js', () => ({
  retrieveStylistContext: vi.fn().mockResolvedValue({
    items: [
      { name: 'White Gown', category: 'Gown', price: 1000, onSale: false, salePrice: null, discountPct: null, colors: [] },
      { name: 'Black Suit', category: 'Suit', price: 800, onSale: false, salePrice: null, discountPct: null, colors: [] },
    ],
    policies: [],
    retrieval: 'keyword',
    groundedIn: 2,
  }),
}));

import { extractEventDate, manilaToday, mentionedMonthOnly } from '../src/utils/stylistDates.js';
import { prisma } from '../src/config/database.js';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', routes);
app.use(errorHandler);

// Fixed "now": Nov 19, 2026 10:00 Manila.
const NOW = new Date('2026-11-19T02:00:00Z');
const ymd = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe('extractEventDate', () => {
  it('parses month-name dates and rolls past dates to next year', () => {
    expect(ymd(extractEventDate('wedding on Dec 20', NOW))).toBe('2026-12-20');
    expect(ymd(extractEventDate('debut on December 5th, 2027', NOW))).toBe('2027-12-05');
    expect(ymd(extractEventDate('party on 20 December', NOW))).toBe('2026-12-20');
    expect(ymd(extractEventDate('graduation March 3', NOW))).toBe('2027-03-03');
  });
  it('parses numeric dates and relative words', () => {
    expect(ymd(extractEventDate('event 2026-12-24', NOW))).toBe('2026-12-24');
    expect(ymd(extractEventDate('on 12/20', NOW))).toBe('2026-12-20');
    expect(ymd(extractEventDate('I need it tomorrow', NOW))).toBe('2026-11-20');
  });
  it('returns null without a date or for impossible dates', () => {
    expect(extractEventDate('outfit for a Christmas party', NOW)).toBeNull();
    expect(extractEventDate('Feb 30', NOW)).toBeNull();
  });
  it('detects a month named without a day', () => {
    expect(mentionedMonthOnly('available on dec?', NOW)).toBe('December');
    expect(mentionedMonthOnly('available on Dec 20?', NOW)).toBeNull();
    expect(mentionedMonthOnly('I may need a gown', NOW)).toBeNull();
    expect(mentionedMonthOnly('free in May?', NOW)).toBe('May');
  });
  it('uses the Manila calendar day', () => {
    // 17:00 UTC Nov 19 is already Nov 20 in Manila.
    expect(ymd(manilaToday(new Date('2026-11-19T17:00:00Z')))).toBe('2026-11-20');
  });
});

describe('POST /api/ai/chat date-aware filtering', () => {
  beforeEach(() => {
    chatSpy.mockClear();
    vi.mocked(prisma.transaction.findMany).mockReset().mockResolvedValue([] as never);
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never);
  });

  it('drops items booked around the mentioned date and labels the reply', async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([{ item: { name: 'Black Suit' } }] as never);
    const nextYear = manilaToday().getUTCFullYear() + 1;
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer customer-token')
      .send({ message: `wedding outfit for Dec 20 ${nextYear}` });

    expect(res.status).toBe(200);
    const ctx = chatSpy.mock.calls[0][2] as { items: { name: string }[]; policies: { key: string }[] };
    expect(ctx.items.map((i) => i.name)).toEqual(['White Gown']);
    expect(ctx.policies.some((p) => p.key === 'event_date_availability')).toBe(true);
    expect(res.body.checkedDate).toBe(`${nextYear}-12-20`);
    expect(res.body.bookedExcluded).toBe(1);
    expect(res.body.reply).toContain(`checked against bookings for Dec 20, ${nextYear}`);
  });

  it('picks up the date from an earlier user message', async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([{ item: { name: 'White Gown' } }] as never);
    const nextYear = manilaToday().getUTCFullYear() + 1;
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer customer-token')
      .send({
        message: 'what about a suit instead?',
        history: [{ role: 'user', text: `my event is on Jan 10 ${nextYear}` }, { role: 'assistant', text: 'Sure!' }],
      });

    const ctx = chatSpy.mock.calls[0][2] as { items: { name: string }[] };
    expect(ctx.items.map((i) => i.name)).toEqual(['Black Suit']);
    expect(res.body.checkedDate).toBe(`${nextYear}-01-10`);
  });

  it('answers a named item directly: booked → no, with free alternatives', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { name: 'Navy Blue Sequin Gown', category: 'Gown', status: 'Available' },
      { name: 'White Gown', category: 'Gown', status: 'Available' },
      { name: 'Black Suit', category: 'Suit', status: 'Available' },
    ] as never);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([{ item: { name: 'Navy Blue Sequin Gown' } }] as never);
    const nextYear = manilaToday().getUTCFullYear() + 1;
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer customer-token')
      .send({ message: `Navy Blue Sequin Gown is this free on Dec 20 ${nextYear}?` });

    expect(res.body.source).toBe('availability');
    expect(res.body.bookedItem).toBe('Navy Blue Sequin Gown');
    expect(res.body.reply).toContain('is not available for Dec 20');
    // Same-category alternative listed first; the booked item is not offered.
    expect(res.body.reply.indexOf('White Gown')).toBeLessThan(res.body.reply.indexOf('Black Suit'));
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('answers a named item directly: free → yes', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { name: 'Navy Blue Sequin Gown', category: 'Gown', status: 'Available' },
    ] as never);
    const nextYear = manilaToday().getUTCFullYear() + 1;
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer customer-token')
      .send({ message: `is the navy blue sequin gown available on Dec 20 ${nextYear}` });

    expect(res.body.source).toBe('availability');
    expect(res.body.bookedItem).toBeUndefined();
    expect(res.body.reply).toContain('is free for Dec 20');
  });

  it('asks for the date when a named item has no date', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { name: 'Navy Blue Sequin Gown', category: 'Gown', status: 'Available' },
    ] as never);
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer customer-token')
      .send({ message: 'is the Navy Blue Sequin Gown available?' });

    expect(res.body.source).toBe('availability');
    expect(res.body.reply).toContain("What's your event date?");
  });

  it('month without a day asks which day instead of reusing an older date', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { name: 'Navy Blue Sequin Gown', category: 'Gown', status: 'Available' },
    ] as never);
    const nextYear = manilaToday().getUTCFullYear() + 1;
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer customer-token')
      .send({
        message: 'Is the Navy Blue Sequin Gown available on dec?',
        history: [{ role: 'user', text: `wedding on Jan 10 ${nextYear}` }],
      });

    expect(res.body.source).toBe('availability');
    expect(res.body.checkedDate).toBeUndefined();
    expect(res.body.reply).toContain('Which day in December');
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it('a date-only follow-up checks the item the stylist just asked about', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { name: 'Navy Blue Sequin Gown', category: 'Gown', status: 'Available' },
      { name: 'White Gown', category: 'Gown', status: 'Available' },
    ] as never);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([{ item: { name: 'Navy Blue Sequin Gown' } }] as never);
    const nextYear = manilaToday().getUTCFullYear() + 1;
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer customer-token')
      .send({
        message: `december 20 ${nextYear}`,
        history: [
          { role: 'user', text: 'Is the Navy Blue Sequin Gown available on dec?' },
          { role: 'assistant', text: 'Which day in December is your event? Tell me the exact date (e.g. "Dec 20") and I\'ll check **Navy Blue Sequin Gown**.' },
        ],
      });

    expect(res.body.source).toBe('availability');
    expect(res.body.checkedItem).toBe('Navy Blue Sequin Gown');
    expect(res.body.reply).toContain('is not available for Dec 20');
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('an older "which day?" question does not hijack a new style question', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { name: 'Navy Blue Sequin Gown', category: 'Gown', status: 'Available' },
    ] as never);
    const nextYear = manilaToday().getUTCFullYear() + 1;
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer customer-token')
      .send({
        message: 'Outfit for a Christmas party',
        history: [
          { role: 'user', text: 'Is the Navy Blue Sequin Gown available on dec?' },
          { role: 'assistant', text: "Which day in December is your event? I'll check **Navy Blue Sequin Gown**." },
          { role: 'user', text: `december 29 ${nextYear}` },
          { role: 'assistant', text: `✅ **Navy Blue Sequin Gown** is free for Dec 29, ${nextYear}.` },
        ],
      });

    expect(res.body.source).toBe('ai');
    expect(chatSpy).toHaveBeenCalled();
  });

  it('keeps all items and the generic note when no date is mentioned', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer customer-token')
      .send({ message: 'outfit for a Christmas party' });

    const ctx = chatSpy.mock.calls[0][2] as { items: { name: string }[] };
    expect(ctx.items.map((i) => i.name)).toEqual(['White Gown', 'Black Suit']);
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
    expect(res.body.checkedDate).toBeUndefined();
    expect(res.body.reply).toContain('Availability for your exact dates is confirmed when you book.');
  });
});

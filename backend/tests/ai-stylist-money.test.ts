import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { chatWithAi, findUngroundedAmounts, livePolicyFaq } from '../src/services/gemini.service.js';

const ITEMS = [
  { name: 'Onyx Ornate Barong', category: 'Barong', price: 2800 },
  { name: 'Classic Black Tie Set', category: 'Suit', price: 3500 },
];
const POLICIES = [
  { key: 'min_downpayment', value: '200' },
  { key: 'rental_period_days', value: '3' },
];

describe('findUngroundedAmounts', () => {
  it('flags invented downpayments (₱500, 30%, ₱1,000)', () => {
    expect(findUngroundedAmounts('A ₱500 down-payment secures the reservation.', ITEMS, POLICIES)).toEqual(['₱500']);
    expect(findUngroundedAmounts('Pay a 30 % downpayment via GCash.', ITEMS, POLICIES)).toEqual(['30 %']);
    expect(findUngroundedAmounts('A ₱1,000 down-payment secures the rental.', ITEMS, POLICIES)).toEqual(['₱1,000']);
  });

  it('accepts item prices and live policy numbers', () => {
    const ok = 'The Classic Black Tie Set is ₱3,500. Pay at least ₱200 via QR; the Onyx Ornate Barong is ₱2,800.';
    expect(findUngroundedAmounts(ok, ITEMS, POLICIES)).toEqual([]);
  });

  it('follows a changed rule (admin sets min_downpayment to 300)', () => {
    const changed = [{ key: 'min_downpayment', value: '300' }];
    expect(findUngroundedAmounts('Pay at least ₱300.', ITEMS, changed)).toEqual([]);
    expect(findUngroundedAmounts('Pay at least ₱200.', ITEMS, changed)).toEqual(['₱200']);
  });
});

describe('livePolicyFaq', () => {
  it('rebuilds the downpayment FAQ from the live rule', async () => {
    const res = await chatWithAi('magkano downpayment?', [], { items: [], policies: [{ key: 'min_downpayment', value: '300' }] });
    expect(res.source).toBe('faq');
    expect(res.reply).toContain('₱300');
    expect(res.reply).not.toContain('₱200');
  });

  it('keeps unrelated answers and falls back to static text without the rule', () => {
    expect(livePolicyFaq('Some other answer', POLICIES)).toBe('Some other answer');
    expect(livePolicyFaq(null, POLICIES)).toBeNull();
  });
});

describe('stylist reply with an invented downpayment', () => {
  const geminiOk = (text: string) => ({
    ok: true,
    json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text }] } }] }),
  });

  beforeAll(async () => {
    const { env } = await import('../src/config/env.js');
    env.GEMINI_API_KEY = 'test-key';
    global.fetch = vi.fn();
  });
  afterAll(async () => {
    const { env } = await import('../src/config/env.js');
    env.GEMINI_API_KEY = '';
    vi.unstubAllGlobals();
  });

  it('retries with a correction and returns the grounded rewrite', async () => {
    const f = global.fetch as ReturnType<typeof vi.fn>;
    f.mockReset();
    f.mockResolvedValueOnce(geminiOk('Try the Onyx Ornate Barong! A ₱500 down-payment secures the reservation.'))
      .mockResolvedValueOnce(geminiOk('Try the Onyx Ornate Barong - sleek all-black, very formal.'));
    const res = await chatWithAi('kasalan ninong lalake barong', [], { items: ITEMS, policies: POLICIES });
    expect(f).toHaveBeenCalledTimes(2);
    const correction = JSON.stringify(f.mock.calls[1][1]);
    expect(correction).toContain('NOT in our data');
    expect(res.source).toBe('ai');
    expect(res.reply).not.toContain('₱500');
  });

  it('a clean styling reply passes on the first call', async () => {
    const f = global.fetch as ReturnType<typeof vi.fn>;
    f.mockReset();
    f.mockResolvedValueOnce(geminiOk('A barong suits a ninong. Try the Onyx Ornate Barong - sleek all-black.'));
    const res = await chatWithAi('kasalan ninong lalake barong', [], { items: ITEMS, policies: POLICIES });
    expect(f).toHaveBeenCalledTimes(1);
    expect(res.source).toBe('ai');
  });
});

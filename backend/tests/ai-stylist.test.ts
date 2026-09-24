import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  chatWithAi,
  hasRecommendIntent,
  countGroundedMentions,
  stripDraftMarkers,
  requestedColorFamilies,
  itemColorFamilies,
  findColorMismatches,
} from '../src/services/gemini.service.js';

describe('stylist shopping-intent helpers', () => {
  it('detects shopping intent (events, garments, colors, verbs)', () => {
    for (const m of ['pink', 'just suggest any pink', 'Gown for a debut party', 'What fits a wedding guest?', 'Show me more options', 'any pink dress']) {
      expect(hasRecommendIntent(m)).toBe(true);
    }
  });

  it('ignores pure Q&A', () => {
    for (const m of ['How much is rental?', 'Store location & hours', 'What sizes do you have?', 'How do I book?', 'You are the best!']) {
      expect(hasRecommendIntent(m)).toBe(false);
    }
  });

  it('counts grounded mentions fold-tolerant', () => {
    const names = ['Coral Pink Debut Gown', 'Charcoal Three-Piece Suit'];
    expect(countGroundedMentions('Try the Coral Pink Debut Gown!', names)).toBe(1);
    expect(countGroundedMentions('What shade do you like?', names)).toBe(0);
  });

  it('strips INTRO/OUTRO markers', () => {
    expect(stripDraftMarkers('[INTRO]\n\nHi there!')).toBe('Hi there!');
    expect(stripDraftMarkers('Picks below. [OUTRO]')).toBe('Picks below.');
  });
});

describe('zero-picks gate breaks the question loop', () => {
  const inventory = [{ name: 'Coral Pink Debut Gown', category: 'Gown', price: 3000 }];
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

  it('question-only draft retries, then falls back to real picks', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValue(geminiOk('Are you looking for a specific style in pink? Tell me more!'));
    const res = await chatWithAi('just suggest any pink', [], inventory);
    // Correction retry happened (2 provider calls), then deterministic reply
    // that names a real item — the loop terminates with options, not questions.
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect(res.source).toBe('fallback');
    expect(res.reply).toContain('Coral Pink Debut Gown');
  });

  it('draft with real picks passes through untouched', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(geminiOk('For your debut, try the Coral Pink Debut Gown - romantic and on-theme!'));
    const res = await chatWithAi('any pink dress', [], inventory);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(res.source).toBe('ai');
    expect(res.reply).toContain('Coral Pink Debut Gown');
  });
});

describe('color-fidelity gate', () => {
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

  const PINK_INVENTORY = [
    { name: 'Coral Pink Debut Gown', category: 'Gown', price: 5800 },
    { name: 'Blush Satin Debut Gown', category: 'Gown', price: 5800 },
    { name: 'Peach Ruffle Debut Gown', category: 'Gown', price: 6000 },
    { name: 'Scarlet Lace Debut Gown', category: 'Gown', price: 6200 },
    { name: 'Aqua Lace Debut Gown', category: 'Gown', price: 5400 },
    { name: 'Royal Sapphire Debut Gown', category: 'Gown', price: 7200 },
  ];

  it('maps request and item colors to families', () => {
    expect(requestedColorFamilies('pink gown')).toEqual(['pink']);
    expect(requestedColorFamilies('What fits a wedding guest?')).toEqual([]);
    expect(itemColorFamilies('Royal Sapphire Debut Gown')).toEqual(['blue']);
    expect(itemColorFamilies('Aqua Lace Debut Gown')).toEqual(['blue']);
    expect(itemColorFamilies('Scarlet Lace Debut Gown')).toEqual(['red']);
    expect(itemColorFamilies('Coral Pink Debut Gown')).toEqual(['pink']);
    expect(itemColorFamilies('Enchanted Evening Gown')).toEqual([]);
  });

  it('flags blue/red picks for a pink request, passes true pinks', () => {
    const reply = PINK_INVENTORY.map((i) => `- ${i.name}`).join('\n');
    const bad = findColorMismatches(reply, PINK_INVENTORY, ['pink']);
    expect(bad.map((b) => b.name).sort()).toEqual([
      'Aqua Lace Debut Gown',
      'Royal Sapphire Debut Gown',
      'Scarlet Lace Debut Gown',
    ]);
  });

  it('persistent color violations fall back to pink-only picks', async () => {
    const violating = PINK_INVENTORY.map((i) => `- ${i.name} - Gown`).join('\n');
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: violating }] } }] }),
      });
    const res = await chatWithAi('pink gown', [], PINK_INVENTORY);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect(res.source).toBe('fallback');
    expect(res.reply).toContain('Coral Pink Debut Gown');
    expect(res.reply).toContain('Blush Satin Debut Gown');
    expect(res.reply).toContain('Peach Ruffle Debut Gown');
    expect(res.reply).not.toContain('Sapphire');
    expect(res.reply).not.toContain('Aqua');
    expect(res.reply).not.toContain('Scarlet');
  });
});

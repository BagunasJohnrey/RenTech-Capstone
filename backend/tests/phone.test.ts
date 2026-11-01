import { describe, it, expect } from 'vitest';
import { phMobile, PH_MOBILE_MESSAGE } from '../src/utils/phone.js';

describe('phMobile', () => {
  it('accepts the stored 09 form unchanged', () => {
    expect(phMobile.parse('09171234567')).toBe('09171234567');
  });

  it('normalizes +639 / 639 / spaced input to the stored form', () => {
    expect(phMobile.parse('+639171234567')).toBe('09171234567');
    expect(phMobile.parse('639171234567')).toBe('09171234567');
    expect(phMobile.parse('+63 917 123 4567')).toBe('09171234567');
  });

  it('rejects numbers that are not PH mobiles', () => {
    for (const bad of ['12345678901', '0817123456', '+638171234567', '0917123456', '091712345678']) {
      const r = phMobile.safeParse(bad);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe(PH_MOBILE_MESSAGE);
    }
  });
});

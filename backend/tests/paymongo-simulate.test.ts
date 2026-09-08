import { describe, it, expect, vi } from 'vitest';

// Pre-integration mode: no key + production + PAYMONGO_SIMULATE=true must
// return a fake succeeded intent (flagged simulated) instead of 503.
vi.mock('../src/config/env.js', () => ({
  env: {
    PAYMONGO_SECRET_KEY: '',
    PAYMONGO_SIMULATE: true,
    NODE_ENV: 'production',
  },
}));

import { createPaymentIntent, checkPaymongoHealth } from '../src/services/paymongo.service.js';

describe('paymongo simulate mode (PAYMONGO_SIMULATE=true)', () => {
  it('returns a simulated succeeded intent without a key, even in production', async () => {
    const intent = await createPaymentIntent(2500, 'Test payment', { transactionId: 'tx-1' });
    expect(intent.simulated).toBe(true);
    expect(intent.status).toBe('succeeded');
    expect(intent.amount).toBe(2500);
  });

  it('health probe reports simulate mode', async () => {
    const health = await checkPaymongoHealth();
    expect(health.simulated).toBe(true);
    expect(health.detail).toMatch(/SIMULATE/);
  });
});

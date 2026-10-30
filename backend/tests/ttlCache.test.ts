import { describe, it, expect, vi } from 'vitest';
import { cacheOrCompute, clearDataCache } from '../src/utils/ttlCache.js';

describe('ttlCache', () => {
  it('concurrent misses for one key share a single computation', async () => {
    clearDataCache();
    const compute = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r(1), 10)));
    const [a, b] = await Promise.all([cacheOrCompute('k-share', compute), cacheOrCompute('k-share', compute)]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('a computation that started before a clear never lands in the cache', async () => {
    clearDataCache();
    let release!: (v: string) => void;
    const stale = cacheOrCompute('k-race', () => new Promise<string>((r) => { release = r; }));
    clearDataCache(); // a mutation lands while the old read is in flight
    release('pre-mutation');
    expect(await stale).toBe('pre-mutation');
    const fresh = await cacheOrCompute('k-race', async () => 'post-mutation');
    expect(fresh).toBe('post-mutation');
  });
});

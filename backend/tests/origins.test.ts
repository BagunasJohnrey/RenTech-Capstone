import { describe, it, expect } from 'vitest';
import { buildAllowedOrigins, normalizeOrigin } from '../src/utils/origins.js';

describe('normalizeOrigin', () => {
  it('reduces URLs to scheme + host, dropping paths and trailing slashes', () => {
    expect(normalizeOrigin('https://www.myleneboutique.shop/sign-in')).toBe('https://www.myleneboutique.shop');
    expect(normalizeOrigin('https://www.myleneboutique.shop/')).toBe('https://www.myleneboutique.shop');
  });

  it('keeps explicit ports and lowercases the host', () => {
    expect(normalizeOrigin('https://Shop.Example.com:8443/x')).toBe('https://shop.example.com:8443');
  });

  it('rejects non-http(s) inputs (including the in-app-browser "null" origin)', () => {
    expect(normalizeOrigin('null')).toBe('');
    expect(normalizeOrigin('file:///etc/hosts')).toBe('');
    expect(normalizeOrigin('not a url')).toBe('');
    expect(normalizeOrigin('')).toBe('');
  });
});

describe('buildAllowedOrigins', () => {
  it('adds the www twin of an apex frontend origin', () => {
    const set = buildAllowedOrigins('https://myleneboutique.shop', []);
    expect(set.has('https://myleneboutique.shop')).toBe(true);
    expect(set.has('https://www.myleneboutique.shop')).toBe(true);
  });

  it('adds the apex twin of a www frontend origin', () => {
    const set = buildAllowedOrigins('https://www.myleneboutique.shop', []);
    expect(set.has('https://myleneboutique.shop')).toBe(true);
    expect(set.has('https://www.myleneboutique.shop')).toBe(true);
  });

  it('preserves explicit ports on twins', () => {
    const set = buildAllowedOrigins('https://www.shop.example:8443', []);
    expect(set.has('https://shop.example:8443')).toBe(true);
  });

  it('never invents a www twin for multi-label subdomains', () => {
    const set = buildAllowedOrigins('https://app.shop.example', []);
    expect(set.has('https://app.shop.example')).toBe(true);
    expect(set.has('https://www.app.shop.example')).toBe(false);
  });

  it('includes extra origins (e.g. a legacy deployment host)', () => {
    const set = buildAllowedOrigins(
      'https://www.myleneboutique.shop',
      ['https://rentech-myleneboutique.vercel.app'],
    );
    expect(set.has('https://rentech-myleneboutique.vercel.app')).toBe(true);
    expect(set.has('https://www.rentech-myleneboutique.vercel.app')).toBe(false);
  });

  it('ignores invalid entries without throwing', () => {
    const set = buildAllowedOrigins('https://shop.example', ['null', '', 'ftp://x.example']);
    expect(set.has('https://shop.example')).toBe(true);
    expect(set.has('https://www.shop.example')).toBe(true);
    expect(set.has('null')).toBe(false);
  });

  it('always includes localhost dev origins', () => {
    const set = buildAllowedOrigins('https://shop.example', []);
    expect(set.has('http://localhost:5173')).toBe(true);
    expect(set.has('http://127.0.0.1:3000')).toBe(true);
  });
});

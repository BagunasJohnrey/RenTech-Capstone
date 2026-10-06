import { describe, it, expect, beforeAll } from 'vitest';
import * as crypto from 'crypto';
import { verifyJwtLocally, __setJwksForTest } from '../src/middleware/jwtVerify.js';

// ES256 local-verify: the live project signs access tokens with P-256, so
// this pins a generated keypair as the JWKS (no network) and proves a token
// signed by the private key verifies — plus the negative cases (wrong key,
// expired, garbage) fall through to null so auth falls back to getUser().
const b64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let pubJwk: { kty: string; crv: string; x: string; y: string };
let sign: (header: object, payload: object) => string;
let signWith: (key: crypto.KeyObject, header: object, payload: object) => string;

beforeAll(() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  pubJwk = publicKey.export({ format: 'jwk' }) as unknown as typeof pubJwk;
  __setJwksForTest({
    keys: [{ kid: 'test-kid', kty: 'EC', alg: 'ES256', use: 'sig', crv: 'P-256', x: pubJwk.x, y: pubJwk.y }],
  });
  signWith = (key: crypto.KeyObject, header: object, payload: object) => {
    const h = b64url(Buffer.from(JSON.stringify(header)));
    const p = b64url(Buffer.from(JSON.stringify(payload)));
    const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), key);
    return `${h}.${p}.${b64url(sig)}`;
  };
  sign = (header: object, payload: object) => signWith(privateKey, header, payload);
});

const payload = (over: object = {}) => ({
  sub: 'user-123',
  aud: 'authenticated',
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...over,
});

describe('verifyJwtLocally (ES256)', () => {
  it('verifies a token signed by the JWKS key', async () => {
    const token = sign({ alg: 'ES256', kid: 'test-kid', typ: 'JWT' }, payload());
    const v = await verifyJwtLocally(token);
    expect(v).not.toBeNull();
    expect(v?.sub).toBe('user-123');
    expect(v?.aud).toBe('authenticated');
  });

  it('rejects a token signed by a different key', async () => {
    const { privateKey: other } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const token = signWith(other, { alg: 'ES256', kid: 'test-kid', typ: 'JWT' }, payload());
    expect(await verifyJwtLocally(token)).toBeNull();
  });

  it('rejects expired tokens without network', async () => {
    const token = sign(
      { alg: 'ES256', kid: 'test-kid', typ: 'JWT' },
      payload({ exp: Math.floor(Date.now() / 1000) - 10 })
    );
    expect(await verifyJwtLocally(token)).toBeNull();
  });

  it('returns null for non-JWT test tokens (falls back to getUser)', async () => {
    expect(await verifyJwtLocally('admin-token')).toBeNull();
    expect(await verifyJwtLocally('')).toBeNull();
    expect(await verifyJwtLocally('a.b')).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const good = sign({ alg: 'ES256', kid: 'test-kid', typ: 'JWT' }, payload());
    const [h, p, s] = good.split('.');
    const tamperedPayload = b64url(
      Buffer.from(JSON.stringify(payload({ sub: 'attacker' })))
    );
    expect(await verifyJwtLocally(`${h}.${tamperedPayload}.${s}`)).toBeNull();
    expect(p).toBeTruthy(); // sanity: parts parsed
  });
});

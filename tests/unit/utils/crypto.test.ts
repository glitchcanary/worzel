import { describe, it, expect } from 'vitest';
import {
  secureRandomHex,
  hmacSha256,
  generateToken,
  verifyToken,
} from '../../../src/utils/crypto.js';

describe('secureRandomHex', () => {
  it('generates hex string of correct length', () => {
    const hex = secureRandomHex(16);
    expect(hex).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it('generates unique values', () => {
    const a = secureRandomHex();
    const b = secureRandomHex();
    expect(a).not.toBe(b);
  });
});

describe('hmacSha256', () => {
  it('produces consistent signatures', () => {
    const sig1 = hmacSha256('secret', 'data');
    const sig2 = hmacSha256('secret', 'data');
    expect(sig1).toBe(sig2);
  });

  it('produces different signatures for different data', () => {
    const sig1 = hmacSha256('secret', 'data1');
    const sig2 = hmacSha256('secret', 'data2');
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different keys', () => {
    const sig1 = hmacSha256('key1', 'data');
    const sig2 = hmacSha256('key2', 'data');
    expect(sig1).not.toBe(sig2);
  });

  it('produces 64-character hex string', () => {
    const sig = hmacSha256('key', 'data');
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });
});

describe('generateToken / verifyToken', () => {
  const secret = 'a-very-secure-secret-for-testing-purposes!';

  it('generates a valid token that can be verified', () => {
    const token = generateToken(secret, 'device-001', 3600);
    const result = verifyToken(secret, token);
    expect(result).toBe('device-001');
  });

  it('rejects expired tokens', () => {
    // Generate token with 0 TTL (already expired)
    const token = generateToken(secret, 'device-001', -1);
    const result = verifyToken(secret, token);
    expect(result).toBeNull();
  });

  it('rejects tampered tokens', () => {
    const token = generateToken(secret, 'device-001', 3600);
    const tampered = token.slice(0, -1) + 'x';
    const result = verifyToken(secret, tampered);
    expect(result).toBeNull();
  });

  it('rejects tokens with wrong secret', () => {
    const token = generateToken(secret, 'device-001', 3600);
    const result = verifyToken('wrong-secret', token);
    expect(result).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyToken(secret, '')).toBeNull();
    expect(verifyToken(secret, 'not.a.token.at.all')).toBeNull();
    expect(verifyToken(secret, 'abc')).toBeNull();
    expect(verifyToken(secret, '...')).toBeNull();
  });

  it('token format is expiry.deviceId.signature', () => {
    const token = generateToken(secret, 'device-001', 3600);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    const expiry = parseInt(parts[0]!, 10);
    expect(expiry).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(parts[1]).toBe('device-001');
  });
});

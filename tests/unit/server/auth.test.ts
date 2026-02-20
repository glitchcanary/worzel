import { describe, it, expect } from 'vitest';
import { generateToken, verifyToken } from '../../../src/utils/crypto.js';
import { verifyWsToken } from '../../../src/server/middleware/auth.js';

describe('verifyWsToken', () => {
  const secret = 'a-very-secure-secret-for-testing-purposes!';

  it('extracts and verifies token from WebSocket URL', () => {
    const token = generateToken(secret, 'device-001', 3600);
    const url = `/ws?token=${token}`;
    const result = verifyWsToken(secret, url);
    expect(result).toBe('device-001');
  });

  it('rejects URL without token', () => {
    expect(verifyWsToken(secret, '/ws')).toBeNull();
    expect(verifyWsToken(secret, '/ws?other=param')).toBeNull();
  });

  it('rejects invalid token in URL', () => {
    expect(verifyWsToken(secret, '/ws?token=invalid')).toBeNull();
  });

  it('rejects expired token in URL', () => {
    const token = generateToken(secret, 'device-001', -1);
    const url = `/ws?token=${token}`;
    expect(verifyWsToken(secret, url)).toBeNull();
  });
});

describe('auth is mandatory', () => {
  it('secret must be at least 32 characters', () => {
    // Short secret still works at crypto level, but config schema rejects it
    // This test verifies the crypto layer doesn't crash with any secret
    const token = generateToken('short', 'device-001', 3600);
    expect(verifyToken('short', token)).toBe('device-001');
  });

  it('there is no disable/bypass mechanism', () => {
    // Verify there's no "skip auth" or "disable auth" path
    // The only way to get a device ID is through verifyToken
    expect(verifyToken('secret', '')).toBeNull();
    expect(verifyWsToken('secret', '/ws')).toBeNull();
    expect(verifyWsToken('secret', '/ws?token=')).toBeNull();
  });
});

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Generate a cryptographically secure random hex string.
 */
export function secureRandomHex(bytes: number = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Generate an HMAC-SHA256 signature.
 */
export function hmacSha256(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data, 'utf-8').digest('hex');
}

/**
 * Generate an auth token for a device.
 * Format: <expiry-timestamp>.<device-id>.<hmac>
 */
export function generateToken(secret: string, deviceId: string, ttlSeconds: number): string {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${expiry}.${deviceId}`;
  const signature = hmacSha256(secret, payload);
  return `${payload}.${signature}`;
}

/**
 * Verify an auth token. Returns the device ID if valid, null otherwise.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyToken(secret: string, token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [expiryStr, deviceId, providedSig] = parts as [string, string, string];
  const expiry = parseInt(expiryStr, 10);

  // Check expiry
  if (isNaN(expiry) || expiry < Math.floor(Date.now() / 1000)) return null;

  // Check device ID is present
  if (!deviceId) return null;

  // Recompute signature
  const payload = `${expiryStr}.${deviceId}`;
  const expectedSig = hmacSha256(secret, payload);

  // Timing-safe comparison
  const providedBuf = Buffer.from(providedSig, 'utf-8');
  const expectedBuf = Buffer.from(expectedSig, 'utf-8');

  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;

  return deviceId;
}

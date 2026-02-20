import type { RateLimitConfig } from '../../config/schema.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory rate limiter for per-IP and per-device limits.
 * Not shared across processes (fine for single-process architecture).
 */
export class RateLimiter {
  private ipBuckets = new Map<string, RateLimitEntry>();
  private deviceBuckets = new Map<string, RateLimitEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: RateLimitConfig) {}

  start(): void {
    // Clean up expired entries every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.ipBuckets.clear();
    this.deviceBuckets.clear();
  }

  /**
   * Check if a request is allowed.
   * Returns { allowed: true } or { allowed: false, retryAfterMs }.
   */
  checkIp(ip: string): { allowed: boolean; retryAfterMs?: number } {
    return this.check(this.ipBuckets, ip, this.config.maxPerIpPerMinute);
  }

  checkDevice(deviceId: string): { allowed: boolean; retryAfterMs?: number } {
    return this.check(this.deviceBuckets, deviceId, this.config.maxPerDevicePerMinute);
  }

  private check(
    buckets: Map<string, RateLimitEntry>,
    key: string,
    maxPerMinute: number,
  ): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const entry = buckets.get(key);

    if (!entry || now >= entry.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + 60_000 });
      return { allowed: true };
    }

    if (entry.count >= maxPerMinute) {
      return { allowed: false, retryAfterMs: entry.resetAt - now };
    }

    entry.count++;
    return { allowed: true };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.ipBuckets) {
      if (now >= entry.resetAt) this.ipBuckets.delete(key);
    }
    for (const [key, entry] of this.deviceBuckets) {
      if (now >= entry.resetAt) this.deviceBuckets.delete(key);
    }
  }
}

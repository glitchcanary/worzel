/**
 * ExternalStoryLoader — fetches .fink.js files from the web.
 *
 * Security constraints:
 * - HTTPS only (except localhost for development)
 * - Host allowlist via FINK_EXTERNAL_HOSTS env var
 * - Size limit (default 512KB — Ink stories are text)
 * - Request timeout (default 10 seconds)
 * - Uses standard fetch(), not the provider endpoint guard
 */

import type pino from 'pino';

export interface ExternalStoryLoaderOptions {
  /** Allowed hostnames (e.g. ["danbri.github.io"]) */
  allowedHosts: string[];
  /** Max response size in bytes (default 512KB) */
  maxSizeBytes?: number;
  /** Request timeout in ms (default 10000) */
  timeoutMs?: number;
  logger?: pino.Logger;
}

export class ExternalStoryLoader {
  private readonly allowedHosts: Set<string>;
  private readonly maxSize: number;
  private readonly timeout: number;
  private readonly logger?: pino.Logger;

  constructor(options: ExternalStoryLoaderOptions) {
    this.allowedHosts = new Set(
      options.allowedHosts.map(h => h.toLowerCase()),
    );
    this.maxSize = options.maxSizeBytes ?? 512 * 1024;
    this.timeout = options.timeoutMs ?? 10_000;
    this.logger = options.logger;
  }

  /**
   * Fetch a .fink.js file from a URL.
   * Validates host against allowlist and enforces size/timeout limits.
   */
  async fetch(url: string): Promise<string> {
    const parsed = new URL(url);

    // HTTPS only (except localhost for development)
    if (parsed.protocol !== 'https:' && !isLocalhost(parsed.hostname)) {
      throw new Error(`External story fetch requires HTTPS: ${parsed.hostname}`);
    }

    // Host allowlist
    if (!this.isHostAllowed(parsed.hostname)) {
      throw new Error(
        `Host not in FINK_EXTERNAL_HOSTS allowlist: ${parsed.hostname}`,
      );
    }

    this.logger?.info({ url }, 'Fetching external .fink.js');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'text/plain, application/javascript, */*' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${url}`);
      }

      // Check content-length header if available
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > this.maxSize) {
        throw new Error(
          `External story too large: ${contentLength} bytes (max ${this.maxSize})`,
        );
      }

      const text = await response.text();
      if (text.length > this.maxSize) {
        throw new Error(
          `External story too large: ${text.length} chars (max ${this.maxSize})`,
        );
      }

      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  private isHostAllowed(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    if (isLocalhost(lower)) return true;
    return this.allowedHosts.has(lower);
  }
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  );
}

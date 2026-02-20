import { isAllowedEndpoint } from '../config/allowlist.js';

export class EndpointBlockedError extends Error {
  constructor(url: string) {
    // Don't include the full URL in the error message to avoid leaking it in logs
    const hostname = new URL(url).hostname;
    super(`Provider endpoint blocked: ${hostname} is not on the allowlist`);
    this.name = 'EndpointBlockedError';
  }
}

/**
 * Guard that validates a URL against the allowlist before making any HTTP request.
 * This is the last line of defense — even if config validation is bypassed somehow,
 * no HTTP call to a non-allowlisted endpoint will succeed.
 */
export function guardEndpoint(url: string): void {
  if (!isAllowedEndpoint(url)) {
    throw new EndpointBlockedError(url);
  }
}

/**
 * Create a fetch wrapper that enforces the endpoint allowlist.
 * Use this instead of raw fetch for all provider HTTP calls.
 */
export function createGuardedFetch(): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.toString()
      : input.url;

    guardEndpoint(url);
    return fetch(input, init);
  };
}

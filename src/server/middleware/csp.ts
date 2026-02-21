import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Content-Security-Policy headers.
 * Strict by default: only allow same-origin resources.
 */
const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // unsafe-inline needed for Web Components Shadow DOM
  "img-src 'self' data:",
  "connect-src 'self' wss: ws:", // Allow WebSocket connections
  "media-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export async function cspHook(
  _request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  reply.header('Content-Security-Policy', CSP_HEADER);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'microphone=(*), camera=()');
  reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  return payload;
}

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type pino from 'pino';
import type { AppConfig } from '../config/schema.js';
import { createOtaHandler } from './middleware/auth.js';
import { buildCorsOptions } from './middleware/cors.js';
import { cspHook } from './middleware/csp.js';

/**
 * Create and configure the Fastify HTTP server.
 * Handles: OTA auth endpoint, health check, WHIP signaling (Phase 1 stub),
 * and static file serving for the web client (Phase 3).
 */
export async function createHttpServer(config: AppConfig, logger: pino.Logger) {
  const app = Fastify({
    logger: false, // We use our own logger
    trustProxy: false, // Only trust proxy if explicitly enabled
    bodyLimit: 1_048_576, // 1MB max body
  });

  // CORS
  await app.register(fastifyCors, buildCorsOptions(config.cors));

  // CSP and security headers
  app.addHook('onSend', cspHook);

  // Health check
  app.get('/api/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    sessions: 0, // Will be wired to session manager
  }));

  // OTA authentication endpoint (xiaozhi protocol)
  // WebSocket URL is derived from the request Host header so it works
  // regardless of bind address (0.0.0.0, 127.0.0.1, etc.)
  app.post('/api/ota', createOtaHandler(config.auth, config.server));

  // WHIP signaling endpoint stub (WebRTC Phase 1)
  app.post('/api/whip', async (_request, reply) => {
    logger.info('WHIP endpoint called (WebRTC signaling — full implementation in Phase 1+)');
    reply.status(501).send({ error: 'not_implemented', message: 'WebRTC WHIP signaling coming soon' });
  });

  // Serve web client static files
  const currentFile = fileURLToPath(import.meta.url);
  const webClientDir = join(dirname(currentFile), '..', 'web-client');
  await app.register(fastifyStatic, {
    root: webClientDir,
    prefix: '/',
    decorateReply: false,
  });

  return app;
}

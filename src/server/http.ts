import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type pino from 'pino';
import type { AppConfig } from '../config/schema.js';
import { createOtaHandler } from './middleware/auth.js';
import { buildCorsOptions } from './middleware/cors.js';
import { cspHook } from './middleware/csp.js';
import type { FillerCache } from '../pipeline/filler-cache.js';

/**
 * Create and configure the Fastify HTTP server.
 * Handles: OTA auth endpoint, health check, WHIP signaling (Phase 1 stub),
 * and static file serving for the web client (Phase 3).
 */
export async function createHttpServer(config: AppConfig, logger: pino.Logger) {
  // TLS support: if cert and key paths are provided, enable HTTPS
  const tlsOptions = config.server.tlsCert && config.server.tlsKey
    ? {
        https: {
          cert: readFileSync(config.server.tlsCert),
          key: readFileSync(config.server.tlsKey),
        },
      }
    : {};

  const app = Fastify({
    ...tlsOptions,
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

  // Settings endpoint — exposes safe config (no secrets, no URLs, no keys)
  // fillerCache reference is set later via setFillerCache()
  let _fillerCache: FillerCache | undefined;
  app.get('/.well-known/x-wzl-settings', async () => ({
    llm: {
      provider: config.llm.provider,
      model: config.llm.model,
      systemPrompt: config.llm.systemPrompt,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
    },
    tts: {
      provider: config.tts.provider,
      voice: config.tts.voice,
      model: config.tts.model,
      sampleRate: config.tts.sampleRate,
    },
    asr: {
      provider: config.asr.provider,
      model: config.asr.model,
      language: config.asr.language,
    },
    llmSmart: config.llmSmart.model ? {
      provider: config.llmSmart.provider,
      model: config.llmSmart.model,
    } : null,
    fillers: _fillerCache ? {
      ready: _fillerCache.isReady,
      count: _fillerCache.count,
    } : null,
  }));

  // Allow setting fillerCache after server creation
  (app as unknown as { setFillerCache: (fc: FillerCache) => void }).setFillerCache =
    (fc: FillerCache) => { _fillerCache = fc; };

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

/**
 * Register filler audio endpoints once the cache is ready.
 */
export function registerFillerRoutes(app: FastifyInstance, fillerCache: FillerCache): void {
  // List all filler texts
  app.get('/.well-known/x-wzl-fillers', async () => ({
    fillers: fillerCache.getTexts(),
    count: fillerCache.count,
  }));

  // Get audio for a specific filler by index
  app.get<{ Params: { index: string } }>('/.well-known/x-wzl-fillers/:index', async (request, reply) => {
    const index = parseInt(request.params.index, 10);
    const filler = fillerCache.getFiller(index);
    if (!filler) {
      reply.status(404).send({ error: 'Filler not found' });
      return;
    }
    reply.header('Content-Type', 'audio/pcm');
    reply.header('X-Sample-Rate', String(filler.sampleRate));
    reply.send(filler.audio);
  });
}

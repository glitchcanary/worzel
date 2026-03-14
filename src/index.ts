import { createHttpServer, registerFillerRoutes } from './server/http.js';
import { createWebSocketServer } from './server/websocket.js';
import { FillerCache } from './pipeline/filler-cache.js';
import { createAppRuntime, listenWithPortHandling } from './server/runtime.js';

async function main(): Promise<void> {
  const { config, logger, providers, sessionManager } = createAppRuntime({
    startupMessage: 'Starting worzel server...',
  });

  // Create HTTP server
  const app = await createHttpServer(config, logger);

  // Pre-cache filler audio in background (non-blocking)
  const fillerCache = new FillerCache();
  registerFillerRoutes(app, fillerCache);
  // Wire filler cache into settings endpoint
  (app as unknown as { setFillerCache: (fc: typeof fillerCache) => void }).setFillerCache(fillerCache);

  // Start HTTP server
  const address = await listenWithPortHandling(app, {
    port: config.server.port,
    host: config.server.host,
    inUseMessage: "Kill the existing server first: pkill -f 'node worzel/dist/index.js'",
  });

  logger.info({ address }, 'HTTP server listening');

  // Get the underlying Node.js HTTP server for WebSocket upgrade
  const httpServer = app.server;

  // Create WebSocket server (attaches to HTTP server, with filler cache for latency masking)
  const wss = createWebSocketServer(httpServer, config, sessionManager, providers, logger, fillerCache);

  logger.info({ path: '/ws' }, 'WebSocket server ready');
  logger.info({ path: '/api/ota' }, 'OTA auth endpoint ready');
  logger.info({ path: '/api/health' }, 'Health check endpoint ready');
  if (config.twilio.accountSid) {
    logger.info({ path: '/api/telephony/twiml' }, 'Twilio TwiML webhook ready');
  }
  logger.info({
    host: config.server.host,
    port: config.server.port,
    llmProvider: config.llm.provider,
    asrProvider: config.asr.provider,
    ttsProvider: config.tts.provider,
  }, 'Worzel server started');

  // Init filler cache in background (non-blocking)
  fillerCache.init(providers.tts, logger).catch(err => {
    logger.warn({ err }, 'Filler cache init failed (non-fatal)');
  });

  // Graceful shutdown
  let shutdownStarted = false;
  let forcedExitTimer: NodeJS.Timeout | null = null;
  const shutdown = async (signal: string) => {
    if (shutdownStarted) {
      logger.warn({ signal }, 'Shutdown already in progress');
      return;
    }
    shutdownStarted = true;
    logger.info({ signal }, 'Shutting down...');
    forcedExitTimer = setTimeout(() => {
      logger.error({ signal }, 'Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 1000);
    try {
      wss.close();
      sessionManager.stop();
      await app.close();
      if (forcedExitTimer) clearTimeout(forcedExitTimer);
      process.exit(0);
    } catch (err) {
      if (forcedExitTimer) clearTimeout(forcedExitTimer);
      logger.error({ err, signal }, 'Shutdown failed; forcing exit');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

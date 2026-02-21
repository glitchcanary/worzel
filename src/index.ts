import { loadConfig } from './config/loader.js';
import { createLogger } from './utils/logger.js';
import { createHttpServer, registerFillerRoutes } from './server/http.js';
import { createWebSocketServer } from './server/websocket.js';
import { SessionManager } from './session/manager.js';
import { createProviders } from './providers/registry.js';
import { FillerCache } from './pipeline/filler-cache.js';

async function main(): Promise<void> {
  // Load and validate config
  const configPath = process.env['WORZEL_CONFIG_FILE'];
  let config;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    console.error('Configuration error:', (err as Error).message);
    process.exit(1);
  }

  // Create logger
  const logger = createLogger(config.logLevel);
  logger.info('Starting worzel server...');

  // Create providers (ASR, LLM, TTS)
  const providers = createProviders(config);
  logger.info({
    asr: config.asr.provider,
    llm: `${config.llm.provider}/${config.llm.model}`,
    tts: config.tts.provider,
  }, 'Providers initialized');

  // Create session manager
  const sessionManager = new SessionManager(config.session, logger);
  sessionManager.start();

  // Create HTTP server
  const app = await createHttpServer(config, logger);

  // Start HTTP server
  let address: string;
  try {
    address = await app.listen({
      port: config.server.port,
      host: config.server.host,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`\nERROR: Port ${config.server.port} is already in use.`);
      console.error(`Kill the existing server first: pkill -f 'node worzel/dist/index.js'\n`);
      process.exit(1);
    }
    throw err;
  }

  logger.info({ address }, 'HTTP server listening');

  // Get the underlying Node.js HTTP server for WebSocket upgrade
  const httpServer = app.server;

  // Create WebSocket server (attaches to HTTP server)
  const wss = createWebSocketServer(httpServer, config, sessionManager, providers, logger);

  logger.info({ path: '/ws' }, 'WebSocket server ready');
  logger.info({ path: '/api/ota' }, 'OTA auth endpoint ready');
  logger.info({ path: '/api/health' }, 'Health check endpoint ready');
  logger.info({
    host: config.server.host,
    port: config.server.port,
    llmProvider: config.llm.provider,
    asrProvider: config.asr.provider,
    ttsProvider: config.tts.provider,
  }, 'Worzel server started');

  // Pre-cache filler audio in background (non-blocking)
  const fillerCache = new FillerCache();
  registerFillerRoutes(app, fillerCache);
  fillerCache.init(providers.tts, logger).catch(err => {
    logger.warn({ err }, 'Filler cache init failed (non-fatal)');
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    wss.close();
    sessionManager.stop();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

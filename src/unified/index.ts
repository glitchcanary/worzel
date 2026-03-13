import { loadConfig } from '../config/loader.js';
import { createLogger } from '../utils/logger.js';
import { createHttpServer, registerFillerRoutes } from '../server/http.js';
import { createNoServerWebSocketServers } from '../server/websocket.js';
import { SessionManager } from '../session/manager.js';
import { createProviders } from '../providers/registry.js';
import { FillerCache } from '../pipeline/filler-cache.js';
import { createNoServerFinkWebSocketServer, registerFinkModule } from '../fink/module.js';

async function main(): Promise<void> {
  const configPath = process.env['WORZEL_CONFIG_FILE'];
  let config;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    console.error('Configuration error:', (err as Error).message);
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);
  logger.info('Starting unified worzel server...');

  const providers = createProviders(config);
  logger.info({
    asr: config.asr.provider,
    llm: `${config.llm.provider}/${config.llm.model}`,
    tts: config.tts.provider,
  }, 'Providers initialized');

  const sessionManager = new SessionManager(config.session, logger);
  sessionManager.start();

  const app = await createHttpServer(config, logger);
  const fillerCache = new FillerCache();
  registerFillerRoutes(app, fillerCache);
  (app as unknown as { setFillerCache: (fc: typeof fillerCache) => void }).setFillerCache(fillerCache);
  const finkRuntime = await registerFinkModule({
    app,
    config,
    providers,
    logger,
    sessionManager,
  });

  let address: string;
  try {
    address = await app.listen({
      port: config.server.port,
      host: config.server.host,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`\nERROR: Port ${config.server.port} is already in use.`);
      process.exit(1);
    }
    throw err;
  }

  const httpServer = app.server;
  const { mainWss, twilioWss } = createNoServerWebSocketServers(
    config, sessionManager, providers, logger, fillerCache,
  );
  const finkWss = createNoServerFinkWebSocketServer(finkRuntime);

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (pathname === '/ws') {
      mainWss.handleUpgrade(request, socket, head, (ws, req) => {
        mainWss.emit('connection', ws, req);
      });
      return;
    }

    if (pathname === '/ws/fink') {
      finkWss.handleUpgrade(request, socket, head, (ws, req) => {
        finkWss.emit('connection', ws, req);
      });
      return;
    }

    if (pathname === '/ws/twilio' && twilioWss) {
      twilioWss.handleUpgrade(request, socket, head, (ws, req) => {
        twilioWss.emit('connection', ws, req);
      });
      return;
    }

    socket.destroy();
  });

  logger.info({ address }, 'Unified HTTP server listening');
  logger.info({ path: '/ws' }, 'Main WebSocket server ready');
  logger.info({ path: '/ws/fink' }, 'Fink WebSocket server ready');
  logger.info({ path: '/fink/' }, 'Fink UI ready');
  logger.info({
    host: config.server.host,
    port: config.server.port,
  }, 'Unified worzel server started');

  fillerCache.init(providers.tts, logger).catch(err => {
    logger.warn({ err }, 'Filler cache init failed (non-fatal)');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    mainWss.close();
    finkWss.close();
    twilioWss?.close();
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

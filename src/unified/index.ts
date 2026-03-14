import { createHttpServer, registerFillerRoutes } from '../server/http.js';
import { createNoServerWebSocketServers } from '../server/websocket.js';
import { FillerCache } from '../pipeline/filler-cache.js';
import { createNoServerFinkWebSocketServer, registerFinkModule } from '../fink/module.js';
import { createAppRuntime, listenWithPortHandling } from '../server/runtime.js';

async function main(): Promise<void> {
  const { config, logger, providers, sessionManager } = createAppRuntime({
    startupMessage: 'Starting unified worzel server...',
  });

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

  const address = await listenWithPortHandling(app, {
    port: config.server.port,
    host: config.server.host,
  });

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
      mainWss.close();
      finkWss.close();
      twilioWss?.close();
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

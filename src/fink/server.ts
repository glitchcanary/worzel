import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { buildCorsOptions } from '../server/middleware/cors.js';
import { cspHook } from '../server/middleware/csp.js';
import { attachFinkWebSocketServer, registerFinkModule } from './module.js';
import { createAppRuntime, listenWithPortHandling } from '../server/runtime.js';

const FINK_PORT = parseInt(process.env['FINK_PORT'] ?? '3001', 10);

async function main(): Promise<void> {
  const { config, logger, providers, sessionManager } = createAppRuntime({
    startupMessage: 'Starting Fink server...',
  });

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
    logger: false,
    trustProxy: false,
    bodyLimit: 1_048_576,
  });

  await app.register(fastifyCors, buildCorsOptions(config.cors));
  app.addHook('onSend', cspHook);

  const finkRuntime = await registerFinkModule({
    app,
    config,
    providers,
    logger,
    sessionManager,
    routePrefix: '',
    wsPath: '/ws',
    apiPrefix: '/api',
  });

  const address = await listenWithPortHandling(app, {
    port: FINK_PORT,
    host: config.server.host,
  });

  const wss = attachFinkWebSocketServer(app.server, finkRuntime);

  logger.info({ address }, 'Fink HTTP server listening');
  logger.info({ path: '/ws' }, 'Fink WebSocket server ready');
  logger.info({ path: '/' }, 'Fink UI ready');
  logger.info({ port: FINK_PORT, story: finkRuntime.defaultStoryId }, 'Fink server ready');

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

import type pino from 'pino';
import { loadConfig } from '../config/loader.js';
import type { AppConfig } from '../config/schema.js';
import { createProviders, type Providers } from '../providers/registry.js';
import { SessionManager } from '../session/manager.js';
import { createLogger } from '../utils/logger.js';

export interface RuntimeOptions {
  startupMessage: string;
}

export interface AppRuntime {
  config: AppConfig;
  logger: pino.Logger;
  providers: Providers;
  sessionManager: SessionManager;
}

export function createAppRuntime(options: RuntimeOptions): AppRuntime {
  const configPath = process.env['WORZEL_CONFIG_FILE'];
  let config: AppConfig;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    console.error('Configuration error:', (err as Error).message);
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);
  logger.info(options.startupMessage);

  const providers = createProviders(config);
  logger.info({
    asr: config.asr.provider,
    llm: `${config.llm.provider}/${config.llm.model}`,
    tts: config.tts.provider,
  }, 'Providers initialized');

  const sessionManager = new SessionManager(config.session, logger);
  sessionManager.start();

  return {
    config,
    logger,
    providers,
    sessionManager,
  };
}

export async function listenWithPortHandling(
  app: { listen(opts: { port: number; host: string }): Promise<string> },
  options: {
    port: number;
    host: string;
    inUseMessage?: string;
  },
): Promise<string> {
  try {
    return await app.listen({
      port: options.port,
      host: options.host,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`\nERROR: Port ${options.port} is already in use.`);
      if (options.inUseMessage) {
        console.error(`${options.inUseMessage}\n`);
      }
      process.exit(1);
    }
    throw err;
  }
}

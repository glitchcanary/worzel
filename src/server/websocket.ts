import { WebSocketServer, type WebSocket } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type pino from 'pino';
import type { AppConfig } from '../config/schema.js';
import type { SessionManager } from '../session/manager.js';
import type { Providers } from '../providers/registry.js';
import { WebSocketTransport } from '../transport/websocket-transport.js';
import { TwilioTransport } from '../telephony/twilio-bridge.js';
import { verifyWsToken } from './middleware/auth.js';
import { RateLimiter } from './middleware/rate-limit.js';
import { validateMessage } from '../protocol/validator.js';
import { routeMessage } from '../protocol/router.js';
import { VoicePipeline } from '../pipeline/voice-pipeline.js';
import type { FillerCache } from '../pipeline/filler-cache.js';

interface WsDeps {
  config: AppConfig;
  sessionManager: SessionManager;
  providers: Providers;
  logger: pino.Logger;
  fillerCache?: FillerCache;
}

function attachMainConnectionHandler(wss: WebSocketServer, deps: WsDeps): void {
  const { config, sessionManager, providers, logger, fillerCache } = deps;
  const rateLimiter = new RateLimiter(config.rateLimit);
  rateLimiter.start();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const ipCheck = rateLimiter.checkIp(ip);
    if (!ipCheck.allowed) {
      logger.warn({ ip }, 'Rate limited by IP');
      ws.close(1008, 'rate_limited');
      return;
    }

    const url = req.url ?? '';
    const deviceId = verifyWsToken(config.auth.secret, url);
    if (!deviceId) {
      logger.warn({ ip }, 'WebSocket auth failed');
      ws.close(1008, 'unauthorized');
      return;
    }

    const deviceCheck = rateLimiter.checkDevice(deviceId);
    if (!deviceCheck.allowed) {
      logger.warn({ deviceId }, 'Rate limited by device');
      ws.close(1008, 'rate_limited');
      return;
    }

    const session = sessionManager.create(deviceId);
    if (!session) {
      logger.warn({ deviceId }, 'Max sessions reached');
      ws.close(1013, 'max_sessions');
      return;
    }

    const transport = new WebSocketTransport(ws);
    const pipeline = new VoicePipeline({
      asr: providers.asr,
      llm: providers.llm,
      tts: providers.tts,
      llmSmart: providers.llmSmart,
      fillerCache,
      logger: logger.child({ sessionId: session.id }),
    });

    logger.info({
      sessionId: session.id,
      deviceId,
      ip,
      transportId: transport.id,
    }, 'Device connected via WebSocket');

    transport.onText(async (data: string) => {
      session.touchActivity();

      const result = validateMessage(data);
      if (!result.ok) {
        logger.warn({
          sessionId: session.id,
          error: result.error,
          code: result.code,
        }, 'Invalid message');
        await transport.sendText(JSON.stringify({
          type: 'error',
          code: result.code,
          message: result.error,
        }));
        return;
      }

      if (result.message.type === 'listen' && result.message.state === 'stop') {
        await routeMessage(result.message, {
          session,
          transport,
          logger: logger.child({ sessionId: session.id }),
        });
        pipeline.process(session, transport).catch(err => {
          logger.error({ err, sessionId: session.id }, 'Pipeline error');
        });
        return;
      }

      if (result.message.type === 'abort') {
        pipeline.clearAudio();
      }

      try {
        await routeMessage(result.message, {
          session,
          transport,
          logger: logger.child({ sessionId: session.id }),
        });
      } catch (err) {
        logger.error({ err, sessionId: session.id }, 'Handler error');
        await transport.sendText(JSON.stringify({
          type: 'error',
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        }));
      }
    });

    transport.onBinary((data: Buffer) => {
      session.touchActivity();
      pipeline.pushAudio(data);
    });

    transport.onClose((code: number, reason: string) => {
      logger.info({
        sessionId: session.id,
        deviceId,
        code,
        reason,
      }, 'Device disconnected');
      pipeline.clearAudio();
      sessionManager.destroy(session.id);
    });

    transport.onError((err: Error) => {
      logger.error({ err, sessionId: session.id }, 'WebSocket error');
    });
  });

  wss.on('close', () => {
    rateLimiter.stop();
  });
}

function attachTwilioConnectionHandler(twilioWss: WebSocketServer, deps: WsDeps): void {
  const { sessionManager, providers, logger, fillerCache } = deps;

  twilioWss.on('connection', (ws: WebSocket) => {
    const twilioLogger = logger.child({ transport: 'twilio' });
    const transport = new TwilioTransport(ws, twilioLogger);
    let session: ReturnType<typeof sessionManager.create> | null = null;
    let pipeline: VoicePipeline | null = null;
    let processing = false;

    transport.onText(async (data: string) => {
      let msg: { type?: string; audio_params?: { format?: string; sample_rate?: number; channels?: number } };
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      if (msg.type === 'hello' && !session) {
        const deviceId = `twilio-${transport.streamSid ?? Date.now()}`;
        session = sessionManager.create(deviceId);
        if (!session) {
          twilioLogger.warn({ deviceId }, 'Max sessions reached for Twilio call');
          ws.close(1013, 'max_sessions');
          return;
        }

        session.audioParams = {
          format: 'pcm',
          sample_rate: 16000,
          channels: 1,
          frame_duration: 60,
        };
        session.state = 'ready';

        pipeline = new VoicePipeline({
          asr: providers.asr,
          llm: providers.llm,
          tts: providers.tts,
          llmSmart: providers.llmSmart,
          fillerCache,
          logger: twilioLogger.child({ sessionId: session.id }),
        });

        transport.onSpeechSegment = (pcmBuf: Buffer, durationMs: number) => {
          if (!session || !pipeline || processing) return;
          twilioLogger.info({ durationMs, bytes: pcmBuf.length }, 'Speech segment → pipeline');
          pipeline.pushAudio(pcmBuf);
          processing = true;
          pipeline.process(session, transport).catch(err => {
            twilioLogger.error({ err }, 'Pipeline error');
          }).finally(() => {
            processing = false;
          });
        };

        twilioLogger.info({
          sessionId: session.id,
          deviceId,
          callSid: transport.callSid,
          streamSid: transport.streamSid,
        }, 'Twilio call session created');
      }
    });

    transport.onClose(() => {
      if (pipeline) pipeline.clearAudio();
      if (session) {
        twilioLogger.info({ sessionId: session.id }, 'Twilio call ended');
        sessionManager.destroy(session.id);
      }
    });

    transport.onError((err: Error) => {
      twilioLogger.error({ err }, 'Twilio WebSocket error');
    });
  });
}

export function createWebSocketServer(
  httpServer: HttpServer,
  config: AppConfig,
  sessionManager: SessionManager,
  providers: Providers,
  logger: pino.Logger,
  fillerCache?: FillerCache,
): WebSocketServer {
  const deps: WsDeps = { config, sessionManager, providers, logger, fillerCache };
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 512 * 1024,
  });
  attachMainConnectionHandler(wss, deps);

  if (config.twilio.accountSid) {
    const twilioWss = new WebSocketServer({
      server: httpServer,
      path: '/ws/twilio',
      maxPayload: 512 * 1024,
    });
    attachTwilioConnectionHandler(twilioWss, deps);
    wss.on('close', () => twilioWss.close());
    logger.info({ path: '/ws/twilio' }, 'Twilio telephony WebSocket ready');
  }

  return wss;
}

export function createNoServerWebSocketServers(
  config: AppConfig,
  sessionManager: SessionManager,
  providers: Providers,
  logger: pino.Logger,
  fillerCache?: FillerCache,
): { mainWss: WebSocketServer; twilioWss?: WebSocketServer } {
  const deps: WsDeps = { config, sessionManager, providers, logger, fillerCache };
  const mainWss = new WebSocketServer({
    noServer: true,
    maxPayload: 512 * 1024,
  });
  attachMainConnectionHandler(mainWss, deps);

  let twilioWss: WebSocketServer | undefined;
  if (config.twilio.accountSid) {
    twilioWss = new WebSocketServer({
      noServer: true,
      maxPayload: 512 * 1024,
    });
    attachTwilioConnectionHandler(twilioWss, deps);
  }

  return { mainWss, twilioWss };
}

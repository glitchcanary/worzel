import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, type WebSocket } from 'ws';
import type pino from 'pino';
import { generateToken } from '../utils/crypto.js';
import type { AppConfig } from '../config/schema.js';
import type { SessionManager } from '../session/manager.js';
import { createProviders, type Providers } from '../providers/registry.js';
import { WebSocketTransport } from '../transport/websocket-transport.js';
import { RateLimiter } from '../server/middleware/rate-limit.js';
import { verifyWsToken } from '../server/middleware/auth.js';
import { validateMessage } from '../protocol/validator.js';
import { routeMessage } from '../protocol/router.js';
import { StoryManager } from '../ink/story-manager.js';
import { ExternalStoryLoader } from '../ink/external-story-loader.js';
import { InkSession } from '../ink/ink-session.js';
import { InkPipeline } from './ink-pipeline.js';
import type { ParentStoryState } from './ink-pipeline.js';
import { sanitizeDeviceId } from '../utils/sanitize.js';
import { isSupabaseEnabled, createSupabaseAuthHook, verifySupabaseWsToken } from '../server/middleware/supabase-auth.js';
import type { Session } from '../session/session.js';
import type { Transport } from '../transport/interface.js';

export interface FinkModuleOptions {
  app: FastifyInstance;
  config: AppConfig;
  providers: Providers;
  logger: pino.Logger;
  sessionManager: SessionManager;
  routePrefix?: string;
  wsPath?: string;
  apiPrefix?: string;
}

export interface FinkRuntime {
  config: AppConfig;
  providers: Providers;
  fallbackTts?: Providers['tts'];
  ttsChain: Providers['tts'][];
  logger: pino.Logger;
  sessionManager: SessionManager;
  storyManager: StoryManager;
  routePrefix: string;
  wsPath: string;
  defaultStoryId?: string;
  voiceAliases: Record<string, string>;
  choiceVoice?: string;
  fallbackChoiceVoice?: string;
  storiesCount: number;
}

function parseVoiceAliases(raw?: string): Record<string, string> {
  if (!raw?.trim()) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('voice alias map must be a JSON object');
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) {
        result[key] = value.trim();
      }
    }
    return result;
  } catch (err) {
    throw new Error(`Invalid FINK_TTS_VOICE_MAP: ${(err as Error).message}`);
  }
}

function applyFinkOverrides(config: AppConfig): AppConfig {
  const ttsProvider = process.env['FINK_TTS_PROVIDER']?.trim().toLowerCase();
  const ttsModel = process.env['FINK_TTS_MODEL']?.trim();
  const ttsVoice = process.env['FINK_TTS_VOICE']?.trim();
  const ttsSampleRateRaw = process.env['FINK_TTS_SAMPLE_RATE']?.trim();
  const ttsSampleRate = ttsSampleRateRaw ? Number.parseInt(ttsSampleRateRaw, 10) : undefined;

  if (!ttsProvider && !ttsModel && !ttsVoice && !ttsSampleRate) return config;

  return {
    ...config,
    tts: {
      ...config.tts,
      ...(ttsProvider ? { provider: ttsProvider as AppConfig['tts']['provider'] } : {}),
      ...(ttsModel ? { model: ttsModel } : {}),
      ...(ttsVoice ? { voice: ttsVoice } : {}),
      ...(ttsSampleRate ? { sampleRate: ttsSampleRate } : {}),
    },
  };
}

async function handleInkChoose(
  choiceIndex: number,
  session: Session,
  transport: Transport,
  inkSession: InkSession,
  pipeline: InkPipeline,
  logger: pino.Logger,
  storyManager: StoryManager,
  inkSessions: Map<string, InkSession>,
  storyStacks: Map<string, ParentStoryState[]>,
): Promise<InkSession> {
  const choices = inkSession.getChoices();
  const choice = choices.find(c => c.index === choiceIndex);
  if (choice?.tags.finkLink) {
    let targetId = choice.tags.finkLink;

    let storyJson = storyManager.getStoryJson(targetId);
    if (!storyJson) {
      const resolved = await storyManager.resolveExternalLink(targetId, inkSession.storyId);
      if (resolved) {
        targetId = resolved;
        storyJson = storyManager.getStoryJson(resolved);
      }
    }
    if (!storyJson) {
      logger.warn({ targetId }, 'FINK: link target story not found (local + external)');
      const currentState = inkSession.getState();
      await transport.sendText(JSON.stringify({
        type: 'ink_state',
        session_id: session.id,
        narration: [{ text: 'Sorry, that story could not be loaded right now.', speaker: 'system' }],
        choices: currentState.choices.map(c => ({ index: c.index, text: c.text })),
        isEnded: false,
        turnCount: currentState.turnCount,
        storyId: currentState.storyId,
      }));
      return inkSession;
    }

    const stack = storyStacks.get(session.id) ?? [];
    stack.push({
      storyId: inkSession.storyId,
      serializedState: inkSession.serialize(),
    });
    storyStacks.set(session.id, stack);

    const metadata = storyManager.getMetadata(targetId);
    const newSession = new InkSession(targetId, storyJson, metadata);
    inkSessions.set(session.id, newSession);
    logger.info({ from: inkSession.storyId, to: targetId, stackDepth: stack.length }, 'Switching story via FINK: link (tap)');

    const initial = newSession.continue();
    const openingText = initial.narration.map(n => n.text).join('\n');
    const openingChoices = initial.choices.length > 0
      ? '\n\nAvailable options: ' + initial.choices.map(c => c.text).join(', ')
      : '';
    if (openingText) {
      session.addDialogue('assistant', `[Story] ${openingText}${openingChoices}`);
    }

    await transport.sendText(JSON.stringify({
      type: 'ink_state',
      session_id: session.id,
      narration: initial.narration.map(n => ({
        text: n.text, speaker: n.speaker, voice: n.voice, mood: n.mood,
      })),
      choices: initial.choices.map(c => ({ index: c.index, text: c.text })),
      isEnded: newSession.isEnded,
      turnCount: 0,
      storyId: targetId,
    }));

    await pipeline.narrateAndReadChoices(session, transport, initial.narration, initial.choices);
    return newSession;
  }

  await pipeline.processDirectChoice(session, transport, inkSession, choiceIndex);
  return inkSession;
}

function createFinkOtaHandler(config: AppConfig, wsPath: string) {
  return async function otaHandler(
    request: FastifyRequest<{
      Body: { mac_address?: string; device_id?: string; board?: string; app_version?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const body = request.body ?? {};
    const rawDeviceId = body.mac_address ?? body.device_id;

    if (!rawDeviceId) {
      reply.status(400).send({
        error: 'missing_device_id',
        message: 'mac_address or device_id is required',
      });
      return;
    }

    const deviceId = sanitizeDeviceId(rawDeviceId);
    if (!deviceId) {
      reply.status(400).send({
        error: 'invalid_device_id',
        message: 'Device ID contains invalid characters',
      });
      return;
    }

    const host = request.headers.host ?? `localhost:${config.server.port}`;
    const forwardedProto = request.headers['x-forwarded-proto'];
    const isTailscale = host.endsWith('.ts.net') || host.endsWith('.ts.net:443');
    const isTls = config.server.tlsCert || forwardedProto === 'https' || isTailscale;
    const wsProtocol = isTls ? 'wss' : 'ws';
    const wsUrl = `${wsProtocol}://${host}${wsPath}`;
    const token = generateToken(config.auth.secret, deviceId, config.auth.tokenTtlSeconds);

    reply.send({
      server_url: wsUrl,
      token,
      device_id: deviceId,
    });
  };
}

export async function registerFinkModule(options: FinkModuleOptions): Promise<FinkRuntime> {
  const { app, logger, sessionManager } = options;
  const config = applyFinkOverrides(options.config);
  const providers = config === options.config ? options.providers : createProviders(config, logger);

  // Build TTS chain: primary (Fink override) + any working fallbacks
  // Skip Edge TTS (stub that generates silence)
  const ttsChain: Providers['tts'][] = [providers.tts];
  const baseTts = options.providers.tts;
  const baseTtsIsStub = baseTts.provider === 'edge' || baseTts.name === 'edge-tts';
  if (config.tts.provider !== options.config.tts.provider && !baseTtsIsStub) {
    ttsChain.push(baseTts);
  }
  // Legacy single fallback for backward compat
  const fallbackTts = ttsChain.length > 1 ? ttsChain[1] : undefined;
  logger.info({
    ttsChain: ttsChain.map(p => p.provider ?? p.name),
  }, 'TTS provider chain configured');
  const routePrefix = options.routePrefix ?? '/fink';
  const wsPath = options.wsPath ?? '/ws/fink';
  const apiPrefix = options.apiPrefix ?? `${routePrefix}/api`;
  const voiceAliases = parseVoiceAliases(process.env['FINK_TTS_VOICE_MAP']);
  const choiceVoice = process.env['FINK_CHOICE_VOICE']?.trim() || config.tts.voice || undefined;
  const fallbackChoiceVoice = config.tts.provider === options.config.tts.provider
    ? choiceVoice
    : options.config.tts.voice;

  const storyManager = new StoryManager({ logger });
  const currentFile = fileURLToPath(import.meta.url);
  const projectRoot = join(dirname(currentFile), '..', '..');
  const storiesDir = process.env['FINK_STORIES_DIR'] ?? join(projectRoot, 'stories');
  await storyManager.loadFromDirectory(storiesDir);

  const externalHosts = process.env['FINK_EXTERNAL_HOSTS'];
  if (externalHosts) {
    const hosts = externalHosts.split(',').map(h => h.trim()).filter(Boolean);
    if (hosts.length > 0) {
      storyManager.setExternalLoader(new ExternalStoryLoader({ allowedHosts: hosts, logger }));
      logger.info({ hosts }, 'External .fink.js loading enabled');
    }
  }

  const stories = storyManager.listStories();
  const menuStory = stories.find(s => s.id === 'menu');
  const defaultStoryId = process.env['FINK_DEFAULT_STORY'] ?? menuStory?.id ?? stories[0]?.id;

  app.get(`${apiPrefix}/health`, async () => ({
    status: 'ok',
    service: 'fink',
    stories: stories.length,
    wsPath,
  }));

  app.post(`${apiPrefix}/ota`, createFinkOtaHandler(config, wsPath));

  // Supabase login flow (experimental)
  const supabaseEnabled = isSupabaseEnabled(config.supabase);
  const supabaseAuthHook = createSupabaseAuthHook(config.supabase);

  if (supabaseEnabled) {
    // Public endpoint: expose Supabase project URL + anon key so the login page can init the client
    app.get(`${apiPrefix}/supabase-config`, async () => ({
      url: config.supabase.url,
      anonKey: config.supabase.anonKey,
    }));

    logger.info('Supabase auth enabled for Fink');
  }

  app.get(`${apiPrefix}/stories`, {
    ...(supabaseEnabled ? { preHandler: supabaseAuthHook } : {}),
  }, async () => ({
    stories: storyManager.listStories(),
    default: defaultStoryId,
  }));

  if (routePrefix) {
    app.get(routePrefix, async (_request, reply) => {
      reply.redirect(`${routePrefix}/`);
    });
  }

  // Serve stories directory as static files so the client-side finkapp
  // can fetch .ink source files directly for in-browser compilation.
  const storiesPrefix = routePrefix ? `${routePrefix}/stories/` : '/stories/';
  await app.register(fastifyStatic, {
    root: storiesDir,
    prefix: storiesPrefix,
    decorateReply: false,
  });

  const finkClientDir = join(projectRoot, 'fink', 'client');

  // When Supabase auth is enabled, gate the main Fink UI behind login.
  // The login page itself and its assets are always served publicly.
  if (supabaseEnabled) {
    // Serve login.html at the Fink root when user has no valid token
    app.get(`${routePrefix}/login`, async (_request, reply) => {
      return reply.sendFile('login.html', finkClientDir);
    });

    // Redirect unauthenticated users from the Fink index to login
    app.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0] ?? '';
      const finkBase = routePrefix ? `${routePrefix}/` : '/';

      // Allow public paths: login page, API config endpoint, static assets, health
      if (
        path === `${routePrefix}/login` ||
        path.startsWith(`${apiPrefix}/supabase-config`) ||
        path.startsWith(`${apiPrefix}/health`) ||
        path.startsWith(`${apiPrefix}/ota`) ||
        path.endsWith('.ico')
      ) return;

      // Only gate Fink routes
      if (!path.startsWith(finkBase) && path !== routePrefix) return;

      // Check for token in: query param, Authorization header, or cookie.
      // Query param is the primary path when cookies are disabled — the login
      // page appends ?sb-token=... on redirect. The Fink client JS strips it
      // from the URL on load and stores it in localStorage for future API calls.
      const urlObj = new URL(request.url, 'http://localhost');
      const qsToken = urlObj.searchParams.get('sb-token');

      const authHeader = request.headers.authorization;
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

      const cookieHeader = request.headers.cookie ?? '';
      const cookieToken = cookieHeader.split(';')
        .map(c => c.trim())
        .find(c => c.startsWith('sb-token='))
        ?.slice(9);

      if (!qsToken && !bearerToken && !cookieToken) {
        reply.redirect(`${routePrefix}/login?redirect=${encodeURIComponent(request.url)}`);
        return;
      }
    });
  }

  await app.register(fastifyStatic, {
    root: finkClientDir,
    prefix: routePrefix ? `${routePrefix}/` : '/',
    decorateReply: false,
  });

  logger.info({
    routePrefix,
    wsPath,
    story: defaultStoryId,
    storyCount: stories.length,
    ttsProvider: config.tts.provider,
    ttsVoice: config.tts.voice,
  }, 'Fink module ready');

  return {
    config,
    providers,
    fallbackTts,
    ttsChain,
    logger,
    sessionManager,
    storyManager,
    routePrefix,
    wsPath,
    defaultStoryId,
    voiceAliases,
    choiceVoice,
    fallbackChoiceVoice,
    storiesCount: stories.length,
  };
}

function createFinkWebSocketServer(runtime: FinkRuntime, options: { httpServer?: HttpServer; noServer?: boolean }): WebSocketServer {
  const {
    config,
    providers,
    fallbackTts,
    ttsChain,
    logger,
    sessionManager,
    storyManager,
    wsPath,
    defaultStoryId,
    voiceAliases,
    choiceVoice,
    fallbackChoiceVoice,
  } = runtime;
  const sessionLoggerBase = logger;
  const rateLimiter = new RateLimiter(config.rateLimit);
  rateLimiter.start();
  const inkSessions = new Map<string, InkSession>();
  const storyStacks = new Map<string, ParentStoryState[]>();

  const wss = options.noServer
    ? new WebSocketServer({
        noServer: true,
        maxPayload: 512 * 1024,
      })
    : new WebSocketServer({
        server: options.httpServer!,
        path: wsPath,
        maxPayload: 512 * 1024,
      });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const ip = req.socket.remoteAddress ?? 'unknown';

    const ipCheck = rateLimiter.checkIp(ip);
    if (!ipCheck.allowed) {
      ws.close(1008, 'rate_limited');
      return;
    }

    const url = req.url ?? '';

    // If Supabase is enabled, also accept Supabase tokens for WebSocket auth
    const supabaseUserId = isSupabaseEnabled(config.supabase)
      ? await verifySupabaseWsToken(config.supabase, url, req.headers.cookie, req.headers.authorization)
      : null;

    const verifiedDeviceId = supabaseUserId ?? verifyWsToken(config.auth.secret, url);
    if (!verifiedDeviceId) {
      ws.close(1008, 'unauthorized');
      return;
    }

    const session = sessionManager.create(verifiedDeviceId);
    if (!session) {
      ws.close(1013, 'max_sessions');
      return;
    }

    const transport = new WebSocketTransport(ws);
    const sessionLogger = sessionLoggerBase.child({ sessionId: session.id, deviceId: verifiedDeviceId, mode: 'fink' });

    let inkSession: InkSession | undefined;
    const pipeline = new InkPipeline({
      asr: providers.asr,
      llm: providers.llm,
      tts: providers.tts,
      ttsFallback: fallbackTts,
      ttsChain,
      logger: sessionLogger,
      voiceAliases,
      choiceVoice,
      fallbackChoiceVoice,
      onFinkLink: async (targetId, sess, trans, parentState) => {
        let resolvedId = targetId;
        let json = storyManager.getStoryJson(resolvedId);
        if (!json) {
          const currentInk = inkSessions.get(sess.id);
          const resolved = await storyManager.resolveExternalLink(
            targetId, currentInk?.storyId ?? '',
          );
          if (resolved) {
            resolvedId = resolved;
            json = storyManager.getStoryJson(resolved);
          }
        }
        if (!json) {
          sessionLogger.warn({ targetId }, 'FINK: link target not found (local + external)');
          return null;
        }

        const stack = storyStacks.get(sess.id) ?? [];
        stack.push(parentState);
        storyStacks.set(sess.id, stack);

        const meta = storyManager.getMetadata(resolvedId);
        const newInk = new InkSession(resolvedId, json, meta);
        inkSessions.set(sess.id, newInk);
        inkSession = newInk;
        sessionLogger.info({ to: resolvedId, stackDepth: stack.length }, 'Voice FINK: link switch');

        const initial = newInk.continue();
        const openingText = initial.narration.map(n => n.text).join('\n');
        const openingChoices = initial.choices.length > 0
          ? '\n\nAvailable options: ' + initial.choices.map(c => c.text).join(', ')
          : '';
        if (openingText) {
          sess.addDialogue('assistant', `[Story] ${openingText}${openingChoices}`);
        }

        await trans.sendText(JSON.stringify({
          type: 'ink_state',
          session_id: sess.id,
          narration: initial.narration.map(n => ({
            text: n.text, speaker: n.speaker, voice: n.voice, mood: n.mood,
          })),
          choices: initial.choices.map(c => ({ index: c.index, text: c.text })),
          isEnded: newInk.isEnded,
          turnCount: 0,
          storyId: resolvedId,
        }));

        await pipeline.narrateAndReadChoices(sess, trans, initial.narration, initial.choices);
        return newInk;
      },
      onStoryEnded: async (sess, trans) => {
        const stack = storyStacks.get(sess.id);
        if (!stack || stack.length === 0) return null;

        const parent = stack.pop()!;
        sessionLogger.info({ to: parent.storyId, stackDepth: stack.length }, 'Returning to parent story');
        const parentJson = storyManager.getStoryJson(parent.storyId);
        if (!parentJson) {
          sessionLogger.error({ storyId: parent.storyId }, 'Parent story JSON not found');
          return null;
        }

        const meta = storyManager.getMetadata(parent.storyId);
        const parentInk = new InkSession(parent.storyId, parentJson, meta);
        parentInk.restore(parent.serializedState);
        inkSessions.set(sess.id, parentInk);
        inkSession = parentInk;

        const state = parentInk.getState();
        await trans.sendText(JSON.stringify({
          type: 'ink_state',
          session_id: sess.id,
          narration: state.narration.map(n => ({
            text: n.text, speaker: n.speaker, voice: n.voice, mood: n.mood,
          })),
          choices: state.choices.map(c => ({ index: c.index, text: c.text })),
          isEnded: parentInk.isEnded,
          turnCount: state.turnCount,
          storyId: parent.storyId,
        }));

        return {
          inkSession: parentInk,
          narration: state.narration,
          choices: state.choices,
        };
      },
    });

    if (defaultStoryId) {
      const storyJson = storyManager.getStoryJson(defaultStoryId);
      if (storyJson) {
        const metadata = storyManager.getMetadata(defaultStoryId);
        inkSession = new InkSession(defaultStoryId, storyJson, metadata);
        inkSessions.set(session.id, inkSession);

        const initial = inkSession.continue();
        sessionLogger.info({
          storyId: defaultStoryId,
          narrationCount: initial.narration.length,
          choiceCount: initial.choices.length,
        }, 'Story started');

        const openingText = initial.narration.map(n => n.text).join('\n');
        const openingChoices = initial.choices.length > 0
          ? '\n\nAvailable options: ' + initial.choices.map(c => c.text).join(', ')
          : '';
        if (openingText) {
          session.addDialogue('assistant', `[Story] ${openingText}${openingChoices}`);
        }

        (session as Session & { _finkSendInitial?: () => Promise<void> })._finkSendInitial = async () => {
          await transport.sendText(JSON.stringify({
            type: 'ink_state',
            session_id: session.id,
            narration: initial.narration.map(n => ({
              text: n.text,
              speaker: n.speaker,
              voice: n.voice,
              mood: n.mood,
            })),
            choices: initial.choices.map(c => ({
              index: c.index,
              text: c.text,
            })),
            isEnded: inkSession!.isEnded,
            turnCount: 0,
            storyId: defaultStoryId,
          }));

          pipeline.narrateAndReadChoices(
            session, transport, initial.narration, initial.choices,
          ).catch(err => {
            sessionLogger.error({ err }, 'Initial narration error');
          });
        };
      }
    }

    sessionLogger.info({ storyId: defaultStoryId }, 'Fink session started');

    transport.onText(async (data: string) => {
      session.touchActivity();

      let raw: { type?: string; action?: string; choice_index?: number; tts_speed?: number; text?: string } | null = null;
      try { raw = JSON.parse(data); } catch {}

      if (raw?.type === 'fink_settings') {
        if (typeof raw.tts_speed === 'number' && raw.tts_speed >= 0.5 && raw.tts_speed <= 2.0) {
          pipeline.ttsSpeed = raw.tts_speed;
          sessionLogger.info({ ttsSpeed: raw.tts_speed }, 'TTS speed updated');
        }
        return;
      }

      if (raw?.type === 'stt_text' && typeof raw.text === 'string') {
        const currentInk = inkSessions.get(session.id);
        if (!currentInk) return;
        sessionLogger.info({ text: raw.text }, 'Browser ASR text received');
        session.abortController?.abort();
        pipeline.clearAudio();
        pipeline.processText(raw.text, session, transport, currentInk).catch(err => {
          sessionLogger.error({ err }, 'Text pipeline error');
        });
        return;
      }

      if (raw?.type === 'ink') {
        const currentInk = inkSessions.get(session.id);
        if (!currentInk) return;

        sessionLogger.info({ action: raw.action, choiceIndex: raw.choice_index }, 'Ink message');
        if (raw.action === 'choose' && typeof raw.choice_index === 'number') {
          session.abortController?.abort();
          pipeline.clearAudio();
          inkSession = await handleInkChoose(
            raw.choice_index, session, transport, currentInk, pipeline, sessionLogger,
            storyManager, inkSessions, storyStacks,
          );
        }
        return;
      }

      const result = validateMessage(data);
      if (!result.ok) {
        await transport.sendText(JSON.stringify({
          type: 'error', code: result.code, message: result.error,
        }));
        return;
      }

      const msg = result.message;
      if (msg.type === 'hello') {
        await routeMessage(msg, { session, transport, logger: sessionLogger });
        const sendInitial = (session as Session & { _finkSendInitial?: () => Promise<void> })._finkSendInitial;
        if (sendInitial) {
          await sendInitial();
          delete (session as Session & { _finkSendInitial?: () => Promise<void> })._finkSendInitial;
        }
        return;
      }

      if (msg.type === 'listen' && msg.state === 'stop') {
        await routeMessage(msg, { session, transport, logger: sessionLogger });
        const currentInk = inkSessions.get(session.id);
        if (currentInk) {
          pipeline.process(session, transport, currentInk).catch(err => {
            sessionLogger.error({ err }, 'Ink pipeline error');
          });
        }
        return;
      }

      if (msg.type === 'abort') {
        pipeline.clearAudio();
      }

      try {
        await routeMessage(msg, { session, transport, logger: sessionLogger });
      } catch (err) {
        sessionLogger.error({ err }, 'Handler error');
        await transport.sendText(JSON.stringify({
          type: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error',
        }));
      }
    });

    transport.onBinary((data: Buffer) => {
      session.touchActivity();
      pipeline.pushAudio(data);
    });

    transport.onClose((code: number, reason: string) => {
      sessionLogger.info({ code, reason }, 'Fink session ended');
      pipeline.clearAudio();
      inkSessions.delete(session.id);
      storyStacks.delete(session.id);
      sessionManager.destroy(session.id);
    });

    transport.onError((err: Error) => {
      sessionLogger.error({ err }, 'WebSocket error');
    });
  });

  wss.on('close', () => {
    rateLimiter.stop();
  });

  return wss;
}

export function attachFinkWebSocketServer(httpServer: HttpServer, runtime: FinkRuntime): WebSocketServer {
  return createFinkWebSocketServer(runtime, { httpServer });
}

export function createNoServerFinkWebSocketServer(runtime: FinkRuntime): WebSocketServer {
  return createFinkWebSocketServer(runtime, { noServer: true });
}

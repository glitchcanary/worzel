/**
 * Fink Server — Voice-navigated interactive fiction demo.
 *
 * A standalone server that:
 * 1. Serves the Fink web client (fink/client/)
 * 2. Runs the standard Worzel auth + WebSocket protocol
 * 3. Intercepts the voice pipeline to route through InkRouter
 * 4. Sends ink_state messages with narration + choices
 *
 * Uses Worzel's providers (ASR, LLM, TTS) and Ink engine modules.
 *
 * Usage:
 *   node --env-file=../../.env dist/fink/server.js
 *
 * Or via npm script:
 *   npm run fink
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type pino from 'pino';
import { createLogger } from '../utils/logger.js';
import { loadConfig } from '../config/loader.js';
import { createProviders } from '../providers/registry.js';
import { SessionManager } from '../session/manager.js';
import type { Session } from '../session/session.js';
import { WebSocketTransport } from '../transport/websocket-transport.js';
import type { Transport } from '../transport/interface.js';
import { verifyWsToken, createOtaHandler } from '../server/middleware/auth.js';
import { buildCorsOptions } from '../server/middleware/cors.js';
import { cspHook } from '../server/middleware/csp.js';
import { RateLimiter } from '../server/middleware/rate-limit.js';
import { validateMessage } from '../protocol/validator.js';
import { routeMessage } from '../protocol/router.js';
import { StoryManager } from '../ink/story-manager.js';
import { InkSession } from '../ink/ink-session.js';
import { InkPipeline } from './ink-pipeline.js';

const FINK_PORT = parseInt(process.env['FINK_PORT'] ?? '3001', 10);

/**
 * Handle a tapped choice from the Fink UI.
 *
 * If the choice has a FINK: tag, switch to that story instead of advancing.
 * Otherwise delegates to InkPipeline.processDirectChoice().
 *
 * Returns the (possibly new) InkSession.
 */
async function handleInkChoose(
  choiceIndex: number,
  session: Session,
  transport: Transport,
  inkSession: InkSession,
  pipeline: InkPipeline,
  logger: pino.Logger,
  storyManager: StoryManager,
  inkSessions: Map<string, InkSession>,
): Promise<InkSession> {
  // Check if this choice links to another story
  const choices = inkSession.getChoices();
  const choice = choices.find(c => c.index === choiceIndex);
  if (choice?.tags.finkLink) {
    const targetId = choice.tags.finkLink;
    const storyJson = storyManager.getStoryJson(targetId);
    if (!storyJson) {
      logger.warn({ targetId }, 'FINK: link target story not found');
      await pipeline.processDirectChoice(session, transport, inkSession, choiceIndex);
      return inkSession;
    }

    // Switch to the new story
    const metadata = storyManager.getMetadata(targetId);
    const newSession = new InkSession(targetId, storyJson, metadata?.defaultVoices?.['narrator']);
    inkSessions.set(session.id, newSession);
    logger.info({ from: inkSession.storyId, to: targetId }, 'Switching story via FINK: link');

    // Continue from start
    const initial = newSession.continue();

    // Seed dialogue history
    const openingText = initial.narration.map(n => n.text).join('\n');
    const openingChoices = initial.choices.length > 0
      ? '\n\nAvailable options: ' + initial.choices.map(c => c.text).join(', ')
      : '';
    if (openingText) {
      session.addDialogue('assistant', `[Story] ${openingText}${openingChoices}`);
    }

    // Send ink_state and narrate
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

async function main(): Promise<void> {
  // Load shared Worzel config (providers, auth, etc.)
  const configPath = process.env['WORZEL_CONFIG_FILE'];
  let config;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    console.error('Configuration error:', (err as Error).message);
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);
  logger.info('Starting Fink server...');

  // Create providers
  const providers = createProviders(config);
  logger.info({
    asr: config.asr.provider,
    llm: `${config.llm.provider}/${config.llm.model}`,
    tts: config.tts.provider,
  }, 'Providers initialized');

  // Load stories
  const storyManager = new StoryManager({ logger });
  const currentFile = fileURLToPath(import.meta.url);
  const projectRoot = join(dirname(currentFile), '..', '..');
  const storiesDir = process.env['FINK_STORIES_DIR'] ?? join(projectRoot, 'stories');
  await storyManager.loadFromDirectory(storiesDir);

  const stories = storyManager.listStories();
  if (stories.length === 0) {
    logger.warn({ dir: storiesDir }, 'No stories found');
  } else {
    logger.info({ stories: stories.map(s => s.id) }, 'Stories available');
  }

  // Default story: menu if available, else first, else from env
  const menuStory = stories.find(s => s.id === 'menu');
  const defaultStoryId = process.env['FINK_DEFAULT_STORY'] ?? menuStory?.id ?? stories[0]?.id;

  // Session manager
  const sessionManager = new SessionManager(config.session, logger);
  sessionManager.start();

  // Track InkSessions per Worzel session
  const inkSessions = new Map<string, InkSession>();

  // Create HTTP server (Fastify)
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

  // Health check
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'fink',
    stories: stories.length,
  }));

  // OTA auth (same as Worzel — reuse tokens)
  app.post('/api/ota', createOtaHandler(config.auth, config.server));

  // Story list API
  app.get('/api/stories', async () => ({
    stories: storyManager.listStories(),
    default: defaultStoryId,
  }));

  // Serve Fink web client
  const finkClientDir = join(projectRoot, 'fink', 'client');
  await app.register(fastifyStatic, {
    root: finkClientDir,
    prefix: '/',
    decorateReply: false,
  });

  // Start HTTP
  const address = await app.listen({
    port: FINK_PORT,
    host: config.server.host,
  });
  logger.info({ address }, 'Fink HTTP server listening');

  // WebSocket server
  const rateLimiter = new RateLimiter(config.rateLimit);
  rateLimiter.start();

  const wss = new WebSocketServer({
    server: app.server,
    path: '/ws',
    maxPayload: 512 * 1024,
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = req.socket.remoteAddress ?? 'unknown';

    const ipCheck = rateLimiter.checkIp(ip);
    if (!ipCheck.allowed) {
      ws.close(1008, 'rate_limited');
      return;
    }

    const url = req.url ?? '';
    const deviceId = verifyWsToken(config.auth.secret, url);
    if (!deviceId) {
      ws.close(1008, 'unauthorized');
      return;
    }

    const session = sessionManager.create(deviceId);
    if (!session) {
      ws.close(1013, 'max_sessions');
      return;
    }

    const transport = new WebSocketTransport(ws);
    const sessionLogger = logger.child({ sessionId: session.id, deviceId });

    // Create InkPipeline (Ink-aware voice pipeline)
    const pipeline = new InkPipeline({
      asr: providers.asr,
      llm: providers.llm,
      tts: providers.tts,
      logger: sessionLogger,
      onFinkLink: async (targetId, sess, trans) => {
        const json = storyManager.getStoryJson(targetId);
        if (!json) {
          sessionLogger.warn({ targetId }, 'FINK: link target not found');
          return null;
        }
        const meta = storyManager.getMetadata(targetId);
        const newInk = new InkSession(targetId, json, meta?.defaultVoices?.['narrator']);
        inkSessions.set(sess.id, newInk);
        inkSession = newInk;
        sessionLogger.info({ to: targetId }, 'Voice FINK: link switch');

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
          storyId: targetId,
        }));

        await pipeline.narrateAndReadChoices(sess, trans, initial.narration, initial.choices);
        return newInk;
      },
    });

    // Start an Ink session with the default story
    let inkSession: InkSession | undefined;
    if (defaultStoryId) {
      const storyJson = storyManager.getStoryJson(defaultStoryId);
      if (storyJson) {
        const metadata = storyManager.getMetadata(defaultStoryId);
        inkSession = new InkSession(defaultStoryId, storyJson, metadata?.defaultVoices?.['narrator']);
        inkSessions.set(session.id, inkSession);

        // Continue from start to get initial narration
        const initial = inkSession.continue();
        sessionLogger.info({
          storyId: defaultStoryId,
          narrationCount: initial.narration.length,
          choiceCount: initial.choices.length,
        }, 'Story started');

        // Seed dialogue history with initial story state
        const openingText = initial.narration.map(n => n.text).join('\n');
        const openingChoices = initial.choices.length > 0
          ? '\n\nAvailable options: ' + initial.choices.map(c => c.text).join(', ')
          : '';
        if (openingText) {
          session.addDialogue('assistant', `[Story] ${openingText}${openingChoices}`);
        }

        // Defer sending initial state + TTS until after hello handshake
        const sendInitialState = async () => {
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

          // Narrate the opening + read choices aloud
          pipeline.narrateAndReadChoices(
            session, transport, initial.narration, initial.choices,
          ).catch(err => {
            sessionLogger.error({ err }, 'Initial narration error');
          });
        };

        // Queue initial state send after hello
        (session as unknown as { _finkSendInitial?: () => Promise<void> })._finkSendInitial = sendInitialState;
      }
    }

    sessionLogger.info({ storyId: defaultStoryId }, 'Fink session started');

    // Handle text messages
    transport.onText(async (data: string) => {
      session.touchActivity();

      // Pre-parse to check for Fink-specific messages (not in Worzel's schema)
      let raw: { type?: string; action?: string; choice_index?: number; story_id?: string } | null = null;
      try { raw = JSON.parse(data); } catch { /* invalid JSON handled below by validator */ }

      // Handle ink messages (Fink extension — not in Worzel's InboundMessageSchema)
      if (raw?.type === 'ink' && inkSession) {
        sessionLogger.info({ action: raw.action, choiceIndex: raw.choice_index }, 'Ink message');
        if (raw.action === 'choose' && typeof raw.choice_index === 'number') {
          // Abort any in-flight narration/TTS before starting the new choice
          session.abortController?.abort();
          pipeline.clearAudio();
          inkSession = await handleInkChoose(
            raw.choice_index, session, transport, inkSession, pipeline, sessionLogger,
            storyManager, inkSessions,
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

      // Handle hello — send ink_state after handshake
      if (msg.type === 'hello') {
        await routeMessage(msg, { session, transport, logger: sessionLogger });
        // Send initial story state after hello response
        const sendInitial = (session as unknown as { _finkSendInitial?: () => Promise<void> })._finkSendInitial;
        if (sendInitial) {
          await sendInitial();
          delete (session as unknown as { _finkSendInitial?: () => Promise<void> })._finkSendInitial;
        }
        return;
      }

      // Handle listen stop → Ink pipeline
      if (msg.type === 'listen' && msg.state === 'stop') {
        await routeMessage(msg, { session, transport, logger: sessionLogger });

        if (inkSession) {
          pipeline.process(session, transport, inkSession).catch(err => {
            sessionLogger.error({ err }, 'Ink pipeline error');
          });
        }
        return;
      }

      // Handle abort
      if (msg.type === 'abort') {
        pipeline.clearAudio();
      }

      // Default routing
      try {
        await routeMessage(msg, { session, transport, logger: sessionLogger });
      } catch (err) {
        sessionLogger.error({ err }, 'Handler error');
        await transport.sendText(JSON.stringify({
          type: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error',
        }));
      }
    });

    // Handle binary (audio frames)
    transport.onBinary((data: Buffer) => {
      session.touchActivity();
      pipeline.pushAudio(data);
    });

    // Handle close
    transport.onClose((code: number, reason: string) => {
      sessionLogger.info({ code, reason }, 'Fink session ended');
      pipeline.clearAudio();
      inkSessions.delete(session.id);
      sessionManager.destroy(session.id);
    });

    transport.onError((err: Error) => {
      sessionLogger.error({ err }, 'WebSocket error');
    });
  });

  logger.info({ port: FINK_PORT, story: defaultStoryId }, 'Fink server ready');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    wss.close();
    rateLimiter.stop();
    sessionManager.stop();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

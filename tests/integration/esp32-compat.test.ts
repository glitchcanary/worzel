import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHttpServer } from '../../src/server/http.js';
import { createWebSocketServer } from '../../src/server/websocket.js';
import { SessionManager } from '../../src/session/manager.js';
import { createLogger } from '../../src/utils/logger.js';
import { generateToken } from '../../src/utils/crypto.js';
import type { AppConfig } from '../../src/config/schema.js';
import type { Providers } from '../../src/providers/registry.js';
import type { ASRProvider, LLMProvider, TTSProvider } from '../../src/providers/interface.js';
import WebSocket from 'ws';

const TEST_SECRET = 'test-secret-that-is-at-least-32-characters-long!';
const TEST_PORT = 0; // Let OS pick a port

function makeTestConfig(): AppConfig {
  return {
    server: { host: '127.0.0.1', port: TEST_PORT },
    auth: { secret: TEST_SECRET, tokenTtlSeconds: 3600 },
    cors: { allowedOrigins: [] },
    rateLimit: { maxPerIpPerMinute: 100, maxPerDevicePerMinute: 50 },
    session: { idleTimeoutSeconds: 120, maxConcurrentSessions: 10 },
    apiKeys: {},
    asr: {
      provider: 'openai',
      url: 'https://api.openai.com/v1/audio/transcriptions',
      model: 'whisper-1',
      language: 'en',
    },
    llm: {
      provider: 'ollama',
      url: 'http://localhost:11434/v1/chat/completions',
      model: 'qwen2.5:7b',
      systemPrompt: 'You are a helpful assistant.',
      maxTokens: 2048,
      temperature: 0.7,
    },
    tts: {
      provider: 'edge',
      voice: 'en-US-AriaNeural',
      sampleRate: 24000,
    },
    logLevel: 'warn',
  };
}

describe('ESP32 compatibility flow', () => {
  let app: Awaited<ReturnType<typeof createHttpServer>>;
  let sessionManager: SessionManager;
  let baseUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    const config = makeTestConfig();
    const logger = createLogger('warn');
    sessionManager = new SessionManager(config.session, logger);
    sessionManager.start();

    // Mock providers (not used in protocol tests)
    const mockProviders: Providers = {
      asr: { name: 'mock-asr', transcribe: async () => ({ text: '' }) } as ASRProvider,
      llm: { name: 'mock-llm', chat: async function*() {} } as unknown as LLMProvider,
      tts: { name: 'mock-tts', synthesize: async () => ({ audio: Buffer.alloc(0), sampleRate: 16000, format: 'pcm', duration: 0 }) } as TTSProvider,
    };

    app = await createHttpServer(config, logger);
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
    const port = (app.server.address() as { port: number }).port;
    wsUrl = `ws://127.0.0.1:${port}/ws`;

    createWebSocketServer(app.server, config, sessionManager, mockProviders, logger);
  });

  afterAll(async () => {
    sessionManager.stop();
    await app.close();
  });

  it('Step 1: OTA endpoint returns token and WS URL', async () => {
    const response = await fetch(`${baseUrl}/api/ota`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac_address: 'AA:BB:CC:DD:EE:FF' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { token: string; device_id: string; server_url: string };
    expect(body.token).toBeDefined();
    expect(body.device_id).toBe('AA:BB:CC:DD:EE:FF');
    expect(body.server_url).toContain('ws://');
  });

  it('Step 2: OTA rejects missing device ID', async () => {
    const response = await fetch(`${baseUrl}/api/ota`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });

  it('Step 3: Health endpoint works', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    const body = await response.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('Step 4: WebSocket rejects connection without token', async () => {
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve) => {
      ws.on('close', (code) => {
        expect(code).toBe(1008);
        resolve();
      });
      ws.on('error', () => {
        resolve(); // Connection error is also acceptable (rejected before upgrade)
      });
    });
  });

  it('Step 5: WebSocket accepts valid token and exchanges hello', async () => {
    const token = generateToken(TEST_SECRET, 'test-device-001', 3600);
    const ws = new WebSocket(`${wsUrl}?token=${token}`);

    const messages: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

      ws.on('open', () => {
        // Send hello message (simulating ESP32)
        ws.send(JSON.stringify({
          type: 'hello',
          version: 1,
          transport: 'websocket',
          audio_params: {
            format: 'opus',
            sample_rate: 16000,
            channels: 1,
            frame_duration: 60,
          },
          features: ['tts', 'stt'],
        }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        messages.push(msg);

        // Got server hello — send ping to verify bidirectional comms
        if (msg.type === 'hello') {
          ws.send(JSON.stringify({ type: 'ping' }));
        }

        // Got pong — test complete
        if (msg.type === 'pong') {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Verify server hello
    const serverHello = messages[0] as Record<string, unknown>;
    expect(serverHello['type']).toBe('hello');
    expect(serverHello['session_id']).toBeDefined();
    expect(serverHello['version']).toBe(1);
    expect(serverHello['transport']).toBe('websocket');

    // Verify pong
    const pong = messages[1] as Record<string, unknown>;
    expect(pong['type']).toBe('pong');
  });

  it('Step 6: WebSocket returns error for malformed messages', async () => {
    const token = generateToken(TEST_SECRET, 'test-device-002', 3600);
    const ws = new WebSocket(`${wsUrl}?token=${token}`);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

      ws.on('open', () => {
        // Send malformed JSON
        ws.send('not valid json{{{');
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.type).toBe('error');
        expect(msg.code).toBe('INVALID_JSON');
        clearTimeout(timeout);
        ws.close();
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });

  it('Step 7: WebSocket returns error for unknown message type', async () => {
    const token = generateToken(TEST_SECRET, 'test-device-003', 3600);
    const ws = new WebSocket(`${wsUrl}?token=${token}`);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'nonexistent_type' }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.type).toBe('error');
        expect(msg.code).toBe('SCHEMA_ERROR');
        clearTimeout(timeout);
        ws.close();
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });

  it('Step 8: Full flow — OTA → WS connect → hello → ping → goodbye', async () => {
    // 1. OTA to get token
    const otaResponse = await fetch(`${baseUrl}/api/ota`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac_address: 'FF:EE:DD:CC:BB:AA' }),
    });
    const ota = await otaResponse.json() as { token: string; server_url: string };

    // 2. Connect WebSocket with token
    const port = (app.server.address() as { port: number }).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${ota.token}`);

    const messages: Record<string, unknown>[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

      ws.on('open', () => {
        // 3. Send hello
        ws.send(JSON.stringify({ type: 'hello' }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        messages.push(msg);

        if (msg['type'] === 'hello') {
          // 4. Send ping
          ws.send(JSON.stringify({ type: 'ping' }));
        } else if (msg['type'] === 'pong') {
          // 5. Send goodbye
          ws.send(JSON.stringify({ type: 'goodbye', reason: 'test_complete' }));
        } else if (msg['type'] === 'goodbye') {
          clearTimeout(timeout);
          resolve();
        }
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    expect(messages).toHaveLength(3); // hello, pong, goodbye
    expect(messages[0]!['type']).toBe('hello');
    expect(messages[1]!['type']).toBe('pong');
    expect(messages[2]!['type']).toBe('goodbye');
  });
});

/**
 * WebSocket protocol client for worzel.
 * Handles OTA auth → WebSocket connection → hello handshake.
 */

export type ConnectionState = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error';

export interface WsClientOptions {
  serverUrl: string;
  deviceId?: string;
}

export interface WsClientEvents {
  stateChange: (state: ConnectionState) => void;
  stt: (text: string) => void;
  tts: (event: { state: string; text?: string }) => void;
  error: (message: string) => void;
  audio: (data: ArrayBuffer) => void;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private token: string | null = null;
  private sessionId: string | null = null;
  private listeners = new Map<string, Set<Function>>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private options: WsClientOptions) {}

  on<K extends keyof WsClientEvents>(event: K, handler: WsClientEvents[K]): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  off<K extends keyof WsClientEvents>(event: K, handler: WsClientEvents[K]): void {
    this.listeners.get(event)?.delete(handler);
  }

  private emit<K extends keyof WsClientEvents>(event: K, ...args: Parameters<WsClientEvents[K]>): void {
    for (const handler of this.listeners.get(event) ?? []) {
      (handler as Function)(...args);
    }
  }

  private setState(newState: ConnectionState): void {
    this.state = newState;
    this.emit('stateChange', newState);
  }

  get currentState(): ConnectionState { return this.state; }
  get currentSessionId(): string | null { return this.sessionId; }

  /** Step 1: Authenticate via OTA endpoint */
  async connect(): Promise<void> {
    if (this.state !== 'disconnected' && this.state !== 'error') return;
    this.setState('authenticating');

    try {
      // OTA request to get token
      const otaUrl = this.options.serverUrl.replace(/\/$/, '') + '/api/ota';
      const deviceId = this.options.deviceId ?? `browser-${crypto.randomUUID().slice(0, 8)}`;

      const response = await fetch(otaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId }),
      });

      if (!response.ok) {
        throw new Error(`OTA auth failed: ${response.status}`);
      }

      const data = await response.json() as { token: string; server_url: string };
      this.token = data.token;

      // Step 2: Connect WebSocket
      this.setState('connecting');
      const wsUrl = data.server_url + `?token=${encodeURIComponent(this.token)}`;
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        // Step 3: Send hello
        this.send({
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
        });
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          this.emit('audio', event.data);
          return;
        }

        try {
          const msg = JSON.parse(event.data as string) as Record<string, unknown>;
          this.handleMessage(msg);
        } catch {
          this.emit('error', 'Invalid message from server');
        }
      };

      this.ws.onclose = () => {
        this.cleanup();
        this.setState('disconnected');
      };

      this.ws.onerror = () => {
        this.emit('error', 'WebSocket error');
        this.cleanup();
        this.setState('error');
      };

    } catch (err) {
      this.emit('error', (err as Error).message);
      this.setState('error');
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.send({ type: 'goodbye', reason: 'user_disconnect' });
      this.ws.close();
    }
    this.cleanup();
    this.setState('disconnected');
  }

  /** Send audio data */
  sendAudio(data: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  /** Start recording */
  startListening(mode: 'manual' | 'auto' = 'manual'): void {
    this.send({ type: 'listen', state: 'start', mode });
  }

  /** Stop recording */
  stopListening(): void {
    this.send({ type: 'listen', state: 'stop' });
  }

  /** Abort current response */
  abort(): void {
    this.send({ type: 'abort', reason: 'user_interrupt' });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg['type']) {
      case 'hello':
        this.sessionId = msg['session_id'] as string;
        this.setState('connected');
        this.startPing();
        break;
      case 'stt':
        this.emit('stt', msg['text'] as string);
        break;
      case 'tts':
        this.emit('tts', { state: msg['state'] as string, text: msg['text'] as string | undefined });
        break;
      case 'pong':
        // Keepalive response
        break;
      case 'error':
        this.emit('error', msg['message'] as string);
        break;
      case 'goodbye':
        this.disconnect();
        break;
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30_000);
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.ws = null;
    this.token = null;
    this.sessionId = null;
  }
}

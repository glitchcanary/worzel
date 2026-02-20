import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { Transport } from './interface.js';

/**
 * WebSocket transport implementing the legacy xiaozhi protocol.
 * Binary frames carry Opus audio, text frames carry JSON control messages.
 */
export class WebSocketTransport implements Transport {
  readonly id: string;
  readonly type = 'websocket' as const;

  private _connected = true;
  private textHandlers: ((data: string) => void)[] = [];
  private binaryHandlers: ((data: Buffer) => void)[] = [];
  private closeHandlers: ((code: number, reason: string) => void)[] = [];
  private errorHandlers: ((error: Error) => void)[] = [];

  constructor(private readonly ws: WebSocket) {
    this.id = randomUUID();

    ws.on('message', (data: Buffer | string, isBinary: boolean) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        for (const handler of this.binaryHandlers) handler(buf);
      } else {
        const str = typeof data === 'string' ? data : data.toString('utf-8');
        for (const handler of this.textHandlers) handler(str);
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this._connected = false;
      for (const handler of this.closeHandlers) handler(code, reason.toString('utf-8'));
    });

    ws.on('error', (err: Error) => {
      for (const handler of this.errorHandlers) handler(err);
    });
  }

  get connected(): boolean {
    return this._connected && this.ws.readyState === this.ws.OPEN;
  }

  async sendText(data: string): Promise<void> {
    if (!this.connected) return;
    return new Promise((resolve, reject) => {
      this.ws.send(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async sendBinary(data: Buffer | Uint8Array): Promise<void> {
    if (!this.connected) return;
    return new Promise((resolve, reject) => {
      this.ws.send(data, { binary: true }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  close(code: number = 1000, reason: string = 'normal'): void {
    this._connected = false;
    this.ws.close(code, reason);
  }

  onText(handler: (data: string) => void): void {
    this.textHandlers.push(handler);
  }

  onBinary(handler: (data: Buffer) => void): void {
    this.binaryHandlers.push(handler);
  }

  onClose(handler: (code: number, reason: string) => void): void {
    this.closeHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }
}

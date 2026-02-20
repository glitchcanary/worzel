/**
 * MCP client for device-side tools.
 *
 * Allows the server to call tools exposed by the connected device
 * (e.g., IoT controls, camera capture, sensor readings).
 *
 * In the xiaozhi protocol, MCP sub-messages flow within the WebSocket
 * connection. This client wraps that exchange as JSON-RPC 2.0.
 */

import type { Transport } from '../transport/interface.js';
import type pino from 'pino';

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class McpClient {
  private nextId = 1;
  private pending = new Map<string | number, PendingRequest>();
  private readonly requestTimeout: number;

  constructor(
    private readonly transport: Transport,
    private readonly logger: pino.Logger,
    options?: { requestTimeout?: number },
  ) {
    this.requestTimeout = options?.requestTimeout ?? 30_000;
  }

  /** Call a tool on the device */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;

    const request = {
      type: 'mcp',
      method: 'tools/call',
      id,
      params: { name, arguments: args },
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP tool call '${name}' timed out after ${this.requestTimeout}ms`));
      }, this.requestTimeout);

      this.pending.set(id, { resolve, reject, timeout });
      this.transport.sendText(JSON.stringify(request)).catch(reject);
    });
  }

  /** Handle an MCP response from the device */
  handleResponse(msg: {
    id?: string | number;
    result?: unknown;
    error?: { code: number; message: string };
  }): void {
    if (msg.id == null) return;

    const pending = this.pending.get(msg.id);
    if (!pending) {
      this.logger.warn({ id: msg.id }, 'Received MCP response for unknown request');
      return;
    }

    this.pending.delete(msg.id);
    clearTimeout(pending.timeout);

    if (msg.error) {
      pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  /** List tools exposed by the device */
  async listTools(): Promise<unknown> {
    const id = this.nextId++;
    const request = {
      type: 'mcp',
      method: 'tools/list',
      id,
      params: {},
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('MCP tools/list timed out'));
      }, this.requestTimeout);

      this.pending.set(id, { resolve, reject, timeout });
      this.transport.sendText(JSON.stringify(request)).catch(reject);
    });
  }

  /** Clean up pending requests */
  destroy(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('MCP client destroyed'));
      this.pending.delete(id);
    }
  }
}

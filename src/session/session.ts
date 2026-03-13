import { randomUUID } from 'node:crypto';
import type { AudioParams } from '../protocol/types.js';

export type SessionState = 'connecting' | 'ready' | 'listening' | 'processing' | 'closed';
export type ListeningState = 'idle' | 'detecting' | 'recording';

export interface DialogueEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * Per-device session state.
 * Structured like an XMPP JID: device-id@worzel.local
 */
export class Session {
  readonly id: string;
  readonly deviceId: string;
  readonly jid: string;
  readonly createdAt: number;

  state: SessionState = 'connecting';
  listeningState: ListeningState = 'idle';
  transport: 'websocket' | 'webrtc' = 'websocket';
  audioParams: AudioParams = {
    format: 'opus',
    sample_rate: 16000,
    channels: 1,
    frame_duration: 60,
  };

  /** Dialogue history for this session */
  dialogue: DialogueEntry[] = [];

  /** Peak RMS audio energy (0.0–1.0) from the last recording chunk. */
  lastAudioLevel: number | undefined;

  /** Abort controller for interrupting pipeline operations */
  abortController: AbortController | null = null;

  /** Last activity timestamp (for idle timeout) */
  private _lastActivity: number;

  constructor(deviceId: string) {
    this.id = randomUUID();
    this.deviceId = deviceId;
    this.jid = `${deviceId}@worzel.local`;
    this.createdAt = Date.now();
    this._lastActivity = Date.now();
  }

  get lastActivity(): number {
    return this._lastActivity;
  }

  /** Update the last activity timestamp */
  touchActivity(): void {
    this._lastActivity = Date.now();
  }

  /** Check if the session has been idle for longer than the timeout */
  isIdle(timeoutMs: number): boolean {
    return Date.now() - this._lastActivity > timeoutMs;
  }

  /** Add a dialogue entry */
  addDialogue(role: 'user' | 'assistant', content: string): void {
    this.dialogue.push({
      role,
      content,
      timestamp: Date.now(),
    });
  }

  /** Get dialogue formatted for LLM context */
  getDialogueForLlm(maxEntries: number = 20): { role: string; content: string }[] {
    return this.dialogue.slice(-maxEntries).map(({ role, content }) => ({ role, content }));
  }

  /** Clean up session resources */
  destroy(): void {
    this.state = 'closed';
    this.abortController?.abort();
    this.dialogue = [];
  }
}

/**
 * Transport abstraction for device communication.
 * Implementations: WebSocket (legacy), WebRTC (preferred), Twilio (PSTN).
 */
export interface Transport {
  /** Unique identifier for this transport instance */
  readonly id: string;

  /** Transport type */
  readonly type: 'websocket' | 'webrtc' | 'twilio';

  /** Whether the transport is currently connected */
  readonly connected: boolean;

  /** Send a text (JSON) message */
  sendText(data: string): Promise<void>;

  /** Send binary (audio) data */
  sendBinary(data: Buffer | Uint8Array): Promise<void>;

  /** Close the transport */
  close(code?: number, reason?: string): void;

  /** Register handler for text messages */
  onText(handler: (data: string) => void): void;

  /** Register handler for binary messages */
  onBinary(handler: (data: Buffer) => void): void;

  /** Register handler for close */
  onClose(handler: (code: number, reason: string) => void): void;

  /** Register handler for errors */
  onError(handler: (error: Error) => void): void;
}

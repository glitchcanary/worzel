/**
 * WebRTC signaling via WHIP (WebRTC-HTTP Ingestion Protocol).
 *
 * ESP32 esp-webrtc-solution supports WHIP signaling and HTTP SSE.
 * This module provides the server-side signaling endpoints.
 *
 * Phase 1: Stub endpoints. Full WebRTC implementation will evaluate
 * werift (pure TS) vs node-webrtc (native) in Phase 1+.
 */

import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

export function registerWhipEndpoints(
  _app: FastifyInstance,
  _logger: pino.Logger,
): void {
  // WHIP endpoint is already stubbed in http.ts
  // Full implementation will be added when WebRTC library is selected
  //
  // The flow:
  // 1. Client POST /api/whip with SDP offer
  // 2. Server creates PeerConnection, returns SDP answer
  // 3. ICE candidates exchanged via PATCH /api/whip/{session-id}
  // 4. Audio arrives on RTP track (Opus), control on DataChannel
  // 5. Server sends audio back on RTP track
}

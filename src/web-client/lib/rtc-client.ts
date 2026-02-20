/**
 * WebRTC client stub.
 *
 * Will connect via WHIP signaling to the worzel server.
 * Audio flows over RTP track (Opus), control messages over DataChannel.
 *
 * This is the preferred transport for both browsers and ESP32 devices
 * using esp-webrtc-solution.
 */

export type RtcConnectionState = 'disconnected' | 'signaling' | 'connecting' | 'connected' | 'error';

export interface RtcClientOptions {
  serverUrl: string;
  deviceId?: string;
}

export class RtcClient {
  private _state: RtcConnectionState = 'disconnected';

  constructor(private readonly _options: RtcClientOptions) { void this._options; }

  get state(): RtcConnectionState { return this._state; }

  /**
   * Connect via WHIP signaling.
   *
   * Flow:
   * 1. Create RTCPeerConnection
   * 2. Add audio track (microphone)
   * 3. Create DataChannel for control messages
   * 4. Create SDP offer
   * 5. POST offer to /api/whip → get SDP answer
   * 6. Set remote description
   * 7. Exchange ICE candidates
   *
   * ESP32 esp-webrtc-solution uses the same WHIP flow.
   */
  async connect(): Promise<void> {
    // Full implementation pending WebRTC library selection for server side.
    // Browser-side RTCPeerConnection API is standard and ready to use.
    this._state = 'disconnected';
    throw new Error('WebRTC client not yet implemented — use WsClient for now');
  }

  disconnect(): void {
    this._state = 'disconnected';
  }
}

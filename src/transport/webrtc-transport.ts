/**
 * WebRTC transport stub.
 *
 * Will be implemented when WebRTC library (werift or node-webrtc) is selected.
 * The interface matches Transport so it's a drop-in replacement for WebSocketTransport.
 *
 * In WebRTC mode:
 * - Audio flows via RTP media track (Opus, no manual encode/decode on wire)
 * - JSON control messages flow via DataChannel
 * - DTLS/SRTP provides mandatory encryption
 * - WHIP provides HTTP-based signaling
 */

export const WEBRTC_TRANSPORT_PENDING = true;

// Implementation will:
// 1. Accept a PeerConnection (created during WHIP signaling)
// 2. Listen for audio on the inbound audio track
// 3. Send audio on the outbound audio track
// 4. Use DataChannel for sendText/onText
// 5. Implement the Transport interface identically to WebSocketTransport

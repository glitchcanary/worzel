import type { HelloMessage, ServerHello } from '../types.js';
import type { RouteContext } from '../router.js';

const PROTOCOL_VERSION = 1;
const SUPPORTED_FEATURES = ['tts', 'stt', 'iot', 'mcp'];

/**
 * Handle the hello handshake message.
 * Negotiates audio parameters and features, sends server hello response.
 */
export async function handleHello(
  message: HelloMessage,
  ctx: RouteContext,
): Promise<void> {
  const { session, transport, logger } = ctx;

  // Update session with negotiated params
  const audioParams = {
    format: message.audio_params?.format ?? 'opus',
    sample_rate: message.audio_params?.sample_rate ?? 16000,
    channels: message.audio_params?.channels ?? 1,
    frame_duration: message.audio_params?.frame_duration ?? 60,
  } as const;

  session.audioParams = audioParams;
  session.transport = message.transport;
  session.state = 'ready';

  // Determine supported features based on what the client requested
  const clientFeatures = message.features ?? [];
  const negotiatedFeatures = clientFeatures.length > 0
    ? clientFeatures.filter(f => SUPPORTED_FEATURES.includes(f))
    : SUPPORTED_FEATURES;

  const response: ServerHello = {
    type: 'hello',
    version: PROTOCOL_VERSION,
    session_id: session.id,
    transport: message.transport,
    audio_params: audioParams,
    features: negotiatedFeatures,
  };

  logger.info({
    sessionId: session.id,
    deviceId: session.deviceId,
    transport: message.transport,
    features: negotiatedFeatures,
  }, 'Hello handshake completed');

  await transport.sendText(JSON.stringify(response));
}

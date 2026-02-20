import type { AbortMessage } from '../types.js';
import type { RouteContext } from '../router.js';

/**
 * Handle abort: interrupt current TTS/LLM response.
 */
export async function handleAbort(
  message: AbortMessage,
  ctx: RouteContext,
): Promise<void> {
  const { session, transport, logger } = ctx;

  // Signal the voice pipeline to stop (Phase 2 will wire this up)
  session.abortController?.abort();
  session.listeningState = 'idle';

  logger.info({
    sessionId: session.id,
    reason: message.reason,
  }, 'Response aborted');

  await transport.sendText(JSON.stringify({
    type: 'tts',
    state: 'stop',
    session_id: session.id,
  }));
}

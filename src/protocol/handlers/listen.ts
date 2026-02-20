import type { ListenMessage } from '../types.js';
import type { RouteContext } from '../router.js';

/**
 * Handle listen state changes (recording start/stop/detect).
 */
export async function handleListen(
  message: ListenMessage,
  ctx: RouteContext,
): Promise<void> {
  const { session, logger } = ctx;

  switch (message.state) {
    case 'start':
      session.listeningState = 'recording';
      logger.info({ sessionId: session.id, mode: message.mode }, 'Recording started');
      break;
    case 'stop':
      session.listeningState = 'idle';
      logger.info({ sessionId: session.id }, 'Recording stopped');
      break;
    case 'detect':
      session.listeningState = 'detecting';
      logger.info({ sessionId: session.id }, 'Wake word detection mode');
      break;
  }

  session.touchActivity();
}

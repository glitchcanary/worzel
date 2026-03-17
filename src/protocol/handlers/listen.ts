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
      session.startRecordingWindow();
      logger.info({ sessionId: session.id, mode: message.mode }, 'Recording started');
      break;
    case 'stop':
      session.listeningState = 'idle';
      session.lastAudioLevel = message.audio_level;
      session.finishRecordingWindow(Date.now(), message.audio_level);
      logger.info({ sessionId: session.id, audioLevel: message.audio_level }, 'Recording stopped');
      break;
    case 'detect':
      session.listeningState = 'detecting';
      logger.info({ sessionId: session.id }, 'Wake word detection mode');
      break;
  }

  session.touchActivity();
}

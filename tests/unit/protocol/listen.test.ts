import { describe, expect, it } from 'vitest';
import { handleListen } from '../../../src/protocol/handlers/listen.js';
import { Session } from '../../../src/session/session.js';
import { createLogger } from '../../../src/utils/logger.js';

describe('handleListen', () => {
  it('tracks recording windows across start and stop', async () => {
    const session = new Session('test-device');
    const logger = createLogger('silent');
    const ctx = {
      session,
      logger,
      transport: null,
      sessionManager: null,
    } as any;

    await handleListen({ type: 'listen', state: 'start', mode: 'manual' }, ctx);
    expect(session.currentRecordingStartedAt).not.toBeNull();

    await new Promise(resolve => setTimeout(resolve, 5));

    await handleListen({ type: 'listen', state: 'stop', audio_level: 0.12 }, ctx);
    expect(session.currentRecordingStartedAt).toBeNull();
    expect(session.lastRecordingWindow).toEqual(expect.objectContaining({
      audioLevel: 0.12,
    }));
    expect(session.lastRecordingWindow!.durationMs).toBeGreaterThanOrEqual(0);
  });
});

import { describe, expect, it } from 'vitest';
import { Session } from '../../../src/session/session.js';

describe('Session spoken output tracking', () => {
  it('stores spoken output with estimated finish time', () => {
    const session = new Session('test-device');
    const startedAt = Date.now();

    session.addSpokenOutput({
      text: 'Hello there',
      provider: 'mock-tts',
      cacheScope: 'volatile',
      startedAt,
      estimatedDurationMs: 900,
    });

    expect(session.recentSpokenOutput).toHaveLength(1);
    expect(session.recentSpokenOutput[0]).toEqual(expect.objectContaining({
      text: 'Hello there',
      provider: 'mock-tts',
      cacheScope: 'volatile',
      startedAt,
      estimatedDurationMs: 900,
      finishedAtEstimate: startedAt + 900,
    }));
  });

  it('finds spoken output overlapping a time window', () => {
    const session = new Session('test-device');
    const now = Date.now();

    session.addSpokenOutput({
      text: 'First line',
      startedAt: now - 2_000,
      estimatedDurationMs: 1_500,
    });
    session.addSpokenOutput({
      text: 'Second line',
      startedAt: now - 500,
      estimatedDurationMs: 2_000,
    });

    const overlaps = session.getSpokenOutputOverlapping(now - 1_000, now + 200);
    expect(overlaps.map(entry => entry.text)).toEqual(['First line', 'Second line']);
  });
});

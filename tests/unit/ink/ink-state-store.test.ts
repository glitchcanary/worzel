import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InkStateStore } from '../../../src/ink/ink-state-store.js';

describe('InkStateStore', () => {
  let tmpDir: string;
  let store: InkStateStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ink-state-'));
    store = new InkStateStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads state', async () => {
    await store.save('device-1', 'test-story', '{"ink_state": true}', {
      turnCount: 5,
      lastChoice: 'Open the gate',
      variables: { courage: 2 },
      characterVoices: { narrator: 'alloy', cat: 'shimmer' },
    });

    const loaded = await store.load('device-1', 'test-story');
    expect(loaded).not.toBeNull();
    expect(loaded!.storyId).toBe('test-story');
    expect(loaded!.inkState).toBe('{"ink_state": true}');
    expect(loaded!.turnCount).toBe(5);
    expect(loaded!.lastChoice).toBe('Open the gate');
    expect(loaded!.variables).toEqual({ courage: 2 });
    expect(loaded!.characterVoices).toEqual({ narrator: 'alloy', cat: 'shimmer' });
  });

  it('returns null for non-existent save', async () => {
    const loaded = await store.load('no-device', 'no-story');
    expect(loaded).toBeNull();
  });

  it('hasSave returns true when save exists', async () => {
    await store.save('device-1', 'story-1', '{}');
    expect(await store.hasSave('device-1', 'story-1')).toBe(true);
    expect(await store.hasSave('device-1', 'story-2')).toBe(false);
  });

  it('overwrites existing save', async () => {
    await store.save('device-1', 'story-1', '{"v": 1}', { turnCount: 1 });
    await store.save('device-1', 'story-1', '{"v": 2}', { turnCount: 2 });

    const loaded = await store.load('device-1', 'story-1');
    expect(loaded!.inkState).toBe('{"v": 2}');
    expect(loaded!.turnCount).toBe(2);
  });

  it('sanitizes device and story IDs for filesystem safety', async () => {
    await store.save('device/../../../etc', 'story;rm -rf', '{"safe": true}');

    const loaded = await store.load('device/../../../etc', 'story;rm -rf');
    expect(loaded).not.toBeNull();
    expect(loaded!.inkState).toBe('{"safe": true}');
  });
});

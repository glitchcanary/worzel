import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CachedTTSProvider } from '../../../src/providers/tts/cached-tts.js';
import type { TTSProvider, TTSResult } from '../../../src/providers/interface.js';

class FakeTTSProvider implements TTSProvider {
  readonly name = 'fake-tts';
  readonly provider = 'fake';
  calls = 0;

  async synthesize(text: string): Promise<TTSResult> {
    this.calls++;
    return {
      audio: Buffer.from(`audio:${text}:${this.calls}`),
      sampleRate: 16000,
      format: 'pcm',
    };
  }
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('CachedTTSProvider', () => {
  it('reuses persistent cache entries across identical requests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worzel-tts-cache-'));
    cleanupDirs.push(dir);
    const inner = new FakeTTSProvider();
    const cached = new CachedTTSProvider(inner, { cacheDir: dir });

    const first = await cached.synthesize('Cold night air hits your face.', {
      voice: 'barney',
      cacheScope: 'persistent',
    });
    const second = await cached.synthesize('Cold night air hits your face.', {
      voice: 'barney',
      cacheScope: 'persistent',
    });

    expect(inner.calls).toBe(1);
    expect(second.audio.equals(first.audio)).toBe(true);
  });

  it('keeps volatile cache in memory without persisting user-derived text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worzel-tts-cache-'));
    cleanupDirs.push(dir);
    const inner = new FakeTTSProvider();
    const cached = new CachedTTSProvider(inner, { cacheDir: dir, volatileTtlMs: 60_000 });

    const first = await cached.synthesize('Who can you trust here?', {
      cacheScope: 'volatile',
    });
    const second = await cached.synthesize('Who can you trust here?', {
      cacheScope: 'volatile',
    });

    expect(inner.calls).toBe(1);
    expect(second.audio.equals(first.audio)).toBe(true);
  });
});

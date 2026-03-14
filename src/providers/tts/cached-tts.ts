import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pino from 'pino';
import type { TTSProvider, TTSResult } from '../interface.js';

interface CachedTTSOptions {
  cacheDir: string;
  logger?: pino.Logger;
  volatileTtlMs?: number;
}

interface VolatileEntry {
  result: TTSResult;
  expiresAt: number;
}

interface PersistentPayload {
  sampleRate: number;
  format: string;
  duration?: number;
  audioBase64: string;
}

export class CachedTTSProvider implements TTSProvider {
  readonly name: string;
  readonly provider?: string;

  private readonly inner: TTSProvider;
  private readonly cacheDir: string;
  private readonly logger?: pino.Logger;
  private readonly volatileTtlMs: number;
  private readonly volatileCache = new Map<string, VolatileEntry>();
  private cacheDirReady?: Promise<void>;

  constructor(inner: TTSProvider, options: CachedTTSOptions) {
    this.inner = inner;
    this.name = inner.name;
    this.provider = inner.provider;
    this.cacheDir = options.cacheDir;
    this.logger = options.logger;
    this.volatileTtlMs = options.volatileTtlMs ?? 30 * 60 * 1000;
  }

  async synthesize(text: string, options?: {
    voice?: string;
    language?: string;
    sampleRate?: number;
    format?: 'opus' | 'pcm' | 'mp3';
    speed?: number;
    cacheScope?: 'persistent' | 'volatile' | 'none';
    cacheTtlMs?: number;
  }): Promise<TTSResult> {
    const cacheScope = options?.cacheScope ?? 'volatile';
    if (cacheScope === 'none') {
      return this.inner.synthesize(text, options);
    }

    const cacheKey = buildCacheKey(this.inner, text, options);

    if (cacheScope === 'volatile') {
      const hit = this.getVolatile(cacheKey);
      if (hit) return hit;
    } else {
      const hit = await this.getPersistent(cacheKey);
      if (hit) return hit;
    }

    const result = await this.inner.synthesize(text, options);

    if (cacheScope === 'volatile') {
      this.setVolatile(cacheKey, result, options?.cacheTtlMs);
    } else {
      await this.setPersistent(cacheKey, result);
    }

    return result;
  }

  private getVolatile(key: string): TTSResult | undefined {
    const hit = this.volatileCache.get(key);
    if (!hit) return undefined;
    if (Date.now() >= hit.expiresAt) {
      this.volatileCache.delete(key);
      return undefined;
    }
    this.logger?.debug({ key, provider: this.provider ?? this.name }, 'TTS volatile cache hit');
    return cloneResult(hit.result);
  }

  private setVolatile(key: string, result: TTSResult, ttlMs?: number): void {
    this.volatileCache.set(key, {
      result: cloneResult(result),
      expiresAt: Date.now() + (ttlMs ?? this.volatileTtlMs),
    });
  }

  private async getPersistent(key: string): Promise<TTSResult | undefined> {
    try {
      await this.ensureCacheDir();
      const payload = JSON.parse(
        await readFile(join(this.cacheDir, `${key}.json`), 'utf8'),
      ) as PersistentPayload;
      this.logger?.debug({ key, provider: this.provider ?? this.name }, 'TTS persistent cache hit');
      return {
        audio: Buffer.from(payload.audioBase64, 'base64'),
        sampleRate: payload.sampleRate,
        format: payload.format,
        duration: payload.duration,
      };
    } catch {
      return undefined;
    }
  }

  private async setPersistent(key: string, result: TTSResult): Promise<void> {
    try {
      await this.ensureCacheDir();
      const payload: PersistentPayload = {
        sampleRate: result.sampleRate,
        format: result.format,
        duration: result.duration,
        audioBase64: result.audio.toString('base64'),
      };
      await writeFile(join(this.cacheDir, `${key}.json`), JSON.stringify(payload));
    } catch (err) {
      this.logger?.warn({ err, key, provider: this.provider ?? this.name }, 'Failed to write TTS cache');
    }
  }

  private async ensureCacheDir(): Promise<void> {
    if (!this.cacheDirReady) {
      this.cacheDirReady = mkdir(this.cacheDir, { recursive: true }).then(() => undefined);
    }
    await this.cacheDirReady;
  }
}

function buildCacheKey(
  provider: TTSProvider,
  text: string,
  options?: {
    voice?: string;
    language?: string;
    sampleRate?: number;
    format?: 'opus' | 'pcm' | 'mp3';
    speed?: number;
  },
): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({
    provider: provider.provider ?? provider.name,
    text,
    voice: options?.voice ?? '',
    language: options?.language ?? '',
    sampleRate: options?.sampleRate ?? '',
    format: options?.format ?? '',
    speed: options?.speed ?? '',
  }));
  return hash.digest('hex');
}

function cloneResult(result: TTSResult): TTSResult {
  return {
    audio: Buffer.from(result.audio),
    sampleRate: result.sampleRate,
    format: result.format,
    duration: result.duration,
  };
}

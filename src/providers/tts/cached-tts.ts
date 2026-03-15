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
      this.logger?.info({
        provider: this.provider ?? this.name,
        cacheScope,
        textLength: text.length,
      }, 'TTS cache bypass');
      return this.inner.synthesize(text, options);
    }

    const cacheKey = buildCacheKey(this.inner, text, options);
    const cacheLog = {
      key: cacheKey.slice(0, 12),
      provider: this.provider ?? this.name,
      cacheScope,
      textLength: text.length,
      voice: options?.voice,
      sampleRate: options?.sampleRate,
      format: options?.format,
      speed: options?.speed,
    };

    if (cacheScope === 'volatile') {
      const hit = this.getVolatile(cacheKey);
      if (hit) {
        this.logger?.info(cacheLog, 'TTS cache hit');
        return hit;
      }
    } else {
      const hit = await this.getPersistent(cacheKey);
      if (hit) {
        this.logger?.info(cacheLog, 'TTS cache hit');
        return hit;
      }
    }

    this.logger?.info(cacheLog, 'TTS cache miss');

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
    return cloneResult(hit.result);
  }

  private setVolatile(key: string, result: TTSResult, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.volatileTtlMs);
    this.volatileCache.set(key, {
      result: cloneResult(result),
      expiresAt,
    });
    this.logger?.info({
      key: key.slice(0, 12),
      provider: this.provider ?? this.name,
      cacheScope: 'volatile',
      audioBytes: result.audio.length,
      format: result.format,
      sampleRate: result.sampleRate,
      ttlMs: ttlMs ?? this.volatileTtlMs,
      expiresAt,
    }, 'TTS cache write');
  }

  private async getPersistent(key: string): Promise<TTSResult | undefined> {
    try {
      await this.ensureCacheDir();
      const payload = JSON.parse(
        await readFile(join(this.cacheDir, `${key}.json`), 'utf8'),
      ) as PersistentPayload;
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
      this.logger?.info({
        key: key.slice(0, 12),
        provider: this.provider ?? this.name,
        cacheScope: 'persistent',
        audioBytes: result.audio.length,
        format: result.format,
        sampleRate: result.sampleRate,
      }, 'TTS cache write');
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

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pino from 'pino';
import type { LLMProvider, LLMChunk, ChatMessage } from '../interface.js';

interface CachedLLMOptions {
  cacheDir: string;
  logger?: pino.Logger;
}

interface PersistentPayload {
  text: string;
}

export class CachedLLMProvider implements LLMProvider {
  readonly name: string;

  private readonly inner: LLMProvider;
  private readonly cacheDir: string;
  private readonly logger?: pino.Logger;
  private cacheDirReady?: Promise<void>;

  constructor(inner: LLMProvider, options: CachedLLMOptions) {
    this.inner = inner;
    this.name = inner.name;
    this.cacheDir = options.cacheDir;
    this.logger = options.logger;
  }

  async *chat(messages: ChatMessage[], options?: {
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): AsyncIterable<LLMChunk> {
    const cacheKey = buildCacheKey(this.inner, messages, options);
    const cacheLog = {
      key: cacheKey.slice(0, 12),
      provider: this.inner.name,
      messages: messages.length,
      model: undefined as string | undefined,
    };

    const hit = await this.getPersistent(cacheKey);
    if (hit) {
      this.logger?.info(cacheLog, 'LLM cache hit');
      yield { text: hit, done: false };
      yield { text: '', done: true };
      return;
    }

    this.logger?.info(cacheLog, 'LLM cache miss');

    let full = '';
    for await (const chunk of this.inner.chat(messages, options)) {
      full += chunk.text;
      yield chunk;
    }

    if (full) {
      await this.setPersistent(cacheKey, full);
    }
  }

  private async getPersistent(key: string): Promise<string | undefined> {
    try {
      await this.ensureCacheDir();
      const payload = JSON.parse(
        await readFile(join(this.cacheDir, `${key}.json`), 'utf8'),
      ) as PersistentPayload;
      return payload.text;
    } catch {
      return undefined;
    }
  }

  private async setPersistent(key: string, text: string): Promise<void> {
    try {
      await this.ensureCacheDir();
      const payload: PersistentPayload = { text };
      await writeFile(join(this.cacheDir, `${key}.json`), JSON.stringify(payload));
      this.logger?.info({
        key: key.slice(0, 12),
        provider: this.inner.name,
        textLength: text.length,
      }, 'LLM cache write');
    } catch (err) {
      this.logger?.warn({ err, key, provider: this.inner.name }, 'Failed to write LLM cache');
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
  provider: LLMProvider,
  messages: ChatMessage[],
  options?: {
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
  },
): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({
    provider: provider.name,
    messages,
    systemPrompt: options?.systemPrompt ?? '',
    maxTokens: options?.maxTokens ?? '',
    temperature: options?.temperature ?? '',
  }));
  return hash.digest('hex');
}

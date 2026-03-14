import type { TTSProvider, TTSResult } from '../interface.js';
import { createGuardedFetch } from '../endpoint-guard.js';

export interface ElevenLabsTTSOptions {
  apiKey: string;
  voice: string;
  model: string;
  sampleRate: number;
}

/**
 * ElevenLabs TTS provider.
 * Uses the ElevenLabs text-to-speech API.
 */
export class ElevenLabsTTS implements TTSProvider {
  readonly name = 'elevenlabs-tts';
  readonly provider = 'elevenlabs';
  private readonly fetch = createGuardedFetch();
  private readonly options: ElevenLabsTTSOptions;
  private voiceIdCache: Map<string, string> | null = null;

  constructor(options: ElevenLabsTTSOptions) {
    this.options = options;
  }

  async synthesize(text: string, options?: {
    voice?: string;
    sampleRate?: number;
    format?: string;
    speed?: number;
    cacheScope?: 'persistent' | 'volatile' | 'none';
    cacheTtlMs?: number;
  }): Promise<TTSResult> {
    const requestedVoice = options?.voice ?? this.options.voice;
    const voiceId = await this.resolveVoiceId(requestedVoice);
    const sampleRate = options?.sampleRate ?? this.options.sampleRate;

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;

    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.options.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: this.options.model,
        output_format: `pcm_${sampleRate}`,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs TTS request failed (${response.status}): ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);
    const isMp3 = audio.length >= 3
      && audio[0] === 0x49
      && audio[1] === 0x44
      && audio[2] === 0x33;

    return {
      audio,
      sampleRate,
      format: isMp3 ? 'mp3' : 'pcm',
    };
  }

  private async resolveVoiceId(voice: string): Promise<string> {
    const trimmed = voice.trim();
    if (!trimmed) return this.options.voice;
    if (/^[A-Za-z0-9]{20,}$/.test(trimmed)) return trimmed;

    const cache = await this.loadVoiceCache();
    const exact = cache.get(trimmed.toLowerCase());
    if (exact) return exact;

    const normalized = trimmed.toLowerCase().replace(/\s+-.*$/, '').trim();
    const loose = cache.get(normalized);
    if (loose) return loose;

    return trimmed;
  }

  private async loadVoiceCache(): Promise<Map<string, string>> {
    if (this.voiceIdCache) return this.voiceIdCache;

    const response = await this.fetch('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers: {
        'xi-api-key': this.options.apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs voice list request failed (${response.status}): ${error}`);
    }

    const data = await response.json() as { voices?: Array<{ voice_id?: string; name?: string }> };
    const cache = new Map<string, string>();

    for (const voice of data.voices ?? []) {
      const id = voice.voice_id?.trim();
      const name = voice.name?.trim();
      if (!id || !name) continue;

      cache.set(name.toLowerCase(), id);
      cache.set(name.toLowerCase().replace(/\s+-.*$/, '').trim(), id);
    }

    this.voiceIdCache = cache;
    return cache;
  }
}

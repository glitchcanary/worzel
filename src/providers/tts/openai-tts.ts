import type { TTSProvider, TTSResult } from '../interface.js';
import { createGuardedFetch } from '../endpoint-guard.js';

export interface OpenAITTSOptions {
  url: string;
  apiKey: string;
  model: string;
  voice: string;
  sampleRate: number;
}

/**
 * OpenAI TTS provider.
 * Uses the OpenAI audio speech API.
 */
export class OpenAITTS implements TTSProvider {
  readonly name = 'openai-tts';
  private readonly fetch = createGuardedFetch();
  private readonly options: OpenAITTSOptions;

  constructor(options: OpenAITTSOptions) {
    this.options = options;
  }

  async synthesize(text: string, options?: {
    voice?: string;
    sampleRate?: number;
    format?: string;
  }): Promise<TTSResult> {
    const voice = options?.voice ?? this.options.voice;

    const response = await this.fetch(this.options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        input: text,
        voice,
        response_format: 'pcm',
        speed: 1.0,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS request failed (${response.status}): ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    return {
      audio,
      sampleRate: options?.sampleRate ?? this.options.sampleRate,
      format: 'pcm',
    };
  }
}

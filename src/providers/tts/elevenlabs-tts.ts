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
  private readonly fetch = createGuardedFetch();
  private readonly options: ElevenLabsTTSOptions;

  constructor(options: ElevenLabsTTSOptions) {
    this.options = options;
  }

  async synthesize(text: string, options?: {
    voice?: string;
    sampleRate?: number;
    format?: string;
  }): Promise<TTSResult> {
    const voiceId = options?.voice ?? this.options.voice;
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

    return {
      audio,
      sampleRate,
      format: 'pcm',
    };
  }
}

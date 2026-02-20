import type { ASRProvider, ASRResult } from '../interface.js';
import { createGuardedFetch } from '../endpoint-guard.js';

/** Build a minimal WAV header for raw PCM data */
function buildWavHeader(dataLength: number, sampleRate: number, channels: number, bitsPerSample: number): Uint8Array {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF chunk
  view.setUint32(0, 0x52494646, false);  // "RIFF"
  view.setUint32(4, 36 + dataLength, true);
  view.setUint32(8, 0x57415645, false);  // "WAVE"

  // fmt sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);          // sub-chunk size
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataLength, true);

  return new Uint8Array(header);
}

export interface OpenAIASROptions {
  url: string;
  apiKey: string;
  model: string;
  language: string;
}

/**
 * OpenAI Whisper ASR provider.
 * Also compatible with Groq's Whisper endpoint.
 */
export class OpenAIASR implements ASRProvider {
  readonly name = 'openai-asr';
  private readonly fetch = createGuardedFetch();
  private readonly options: OpenAIASROptions;

  constructor(options: OpenAIASROptions) {
    this.options = options;
  }

  async transcribe(audio: Buffer, options?: {
    language?: string;
    format?: string;
    sampleRate?: number;
  }): Promise<ASRResult> {
    const formData = new FormData();

    let fileData: Buffer;
    let filename: string;
    let mimeType: string;

    if (options?.format === 'pcm') {
      // Raw PCM int16 LE needs a WAV header for Whisper to decode it
      const sampleRate = options?.sampleRate ?? 16000;
      const wavHeader = Buffer.from(buildWavHeader(audio.length, sampleRate, 1, 16));
      fileData = Buffer.concat([wavHeader, audio]);
      filename = 'audio.wav';
      mimeType = 'audio/wav';
    } else {
      // Opus frames — send as-is, Whisper handles raw Opus/OGG
      fileData = Buffer.from(audio);
      filename = 'audio.ogg';
      mimeType = 'audio/ogg';
    }
    formData.append('file', new Blob([fileData as unknown as ArrayBuffer], { type: mimeType }), filename);
    formData.append('model', this.options.model);
    formData.append('language', options?.language ?? this.options.language);
    formData.append('response_format', 'json');

    const response = await this.fetch(this.options.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.options.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ASR request failed (${response.status}): ${error}`);
    }

    const result = await response.json() as { text: string };
    return { text: result.text };
  }
}

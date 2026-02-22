import type pino from 'pino';
import type { TTSProvider } from '../providers/interface.js';
import { encodeToOpusFrames } from '../utils/opus-encode.js';

/** Short non-verbal filler phrases for latency masking */
export const FILLER_TEXTS: readonly string[] = [
  'Hmm.', 'Yeah.', 'Okay.', 'Uh-huh.', 'Mm-hmm.',
  'Right.', 'Sure.', 'Ahem.', 'Oh.', 'Ah.',
  'Well.', 'So.', 'Mhm.', 'Yep.', 'Got it.',
  'I see.', 'Alright.', 'Huh.', 'Let me think.', 'One moment.',
  'Hmm, let\'s see.', 'OK so.', 'Right, right.', 'Ah yes.', 'Oh, interesting.',
] as const;

export interface CachedFiller {
  text: string;
  audio: Buffer;
  opusFrames: Buffer[];
  sampleRate: number;
}

/**
 * Pre-caches TTS audio for short filler phrases at startup.
 * Fillers can be played immediately after ASR to mask LLM latency.
 */
export class FillerCache {
  private fillers: CachedFiller[] = [];
  private ready = false;

  /** Synthesize all fillers using the given TTS provider. */
  async init(tts: TTSProvider, logger: pino.Logger): Promise<void> {
    logger.info({ count: FILLER_TEXTS.length }, 'Pre-caching filler audio');
    const results = await Promise.allSettled(
      FILLER_TEXTS.map(async (text): Promise<CachedFiller> => {
        const result = await tts.synthesize(text);
        const rate = result.sampleRate as 8000 | 12000 | 16000 | 24000 | 48000;
        const opusFrames = encodeToOpusFrames(result.audio, rate);
        return { text, audio: result.audio, opusFrames, sampleRate: result.sampleRate };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        this.fillers.push(r.value);
      }
    }

    this.ready = true;
    logger.info({ cached: this.fillers.length, failed: FILLER_TEXTS.length - this.fillers.length }, 'Filler cache ready');
  }

  /** Get a random cached filler. Returns undefined if cache isn't ready or is empty. */
  getRandomFiller(): CachedFiller | undefined {
    if (!this.ready || this.fillers.length === 0) return undefined;
    const idx = Math.floor(Math.random() * this.fillers.length);
    return this.fillers[idx];
  }

  /** Get filler by index. */
  getFiller(index: number): CachedFiller | undefined {
    return this.fillers[index];
  }

  /** Get all filler texts (for the settings/audition UI). */
  getTexts(): string[] {
    return this.fillers.map(f => f.text);
  }

  /** Number of cached fillers. */
  get count(): number {
    return this.fillers.length;
  }

  get isReady(): boolean {
    return this.ready;
  }
}

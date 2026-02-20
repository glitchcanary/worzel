import type pino from 'pino';
import type { Session } from '../session/session.js';
import type { Transport } from '../transport/interface.js';
import type { ASRProvider, LLMProvider, TTSProvider, ChatMessage } from '../providers/interface.js';
import { TextSegmenter } from './text-segmenter.js';
import { AudioRateController } from './audio-rate-controller.js';
import { stripThinkTags } from '../utils/sanitize.js';
import { decodeOpusFrames } from '../utils/opus-decode.js';

export interface VoicePipelineOptions {
  asr: ASRProvider;
  llm: LLMProvider;
  tts: TTSProvider;
  logger: pino.Logger;
}

/**
 * Voice pipeline: orchestrates the full audio processing chain.
 *
 * Flow: binary audio frames → ASR → LLM (streaming) → TTS → binary audio frames
 *
 * In WebSocket mode, audio arrives as binary frames on the transport.
 * In WebRTC mode, audio arrives via the RTP audio track (handled by transport layer).
 */
export class VoicePipeline {
  private readonly asr: ASRProvider;
  private readonly llm: LLMProvider;
  private readonly tts: TTSProvider;
  private readonly logger: pino.Logger;
  private audioBuffer: Buffer[] = [];

  constructor(options: VoicePipelineOptions) {
    this.asr = options.asr;
    this.llm = options.llm;
    this.tts = options.tts;
    this.logger = options.logger;
  }

  /** Accumulate an audio chunk (called per binary frame) */
  pushAudio(chunk: Buffer): void {
    this.audioBuffer.push(chunk);
  }

  /**
   * Process accumulated audio through the full pipeline.
   * Called when VAD detects end of speech or manual stop.
   */
  async process(session: Session, transport: Transport): Promise<void> {
    if (this.audioBuffer.length === 0) return;

    // Create abort controller for this processing cycle
    const abortController = new AbortController();
    session.abortController = abortController;

    try {
      // 1. Decode audio to PCM
      const frames = this.audioBuffer;
      this.audioBuffer = [];
      let pcmData: Buffer;

      if (session.audioParams.format === 'opus') {
        // ESP32 clients send raw Opus frames — decode to PCM
        this.logger.info({ frames: frames.length }, 'Decoding Opus frames');
        pcmData = decodeOpusFrames(frames);
      } else {
        // Browser clients send raw PCM — just concatenate
        pcmData = Buffer.concat(frames);
      }

      this.logger.info({ bytes: pcmData.length, format: session.audioParams.format }, 'Processing audio');

      // 2. ASR: audio → text (always PCM at this point)
      const asrResult = await this.asr.transcribe(pcmData, {
        language: 'en',
        format: 'pcm',
        sampleRate: session.audioParams.sample_rate,
      });

      if (!asrResult.text.trim()) {
        this.logger.info('ASR returned empty text, skipping');
        return;
      }

      this.logger.info({ text: asrResult.text }, 'ASR result');

      // Send STT result to client
      await transport.sendText(JSON.stringify({
        type: 'stt',
        text: asrResult.text,
        session_id: session.id,
      }));

      // Add to dialogue
      session.addDialogue('user', asrResult.text);

      // 3. LLM: text → response (streaming)
      const messages: ChatMessage[] = session.getDialogueForLlm() as ChatMessage[];

      // Notify client TTS is starting
      await transport.sendText(JSON.stringify({
        type: 'tts',
        state: 'start',
        session_id: session.id,
      }));

      const segmenter = new TextSegmenter();
      const rateController = new AudioRateController();
      let fullResponse = '';

      for await (const chunk of this.llm.chat(messages, {
        signal: abortController.signal,
      })) {
        if (abortController.signal.aborted) break;

        // Strip think tags from reasoning models
        const cleanText = stripThinkTags(chunk.text);
        if (!cleanText) continue;

        fullResponse += cleanText;

        // 4. Segment text for TTS
        const segments = segmenter.push(cleanText);

        for (const segment of segments) {
          if (abortController.signal.aborted) break;

          // Notify client of sentence
          await transport.sendText(JSON.stringify({
            type: 'tts',
            state: 'sentence_start',
            text: segment,
            session_id: session.id,
          }));

          // 5. TTS: text → audio
          try {
            const ttsResult = await this.tts.synthesize(segment, {
              sampleRate: session.audioParams.sample_rate,
            });

            // Send audio packets with rate control
            const packetSize = 960 * 2; // 960 samples * 2 bytes per sample (16-bit)
            for (let offset = 0; offset < ttsResult.audio.length; offset += packetSize) {
              if (abortController.signal.aborted) break;
              const delay = rateController.getDelay();
              if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
              }
              const packet = ttsResult.audio.subarray(offset, offset + packetSize);
              await transport.sendBinary(packet);
            }
          } catch (err) {
            this.logger.error({ err, segment }, 'TTS error for segment');
          }

          await transport.sendText(JSON.stringify({
            type: 'tts',
            state: 'sentence_end',
            session_id: session.id,
          }));
        }
      }

      // Flush remaining text
      const remaining = segmenter.flush();
      if (remaining && !abortController.signal.aborted) {
        await transport.sendText(JSON.stringify({
          type: 'tts',
          state: 'sentence_start',
          text: remaining,
          session_id: session.id,
        }));

        try {
          const ttsResult = await this.tts.synthesize(remaining);
          await transport.sendBinary(ttsResult.audio);
        } catch (err) {
          this.logger.error({ err }, 'TTS error for final segment');
        }

        await transport.sendText(JSON.stringify({
          type: 'tts',
          state: 'sentence_end',
          session_id: session.id,
        }));
      }

      // Add full response to dialogue
      if (fullResponse) {
        session.addDialogue('assistant', fullResponse);
      }

      // Notify client TTS is done
      await transport.sendText(JSON.stringify({
        type: 'tts',
        state: 'stop',
        session_id: session.id,
      }));

    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.logger.info({ sessionId: session.id }, 'Pipeline aborted');
      } else {
        const error = err instanceof Error ? { message: err.message, stack: err.stack } : err;
        this.logger.error({ error, sessionId: session.id }, 'Pipeline error');
      }
    } finally {
      session.abortController = null;
    }
  }

  /** Clear buffered audio (e.g., on abort) */
  clearAudio(): void {
    this.audioBuffer = [];
  }
}

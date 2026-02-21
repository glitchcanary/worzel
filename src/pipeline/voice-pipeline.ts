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
  llmSmart?: LLMProvider;
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
  private readonly llmSmart?: LLMProvider;
  private readonly logger: pino.Logger;
  private audioBuffer: Buffer[] = [];

  constructor(options: VoicePipelineOptions) {
    this.asr = options.asr;
    this.llm = options.llm;
    this.tts = options.tts;
    this.llmSmart = options.llmSmart;
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
      let segmentIndex = 0;

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

        // Fire TTS for all segments in parallel (prefetch), send audio sequentially
        const ttsPromises = segments.map(seg => this.tts.synthesize(seg).catch(err => {
          this.logger.error({ err, segment: seg }, 'TTS prefetch error');
          return null;
        }));

        for (let i = 0; i < segments.length; i++) {
          if (abortController.signal.aborted) break;
          const segment = segments[i]!;

          this.logger.info({ segmentIndex, text: segment }, 'TTS segment ready');

          // Notify client of sentence
          await transport.sendText(JSON.stringify({
            type: 'tts',
            state: 'sentence_start',
            text: segment,
            session_id: session.id,
          }));

          // 5. TTS: text → audio (may already be resolved from prefetch)
          try {
            const ttsResult = await ttsPromises[i];
            if (!ttsResult) { segmentIndex++; continue; }

            // Reset rate controller for each segment (re-prime the audio buffer)
            rateController.reset();

            // Send audio packets with rate control
            // TTS returns 24kHz PCM; use 1440 samples (60ms at 24kHz) per packet
            const ttsRate = ttsResult.sampleRate || 24000;
            const samplesPerPacket = Math.round(ttsRate * 0.06); // 60ms worth
            const packetSize = samplesPerPacket * 2; // 16-bit = 2 bytes/sample
            let packetsSent = 0;
            for (let offset = 0; offset < ttsResult.audio.length; offset += packetSize) {
              if (abortController.signal.aborted) break;
              const delay = rateController.getDelay();
              if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
              }
              const packet = ttsResult.audio.subarray(offset, offset + packetSize);
              await transport.sendBinary(packet);
              packetsSent++;
            }

            this.logger.info({ segmentIndex, audioBytes: ttsResult.audio.length, packetsSent, sampleRate: ttsRate }, 'TTS audio sent');
          } catch (err) {
            this.logger.error({ err, segment, segmentIndex }, 'TTS error for segment');
          }

          await transport.sendText(JSON.stringify({
            type: 'tts',
            state: 'sentence_end',
            session_id: session.id,
          }));
          segmentIndex++;
        }
      }

      // Flush remaining text
      const remaining = segmenter.flush();
      if (remaining && !abortController.signal.aborted) {
        this.logger.info({ segmentIndex, text: remaining }, 'TTS flush segment');

        await transport.sendText(JSON.stringify({
          type: 'tts',
          state: 'sentence_start',
          text: remaining,
          session_id: session.id,
        }));

        try {
          const ttsResult = await this.tts.synthesize(remaining);

          rateController.reset();
          const flushRate = ttsResult.sampleRate || 24000;
          const flushSamples = Math.round(flushRate * 0.06);
          const flushPacketSize = flushSamples * 2;
          let packetsSent = 0;
          for (let offset = 0; offset < ttsResult.audio.length; offset += flushPacketSize) {
            if (abortController.signal.aborted) break;
            const delay = rateController.getDelay();
            if (delay > 0) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
            const packet = ttsResult.audio.subarray(offset, offset + flushPacketSize);
            await transport.sendBinary(packet);
            packetsSent++;
          }

          this.logger.info({ segmentIndex, audioBytes: ttsResult.audio.length, packetsSent, sampleRate: flushRate }, 'TTS flush audio sent');
        } catch (err) {
          this.logger.error({ err, segmentIndex }, 'TTS error for final segment');
        }

        await transport.sendText(JSON.stringify({
          type: 'tts',
          state: 'sentence_end',
          session_id: session.id,
        }));
      }

      // 6. Smart LLM quality check (if configured)
      if (this.llmSmart && fullResponse && !abortController.signal.aborted) {
        try {
          const correction = await this.runSmartCheck(
            asrResult.text, fullResponse, abortController.signal
          );
          if (correction && !abortController.signal.aborted) {
            this.logger.info({ correction }, 'Smart LLM correction');

            // TTS + send the correction as additional segment
            await transport.sendText(JSON.stringify({
              type: 'tts',
              state: 'sentence_start',
              text: correction,
              session_id: session.id,
            }));

            try {
              const ttsResult = await this.tts.synthesize(correction);
              rateController.reset();
              const corrRate = ttsResult.sampleRate || 24000;
              const corrSamples = Math.round(corrRate * 0.06);
              const corrPacketSize = corrSamples * 2;
              for (let offset = 0; offset < ttsResult.audio.length; offset += corrPacketSize) {
                if (abortController.signal.aborted) break;
                const delay = rateController.getDelay();
                if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
                await transport.sendBinary(ttsResult.audio.subarray(offset, offset + corrPacketSize));
              }
            } catch (err) {
              this.logger.error({ err }, 'TTS error for smart correction');
            }

            await transport.sendText(JSON.stringify({
              type: 'tts',
              state: 'sentence_end',
              session_id: session.id,
            }));

            // Update dialogue with corrected response
            fullResponse += ' ' + correction;
          }
        } catch (err) {
          this.logger.warn({ err }, 'Smart LLM check failed (non-fatal)');
        }
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

  /**
   * Run the smart LLM quality check on the fast model's response.
   * Returns a correction string to speak, or null if the response was fine.
   */
  private async runSmartCheck(
    userText: string,
    fastResponse: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    if (!this.llmSmart) return null;

    const checkPrompt = `You are reviewing a voice assistant's response for accuracy and quality.
The user asked: "${userText}"
The assistant replied: "${fastResponse}"

If the response is accurate and appropriate, reply with exactly "OK" and nothing else.
If it needs correction, reply with ONLY a brief corrective sentence starting with "Actually," or "Well," that the user will hear spoken aloud right after the original response. Keep it under 2 sentences. Do not repeat what was already said correctly.`;

    const messages: ChatMessage[] = [
      { role: 'user', content: checkPrompt },
    ];

    let result = '';
    for await (const chunk of this.llmSmart.chat(messages, { signal })) {
      if (signal.aborted) return null;
      result += chunk.text;
    }

    result = result.trim();
    if (!result || result === 'OK' || result.toLowerCase() === 'ok') return null;

    return result;
  }

  /** Clear buffered audio (e.g., on abort) */
  clearAudio(): void {
    this.audioBuffer = [];
  }
}

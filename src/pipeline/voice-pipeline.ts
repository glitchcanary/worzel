import type pino from 'pino';
import type { Session } from '../session/session.js';
import type { Transport } from '../transport/interface.js';
import type { ASRProvider, LLMProvider, TTSProvider, ChatMessage } from '../providers/interface.js';
import type { FillerCache } from './filler-cache.js';
import { TextSegmenter } from './text-segmenter.js';
import { AudioRateController } from './audio-rate-controller.js';
import { SegmentTracker } from './segment-tracker.js';
import { stripThinkTags } from '../utils/sanitize.js';
import { decodeOpusFrames } from '../utils/opus-decode.js';
import { OpusEncoder } from '../utils/opus-encode.js';

export interface VoicePipelineOptions {
  asr: ASRProvider;
  llm: LLMProvider;
  tts: TTSProvider;
  llmSmart?: LLMProvider;
  fillerCache?: FillerCache;
  logger: pino.Logger;
}

/** Telemetry event emitted via transport during pipeline processing. */
export interface PipelineTelemetryEvent {
  type: 'pipeline_telemetry';
  event: string;
  [key: string]: unknown;
}

/**
 * Voice pipeline: orchestrates the full audio processing chain.
 *
 * Flow: binary audio frames → ASR → filler → LLM (streaming) → TTS → binary audio frames
 *
 * When llmSmart is configured, both LLMs run in parallel. The smart LLM can
 * replace fast LLM segments that haven't started TTS yet, or generate a
 * correction for segments already spoken.
 */
export class VoicePipeline {
  private readonly asr: ASRProvider;
  private readonly llm: LLMProvider;
  private readonly tts: TTSProvider;
  private readonly llmSmart?: LLMProvider;
  private readonly fillerCache?: FillerCache;
  private readonly logger: pino.Logger;
  private audioBuffer: Buffer[] = [];

  constructor(options: VoicePipelineOptions) {
    this.asr = options.asr;
    this.llm = options.llm;
    this.tts = options.tts;
    this.llmSmart = options.llmSmart;
    this.fillerCache = options.fillerCache;
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

    const pipelineStart = Date.now();
    const abortController = new AbortController();
    session.abortController = abortController;

    // Opus encoder for TTS output (24kHz mono, reused across all segments)
    const opusEncoder = new OpusEncoder({ sampleRate: 24000, channels: 1 });

    try {
      // 1. Decode audio to PCM
      const frames = this.audioBuffer;
      this.audioBuffer = [];
      let pcmData: Buffer;

      if (session.audioParams.format === 'opus') {
        this.logger.info({ frames: frames.length }, 'Decoding Opus frames');
        pcmData = decodeOpusFrames(frames);
      } else {
        pcmData = Buffer.concat(frames);
      }

      this.logger.info({ bytes: pcmData.length, format: session.audioParams.format }, 'Processing audio');

      // 2. ASR: audio → text
      const asrStart = Date.now();
      const asrResult = await this.asr.transcribe(pcmData, {
        language: 'en',
        format: 'pcm',
        sampleRate: session.audioParams.sample_rate,
      });
      const asrDuration = Date.now() - asrStart;

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

      // Telemetry: ASR complete
      await this.emitTelemetry(transport, {
        event: 'asr_complete',
        text: asrResult.text,
        duration_ms: asrDuration,
      });

      // Add to dialogue
      session.addDialogue('user', asrResult.text);

      // 3. Play filler to mask LLM latency
      await this.playFiller(transport, session, abortController.signal);

      // 4. LLM: text → response (streaming)
      const messages: ChatMessage[] = session.getDialogueForLlm() as ChatMessage[];

      // Notify client TTS is starting (this creates a new AudioPlayer on the client,
      // interrupting any remaining filler audio)
      await transport.sendText(JSON.stringify({
        type: 'tts',
        state: 'start',
        session_id: session.id,
      }));

      const segmenter = new TextSegmenter();
      const rateController = new AudioRateController();
      const tracker = new SegmentTracker();
      let fullResponse = '';
      let segmentIndex = 0;

      // Start smart LLM in parallel if configured
      let smartPromise: Promise<string> | undefined;
      if (this.llmSmart && !abortController.signal.aborted) {
        smartPromise = this.runSmartParallel(
          messages, tracker, abortController.signal,
        );
      }

      for await (const chunk of this.llm.chat(messages, {
        signal: abortController.signal,
      })) {
        if (abortController.signal.aborted) break;

        const cleanText = stripThinkTags(chunk.text);
        if (!cleanText) continue;

        fullResponse += cleanText;

        // Segment text for TTS
        const segments = segmenter.push(cleanText);

        // Fire TTS for all segments in parallel (prefetch), send audio sequentially
        const ttsPromises = segments.map(seg => this.tts.synthesize(seg).catch(err => {
          this.logger.error({ err, segment: seg }, 'TTS prefetch error');
          return null;
        }));

        for (let i = 0; i < segments.length; i++) {
          if (abortController.signal.aborted) break;
          const segment = segments[i]!;

          // Add to tracker as pending
          const trackIdx = tracker.addFastSegment(segment);

          // Brief yield to let smart LLM replace this segment if it's ready
          // (skip for first segment to minimize latency)
          if (trackIdx > 0) {
            await new Promise(resolve => setTimeout(resolve, 5));
          }

          // Get effective text (may have been replaced by smart LLM)
          const effectiveText = tracker.getEffectiveText(trackIdx) ?? segment;
          const source = tracker.getSource(trackIdx) ?? 'fast';

          // If smart LLM replaced the text, we need different TTS audio
          let ttsPromise = ttsPromises[i]!;
          if (source === 'smart' && effectiveText !== segment) {
            ttsPromise = this.tts.synthesize(effectiveText).catch(err => {
              this.logger.error({ err, segment: effectiveText }, 'TTS error for smart replacement');
              return null;
            });
          }

          tracker.advance(trackIdx, 'tts_started');
          this.logger.info({ segmentIndex, text: effectiveText, source }, 'TTS segment ready');

          // Notify client of sentence
          await transport.sendText(JSON.stringify({
            type: 'tts',
            state: 'sentence_start',
            text: effectiveText,
            session_id: session.id,
          }));

          // Telemetry: segment
          await this.emitTelemetry(transport, {
            event: 'llm_segment',
            text: effectiveText,
            source,
            index: segmentIndex,
          });

          // TTS: text → audio
          try {
            const ttsResult = await ttsPromise;
            if (!ttsResult) {
              tracker.advance(trackIdx, 'committed');
              segmentIndex++;
              continue;
            }

            tracker.advance(trackIdx, 'audio_sent');
            rateController.reset();

            const packetsSent = await this.sendOpusAudio(
              ttsResult.audio, opusEncoder, transport, rateController, abortController.signal,
            );

            tracker.advance(trackIdx, 'committed');
            this.logger.info({ segmentIndex, audioBytes: ttsResult.audio.length, packetsSent, source }, 'TTS audio sent');
          } catch (err) {
            this.logger.error({ err, segment: effectiveText, segmentIndex }, 'TTS error for segment');
            tracker.advance(trackIdx, 'committed');
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
        const trackIdx = tracker.addFastSegment(remaining);

        // Brief yield for smart LLM
        if (trackIdx > 0) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }

        const effectiveText = tracker.getEffectiveText(trackIdx) ?? remaining;
        const source = tracker.getSource(trackIdx) ?? 'fast';
        tracker.advance(trackIdx, 'tts_started');

        this.logger.info({ segmentIndex, text: effectiveText, source }, 'TTS flush segment');

        await transport.sendText(JSON.stringify({
          type: 'tts',
          state: 'sentence_start',
          text: effectiveText,
          session_id: session.id,
        }));

        await this.emitTelemetry(transport, {
          event: 'llm_segment',
          text: effectiveText,
          source,
          index: segmentIndex,
        });

        try {
          const ttsResult = await this.tts.synthesize(effectiveText);
          tracker.advance(trackIdx, 'audio_sent');

          rateController.reset();
          const packetsSent = await this.sendOpusAudio(
            ttsResult.audio, opusEncoder, transport, rateController, abortController.signal,
          );

          tracker.advance(trackIdx, 'committed');
          this.logger.info({ segmentIndex, audioBytes: ttsResult.audio.length, packetsSent, source }, 'TTS flush audio sent');
        } catch (err) {
          this.logger.error({ err, segmentIndex }, 'TTS error for final segment');
          tracker.advance(trackIdx, 'committed');
        }

        await transport.sendText(JSON.stringify({
          type: 'tts',
          state: 'sentence_end',
          session_id: session.id,
        }));
      }

      // 5. Wait for smart LLM to finish (if running) and handle corrections
      if (smartPromise && !abortController.signal.aborted) {
        try {
          const smartResponse = await smartPromise;

          // Check if smart LLM produced a correction for already-committed segments
          if (smartResponse && !abortController.signal.aborted) {
            const correction = this.buildCorrection(
              asrResult.text, fullResponse, smartResponse,
            );

            if (correction) {
              this.logger.info({ correction }, 'Smart LLM correction');

              await this.emitTelemetry(transport, {
                event: 'smart_correction',
                correction,
              });

              await transport.sendText(JSON.stringify({
                type: 'tts',
                state: 'sentence_start',
                text: correction,
                session_id: session.id,
              }));

              try {
                const ttsResult = await this.tts.synthesize(correction);
                rateController.reset();
                await this.sendOpusAudio(
                  ttsResult.audio, opusEncoder, transport, rateController, abortController.signal,
                );
              } catch (err) {
                this.logger.error({ err }, 'TTS error for smart correction');
              }

              await transport.sendText(JSON.stringify({
                type: 'tts',
                state: 'sentence_end',
                session_id: session.id,
              }));

              fullResponse += ' ' + correction;
            }
          }
        } catch (err) {
          this.logger.warn({ err }, 'Smart LLM check failed (non-fatal)');
        }
      }

      // Add full response to dialogue
      if (fullResponse) {
        session.addDialogue('assistant', fullResponse);
      }

      // Telemetry: pipeline complete
      await this.emitTelemetry(transport, {
        event: 'pipeline_complete',
        total_duration_ms: Date.now() - pipelineStart,
        segment_count: tracker.count,
        segments: tracker.getAll().map(s => ({
          text: s.source === 'smart' && s.smartText ? s.smartText : s.fastText,
          source: s.source,
        })),
      });

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
      opusEncoder.delete();
    }
  }

  /**
   * Encode PCM audio to Opus and send frames via transport with rate control.
   */
  private async sendOpusAudio(
    pcmAudio: Buffer,
    encoder: OpusEncoder,
    transport: Transport,
    rateController: AudioRateController,
    signal: AbortSignal,
  ): Promise<number> {
    const opusFrames = encoder.encodeAll(pcmAudio);
    let packetsSent = 0;
    for (const opusPacket of opusFrames) {
      if (signal.aborted) break;
      const delay = rateController.getDelay();
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      await transport.sendBinary(opusPacket);
      packetsSent++;
    }
    return packetsSent;
  }

  /**
   * Play a random filler audio to mask ASR→LLM latency.
   * Sends a full tts:start / audio / tts:stop sequence so the client creates
   * a proper AudioPlayer for it. The subsequent tts:start for the real LLM
   * response will create a new AudioPlayer, interrupting any remaining filler.
   */
  private async playFiller(
    transport: Transport,
    session: Session,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.fillerCache?.isReady || signal.aborted) return;

    const filler = this.fillerCache.getRandomFiller();
    if (!filler) return;

    this.logger.info({ text: filler.text }, 'Playing filler');

    // Full TTS lifecycle so the client creates a proper AudioPlayer
    await transport.sendText(JSON.stringify({
      type: 'tts',
      state: 'start',
      session_id: session.id,
    }));

    await transport.sendText(JSON.stringify({
      type: 'tts',
      state: 'sentence_start',
      text: filler.text,
      session_id: session.id,
    }));

    // Send pre-encoded Opus frames with rate control
    const rateController = new AudioRateController();
    const opusFrames = filler.opusFrames;
    for (const opusPacket of opusFrames) {
      if (signal.aborted) break;
      const delay = rateController.getDelay();
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      await transport.sendBinary(opusPacket);
    }

    await transport.sendText(JSON.stringify({
      type: 'tts',
      state: 'sentence_end',
      session_id: session.id,
    }));

    // Don't send tts:stop — the real LLM response's tts:start will follow,
    // and the client will create a new AudioPlayer which replaces this one.

    await this.emitTelemetry(transport, {
      event: 'filler_played',
      text: filler.text,
    });
  }

  /**
   * Run the smart LLM in parallel with the fast LLM.
   * Streams the smart LLM response and tries to replace pending fast segments
   * in the tracker. Returns the full smart response text.
   */
  private async runSmartParallel(
    messages: ChatMessage[],
    tracker: SegmentTracker,
    signal: AbortSignal,
  ): Promise<string> {
    if (!this.llmSmart) return '';

    const segmenter = new TextSegmenter();
    let fullResponse = '';
    let smartSegmentIndex = 0;

    try {
      for await (const chunk of this.llmSmart.chat(messages, { signal })) {
        if (signal.aborted) return fullResponse;

        const cleanText = stripThinkTags(chunk.text);
        if (!cleanText) continue;

        fullResponse += cleanText;

        const segments = segmenter.push(cleanText);
        for (const seg of segments) {
          // Try to replace the corresponding fast segment
          tracker.tryReplace(smartSegmentIndex, seg);
          smartSegmentIndex++;
        }
      }

      // Flush remaining
      const remaining = segmenter.flush();
      if (remaining) {
        tracker.tryReplace(smartSegmentIndex, remaining);
        fullResponse += ''; // already accumulated
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        this.logger.warn({ err }, 'Smart LLM parallel run failed (non-fatal)');
      }
    }

    return fullResponse;
  }

  /**
   * Build a correction sentence if the smart LLM response meaningfully differs
   * from the fast response that was already spoken.
   */
  private buildCorrection(
    _userText: string,
    fastResponse: string,
    smartResponse: string,
  ): string | null {
    // Simple heuristic: if the smart response is very similar to the fast one, no correction
    const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
    if (normalize(fastResponse) === normalize(smartResponse)) return null;

    // Check if the smart response looks like it's just "OK" (no correction needed)
    const trimmed = smartResponse.trim();
    if (!trimmed || trimmed === 'OK' || trimmed.toLowerCase() === 'ok') return null;

    // If the responses differ substantially, the correction is derived from
    // the smart response. In a real scenario we'd want the smart LLM to
    // produce an explicit correction phrase. For now, return a brief addendum.
    // Only correct if responses are meaningfully different (> 30% different words)
    const fastWords = new Set(normalize(fastResponse).split(/\s+/));
    const smartWords = normalize(smartResponse).split(/\s+/);
    const overlap = smartWords.filter(w => fastWords.has(w)).length;
    const similarity = overlap / Math.max(smartWords.length, 1);

    if (similarity > 0.7) return null; // Close enough, no correction

    // Build a spoken correction prefix
    return `Actually, ${smartResponse}`;
  }

  /** Emit a telemetry event (Worzel extension, not xiaozhi protocol). */
  private async emitTelemetry(
    transport: Transport,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await transport.sendText(JSON.stringify({
        type: 'pipeline_telemetry',
        ...data,
      }));
    } catch {
      // Non-fatal — telemetry should never break the pipeline
    }
  }

  /** Clear buffered audio (e.g., on abort) */
  clearAudio(): void {
    this.audioBuffer = [];
  }
}

/**
 * InkPipeline — Ink-aware voice pipeline for Fink.
 *
 * Replaces the normal ASR→LLM→TTS flow with:
 *   ASR → InkRouter.classify() → [choice|discussion|meta|freeform|no_match] → TTS
 *
 * Each classification mode produces text differently:
 * - choice_match:   Advance story via InkSession.choose(), narrate result
 * - discussion:     LLM responds in-character using InkPromptBuilder
 * - meta_query:     LLM describes choices naturally
 * - freeform_input: Pass raw text to story variable, continue
 * - no_match:       LLM gently redirects toward choices
 */

import type pino from 'pino';
import type { Transport } from '../transport/interface.js';
import type { ASRProvider, LLMProvider, TTSProvider, ChatMessage } from '../providers/interface.js';
import type { Session } from '../session/session.js';
import { InkSession } from '../ink/ink-session.js';
import type { NarrationSegment, InkChoice } from '../ink/ink-session.js';
import { InkRouter } from '../ink/ink-router.js';
import type { Classification } from '../ink/ink-router.js';
import { buildDiscussionPrompt, buildMetaPrompt, buildNoMatchPrompt } from '../ink/ink-prompt-builder.js';
import type { PromptContext } from '../ink/ink-prompt-builder.js';
import { decodeOpusFrames } from '../utils/opus-decode.js';
import { OpusEncoder } from '../utils/opus-encode.js';
import { resamplePcm } from '../utils/resample.js';
import { stripThinkTags } from '../utils/sanitize.js';
import { TextSegmenter } from '../pipeline/text-segmenter.js';
import { AudioRateController } from '../pipeline/audio-rate-controller.js';

/** Parent story state saved before a FINK link switch. */
export interface ParentStoryState {
  storyId: string;
  serializedState: string;
}

/** Callback for when a choice with a FINK: link is selected by voice. */
export type FinkLinkHandler = (
  storyId: string, session: Session, transport: Transport,
  parentState: ParentStoryState,
) => Promise<InkSession | null>;

/** Callback for when a story ends — returns parent session if available. */
export type StoryEndedHandler = (
  session: Session, transport: Transport,
) => Promise<{ inkSession: InkSession; narration: NarrationSegment[]; choices: InkChoice[] } | null>;

export interface InkPipelineOptions {
  asr: ASRProvider;
  llm: LLMProvider;
  tts: TTSProvider;
  logger: pino.Logger;
  voiceAliases?: Record<string, string>;
  choiceVoice?: string;
  onFinkLink?: FinkLinkHandler;
  onStoryEnded?: StoryEndedHandler;
}

export class InkPipeline {
  private readonly asr: ASRProvider;
  private readonly llm: LLMProvider;
  private readonly tts: TTSProvider;
  private readonly logger: pino.Logger;
  private readonly router: InkRouter;
  private readonly voiceAliases: Map<string, string>;
  private readonly choiceVoice: string;
  private readonly onFinkLink?: FinkLinkHandler;
  private readonly onStoryEnded?: StoryEndedHandler;
  private audioBuffer: Buffer[] = [];

  /** Track consecutive no_match results to auto-read choices */
  private noMatchCount = 0;

  constructor(options: InkPipelineOptions) {
    this.asr = options.asr;
    this.llm = options.llm;
    this.tts = options.tts;
    this.logger = options.logger;
    this.router = new InkRouter({ llm: options.llm });
    this.voiceAliases = new Map(
      Object.entries(options.voiceAliases ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    );
    this.choiceVoice = options.choiceVoice ?? 'nova';
    this.onFinkLink = options.onFinkLink;
    this.onStoryEnded = options.onStoryEnded;
  }

  pushAudio(chunk: Buffer): void {
    this.audioBuffer.push(chunk);
  }

  clearAudio(): void {
    this.audioBuffer = [];
  }

  /**
   * Process accumulated audio through the Ink-aware pipeline.
   */
  async process(
    session: Session,
    transport: Transport,
    inkSession: InkSession,
  ): Promise<void> {
    if (this.audioBuffer.length === 0) return;

    const abortController = new AbortController();
    session.abortController = abortController;
    const opusEncoder = new OpusEncoder({ sampleRate: 16000, channels: 1 });

    try {
      // 0. Skip ASR if client reports very low audio energy (likely silence/ambient)
      const audioLevel = session.lastAudioLevel;
      if (audioLevel !== undefined && audioLevel < 0.01) {
        this.logger.info({ audioLevel }, 'Audio level below threshold, skipping ASR');
        this.audioBuffer = [];
        return;
      }

      // 1. Decode audio
      const frames = this.audioBuffer;
      this.audioBuffer = [];
      const pcmData = session.audioParams.format === 'opus'
        ? decodeOpusFrames(frames)
        : Buffer.concat(frames);

      // 2. ASR
      const asrResult = await this.asr.transcribe(pcmData, {
        language: 'en',
        format: 'pcm',
        sampleRate: session.audioParams.sample_rate,
      });

      if (!asrResult.text.trim()) {
        this.logger.info('ASR returned empty text, skipping');
        return;
      }

      const asrText = asrResult.text.trim();
      this.logger.info({ text: asrText, audioLevel }, 'ASR result');

      // Record user utterance in dialogue history
      session.addDialogue('user', asrText);

      // Send STT to client
      await transport.sendText(JSON.stringify({
        type: 'stt', text: asrText, session_id: session.id,
      }));

      // 3. Classify via InkRouter
      const state = inkSession.getState();
      const classification = await this.router.classify(
        asrText, state, abortController.signal,
      );
      this.logger.info({
        type: classification.type,
        choiceIndex: classification.choiceIndex,
        confidence: classification.confidence,
      }, 'Classification result');

      // 4. Act on classification
      switch (classification.type) {
        case 'choice_match':
          this.noMatchCount = 0;
          await this.handleChoice(
            session, transport, inkSession, opusEncoder,
            classification, abortController.signal,
          );
          break;

        case 'freeform_input':
          this.noMatchCount = 0;
          await this.handleFreeformInput(
            session, transport, inkSession, opusEncoder,
            asrText, abortController.signal,
          );
          break;

        case 'discussion':
          this.noMatchCount = 0;
          await this.handleLlmResponse(
            session, transport, inkSession, opusEncoder,
            asrText, 'discussion', abortController.signal,
          );
          break;

        case 'meta_query':
          this.noMatchCount = 0;
          await this.handleLlmResponse(
            session, transport, inkSession, opusEncoder,
            asrText, 'meta', abortController.signal,
          );
          break;

        case 'skip_ahead':
          this.noMatchCount = 0;
          await this.handleSkipAhead(
            session, transport, inkSession, opusEncoder, abortController.signal,
          );
          break;

        case 'no_match':
          this.noMatchCount++;
          await this.handleLlmResponse(
            session, transport, inkSession, opusEncoder,
            asrText, 'no_match', abortController.signal,
          );
          // Read the real choices after the creative refusal
          if (!abortController.signal.aborted) {
            const noMatchState = inkSession.getState();
            if (noMatchState.choices.length > 0) {
              await this.readChoicesAloud(
                session, transport, opusEncoder,
                noMatchState.choices, abortController.signal,
              );
            }
          }
          break;
      }

    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.logger.info({ sessionId: session.id }, 'Pipeline aborted');
      } else {
        this.logger.error({ err, sessionId: session.id }, 'Ink pipeline error');
      }
    }
  }

  /**
   * Narrate story segments + read choices aloud.
   * Used for the initial opening after hello handshake.
   */
  async narrateAndReadChoices(
    session: Session,
    transport: Transport,
    narration: NarrationSegment[],
    choices: InkChoice[],
  ): Promise<void> {
    const opusEncoder = new OpusEncoder({ sampleRate: 16000, channels: 1 });
    const abortController = new AbortController();
    session.abortController = abortController;

    if (narration.length > 0) {
      await this.narrateSegments(
        session, transport, opusEncoder, narration, abortController.signal,
      );
    }

    if (choices.length > 0 && !abortController.signal.aborted) {
      await this.readChoicesAloud(
        session, transport, opusEncoder, choices, abortController.signal,
      );
    }
  }

  /**
   * Handle a direct choice selection (from UI tap, not voice).
   * Public method for use by the server when the client sends ink:choose.
   */
  async processDirectChoice(
    session: Session,
    transport: Transport,
    inkSession: InkSession,
    choiceIndex: number,
  ): Promise<void> {
    const opusEncoder = new OpusEncoder({ sampleRate: 16000, channels: 1 });
    const abortController = new AbortController();
    session.abortController = abortController;

    try {
      await this.handleChoice(
        session, transport, inkSession, opusEncoder,
        { type: 'choice_match', choiceIndex, confidence: 1.0 },
        abortController.signal,
      );
    } catch (err) {
      this.logger.error({ err, choiceIndex }, 'Direct choice error');
    }
  }

  /** TTS speed multiplier — configurable per-session via fink_settings. */
  ttsSpeed = 1.15;

  private resolveVoice(voice?: string): string | undefined {
    if (!voice) return undefined;
    return this.voiceAliases.get(voice.toLowerCase()) ?? voice;
  }

  /**
   * Handle a matched choice: advance the story and narrate the result.
   */
  private async handleChoice(
    session: Session,
    transport: Transport,
    inkSession: InkSession,
    opusEncoder: OpusEncoder,
    classification: Classification,
    signal: AbortSignal,
  ): Promise<void> {
    const choiceIndex = classification.choiceIndex!;
    this.logger.info({ choiceIndex }, 'Advancing story');

    // Save state before any potential FINK link switch (for parent story stack)
    const parentState: ParentStoryState = {
      storyId: inkSession.storyId,
      serializedState: inkSession.serialize(),
    };

    // Check for FINK: link before advancing
    const choices = inkSession.getChoices();
    const selected = choices.find(c => c.index === choiceIndex);
    if (selected?.tags.finkLink && this.onFinkLink) {
      const newSession = await this.onFinkLink(
        selected.tags.finkLink, session, transport, parentState,
      );
      if (newSession) return; // Story switch handled by callback
      // FINK link failed — don't advance the story (choice may lead to -> END or stub).
      // Stay at the current story position and tell the user.
      this.logger.warn({ finkLink: selected.tags.finkLink }, 'FINK: link failed, staying at current position');
      await this.speakText(
        session, transport, opusEncoder,
        'Sorry, that story could not be loaded right now.', signal,
      );
      // Re-read the current choices so the user knows where they are
      const currentState = inkSession.getState();
      if (currentState.choices.length > 0 && !signal.aborted) {
        await this.readChoicesAloud(
          session, transport, opusEncoder, currentState.choices, signal,
        );
      }
      return;
    }

    const result = inkSession.choose(choiceIndex);

    // Check narration-level FINK: tags (toc.fink.js puts # FINK: on knot lines)
    if (this.onFinkLink) {
      for (const seg of result.narration) {
        if (seg.tags.finkLink) {
          this.logger.info({ finkLink: seg.tags.finkLink }, 'FINK: link in narration tag');
          const newSession = await this.onFinkLink(
            seg.tags.finkLink, session, transport, parentState,
          );
          if (newSession) return; // Story switch handled by callback
          // Narration-level FINK link failed — story already advanced, narrate what we have
          // but warn the user about the broken link
          this.logger.warn({ finkLink: seg.tags.finkLink }, 'FINK: narration link failed');
        }
      }
    }

    // Record story output in dialogue history
    const narrationText = result.narration.map(n => n.text).join('\n');
    const newState = inkSession.getState();
    const choicesText = newState.choices.length > 0
      ? '\n\nAvailable options: ' + newState.choices.map(c => c.text).join(', ')
      : '';
    if (narrationText) {
      session.addDialogue('assistant', `[Story] ${narrationText}${choicesText}`);
    }

    // Send ink_state to client (narration + new choices)
    await this.sendInkState(transport, session, inkSession, result.narration);

    // Narrate the story text via TTS (multi-voice)
    if (result.narration.length > 0) {
      await this.narrateSegments(
        session, transport, opusEncoder, result.narration, signal,
      );
    }

    // Read choices aloud in a different voice
    const state = inkSession.getState();
    if (state.choices.length > 0 && !signal.aborted) {
      await this.readChoicesAloud(
        session, transport, opusEncoder, state.choices, signal,
      );
    }

    // If story ended, try returning to parent story
    if (inkSession.isEnded) {
      if (this.onStoryEnded) {
        const parent = await this.onStoryEnded(session, transport);
        if (parent) {
          // Brief transition, then read parent's choices (don't re-narrate — user already heard it)
          this.logger.info({ storyId: parent.inkSession.storyId }, 'Returned to parent story');
          if (!signal.aborted) {
            await this.speakText(
              session, transport, opusEncoder,
              'You find yourself back where you were.', signal,
            );
          }
          if (parent.choices.length > 0 && !signal.aborted) {
            await this.readChoicesAloud(
              session, transport, opusEncoder, parent.choices, signal,
            );
          }
          return;
        }
      }
      await this.speakText(
        session, transport, opusEncoder,
        'The story has come to an end.', signal,
      );
    }
  }

  /**
   * Handle freeform input: set the story variable and continue.
   */
  private async handleFreeformInput(
    session: Session,
    transport: Transport,
    inkSession: InkSession,
    opusEncoder: OpusEncoder,
    asrText: string,
    signal: AbortSignal,
  ): Promise<void> {
    this.logger.info({ text: asrText }, 'Freeform input');

    // Set the freeform response variable and continue
    inkSession.setVariable('freeform_response', asrText);
    const result = inkSession.continue();

    await this.sendInkState(transport, session, inkSession, result.narration);

    if (result.narration.length > 0) {
      await this.narrateSegments(
        session, transport, opusEncoder, result.narration, signal,
      );
    }
  }

  /**
   * Handle skip/interrupt: speak a brief numbered choice list.
   * No LLM call — just a quick list of choice names.
   */
  private async handleSkipAhead(
    session: Session,
    transport: Transport,
    inkSession: InkSession,
    opusEncoder: OpusEncoder,
    signal: AbortSignal,
  ): Promise<void> {
    const state = inkSession.getState();

    if (state.choices.length === 0) {
      await this.speakText(
        session, transport, opusEncoder,
        'There are no choices right now.', signal,
      );
      return;
    }

    // Brief numbered format — terse, no preamble
    let briefText: string;
    if (state.choices.length === 1) {
      briefText = `Your option is: ${state.choices[0]!.text}.`;
    } else {
      const names = state.choices.map((c, i) => `${i + 1}, ${c.text}`);
      briefText = `Your options: ${names.join('. ')}.`;
    }

    await this.speakText(session, transport, opusEncoder, briefText, signal);
    session.addDialogue('assistant', `[Skip] ${briefText}`);
  }

  /**
   * Handle discussion, meta, or no_match via LLM.
   */
  private async handleLlmResponse(
    session: Session,
    transport: Transport,
    inkSession: InkSession,
    opusEncoder: OpusEncoder,
    asrText: string,
    mode: 'discussion' | 'meta' | 'no_match',
    signal: AbortSignal,
  ): Promise<void> {
    const state = inkSession.getState();
    const ctx: PromptContext = {
      asrText,
      narration: state.narration,
      choices: state.choices,
      variables: state.variables,
      characters: inkSession.getAllCharacters(),
      currentSpeaker: undefined,
    };

    let systemPrompt: string;
    switch (mode) {
      case 'discussion':
        systemPrompt = buildDiscussionPrompt(ctx);
        break;
      case 'meta':
        systemPrompt = buildMetaPrompt(ctx);
        break;
      case 'no_match':
        systemPrompt = buildNoMatchPrompt(ctx);
        break;
    }

    // Build messages with dialogue history for conversational continuity
    const history = session.getDialogueForLlm(10);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      // Include recent dialogue (excluding the current utterance which is last)
      ...history.slice(0, -1).map(d => ({
        role: d.role as 'user' | 'assistant',
        content: d.content,
      })),
      { role: 'user', content: asrText },
    ];

    // Stream LLM response → TTS
    await transport.sendText(JSON.stringify({
      type: 'tts', state: 'start', session_id: session.id,
    }));

    const segmenter = new TextSegmenter();
    const rateController = new AudioRateController();
    let fullResponse = '';

    for await (const chunk of this.llm.chat(messages, { signal })) {
      if (signal.aborted) break;
      const cleanText = stripThinkTags(chunk.text);
      if (!cleanText) continue;
      fullResponse += cleanText;

      const segments = segmenter.push(cleanText);
      for (const seg of segments) {
        if (signal.aborted) break;
        await this.speakSegment(session, transport, opusEncoder, rateController, seg, signal);
      }
    }

    // Flush remaining
    const remaining = segmenter.flush();
    if (remaining && !signal.aborted) {
      await this.speakSegment(session, transport, opusEncoder, rateController, remaining, signal);
    }

    if (fullResponse) {
      session.addDialogue('assistant', fullResponse);
    }

    await transport.sendText(JSON.stringify({
      type: 'tts', state: 'stop', session_id: session.id,
    }));
  }

  /**
   * Narrate story segments with per-speaker voice routing.
   */
  private async narrateSegments(
    session: Session,
    transport: Transport,
    opusEncoder: OpusEncoder,
    segments: NarrationSegment[],
    signal: AbortSignal,
  ): Promise<void> {
    await transport.sendText(JSON.stringify({
      type: 'tts', state: 'start', session_id: session.id,
    }));

    const rateController = new AudioRateController();

    for (const seg of segments) {
      if (signal.aborted) break;
      if (!seg.text) continue; // Skip tag-only segments (no text to speak)

      await transport.sendText(JSON.stringify({
        type: 'tts', state: 'sentence_start',
        text: seg.text, speaker: seg.speaker,
        session_id: session.id,
      }));

      try {
        const ttsResult = await this.tts.synthesize(seg.text, {
          voice: this.resolveVoice(seg.voice),
          speed: this.ttsSpeed,
        });

        rateController.reset();
        await this.sendOpusAudio(
          ttsResult.audio, opusEncoder, transport, rateController, signal,
          ttsResult.sampleRate,
        );
      } catch (err) {
        this.logger.error({ err: err instanceof Error ? err.message : String(err), text: seg.text }, 'TTS error for narration segment');
      }

      await transport.sendText(JSON.stringify({
        type: 'tts', state: 'sentence_end', session_id: session.id,
      }));
    }

    await transport.sendText(JSON.stringify({
      type: 'tts', state: 'stop', session_id: session.id,
    }));
  }

  /**
   * Read the available choices aloud in a distinct voice.
   */
  private async readChoicesAloud(
    session: Session,
    transport: Transport,
    opusEncoder: OpusEncoder,
    choices: InkChoice[],
    signal: AbortSignal,
  ): Promise<void> {
    if (choices.length === 0) return;

    const rateController = new AudioRateController();

    // Build a natural sentence listing the choices
    let choiceText: string;
    if (choices.length === 1) {
      choiceText = `You can: ${choices[0]!.text}.`;
    } else {
      const items = choices.map(c => c.text);
      const last = items.pop()!;
      choiceText = `You can: ${items.join(', ')}, or ${last}.`;
    }

    await transport.sendText(JSON.stringify({
      type: 'tts', state: 'sentence_start',
      text: choiceText, speaker: 'choices',
      session_id: session.id,
    }));

    try {
      const ttsResult = await this.tts.synthesize(choiceText, {
        voice: this.resolveVoice(this.choiceVoice),
        speed: this.ttsSpeed,
      });
      rateController.reset();
      await this.sendOpusAudio(
        ttsResult.audio, opusEncoder, transport, rateController, signal,
        ttsResult.sampleRate,
      );
    } catch (err) {
      this.logger.error({ err: err instanceof Error ? err.message : String(err) }, 'TTS error reading choices');
    }

    await transport.sendText(JSON.stringify({
      type: 'tts', state: 'sentence_end', session_id: session.id,
    }));
  }

  /**
   * Speak a single text segment (for LLM streaming output).
   */
  private async speakSegment(
    session: Session,
    transport: Transport,
    opusEncoder: OpusEncoder,
    rateController: AudioRateController,
    text: string,
    signal: AbortSignal,
  ): Promise<void> {
    await transport.sendText(JSON.stringify({
      type: 'tts', state: 'sentence_start',
      text, session_id: session.id,
    }));

    try {
      const ttsResult = await this.tts.synthesize(text, { speed: this.ttsSpeed });
      rateController.reset();
      await this.sendOpusAudio(
        ttsResult.audio, opusEncoder, transport, rateController, signal,
        ttsResult.sampleRate,
      );
    } catch (err) {
      this.logger.error({ err: err instanceof Error ? err.message : String(err), text }, 'TTS error for segment');
    }

    await transport.sendText(JSON.stringify({
      type: 'tts', state: 'sentence_end', session_id: session.id,
    }));
  }

  /**
   * Speak a single text string (not segmented).
   */
  private async speakText(
    session: Session,
    transport: Transport,
    opusEncoder: OpusEncoder,
    text: string,
    signal: AbortSignal,
  ): Promise<void> {
    const rateController = new AudioRateController();
    await transport.sendText(JSON.stringify({
      type: 'tts', state: 'start', session_id: session.id,
    }));

    await this.speakSegment(session, transport, opusEncoder, rateController, text, signal);

    await transport.sendText(JSON.stringify({
      type: 'tts', state: 'stop', session_id: session.id,
    }));
  }

  /**
   * Send ink_state message to client with current story state.
   */
  private async sendInkState(
    transport: Transport,
    session: Session,
    inkSession: InkSession,
    narration: NarrationSegment[],
  ): Promise<void> {
    const state = inkSession.getState();
    this.logger.info({
      storyId: state.storyId,
      choiceCount: state.choices.length,
      choices: state.choices.map(c => c.text),
      narrationCount: narration.length,
      isEnded: state.isEnded,
    }, 'Sending ink_state');
    await transport.sendText(JSON.stringify({
      type: 'ink_state',
      session_id: session.id,
      narration: narration.map(n => ({
        text: n.text,
        speaker: n.speaker,
        voice: n.voice,
        mood: n.mood,
        ...(n.tags.image ? { image: n.tags.image } : {}),
      })),
      choices: state.choices.map(c => ({
        index: c.index,
        text: c.text,
      })),
      isEnded: state.isEnded,
      turnCount: state.turnCount,
      storyId: state.storyId,
    }));
  }

  /**
   * Encode PCM to Opus and send frames with rate control.
   */
  private async sendOpusAudio(
    pcmAudio: Buffer,
    encoder: OpusEncoder,
    transport: Transport,
    rateController: AudioRateController,
    signal: AbortSignal,
    srcSampleRate?: number,
  ): Promise<number> {
    const pcm = srcSampleRate
      ? resamplePcm(pcmAudio, srcSampleRate, encoder.sampleRate)
      : pcmAudio;
    const opusFrames = encoder.encodeAll(pcm);
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
}

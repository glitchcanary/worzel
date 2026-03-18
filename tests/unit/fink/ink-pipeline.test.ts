import { describe, it, expect } from 'vitest';
import { InkPipeline } from '../../../src/fink/ink-pipeline.js';
import { InkSession } from '../../../src/ink/ink-session.js';
import { Session } from '../../../src/session/session.js';
import { createLogger } from '../../../src/utils/logger.js';
import type { Transport } from '../../../src/transport/interface.js';
import type { ASRProvider, ASRResult, LLMProvider, LLMChunk, TTSProvider, TTSResult, ChatMessage } from '../../../src/providers/interface.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as inkjs from 'inkjs/full';
import { extractInkFromFinkJs } from '../../../src/ink/fink-js-extractor.js';

// --- Mock providers ---

class MockASR implements ASRProvider {
  readonly name = 'mock-asr';
  transcribeResponse = 'open the gate';

  async transcribe(): Promise<ASRResult> {
    return { text: this.transcribeResponse };
  }
}

class MockLLM implements LLMProvider {
  readonly name = 'mock-llm';
  chatResponse = 'Perhaps you could try the gate, or speak with someone nearby.';

  async *chat(_messages: ChatMessage[]): AsyncIterable<LLMChunk> {
    yield { text: this.chatResponse, done: true };
  }
}

class MockTTS implements TTSProvider {
  readonly name = 'mock-tts';
  readonly provider = 'mock-tts';
  synthesizeCalls: { text: string; voice?: string }[] = [];

  async synthesize(text: string, options?: { voice?: string }): Promise<TTSResult> {
    this.synthesizeCalls.push({ text, voice: options?.voice });
    return {
      audio: Buffer.alloc(1920),
      sampleRate: 16000,
      format: 'pcm',
    };
  }
}

class MockFallbackTTS extends MockTTS {
  override readonly name = 'mock-fallback-tts';
  override readonly provider = 'mock-fallback-tts';
}

class MockTransport implements Transport {
  readonly id = 'mock-transport';
  readonly type = 'websocket' as const;
  connected = true;
  sentText: string[] = [];
  sentBinary: Buffer[] = [];

  async sendText(data: string): Promise<void> {
    this.sentText.push(data);
  }
  async sendBinary(data: Buffer | Uint8Array): Promise<void> {
    this.sentBinary.push(Buffer.from(data));
  }
  close(): void { this.connected = false; }
  onText(): void {}
  onBinary(): void {}
  onClose(): void {}
  onError(): void {}

  /** Get parsed JSON messages of a specific type */
  getMessages(type: string): Record<string, unknown>[] {
    return this.sentText
      .map(s => { try { return JSON.parse(s); } catch { return null; } })
      .filter((m): m is Record<string, unknown> => m !== null && m.type === type);
  }
}

// Load test story
const storyFinkPath = join(import.meta.dirname, '../../../stories/test-garden/story.fink.js');
const storyFink = readFileSync(storyFinkPath, 'utf-8');
const storySource = await extractInkFromFinkJs(storyFink);
const storyJson = new inkjs.Compiler(storySource).Compile().ToJson();

function createTestSetup() {
  const asr = new MockASR();
  const llm = new MockLLM();
  const tts = new MockTTS();
  const logger = createLogger('silent');
  const pipeline = new InkPipeline({ asr, llm, tts, logger });
  const session = new Session('test-device');
  session.state = 'ready';
  session.audioParams = { format: 'pcm', sample_rate: 16000, channels: 1, frame_duration: 60 };
  const transport = new MockTransport();
  const inkSession = new InkSession('test-garden', storyJson);
  // Start the story
  inkSession.continue();

  return { asr, llm, tts, pipeline, session, transport, inkSession };
}

function createTestSetupWithFallback() {
  const asr = new MockASR();
  const llm = new MockLLM();
  const tts = new MockTTS();
  const ttsFallback = new MockFallbackTTS();
  const logger = createLogger('silent');
  const pipeline = new InkPipeline({ asr, llm, tts, ttsFallback, logger });
  const session = new Session('test-device');
  session.state = 'ready';
  session.audioParams = { format: 'pcm', sample_rate: 16000, channels: 1, frame_duration: 60 };
  const transport = new MockTransport();
  const inkSession = new InkSession('test-garden', storyJson);
  inkSession.continue();

  return { asr, llm, tts, ttsFallback, pipeline, session, transport, inkSession };
}

describe('InkPipeline', () => {
  describe('processDirectChoice', () => {
    it('advances the story and sends ink_state + TTS', async () => {
      const { pipeline, session, transport, inkSession } = createTestSetup();

      // The story should start with choices
      const state = inkSession.getState();
      expect(state.choices.length).toBeGreaterThan(0);

      // Pick the first choice
      await pipeline.processDirectChoice(session, transport, inkSession, 0);

      // Should have sent ink_state
      const inkStates = transport.getMessages('ink_state');
      expect(inkStates.length).toBe(1);
      expect(inkStates[0]!['storyId']).toBe('test-garden');

      // Should have sent TTS messages
      const ttsMessages = transport.getMessages('tts');
      const starts = ttsMessages.filter(m => m.state === 'start');
      const stops = ttsMessages.filter(m => m.state === 'stop');
      expect(starts.length).toBeGreaterThan(0);
      expect(stops.length).toBeGreaterThan(0);
    });
  });

  describe('process (voice pipeline)', () => {
    it('classifies exact choice match and advances story', async () => {
      const { asr, tts, pipeline, session, transport, inkSession } = createTestSetup();

      // Get the text of the first choice
      const choices = inkSession.getState().choices;
      expect(choices.length).toBeGreaterThan(0);
      const choiceText = choices[0]!.text;

      // Set ASR to return the exact choice text
      asr.transcribeResponse = choiceText;

      // Push some fake audio
      pipeline.pushAudio(Buffer.alloc(3200)); // 100ms of 16-bit mono 16kHz

      await pipeline.process(session, transport, inkSession);

      // Should have sent stt message
      const sttMessages = transport.getMessages('stt');
      expect(sttMessages.length).toBe(1);
      expect(sttMessages[0]!['text']).toBe(choiceText);

      // Should have sent ink_state with new narration
      const inkStates = transport.getMessages('ink_state');
      expect(inkStates.length).toBe(1);

      // Should have done TTS
      expect(tts.synthesizeCalls.length).toBeGreaterThan(0);
      expect(session.recentSpokenOutput.length).toBeGreaterThan(0);
    });

    it('classifies meta query and uses LLM', async () => {
      const { asr, llm, tts, pipeline, session, transport, inkSession } = createTestSetup();

      asr.transcribeResponse = 'what are my options';
      llm.chatResponse = 'You could try opening the gate or turning back.';

      pipeline.pushAudio(Buffer.alloc(3200));
      await pipeline.process(session, transport, inkSession);

      // Should have used LLM (TTS should have the LLM response text)
      expect(tts.synthesizeCalls.some(c =>
        c.text.includes('opening the gate') || c.text.includes('turning back')
      )).toBe(true);

      // Should NOT have sent ink_state (no story advancement)
      const inkStates = transport.getMessages('ink_state');
      expect(inkStates.length).toBe(0);
    });

    it('classifies no_match and uses LLM for redirect', async () => {
      const { asr, llm, tts, pipeline, session, transport, inkSession } = createTestSetup();

      asr.transcribeResponse = 'I like pizza';
      llm.chatResponse = 'Interesting thought! But perhaps focus on what lies ahead.';

      pipeline.pushAudio(Buffer.alloc(3200));
      await pipeline.process(session, transport, inkSession);

      // Should have used LLM for gentle redirect
      expect(tts.synthesizeCalls.length).toBeGreaterThan(0);

      // Should NOT have advanced story
      const inkStates = transport.getMessages('ink_state');
      expect(inkStates.length).toBe(0);
    });

    it('ignores acknowledgment junk before classification', async () => {
      const { asr, tts, pipeline, session, transport, inkSession } = createTestSetup();

      asr.transcribeResponse = 'Thank you.';

      pipeline.pushAudio(Buffer.alloc(3200));
      await pipeline.process(session, transport, inkSession);

      expect(transport.getMessages('stt').length).toBe(0);
      expect(transport.getMessages('ink_state').length).toBe(0);
      expect(transport.getMessages('input_ignored')).toEqual([
        expect.objectContaining({ reason: 'ack_junk' }),
      ]);
      expect(tts.synthesizeCalls.length).toBe(0);
    });

    it('does not ignore short meaningful choices like yes and no', async () => {
      const { asr, tts, pipeline, session, transport, inkSession } = createTestSetup();

      asr.transcribeResponse = 'Yes.';

      pipeline.pushAudio(Buffer.alloc(3200));
      await pipeline.process(session, transport, inkSession);

      expect(transport.getMessages('stt').length).toBe(1);
      expect(transport.getMessages('input_ignored').length).toBe(0);
      expect(tts.synthesizeCalls.length).toBeGreaterThan(0);
    });

    it('routes volatile no-match speech to fallback TTS first', async () => {
      const { asr, tts, ttsFallback, pipeline, session, transport, inkSession } = createTestSetupWithFallback();

      asr.transcribeResponse = 'I like pizza';

      pipeline.pushAudio(Buffer.alloc(3200));
      await pipeline.process(session, transport, inkSession);

      expect(ttsFallback.synthesizeCalls.length).toBeGreaterThan(0);
      expect(tts.synthesizeCalls.length).toBe(0);
      expect(transport.getMessages('ink_state').length).toBe(0);
    });

    it('ignores short no-match fragments that overlap recent spoken output', async () => {
      const { asr, tts, pipeline, session, transport, inkSession } = createTestSetup();

      const now = Date.now();
      session.addSpokenOutput({
        text: 'The note says it might be worth it though, if you are brave.',
        provider: 'mock-tts',
        cacheScope: 'persistent',
        startedAt: now - 400,
        estimatedDurationMs: 2_000,
      });
      session.startRecordingWindow(now - 200);
      session.finishRecordingWindow(now + 100, 0.08);
      asr.transcribeResponse = 'worth it though';

      pipeline.pushAudio(Buffer.alloc(3200));
      await pipeline.process(session, transport, inkSession);

      expect(transport.getMessages('input_ignored')).toEqual([
        expect.objectContaining({ reason: 'ack_junk' }),
      ]);
      expect(transport.getMessages('stt').length).toBe(1);
      expect(tts.synthesizeCalls.length).toBe(0);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { VoicePipeline } from '../../src/pipeline/voice-pipeline.js';
import { Session } from '../../src/session/session.js';
import { createLogger } from '../../src/utils/logger.js';
import type { Transport } from '../../src/transport/interface.js';
import type { ASRProvider, ASRResult, LLMProvider, LLMChunk, TTSProvider, TTSResult, ChatMessage } from '../../src/providers/interface.js';
import type { FillerCache, CachedFiller } from '../../src/pipeline/filler-cache.js';

// --- Mock providers ---

class MockASR implements ASRProvider {
  readonly name = 'mock-asr';
  transcribeResponse = 'Hello, how are you?';

  async transcribe(): Promise<ASRResult> {
    return { text: this.transcribeResponse };
  }
}

class MockLLM implements LLMProvider {
  readonly name = 'mock-llm';
  chatResponse = 'I am doing well, thank you for asking!';
  delay = 0; // ms delay per chunk

  async *chat(_messages: ChatMessage[]): AsyncIterable<LLMChunk> {
    // Simulate streaming word by word
    const words = this.chatResponse.split(' ');
    for (let i = 0; i < words.length; i++) {
      if (this.delay > 0) await new Promise(r => setTimeout(r, this.delay));
      const text = (i > 0 ? ' ' : '') + words[i]!;
      yield { text, done: i === words.length - 1 };
    }
  }
}

class MockTTS implements TTSProvider {
  readonly name = 'mock-tts';
  synthesizeCalls: string[] = [];

  async synthesize(text: string): Promise<TTSResult> {
    this.synthesizeCalls.push(text);
    // Return minimal audio data
    return {
      audio: Buffer.alloc(1920), // 960 samples * 2 bytes
      sampleRate: 16000,
      format: 'pcm',
    };
  }
}

// --- Mock transport ---

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
  close(): void {
    this.connected = false;
  }
  onText(): void {}
  onBinary(): void {}
  onClose(): void {}
  onError(): void {}
}

// --- Mock FillerCache ---

class MockFillerCache {
  private _ready: boolean;
  private _filler: CachedFiller | undefined;

  constructor(ready = true) {
    this._ready = ready;
    if (ready) {
      this._filler = {
        text: 'Hmm.',
        audio: Buffer.alloc(960), // small audio
        sampleRate: 16000,
      };
    }
  }

  get isReady() { return this._ready; }
  get count() { return this._filler ? 1 : 0; }
  getRandomFiller() { return this._filler; }
  getTexts() { return this._filler ? [this._filler.text] : []; }
  getFiller(index: number) { return index === 0 ? this._filler : undefined; }
}

describe('VoicePipeline integration', () => {
  it('processes audio through the full ASR → LLM → TTS chain', async () => {
    const mockASR = new MockASR();
    const mockLLM = new MockLLM();
    const mockTTS = new MockTTS();
    const transport = new MockTransport();
    const session = new Session('test-device');
    session.state = 'ready';

    const pipeline = new VoicePipeline({
      asr: mockASR,
      llm: mockLLM,
      tts: mockTTS,
      logger: createLogger('warn'),
    });

    // Push some audio data
    pipeline.pushAudio(Buffer.alloc(960 * 2)); // One frame

    // Process
    await pipeline.process(session, transport);

    // Verify STT message sent
    const sttMsg = transport.sentText.find(t => {
      const parsed = JSON.parse(t);
      return parsed.type === 'stt';
    });
    expect(sttMsg).toBeDefined();
    const stt = JSON.parse(sttMsg!);
    expect(stt.text).toBe('Hello, how are you?');

    // Verify TTS start/stop messages
    const ttsMessages = transport.sentText
      .map(t => JSON.parse(t))
      .filter((m: { type: string }) => m.type === 'tts');

    expect(ttsMessages.some((m: { state: string }) => m.state === 'start')).toBe(true);
    expect(ttsMessages.some((m: { state: string }) => m.state === 'stop')).toBe(true);

    // Verify TTS was called with text from LLM
    expect(mockTTS.synthesizeCalls.length).toBeGreaterThan(0);

    // Verify binary audio was sent
    expect(transport.sentBinary.length).toBeGreaterThan(0);

    // Verify dialogue was recorded
    expect(session.dialogue).toHaveLength(2);
    expect(session.dialogue[0]!.role).toBe('user');
    expect(session.dialogue[1]!.role).toBe('assistant');
  });

  it('handles empty ASR result gracefully', async () => {
    const mockASR = new MockASR();
    mockASR.transcribeResponse = '   '; // Whitespace only
    const mockLLM = new MockLLM();
    const mockTTS = new MockTTS();
    const transport = new MockTransport();
    const session = new Session('test-device');

    const pipeline = new VoicePipeline({
      asr: mockASR,
      llm: mockLLM,
      tts: mockTTS,
      logger: createLogger('warn'),
    });

    pipeline.pushAudio(Buffer.alloc(960 * 2));
    await pipeline.process(session, transport);

    // Should not have sent any TTS messages
    const ttsMessages = transport.sentText
      .map(t => JSON.parse(t))
      .filter((m: { type: string }) => m.type === 'tts');
    expect(ttsMessages).toHaveLength(0);
  });

  it('respects abort signal', async () => {
    const mockASR = new MockASR();
    const mockLLM = new MockLLM();
    // Make LLM response very long so we have time to abort
    mockLLM.chatResponse = 'word '.repeat(100);
    const mockTTS = new MockTTS();
    const transport = new MockTransport();
    const session = new Session('test-device');

    const pipeline = new VoicePipeline({
      asr: mockASR,
      llm: mockLLM,
      tts: mockTTS,
      logger: createLogger('warn'),
    });

    pipeline.pushAudio(Buffer.alloc(960 * 2));

    // Start processing and abort after a short delay
    const processPromise = pipeline.process(session, transport);

    // Give it a tick to start, then abort
    await new Promise(resolve => setTimeout(resolve, 10));
    session.abortController?.abort();

    await processPromise;

    // Should have been aborted cleanly (no unhandled errors)
    expect(session.abortController).toBeNull();
  });

  it('clears audio buffer', async () => {
    const pipeline = new VoicePipeline({
      asr: new MockASR(),
      llm: new MockLLM(),
      tts: new MockTTS(),
      logger: createLogger('warn'),
    });

    pipeline.pushAudio(Buffer.alloc(100));
    pipeline.pushAudio(Buffer.alloc(100));
    pipeline.clearAudio();

    // Process with empty buffer should be no-op
    const session = new Session('test');
    const transport = new MockTransport();
    // Doesn't throw with empty buffer
    await expect(pipeline.process(session, transport)).resolves.not.toThrow();
  });

  it('plays filler audio before LLM response', async () => {
    const mockASR = new MockASR();
    const mockLLM = new MockLLM();
    const mockTTS = new MockTTS();
    const transport = new MockTransport();
    const session = new Session('test-device');
    session.state = 'ready';
    const fillerCache = new MockFillerCache(true);

    const pipeline = new VoicePipeline({
      asr: mockASR,
      llm: mockLLM,
      tts: mockTTS,
      fillerCache: fillerCache as unknown as FillerCache,
      logger: createLogger('warn'),
    });

    pipeline.pushAudio(Buffer.alloc(960 * 2));
    await pipeline.process(session, transport);

    const allMessages = transport.sentText.map(t => JSON.parse(t));

    // Filler sends its own tts:start, then sentence_start with filler text.
    // The LLM response sends a second tts:start after.
    const ttsStarts = allMessages
      .map((m: { type: string; state: string }, i: number) => ({ m, i }))
      .filter(({ m }: { m: { type: string; state: string } }) => m.type === 'tts' && m.state === 'start');

    // Should have at least 2 tts:start messages (filler + LLM response)
    expect(ttsStarts.length).toBeGreaterThanOrEqual(2);

    // Filler sentence_start should be between the first and second tts:start
    const fillerStart = allMessages.findIndex(
      (m: { type: string; state: string; text?: string }) =>
        m.type === 'tts' && m.state === 'sentence_start' && m.text === 'Hmm.'
    );
    expect(fillerStart).toBeGreaterThan(-1);
    expect(fillerStart).toBeGreaterThan(ttsStarts[0]!.i); // after filler's tts:start
    expect(fillerStart).toBeLessThan(ttsStarts[1]!.i);    // before LLM's tts:start

    // Filler audio binary should have been sent
    expect(transport.sentBinary.length).toBeGreaterThan(0);
  });

  it('skips filler when cache is not ready', async () => {
    const mockASR = new MockASR();
    const mockLLM = new MockLLM();
    const mockTTS = new MockTTS();
    const transport = new MockTransport();
    const session = new Session('test-device');
    const fillerCache = new MockFillerCache(false);

    const pipeline = new VoicePipeline({
      asr: mockASR,
      llm: mockLLM,
      tts: mockTTS,
      fillerCache: fillerCache as unknown as FillerCache,
      logger: createLogger('warn'),
    });

    pipeline.pushAudio(Buffer.alloc(960 * 2));
    await pipeline.process(session, transport);

    const allMessages = transport.sentText.map(t => JSON.parse(t));
    // No filler sentence_start with text "Hmm."
    const fillerMsg = allMessages.find(
      (m: { type: string; state?: string; text?: string }) =>
        m.type === 'tts' && m.state === 'sentence_start' && m.text === 'Hmm.'
    );
    expect(fillerMsg).toBeUndefined();
  });

  it('emits pipeline telemetry events', async () => {
    const mockASR = new MockASR();
    const mockLLM = new MockLLM();
    const mockTTS = new MockTTS();
    const transport = new MockTransport();
    const session = new Session('test-device');

    const pipeline = new VoicePipeline({
      asr: mockASR,
      llm: mockLLM,
      tts: mockTTS,
      logger: createLogger('warn'),
    });

    pipeline.pushAudio(Buffer.alloc(960 * 2));
    await pipeline.process(session, transport);

    const telemetryMessages = transport.sentText
      .map(t => JSON.parse(t))
      .filter((m: { type: string }) => m.type === 'pipeline_telemetry');

    // Should have at least asr_complete and pipeline_complete
    const events = telemetryMessages.map((m: { event: string }) => m.event);
    expect(events).toContain('asr_complete');
    expect(events).toContain('pipeline_complete');

    // asr_complete should have text and duration
    const asrTelemetry = telemetryMessages.find((m: { event: string }) => m.event === 'asr_complete');
    expect(asrTelemetry.text).toBe('Hello, how are you?');
    expect(asrTelemetry.duration_ms).toBeGreaterThanOrEqual(0);

    // pipeline_complete should have total_duration and segment_count
    const completeTelemetry = telemetryMessages.find((m: { event: string }) => m.event === 'pipeline_complete');
    expect(completeTelemetry.total_duration_ms).toBeGreaterThanOrEqual(0);
    expect(completeTelemetry.segment_count).toBeGreaterThan(0);
  });

  it('emits llm_segment telemetry with source', async () => {
    const mockASR = new MockASR();
    const mockLLM = new MockLLM();
    const mockTTS = new MockTTS();
    const transport = new MockTransport();
    const session = new Session('test-device');

    const pipeline = new VoicePipeline({
      asr: mockASR,
      llm: mockLLM,
      tts: mockTTS,
      logger: createLogger('warn'),
    });

    pipeline.pushAudio(Buffer.alloc(960 * 2));
    await pipeline.process(session, transport);

    const segmentEvents = transport.sentText
      .map(t => JSON.parse(t))
      .filter((m: { type: string; event?: string }) => m.type === 'pipeline_telemetry' && m.event === 'llm_segment');

    expect(segmentEvents.length).toBeGreaterThan(0);
    // Without smart LLM, all segments should be 'fast'
    for (const seg of segmentEvents) {
      expect(seg.source).toBe('fast');
      expect(seg.text).toBeTruthy();
    }
  });

  it('runs smart LLM in parallel and may replace segments', async () => {
    const mockASR = new MockASR();
    // Fast LLM: slow, gives smart LLM time to replace
    const fastLLM = new MockLLM();
    fastLLM.chatResponse = 'The capital of France is Lyon.';
    fastLLM.delay = 20; // 20ms per word

    // Smart LLM: fast, better answer
    const smartLLM = new MockLLM();
    smartLLM.name = 'mock-smart-llm';
    smartLLM.chatResponse = 'The capital of France is Paris.';
    smartLLM.delay = 0; // instant

    const mockTTS = new MockTTS();
    const transport = new MockTransport();
    const session = new Session('test-device');

    const pipeline = new VoicePipeline({
      asr: mockASR,
      llm: fastLLM,
      tts: mockTTS,
      llmSmart: smartLLM,
      logger: createLogger('warn'),
    });

    pipeline.pushAudio(Buffer.alloc(960 * 2));
    await pipeline.process(session, transport);

    // Pipeline should complete without errors
    const ttsMessages = transport.sentText
      .map(t => JSON.parse(t))
      .filter((m: { type: string }) => m.type === 'tts');

    expect(ttsMessages.some((m: { state: string }) => m.state === 'start')).toBe(true);
    expect(ttsMessages.some((m: { state: string }) => m.state === 'stop')).toBe(true);

    // Telemetry should show segment sources
    const segmentEvents = transport.sentText
      .map(t => JSON.parse(t))
      .filter((m: { type: string; event?: string }) => m.type === 'pipeline_telemetry' && m.event === 'llm_segment');

    expect(segmentEvents.length).toBeGreaterThan(0);
    // At least some segments might be from smart (depends on timing)
    // The important thing is it completes without error
  });

  it('emits filler_played telemetry when filler is used', async () => {
    const mockASR = new MockASR();
    const mockLLM = new MockLLM();
    const mockTTS = new MockTTS();
    const transport = new MockTransport();
    const session = new Session('test-device');
    const fillerCache = new MockFillerCache(true);

    const pipeline = new VoicePipeline({
      asr: mockASR,
      llm: mockLLM,
      tts: mockTTS,
      fillerCache: fillerCache as unknown as FillerCache,
      logger: createLogger('warn'),
    });

    pipeline.pushAudio(Buffer.alloc(960 * 2));
    await pipeline.process(session, transport);

    const fillerTelemetry = transport.sentText
      .map(t => JSON.parse(t))
      .find((m: { type: string; event?: string }) => m.type === 'pipeline_telemetry' && m.event === 'filler_played');

    expect(fillerTelemetry).toBeDefined();
    expect(fillerTelemetry.text).toBe('Hmm.');
  });
});

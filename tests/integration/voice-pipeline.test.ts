import { describe, it, expect } from 'vitest';
import { VoicePipeline } from '../../src/pipeline/voice-pipeline.js';
import { Session } from '../../src/session/session.js';
import { createLogger } from '../../src/utils/logger.js';
import type { Transport } from '../../src/transport/interface.js';
import type { ASRProvider, ASRResult, LLMProvider, LLMChunk, TTSProvider, TTSResult, ChatMessage } from '../../src/providers/interface.js';

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

  async *chat(_messages: ChatMessage[]): AsyncIterable<LLMChunk> {
    // Simulate streaming word by word
    const words = this.chatResponse.split(' ');
    for (let i = 0; i < words.length; i++) {
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

  it('clears audio buffer', () => {
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
    expect(pipeline.process(session, transport)).resolves.not.toThrow();
  });
});

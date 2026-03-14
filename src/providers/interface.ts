/**
 * Base provider interfaces for the voice pipeline.
 * Each provider implements one of these interfaces.
 * MCP tool schemas map directly to these interfaces (Phase 4).
 */

/** ASR (Automatic Speech Recognition) provider */
export interface ASRProvider {
  readonly name: string;

  /** Transcribe audio to text */
  transcribe(audio: Buffer, options?: {
    language?: string;
    format?: 'opus' | 'pcm' | 'wav';
    sampleRate?: number;
  }): Promise<ASRResult>;
}

export interface ASRResult {
  text: string;
  confidence?: number;
  language?: string;
}

/** LLM (Large Language Model) provider */
export interface LLMProvider {
  readonly name: string;

  /** Generate a chat completion (streaming) */
  chat(messages: ChatMessage[], options?: {
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    functions?: FunctionDef[];
    signal?: AbortSignal;
  }): AsyncIterable<LLMChunk>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
}

export interface FunctionDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMChunk {
  text: string;
  done: boolean;
  functionCall?: { name: string; arguments: string };
}

/** TTS (Text-to-Speech) provider */
export interface TTSProvider {
  readonly name: string;
  readonly provider?: string;

  /** Synthesize text to audio */
  synthesize(text: string, options?: {
    voice?: string;
    language?: string;
    sampleRate?: number;
    format?: 'opus' | 'pcm' | 'mp3';
    speed?: number;
  }): Promise<TTSResult>;
}

export interface TTSResult {
  audio: Buffer;
  sampleRate: number;
  format: string;
  duration?: number;
}

/** VAD (Voice Activity Detection) provider */
export interface VADProvider {
  readonly name: string;

  /** Process an audio chunk and return speech probability */
  process(audioChunk: Buffer): Promise<VADResult>;

  /** Reset VAD state */
  reset(): void;
}

export interface VADResult {
  /** Speech probability (0.0 - 1.0) */
  probability: number;
  /** Whether this chunk is speech (above threshold) */
  isSpeech: boolean;
}

import type { AppConfig } from '../config/schema.js';
import { resolveApiKey } from '../config/loader.js';
import type { ASRProvider, LLMProvider, TTSProvider } from './interface.js';
import { OpenAIASR } from './asr/openai-asr.js';
import { OllamaLLM } from './llm/ollama.js';
import { OpenAICompatLLM } from './llm/openai-compat.js';
import { AnthropicLLM } from './llm/anthropic.js';
import { EdgeTTS } from './tts/edge-tts.js';
import { OpenAITTS } from './tts/openai-tts.js';
import { ElevenLabsTTS } from './tts/elevenlabs-tts.js';

/**
 * Provider registry: creates provider instances from config.
 */
export interface Providers {
  asr: ASRProvider;
  llm: LLMProvider;
  tts: TTSProvider;
  llmSmart?: LLMProvider;
}

export function createProviders(config: AppConfig): Providers {
  return {
    asr: createASR(config),
    llm: createLLM(config),
    tts: createTTS(config),
    llmSmart: createLLMSmart(config),
  };
}

function createASR(config: AppConfig): ASRProvider {
  const apiKey = resolveApiKey(config, 'asr');
  switch (config.asr.provider) {
    case 'openai':
    case 'groq':
      return new OpenAIASR({
        url: config.asr.url,
        apiKey,
        model: config.asr.model,
        language: config.asr.language,
      });
    case 'whisper-local':
      // Phase 5: local Whisper
      throw new Error('whisper-local ASR not yet implemented (Phase 5)');
  }
}

function createLLM(config: AppConfig): LLMProvider {
  const apiKey = resolveApiKey(config, 'llm');
  switch (config.llm.provider) {
    case 'ollama':
      return new OllamaLLM({
        url: config.llm.url,
        model: config.llm.model,
        systemPrompt: config.llm.systemPrompt,
        maxTokens: config.llm.maxTokens,
        temperature: config.llm.temperature,
      });
    case 'openai':
      return new OpenAICompatLLM({
        url: config.llm.url,
        apiKey,
        model: config.llm.model,
        systemPrompt: config.llm.systemPrompt,
        maxTokens: config.llm.maxTokens,
        temperature: config.llm.temperature,
      });
    case 'anthropic':
      return new AnthropicLLM({
        apiKey,
        url: config.llm.url,
        model: config.llm.model,
        systemPrompt: config.llm.systemPrompt,
        maxTokens: config.llm.maxTokens,
        temperature: config.llm.temperature,
      });
  }
}

function createTTS(config: AppConfig): TTSProvider {
  const apiKey = resolveApiKey(config, 'tts');
  switch (config.tts.provider) {
    case 'edge':
      return new EdgeTTS({
        voice: config.tts.voice,
        sampleRate: config.tts.sampleRate,
      });
    case 'openai':
      return new OpenAITTS({
        url: config.tts.url ?? 'https://api.openai.com/v1/audio/speech',
        apiKey,
        model: config.tts.model,
        voice: config.tts.voice,
        sampleRate: config.tts.sampleRate,
      });
    case 'elevenlabs':
      return new ElevenLabsTTS({
        apiKey: config.apiKeys.elevenlabs ?? '',
        model: config.tts.model,
        voice: config.tts.voice,
        sampleRate: config.tts.sampleRate,
      });
    case 'piper-local':
    case 'kokoro-local':
      throw new Error(`${config.tts.provider} TTS not yet implemented (Phase 5)`);
  }
}

function createLLMSmart(config: AppConfig): LLMProvider | undefined {
  const smart = config.llmSmart;
  if (!smart.provider || !smart.model) return undefined;

  // Resolve API key based on the smart provider type
  const providerKeyMap: Record<string, keyof AppConfig['apiKeys']> = {
    openai: 'openai',
    anthropic: 'anthropic',
    ollama: 'openai', // ollama doesn't need a key
  };
  const keyName = providerKeyMap[smart.provider];
  const apiKey = keyName ? (config.apiKeys[keyName] ?? '') : '';

  // Use the main LLM config for defaults not specified in llmSmart
  const url = smart.url ?? config.llm.url;

  switch (smart.provider) {
    case 'ollama':
      return new OllamaLLM({
        url,
        model: smart.model,
        systemPrompt: config.llm.systemPrompt,
        maxTokens: config.llm.maxTokens,
        temperature: config.llm.temperature,
      });
    case 'openai':
      return new OpenAICompatLLM({
        url,
        apiKey,
        model: smart.model,
        systemPrompt: config.llm.systemPrompt,
        maxTokens: config.llm.maxTokens,
        temperature: config.llm.temperature,
      });
    case 'anthropic':
      return new AnthropicLLM({
        apiKey,
        url,
        model: smart.model,
        systemPrompt: config.llm.systemPrompt,
        maxTokens: config.llm.maxTokens,
        temperature: config.llm.temperature,
      });
    default:
      return undefined;
  }
}

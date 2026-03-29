import type { AppConfig } from '../config/schema.js';
import { join } from 'node:path';
import { resolveApiKey } from '../config/loader.js';
import type { ASRProvider, LLMProvider, TTSProvider } from './interface.js';
import { OpenAIASR } from './asr/openai-asr.js';
import { OllamaLLM } from './llm/ollama.js';
import { OpenAICompatLLM } from './llm/openai-compat.js';
import { AnthropicLLM } from './llm/anthropic.js';
import { EdgeTTS } from './tts/edge-tts.js';
import { OpenAITTS } from './tts/openai-tts.js';
import { ElevenLabsTTS } from './tts/elevenlabs-tts.js';
import { CachedTTSProvider } from './tts/cached-tts.js';
import { CachedLLMProvider } from './llm/cached-llm.js';
import type pino from 'pino';

/**
 * Provider registry: creates provider instances from config.
 */
export interface Providers {
  asr: ASRProvider;
  llm: LLMProvider;
  tts: TTSProvider;
  llmSmart?: LLMProvider;
}

export function createProviders(config: AppConfig, logger?: pino.Logger): Providers {
  const llmCacheDir = process.env['WORZEL_LLM_CACHE_DIR'] ?? join(process.cwd(), 'tmp', 'llm-cache');
  return {
    asr: createASR(config),
    llm: new CachedLLMProvider(createLLM(config), { cacheDir: llmCacheDir, logger }),
    tts: createTTS(config, logger),
    llmSmart: (() => {
      const smart = createLLMSmart(config);
      return smart ? new CachedLLMProvider(smart, { cacheDir: llmCacheDir, logger }) : undefined;
    })(),
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

function createTTS(config: AppConfig, logger?: pino.Logger): TTSProvider {
  const apiKey = resolveApiKey(config, 'tts');
  let provider: TTSProvider;
  switch (config.tts.provider) {
    case 'edge':
      provider = new EdgeTTS({
        voice: config.tts.voice,
        sampleRate: config.tts.sampleRate,
      });
      break;
    case 'openai':
      provider = new OpenAITTS({
        url: config.tts.url ?? 'https://api.openai.com/v1/audio/speech',
        apiKey,
        model: config.tts.model,
        voice: config.tts.voice,
        sampleRate: config.tts.sampleRate,
      });
      break;
    case 'elevenlabs': {
      const dictIds = process.env['ELEVENLABS_PRONUNCIATION_DICT_IDS']?.split(',').map(s => s.trim()).filter(Boolean);
      provider = new ElevenLabsTTS({
        apiKey: config.apiKeys.elevenlabs ?? '',
        model: config.tts.model,
        voice: config.tts.voice,
        sampleRate: config.tts.sampleRate,
        pronunciationDictionaryIds: dictIds,
      });
    }
      break;
    case 'piper-local':
    case 'kokoro-local':
      throw new Error(`${config.tts.provider} TTS not yet implemented (Phase 5)`);
  }

  return new CachedTTSProvider(provider, {
    cacheDir: process.env['WORZEL_TTS_CACHE_DIR'] ?? join(process.cwd(), 'tmp', 'tts-cache'),
    logger,
  });
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

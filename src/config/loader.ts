import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { AppConfigSchema, type AppConfig } from './schema.js';

/** Map of environment variable names to config paths */
const ENV_MAP: Record<string, string> = {
  WORZEL_HOST: 'server.host',
  WORZEL_PORT: 'server.port',
  WORZEL_TLS_CERT: 'server.tlsCert',
  WORZEL_TLS_KEY: 'server.tlsKey',
  WORZEL_AUTH_SECRET: 'auth.secret',
  WORZEL_AUTH_TOKEN_TTL: 'auth.tokenTtlSeconds',
  // Per-service API keys (one key per vendor, used across all their services)
  WORZEL_OPENAI_API_KEY: 'apiKeys.openai',
  WORZEL_ANTHROPIC_API_KEY: 'apiKeys.anthropic',
  WORZEL_GROQ_API_KEY: 'apiKeys.groq',
  WORZEL_CORS_ORIGINS: 'cors.allowedOrigins',
  WORZEL_RATE_LIMIT_IP: 'rateLimit.maxPerIpPerMinute',
  WORZEL_RATE_LIMIT_DEVICE: 'rateLimit.maxPerDevicePerMinute',
  WORZEL_SESSION_TIMEOUT: 'session.idleTimeoutSeconds',
  WORZEL_SESSION_MAX: 'session.maxConcurrentSessions',
  WORZEL_ASR_PROVIDER: 'asr.provider',
  WORZEL_ASR_URL: 'asr.url',
  WORZEL_ASR_MODEL: 'asr.model',
  WORZEL_ASR_LANGUAGE: 'asr.language',
  WORZEL_LLM_PROVIDER: 'llm.provider',
  WORZEL_LLM_URL: 'llm.url',
  WORZEL_LLM_MODEL: 'llm.model',
  WORZEL_LLM_SYSTEM_PROMPT: 'llm.systemPrompt',
  WORZEL_LLM_MAX_TOKENS: 'llm.maxTokens',
  WORZEL_LLM_TEMPERATURE: 'llm.temperature',
  WORZEL_TTS_PROVIDER: 'tts.provider',
  WORZEL_TTS_URL: 'tts.url',
  WORZEL_TTS_MODEL: 'tts.model',
  WORZEL_TTS_VOICE: 'tts.voice',
  WORZEL_TTS_SAMPLE_RATE: 'tts.sampleRate',
  WORZEL_LOG_LEVEL: 'logLevel',
};

/** Set a nested property on an object using a dot-separated path */
function setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1]!;
  current[lastPart] = value;
}

/** Load config from environment variables, with optional YAML file override */
export function loadConfig(yamlPath?: string): AppConfig {
  // Start with YAML file if provided
  let rawConfig: Record<string, unknown> = {};
  if (yamlPath) {
    try {
      const yamlContent = readFileSync(yamlPath, 'utf-8');
      rawConfig = parseYaml(yamlContent) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Failed to load config from ${yamlPath}: ${(err as Error).message}`);
    }
  }

  // Environment variables override YAML values
  for (const [envVar, configPath] of Object.entries(ENV_MAP)) {
    const value = process.env[envVar];
    if (value !== undefined) {
      // Handle comma-separated arrays
      if (configPath === 'cors.allowedOrigins') {
        setNested(rawConfig, configPath, value.split(',').map(s => s.trim()).filter(Boolean));
      } else {
        setNested(rawConfig, configPath, value);
      }
    }
  }

  // Validate and return
  const result = AppConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    const errors = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }
  return result.data;
}

/**
 * Resolve the API key for a given provider from the per-service apiKeys config.
 * This avoids duplicating keys across LLM/ASR/TTS config sections.
 */
export function resolveApiKey(config: AppConfig, service: 'asr' | 'llm' | 'tts'): string {
  const providerKeyMap: Record<string, keyof AppConfig['apiKeys']> = {
    // ASR providers
    'openai': 'openai',
    'groq': 'groq',
    // LLM providers
    'ollama': 'openai',  // ollama doesn't need a key, but won't be looked up
    'anthropic': 'anthropic',
    // TTS providers
    'edge': 'openai',    // edge doesn't need a key
  };

  const provider = config[service].provider;
  const keyName = providerKeyMap[provider];
  if (!keyName) return '';
  return config.apiKeys[keyName] ?? '';
}

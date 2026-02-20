import { z } from 'zod';

/** Valid host patterns for provider endpoints */
const SAFE_HOST_PATTERN = /^(localhost|127\.0\.0\.1|::1|[\w.-]+\.(openai\.com|anthropic\.com|googleapis\.com|groq\.com|tts\.speech\.microsoft\.com))$/;

const urlWithAllowlist = z.string().url().refine(
  (url) => {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      // localhost always allowed
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
      return SAFE_HOST_PATTERN.test(host);
    } catch {
      return false;
    }
  },
  { message: 'Provider URL not on allowlist. Only localhost, OpenAI, Anthropic, Google, Groq, and Microsoft Edge TTS endpoints are permitted.' }
);

export const ServerConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  tlsCert: z.string().optional(),
  tlsKey: z.string().optional(),
});

export const AuthConfigSchema = z.object({
  secret: z.string().min(32, 'Auth secret must be at least 32 characters'),
  tokenTtlSeconds: z.coerce.number().int().min(60).default(86400),
});

export const CorsConfigSchema = z.object({
  allowedOrigins: z.array(z.string()).default([]),
});

export const RateLimitConfigSchema = z.object({
  maxPerIpPerMinute: z.coerce.number().int().min(1).default(60),
  maxPerDevicePerMinute: z.coerce.number().int().min(1).default(30),
});

export const SessionConfigSchema = z.object({
  idleTimeoutSeconds: z.coerce.number().int().min(10).default(120),
  maxConcurrentSessions: z.coerce.number().int().min(1).default(100),
});

export const ApiKeysSchema = z.object({
  openai: z.string().optional(),     // covers OpenAI LLM, Whisper ASR, OpenAI TTS
  anthropic: z.string().optional(),  // covers Anthropic Claude LLM
  groq: z.string().optional(),       // covers Groq Whisper ASR
});

export const AsrConfigSchema = z.object({
  provider: z.string().transform(s => s.toLowerCase()).pipe(z.enum(['openai', 'groq', 'whisper-local'])).default('openai'),
  url: urlWithAllowlist.default('https://api.openai.com/v1/audio/transcriptions'),
  model: z.string().default('whisper-1'),
  language: z.string().default('en'),
});

export const LlmConfigSchema = z.object({
  provider: z.string().transform(s => s.toLowerCase()).pipe(z.enum(['ollama', 'openai', 'anthropic'])).default('ollama'),
  url: urlWithAllowlist.default('http://localhost:11434/v1/chat/completions'),
  model: z.string().default('qwen2.5:7b'),
  systemPrompt: z.string().default('You are a helpful voice assistant. Keep responses concise and conversational.'),
  maxTokens: z.coerce.number().int().min(1).default(2048),
  temperature: z.coerce.number().min(0).max(2).default(0.7),
});

export const TtsConfigSchema = z.object({
  provider: z.string().transform(s => s.toLowerCase()).pipe(z.enum(['edge', 'openai', 'piper-local', 'kokoro-local'])).default('edge'),
  url: urlWithAllowlist.optional(),
  model: z.string().default('tts-1'),
  voice: z.string().default('en-US-AriaNeural'),
  sampleRate: z.coerce.number().int().default(24000),
});

export const AppConfigSchema = z.object({
  server: ServerConfigSchema.default({}),
  auth: AuthConfigSchema,
  apiKeys: ApiKeysSchema.default({}),
  cors: CorsConfigSchema.default({}),
  rateLimit: RateLimitConfigSchema.default({}),
  session: SessionConfigSchema.default({}),
  asr: AsrConfigSchema.default({}),
  llm: LlmConfigSchema.default({}),
  tts: TtsConfigSchema.default({}),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type CorsConfig = z.infer<typeof CorsConfigSchema>;
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type ApiKeys = z.infer<typeof ApiKeysSchema>;
export type AsrConfig = z.infer<typeof AsrConfigSchema>;
export type LlmConfig = z.infer<typeof LlmConfigSchema>;
export type TtsConfig = z.infer<typeof TtsConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

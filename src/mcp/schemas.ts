import { z } from 'zod';

/**
 * MCP tool schemas for provider isolation.
 * Each provider is exposed as an MCP tool with a defined schema.
 */

// --- ASR ---
export const AsrTranscribeInputSchema = z.object({
  audio: z.string().describe('Base64-encoded audio data'),
  language: z.string().optional().describe('ISO 639-1 language code'),
  format: z.enum(['opus', 'pcm', 'wav']).optional().describe('Audio format'),
  sampleRate: z.number().optional().describe('Sample rate in Hz'),
});

export const AsrTranscribeOutputSchema = z.object({
  text: z.string(),
  confidence: z.number().optional(),
  language: z.string().optional(),
});

// --- LLM ---
export const LlmChatInputSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'function']),
    content: z.string(),
    name: z.string().optional(),
  })),
  functions: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.unknown()),
  })).optional(),
  stream: z.boolean().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
});

export const LlmChatOutputSchema = z.object({
  text: z.string(),
  functionCall: z.object({
    name: z.string(),
    arguments: z.string(),
  }).optional(),
});

// --- TTS ---
export const TtsSynthesizeInputSchema = z.object({
  text: z.string(),
  voice: z.string().optional(),
  language: z.string().optional(),
  sampleRate: z.number().optional(),
  format: z.enum(['opus', 'pcm', 'mp3']).optional(),
});

export const TtsSynthesizeOutputSchema = z.object({
  audio: z.string().describe('Base64-encoded audio data'),
  sampleRate: z.number(),
  format: z.string(),
  duration: z.number().optional(),
});

// --- Tool definitions for MCP protocol ---
export const MCP_TOOL_DEFINITIONS = [
  {
    name: 'asr/transcribe',
    description: 'Transcribe audio to text using speech recognition',
    inputSchema: AsrTranscribeInputSchema,
  },
  {
    name: 'llm/chat',
    description: 'Generate a chat completion from a language model',
    inputSchema: LlmChatInputSchema,
  },
  {
    name: 'tts/synthesize',
    description: 'Synthesize speech audio from text',
    inputSchema: TtsSynthesizeInputSchema,
  },
] as const;

export type AsrTranscribeInput = z.infer<typeof AsrTranscribeInputSchema>;
export type AsrTranscribeOutput = z.infer<typeof AsrTranscribeOutputSchema>;
export type LlmChatInput = z.infer<typeof LlmChatInputSchema>;
export type LlmChatOutput = z.infer<typeof LlmChatOutputSchema>;
export type TtsSynthesizeInput = z.infer<typeof TtsSynthesizeInputSchema>;
export type TtsSynthesizeOutput = z.infer<typeof TtsSynthesizeOutputSchema>;

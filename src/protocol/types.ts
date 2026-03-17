import { z } from 'zod';

/**
 * Zod schemas for ALL xiaozhi WebSocket protocol message types.
 * Every inbound message must validate against one of these schemas.
 */

// --- Audio parameters negotiated during hello ---
export const AudioParamsSchema = z.object({
  format: z.enum(['opus', 'pcm']).default('opus'),
  sample_rate: z.coerce.number().int().min(8000).max(48000).default(16000),
  channels: z.coerce.number().int().min(1).max(2).default(1),
  frame_duration: z.coerce.number().int().min(10).max(120).default(60),
});

// --- Hello: initial handshake ---
export const HelloMessageSchema = z.object({
  type: z.literal('hello'),
  version: z.coerce.number().int().optional(),
  transport: z.enum(['websocket', 'webrtc']).default('websocket'),
  audio_params: AudioParamsSchema.optional(),
  features: z.array(z.string()).optional(),
});

// --- Listen: recording state changes ---
export const ListenMessageSchema = z.object({
  type: z.literal('listen'),
  state: z.enum(['start', 'stop', 'detect']),
  mode: z.enum(['manual', 'auto']).optional(),
  /** Peak RMS audio energy (0.0–1.0) for the recording chunk. Fink extension. */
  audio_level: z.number().min(0).max(1).optional(),
});

// --- STT: speech-to-text result (server → client) ---
export const SttMessageSchema = z.object({
  type: z.literal('stt'),
  text: z.string(),
  session_id: z.string().optional(),
});

// --- TTS: text-to-speech result (server → client) ---
export const TtsMessageSchema = z.object({
  type: z.literal('tts'),
  state: z.enum(['start', 'sentence_start', 'sentence_end', 'stop']),
  text: z.string().optional(),
  session_id: z.string().optional(),
  provider: z.string().optional(),
  fallback: z.boolean().optional(),
});

// --- Input ignored: server intentionally skipped a turn (server → client) ---
export const InputIgnoredMessageSchema = z.object({
  type: z.literal('input_ignored'),
  reason: z.enum(['low_audio', 'empty_asr', 'ack_junk']),
  session_id: z.string().optional(),
});

// --- Abort: interrupt current response ---
export const AbortMessageSchema = z.object({
  type: z.literal('abort'),
  reason: z.string().optional(),
});

// --- IoT: device descriptor updates ---
export const IotDescriptorSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
  methods: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  })).optional(),
});

export const IotMessageSchema = z.object({
  type: z.literal('iot'),
  descriptors: z.array(IotDescriptorSchema).optional(),
  update: z.record(z.unknown()).optional(),
});

// --- MCP: Model Context Protocol sub-messages ---
export const McpMessageSchema = z.object({
  type: z.literal('mcp'),
  method: z.string(),
  id: z.union([z.string(), z.number()]).optional(),
  params: z.record(z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
  }).optional(),
});

// --- Ping: keepalive ---
export const PingMessageSchema = z.object({
  type: z.literal('ping'),
});

// --- Goodbye: graceful disconnect ---
export const GoodbyeMessageSchema = z.object({
  type: z.literal('goodbye'),
  reason: z.string().optional(),
});

// --- Union of all inbound message types ---
export const InboundMessageSchema = z.discriminatedUnion('type', [
  HelloMessageSchema,
  ListenMessageSchema,
  AbortMessageSchema,
  IotMessageSchema,
  McpMessageSchema,
  PingMessageSchema,
  GoodbyeMessageSchema,
]);

// --- Server outbound messages ---
export const ServerHelloSchema = z.object({
  type: z.literal('hello'),
  version: z.number(),
  session_id: z.string(),
  transport: z.enum(['websocket', 'webrtc']),
  audio_params: AudioParamsSchema,
  features: z.array(z.string()),
});

export const PongMessageSchema = z.object({
  type: z.literal('pong'),
});

// --- Type exports ---
export type AudioParams = z.infer<typeof AudioParamsSchema>;
export type HelloMessage = z.infer<typeof HelloMessageSchema>;
export type ListenMessage = z.infer<typeof ListenMessageSchema>;
export type SttMessage = z.infer<typeof SttMessageSchema>;
export type TtsMessage = z.infer<typeof TtsMessageSchema>;
export type InputIgnoredMessage = z.infer<typeof InputIgnoredMessageSchema>;
export type AbortMessage = z.infer<typeof AbortMessageSchema>;
export type IotMessage = z.infer<typeof IotMessageSchema>;
export type McpMessage = z.infer<typeof McpMessageSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;
export type GoodbyeMessage = z.infer<typeof GoodbyeMessageSchema>;
export type InboundMessage = z.infer<typeof InboundMessageSchema>;
export type ServerHello = z.infer<typeof ServerHelloSchema>;

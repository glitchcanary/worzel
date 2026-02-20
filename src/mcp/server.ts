import type pino from 'pino';
import type { ASRProvider, LLMProvider, TTSProvider } from '../providers/interface.js';
import {
  AsrTranscribeInputSchema,
  LlmChatInputSchema,
  TtsSynthesizeInputSchema,
  MCP_TOOL_DEFINITIONS,
} from './schemas.js';

/**
 * JSON-RPC 2.0 message types for MCP.
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * MCP Server — exposes ASR/LLM/TTS as MCP tools.
 *
 * In-process initially (direct function calls).
 * Can be lifted to separate processes via stdio transport for true isolation.
 */
export class McpServer {
  constructor(
    private readonly asr: ASRProvider,
    private readonly llm: LLMProvider,
    private readonly tts: TTSProvider,
    private readonly logger: pino.Logger,
  ) {}

  /** Handle a JSON-RPC 2.0 request */
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const startTime = Date.now();

    try {
      switch (request.method) {
        case 'tools/list':
          return this.success(request.id, {
            tools: MCP_TOOL_DEFINITIONS.map(t => ({
              name: t.name,
              description: t.description,
            })),
          });

        case 'tools/call':
          return await this.handleToolCall(request);

        default:
          return this.error(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (err) {
      this.logger.error({ err, method: request.method, durationMs: Date.now() - startTime }, 'MCP request error');
      return this.error(request.id, -32603, (err as Error).message);
    } finally {
      this.logger.info({
        method: request.method,
        durationMs: Date.now() - startTime,
      }, 'MCP request completed');
    }
  }

  private async handleToolCall(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    const toolName = params?.name;
    const args = params?.arguments ?? {};

    switch (toolName) {
      case 'asr/transcribe': {
        const input = AsrTranscribeInputSchema.parse(args);
        const audio = Buffer.from(input.audio, 'base64');
        const result = await this.asr.transcribe(audio, {
          language: input.language,
          format: input.format,
          sampleRate: input.sampleRate,
        });
        return this.success(request.id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        });
      }

      case 'llm/chat': {
        const input = LlmChatInputSchema.parse(args);
        let fullText = '';
        for await (const chunk of this.llm.chat(input.messages, {
          maxTokens: input.maxTokens,
          temperature: input.temperature,
        })) {
          fullText += chunk.text;
        }
        return this.success(request.id, {
          content: [{ type: 'text', text: JSON.stringify({ text: fullText }) }],
        });
      }

      case 'tts/synthesize': {
        const input = TtsSynthesizeInputSchema.parse(args);
        const result = await this.tts.synthesize(input.text, {
          voice: input.voice,
          language: input.language,
          sampleRate: input.sampleRate,
          format: input.format,
        });
        return this.success(request.id, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              audio: result.audio.toString('base64'),
              sampleRate: result.sampleRate,
              format: result.format,
              duration: result.duration,
            }),
          }],
        });
      }

      default:
        return this.error(request.id, -32602, `Unknown tool: ${toolName}`);
    }
  }

  private success(id: string | number, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private error(id: string | number, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}

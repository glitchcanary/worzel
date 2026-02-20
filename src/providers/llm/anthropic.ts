import type { LLMProvider, LLMChunk, ChatMessage } from '../interface.js';
import { createGuardedFetch } from '../endpoint-guard.js';

export interface AnthropicLLMOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  url?: string;
}

/**
 * Anthropic Claude LLM provider.
 * Uses the Messages API with streaming.
 */
export class AnthropicLLM implements LLMProvider {
  readonly name = 'anthropic';
  private readonly fetch = createGuardedFetch();
  private readonly options: AnthropicLLMOptions;
  private readonly url: string;

  constructor(options: AnthropicLLMOptions) {
    this.options = options;
    this.url = options.url ?? 'https://api.anthropic.com/v1/messages';
  }

  async *chat(messages: ChatMessage[], options?: {
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): AsyncIterable<LLMChunk> {
    const systemPrompt = options?.systemPrompt ?? this.options.systemPrompt;

    // Convert messages to Anthropic format (system prompt is separate)
    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'function' ? 'user' as const : m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const response = await this.fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.options.model,
        system: systemPrompt,
        messages: anthropicMessages,
        max_tokens: options?.maxTokens ?? this.options.maxTokens,
        temperature: options?.temperature ?? this.options.temperature,
        stream: true,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic request failed (${response.status}): ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);

          try {
            const event = JSON.parse(data) as {
              type: string;
              delta?: { type: string; text?: string };
            };

            if (event.type === 'content_block_delta' && event.delta?.text) {
              yield { text: event.delta.text, done: false };
            } else if (event.type === 'message_stop') {
              yield { text: '', done: true };
              return;
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

import type { LLMProvider, LLMChunk, ChatMessage } from '../interface.js';
import { createGuardedFetch } from '../endpoint-guard.js';

export interface OpenAICompatLLMOptions {
  url: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
}

/**
 * OpenAI-compatible LLM provider.
 * Works with OpenAI API and any compatible endpoint.
 */
export class OpenAICompatLLM implements LLMProvider {
  readonly name = 'openai-compat';
  private readonly fetch = createGuardedFetch();
  private readonly options: OpenAICompatLLMOptions;

  constructor(options: OpenAICompatLLMOptions) {
    this.options = options;
  }

  async *chat(messages: ChatMessage[], options?: {
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): AsyncIterable<LLMChunk> {
    const systemPrompt = options?.systemPrompt ?? this.options.systemPrompt;
    const allMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const response = await this.fetch(this.options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: allMessages,
        max_tokens: options?.maxTokens ?? this.options.maxTokens,
        temperature: options?.temperature ?? this.options.temperature,
        stream: true,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${error}`);
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
          if (data === '[DONE]') {
            yield { text: '', done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
            };
            const content = parsed.choices?.[0]?.delta?.content ?? '';
            const isDone = parsed.choices?.[0]?.finish_reason != null;
            if (content || isDone) {
              yield { text: content, done: isDone };
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

import type {
  AiAdapter,
  CompletionRequest,
  CompletionResult,
  StreamChunk,
} from './ai-adapter.interface.js';
import { ProviderError } from './ai-adapter.interface.js';
import { readSse, request, splitSystem } from './http.util.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

/**
 * Anthropic Messages API. Differences from OpenAI that the adapter hides:
 *  - the system prompt is a top-level `system` field, not a message
 *  - `max_tokens` is required
 *  - auth uses `x-api-key` + `anthropic-version` headers
 *  - streaming sends typed events (message_start, content_block_delta, ...)
 */
export class AnthropicAdapter implements AiAdapter {
  private headers(apiKey: string) {
    return { 'x-api-key': apiKey, 'anthropic-version': API_VERSION };
  }

  private body(req: CompletionRequest, stream: boolean) {
    const { system, turns } = splitSystem(req.messages);
    return {
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      ...(system && { system }),
      messages: turns,
      ...(req.temperature !== undefined && { temperature: req.temperature }),
      ...(stream && { stream: true }),
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await request(`${req.baseUrl ?? DEFAULT_BASE_URL}/messages`, {
      method: 'POST',
      headers: this.headers(req.apiKey),
      json: this.body(req, false),
      signal: req.signal,
    });
    const data = (await res.json()) as {
      content: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      text: data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(''),
      promptTokens: data.usage?.input_tokens,
      completionTokens: data.usage?.output_tokens,
    };
  }

  async *stream(req: CompletionRequest): AsyncGenerator<StreamChunk> {
    const res = await request(`${req.baseUrl ?? DEFAULT_BASE_URL}/messages`, {
      method: 'POST',
      headers: this.headers(req.apiKey),
      json: this.body(req, true),
      signal: req.signal,
    });
    let promptTokens: number | undefined;
    for await (const { event, data } of readSse(res.body)) {
      const payload = JSON.parse(data);
      switch (event ?? payload.type) {
        case 'message_start':
          promptTokens = payload.message?.usage?.input_tokens;
          break;
        case 'content_block_delta':
          if (payload.delta?.type === 'text_delta' && payload.delta.text) {
            yield { type: 'delta', text: payload.delta.text };
          }
          break;
        case 'message_delta':
          if (payload.usage) {
            yield {
              type: 'usage',
              promptTokens,
              completionTokens: payload.usage.output_tokens,
            };
          }
          break;
        case 'error':
          throw new ProviderError(
            undefined,
            payload.error?.message ?? 'Stream error',
          );
      }
    }
  }

  async healthCheck(
    apiKey: string,
    baseUrl?: string | null,
    signal?: AbortSignal,
  ) {
    await request(`${baseUrl ?? DEFAULT_BASE_URL}/models`, {
      headers: this.headers(apiKey),
      signal,
    });
  }
}

import type {
  AiAdapter,
  CompletionRequest,
  CompletionResult,
  StreamChunk,
} from './ai-adapter.interface.js';
import { readSse, request } from './http.util.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/** OpenAI Chat Completions API (also works with OpenAI-compatible gateways via baseUrl). */
export class OpenAiAdapter implements AiAdapter {
  private body(req: CompletionRequest, stream: boolean) {
    return {
      model: req.model,
      messages: req.messages,
      ...(req.maxTokens && { max_completion_tokens: req.maxTokens }),
      ...(req.temperature !== undefined && { temperature: req.temperature }),
      ...(stream && { stream: true, stream_options: { include_usage: true } }),
    };
  }

  private headers(apiKey: string) {
    return { authorization: `Bearer ${apiKey}` };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await request(
      `${req.baseUrl ?? DEFAULT_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: this.headers(req.apiKey),
        json: this.body(req, false),
        signal: req.signal,
      },
    );
    const data = (await res.json()) as {
      choices: { message: { content: string | null } }[];
      usage?: OpenAiUsage;
    };
    return {
      text: data.choices[0]?.message.content ?? '',
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    };
  }

  async *stream(req: CompletionRequest): AsyncGenerator<StreamChunk> {
    const res = await request(
      `${req.baseUrl ?? DEFAULT_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: this.headers(req.apiKey),
        json: this.body(req, true),
        signal: req.signal,
      },
    );
    for await (const { data } of readSse(res.body)) {
      if (data === '[DONE]') break;
      const chunk = JSON.parse(data) as {
        choices?: { delta?: { content?: string } }[];
        usage?: OpenAiUsage | null;
      };
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield { type: 'delta', text };
      if (chunk.usage) {
        yield {
          type: 'usage',
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
        };
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

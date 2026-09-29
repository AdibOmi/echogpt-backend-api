import type {
  AiAdapter,
  CompletionRequest,
  CompletionResult,
  StreamChunk,
} from './ai-adapter.interface.js';
import { readSse, request, splitSystem } from './http.util.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Google Gemini generateContent API. Differences the adapter hides:
 *  - messages are `contents` with `parts`, and the assistant role is called "model"
 *  - system prompt goes in `systemInstruction`
 *  - streaming uses a separate endpoint (`:streamGenerateContent?alt=sse`)
 */
export class GeminiAdapter implements AiAdapter {
  private headers(apiKey: string) {
    return { 'x-goog-api-key': apiKey };
  }

  private url(req: CompletionRequest, method: string) {
    return `${req.baseUrl ?? DEFAULT_BASE_URL}/models/${encodeURIComponent(req.model)}:${method}`;
  }

  private body(req: CompletionRequest) {
    const { system, turns } = splitSystem(req.messages);
    return {
      contents: turns.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      ...(system && { systemInstruction: { parts: [{ text: system }] } }),
      generationConfig: {
        ...(req.maxTokens && { maxOutputTokens: req.maxTokens }),
        ...(req.temperature !== undefined && { temperature: req.temperature }),
      },
    };
  }

  private text(data: GeminiResponse) {
    return (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await request(this.url(req, 'generateContent'), {
      method: 'POST',
      headers: this.headers(req.apiKey),
      json: this.body(req),
      signal: req.signal,
    });
    const data = (await res.json()) as GeminiResponse;
    return {
      text: this.text(data),
      promptTokens: data.usageMetadata?.promptTokenCount,
      completionTokens: data.usageMetadata?.candidatesTokenCount,
    };
  }

  async *stream(req: CompletionRequest): AsyncGenerator<StreamChunk> {
    const res = await request(
      `${this.url(req, 'streamGenerateContent')}?alt=sse`,
      {
        method: 'POST',
        headers: this.headers(req.apiKey),
        json: this.body(req),
        signal: req.signal,
      },
    );
    let usage: GeminiResponse['usageMetadata'];
    for await (const { data } of readSse(res.body)) {
      const chunk = JSON.parse(data) as GeminiResponse;
      const text = this.text(chunk);
      if (text) yield { type: 'delta', text };
      if (chunk.usageMetadata) usage = chunk.usageMetadata; // cumulative; keep latest
    }
    if (usage) {
      yield {
        type: 'usage',
        promptTokens: usage.promptTokenCount,
        completionTokens: usage.candidatesTokenCount,
      };
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

/**
 * STRATEGY / ADAPTER PATTERN
 *
 * Every AI vendor has a different HTTP API (OpenAI "chat.completions",
 * Anthropic "messages", Gemini "generateContent"). The rest of the app only
 * talks to this one interface, so ChatService never contains
 * `if (provider === 'openai') ... else if ...`. Adding a new vendor means
 * writing one new adapter class — no changes to chat code (Open/Closed principle).
 */

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  apiKey: string;
  baseUrl?: string | null;
  model: string;
  messages: ChatTurn[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface CompletionResult extends TokenUsage {
  text: string;
}

export type StreamChunk =
  { type: 'delta'; text: string } | ({ type: 'usage' } & TokenUsage);

export interface AiAdapter {
  complete(req: CompletionRequest): Promise<CompletionResult>;
  stream(req: CompletionRequest): AsyncGenerator<StreamChunk>;
  /** Cheap authenticated call (list models) to verify key + connectivity. */
  healthCheck(
    apiKey: string,
    baseUrl?: string | null,
    signal?: AbortSignal,
  ): Promise<void>;
}

/** Upstream vendor returned an error or was unreachable. */
export class ProviderError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

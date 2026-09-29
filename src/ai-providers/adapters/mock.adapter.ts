import { setTimeout as sleep } from 'node:timers/promises';
import type {
  AiAdapter,
  CompletionRequest,
  CompletionResult,
  StreamChunk,
} from './ai-adapter.interface.js';

/** Rough token estimate (~4 chars per token for English). */
const estimateTokens = (text: string) =>
  Math.max(1, Math.ceil(text.length / 4));

/**
 * Development-only adapter used when AI_MOCK_RESPONSES=true, so the chat and
 * streaming endpoints can be exercised end-to-end without paid API keys.
 */
export class MockAdapter implements AiAdapter {
  constructor(private readonly vendor: string) {}

  private reply(req: CompletionRequest) {
    const last =
      req.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    const history = req.messages.filter((m) => m.role !== 'system').length;
    return (
      `[mock ${this.vendor} · ${req.model}] You said: "${last.slice(0, 200)}". ` +
      `This conversation has ${history} message(s) of context. ` +
      `Set AI_MOCK_RESPONSES=false and add a real API key to get genuine answers.`
    );
  }

  private promptTokens(req: CompletionRequest) {
    return estimateTokens(req.messages.map((m) => m.content).join(' '));
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const text = this.reply(req);
    return {
      text,
      promptTokens: this.promptTokens(req),
      completionTokens: estimateTokens(text),
    };
  }

  async *stream(req: CompletionRequest): AsyncGenerator<StreamChunk> {
    const text = this.reply(req);
    for (const word of text.split(/(?<= )/)) {
      await sleep(25, undefined, { signal: req.signal });
      yield { type: 'delta', text: word };
    }
    yield {
      type: 'usage',
      promptTokens: this.promptTokens(req),
      completionTokens: estimateTokens(text),
    };
  }

  async healthCheck() {
    await sleep(10);
  }
}

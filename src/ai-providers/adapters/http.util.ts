import { ProviderError } from './ai-adapter.interface.js';

/** fetch() wrapper that turns non-2xx responses and network failures into ProviderError. */
export async function request(
  url: string,
  init: RequestInit & { json?: unknown },
): Promise<Response> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(rest.headers as Record<string, string>),
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (err) {
    if (
      (err as Error).name === 'AbortError' ||
      (err as Error).name === 'TimeoutError'
    ) {
      throw err; // let callers distinguish "client went away" / timeout
    }
    throw new ProviderError(
      undefined,
      `Network error: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 500);
    throw new ProviderError(
      res.status,
      `Upstream responded ${res.status}: ${body}`,
    );
  }
  return res;
}

/**
 * Minimal Server-Sent Events parser. SSE is a text protocol:
 *   event: <name>\n
 *   data: <payload>\n
 *   \n            <- blank line ends one event
 * Network chunks don't align with event boundaries, so we buffer until we see
 * complete lines.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<{ event?: string; data: string }> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | undefined;
  let data: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);

        if (line === '') {
          if (data.length) yield { event, data: data.join('\n') };
          event = undefined;
          data = [];
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        } // lines starting with ':' are comments/keep-alives
      }
    }
    if (data.length) yield { event, data: data.join('\n') };
  } finally {
    reader.releaseLock();
  }
}

export const splitSystem = (messages: { role: string; content: string }[]) => ({
  system:
    messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n') || undefined,
  turns: messages.filter((m) => m.role !== 'system'),
});

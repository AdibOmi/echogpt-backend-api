import { readSse, splitSystem } from './http.util.js';

/** Builds a ReadableStream that delivers the given raw chunks one by one. */
const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });

const collect = async (stream: ReadableStream<Uint8Array>) => {
  const events: { event?: string; data: string }[] = [];
  for await (const e of readSse(stream)) events.push(e);
  return events;
};

describe('readSse', () => {
  it('parses named events', async () => {
    const events = await collect(
      streamOf(
        'event: delta\ndata: {"text":"Hi"}\n\nevent: done\ndata: {}\n\n',
      ),
    );
    expect(events).toEqual([
      { event: 'delta', data: '{"text":"Hi"}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('handles events split across network chunks (the tricky part)', async () => {
    const events = await collect(
      streamOf('da', 'ta: {"a"', ':1}\n', '\ndata: [DONE]\n\n'),
    );
    expect(events.map((e) => e.data)).toEqual(['{"a":1}', '[DONE]']);
  });

  it('handles CRLF line endings and ignores comment keep-alives', async () => {
    const events = await collect(streamOf(': ping\r\n\r\ndata: x\r\n\r\n'));
    expect(events).toEqual([{ event: undefined, data: 'x' }]);
  });

  it('joins multi-line data fields', async () => {
    const events = await collect(streamOf('data: line1\ndata: line2\n\n'));
    expect(events[0].data).toBe('line1\nline2');
  });
});

describe('splitSystem', () => {
  it('pulls system messages out of the conversation', () => {
    const { system, turns } = splitSystem([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(system).toBe('Be brief.');
    expect(turns).toEqual([{ role: 'user', content: 'Hi' }]);
  });
});

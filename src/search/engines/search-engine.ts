import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { request } from '../../ai-providers/adapters/http.util.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Same Strategy idea as the AI adapters: swap search backends via config. */
export interface SearchEngine {
  readonly name: string;
  search(
    query: string,
    count: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]>;
}

/** Brave Search API — https://api-dashboard.search.brave.com/app/documentation */
export class BraveSearchEngine implements SearchEngine {
  readonly name = 'brave';

  constructor(private readonly apiKey: string) {}

  async search(query: string, count: number, signal?: AbortSignal) {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));
    const res = await request(url.toString(), {
      headers: {
        accept: 'application/json',
        'x-subscription-token': this.apiKey,
      },
      signal,
    });
    const data = (await res.json()) as {
      web?: {
        results?: { title: string; url: string; description?: string }[];
      };
    };
    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      // Brave marks matches with <strong>; strip tags for clean text.
      snippet: (r.description ?? '').replace(/<[^>]+>/g, ''),
    }));
  }
}

/** Deterministic fake results for development and tests. */
export class MockSearchEngine implements SearchEngine {
  readonly name = 'mock';

  async search(query: string, count: number) {
    const slug = encodeURIComponent(query.toLowerCase().replace(/\s+/g, '-'));
    return Array.from({ length: Math.min(count, 5) }, (_, i) => ({
      title: `${query} — result ${i + 1}`,
      url: `https://example.com/${slug}/${i + 1}`,
      snippet: `Mock snippet ${i + 1} about "${query}". Set SEARCH_ENGINE=brave for real results.`,
    }));
  }
}

@Injectable()
export class SearchEngineProvider {
  readonly engine: SearchEngine;

  constructor(config: ConfigService) {
    const kind = config.get<string>('SEARCH_ENGINE', 'mock');
    this.engine =
      kind === 'brave'
        ? new BraveSearchEngine(config.getOrThrow<string>('SEARCH_API_KEY'))
        : new MockSearchEngine();
    if (this.engine.name === 'mock') {
      new Logger(SearchEngineProvider.name).warn(
        'SEARCH_ENGINE=mock: web search returns fake results',
      );
    }
  }
}

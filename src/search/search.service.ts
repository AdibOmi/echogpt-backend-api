import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiAdapterRegistry } from '../ai-providers/adapters/ai-adapter.registry.js';
import { ProviderError } from '../ai-providers/adapters/ai-adapter.interface.js';
import { AiProvidersService } from '../ai-providers/ai-providers.service.js';
import { recordAiUsage } from '../common/context/request-context.js';
import {
  paginate,
  type PaginationQueryDto,
} from '../common/dto/pagination.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../subscriptions/usage.service.js';
import type {
  RecentSearchDto,
  SearchQueryDto,
  SearchResponseDto,
  SuggestionDto,
} from './dto/search.dto.js';
import {
  SearchEngineProvider,
  type SearchResult,
} from './engines/search-engine.js';

const RESULT_COUNT = 8;
const SEARCH_TIMEOUT_MS = 15_000;
const SUMMARY_TIMEOUT_MS = 30_000;

/** "  NestJS   Guards " and "nestjs guards" should share one cache entry. */
export const normalizeQuery = (q: string) =>
  q.trim().toLowerCase().replace(/\s+/g, ' ');

/** Escape LIKE wildcards so a user typing "50%" doesn't match everything. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly cacheTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly engines: SearchEngineProvider,
    private readonly providers: AiProvidersService,
    private readonly adapters: AiAdapterRegistry,
    private readonly usage: UsageService,
    config: ConfigService,
  ) {
    this.cacheTtlMs =
      config.get<number>('SEARCH_CACHE_TTL_SECONDS', 3600) * 1000;
  }

  /**
   * CACHE-ASIDE pattern:
   *   1. look in the cache  → hit: return it (fast, free)
   *   2. miss: call the search engine (+ AI summary), then store in the cache
   * The cache is shared by all users and keyed by the NORMALIZED query, with a
   * TTL so results don't go stale forever.
   */
  async search(
    userId: string,
    dto: SearchQueryDto,
  ): Promise<SearchResponseDto> {
    const normalized = normalizeQuery(dto.query);
    await this.usage.consume(userId);

    let results: SearchResult[];
    let answer: string | null = null;
    let fromCache = false;
    let providerId: string | null = null;

    try {
      const cached = await this.prisma.searchCache.findUnique({
        where: { normalizedQuery: normalized },
      });
      const wantsAnswer = dto.summarize !== false;

      if (
        cached &&
        cached.expiresAt > new Date() &&
        (!wantsAnswer || cached.answer)
      ) {
        fromCache = true;
        results = cached.results as unknown as SearchResult[];
        answer = wantsAnswer ? cached.answer : null;
        await this.prisma.searchCache.update({
          where: { id: cached.id },
          data: { hitCount: { increment: 1 } },
        });
      } else {
        results = await this.engines.engine.search(
          dto.query,
          RESULT_COUNT,
          AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        );
        if (wantsAnswer && results.length) {
          const summary = await this.summarize(userId, dto.query, results);
          answer = summary?.text ?? null;
          providerId = summary?.providerId ?? null;
        }
        const expiresAt = new Date(Date.now() + this.cacheTtlMs);
        const data = {
          results: results as object[],
          answer,
          expiresAt,
          hitCount: 0,
        };
        await this.prisma.searchCache.upsert({
          where: { normalizedQuery: normalized },
          create: { normalizedQuery: normalized, ...data },
          update: data,
        });
      }
    } catch (err) {
      await this.usage.refund(userId);
      if (
        err instanceof ProviderError ||
        (err as Error).name === 'TimeoutError'
      ) {
        throw new BadGatewayException(
          `Search engine request failed: ${(err as Error).message}`,
        );
      }
      throw err;
    }

    const record = await this.prisma.webSearch.create({
      data: {
        userId,
        query: dto.query.trim(),
        normalizedQuery: normalized,
        providerId,
        resultCount: results.length,
        fromCache,
      },
    });

    return {
      id: record.id,
      query: record.query,
      results,
      answer,
      fromCache,
      createdAt: record.createdAt,
    };
  }

  async history(userId: string, query: PaginationQueryDto) {
    const where = { userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.webSearch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
        select: {
          id: true,
          query: true,
          resultCount: true,
          fromCache: true,
          createdAt: true,
        },
      }),
      this.prisma.webSearch.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async clearHistory(userId: string) {
    const { count } = await this.prisma.webSearch.deleteMany({
      where: { userId },
    });
    return { deleted: count };
  }

  async deleteHistoryItem(userId: string, id: string) {
    const { count } = await this.prisma.webSearch.deleteMany({
      where: { id, userId },
    });
    if (!count) throw new NotFoundException('Search not found');
  }

  /** Latest searches with duplicates collapsed (Postgres DISTINCT ON). */
  async recent(userId: string, limit: number): Promise<RecentSearchDto[]> {
    return this.prisma.$queryRaw<RecentSearchDto[]>`
      SELECT query, last_searched_at AS "lastSearchedAt"
      FROM (
        SELECT DISTINCT ON (normalized_query) query, created_at AS last_searched_at
        FROM web_searches
        WHERE user_id = ${userId}::uuid
        ORDER BY normalized_query, created_at DESC
      ) t
      ORDER BY last_searched_at DESC
      LIMIT ${limit}
    `;
  }

  /**
   * Autocomplete: queries starting with the prefix, ranked by
   * "you searched it before" first, then global popularity.
   */
  async suggestions(
    userId: string,
    prefix: string,
    limit: number,
  ): Promise<SuggestionDto[]> {
    const pattern = `${escapeLike(normalizeQuery(prefix))}%`;
    return this.prisma.$queryRaw<SuggestionDto[]>`
      SELECT normalized_query AS suggestion,
             COUNT(*)::int AS count,
             bool_or(user_id = ${userId}::uuid) AS "fromHistory"
      FROM web_searches
      WHERE normalized_query LIKE ${pattern}
      GROUP BY normalized_query
      ORDER BY "fromHistory" DESC, count DESC, suggestion
      LIMIT ${limit}
    `;
  }

  async purgeCache(expiredOnly: boolean) {
    const { count } = await this.prisma.searchCache.deleteMany({
      where: expiredOnly ? { expiresAt: { lt: new Date() } } : {},
    });
    return { deleted: count };
  }

  /** AI-assisted part: summarize results with citations. Never fails the search. */
  private async summarize(
    userId: string,
    query: string,
    results: SearchResult[],
  ) {
    try {
      const resolved = await this.providers.resolve({});
      const sources = results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
        .join('\n\n');
      const result = await this.adapters.get(resolved.provider.type).complete({
        apiKey: resolved.apiKey,
        baseUrl: resolved.provider.baseUrl,
        model: resolved.model,
        maxTokens: 400,
        signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
        messages: [
          {
            role: 'system',
            content:
              'Answer the user query in 2-4 sentences using ONLY the numbered sources. ' +
              'Cite sources like [1]. If the sources are insufficient, say so.',
          },
          { role: 'user', content: `Query: ${query}\n\nSources:\n${sources}` },
        ],
      });
      const tokens =
        (result.promptTokens ?? 0) + (result.completionTokens ?? 0);
      await this.usage.addTokens(userId, tokens);
      recordAiUsage(resolved.provider.id, tokens);
      return { text: result.text, providerId: resolved.provider.id };
    } catch (err) {
      this.logger.warn(`Search summary skipped: ${(err as Error).message}`);
      return null;
    }
  }
}

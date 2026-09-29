import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProviderError,
  type ChatTurn,
  type CompletionRequest,
  type TokenUsage,
} from '../ai-providers/adapters/ai-adapter.interface.js';
import { AiAdapterRegistry } from '../ai-providers/adapters/ai-adapter.registry.js';
import {
  AiProvidersService,
  type ResolvedProvider,
} from '../ai-providers/ai-providers.service.js';
import { recordAiUsage } from '../common/context/request-context.js';
import {
  paginate,
  type PaginationQueryDto,
} from '../common/dto/pagination.dto.js';
import type { Conversation } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../subscriptions/usage.service.js';
import type {
  ChatResponseDto,
  ConversationDetailDto,
  SendMessageDto,
} from './dto/chat.dto.js';

/** How many previous messages are sent to the model as context. */
const HISTORY_LIMIT = 20;
const TITLE_LENGTH = 60;

const providerRef = { select: { id: true, name: true, type: true } } as const;
const messageSelect = {
  id: true,
  role: true,
  content: true,
  model: true,
  promptTokens: true,
  completionTokens: true,
  latencyMs: true,
  createdAt: true,
  provider: providerRef,
} as const;

interface ChatContext {
  userId: string;
  conversation: Conversation;
  isNewConversation: boolean;
  resolved: ResolvedProvider;
  request: CompletionRequest;
  userText: string;
  startedAt: Date;
}

export type ChatStreamEvent =
  | {
      event: 'meta';
      data: {
        conversationId: string;
        provider: { id: string; name: string };
        model: string;
      };
    }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: ChatResponseDto }
  | { event: 'error'; data: { message: string } };

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly timeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: AiProvidersService,
    private readonly adapters: AiAdapterRegistry,
    private readonly usage: UsageService,
    config: ConfigService,
  ) {
    this.timeoutMs = config.get<number>('AI_REQUEST_TIMEOUT_MS', 60_000);
  }

  // ───────────────────────── Send (request/response) ─────────────────────────

  async send(userId: string, dto: SendMessageDto): Promise<ChatResponseDto> {
    const ctx = await this.prepare(userId, dto);
    const adapter = this.adapters.get(ctx.resolved.provider.type);
    try {
      const result = await adapter.complete({
        ...ctx.request,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return await this.persist(ctx, result.text, result);
    } catch (err) {
      await this.rollback(ctx);
      throw this.toHttpError(err, ctx.resolved.provider.name);
    }
  }

  // ───────────────────────── Stream (Server-Sent Events) ─────────────────────────

  /**
   * Validation, quota and provider resolution happen BEFORE any bytes are sent,
   * so those failures still produce normal JSON errors with proper status codes.
   * Once streaming starts, the HTTP status is already 200, so later failures
   * are reported as an `error` event inside the stream.
   */
  async startStream(
    userId: string,
    dto: SendMessageDto,
    clientSignal: AbortSignal,
  ): Promise<AsyncGenerator<ChatStreamEvent>> {
    const ctx = await this.prepare(userId, dto);
    return this.runStream(ctx, clientSignal);
  }

  private async *runStream(
    ctx: ChatContext,
    clientSignal: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const { provider, model } = ctx.resolved;
    yield {
      event: 'meta',
      data: {
        conversationId: ctx.conversation.id,
        provider: { id: provider.id, name: provider.name },
        model,
      },
    };

    let text = '';
    let usage: TokenUsage = {};
    try {
      const chunks = this.adapters.get(provider.type).stream({
        ...ctx.request,
        // Abort the upstream call if the user closes the tab OR we time out —
        // no point paying for tokens nobody will read.
        signal: AbortSignal.any([
          clientSignal,
          AbortSignal.timeout(this.timeoutMs),
        ]),
      });
      for await (const chunk of chunks) {
        if (chunk.type === 'delta') {
          text += chunk.text;
          yield { event: 'delta', data: { text: chunk.text } };
        } else {
          usage = chunk;
        }
      }
    } catch (err) {
      // Keep whatever was generated; only refund if the user got nothing.
      if (text) await this.persist(ctx, text, usage);
      else await this.rollback(ctx);

      if (clientSignal.aborted) return; // client is gone, nobody to tell
      const httpErr = this.toHttpError(err, provider.name);
      yield { event: 'error', data: { message: httpErr.message } };
      return;
    }

    yield { event: 'done', data: await this.persist(ctx, text, usage) };
  }

  // ───────────────────────── Conversation history ─────────────────────────

  async listConversations(userId: string, query: PaginationQueryDto) {
    const where = { userId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: query.skip,
        take: query.limit,
        include: {
          provider: providerRef,
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);
    return paginate(
      rows.map(({ _count, userId: _u, providerId: _p, ...c }) => ({
        ...c,
        messageCount: _count.messages,
      })),
      total,
      query,
    );
  }

  async getConversation(
    userId: string,
    id: string,
  ): Promise<ConversationDetailDto> {
    // Filtering by BOTH id and userId is the ownership check. Another user's
    // conversation returns 404 (not 403) so we don't reveal that it exists.
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, userId },
      include: {
        provider: providerRef,
        messages: { orderBy: { createdAt: 'asc' }, select: messageSelect },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const { userId: _u, providerId: _p, ...rest } = conversation;
    return { ...rest, messageCount: rest.messages.length };
  }

  async renameConversation(userId: string, id: string, title: string) {
    const { count } = await this.prisma.conversation.updateMany({
      where: { id, userId },
      data: { title },
    });
    if (!count) throw new NotFoundException('Conversation not found');
    return this.getConversation(userId, id);
  }

  async deleteConversation(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.conversation.deleteMany({
      where: { id, userId },
    });
    if (!count) throw new NotFoundException('Conversation not found');
  }

  // ───────────────────────── internals ─────────────────────────

  private async prepare(
    userId: string,
    dto: SendMessageDto,
  ): Promise<ChatContext> {
    const existing = dto.conversationId
      ? await this.prisma.conversation.findFirst({
          where: { id: dto.conversationId, userId },
        })
      : null;
    if (dto.conversationId && !existing) {
      throw new NotFoundException('Conversation not found');
    }

    const resolved = await this.providers.resolve({
      providerId: dto.providerId,
      fallbackProviderId: existing?.providerId,
      model: dto.model,
    });
    // Keep the conversation's model if we're still on the same provider.
    if (
      !dto.model &&
      existing?.model &&
      existing.providerId === resolved.provider.id &&
      resolved.provider.models.includes(existing.model)
    ) {
      resolved.model = existing.model;
    }

    // Charge quota only after the request is known to be valid.
    await this.usage.consume(userId);

    const history = existing
      ? (
          await this.prisma.message.findMany({
            where: { conversationId: existing.id },
            orderBy: { createdAt: 'desc' },
            take: HISTORY_LIMIT,
            select: { role: true, content: true },
          })
        ).reverse()
      : [];

    const messages: ChatTurn[] = [
      ...(dto.systemPrompt
        ? [{ role: 'system' as const, content: dto.systemPrompt }]
        : []),
      ...history.map((m) => ({
        role: m.role.toLowerCase() as ChatTurn['role'],
        content: m.content,
      })),
      { role: 'user', content: dto.message },
    ];

    const conversation =
      existing ??
      (await this.prisma.conversation.create({
        data: {
          userId,
          title: this.makeTitle(dto.message),
          providerId: resolved.provider.id,
          model: resolved.model,
        },
      }));

    return {
      userId,
      conversation,
      isNewConversation: !existing,
      resolved,
      userText: dto.message,
      startedAt: new Date(),
      request: {
        apiKey: resolved.apiKey,
        baseUrl: resolved.provider.baseUrl,
        model: resolved.model,
        messages,
        maxTokens: dto.maxTokens,
        temperature: dto.temperature,
      },
    };
  }

  /** Saves the user prompt + assistant reply atomically and records token usage. */
  private async persist(
    ctx: ChatContext,
    text: string,
    usage: TokenUsage,
  ): Promise<ChatResponseDto> {
    const { provider, model } = ctx.resolved;
    const finishedAt = new Date();

    const [userMessage, assistantMessage] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: ctx.conversation.id,
          role: 'USER',
          content: ctx.userText,
          createdAt: ctx.startedAt,
        },
        select: messageSelect,
      }),
      this.prisma.message.create({
        data: {
          conversationId: ctx.conversation.id,
          role: 'ASSISTANT',
          content: text,
          providerId: provider.id,
          model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          latencyMs: finishedAt.getTime() - ctx.startedAt.getTime(),
          createdAt: finishedAt,
        },
        select: messageSelect,
      }),
      this.prisma.conversation.update({
        where: { id: ctx.conversation.id },
        data: { providerId: provider.id, model, updatedAt: finishedAt },
      }),
    ]);

    const tokens = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
    await this.usage.addTokens(ctx.userId, tokens);
    recordAiUsage(provider.id, tokens);

    return {
      conversationId: ctx.conversation.id,
      userMessage,
      assistantMessage,
    };
  }

  /** Upstream failed: refund the quota and remove an empty conversation we just created. */
  private async rollback(ctx: ChatContext) {
    await this.usage.refund(ctx.userId);
    if (ctx.isNewConversation) {
      await this.prisma.conversation
        .delete({ where: { id: ctx.conversation.id } })
        .catch(() => undefined);
    }
  }

  private toHttpError(err: unknown, providerName: string): HttpException {
    if (err instanceof HttpException) return err;
    if ((err as Error)?.name === 'TimeoutError') {
      return new GatewayTimeoutException(
        `${providerName} did not respond in time`,
      );
    }
    if (err instanceof ProviderError) {
      this.logger.warn(`${providerName}: ${err.message}`);
      return new BadGatewayException(
        `${providerName} request failed: ${err.message}`,
      );
    }
    this.logger.error(err);
    return new BadGatewayException(`${providerName} request failed`);
  }

  private makeTitle(message: string) {
    const clean = message.replace(/\s+/g, ' ').trim();
    return clean.length > TITLE_LENGTH
      ? `${clean.slice(0, TITLE_LENGTH - 1)}…`
      : clean;
  }
}

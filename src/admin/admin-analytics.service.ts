import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { PlanCode } from '../generated/prisma/enums.js';
import { paginate } from '../common/dto/pagination.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AdminSubscriptionsQueryDto,
  DashboardDto,
  LogsQueryDto,
  UpdatePlanDto,
} from './dto/admin.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Read-heavy reporting queries. Simple counts use Prisma; anything needing
 * GROUP BY on expressions, percentiles or gap-filled time series uses raw SQL,
 * which is the right tool for analytics. At larger scale these would move to a
 * read replica or pre-aggregated tables refreshed on a schedule.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(): Promise<DashboardDto> {
    const now = new Date();
    const todayStart = new Date(now.toISOString().slice(0, 10));
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

    // Independent queries run in parallel: total time ≈ the slowest one.
    const [
      usersTotal,
      usersActive,
      usersToday,
      usersWeek,
      subsByPlan,
      conversations,
      messages,
      webSearches,
      todayUsage,
      requests24h,
      errors24h,
      providers,
      activeSessions,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.$queryRaw<{ code: PlanCode; count: number }[]>`
        SELECT p.code, COUNT(*)::int AS count
        FROM subscriptions s JOIN plans p ON p.id = s.plan_id
        WHERE s.status = 'ACTIVE'
          AND (s.current_period_end IS NULL OR s.current_period_end > now())
        GROUP BY p.code`,
      this.prisma.conversation.count(),
      this.prisma.message.count(),
      this.prisma.webSearch.count(),
      this.prisma.dailyUsage.aggregate({
        where: { date: todayStart },
        _sum: { requestCount: true, tokenCount: true },
      }),
      this.prisma.apiUsageLog.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.apiUsageLog.count({
        where: { createdAt: { gte: dayAgo }, statusCode: { gte: 500 } },
      }),
      this.prisma.aiProvider.findMany({
        select: { isEnabled: true, healthStatus: true },
      }),
      this.prisma.session.count({
        where: { revokedAt: null, expiresAt: { gt: now } },
      }),
    ]);

    return {
      users: {
        total: usersTotal,
        active: usersActive,
        newToday: usersToday,
        newLast7Days: usersWeek,
      },
      activeSubscriptions: Object.fromEntries(
        subsByPlan.map((r) => [r.code, r.count]),
      ),
      content: { conversations, messages, webSearches },
      today: {
        aiRequests: todayUsage._sum.requestCount ?? 0,
        tokens: todayUsage._sum.tokenCount ?? 0,
      },
      last24h: {
        requests: requests24h,
        errors: errors24h,
        errorRate: requests24h
          ? Number((errors24h / requests24h).toFixed(4))
          : 0,
      },
      providers: {
        total: providers.length,
        enabled: providers.filter((p) => p.isEnabled).length,
        healthy: providers.filter((p) => p.healthStatus === 'HEALTHY').length,
      },
      activeSessions,
    };
  }

  async usageAnalytics(days: number) {
    const since = new Date(Date.now() - days * DAY_MS);

    const [daily, endpoints, statusClasses, providerRows, topUsers] =
      await Promise.all([
        // generate_series fills days with zero activity, so charts have no gaps.
        this.prisma.$queryRaw<
          {
            date: Date;
            requests: number;
            tokens: number;
            activeUsers: number;
          }[]
        >`
        SELECT d::date AS date,
               COALESCE(SUM(u.request_count), 0)::int AS requests,
               COALESCE(SUM(u.token_count), 0)::int AS tokens,
               COUNT(u.user_id)::int AS "activeUsers"
        FROM generate_series(current_date - ${days - 1}::int, current_date, '1 day') d
        LEFT JOIN daily_usage u ON u.date = d::date
        GROUP BY d ORDER BY d`,
        this.prisma.$queryRaw<
          {
            method: string;
            route: string;
            requests: number;
            avgMs: number;
            p95Ms: number;
            errors: number;
          }[]
        >`
        SELECT method, COALESCE(route, path) AS route,
               COUNT(*)::int AS requests,
               ROUND(AVG(duration_ms))::int AS "avgMs",
               ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS "p95Ms",
               COUNT(*) FILTER (WHERE status_code >= 500)::int AS errors
        FROM api_usage_logs
        WHERE created_at >= ${since}
        GROUP BY method, COALESCE(route, path)
        ORDER BY requests DESC
        LIMIT 15`,
        this.prisma.$queryRaw<{ statusClass: string; count: number }[]>`
        SELECT (status_code / 100) || 'xx' AS "statusClass", COUNT(*)::int AS count
        FROM api_usage_logs WHERE created_at >= ${since}
        GROUP BY 1 ORDER BY 1`,
        this.prisma.message.groupBy({
          by: ['providerId'],
          where: { role: 'ASSISTANT', createdAt: { gte: since } },
          _count: { _all: true },
          _sum: { promptTokens: true, completionTokens: true },
          _avg: { latencyMs: true },
        }),
        this.prisma.$queryRaw<
          { userId: string; email: string; requests: number; tokens: number }[]
        >`
        SELECT u.id AS "userId", u.email,
               SUM(d.request_count)::int AS requests, SUM(d.token_count)::int AS tokens
        FROM daily_usage d JOIN users u ON u.id = d.user_id
        WHERE d.date >= ${since}::date
        GROUP BY u.id, u.email
        ORDER BY requests DESC LIMIT 10`,
      ]);

    const providerNames = new Map(
      (
        await this.prisma.aiProvider.findMany({
          select: { id: true, name: true, type: true },
        })
      ).map((p) => [p.id, p]),
    );

    return {
      range: { days, since },
      daily,
      providers: providerRows.map((r) => ({
        providerId: r.providerId,
        name: r.providerId
          ? (providerNames.get(r.providerId)?.name ?? 'Unknown')
          : 'Deleted provider',
        type: r.providerId
          ? (providerNames.get(r.providerId)?.type ?? null)
          : null,
        responses: r._count._all,
        promptTokens: r._sum.promptTokens ?? 0,
        completionTokens: r._sum.completionTokens ?? 0,
        avgLatencyMs: Math.round(r._avg.latencyMs ?? 0),
      })),
      endpoints,
      statusClasses,
      topUsers,
    };
  }

  async logs(query: LogsQueryDto) {
    const where: Prisma.ApiUsageLogWhereInput = {
      ...(query.userId && { userId: query.userId }),
      ...(query.statusCode && { statusCode: query.statusCode }),
      ...(query.errorsOnly && { statusCode: { gte: 400 } }),
      ...(query.method && { method: query.method }),
      ...(query.path && { path: { contains: query.path } }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: query.from }),
          ...(query.to && { lte: query.to }),
        },
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.apiUsageLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: query.skip,
        take: query.limit,
        include: { user: { select: { id: true, email: true } } },
      }),
      this.prisma.apiUsageLog.count({ where }),
    ]);
    // JSON.stringify can't serialize BigInt, so the id goes out as a string.
    const items = rows.map(({ id, userId: _u, ...r }) => ({
      id: id.toString(),
      ...r,
    }));
    return paginate(items, total, query);
  }

  // ─────────────── Subscriptions & plans ───────────────

  async subscriptions(query: AdminSubscriptionsQueryDto) {
    const where: Prisma.SubscriptionWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.planCode && { plan: { code: query.planCode } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
        select: {
          id: true,
          status: true,
          startedAt: true,
          currentPeriodEnd: true,
          canceledAt: true,
          user: { select: { id: true, email: true, name: true } },
          plan: { select: { code: true, name: true } },
        },
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  plans() {
    return this.prisma.plan.findMany({
      orderBy: { priceCents: 'asc' },
      include: {
        _count: { select: { subscriptions: { where: { status: 'ACTIVE' } } } },
      },
    });
  }

  async updatePlan(code: PlanCode, dto: UpdatePlanDto) {
    const plan = await this.prisma.plan.findUnique({ where: { code } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (code === 'FREE' && dto.isActive === false) {
      throw new BadRequestException(
        'The FREE plan cannot be deactivated (it is the fallback plan)',
      );
    }
    return this.prisma.plan.update({ where: { code }, data: dto });
  }
}

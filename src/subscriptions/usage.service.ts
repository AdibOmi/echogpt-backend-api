import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UsageDto } from './dto/subscriptions.dto.js';
import { SubscriptionsService } from './subscriptions.service.js';

/** 'YYYY-MM-DD' for the current UTC day — quotas reset at UTC midnight. */
const utcToday = () => new Date().toISOString().slice(0, 10);

const nextUtcMidnight = () => {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
};

@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Atomically checks AND increments today's request counter in ONE statement.
   *
   * The naive version — SELECT count; if (count < limit) UPDATE count+1 — has a
   * race condition: 10 parallel requests can all read "19 < 20" and all pass.
   * Here Postgres does the check inside the UPDATE's WHERE clause while holding
   * the row lock, so the limit can never be exceeded. If the WHERE fails, no
   * row is returned and we reject with 429.
   *
   * $queryRaw with a tagged template sends values as bind parameters, so this is
   * safe from SQL injection (never use $queryRawUnsafe with string concatenation).
   */
  async consume(userId: string): Promise<void> {
    const { plan } = await this.subscriptions.getActive(userId);
    const limit = plan.dailyRequestLimit;

    const rows = await this.prisma.$queryRaw<{ request_count: number }[]>`
      INSERT INTO daily_usage (user_id, date, request_count, token_count)
      VALUES (${userId}::uuid, ${utcToday()}::date, 1, 0)
      ON CONFLICT (user_id, date) DO UPDATE
        SET request_count = daily_usage.request_count + 1
        WHERE daily_usage.request_count < ${limit}
      RETURNING request_count
    `;

    if (rows.length === 0 || limit <= 0) {
      throw new HttpException(
        `Daily limit of ${limit} requests reached on the ${plan.name} plan. ` +
          `It resets at ${nextUtcMidnight().toISOString()}.` +
          (plan.code === 'FREE'
            ? ' Upgrade to Premium for more requests.'
            : ''),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Gives a request back when the upstream AI call failed (not the user's fault). */
  async refund(userId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE daily_usage
      SET request_count = GREATEST(request_count - 1, 0)
      WHERE user_id = ${userId}::uuid AND date = ${utcToday()}::date
    `;
  }

  async addTokens(userId: string, tokens: number): Promise<void> {
    if (!tokens) return;
    await this.prisma.$executeRaw`
      UPDATE daily_usage
      SET token_count = token_count + ${tokens}
      WHERE user_id = ${userId}::uuid AND date = ${utcToday()}::date
    `;
  }

  async getUsage(userId: string): Promise<UsageDto> {
    const [{ plan }, usage] = await Promise.all([
      this.subscriptions.getActive(userId),
      this.prisma.dailyUsage.findUnique({
        where: { userId_date: { userId, date: new Date(utcToday()) } },
      }),
    ]);
    const used = usage?.requestCount ?? 0;
    return {
      plan: plan.code,
      dailyLimit: plan.dailyRequestLimit,
      used,
      remaining: Math.max(plan.dailyRequestLimit - used, 0),
      tokensUsed: usage?.tokenCount ?? 0,
      resetsAt: nextUtcMidnight(),
    };
  }
}

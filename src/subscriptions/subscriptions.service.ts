import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PlanCode } from '../generated/prisma/enums.js';

const BILLING_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

const subscriptionInclude = { plan: true } as const;

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  listPlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceCents: 'asc' },
      omit: { isActive: true, createdAt: true, updatedAt: true },
    });
  }

  /**
   * Returns the user's ACTIVE subscription, applying LAZY EXPIRATION:
   * instead of a cron job that expires subscriptions at midnight, we check
   * `currentPeriodEnd` whenever the subscription is read, and if it has passed
   * we mark it EXPIRED and fall back to FREE. Simple, and always correct.
   */
  async getActive(userId: string) {
    const active = await this.prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: subscriptionInclude,
    });

    if (
      active &&
      (!active.currentPeriodEnd || active.currentPeriodEnd > new Date())
    ) {
      return active;
    }

    return this.prisma.$transaction(async (tx) => {
      if (active) {
        await tx.subscription.update({
          where: { id: active.id },
          data: { status: 'EXPIRED' },
        });
      }
      const free = await tx.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
      return tx.subscription.create({
        data: { userId, planId: free.id },
        include: subscriptionInclude,
      });
    });
  }

  history(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: subscriptionInclude,
    });
  }

  /**
   * Upgrade or downgrade. The old subscription is CANCELED and a new ACTIVE one
   * is created inside one transaction. If two requests race, the partial unique
   * index (one ACTIVE per user) makes the second one fail with 409 instead of
   * leaving the user with two active plans.
   *
   * NOTE: there is no payment gateway in this assignment. In production an
   * upgrade would create a Stripe Checkout session, and the plan would only
   * change when Stripe's webhook confirms payment.
   */
  async changePlan(userId: string, planCode: PlanCode) {
    const plan = await this.prisma.plan.findUnique({
      where: { code: planCode },
    });
    if (!plan || !plan.isActive) {
      throw new NotFoundException(`Plan ${planCode} is not available`);
    }

    const current = await this.getActive(userId);
    if (current.planId === plan.id) {
      throw new BadRequestException(`You are already on the ${plan.name} plan`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: current.id },
        data: { status: 'CANCELED', canceledAt: new Date() },
      });
      return tx.subscription.create({
        data: {
          userId,
          planId: plan.id,
          currentPeriodEnd:
            plan.priceCents > 0
              ? new Date(Date.now() + BILLING_PERIOD_MS)
              : null,
        },
        include: subscriptionInclude,
      });
    });
  }
}

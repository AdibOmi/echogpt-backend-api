import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { PlanCode } from '../generated/prisma/enums.js';
import { paginate } from '../common/dto/pagination.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { UsageService } from '../subscriptions/usage.service.js';
import type {
  AdminUpdateUserDto,
  AdminUserDetailDto,
  AdminUsersQueryDto,
} from './dto/admin.dto.js';

const userSelect = {
  id: true,
  email: true,
  name: true,
  isActive: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { name: true } },
  subscriptions: {
    where: { status: 'ACTIVE' },
    take: 1,
    select: { plan: { select: { code: true } } },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly usage: UsageService,
  ) {}

  async list(query: AdminUsersQueryDto) {
    const where: Prisma.UserWhereInput = {
      ...(query.search && {
        OR: [
          { email: { contains: query.search, mode: 'insensitive' } },
          { name: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
      ...(query.role && { role: { name: query.role } }),
      ...(query.isActive !== undefined && { isActive: query.isActive }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
        select: userSelect,
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(
      rows.map((u) => this.toDto(u)),
      total,
      query,
    );
  }

  async get(id: string): Promise<AdminUserDetailDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...userSelect,
        _count: {
          select: {
            conversations: true,
            webSearches: true,
            sessions: {
              where: { revokedAt: null, expiresAt: { gt: new Date() } },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { _count, ...row } = user;
    const { dailyLimit, used, remaining, tokensUsed } =
      await this.usage.getUsage(id);
    return {
      ...this.toDto(row),
      counts: {
        conversations: _count.conversations,
        webSearches: _count.webSearches,
        activeSessions: _count.sessions,
      },
      usageToday: { dailyLimit, used, remaining, tokensUsed },
    };
  }

  async update(adminId: string, id: string, dto: AdminUpdateUserDto) {
    await this.assertExists(id);
    // Guard rail: an admin can't demote or suspend themselves (avoids lockout).
    if (id === adminId && (dto.role !== undefined || dto.isActive === false)) {
      throw new BadRequestException(
        'You cannot change your own role or suspend yourself',
      );
    }
    const role = dto.role
      ? await this.prisma.role.findUniqueOrThrow({ where: { name: dto.role } })
      : undefined;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          name: dto.name,
          isActive: dto.isActive,
          ...(role && { roleId: role.id }),
        },
      }),
      // Suspending also kills every session immediately.
      ...(dto.isActive === false
        ? [
            this.prisma.session.updateMany({
              where: { userId: id, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
    ]);
    return this.get(id);
  }

  async remove(adminId: string, id: string) {
    if (id === adminId)
      throw new BadRequestException('You cannot delete your own account here');
    await this.assertExists(id);
    await this.prisma.user.delete({ where: { id } });
  }

  async setPlan(id: string, planCode: PlanCode) {
    await this.assertExists(id);
    return this.subscriptions.changePlan(id, planCode);
  }

  async revokeSessions(id: string) {
    await this.assertExists(id);
    const { count } = await this.prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: `Revoked ${count} session(s)` };
  }

  private async assertExists(id: string) {
    const exists = await this.prisma.user.count({ where: { id } });
    if (!exists) throw new NotFoundException('User not found');
  }

  private toDto(u: UserRow) {
    const { role, subscriptions, ...rest } = u;
    return {
      ...rest,
      role: role.name,
      plan: subscriptions[0]?.plan.code ?? null,
    };
  }
}

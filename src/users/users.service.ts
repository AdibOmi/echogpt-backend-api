import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { BCRYPT_ROUNDS } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ChangePasswordDto,
  SessionDto,
  UpdateProfileDto,
  UserProfileDto,
} from './dto/users.dto.js';

/**
 * Explicit column list: passwordHash and token hashes can never leak into a
 * response, because they are never selected in the first place.
 */
const profileSelect = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  isActive: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { name: true } },
  subscriptions: {
    where: { status: 'ACTIVE' as const },
    take: 1,
    select: {
      plan: { select: { code: true, name: true, dailyRequestLimit: true } },
    },
  },
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: profileSelect,
    });
    return this.toProfile(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto, // safe: ValidationPipe whitelist removed any non-DTO fields
      select: profileSelect,
    });
    return this.toProfile(user);
  }

  /**
   * Changes the password and revokes all OTHER sessions — if the password was
   * changed because it leaked, an attacker's session must die too.
   */
  async changePassword(
    userId: string,
    currentSessionId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    await this.assertPassword(userId, dto.currentPassword);
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must differ from the current password',
      );
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null, id: { not: currentSessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /**
   * Hard delete. Sessions, subscriptions, chats and searches cascade away;
   * API usage logs keep their rows with user_id set to NULL (see schema).
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    await this.assertPassword(userId, password);
    await this.prisma.user.delete({ where: { id: userId } });
  }

  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<SessionDto[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });
    return sessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
  }

  private async assertPassword(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Password is incorrect');
    }
  }

  private toProfile(user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    isActive: boolean;
    emailVerifiedAt: Date | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    role: { name: string };
    subscriptions: {
      plan: { code: string; name: string; dailyRequestLimit: number };
    }[];
  }): UserProfileDto {
    const { role, subscriptions, ...rest } = user;
    return {
      ...rest,
      role: role.name,
      plan: subscriptions[0]?.plan ?? null,
    };
  }
}

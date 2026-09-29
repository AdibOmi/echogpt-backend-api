import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from '../common/types/auth-user.js';
import { randomToken, sha256 } from '../common/utils/crypto.util.js';
import type { RoleName } from '../generated/prisma/enums.js';
import type {
  AuthResponseDto,
  LoginDto,
  RegisterDto,
  TokensDto,
} from './dto/auth.dto.js';

export const BCRYPT_ROUNDS = 12;
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/** Client metadata stored on the session so users can see their devices. */
export interface ClientMeta {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /**
   * A real bcrypt hash of a random string. When a login email doesn't exist we
   * still run bcrypt.compare against this, so "unknown email" and "wrong
   * password" take the same time — preventing user enumeration by timing.
   */
  private readonly dummyHash = bcrypt.hashSync(randomToken(), BCRYPT_ROUNDS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto, meta: ClientMeta): Promise<AuthResponseDto> {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (exists) throw new ConflictException('Email is already registered');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const verifyToken = randomToken();

    // Transaction: user + role link + FREE subscription are created together
    // or not at all — never a user without a plan.
    const user = await this.prisma.$transaction(async (tx) => {
      const [role, freePlan] = await Promise.all([
        tx.role.findUniqueOrThrow({ where: { name: 'USER' } }),
        tx.plan.findUniqueOrThrow({ where: { code: 'FREE' } }),
      ]);
      return tx.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          passwordHash,
          roleId: role.id,
          emailVerifyTokenHash: sha256(verifyToken),
          emailVerifyTokenExpiry: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
          subscriptions: { create: { planId: freePlan.id } },
        },
        include: { role: true },
      });
    });

    this.sendVerificationEmail(user.email, verifyToken);

    const tokens = await this.createSession(user.id, user.role.name, meta);
    return { user: this.toSummary(user), tokens };
  }

  async login(dto: LoginDto, meta: ClientMeta): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { role: true },
    });

    const passwordOk = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? this.dummyHash,
    );
    // Same message for both cases: don't reveal which emails are registered.
    if (!user || !passwordOk) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) throw new ForbiddenException('Account is disabled');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.createSession(user.id, user.role.name, meta);
    return { user: this.toSummary(user), tokens };
  }

  /**
   * Refresh-token ROTATION with REUSE DETECTION:
   * every refresh issues a new refresh token and invalidates the old one. If an
   * old (already-rotated) token is ever presented again, it was probably
   * stolen — so we revoke every session of that user.
   */
  async refresh(refreshToken: string, meta: ClientMeta): Promise<TokensDto> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { role: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    if (session.refreshTokenHash !== sha256(refreshToken)) {
      await this.prisma.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(
        `Refresh token reuse detected for user ${session.userId}; all sessions revoked`,
      );
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (!session.user.isActive) {
      throw new ForbiddenException('Account is disabled');
    }

    const newRefresh = await this.signRefreshToken(session.userId, session.id);
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: sha256(newRefresh.token),
        expiresAt: newRefresh.expiresAt,
        lastUsedAt: new Date(),
        userAgent: meta.userAgent ?? session.userAgent,
        ipAddress: meta.ipAddress ?? session.ipAddress,
      },
    });

    return this.buildTokens(
      await this.signAccessToken(
        session.userId,
        session.id,
        session.user.role.name,
      ),
      newRefresh.token,
    );
  }

  /** Revokes the current device's session. */
  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every session of the user ("log out everywhere"). */
  async logoutAll(userId: string): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  async verifyEmail(token: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { emailVerifyTokenHash: sha256(token) },
    });
    if (
      !user ||
      !user.emailVerifyTokenExpiry ||
      user.emailVerifyTokenExpiry < new Date()
    ) {
      throw new BadRequestException('Verification link is invalid or expired');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerifyTokenHash: null,
        emailVerifyTokenExpiry: null,
      },
    });
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Email is already verified');
    }
    const token = randomToken();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerifyTokenHash: sha256(token),
        emailVerifyTokenExpiry: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
      },
    });
    this.sendVerificationEmail(user.email, token);
  }

  // ─────────────────────────── helpers ───────────────────────────

  private async createSession(
    userId: string,
    role: RoleName,
    meta: ClientMeta,
  ): Promise<TokensDto> {
    // We pick the session id up-front so it can be embedded in both tokens.
    const sessionId = randomUUID();
    const refresh = await this.signRefreshToken(userId, sessionId);
    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash: sha256(refresh.token),
        expiresAt: refresh.expiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });
    return this.buildTokens(
      await this.signAccessToken(userId, sessionId, role),
      refresh.token,
    );
  }

  private signAccessToken(userId: string, sessionId: string, role: RoleName) {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId, role };
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.getOrThrow<string>(
        'JWT_ACCESS_EXPIRES_IN',
      ) as JwtSignOptions['expiresIn'],
    });
  }

  private async signRefreshToken(userId: string, sessionId: string) {
    const payload: RefreshTokenPayload = { sub: userId, sid: sessionId };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.getOrThrow<string>(
        'JWT_REFRESH_EXPIRES_IN',
      ) as JwtSignOptions['expiresIn'],
      jwtid: randomUUID(), // guarantees each rotated token is unique
    });
    const { exp } = this.jwt.decode<{ exp: number }>(token);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  private buildTokens(accessToken: string, refreshToken: string): TokensDto {
    const { exp, iat } = this.jwt.decode<{ exp: number; iat: number }>(
      accessToken,
    );
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: exp - iat,
    };
  }

  private toSummary(user: {
    id: string;
    email: string;
    name: string | null;
    emailVerifiedAt: Date | null;
    role: { name: RoleName };
  }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.name,
      emailVerified: !!user.emailVerifiedAt,
    };
  }

  /**
   * No mail provider is wired up for this assignment, so the link is logged.
   * In production this would enqueue a job for an email service (SES, Resend…).
   */
  private sendVerificationEmail(email: string, token: string) {
    this.logger.log(
      `[DEV] Verification link for ${email}: POST /api/v1/auth/verify-email { "token": "${token}" }`,
    );
  }
}

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  ApiAuth,
  ApiValidationError,
} from '../common/decorators/api-errors.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import {
  ErrorResponseDto,
  MessageResponseDto,
} from '../common/dto/error-response.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';
import { AuthService, type ClientMeta } from './auth.service.js';
import {
  AuthResponseDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  TokensDto,
  VerifyEmailDto,
} from './dto/auth.dto.js';

// Brute-force protection: at most 5 attempts per minute per IP on credential routes.
const STRICT_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(STRICT_THROTTLE)
  @Post('register')
  @ApiOperation({
    summary: 'Register a new account',
    description:
      'Creates a USER with a FREE subscription, sends a verification email, and logs the user in.',
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiValidationError()
  @ApiConflictResponse({
    description: 'Email already registered',
    type: ErrorResponseDto,
  })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, clientMeta(req));
  }

  @Public()
  @Throttle(STRICT_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiValidationError()
  @ApiUnauthorizedResponse({
    description: 'Invalid email or password',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Account is disabled',
    type: ErrorResponseDto,
  })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, clientMeta(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair',
    description:
      'Rotates the refresh token: the old one stops working. Re-using an old refresh token revokes ALL sessions of the user.',
  })
  @ApiOkResponse({ type: TokensDto })
  @ApiUnauthorizedResponse({
    description: 'Invalid, expired, revoked or reused refresh token',
    type: ErrorResponseDto,
  })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, clientMeta(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({ summary: 'Log out the current device (revokes its session)' })
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(@CurrentUser() user: AuthUser) {
    await this.auth.logout(user.sessionId);
    return { message: 'Logged out' };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({ summary: 'Log out from every device' })
  @ApiOkResponse({ type: MessageResponseDto })
  async logoutAll(@CurrentUser('id') userId: string) {
    const count = await this.auth.logoutAll(userId);
    return { message: `Revoked ${count} session(s)` };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address with the emailed token' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    description: 'Token invalid or expired',
    type: ErrorResponseDto,
  })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
    return { message: 'Email verified' };
  }

  @Throttle(STRICT_THROTTLE)
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({ summary: 'Send a new verification email' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    description: 'Email already verified',
    type: ErrorResponseDto,
  })
  async resendVerification(@CurrentUser('id') userId: string) {
    await this.auth.resendVerification(userId);
    return { message: 'Verification email sent' };
  }
}

function clientMeta(req: Request): ClientMeta {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}

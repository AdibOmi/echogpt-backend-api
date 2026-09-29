import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_REGEX } from '../../auth/dto/auth.dto.js';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  avatarUrl?: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'Str0ngPass!' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ example: 'EvenStr0nger!' })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  newPassword: string;
}

export class DeleteAccountDto {
  @ApiProperty({
    example: 'Str0ngPass!',
    description: 'Current password, required to confirm deletion',
  })
  @IsString()
  @IsNotEmpty()
  password: string;
}

// ─────────── Responses ───────────

export class UserPlanDto {
  @ApiProperty({ enum: ['FREE', 'PREMIUM'], example: 'FREE' })
  code: string;

  @ApiProperty({ example: 'Free' })
  name: string;

  @ApiProperty({ example: 20 })
  dailyRequestLimit: number;
}

export class UserProfileDto {
  @ApiProperty({ example: '7b1d7c6e-2f0a-4a8e-9a55-0f3c1f5d9d21' })
  id: string;

  @ApiProperty({ example: 'jane@example.com' })
  email: string;

  @ApiProperty({ example: 'Jane Doe', nullable: true })
  name: string | null;

  @ApiProperty({ example: null, nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ enum: ['USER', 'ADMIN'], example: 'USER' })
  role: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z', nullable: true })
  emailVerifiedAt: Date | null;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z', nullable: true })
  lastLoginAt: Date | null;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ type: UserPlanDto, nullable: true })
  plan: UserPlanDto | null;
}

export class SessionDto {
  @ApiProperty({ example: '0b8a0c1e-6a55-4f8e-9e44-1c9d0f0e2a11' })
  id: string;

  @ApiProperty({
    example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    nullable: true,
  })
  userAgent: string | null;

  @ApiProperty({ example: '::1', nullable: true })
  ipAddress: string | null;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z' })
  lastUsedAt: Date;

  @ApiProperty({ example: '2026-10-04T10:00:00.000Z' })
  expiresAt: Date;

  @ApiProperty({
    example: true,
    description: 'True for the session making this request',
  })
  current: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PaginationMetaDto,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import {
  PlanCode,
  RoleName,
  SubscriptionStatus,
} from '../../generated/prisma/enums.js';

/** Query strings are always strings: turn "true"/"false" into booleans. */
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

// ─────────────────────────── Users ───────────────────────────

export class AdminUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Matches email or name (case-insensitive)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: RoleName })
  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

export class AdminUpdateUserDto {
  @ApiPropertyOptional({ enum: RoleName })
  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @ApiPropertyOptional({
    description: 'false = suspend (also logs the user out everywhere)',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
}

export class AdminUserDto {
  @ApiProperty({ example: '7b1d7c6e-2f0a-4a8e-9a55-0f3c1f5d9d21' }) id: string;
  @ApiProperty({ example: 'jane@example.com' }) email: string;
  @ApiProperty({ example: 'Jane Doe', nullable: true }) name: string | null;
  @ApiProperty({ enum: RoleName }) role: RoleName;
  @ApiProperty({ enum: PlanCode, nullable: true }) plan: PlanCode | null;
  @ApiProperty({ example: true }) isActive: boolean;
  @ApiProperty({ nullable: true }) emailVerifiedAt: Date | null;
  @ApiProperty({ nullable: true }) lastLoginAt: Date | null;
  @ApiProperty() createdAt: Date;
}

export class PaginatedAdminUsersDto {
  @ApiProperty({ type: [AdminUserDto] }) items: AdminUserDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class AdminUserCountsDto {
  @ApiProperty({ example: 12 }) conversations: number;
  @ApiProperty({ example: 30 }) webSearches: number;
  @ApiProperty({ example: 2 }) activeSessions: number;
}

export class AdminUserUsageDto {
  @ApiProperty({ example: 20 }) dailyLimit: number;
  @ApiProperty({ example: 4 }) used: number;
  @ApiProperty({ example: 16 }) remaining: number;
  @ApiProperty({ example: 820 }) tokensUsed: number;
}

export class AdminUserDetailDto extends AdminUserDto {
  @ApiProperty({ type: AdminUserCountsDto }) counts: AdminUserCountsDto;
  @ApiProperty({ type: AdminUserUsageDto }) usageToday: AdminUserUsageDto;
}

// ─────────────────────────── Subscriptions & plans ───────────────────────────

export class AdminSubscriptionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiPropertyOptional({ enum: PlanCode })
  @IsOptional()
  @IsEnum(PlanCode)
  planCode?: PlanCode;
}

export class AdminSubscriptionDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: SubscriptionStatus }) status: SubscriptionStatus;
  @ApiProperty({
    example: { id: '7b1d…', email: 'jane@example.com', name: 'Jane' },
  })
  user: { id: string; email: string; name: string | null };
  @ApiProperty({ example: { code: 'PREMIUM', name: 'Premium' } })
  plan: { code: PlanCode; name: string };
  @ApiProperty() startedAt: Date;
  @ApiProperty({ nullable: true }) currentPeriodEnd: Date | null;
  @ApiProperty({ nullable: true }) canceledAt: Date | null;
}

export class PaginatedAdminSubscriptionsDto {
  @ApiProperty({ type: [AdminSubscriptionDto] }) items: AdminSubscriptionDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class UpdatePlanDto {
  @ApiPropertyOptional({ example: 'Premium' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 'For power users' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 1299, description: 'Monthly price in cents' })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @ApiPropertyOptional({ example: 2000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  dailyRequestLimit?: number;

  @ApiPropertyOptional({ example: ['2000 AI requests per day'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  features?: string[];

  @ApiPropertyOptional({
    description: 'false hides the plan from new upgrades',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ─────────────────────────── Analytics & logs ───────────────────────────

export class AnalyticsQueryDto {
  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 90 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days: number = 7;
}

export class LogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ example: 429 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode?: number;

  @ApiPropertyOptional({ description: 'true = only 4xx/5xx responses' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  errorsOnly?: boolean;

  @ApiPropertyOptional({ enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] })
  @IsOptional()
  @IsIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  method?: string;

  @ApiPropertyOptional({ example: '/chat', description: 'Path contains' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  path?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class RequestLogDto {
  @ApiProperty({
    example: '1024',
    description: 'BigInt id serialized as string',
  })
  id: string;
  @ApiProperty({ example: 'POST' }) method: string;
  @ApiProperty({ example: '/api/v1/chat' }) path: string;
  @ApiProperty({ example: '/api/v1/chat', nullable: true }) route:
    string | null;
  @ApiProperty({ example: 200 }) statusCode: number;
  @ApiProperty({ example: 812 }) durationMs: number;
  @ApiProperty({ nullable: true }) ipAddress: string | null;
  @ApiProperty({ nullable: true }) userAgent: string | null;
  @ApiProperty({
    nullable: true,
    example: { id: '7b1d…', email: 'jane@example.com' },
  })
  user: { id: string; email: string } | null;
  @ApiProperty({ nullable: true }) providerId: string | null;
  @ApiProperty({ nullable: true, example: 350 }) tokensUsed: number | null;
  @ApiProperty() createdAt: Date;
}

export class PaginatedRequestLogsDto {
  @ApiProperty({ type: [RequestLogDto] }) items: RequestLogDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class DashboardDto {
  @ApiProperty({
    example: { total: 120, active: 118, newToday: 4, newLast7Days: 31 },
  })
  users: {
    total: number;
    active: number;
    newToday: number;
    newLast7Days: number;
  };

  @ApiProperty({ example: { FREE: 100, PREMIUM: 20 } })
  activeSubscriptions: Record<string, number>;

  @ApiProperty({
    example: { conversations: 540, messages: 4210, webSearches: 880 },
  })
  content: { conversations: number; messages: number; webSearches: number };

  @ApiProperty({ example: { aiRequests: 310, tokens: 182000 } })
  today: { aiRequests: number; tokens: number };

  @ApiProperty({ example: { requests: 5120, errors: 12, errorRate: 0.0023 } })
  last24h: { requests: number; errors: number; errorRate: number };

  @ApiProperty({ example: { total: 3, enabled: 2, healthy: 2 } })
  providers: { total: number; enabled: number; healthy: number };

  @ApiProperty({ example: 87 })
  activeSessions: number;
}

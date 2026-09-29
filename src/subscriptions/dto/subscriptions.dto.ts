import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PlanCode } from '../../generated/prisma/enums.js';

export class ChangePlanDto {
  @ApiProperty({ enum: PlanCode, example: PlanCode.PREMIUM })
  @IsEnum(PlanCode)
  planCode: PlanCode;
}

export class PlanDto {
  @ApiProperty({ example: 'b3e1c1c2-9a51-4d7e-8f11-2f5e6d7c8b90' })
  id: string;

  @ApiProperty({ enum: PlanCode, example: PlanCode.PREMIUM })
  code: PlanCode;

  @ApiProperty({ example: 'Premium' })
  name: string;

  @ApiPropertyOptional({ example: 'For power users', nullable: true })
  description: string | null;

  @ApiProperty({ example: 999, description: 'Monthly price in cents' })
  priceCents: number;

  @ApiProperty({ example: 1000 })
  dailyRequestLimit: number;

  @ApiProperty({ example: ['1000 AI requests per day', 'Streaming responses'] })
  features: string[];
}

export class SubscriptionDto {
  @ApiProperty({ example: '5c0f5a0e-1d7b-4c47-9f39-6f0f1a2b3c4d' })
  id: string;

  @ApiProperty({ enum: ['ACTIVE', 'CANCELED', 'EXPIRED'], example: 'ACTIVE' })
  status: string;

  @ApiProperty({ type: PlanDto })
  plan: PlanDto;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z' })
  startedAt: Date;

  @ApiProperty({
    example: '2026-10-27T10:00:00.000Z',
    nullable: true,
    description: 'End of the paid period; null for the free plan',
  })
  currentPeriodEnd: Date | null;

  @ApiProperty({ example: null, nullable: true })
  canceledAt: Date | null;
}

export class UsageDto {
  @ApiProperty({ enum: PlanCode, example: PlanCode.FREE })
  plan: PlanCode;

  @ApiProperty({ example: 20 })
  dailyLimit: number;

  @ApiProperty({ example: 3 })
  used: number;

  @ApiProperty({ example: 17 })
  remaining: number;

  @ApiProperty({ example: 1520, description: 'AI tokens consumed today' })
  tokensUsed: number;

  @ApiProperty({
    example: '2026-09-28T00:00:00.000Z',
    description: 'When the daily counter resets (UTC midnight)',
  })
  resetsAt: Date;
}

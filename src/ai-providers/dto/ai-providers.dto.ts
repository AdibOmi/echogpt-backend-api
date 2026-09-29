import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { HealthStatus, ProviderType } from '../../generated/prisma/enums.js';

export class CreateAiProviderDto {
  @ApiProperty({ example: 'OpenAI', description: 'Unique display name' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.OPENAI })
  @IsEnum(ProviderType)
  type: ProviderType;

  @ApiProperty({
    example: 'sk-proj-xxxxxxxxxxxxxxxx',
    description:
      'Vendor API key. Stored encrypted (AES-256-GCM); never returned.',
    writeOnly: true,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  apiKey: string;

  @ApiProperty({ example: 'gpt-5-mini' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  defaultModel: string;

  @ApiPropertyOptional({
    example: ['gpt-5-mini', 'gpt-5'],
    description: 'Models users may pick. The default model is always allowed.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  models?: string[];

  @ApiPropertyOptional({
    example: 'https://api.openai.com/v1',
    description: 'Override the vendor base URL (proxies, Azure, gateways)',
  })
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  baseUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Make this the default provider (unsets the previous default)',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** All fields optional; `type` can't change (it would invalidate the key). */
export class UpdateAiProviderDto extends PartialType(
  OmitType(CreateAiProviderDto, ['type', 'isDefault'] as const),
) {}

export class SetProviderStatusDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  isEnabled: boolean;
}

// ─────────── Responses ───────────

export class AiProviderDto {
  @ApiProperty({ example: 'a4f1c1c2-9a51-4d7e-8f11-2f5e6d7c8b90' })
  id: string;

  @ApiProperty({ example: 'OpenAI' })
  name: string;

  @ApiProperty({ enum: ProviderType })
  type: ProviderType;

  @ApiProperty({ example: null, nullable: true })
  baseUrl: string | null;

  @ApiProperty({ example: 'gpt-5-mini' })
  defaultModel: string;

  @ApiProperty({ example: ['gpt-5-mini', 'gpt-5'] })
  models: string[];

  @ApiProperty({
    example: 'x7Qa',
    description: 'Last 4 characters of the API key',
  })
  apiKeyLast4: string;

  @ApiProperty({ example: true })
  isEnabled: boolean;

  @ApiProperty({ example: true })
  isDefault: boolean;

  @ApiProperty({ enum: HealthStatus, example: HealthStatus.HEALTHY })
  healthStatus: HealthStatus;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z', nullable: true })
  lastHealthCheckAt: Date | null;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z' })
  updatedAt: Date;
}

/** Public view for the extension's provider picker: no admin metadata. */
export class AvailableProviderDto {
  @ApiProperty({ example: 'a4f1c1c2-9a51-4d7e-8f11-2f5e6d7c8b90' })
  id: string;

  @ApiProperty({ example: 'OpenAI' })
  name: string;

  @ApiProperty({ enum: ProviderType })
  type: ProviderType;

  @ApiProperty({ example: 'gpt-5-mini' })
  defaultModel: string;

  @ApiProperty({ example: ['gpt-5-mini', 'gpt-5'] })
  models: string[];

  @ApiProperty({ example: true })
  isDefault: boolean;
}

export class HealthCheckResultDto {
  @ApiProperty({ example: 'a4f1c1c2-9a51-4d7e-8f11-2f5e6d7c8b90' })
  providerId: string;

  @ApiProperty({ enum: HealthStatus, example: HealthStatus.HEALTHY })
  status: HealthStatus;

  @ApiProperty({ example: 212 })
  latencyMs: number;

  @ApiPropertyOptional({ example: 'Upstream responded 401: invalid api key' })
  error?: string;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z' })
  checkedAt: Date;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MessageRole, ProviderType } from '../../generated/prisma/enums.js';
import { PaginationMetaDto } from '../../common/dto/pagination.dto.js';

export class SendMessageDto {
  @ApiProperty({ example: 'Explain quantum entanglement in one paragraph.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32_000)
  message: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Continue an existing conversation. Omit to start a new one.',
  })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "AI provider to use. Defaults to the conversation's last provider, then the system default.",
  })
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({
    example: 'gpt-5-mini',
    description: "Model to use. Must be in the provider's model list.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({ example: 'You are a concise assistant.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  systemPrompt?: string;

  @ApiPropertyOptional({ example: 0.7, minimum: 0, maximum: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({ example: 1024, minimum: 1, maximum: 8192 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8192)
  maxTokens?: number;
}

export class RenameConversationDto {
  @ApiProperty({ example: 'Quantum physics notes' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;
}

// ─────────── Responses ───────────

export class ProviderRefDto {
  @ApiProperty({ example: 'a4f1c1c2-9a51-4d7e-8f11-2f5e6d7c8b90' })
  id: string;

  @ApiProperty({ example: 'OpenAI' })
  name: string;

  @ApiProperty({ enum: ProviderType })
  type: ProviderType;
}

export class MessageDto {
  @ApiProperty({ example: 'e2b6b8a4-0c1f-4a8d-9e0f-3c2b1a0d9e8f' })
  id: string;

  @ApiProperty({ enum: MessageRole, example: MessageRole.ASSISTANT })
  role: MessageRole;

  @ApiProperty({ example: 'Quantum entanglement is ...' })
  content: string;

  @ApiProperty({ example: 'gpt-5-mini', nullable: true })
  model: string | null;

  @ApiProperty({ type: ProviderRefDto, nullable: true })
  provider: ProviderRefDto | null;

  @ApiProperty({ example: 42, nullable: true })
  promptTokens: number | null;

  @ApiProperty({ example: 180, nullable: true })
  completionTokens: number | null;

  @ApiProperty({ example: 1834, nullable: true })
  latencyMs: number | null;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z' })
  createdAt: Date;
}

export class ChatResponseDto {
  @ApiProperty({ example: '9d7e3f0a-2b1c-4d5e-8f9a-0b1c2d3e4f5a' })
  conversationId: string;

  @ApiProperty({ type: MessageDto })
  userMessage: MessageDto;

  @ApiProperty({ type: MessageDto })
  assistantMessage: MessageDto;
}

export class ConversationSummaryDto {
  @ApiProperty({ example: '9d7e3f0a-2b1c-4d5e-8f9a-0b1c2d3e4f5a' })
  id: string;

  @ApiProperty({ example: 'Explain quantum entanglement' })
  title: string;

  @ApiProperty({ example: 'gpt-5-mini', nullable: true })
  model: string | null;

  @ApiProperty({ type: ProviderRefDto, nullable: true })
  provider: ProviderRefDto | null;

  @ApiProperty({ example: 6 })
  messageCount: number;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-09-27T10:05:00.000Z' })
  updatedAt: Date;
}

export class ConversationDetailDto extends ConversationSummaryDto {
  @ApiProperty({ type: [MessageDto] })
  messages: MessageDto[];
}

export class PaginatedConversationsDto {
  @ApiProperty({ type: [ConversationSummaryDto] })
  items: ConversationSummaryDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

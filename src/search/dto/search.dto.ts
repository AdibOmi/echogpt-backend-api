import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationMetaDto } from '../../common/dto/pagination.dto.js';

export class SearchQueryDto {
  @ApiProperty({ example: 'latest NestJS release notes' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  query: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Ask the default AI provider to write a short answer from the results',
  })
  @IsOptional()
  @IsBoolean()
  summarize?: boolean = true;
}

export class SuggestionsQueryDto {
  @ApiProperty({ example: 'nest', description: 'Prefix typed so far' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q: string;

  @ApiPropertyOptional({ default: 8, minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 8;
}

export class RecentQueryDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}

// ─────────── Responses ───────────

export class SearchResultDto {
  @ApiProperty({ example: 'NestJS 12 released' })
  title: string;

  @ApiProperty({ example: 'https://example.com/nestjs-12' })
  url: string;

  @ApiProperty({ example: 'NestJS 12 brings native ESM support…' })
  snippet: string;
}

export class SearchResponseDto {
  @ApiProperty({ example: '1f7c3e8a-1b2c-4d3e-9f0a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({ example: 'latest NestJS release notes' })
  query: string;

  @ApiProperty({ type: [SearchResultDto] })
  results: SearchResultDto[];

  @ApiProperty({
    example: 'NestJS 12 was released with native ESM support [1]…',
    nullable: true,
    description:
      'AI-written answer citing results as [n]; null if summarization was off or failed',
  })
  answer: string | null;

  @ApiProperty({
    example: false,
    description: 'True when served from the result cache',
  })
  fromCache: boolean;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z' })
  createdAt: Date;
}

export class SearchHistoryItemDto {
  @ApiProperty({ example: '1f7c3e8a-1b2c-4d3e-9f0a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({ example: 'latest NestJS release notes' })
  query: string;

  @ApiProperty({ example: 5 })
  resultCount: number;

  @ApiProperty({ example: false })
  fromCache: boolean;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z' })
  createdAt: Date;
}

export class PaginatedSearchHistoryDto {
  @ApiProperty({ type: [SearchHistoryItemDto] })
  items: SearchHistoryItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class RecentSearchDto {
  @ApiProperty({ example: 'latest NestJS release notes' })
  query: string;

  @ApiProperty({ example: '2026-09-27T10:00:00.000Z' })
  lastSearchedAt: Date;
}

export class SuggestionDto {
  @ApiProperty({ example: 'nestjs guards' })
  suggestion: string;

  @ApiProperty({ example: 12, description: 'How many times this was searched' })
  count: number;

  @ApiProperty({ example: true, description: 'You have searched this before' })
  fromHistory: boolean;
}

export class ClearedDto {
  @ApiProperty({ example: 14 })
  deleted: number;
}

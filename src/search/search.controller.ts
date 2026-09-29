import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import {
  ApiAdmin,
  ApiAuth,
  ApiValidationError,
} from '../common/decorators/api-errors.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import {
  ClearedDto,
  PaginatedSearchHistoryDto,
  RecentQueryDto,
  RecentSearchDto,
  SearchQueryDto,
  SearchResponseDto,
  SuggestionDto,
  SuggestionsQueryDto,
} from './dto/search.dto.js';
import { SearchService } from './search.service.js';

@ApiTags('Web Search')
@ApiAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run an AI-assisted web search',
    description:
      'Returns web results plus a short AI answer citing them. Identical (normalized) queries are served from a shared cache until the TTL expires. Uses 1 request from the daily quota.',
  })
  @ApiOkResponse({ type: SearchResponseDto })
  @ApiValidationError()
  @ApiTooManyRequestsResponse({
    description: 'Daily plan limit reached',
    type: ErrorResponseDto,
  })
  @ApiBadGatewayResponse({
    description: 'Search engine failed',
    type: ErrorResponseDto,
  })
  run(@CurrentUser('id') userId: string, @Body() dto: SearchQueryDto) {
    return this.search.search(userId, dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'My search history (newest first)' })
  @ApiOkResponse({ type: PaginatedSearchHistoryDto })
  history(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.search.history(userId, query);
  }

  @Delete('history')
  @ApiOperation({ summary: 'Clear my entire search history' })
  @ApiOkResponse({ type: ClearedDto })
  clear(@CurrentUser('id') userId: string) {
    return this.search.clearHistory(userId);
  }

  @Delete('history/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Delete one search from my history' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({
    description: 'Search not found',
    type: ErrorResponseDto,
  })
  async deleteOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.search.deleteHistoryItem(userId, id);
  }

  @Get('recent')
  @ApiOperation({ summary: 'My recent distinct searches' })
  @ApiOkResponse({ type: [RecentSearchDto] })
  recent(@CurrentUser('id') userId: string, @Query() query: RecentQueryDto) {
    return this.search.recent(userId, query.limit);
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'Autocomplete suggestions for a prefix',
    description:
      'Your own past searches rank first, then popular searches from all users.',
  })
  @ApiOkResponse({ type: [SuggestionDto] })
  suggestions(
    @CurrentUser('id') userId: string,
    @Query() query: SuggestionsQueryDto,
  ) {
    return this.search.suggestions(userId, query.q, query.limit);
  }
}

@ApiTags('Admin · System')
@ApiAdmin()
@Roles('ADMIN')
@Controller('admin/search-cache')
export class AdminSearchController {
  constructor(private readonly search: SearchService) {}

  @Delete()
  @ApiOperation({ summary: 'Purge the web search result cache' })
  @ApiQuery({
    name: 'expiredOnly',
    required: false,
    type: Boolean,
    description: 'Default true',
  })
  @ApiOkResponse({ type: ClearedDto })
  purge(
    @Query('expiredOnly', new ParseBoolPipe({ optional: true }))
    expiredOnly?: boolean,
  ) {
    return this.search.purgeCache(expiredOnly ?? true);
  }
}

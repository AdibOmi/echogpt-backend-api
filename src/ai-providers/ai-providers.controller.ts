import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiAdmin,
  ApiAuth,
  ApiValidationError,
} from '../common/decorators/api-errors.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { AiProvidersService } from './ai-providers.service.js';
import {
  AiProviderDto,
  AvailableProviderDto,
  CreateAiProviderDto,
  HealthCheckResultDto,
  SetProviderStatusDto,
  UpdateAiProviderDto,
} from './dto/ai-providers.dto.js';

const ApiProviderId = () => ApiParam({ name: 'id', format: 'uuid' });
const NotFound = () =>
  ApiNotFoundResponse({
    description: 'AI provider not found',
    type: ErrorResponseDto,
  });

/** Read-only list for end users (the extension's model picker). */
@ApiTags('AI Providers')
@Controller('providers')
export class AiProvidersController {
  constructor(private readonly providers: AiProvidersService) {}

  @Get()
  @ApiAuth()
  @ApiOperation({ summary: 'List enabled AI providers and their models' })
  @ApiOkResponse({ type: [AvailableProviderDto] })
  listAvailable() {
    return this.providers.listAvailable();
  }
}

/** Full management, ADMIN only. */
@ApiTags('Admin · AI Providers')
@ApiAdmin()
@Roles('ADMIN')
@Controller('admin/providers')
export class AdminAiProvidersController {
  constructor(private readonly providers: AiProvidersService) {}

  @Post()
  @ApiOperation({ summary: 'Add an AI provider' })
  @ApiCreatedResponse({ type: AiProviderDto })
  @ApiValidationError()
  @ApiConflictResponse({
    description: 'Name already in use',
    type: ErrorResponseDto,
  })
  create(@Body() dto: CreateAiProviderDto) {
    return this.providers.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all AI providers (API keys are never returned)',
  })
  @ApiOkResponse({ type: [AiProviderDto] })
  findAll() {
    return this.providers.findAll();
  }

  @Post('health-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health-check every enabled provider in parallel' })
  @ApiOkResponse({ type: [HealthCheckResultDto] })
  healthCheckAll() {
    return this.providers.healthCheckAll();
  }

  @Get(':id')
  @ApiProviderId()
  @ApiOperation({ summary: 'Get one AI provider' })
  @ApiOkResponse({ type: AiProviderDto })
  @NotFound()
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.providers.findOne(id);
  }

  @Patch(':id')
  @ApiProviderId()
  @ApiOperation({
    summary: 'Edit an AI provider',
    description:
      'Send `apiKey` to rotate the key; omit it to keep the current one.',
  })
  @ApiOkResponse({ type: AiProviderDto })
  @ApiValidationError()
  @NotFound()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiProviderDto,
  ) {
    return this.providers.update(id, dto);
  }

  @Patch(':id/status')
  @ApiProviderId()
  @ApiOperation({ summary: 'Enable or disable an AI provider' })
  @ApiOkResponse({ type: AiProviderDto })
  @ApiBadRequestResponse({
    description: 'Cannot disable the default provider',
    type: ErrorResponseDto,
  })
  @NotFound()
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetProviderStatusDto,
  ) {
    return this.providers.setEnabled(id, dto.isEnabled);
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @ApiProviderId()
  @ApiOperation({ summary: 'Make this the default provider' })
  @ApiOkResponse({ type: AiProviderDto })
  @ApiBadRequestResponse({
    description: 'Provider is disabled',
    type: ErrorResponseDto,
  })
  @NotFound()
  setDefault(@Param('id', ParseUUIDPipe) id: string) {
    return this.providers.setDefault(id);
  }

  @Post(':id/health-check')
  @HttpCode(HttpStatus.OK)
  @ApiProviderId()
  @ApiOperation({
    summary: 'Check provider connectivity and API key validity',
    description:
      'Makes a cheap authenticated call (list models) and records the result.',
  })
  @ApiOkResponse({ type: HealthCheckResultDto })
  @NotFound()
  healthCheck(@Param('id', ParseUUIDPipe) id: string) {
    return this.providers.healthCheck(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiProviderId()
  @ApiOperation({ summary: 'Delete an AI provider' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({
    description: 'Cannot delete the default provider',
    type: ErrorResponseDto,
  })
  @NotFound()
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.providers.remove(id);
  }
}

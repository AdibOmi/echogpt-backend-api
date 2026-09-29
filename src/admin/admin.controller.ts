import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiAdmin,
  ApiValidationError,
} from '../common/decorators/api-errors.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import {
  ErrorResponseDto,
  MessageResponseDto,
} from '../common/dto/error-response.dto.js';
import { PlanCode } from '../generated/prisma/enums.js';
import {
  ChangePlanDto,
  PlanDto,
  SubscriptionDto,
} from '../subscriptions/dto/subscriptions.dto.js';
import { AdminAnalyticsService } from './admin-analytics.service.js';
import { AdminUsersService } from './admin-users.service.js';
import {
  AdminSubscriptionsQueryDto,
  AdminUpdateUserDto,
  AdminUserDetailDto,
  AdminUsersQueryDto,
  AnalyticsQueryDto,
  DashboardDto,
  LogsQueryDto,
  PaginatedAdminSubscriptionsDto,
  PaginatedAdminUsersDto,
  PaginatedRequestLogsDto,
  UpdatePlanDto,
} from './dto/admin.dto.js';

const UserNotFound = () =>
  ApiNotFoundResponse({
    description: 'User not found',
    type: ErrorResponseDto,
  });

@ApiTags('Admin · Dashboard & Analytics')
@ApiAdmin()
@Roles('ADMIN')
@Controller('admin')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Headline statistics for the admin dashboard' })
  @ApiOkResponse({ type: DashboardDto })
  dashboard() {
    return this.analytics.dashboard();
  }

  @Get('analytics/usage')
  @ApiOperation({
    summary: 'API usage analytics',
    description:
      'Daily requests/tokens/active users (gap-filled), per-provider token usage and latency, top endpoints with avg & p95 latency, status code classes, and top users.',
  })
  @ApiOkResponse({ description: 'Analytics report' })
  usage(@Query() query: AnalyticsQueryDto) {
    return this.analytics.usageAnalytics(query.days);
  }

  @Get('logs')
  @ApiOperation({ summary: 'Browse API request logs (newest first)' })
  @ApiOkResponse({ type: PaginatedRequestLogsDto })
  logs(@Query() query: LogsQueryDto) {
    return this.analytics.logs(query);
  }
}

@ApiTags('Admin · Subscriptions')
@ApiAdmin()
@Roles('ADMIN')
@Controller('admin')
export class AdminSubscriptionsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('subscriptions')
  @ApiOperation({ summary: 'List subscriptions (filter by status / plan)' })
  @ApiOkResponse({ type: PaginatedAdminSubscriptionsDto })
  list(@Query() query: AdminSubscriptionsQueryDto) {
    return this.analytics.subscriptions(query);
  }

  @Get('plans')
  @ApiOperation({
    summary:
      'List all plans including inactive ones, with active subscriber counts',
  })
  @ApiOkResponse({ type: [PlanDto] })
  plans() {
    return this.analytics.plans();
  }

  @Patch('plans/:code')
  @ApiParam({ name: 'code', enum: PlanCode })
  @ApiOperation({
    summary: 'Edit a plan (price, daily limit, features, availability)',
    description:
      'Limits are data, not code: changes apply immediately to every subscriber.',
  })
  @ApiOkResponse({ type: PlanDto })
  @ApiValidationError()
  @ApiNotFoundResponse({
    description: 'Plan not found',
    type: ErrorResponseDto,
  })
  updatePlan(
    @Param('code', new ParseEnumPipe(PlanCode)) code: PlanCode,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.analytics.updatePlan(code, dto);
  }
}

@ApiTags('Admin · Users')
@ApiAdmin()
@Roles('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List / search users' })
  @ApiOkResponse({ type: PaginatedAdminUsersDto })
  list(@Query() query: AdminUsersQueryDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: "Get a user's details, activity counts and today's usage",
  })
  @ApiOkResponse({ type: AdminUserDetailDto })
  @UserNotFound()
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Change role, suspend/reactivate, or rename a user',
  })
  @ApiOkResponse({ type: AdminUserDetailDto })
  @ApiBadRequestResponse({
    description: 'Cannot demote or suspend yourself',
    type: ErrorResponseDto,
  })
  @UserNotFound()
  update(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.users.update(adminId, id, dto);
  }

  @Patch(':id/subscription')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: "Change a user's plan (e.g. grant Premium)" })
  @ApiOkResponse({ type: SubscriptionDto })
  @ApiBadRequestResponse({
    description: 'User is already on that plan',
    type: ErrorResponseDto,
  })
  @UserNotFound()
  setPlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangePlanDto) {
    return this.users.setPlan(id, dto.planCode);
  }

  @Post(':id/logout')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Force-logout a user from every device' })
  @ApiOkResponse({ type: MessageResponseDto })
  @UserNotFound()
  logout(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.revokeSessions(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a user permanently' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({
    description: 'Cannot delete yourself',
    type: ErrorResponseDto,
  })
  @UserNotFound()
  async remove(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.users.remove(adminId, id);
  }
}

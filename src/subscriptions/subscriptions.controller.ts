import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiAuth,
  ApiValidationError,
} from '../common/decorators/api-errors.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import {
  ChangePlanDto,
  PlanDto,
  SubscriptionDto,
  UsageDto,
} from './dto/subscriptions.dto.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { UsageService } from './usage.service.js';

@ApiTags('Subscriptions')
@Controller()
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly usage: UsageService,
  ) {}

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'List available plans (Free & Premium)' })
  @ApiOkResponse({ type: [PlanDto] })
  listPlans() {
    return this.subscriptions.listPlans();
  }

  @Get('subscriptions/me')
  @ApiAuth()
  @ApiOperation({ summary: 'Get my current subscription status' })
  @ApiOkResponse({ type: SubscriptionDto })
  getMine(@CurrentUser('id') userId: string) {
    return this.subscriptions.getActive(userId);
  }

  @Get('subscriptions/me/history')
  @ApiAuth()
  @ApiOperation({ summary: 'Get my subscription history (newest first)' })
  @ApiOkResponse({ type: [SubscriptionDto] })
  history(@CurrentUser('id') userId: string) {
    return this.subscriptions.history(userId);
  }

  @Post('subscriptions/me/change')
  @ApiAuth()
  @ApiOperation({
    summary: 'Upgrade or downgrade my plan',
    description:
      'Cancels the current subscription and starts a new one. Paid plans run for 30 days, then fall back to Free automatically.',
  })
  @ApiCreatedResponse({ type: SubscriptionDto })
  @ApiValidationError()
  @ApiBadRequestResponse({
    description: 'Already on that plan',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Plan not available',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Concurrent plan change',
    type: ErrorResponseDto,
  })
  changePlan(@CurrentUser('id') userId: string, @Body() dto: ChangePlanDto) {
    return this.subscriptions.changePlan(userId, dto.planCode);
  }

  @Get('usage/me')
  @ApiTags('Usage')
  @ApiAuth()
  @ApiOperation({
    summary: 'Get my usage and remaining requests for today',
  })
  @ApiOkResponse({ type: UsageDto })
  getUsage(@CurrentUser('id') userId: string) {
    return this.usage.getUsage(userId);
  }
}

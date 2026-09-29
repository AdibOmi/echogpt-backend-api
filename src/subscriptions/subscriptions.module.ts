import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { UsageService } from './usage.service.js';

@Module({
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, UsageService],
  exports: [SubscriptionsService, UsageService],
})
export class SubscriptionsModule {}

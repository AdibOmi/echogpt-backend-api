import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { AdminAnalyticsService } from './admin-analytics.service.js';
import { AdminUsersService } from './admin-users.service.js';
import {
  AdminAnalyticsController,
  AdminSubscriptionsController,
  AdminUsersController,
} from './admin.controller.js';

@Module({
  imports: [SubscriptionsModule],
  controllers: [
    AdminAnalyticsController,
    AdminSubscriptionsController,
    AdminUsersController,
  ],
  providers: [AdminUsersService, AdminAnalyticsService],
})
export class AdminModule {}

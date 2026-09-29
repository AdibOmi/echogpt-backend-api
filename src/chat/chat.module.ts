import { Module } from '@nestjs/common';
import { AiProvidersModule } from '../ai-providers/ai-providers.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [AiProvidersModule, SubscriptionsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}

import { Module } from '@nestjs/common';
import { AiProvidersModule } from '../ai-providers/ai-providers.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { SearchEngineProvider } from './engines/search-engine.js';
import {
  AdminSearchController,
  SearchController,
} from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [AiProvidersModule, SubscriptionsModule],
  controllers: [SearchController, AdminSearchController],
  providers: [SearchService, SearchEngineProvider],
})
export class SearchModule {}

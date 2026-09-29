import { Module } from '@nestjs/common';
import { EncryptionService } from '../common/crypto/encryption.service.js';
import { AiAdapterRegistry } from './adapters/ai-adapter.registry.js';
import {
  AdminAiProvidersController,
  AiProvidersController,
} from './ai-providers.controller.js';
import { AiProvidersService } from './ai-providers.service.js';

@Module({
  controllers: [AiProvidersController, AdminAiProvidersController],
  providers: [AiProvidersService, AiAdapterRegistry, EncryptionService],
  exports: [AiProvidersService, AiAdapterRegistry],
})
export class AiProvidersModule {}

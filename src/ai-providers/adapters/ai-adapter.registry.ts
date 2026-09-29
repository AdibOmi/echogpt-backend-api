import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProviderType } from '../../generated/prisma/enums.js';
import type { AiAdapter } from './ai-adapter.interface.js';
import { AnthropicAdapter } from './anthropic.adapter.js';
import { GeminiAdapter } from './gemini.adapter.js';
import { MockAdapter } from './mock.adapter.js';
import { OpenAiAdapter } from './openai.adapter.js';

/** Maps a provider type to its adapter (a tiny Factory). */
@Injectable()
export class AiAdapterRegistry {
  private readonly adapters: Record<ProviderType, AiAdapter>;

  constructor(config: ConfigService) {
    const mock =
      config.get<boolean>('AI_MOCK_RESPONSES') &&
      config.get<string>('NODE_ENV') !== 'production';

    this.adapters = mock
      ? {
          OPENAI: new MockAdapter('openai'),
          ANTHROPIC: new MockAdapter('anthropic'),
          GEMINI: new MockAdapter('gemini'),
        }
      : {
          OPENAI: new OpenAiAdapter(),
          ANTHROPIC: new AnthropicAdapter(),
          GEMINI: new GeminiAdapter(),
        };

    if (mock) {
      new Logger(AiAdapterRegistry.name).warn(
        'AI_MOCK_RESPONSES is on: AI providers return fake responses',
      );
    }
  }

  get(type: ProviderType): AiAdapter {
    return this.adapters[type];
  }
}

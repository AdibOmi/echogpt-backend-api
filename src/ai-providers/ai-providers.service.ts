import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EncryptionService } from '../common/crypto/encryption.service.js';
import type { AiProvider } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiAdapterRegistry } from './adapters/ai-adapter.registry.js';
import type {
  AiProviderDto,
  AvailableProviderDto,
  CreateAiProviderDto,
  HealthCheckResultDto,
  UpdateAiProviderDto,
} from './dto/ai-providers.dto.js';

const HEALTH_CHECK_TIMEOUT_MS = 10_000;

/** A provider ready to call: includes the DECRYPTED key. Never return this from a controller. */
export interface ResolvedProvider {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

@Injectable()
export class AiProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly adapters: AiAdapterRegistry,
  ) {}

  // ───────────────────────── Admin CRUD ─────────────────────────

  async create(dto: CreateAiProviderDto): Promise<AiProviderDto> {
    const { apiKey, isDefault, ...rest } = dto;
    if (isDefault && dto.isEnabled === false) {
      throw new BadRequestException(
        'A disabled provider cannot be the default',
      );
    }

    // The first enabled provider automatically becomes the default.
    const hasDefault = await this.prisma.aiProvider.count({
      where: { isDefault: true },
    });
    const makeDefault =
      !!isDefault || (hasDefault === 0 && dto.isEnabled !== false);

    const provider = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.aiProvider.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.aiProvider.create({
        data: {
          ...rest,
          models: this.normalizeModels(rest.defaultModel, rest.models),
          encryptedApiKey: this.encryption.encrypt(apiKey),
          apiKeyLast4: apiKey.slice(-4),
          isDefault: makeDefault,
        },
      });
    });
    return this.toDto(provider);
  }

  async findAll(): Promise<AiProviderDto[]> {
    const providers = await this.prisma.aiProvider.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return providers.map((p) => this.toDto(p));
  }

  async findOne(id: string): Promise<AiProviderDto> {
    return this.toDto(await this.getOrThrow(id));
  }

  async update(id: string, dto: UpdateAiProviderDto): Promise<AiProviderDto> {
    const existing = await this.getOrThrow(id);
    const { apiKey, ...rest } = dto;
    if (rest.isEnabled === false && existing.isDefault) {
      throw new BadRequestException(
        'Cannot disable the default provider. Set another default first.',
      );
    }
    const provider = await this.prisma.aiProvider.update({
      where: { id },
      data: {
        ...rest,
        ...((rest.models || rest.defaultModel) && {
          models: this.normalizeModels(
            rest.defaultModel ?? existing.defaultModel,
            rest.models ?? existing.models,
          ),
        }),
        // Rotating the key resets health: we don't know if the new key works yet.
        ...(apiKey && {
          encryptedApiKey: this.encryption.encrypt(apiKey),
          apiKeyLast4: apiKey.slice(-4),
          healthStatus: 'UNKNOWN',
          lastHealthCheckAt: null,
        }),
      },
    });
    return this.toDto(provider);
  }

  async setEnabled(id: string, isEnabled: boolean): Promise<AiProviderDto> {
    return this.update(id, { isEnabled });
  }

  async remove(id: string): Promise<void> {
    const existing = await this.getOrThrow(id);
    if (existing.isDefault) {
      throw new BadRequestException(
        'Cannot delete the default provider. Set another default first.',
      );
    }
    // Conversations/messages keep their rows; provider_id becomes NULL (onDelete: SetNull).
    await this.prisma.aiProvider.delete({ where: { id } });
  }

  async setDefault(id: string): Promise<AiProviderDto> {
    const provider = await this.getOrThrow(id);
    if (!provider.isEnabled) {
      throw new BadRequestException(
        'Enable the provider before making it the default',
      );
    }
    // Two statements in one transaction: unset old default, set new one.
    // The partial unique index guarantees there's never more than one.
    const [, updated] = await this.prisma.$transaction([
      this.prisma.aiProvider.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      }),
      this.prisma.aiProvider.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
    return this.toDto(updated);
  }

  async healthCheck(id: string): Promise<HealthCheckResultDto> {
    const provider = await this.getOrThrow(id);
    const started = Date.now();
    let error: string | undefined;
    try {
      await this.adapters
        .get(provider.type)
        .healthCheck(
          this.encryption.decrypt(provider.encryptedApiKey),
          provider.baseUrl,
          AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
        );
    } catch (err) {
      error = (err as Error).message;
    }
    const checkedAt = new Date();
    const status = error ? 'UNHEALTHY' : 'HEALTHY';
    await this.prisma.aiProvider.update({
      where: { id },
      data: { healthStatus: status, lastHealthCheckAt: checkedAt },
    });
    return {
      providerId: id,
      status,
      latencyMs: Date.now() - started,
      error,
      checkedAt,
    };
  }

  async healthCheckAll(): Promise<HealthCheckResultDto[]> {
    const providers = await this.prisma.aiProvider.findMany({
      where: { isEnabled: true },
      select: { id: true },
    });
    // Run in parallel — total time ≈ slowest provider, not the sum.
    return Promise.all(providers.map((p) => this.healthCheck(p.id)));
  }

  // ───────────────────────── User-facing ─────────────────────────

  listAvailable(): Promise<AvailableProviderDto[]> {
    return this.prisma.aiProvider.findMany({
      where: { isEnabled: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        type: true,
        defaultModel: true,
        models: true,
        isDefault: true,
      },
    });
  }

  /**
   * Picks the provider for a chat request:
   *   explicit providerId → the conversation's previous provider → the default.
   * Validates the model against the provider's allow-list.
   */
  async resolve(opts: {
    providerId?: string | null;
    fallbackProviderId?: string | null;
    model?: string | null;
  }): Promise<ResolvedProvider> {
    let provider: AiProvider | null = null;

    if (opts.providerId) {
      provider = await this.prisma.aiProvider.findUnique({
        where: { id: opts.providerId },
      });
      if (!provider || !provider.isEnabled) {
        throw new BadRequestException('Selected AI provider is not available');
      }
    } else if (opts.fallbackProviderId) {
      provider = await this.prisma.aiProvider.findFirst({
        where: { id: opts.fallbackProviderId, isEnabled: true },
      });
    }
    provider ??= await this.prisma.aiProvider.findFirst({
      where: { isDefault: true, isEnabled: true },
    });
    if (!provider) {
      throw new ServiceUnavailableException(
        'No AI provider is currently available',
      );
    }

    const model = opts.model ?? provider.defaultModel;
    if (!provider.models.includes(model)) {
      throw new BadRequestException(
        `Model "${model}" is not available for ${provider.name}. Choose one of: ${provider.models.join(', ')}`,
      );
    }

    return {
      provider,
      apiKey: this.encryption.decrypt(provider.encryptedApiKey),
      model,
    };
  }

  // ───────────────────────── helpers ─────────────────────────

  private async getOrThrow(id: string) {
    const provider = await this.prisma.aiProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException('AI provider not found');
    return provider;
  }

  private normalizeModels(defaultModel: string, models: string[] = []) {
    return [...new Set([defaultModel, ...models])];
  }

  /** Strips the encrypted key: it never leaves the service layer. */
  private toDto(provider: AiProvider): AiProviderDto {
    const { encryptedApiKey: _omit, ...safe } = provider;
    return safe;
  }
}

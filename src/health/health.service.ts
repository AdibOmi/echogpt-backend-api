import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';

const { version } = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
) as { version: string };

const DB_TIMEOUT_MS = 3000;
const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  readonly version = version;

  /** Liveness + readiness in one: is the process up AND can it reach the DB? */
  async check() {
    const database = await this.pingDatabase();
    return {
      status: database.status === 'up' ? ('ok' as const) : ('error' as const),
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database },
    };
  }

  /** Detailed view for admins: never expose this publicly (it leaks internals). */
  async detailed() {
    const [basic, dbInfo, providers] = await Promise.all([
      this.check(),
      this.prisma.$queryRaw<
        { version: string; sizeBytes: bigint; connections: number }[]
      >`
          SELECT current_setting('server_version') AS version,
                 pg_database_size(current_database()) AS "sizeBytes",
                 (SELECT COUNT(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections`
        .then((r) => r[0])
        .catch(() => null),
      this.prisma.aiProvider.findMany({
        select: {
          name: true,
          type: true,
          isEnabled: true,
          isDefault: true,
          healthStatus: true,
          lastHealthCheckAt: true,
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    const mem = process.memoryUsage();
    return {
      ...basic,
      app: {
        version,
        environment: this.config.get<string>('NODE_ENV'),
        nodeVersion: process.version,
        pid: process.pid,
        aiMockResponses: this.config.get<boolean>('AI_MOCK_RESPONSES'),
        searchEngine: this.config.get<string>('SEARCH_ENGINE'),
      },
      memoryMb: {
        rss: mb(mem.rss),
        heapUsed: mb(mem.heapUsed),
        heapTotal: mb(mem.heapTotal),
      },
      database: dbInfo && {
        version: dbInfo.version,
        sizeMb: mb(Number(dbInfo.sizeBytes)),
        connections: dbInfo.connections,
      },
      aiProviders: providers,
    };
  }

  private async pingDatabase() {
    const started = performance.now();
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), DB_TIMEOUT_MS).unref(),
        ),
      ]);
      return {
        status: 'up' as const,
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      return { status: 'down' as const, error: (err as Error).message };
    }
  }
}

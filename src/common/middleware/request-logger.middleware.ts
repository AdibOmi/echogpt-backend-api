import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  requestContext,
  type RequestStore,
} from '../context/request-context.js';

const SKIP_PREFIXES = ['/api/v1/health'];

/**
 * Writes one row to api_usage_logs per API request.
 *
 * Why middleware and not an interceptor? Middleware runs FIRST, so it also
 * sees requests rejected by guards (401/403/429) — an interceptor never runs
 * for those, and failed auth attempts are exactly what you want in the logs.
 *
 * The DB write happens after the response is sent ('close' event) and is not
 * awaited, so logging adds no latency to the user's request.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly prisma: PrismaService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const path = req.originalUrl.split('?')[0];
    if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return next();

    const started = performance.now();
    const store: RequestStore = {};

    // 'close' fires for normal completion AND for aborted streams.
    res.once('close', () => {
      const durationMs = Math.round(performance.now() - started);
      const route = req.route?.path as string | undefined;
      this.logger.log(
        `${req.method} ${path} ${res.statusCode} ${durationMs}ms`,
      );
      void this.save({
        userId: req.user?.id ?? null,
        method: req.method,
        path: path.slice(0, 500),
        route: route ? `${req.baseUrl ?? ''}${route}`.slice(0, 200) : null,
        statusCode: res.statusCode,
        durationMs,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
        providerId: store.providerId ?? null,
        tokensUsed: store.tokens ?? null,
      });
    });

    requestContext.run(store, () => next());
  }

  private async save(data: Prisma.ApiUsageLogUncheckedCreateInput) {
    try {
      await this.prisma.apiUsageLog.create({ data });
    } catch {
      // e.g. the user (or provider) was deleted during this very request,
      // so the foreign key no longer exists — keep the log without the link.
      await this.prisma.apiUsageLog
        .create({ data: { ...data, userId: null, providerId: null } })
        .catch((err: Error) =>
          this.logger.warn(`Failed to write usage log: ${err.message}`),
        );
    }
  }
}

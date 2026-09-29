import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiAdmin } from '../common/decorators/api-errors.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { HealthService } from './health.service.js';

const HEALTH_EXAMPLE = {
  status: 'ok',
  timestamp: '2026-09-27T10:00:00.000Z',
  uptimeSeconds: 3600,
  checks: { database: { status: 'up', latencyMs: 2 } },
};

@ApiTags('System')
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @SkipThrottle()
  @Get('health')
  @ApiOperation({
    summary: 'Health check for load balancers / Docker / Kubernetes',
    description:
      'Returns 200 when the app and database are reachable, 503 otherwise.',
  })
  @ApiOkResponse({ schema: { example: HEALTH_EXAMPLE } })
  @ApiServiceUnavailableResponse({
    schema: {
      example: {
        ...HEALTH_EXAMPLE,
        status: 'error',
        checks: { database: { status: 'down', error: 'timeout' } },
      },
    },
  })
  async check(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.check();
    if (result.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }

  @Get('admin/system/health')
  @Roles('ADMIN')
  @ApiAdmin()
  @ApiTags('Admin · System')
  @ApiOperation({
    summary: 'Detailed system health',
    description:
      'App version, memory, database version/size/connections, and AI provider health.',
  })
  @ApiOkResponse({ description: 'Detailed health report' })
  detailed() {
    return this.health.detailed();
  }
}

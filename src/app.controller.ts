import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';
import { Public } from './common/decorators/public.decorator.js';

@ApiTags('System')
@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'API info' })
  @ApiOkResponse({
    schema: {
      example: {
        name: 'EchoGPT API',
        version: 'v1',
        docs: '/docs',
        health: '/api/v1/health',
      },
    },
  })
  getInfo() {
    return this.appService.getInfo();
  }
}

import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: 'EchoGPT API',
      version: 'v1',
      docs: '/docs',
      health: '/api/v1/health',
    };
  }
}

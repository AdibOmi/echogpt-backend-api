import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp, setupSwagger } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Behind a reverse proxy (nginx, load balancer) trust X-Forwarded-For so
  // req.ip is the real client IP — needed for rate limiting and request logs.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  configureApp(app);
  setupSwagger(app);

  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`API running on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`Swagger docs at http://localhost:${port}/docs`, 'Bootstrap');
}
await bootstrap();

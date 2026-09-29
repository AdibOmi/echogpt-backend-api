import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

/**
 * Global app configuration, shared by main.ts and the e2e tests so tests run
 * against exactly the same pipeline as production.
 */
export function configureApp(app: INestApplication) {
  // Security headers (X-Content-Type-Options, HSTS, etc.)
  app.use(helmet());

  // The Chrome extension calls us from a chrome-extension:// origin.
  app.enableCors({ origin: true, credentials: true });

  // All routes live under /api/v1/...
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Validate every incoming DTO against its class-validator decorators.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties that have no decorator
      forbidNonWhitelisted: true, // ...and reject the request if any were sent
      transform: true, // turn plain JSON into DTO class instances
    }),
  );

  // Lets Nest run onModuleDestroy hooks (e.g. close DB pool) on SIGTERM.
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('EchoGPT API')
    .setDescription(
      [
        'Backend REST API for the **EchoGPT** multi-AI chat Chrome extension.',
        '',
        '**Authentication:** call `POST /auth/login`, click **Authorize**, and paste the `accessToken`.',
        'Access tokens last 15 minutes; use `POST /auth/refresh` with the refresh token to get a new pair.',
        '',
        '**Errors** always have the shape `{ statusCode, error, message, path, timestamp }`.',
        '',
        'Seeded admin (development): `admin@echogpt.local` / `Admin@12345`',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addTag(
      'Auth',
      'Registration, login, token refresh, logout, email verification',
    )
    .addTag(
      'Users',
      'Current user profile, password, sessions, account deletion',
    )
    .addTag('Subscriptions', 'Plans, subscription status, upgrade/downgrade')
    .addTag('Usage', 'Daily quota and remaining requests')
    .addTag('AI Providers', 'Providers and models available to users')
    .addTag('Chat', 'Send prompts, stream responses, conversation history')
    .addTag(
      'Web Search',
      'AI-assisted search, history, recent searches, suggestions',
    )
    .addTag('System', 'API info and health checks')
    .addTag(
      'Admin · Dashboard & Analytics',
      'Statistics, usage analytics, request logs',
    )
    .addTag('Admin · Users', 'User management')
    .addTag('Admin · Subscriptions', 'Subscriptions and plan configuration')
    .addTag(
      'Admin · AI Providers',
      'Provider CRUD, keys, default selection, health checks',
    )
    .addTag('Admin · System', 'Detailed health, cache maintenance')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'EchoGPT API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      docExpansion: 'none',
      filter: true,
    },
  });
}

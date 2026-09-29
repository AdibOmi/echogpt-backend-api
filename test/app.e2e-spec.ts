/**
 * End-to-end tests: boot the real AppModule (real guards, pipes, filters and
 * database) and drive it over HTTP. Requires Postgres (`docker compose up -d`).
 */
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('EchoGPT API (e2e)', () => {
  let app: INestApplication<App>;
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'Str0ngPass';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.get(PrismaService).user.deleteMany({ where: { email } });
    await app.close();
  });

  it('GET /api/v1/health → 200 with database up', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(res.body.checks.database.status).toBe('up');
  });

  it('rejects protected routes without a token (401, consistent error shape)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .expect(401);
    expect(res.body).toMatchObject({
      statusCode: 401,
      path: '/api/v1/users/me',
    });
  });

  it('rejects unknown body fields (mass-assignment protection)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'x@example.com', password, role: 'ADMIN' })
      .expect(400);
    expect(res.body.message).toContain('property role should not exist');
  });

  it('register → me → usage → logout → token rejected', async () => {
    const server = app.getHttpServer();
    const reg = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'E2E' })
      .expect(201);
    const token = reg.body.tokens.accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };

    const me = await request(server)
      .get('/api/v1/users/me')
      .set(auth)
      .expect(200);
    expect(me.body).toMatchObject({
      email,
      role: 'USER',
      plan: { code: 'FREE' },
    });
    expect(me.body).not.toHaveProperty('passwordHash');

    const usage = await request(server)
      .get('/api/v1/usage/me')
      .set(auth)
      .expect(200);
    expect(usage.body).toMatchObject({
      plan: 'FREE',
      used: 0,
      remaining: usage.body.dailyLimit,
    });

    await request(server).post('/api/v1/auth/logout').set(auth).expect(200);
    await request(server).get('/api/v1/users/me').set(auth).expect(401);
  });

  it('forbids admin routes for normal users (403)', async () => {
    const server = app.getHttpServer();
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    await request(server)
      .get('/api/v1/admin/dashboard')
      .set({ Authorization: `Bearer ${login.body.tokens.accessToken}` })
      .expect(403);
  });
});

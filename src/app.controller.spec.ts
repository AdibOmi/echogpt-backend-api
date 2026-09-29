import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('returns API info with links to docs and health', () => {
    expect(appController.getInfo()).toMatchObject({
      name: 'EchoGPT API',
      docs: '/docs',
      health: '/api/v1/health',
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { GeminiService } from './../src/gemini/gemini.service';

describe('Meta Messenger Webhook (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.MESSENGER_VERIFY_TOKEN = 'e2e_verify_token';
    delete process.env.MESSENGER_APP_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GeminiService)
      .useValue({
        sendMessage: jest.fn().mockResolvedValue({
          text: 'Hello from mock Gemini AI',
          quickReplies: ['Help', 'Menu'],
        }),
        resetChat: jest.fn().mockReturnValue(true),
        getHistory: jest.fn().mockReturnValue([]),
      })
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    await app.init();
  });


  describe('GET /webhook', () => {
    it('should verify token and return challenge', () => {
      return request(app.getHttpServer())
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'e2e_verify_token',
          'hub.challenge': 'CHALLENGE_STRING_123',
        })
        .expect(200)
        .expect('CHALLENGE_STRING_123');
    });

    it('should return 403 Forbidden for invalid verify token', () => {
      return request(app.getHttpServer())
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong_token',
          'hub.challenge': 'CHALLENGE_STRING_123',
        })
        .expect(403);
    });
  });

  describe('POST /webhook', () => {
    it('should process valid Meta Messenger webhook event (object: "page")', () => {
      const payload = {
        object: 'page',
        entry: [
          {
            id: '12345',
            time: Date.now(),
            messaging: [
              {
                sender: { id: 'user_1' },
                recipient: { id: 'page_1' },
                timestamp: Date.now(),
                message: { mid: 'mid_1', text: 'Hello bot' },
              },
            ],
          },
        ],
      };

      return request(app.getHttpServer())
        .post('/webhook')
        .send(payload)
        .expect(200)
        .expect('EVENT_RECEIVED');
    });

    it('should reject non-Messenger payloads (object !== "page")', () => {
      const payload = {
        object: 'whatsapp',
        entry: [],
      };

      return request(app.getHttpServer())
        .post('/webhook')
        .send(payload)
        .expect(400);
    });
  });

  afterEach(async () => {
    await app.close();
  });
});

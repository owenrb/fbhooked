import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { MessengerController } from './messenger.controller';
import { MessengerService } from './messenger.service';
import { MessengerWebhookDto } from './dto/messenger-webhook.dto';

describe('MessengerController', () => {
  let controller: MessengerController;
  let messengerService: jest.Mocked<Partial<MessengerService>>;
  let configService: jest.Mocked<Partial<ConfigService>>;

  const mockVerifyToken = 'my_test_verify_token';

  beforeEach(async () => {
    messengerService = {
      handleWebhookEvent: jest.fn().mockResolvedValue(undefined),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'MESSENGER_VERIFY_TOKEN') return mockVerifyToken;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessengerController],
      providers: [
        { provide: MessengerService, useValue: messengerService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<MessengerController>(MessengerController);
  });

  describe('verifyWebhook (GET /webhook)', () => {
    it('should return challenge when token and mode match', () => {
      const challenge = '1234567890';
      const result = controller.verifyWebhook(
        'subscribe',
        mockVerifyToken,
        challenge,
      );
      expect(result).toBe(challenge);
    });

    it('should throw ForbiddenException if verify token does not match', () => {
      expect(() =>
        controller.verifyWebhook('subscribe', 'invalid_token', '12345'),
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if hub.mode is not subscribe', () => {
      expect(() =>
        controller.verifyWebhook('unsubscribe', mockVerifyToken, '12345'),
      ).toThrow(ForbiddenException);
    });
  });

  describe('handleWebhook (POST /webhook)', () => {
    it('should process messenger events and return EVENT_RECEIVED for valid object: "page"', async () => {
      const payload: MessengerWebhookDto = {
        object: 'page',
        entry: [
          {
            id: 'page_123',
            time: 123456,
            messaging: [
              {
                sender: { id: 'user_456' },
                recipient: { id: 'page_123' },
                timestamp: 123456,
                message: { mid: 'mid.1', text: 'Hello!' },
              },
            ],
          },
        ],
      };

      const result = await controller.handleWebhook(payload);
      expect(result).toBe('EVENT_RECEIVED');
      expect(messengerService.handleWebhookEvent).toHaveBeenCalledTimes(1);
      expect(messengerService.handleWebhookEvent).toHaveBeenCalledWith(
        payload.entry[0].messaging[0],
      );
    });

    it('should reject non-Messenger payloads (object !== "page")', async () => {
      const payload = {
        object: 'instagram',
        entry: [],
      } as unknown as MessengerWebhookDto;

      await expect(controller.handleWebhook(payload)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('setupGetStartedButton (POST /webhook/get-started)', () => {
    it('should call messengerService.setGetStartedButton', async () => {
      messengerService.setGetStartedButton = jest
        .fn()
        .mockResolvedValue({ result: 'success' });

      const result = await controller.setupGetStartedButton();
      expect(result).toEqual({ result: 'success' });
      expect(messengerService.setGetStartedButton).toHaveBeenCalled();
    });
  });
});

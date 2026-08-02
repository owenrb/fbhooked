import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MessengerService } from './messenger.service';
import { MessagingEvent } from './dto/messenger-webhook.dto';

describe('MessengerService', () => {
  let service: MessengerService;
  let configService: jest.Mocked<Partial<ConfigService>>;

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'MESSENGER_PAGE_ACCESS_TOKEN')
          return 'mock_page_access_token';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessengerService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<MessengerService>(MessengerService);
  });

  describe('handleWebhookEvent', () => {
    it('should handle text message without throwing errors', async () => {
      const event: MessagingEvent = {
        sender: { id: '123' },
        recipient: { id: '456' },
        timestamp: 10000,
        message: { mid: 'mid.1', text: 'Testing message' },
      };

      await expect(service.handleWebhookEvent(event)).resolves.not.toThrow();
    });

    it('should handle postback event without throwing errors', async () => {
      const event: MessagingEvent = {
        sender: { id: '123' },
        recipient: { id: '456' },
        timestamp: 10000,
        postback: { title: 'Get Started', payload: 'START_PAYLOAD' },
      };

      await expect(service.handleWebhookEvent(event)).resolves.not.toThrow();
    });
  });

  describe('sendCustomMessage', () => {
    it('should handle fetch API response when page access token is configured', async () => {
      const responseData = {
        recipient_id: '123',
        message_id: 'mid.mock123',
      };
      const mockFetchResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(responseData),
      };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse);

      const result = await service.sendTextMessage('123', 'Hello back!');
      expect(result).toEqual(responseData);
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should return error status if MESSENGER_PAGE_ACCESS_TOKEN is missing', async () => {
      (configService.get as jest.Mock).mockReturnValue(undefined);
      const result = await service.sendTextMessage('123', 'Hello');
      expect(result).toEqual({
        success: false,
        reason: 'MESSENGER_PAGE_ACCESS_TOKEN missing',
      });
    });
  });
});

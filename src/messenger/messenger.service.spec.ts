import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  MessengerService,
  START_CONVERSATION_PAYLOAD,
} from './messenger.service';
import { MessagingEvent } from './dto/messenger-webhook.dto';
import { GeminiService } from '../gemini/gemini.service';

describe('MessengerService', () => {
  let service: MessengerService;
  let configService: jest.Mocked<Partial<ConfigService>>;
  let geminiService: {
    sendMessage: jest.Mock;
    resetChat: jest.Mock;
    getHistory: jest.Mock;
  };

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'MESSENGER_PAGE_ACCESS_TOKEN')
          return 'mock_page_access_token';
        return undefined;
      }),
    };

    geminiService = {
      sendMessage: jest.fn().mockResolvedValue('Mock Gemini AI Response'),
      resetChat: jest.fn().mockReturnValue(true),
      getHistory: jest.fn().mockReturnValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessengerService,
        { provide: ConfigService, useValue: configService },
        { provide: GeminiService, useValue: geminiService },
      ],
    }).compile();

    service = module.get<MessengerService>(MessengerService);
  });

  describe('handleWebhookEvent', () => {
    it('should process text message, query Gemini AI, and send response back', async () => {
      const sendSpy = jest
        .spyOn(service, 'sendTextMessage')
        .mockResolvedValue({ recipient_id: '123', message_id: 'mid.1' });

      const event: MessagingEvent = {
        sender: { id: '123' },
        recipient: { id: '456' },
        timestamp: 10000,
        message: { mid: 'mid.1', text: 'What is the capital of France?' },
      };

      await service.handleWebhookEvent(event);

      expect(geminiService.sendMessage).toHaveBeenCalledWith(
        '123',
        'What is the capital of France?',
      );
      expect(sendSpy).toHaveBeenCalledWith('123', 'Mock Gemini AI Response');
    });

    it('should process quick reply payload, query Gemini AI, and send response back', async () => {
      const sendSpy = jest
        .spyOn(service, 'sendTextMessage')
        .mockResolvedValue({ recipient_id: '123', message_id: 'mid.1' });

      const event: MessagingEvent = {
        sender: { id: '123' },
        recipient: { id: '456' },
        timestamp: 10000,
        message: {
          mid: 'mid.1',
          quick_reply: { payload: 'Tell me a joke' },
        },
      };

      await service.handleWebhookEvent(event);

      expect(geminiService.sendMessage).toHaveBeenCalledWith(
        '123',
        'Tell me a joke',
      );
      expect(sendSpy).toHaveBeenCalledWith('123', 'Mock Gemini AI Response');
    });

    it('should handle postback event without throwing errors', async () => {
      const event: MessagingEvent = {
        sender: { id: '123' },
        recipient: { id: '456' },
        timestamp: 10000,
        postback: { title: 'Other Action', payload: 'OTHER_PAYLOAD' },
      };

      await expect(service.handleWebhookEvent(event)).resolves.not.toThrow();
    });

    it('should handle START_CONVERSATION postback, reset chat session, and send welcome message', async () => {
      const event: MessagingEvent = {
        sender: { id: '123' },
        recipient: { id: '456' },
        timestamp: 10000,
        postback: {
          title: 'Get Started',
          payload: START_CONVERSATION_PAYLOAD,
        },
      };

      const sendSpy = jest
        .spyOn(service, 'sendTextMessage')
        .mockResolvedValue({ recipient_id: '123', message_id: 'mid.1' });

      await service.handleWebhookEvent(event);

      expect(geminiService.resetChat).toHaveBeenCalledWith('123');
      expect(sendSpy).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('Welcome!'),
      );
    });
  });

  describe('setGetStartedButton', () => {
    it('should call Graph API to set get_started profile setting', async () => {
      const mockResponse = { result: 'success' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.setGetStartedButton();

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/me/messenger_profile?access_token=mock_page_access_token',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            get_started: { payload: START_CONVERSATION_PAYLOAD },
          }),
        }),
      );
    });

    it('should return error if MESSENGER_PAGE_ACCESS_TOKEN is missing', async () => {
      (configService.get as jest.Mock).mockReturnValue(undefined);

      const result = await service.setGetStartedButton();

      expect(result).toEqual({
        success: false,
        reason: 'MESSENGER_PAGE_ACCESS_TOKEN missing',
      });
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

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  MessengerService,
  START_CONVERSATION_PAYLOAD,
  splitMessage,
  formatQuickReplies,
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
      sendMessage: jest.fn().mockResolvedValue({
        text: 'Mock Gemini AI Response',
        quickReplies: ['Help', 'Menu'],
      }),
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
    it('should process text message, query Gemini AI, and send response back with quick replies', async () => {
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
      expect(sendSpy).toHaveBeenCalledWith('123', 'Mock Gemini AI Response', [
        'Help',
        'Menu',
      ]);
    });

    it('should deduplicate repeated incoming messages with the same mid', async () => {
      const sendSpy = jest
        .spyOn(service, 'sendTextMessage')
        .mockResolvedValue({ recipient_id: '123', message_id: 'mid.out' });

      const event: MessagingEvent = {
        sender: { id: '123' },
        recipient: { id: '456' },
        timestamp: 10000,
        message: { mid: 'mid.duplicate_test', text: 'Hello repeated' },
      };

      await service.handleWebhookEvent(event);
      await service.handleWebhookEvent(event);

      expect(geminiService.sendMessage).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it('should dispatch carousel template when Gemini returns carousel cards', async () => {
      geminiService.sendMessage.mockResolvedValue({
        text: 'Here are available plumbers:',
        carousel: [
          {
            title: 'Plumber 1',
            subtitle: 'Pasig area',
            buttons: [{ type: 'postback', title: 'Inquire', payload: 'INQ_1' }],
          },
        ],
        quickReplies: ['More Info'],
      });

      const textSpy = jest
        .spyOn(service, 'sendTextMessage')
        .mockResolvedValue({ recipient_id: '123' });
      const carouselSpy = jest
        .spyOn(service, 'sendCarousel')
        .mockResolvedValue({ recipient_id: '123' });

      const event: MessagingEvent = {
        sender: { id: '123' },
        recipient: { id: '456' },
        timestamp: 10000,
        message: { mid: 'mid.1', text: 'Plumber near Pasig' },
      };

      await service.handleWebhookEvent(event);

      expect(textSpy).toHaveBeenCalledWith(
        '123',
        'Here are available plumbers:',
      );
      expect(carouselSpy).toHaveBeenCalledWith(
        '123',
        expect.arrayContaining([
          expect.objectContaining({ title: 'Plumber 1' }),
        ]),
        ['More Info'],
      );
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
      expect(sendSpy).toHaveBeenCalledWith('123', 'Mock Gemini AI Response', [
        'Help',
        'Menu',
      ]);
    });

    it('should handle custom postback by passing payload to Gemini', async () => {
      const event: MessagingEvent = {
        sender: { id: '123' },
        recipient: { id: '456' },
        timestamp: 10000,
        postback: { title: 'Select Service', payload: 'SELECT_SERVICE_A' },
      };

      await service.handleWebhookEvent(event);
      expect(geminiService.sendMessage).toHaveBeenCalledWith(
        '123',
        'Select Service',
      );
    });

    it('should handle START_CONVERSATION postback, reset chat session, and send welcome message with quick replies', async () => {
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
        ['Services', 'Contact Us', 'Help'],
      );
    });
  });

  describe('sendCarousel', () => {
    it('should construct generic template payload and call Graph API', async () => {
      const responseData = { recipient_id: '123', message_id: 'mid.card1' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(responseData),
      });

      const elements = [
        {
          title: 'Service A',
          subtitle: 'Affordable plumbing',
          buttons: [
            { type: 'postback' as const, title: 'Book', payload: 'BOOK_A' },
          ],
        },
      ];

      const result = await service.sendCarousel('123', elements, ['Back']);

      expect(result).toEqual(responseData);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/me/messages?access_token=mock_page_access_token',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            messaging_type: 'RESPONSE',
            recipient: { id: '123' },
            message: {
              attachment: {
                type: 'template',
                payload: {
                  template_type: 'generic',
                  elements,
                },
              },
              quick_replies: [
                {
                  content_type: 'text',
                  title: 'Back',
                  payload: 'BACK',
                },
              ],
            },
          }),
        }),
      );
    });
  });

  describe('sendTextMessage', () => {
    it('should split long messages exceeding 2000 characters and attach quick replies to last chunk', async () => {
      const responseData = {
        recipient_id: '123',
        message_id: 'mid.mock123',
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(responseData),
      });

      const longMessage = 'A'.repeat(1500) + '\n\n' + 'B'.repeat(1500);
      const result = await service.sendTextMessage('123', longMessage, [
        'Option',
      ]);

      expect(result).toEqual(responseData);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('formatQuickReplies', () => {
    it('should format string array into Meta quick reply objects', () => {
      const formatted = formatQuickReplies(['Option 1', 'Option 2']);
      expect(formatted).toEqual([
        {
          content_type: 'text',
          title: 'Option 1',
          payload: 'OPTION_1',
        },
        {
          content_type: 'text',
          title: 'Option 2',
          payload: 'OPTION_2',
        },
      ]);
    });

    it('should return undefined for empty or invalid input', () => {
      expect(formatQuickReplies([])).toBeUndefined();
      expect(formatQuickReplies(undefined)).toBeUndefined();
    });
  });

  describe('splitMessage', () => {
    it('should not split text shorter than or equal to maxLength', () => {
      const text = 'Short message';
      expect(splitMessage(text, 2000)).toEqual([text]);
    });

    it('should split at paragraph breaks when text exceeds maxLength', () => {
      const part1 = 'Paragraph 1 '.repeat(50);
      const part2 = 'Paragraph 2 '.repeat(50);
      const fullText = `${part1}\n\n${part2}`;
      const chunks = splitMessage(fullText, 400);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(400);
      }
    });

    it('should handle hard splits when no whitespace exists', () => {
      const longWord = 'X'.repeat(500);
      const chunks = splitMessage(longWord, 200);

      expect(chunks.length).toBe(3);
      expect(chunks[0].length).toBe(200);
      expect(chunks[1].length).toBe(200);
      expect(chunks[2].length).toBe(100);
    });
  });
});

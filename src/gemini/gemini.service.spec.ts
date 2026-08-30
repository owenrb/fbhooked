import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  GeminiService,
  cleanMarkdownForMessenger,
  parseGeminiResponse,
  sanitizeCarouselElements,
} from './gemini.service';

const mockSendMessage = jest.fn();
const mockGetHistory = jest.fn();
const mockChatsCreate = jest.fn().mockImplementation(() => ({
  sendMessage: mockSendMessage,
  getHistory: mockGetHistory,
}));

jest.mock('@google/genai', () => {
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      chats: {
        create: mockChatsCreate,
      },
    })),
  };
});

describe('GeminiService', () => {
  let service: GeminiService;
  let configService: jest.Mocked<Partial<ConfigService>>;

  beforeEach(async () => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'GEMINI_API_KEY') return 'test-gemini-key';
        if (key === 'GEMINI_MODEL') return 'gemini-3.6-flash';
        if (key === 'GEMINI_SYSTEM_INSTRUCTION')
          return 'Custom prompt for tests';
        if (key === 'GEMINI_SESSION_TTL_MS') return '60000';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<GeminiService>(GeminiService);
  });

  it('should be defined and initialized with GoogleGenAI', () => {
    expect(service).toBeDefined();
  });

  describe('sendMessage', () => {
    it('should parse structured JSON carousel response from Gemini', async () => {
      const geminiJson = JSON.stringify({
        text: 'Here are available plumbers:',
        carousel: [
          {
            title: 'Plumber A',
            subtitle: 'Emergency leak repair',
            buttons: [
              {
                type: 'phone_number',
                title: 'Call',
                payload: '+639123456789',
              },
            ],
          },
        ],
        quickReplies: ['Help', 'Menu'],
      });

      mockSendMessage.mockResolvedValue({
        text: `\`\`\`json\n${geminiJson}\n\`\`\``,
      });

      const response = await service.sendMessage('user_123', 'Need plumber');

      expect(response.text).toBe('Here are available plumbers:');
      expect(response.carousel).toHaveLength(1);
      expect(response.carousel?.[0].title).toBe('Plumber A');
      expect(response.quickReplies).toEqual(['Help', 'Menu']);
    });

    it('should clean markdown in plain text responses', async () => {
      mockSendMessage.mockResolvedValue({
        text: '### Hello!\n**We are here** to help with [Our Site](https://example.com).',
      });

      const response = await service.sendMessage('user_123', 'Hello');

      expect(response.text).toContain('Hello!:');
      expect(response.text).toContain('We are here to help');
      expect(response.text).toContain('Our Site (https://example.com)');
      expect(response.text).not.toContain('**');
      expect(response.text).not.toContain('###');
    });

    it('should handle API errors gracefully and return fallback message', async () => {
      mockSendMessage.mockRejectedValue(new Error('API quota exceeded'));

      const response = await service.sendMessage('user_123', 'Hello!');

      expect(response.text).toContain('error processing your request');
    });

    it('should handle empty responses gracefully', async () => {
      mockSendMessage.mockResolvedValue({});

      const response = await service.sendMessage('user_123', 'Hello!');

      expect(response.text).toContain("couldn't generate a response");
    });
  });

  describe('cleanMarkdownForMessenger', () => {
    it('should convert markdown links to readable format', () => {
      const input = 'Visit [Google](https://google.com) for info.';
      expect(cleanMarkdownForMessenger(input)).toBe(
        'Visit Google (https://google.com) for info.',
      );
    });

    it('should strip bold and italic markers', () => {
      const input = 'This is **bold**, *italic*, and __bold2__.';
      expect(cleanMarkdownForMessenger(input)).toBe(
        'This is bold, italic, and bold2.',
      );
    });

    it('should convert bullet points to unicode dots', () => {
      const input = '- Item 1\n* Item 2\n+ Item 3';
      expect(cleanMarkdownForMessenger(input)).toBe(
        '• Item 1\n• Item 2\n• Item 3',
      );
    });

    it('should convert markdown headers', () => {
      const input = '### Services Offered\nWe do repair.';
      expect(cleanMarkdownForMessenger(input)).toBe(
        'Services Offered:\nWe do repair.',
      );
    });
  });

  describe('parseGeminiResponse', () => {
    it('should parse markdown list into carousel when 2 or more items are present', () => {
      const markdownList = `
1. **Pasig Plumber**: 24/7 leak detection & repair
2. **Metro Manila Master**: Pipe replacement & clearing
`;
      const result = parseGeminiResponse(markdownList);

      expect(result.carousel).toBeDefined();
      expect(result.carousel?.length).toBe(2);
      expect(result.carousel?.[0].title).toBe('Pasig Plumber');
      expect(result.carousel?.[0].subtitle).toBe(
        '24/7 leak detection & repair',
      );
    });
  });

  describe('sanitizeCarouselElements', () => {
    it('should enforce 80 char title limit and 20 char button limit', () => {
      const rawElements = [
        {
          title: 'A'.repeat(100),
          subtitle: 'B'.repeat(120),
          buttons: [
            {
              type: 'postback',
              title: 'Very Long Button Title Exceeding Limit',
              payload: 'ACTION',
            },
          ],
        },
      ];

      const sanitized = sanitizeCarouselElements(rawElements);

      expect(sanitized[0].title.length).toBe(80);
      expect(sanitized[0].subtitle?.length).toBe(80);
      expect(sanitized[0].buttons?.[0].title.length).toBe(20);
    });
  });

  describe('without API key', () => {
    it('should return friendly error message if GEMINI_API_KEY is not configured', async () => {
      const unconfiguredConfigService = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GeminiService,
          { provide: ConfigService, useValue: unconfiguredConfigService },
        ],
      }).compile();

      const unconfiguredService = module.get<GeminiService>(GeminiService);
      const response = await unconfiguredService.sendMessage(
        'user_123',
        'Hello',
      );

      expect(response.text).toContain('AI chat is currently unavailable');
    });
  });
});

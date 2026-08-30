import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  AiService,
  cleanMarkdownForMessenger,
  parseAiResponse,
  sanitizeCarouselElements,
} from './ai.service';

interface MockCompletionParams {
  model: string;
  messages: unknown[];
}

const mockCreate = jest.fn<Promise<unknown>, [MockCompletionParams]>();

jest.mock('openai', () => {
  return {
    AzureOpenAI: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

describe('AiService', () => {
  let service: AiService;
  let configService: jest.Mocked<Partial<ConfigService>>;

  beforeEach(async () => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'AZURE_OPENAI_ENDPOINT')
          return 'https://owen-foundry.openai.azure.com/';
        if (key === 'AZURE_OPENAI_API_KEY') return 'test-azure-key';
        if (key === 'AZURE_OPENAI_DEPLOYMENT') return 'gpt-5-mini';
        if (key === 'AZURE_OPENAI_API_VERSION') return '2024-10-21';
        if (key === 'AZURE_OPENAI_SESSION_TTL_MS') return '60000';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  it('should be defined and initialized with AzureOpenAI', () => {
    expect(service).toBeDefined();
  });

  describe('sendMessage', () => {
    it('should send user message, append to conversation history, and parse JSON carousel', async () => {
      const azureJson = JSON.stringify({
        text: 'Here are available plumbers in Pasig:',
        carousel: [
          {
            title: 'Pasig Plumbing Pro',
            subtitle: 'Emergency repairs in Pasig',
            buttons: [
              {
                type: 'phone_number',
                title: 'Call Now',
                payload: '+639123456789',
              },
            ],
          },
        ],
        quickReplies: ['Help', 'Menu'],
      });

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: `\`\`\`json\n${azureJson}\n\`\`\``,
            },
          },
        ],
      });

      const response = await service.sendMessage(
        'user_123',
        'Need plumber in Pasig',
      );

      expect(response.text).toBe('Here are available plumbers in Pasig:');
      expect(response.carousel).toHaveLength(1);
      expect(response.carousel?.[0].title).toBe('Pasig Plumbing Pro');
      expect(response.quickReplies).toEqual(['Help', 'Menu']);

      expect(mockCreate).toHaveBeenCalled();
      const calls = mockCreate.mock.calls;
      const firstCall = calls[0];
      expect(firstCall?.[0]?.model).toBe('gpt-5-mini');
      expect(Array.isArray(firstCall?.[0]?.messages)).toBe(true);
    });

    it('should maintain multi-turn history across consecutive calls', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify({ text: 'Hello Owen' }) } },
        ],
      });
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: JSON.stringify({ text: 'Your name is Owen' }) },
          },
        ],
      });

      await service.sendMessage('user_123', 'My name is Owen');
      await service.sendMessage('user_123', 'What is my name?');

      const history = service.getHistory('user_123');
      expect(history.length).toBe(5); // system + user1 + assistant1 + user2 + assistant2
      expect(history[1].content).toBe('My name is Owen');
      expect(history[3].content).toBe('What is my name?');
    });

    it('should handle API errors gracefully and return fallback message', async () => {
      mockCreate.mockRejectedValue(
        new Error('Azure OpenAI rate limit exceeded'),
      );

      const response = await service.sendMessage('user_123', 'Hello!');

      expect(response.text).toContain('error processing your request');
    });

    it('should handle empty responses gracefully', async () => {
      mockCreate.mockResolvedValue({ choices: [] });

      const response = await service.sendMessage('user_123', 'Hello!');

      expect(response.text).toContain("couldn't generate a response");
    });
  });

  describe('cleanMarkdownForMessenger', () => {
    it('should convert markdown links to readable format', () => {
      const input =
        'Visit [Foundry](https://owen-foundry.openai.azure.com/) for info.';
      expect(cleanMarkdownForMessenger(input)).toBe(
        'Visit Foundry (https://owen-foundry.openai.azure.com/) for info.',
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
      const input = '### Plumbing Services\nAvailable 24/7.';
      expect(cleanMarkdownForMessenger(input)).toBe(
        'Plumbing Services:\nAvailable 24/7.',
      );
    });
  });

  describe('parseAiResponse', () => {
    it('should parse markdown list into carousel when 2 or more items are present', () => {
      const markdownList = `
1. **Pasig Plumber**: 24/7 leak detection & repair
2. **Metro Manila Master**: Pipe replacement & clearing
`;
      const result = parseAiResponse(markdownList);

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

  describe('resetChat', () => {
    it('should clear session history', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hi' } }],
      });

      await service.sendMessage('user_123', 'Hello');
      expect(service.hasSession('user_123')).toBe(true);

      const reset = service.resetChat('user_123');
      expect(reset).toBe(true);
      expect(service.hasSession('user_123')).toBe(false);
      expect(service.getHistory('user_123')).toEqual([]);
    });
  });

  describe('without API key', () => {
    it('should return friendly error message if AZURE_OPENAI_API_KEY is not configured', async () => {
      const unconfiguredConfigService = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiService,
          { provide: ConfigService, useValue: unconfiguredConfigService },
        ],
      }).compile();

      const unconfiguredService = module.get<AiService>(AiService);
      const response = await unconfiguredService.sendMessage(
        'user_123',
        'Hello',
      );

      expect(response.text).toContain('AI chat is currently unavailable');
    });
  });
});

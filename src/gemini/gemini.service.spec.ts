import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from './gemini.service';

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
          return 'You are a helpful assistant.';
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
    it('should create a chat session and send a message returning response text', async () => {
      mockSendMessage.mockResolvedValue({
        text: 'Hello, I am Gemini AI!',
      });

      const response = await service.sendMessage('user_123', 'Hello!');

      expect(response).toBe('Hello, I am Gemini AI!');
      expect(mockChatsCreate).toHaveBeenCalledWith({
        model: 'gemini-3.6-flash',
        config: {
          systemInstruction: 'You are a helpful assistant.',
        },
      });
      expect(mockSendMessage).toHaveBeenCalledWith({ message: 'Hello!' });
    });

    it('should reuse existing chat session for multi-turn conversations', async () => {
      mockSendMessage.mockResolvedValueOnce({ text: 'Response 1' });
      mockSendMessage.mockResolvedValueOnce({ text: 'Response 2' });

      await service.sendMessage('user_123', 'First message');
      await service.sendMessage('user_123', 'Second message');

      expect(mockChatsCreate).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockSendMessage).toHaveBeenNthCalledWith(1, {
        message: 'First message',
      });
      expect(mockSendMessage).toHaveBeenNthCalledWith(2, {
        message: 'Second message',
      });
    });

    it('should handle API errors gracefully and return fallback message', async () => {
      mockSendMessage.mockRejectedValue(new Error('API quota exceeded'));

      const response = await service.sendMessage('user_123', 'Hello!');

      expect(response).toContain('error processing your request');
    });

    it('should handle empty responses gracefully', async () => {
      mockSendMessage.mockResolvedValue({});

      const response = await service.sendMessage('user_123', 'Hello!');

      expect(response).toContain("couldn't generate a response");
    });
  });

  describe('resetChat', () => {
    it('should delete existing session and start a new one on next message', async () => {
      mockSendMessage.mockResolvedValue({ text: 'Reply' });

      await service.sendMessage('user_123', 'Message 1');
      expect(service.hasSession('user_123')).toBe(true);

      const resetResult = service.resetChat('user_123');
      expect(resetResult).toBe(true);
      expect(service.hasSession('user_123')).toBe(false);

      await service.sendMessage('user_123', 'Message 2');
      expect(mockChatsCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('getHistory', () => {
    it('should return history from chat instance', async () => {
      const mockHistory = [
        { role: 'user', parts: [{ text: 'Hi' }] },
        { role: 'model', parts: [{ text: 'Hello' }] },
      ];
      mockGetHistory.mockReturnValue(mockHistory);
      mockSendMessage.mockResolvedValue({ text: 'Hello' });

      await service.sendMessage('user_123', 'Hi');
      const history = service.getHistory('user_123');

      expect(history).toEqual(mockHistory);
    });

    it('should return empty array if session does not exist', () => {
      expect(service.getHistory('non_existent')).toEqual([]);
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

      expect(response).toContain('AI chat is currently unavailable');
    });
  });
});

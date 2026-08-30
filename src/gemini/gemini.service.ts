import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenAI,
  Chat,
  Content,
  GenerateContentConfig,
} from '@google/genai';

export interface ChatSession {
  chat: Chat;
  lastActive: number;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly ai: GoogleGenAI | null = null;
  private readonly sessions = new Map<string, ChatSession>();

  private readonly modelName: string;
  private readonly systemInstruction?: string;
  private readonly sessionTtlMs: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.modelName =
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-3.6-flash';
    this.systemInstruction = this.configService.get<string>(
      'GEMINI_SYSTEM_INSTRUCTION',
    );
    this.sessionTtlMs =
      Number(this.configService.get<string>('GEMINI_SESSION_TTL_MS')) ||
      30 * 60 * 1000; // 30 minutes default

    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
      this.logger.log(
        `GeminiService initialized with model: "${this.modelName}"`,
      );
    } else {
      this.logger.warn(
        'GEMINI_API_KEY is not configured. Gemini multi-turn chat will be disabled.',
      );
    }
  }

  /**
   * Get an existing chat session or create a new multi-turn conversation session
   */
  getOrCreateChat(sessionId: string): Chat {
    if (!this.ai) {
      throw new Error('Gemini API client is not initialized (missing API key)');
    }

    this.cleanExpiredSessions();

    const existingSession = this.sessions.get(sessionId);
    const now = Date.now();

    if (
      existingSession &&
      now - existingSession.lastActive < this.sessionTtlMs
    ) {
      existingSession.lastActive = now;
      return existingSession.chat;
    }

    const config: GenerateContentConfig = {};
    if (this.systemInstruction) {
      config.systemInstruction = this.systemInstruction;
    }

    const newChat = this.ai.chats.create({
      model: this.modelName,
      config: Object.keys(config).length > 0 ? config : undefined,
    });

    this.sessions.set(sessionId, {
      chat: newChat,
      lastActive: now,
    });

    this.logger.log(`Created new Gemini chat session for: "${sessionId}"`);
    return newChat;
  }

  /**
   * Send a message to Gemini in the context of the user's multi-turn conversation
   */
  async sendMessage(sessionId: string, message: string): Promise<string> {
    if (!this.ai) {
      this.logger.warn('Gemini API is not configured. Cannot process message.');
      return 'Sorry, AI chat is currently unavailable. Please check the server configuration.';
    }

    try {
      const chat = this.getOrCreateChat(sessionId);
      const response = await chat.sendMessage({ message });
      const replyText = response.text;

      if (!replyText) {
        this.logger.warn(
          `Empty text response received from Gemini for session "${sessionId}"`,
        );
        return "I'm sorry, I couldn't generate a response. Please try again.";
      }

      return replyText;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error sending message to Gemini for session "${sessionId}": ${errorMessage}`,
      );
      return 'Sorry, I encountered an error processing your request. Please try again later.';
    }
  }

  /**
   * Reset / clear chat session history for a user
   */
  resetChat(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);
    if (existed) {
      this.logger.log(`Reset Gemini chat session for: "${sessionId}"`);
    }
    return existed;
  }

  /**
   * Retrieve conversation history for a given session
   */
  getHistory(sessionId: string): Content[] {
    const session = this.sessions.get(sessionId);
    if (!session || !session.chat) {
      return [];
    }
    return session.chat.getHistory();
  }

  /**
   * Check if a session currently exists in memory
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Clean up sessions that have been inactive longer than sessionTtlMs
   */
  cleanExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActive >= this.sessionTtlMs) {
        this.sessions.delete(sessionId);
        this.logger.log(`Cleaned up expired Gemini session: "${sessionId}"`);
      }
    }
  }
}

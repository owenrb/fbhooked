import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AzureOpenAI } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface GenericTemplateButton {
  type: 'web_url' | 'postback' | 'phone_number';
  title: string;
  url?: string;
  payload?: string;
}

export interface GenericTemplateElement {
  title: string;
  subtitle?: string;
  image_url?: string;
  buttons?: GenericTemplateButton[];
}

export interface AiBotResponse {
  text?: string;
  carousel?: GenericTemplateElement[];
  quickReplies?: string[];
}

export interface ChatSession {
  messages: ChatCompletionMessageParam[];
  lastActive: number;
}

interface RawCarouselButton {
  type?: string;
  title?: string;
  label?: string;
  url?: string;
  payload?: string;
  number?: string;
  phone?: string;
  action?: string;
}

interface RawCarouselElement {
  title?: string;
  name?: string;
  subtitle?: string;
  description?: string;
  details?: string;
  imageUrl?: string;
  image_url?: string;
  buttons?: RawCarouselButton[];
}

interface RawAiOutput {
  text?: string;
  carousel?: RawCarouselElement[];
  quickReplies?: string[];
}

export const DEFAULT_MESSENGER_SYSTEM_INSTRUCTION = `You are a smart, professional, and friendly AI assistant for a Facebook Messenger page powered by Azure OpenAI (gpt-5-mini).

IMPORTANT FORMATTING RULES FOR FACEBOOK MESSENGER:
1. Facebook Messenger does NOT support markdown headers (###), bold asterisks (**text**), or raw markdown link syntax ([text](url)). Always write human-readable plain text without broken markdown symbols.
2. If your response contains a list of items, recommendations, services, products, options, places, or steps, ALWAYS structure your output as a scrollable carousel using JSON:
{
  "text": "Introductory message in plain text (no markdown)",
  "carousel": [
    {
      "title": "Item Name (max 80 chars)",
      "subtitle": "Short details / pricing / location (max 80 chars)",
      "imageUrl": "https://optional-valid-image-url",
      "buttons": [
        { "type": "postback", "title": "Inquire", "payload": "INQUIRE_ITEM_NAME" },
        { "type": "phone_number", "title": "Call", "payload": "+639123456789" },
        { "type": "web_url", "title": "Visit", "url": "https://example.com" }
      ]
    }
  ],
  "quickReplies": ["Quick Option 1", "Quick Option 2"]
}
3. If the user's message is a general conversation, question, or inquiry that is NOT a list, return JSON:
{
  "text": "Direct, helpful, and friendly plain text response.",
  "quickReplies": ["Suggested Follow-up 1", "Suggested Follow-up 2"]
}
4. Constraints:
- Max 10 items in carousel.
- Carousel title & subtitle: maximum 80 characters.
- Buttons per card: maximum 3 buttons.
- Button title: maximum 20 characters.
- Quick replies: maximum 13 options, each title maximum 20 characters.
- Always output valid JSON.`;

/**
 * Clean markdown artifacts from text so it displays cleanly in Facebook Messenger
 */
export function cleanMarkdownForMessenger(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // Convert markdown links [title](url) -> title: url
  cleaned = cleaned.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');

  // Convert headers (### Header) -> HEADER
  cleaned = cleaned.replace(
    /^#{1,6}\s*(.+)$/gm,
    (_match, headerText: string) => {
      return `${headerText.trim()}:`;
    },
  );

  // Remove bold and italic markers: **bold**, *italic*, __bold__, _italic_
  cleaned = cleaned.replace(/(\*\*|__)(.*?)\1/g, '$2');
  cleaned = cleaned.replace(/(\*|_)(.*?)\1/g, '$2');

  // Convert code blocks ```code``` -> code
  cleaned = cleaned.replace(/```[a-z]*\n([\s\S]*?)\n```/g, '$1');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  // Normalize bullet points to clean unicode bullet
  cleaned = cleaned.replace(/^[*+-]\s+/gm, '• ');

  // Normalize excessive newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/**
 * Sanitize carousel elements to strictly adhere to Meta Messenger platform constraints
 */
export function sanitizeCarouselElements(
  elements: RawCarouselElement[],
): GenericTemplateElement[] {
  if (!Array.isArray(elements)) return [];

  const sanitized: GenericTemplateElement[] = [];

  for (const el of elements.slice(0, 10)) {
    if (!el || typeof el !== 'object') continue;

    const rawTitle = el.title || el.name || 'Details';
    const title = cleanMarkdownForMessenger(rawTitle).slice(0, 80);

    const rawSubtitle = el.subtitle || el.description || el.details || '';
    const subtitle = rawSubtitle
      ? cleanMarkdownForMessenger(rawSubtitle).slice(0, 80)
      : undefined;

    const imageUrl = el.imageUrl || el.image_url;
    const validImageUrl =
      typeof imageUrl === 'string' && imageUrl.startsWith('http')
        ? imageUrl
        : undefined;

    const buttons: GenericTemplateButton[] = [];
    if (Array.isArray(el.buttons)) {
      for (const btn of el.buttons.slice(0, 3)) {
        if (!btn || typeof btn !== 'object') continue;
        const btnTitle = cleanMarkdownForMessenger(
          btn.title || btn.label || 'Select',
        ).slice(0, 20);

        if (btn.type === 'web_url' && typeof btn.url === 'string') {
          buttons.push({ type: 'web_url', title: btnTitle, url: btn.url });
        } else if (
          btn.type === 'phone_number' &&
          typeof (btn.payload || btn.number || btn.phone) === 'string'
        ) {
          const number = String(btn.payload || btn.number || btn.phone);
          buttons.push({
            type: 'phone_number',
            title: btnTitle,
            payload: number,
          });
        } else {
          const payload = String(
            btn.payload || btn.action || `SELECT_${title.slice(0, 30)}`,
          );
          buttons.push({
            type: 'postback',
            title: btnTitle,
            payload: payload.slice(0, 1000),
          });
        }
      }
    }

    sanitized.push({
      title,
      subtitle: subtitle || undefined,
      image_url: validImageUrl,
      buttons: buttons.length > 0 ? buttons : undefined,
    });
  }

  return sanitized;
}

/**
 * Parse raw AI output into structured text, carousel cards, and quick replies
 */
export function parseAiResponse(rawText: string): AiBotResponse {
  if (!rawText || rawText.trim().length === 0) {
    return {
      text: "I'm sorry, I couldn't generate a response. Please try again.",
    };
  }

  let textToParse = rawText.trim();

  // Strip ```json ... ``` code fence if present
  const jsonBlockMatch = textToParse.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch) {
    textToParse = jsonBlockMatch[1].trim();
  }

  // Attempt JSON parsing
  try {
    const parsed = JSON.parse(textToParse) as RawAiOutput;
    if (parsed && typeof parsed === 'object') {
      const result: AiBotResponse = {};

      if (parsed.text && typeof parsed.text === 'string') {
        result.text = cleanMarkdownForMessenger(parsed.text);
      }

      if (Array.isArray(parsed.carousel) && parsed.carousel.length > 0) {
        result.carousel = sanitizeCarouselElements(parsed.carousel);
      }

      if (
        Array.isArray(parsed.quickReplies) &&
        parsed.quickReplies.length > 0
      ) {
        result.quickReplies = parsed.quickReplies
          .filter((q): q is string => typeof q === 'string')
          .map((q) => cleanMarkdownForMessenger(q).slice(0, 20))
          .slice(0, 13);
      }

      if (result.text || (result.carousel && result.carousel.length > 0)) {
        return result;
      }
    }
  } catch {
    // Fall through to fallback text/markdown parsing
  }

  // Fallback: Check if response has structured markdown list that can be converted to carousel
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const listItems: { title: string; subtitle: string }[] = [];

  for (const line of lines) {
    // Match "1. **Title**: Description" or "• **Title** - Description"
    const match = line.match(
      /^(?:(?:\d+[.)]|[•*-])\s*)(?:\*\*([^*]+)\*\*|__([^_]+)__)(?:\s*[:-–]\s*)(.+)$/,
    );
    if (match) {
      const title = (match[1] || match[2] || '').trim();
      const subtitle = match[3].trim();
      if (title && subtitle) {
        listItems.push({ title, subtitle });
      }
    }
  }

  if (listItems.length >= 2) {
    const carousel = sanitizeCarouselElements(
      listItems.slice(0, 10).map((item) => ({
        title: item.title,
        subtitle: item.subtitle,
        buttons: [
          {
            type: 'postback',
            title: 'Select',
            payload: `SELECT_${item.title.toUpperCase().replace(/\s+/g, '_').slice(0, 20)}`,
          },
        ],
      })),
    );

    return {
      text: 'Here are the options available:',
      carousel,
    };
  }

  // Pure text response: Clean all markdown artifacts
  return {
    text: cleanMarkdownForMessenger(rawText),
  };
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: AzureOpenAI | null = null;
  private readonly sessions = new Map<string, ChatSession>();

  private readonly endpoint: string;
  private readonly deploymentName: string;
  private readonly apiVersion: string;
  private readonly systemInstruction: string;
  private readonly sessionTtlMs: number;

  constructor(private readonly configService: ConfigService) {
    this.endpoint =
      this.configService.get<string>('AZURE_OPENAI_ENDPOINT') ||
      'https://owen-foundry.openai.azure.com/';
    const apiKey =
      this.configService.get<string>('AZURE_OPENAI_API_KEY') ||
      this.configService.get<string>('OPENAI_API_KEY');
    this.deploymentName =
      this.configService.get<string>('AZURE_OPENAI_DEPLOYMENT') ||
      this.configService.get<string>('AZURE_OPENAI_MODEL') ||
      'gpt-5-mini';
    this.apiVersion =
      this.configService.get<string>('AZURE_OPENAI_API_VERSION') ||
      '2024-10-21';

    const customInstruction = this.configService.get<string>(
      'AZURE_OPENAI_SYSTEM_INSTRUCTION',
    );
    this.systemInstruction = customInstruction
      ? `${DEFAULT_MESSENGER_SYSTEM_INSTRUCTION}\n\nAdditional Instructions:\n${customInstruction}`
      : DEFAULT_MESSENGER_SYSTEM_INSTRUCTION;

    this.sessionTtlMs =
      Number(this.configService.get<string>('AZURE_OPENAI_SESSION_TTL_MS')) ||
      30 * 60 * 1000; // 30 minutes default

    if (apiKey) {
      this.client = new AzureOpenAI({
        endpoint: this.endpoint,
        apiKey,
        deployment: this.deploymentName,
        apiVersion: this.apiVersion,
      });
      this.logger.log(
        `AiService initialized with Azure OpenAI endpoint: "${this.endpoint}", deployment: "${this.deploymentName}", apiVersion: "${this.apiVersion}"`,
      );
    } else {
      this.logger.warn(
        'AZURE_OPENAI_API_KEY is not configured. AI chat will be disabled.',
      );
    }
  }

  /**
   * Get an existing multi-turn chat session or create a new session
   */
  getOrCreateSession(sessionId: string): ChatSession {
    this.cleanExpiredSessions();

    const existingSession = this.sessions.get(sessionId);
    const now = Date.now();

    if (
      existingSession &&
      now - existingSession.lastActive < this.sessionTtlMs
    ) {
      existingSession.lastActive = now;
      return existingSession;
    }

    const newSession: ChatSession = {
      messages: [{ role: 'system', content: this.systemInstruction }],
      lastActive: now,
    };

    this.sessions.set(sessionId, newSession);
    this.logger.log(
      `Created new Azure OpenAI chat session for: "${sessionId}"`,
    );
    return newSession;
  }

  /**
   * Send a message to Azure OpenAI in the context of the user's multi-turn conversation
   * and return a structured response (text, carousel adaptive cards, quick replies).
   */
  async sendMessage(
    sessionId: string,
    message: string,
  ): Promise<AiBotResponse> {
    if (!this.client) {
      this.logger.warn(
        'Azure OpenAI API is not configured. Cannot process message.',
      );
      return {
        text: 'Sorry, AI chat is currently unavailable. Please check the server configuration.',
      };
    }

    try {
      const session = this.getOrCreateSession(sessionId);
      session.messages.push({ role: 'user', content: message });

      const completion = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: session.messages,
      });

      const replyText = completion.choices?.[0]?.message?.content;

      if (!replyText) {
        this.logger.warn(
          `Empty text response received from Azure OpenAI for session "${sessionId}"`,
        );
        return {
          text: "I'm sorry, I couldn't generate a response. Please try again.",
        };
      }

      session.messages.push({ role: 'assistant', content: replyText });

      return parseAiResponse(replyText);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error sending message to Azure OpenAI for session "${sessionId}": ${errorMessage}`,
      );
      return {
        text: 'Sorry, I encountered an error processing your request. Please try again later.',
      };
    }
  }

  /**
   * Reset / clear chat session history for a user
   */
  resetChat(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);
    if (existed) {
      this.logger.log(`Reset Azure OpenAI chat session for: "${sessionId}"`);
    }
    return existed;
  }

  /**
   * Retrieve conversation history messages for a given session
   */
  getHistory(sessionId: string): ChatCompletionMessageParam[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }
    return session.messages;
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
        this.logger.log(
          `Cleaned up expired Azure OpenAI session: "${sessionId}"`,
        );
      }
    }
  }
}

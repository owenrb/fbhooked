import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessagingEvent,
  MessageContent,
  PostbackContent,
} from './dto/messenger-webhook.dto';
import {
  AiService,
  GenericTemplateElement,
  AiBotResponse,
} from '../ai/ai.service';

export const START_CONVERSATION_PAYLOAD = 'START_CONVERSATION';

export interface MessengerSendApiResponse {
  recipient_id?: string;
  message_id?: string;
  error?: any;
  [key: string]: any;
}

export interface QuickReplyOption {
  content_type: 'text';
  title: string;
  payload: string;
}

/**
 * Splits text into chunks of at most maxLength characters (Meta limit is 2000),
 * prioritizing paragraph breaks, newlines, sentence ends, or spaces.
 */
export function splitMessage(text: string, maxLength: number = 2000): string[] {
  if (!text || text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = -1;

    // 1. Try splitting at paragraph break (\n\n)
    const lastParagraph = remaining.lastIndexOf('\n\n', maxLength);
    if (lastParagraph > 0) {
      splitIndex = lastParagraph + 2;
    } else {
      // 2. Try splitting at single newline (\n)
      const lastNewline = remaining.lastIndexOf('\n', maxLength);
      if (lastNewline > 0) {
        splitIndex = lastNewline + 1;
      } else {
        // 3. Try splitting at sentence break (.!? followed by space)
        const sentenceMatch = remaining
          .slice(0, maxLength)
          .match(/.*[.!?](?=\s)/);
        if (sentenceMatch && sentenceMatch[0].length > 0) {
          splitIndex = sentenceMatch[0].length + 1;
        } else {
          // 4. Try splitting at last space
          const lastSpace = remaining.lastIndexOf(' ', maxLength);
          if (lastSpace > 0) {
            splitIndex = lastSpace + 1;
          } else {
            // 5. Hard split at maxLength
            splitIndex = maxLength;
          }
        }
      }
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

/**
 * Format string array into Meta Quick Reply objects
 */
export function formatQuickReplies(
  quickReplies?: string[],
): QuickReplyOption[] | undefined {
  if (!Array.isArray(quickReplies) || quickReplies.length === 0) {
    return undefined;
  }

  return quickReplies.slice(0, 13).map((title) => {
    const cleanTitle = String(title).slice(0, 20);
    return {
      content_type: 'text',
      title: cleanTitle,
      payload: cleanTitle.toUpperCase().replace(/\s+/g, '_').slice(0, 1000),
    };
  });
}

@Injectable()
export class MessengerService implements OnModuleInit {
  private readonly logger = new Logger(MessengerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly aiService: AiService,
  ) {}

  /**
   * Auto-configure Messenger Profile (e.g. Get Started button) on module startup
   */
  async onModuleInit(): Promise<void> {
    const pageAccessToken = this.configService.get<string>(
      'MESSENGER_PAGE_ACCESS_TOKEN',
    );
    if (pageAccessToken) {
      try {
        await this.setGetStartedButton();
      } catch (error) {
        this.logger.error(
          `Failed to configure Get Started button on startup: ${error}`,
        );
      }
    }
  }

  /**
   * Process incoming Meta Messenger Webhook events
   */
  async handleWebhookEvent(event: MessagingEvent): Promise<void> {
    const senderId = event.sender?.id;
    const recipientId = event.recipient?.id;

    this.logger.log(
      `Received event from sender: ${senderId ?? 'unknown'} to recipient: ${recipientId ?? 'unknown'}`,
    );

    if (event.message) {
      await this.handleMessage(senderId, event.message);
    } else if (event.postback) {
      await this.handlePostback(senderId, event.postback);
    } else if (event.read) {
      this.logger.log(
        `Message read by user ${senderId} up to ${event.read.watermark}`,
      );
    } else if (event.delivery) {
      this.logger.log(
        `Message delivered to user ${senderId} up to ${event.delivery.watermark}`,
      );
    } else {
      this.logger.log(
        `Received unknown or unhandled event type for sender ${senderId}`,
      );
    }

    await Promise.resolve();
  }

  /**
   * Handle incoming message object
   */
  private async handleMessage(
    senderId: string | undefined,
    message: MessageContent,
  ): Promise<void> {
    if (message.is_echo) {
      this.logger.log(`Skipping echo message for mid: ${message.mid}`);
      return;
    }

    const userInput = message.quick_reply?.payload || message.text;

    if (userInput && senderId) {
      this.logger.log(`Processing message from ${senderId}: "${userInput}"`);
      const botResponse = await this.aiService.sendMessage(senderId, userInput);
      await this.dispatchBotResponse(senderId, botResponse);
    }

    if (message.attachments) {
      this.logger.log(
        `Received ${message.attachments.length} attachment(s) from ${senderId}`,
      );
    }
  }

  /**
   * Dispatch structured AI bot response (text, carousel, quick replies) to Messenger user
   */
  async dispatchBotResponse(
    recipientId: string,
    botResponse: AiBotResponse,
  ): Promise<void> {
    const hasCarousel =
      Array.isArray(botResponse.carousel) && botResponse.carousel.length > 0;

    if (hasCarousel && botResponse.carousel) {
      if (botResponse.text) {
        await this.sendTextMessage(recipientId, botResponse.text);
      }
      await this.sendCarousel(
        recipientId,
        botResponse.carousel,
        botResponse.quickReplies,
      );
    } else if (botResponse.text) {
      await this.sendTextMessage(
        recipientId,
        botResponse.text,
        botResponse.quickReplies,
      );
    }
  }

  /**
   * Handle incoming postback object
   */
  private async handlePostback(
    senderId: string | undefined,
    postback: PostbackContent,
  ): Promise<void> {
    this.logger.log(
      `Postback received from ${senderId}: title="${postback.title}", payload="${postback.payload}"`,
    );

    if (postback.payload === START_CONVERSATION_PAYLOAD) {
      this.logger.log(
        `User ${senderId} started first chat session via Get Started button ("${postback.payload}").`,
      );
      if (senderId) {
        this.aiService.resetChat(senderId);
        await this.sendTextMessage(
          senderId,
          'Welcome! How can we help you today?',
          ['Services', 'Contact Us', 'Help'],
        );
      }
      return;
    }

    // Pass custom button postbacks to AI as user prompt
    if (senderId && (postback.title || postback.payload)) {
      const prompt = postback.title || postback.payload;
      const botResponse = await this.aiService.sendMessage(senderId, prompt);
      await this.dispatchBotResponse(senderId, botResponse);
    }
  }

  /**
   * Configure Meta Messenger Profile "Get Started" button
   */
  async setGetStartedButton(
    payload: string = START_CONVERSATION_PAYLOAD,
  ): Promise<MessengerSendApiResponse> {
    const pageAccessToken = this.configService.get<string>(
      'MESSENGER_PAGE_ACCESS_TOKEN',
    );

    if (!pageAccessToken) {
      this.logger.warn(
        'MESSENGER_PAGE_ACCESS_TOKEN is not configured. Unable to set Get Started button.',
      );
      return { success: false, reason: 'MESSENGER_PAGE_ACCESS_TOKEN missing' };
    }

    const url = `https://graph.facebook.com/v21.0/me/messenger_profile?access_token=${pageAccessToken}`;

    const body = {
      get_started: {
        payload,
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as MessengerSendApiResponse;
      if (!response.ok) {
        this.logger.error(
          `Failed to set Get Started button: ${JSON.stringify(data)}`,
        );
      } else {
        this.logger.log(
          `Successfully configured Get Started button with payload: "${payload}"`,
        );
      }

      return data;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error setting Get Started button: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Send a text message to a Messenger user via the Meta Graph Send API.
   * Automatically splits long messages (>2000 chars) into multiple consecutive chunks.
   * Optionally attaches Quick Reply pills to the final chunk.
   */
  async sendTextMessage(
    recipientId: string,
    text: string,
    quickReplies?: string[],
  ): Promise<MessengerSendApiResponse> {
    const chunks = splitMessage(text, 2000);
    const formattedQuickReplies = formatQuickReplies(quickReplies);

    let lastResult: MessengerSendApiResponse = {
      recipient_id: recipientId,
    };

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk.length > 0) {
        const isLastChunk = i === chunks.length - 1;
        const payload: Record<string, unknown> = { text: chunk };

        if (isLastChunk && formattedQuickReplies) {
          payload.quick_replies = formattedQuickReplies;
        }

        lastResult = await this.sendCustomMessage(recipientId, payload);
        if (lastResult?.error) {
          this.logger.error(
            `Failed sending text chunk to ${recipientId}: ${JSON.stringify(lastResult.error)}`,
          );
          break;
        }
      }
    }

    return lastResult;
  }

  /**
   * Send a Generic Template (scrollable carousel) to a Messenger user
   */
  async sendCarousel(
    recipientId: string,
    elements: GenericTemplateElement[],
    quickReplies?: string[],
  ): Promise<MessengerSendApiResponse> {
    if (!elements || elements.length === 0) {
      return { success: false, reason: 'No elements provided for carousel' };
    }

    const payload: Record<string, unknown> = {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: elements.slice(0, 10),
        },
      },
    };

    const formattedQuickReplies = formatQuickReplies(quickReplies);
    if (formattedQuickReplies) {
      payload.quick_replies = formattedQuickReplies;
    }

    return this.sendCustomMessage(recipientId, payload);
  }

  /**
   * Send a custom payload (e.g. templates, quick replies, attachments) via Messenger Send API
   */
  async sendCustomMessage(
    recipientId: string,
    messagePayload: Record<string, unknown>,
  ): Promise<MessengerSendApiResponse> {
    const pageAccessToken = this.configService.get<string>(
      'MESSENGER_PAGE_ACCESS_TOKEN',
    );

    if (!pageAccessToken) {
      this.logger.warn(
        'MESSENGER_PAGE_ACCESS_TOKEN is not configured. Unable to send message via Graph API.',
      );
      return { success: false, reason: 'MESSENGER_PAGE_ACCESS_TOKEN missing' };
    }

    const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${pageAccessToken}`;

    const body = {
      messaging_type: 'RESPONSE',
      recipient: { id: recipientId },
      message: messagePayload,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as MessengerSendApiResponse;
      if (!response.ok) {
        this.logger.error(
          `Failed to send message via Messenger API: ${JSON.stringify(data)}`,
        );
      } else {
        this.logger.log(
          `Successfully sent message to ${recipientId}: recipient_id=${data.recipient_id ?? ''}, message_id=${data.message_id ?? ''}`,
        );
      }

      return data;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error calling Messenger Send API: ${errorMessage}`);
      throw error;
    }
  }
}

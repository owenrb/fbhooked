import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessagingEvent,
  MessageContent,
  PostbackContent,
} from './dto/messenger-webhook.dto';
import { GeminiService } from '../gemini/gemini.service';

export const START_CONVERSATION_PAYLOAD = 'START_CONVERSATION';

export interface MessengerSendApiResponse {
  recipient_id?: string;
  message_id?: string;
  error?: any;
  [key: string]: any;
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

@Injectable()
export class MessengerService implements OnModuleInit {
  private readonly logger = new Logger(MessengerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly geminiService: GeminiService,
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

    if (message.quick_reply) {
      this.logger.log(
        `Quick reply received from ${senderId}: ${message.quick_reply.payload}`,
      );
      if (senderId && message.quick_reply.payload) {
        const reply = await this.geminiService.sendMessage(
          senderId,
          message.quick_reply.payload,
        );
        await this.sendTextMessage(senderId, reply);
      }
      return;
    }

    if (message.text) {
      this.logger.log(
        `Text message received from ${senderId}: "${message.text}"`,
      );
      if (senderId) {
        const reply = await this.geminiService.sendMessage(
          senderId,
          message.text,
        );
        await this.sendTextMessage(senderId, reply);
      }
    }

    if (message.attachments) {
      this.logger.log(
        `Received ${message.attachments.length} attachment(s) from ${senderId}`,
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
        this.geminiService.resetChat(senderId);
        await this.sendTextMessage(
          senderId,
          'Welcome! Thank you for starting a conversation with us. How can we help you today?',
        );
      }
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
   * Automatically splits long messages (>2000 chars) into multiple consecutive chunks
   * to respect Meta Messenger's 2000 character limit.
   */
  async sendTextMessage(
    recipientId: string,
    text: string,
  ): Promise<MessengerSendApiResponse> {
    const chunks = splitMessage(text, 2000);
    let lastResult: MessengerSendApiResponse = {
      recipient_id: recipientId,
    };

    for (const chunk of chunks) {
      if (chunk.length > 0) {
        lastResult = await this.sendCustomMessage(recipientId, { text: chunk });
        if (lastResult?.error) {
          this.logger.error(
            `Failed sending chunk to ${recipientId}: ${JSON.stringify(lastResult.error)}`,
          );
          break;
        }
      }
    }

    return lastResult;
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

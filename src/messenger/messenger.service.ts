import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessagingEvent,
  MessageContent,
  PostbackContent,
} from './dto/messenger-webhook.dto';

export const START_CONVERSATION_PAYLOAD = 'START_CONVERSATION';

interface MessengerSendApiResponse {
  recipient_id?: string;
  message_id?: string;
  error?: any;
  [key: string]: any;
}

@Injectable()
export class MessengerService implements OnModuleInit {
  private readonly logger = new Logger(MessengerService.name);

  constructor(private readonly configService: ConfigService) {}

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
      this.handleMessage(senderId, event.message);
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
  private handleMessage(
    senderId: string | undefined,
    message: MessageContent,
  ): void {
    if (message.is_echo) {
      this.logger.log(`Skipping echo message for mid: ${message.mid}`);
      return;
    }

    if (message.quick_reply) {
      this.logger.log(
        `Quick reply received from ${senderId}: ${message.quick_reply.payload}`,
      );
      return;
    }

    if (message.text) {
      this.logger.log(
        `Text message received from ${senderId}: "${message.text}"`,
      );
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
   * Send a text message to a Messenger user via the Meta Graph Send API
   */
  async sendTextMessage(
    recipientId: string,
    text: string,
  ): Promise<MessengerSendApiResponse> {
    return this.sendCustomMessage(recipientId, { text });
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


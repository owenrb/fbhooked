import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessagingEvent,
  MessageContent,
  PostbackContent,
} from './dto/messenger-webhook.dto';

interface MessengerSendApiResponse {
  recipient_id?: string;
  message_id?: string;
  error?: any;
  [key: string]: any;
}

@Injectable()
export class MessengerService {
  private readonly logger = new Logger(MessengerService.name);

  constructor(private readonly configService: ConfigService) {}

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
      this.handlePostback(senderId, event.postback);
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
  private handlePostback(
    senderId: string | undefined,
    postback: PostbackContent,
  ): void {
    this.logger.log(
      `Postback received from ${senderId}: title="${postback.title}", payload="${postback.payload}"`,
    );
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

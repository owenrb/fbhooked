import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessengerService } from './messenger.service';
import { MessengerWebhookDto } from './dto/messenger-webhook.dto';
import { MetaSignatureGuard } from './guards/meta-signature.guard';

@Controller('webhook')
export class MessengerController {
  private readonly logger = new Logger(MessengerController.name);

  constructor(
    private readonly messengerService: MessengerService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Meta Messenger Webhook Verification endpoint (GET /webhook)
   * Meta sends GET request with hub.mode, hub.verify_token, and hub.challenge
   */
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const configuredVerifyToken = this.configService.get<string>(
      'MESSENGER_VERIFY_TOKEN',
    );

    this.logger.log(
      `GET /webhook verification request received (mode=${mode})`,
    );

    if (mode === 'subscribe' && token && token === configuredVerifyToken) {
      this.logger.log('Webhook verification successful.');
      return challenge ?? '';
    } else {
      this.logger.error(
        `Webhook verification failed. Token mismatch or invalid mode: mode=${mode}, token=${token}`,
      );
      throw new ForbiddenException(
        'Verification token mismatch or invalid mode',
      );
    }
  }

  /**
   * Meta Messenger Webhook Event endpoint (POST /webhook)
   * Exclusive for Meta Messenger Webhooks (object: 'page')
   */
  @Post()
  @UseGuards(MetaSignatureGuard)
  @HttpCode(HttpStatus.OK)
  handleWebhook(@Body() body: MessengerWebhookDto): string {
    // Exclusive check for Meta Messenger Webhook payloads (object must equal 'page')
    if (!body || body.object !== 'page') {
      this.logger.error(
        `Rejected non-Messenger payload. Received object: "${body?.object}"`,
      );
      throw new BadRequestException(
        'Payload is not a valid Meta Messenger webhook event',
      );
    }

    if (Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        if (Array.isArray(entry.messaging)) {
          for (const messagingEvent of entry.messaging) {
            // Process event asynchronously in the background so Meta receives immediate HTTP 200 OK
            void this.messengerService
              .handleWebhookEvent(messagingEvent)
              .catch((err: unknown) => {
                const errorMsg =
                  err instanceof Error ? err.message : String(err);
                this.logger.error(
                  `Error processing webhook event in background: ${errorMsg}`,
                );
              });
          }
        }
      }
    }

    return 'EVENT_RECEIVED';
  }

  /**
   * Set the Meta Messenger "Get Started" button profile configuration (POST /webhook/get-started)
   */
  @Post('get-started')
  @HttpCode(HttpStatus.OK)
  async setupGetStartedButton(): Promise<Record<string, unknown>> {
    return this.messengerService.setGetStartedButton();
  }
}

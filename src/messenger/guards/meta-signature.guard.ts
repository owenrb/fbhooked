import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Request } from 'express';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

@Injectable()
export class MetaSignatureGuard implements CanActivate {
  private readonly logger = new Logger(MetaSignatureGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const appSecret = this.configService.get<string>('MESSENGER_APP_SECRET');

    // If MESSENGER_APP_SECRET is not configured, bypass signature check with a warning
    if (!appSecret) {
      this.logger.warn(
        'MESSENGER_APP_SECRET is not set in environment. Skipping x-hub-signature-256 validation.',
      );
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithRawBody>();
    const signature = request.headers['x-hub-signature-256'] as string;

    if (!signature) {
      this.logger.error('Missing x-hub-signature-256 header in request');
      throw new UnauthorizedException('Missing x-hub-signature-256 header');
    }

    const elements = signature.split('=');
    const signatureHash = elements[1];

    if (elements[0] !== 'sha256' || !signatureHash) {
      this.logger.error(
        'Invalid signature format in x-hub-signature-256 header',
      );
      throw new UnauthorizedException('Invalid signature format');
    }

    const rawBody =
      request.rawBody || Buffer.from(JSON.stringify(request.body));
    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedHash, 'utf8');
    const signatureBuffer = Buffer.from(signatureHash, 'utf8');

    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      this.logger.error('x-hub-signature-256 signature verification failed');
      throw new UnauthorizedException('Invalid x-hub-signature-256 signature');
    }

    return true;
  }
}

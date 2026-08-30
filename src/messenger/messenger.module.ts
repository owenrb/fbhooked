import { Module } from '@nestjs/common';
import { MessengerController } from './messenger.controller';
import { MessengerService } from './messenger.service';
import { MetaSignatureGuard } from './guards/meta-signature.guard';
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [GeminiModule],
  controllers: [MessengerController],
  providers: [MessengerService, MetaSignatureGuard],
  exports: [MessengerService],
})
export class MessengerModule {}

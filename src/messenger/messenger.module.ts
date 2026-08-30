import { Module } from '@nestjs/common';
import { MessengerController } from './messenger.controller';
import { MessengerService } from './messenger.service';
import { MetaSignatureGuard } from './guards/meta-signature.guard';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [MessengerController],
  providers: [MessengerService, MetaSignatureGuard],
  exports: [MessengerService],
})
export class MessengerModule {}

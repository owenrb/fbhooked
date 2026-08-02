import { Module } from '@nestjs/common';
import { MessengerController } from './messenger.controller';
import { MessengerService } from './messenger.service';
import { MetaSignatureGuard } from './guards/meta-signature.guard';

@Module({
  controllers: [MessengerController],
  providers: [MessengerService, MetaSignatureGuard],
  exports: [MessengerService],
})
export class MessengerModule {}

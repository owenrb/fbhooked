import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MessengerModule } from './messenger/messenger.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MessengerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

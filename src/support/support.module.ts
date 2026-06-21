import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { SupportChatGateway } from './chat/support-chat.gateway';
import { SupportChatPublisher } from './chat/support-chat.publisher';
import { SupportChatService } from './chat/support-chat.service';
import { SupportChatSubscriber } from './chat/support-chat.subscriber';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { IS_HTTP_TIER } from '../common/process-role';

// The WS gateway + Redis subscriber run wherever HTTP is served — api + realtime + dev
// (NOT the worker).
const IS_API = IS_HTTP_TIER;

@Module({
  imports: [
    // JwtService for the chat gateway's handshake auth (same secret via config).
    JwtModule.register({}),
  ],
  controllers: [SupportController],
  providers: [
    SupportService,
    SupportChatService,
    // Tier-agnostic — runs everywhere so a future agent surface can publish.
    SupportChatPublisher,
    // The WS gateway + its Redis subscriber only run on api/dev instances.
    ...(IS_API ? [SupportChatGateway, SupportChatSubscriber] : []),
  ],
  exports: [SupportService, SupportChatPublisher],
})
export class SupportModule {}

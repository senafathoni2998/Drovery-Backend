import {
  BadRequestException,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { Server, WebSocket } from 'ws';

import { MetricsService } from '../../metrics/metrics.service';
import {
  SupportChatPublisher,
  toSupportChatPayload,
} from './support-chat.publisher';
import { SupportChatService } from './support-chat.service';
import {
  SupportChatFrame,
  SupportChatSubscriber,
} from './support-chat.subscriber';

interface AuthedSocket extends WebSocket {
  userId?: string;
}

/**
 * Real-time human-agent support chat over WebSockets, mounted at a DISTINCT path
 * (/ws/support) so it coexists with the tracking gateway at '/' (the WsAdapter
 * routes upgrades by exact pathname — see node_modules/@nestjs/platform-ws). The
 * mobile app's tracking socket is untouched.
 *
 * Horizontally scalable: a message accepted on any api replica is persisted then
 * published to Redis (SupportChatPublisher); every replica's SupportChatSubscriber
 * fans it out to its locally-connected clients — so a future agent on replica B
 * reaches a user on replica A.
 *
 * Security mirrors TrackingGateway: the global HTTP JwtAuthGuard does NOT guard
 * WS, so the client authenticates with a JWT in the handshake query
 * (ws://host/ws/support?token=...) and ticket ownership is re-checked per ticket
 * at subscribe AND send.
 */
@WebSocketGateway({ path: '/ws/support' })
export class SupportChatGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnApplicationShutdown
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SupportChatGateway.name);

  /** ticketId → set of locally-connected, subscribed clients. */
  private readonly subscriptions = new Map<string, Set<AuthedSocket>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly chat: SupportChatService,
    private readonly publisher: SupportChatPublisher,
    private readonly subscriber: SupportChatSubscriber,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit() {
    // Bridge Redis messages to the local fanout (no DI cycle: the subscriber
    // never imports the gateway).
    this.subscriber.onUpdate((ticketId, frame) =>
      this.deliverToLocalClients(ticketId, frame),
    );
  }

  async handleConnection(client: AuthedSocket, request: IncomingMessage) {
    try {
      const url = new URL(request.url ?? '', `http://${request.headers.host}`);
      const token = url.searchParams.get('token');
      if (!token) throw new Error('missing token');

      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
      // If the client disconnected DURING verification, handleDisconnect already
      // ran with no userId — don't inc() now (it would leak the gauge with no
      // matching dec()). Setting userId + inc() is atomic w.r.t. the event loop.
      if (client.readyState !== WebSocket.OPEN) return;
      client.userId = payload.sub;
      this.metrics?.wsSupportConnections.inc();
      // Never log the URL (it carries the token); log only the user.
      this.logger.log(`support chat client connected (user ${payload.sub})`);
    } catch {
      client.close(1008, 'Unauthorized');
    }
  }

  handleDisconnect(client: AuthedSocket) {
    for (const [ticketId, clients] of this.subscriptions) {
      if (clients.delete(client) && clients.size === 0) {
        this.subscriptions.delete(ticketId);
        this.subscriber.unsubscribeFromTicket(ticketId);
      }
    }
    if (client.userId) this.metrics?.wsSupportConnections.dec();
  }

  /**
   * Graceful drain on SIGTERM — mirrors TrackingGateway. Send each socket a 1001
   * "going away" close so clients reconnect cleanly instead of seeing a 1006 abnormal
   * closure + a thundering-herd reconnect. Best-effort.
   */
  onApplicationShutdown() {
    try {
      for (const client of this.server?.clients ?? []) {
        client.close(1001, 'server draining');
      }
    } catch (e) {
      this.logger.warn(`support socket drain failed: ${(e as Error).message}`);
    }
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(client: AuthedSocket, payload: { ticketId?: string }) {
    const ticketId = payload?.ticketId;
    if (!client.userId || !ticketId) {
      return { event: 'error', data: { message: 'unauthorized' } };
    }

    try {
      await this.chat.assertOwnedTicket(client.userId, ticketId);
    } catch {
      // Generic — don't reveal whether the ticket exists.
      return { event: 'error', data: { message: 'not found or no access' } };
    }

    let clients = this.subscriptions.get(ticketId);
    if (!clients) {
      clients = new Set();
      this.subscriptions.set(ticketId, clients);
      this.subscriber.subscribeToTicket(ticketId);
    }
    clients.add(client);
    return { event: 'subscribed', data: { ticketId } };
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: AuthedSocket, payload: { ticketId?: string }) {
    const ticketId = payload?.ticketId;
    if (!ticketId) return { event: 'error', data: { message: 'bad request' } };
    const clients = this.subscriptions.get(ticketId);
    if (clients?.delete(client) && clients.size === 0) {
      this.subscriptions.delete(ticketId);
      this.subscriber.unsubscribeFromTicket(ticketId);
    }
    return { event: 'unsubscribed', data: { ticketId } };
  }

  @SubscribeMessage('send')
  async handleSend(
    client: AuthedSocket,
    payload: { ticketId?: string; content?: string },
  ) {
    const ticketId = payload?.ticketId;
    const content =
      typeof payload?.content === 'string' ? payload.content.trim() : '';
    if (!client.userId || !ticketId) {
      return { event: 'error', data: { message: 'unauthorized' } };
    }
    if (!content || content.length > 2000) {
      return { event: 'error', data: { message: 'bad request' } };
    }

    let message;
    try {
      message = await this.chat.createUserMessage(
        client.userId,
        ticketId,
        content,
      );
    } catch (e) {
      if (e instanceof BadRequestException) {
        return { event: 'error', data: { message: 'ticket closed' } };
      }
      return { event: 'error', data: { message: 'not found or no access' } };
    }

    const frame = toSupportChatPayload(message);
    // Fan out to every subscribed client on every replica (incl. the sender's
    // other devices). The sender ALSO gets this 'message:sent' ack synchronously;
    // clients dedupe by id.
    await this.publisher.publishMessage(frame);
    return { event: 'message:sent', data: frame };
  }

  /** Local fanout — invoked by the SupportChatSubscriber on each Redis message. */
  deliverToLocalClients(ticketId: string, frame: SupportChatFrame) {
    const clients = this.subscriptions.get(ticketId);
    if (!clients || clients.size === 0) return;
    const message = JSON.stringify(frame);
    for (const client of clients) {
      try {
        if (client.readyState === WebSocket.OPEN) client.send(message);
      } catch (e) {
        this.logger.warn(`support broadcast failed: ${(e as Error).message}`);
      }
    }
  }
}

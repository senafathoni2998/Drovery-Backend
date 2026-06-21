import { Logger, OnModuleInit, Optional } from '@nestjs/common';
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
import { WS_MAX_BUFFERED_BYTES } from './realtime.constants';
import { DeliveriesService } from '../deliveries.service';
import { TrackingUpdatePayload } from './tracking.publisher';
import { TrackingSubscriber } from './tracking.subscriber';

interface AuthedSocket extends WebSocket {
  userId?: string;
}

/**
 * Real-time delivery tracking over WebSockets ('ws', not socket.io — main.ts
 * installs WsAdapter). Horizontally scalable: the worker publishes updates to
 * Redis (TrackingPublisher) and this gateway's TrackingSubscriber fans them out
 * to locally-connected clients — so an update computed in the worker reaches a
 * client connected to ANY api replica.
 *
 * Security: the client authenticates with a JWT in the handshake query
 * (ws://host/?token=...) — browsers can't set WS headers — and ownership is
 * re-checked per delivery at subscribe time (parity with GET /deliveries/track).
 */
// No `cors` option: the 'ws' library ignores it — access is gated entirely by
// the JWT handshake check in handleConnection (origin isn't a security boundary
// here since the token is mandatory).
@WebSocketGateway()
export class TrackingGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TrackingGateway.name);

  /** deliveryId → set of locally-connected, subscribed clients. */
  private readonly subscriptions = new Map<string, Set<AuthedSocket>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly deliveries: DeliveriesService,
    private readonly subscriber: TrackingSubscriber,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit() {
    // Bridge Redis messages to the local fanout (no DI cycle: the subscriber
    // never imports the gateway).
    this.subscriber.onUpdate((deliveryId, data) =>
      this.deliverToLocalClients(deliveryId, data),
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
      // ran with no userId — so don't inc() now (it would leak the gauge with no
      // matching dec()). Setting userId + inc() here is atomic w.r.t. the event
      // loop, so a later disconnect is guaranteed to dec().
      if (client.readyState !== WebSocket.OPEN) return;
      client.userId = payload.sub;
      this.metrics?.wsConnections.inc();
      // Never log the URL (it carries the token); log only the user.
      this.logger.log(`tracking client connected (user ${payload.sub})`);
    } catch {
      // 1008 = Policy Violation.
      client.close(1008, 'Unauthorized');
    }
  }

  handleDisconnect(client: AuthedSocket) {
    for (const [deliveryId, clients] of this.subscriptions) {
      if (clients.delete(client) && clients.size === 0) {
        this.subscriptions.delete(deliveryId);
        this.subscriber.unsubscribeFromDelivery(deliveryId);
      }
    }
    if (client.userId) this.metrics?.wsConnections.dec();
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    client: AuthedSocket,
    payload: { deliveryId?: string },
  ) {
    const deliveryId = payload?.deliveryId;
    if (!client.userId || !deliveryId) {
      return { event: 'error', data: { message: 'unauthorized' } };
    }

    try {
      // Throws NotFoundException unless this user owns the delivery.
      await this.deliveries.findOne(client.userId, deliveryId);
    } catch {
      // Generic message — don't reveal whether the delivery exists.
      return { event: 'error', data: { message: 'not found or no access' } };
    }

    let clients = this.subscriptions.get(deliveryId);
    if (!clients) {
      clients = new Set();
      this.subscriptions.set(deliveryId, clients);
      // First local subscriber for this delivery — start receiving its channel.
      this.subscriber.subscribeToDelivery(deliveryId);
    }
    clients.add(client);
    return { event: 'subscribed', data: { deliveryId } };
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: AuthedSocket, payload: { deliveryId?: string }) {
    const deliveryId = payload?.deliveryId;
    if (!deliveryId)
      return { event: 'error', data: { message: 'bad request' } };
    const clients = this.subscriptions.get(deliveryId);
    if (clients?.delete(client) && clients.size === 0) {
      this.subscriptions.delete(deliveryId);
      this.subscriber.unsubscribeFromDelivery(deliveryId);
    }
    return { event: 'unsubscribed', data: { deliveryId } };
  }

  /** Local fanout — invoked by the TrackingSubscriber on each Redis message. */
  deliverToLocalClients(deliveryId: string, data: TrackingUpdatePayload) {
    const clients = this.subscriptions.get(deliveryId);
    if (!clients || clients.size === 0) return;
    const message = JSON.stringify({ event: 'tracking:update', data });
    // A STATUS transition is NEVER dropped: it's recoverable only via a poll, and a
    // terminal status FREEZES position so no later frame supersedes it. Only the
    // position stream is lossy (the next frame supersedes a dropped one) — mirrors the
    // coalescer's never-coalesce-status split.
    const isStatusFrame = data.status !== undefined;
    for (const client of clients) {
      try {
        if (client.readyState !== WebSocket.OPEN) continue;
        // Backpressure: drop a POSITION frame to a socket whose send buffer is already
        // backed up (a slow client), rather than growing it unbounded toward an OOM.
        if (!isStatusFrame && client.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
          this.metrics?.wsDroppedFrames.inc();
          continue;
        }
        client.send(message);
      } catch (e) {
        this.logger.warn(`broadcast failed: ${(e as Error).message}`);
      }
    }
  }
}

import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'ws';

@WebSocketGateway({ cors: { origin: '*' } })
export class TrackingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TrackingGateway.name);

  /** deliveryId → set of subscribed WS clients */
  private readonly subscriptions = new Map<string, Set<any>>();

  handleConnection(_client: any) {
    this.logger.log('Tracking client connected');
  }

  handleDisconnect(client: any) {
    for (const [deliveryId, clients] of this.subscriptions) {
      clients.delete(client);
      if (clients.size === 0) {
        this.subscriptions.delete(deliveryId);
      }
    }
    this.logger.log('Tracking client disconnected');
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: any, payload: { deliveryId: string }) {
    const { deliveryId } = payload;
    if (!this.subscriptions.has(deliveryId)) {
      this.subscriptions.set(deliveryId, new Set());
    }
    this.subscriptions.get(deliveryId)!.add(client);
    this.logger.log(`Client subscribed to delivery: ${deliveryId}`);
    return { event: 'subscribed', data: { deliveryId } };
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: any, payload: { deliveryId: string }) {
    const { deliveryId } = payload;
    this.subscriptions.get(deliveryId)?.delete(client);
    this.logger.log(`Client unsubscribed from delivery: ${deliveryId}`);
    return { event: 'unsubscribed', data: { deliveryId } };
  }

  /**
   * Sends a tracking/status update to every client subscribed to this delivery.
   * Called by SimulationService whenever position or status changes.
   */
  broadcastTrackingUpdate(deliveryId: string, data: Record<string, any>) {
    const clients = this.subscriptions.get(deliveryId);
    if (!clients || clients.size === 0) return;

    const message = JSON.stringify({ event: 'tracking:update', data });

    for (const client of clients) {
      try {
        // readyState 1 = WebSocket.OPEN
        if (client.readyState === 1) {
          client.send(message);
        }
      } catch (error) {
        this.logger.warn(`Broadcast failed: ${(error as Error).message}`);
      }
    }
  }
}

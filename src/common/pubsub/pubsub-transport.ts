import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';

/**
 * Pub/sub DELIVERY MODE for the tracking + support-chat fan-out (the telemetry
 * hot path). A thin seam over ioredis so the publishers/subscribers stay mode-
 * agnostic; the mode is read once at connection time from REDIS_PUBSUB_MODE.
 *
 *  - 'standard' (DEFAULT): PUBLISH / SUBSCRIBE — broadcast semantics. On a single
 *    Redis this is exactly today's behavior. On a Redis CLUSTER, though, classic
 *    pub/sub does NOT shard: every PUBLISH is propagated to EVERY node (a
 *    subscriber may be connected to any node), so pub/sub throughput is capped by
 *    a single node and does NOT scale by adding nodes — the 1M+ telemetry fan-out
 *    wall (SCALING-1M.md §4).
 *  - 'sharded': SPUBLISH / SSUBSCRIBE (Redis 7.0+) — a message is routed ONLY to
 *    the node that owns the channel's hash slot, and subscribers SSUBSCRIBE on that
 *    same node. The firehose is therefore partitioned across the cluster and
 *    throughput scales with node count. Works on a standalone Redis 7+ too (one
 *    shard owns every slot), so it is safe to flip before the Cluster client lands.
 *
 * UNIFORM CONFIG: the publisher tier (worker) and the subscriber tier (api/realtime)
 * MUST agree on the mode — a sharded SPUBLISH is only delivered to SSUBSCRIBE
 * listeners, never to a classic SUBSCRIBE. Both read the same REDIS_PUBSUB_MODE env.
 */
export type PubSubMode = 'standard' | 'sharded';

export const PUBSUB_MODE_STANDARD: PubSubMode = 'standard';

/**
 * Resolves the active mode from config (`redis.pubsubMode` ← REDIS_PUBSUB_MODE).
 * FAIL-SAFE: anything other than the exact string 'sharded' resolves to 'standard',
 * so an unset/typo'd value keeps today's broadcast behavior rather than silently
 * switching the wire protocol.
 */
export function resolvePubSubMode(config: ConfigService): PubSubMode {
  return config.get<string>('redis.pubsubMode') === 'sharded'
    ? 'sharded'
    : 'standard';
}

/** The ioredis event a subscriber must listen on for the given mode. Sharded
 * deliveries arrive as 'smessage', classic ones as 'message' — they are distinct
 * events, so listening on the wrong one yields zero messages (never duplicates). */
export function pubSubMessageEvent(mode: PubSubMode): 'message' | 'smessage' {
  return mode === 'sharded' ? 'smessage' : 'message';
}

/** Publish one message under the active mode (SPUBLISH when sharded, else PUBLISH).
 * Returns the raw ioredis reply (receiver count) unchanged. */
export function pubSubPublish(
  client: Redis,
  channel: string,
  message: string,
  mode: PubSubMode,
): Promise<unknown> {
  return mode === 'sharded'
    ? client.spublish(channel, message)
    : client.publish(channel, message);
}

/** Subscribe to one channel under the active mode (SSUBSCRIBE when sharded). */
export function pubSubSubscribe(
  client: Redis,
  channel: string,
  mode: PubSubMode,
): Promise<unknown> {
  return mode === 'sharded'
    ? client.ssubscribe(channel)
    : client.subscribe(channel);
}

/** Unsubscribe from one channel under the active mode (SUNSUBSCRIBE when sharded). */
export function pubSubUnsubscribe(
  client: Redis,
  channel: string,
  mode: PubSubMode,
): Promise<unknown> {
  return mode === 'sharded'
    ? client.sunsubscribe(channel)
    : client.unsubscribe(channel);
}

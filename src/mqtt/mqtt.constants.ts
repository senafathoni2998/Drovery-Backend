/**
 * Single source of truth for the MQTT topic strings, so producers and consumers can never
 * drift (mirrors tracking.publisher.ts's `trackingChannel` helper).
 *
 *   drone  → backend : drovery/telemetry/<droneId>   (subscribed via the +-wildcard filter)
 *   drone  → backend : drovery/commands/ack          (command acknowledgements)
 *   backend → drone  : drovery/commands/<droneId>    (pushed commands)
 */
export const TELEMETRY_FILTER = 'drovery/telemetry/+';
export const COMMAND_ACK_FILTER = 'drovery/commands/ack';

export const commandTopic = (droneId: string): string =>
  `drovery/commands/${droneId}`;

/** Wrap a filter as an MQTT5 shared subscription so the broker delivers each message to
 * exactly ONE member of the group (one api replica), not every subscriber. */
export const sharedFilter = (group: string, filter: string): string =>
  `$share/${group}/${filter}`;

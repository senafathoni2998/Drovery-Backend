// Process-role tiers — the single source of truth for which slice of the app a node
// runs, selected by the PROCESS_ROLE env var. One Docker image, four roles:
//
//   'api'      → HTTP controllers + WS gateways + ingest; NO worker processors. (main.ts)
//   'worker'   → headless worker processors/schedulers; no HTTP. (worker.ts)
//   'realtime' → WS gateways ONLY (HTTP boots, but the Ingress routes only the WS
//                upgrade here); NO worker processors and NO ingest — so a tier that
//                holds hundreds of thousands of long-lived sockets scales (KEDA on
//                socket count) independently of the api/worker tiers. (main.ts)
//   unset      → dev: everything runs in one process.
//
// Introducing 'realtime' is purely additive: for api/worker/unset these flags evaluate
// EXACTLY as the old per-file `PROCESS_ROLE !== 'api'` / `!== 'worker'` checks did.

const role = process.env.PROCESS_ROLE;

/** Worker-tier processors + repeatable schedulers (sim, watchdog, partition, recurring,
 * tracking-checkpoint). Runs on the worker + dev — NOT api, NOT the socket-only realtime. */
export const IS_WORKER_TIER = role !== 'api' && role !== 'realtime';

/** HTTP server + WS gateways/subscribers. Runs on api + realtime + dev — NOT the worker. */
export const IS_HTTP_TIER = role !== 'worker';

/** Inbound ingest (MQTT telemetry + command-ack subscribers). Runs on api + dev — NOT
 * the worker, and NOT the realtime tier (which fans updates OUT, it doesn't ingest). */
export const IS_INGEST_TIER = role !== 'worker' && role !== 'realtime';

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
// Lazy require() (not import) is intentional here: the OTel SDK + instrumentations
// are loaded ONLY when tracing is enabled, so a deployment that never enables it
// pays nothing and can't crash on a missing/incompatible OTel dep at boot.
import { sentryEnabled } from './sentry';

/**
 * Distributed tracing (OpenTelemetry), real-or-mock like sentry.ts. DISABLED BY
 * DEFAULT: when off, NOTHING is required/patched and every export is a no-op, so
 * dev/test/CI are byte-identical (the SDK must init at the very top of main.ts /
 * worker.ts — before the module graph — for the http/express/pg/ioredis
 * instrumentations to patch at require time).
 *
 * Enabled when TRACING_ENABLED is truthy OR an OTLP endpoint is set — AND Sentry is
 * NOT enabled: @sentry/node, whenever a DSN is set, registers the GLOBAL OTel tracer
 * provider/propagator/context manager unconditionally (even at tracesSampleRate 0),
 * so a standalone SDK would be ignored or conflict. Pick one owner. Recommended for
 * this backend: leave SENTRY_DSN unset and set TRACING_ENABLED → OTel owns tracing.
 */
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const flag = process.env.TRACING_ENABLED;
const wanted = Boolean(otlpEndpoint) || flag === 'true' || flag === '1';

export const tracingEnabled = wanted && !sentryEnabled;

// Lazily-resolved OTel api (only when enabled) so the disabled path never loads it.
let otelApi: typeof import('@opentelemetry/api') | undefined;
let sdk: { shutdown(): Promise<void> } | undefined;
let started = false;
// True only after the SDK has fully started; the no-op exports gate on THIS (not
// otelApi) so a caught init failure leaves them inert rather than half-wired.
let traceReady = false;

if (tracingEnabled) {
  start();
} else if (wanted && sentryEnabled) {
  // eslint-disable-next-line no-console
  console.warn(
    '[tracing] SENTRY_DSN is set — Sentry owns OpenTelemetry; standalone tracing skipped. Unset SENTRY_DSN to enable OTel tracing.',
  );
}

function start(): void {
  if (started) return;
  started = true; // guard a second start even if this attempt fails

  // Fail-OPEN: a bad OTLP endpoint or an instrumentation incompat must degrade to
  // untraced, NOT crash boot (this module is imported before AppModule). Mirrors
  // sentry.ts's never-break-the-app intent — but tracing has a far larger init
  // surface (a user-supplied URL the OTLP exporter parses + 4 instrumentations).
  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { Resource } = require('@opentelemetry/resources');
    const {
      ATTR_SERVICE_NAME,
      ATTR_SERVICE_VERSION,
    } = require('@opentelemetry/semantic-conventions');
    const {
      ConsoleSpanExporter,
      SimpleSpanProcessor,
      BatchSpanProcessor,
      ParentBasedSampler,
      TraceIdRatioBasedSampler,
    } = require('@opentelemetry/sdk-trace-base');
    const {
      OTLPTraceExporter,
    } = require('@opentelemetry/exporter-trace-otlp-http');
    const {
      HttpInstrumentation,
    } = require('@opentelemetry/instrumentation-http');
    const {
      ExpressInstrumentation,
    } = require('@opentelemetry/instrumentation-express');
    const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
    const {
      IORedisInstrumentation,
    } = require('@opentelemetry/instrumentation-ioredis');

    otelApi = require('@opentelemetry/api');

    const serviceName =
      process.env.PROCESS_ROLE === 'worker'
        ? 'drovery-worker'
        : process.env.PROCESS_ROLE === 'realtime'
          ? 'drovery-realtime'
          : 'drovery-api';
    const ratio = clampRatio(process.env.OTEL_TRACES_SAMPLER_ARG);

    // Console exporter for local/hardware-free verification; OTLP-HTTP to a real
    // collector (Tempo/Jaeger/OTLP) when an endpoint is configured.
    const useConsole = process.env.OTEL_EXPORTER === 'console' || !otlpEndpoint;
    // No explicit `url`: the exporter reads OTEL_EXPORTER_OTLP_ENDPOINT itself and
    // appends the `/v1/traces` signal path (per the OTel convention). Passing the
    // base endpoint as `url` would skip that append → spans POST to the bare root
    // and the collector rejects them.
    const spanProcessor = useConsole
      ? new SimpleSpanProcessor(new ConsoleSpanExporter())
      : new BatchSpanProcessor(new OTLPTraceExporter());

    // Don't trace the high-frequency scrape/probe endpoints — pure noise at scale.
    const ignore = [
      '/metrics',
      '/api/v1/metrics',
      '/health',
      '/api/v1/health',
      '/api/v1/health/ready',
    ];

    const nodeSdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_VERSION]: process.env.SENTRY_RELEASE ?? 'dev',
      }),
      spanProcessors: [spanProcessor],
      // ParentBased so the worker honors the producer's sampled flag; ratio samples roots.
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(ratio),
      }),
      instrumentations: [
        new HttpInstrumentation({
          ignoreIncomingRequestHook: (req: { url?: string }) =>
            ignore.some((p) => (req.url ?? '').split('?')[0] === p),
        }),
        new ExpressInstrumentation(),
        new PgInstrumentation(),
        new IORedisInstrumentation(),
      ],
    });
    nodeSdk.start();
    sdk = nodeSdk;
    traceReady = true;
    // eslint-disable-next-line no-console
    console.log(
      `[tracing] OpenTelemetry enabled (service=${serviceName}, exporter=${useConsole ? 'console' : 'otlp'}, sampleRatio=${ratio}).`,
    );
    if (!useConsole && ratio >= 1 && process.env.NODE_ENV === 'production') {
      // eslint-disable-next-line no-console
      console.warn(
        '[tracing] sampling 100% of traces in production — set OTEL_TRACES_SAMPLER_ARG (e.g. 0.05) to reduce cost.',
      );
    }
  } catch (error) {
    // Degrade to untraced. Clear otelApi + leave sdk undefined so every export
    // stays a no-op; keep `started` true so a broken config is not retried.
    otelApi = undefined;
    sdk = undefined;
    traceReady = false;
    // eslint-disable-next-line no-console
    console.warn(
      `[tracing] OpenTelemetry init failed — running untraced: ${(error as Error).message}`,
    );
  }
}

function clampRatio(arg?: string): number {
  // Conservative in production (sample 5%); full sampling in dev for visibility.
  // Mirrors sentry.ts defaulting tracesSampleRate low; overridable via env.
  const fallback = process.env.NODE_ENV === 'production' ? 0.05 : 1;
  const n = arg === undefined ? fallback : parseFloat(arg);
  if (Number.isNaN(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/**
 * Inject the active trace context into a copy of a BullMQ job's data under
 * `_carrier`, so the worker can continue the producer's trace. Pure pass-through
 * (same reference) when tracing is disabled → job data stays byte-identical.
 */
export function injectTraceCarrier<T extends Record<string, unknown>>(
  data: T,
): T {
  if (!traceReady || !otelApi) return data;
  const carrier: Record<string, string> = {};
  otelApi.propagation.inject(otelApi.context.active(), carrier);
  return { ...data, _carrier: carrier };
}

/**
 * Run a BullMQ job handler inside a CONSUMER span linked to the producer trace
 * (extracted from `carrier`), so the worker's pg/redis spans nest under it and
 * share the create request's traceId. No-op wrapper when tracing is disabled.
 */
export async function withJobSpan<T>(
  jobName: string,
  carrier: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  if (!traceReady || !otelApi) return fn();
  const { trace, propagation, context, SpanKind, SpanStatusCode } = otelApi;
  const parent = carrier
    ? propagation.extract(context.active(), carrier)
    : context.active();
  const tracer = trace.getTracer('drovery-sim-worker');
  return context.with(parent, () =>
    tracer.startActiveSpan(
      `bullmq.process ${jobName}`,
      { kind: SpanKind.CONSUMER },
      async (span) => {
        try {
          return await fn();
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error).message,
          });
          throw error;
        } finally {
          span.end();
        }
      },
    ),
  );
}

/** The active trace id (for log correlation), or undefined when not in a span. */
export function activeTraceId(): string | undefined {
  if (!traceReady || !otelApi) return undefined;
  return otelApi.trace.getActiveSpan()?.spanContext().traceId;
}

/** Flush + shut down the SDK so buffered spans aren't lost on exit. No-op when off. */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    /* best-effort flush on shutdown */
  }
}

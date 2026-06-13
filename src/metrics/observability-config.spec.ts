import * as fs from 'fs';
import * as path from 'path';

/**
 * Guards the observability config against the silent "parses fine but matches zero
 * series" class of bug (promtool/JSON-lint can't catch a label/route that doesn't
 * exist on the live metric). The HTTP metric emits labels { method, status, route }
 * (metrics.service.ts) and `route` carries the global api/v1 prefix
 * (metrics.interceptor.ts) — selectors must agree.
 */
describe('observability config ↔ emitted metrics', () => {
  const root = path.join(__dirname, '..', '..', 'observability');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
  const alerts = read('alerts.yml');
  const apiDash = read('grafana/dashboards/drovery-api.json');
  const workerDash = read('grafana/dashboards/drovery-workers.json');

  it('uses the emitted `status` label, never `status_code`', () => {
    expect(alerts).not.toContain('status_code');
    expect(apiDash).not.toContain('status_code');
  });

  it('matches the readiness route prefix-agnostically (route is /api/v1/health/ready)', () => {
    // No bare, unprefixed literal selector — it would never match the emitted label
    // (the valid prefix-agnostic `.*/health/ready` form is asserted positively below).
    expect(alerts).not.toContain('route="/health/ready"');
    expect(apiDash).not.toContain('route=\\"/health/ready\\"');
    expect(alerts).toContain('.*/health/ready');
    expect(apiDash).toContain('.*/health/ready');
  });

  it('keeps the queue label on the failed-jobs alert (by clause, not bare max)', () => {
    expect(alerts).toContain('max by (queue) (drovery_queue_jobs{state="failed"})');
  });

  it('only references metric names the app actually emits', () => {
    const emitted = [
      'drovery_http_requests_total',
      'drovery_http_request_duration_seconds_bucket',
      'drovery_queue_jobs',
      'drovery_ws_connections',
      'drovery_ws_support_connections',
      'drovery_nodejs_eventloop_lag_p99_seconds',
      'drovery_process_resident_memory_bytes',
      'drovery_process_cpu_seconds_total',
      'up',
    ];
    const referenced = [
      ...alerts.matchAll(/drovery_[a-z0-9_]+/g),
      ...apiDash.matchAll(/drovery_[a-z0-9_]+/g),
      ...workerDash.matchAll(/drovery_[a-z0-9_]+/g),
    ].map((m) => m[0]);
    const unknown = [...new Set(referenced)].filter(
      (m) => !emitted.includes(m),
    );
    expect(unknown).toEqual([]);
  });

  it('dashboards are structurally valid JSON', () => {
    expect(() => JSON.parse(apiDash)).not.toThrow();
    expect(() => JSON.parse(workerDash)).not.toThrow();
  });
});

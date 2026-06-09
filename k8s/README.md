# Kubernetes manifests

Kustomize **base + overlays** mirroring the `docker-compose.yml` topology. One
container image (`drovery-backend`) runs every role — the role is chosen by the
container `command` + `PROCESS_ROLE`.

```
k8s/
  base/
    namespace.yaml
    api-deployment.yaml      # node dist/src/main, PROCESS_ROLE=api, HTTP probes, CPU request (HPA needs it)
    api-service.yaml         # ClusterIP :80 -> :3000
    api-ingress.yaml         # nginx, host patched per overlay
    api-pdb.yaml             # PodDisruptionBudget (keep >=1 api during drains)
    api-hpa.yaml             # autoscaling/v2, CPU 65% + behavior windows
    worker-deployment.yaml   # node dist/src/worker, PROCESS_ROLE=worker, NO http probes, :9091 metrics
    worker-scaledobject.yaml # KEDA: scales worker on BullMQ queue depth (Prometheus)
    migrate-job.yaml         # prisma migrate deploy, DIRECT to Postgres
    secrets.env.example      # placeholder Secret (overlays replace)
    kustomization.yaml       # configMapGenerator + secretGenerator
  overlays/
    local/    # kind/minikube: image tag ci, HPA max 4, dev secrets
    prod/     # pinned image, HPA 3..20, PDB 50%, External-Secrets note
    loadtest/ # api=2 worker=3, LOADTEST_BYPASS_THROTTLE=true, NODE_ENV=development
```

## Apply (local kind/minikube)

```bash
docker build -t drovery-backend:ci .
kind load docker-image drovery-backend:ci          # or: minikube image load
minikube addons enable metrics-server              # the api HPA needs it

kubectl apply -k k8s/overlays/local

# Plain kubectl does NOT honor the Helm/Argo migrate-ordering hooks, so gate the
# rollout on the migration completing before the app serves traffic:
kubectl -n drovery wait --for=condition=complete job/drovery-migrate --timeout=180s
```

The worker autoscaler additionally needs **KEDA** + **Prometheus** in-cluster,
with Prometheus scraping the pod annotations (api `:3000/api/v1/metrics`,
worker `:9091/metrics`).

## What's intentionally NOT here

- **Postgres / PgBouncer / Redis** — assumed managed services or separately
  deployed (Bitnami charts). Point `DATABASE_URL` / `REDIS_HOST` at them.
- **Prometheus / KEDA / metrics-server / ingress-nginx** — cluster add-ons.

## Gotchas (the ones that actually bite)

- **Worker has no HTTP server.** It serves only `:9091/metrics` — never give it
  an `httpGet /api/v1/health` probe or it CrashLoopBackOffs. Uses an exec
  startup probe instead.
- **Migrations bypass PgBouncer.** The migrate Job uses `DATABASE_URL_DIRECT`
  (Postgres directly); DDL + Prisma advisory locks break under transaction pooling.
- **One autoscaler per Deployment.** KEDA creates/owns `keda-hpa-drovery-worker`
  for the worker — never also attach a plain HPA to it. The api uses a plain HPA
  (no KEDA).
- **KEDA query uses `max()`, not `sum()`.** Every replica exports the same
  queue-global `drovery_queue_jobs` gauge; `sum()` would multiply the backlog by
  the pod count and over-scale.
- **Secrets in prod** come from External Secrets / Sealed Secrets — never commit
  real values. The committed `secrets.env.example` / `secrets.local.env` are
  placeholders / local-only.

Every overlay is validated in CI by `.github/workflows/manifests.yml`
(`kustomize build` → `kubeconform` → `kind` + `kubectl apply --dry-run=server`).

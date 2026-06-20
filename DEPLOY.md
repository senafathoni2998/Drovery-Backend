# Deploying Drovery to a VPS

Run the whole system — API, worker, Postgres/PgBouncer, Redis, MQTT, and the admin console —
on a single VPS with Docker Compose, behind **Caddy** (automatic HTTPS). The mobile app isn't
deployed here (it ships to the app stores); it just points at this server's API.

```
                      ┌──────────────── your VPS ────────────────┐
  Browser ─┐          │  Caddy :443  ──► /api/*  + WS ──► api ─┐  │
  (admin)  ├─► DNS ───►  (auto-TLS)   ──► everything else ──► admin (SPA)
  Mobile ──┘          │                                  worker, postgres, pgbouncer,
  app                 │                                  redis, mosquitto              │
                      └───────────────────────────────────────────┘
```

Caddy serves **one origin**: WebSocket upgrades (tracking + support) and `/api/*` go to the
API; everything else is the admin SPA. So there's no CORS and the admin image isn't tied to a
domain.

## 1. Prerequisites

- A VPS (Ubuntu 22.04+ is fine) with **Docker Engine + the Compose plugin**:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- A **domain** with an `A` (and `AAAA` if you have IPv6) record pointing at the VPS's IP.
  HTTPS won't issue until DNS resolves to the box. Open ports **80** and **443**.

## 2. Configure

```bash
git clone https://github.com/senafathoni2998/Drovery-Backend.git
cd Drovery-Backend
cp .env.prod.example .env
```

Edit `.env`: set `DOMAIN`, and generate strong secrets (the prod boot guard rejects weak ones):

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"   >> .env
echo "JWT_SECRET=$(openssl rand -hex 32)"          >> .env
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"  >> .env
# (then remove the placeholder lines for those keys)
```

## 3. Deploy — pick one

The compose file is `docker-compose.yml` + the `docker-compose.prod.yml` overlay.

### Option A — build on the VPS

Clone the admin repo **as a sibling** (the compose builds it from `../drovery-admin`):

```bash
cd ..
git clone https://github.com/senafathoni2998/Drovery-Admin-Frontend.git drovery-admin
cd Drovery-Backend
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### Option B — pull pre-built images from Docker Hub

First publish the images (one-time setup):

1. Create a Docker Hub **access token** (Account Settings → Security → New Access Token).
2. In **each** repo on GitHub (Backend + Admin-Frontend) → Settings → Secrets → Actions, add
   `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.
3. Tag a release in each repo to trigger the `publish.yml` workflow:
   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```
   This pushes `<user>/drovery-backend:v1.0.0` (+ `:latest`) and `<user>/drovery-admin:…`.

Then on the VPS you only need the backend repo (no source build):

```bash
# in .env: set DOCKER_REGISTRY=<your-dockerhub-user>  (and TAG=v1.0.0 to pin)
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## 4. Verify

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps      # all healthy, migrate Exited 0
curl -fsS https://$DOMAIN/api/v1/health                                 # {"status":"ok"}
```

Open `https://<DOMAIN>` → the admin console. Log in with the seeded admin
`admin@drovery.com` / `admin123` (the `migrate` one-shot seeds it — **change or remove the seed
for a real deployment**).

## 5. Point the mobile app at it

In `drovery-mobile/.env`: `EXPO_PUBLIC_API_URL=https://<DOMAIN>/api/v1` (and
`EXPO_PUBLIC_AUTH_MODE=api`), then rebuild the app. Tracking WebSockets work automatically
(Caddy routes the upgrade to the API).

## 6. Update / rollback

```bash
# build flow
git pull && (cd ../drovery-admin && git pull)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# pull flow — bump TAG in .env, then:
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Rollback = set `TAG` back to the previous version and re-run the pull flow. Postgres/Redis data
persist in named volumes across restarts.

## Notes

- **Secrets**: never commit `.env`. The Postgres password feeds postgres + pgbouncer + the
  app connection strings; rotating it means recreating the postgres volume (or `ALTER ROLE`).
- **Backups**: `docker compose ... exec postgres pg_dump -U postgres drovery > backup.sql`.
- **Scaling on a bigger box**: `--scale api=3 --scale worker=3` (Caddy load-balances the api
  replicas automatically); for real multi-node, see `k8s/` (HPA + KEDA) and `ARCHITECTURE.md`.
- **Observability**: layer `docker-compose.observability.yml` for Prometheus + Grafana.

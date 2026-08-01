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

The `publish.yml` workflow in each repo is the CI/CD that builds + pushes to Docker Hub
(`senaahmad2998/drovery-backend` and `senaahmad2998/drovery-admin`). One-time setup:

1. Create a Docker Hub **access token** (Account Settings → Security → New Access Token,
   Read/Write).
2. In **each** repo on GitHub (Backend + Admin-Frontend) → Settings → Secrets and variables →
   Actions, add a single secret: **`DOCKERHUB_TOKEN`** (the username is hard-coded, not secret).

It then publishes automatically:
- **every push** to the working branch → `:latest` + `:sha-<short>` (continuous delivery)
- **a version tag** (`git tag v1.0.0 && git push origin v1.0.0`) → `:v1.0.0` + `:latest`
- or run it manually from the Actions tab.

Then on the VPS you only need the backend repo (no source build, no admin clone):

```bash
# in .env: set DOCKER_REGISTRY=senaahmad2998  (and TAG=v1.0.0 to pin a release, else latest)
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

## 7. Automatic deploy (CI/CD via SSH)

The **Deploy to VPS** workflow (`.github/workflows/deploy.yml`) SSHes into the VPS and runs the
pull-flow for you — so a release is: tag → images publish → click Deploy.

**One-time setup** — add four repo secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `VPS_HOST` | the VPS IP / hostname |
| `VPS_USER` | the SSH user (in the `docker` group) |
| `VPS_SSH_KEY` | a **private** key whose public half is in that user's `~/.ssh/authorized_keys` |
| `VPS_PATH` | the `drovery-backend` directory on the VPS (where `.env` lives) |

**Run it:** Actions → *Deploy to VPS* → *Run workflow* → enter the image tag (`latest`, a
`vX.Y.Z`, or a `sha-<short>`). It runs `docker compose … pull && up -d` with
`DOCKER_REGISTRY=senaahmad2998` and that `TAG`, then prints `ps`.

It's **manual by design** (a human gates each prod deploy). For fully-automatic
deploy-on-release, change its trigger to `push: { tags: ['v*'] }` — but mind the timing: it
must run *after* both publish workflows finish, so prefer triggering on the tag in *this* repo
only once you've confirmed the images are pushed.

## Notes

- **Tag strategy**: `:latest` is convenient but mutable (it moves on every push) — fine for a
  staging box. For real prod, **pin a release** (`TAG=v1.0.0`, or a `:sha-<short>`) so a deploy
  is reproducible and rollback is exact; the Deploy workflow takes the tag as an input.
- **Secrets**: never commit `.env`. The Postgres password feeds postgres + pgbouncer + the
  app connection strings; rotating it means recreating the postgres volume (or `ALTER ROLE`).
- **Backups & restore**: see the runbook below — `scripts/backup.sh` / `scripts/restore.sh`.
- **Scaling on a bigger box**: `--scale api=3 --scale worker=3` (Caddy load-balances the api
  replicas automatically); for real multi-node, see `k8s/` (HPA + KEDA) and `ARCHITECTURE.md`.
- **Observability**: layer `docker-compose.observability.yml` for Prometheus + Grafana.


---

## Backups and restore

The previous instruction here was a single `pg_dump > backup.sql`. That produced an
unverified, uncompressed, unrotated file, and — the part that actually matters — there
was no documented restore, so the recovery path had never been executed. A backup you
have never restored is a hope, not a backup.

### Taking a backup

```bash
DATABASE_URL=postgres://... ./scripts/backup.sh
# custom location + retention
BACKUP_DIR=/mnt/backups RETAIN_DAYS=30 ./scripts/backup.sh
```

It writes a compressed custom-format archive, then **verifies** it with
`pg_restore --list` and fails if the archive is unreadable or contains no table data.
Retention runs last and only after a verified success, so a run of failures can never
age out the last good backup. Non-zero exit on any failure, so a timer surfaces it.

Suggested cron (daily 03:15 UTC, keep 14 days):

```cron
15 3 * * * cd /srv/drovery && DATABASE_URL=... BACKUP_DIR=/mnt/backups ./scripts/backup.sh >> /var/log/drovery-backup.log 2>&1
```

### Rehearsing the restore — do this on a schedule

```bash
DATABASE_URL=postgres://... ./scripts/restore.sh /mnt/backups/drovery-20260726T031500Z.dump
```

Restores into a scratch database, asserts the result is usable (table count, `users`
and `deliveries` are queryable, and **`deliveries` still has partition children**),
prints the elapsed time — your real RTO — then drops the scratch database. Exits
non-zero if the archive does not restore to a working database.

### Restoring for real

```bash
CONFIRM=i-understand-this-overwrites \
  ./scripts/restore.sh /mnt/backups/drovery-<stamp>.dump "$DATABASE_URL"
```

The confirmation is checked before the file is even read. Two things to know:

- **Do not run `prisma migrate deploy` into a freshly restored database** expecting it
  to rebuild the partitions. `deliveries` and its co-partitioned children are
  RANGE-partitioned and their child DDL is owned by the `partition_*` routines, not by
  Prisma (`prisma/PARTITIONING.md`). The custom-format dump already carries the parent,
  the children and the attachments.
- **Stop the API and worker first.** The restore uses `--clean`, and a live connection
  writing during it will produce a database that is neither the old one nor the new one.

### What is still missing

- **No point-in-time recovery.** These are nightly snapshots; the worst case is losing
  a day. PITR needs WAL archiving (`archive_mode`/`archive_command` or a managed
  Postgres that provides it) and is not configured.
- **Backups are local by default.** Set `BACKUP_DIR` to mounted off-host storage, or
  ship the archives somewhere else — a backup on the same disk as the database does not
  survive the failure it exists for.
- **No alert on a stale backup.** A silent backup failure is the same as no backup;
  the cron log is the only signal today.

---

## Alerting

`observability/alerts.yml` has always defined nine SLO rules, three of them
`severity: critical`. Until now `prometheus.yml` had no `alerting:` block and there was
no Alertmanager in the stack, so every one of them fired into the Prometheus UI and
nowhere else — the platform could detect an outage and page nobody.

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml \
  --profile observability up -d
```

- Prometheus  http://localhost:9090  (targets, rules, firing state)
- Alertmanager http://localhost:9093  (grouping, inhibition, silences)
- Grafana      http://localhost:3001  (admin/admin)

Routing is in `observability/alertmanager.yml`: `severity: critical` pages with a 10s
group wait and hourly repeat; everything else is ticketed. A tier that is DOWN inhibits
its own latency and error-rate alerts, so an outage pages once about the cause instead
of three times about the symptoms.

**Receivers ship empty on purpose.** Alertmanager does not expand environment variables
in its config, so a `${WEBHOOK}` placeholder would be taken literally and stop it from
starting. Empty receivers are valid — you get grouping, inhibition and silences out of
the box, and delivery is a few uncommented lines in that file (Slack, PagerDuty and
generic-webhook blocks are all written out ready to fill in).

### A caveat on `/health/ready`

`DroveryReadinessFailing` watches `GET /health/ready`, which checks Postgres and the
**cache** Redis. Every shipped config points all Redis roles at one instance, so that
covers them — but `src/config/configuration.ts` explicitly supports splitting `queue`,
`pubsub` and `throttle` onto separate hosts. If you use that, readiness silently stops
covering the roles you split off, and this alert will not fire for them.

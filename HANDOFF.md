# Drovery — session handoff (laptop switch, 2026-06-22)

You're a fresh Claude Code on a new laptop. **Your auto-memory does not transfer between machines**, so this file re-captures everything the previous session's memory held: current state, conventions, gotchas, env setup, and what's next. Read it fully before acting.

---

## ⚠️ DO THIS BEFORE WIPING THE OLD LAPTOP (time-sensitive)

On the **old** laptop, `drovery-mobile` has **uncommitted, local-only work** on branch `ci/android-aab` that will be **LOST** on a clean clone:

```
 M .env                              # machine-specific / gitignored — fine to lose, recreate from .env.example
 M app.json                          # REAL change — save if intentional
 M config/env.ts                     # REAL change — save if intentional (note: this currently FAILS __tests__/config/env.test.ts)
?? .github/workflows/unit-tests.yml  # UNTRACKED new CI workflow — REAL work, will be lost
```

→ On the old laptop, decide: commit + push these (or `git stash` + carry them), or accept losing them. The previous Claude deliberately did **not** touch them (they're your in-progress work). If `config/env.ts` is incomplete, that explains the one failing mobile test.

Also verify nothing else is unpushed anywhere: `git -C <repo> status` + `git -C <repo> log origin/main..HEAD` in all three repos.

---

## The system (3 sibling repos under one parent dir, e.g. `~/Documents/PP/`)

| Repo | GitHub remote | Stack | State |
|---|---|---|---|
| **drovery-backend** | `senafathoni2998/Drovery-Backend` | NestJS 11 · Prisma 7 (pg-adapter) · Postgres 16 · Redis/BullMQ | `main` green, tip `7884702`. Feature-complete + 1M+ scaling implemented + load-tested. |
| **drovery-mobile** | `senafathoni2998/drovery-mobile` | Expo SDK 54 · expo-router 6 · RN 0.81 · TS | `main` has merged features + Android-AAB CI. **PR #3 open** (handoff-share, awaiting your merge). WIP on `ci/android-aab` (above). |
| **drovery-admin** | `Drovery-Admin-Frontend` (a.k.a. senaahmad/…)  | Vite + React + MUI (web console on `/admin` API) | `main`, feature-complete (dashboard, deliveries oversight, promos, users, support). |

Drovery = a drone-delivery portfolio system, originally "designed for 100k," now **designed AND implemented for 1,000,000+ users**. All of ROADMAP P0–P3 + extensive post-roadmap work is DONE. CI/CD + Docker Hub publish are live for backend + admin (mobile → app stores via EAS).

---

## Working conventions (these lived in memory — honor them)

- **Cadence:** the user often just says **"continue"** = autonomously ship the next item end-to-end. Loop: **design → live-verify → adversarial review → fix → docs → memory**. Portfolio project; bias to thoroughness on review/audit work.
- **Commits:** **NO `Co-Authored-By` trailer.** Commit **per-file / granular** (small, focused commits). This overrides the harness default.
- **Branch protection:** all repos protect `main` (linear history, **NO merge commits**, PR-required). Merge **only** via **squash/rebase**. A local `--no-ff` push to a protected main gets bypass-flagged — don't.
- **PRs without `gh`:** `gh` is **not installed**. Create/merge PRs via the **GitHub REST API** using the token from `~/.git-credentials`:
  `TOKEN=$(sed -nE 's#https://[^:]+:([^@]+)@github\.com.*#\1#p' ~/.git-credentials | head -1)` — **never print/commit the token.** Merge: `PUT /repos/{slug}/pulls/{n}/merge` body `{"merge_method":"squash"}`. On the **new laptop you must re-configure git credentials** (or install `gh`) before this works.
- **CI/lint:** run **`npm run format`** before committing or CI's no-fix ESLint gate fails on prettier. `no-unsafe-*` are warn/off-for-specs **by design** — don't re-error them. Backend CI = `docker` + `test` + GitGuardian; also runs `node loadtest/capacity-model-1m.mjs` + `…-multiregion.mjs` as a smoke (only those two named files).
- **Prisma:** `prisma db push` AND `db pull` are **FORBIDDEN** on the partitioned tables (`deliveries`, `notifications`, + co-partitioned children) — neither round-trips `PARTITION BY`. Migrations only. `prisma migrate` needs `DATABASE_URL` in env (use `--create-only` to review SQL, then `migrate deploy`). Drift gate: `npm run prisma:drift-check`.
- **Workflow/subagents:** pin **`model: 'opus'`** on design/synthesis/review agents (`agentType:'Explore'` silently downgrades to Haiku). Ultracode mode → use the Workflow tool for substantive design/review (find→verify adversarial pattern).
- **Mobile gotcha:** the app only reads `EXPO_PUBLIC_*` env vars (plain `.env` keys are ignored by the client). Don't sweep the user's untracked `drovery-mobile/.github/` into commits.

---

## What the previous session (this one) shipped — the 1M+ scaling implementation

The design lives in **`SCALING-1M.md`** (read it — dense, with inline SHIPPED markers). All merged to backend `main`:

| PR | § | What |
|---|---|---|
| #9 | §5 | cache-aside on `/users/me` (60s TTL, fail-open, invalidate on update) + omit passwordHash |
| #10 | §4 | **sharded pub/sub** transport (`REDIS_PUBSUB_MODE=sharded` → SPUBLISH/SSUBSCRIBE) — §4 complete |
| #11 | §2 | **transactional outbox** (`src/outbox/`) + referral reward decoupled (Stage-1) |
| #12 | §2 | debit-first saga **A1** — pre-generate the delivery id (byte-identical keystone) |
| #13 | §2 | debit-first saga **A2** — the reorder behind `DELIVERY_DEBIT_FIRST` (authoritative debit/promo in their own single-shard txns before the delivery tx, with in-process compensation) |
| #14 | §2 | debit-first saga **A3** — orphan-reservation janitor (`src/deliveries/orphan-reaper/`, the crash-window safety net) |
| #15 | — | docker-free load harness (`loadtest/host-run.sh` + `host-driver.mjs`) — HTTP create path |
| #16 | — | WS-tracking load scenario (`SCENARIO=ws` + `host-ws-driver.mjs`) — realtime fan-out path |

Plus: both earlier review-found bugs were already fixed (Stripe webhook idempotency PR #3, push fan-out PR #4), and the mobile **handoff-share** enhancement is **mobile PR #3** (open).

**All scaling seams are env-gated + default-OFF (byte-identical when off):** `TRACKING_HOT_STORE=redis` (§3 hot-store), `REDIS_PUBSUB_MODE=sharded` (§4), `DELIVERY_OUTBOX_REFERRAL=true`, `DELIVERY_DEBIT_FIRST=true` (+ `ORPHAN_REAPER_*`, `OUTBOX_*` knobs). See `.env.example`.

**Verification done:** 710/710 backend tests, drift-clean migrations, per-tier boot-smokes, a **live end-to-end** debit-first saga run (real PG+Redis), and **load demonstrations** of both the create path and the realtime tier (both 0 errors / 0 5xx / 0 dropped frames / no regression — see `loadtest/RESULTS-host-load.md`). Each increment went through an Opus design-critique + adversarial find→verify review.

---

## What's NEXT / deferred (honest assessment)

**The only substantial item left is the multi-shard `ShardRouter` epic** (SCALING-1M.md §2 "L2"): a routing layer above `PrismaService` keyed on the shipped `shardKey` util, per-shard connection pools, + the last two cross-shard writes — **shard-prefixed `trackingId`** (deletes the cross-shard registry; a public-contract change) and the **global `promoCode.timesRedeemed` counter** for capped codes (per-shard replicate + reconcile, or accept bounded over-redeem).

⚠️ **This is inert until you actually run more than one shard, which has no payoff in a single-instance portfolio.** The previous session's repeated recommendation: **don't build it blind.** If the user wants to continue and there's no specific ask, surface this honestly rather than grinding inert infra — the products are feature-complete and the scaling work is implemented + demonstrated.

Smaller live loose ends: **merge mobile PR #3** if the user approves; decide on the mobile `ci/android-aab` WIP.

---

## New-laptop setup (to run/verify locally)

1. `git clone` all three repos under one parent dir (sibling dirs). `npm install` in each.
2. **Local services** (the live-verify + load harness need them): **PostgreSQL 16** on `:5432` (db `drovery`) + **Redis 7+** on `:6379`. `redis-server` is a plain binary (no Docker needed for it). **Docker is NOT available in the agent sandbox** here — the containerized `loadtest/run.sh` can't run; use the docker-free `loadtest/host-run.sh` instead.
3. `.env` in backend from `.env.example` (set `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`). Apply migrations: `export $(grep -v '^#' .env | xargs); npx prisma migrate deploy && npx prisma generate`.
4. **Verify:** `npx tsc --noEmit` · `npx jest` (710 tests) · `npx eslint "src/**/*.ts"` · `npm run build` · `npm run prisma:drift-check`.
5. **Boot-smoke per tier:** `PROCESS_ROLE=api node dist/src/main.js` / `PROCESS_ROLE=worker node dist/src/worker.js` (also `realtime`).
6. **Load demo (docker-free):** `POOL=24 VUS=40 HOLD=30 bash loadtest/host-run.sh` (HTTP) and `SCENARIO=ws POOL=20 FANOUT=5 HOLD=90 bash loadtest/host-run.sh` (realtime). `SCALING=off` for the baseline.
7. Demo admin login is seeded: `admin@drovery.com` (see `prisma/seed.ts` for creds).

## Key in-repo reference docs
`CLAUDE.md` (auto-loaded) · `SCALING-1M.md` (the 1M+ design + shipped status) · `ARCHITECTURE.md` · `loadtest/RESULTS-host-load.md` + `loadtest/CAPACITY-MODEL.md` · `prisma/PARTITIONING.md` · `DEPLOY.md` (VPS/Docker) · `SYSTEM-OVERVIEW` section atop the README.

## Re-seed your memory (optional but recommended)
The old laptop had memory files at `~/.claude/projects/<project-slug>/memory/` (MEMORY.md index + per-fact files: `drovery-scaling-1m`, `drovery-roadmap-position`, `drovery-working-cadence`, `drovery-commit-style`, `drovery-main-branch-protection`, `drovery-ci-lint-posture`, `workflow-agents-use-opus`, etc.). They don't transfer. As you work, re-create the ones that matter from the sections above (especially the conventions). This HANDOFF.md is the authoritative snapshot as of 2026-06-22.

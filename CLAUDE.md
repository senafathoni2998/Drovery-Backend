# Drovery Backend — konvensi kerja

NestJS 11 · Prisma 7 (pg adapter) · PostgreSQL 16 · Redis/BullMQ · MQTT · Docker/K8s · OpenTelemetry.
Proyek portofolio: sistem pengiriman drone, dirancang **dan** diimplementasikan untuk 1.000.000+ pengguna.

> Menggantikan `HANDOFF.md` di branch `chore/session-handoff` (22 Jun 2026), yang sudah usang dan
> beberapa klaimnya terbukti salah saat diperiksa 18 Agu 2026. Jangan pakai dokumen itu.

## Commit

- **Granular** — per-file atau per-topik, bukan satu commit raksasa.
- **Conventional commits dengan scope**: `fix(airspace): …`, `test(fleet): …`, `docs(audit): …`.
  Judul menjelaskan **apa yang berubah dan kenapa**, bukan "update file".
- **JANGAN pakai trailer `Co-Authored-By`.** Ini menimpa default harness.
  (Terverifikasi: 0 kemunculan di 50 commit terakhir `main`.)
- Jalankan **`npm run format`** sebelum commit — gerbang ESLint di CI tidak memperbaiki sendiri dan
  akan gagal soal prettier.

## Branch

- **`main` DIPROTEKSI lewat GitHub ruleset**, bukan branch protection klasik. Diperiksa 18 Agu 2026:

  | Repo | Aturan aktif di `main` |
  |---|---|
  | Drovery-Backend | `pull_request` · `required_linear_history` · `non_fast_forward` · `creation` · `deletion` · `update` |
  | drovery-mobile | sama |
  | Drovery-Admin-Frontend | tidak ada aturan |

  ⚠️ Endpoint `GET /repos/{slug}/branches/main/protection` menjawab **"Branch not protected"**
  meskipun ruleset aktif — ia hanya melaporkan proteksi klasik. Pakai
  `GET /repos/{slug}/rules/branches/main` untuk melihat yang sebenarnya berlaku.

- **Jangan push langsung ke `main`.** Sebagai admin, push-mu akan *berhasil* tapi ditandai
  `Bypassed rule violations` di sisi remote — melanggar aturan sambil terlihat sukses.
  Kerjakan di branch `fix/…`, `feat/…`, `docs/…`, lalu **merge lewat PR dengan squash/rebase**.
- `required_linear_history` aktif, jadi merge commit ditolak. (Ada 8 merge commit lama di `main` —
  peninggalan dari sebelum ruleset dipasang, atau hasil bypass. Jangan jadikan preseden.)
- Kerja belajar/kurikulum **tidak** masuk `main` — lihat branch `docs/kurikulum-belajar`.

## PR tanpa `gh`

`gh` tidak terpasang. Pakai REST API dengan token dari `~/.git-credentials`:

```bash
TOKEN=$(sed -nE 's#https://[^:]+:([^@]+)@github\.com.*#\1#p' ~/.git-credentials | head -1)
```

**Jangan pernah mencetak, menyalin ke file, atau meng-commit token itu.**
Merge: `PUT /repos/{slug}/pulls/{n}/merge` dengan body `{"merge_method":"squash"}`.
Di laptop baru, kredensial harus dikonfigurasi ulang dulu.

## Prisma — larangan keras

- **`prisma db push` dan `prisma db pull` DILARANG.** Keduanya tidak round-trip `PARTITION BY`, dan
  tabel `deliveries` + `notifications` (beserta anak-anak co-partitioned-nya) di-partisi RANGE per bulan.
  Menjalankannya akan diam-diam merusak partisi. **Migration saja.**
- `prisma migrate` butuh `DATABASE_URL` di env. Pakai `--create-only` untuk meninjau SQL dulu,
  baru `migrate deploy`.
- Gerbang drift: `npm run prisma:drift-check`.
- Migrasi **harus** bypass PgBouncer (advisory lock ber-scope sesi) — lihat `DATABASE_URL_DIRECT`
  di `docker-compose.yml` dan `k8s/base/migrate-job.yaml`.

## Lint

`no-unsafe-*` sengaja warn (dan off untuk file spec). **Jangan** dikembalikan jadi error.

## Subagent / Workflow

Sematkan **`model: 'opus'`** pada agen desain, sintesis, dan review. `agentType: 'Explore'` diam-diam
turun ke Haiku.

## Verifikasi lokal

```bash
npx tsc --noEmit && npx jest && npx eslint "src/**/*.ts" && npm run build && npm run prisma:drift-check
```

Boot-smoke per tier: `PROCESS_ROLE=api node dist/src/main.js` · `PROCESS_ROLE=worker node dist/src/worker.js`.

## Dokumen rujukan di repo

`ARCHITECTURE.md` · `SCALING-1M.md` · `ROADMAP.md` · `DEPLOY.md` · `INTEGRATION.md` ·
`prisma/PARTITIONING.md` · `loadtest/CAPACITY-MODEL.md` · `AUDIT-PLAN.md` + `AUDIT-LOG.md`.

Baca penanda statusnya secara skeptis: ✅ dibangun+diverifikasi · 🟡 sebagian · 📐 baru dirancang.
Bagian `Left undone` di `AUDIT-LOG.md` adalah tempat utang dicatat jujur.

## Kalau sesi ini soal BELAJAR, bukan soal fitur

Konteks belajar hidup di repo terpisah: **`drovery-learning`** (sibling directory).
Baca `drovery-learning/PROGRESS.md` dulu — memory Claude tidak ikut pindah antar-mesin.
Kurikulumnya ada di branch `docs/kurikulum-belajar`, folder `docs/learning/`.

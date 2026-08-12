# Peta Belajar — `backend:infra-and-deploy` (Drovery Backend)

Untuk pembelajar: **frontend dev Ionic React + Capacitor**. Sudah paham React/TS, packaging mobile,
konsumsi REST dari client. **Belum** paham Docker, Kubernetes, message queue, observability.

Analogi pembuka yang dipakai sepanjang peta ini:

| Yang kamu sudah tahu (mobile) | Padanannya di sini |
|---|---|
| `npm run build` → folder `www/` | `npm run build` → folder `dist/` (tahap *builder* di Dockerfile) |
| Android APK/AAB = artefak yang dikirim ke device | **Docker image** = artefak yang dikirim ke server |
| `capacitor.config.ts` = konfigurasi per-platform | `docker-compose*.yml` / Kustomize overlay = konfigurasi per-environment |
| Play Store internal track vs production track | tag image `:sha-<short>` / `:latest` vs `:v1.0.0` |
| Crashlytics | Prometheus + Alertmanager + Sentry |
| Emulator | `docker compose up` (stack lengkap di laptop) |

Satu ide besar yang mengikat SEMUA konsep di area ini (baca ini dulu, lalu baru konsepnya):

> **Satu image, banyak peran.** `Dockerfile:63-64` membangun **satu** image. Peran node ditentukan
> `command` + env `PROCESS_ROLE` (`src/common/process-role.ts:15-26`). `api`, `worker`, `realtime`,
> dan `migrate` semuanya image yang sama. Semua topologi di bawah (Compose, k8s, load test) cuma
> variasi "berapa banyak replika dari peran mana, dan siapa yang jadi tetangganya".

---

## Peta file Compose — file mana untuk pelajaran mana

Ini penting: repo ini punya **5 file compose** dan mereka **dilapis** (`-f a.yml -f b.yml`), bukan
dipilih salah satu. Urutan file menentukan siapa yang menimpa siapa.

| Pelajaran | Perintah persis | File |
|---|---|---|
| Docker + Compose dasar, healthcheck, `depends_on`, PgBouncer, worker split | `docker compose up --build` | `docker-compose.yml` |
| Scaling horizontal + LB + k6 | `docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d --build --scale api=3 --scale worker=3` | base + `docker-compose.loadtest.yml` |
| "Node" berukuran tetap (CPU quota per replika) | `sudo NODES=1 bash loadtest/run.sh` | base + loadtest + `docker-compose.nodes.yml` (urutan ke-3) |
| Prometheus/Alertmanager/Grafana | `docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile observability up -d` | base + `docker-compose.observability.yml` |
| Deploy production 1 VPS + HTTPS otomatis | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` | base + `docker-compose.prod.yml` |

Aturan yang gampang bikin bingung: `docker-compose.nodes.yml` **harus jadi file ketiga**
(`loadtest/run.sh:29-34` melakukannya otomatis saat `NODES=1`), dan `docker-compose.observability.yml`
butuh `--profile observability` (`docker-compose.observability.yml:14`) karena service-nya
profile-gated supaya `docker compose up` default tetap ringan.

---

## 1. Docker image, layer, dan layer caching

- **Prasyarat:** —
- **Anchor:** `Dockerfile:16-24` — perhatikan `COPY package*.json ./` + `COPY prisma ./prisma` +
  `RUN npm ci` dijalankan **sebelum** `COPY . .`. Bandingkan komentarnya di `Dockerfile:16`
  ("Install deps against the lockfile first (better layer caching)").
- **Kenapa dipakai di sini:** Setiap instruksi `RUN`/`COPY`/`ADD` menghasilkan satu **layer** yang
  di-cache berdasarkan isi input-nya. Kalau `COPY . .` ditaruh di atas `npm ci`, maka mengubah satu
  baris di `src/` akan meng-invalidate cache `npm ci` dan build ulang seluruh `node_modules`. Dengan
  urutan yang dipakai repo ini, `npm ci` hanya di-rebuild kalau `package.json`/`package-lock.json`
  berubah. Efeknya nyata di CI: `.github/workflows/ci.yml:104-105` dan
  `.github/workflows/publish.yml:46-47` mengaktifkan `cache-from: type=gha` /
  `cache-to: type=gha,mode=max` — cache layer ini disimpan lintas run GitHub Actions.
  `Dockerfile:1` (`# syntax=docker/dockerfile:1`) memilih frontend BuildKit modern yang membuat cache
  ini bisa dimanfaatkan.
- **Alternatif:**
  - **Tidak pakai Docker sama sekali (deploy source + `npm ci` di server, pakai pm2/systemd)** —
    lebih sederhana untuk 1 server, tapi "works on my machine" kembali: versi Node, `openssl`, dan
    binary engine Prisma jadi tanggung jawab server. Repo ini justru memilih Docker karena
    engine Prisma sensitif terhadap libc/openssl (lihat konsep #2).
  - **Buildpacks (Paketo / `pack`) atau Nixpacks** — tidak perlu menulis Dockerfile, tapi kamu
    kehilangan kontrol eksplisit atas tahap `prisma generate`, user non-root, dan HEALTHCHECK yang
    di-*bake* di sini.
  - **`npm install` alih-alih `npm ci`** — `npm ci` menolak jika lockfile tidak sinkron dan menghapus
    `node_modules` dulu; itu yang membuat build **reproducible**. `npm install` bisa diam-diam
    meng-upgrade dependency saat build image.
- **Latihan:** Jalankan `docker build -t drovery-backend:lat1 .`, catat waktunya. Ubah satu baris
  komentar di `src/main.ts`, build lagi — perhatikan step `npm ci` menampilkan `CACHED`. Lalu tambah
  satu dependency kosong di `package.json`, build lagi — sekarang `npm ci` jalan penuh. Tulis 3
  angka waktu itu; itulah nilai ekonomi layer caching.

---

## 2. Multi-stage build & kenapa `node:22-slim`, bukan `alpine`

- **Prasyarat:** #1
- **Anchor:** `Dockerfile:3-8` (komentar builder) dan `Dockerfile:26-35` (komentar runtime), lalu
  `Dockerfile:45-48` (`COPY --from=builder`).
- **Kenapa dipakai di sini:** Dua alasan berbeda, keduanya tertulis di file:
  1. **Multi-stage.** Tahap `builder` butuh seluruh devDependencies + toolchain TypeScript. Tahap
     `runtime` hanya menyalin hasilnya: `node_modules`, `dist`, `prisma`, `package.json`
     (`Dockerfile:45-48`). Yang tidak disalin (source `.ts`, cache build) tidak pernah masuk image
     final.
  2. **`node:22-slim` (Debian, glibc) BUKAN `alpine` (musl).** Komentarnya eksplisit di
     `Dockerfile:5-6`: *"debian-slim (glibc) avoids the musl/openssl binary-target friction Prisma
     hits on Alpine"*. Prisma mengirim **query engine biner** yang di-compile per target
     (`debian-openssl-3.0.x`, `linux-musl-openssl-3.0.x`, dst). Di Alpine kamu harus mengurus
     `binaryTargets` + `libc6-compat` + versi openssl yang cocok, dan gagalnya baru kelihatan
     **saat runtime**, bukan saat build. `Dockerfile:11-14` dan `Dockerfile:39-41` sengaja memasang
     `openssl` + `ca-certificates` di **kedua** tahap karena Prisma butuh openssl saat `generate`
     maupun saat konek.
- **Catatan jujur dari repo:** `Dockerfile:30-33` mengakui trade-off — devDependencies **sengaja
  tidak** di-prune karena peran `migrate` menjalankan `prisma db seed` yang butuh `ts-node`. Image
  jadi lebih besar; alternatifnya (ditulis di komentar) adalah image migrasi terpisah +
  `npm prune --omit=dev`. Ini contoh bagus "keputusan sadar, bukan kelalaian".
- **Alternatif:**
  - **`node:22-alpine`** — image ~5× lebih kecil, tapi musl libc: Prisma butuh `binaryTargets`
    tambahan, dan beberapa native module (bcrypt) perlu rebuild. Repo ini memilih ukuran lebih besar
    demi nol gesekan Prisma.
  - **`gcr.io/distroless/nodejs22`** — permukaan serangan paling kecil (tanpa shell), tapi
    `HEALTHCHECK` berbasis `wget` di `Dockerfile:60-61` dan `command: ['sh','-c', ...]`
    di `docker-compose.yml:86` tidak akan jalan karena tidak ada shell.
  - **Single-stage build** — Dockerfile lebih pendek, tapi source `.ts`, cache npm, dan toolchain
    ikut terkirim ke production.
- **Latihan:** Bandingkan `docker image ls drovery-backend`. Lalu buat `Dockerfile.alpine` dengan
  `FROM node:22-alpine` tanpa mengubah hal lain, build, dan jalankan
  `docker run --rm drovery-backend:alpine node -e "require('@prisma/client')"`. Catat pesan error
  engine yang muncul — itu bukti konkret komentar di `Dockerfile:5-6`.

---

## 3. Build context & `.dockerignore`

- **Prasyarat:** #1
- **Anchor:** `.dockerignore:1-20` — khususnya `node_modules`, `dist`, `.git`, `.env`, `.env.*`
  dengan pengecualian `!.env.example` (`.dockerignore:7-9`).
- **Kenapa dipakai di sini:** `COPY . .` di `Dockerfile:23` menyalin seluruh build context. Tanpa
  `.dockerignore`, `node_modules` host (yang mungkin berisi binary untuk OS lain) dan `.git` ikut
  terkirim ke daemon — lambat, dan `node_modules` host akan **menimpa** hasil `npm ci` di dalam
  image. Baris `.env` + `.env.*` (`.dockerignore:7-8`) adalah kontrol keamanan: mencegah secret
  production ikut ter-*bake* ke image yang nanti di-push ke Docker Hub
  (`.github/workflows/publish.yml:35`).
- **Alternatif:**
  - **Tanpa `.dockerignore`, andalkan `COPY src ./src` yang eksplisit** — aman juga, tapi tiap
    penambahan folder baru harus diingat; `.dockerignore` adalah deny-list yang gagal lebih aman.
  - **Build context remote (`docker build https://github.com/...`)** — tidak butuh file lokal, tapi
    tidak bisa memakai file yang belum di-commit; tidak cocok untuk iterasi.
- **Latihan:** Jalankan `docker build .` dan perhatikan baris pertama `transferring context: ... B`.
  Lalu komentari baris `node_modules` di `.dockerignore` dan build lagi — bandingkan ukuran context
  (repo ini punya folder `node_modules` besar). Kembalikan setelah selesai.

---

## 4. Runtime hardening: non-root user, `EXPOSE`, `HEALTHCHECK`, `CMD`

- **Prasyarat:** #2
- **Anchor:** `Dockerfile:42-43` (`groupadd`/`useradd` uid 1001), `Dockerfile:56` (`USER nodejs`),
  `Dockerfile:60-61` (`HEALTHCHECK`), `Dockerfile:64` (`CMD ["node","dist/src/main"]`).
- **Kenapa dipakai di sini:** Container yang jalan sebagai root = proses root di kernel host. UID
  1001 di sini bukan angka acak: `k8s/base/api-deployment.yaml:20-23` menegaskan
  `runAsUser: 1001` dengan komentar *"matches the Dockerfile's nodejs user"* — kalau tidak cocok,
  file yang ditulis container jadi tak terbaca. `HEALTHCHECK` di-*bake* ke image sehingga
  `docker compose ps` bisa menampilkan `healthy`, dan itulah yang dipakai
  `depends_on: condition: service_healthy` (konsep #7). Perhatikan `Dockerfile:40` memasang `wget`
  **khusus** supaya HEALTHCHECK ini punya alat untuk jalan.
- **Alternatif:**
  - **Healthcheck di orchestrator saja (Compose `healthcheck:` / k8s probe), tidak di image** —
    lebih fleksibel per-environment. Repo ini melakukan **keduanya**: image punya default, dan
    k8s **menggantinya** dengan tiga probe berbeda (`k8s/base/api-deployment.yaml:39-53`) karena
    Docker HEALTHCHECK tidak bisa membedakan *liveness* vs *readiness*.
  - **`ENTRYPOINT` + `CMD`** alih-alih `CMD` saja — `ENTRYPOINT` mengunci binary dan `CMD` jadi
    argumen. Repo ini memakai `CMD` polos justru **supaya bisa ditimpa total**:
    `docker-compose.yml:124` menimpanya jadi `node dist/src/worker`, dan
    `docker-compose.yml:86` jadi perintah migrasi.
- **Latihan:** `docker run --rm drovery-backend:lat1 id` → pastikan `uid=1001`. Lalu jalankan
  `docker compose up postgres pgbouncer redis mosquitto migrate api -d` dan pantau
  `docker compose ps` sampai kolom status api berubah dari `starting` ke `healthy` — itu
  `--start-period=20s` di `Dockerfile:60` yang bekerja.

---

## 5. Satu image, banyak peran — `PROCESS_ROLE`

- **Prasyarat:** #4
- **Anchor:** `src/common/process-role.ts:15-26` (definisi `IS_WORKER_TIER` / `IS_HTTP_TIER` /
  `IS_INGEST_TIER`), lalu lihat pemakaiannya: `docker-compose.yml:99` (`PROCESS_ROLE: api`),
  `docker-compose.yml:124,127` (worker), `k8s/base/realtime-deployment.yaml:41`
  (`PROCESS_ROLE: realtime`).
- **Kenapa dipakai di sini:** `k8s/README.md:3-5` menyatakannya sebagai prinsip:
  *"One container image (drovery-backend) runs every role — the role is chosen by the container
  command + PROCESS_ROLE"*. Konsekuensinya konkret: CI hanya perlu build **satu** image
  (`.github/workflows/publish.yml:41-47`), dan `docker-compose.prod.yml:35,40,57` memakai referensi
  image yang **identik** untuk migrate/api/worker dengan komentar *"Reuses the backend image so it
  isn't built/pulled twice"*. Kenapa peran `realtime` ada dipaparkan di `SCALING-1M.md:196-205`:
  socket WS yang panjang-umur punya ceiling berbeda (FD/heap), jadi harus bisa di-scale terpisah
  dari tier HTTP.
- **Alternatif:**
  - **Satu image per peran (api-image, worker-image)** — image lebih ramping per peran, tapi
    pipeline build ×3, matriks tag ×3, dan risiko drift versi antar-tier (api v5 bicara ke worker v4).
  - **Satu proses menjalankan semuanya** (mode `unset`, yaitu default dev — `process-role.ts:10`) —
    paling mudah untuk lokal, tapi tidak bisa di-scale terpisah: menambah replika untuk menyerap
    trafik HTTP otomatis menggandakan konsumsi queue juga.
- **Latihan:** Jalankan `docker compose up -d --scale worker=3`, lalu
  `docker compose exec api printenv PROCESS_ROLE` dan `docker compose exec worker printenv PROCESS_ROLE`.
  Kemudian buktikan pemisahannya: `docker compose logs worker | head -30` (harus terlihat log
  processor BullMQ) vs `docker compose logs api | head -30` (harus terlihat route mapping Nest).

---

## 6. Compose sebagai service graph: services, volumes, network

- **Prasyarat:** #5
- **Anchor:** `docker-compose.yml:1-14` (diagram topologi di komentar header) lalu daftar service
  `postgres` (17), `pgbouncer` (34), `redis` (55), `mosquitto` (69), `migrate` (84), `api` (94),
  `worker` (122), dan `volumes:` (143-146).
- **Kenapa dipakai di sini:** Header file menggambar topologi yang persis dicerminkan k8s nanti
  (`k8s/README.md:3` "mirroring the docker-compose.yml topology"). Beberapa mekanik penting:
  - **DNS internal.** `api` konek ke `pgbouncer:5432` (`docker-compose.yml:101`) — nama service
    adalah hostname. Ini yang membuat `--scale api=3` bisa dibaca nginx sebagai 3 A-record
    (lihat konsep #12).
  - **Named volume** (`pgdata`, `redisdata`, `mosquittodata`) memisahkan **data** dari **container**.
    `DEPLOY.md:113-114`: *"Postgres/Redis data persist in named volumes across restarts"* — itulah
    kenapa rollback tag image tidak menghilangkan data.
  - **Redis dipakai untuk tiga hal sekaligus** (`docker-compose.yml:1-6` komentar: "queue + cache +
    rate-limit"). `SCALING-1M.md:230-237` menjelaskan kenapa itu akhirnya harus dipecah per-concern.
  - **Mosquitto (MQTT)** ada sebagai transport push opsional; `docker-compose.yml:66-68` menjelaskan
    alasan spesifiknya: *"Mosquitto 2 supports MQTT5 shared subscriptions, so each ingest frame is
    processed by exactly ONE api replica"* — tanpa shared subscription, menambah replika api akan
    memproses frame telemetri yang sama berkali-kali.
- **Alternatif:**
  - **Menjalankan Postgres/Redis langsung di host (apt install)** — lebih cepat sedikit, tapi versi
    tidak tercatat di repo dan tidak reproducible di mesin rekan tim.
  - **`docker run` manual + `--link`** — deprecated; Compose memberi network + DNS + dependency graph
    secara deklaratif.
  - **Managed services (RDS/ElastiCache) bahkan untuk lokal** — biaya + latency; `k8s/README.md:45-48`
    menyatakan bahwa di k8s memang Postgres/PgBouncer/Redis **sengaja tidak ada** dan diasumsikan
    managed.
- **Latihan:** Jalankan `docker compose up -d` lalu `docker compose exec api getent hosts pgbouncer`
  dan `docker compose exec api getent hosts postgres`. Lanjut: `docker compose down` (tanpa `-v`),
  `docker compose up -d`, dan cek datanya masih ada; lalu `docker compose down -v` dan lihat seeding
  jalan lagi dari nol.

---

## 7. Healthcheck + `depends_on` condition + one-shot job `migrate`

- **Prasyarat:** #6
- **Anchor:** `docker-compose.yml:25-29` (healthcheck postgres `pg_isready`),
  `docker-compose.yml:82-92` (service `migrate`), dan yang paling penting
  `docker-compose.yml:110-118` (blok `depends_on` milik `api`).
- **Kenapa dipakai di sini:** `depends_on` polos hanya menjamin **urutan start**, bukan **kesiapan**.
  Repo ini memakai bentuk kondisional:
  - `condition: service_healthy` untuk `redis`, `pgbouncer`, `mosquitto` — api tidak boot sebelum
    dependensi benar-benar menjawab. Perhatikan healthcheck-nya bukan "cek port terbuka" tapi
    perintah protokol asli: `pg_isready` (`:26`), `redis-cli ping` (`:61`),
    `mosquitto_pub` (`:77`).
  - `condition: service_completed_successfully` untuk `migrate` (`docker-compose.yml:117-118`) —
    ini pola **one-shot job**: `migrate` menjalankan `prisma migrate deploy && prisma db seed`
    lalu **exit 0** (`restart: 'no'` di `:92`), dan api/worker baru boleh start setelah itu.
    Tanpa ini, api bisa boot ke database yang tabelnya belum ada.
  - Satu detail yang sangat instruktif: `migrate` konek **langsung ke `postgres:5432`**
    (`docker-compose.yml:88`), bukan ke pgbouncer, dengan komentar di `:82-83`
    *"DDL + migration advisory locks bypass the transaction pooler by design"*. Ini jembatan ke
    konsep #8 dan diulang di k8s (`k8s/base/migrate-job.yaml:31-35`).
- **Alternatif:**
  - **Script `wait-for-it.sh` / `dockerize` di entrypoint** — jalan di mana saja (termasuk Swarm/k8s
    yang mengabaikan `depends_on`), tapi logika tunggu jadi tersebar di banyak image.
  - **Retry di level aplikasi** (app boot ulang sampai DB siap) — paling tangguh di production, tapi
    log jadi berisik dan startup tidak deterministik saat mengajar.
  - **Migrasi otomatis di dalam entrypoint app** — sederhana, tapi dengan N replika kamu punya N
    proses mencoba migrasi bersamaan; job terpisah membuatnya tepat sekali.
- **Latihan:** Jalankan `docker compose up` (foreground) dari state bersih (`down -v` dulu) dan amati
  urutannya: postgres healthy → pgbouncer healthy → migrate `Exited (0)` → api start. Lalu rusak
  sengaja: ubah `docker-compose.yml:86` menjadi `npx prisma migrate deploy && exit 1`, `up` lagi, dan
  lihat api **tidak pernah** start. Kembalikan.

---

## 8. PgBouncer & transaction pooling — kenapa ini yang memungkinkan autoscaling

*(Ini konsep paling penting sekaligus paling sulit di area ini.)*

- **Prasyarat:** #7
- **Anchor:** `docker-compose.yml:31-53` — baca komentar `:31-33` dulu, lalu env
  `POOL_MODE: transaction` (`:42`), `MAX_CLIENT_CONN: 1000` (`:43`),
  `DEFAULT_POOL_SIZE: 20` (`:44`). Pasangannya: `DATABASE_POOL_MAX: 10` di api
  (`docker-compose.yml:102`) dan `DATABASE_POOL_MAX: 5` di worker (`:129`).
- **Kenapa dipakai di sini:** Komentarnya menyatakan tesisnya langsung:
  *"Multiplexes many app clients onto a small Postgres server-side pool — this is what lets the
  API/worker tiers autoscale without exhausting Postgres `max_connections`."*
  Matematikanya: Postgres punya `max_connections` (default ~100) dan **setiap koneksi = satu proses
  OS**, jadi tidak murah. Tiap replika api membuka pool sendiri (10 koneksi). 3 replika api + 3
  worker sudah 45 koneksi; skala ke 20 replika (`k8s/base/api-hpa.yaml:11`) = 200+ koneksi → Postgres
  menolak. PgBouncer duduk di tengah: aplikasi melihat 1000 slot klien, Postgres hanya melihat 20.
  Repo ini bahkan menghitung ceiling-nya secara eksplisit di `SCALING-1M.md:246-248`:
  *"The PgBouncer ceiling is `floor((1000 − workerNodes×5)/10) ≈ 94 api nodes` on one pooler"* —
  dan resepnya: satu PgBouncer per write-shard.
  **`POOL_MODE: transaction`** artinya koneksi server dikembalikan ke pool di akhir tiap transaksi,
  bukan di akhir sesi — itulah yang memberi rasio multiplexing tinggi. Harganya: fitur ber-*state
  sesi* rusak (prepared statement lintas transaksi, `SET`, advisory lock ber-scope sesi, `LISTEN`).
  Itu sebabnya migrasi harus bypass pooler — dinyatakan dua kali di repo:
  `docker-compose.yml:82-83` dan `k8s/base/migrate-job.yaml:31-35`
  (*"DDL + Prisma's session-scoped advisory locks break through PgBouncer transaction pooling"*),
  dengan URL terpisah `DATABASE_URL_DIRECT` di `k8s/base/secrets.env.example:8-11`.
- **Alternatif:**
  - **`POOL_MODE: session`** — kompatibilitas 100% dengan Postgres (advisory lock, prepared stmt,
    `LISTEN` semua jalan), tapi 1 klien memegang 1 koneksi server sepanjang sesi → nyaris tidak ada
    multiplexing, jadi tidak menyelesaikan masalah autoscaling.
  - **`POOL_MODE: statement`** — rasio tertinggi, tapi transaksi multi-statement dilarang total;
    `create()` di repo ini pakai `$transaction`, jadi mustahil.
  - **Pgpool-II** — bisa pooling + load-balance read replica + query cache; jauh lebih berat dan
    kompleks. Repo ini memilih PgBouncer (ringan, 1 fungsi) dan menangani read-replica di level
    aplikasi (`readWithFallback`, lihat `ARCHITECTURE.md:92`).
  - **Supavisor / RDS Proxy / Cloud SQL connector** — managed, tidak perlu operasikan sendiri, tapi
    vendor-locked dan tidak bisa dijalankan di laptop untuk belajar.
  - **Tanpa pooler, cukup naikkan `max_connections`** — tiap koneksi ~5-10MB dan satu proses;
    ribuan koneksi menghancurkan Postgres jauh sebelum kehabisan slot.
- **Latihan:** Nyalakan stack (`docker compose up -d --scale api=3`), lalu jalankan
  `docker compose exec postgres psql -U postgres -d drovery -c "select count(*), application_name from pg_stat_activity group by 2;"`.
  Naikkan `--scale api=6`, ulangi query — jumlah koneksi ke Postgres **tidak** naik 2×, karena
  `DEFAULT_POOL_SIZE: 20` yang mengikat. Lalu buktikan sisi lainnya: ubah `DATABASE_URL` service
  `migrate` (`docker-compose.yml:88`) menjadi `@pgbouncer:5432`, `docker compose up migrate`, dan baca
  errornya — itu advisory lock Prisma yang pecah di transaction pooling.

---

## 9. Overlay Compose: melapis file, `!reset`, dan interpolasi env

- **Prasyarat:** #7
- **Anchor:** `docker-compose.prod.yml:1-13` (cara pakai), `docker-compose.prod.yml:43`
  (`ports: !reset []`), `docker-compose.prod.yml:19` (`${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}`),
  `docker-compose.prod.yml:35,40` (`${DOCKER_REGISTRY:-drovery}/drovery-backend:${TAG:-latest}`).
- **Kenapa dipakai di sini:** Compose menggabungkan file `-f` secara berurutan; file berikutnya
  **menambah/menimpa** field. Ini yang memungkinkan satu base topology dipakai untuk dev, prod, load
  test, dan node-isolation tanpa duplikasi. Tiga idiom penting:
  - **`!reset []`** (`docker-compose.prod.yml:43`, juga `docker-compose.loadtest.yml:17`) — merge
    Compose secara default *menggabungkan* list; untuk **menghapus** `ports: ['3000:3000']` dari base
    kamu butuh `!reset`. Alasannya berbeda di dua file: di prod karena Caddy yang pegang port publik
    (`:43` "fronted by Caddy — no host port"); di loadtest karena satu host port tidak bisa dibagi
    oleh 3 replika (`docker-compose.loadtest.yml:17` "no host-port conflict when scaling").
  - **`${VAR:?pesan}`** — gagal-keras jika env tidak diset. Repo memakainya untuk semua secret
    (`:19,24,46,47,87`), sejalan dengan boot guard aplikasi yang menolak secret lemah
    (`DEPLOY.md:37`).
  - **`${VAR:-default}`** — nilai default; dipakai untuk `TAG`, `DOCKER_REGISTRY`, `CORS_ORIGINS`.
- **Alternatif:**
  - **File compose terpisah dan lengkap per environment** — tidak ada sihir merge, tapi duplikasi
    dan mudah drift.
  - **`extends:`** (Compose v2 mengembalikannya) — reuse per-service, bukan per-file; lebih granular
    tapi tidak bisa "tambah service baru untuk environment ini" semudah overlay.
  - **Helm/Kustomize saja** (langsung k8s tanpa Compose) — konsisten dengan production, tapi butuh
    cluster untuk iterasi lokal; repo ini memilih Compose untuk laptop dan Kustomize untuk cluster,
    dan sengaja membuat keduanya bercermin.
- **Latihan:** Jalankan `docker compose -f docker-compose.yml -f docker-compose.prod.yml config`
  (tanpa daemon pun bisa) dan baca YAML hasil merge-nya. Cari service `api`: buktikan `ports` hilang
  dan `image` muncul. Lalu hapus `DOMAIN` dari `.env` dan jalankan `config` lagi — baca pesan gagalnya.

---

## 10. Edge production: Caddy, HTTPS otomatis, dan single-origin (tanpa CORS)

- **Prasyarat:** #9
- **Anchor:** `deploy/Caddyfile:1-28` — khususnya matcher `@ws` (`:11-17`), `handle /api/*` (`:20-22`),
  dan catch-all ke admin SPA (`:25-27`). Pasangannya `docker-compose.prod.yml:76-91`.
- **Kenapa dipakai di sini:** `DEPLOY.md:16-18` menyatakan alasannya:
  *"Caddy serves one origin: WebSocket upgrades (tracking + support) and `/api/*` go to the API;
  everything else is the admin SPA. So there's no CORS and the admin image isn't tied to a domain."*
  Untuk kamu yang datang dari frontend, ini penting: CORS hilang bukan karena di-*disable*, tapi
  karena browser melihat SATU origin. Konsekuensi kedua: image admin tidak perlu di-build ulang per
  domain (tidak ada `VITE_API_URL` yang di-bake). Caddy juga mengurus sertifikat Let's Encrypt
  otomatis — makanya volume `caddy_data` (`docker-compose.prod.yml:90,94`) wajib persistent, kalau
  tidak kamu akan minta sertifikat ulang tiap restart dan kena rate limit ACME. Perhatikan matcher
  `@ws` mencocokkan **header** `Connection: Upgrade` + `Upgrade: websocket`, bukan path — sesuai
  komentar `deploy/Caddyfile:10`, karena WS tracking menempel di root `/`.
- **Alternatif:**
  - **nginx + certbot** — paling umum, kontrol penuh, tapi TLS otomatis butuh cron renew + reload
    manual; Caddy melakukannya bawaan. (Repo tetap memakai nginx untuk LB load test —
    `loadtest/nginx.conf` — karena di sana yang dibutuhkan cuma round-robin.)
  - **Traefik** — auto-TLS juga + service discovery dari label Docker (tanpa file config), tapi
    konfigurasi via label lebih sulit dibaca saat belajar.
  - **Cloudflare Tunnel / managed LB** — TLS + DDoS di edge tanpa buka port, tapi menambah
    dependensi eksternal dan tidak mengajarkan reverse proxy.
  - **Node melayani TLS sendiri** — satu proses lebih sedikit, tapi Node bukan terminator TLS yang
    baik dan kamu kehilangan routing SPA/API.
- **Latihan:** Tanpa domain publik, edit `/etc/hosts` menambahkan `127.0.0.1 drovery.local`, set
  `DOMAIN=drovery.local` di `.env`, jalankan flow prod, dan panggil
  `curl -k https://drovery.local/api/v1/health`. Lalu ubah `deploy/Caddyfile` menukar urutan
  `handle /api/*` dan `handle {...}` — amati bahwa Caddy `handle` bersifat mutually-exclusive dan
  request `/api/v1/health` sekarang nyasar ke admin.

---

## 11. Metrics endpoint & Prometheus scraping

- **Prasyarat:** #6
- **Anchor:** `observability/prometheus.yml:16-30` (dua scrape job), `src/metrics/metrics.controller.ts:9-23`
  (kenapa endpoint ini public + skip throttle), `src/worker.ts:36-44` (kenapa worker punya HTTP
  server mini sendiri).
- **Kenapa dipakai di sini:** Prometheus adalah **pull-based**: dia yang datang mengambil, bukan app
  yang mengirim. Repo ini punya dua target dengan bentuk berbeda dan alasannya tertulis:
  - **api** di `api:3000` path `/api/v1/metrics` (`prometheus.yml:18-22`) — karena controller Nest
    ikut global prefix.
  - **worker** di `worker:9091` path `/metrics` (`prometheus.yml:26-30`) — worker adalah
    `createApplicationContext` tanpa HTTP server (`src/worker.ts:30-32`), jadi `worker.ts:45-70`
    membuat `http.createServer` mentah hanya untuk metrics. Komentar `src/worker.ts:36-39`
    menjelaskan tujuannya: *"KEDA scales it on queue depth — so it serves the same metrics
    registry"*.
  - Label `tier: api` / `tier: worker` (`prometheus.yml:22,30`) bukan hiasan: alert
    `DroveryEventLoopLag` dan grouping Alertmanager memakainya (`alertmanager.yml:22`).
  - Endpoint metrics **tanpa auth** by design, dengan mitigasi tertulis di
    `src/metrics/metrics.controller.ts:12-15`: *"in production it should be network-restricted
    (cluster-internal Service / NetworkPolicy) and can be killed via METRICS_ENABLED=false"*.
    Ini juga yang membuat `loadtest/metrics-probe.sh:9-11` bisa scrape lewat LB tanpa JWT.
- **Alternatif:**
  - **Push-based (StatsD / Graphite / Prometheus Pushgateway)** — cocok untuk job pendek yang mati
    sebelum di-scrape; untuk service panjang-umur, pull memberi bonus `up` metric gratis (dipakai
    oleh alert `DroveryTargetDown`, `alerts.yml:77-82`).
  - **Datadog / New Relic (agent SaaS)** — lebih sedikit operasional, tapi berbayar per host dan
    tidak bisa dijalankan penuh di laptop.
  - **OpenTelemetry Collector sebagai satu pintu** — repo sudah punya seam OTel
    (`src/worker.ts:4-6`), jadi ini jalur upgrade yang wajar; tapi menambah satu komponen lagi
    untuk dipelajari.
- **Latihan:** `docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile observability up -d`,
  buka http://localhost:9090/targets → pastikan dua target `UP`. Lalu
  `curl -s localhost:3000/api/v1/metrics | grep drovery_queue_jobs`. Matikan worker
  (`docker compose stop worker`), tunggu 2 menit, dan lihat alert `DroveryTargetDown` menjadi
  `FIRING` di http://localhost:9090/alerts.

---

## 12. Scaling horizontal di Compose + nginx sebagai load balancer

- **Prasyarat:** #9, #11
- **Anchor:** `docker-compose.loadtest.yml:1-13` (header), `loadtest/nginx.conf:1-4` (komentar kunci)
  dan `loadtest/nginx.conf:16-18` (`set $api "api:3000"; proxy_pass http://$api;`).
- **Kenapa dipakai di sini:** Ini detail yang hampir selalu bikin orang gagal: nginx me-*resolve* DNS
  upstream **sekali saat startup** kalau host ditulis literal. Dengan `--scale api=3`, Docker DNS
  mengembalikan 3 A-record, tapi nginx sudah mengunci satu IP — jadi "scaling" tidak terjadi dan
  kamu salah menyimpulkan arsitekturnya tidak scale. Komentar `loadtest/nginx.conf:2-4` menjelaskan
  fix-nya: memakai **variabel** di `proxy_pass` memaksa re-resolve per request via resolver Docker
  `127.0.0.11` (`:11`). Detail kedua: `LOADTEST_BYPASS_THROTTLE=true` + `NODE_ENV: staging`
  (`docker-compose.loadtest.yml:19-20`) — `load/README.md:33-38` menjelaskan kenapa ini *harus* ada:
  rate limiter global 100/min/IP disimpan di Redis dan **shared antar replika**, jadi k6 dari satu IP
  akan menabrak limit yang sama berapa pun jumlah replikanya — *"2 replicas would look identical to
  1, falsifying the scaling claim"*. Dan bypass-nya aman karena guard aplikasi mematikannya keras
  saat `NODE_ENV=production` (`docker-compose.loadtest.yml:12-13`).
- **Alternatif:**
  - **Traefik/HAProxy sebagai LB** — punya service discovery Docker native (tidak perlu trik
    variabel), tapi config lebih banyak untuk kebutuhan round-robin sederhana.
  - **`deploy.replicas` + Swarm routing mesh** — LB built-in, tapi Swarm praktis mati; repo memilih
    `--scale` + LB eksplisit yang bisa dibaca.
  - **k8s Service (ClusterIP)** — yang sebenarnya dipakai di production
    (`k8s/base/api-service.yaml`), load-balancing di level kernel; Compose+nginx adalah versi
    laptop-nya.
- **Latihan:** `docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d --build --scale api=3`,
  lalu `for i in $(seq 1 20); do curl -s localhost:8088/api/v1/health >/dev/null; done` dan
  `docker compose -f docker-compose.yml -f docker-compose.loadtest.yml logs api | grep -c "GET /api/v1/health"`
  per container — pastikan tersebar. Kemudian ubah `loadtest/nginx.conf:16-17` menjadi
  `proxy_pass http://api:3000;` literal, `docker compose restart lb`, ulangi — semua request akan
  jatuh ke satu replika. Itu bukti komentar `nginx.conf:2-4`.

---

## 13. Load testing dengan k6: scenario, threshold, dan amortisasi auth

- **Prasyarat:** #12
- **Anchor:** `loadtest/scenario.js:23-43` (executor `ramping-vus` + `thresholds`),
  `loadtest/README.md:85-104` (tabel tiga scenario + penjelasan amortisasi),
  `docker-compose.loadtest.yml:38-58` (k6 sebagai container, `profiles: ['load']`).
- **Kenapa dipakai di sini:** k6 dijalankan sebagai **container** supaya tidak perlu install di host
  (`loadtest/README.md:3-6`), dan `profiles: ['load']` (`docker-compose.loadtest.yml:40`) mencegahnya
  ikut jalan pada `up` biasa. Yang paling mengajar adalah **kenapa ada tiga scenario**: satu journey
  campuran mencampur dua biaya yang sangat berbeda — bcrypt cost-12 (CPU-bound) dan I/O. Hasil nyata
  di repo membuktikannya (`loadtest/README.md:207-229`): p95 global 5.66s **seluruhnya** dari step
  signup (7.72s), sementara create 659ms / list 248ms / get 323ms. Kesimpulan yang ditulis
  eksplisit: *"NOT something to fix by weakening the hash cost"* — `scenario-io.js` memindahkan login
  ke `setup()` sekali saja (`README.md:97-101`) supaya loop terukur bebas bcrypt, **tanpa** menurunkan
  `BCRYPT_SALT_ROUNDS=12`. Threshold-nya pun jujur: `loadtest/scenario.js:36-37` menandai angka itu
  untuk satu kotak lokal dan menyuruh mengetatkan untuk cloud. Detail operasional yang bagus:
  `loadtest/run.sh:66-84` menjelaskan `--no-deps` (kalau tidak, `compose run` akan diam-diam
  men-scale ulang api/worker kembali ke 1) dan menangani exit code 99 k6 (threshold terlanggar)
  supaya pengukuran drain worker tidak hilang.
- **Alternatif:**
  - **Apache JMeter** — GUI + ekosistem plugin luas, tapi berat (JVM/thread-per-VU) dan skrip XML
    sulit di-review di PR. k6 skripnya JS — sesuai skill kamu.
  - **Artillery** — YAML-first, Node-native, mudah; tapi engine JS single-thread lebih cepat jadi
    bottleneck generator dibanding k6 (Go).
  - **Locust** — Python, distributed mode mudah; menambah runtime baru ke repo.
  - **`autocannon`/`wrk`** — sangat ringan untuk mengukur satu endpoint, tapi tidak bisa memodelkan
    journey berbilang langkah dengan token.
- **Latihan:** Jalankan `sudo bash loadtest/run.sh` (scenario `auth`), catat `step_signup` p95 vs
  `step_list` p95. Lalu jalankan `sudo SCENARIO=io VUS=100 bash loadtest/run.sh` dan bandingkan p95
  global. Tulis satu paragraf: kenapa angka kedua jauh lebih baik padahal kode aplikasi identik?

---

## 14. Resource limit per replika: `cpus` quota vs `cpuset` pinning

- **Prasyarat:** #13
- **Anchor:** `docker-compose.nodes.yml:14-34` — ini blok komentar paling padat di repo; baca
  seluruhnya. Lalu `docker-compose.nodes.yml:48-56` (limit api per replika) dan `:89-93`
  (siapa yang sengaja **tidak** dibatasi).
- **Kenapa dipakai di sini:** Masalah yang dipecahkan disebut langsung (`:12-16`): tanpa limit,
  `--scale api=3` bukan "3 node" melainkan 3 thread yang **berebut** 4 core host, sehingga throughput
  per replika tidak bisa diatribusikan. Tiga pelajaran berharga di sini:
  1. **`cpus` (quota) bukan `cpuset` (pinning)** — `:18-23`: quota adalah jatah *waktu CPU* yang bisa
     ditempatkan scheduler di core mana pun, jadi menambah replika **menambah** throughput; pinning
     mengikat semua replika ke daftar core yang sama sehingga menambah replika hanya menambah
     **kontensi**. Ini kesalahan klasik yang membalikkan kesimpulan benchmark.
  2. **`deploy.resources.limits` bekerja di `docker compose up` non-Swarm** — `:24-27` secara khusus
     memperingatkan agar tidak "memperbaiki"-nya kembali ke `cpus:`/`mem_limit:` legacy; mitos
     "deploy hanya untuk Swarm" berlaku untuk docker-compose v1 (Python), bukan Compose v2.
  3. **CPU dibatasi, memori diberi headroom** — `:38-47` mencatat kegagalan yang benar-benar terjadi:
     memori cgroup ketat → container **OOM-killed** (CPU hanya di-throttle), dan `--max-old-space-size`
     rendah → worker concurrency-10 crash-loop sehingga *"the SIM backlog froze at exactly the
     enqueued count with zero drain"*.
  4. **Generator beban sengaja tidak dibatasi** (`:89-93`): *"a CPU-throttled generator silently
     under-drives the system and you'd measure the generator's ceiling, not the system's."*
  Budget default sengaja over-subscribed di kotak 4-core (`:29-34`), dan `loadtest/README.md:140-151`
  menjelaskan bahwa yang harus dibaca adalah **bentuk kurva**, bukan angka absolutnya.
- **Alternatif:**
  - **`cpuset: "0,1"`** — deterministik untuk mikro-benchmark cache-locality; salah untuk uji scaling
    (alasannya di `:20-23`).
  - **Mesin/VM terpisah sungguhan** — satu-satunya cara mengukur NIC hop, NUMA, page cache per host;
    `loadtest/README.md:155-157` mengakui batas metode cgroup ini secara terbuka.
  - **k8s `resources.requests/limits`** — hal yang sama di cluster; lihat konsep #18. Compose overlay
    ini adalah versi laptop-nya.
- **Latihan:** Jalankan `sudo bash loadtest/sweep.sh` (api=1,2,3 dengan `NODES=1`) dan baca tabel
  akhirnya. Per-node req/s ~flat = scaling linear; per-node turun = ada tier bersama yang jadi
  ceiling. Lalu jalankan sekali lagi dengan `sudo API_CPUS=0.3 bash loadtest/sweep.sh` dan
  jelaskan perubahan bentuk kurvanya.

---

## 15. Alert rules, SLO, dan routing Alertmanager

- **Prasyarat:** #11
- **Anchor:** `observability/alerts.yml:1-98` (sembilan rule dalam empat group),
  `observability/prometheus.yml:8-14` (blok `alerting:` + komentar kenapa ia harus ada),
  `observability/alertmanager.yml:8-14` dan `:37-46` (inhibit rules).
- **Kenapa dipakai di sini:** Komentar `prometheus.yml:8-10` menceritakan bug nyata yang diperbaiki:
  *"Without this block the nine rules in alerts.yml evaluated and fired into the Prometheus UI and
  nowhere else … the stack could detect an outage and page nobody."* Ini pelajaran yang tidak ada di
  tutorial. Detail lain yang layak diajarkan:
  - **Dua tingkat untuk metrik yang sama** — `DroveryHighErrorRateWarning` (>2% selama 10m,
    `alerts.yml:5-13`) vs `DroveryHighErrorRatePage` (>5% selama 5m, critical, `:14-21`). `for:`
    adalah anti-flapping.
  - **`inhibit_rules`** (`alertmanager.yml:37-46`): kalau satu tier **down**, alert latency dan error
    rate tier itu ditekan — *"Page once about the cause, not three times about the symptoms."*
  - **`group_by: ['alertname','tier']`** (`alertmanager.yml:22`) — lonjakan 5xx di 10 replika jadi
    SATU notifikasi, tapi masalah api dan worker tetap terpisah.
  - **Receiver sengaja kosong** (`alertmanager.yml:8-14`, diulang di `DEPLOY.md:242-246`) karena
    Alertmanager **tidak** meng-expand env var; `${WEBHOOK}` akan diambil literal dan membuatnya gagal
    start. *"Empty beats a fake URL that logs delivery errors forever."*
  - **`max()` bukan `sum()`** pada gauge queue (`alerts.yml:46-48`) — gauge-nya queue-global dan
    dilaporkan identik oleh setiap replika; `sum()` akan mengalikan backlog dengan jumlah pod.
    Aturan yang sama muncul lagi di KEDA (konsep #20).
  - **Kejujuran soal cakupan**: `DEPLOY.md:248-254` mencatat bahwa `DroveryReadinessFailing` hanya
    mengcover Redis peran *cache*; kalau kamu memecah Redis per-concern, readiness diam-diam berhenti
    mengcover peran yang dipisah.
- **Alternatif:**
  - **Alert di Grafana (Grafana Alerting)** — UI enak, tapi rule jadi state di database Grafana, bukan
    file di git (repo ini memilih file supaya bisa di-review di PR).
  - **PagerDuty/Opsgenie langsung dari Prometheus** — tidak ada; Prometheus butuh Alertmanager untuk
    dedupe/grouping/silence. Blok siap-pakai tersedia di `alertmanager.yml:58-66`.
  - **Sentry/Crashlytics saja** — bagus untuk *error aplikasi*, buta terhadap SLO agregat (rate 5xx,
    p99 latency, `up == 0`).
- **Latihan:** Nyalakan stack observability, lalu sengaja bikin readiness gagal:
  `docker compose stop postgres`. Amati http://localhost:9090/alerts → `DroveryReadinessFailing`
  (2m) dan `DroveryTargetDown`. Lalu buka http://localhost:9093 dan buktikan inhibit rule bekerja
  (alert latency/error tier yang sama tidak muncul terpisah). Terakhir, uncomment blok
  `webhook_configs` di `alertmanager.yml:64-66` mengarah ke `https://webhook.site/<id>` milikmu dan
  lihat payload-nya masuk.

---

## 16. Grafana provisioning-as-code

- **Prasyarat:** #15
- **Anchor:** `observability/grafana/provisioning/datasources/prometheus.yml:1-8`,
  `observability/grafana/provisioning/dashboards/dashboards.yml:1-12`,
  `docker-compose.observability.yml:52-55` (dua mount: provisioning + dashboards).
- **Kenapa dipakai di sini:** Dashboard di repo ini adalah **file JSON yang di-commit**
  (`observability/grafana/dashboards/drovery-api.json`, `drovery-workers.json`), bukan sesuatu yang
  diklik di UI lalu hilang saat container di-recreate. Datasource ditandai `editable: false`
  (`datasources/prometheus.yml:8`) supaya tidak diubah diam-diam lewat UI. Isi dashboard-nya
  mencerminkan alert 1:1 — panel "5xx error rate (SLO < 2%)" dan "Latency p99 by route (s, SLO < 1s)"
  memakai ekspresi PromQL yang sama dengan `alerts.yml`, dan dashboard workers menampilkan
  "BullMQ jobs by state (the KEDA scale signal)". Jadi dashboard = versi visual dari sinyal yang
  dipakai untuk autoscaling dan paging, bukan koleksi grafik acak.
- **Alternatif:**
  - **Klik-klik di UI Grafana** — cepat untuk eksplorasi, tapi hilang saat volume dihapus dan tidak
    bisa direview.
  - **Grafonnet / Jsonnet / Terraform provider** — dashboard sebagai kode yang bisa di-parametrize;
    lebih powerful, tapi butuh toolchain tambahan untuk keuntungan kecil di skala repo ini.
  - **Grafana Cloud** — tidak perlu operasional, tapi berbayar dan data keluar dari mesinmu.
- **Latihan:** Buka http://localhost:3001 (admin/admin) → folder "Drovery". Sambil menjalankan
  `sudo SCENARIO=io bash loadtest/run.sh`, tonton panel "Request rate by route" dan
  "Waiting + delayed backlog". Lalu tambahkan satu panel baru lewat UI, simpan, jalankan
  `docker compose ... down && up -d`, dan lihat panelmu hilang — lalu tambahkan panel itu ke file
  JSON dan ulangi, kali ini bertahan.

---

## 17. CI: pipeline GitHub Actions dengan service container

- **Prasyarat:** #1, #7
- **Anchor:** `.github/workflows/ci.yml:21-37` (service `postgres` + `redis` dengan `--health-cmd`),
  `:57-69` (generate → `migrate deploy` → drift check), `:71-73` (lint `continue-on-error`),
  `:78-81` (smoke capacity model), `:90-105` (job `docker` dengan cache GHA).
- **Kenapa dipakai di sini:** Beberapa keputusan yang bisa dijelaskan:
  - **Service container dengan health option** (`ci.yml:29-31`) — pola `depends_on: service_healthy`
    (konsep #7) versi GitHub Actions. Alasan memakai Postgres/Redis asli disebut di `ci.yml:14-16`:
    *"so the migrations are validated against a live database"* — bukan mock.
  - **Drift check** (`ci.yml:68-69`, script `prisma:drift-check` di `package.json:31`) — komentar
    `ci.yml:63-67` menyebut ini gerbang durabilitas partisi: diff non-kosong berarti ada perubahan
    schema yang mencoba meng-*un-partition* tabel. Ini contoh CI menjaga invariant arsitektur, bukan
    sekadar "tes hijau".
  - **Lint sengaja non-blocking** (`ci.yml:71-73`) dengan alasan tertulis (menunggu cleanup
    `no-unsafe-any`) — trade-off yang didokumentasikan, bukan disembunyikan.
  - **`concurrency` + `cancel-in-progress`** (`ci.yml:9-11`) — push beruntun membatalkan run lama.
  - **Job `docker` terpisah dengan `needs: test`** (`ci.yml:92`) — build image hanya sebagai validasi
    (`push: false`, `:100`); publikasi ada di workflow lain (konsep #18).
- **Alternatif:**
  - **GitLab CI / CircleCI / Jenkins** — konsep sama (job, cache, service), beda sintaks; GitHub
    Actions dipilih karena repo di GitHub dan runner gratis untuk repo publik.
  - **Menjalankan `docker compose up` di CI alih-alih service container** — lebih dekat ke lokal,
    tapi lebih lambat dan health-gating harus ditulis manual.
  - **SQLite/mock untuk test DB** — cepat, tapi tidak akan menangkap masalah partisi/DDL yang
    justru dijaga drift check di sini.
- **Latihan:** Buat branch, ubah `prisma/schema.prisma` sedikit **tanpa** membuat migration, push, dan
  amati step "Prisma drift check" gagal. Lalu di lokal jalankan perintah persisnya
  (`npm run prisma:drift-check`) untuk melihat error yang sama tanpa menunggu CI.

---

## 18. CD: publish image (tagging) + deploy via SSH

- **Prasyarat:** #17, #9
- **Anchor:** `.github/workflows/publish.yml:32-47` (`docker/metadata-action` + tiga strategi tag),
  `.github/workflows/deploy.yml:11-18` (`workflow_dispatch` dengan input `tag`) dan `:27-41`
  (ssh-action menjalankan `pull && up -d`), plus `DEPLOY.md:139-143` (catatan strategi tag).
- **Kenapa dipakai di sini:**
  - **Tiga tag sekaligus** (`publish.yml:36-39`): `latest` (mutable), `sha-<short>` (immutable,
    telusur ke commit), `type=ref,event=tag` (rilis `vX.Y.Z`). `DEPLOY.md:140-143` menjelaskan
    kapan pakai yang mana: *"`:latest` is convenient but mutable … For real prod, pin a release
    so a deploy is reproducible and rollback is exact"*. Rollback = set `TAG` ke versi sebelumnya
    dan jalankan flow pull (`DEPLOY.md:113`).
  - **Deploy manual by design** (`deploy.yml:4-5`, `DEPLOY.md:134-137`): *"a human gates each prod
    deploy"*, dengan catatan timing kalau mau otomatis — workflow deploy harus jalan **setelah**
    kedua publish workflow selesai.
  - **`concurrency: deploy-vps` dengan `cancel-in-progress: false`** (`deploy.yml:19-21`) — deploy
    tidak boleh dibatalkan di tengah jalan; berbeda dari CI yang justru membatalkan run usang.
  - **Satu secret saja untuk publish** (`DOCKERHUB_TOKEN`) karena username bukan rahasia
    (`publish.yml:7-8`), dan empat secret untuk deploy (`DEPLOY.md:121-128`).
- **Alternatif:**
  - **GitOps (ArgoCD/Flux)** — cluster menarik manifest dari git; auditable dan self-healing, tapi
    butuh k8s. Repo sudah menyiapkan hook untuk itu (`k8s/base/migrate-job.yaml:14`
    `argocd.argoproj.io/hook: PreSync`).
  - **`docker context` / SSH langsung dari runner tanpa action** — hilangkan dependensi
    `appleboy/ssh-action`, tapi kamu menulis sendiri penanganan known_hosts dan exit code.
  - **PaaS (Fly.io/Render/Railway)** — deploy dari git tanpa VPS, tapi kamu tidak belajar bagian
    edge/proxy/pooler.
  - **GHCR alih-alih Docker Hub** — auth otomatis via `GITHUB_TOKEN` (tanpa secret manual), tapi
    repo memilih Docker Hub karena consumer-nya ada di dua repo berbeda. (Overlay prod k8s justru
    memakai GHCR: `k8s/overlays/prod/kustomization.yaml:8`.)
- **Latihan:** Baca `publish.yml:32-39`, lalu jalankan `docker/metadata-action` secara mental untuk
  tiga kejadian: push ke `main`, tag `v1.2.0`, dan `workflow_dispatch`. Tulis daftar tag yang
  dihasilkan masing-masing. Verifikasi dugaanmu dengan menjalankan workflow dari tab Actions dan
  membaca output step `meta`.

---

## 19. Kubernetes: Deployment, Service, Ingress, dan tiga jenis probe

- **Prasyarat:** #5, #7, #11
- **Anchor:** `k8s/base/api-deployment.yaml:39-53` (startup/readiness/liveness),
  `:54-56` (`preStop` sleep) dan `:26` (`terminationGracePeriodSeconds: 40`),
  `:57-60` (requests/limits + komentar HPA), `k8s/base/api-service.yaml:1-10`,
  `k8s/base/api-ingress.yaml:1-20`.
- **Kenapa dipakai di sini:** Ini "Compose versi cluster", tapi dengan tiga hal yang tidak ada di
  Compose:
  - **Tiga probe, tiga tujuan berbeda.** `startupProbe` (periode 5s × 12 = sampai 60s,
    `api-deployment.yaml:39-42`) memberi Prisma+Nest waktu boot **tanpa** membuat liveness membunuh
    pod; `readinessProbe` menunjuk `/health/ready` yang mengecek dependensi
    (`src/health/health.controller.ts:28-39` → 503 kalau DB/Redis mati) sehingga pod dikeluarkan dari
    Service tanpa di-restart; `livenessProbe` menunjuk `/health` yang hanya membuktikan proses hidup
    (`health.controller.ts:17-26`). Salah menukar keduanya adalah bug klasik: readiness yang dipakai
    sebagai liveness akan me-restart seluruh armada saat database sempat down.
  - **Urutan shutdown yang benar.** `preStop: sleep 5` (`:56`) memberi LB waktu men-*deregister* pod
    **sebelum** SIGTERM, dan `terminationGracePeriodSeconds: 40` (`:26`) harus **melebihi** preStop +
    waktu drain aplikasi (komentar `:25`). Bandingkan dengan worker: 90 detik
    (`worker-deployment.yaml:26-27`, "let in-flight BullMQ jobs finish") dan realtime: 120 detik
    (`realtime-deployment.yaml:30-32`, ribuan socket).
  - **`resources.requests.cpu` wajib** (`api-deployment.yaml:57-59`): *"the HPA computes utilization
    as usage/request"* — hapus request, HPA melaporkan `<unknown>` dan mati diam-diam
    (`api-hpa.yaml:32`).
  - **Worker sengaja TANPA httpGet probe** — `worker-deployment.yaml:39-43` dan
    `k8s/README.md:52-55`: worker adalah application context tanpa server HTTP di :3000, jadi probe
    httpGet akan **selalu** gagal → CrashLoopBackOff. Diganti `exec` startup probe
    (`worker-deployment.yaml:44-48`).
- **Alternatif:**
  - **Docker Swarm** — jauh lebih sederhana, tapi tidak punya HPA/KEDA, PDB, atau ekosistem operator.
  - **Nomad** — lebih ringan dari k8s, tapi ekosistem autoscaler/ingress lebih tipis.
  - **Tetap di Compose satu VPS** — persis yang dilakukan `docker-compose.prod.yml`; `DEPLOY.md:147-148`
    menyebut ambang pindahnya: *"for real multi-node, see k8s/ (HPA + KEDA)"*.
- **Latihan:** Ikuti `k8s/README.md:27-39` dengan kind/minikube: build image `:ci`, load, apply
  overlay local, lalu `kubectl -n drovery describe pod -l role=api` dan baca urutan event probe.
  Setelah itu, sengaja beri worker sebuah `livenessProbe` httpGet ke `/api/v1/health`, apply, dan
  amati CrashLoopBackOff — bukti langsung dari `k8s/README.md:52-55`.

---

## 20. Kustomize: base + overlays, ConfigMap/Secret generator

- **Prasyarat:** #19, #9
- **Anchor:** `k8s/base/kustomization.yaml:21-41` (configMapGenerator + secretGenerator),
  `k8s/overlays/local/kustomization.yaml:9-26`, `k8s/overlays/prod/kustomization.yaml:11-29`,
  `k8s/overlays/loadtest/kustomization.yaml:10-22`.
- **Kenapa dipakai di sini:** Pola yang sama dengan overlay Compose (konsep #9), jadi transfer
  belajarnya langsung. Yang khas Kustomize:
  - **Name suffix hash** (`base/kustomization.yaml:21`): *"The name gets a content hash so a change
    rolls the pods."* Ubah satu literal di ConfigMap → nama ConfigMap berubah → Deployment berubah →
    rolling update otomatis. Tanpa ini, pod lama akan terus memakai env lama.
  - **Overlay = perbedaan, bukan salinan.** `local` mengganti tag image jadi `ci` dan menurunkan
    `maxReplicas` HPA ke 4; `prod` memakai GHCR + `minReplicas: 3` + PDB 50%; `loadtest` menyalakan
    `LOADTEST_BYPASS_THROTTLE` dan mengunci replika untuk perbandingan A/B (`loadtest/kustomization.yaml:24-31`).
  - **Peringatan secret yang jujur** — `base/secrets.env.example:4-5`: *"Kubernetes Secrets are
    base64, NOT encrypted at rest unless etcd encryption is enabled"*, dan
    `overlays/prod/kustomization.yaml:23-28` melarang menaruh nilai asli, menyebut External Secrets /
    Sealed Secrets, plus catatan teknis: kalau Secret dikelola di luar, matikan generator base dan
    set `disableNameSuffixHash: true` supaya nama Secret stabil.
- **Alternatif:**
  - **Helm** — templating penuh (loop, conditional), ekosistem chart besar, dan punya hook ordering
    asli (repo memanfaatkannya kalau ada: `k8s/base/migrate-job.yaml:10-13`). Harganya: Go template
    di dalam YAML sulit dibaca dan salah indentasi baru ketahuan saat render.
  - **YAML mentah per environment** — nol tooling, tapi drift antar-environment pasti terjadi.
  - **jsonnet/cdk8s/Pulumi** — bahasa pemrograman penuh; kuat, tapi menambah runtime dan learning
    curve.
- **Latihan:** Jalankan `kubectl kustomize k8s/overlays/local > /tmp/local.yaml` dan
  `kubectl kustomize k8s/overlays/prod > /tmp/prod.yaml`, lalu `diff /tmp/local.yaml /tmp/prod.yaml`.
  Identifikasi 4 perbedaan dan kaitkan tiap perbedaan ke baris patch penyebabnya. Lalu ubah satu
  literal di `base/kustomization.yaml:24-33` dan lihat suffix hash ConfigMap berubah di output.

---

## 21. Autoscaling: HPA (CPU), KEDA (queue depth), KEDA (socket count), PDB

- **Prasyarat:** #19, #20, #11, #8
- **Anchor:** `k8s/base/api-hpa.yaml:12-30`, `k8s/base/worker-scaledobject.yaml:1-10` dan `:43-56`,
  `k8s/base/realtime-scaledobject.yaml:1-5` dan `:22-40`, `k8s/base/api-pdb.yaml:6-9`,
  `k8s/base/realtime-pdb.yaml:1-4`.
- **Kenapa dipakai di sini:** Ini puncak area infra, dan repo mengajarkan satu prinsip:
  **sinyal autoscaler harus cocok dengan sumber daya yang benar-benar habis di tier itu.**
  - **api → HPA on CPU 65%** (`api-hpa.yaml:12-18`). Tier HTTP stateless yang CPU-bound (ingat
    temuan bcrypt di konsep #13). `behavior` asimetris (`:19-30`): scale-up
    `stabilizationWindowSeconds: 0` ("react to traffic spikes immediately"), scale-down 300 detik
    ("avoid thrash on transient dips").
  - **worker → KEDA on queue depth** (`worker-scaledobject.yaml`). Alasan memakai **Prometheus**
    dan bukan scaler Redis native KEDA ditulis panjang di `:3-7`: BullMQ menyimpan job *delayed* di
    sorted set dan hanya *waiting* di list, sehingga scaler `listLength` (LLEN) **buta** terhadap
    backlog delayed — *"which is the majority of this queue"*. Query-nya memakai `max()` bukan
    `sum()` (`:51-53`), alasan identik dengan alert (konsep #15). Ada juga `fallback` bila Prometheus
    tak terjangkau (`:24-27`) dan peringatan satu-autoscaler-per-Deployment (`:9-10`,
    `worker-deployment.yaml:7-8`, `k8s/README.md:56-59`).
  - **realtime → KEDA on socket count** (`realtime-scaledobject.yaml:1-5`): CPU buta terhadap socket
    idle (*"≈1 frame/5s"*), yang habis adalah FD/heap/event loop. Dan dua keputusan yang sangat
    spesifik-domain: `restoreToOriginalReplicaCount: false` (`:23-26`) karena mengembalikan replika
    ke baseline akan **mass-disconnect** semua klien; scale-down super konservatif — 1 pod per 120
    detik dengan window 600 detik (`:34-40`).
  - **PDB** membatasi disruption **sukarela** (drain node, upgrade) yang **tidak** diatur `behavior`
    HPA (`realtime-pdb.yaml:1-4`). Perhatikan pilihan berbeda: api pakai `minAvailable: 1` dengan
    peringatan harus di bawah jumlah replika (`api-pdb.yaml:6-8`), realtime pakai `maxUnavailable: 1`
    karena *"scales sensibly with the KEDA-driven replica count"* (`realtime-pdb.yaml:4`).
- **Alternatif:**
  - **HPA custom metrics via prometheus-adapter** — bisa scale on queue depth tanpa KEDA, tapi kamu
    harus mengelola API aggregation layer sendiri; KEDA membungkus itu dan menambah scale-to-zero.
  - **Cluster Autoscaler / Karpenter** — menambah **node**, bukan pod; komplementer, bukan pengganti.
  - **VPA (Vertical Pod Autoscaler)** — membesarkan pod, bukan menambah; tidak cocok untuk tier
    stateless dan konflik dengan HPA pada metrik yang sama.
  - **Scaling manual (`kubectl scale`)** — justru yang direkomendasikan overlay loadtest
    (`overlays/loadtest/kustomization.yaml:33-35`) untuk A/B terkontrol, karena HPA yang bergerak
    merusak eksperimen.
- **Latihan:** Di minikube, `minikube addons enable metrics-server`, apply overlay local, lalu
  `kubectl -n drovery get hpa -w` sambil menembak load ke Ingress. Amati `TARGETS` naik dan replika
  bertambah maksimal 4 (patch di `overlays/local/kustomization.yaml:21-23`). Lalu tulis analisis:
  kenapa sinyal CPU yang sama akan **salah** untuk tier realtime? (Jawabannya ada di
  `realtime-scaledobject.yaml:1-5`.)

---

## 22. Migrasi database di cluster: Job, hook ordering, dan bypass pooler

- **Prasyarat:** #19, #8
- **Anchor:** `k8s/base/migrate-job.yaml:1-4` (komentar ordering), `:9-14` (Helm/Argo hook),
  `:16-18` (`backoffLimit`, `activeDeadlineSeconds`, `ttlSecondsAfterFinished`), `:29-35`
  (perintah tanpa seed + `DATABASE_URL_DIRECT`), lalu `k8s/README.md:36-38` (`kubectl wait`).
- **Kenapa dipakai di sini:** Job = "jalankan sampai selesai", padanan service `migrate` di Compose
  (konsep #7). Yang khas cluster:
  - **Ordering tidak gratis.** Anotasi `helm.sh/hook: pre-install,pre-upgrade` dan
    `argocd.argoproj.io/hook: PreSync` (`:11-14`) **inert** di bawah `kubectl apply -k` — komentarnya
    menyatakan itu terang-terangan (`:10`). Karena itu `k8s/README.md:36-38` menyuruh
    `kubectl -n drovery wait --for=condition=complete job/drovery-migrate --timeout=180s` sebelum
    aplikasi melayani trafik.
  - **Seed dikecualikan di prod** (`:29` "seed excluded in prod") — beda dengan Compose lokal yang
    ikut seed (`docker-compose.yml:86`), sejalan dengan peringatan `DEPLOY.md:91-93` untuk mengganti
    atau menghapus seed pada deployment nyata.
  - **`DATABASE_URL_DIRECT`** (`:31-35`) — konsep #8 muncul lagi, kali ini sebagai key Secret
    terpisah (`k8s/base/secrets.env.example:8-11`).
  - **`ttlSecondsAfterFinished: 600`** membersihkan Job selesai supaya tidak menumpuk tiap deploy.
- **Alternatif:**
  - **initContainer di setiap Deployment** — urutannya otomatis, tapi N replika menjalankan migrasi
    bersamaan (mengandalkan advisory lock Prisma) dan setiap rollout mengulanginya.
  - **Migrasi manual sebelum deploy** (operator jalankan sendiri) — kontrol penuh, tapi tidak
    reproducible dan mudah terlupa.
  - **Tool migrasi terpisah (Flyway/Liquibase/Atlas)** — punya fitur ordering/rollback lebih kaya,
    tapi repo ini memakai Prisma sebagai sumber kebenaran schema (dan drift check di
    `ci.yml:68-69` menjaganya).
- **Latihan:** Di kind, apply overlay local **tanpa** `kubectl wait`, lalu `kubectl -n drovery logs
  -l role=api --tail=50` segera — kemungkinan besar kamu melihat error tabel belum ada. Ulangi dengan
  `kubectl wait` sesuai `k8s/README.md:36-38` dan bandingkan.

---

## 23. Memvalidasi manifest di CI (kubeconform + kind dry-run)

- **Prasyarat:** #20, #17
- **Anchor:** `.github/workflows/manifests.yml:11-35` (job `schema`) dan `:37-56` (job `dryrun`).
- **Kenapa dipakai di sini:** Manifest YAML gampang salah dan errornya baru muncul saat `apply` ke
  cluster nyata. Repo memakai **dua lapis** dengan pembagian tugas eksplisit:
  1. **kubeconform** — validasi schema offline, cepat, untuk setiap overlay hasil `kubectl kustomize`
    (`:26-34`). CRD KEDA dilewati (`-skip ScaledObject`, `:31-33`) karena schema-nya tidak ada di set
    default — dan komentarnya langsung menunjuk siapa yang menutupi celah itu.
  2. **kind + `kubectl apply --dry-run=server`** (`:38-56`) — validasi **admission** oleh API server
    sungguhan, setelah memasang CRD KEDA (`:47-48`). Ini yang menangkap ScaledObject yang lolos
    lapis pertama.
  Perhatikan `paths:` filter (`:5,8`) — workflow hanya jalan kalau `k8s/**` berubah. Dan
  `k8s/README.md:68-69` menutup lingkaran: setiap overlay memang divalidasi di CI.
- **Alternatif:**
  - **`kubectl apply --dry-run=client`** — hanya cek YAML/format, tidak memanggil API server; gagal
    menangkap field tidak dikenal.
  - **`kubeval`** — pendahulu kubeconform, tidak lagi dirawat aktif dan lebih lambat.
  - **OPA/Gatekeeper atau Kyverno** — validasi **kebijakan** (mis. "semua pod harus runAsNonRoot"),
    bukan schema; komplementer dan langkah lanjut yang wajar untuk repo ini.
- **Latihan:** Jalankan lokal: `kubectl kustomize k8s/overlays/local > /tmp/local.yaml` lalu
  `kubeconform -strict -summary -skip ScaledObject /tmp/local.yaml`. Kemudian sengaja typo satu field
  (mis. `replicas: two` di `k8s/base/api-deployment.yaml:7`) dan jalankan ulang — bandingkan pesan
  kubeconform vs pesan `--dry-run=server`.

---

## 24. Runbook operasional: backup terverifikasi & rehearsal restore

- **Prasyarat:** #10
- **Anchor:** `scripts/backup.sh:40-58` (verifikasi + guard "no table data"), `:60-65` (retensi
  dijalankan **terakhir**), `scripts/restore.sh:34-41` (guard `CONFIRM` dicek paling awal),
  `:15-19` (catatan partisi), dan `DEPLOY.md:154-217`.
- **Kenapa dipakai di sini:** Kalimat tesisnya ada di `scripts/backup.sh:6-7` dan `DEPLOY.md:158-159`:
  *"A backup you have never restored is a hope, not a backup."* Empat keputusan yang layak
  dibedah:
  - **Verifikasi otomatis** — `pg_restore --list` mem-parse table of contents, jadi arsip korup
    ketahuan **sekarang**, bukan jam 3 pagi (`backup.sh:40-47`); ditambah guard "0 tabel = gagal"
    (`:53-58`) supaya salah menunjuk database kosong tidak dianggap sukses.
  - **Retensi paling akhir dan hanya setelah sukses** (`:60-62`) — deretan kegagalan tidak akan
    menghapus backup baik terakhir.
  - **Guard destruktif dicek sebelum file dibaca** (`restore.sh:34-41`) — penolakan harus instan dan
    tidak bergantung pada apa pun yang berhasil lebih dulu.
  - **Mode rehearsal** yang mengukur **RTO nyata** dan memverifikasi partisi anak masih ada
    (`DEPLOY.md:186-189`), dengan peringatan agar **tidak** menjalankan `prisma migrate deploy` ke
    database hasil restore (`restore.sh:15-19`).
  Dan yang paling mendidik: bagian **"What is still missing"** (`DEPLOY.md:209-217`) mendaftar
  kekurangan yang diketahui — tidak ada PITR, backup default lokal, tidak ada alert backup basi.
- **Alternatif:**
  - **Snapshot managed (RDS/Cloud SQL automated backup)** — PITR bawaan dan tanpa operasional, tapi
    vendor-locked dan tetap harus dirandom-uji restore-nya.
  - **`pg_basebackup` + WAL archiving** — memberi PITR sungguhan (yang diakui hilang di
    `DEPLOY.md:209-212`), tapi butuh storage WAL dan operasional lebih berat.
  - **`pg_dump --format=plain`** — bisa dibaca mata, tapi tidak terkompresi dan tidak bisa restore
    selektif; `backup.sh:30-32` memilih `-Fc` justru untuk kedua alasan itu.
- **Latihan:** Dengan stack lokal jalan:
  `DATABASE_URL=postgres://postgres:postgres@localhost:5432/drovery BACKUP_DIR=/tmp/bk ./scripts/backup.sh`
  (butuh `pg_dump` di host, atau jalankan di dalam container postgres). Lalu jalankan rehearsal
  `./scripts/restore.sh /tmp/bk/drovery-*.dump` dan catat RTO yang dicetak. Terakhir, rusak arsipnya
  (`truncate -s 1000 file.dump`) dan jalankan ulang untuk melihat verifikasi menolaknya.

---

## Ringkasan alur belajar yang disarankan

```
1-4   Docker dari nol           →  bisa build + run satu container
5-8   Compose + PgBouncer       →  bisa jalankan seluruh sistem di laptop      [docker-compose.yml]
9-10  Overlay + edge production →  bisa deploy ke VPS dengan HTTPS             [+prod.yml]
11    Metrics                   →  bisa melihat isi sistem                     [+observability.yml]
12-14 Scaling + load test       →  bisa membuktikan sistemnya scale            [+loadtest.yml, +nodes.yml]
15-16 Alert + dashboard         →  bisa tahu saat sistem sakit                 [+observability.yml]
17-18 CI/CD                     →  bisa rilis tanpa menyentuh server
19-23 Kubernetes                →  bisa scale lintas mesin                     [k8s/ + kind/minikube]
24    Runbook                   →  bisa pulih saat bencana
```

Bagian tersulit yang harus diantisipasi pengajar: **konsep #8 (PgBouncer transaction pooling)**.
Semua yang lain punya padanan mental di dunia frontend; ini tidak. Ia butuh model mental baru
(koneksi Postgres = proses OS yang mahal → multiplexing → hilangnya state sesi → makanya migrasi
harus bypass pooler), dan ia adalah **penjelas** kenapa autoscaling di konsep #21 mungkin sama
sekali. Ajarkan dengan angka konkret dari `SCALING-1M.md:246-248` dan dengan latihan
`pg_stat_activity` di konsep #8, bukan dengan definisi.

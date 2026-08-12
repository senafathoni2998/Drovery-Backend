# Curriculum Facts — Dasar Penyusunan Phase Ladder Drovery

> Dokumen kerja. Prosa Bahasa Indonesia, identifier/nama file tetap Inggris.
> Sumber: delapan peta belajar di scratchpad (`map-be-core`, `map-be-data`, `map-be-domain`,
> `map-be-async`, `map-be-infra`, `map-docs`, `map-mobile`, `map-admin`) — total ~4.700 baris.
> Target pembaca dokumen ini: saya sendiri (dan siapa pun yang mau menantang urutan tangga fase).

---

## ⚠️ Penomoran di dokumen ini SUDAH USANG

Dokumen ini menyusun tangga **12 fase (1–12)**. Tangga final yang dipakai kurikulum punya
**14 fase (0–13)**, karena dua fase disisipkan setelah dokumen ini ditulis:

- **Fase 0 — Nyalakan sistemnya.** Dokumen ini sendiri menandai (risiko #1) bahwa Fase 1 menyuruh
  `docker compose up postgres` padahal Docker baru diajarkan jauh belakangan. Fase 0 menutup lubang itu.
- **Fase 4 — React Native & Expo.** Dokumen ini memampatkan seluruh React Native jadi satu butir
  di dalam fase end-to-end, dan menandai sendiri (risiko #6) bahwa itu berbahaya untuk pembelajar
  yang datang dari Ionic + Capacitor. Fase 4 memberinya ruang sendiri, ditaruh awal.

Fase 5 juga dinaikkan dari 2,5 ke 3,5 minggu, sesuai peringatan dokumen ini sendiri bahwa fase
konkurensi realistis butuh ~4 minggu.

**Setiap kali dokumen ini menulis "Fase N", terjemahkan dengan tabel berikut:**

| Di dokumen ini | Di kurikulum final | Judul final |
|---:|---:|---|
| — | **0** | Nyalakan sistemnya |
| 1 | **1** | Irisan pertama |
| 2 | **2** | Pipeline dan identitas |
| 3 | **3** | Data layer sebagai kontrak |
| — | **4** | Dari WebView ke native: React Native & Expo |
| 4 | **5** | Konkurensi dan uang |
| 5 | **6** | Satu graph, banyak proses |
| 6 | **7** | Domain penerbangan |
| 7 | **8** | Realtime dari sisi server |
| 8 | **9** | Observability |
| 9 | **10** | Container sampai produksi |
| 10 | **11** | Bukti skala dan Kubernetes |
| 11 | **12** | Kirim fitur nyata end-to-end |
| 12 | **13** | Modul Next.js: App Router |

Dokumen fase di [`../fase/`](../fase/) selalu memakai penomoran final (0–13). Kalau ada bentrok,
**dokumen fase yang benar** — dokumen ini disimpan apa adanya sebagai rekaman penalaran, bukan
sebagai rujukan penomoran.

---

## 0. Profil pembelajar (input, bukan asumsi saya)

| Dimensi | Isi |
|---|---|
| Latar | Frontend dev Indonesia, Ionic React + Capacitor, Android-heavy |
| Sudah punya | React, TypeScript dasar, packaging mobile, konsumsi REST dari client |
| Belum punya | NestJS, DI, decorator/metadata, ORM, desain schema SQL, Docker, Kubernetes, message queue, WebSocket sisi server, observability, Redux Toolkit |
| Ingin | **struktur**, **KENAPA** tiap teknologi dipilih, dan **ALTERNATIFNYA** |
| Budget | 10–15 jam/minggu, target ±18–22 minggu |
| Gaya | STAGED MIXED: awal = bangun versi mini dari nol · tengah = bedah repo asli · akhir = kirim fitur nyata end-to-end |
| Ops | DEEP — sampai Kubernetes + observability |
| Next.js | modul tersendiri, puncaknya port satu halaman Drovery_Admin ke App Router |

Dua konsekuensi desain langsung dari profil ini:

1. **Prosa "kenapa + alternatif" sudah tersedia gratis.** Kedelapan peta itu bukan tutorial; tiap
   konsep punya blok `Kenapa dipakai di sini` (mengutip komentar kode asli) dan `Alternatif`
   (dengan trade-off). Artinya kurikulum tidak perlu menyediakan teori — ia perlu menyediakan
   **urutan** dan **capstone**. Itu yang saya kerjakan di sini.
2. **Kekuatan React/TS bisa dipakai sebagai jalan pintas.** Layar React untuk irisan end-to-end
   pertama nyaris nol biaya belajar. Maka "layar saya sendiri" bisa masuk ke Fase 1, bukan Fase 5.

---

## 1. Inventaris konsep gabungan (hasil merge 8 peta)

Nomor dalam kurung = nomor konsep di peta asal. Kolom **Fase** = tempat konsep itu mendarat di
tangga akhir. Tanda `~` = sengaja dibaca saja (skim), tidak ada latihan wajib.

### 1.1 `backend:core-and-auth` (map-be-core, 14 konsep)

| # | Konsep | Prasyarat menurut peta | Fase |
|---|---|---|---|
| 1 | Module & module graph (`@Module`) | — | 1 |
| 2 | Provider & Dependency Injection | 1 | 1 |
| 3 | Decorator + `reflect-metadata` (pasangan tulis/baca) | 2 | 1 |
| 4 | Controller, routing, param decorator | 3 | 1 |
| 5 | Custom provider, injection token, `@Global()` | 2, 3 | 2 |
| 6 | `ConfigModule` + `validate()` fail-fast | 5 | 2 |
| 7 | DTO + `ValidationPipe` + `class-validator` | 4, 3 | 1 (dasar) / 2 (whitelist sebagai trust boundary) |
| 8 | `TransformInterceptor` + RxJS (middleware dua arah) | 4 | 2 |
| 9 | `APP_FILTER` + `AllExceptionsFilter` + exception ber-key | 5, 7, 8 | 2 |
| 10 | i18n katalog + `i18nValidationExceptionFactory` | 9, 5, 7 | 2 |
| 11 | Guard global, urutan `APP_GUARD`, `Reflector` | 3, 5, 4 | 2 |
| 12 | Passport JWT strategy | 11, 6 | 2 |
| 13 | Refresh rotation, reuse detection, atomisitas | 12, 9, 11 | 2 (rotasi dasar) → **4** (atomisitas + reuse detection) |
| 14 | OpenAPI/Swagger sebagai produk sampingan metadata | 3, 8, 11, 7 | 2 |

**Catatan pemisahan #13.** Peta menaruh reuse-detection di area auth, tapi penjelasannya bersandar
pada `$transaction([revoke, insert])` dan pada gagasan "dua penulis berebut satu baris". Transaksi
baru ada di Fase 3 dan balapan baru ada di Fase 4. Jadi #13 saya **pecah dua**: mekanika rotasi
(hash-at-rest, `jti`, satu token sekali pakai) di Fase 2 tanpa klaim atomik, lalu atomisitas +
reuse detection + skenario `AUDIT-LOG.md:301-310` dibuka ulang di Fase 4. Ini juga persis urutan
historis repo-nya sendiri.

### 1.2 `backend:data-layer` (map-be-data, 19 konsep)

| # | Konsep | Prasyarat | Fase |
|---|---|---|---|
| 1 | Model → tabel, `@@map`, `prisma.config.ts` | — | 1 |
| 2 | Kolom: tipe, nullable, `Json`, `String[]`, `Float` vs `Decimal` untuk uang | 1 | 1 (dasar) / 3 (uang) |
| 3 | PK & unique constraint; **unique sebagai LOCK** (`activeDeliveryId`) | 2 | 3 |
| 4 | Relasi & FK, `Cascade` / `SetNull` / sengaja tanpa FK | 3 | 3 |
| 5 | Enum PG vs string polos (`locale`) | 2 | 3 |
| 6 | Index & aturan prefix kiri | 3, 4 | 3 |
| 7 | `CHECK` + partial unique index (yang Prisma tak bisa ungkapkan) | 3, 6 | 3 |
| 8 | Migration = DDL berversi, urutan backfill, gerbang drift | 1–7 | 3 |
| 9 | Seed idempoten (`upsert`, `ON CONFLICT`) | 8 | 3 |
| 10 | `PrismaService`: pool, adapter, DI, `onApplicationShutdown` | 1 + DI | 3 |
| 11 | Transaksi: atomicity dan **apa yang TIDAK ikut rollback** | 10, 4 | 3 |
| 12 | CAS + isolation level (Read Committed) | 11, 3 | **4** |
| 13 | Idempotency & at-least-once (kunci deterministik, P2002=sukses) | 3, 11, 12 | **4** |
| 14 | Read replica + empat larangan rute baca | 10, 12 | **4** (bukan 3 — lihat §3.2) |
| 15 | Redis cache-aside, TTL, fail-open, negative caching, cache ROWS bukan JAWABAN | 10, 14 | **4** |
| 16 | Transactional Outbox (dual-write problem) | 11, 12, 13 | **4** |
| 17 | RANGE partitioning + konsekuensi composite PK + `TrackingIdRegistry` | 3, 4, 6, 8 | **5** (lihat §3.3) |
| 18 | Maintenance partisi: DDL sebagai job terjadwal, `??` vs `\|\|` | 17 + BullMQ | **5** |
| 19 | Sharding: sumbu skala berbeda dari partisi, blocker transaksi | 17, 11, 16 | ~9 (baca) |

### 1.3 `backend:delivery-domain` (map-be-domain, 15 konsep)

| # | Konsep | Prasyarat | Fase |
|---|---|---|---|
| 1 | Delivery sebagai state machine (himpunan status, bukan satu kolom) | — | 4 (kosakata) / 6 (utuh) |
| 2 | Validasi di boundary vs invariant di service (DTO saja tidak cukup) | 1 | 6 |
| 3 | Data server-authoritative (geocode menang atas koordinat klien) | 2 | 6 |
| 4 | Gerbang berlapis, fail-closed (airspace) vs fail-open (weather) | 3 | 6 |
| 5 | CAS — primitif konkurensi inti | 1 | **4** |
| 6 | Inti domain sebagai fungsi murni (feasibility, energy) | 4 | 6 |
| 7 | Job queue durabel + idempotensi (BullMQ ganti `setTimeout`) | 1, 5 | **5** |
| 8 | Dua produsen satu kontrak: `SIMULATED` vs `LIVE`, PHASE≠STATUS | 5, 7 | 6 |
| 9 | Klaim & pelepasan resource fisik (dispatch engine) | 5, 6 | 6 |
| 10 | Realtime fan-out: WS + Redis pub/sub + hot store | 7, 8 | **7** |
| 11 | Watchdog: sistem yang menyembuhkan diri, false-positive | 5, 8, 10 | 6 (butuh 5 & 7 → lihat §3.4) |
| 12 | Command outbox backend → drone (issue/poll/ack) | 5, 8, 11 | 6 |
| 13 | Saga, kompensasi, reconciliation (`OrphanReaper`) | 5, 7, 9 | **4** (pola) / 6 (jalur pesawat) |
| 14 | Delivery terjadwal & berulang: cursor CAS, at-most-once, timezone | 1, 7, 9 | 6 |
| 15 | Audit di dalam transaksi, dan aturan yang sengaja dilanggar | 5, 13 | **4** |

### 1.4 `backend:async-and-integrations` (map-be-async, 17 konsep)

| # | Konsep | Prasyarat | Fase |
|---|---|---|---|
| 1 | Seam "real-or-mock" per integrasi eksternal | DI, Config | 4 (Stripe) / 7 (MQTT, mail, storage) |
| 2 | Health check: liveness vs readiness | controller | **5** |
| 3 | `PROCESS_ROLE`: satu graph, empat proses | 2 | **5** |
| 4 | BullMQ: delayed job durabel (producer ↔ processor) | 3, Redis | **5** |
| 5 | Idempotency: `jobId` deterministik + CAS monoton | 4, transaksi | **5** (bersandar CAS dari 4) |
| 6 | Prometheus: registry, tipe metrik, jebakan cardinality | 4, 3 | **8** |
| 7 | Repeatable scheduler, kill switch, heartbeat gauge | 4, 6 | **5** (mekanika) / 8 (gauge) |
| 8 | Dari metrik ke autoscaling & alerting (`max()` vs `sum()`) | 6, 3 | 8 (alert) / 9 (KEDA) |
| 9 | Stripe webhook 1/2: raw body & verifikasi signature | 1 | **4** |
| 10 | Stripe webhook 2/2: at-least-once, out-of-order, ledger idempotency | 9, 5 | **4** |
| 11 | Fan-out push notification: fire-and-forget yang benar | 1, 5 | **7** |
| 12 | WebSocket gateway `ws` mentah (kenapa bukan socket.io) | 3 | **7** |
| 13 | Fan-out lintas replica via Redis Pub/Sub (+ mode sharded) | 12, 3 | **7** |
| 14 | Backpressure & graceful drain di tier socket | 12, 13, 6 | **7** |
| 15 | MQTT transport kedua + MQTT5 `$share` | 1, 3, 6 | ~7 |
| 16 | OpenTelemetry: satu `traceId` melintasi API → queue → worker | 4, 3, 6 | **8** |
| 17 | Sentry, dan aturan "satu pemilik" OTel global | 16 | 8 |

### 1.5 `backend:infra-and-deploy` (map-be-infra, 24 konsep)

| # | Konsep | Fase |
|---|---|---|
| 1–4 | Image, layer caching, multi-stage, slim vs alpine (Prisma!), `.dockerignore`, non-root/HEALTHCHECK | 9 |
| 5 | Satu image banyak peran (`PROCESS_ROLE` sisi container) | 9 (sudah dikenal sejak 5) |
| 6–7 | Compose sebagai service graph; healthcheck + `depends_on` condition + one-shot `migrate` | 9 |
| 8 | **PgBouncer & transaction pooling** — konsep tersulit area ini | 9 |
| 9–10 | Overlay Compose (`!reset`, `${VAR:?}`), Caddy edge single-origin + auto-TLS | 9 |
| 11 | Metrics endpoint & Prometheus scraping | 8 |
| 12–14 | Scale horizontal + nginx resolver trap, k6, `cpus` quota vs `cpuset` | 10 |
| 15–16 | Alert rules/SLO/Alertmanager inhibit; Grafana provisioning-as-code | 8 |
| 17–18 | CI (service container + drift gate), CD (tagging, rollback, deploy manual) | 9 |
| 19–23 | Kubernetes: Deployment/Service/Ingress, tiga probe, preStop/grace, Kustomize, migrate Job, HPA/KEDA/PDB, kubeconform + kind dry-run | 10 |
| 24 | Runbook backup terverifikasi & rehearsal restore | 9 |

### 1.6 `docs:decisions-and-rationale` (map-docs, 19 konsep + tabel kelas bug)

Peta ini **bukan** fase tersendiri. Ia adalah lapisan "kenapa" yang ditempelkan ke fase lain:

- #1 (dokumen keputusan sebagai artefak, penanda ✅/🟡/📐) → Fase 3, sebagai keterampilan membaca repo.
- #2 (envelope sebagai kontrak lintas-repo) → Fase 2 + Fase 10.
- #4 (inert seam / feature flag default OFF) → Fase 4 (`DELIVERY_DEBIT_FIRST`) & Fase 5.
- #5 (fail-open vs fail-closed per-dependency) → Fase 6.
- #13 (`??` bukan `||`) → Fase 5.
- #14 (audit log: allowlist, co-commit, tanpa FK) → Fase 4.
- #15 (config jadi data: airspace) → Fase 6.
- #16 (capacity model, angka ILLUSTRATIVE) → Fase 10.
- #17–18 (sinyal autoscaling; menunda sharding) → Fase 10.
- #19 (loop AUDIT-PLAN → kerja → AUDIT-LOG → mutation testing) → **Fase 4** (dipakai sebagai metode
  verifikasi capstone) dan menjadi ritual wajib mulai Fase 4 sampai Fase 11.
- **Tabel "Kelas bug berulang"** (13 baris) → dipakai sebagai bank studi kasus lintas fase.

### 1.7 `mobile:expo-app` (map-mobile, 20 konsep)

Dipakai selektif. Yang masuk kurikulum: 1–6 (anatomi Expo, RN primitives, expo-router, feature-sliced,
`EXPO_PUBLIC_*`, apiClient), 7–10 (secure store, AuthContext, refresh + `noAuthRetry`, AuthGate),
11 (pola hook data), 18 (kontrak wire-format — ini jembatan terbaik ke backend), 19 (testing).
Yang di-skim: 12–17 (back button, native modules, peta, animasi, WS client, merge frame) dan 20 (EAS).
Alasan: fokus kurikulum adalah backend + ops; mobile masuk hanya sebagai **konsumen** fitur di Fase 11.

### 1.8 `admin:vite-react-console` (map-admin, 15 konsep + bagian Next.js)

Masuk Fase 10: 1 (Vite entry chain), 2 (typed fetch + envelope), 3 (MUI/`sx`), 4 (**Redux Toolkit**),
5 (`createAsyncThunk` + single-flight refresh), 6 (react-router 7 data router), 7 (`NAV_ITEMS` sebagai
satu sumber kebenaran nav+guard), 8 (`useApi`), 9 (`useMutation` + `ConfirmDialog`), 10 (URL sebagai
state), 11 (invariant domain sebagai fungsi murni), 13 (Vitest + `renderWithProviders`).
Di-skim: 12 (supportSocket — sudah dapat versi backend-nya di Fase 7), 14–15 (chunking, nginx —
sudah dapat konsep induknya di Fase 9).
Bagian "kalau di-port ke Next.js App Router" (map-admin baris 899–987) adalah **silabus Fase 11 apa
adanya**, termasuk tabel perubahan lintas-halaman dan catatan per-halaman.

---

## 2. Prinsip penyusunan tangga

1. **Frontload sampai terasa.** Yang membuat orang berhenti bukan sulitnya konsep, tapi tidak
   melihat hasil. Jalur terpendek ke "endpoint saya, tabel saya, layar saya, saling bicara" =
   module → provider/DI → controller → DTO → Prisma model → migration → `fetch` dari React.
   Itu 7 konsep, semuanya prasyarat-nol atau prasyarat-satu. Muat di 1,5 minggu.
2. **Bangun dulu yang kecil, baru bedah yang besar.** Fase 1–2 di sandbox sendiri; Fase 3 ke atas
   di repo asli. Alasannya bukan pedagogis-umum: `AppModule` Drovery mengimpor 22 module dan
   memasang 3 guard global — membaca `app.module.ts` sebelum pernah menulis `@Module` sendiri
   adalah membaca peta kota tanpa pernah berjalan kaki.
3. **Satu fase = satu model mental baru.** Fase 4 hanya punya satu ide besar ("database yang
   memutuskan siapa menang"), meski ia menyentuh 10 file. Fase 5 juga satu ("satu graph, banyak
   proses"). Kalau satu fase butuh dua model mental baru, ia dipecah.
4. **Capstone harus bisa gagal.** Setiap capstone punya bentuk "jalankan → lihat", bukan "pahami".
   Beberapa sengaja berbentuk **merusak lalu memperbaiki** (mutation testing), karena peta
   `map-docs` #19 menunjukkan itulah satu-satunya cara membuktikan test-nya bernilai.
5. **Alternatif diajarkan sebagai bagian capstone, bukan bacaan tambahan.** Pembelajar minta
   "apa alternatifnya". Maka beberapa capstone secara eksplisit meminta perbandingan tertulis
   (mis. `sum()` vs `max()`, `cpus` vs `cpuset`, cache jawaban vs cache rows).

---

## 3. Verifikasi urutan: jalan-kaki menyusuri daftar prasyarat

Aturan: **tidak ada fase yang membutuhkan konsep yang baru diperkenalkan belakangan.** Berikut
pemeriksaannya, satu per satu, termasuk empat tempat di mana saya harus **menyimpang dari urutan
peta asal**.

### 3.1 Jalan-kaki dasar

- **Fase 1** butuh: React, TS, REST-client (sudah dimiliki). Memperkenalkan: module, provider/DI,
  decorator/metadata, controller, DTO/ValidationPipe dasar, Prisma model/migration/client, CORS.
  Tidak ada yang menunjuk ke depan. ✔
  *Satu utang yang saya akui:* `docker compose up postgres` dipakai sebagai **resep**, padahal Docker
  baru diajarkan di Fase 9. Ini bukan pelanggaran konsep (tidak ada pemahaman Docker yang dibutuhkan
  untuk mengetik satu perintah), tapi ia risiko nyata — masuk ke `riskiestAssumptions` beserta jalan
  keluarnya (Postgres terkelola gratis).
- **Fase 2** butuh Fase 1 (module/DI/decorator/controller/DTO). Memperkenalkan: custom provider &
  `@Global`, Config + `validate()`, interceptor + RxJS, `APP_FILTER` + exception ber-key, i18n
  sebagai fungsi murni, guard global + urutan + `Reflector`, Passport JWT, bcrypt, rotasi refresh
  (mekanika), throttler, Swagger. Semua prasyaratnya ada di Fase 1 atau di dalam Fase 2 sendiri
  dengan urutan internal yang benar (custom provider → config → filter, karena filter butuh DI
  untuk `I18nService`). ✔
- **Fase 3** butuh Fase 1 (Prisma dasar) + Fase 2 (DI, lifecycle, config). Memperkenalkan seluruh
  data layer statik + transaksi. Transaksi tidak butuh CAS (arahnya terbalik: CAS butuh transaksi). ✔
- **Fase 4** butuh Fase 3 (transaksi, unique, index) + Fase 2 (auth, filter). Memperkenalkan CAS,
  isolation, idempotency, webhook Stripe, outbox, saga+reaper, audit-in-tx, replica, cache,
  dan menutup utang atomisitas rotasi refresh dari Fase 2. ✔
- **Fase 5** butuh Fase 4 (CAS + idempotency — tanpa keduanya, "retry aman" adalah dusta).
  Memperkenalkan `PROCESS_ROLE`, BullMQ, scheduler, health probe, partisi + maintenance-nya. ✔
- **Fase 6** butuh Fase 4 (CAS) + Fase 5 (job, worker). Memperkenalkan domain penerbangan utuh. ✔
- **Fase 7** butuh Fase 5 (tier, worker) + Fase 6 (siapa yang menghitung update). ✔
- **Fase 8** butuh Fase 5 (queue depth), 6, 7 (socket gauge). ✔
- **Fase 9** butuh Fase 3 (migration), 5 (peran proses), 8 (endpoint metrics untuk di-scrape). ✔
- **Fase 10** butuh Fase 9 (image, compose, CI) + Fase 8 (metrik yang jadi sinyal KEDA). ✔
- **Fase 11** butuh hampir semua (fitur menyentuh migration, CAS, job, metrik, i18n, CI). ✔
- **Fase 12** butuh Fase 10-11 (halaman admin yang mau di-port harus sudah dikenal + auth model). ✔

### 3.2 Penyimpangan #1 — read replica & cache **pindah** dari data layer ke fase konkurensi

Peta `map-be-data` menaruh read replica (#14) dan cache (#15) tepat setelah `PrismaService` (#10).
Tapi aturan operasional replica ditulis begini di `src/prisma/prisma.service.ts:68-73`:

> NEVER route a read that **feeds a CAS**, is compared/incremented, authorizes a write, or is
> returned right after a write through here.

Empat larangan itu **tidak bisa dipahami** sebelum tahu apa itu CAS. Hal serupa untuk cache:
`users.service.ts:11-14` membenarkan caching profil justru karena "the authoritative gate is the
DB-resolved RolesGuard, which never reads this cache". Jadi keduanya saya geser ke Fase 4, setelah
CAS dan setelah guard. Ini memperbaiki urutan peta asal, bukan melanggarnya.

### 3.3 Penyimpangan #2 — partitioning **turun** dari data layer ke fase job

Partisi (#17) secara teknis adalah konsep schema/migration (Fase 3). Tapi:
- konsekuensi terberatnya (`findUnique({where:{id}})` mati, `TrackingIdRegistry` lahir, kolom
  `deliveryCreatedAt` menyebar ke 6 tabel anak) baru **terasa** saat kode dijalankan; dan
- pemeliharaannya (#18) adalah **repeatable job BullMQ**, yang butuh Fase 5.

Mengajarkan #17 di Fase 3 lalu #18 dua fase kemudian memecah satu cerita jadi dua. Saya satukan
keduanya di Fase 5, di mana "DDL sebagai pekerjaan terjadwal" jadi contoh paling tajam dari
"job bukan cuma untuk mengirim email". Prasyaratnya (migration dari Fase 3, index/PK dari Fase 3,
job dari Fase 5) semuanya sudah ada. ✔

### 3.4 Penyimpangan #3 — watchdog tetap di fase domain meski peta menaruhnya setelah realtime

`map-be-domain` #11 mencantumkan prasyarat #10 (realtime fan-out). Saya periksa alasannya: watchdog
membaca `tracking.updatedAt` — kolom yang diisi oleh jalur tracking. Tapi yang dibutuhkan hanyalah
**fakta bahwa kolom itu bergerak tiap frame posisi**, bukan mekanisme fan-out WS/pub-sub. Frame
posisi masuk lewat telemetry ingest (Fase 6), bukan lewat WebSocket. Jadi watchdog aman di Fase 6,
dan Fase 7 (realtime) boleh datang sesudahnya. Yang saya pindahkan ke Fase 7 hanyalah bagian
`tracking-hot-store.ts:100-107` (kenapa posisi tetap ditulis ke Postgres) — itu memang butuh
pemahaman hot store, dan di situ ia jadi "oh, ini menyelamatkan watchdog yang sudah kamu kenal".

### 3.5 Penyimpangan #4 — Stripe webhook **utuh** di Fase 4, bukan dipecah

`map-be-async` memecah webhook jadi #9 (raw body + signature) dan #10 (idempotency + ordering).
#9 secara topikal adalah "integrasi", #10 adalah "idempotency". Memecahnya lintas fase berarti
membaca `webhook.controller.ts` dua kali dengan jarak berminggu-minggu. Karena `rawBody: true`
hanyalah satu flag di `main.ts` (dan `main.ts` sudah akrab sejak Fase 1–2), saya taruh keduanya
di Fase 4, di mana pesan besarnya utuh: **uang + at-least-once = wajib idempoten, dan gerbangnya
fail-closed.** Fase 7 lalu murni berisi transport realtime (WS/pub-sub/MQTT/push).

### 3.6 Titik yang saya periksa ulang dan ternyata AMAN

- **`@Global()` sebelum `@Global()` dibutuhkan?** Fase 1 memakai `PrismaService` dari module yang
  di-import eksplisit (bukan global), jadi `@Global()` boleh baru muncul di Fase 2. ✔
- **`i18n` sebelum worker?** Justifikasi i18n non-request-scoped ("worker tidak punya request")
  butuh gagasan worker. Di Fase 2 saya ajarkan i18n sebagai **fungsi murni `(key, locale, params)`**
  dan menandai alasan arsitekturalnya sebagai *forward pointer* — lalu Fase 5 membuka kembali
  komentar `i18n.service.ts:5-12` sebagai "sekarang kalimat itu masuk akal". Ini forward *pointer*,
  bukan forward *dependency*: Fase 2 tetap lengkap tanpa pengetahuan worker.
- **Outbox butuh worker?** Polanya (tulis niat di transaksi yang sama) lengkap tanpa worker.
  Yang butuh Fase 5 hanyalah "di proses mana dispatcher hidup". Di Fase 4 dispatcher dijalankan
  manual/flag, sesuai latihan di `map-be-data` #16. ✔
- **Health probe sebelum Kubernetes?** Liveness vs readiness bisa dijelaskan penuh dengan `curl`
  dan Compose `depends_on`. Probe k8s (Fase 10) lalu hanya memasang tiga probe ke dua endpoint
  yang sudah dipahami. Urutan ini justru lebih baik daripada kebalikannya. ✔
- **Redux Toolkit sebelum Next.js?** Fase 12 (port ke App Router) **menghapus** Redux dari halaman
  yang di-port. Jadi RTK harus diajarkan lebih dulu (Fase 10) supaya pembelajar tahu apa yang
  hilang dan kenapa. Kalau dibalik, port-nya jadi ritual tanpa makna. ✔

---

## 4. Hitungan waktu (dan kenapa angkanya jujur)

Estimasi dikalibrasi pada **±12 jam/minggu** (tengah rentang 10–15).

| Fase | Minggu | Jam (±12/mgg) | Jumlah konsep | Jam/konsep |
|---|---|---|---|---|
| 1 Irisan pertama | 1,5 | 18 | 8 | 2,3 |
| 2 Pipeline & identitas | 2,0 | 24 | 11 | 2,2 |
| 3 Data layer & transaksi | 2,5 | 30 | 11 | 2,7 |
| 4 Konkurensi & uang | 2,5 | 30 | 12 | 2,5 |
| 5 Satu graph, banyak proses | 2,0 | 24 | 10 | 2,4 |
| 6 Domain penerbangan | 2,0 | 24 | 10 | 2,4 |
| 7 Realtime & integrasi | 2,5 | 30 | 9 | 3,3 |
| 8 Observability | 2,0 | 24 | 9 | 2,7 |
| 9 Container → produksi 1 kotak | 2,5 | 30 | 12 | 2,5 |
| 10 Bukti skala & Kubernetes | 2,5 | 30 | 12 | 2,5 |
| 11 Kirim fitur end-to-end | 2,5 | 30 | 12 | 2,5 |
| 12 Modul Next.js | 1,5 | 18 | 8 | 2,3 |
| **Total** | **26,0** | **312** | **124** | **2,5** |

**26 minggu, bukan 18–22.** Ini harus dikatakan terus terang, bukan disembunyikan dengan
mengecilkan angka per fase. Tiga fakta yang menghasilkan angka itu:

1. Cakupannya memang besar: 124 konsep dari 8 peta, plus ops DEEP (Docker → k8s → observability),
   plus modul Next.js, plus fase kirim-fitur.
2. Ops tidak bisa dipercepat dengan membaca. `kind` + KEDA + k6 + PgBouncer adalah jam-jam
   menunggu container, bukan jam membaca.
3. Fase 4 (konkurensi) adalah lompatan model mental terbesar bagi orang React; memampatkannya
   adalah cara tercepat membuat semua fase sesudahnya jadi cargo cult.

**Cara mencapai 22 minggu kalau itu batas keras** (tiga tuas, urutan rekomendasi):
- **−1,5 mgg:** Fase 7 potong MQTT `$share` dan mode `sharded` pub/sub jadi bacaan saja; capstone
  cukup WS + pub/sub + backpressure.
- **−1,0 mgg:** Fase 10 potong blok k6/`cpuset`/capacity-model jadi bacaan + satu run `sweep.sh`
  yang sudah ada; fokus penuh ke k8s.
- **−1,5 mgg:** Fase 6 potong recurring/timezone dan command outbox jadi bacaan; keduanya tidak
  jadi prasyarat fase mana pun (sudah saya cek: tidak ada fase setelahnya yang menyebutnya).
Sisanya: 22,0 minggu. Kalau pembelajar konsisten di 15 jam/minggu tanpa memotong apa pun,
26 minggu × (12/15) ≈ **21 minggu kalender** — jadi target 18–22 tercapai lewat **intensitas**,
bukan lewat pemangkasan. Itu pilihan yang harus dia buat sadar, bukan saya sembunyikan.

---

## 5. Desain capstone (kenapa bentuknya begitu)

Empat pola capstone yang saya pakai berulang:

1. **Irisan berjalan** (Fase 1, 2, 11) — ada URL yang bisa dibuka, ada baris di tabel.
2. **Bunuh lalu buktikan sembuh** (Fase 5, 9, 10) — matikan API di tengah penerbangan, matikan
   Redis, rusak probe. Ini satu-satunya cara membuktikan klaim "durable" / "self-healing".
3. **Mutasi lalu catat** (Fase 3, 4, 6) — balik `>` jadi `>=`, hapus klausa `where`, pindahkan
   `release()` ke sebelum CAS; catat test mana yang mati. Kalau tidak ada yang mati, pembelajar
   baru saja menemukan lubang test dan harus menutupnya. Metode ini diambil langsung dari
   `AUDIT-LOG.md:2069-2078`, termasuk aturan anti-menipu-dirinya.
4. **Tulis perbandingan** (Fase 7, 8, 10, 12) — karena pembelajar secara eksplisit minta
   "alternatifnya apa", dan satu-satunya cara memverifikasi pemahaman alternatif adalah
   memintanya menuliskan trade-off dengan angka dari mesinnya sendiri.

Mulai Fase 4, setiap capstone juga menghasilkan **satu entri bergaya `AUDIT-LOG.md`**: apa yang
berubah, cacat apa yang ditutup, harga apa yang diterima, dan `### Left undone`. Ini melatih
keterampilan yang `map-docs` sebut paling bernilai dari repo ini: membedakan yang sudah jalan,
yang baru dirancang, dan yang sudah dibantah.

---

## 6. Yang sengaja TIDAK masuk (dan alasannya)

| Dikeluarkan | Alasan |
|---|---|
| Sharding (`shard-key.ts`, `SCALING-1M.md §2`) | Inert di produksi (`shardCount=1`). Nilainya sebagai *cerita keputusan*, bukan keterampilan. Dibaca di Fase 10 sebagai "kenapa ini ditunda". |
| `react-native-maps`, Reanimated, EAS build, back-button Android | Mobile masuk kurikulum hanya sebagai konsumen fitur (Fase 11). Pembelajar sudah bisa mengirim app Android; delta RN yang benar-benar dibutuhkan hanya apiClient + secure store + AuthGate + wire contract. |
| `manualChunks` / nginx admin (map-admin #14–15) | Konsep induknya (layer caching, multi-stage, static serving) sudah didapat di Fase 9. |
| `supportSocket` sisi klien (map-admin #12) | Duplikat dari Fase 7 sisi server; dibaca saja saat Fase 10. |
| Grafana Jsonnet, Helm, GitOps/ArgoCD | Alternatif yang disebut peta tapi tidak ada di repo; cukup jadi paragraf perbandingan. |

---

## 7. Risiko yang saya sadari saat menyusun (versi panjang dari `riskiestAssumptions`)

1. **Docker dipakai sebelum diajarkan (Fase 1).** Kalau Docker Desktop/WSL2 bermasalah, frontload
   mati di minggu pertama — persis kebalikan dari tujuannya. Mitigasi: sediakan `DATABASE_URL`
   Postgres terkelola (Neon/Supabase) sebagai jalur cadangan Fase 1–2.
2. **Lompatan model mental terbesar bukan NestJS, tapi konkurensi.** Di React, `setState` selalu
   menang. Di sini `updateMany(...).count === 0` berarti "aktor lain menang". Kalau Fase 4 tidak
   mendarat, Fase 5–7 berubah jadi menyalin pola. Fase 4 mungkin butuh 4 minggu, bukan 2,5.
3. **Taruhan "bangun dulu yang kecil".** Dua fase pertama tidak menghasilkan kontribusi apa pun ke
   repo asli. Pembelajar yang ingin portofolio bisa merasa 3,5 minggu pertama "bukan kerja nyata"
   dan melompat ke repo — terasa produktif, hasil belajarnya lebih dangkal.
4. **DI + decorator bisa terasa sihir berminggu-minggu.** Latihan `emitDecoratorMetadata` dan
   pasangan tulis/baca metadata dirancang untuk membongkarnya, tapi tidak ada jaminan.
5. **Refleks Ionic memetakan RN terlalu optimistis.** "React juga kan?" — sampai bertemu tanpa DOM,
   tanpa CSS cascade, Expo Go tidak bisa native module, dan EAS build. Fase 11 memampatkan delta ini.
6. **Redux Toolkit diajarkan lalu sebagian dibuang.** Fase 10 mengajarkannya, Fase 12 menghapusnya
   dari halaman yang di-port. Bisa terasa sia-sia; harus dibingkai sebagai "inilah cara memilih
   rumah untuk tiap jenis state", bukan "belajar RTK".
7. **Ops DEEP butuh mesin.** `kind` + KEDA + Prometheus + Grafana + full compose stack butuh RAM
   yang lumayan; `loadtest/run.sh` butuh Linux + `sudo`. Di laptop Windows 8 GB, Fase 10 runtuh.
8. **Anchor baris akan bergeser.** Mulai Fase 3 pembelajar mengubah repo; seluruh anchor
   `file.ts:123` di kedelapan peta menunjuk snapshot hari ini. Wajib: pin satu tag/branch
   (`git tag curriculum-baseline`) dan baca peta terhadap tag itu.
9. **Fase 11 mengandaikan tiga repo hidup bersamaan** + seluruh seam mock (Stripe/Expo/MQTT) cukup.
   Kalau ternyata butuh kunci Stripe asli atau device fisik, fase itu melar.
10. **Next.js di paling akhir** = dikerjakan saat energi paling rendah. Kalau Next.js adalah
    kebutuhan kerja mendesak, ia harus naik ke sekitar Fase 8 — harganya: port-nya dilakukan
    terhadap halaman admin yang belum benar-benar dikuasai.
11. **Bahasa.** Peta berbahasa Indonesia, tapi seluruh komentar kode, `ARCHITECTURE.md`,
    `AUDIT-LOG.md`, dan `SCALING-1M.md` berbahasa Inggris teknis padat. Kurikulum ini
    mengandaikan kenyamanan membaca prosa teknis Inggris — asumsi yang belum diverifikasi.
12. **Angka 26 minggu bisa jadi masih optimis** kalau pembelajar juga bekerja penuh waktu:
    10–15 jam/minggu di luar pekerjaan adalah komitmen besar yang biasanya melemah di minggu 8–12,
    yaitu tepat di Fase 5–7 (bagian terpadat). Titik rawan drop-out ada di sana, bukan di awal.

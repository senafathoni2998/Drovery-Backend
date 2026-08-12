# Peta Area: `docs:decisions-and-rationale`

**Repo:** `/home/darth-zelantus/Documents/Project_Pribadi/Drovery_Backend`
**Untuk:** frontend dev Ionic React + Capacitor yang belum kenal NestJS, DI, ORM, SQL schema, Docker, K8s, message queue, WebSocket server-side, observability.

---

## Kalimat pembuka

Area ini **bukan** tentang library. Ini tentang **rekaman keputusan**: repo Drovery menulis
alasannya sendiri di enam dokumen tingkat-repo (`README.md`, `ARCHITECTURE.md`, `SCALING-1M.md`,
`ROADMAP.md`, `INTEGRATION.md`, `DEPLOY.md`), dua spec desain di `docs/superpowers/specs/`, satu
runbook (`prisma/PARTITIONING.md`), sebuah rencana perbaikan (`AUDIT-PLAN.md`) dan sebuah log
append-only sepanjang 2.297 baris (`AUDIT-LOG.md`) — plus komentar kode yang, tidak biasa untuk
proyek sebesar ini, **menjelaskan alternatif yang ditolak**, bukan cuma apa yang dilakukan.

Yang harus dipelajari di sini: cara membaca sebuah *keputusan arsitektur* — apa yang dipilih, apa
yang **ditolak**, dan **harga apa yang diterima**. Hampir setiap konsep di bawah punya kalimat
"cost, accepted" atau "the flaw is X, deliberately deferred" di dalam repo itu sendiri.

### Cara membaca dokumen ini (aturan main repo-nya)

Dokumen di repo ini memuat **tiga hal sekaligus** dan menandainya:

| Penanda | Artinya |
|---|---|
| `✅` | sudah dibangun **dan** diverifikasi |
| `🟡` | separuh jalan — baca kalimat setelahnya, biasanya menyebut sisa pekerjaannya |
| `☐ / 📐 "Designed here, built later"` | baru desain, **belum ada kodenya** |
| `**ILLUSTRATIVE**` / `FILL FROM RUN` | angka placeholder, bukan hasil pengukuran |
| `### Left undone / follow-ups` di `AUDIT-LOG.md` | daftar utang teknis yang **diakui**, per increment |

`SCALING-1M.md:63-91` (§1 *"What this PR ships vs. what it designs"*) adalah contoh paling murni:
satu tabel untuk yang sudah jadi, satu tabel untuk yang baru dirancang, supaya dokumennya tidak
bisa dipakai untuk *over-claim*. Baca dua tabel itu sebelum apa pun.

---

## 1. Dokumen keputusan sebagai artefak rekayasa

- **Prasyarat:** —
- **Anchor:** `SCALING-1M.md:63-91` — tabel "✅ Built + verified in this PR" vs "📐 Designed here,
  built later", masing-masing dengan kolom *Verified* dan *Prerequisite*. Bandingkan dengan
  `ARCHITECTURE.md:11-16` (TL;DR: empat *hard blocker* awal, semuanya bertanda status sekarang).
- **Kenapa dipakai di sini:** repo ini punya tiga audiens sekaligus — dirinya sendiri di sesi
  berikutnya, dua repo klien (`drovery-mobile`, `drovery-admin`), dan seorang reviewer. Aturan yang
  ditulis di `AUDIT-PLAN.md:638-643`: *"Never rewrite a past entry. Append a correcting entry
  instead."* dan *"If you discover the plan is wrong, fix this file **and** record the change under
  Deviations so the disagreement is visible."* Konsekuensinya nyata: commit `8793ca9 docs(audit):
  correct three untrue claims` dan `0e7a650 ... correct the doc's own miscounts` adalah commit
  memperbaiki **dokumen**, bukan kode.
- **Alternatif:**
  - **ADR (Architecture Decision Records)** — satu file kecil per keputusan, bernomor, statusnya
    `proposed/accepted/superseded`. Trade-off: lebih mudah di-*diff* dan di-*supersede*, tapi
    kehilangan narasi lintas-keputusan yang di sini justru inti (misal "kenapa sharding ditunda"
    hanya masuk akal jika §2 dan §3 dibaca berurutan).
  - **Wiki / Notion** — mudah diedit non-developer, tapi tidak ikut di-*review* di PR dan tidak
    punya `git blame`; klaim salah tidak akan pernah ketahuan lewat commit.
  - **Hanya commit message** — repo ini juga melakukannya (pesan commit-nya kalimat penuh, mis.
    `6af2846 fix(airspace): cache the ROWS, not the answer — and make an empty read alertable`),
    tapi commit tidak bisa menjawab "apa status keseluruhan sistem hari ini".
- **Latihan:** ambil satu baris `🟡` di `ARCHITECTURE.md` (§2 Geocoding) dan satu baris `✅` (§3
  Real-time tracking). Untuk masing-masing, buktikan status itu di kode: cari `CacheService` di
  `src/cache/` dan `TrackingSubscriber` di `src/deliveries/tracking/`. Tulis 5 kalimat: apakah
  penandanya jujur? Lalu cari di `AUDIT-LOG.md` bagian *Left undone* mana yang membahasnya.

---

## 2. Response envelope sebagai kontrak lintas-repo

- **Prasyarat:** #1
- **Anchor:** `INTEGRATION.md:56-76` — bentuk sukses `{success, data, timestamp}` vs bentuk error
  yang **sengaja tidak dibungkus** (flat `{statusCode, timestamp, path, message, error}`).
  Implementasinya di `src/main.ts:69` (`TransformInterceptor`) dan `src/app.module.ts:194-199`
  (`AllExceptionsFilter` didaftarkan sebagai `APP_FILTER`, bukan `new` di `main.ts` — komentarnya
  menyebut alasannya: filter itu meng-*inject* `I18nService`, dan mendaftarkannya dua kali akan
  membuatnya jalan dua kali).
- **Kenapa dipakai di sini:** ini satu-satunya kontrak yang dipegang **tiga repo**. `INTEGRATION.md`
  menyebut dirinya *"the source of truth for how the two repos talk to each other"* dan menuliskan
  potongan kode klien yang bergantung padanya: `json.data !== undefined ? json.data : json`. Karena
  envelope-nya runtime-only, `ROADMAP.md:7` mencatat bahwa OpenAPI harus di-*post-process* supaya
  spec-nya ikut membungkus (`allOf[ApiEnvelopeDto, {data}]`) — kalau tidak, klien hasil codegen akan
  men-deserialize bentuk yang salah.
- **Alternatif:**
  - **Tanpa envelope (raw JSON)** — lebih ringkas dan langsung cocok dengan codegen; harganya:
    tidak ada tempat seragam untuk `timestamp`/metadata, dan setiap klien harus menebak apakah
    respons sukses atau error dari status code saja.
  - **JSON:API / HAL** — standar, punya pagination & relasi baku; harganya: payload jauh lebih
    berat dan mobile harus menulis adapter — berlebihan untuk 96 endpoint milik satu tim.
  - **GraphQL** — klien memilih field-nya sendiri, tidak ada masalah envelope; harganya: kehilangan
    caching HTTP, dan seluruh cerita rate-limit per-route + route-template metrics di §10 harus
    dirancang ulang.
- **Latihan:** jalankan `curl -s localhost:3000/api/v1/support/faqs | jq` lalu `curl -s -X POST
  localhost:3000/api/v1/auth/login -d '{}' -H 'Content-Type: application/json' | jq`. Catat bahwa
  yang satu dibungkus dan yang satu tidak. Lalu buka `src/common/interceptors/transform.interceptor.ts`
  dan `src/common/filters/http-exception.filter.ts` dan jelaskan **kenapa** error tidak lewat
  interceptor (petunjuk: interceptor hanya jalan di jalur sukses Nest).

---

## 3. Satu image, banyak peran (`PROCESS_ROLE`)

- **Prasyarat:** #1
- **Anchor:** `src/common/process-role.ts:1-26` — komentar header mendaftar empat peran
  (`api` / `worker` / `realtime` / unset=dev) dan tiga flag turunannya (`IS_WORKER_TIER`,
  `IS_HTTP_TIER`, `IS_INGEST_TIER`). Bandingkan `README.md:524-546` (compose menjalankan satu image
  untuk api/worker/migrate) dan `SCALING-1M.md:85` (kenapa `realtime` dibuat).
- **Kenapa dipakai di sini:** *"Introducing 'realtime' is purely additive: for api/worker/unset these
  flags evaluate EXACTLY as the old per-file `PROCESS_ROLE !== 'api'` checks did."* Artinya: menambah
  tier baru tidak boleh mengubah perilaku tier lama satu byte pun. Efek sampingnya terlihat di
  `src/prisma/prisma.service.ts:37-48` — tier `worker` dan `realtime` **tidak boleh** membuka pool
  read-replica, karena ConfigMap yang sama menaruh URL replica di setiap pod.
- **Alternatif:**
  - **Image/repo terpisah per tier** — batas lebih tegas, tidak ada flag runtime; harganya: N
    pipeline build, dan versi kode antar-tier bisa berbeda saat rolling deploy — padahal di sini
    worker dan api harus menghitung `deliveryShard()` yang **sama persis** (`shard-key.ts:7-11`).
  - **Satu proses monolit** — paling sederhana; harganya persis blocker #1 di `ARCHITECTURE.md:38-43`:
    tidak bisa >1 instance dan restart membunuh setiap delivery yang sedang terbang.
  - **Serverless (Lambda/Cloud Run job)** — skala ke nol; harganya: WebSocket long-lived dan
    BullMQ worker yang harus tetap hidup tidak cocok dengan model eksekusi per-request.
- **Latihan:** jalankan `PROCESS_ROLE=api npm run start:dev` di satu terminal dan `npm run worker` di
  terminal lain. Buat satu delivery lewat `POST /deliveries`, lalu matikan proses api. Buktikan
  delivery tetap maju (cek statusnya lewat worker log / DB). Kemudian buka
  `src/deliveries/deliveries.module.ts` dan tunjukkan baris mana yang mencegah api memproses job.

---

## 4. Feature flag sebagai "inert seam" (default OFF, byte-identical)

- **Prasyarat:** #3
- **Anchor:** `SCALING-1M.md:76-78` — *"These are **inert seams**: introducing them changes nothing at
  runtime (the full test suite stays green), but a later phase **flips a flag / sets an env var**
  instead of refactoring under load."* Contoh kodenya:
  `src/common/sharding/shard-key.ts:32-46` (`shardCount === 1` → selalu `0`) dan
  `src/config/redis.ts:32-43` (per-role host tidak diset → Redis tunggal, byte-identical).
- **Kenapa dipakai di sini:** ada minimal enam flag berpola sama — `TRACKING_HOT_STORE`,
  `REDIS_PUBSUB_MODE=sharded`, `DELIVERY_DEBIT_FIRST`, `DELIVERY_OUTBOX_REFERRAL`,
  `WATCHDOG_ENABLED`, `PARTITION_MAINTENANCE_ENABLED`. Alasannya ditulis eksplisit di
  `SCALING-1M.md:297`: fase 0 harus *"land the inert seams … so later phases flip a flag, not
  refactor under load."* Perhatikan juga sisi jujurnya: `SCALING-1M.md:87` mengakui `REDIS_PUBSUB_MODE
  =sharded` **benar** di Redis standalone tapi baru **mendistribusikan** setelah client Cluster
  dipasang — flag yang tersedia tidak sama dengan manfaat yang tersedia.
- **Alternatif:**
  - **Big-bang refactor** — tidak ada kode mati; harganya: perubahan besar dilakukan justru saat
    sistem sudah kepanasan, dan tidak ada jalan mundur selain revert.
  - **Long-lived branch** — main tetap bersih; harganya: merge hell, dan seam tidak pernah teruji
    bersama kode produksi.
  - **Feature-flag service (LaunchDarkly/Unleash)** — bisa diubah tanpa deploy, ada targeting per
    user; harganya: dependency jaringan baru di jalur boot, dan flag di sini sebagian dibaca **saat
    import** (lihat `partition.constants.ts:4-9`) sehingga runtime-toggle justru tidak diinginkan.
- **Latihan:** pilih `deliveryShard()` di `src/common/sharding/shard-key.ts`. Tulis test yang
  membuktikan tiga hal: (a) `shardCount=1` selalu `0`, (b) `shardCount=4` deterministik untuk id yang
  sama, (c) `shardCount=0` melempar error alih-alih diam-diam mengembalikan 0. Lalu jelaskan kenapa
  (c) adalah keputusan, bukan detail.

---

## 5. Fail-open vs fail-closed — dipilih per-dependency, bukan per-proyek

- **Prasyarat:** #1
- **Anchor:** `src/serviceability/serviceability.service.ts:75-116` — blok no-fly zone, dengan
  komentar: *"FAIL CLOSED, deliberately opposite to the weather check below … the only safe answer to
  'I don't know' is no. **Do not "fix" this into consistency with weather.**"* Pasangannya ada 40
  baris di bawah, `:159-164`: *"Weather is advisory — a failure here must never block a delivery."*
  Sisi service-nya: `src/serviceability/airspace.service.ts:15-22`.
- **Kenapa dipakai di sini:** desainnya menyebutnya *"the inversion that matters"*
  (`docs/superpowers/specs/2026-08-02-airspace-as-data-design.md:88-96`). Dua dependency eksternal,
  dua kebijakan kegagalan berlawanan, **karena konsekuensi salahnya berbeda**: cuaca tidak terbaca →
  paling buruk drone terbang di angin sedang; daftar airspace tidak terbaca → drone bisa masuk ruang
  udara bandara. Repo ini juga mencatat **harga** dari fail-closed di `AUDIT-LOG.md:2366-2377`: blip
  DB sementara saat ini dipetakan ke kode `NO_FLY_ZONE` yang non-retryable, sehingga delivery berbayar
  dibatalkan + di-refund, padahal yang benar adalah *hold*. *"Failing closed is right; reusing a
  non-retryable code for a transient cause is the flaw."*
- **Alternatif:**
  - **Seragam fail-open** — tidak pernah menurunkan availability; harganya: safety check jadi teater
    — persis skenario yang komentar itu larang.
  - **Seragam fail-closed** — paling aman; harganya: satu API cuaca down = seluruh armada berhenti,
    yang di `.env`-default sudah mock dan fail-open justru karena itu.
  - **Circuit breaker + degradasi bertingkat** — membedakan "gagal sekali" vs "gagal terus";
    harganya: state tambahan per-dependency, dan tetap harus menjawab pertanyaan yang sama saat
    breaker terbuka (open apa closed?) — jadi ini menunda keputusan, bukan menggantikannya.
- **Latihan:** matikan Postgres, lalu panggil `POST /pricing/estimate` dengan empat koordinat valid.
  Amati bahwa jawabannya *blocked*, bukan 500. Lalu ubah `airspace.service.ts` supaya `catch`-nya
  `return []` alih-alih `throw`, jalankan `npx jest src/serviceability`, dan catat test mana yang
  merah. (Petunjuk: `AUDIT-LOG.md:2199-2222` menceritakan mutasi persis ini.)

---

## 6. Durable queue menggantikan `setTimeout` in-process

- **Prasyarat:** #3
- **Anchor:** `ARCHITECTURE.md:38-58` — *"Before: `simulation.service.ts` scheduled `setTimeout`s in
  the Node process and stored timers in a `Map`, so you couldn't run more than one instance and a
  restart stranded every in-flight delivery."* Termasuk catatan verifikasi di `:50`: 17 delayed job,
  API dibunuh di tengah, instance baru menyelesaikannya.
- **Kenapa dipakai di sini:** ini blocker #1 dari empat blocker awal. Keputusan turunan yang penting:
  `jobId` dibuat **deterministik** (`deliveryId:stage:i`), sehingga enqueue ulang bersifat idempoten
  dan cancel cukup menghapus job. Efek samping yang diakui jujur di `ARCHITECTURE.md:58`:
  *"⚠️ Redis is now required to run the backend"* — sebuah dependency baru yang wajib, ditulis sebagai
  peringatan, bukan disembunyikan.
- **Alternatif:**
  - **`setTimeout` / node-cron in-process** — nol infrastruktur; harganya persis yang di atas: satu
    instance saja, dan restart = kehilangan kerja.
  - **pg-boss / Postgres-as-queue** — tidak perlu Redis, job ikut transaksi DB; harganya: beban tulis
    tambahan di primary yang di `SCALING-1M.md:95-98` justru sudah jadi ceiling pertama.
  - **Kafka** — throughput dan replay terbaik; harganya: tidak ada delayed-job bawaan (dan lifecycle
    di sini murni delayed), plus satu sistem operasional besar baru.
  - **Temporal / Step Functions** — workflow durable dengan retry & versioning bawaan; harganya:
    vendor/infra baru dan model pemrograman yang berbeda total dari `@Processor` Nest.
- **Latihan:** buka `src/deliveries/simulation/` dan hitung berapa job yang di-enqueue satu
  `create()` (`ARCHITECTURE.md` bilang 17; `loadtest/CAPACITY-MODEL.md` menyebut angka itu dibaca
  langsung dari kode, bukan diasumsikan). Buktikan angkanya. Lalu buat delivery, `docker compose stop
  worker`, tunggu 30 detik, `start` lagi — dan catat apakah status tetap maju.

---

## 7. Single-winner CAS: mengganti read-then-write

- **Prasyarat:** #6
- **Anchor:** `src/deliveries/deliveries.service.ts:876-895` — komentar di `cancel()`:
  *"This used to be: read, then three network round-trips of cleanup, then an UNCONDITIONAL status
  write — the only transition in this file without a CAS … a lost race both refunded a delivery that
  had already completed AND overwrote its terminal status with CANCELED."* Pola pengaman
  komplemennya: `src/deliveries/delivery-exceptions.ts:3-33` — status eksepsi **sengaja di luar**
  `STATUS_ORDER` agar CAS maju-monoton tidak bisa memasukinya.
- **Kenapa dipakai di sini:** ada N replica api + M worker. Tidak ada satu proses pun yang boleh
  menganggap hasil `SELECT`-nya masih benar saat ia `UPDATE`. Bentuknya selalu sama:
  `updateMany({ where: { id, status: { in: ALLOWED } }, data: { status: NEXT } })` lalu cek
  `count === 0` → 409. Ini muncul di `cancel`, `adminForceCancel`, `failExceptional`,
  `confirmHandoff`, klaim drone, klaim outbox, dan CAS `nextRunAt` di recurring materializer.
- **Alternatif:**
  - **`SELECT … FOR UPDATE` (pessimistic lock)** — mudah dipahami; harganya: memegang lock melintasi
    network I/O — dan justru itu yang dilarang di `docs/.../operator-audit-log-design.md:121-125`
    (*"Holding a transaction open across that would be a worse defect than the one being fixed"*).
  - **Isolation `SERIALIZABLE`** — benar secara teori tanpa menulis guard manual; harganya:
    serialization failure harus di-retry di aplikasi, dan PgBouncer transaction-pooling di depan
    Postgres membuat asumsi sesi jadi rumit.
  - **Kolom `version` (optimistic locking ala ORM)** — general; harganya: butuh baca dulu untuk tahu
    versinya — sedangkan CAS berbasis `status` tidak perlu baca sama sekali.
  - **Distributed lock di Redis (Redlock)** — lintas-resource; harganya: correctness-nya bergantung
    pada asumsi waktu, sementara CAS di DB benar tanpa asumsi apa pun.
- **Latihan:** tulis test yang menjalankan `cancel()` dan `confirmHandoff()` "bersamaan" terhadap satu
  delivery dengan Prisma mock, dan buktikan hanya satu yang menang dan yang kalah mendapat 409. Lalu
  hapus klausa `status: { in: CANCELABLE_STATUSES }` dan lihat test mana yang mati.

---

## 8. Idempotensi & at-least-once di setiap batas

- **Prasyarat:** #7
- **Anchor:** `src/outbox/outbox.service.ts:25-36` — *"AT-LEAST-ONCE: a handler may run more than
  once … the `OutboxEvent.status` is a LIVENESS optimization, NOT the dedupe authority — the dedupe
  authority is the handler's own idempotency … A re-applied event is therefore a no-op, surfaced here
  as P2002 → treated as success."*
- **Kenapa dipakai di sini:** setiap batas di sistem ini at-least-once — BullMQ retry
  (`attempts: 5`), webhook Stripe (`SCALING-1M.md:260-268`: *"Stripe webhooks are at-least-once and
  can arrive out of order"*), ack drone, telemetry frame. Jadi "exactly-once" tidak dikejar; yang
  dikejar adalah **efek** yang idempoten. Tiga mekanismenya: `jobId` deterministik, unique constraint
  (`idempotencyKey`, partial-unique index satu open-command per delivery), dan CAS (#7). P2002
  diperlakukan sebagai **sukses**, bukan error — ini keputusan, dan diulang di beberapa service.
- **Alternatif:**
  - **Klaim exactly-once di level queue** — tidak ada yang benar-benar menyediakannya melintasi
    proses + DB; mempercayainya berarti bug diam-diam.
  - **Tabel dedupe terpusat** — satu tempat; harganya: satu tabel panas jadi titik contention, dan
    tetap tidak menutup kasus "crash setelah tulis dedupe, sebelum efek".
  - **Dedupe di broker (mis. Kafka idempotent producer)** — bagus untuk duplikasi produsen; harganya:
    tidak membantu duplikasi *konsumen* yang justru masalahnya di sini.
- **Latihan:** cari semua tempat P2002 ditangani: `grep -rn "P2002" src/`. Untuk masing-masing,
  klasifikasikan: apakah P2002 diperlakukan sebagai sukses (idempotensi), sebagai retry
  (`trackingId` collision), atau sebagai 409 ke user? Tulis tabelnya.

---

## 9. i18n non-request-scoped, karena worker tidak punya request

- **Prasyarat:** #6
- **Anchor:** `src/i18n/i18n.service.ts:5-17` — *"Deliberately a plain default-scope singleton (NOT
  request-scoped, NOT nestjs-i18n): the primary surface — delivery notifications — is produced by the
  BullMQ worker (SimulationProcessor), which has NO HTTP request … **Do NOT make this
  request-scoped, and do NOT inject a request-scoped provider into it — that would break the
  worker.**"* Konteks produknya di `ROADMAP.md:67`.
- **Kenapa dipakai di sini:** ini contoh terbaik di repo untuk "keputusan library ditentukan oleh
  topologi, bukan fitur library". `nestjs-i18n` adalah pilihan default ekosistem — dan ditolak karena
  arsitektur worker-tier (#3, #6) membuat `Accept-Language` tidak ada. Locale jadi kolom
  `User.locale` yang di-*resolve* dari `userId`, dan `translate()` jadi fungsi murni
  `(key, locale, params)`. Konsekuensi kedua: error bisnis melempar **key**, bukan kalimat, dan
  diterjemahkan sekali di `AllExceptionsFilter` (boundary-localized).
- **Alternatif:**
  - **`nestjs-i18n` request-scoped** — otomatis membaca header, punya ICU; harganya: provider
    request-scoped menular ke seluruh rantai DI-nya dan tidak bisa dipakai di worker.
  - **Terjemah di klien saja** — server kirim kode, mobile yang menerjemahkan; harganya: push
    notification dikirim server, jadi teksnya harus sudah jadi sebelum sampai perangkat.
  - **ICU MessageFormat lib penuh** — plural/gender benar; harganya: dependency baru, sedangkan yang
    dibutuhkan hanya `{placeholder}` — repo menulis interpolator 8 baris.
- **Latihan:** tambahkan satu key baru ke `src/i18n/catalog/` hanya di `en`, jalankan `npm test`, dan
  temukan test kelengkapan katalog yang gagal. Lalu panggil `translate('key.yang.tidak.ada','id')` di
  REPL/test dan buktikan ia mengembalikan key-nya, bukan melempar — dan jelaskan kenapa itu penting
  bagi worker.

---

## 10. Realtime: WebSocket + Redis pub/sub, dengan polling sebagai backstop

- **Prasyarat:** #3, #6
- **Anchor:** `ARCHITECTURE.md:75-83` — *"the **worker** publishes each position/status change to
  `delivery:<id>:update` … every API instance's `TrackingSubscriber` fans it out to its
  locally-connected clients … This decouples 'who computed the update' from 'who holds the socket.'"*
  Baris `:80` adalah keputusan produknya: *"**Polling coexists.** … WS is purely **additive**, so
  polling stays the source of truth and the backstop on a Redis blip."*
- **Kenapa dipakai di sini:** aplikasi mobile sudah polling `GET /deliveries/:id` tiap 4 detik dan
  meng-animasi marker (`INTEGRATION.md:148`). Menghapus polling berarti perubahan di repo lain
  sekaligus — jadi WS ditambahkan tanpa mengganggu kontrak lama, dan `INTEGRATION.md` menyebutnya
  eksplisit sebagai *"a separate (mobile-repo) task"*. Gateway kedua (`/ws/support`) memakai pola
  yang sama tapi **penerbitnya berbeda tier** (api, bukan worker) — bukti bahwa polanya generalis.
- **Alternatif:**
  - **socket.io + `@socket.io/redis-adapter`** — fitur banyak (rooms, reconnect, fallback);
    harganya: protokolnya sendiri di atas WS, dan `src/main.ts:33-36` mencatat justru menolaknya —
    klien `ws` mereka berbicara `{event,data}` polos, socket.io akan connect tapi tidak pernah
    mengirim frame yang dimengerti.
  - **SSE (Server-Sent Events)** — lebih sederhana, lewat HTTP biasa, auto-reconnect gratis;
    harganya: satu arah — sedangkan chat support butuh client→server.
  - **Sticky session di LB** — tidak perlu pub/sub; harganya: node yang mati membawa semua
    socket-nya, dan autoscaling jadi kasar.
  - **NATS / Kafka sebagai bus fan-out** — ekonomi fan-out terbaik + replay; ditimbang di
    `SCALING-1M.md:329-330` dan **ditunda**: *"a new dependency and at-least-once to reconcile with
    today's fire-and-forget."*
- **Latihan:** jalankan api + worker terpisah, sambungkan dua klien `wscat` ke `ws://localhost:3000/?token=<jwt>`
  pada delivery yang sama, dan buktikan keduanya menerima frame yang dihitung worker. Lalu matikan
  Redis dan catat: apakah polling `GET /deliveries/:id` masih benar? Tulis apa yang hilang dan apa
  yang bertahan.

---

## 11. Read replica: hanya untuk baca yang toleran lag, dengan fallback

- **Prasyarat:** #2
- **Anchor:** `src/prisma/prisma.service.ts:68-95` — *"NEVER route a read that feeds a CAS, is
  compared/incremented, authorizes a write, or is returned right after a write through here — keep
  those on `this`."* Daftar rute yang boleh ada di `ARCHITECTURE.md:92`. Catatan penolakan
  library-nya juga di sana: *"(NOT the Prisma read-replica extension — it clones the datasource URL,
  which a driver-adapter client doesn't carry)."*
- **Kenapa dipakai di sini:** replica adalah trade *consistency* demi *throughput*, dan trade itu
  hanya boleh diambil di tempat yang aman. Repo membuatnya *fail-safe* dua arah: tanpa
  `DATABASE_REPLICA_URL` reader **adalah** primary (dev/test byte-identical), dan blip replica jatuh
  balik ke primary dengan log — *"never a 5xx"*. Ada juga jebakan yang direkam di komentar `:76-79`:
  reader disimpan di field privat, **bukan getter**, karena Prisma client adalah Proxy yang akan
  menangkap `get` apa pun sebagai model delegate.
- **Alternatif:**
  - **`@prisma/extension-read-replicas`** — resmi, satu baris; ditolak karena tidak kompatibel dengan
    driver adapter (`PrismaPg`) yang dipakai untuk mem-*bound* pool.
  - **Routing di pooler (PgBouncer/pgpool)** — transparan ke aplikasi; harganya: pooler tidak tahu
    query mana yang *read-after-write*, jadi ia akan salah pada kasus yang paling berbahaya.
  - **CQRS penuh (read model terpisah)** — skala baca paling jauh; harganya: proyeksi + eventual
    consistency di seluruh domain, jauh melampaui kebutuhan 100k.
- **Latihan:** `grep -rn "readWithFallback" src/ | wc -l`, lalu ambil 5 pemanggil dan nilai satu per
  satu: apakah baca itu benar-benar toleran lag? Cari **satu** yang menurutmu meragukan dan tulis
  argumennya. Bandingkan dengan daftar di `ARCHITECTURE.md:92`.

---

## 12. RANGE partitioning tanpa `pg_partman`/`pg_cron`

- **Prasyarat:** #11
- **Anchor:** `prisma/PARTITIONING.md:57-79` (bagian *"Prisma rules (do not violate)"*) dan
  `ARCHITECTURE.md:94-98` (mekanika copy-swap). Aturan paling keras: *"**NEVER `prisma db push` OR
  `prisma db pull`** … `push` would recreate them as plain tables; `pull` … cannot represent
  `PARTITION BY`."* Penjaganya: `npm run prisma:drift-check` di CI.
- **Kenapa dipakai di sini:** tabel panas (`notifications`, `deliveries` + 8 anak, `flight_frames`,
  `admin_audit_logs`) tumbuh tanpa batas; retensi lewat `DELETE` adalah O(rows), lewat `DROP
  PARTITION` adalah O(1). Tiga masalah nyata yang dipecahkan dan ditulis: (a) PK harus **komposit**
  `@@id([id, createdAt])`, yang membuat `findUnique({where:{id}})` tidak bisa dikompilasi lagi — dan
  itu disebut *fitur*, karena compiler menemukan semua call-site; (b) `UNIQUE(trackingId)` global
  mustahil di tabel terpartisi → lahir `tracking_id_registry` non-partitioned; (c) FK anak harus jadi
  komposit → setiap anak dapat kolom `deliveryCreatedAt`.
- **Alternatif:**
  - **`pg_partman` + `pg_cron`** — matang, standar industri; ditolak karena mengasumsikan ekstensi
    yang tidak ada di banyak managed Postgres — repo memilih rutin plpgsql sendiri
    (`partition_ensure` / `partition_drain_default` / `partition_drop_old`) yang **self-discovering**
    kolom partisinya dari katalog.
  - **TimescaleDB** — chunking + kompresi otomatis, ideal untuk `flight_frames`; harganya: ekstensi
    lagi, dan tidak menyelesaikan masalah PK komposit di sisi Prisma.
  - **Tanpa partisi, retensi lewat `DELETE`** — nol kerumitan skema; harganya: bloat + autovacuum,
    persis pemicu yang disebut di `ARCHITECTURE.md:98` (~50–100M baris).
- **Latihan:** jalankan `npm run prisma:drift-check` (harus *No difference*). Lalu ubah
  `schema.prisma` pada model `Notification` dari `@@id([id, createdAt])` menjadi `id @id`, jalankan
  ulang drift-check, dan baca migration destruktif yang ingin dibuat Prisma. **Kembalikan.** Tulis 3
  kalimat kenapa gate CI ini ada.

---

## 13. Retensi per-tabel: `??`, bukan `||`

- **Prasyarat:** #12
- **Anchor:** `src/partition-maintenance/partition.constants.ts:64-75` — *"A per-table `retainMonths`
  wins over the global default INCLUDING an explicit 0 (never drop) — so `??`, never `||`. That
  single character is the whole difference between 'audit history is never dropped' and 'it is
  dropped whenever somebody tunes telemetry retention'."* Alasan produknya di
  `docs/superpowers/specs/2026-08-02-operator-audit-log-design.md:193-204`.
- **Kenapa dipakai di sini:** ini contoh terkecil sekaligus terjelas tentang *bahaya knob global*.
  Satu-satunya tabel yang volumenya akan memaksa orang menyalakan retensi adalah `flight_frames`;
  menyalakannya akan **diam-diam** ikut menghapus `admin_audit_logs`. Solusinya ditulis sebagai
  *generalization, not a special case*: `PARTITIONED_TABLES` jadi list objek, dan `admin_audit_logs`
  memasang `retainMonths: 0` eksplisit. Jejak kembarnya ada di
  `src/serviceability/airspace.constants.ts` — `Number(env) || 30_000` dinilai salah **dua arah**
  (`0` dibuang, negatif diloloskan) dan diganti fungsi murni `resolveAirspaceCacheTtlMs` dengan 4
  unit test (`AUDIT-LOG.md:2268-2273`).
- **Alternatif:**
  - **Satu knob global saja** — paling sederhana; harganya persis bug di atas.
  - **Cron/job retensi terpisah per tabel** — fleksibel penuh; harganya: N jadwal untuk dipelihara
    dan tidak ada satu tempat yang menjawab "tabel ini disimpan berapa lama?".
  - **Arsip ke cold storage sebelum drop** — tidak ada data yang hilang; harganya: pipeline baru —
    dicatat sebagai sisa pekerjaan (*"managed-PG + cold archival remain"*, `ARCHITECTURE.md:85`).
- **Latihan:** ganti `??` jadi `||` di `retentionFor`, jalankan `npx jest src/partition-maintenance`,
  dan catat test mana yang merah. Lalu tulis satu test **baru** yang gagal dengan `||` tapi lulus
  dengan `??`, tanpa melihat test yang sudah ada.

---

## 14. Audit log operator: allowlist, co-commit, tanpa FK ke aktor

- **Prasyarat:** #7, #8, #12
- **Anchor:** `src/admin/audit/admin-audit.constants.ts:13-23` — *"An **ALLOWLIST**, not a denylist,
  and the difference is load-bearing: a denylist means a field added to a DTO later starts appearing
  in the audit log until somebody remembers to exclude it. This fails closed instead."* Desain
  lengkapnya: `docs/superpowers/specs/2026-08-02-operator-audit-log-design.md:33-38` (tabel
  keputusan) dan `:77-93` (kenapa `actorUserId` **tanpa** foreign key).
- **Kenapa dipakai di sini:** empat keputusan bertumpuk, semuanya beralasan eksplisit:
  1. **Co-commit, bukan best-effort** — *"A best-effort audit row drops exactly when you need it."*
  2. **Semua 11 rute, termasuk 2 yang sudah menyimpan aktornya** — *"Redundancy is the point"*: log
     ini bernilai kalau ia satu-satunya tempat yang menjawab "operator ini melakukan apa".
  3. **Tanpa FK ke `users`** — `onDelete: SetNull` akan *"preserve the row while destroying its
     single most important field"*; GDPR-delete ada di backlog dan tidak boleh menghapus atribusi.
  4. **`actorRole` di-snapshot** — karena `RolesGuard` membaca role segar dari DB tiap request, jadi
     "siapa yang ADMIN saat itu" tidak bisa dijawab dari baris `users` hari ini.
  Yang paling instruktif justru **harga yang diakui**: `AUDIT-LOG.md:1929-1936` mencatat `before`
  pada dua jalur update dibaca **di luar** transaksi, jadi di READ COMMITTED nilainya bisa bukan
  keadaan tepat sebelum tulis — dan menutupnya berarti memegang row lock di setiap update.
- **Alternatif:**
  - **Denylist redaction** — tidak perlu mendaftar field satu per satu; harganya: fail-open pada
    field baru.
  - **Audit asinkron (log shipping / CDC ke warehouse)** — nol biaya di jalur panas; harganya: baris
    audit bisa hilang tepat saat transaksi gagal atau proses mati — yaitu momen yang paling perlu.
  - **Trigger database** — tidak bisa dilewati aplikasi; harganya: tidak tahu *siapa* aktornya
    (koneksi dipakai bersama lewat PgBouncer) dan logikanya pindah ke tempat yang tidak ter-review.
- **Latihan:** tambahkan `AIRSPACE_ZONE_UPDATE` sebuah field baru di allowlist (mis. `notes`), lalu
  jalankan test dan jelaskan kenapa desainnya justru **mengecualikan** `notes` (petunjuk: baris
  `:101-102`, "free text"). Lalu buktikan sifat *fail-closed*-nya: kirim `PATCH /admin/airspace/:id`
  dengan field yang tidak ada di allowlist dan tunjukkan baris audit tidak memuatnya.

---

## 15. Konfigurasi jadi data: "airspace as data"

- **Prasyarat:** #5, #14
- **Anchor:** `docs/superpowers/specs/2026-08-02-airspace-as-data-design.md:24-32` — tabel keputusan
  6 baris (Geometry / Altitude / Failure mode / Caching / Admin surface / Seeding), masing-masing
  dengan kolom *Why*. Baris paling penting: **Seeding** — *"Deleting the constant without seeding
  silently opens the airspace this system currently protects."*
- **Kenapa dipakai di sini:** masalahnya dirumuskan dalam satu kalimat produk:
  *"An emergency TFR on a deploy cycle is not a restriction anybody can rely on"*
  (`AUDIT-LOG.md:1974-1975`). Tiga sub-keputusan yang layak diajarkan:
  - **`DELETE` adalah deaktivasi**, bukan hapus baris — *"A zone that once existed is part of the
    record of why a past delivery was refused."*
  - **Cache menyimpan ROWS, bukan jawaban** (`airspace.service.ts:39-52`): kalau yang di-cache adalah
    hasil filter, zona yang mulai berlaku **karena jam** (TFR yang dijadwalkan) tidak akan aktif
    hingga satu TTL penuh — *"That was the only fail-open window in a service written to fail
    closed."* Commit-nya: `6af2846 fix(airspace): cache the ROWS, not the answer`.
  - **Altitude disimpan tapi TIDAK menggating planning** — karena quote tidak punya altitude. Repo
    menyebut godaannya dengan nama: *"pretending otherwise would be the overstatement pattern this
    phase keeps tripping on."*
- **Alternatif:**
  - **Konstanta di kode (keadaan sebelumnya)** — nol infrastruktur, ter-review; harganya: perubahan
    butuh deploy.
  - **File config + reload** — tanpa tabel; harganya: tidak ada aktor, tidak ada audit trail, dan
    tiap replica bisa punya file berbeda.
  - **Feature-flag/remote-config service** — perubahan instan; harganya: dependency eksternal di
    jalur *safety*, yang sesuai #5 harus fail-closed — artinya service itu down = seluruh armada
    berhenti.
  - **Impor data aeronautika asli (NOTAM/AIP)** — benar-benar benar; secara eksplisit di luar cakupan
    (spec `:179`), registry-nya masih manual.
- **Latihan:** buat zona TFR baru lewat `POST /admin/airspace` dengan `activeFrom` 2 menit ke depan,
  lalu panggil `POST /pricing/estimate` melewati zona itu **sebelum** dan **sesudah** waktu tersebut,
  tanpa restart apa pun. Buktikan perubahannya terjadi karena filter jam, bukan karena cache
  di-invalidate. Lalu ubah cache jadi menyimpan hasil filter dan ulangi — catat apa yang rusak.

---

## 16. Capacity model: mengganti tebakan, dan menandai angka yang belum diukur

- **Prasyarat:** #3, #6
- **Anchor:** `loadtest/CAPACITY-MODEL.md:16-30` — *"Why one load-test number lies"*: p95 global 5,66s
  ternyata **seluruhnya** biaya bcrypt cost-12 di signup; langkah I/O tetap 248–659ms. Dan
  `SCALING-1M.md:10-13`: *"**The numbers in this doc are ILLUSTRATIVE.** Every per-node ceiling …
  is a conservative **placeholder** marked `FILL FROM RUN`."*
- **Kenapa dipakai di sini:** klaim "dirancang untuk 100k" tidak bisa dibuktikan dengan satu angka di
  satu laptop. Metodenya: isolasi tier (`docker-compose.nodes.yml` mem-*bound* CPU/mem tiap replica),
  amortisasi auth (`scenario-io.js` login sekali di `setup()` supaya loop yang diukur bebas bcrypt —
  dengan catatan tegas *"We never lower `BCRYPT_SALT_ROUNDS=12` — that would be a security
  regression"*), lalu proyeksi per-node ke DAU. Dan yang paling penting untuk dipelajari: model itu
  **menandai dirinya sendiri** sebagai ilustratif, serta menyebut apa yang harus diukur dulu
  (pgbench, redis-benchmark, ws soak) sebelum shard count boleh jadi komitmen.
- **Alternatif:**
  - **Satu angka k6** — cepat; harganya persis bagian "why one number lies".
  - **Benchmark di cloud sungguhan** — angka absolut; harganya: biaya + waktu, dan repo memilih
    *hardware-free* sebagai batasan sadar (`ARCHITECTURE.md:194`: *"provable on kind/minikube at $0"*).
  - **Tanpa model, scale saat kepanasan** — nol usaha di muka; harganya: tidak tahu **tier mana yang
    mengikat lebih dulu** — padahal itulah satu-satunya output yang model ini klaim benar.
- **Latihan:** jalankan `node loadtest/capacity-model.mjs --dau=100000` lalu
  `node loadtest/capacity-model-1m.mjs --dau=2000000 --liveSharePct=20 --liveFrameHz=2`. Bandingkan
  tier mana yang mengikat lebih dulu di kedua kasus, lalu turunkan `--dbPrimaryUpsertsPerSec` jadi
  setengahnya dan lihat verdict-nya berubah. Tulis satu paragraf: mana angka yang **diukur** dan mana
  yang **placeholder**?

---

## 17. Sinyal autoscaling: HPA-CPU untuk api, KEDA-antrian untuk worker, KEDA-socket untuk realtime

- **Prasyarat:** #3, #16
- **Anchor:** `k8s/README.md:56-62` — *"**One autoscaler per Deployment.** KEDA creates/owns
  `keda-hpa-drovery-worker` … never also attach a plain HPA to it"* dan *"**KEDA query uses `max()`,
  not `sum()`.** Every replica exports the same [gauge]"*. Alasan tier realtime:
  `SCALING-1M.md:196-205` — *"**not** a CPU HPA — long-lived tracking sockets are mostly idle (1
  frame/5s), so CPU is blind to the real FD/event-loop/memory ceiling, and a create-RPS spike must
  not churn socket-holding nodes (every scale-down mass-disconnects clients)."*
- **Kenapa dipakai di sini:** pelajarannya bukan "pakai KEDA", tapi **"sinyal skala harus mengukur
  hal yang benar-benar habis di tier itu"**. Api: CPU (request pendek, CPU-bound saat bcrypt).
  Worker: kedalaman antrian (kerja tertunda, bukan CPU). Realtime: jumlah socket (FD + memori, CPU
  hampir nol). Ada juga jebakan yang direkam di `SCALING-1M.md:250-252`: pastikan `ScaledObject`
  menghitung `waiting`/`active` dan **bukan** `delayed` — jutaan tick posisi masa depan hidup di
  delayed-set BullMQ, jadi KEDA akan mengikuti backlog simulasi, bukan beban nyata.
- **Alternatif:**
  - **HPA CPU di semua tier** — satu mekanisme; harganya: worker idle saat antrian menumpuk (job
    menunggu Redis, bukan CPU), dan realtime di-*churn* oleh spike yang tidak relevan.
  - **Skala manual** — prediktabel, murah; harganya: gagal tepat saat trafik puncak.
  - **HPA custom-metrics (Prometheus Adapter)** — tanpa komponen KEDA baru; harganya: adapter +
    APIService sendiri, dan KEDA sudah membawa scaler antrian siap pakai.
- **Latihan:** buka `k8s/base/worker-scaledobject.yaml` dan `k8s/base/api-hpa.yaml`. Tuliskan untuk
  masing-masing: metrik apa, ambangnya berapa, dan **skenario apa yang membuat metrik itu bohong**.
  Lalu cek di `observability/alerts.yml` apakah ada alert yang menutupi skenario bohong itu.

---

## 18. Menunda sharding: urutan L1 sebelum L2, dan saga yang dipilih

- **Prasyarat:** #7, #8, #11, #16
- **Anchor:** `SCALING-1M.md:100-121` — *"**L1** — offload the position firehose (biggest payoff,
  near-term) … **Sharding is the *last* lever, not the first.**"* dan blok
  `> **HARD BLOCKER (must resolve first):**` di `:112-116`: `create()`'s `$transaction` menggabungkan
  baris delivery (shard-delivery) dengan wallet/promo/referral (shard-user) — *"landing it and
  flipping `shardCount>1` corrupts balances. This refactor — not the router code — is the real
  Phase-3 work."*
- **Kenapa dipakai di sini:** ini keputusan arsitektur paling dewasa di repo, dan bentuknya:
  **urutan**, bukan teknologi. Temuan model kapasitasnya kontra-intuitif dan dinyatakan terang:
  pada 2M DAU murni-simulasi semuanya masih muat di satu shard DB — yang memaksa shard pertama kali
  adalah **firehose telemetry drone LIVE** (`liveSharePct × liveFrameHz`), bukan DAU mentah. Jadi
  yang dibangun duluan adalah *hot-store* posisi di Redis + checkpoint batch (§3), yang **menunda**
  sharding. Panel desain lalu memilih **debit-first saga** dan menuliskan yang **ditolak** beserta
  alasannya (`:119`):
  - *reserve-then-settle* — jaminan sama tapi state lebih banyak, dan TTL-nya jadi *load-bearing*
    untuk **uang**; race auto-release-vs-settle bisa **under-charge**.
  - *user-home-shard* — menghapus saga sepenuhnya, tapi menukar beban merata dengan **hot-shard
    skew**, dan counter global `promoCode.timesRedeemed` tetap lintas-shard.
  Ada pula daftar **KILLER RISKS** (`:121`) — grace window janitor, id delivery harus dicetak sekali,
  kompensasi harus tanpa syarat + idempoten — yang lebih berharga daripada diagram mana pun.
- **Alternatif:**
  - **Citus / Aurora Limitless / CockroachDB / Spanner** — distribusi transparan, SQL lintas-shard
    tetap jalan; dicatat sebagai *"transparent-distributed path later (if cross-shard reporting SQL
    hurts)"* — harganya: kunci ke platform dan perilaku transaksi yang berbeda.
  - **Shard duluan, benahi transaksi belakangan** — cepat kelihatan "scalable"; harganya dinyatakan
    langsung: saldo rusak.
  - **Geo-sharding duluan** — cocok kalau ada kewajiban residensi data; direkomendasikan **hash
    dulu** (`:281`) sampai residensi benar-benar dituntut.
- **Latihan:** baca §2 dan §3 `SCALING-1M.md`, lalu gambar (di kertas) urutan empat langkah A1→A2→A3
  dari debit-first saga dan tandai, untuk tiap langkah, **titik crash** mana yang meninggalkan
  reservasi yatim dan siapa yang membersihkannya. Cocokkan dengan `src/deliveries/orphan-reaper/`.

---

## 19. Loop perbaikan: AUDIT-PLAN → kerja → AUDIT-LOG → mutation testing

- **Prasyarat:** #1
- **Anchor:** `AUDIT-PLAN.md:62-80` (§1.1 *"The test suite will not catch your mistakes"*) dan
  `AUDIT-PLAN.md:603-643` (§5 protokol log wajib, dengan template 8 bagian). Bukti terkuat §1.1:
  *"1,073 tests passing, all three repos typecheck clean, lint clean — while an entire user-facing
  feature (support tickets) was unreachable and no payment had ever been captured.
  `supportApi.createTicket` has its own passing test and zero call sites."*
- **Kenapa dipakai di sini:** repo ini menolak "tes hijau" sebagai bukti. Gantinya tiga lapis:
  (a) setiap task punya *acceptance criteria* berupa perilaku, bukan coverage; (b) verifikasi manual
  live dicatat (mis. `AUDIT-LOG.md:2179-2186` mencantumkan isi tabel `airspace_zones` sungguhan);
  (c) **mutation testing** sebelum merge — `AUDIT-LOG.md:2069-2078`: 15 mutasi, 15 tertangkap,
  dengan aturan anti-menipu-diri: *"the harness treats a run that executed zero tests as a failure
  rather than a pass"* dan *"Each edit asserts its anchor text occurs exactly once, so a silently-
  unapplied mutation cannot be scored as killed."*
  Tiga hasil mutasi yang layak dibaca (`:2209-2222`) menunjukkan test yang **hijau untuk alasan
  salah** — termasuk kasus di mana 18 test serviceability tetap hijau padahal fixture mengklaim radius
  yang tidak ada di database.
- **Alternatif:**
  - **Issue tracker (Jira/GitHub Issues)** — bisa dicari, punya assignee; harganya: tidak berada di
    dalam repo, tidak ikut di-review bersama diff, dan tidak bisa memuat "keputusan yang tidak boleh
    dibalik diam-diam" berdampingan dengan kodenya.
  - **Gate coverage %** — otomatis; harganya persis §1.1 — coverage tinggi dengan mock yang salah.
  - **Hanya code review manusia** — menangkap desain; harganya: tidak menangkap "test ini akan tetap
    hijau kalau kodenya dibalik", yang justru inti mutation testing.
- **Latihan:** pilih satu file spec, terapkan **satu** mutasi manual (balik sebuah `>` jadi `>=`,
  atau hapus satu klausa `where`), jalankan seluruh file spec-nya (bukan `jest -t`), dan catat apakah
  ada yang merah. Kalau hijau, kamu baru menemukan lubang test — tulis test yang membunuhnya.

---

# Kelas bug berulang (bahan studi kasus terbaik)

Diambil dari pesan commit; masing-masing punya ≥2 kejadian, jadi ini pola, bukan insiden.

| Kelas | Commit contoh | Pelajaran |
|---|---|---|
| **Read-then-write tanpa CAS** | `bb62e31 fix(deliveries): make cancel single-winner and refund both legs` · `0fe820b fix(dispatch): make the claim re-entrant` · `2c7daea fix(simulation): release the claim only on PROOF the transition did not commit` | Snapshot yang kamu baca sudah basi saat kamu menulis. → konsep #7 |
| **Guard/CAS lebih lebar dari query kandidatnya** | `a284465 fix(watchdog): narrow the reap CAS to the watchdog's own candidate set` | Query memilih `IN_TRANSIT`, CAS mengizinkan `AWAITING_HANDOFF` juga → drone yang sedang menunggu penerima ikut di-fail + refund. Dua daftar status harus **satu** sumber. |
| **Cache meracuni kebenaran** | `ad5cc50 fix(geo): never negative-cache a provider failure` · `6af2846 fix(airspace): cache the ROWS, not the answer` | Kegagalan sementara jangan pernah jadi jawaban yang di-cache; dan cache jawaban ≠ cache data. → #15 |
| **Fail-open di tempat yang salah** | `841b8c1 feat(airspace): source no-fly zones from the database, and block on failure` · `dfe4a86 fix(payments): ALLOW_MOCK_PAYMENTS — keyless Stripe + fail-closed webhook` | Kebijakan kegagalan adalah keputusan per-dependency. → #5 |
| **Trust boundary: klien mengirim data yang menentukan uang/keamanan** | `2cfdc0c fix(pricing): price from the server geocode, never caller-supplied coords` · `17edc92 fix(deliveries): take trackingSource and droneId out of the customer's hands` · `961d167 fix(workflows): owner-scope step + QR endpoints (cross-tenant IDOR)` | Field di DTO = field yang bisa dikirim penyerang. |
| **Validasi DTO yang bocor (`null`, batas)** | `c49074c fix(deliveries): bound lat/lng on CreateDeliveryDto` · `2fd23c5 fix(airspace): reject a null on a NOT NULL column` | `@IsOptional()` melewatkan `null`, bukan hanya `undefined` — dicatat sebagai lubang **repo-wide** di `AUDIT-LOG.md:2378-2383`. |
| **Kontrak antar-repo dengan format berbeda** | `3eae8ab fix(deliveries): validate pickupDate/pickupTime shape` (+ `9c1dbf3`, `22e9a40` pada 2 DTO lain) | Mobile mengirim `"Jul 26, 2026"`, backend mem-parse `YYYY-MM-DD`, gagal diam-diam → setiap delivery "terjadwal" terbang **sekarang**. Rantai lengkapnya di `AUDIT-PLAN.md:244-256`. |
| **Kredensial bocor ke log** | `d2440f6 fix(mail): stop logging reset and verification tokens` · `998a25a fix(logging): widen pino redact to cover credential-bearing fields` | Jalur "dev fallback" adalah jalur produksi default kalau provider tidak dikonfigurasi. |
| **Test hijau karena mock, bukan karena benar** | `6345608 fix(audit): assert WHICH client each call site hands the audit service` · `debca23 fix(audit): pin the fleet/promo audit writes the tests let go unverified` · `01a0494 test(airspace): keep the fixture out of dist, loosen the DB check to containment` | `prisma` dan `prisma.txClient` adalah `jest.fn` yang sama → hanya assertion identitas yang bisa melihat perbedaannya. → #19 |
| **Wiring/DI luput, suite tetap hijau** | `b2f0dd8 chore(deliveries): register FlightRecorderService` · `095bee3 test(telemetry): prove the recorder is actually WIRED into ingest` · `src/admin/admin.module.spec.ts` | *"removing `ServiceabilityModule` from `admin.module.ts` compiles clean and leaves **94 green tests over an application that cannot boot**"* (`AUDIT-LOG.md:2219-2226`). |
| **Fixture tanggal absolut = bom waktu** | `1cee4bc fix(airspace): de-fang a hardcoded-date time bomb` · `a4e89e3 fix(airspace): close review round 1 — backwards clock, unpinned boundaries/await, TTL=0` | *"A hardcoded-date fixture is a time bomb: it degrades with no code change at all"* (`AUDIT-LOG.md:2196`). |
| **Shutdown ordering** | `5bdfec4 fix(prisma): disconnect on application shutdown, not module destroy` | `onModuleDestroy` jalan **sebelum** BullMQ drain → setiap deploy membunuh job yang sedang jalan. Komentarnya di `prisma.service.ts:132-145`. |
| **Resource tidak di-*re-arm* setelah blip** | `d068d00 fix(tracking): re-arm pub/sub subscriptions after a Redis blip` · `9f984a3 fix(support): re-arm chat subscriptions after a Redis blip` | Dengan `enableOfflineQueue:false`, SUBSCRIBE gagal hanya dicatat — klien diberi tahu `subscribed` selamanya. |
| **Satu PATCH merusak invariant** | `dcf1a13 fix(admin): a single PATCH could take a protected airport out of force` | Validasi harus atas **nilai hasil merge**, bukan atas DTO. |
| **Dokumen/komentar over-claim** | `8793ca9 docs(audit): correct three untrue claims` · `4650d7c ... correct an alert overclaim` · `2fd23c5 ... pin what comments claimed` · `0e7a650 ... correct the doc's own miscounts` | *"A comment that justifies not writing a class of assertion has to be re-checked whenever the thing it describes changes"* (`AUDIT-LOG.md:1-5` bagian akhir increment 4). |

---

# Urutan belajar yang disarankan

1–2–3 (orientasi & topologi) → 4–5 (dua pola keputusan yang berulang di mana-mana) → 6–7–8
(inti correctness terdistribusi) → 9–10 (konsekuensi topologi ke fitur) → 11–12–13 (lapisan data)
→ 14–15 (governance & config-as-data) → 16–17–18 (skala, dan kenapa ditunda) → 19 (proses).

**Bagian tersulit:** membedakan apa yang **sudah jalan**, apa yang **baru dirancang**, dan apa yang
**sudah dibantah** — karena file yang sama memuat ketiganya, dan bahasanya sama-sama percaya diri.
Keterampilan yang harus dilatih: sebelum mempercayai klaim mana pun, cek (a) penanda statusnya,
(b) bagian `### Left undone / follow-ups` pada increment terkait di `AUDIT-LOG.md`, dan (c) kodenya.
Ini justru keterampilan paling bernilai yang bisa diambil dari repo ini.

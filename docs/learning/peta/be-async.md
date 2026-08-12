# Peta Belajar — `backend:async-and-integrations` (Drovery Backend)

> **Untuk siapa:** frontend dev Ionic React + Capacitor yang sudah paham React/TypeScript dan
> konsumsi REST dari sisi client, tapi belum pernah menulis backend NestJS.
>
> **Inti area ini dalam satu kalimat:** semua hal di backend ini yang **tidak terjadi di dalam
> siklus request→response** — job yang jalan di proses lain, socket yang hidup berjam-jam, pesan
> dari broker MQTT, callback dari Stripe, dan sinyal (metrics/traces/errors) yang membuat semua itu
> bisa dilihat saat rusak.
>
> **Mental model paling berguna dari pengalaman kamu:** di Ionic React kamu punya *satu* proses
> (WebView) yang menangani UI, timer, dan HTTP. Di sini satu `AppModule` yang **sama persis** di-boot
> oleh **empat jenis proses berbeda**, dan env var `PROCESS_ROLE` yang menentukan potongan mana yang
> hidup. Itu ide sentral yang mengikat semua konsep di bawah.

---

## Peta 30 detik: siapa bicara ke siapa

```
Mobile app ──HTTP──> api tier (main.ts, PROCESS_ROLE=api)
     │                    │  enqueue job ──> Redis (BullMQ) ──> worker tier (worker.ts, PROCESS_ROLE=worker)
     │                    │                                          │ hitung update
     └──WebSocket────> realtime tier (main.ts, PROCESS_ROLE=realtime) │
                          ▲                                          │
                          └──── Redis Pub/Sub (delivery:<id>:update) ─┘

Drone ──MQTT ($share/...)──> api tier (ingest)      Stripe ──webhook POST──> api tier
Prometheus ──scrape /metrics──> api :3000 + worker :9091 ──> KEDA autoscale
OTel spans ──OTLP──> collector      Sentry ──> error tracking
```

---

## 1. Seam "real-or-mock" untuk setiap integrasi eksternal

- **Prasyarat:** NestJS module + DI dasar, `ConfigService`.
- **Anchor:**
  - `src/stripe/stripe.service.ts:37-49` — konstruktor memutuskan `isMock` dari ada/tidaknya
    `STRIPE_SECRET_KEY`.
  - `src/mqtt/mqtt.service.ts:46-48` + `:54-62` — `isMock()` dan `onModuleInit` yang langsung
    `return` saat `MQTT_URL` kosong.
  - `src/storage/storage.service.ts:19-21` dan `src/mail/mail.service.ts:82-95` — pola yang sama
    persis untuk object storage dan email.
- **Kenapa dipakai di sini:** dokstring `StripeService` menyebutnya eksplisit sebagai
  *"the codebase's standard integration pattern"* — *"When it is empty (dev/demo), the same methods
  return deterministic fake objects so the whole payment flow is exercisable without keys. Set keys
  in .env to go live — **no code change required**"* (`stripe.service.ts:22-29`). `MqttModule`
  menegaskan sisi operasionalnya: *"Inert unless MQTT_URL is set"* (`mqtt.module.ts:9`), sehingga
  *"the default config + the whole test suite are untouched"* (`mqtt.service.ts:20-21`). Efek
  praktisnya: `npm test` jalan tanpa Stripe, tanpa broker, tanpa S3.
- **Alternatif:**
  - **Dependency injection token + provider berbeda per environment** (`StripeRealService` vs
    `StripeMockService`, dipilih di module factory) — lebih bersih secara OOP, tapi menggandakan
    permukaan yang harus diuji dan membuat unit test harus tahu provider mana yang aktif.
  - **Library HTTP-mock seperti `nock` / `msw`** — bagus untuk test, tapi **tidak menolong saat
    `npm run start:dev` lokal**; developer tetap butuh kunci asli untuk klik-klik flow. Repo ini
    memilih mock yang hidup di runtime, bukan hanya di test.
  - **Testcontainers (broker/DB sungguhan di Docker)** — fidelitas tertinggi, tapi test jadi lambat
    dan butuh Docker di CI. Repo tetap pakai broker asli hanya di `docker-compose.yml` (Mosquitto),
    bukan di unit test.
- **Latihan:** tambahkan seam yang sama untuk provider SMS fiktif. Buat `src/sms/sms.service.ts`
  dengan `get isMock()` dari `config.get('sms.provider')`, daftarkan `sms: { provider: ... }` di
  `src/config/configuration.ts`, lalu tulis spec yang membuktikan tanpa env apa pun `send()` hanya
  mencatat log dan tidak pernah `throw`. Bandingkan hasilmu dengan `mail.service.spec.ts`.

---

## 2. Health check: liveness vs readiness

- **Prasyarat:** NestJS controller dasar.
- **Anchor:**
  - `src/health/health.controller.ts:17-39` — dua endpoint: `GET /health` (liveness) dan
    `GET /health/ready` (readiness, `503` kalau dependensi mati).
  - `src/health/health.service.ts:19-25` — cek DB + Redis **paralel** (`Promise.all`).
  - `src/health/health.controller.ts:9-13` — `@PublicApi()` + `@SkipThrottle()`.
- **Kenapa dipakai di sini:** komentarnya menyatakan alasannya langsung — *"Public + un-throttled so
  orchestrator probes (k8s/load balancers) aren't blocked by auth or rate limits."* Bedanya penting:
  **liveness** hanya menjawab "proses ini hidup?" (kalau gagal, k8s me-*restart* pod), sedangkan
  **readiness** menjawab "boleh dikirimi traffic?" (kalau gagal, k8s hanya menarik pod dari Service —
  tidak restart). Kalau kamu menaruh cek DB di liveness, satu blip Postgres akan me-restart seluruh
  armada — bukan memperbaiki apa pun. `pingDatabase()` sengaja `catch` → `false` (`health.service.ts:27-34`)
  supaya endpoint mengembalikan status terstruktur, bukan melempar stack trace.
- **Alternatif:**
  - **`@nestjs/terminus`** (paket resmi health-check Nest, punya indicator siap pakai untuk Prisma,
    HTTP, disk, memory) — lebih banyak fitur gratis, tapi menambah dependensi + abstraksi untuk dua
    cek yang totalnya 15 baris. Repo memilih tulis tangan.
  - **Satu endpoint `/health` saja** — lebih sederhana, tapi kamu kehilangan pemisahan
    restart-vs-drain di atas; rolling deploy jadi kasar.
  - **Startup probe terpisah (k8s `startupProbe`)** — dipakai kalau boot lama (migrasi). Di sini boot
    cepat sehingga tidak perlu.
- **Latihan:** tambahkan cek MQTT ke readiness **tanpa** membuat readiness gagal saat MQTT sengaja
  dimatikan. Petunjuk: `MqttService.isMock()` harus dianggap "sehat" (transport HTTP masih aktif —
  lihat `mqtt.service.ts:58-61`), hanya `isMock()===false && isConnected()===false` yang layak
  dilaporkan. Lalu tulis spec-nya dan jelaskan di komentar kenapa itu **tidak** boleh mengembalikan
  503 (petunjuk: MQTT di repo ini fail-open, bukan dependensi kritis).

---

## 3. Pemisahan proses: `PROCESS_ROLE` dan worker tersendiri

- **Prasyarat:** #2, pemahaman bahwa satu module graph bisa di-boot dua cara.
- **Anchor:**
  - `src/common/process-role.ts:1-26` — **sumber kebenaran tunggal**. Tiga flag turunan:
    `IS_WORKER_TIER` (`:19`), `IS_HTTP_TIER` (`:22`), `IS_INGEST_TIER` (`:26`).
  - `src/worker.ts:27-34` — `NestFactory.createApplicationContext(AppModule)` (perhatikan:
    **bukan** `NestFactory.create`) → module graph penuh **tanpa** HTTP server.
  - `src/deliveries/deliveries.module.ts:86-97` — provider di-spread secara kondisional:
    `...(RUN_PROCESSOR ? [SimulationProcessor] : [])`,
    `...(IS_HTTP_TIER ? [TrackingGateway, TrackingSubscriber] : [])`,
    `...(IS_INGEST_TIER ? [MqttTelemetrySubscriber, MqttCommandAckSubscriber] : [])`.
  - `src/main.ts:1-3` — `import 'dotenv/config'` **wajib** paling atas, komentarnya menjelaskan:
    *"so flags read at import time (e.g. PROCESS_ROLE in deliveries.module) honor .env"*.
- **Kenapa dipakai di sini:** komentar header di `process-role.ts` menyebut kontraknya:
  *"One Docker image, four roles"* — `api`, `worker`, `realtime`, dan unset (dev = semuanya dalam satu
  proses). Alasan `realtime` dipisah ditulis di `:6-9`: *"a tier that holds hundreds of thousands of
  long-lived sockets scales (KEDA on socket count) independently of the api/worker tiers"*. Dan
  `worker.ts:24-25` menjelaskan sisi ekonominya: *"Scale workers and API instances separately."*
  Kalau semua dalam satu proses, lonjakan job simulasi akan memakan CPU yang seharusnya melayani HTTP.
  Perhatikan juga bahwa flag itu **konstanta module-level** yang dibaca saat import — bukan
  `ConfigService` — karena keputusannya harus terjadi sebelum DI container dibangun.
- **Alternatif:**
  - **Repo/service terpisah untuk worker** (dua codebase, dua image) — batas paling tegas, tapi
    kode domain (Prisma models, `DeliveriesService`, i18n catalog) harus dibagikan lewat package
    internal atau diduplikasi. Repo memilih satu image + satu graph karena `SimulationProcessor`
    memang meng-inject `DeliveriesService`, `NotificationsService`, `DispatchService` (lihat
    `simulation.processor.ts:46-59`).
  - **Nx / Turborepo monorepo dengan multiple Nest apps** — memungkinkan module graph berbeda per
    app, tapi menambah tooling build yang berat untuk keuntungan yang sudah dicapai oleh tiga boolean.
  - **Feature flag lewat `ConfigService` (bukan env yang dibaca saat import)** — lebih "Nest-y", tapi
    tidak bisa: keputusan "provider ini didaftarkan atau tidak" terjadi di dekorator `@Module`, jauh
    sebelum `ConfigService` ada.
- **Latihan:** jalankan dua proses sekaligus dan buktikan pemisahannya.
  ```bash
  PROCESS_ROLE=api npm run start:dev      # terminal 1
  PROCESS_ROLE=worker npm run worker      # terminal 2
  ```
  Buat satu delivery lewat API, lalu perhatikan log: transisi status (`Delivery ... → PICKED_UP`)
  muncul di terminal **worker**, bukan api. Lalu matikan worker dan buat delivery lagi — job
  ter-enqueue tapi tidak pernah maju. Terakhir, tambahkan `console.log` di
  `deliveries.module.ts:44` yang mencetak nilai `RUN_PROCESSOR`, dan konfirmasi nilainya berbeda
  di dua terminal.

---

## 4. BullMQ: job tertunda yang durable (producer ↔ processor)

- **Prasyarat:** #3, Redis sebagai konsep (key-value + struktur data).
- **Anchor:**
  - `src/app.module.ts:130-138` — `BullModule.forRootAsync` membuat koneksi Redis khusus queue.
    Catat komentarnya: *"maxRetriesPerRequest: null is required so queue commands don't error during
    reconnects"*.
  - `src/deliveries/simulation/simulation.service.ts:39-93` — **producer**: `queue.addBulk` dengan
    `delay: stage.delayMs`.
  - `src/deliveries/simulation/simulation.processor.ts:42-43` — **consumer**:
    `@Processor(SIM_QUEUE, { concurrency: SIM_WORKER_CONCURRENCY })` + `extends WorkerHost`.
  - `src/deliveries/simulation/simulation.service.ts:20-28` — `JOB_OPTS`: `attempts: 5`,
    `backoff: exponential`, `removeOnComplete/{age,count}`.
  - `src/deliveries/simulation/simulation.service.ts:30-32` + `:162-174` — `ENQUEUE_TIMEOUT_MS`
    dengan `Promise.race`.
- **Kenapa dipakai di sini:** dokstring `SimulationService` menyatakan masalah yang dipecahkan:
  *"Schedules a delivery's lifecycle as durable, delayed BullMQ jobs in Redis (**instead of in-process
  `setTimeout`**). This survives restarts and lets any worker instance advance any delivery — the
  foundation for horizontal scaling."* Itu jawaban langsung untuk "kenapa tidak `setTimeout` saja",
  yang persis intuisi frontend: `setTimeout` mati bersama proses, dan tidak bisa dipindah ke replica
  lain. `ARCHITECTURE.md:13` mencatat migrasi ini sebagai langkah #1 dari seluruh rencana scaling.
  Timeout enqueue di `:30-32` punya alasan tersendiri: *"the BullMQ offline queue retries forever"* —
  tanpa `Promise.race`, satu Redis yang down akan **menggantung request create delivery**, bukan
  menggagalkannya dengan cepat.
- **Alternatif:**
  - **`setTimeout` / `@nestjs/schedule` in-process** — nol infrastruktur, tapi hilang saat restart
    dan tidak bisa dibagi antar replica. Ini persis yang digantikan.
  - **RabbitMQ / NATS JetStream** — broker sungguhan dengan routing, dead-letter, dan ack semantics
    yang lebih kaya; tapi menambah satu komponen infra lagi sementara Redis **sudah ada** di stack
    ini untuk cache + throttler + pub/sub. BullMQ memakai Redis yang sama.
  - **Kafka** — kalau butuh replay log dan throughput sangat tinggi; berlebihan untuk beban ini, dan
    *delayed jobs* bukan primitif native Kafka (harus disimulasikan).
  - **AWS SQS + EventBridge Scheduler** — managed, tidak perlu urus Redis; tapi mengunci ke cloud
    tertentu dan latensi delayed-delivery lebih kasar. `SCALING-1M.md:249` juga mencatat batas
    BullMQ: *"millions of future position/stage ticks live in BullMQ's delayed set"* — jadi trade-off
    ini disadari dan didokumentasikan, bukan diabaikan.
  - **`pg-boss` (queue di atas Postgres)** — satu datastore lebih sedikit; tapi memindahkan beban
    polling ke DB primary yang di repo ini justru jadi bottleneck utama.
- **Latihan:** ubah `STAGES` di `simulation.constants.ts` supaya `delayMs` jauh lebih besar (mis. 10
  menit), buat delivery, lalu inspeksi Redis langsung:
  ```bash
  redis-cli ZRANGE bull:delivery-simulation:delayed 0 -1 WITHSCORES
  ```
  Kamu akan melihat job masa depan beserta timestamp-nya. Restart worker — job tetap ada. Ini bukti
  konkret "durable" yang tidak akan pernah kamu dapat dari `setTimeout`. Lalu jalankan
  `SimulationService.stopSimulation()` (lewat cancel delivery) dan lihat entri itu hilang.

---

## 5. Idempotency: `jobId` deterministik, `idempotencyKey`, dan CAS monoton

- **Prasyarat:** #4, dasar transaksi DB.
- **Anchor:**
  - `src/deliveries/simulation/simulation.service.ts:69` & `:82` — `jobId: \`${deliveryId}:stage:${i}\``
    dan `:pos:${j}` (deterministik → enqueue dua kali = satu job).
  - `src/deliveries/simulation/simulation.service.ts:133-160` — kasus balik: `deferKickoff` **sengaja
    memakai jobId baru per attempt** (`-kickoff-r2`, `-r3`), dengan alasan tertulis: *"reusing it
    would be deduped against the job currently being processed and the hold would silently become a
    drop."*
  - `src/deliveries/simulation/simulation.processor.ts:371-380` — **CAS di database**:
    `updateMany({ where: { id, status: { in: statusesBefore(stage.status) } } })`, lalu
    `if (count === 0) return;`.
  - `src/wallet/wallet.service.ts:58-75` — CAS untuk uang: `updateMany({ where: { id, creditBalance:
    { gte: amt } } })` → *"concurrent spends can never drive the balance negative"*.
  - `src/wallet/wallet.service.ts:23-24` + `:124`,`:148`,`:192` — `idempotencyKey` unik
    (`refund:<id>`, `exception-refund:<id>`) → retry jadi P2002 → no-op.
  - `src/promo/promo.service.ts:107-116` — raw `UPDATE ... WHERE timesRedeemed < maxRedemptions`.
- **Kenapa dipakai di sini:** komentar `JOB_OPTS` menyatakan hubungan sebab-akibatnya:
  *"Retry transient failures (DB blip, etc.) with backoff. **Handlers are idempotent (deterministic
  jobIds + monotonic CAS), so retries are safe.**"* Artinya: begitu kamu menyalakan retry, kamu
  **wajib** membayar dengan idempotency. Komentar CAS di `simulation.processor.ts:371-375`
  menjelaskan dua manfaat sekaligus: *"(a) skips a delivery canceled/delivered/already-advanced
  concurrently — closing the cancel/resurrection race — and (b) makes a re-run (retry / stalled job
  re-delivery) a no-op instead of a duplicate transition or regression."* Di `promo.service.ts:100-106`
  ada catatan bug nyata yang pernah terjadi: CAS versi lama membandingkan `timesRedeemed` dengan
  **snapshot** hasil validasi, bukan kolomnya sendiri, sehingga *"a concurrently-lowered cap was
  over-redeemed"*.
- **Alternatif:**
  - **Distributed lock (Redlock / `SET NX PX`)** — mencegah dua worker jalan bersamaan, tapi lock
    bisa kedaluwarsa di tengah operasi dan kamu tetap butuh guard di DB. CAS di baris DB itu
    *authoritative* tanpa asumsi waktu.
  - **`SELECT ... FOR UPDATE` (pessimistic lock)** — benar, tapi memegang row lock selama transaksi
    dan lebih mudah deadlock. `updateMany` bersyarat adalah optimistic CAS satu round-trip.
  - **Kolom `version` (optimistic locking ala JPA/TypeORM)** — setara secara semantik; repo memilih
    membandingkan **status domain** langsung, sehingga guard-nya bisa dibaca sebagai aturan bisnis
    (`statusesBefore`, `ADVANCE_FROM`) alih-alih angka buram.
  - **Exactly-once delivery dari broker** — secara praktis tidak ada. Semua sistem di sini
    (BullMQ, MQTT QoS 1, Stripe) adalah **at-least-once**, jadi idempotency bukan opsi.
- **Latihan:** buktikan idempotency itu nyata. Tulis spec baru di
  `src/deliveries/simulation/simulation.processor.spec.ts` yang memanggil `handleStage` **dua kali**
  dengan data job identik terhadap mock Prisma di mana `updateMany` mengembalikan `{count:1}` pada
  panggilan pertama dan `{count:0}` pada kedua — lalu assert bahwa `notificationsService.create`
  hanya dipanggil **sekali**. Setelah itu, hapus sementara guard `if (count === 0) return;` dan lihat
  spec-mu gagal. Itulah nilai satu baris tersebut.

---

## 6. Prometheus metrics: registry, tipe metrik, dan jebakan cardinality

- **Prasyarat:** #4 (untuk queue gauge), #3.
- **Anchor:**
  - `src/metrics/metrics.service.ts:38-40` + `:116` — satu `Registry`, plus
    `collectDefaultMetrics({ prefix: 'drovery_' })`.
  - `src/metrics/metrics.service.ts:118-126` — **Histogram** `drovery_http_request_duration_seconds`
    dengan komentar cardinality: *"Labelled by route TEMPLATE (e.g. /api/v1/deliveries/:id), never
    the raw URL — labelling raw paths is an unbounded-cardinality trap."*
  - `src/metrics/metrics.interceptor.ts:11-17` + `:30-45` — kenapa `res.on('finish')` dan bukan
    `rxjs tap`.
  - `src/metrics/metrics.service.ts:328-369` — **Gauge dengan `collect()` on-scrape** untuk kedalaman
    queue, dibungkus `withTimeout(…, 1000)` (`:17-27`).
  - `src/metrics/metrics.controller.ts:9-20` — `@Res()` tanpa passthrough, alasannya ditulis.
  - `src/worker.ts:36-71` — worker **tanpa** HTTP server tetap menyajikan `/metrics` lewat
    `http.createServer` mentah di port 9091.
  - `src/metrics/metrics.service.ts:98-108` — contoh kejujuran metrik: catatan panjang bahwa
    `airspaceZonesInForce` membaca 0 sebelum cache pernah diisi, jadi alert `== 0` **tidak sah**.
- **Kenapa dipakai di sini:** dokstring `MetricsService:29-37` menyatakan dua keputusan sekaligus —
  *"The queue-depth gauge is collected ON SCRAPE (not on a timer), so it never drifts and costs
  nothing while idle"* dan *"getJobCounts() is queue-global, so every replica exports the SAME value
  — the KEDA worker autoscaler therefore queries with `max()`, not `sum()`"*. Timeout 1 detik punya
  alasan operasional spesifik: *"the BullMQ connection uses maxRetriesPerRequest:null + an offline
  queue, so getJobCounts() **HANGS (doesn't reject)** when Redis is down. Without this race the whole
  /metrics scrape would hang"* (`:345-348`). `metrics.interceptor.ts:11-16` menjelaskan kenapa hook
  `finish` dipilih: `AllExceptionsFilter` menetapkan status code **setelah** stream handler selesai,
  jadi `tap` akan merekam status yang salah.
- **Alternatif:**
  - **StatsD / DogStatsD (push)** — aplikasi mengirim ke agent; enak untuk job berumur pendek, tapi
    butuh agent di setiap node dan kehilangan model "scrape = state saat ini" yang membuat gauge
    `collect()` di atas mungkin.
  - **OpenTelemetry Metrics** (bukan hanya traces) — satu SDK untuk semua sinyal, tapi ekosistem
    exporter/alert masih lebih matang di `prom-client` + Prometheus; repo memakai OTel hanya untuk
    tracing (lihat #16).
  - **`@willsoto/nestjs-prometheus`** — wrapper Nest untuk `prom-client` (decorator + module siap
    pakai); repo menulis `MetricsService` sendiri karena butuh gauge `collect()` kustom dan registry
    yang bisa disajikan dari dua bootstrap berbeda (`main.ts` dan `worker.ts`).
  - **Melabeli metrik dengan `userId`/`deliveryId`** — terlihat berguna, praktiknya membunuh
    Prometheus (satu time series per nilai label). Ini persis "unbounded-cardinality trap" yang
    dilarang komentar di atas.
- **Latihan:** jalankan API, `curl -s localhost:3000/api/v1/metrics | grep drovery_http`. Lalu **rusak
  sengaja**: ubah `metrics.interceptor.ts:31` menjadi `const route = req.originalUrl;`, panggil
  `GET /api/v1/deliveries/<id>` untuk 5 id berbeda, scrape lagi, dan hitung berapa time series baru
  yang muncul. Kembalikan perubahannya. Bonus: tambahkan Counter baru
  `drovery_promo_redemptions_total{result}` di `MetricsService` dan increment-nya dari
  `PromoService.redeemWithinTx` (sukses) serta dari tiap cabang `promoError` (ditolak) — lalu
  pastikan `observability-config.spec.ts` masih hijau (lihat #8, ia akan menolak nama metrik yang
  tidak diemit).

---

## 7. Repeatable job scheduler, kill switch, dan heartbeat gauge

- **Prasyarat:** #4, #6.
- **Anchor:**
  - `src/delivery-watchdog/watchdog.scheduler.ts:49-62` — `queue.upsertJobScheduler(SCHEDULER_ID,
    { every: ... }, { name: REAP_JOB, ... })`.
  - `src/delivery-watchdog/watchdog.scheduler.ts:19-24` — dokstring: idempotent by id + Redis-coordinated.
  - `src/delivery-watchdog/watchdog.scheduler.ts:36-48` — kill switch yang **menghapus** scheduler
    lama, bukan sekadar `return`.
  - `src/delivery-watchdog/watchdog.scheduler.ts:63-65` + `src/metrics/metrics.service.ts:160-170` —
    dua gauge: `watchdogLastScan` (heartbeat) dan `watchdogSchedulerRegistered`.
  - `src/delivery-watchdog/delivery-watchdog.module.ts:11-19` — komentar kenapa scheduler **selalu**
    didaftarkan di worker tier meski kill switch mati.
- **Kenapa dipakai di sini:** dokstring scheduler menjelaskan properti multi-replica-nya:
  *"so N worker replicas + every restart converge on EXACTLY ONE scheduler and exactly one worker
  runs each tick"* — inilah alasan memakai primitif BullMQ, bukan `setInterval` di setiap pod (yang
  akan menjalankan scan N kali). Kill switch bukan sekadar `if`: *"the persisted scheduler survives
  restarts, so a bare return would leave it running"*. Dan gauge-nya bukan hiasan —
  `metrics.service.ts:48-53` menyebut mengapa: *"a silent scheduler/processor death is otherwise
  invisible. last-scan drives `time() - gauge > N`; scheduler-registered drives `max(gauge) == 0`
  (or absent) across the worker fleet."*
- **Alternatif:**
  - **`@nestjs/schedule` (`@Cron`)** — cara paling umum di Nest; masalahnya cron in-process berjalan
    di **setiap** replica, jadi kamu butuh leader election atau lock sendiri. BullMQ scheduler
    menyelesaikannya di Redis.
  - **Kubernetes `CronJob`** — satu pod per tick, terisolasi, tapi boot cold-start Nest penuh setiap
    tick dan membuat interval sub-menit tidak praktis.
  - **`node-cron` + Redlock** — kombinasi manual yang setara; lebih banyak kode dan satu mekanisme
    kedaluwarsa lock lagi untuk di-debug.
  - **pgcron / pg_cron** — job di sisi DB; menghilangkan Redis dari jalur ini tapi memindahkan logika
    bisnis ke SQL.
- **Latihan:** buat scheduler baru bergaya sama untuk membersihkan `Device` yang tidak pernah dipakai.
  Tiru struktur `watchdog.scheduler.ts` (konstanta `*_QUEUE`, `*_ENABLED`, `SCHEDULER_ID`), daftarkan
  di module dengan gate `IS_WORKER_TIER`, tambahkan gauge `schedulerRegistered` + `lastScan` di
  `MetricsService`, lalu buktikan dengan menjalankan **dua** worker sekaligus
  (`PROCESS_ROLE=worker npm run worker` di dua terminal) bahwa scan hanya berjalan sekali per tick.

---

## 8. Dari metrik ke autoscaling & alerting (KEDA, `max()` vs `sum()`)

- **Prasyarat:** #6, #3.
- **Anchor:**
  - `k8s/base/worker-scaledobject.yaml:1-10` — komentar "kenapa Prometheus, bukan KEDA redis scaler".
  - `k8s/base/worker-scaledobject.yaml:51-56` — query: `max(...waiting) + max(...delayed)` dengan
    alasan tertulis.
  - `k8s/base/realtime-scaledobject.yaml:1-5` — scaling tier socket **berdasarkan jumlah socket**,
    bukan CPU.
  - `k8s/base/realtime-scaledobject.yaml:22-26` — `restoreToOriginalReplicaCount: false` khusus tier
    socket.
  - `observability/alerts.yml:46-52` — alert memakai `max()` yang **sama** dengan sinyal KEDA.
  - `src/metrics/observability-config.spec.ts:1-10` + `:38-60` — spec yang mem-*parse* alerts.yml dan
    dashboard Grafana, lalu menolak nama metrik/label yang tidak pernah diemit aplikasi.
- **Kenapa dipakai di sini:** komentar `worker-scaledobject.yaml:3-7` menerangkan bug yang dihindari:
  KEDA punya scaler Redis native, tapi *"BullMQ keeps DELAYED jobs in a sorted set ... KEDA's redis
  `listLength` scaler does LLEN on the list and is **blind to the delayed backlog** — which is the
  majority of this queue."* Jadi metrik aplikasi dipilih justru karena tahu bentuk data internal
  BullMQ. `max()` vs `sum()` bukan selera: *"every replica exports the same queue-global gauge, so
  `sum()` over N pods would multiply the backlog by the pod count"* — kesalahan ini akan membuat
  autoscaler naik tak terkendali. Untuk tier realtime alasannya beda lagi: *"Long-lived tracking
  sockets are mostly idle (≈1 frame/5s), so a CPU HPA is blind to the real FD/event-loop/memory
  ceiling"*, dan setiap scale-down *"mass-disconnects clients"* — makanya
  `stabilizationWindowSeconds: 600` dan turun 1 pod per 120 detik.
- **Alternatif:**
  - **HPA on CPU** (dipakai untuk tier `api`, `k8s/base/api-hpa.yaml`) — cocok untuk beban
    request-bound; salah total untuk worker (job tertunda tidak memakai CPU sampai jatuh tempo) dan
    untuk socket tier (koneksi idle).
  - **KEDA redis scaler native** — nol dependensi Prometheus, tapi buta terhadap `delayed` set
    (alasan di atas).
  - **Scaling manual / fixed replicas** — paling murah secara operasional, dan `fallback.replicas: 3`
    di file itu justru versi degraded dari strategi ini saat Prometheus tidak terjangkau.
  - **Datadog/CloudWatch sebagai sumber metrik KEDA** — managed, tapi mengunci vendor dan menambah
    latensi query ke jalur keputusan autoscaling.
- **Latihan:** jalankan stack observability lokal —
  `docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile observability up` —
  buka Prometheus di `:9090`, jalankan query dari `worker-scaledobject.yaml:55-56`, lalu buat 200
  delivery dengan skrip k6 di `load/`. Amati nilainya naik. Setelah itu ubah query jadi `sum(...)`
  dan jalankan `--scale worker=3`: kamu akan melihat angka backlog **tiga kali lipat** dari kenyataan.
  Itu bug autoscaler yang komentar tadi cegah. Terakhir, tambahkan alert baru di `observability/alerts.yml`
  untuk `drovery_mqtt_connected == 0` dan jalankan `npx jest observability-config` — perhatikan spec
  itu memaksamu memakai nama metrik yang benar-benar ada.

---

## 9. Stripe webhook (1/2): raw body & verifikasi signature

- **Prasyarat:** #1, dasar HTTP body parsing.
- **Anchor:**
  - `src/main.ts:22-28` — `NestFactory.create(AppModule, { rawBody: true })`, komentar:
    *"rawBody: true preserves the unparsed request body so Stripe webhook signatures can be verified
    (req.rawBody)."*
  - `src/payments/webhook.controller.ts:30-43` — `@Req() req: RawBodyRequest<Request>` +
    `@Headers('stripe-signature')`, lalu `constructEvent` di dalam `try/catch` → `BadRequestException`.
  - `src/stripe/stripe.service.ts:167-195` — `constructEvent` dengan **dua** guard fail-closed.
  - `src/payments/webhook.controller.ts:27` — `@PublicApi()` (endpoint ini tidak punya JWT).
- **Kenapa dipakai di sini:** Stripe menandatangani **byte mentah**, bukan objek hasil `JSON.parse`.
  Sekali body di-parse dan di-serialize ulang, urutan key/spacing bisa berubah dan HMAC tidak cocok
  lagi — makanya flag `rawBody` harus dinyalakan di bootstrap, bukan per-route. Dua guard di
  `stripe.service.ts` menyatakan filosofi keamanannya dengan gamblang: dalam mock mode webhook
  **ditolak**, karena *"otherwise the public endpoint would fail OPEN and let a forged event mutate
  payment state"* (`:169-171`); dan bila `STRIPE_WEBHOOK_SECRET` kosong, *"Never verify against an
  empty secret — that would silently accept any payload. Fail closed"* (`:182-184`). Ingat: endpoint
  ini `@PublicApi()` — satu-satunya yang membuktikan pengirimnya Stripe adalah signature itu.
- **Alternatif:**
  - **Middleware `express.raw({ type: 'application/json' })` khusus path webhook** — cara klasik di
    Express murni; di Nest `rawBody: true` lebih ringkas dan tidak mengubah parsing route lain.
  - **Mempercayai IP allowlist Stripe** — rapuh (daftar IP berubah) dan tidak membuktikan integritas
    payload; signature membuktikan keduanya sekaligus.
  - **Polling Stripe API alih-alih webhook** — tidak perlu endpoint publik sama sekali, tapi latensi
    tinggi dan boros rate limit.
  - **Verifikasi signature di API gateway/edge (mis. Cloudflare Worker)** — memindahkan beban ke edge,
    tapi rahasianya jadi tersebar di dua tempat dan aplikasi kehilangan kemampuan mengujinya lokal.
- **Latihan:** kirim webhook palsu dan pastikan ditolak:
  ```bash
  curl -i -X POST localhost:3000/api/v1/payments/webhook \
    -H 'content-type: application/json' -H 'stripe-signature: t=1,v1=deadbeef' \
    -d '{"id":"evt_fake","type":"payment_intent.succeeded","data":{"object":{"id":"pi_x"}}}'
  ```
  Kamu harus dapat `400`. Lalu buka `src/payments/webhook.controller.spec.ts:44-56` untuk melihat
  perilaku itu dikunci sebagai test. Tantangan: coba hapus `rawBody: true` dari `main.ts` dan
  jelaskan (dengan menelusuri `webhook.controller.ts:35`) kenapa endpoint tetap "jalan" secara
  fungsional tapi **tidak lagi aman** di mode non-mock.

---

## 10. Stripe webhook (2/2): at-least-once, out-of-order, dan ledger idempotency

- **Prasyarat:** #9, #5.
- **Anchor:**
  - `src/payments/payments.service.ts:21-40` — tabel `ADVANCE_FROM`: status sebelumnya yang **boleh**
    berpindah ke status target.
  - `src/payments/payments.service.ts:204-219` — `applyStatus` = `updateMany` dengan
    `status: { in: ADVANCE_FROM[target] }`.
  - `src/payments/payments.service.ts:220-248` — insert `webhookEvent` + update status **dalam satu
    `$transaction`**, `P2002` ⇒ `{ received: true, duplicate: true }`.
  - `prisma/schema.prisma:613-624` — model `WebhookEvent`, `id` = Stripe event id sebagai PK.
  - `SCALING-1M.md:261-270` — catatan audit yang mendefinisikan bug ini sebelum diperbaiki.
- **Kenapa dipakai di sini:** ini contoh terbaik di repo tentang "kenapa" yang terdokumentasi.
  `SCALING-1M.md:261` mencatat temuannya: *"`handleWebhookEvent()` ignores `event.id` and does a blind
  `payment.updateMany(...)`. Stripe webhooks are **at-least-once and can arrive out of order**: a
  re-delivered `processing` after `succeeded` regresses a COMPLETED payment, and a redelivered
  `payment_failed` can flip COMPLETED→FAILED and **trigger an erroneous refund**."* Perbaikannya
  persis apa yang sekarang ada di kode. Dua mekanisme, bukan satu:
  1. **Dedupe** — event id sebagai PK; redelivery menabrak unique constraint.
  2. **Monotonic CAS** — walau dedupe gagal (mis. mock tanpa event id), `ADVANCE_FROM` membuat event
     basi cocok dengan **0 baris**. Perhatikan `REFUNDED: []` di `:39`: *"only the refund flow sets
     REFUNDED — never a webhook"*.
  Yang halus dan patut ditiru: kedua tulisan berada di **transaksi yang sama**, dengan alasan di
  `:222-224` — *"so the event is marked processed only once the update commits, and a crash between
  the two re-processes on Stripe's redelivery instead of silently dropping the update."* Kalau kamu
  insert ledger duluan di transaksi terpisah, crash sesudahnya = pembayaran hilang selamanya.
- **Alternatif:**
  - **Cache dedupe di Redis (`SET NX EX 24h` pada event id)** — lebih cepat dan otomatis kedaluwarsa,
    tapi tidak bisa co-commit dengan tulisan status di Postgres — jendela crash tetap terbuka.
  - **Hanya mengandalkan CAS monoton (tanpa ledger)** — sudah cukup untuk *status* pembayaran, tapi
    gagal untuk efek samping non-idempoten (kirim email, kredit wallet). Ledger memberi satu titik
    "event ini sudah pernah diproses".
  - **Menyimpan `event.created` dan menolak yang lebih tua** — menangani ordering tapi bukan
    duplikasi, dan clock skew antar event bisa menipu.
  - **Antrekan webhook ke queue lalu proses async** (`202 Accepted` cepat) — bagus untuk handler
    berat; di sini handler-nya satu UPDATE, jadi menambah hop hanya menambah mode kegagalan.
- **Latihan:** simulasikan redelivery dan reorder. Di `src/payments/payments.service.spec.ts`,
  tambahkan test: (a) panggil `handleWebhookEvent` dua kali dengan `id: 'evt_1'` yang sama dan assert
  panggilan kedua mengembalikan `{ received: true, duplicate: true }`; (b) kirim
  `payment_intent.succeeded` lalu `payment_intent.processing` dengan id event berbeda, dan assert
  status akhir tetap `COMPLETED` (petunjuk: `ADVANCE_FROM[PROCESSING]` hanya berisi `PENDING`).
  Lalu hapus sementara `status: { in: ADVANCE_FROM[target] }` dari `where` dan lihat test (b) gagal.

---

## 11. Fan-out push notification: fire-and-forget yang benar

- **Prasyarat:** #1, #5.
- **Anchor:**
  - `src/notifications/notifications.service.ts:115-131` — baris in-app **selalu** dibuat; push
    dikirim `void this.maybeSendPush(...)` (sengaja tidak di-`await`).
  - `src/notifications/notifications.service.ts:11-13` — `EXPO_PUSH_CHUNK_SIZE = 100` dengan alasan:
    *"Expo HARD-rejects a push request carrying more than 100 messages"*.
  - `src/notifications/notifications.service.ts:277-312` — loop chunking + parsing ticket.
  - `src/notifications/notifications.service.ts:339-358` — `reapDeadDevices` untuk token
    `DeviceNotRegistered`.
  - `src/notifications/notifications.service.ts:212-233` — `currentServiceHour()` memakai
    `Intl.DateTimeFormat` dengan timezone terkonfigurasi.
  - `src/deliveries/simulation/simulation.processor.ts:403-424` — pemanggilnya di worker, dibungkus
    `this.safe(...)`.
- **Kenapa dipakai di sini:** komentar `:125-126` menetapkan kontraknya: *"Fan out as a real push,
  subject to the user's preferences + quiet hours (fire-and-forget; a failed/absent/suppressed push
  never breaks creation)."* Ini pola penting: **notifikasi adalah efek samping, bukan bagian dari
  kebenaran transaksi**. Di worker, `safe()` memperkuatnya (`simulation.processor.ts:459-465`) —
  komentarnya menjelaskan risikonya kalau tidak: *"a transient failure must not fail the
  already-applied transition (which would skip on retry via the CAS above)"*. Perhatikan hubungan ke
  #5: karena CAS sudah commit, retry job **tidak** akan mengulang transisi — jadi error yang lolos
  ke atas akan menghilangkan efek samping selamanya. Quiet hours dievaluasi di timezone layanan,
  bukan UTC container, dengan alasan konkret di `:213-216`: *"evaluating them in UTC would shift
  every Indonesian user's window by ~7 hours"* (`NOTIFICATIONS_TZ` default `Asia/Jakarta`).
- **Alternatif:**
  - **Queue push khusus (KEDA-scaled `push` queue)** — inilah rekomendasi `SCALING-1M.md:271`:
    *"move push to a dedicated KEDA-scaled push queue"*. Lebih tahan lonjakan dan bisa retry
    per-device, tapi satu queue + processor lagi untuk dirawat. Repo belum melakukannya — ini gap
    yang **disadari dan dicatat**, contoh bagus soal trade-off bertahap.
  - **FCM / APNs langsung** — menghilangkan perantara Expo dan limit ~600 notif/s, tapi kamu harus
    urus sertifikat APNs, service account FCM, dan dua format payload.
  - **`await` push di dalam transaksi delivery** — menjamin urutan, tapi mengikat latensi HTTP
    Expo ke transaksi DB: satu Expo lambat = row lock lama = incident.
  - **Outbox pattern untuk push** — repo sudah punya infrastrukturnya (`prisma/schema.prisma:626-640`,
    `src/outbox/`) untuk referral reward; menerapkannya ke push memberi at-least-once yang durable
    dengan biaya satu baris DB per notifikasi.
- **Latihan:** buat pengiriman push observable. Tambahkan Counter
  `drovery_push_sent_total{result}` (`ok` / `failed` / `suppressed` / `dead_token`) di
  `MetricsService`, increment di empat titik di `NotificationsService`, lalu tulis spec yang
  memalsukan `global.fetch` agar mengembalikan tiket `DeviceNotRegistered` dan assert (a) counter
  `dead_token` naik dan (b) `prisma.device.deleteMany` dipanggil. Bonus: tulis spec untuk
  `inQuietHours` yang membuktikan window wrap-around `22 → 7` bekerja pada jam 23 dan jam 3.

---

## 12. WebSocket gateway dengan raw `ws` (kenapa bukan socket.io)

- **Prasyarat:** #3.
- **Anchor:**
  - `src/main.ts:33-36` — **inilah jawaban pertanyaannya**:
    ```ts
    // Use the raw 'ws' adapter for the tracking gateway. Without this, Nest would
    // default to socket.io (also installed), which doesn't speak the {event,data}
    // protocol our ws clients use — they'd connect but never receive frames.
    app.useWebSocketAdapter(new WsAdapter(app));
    ```
  - `src/deliveries/tracking/tracking.gateway.ts:29-43` — `@WebSocketGateway()` (path default `/`)
    + dokstring *"('ws', not socket.io — main.ts installs WsAdapter)"*.
  - `src/support/chat/support-chat.gateway.ts:54` — `@WebSocketGateway({ path: '/ws/support' })`,
    dua gateway hidup berdampingan.
  - `src/deliveries/tracking/tracking.gateway.ts:75-97` — auth di **handshake**: JWT di query string,
    `client.close(1008, 'Unauthorized')`.
  - `src/support/chat/support-chat.gateway.ts:99` — detail race: cek `readyState !== OPEN` sebelum
    `metrics.inc()` supaya gauge tidak bocor.
  - `src/support/chat/support-chat.gateway.ts:102-104` — role di-resolve **sekali** per koneksi.
- **Kenapa dipakai di sini:** ada tiga alasan yang bisa dibuktikan dari kode/docs.
  1. **Protokol** — komentar `main.ts:33-35` di atas: klien mobile berbicara `{event, data}` JSON
     polos; socket.io punya framing/handshake sendiri (`Engine.IO`) sehingga klien `ws` biasa tidak
     bisa bicara dengannya. Keduanya terpasang di `package.json` (`@nestjs/platform-ws` **dan**
     `@nestjs/platform-socket.io`), jadi ini pilihan sadar, bukan keterbatasan.
  2. **Berat per-koneksi** — tier `realtime` dirancang menahan puluhan ribu socket per pod
     (`realtime-scaledobject.yaml:46` menyebut `threshold: '20000'` sockets per replica). `ws` adalah
     lapisan tipis di atas protokol WebSocket; socket.io menambah state per-koneksi, heartbeat, dan
     buffer sendiri.
  3. **Scaling di-handle di lapisan lain** — nilai jual utama socket.io (adapter Redis untuk
     broadcast antar node) tidak dibutuhkan, karena repo sudah punya mekanisme fan-out sendiri lewat
     Redis Pub/Sub (#13) yang juga dipakai untuk MQTT dan worker.
  Soal `path`: `support-chat.gateway.ts:39-42` menjelaskan bahwa `WsAdapter` merutekan upgrade
  berdasarkan pathname persis, *"so it coexists with the tracking gateway at '/'"*. Soal auth:
  komentar di `tracking.gateway.ts:36-38` memberi alasan token ada di query — *"browsers can't set
  WS headers"* — dan `app.module.ts:112-118` memasang serializer pino untuk **menyensor `?token=`
  dari log**, konsekuensi yang harus ikut dipikirkan.
- **Alternatif:**
  - **socket.io** — dapat auto-reconnect, room, acknowledgement, dan fallback HTTP long-polling
    **gratis** (berguna kalau ada proxy korporat yang memblokir upgrade WS). Harganya: klien wajib
    memakai client socket.io (tidak bisa `new WebSocket()` biasa), overhead memori per koneksi lebih
    besar, dan versi client/server harus cocok.
  - **Server-Sent Events (SSE)** — satu arah server→client, jauh lebih sederhana, lolos proxy dan
    reconnect otomatis by spec. Cocok untuk *tracking* (yang memang satu arah), tapi tidak untuk
    *support chat* (butuh dua arah). Repo butuh keduanya di satu mekanisme.
  - **Long polling** — sudah ada sebagai backstop (`ARCHITECTURE.md` menyebut *"polling kept as
    backstop"*), sangat tahan banting tapi boros dan latensinya kasar.
  - **µWebSockets.js** — jauh lebih efisien per socket (C++), tapi keluar dari abstraksi
    `@nestjs/websockets` dan menambah binary native ke image.
- **Latihan:** sambungkan klien mentah, tanpa library:
  ```bash
  npx wscat -c "ws://localhost:3000/?token=<JWT>"
  > {"event":"subscribe","data":{"deliveryId":"<id>"}}
  ```
  Kamu akan menerima `{"event":"subscribed", ...}` lalu aliran `tracking:update`. Lalu coba tanpa
  `?token=` — koneksi ditutup dengan kode `1008`. Setelah itu **hapus** `app.useWebSocketAdapter(new
  WsAdapter(app))` dari `main.ts`, restart, dan ulangi: `wscat` akan gagal handshake. Itu demonstrasi
  langsung dari komentar di `main.ts:33-35`. (Kembalikan setelahnya.) Bonus: sambungkan ke
  `ws://localhost:3000/ws/support?token=<JWT>` dan buktikan dua gateway benar-benar terpisah per path.

---

## 13. Fan-out lintas replica dengan Redis Pub/Sub (+ mode `sharded`)

- **Prasyarat:** #12, #3.
- **Anchor:**
  - `src/deliveries/tracking/tracking.publisher.ts:33-39` — publisher tinggal di **worker**:
    *"the worker has no WS server, so it can't deliver to clients directly."*
  - `src/support/chat/support-chat.publisher.ts:56-57` + `src/deliveries/tracking/tracking.publisher.ts:30-31`
    — nama channel sebagai **satu sumber kebenaran** (`supportChatChannel`, `trackingChannel`).
  - `src/support/chat/support-chat.subscriber.ts:32-38` — koneksi ioredis **terdedikasi** untuk
    subscribe, subscribe/unsubscribe dinamis per ticket.
  - `src/support/chat/support-chat.gateway.ts:79-85` — bridging tanpa DI cycle:
    `subscriber.onUpdate(handler)` alih-alih subscriber meng-import gateway.
  - `src/support/chat/support-chat.subscriber.ts:43-57` + `:117-127` — set `desired` + `rearmAll()`
    pada event `'ready'`.
  - `src/common/pubsub/pubsub-transport.ts:4-24` — dokumentasi `standard` vs `sharded`.
  - `src/common/pubsub/pubsub-transport.ts:41-46` — `pubSubMessageEvent`: `'message'` vs `'smessage'`.
- **Kenapa dipakai di sini:** ini jawaban untuk masalah paling nyata dari WebSocket multi-replica:
  *update dihitung di proses A, socket-nya dipegang proses B*. Dokstring `SupportChatGateway:44-48`
  menyatakannya: *"a message accepted on any api replica is persisted then published to Redis ...
  every replica's SupportChatSubscriber fans it out to its locally-connected clients — so a future
  agent on replica B reaches a user on replica A."*
  Tiga detail yang layak dipelajari:
  1. **Koneksi subscribe harus terpisah.** Sekali koneksi Redis masuk mode subscribe, ia tidak bisa
     menjalankan perintah biasa — makanya publisher dan subscriber punya `new Redis(...)` sendiri.
  2. **`rearmAll()` menutup bug nyata.** Dokstring `desired` (`support-chat.subscriber.ts:43-56`)
     menceritakan insidennya: karena `enableOfflineQueue:false`, SUBSCRIBE saat Redis tak terjangkau
     langsung reject; gateway sudah menjawab `subscribed`, dan tidak ada yang retry — *"One blink of
     Redis silently deafened those clients for the life of their socket."* Solusinya "simpan niat,
     re-arm saat reconnect" — pola yang **sama** dengan `MqttService` (#15).
  3. **Batas skala Pub/Sub klasik.** `pubsub-transport.ts:12-16`: di Redis Cluster, PUBLISH klasik
     *"does NOT shard: every PUBLISH is propagated to EVERY node ... pub/sub throughput is capped by
     a single node"*. Mode `sharded` (`SPUBLISH`/`SSUBSCRIBE`, Redis 7+) merutekan per hash slot.
     Peringatan penting di `:21-23`: publisher dan subscriber **wajib** sepakat mode — pesan
     `SPUBLISH` tidak pernah sampai ke `SUBSCRIBE` klasik.
- **Alternatif:**
  - **socket.io Redis adapter** — memberi fan-out ini "gratis", tapi mengunci ke socket.io (lihat #12)
    dan menyembunyikan mekanismenya sehingga mode sharded tidak bisa dipilih.
  - **NATS** — pub/sub yang memang dirancang untuk ini, sharding dan backpressure jauh lebih baik;
    biayanya satu sistem baru. `SCALING-1M.md:302` menyebutnya sebagai opsi: *"Flip
    `REDIS_PUBSUB_MODE=sharded` ... **or move to a broker**"*.
  - **Sticky session / consistent hashing di load balancer** (semua socket satu delivery ke pod yang
    sama) — menghapus kebutuhan fan-out, tapi membuat tier tidak lagi stateless dan scale-down jadi
    menyakitkan.
  - **Postgres `LISTEN/NOTIFY`** — nol infra baru, tapi payload dibatasi 8 KB dan setiap notifikasi
    membebani DB primary — datastore yang justru paling ingin dilindungi di repo ini.
- **Latihan:** buktikan fan-out lintas proses. Jalankan `--scale api=2` lewat docker-compose (atau dua
  `npm run start:dev` di port berbeda + satu worker), sambungkan `wscat` ke **api #1**, subscribe ke
  sebuah delivery, lalu pastikan update yang dihitung worker tetap sampai. Kemudian pantau langsung:
  ```bash
  redis-cli PSUBSCRIBE 'delivery:*:update'
  ```
  Lalu ujilah `rearmAll()`: subscribe lewat WS, hentikan Redis (`docker compose stop redis`),
  nyalakan lagi, dan konfirmasi log `"redis ready — re-arming N subscription(s)"` muncul dan frame
  kembali mengalir. Terakhir set `REDIS_PUBSUB_MODE=sharded` **hanya di worker** dan amati fan-out
  berhenti total — demonstrasi hidup dari peringatan "UNIFORM CONFIG".

---

## 14. Backpressure & graceful drain di tier socket

- **Prasyarat:** #12, #13, #6.
- **Anchor:**
  - `src/deliveries/tracking/tracking.gateway.ts:168-191` — `deliverToLocalClients`: cek
    `client.bufferedAmount > WS_MAX_BUFFERED_BYTES` → `metrics.wsDroppedFrames.inc()` + `continue`.
  - `src/deliveries/tracking/tracking.gateway.ts:172-176` — aturan yang **tidak boleh** dilanggar:
    frame berisi `status` tidak pernah di-drop.
  - `src/deliveries/tracking/realtime.constants.ts:13-20` — `WS_MAX_BUFFERED_BYTES` default 1 MiB.
  - `src/deliveries/tracking/realtime.constants.ts:4-11` — `POSITION_PUSH_HZ` (coalescing), default
    0 = pass-through.
  - `src/deliveries/tracking/tracking.gateway.ts:109-123` &
    `src/support/chat/support-chat.gateway.ts:123-136` — `onApplicationShutdown` mengirim
    `close(1001, 'server draining')`.
  - `src/metrics/metrics.service.ts:45-47` — gauge `wsDroppedFrames` dan interpretasinya.
- **Kenapa dipakai di sini:** ini konsep yang jarang muncul di dunia frontend tapi menentukan hidup
  matinya socket tier. Komentar `:181-183` menjelaskan mekanikanya: *"drop a POSITION frame to a
  socket whose send buffer is already backed up (a slow client), rather than growing it unbounded
  toward an OOM."* Klien di jaringan 3G yang lambat tidak bisa menyerap 1 frame/detik; tanpa guard,
  Node akan menumpuk buffer sampai heap habis — dan yang mati bukan klien itu, tapi **pod** beserta
  20.000 socket lainnya. Yang lebih halus adalah pengecualiannya: *"A STATUS transition is NEVER
  dropped: it's recoverable only via a poll, and a terminal status FREEZES position so no later
  frame supersedes it."* Inilah bedanya data lossy (posisi — frame berikutnya menggantikan) dan
  data non-lossy (status — tidak ada yang menggantikan). Untuk drain, komentar
  `tracking.gateway.ts:110-113` menjelaskan kenapa `1001` dan bukan sekadar mati: klien akan
  reconnect rapi *"instead of a 1006 abnormal closure + a **thundering-herd** reconnect"* — dan itu
  berpasangan dengan `restoreToOriginalReplicaCount: false` di `realtime-scaledobject.yaml:22-26`.
- **Alternatif:**
  - **Tutup socket klien lambat** (bukan drop frame) — melindungi memori dengan lebih tegas, tapi
    menghukum pengguna yang jaringannya jelek; drop frame posisi tidak terasa di UI karena frame
    berikutnya datang 1 detik lagi.
  - **Antrean per-klien dengan batas ukuran** — kontrol lebih halus (bisa prioritas), tapi kamu
    menulis ulang apa yang `bufferedAmount` sudah beritahu gratis.
  - **Sampling/coalescing di sisi publisher** — sudah tersedia lewat `POSITION_PUSH_HZ`
    (`PositionCoalescer`); menurunkan beban **bus** Redis, sementara backpressure menurunkan beban
    **socket**. Keduanya menyelesaikan masalah berbeda dan repo menyediakan dua-duanya, default OFF.
  - **Protokol dengan flow control bawaan (gRPC streaming, HTTP/3)** — backpressure jadi urusan
    transport, tapi klien mobile harus ganti stack.
- **Latihan:** paksa backpressure terjadi. Set `WS_MAX_BUFFERED_BYTES=1024` (1 KB) dan
  `POSITION_PUSH_HZ=0`, sambungkan klien lalu **jangan baca socket** (di Node: buat koneksi `ws` dan
  `socket.pause()`), jalankan simulasi, lalu scrape `/metrics` dan lihat
  `drovery_ws_dropped_frames_total` naik. Verifikasi juga bahwa frame `status` **tetap** sampai.
  Lalu kirim `SIGTERM` ke proses api dan konfirmasi klienmu menerima close code `1001`, bukan `1006`.

---

## 15. MQTT sebagai transport kedua + MQTT5 shared subscriptions (`$share`)

- **Prasyarat:** #1, #3, #6.
- **Anchor:**
  - `src/mqtt/mqtt.constants.ts:15-18` — inti konsepnya:
    ```ts
    /** Wrap a filter as an MQTT5 shared subscription so the broker delivers each message to
     * exactly ONE member of the group (one api replica), not every subscriber. */
    export const sharedFilter = (group, filter) => `$share/${group}/${filter}`;
    ```
  - `src/mqtt/mqtt.service.ts:109-117` — `armSubscription`: subscribe ke `sub` yang mungkin
    `$share`-wrapped, `{ qos: 1 }`.
  - `src/mqtt/mqtt.service.ts:35-36` + `:145-159` — **bare filter** disimpan untuk dispatch;
    `topicMatches` (`:161-174`) mencocokkan topik masuk dengan filter tanpa prefix `$share`.
  - `src/mqtt/mqtt.service.ts:83-89` — re-arm setiap subscription pada event `'connect'`.
  - `src/mqtt/mqtt.service.ts:119-143` — publish best-effort dengan `offlineQueueMax`.
  - `src/mqtt/mqtt.service.ts:64-99` — `try/catch` mengelilingi `connect()` supaya URL rusak tidak
    membunuh boot.
  - `src/config/configuration.ts:136-140` — `shared: process.env.MQTT_SHARED !== 'false'`.
  - `src/deliveries/telemetry/mqtt-telemetry.subscriber.ts:9-17` + `:40-64` — adapter transport tipis
    di atas core `TelemetryService.ingest` yang sama dengan HTTP.
  - `src/deliveries/deliveries.module.ts:92-97` — ingest hanya di `IS_INGEST_TIER`.
- **Kenapa dipakai di sini:** MQTT dipilih karena lawan bicaranya adalah **drone**, bukan browser:
  protokolnya ringan, ada QoS, dan brokernya (Mosquitto) memang standar IoT. Tapi bagian yang harus
  benar-benar dipahami adalah `$share`. Tanpa itu, MQTT adalah **broadcast**: setiap replica api yang
  subscribe `drovery/telemetry/+` akan menerima **setiap** frame — 5 replica = 5× pemrosesan, 5×
  tulisan DB, dan lima kali ack yang saling berebut. `configuration.ts:136-138` menyatakannya:
  *"MQTT5 SHARED SUBSCRIPTIONS ($share/<group>/…) so **EXACTLY ONE** api replica processes each
  ingest frame (no N× duplicate processing across the API tier)"*, dengan escape hatch: *"Disable
  (MQTT_SHARED=false) only for a v3.1.1-only broker — then run a single ingest owner."*
  Detail desain yang elegan: handler didaftarkan dengan **bare filter**, wrapping `$share` hanya
  terjadi di sisi broker (`mqtt.service.ts:35-36`, `:109-117`) — karena topik yang **datang** tidak
  membawa prefix `$share`, jadi dispatch harus mencocokkan filter aslinya. Sisanya adalah filosofi
  fail-open yang konsisten: *"a down broker degrades to HTTP-only, never crashes the process or
  blocks a request"* (`:22-24`), dengan `client.end(true)` saat destroy supaya broker mati tidak
  menggantung shutdown (`:176-179`).
- **Alternatif:**
  - **HTTP POST `/ingest/telemetry`** — sudah ada dan tetap jadi jalur default. Sederhana dan
    debuggable, tapi tiap frame = TCP+TLS handshake baru (kecuali keep-alive), boros untuk perangkat
    baterai yang mengirim 1 Hz.
  - **Satu consumer group Kafka** — semantik "tepat satu konsumen per partisi" yang setara dengan
    `$share`, plus replay; tapi client Kafka terlalu berat untuk firmware drone.
  - **MQTT tanpa `$share`, dengan satu pod ingest khusus** — bekerja, tapi jadi single point of
    failure dan tidak bisa di-autoscale. Itulah yang dimaksud komentar *"then run a single ingest
    owner"*.
  - **AMQP/RabbitMQ** — routing lebih kaya, tapi bukan protokol yang lazim di perangkat IoT
    berbatas daya.
  - **CoAP/UDP** — paling hemat energi, tapi kamu kehilangan QoS dan harus menangani reliability
    sendiri.
- **Latihan:** jalankan broker lokal dan buktikan `$share` bekerja.
  ```bash
  docker compose up mosquitto
  # jalankan DUA proses api dengan MQTT_URL=mqtt://localhost:1883 MQTT_SHARED=true
  mosquitto_pub -h localhost -t 'drovery/telemetry/drone-1' -m '{"droneId":"drone-1","lat":-6.2,"lng":106.8}'
  ```
  Amati `drovery_mqtt_frames_total{flow="telemetry",result="ok"}` di kedua `/metrics`: totalnya harus
  **1**, bukan 2. Lalu set `MQTT_SHARED=false` di keduanya, ulangi, dan lihat totalnya jadi 2 —
  itulah duplikasi yang `$share` cegah. Bonus: tulis unit test untuk `MqttService.topicMatches`
  (static, tanpa broker) yang mencakup `+`, `#`, dan kasus panjang segmen tidak sama.

---

## 16. OpenTelemetry: satu `traceId` melintasi API → queue → worker → DB

- **Prasyarat:** #4, #3, #6.
- **Anchor:**
  - `src/main.ts:6-9` dan `src/worker.ts:4-6` — komentar identik:
    *"MUST stay above the AppModule import"* (instrumentation mem-patch `pg`/`ioredis` saat
    `require`).
  - `src/common/monitoring/tracing.ts:1-4` — `require()` malas, bukan `import`, dengan alasan tertulis.
  - `src/common/monitoring/tracing.ts:162-174` — `injectTraceCarrier`: menempelkan W3C context ke
    `job.data._carrier`, **pass-through referensi yang sama** saat tracing mati.
  - `src/common/monitoring/tracing.ts:176-212` — `withJobSpan`: `propagation.extract` + span
    `SpanKind.CONSUMER`.
  - `src/deliveries/simulation/simulation.service.ts:58-66` (produsen) dan
    `src/deliveries/simulation/simulation.processor.ts:71-85` (konsumen) — dua sisi jembatan.
  - `src/app.module.ts:83-88` — pino `mixin` menstempel `trace_id` ke setiap baris log.
  - `src/common/monitoring/tracing.ts:99-106` — `/metrics` dan `/health` diabaikan.
  - `src/common/monitoring/tracing.ts:153-160` — sampling 5% di production, 100% di dev.
- **Kenapa dipakai di sini:** masalahnya spesifik untuk arsitektur ini. Auto-instrumentation HTTP
  bisa menyambung request→request, tapi begitu pekerjaan masuk **queue**, jejaknya putus: worker
  memulai konteks baru dan kamu tidak bisa lagi menjawab "request create yang mana yang akhirnya
  menyebabkan tulisan DB ini?". `ARCHITECTURE.md:143` menyatakan hasil yang dikejar:
  *"the producer's W3C context is injected into BullMQ job data at enqueue and a CONSUMER span is
  started from it in the worker, so **one `traceId` spans the create request → queue → worker → DB**
  (verified live with the console exporter)."*
  Dua keputusan teknik yang patut ditiru:
  1. **Nol biaya saat mati.** `tracing.ts:8-11`: *"when off, NOTHING is required/patched and every
     export is a no-op, so dev/test/CI are byte-identical."* `tracing.spec.ts:20-26` mengunci ini
     dengan assert `expect(out).toBe(data)` — **referensi yang sama**, jadi payload job benar-benar
     tidak berubah.
  2. **Fail-open.** `tracing.ts:46-49`: *"a bad OTLP endpoint or an instrumentation incompat must
     degrade to untraced, NOT crash boot"* — dan `traceReady` di-reset di `catch` supaya tidak
     tertinggal setengah-terpasang.
- **Alternatif:**
  - **Correlation id manual** (generate UUID, ikutkan di job data, log di mana-mana) — ini sudah
    setengah ada lewat `genReqId` di `app.module.ts:89-95`. Murah dan tidak butuh collector, tapi
    kamu hanya dapat *log correlation*, bukan waterfall latensi per-span.
  - **Sentry Performance** — satu vendor untuk error + trace, setup paling ringan; tapi lihat #17:
    Sentry dan OTel standalone tidak bisa hidup berdampingan di repo ini.
  - **Datadog APM / New Relic** — auto-instrumentation paling lengkap, tapi vendor lock-in dan biaya
    per host; OTel adalah spesifikasi netral yang bisa diekspor ke Tempo/Jaeger/Datadog sekaligus.
  - **eBPF (Pixie, Cilium Hubble)** — nol perubahan kode, tapi buta terhadap batas queue yang justru
    jadi masalah utama di sini.
- **Latihan:** lihat trace lintas proses dengan mata sendiri, tanpa infra apa pun:
  ```bash
  TRACING_ENABLED=true OTEL_EXPORTER=console npm run start:dev   # terminal 1
  TRACING_ENABLED=true OTEL_EXPORTER=console PROCESS_ROLE=worker npm run worker  # terminal 2
  ```
  Buat satu delivery, lalu **cocokkan `traceId`** dari span `POST /api/v1/deliveries` di terminal 1
  dengan span `bullmq.process stage` di terminal 2 — harus identik. Setelah itu, komentari
  `injectTraceCarrier` di `simulation.service.ts:59` (ganti dengan objek polos) dan ulangi: `traceId`
  worker akan berbeda. Itulah tepatnya yang dikerjakan satu fungsi tersebut.

---

## 17. Sentry, dan aturan "hanya boleh ada satu pemilik" OTel global

- **Prasyarat:** #16.
- **Anchor:**
  - `src/common/monitoring/sentry.ts:1-22` — `Sentry.init` di module scope, dengan
    `sentryEnabled = Boolean(dsn)`.
  - `src/common/monitoring/sentry.ts:3-9` — *"Sentry.init MUST run before the app's module graph is
    imported"*.
  - `src/common/monitoring/tracing.ts:24` — **baris kuncinya**:
    `export const tracingEnabled = wanted && !sentryEnabled;`
  - `src/common/monitoring/tracing.ts:15-18` — alasannya.
  - `src/common/monitoring/tracing.ts:36-40` — peringatan eksplisit di console kalau keduanya diminta.
  - `src/common/monitoring/tracing.ts:220-228` + `src/main.ts:79-83` / `src/worker.ts:72-78` —
    `shutdownTracing()` untuk flush span saat SIGTERM.
- **Kenapa dipakai di sini:** ini konflik nyata yang mudah menghabiskan berjam-jam debugging, dan
  komentarnya mendokumentasikannya dengan tepat: *"@sentry/node, whenever a DSN is set, registers the
  GLOBAL OTel tracer provider/propagator/context manager unconditionally (**even at
  tracesSampleRate 0**), so a standalone SDK would be ignored or conflict. Pick one owner."*
  API OpenTelemetry punya **satu** provider global per proses; siapa pun yang mendaftar terakhir
  (atau pertama, tergantung guard) menang, dan yang kalah diam-diam tidak menghasilkan span apa pun —
  gejala "tracing menyala tapi kosong" yang sangat sulit didiagnosis. Repo memilih menyelesaikannya
  di **compile-time konfigurasi**, bukan runtime: satu boolean, plus `console.warn` yang memberitahu
  apa yang harus dilakukan. Rekomendasinya bahkan ditulis: *"leave SENTRY_DSN unset and set
  TRACING_ENABLED → OTel owns tracing."* Bagian `shutdownTracing()` juga penting dan mudah terlupa:
  `BatchSpanProcessor` menahan span di memori; tanpa flush di SIGTERM, span dari menit terakhir
  sebelum deploy — yang sering justru yang kamu butuhkan — hilang.
- **Alternatif:**
  - **Sentry saja** (`SENTRY_TRACES_SAMPLE_RATE > 0`) — satu dashboard untuk error dan performance,
    setup paling sedikit; tapi kamu terikat model sampling dan retensi Sentry, dan tidak bisa
    mengekspor span ke Tempo/Jaeger.
  - **OTel saja + Sentry hanya untuk error tanpa DSN OTel-aware** — tidak mungkin di SDK Sentry
    versi ini; DSN yang di-set sudah cukup untuk merebut provider global. Itulah kenapa guard-nya
    berbentuk boolean, bukan opsi.
  - **`@sentry/opentelemetry` bridge** — secara resmi menjembatani keduanya (span OTel dikirim ke
    Sentry); menambah satu paket + konfigurasi propagator, dan menghilangkan kebebasan memilih
    backend trace.
  - **Tidak pakai error tracker sama sekali, andalkan log terstruktur** — repo memang bisa: pino
    sudah mencatat `trace_id` (`app.module.ts:83-88`), jadi Loki/CloudWatch Insights bisa
    menggantikan sebagian fungsinya, tanpa grouping/alerting per-issue.
- **Latihan:** buktikan konfliknya. Jalankan dengan `TRACING_ENABLED=true` saja dan catat baris
  `[tracing] OpenTelemetry enabled (...)`. Lalu tambahkan `SENTRY_DSN=https://x@example.invalid/1`
  dan jalankan lagi: kamu akan melihat peringatan dari `tracing.ts:37-39` dan **tidak ada** span OTel.
  Setelah itu tulis spec baru bergaya `tracing.spec.ts` yang memverifikasi bahwa `captureException`
  adalah no-op saat `SENTRY_DSN` tidak di-set (petunjuk: `sentry.ts:25-31` sudah `return` lebih awal —
  buat spec-nya menjadi kontrak yang dikunci).

---

## Bagian tersulit di area ini (dan cara menaklukkannya)

**Yang paling sering membuat orang macet: menyadari bahwa satu file `AppModule` yang sama berperilaku
berbeda tergantung proses yang mem-boot-nya.** Kamu akan membaca `deliveries.module.ts`, melihat
`SimulationProcessor` di daftar `providers`, menyimpulkan "berarti API memproses job" — lalu bingung
kenapa `console.log` di dalamnya tidak pernah muncul saat `npm run start:dev` dengan
`PROCESS_ROLE=api`. Kondisinya ada di `...(RUN_PROCESSOR ? [...] : [])` di baris 88, dan `RUN_PROCESSOR`
dievaluasi **saat import**, dari `process.env`, sebelum DI container ada.

Efek turunannya menyebar ke mana-mana dan semuanya membingungkan sampai model mentalnya benar:
- `TrackingPublisher` ada di worker, `TrackingSubscriber` di api/realtime — mereka **tidak pernah**
  saling memanggil, hanya lewat Redis (#13).
- `MetricsService` di worker mengekspor gauge airspace bernilai 0 selamanya, dan
  `metrics.service.ts:98-108` menghabiskan 10 baris komentar untuk memperingatkan agar kamu tidak
  membuat alert dari situ.
- `MqttTelemetrySubscriber` tidak ada di tier `realtime`, jadi frame yang "hilang" di sana bukan bug.

**Cara belajarnya:** sebelum menyentuh kode apa pun, buka tiga file ini berdampingan —
`src/common/process-role.ts`, `src/main.ts`, `src/worker.ts` — dan gambar tabel: baris = provider
(`SimulationProcessor`, `TrackingGateway`, `TrackingSubscriber`, `MqttTelemetrySubscriber`,
`WatchdogScheduler`), kolom = empat nilai `PROCESS_ROLE`, isi = hidup/mati. Verifikasi tebakanmu
dengan `grep -rn "IS_WORKER_TIER\|IS_HTTP_TIER\|IS_INGEST_TIER" src/`. Setelah tabel itu benar di
kepalamu, sisa area ini akan terasa seperti konsekuensi logis, bukan kumpulan trik.

---

## Titik masuk yang disarankan (baca berurutan)

1. `src/common/process-role.ts` — 26 baris, seluruh taksonomi tier.
2. `src/main.ts` — bootstrap tier HTTP; perhatikan urutan import (Sentry → tracing → AppModule).
3. `src/worker.ts` — bootstrap tanpa HTTP; bandingkan dengan #2 baris demi baris.
4. `src/deliveries/simulation/simulation.service.ts` — sisi producer BullMQ (enqueue + idempotency).
5. `src/deliveries/tracking/tracking.gateway.ts` — gateway WS, auth handshake, backpressure.
6. `src/payments/payments.service.ts` — idempotency + monotonic CAS pada uang sungguhan.

## Bacaan pendamping di repo (bukan kode, tapi berisi "kenapa")

- `ARCHITECTURE.md` §1, §10, §12 — migrasi `setTimeout` → BullMQ, observability, MQTT.
- `SCALING-1M.md` §4, §6 — batas Pub/Sub di Redis Cluster, dan daftar gap yang disadari
  (webhook idempotency, push fan-out).
- `k8s/base/worker-scaledobject.yaml` + `k8s/base/realtime-scaledobject.yaml` — komentar YAML di sini
  padat berisi alasan teknis, bukan boilerplate.

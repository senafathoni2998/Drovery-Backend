# Fase 6 — Satu graph, banyak proses: worker, job durabel, dan DDL terjadwal

> **Durasi** ~2 minggu (~26 jam) · **Mode** bedah repo asli · **Repo** `Drovery_Backend`

---

## Kenapa fase ini ada di sini

Sampai Fase 5 kamu selalu berdiri di dalam satu siklus: request masuk, service jalan, transaksi commit, response keluar. Bahkan CAS — lompatan terbesar kurikulum ini — masih terjadi di dalam satu request. Fase 6 adalah tempat asumsi itu patah. Kamu akan melihat bahwa `AppModule` yang **sama persis** di-boot oleh dua binary berbeda (`main.ts` dan `worker.ts`), menghasilkan dua kumpulan provider yang berbeda, dan mengerjakan hal yang berbeda — tanpa satu baris pun `if` di dalam service.

Kenapa TEPAT setelah Fase 5, dan bukan sebelum? Karena begitu kamu memindahkan pekerjaan ke queue, kamu otomatis membeli tiga hal sekaligus: **retry**, **pengiriman at-least-once**, dan **eksekusi paralel di banyak replica**. Ketiganya adalah sumber duplikasi. `JOB_OPTS` di repo ini menyatakan hubungan sebab-akibatnya dalam satu kalimat — *"Retry transient failures (DB blip, etc.) with backoff. Handlers are idempotent (deterministic jobIds + monotonic CAS), so retries are safe."* (`src/deliveries/simulation/simulation.service.ts:21-22`). Baca ulang: `attempts: 5` **hanya boleh** ditulis karena CAS-nya sudah ada. Kalau kamu belajar BullMQ sebelum CAS, kamu akan menyalakan retry di atas handler yang tidak idempoten dan menghasilkan transisi ganda, notifikasi ganda, dan refund ganda — dan kamu tidak akan tahu, karena semuanya "berhasil".

Yang mustahil dipahami tanpa fase ini ada tiga. Pertama, **kenapa `console.log` di `SimulationProcessor` tidak pernah muncul di terminal API** — jawabannya bukan bug, tapi satu baris spread kondisional di `src/deliveries/deliveries.module.ts:88` yang dievaluasi saat *import*, sebelum DI container ada. Kedua, **kenapa `setTimeout` bukan pilihan**: `ARCHITECTURE.md:13` mencatat migrasi ini sebagai blocker #1 dari seluruh rencana scaling, dan alasannya konkret — timer mati bersama proses, dan tidak bisa dipindahkan ke replica lain. Ketiga, dan ini yang paling tidak intuitif: **DDL bisa jadi pekerjaan terjadwal**. Partisi bulan depan harus dibuat sebelum bulan depan tiba; di repo ini pekerjaan itu adalah repeatable job BullMQ, bukan cron, bukan `pg_cron`.

Fase ini juga tempat harga dibayar. Partisi RANGE membuat `findUnique({ where: { id } })` **berhenti bisa di-compile** di enam model, melahirkan tabel `TrackingIdRegistry` yang kelihatan seperti duplikasi tak berguna, dan menyebarkan kolom `deliveryCreatedAt` ke enam tabel anak. Semua keanehan itu berasal dari satu aturan PostgreSQL. Saya akan sebut aturannya lebih dulu, lalu kita telusuri riaknya satu per satu — karena kalau dibalik, kamu akan menghabiskan berjam-jam mengira Prisma-nya rusak.

---

## Gerbang masuk

Kamu siap masuk Fase 6 kalau kamu bisa:

- [ ] Menjelaskan, tanpa membuka kode, kenapa `updateMany({ where: { id, status: { in: [...] } } })` yang mengembalikan `{ count: 0 }` **bukan error** — dan apa yang harus dilakukan pemanggilnya.
- [ ] Menulis satu transaksi Prisma yang menulis dua tabel dan menunjukkan (dengan spec) bahwa gagal di tabel kedua meng-*rollback* tabel pertama.
- [ ] Menyebutkan satu tempat di Drovery di mana kunci idempoten deterministik dipakai untuk membuat retry jadi no-op, dan bagaimana P2002 dijadikan "sukses".
- [ ] Menjalankan `docker compose up -d postgres redis`, lalu `redis-cli ping` dan `psql "$DATABASE_URL" -c 'select 1'` berhasil dari mesinmu.
- [ ] Menjalankan `npx jest src/deliveries` dan membaca output-nya tanpa panik; tahu cara menjalankan satu file spec saja.
- [ ] Membuka `src/app.module.ts` dan menunjuk di mana provider global didaftarkan, tanpa harus menelusuri seluruh file.

Kalau butir pertama masih ragu, jangan lanjut. Seluruh Fase 6 bersandar padanya.

---

## Peta jalan mingguan

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| 1 (hari 1–3) | Topologi proses: `process-role.ts`, `worker.ts` vs `main.ts`, spread provider kondisional. Health check liveness vs readiness. | 6 | Tabel provider × 4 nilai `PROCESS_ROLE` yang kamu isi sendiri dan verifikasi dengan `grep`. Dua terminal jalan bersamaan; `curl /health` dan `/health/ready` memberi jawaban berbeda saat Redis dimatikan. |
| 1 (hari 4–7) | BullMQ end-to-end: producer `addBulk` + delayed, `@Processor` + `WorkerHost`, `attempts`/`backoff`/`removeOn*`, `ENQUEUE_TIMEOUT_MS`. `jobId` deterministik dan kontra-contohnya. | 7 | Delivery yang maju hanya saat worker hidup. `redis-cli ZRANGE bull:delivery-simulation:delayed` memperlihatkan job masa depan. Satu spec baru yang membuktikan handler idempoten. |
| 2 (hari 1–4) | Repeatable scheduler (`upsertJobScheduler`), kill switch yang menghapus, watchdog sebagai sistem penyembuh diri, sinyal & heartbeat. | 7 | Scheduler buatan sendiri terdaftar, dua worker jalan, terbukti hanya satu yang mengeksekusi tiap tick. Log reap watchdog muncul saat telemetry sengaja dihentikan. |
| 2 (hari 5–7) | Partisi RANGE + konsekuensi composite PK; maintenance partisi sebagai job terjadwal; seam real-or-mock. | 6 | `psql -f scripts/verify-partitions.sql` hijau. `npx jest src/partition-maintenance` hijau, lalu **merah** setelah `??` diganti `||`. Seluruh test suite jalan tanpa satu pun kunci API. |

Total ~26 jam. Kalau kamu di 15 jam/minggu, ada ruang untuk mengerjakan latihan opsional di 6.11.

---

## Konsep

Sebelum masuk ke konsep satu per satu, tempelkan gambar ini di kepala. Ini topologi yang akan kamu bongkar selama dua minggu — satu image Docker, empat cara menyalakannya:

```
                    ┌──────────────────────── satu image, satu AppModule ─────────────────────────┐
                    │                                                                             │
  Mobile app ──HTTP─┼─> tier api        (main.ts,   PROCESS_ROLE=api)                             │
                    │      │  enqueue                                                             │
                    │      ▼                                                                      │
                    │   Redis ──BullMQ delayed set (ZSET)──> tier worker (worker.ts, ROLE=worker) │
                    │                                            │                                │
                    │                                            ├─ SimulationProcessor           │
                    │                                            ├─ WatchdogScheduler + Processor  │
                    │                                            ├─ PartitionScheduler + Processor│
                    │                                            └─ RecurringScheduler            │
                    │                                                     │                       │
  Browser ──WS──────┼─> tier realtime   (main.ts, ROLE=realtime)          │ DDL + CAS             │
                    │                                                     ▼                       │
                    │                                                 PostgreSQL (terpartisi)     │
                    └─────────────────────────────────────────────────────────────────────────────┘

  ROLE unset (dev) = ketiganya dalam SATU proses. Itu sebabnya `npm run start:dev` "just works".

  Probe:  GET /health        → liveness  (gagal ⇒ pod di-RESTART)   — nol dependensi
          GET /health/ready  → readiness (gagal ⇒ pod DITARIK dari Service, tidak restart)
```

Tiga hal yang akan terus kembali: **satu graph, banyak proses** (6.1–6.2), **at-least-once memaksa idempotency** (6.3–6.4), dan **pekerjaan berkala butuh koordinator, bukan timer** (6.5–6.6, 6.9).

### 6.1 `PROCESS_ROLE`: satu image, empat peran — dan flag yang dibaca saat import

Di Ionic React kamu punya satu proses: WebView yang memegang UI, timer, dan HTTP sekaligus. Tidak ada padanan jujur untuk apa yang terjadi di sini, jadi saya tidak akan memaksakannya. Padanan **terdekat** yang salah-tapi-berguna adalah build variant Android: satu source tree, `debug` dan `release` menghasilkan APK yang berbeda isinya. Bedanya — dan ini bedanya penting — di Drovery pemilihan itu terjadi **saat runtime start**, dari satu env var, terhadap **image Docker yang sama persis**. Tidak ada dua build. Ada satu build, empat cara menyalakannya.

Sumber kebenarannya satu file 27 baris. Bacalah komentar headernya sebelum kodenya: `src/common/process-role.ts:1-13` menyebut kontraknya sebagai *"One Docker image, four roles"* dan menjabarkan keempatnya — `api`, `worker`, `realtime`, dan unset (dev: semuanya dalam satu proses). Alasan `realtime` dipisah ditulis eksplisit di `:6-9`: tier yang memegang ratusan ribu socket berumur panjang harus bisa di-scale independen dari tier api/worker.

Yang paling mudah terlewat: ketiga flag itu adalah **konstanta module-level**, bukan hasil `ConfigService`. Lihat `src/common/process-role.ts:15` — `const role = process.env.PROCESS_ROLE;` dibaca saat file di-`import`, jauh sebelum DI container Nest dibangun. Itu bukan kemalasan; itu keharusan. Keputusan "provider ini didaftarkan atau tidak" terjadi di dalam dekorator `@Module`, dan dekorator dievaluasi saat class di-load. `ConfigService` belum ada di titik itu. Konsekuensi turunannya ada di `src/main.ts:1-3`, yang komentarnya menjelaskan kenapa `import 'dotenv/config'` **wajib** jadi baris pertama: *"so flags read at import time (e.g. PROCESS_ROLE in deliveries.module) honor .env"*. Kalau kamu pindahkan baris itu ke bawah, `.env` kamu diabaikan oleh flag-flag tier — diam-diam, tanpa error.

Ketiga flag ditulis sebagai negasi, dan itu disengaja. `IS_WORKER_TIER = role !== 'api' && role !== 'realtime'` (`:19`) berarti **dev (unset) ikut menjalankan worker**, sehingga `npm run start:dev` tanpa env apa pun tetap memberi kamu sistem lengkap dalam satu proses. Pola yang sama untuk `IS_HTTP_TIER` (`:22`) dan `IS_INGEST_TIER` (`:26`).

**Anchor:** `src/common/process-role.ts:1-13` — komentar kontrak "One Docker image, four roles"; lalu `:15` (pembacaan env saat import), `:19`, `:22`, `:26` (tiga flag turunan). Bandingkan langsung dengan `src/main.ts:1-3` (kenapa dotenv paling atas), `docker-compose.yml:99` (`PROCESS_ROLE: api # enqueue-only — does NOT process jobs`) dan `docker-compose.yml:127` (`PROCESS_ROLE: worker`). Sisi Kubernetes-nya: `k8s/base/api-deployment.yaml:34`, `k8s/base/worker-deployment.yaml:35`, `k8s/base/realtime-deployment.yaml:41` — tiga Deployment, satu image.

**Kenapa dipakai di sini:** karena beban ketiga tier punya bentuk yang berbeda dan tidak bisa di-scale dengan sinyal yang sama. `src/worker.ts:24` menyatakan sisi ekonominya — *"Scale workers and API instances separately."* Kalau semuanya satu proses, lonjakan job simulasi memakan CPU yang seharusnya melayani HTTP; dan sebaliknya, ratusan ribu socket idle di tier realtime akan ikut ter-restart setiap kali kamu men-deploy perubahan controller. Yang membuat solusi ini murah adalah bahwa harganya **tiga boolean**, bukan tiga repo.

**Alternatif:**
- **Repo/service terpisah untuk worker (dua codebase, dua image).** Batas paling tegas, dan tim bisa deploy sendiri-sendiri. Harganya konkret di repo ini: `SimulationProcessor` meng-inject `DeliveriesService`, `NotificationsService`, `DispatchService`, `ServiceabilityService`, `TrackingService`, `I18nService`, dan `MetricsService` (`src/deliveries/simulation/simulation.processor.ts:46-59`). Memisahkan repo berarti mem-package tujuh modul itu jadi library internal berversi — plus schema Prisma yang harus di-generate di dua tempat dan bisa hanyut. Kamu menukar tiga boolean dengan satu pipeline publikasi package.
- **Monorepo Nx/Turborepo dengan beberapa Nest app.** Memungkinkan module graph benar-benar berbeda per app (jadi worker tidak perlu bahkan *mem-parse* file controller), dan build cache-nya bagus. Harganya: satu lapisan tooling build baru yang harus dipelajari dan di-debug di CI, untuk keuntungan yang di sini sudah dicapai oleh `...(RUN_PROCESSOR ? [X] : [])`. Ambil ini kalau kamu punya >3 aplikasi; bukan untuk 2.
- **Feature flag lewat `ConfigService`.** Terasa lebih "Nest-y" dan bisa di-override per environment tanpa restart. Tapi ini **tidak bisa dilakukan** untuk kasus ini: keputusan pendaftaran provider terjadi di dekorator `@Module`, dan `ConfigService` baru ada setelah container dibangun. Yang bisa kamu lakukan lewat config hanyalah kill switch *perilaku* (seperti `WATCHDOG_ENABLED`), bukan kill switch *pendaftaran*.

**Latihan:** gambar tabelnya sebelum menyentuh kode. Baris = `SimulationProcessor`, `TrackingGateway`, `TrackingSubscriber`, `MqttTelemetrySubscriber`, `WatchdogScheduler`, `PartitionScheduler`. Kolom = `api`, `worker`, `realtime`, unset. Isi hidup/mati dari tebakanmu. Lalu verifikasi:

```bash
grep -rn "IS_WORKER_TIER\|IS_HTTP_TIER\|IS_INGEST_TIER" src/
```

Setiap sel yang salah adalah tempat model mentalmu belum benar — perbaiki sekarang, bukan nanti. Bonus: tambahkan `console.log('RUN_PROCESSOR =', RUN_PROCESSOR)` tepat di bawah `src/deliveries/deliveries.module.ts:44`, jalankan dua terminal (`PROCESS_ROLE=api npm run start:dev` dan `PROCESS_ROLE=worker npm run worker`), dan konfirmasi nilainya berbeda.

<details><summary>Kunci jawaban — buka HANYA setelah tabelmu sendiri jadi</summary>

| Provider | `api` | `worker` | `realtime` | unset (dev) |
|---|:---:|:---:|:---:|:---:|
| `SimulationProcessor` (`deliveries.module.ts:88`) | ✗ | ✓ | ✗ | ✓ |
| `TrackingGateway` (`:91`) | ✓ | ✗ | ✓ | ✓ |
| `TrackingSubscriber` (`:91`) | ✓ | ✗ | ✓ | ✓ |
| `MqttTelemetrySubscriber` (`:95-97`) | ✓ | ✗ | ✗ | ✓ |
| `WatchdogScheduler` + `WatchdogProcessor` (`delivery-watchdog.module.ts:28`) | ✗ | ✓ | ✗ | ✓ |
| `PartitionScheduler` + `PartitionProcessor` (`partition-maintenance.module.ts:22`) | ✗ | ✓ | ✗ | ✓ |
| `TrackingPublisher` (`deliveries.module.ts:79`) | ✓ | ✓ | ✓ | ✓ |

Dua hal yang biasanya salah ditebak. Pertama, kolom **unset** hampir seluruhnya ✓ — karena ketiga flag ditulis sebagai negasi, dev mendapat semuanya. Kedua, `MqttTelemetrySubscriber` **mati** di tier realtime: tier itu memfan-out update ke luar, ia tidak meng-ingest (`process-role.ts:24-26`). Jadi frame telemetry yang "hilang" saat kamu menjalankan `PROCESS_ROLE=realtime` bukan bug.
</details>

---

### 6.2 `worker.ts`: module graph penuh tanpa HTTP server

Kalau `main.ts` adalah `NestFactory.create(AppModule)`, `worker.ts` adalah `NestFactory.createApplicationContext(AppModule)`. Satu kata beda, konsekuensinya besar: kamu mendapat **seluruh module graph** — DI, lifecycle hooks, `onModuleInit`, `onApplicationShutdown` — tanpa Express, tanpa route, tanpa port 3000. Analogi yang jujur dari duniamu: ini seperti menjalankan logika aplikasimu di Node script biasa (`node script.js`) alih-alih di dalam WebView, tapi tetap mendapat semua provider yang biasanya kamu dapat lewat context React. Bedanya, di sini "context"-nya adalah DI container Nest yang lengkap.

Baca `src/worker.ts` dari atas ke bawah dan bandingkan baris demi baris dengan `src/main.ts`. Tiga hal yang harus kamu catat:

1. **`src/worker.ts:30-32`** — `NestFactory.createApplicationContext(AppModule, { logger: [...] })`. Perhatikan: **bukan** `NestFactory.create`. Karena tidak ada HTTP server, `app.listen()` tidak ada dan proses tetap hidup karena BullMQ `Worker` memegang koneksi Redis.
2. **`src/worker.ts:34`** — `app.enableShutdownHooks()`, dengan komentar di `:33`: *"Close BullMQ workers / Prisma cleanly on SIGTERM/SIGINT (finishes active jobs)."* Ini yang membuat `docker stop` tidak memotong job di tengah jalan.
3. **`src/worker.ts:36-61`** — worker tidak punya Express, tapi tetap menyajikan `/metrics` lewat `http.createServer` mentah di port 9091, karena KEDA men-scale worker berdasarkan kedalaman queue. Komentar di `:36-39` menjelaskan batasnya: hanya queue gauge + default metrics yang bermakna di worker. Dan `:62-68` menangani `server.on('error')` dengan log alih-alih crash — *"Metrics is auxiliary — if the port can't bind (EADDRINUSE), log and keep the worker draining the queue rather than crashing."*

Sisi kedua dari cerita ini ada di module. `src/deliveries/deliveries.module.ts:43-44` mendefinisikan `const RUN_PROCESSOR = IS_WORKER_TIER;`, lalu `:87-97` menyusun daftar `providers` dengan spread kondisional:

```
...(RUN_PROCESSOR ? [SimulationProcessor] : []),
...(IS_HTTP_TIER ? [TrackingGateway, TrackingSubscriber] : []),
...(IS_INGEST_TIER ? [MqttTelemetrySubscriber, MqttCommandAckSubscriber] : []),
```

Kalau kamu belum pernah melihat pola ini: `[...(cond ? [X] : [])]` adalah cara menyisipkan-atau-tidak satu elemen ke dalam array literal. Hasilnya, array `providers` yang dilihat Nest **benar-benar berbeda panjangnya** tergantung env var. Nest tidak tahu ada provider yang "dimatikan" — dari sudut pandangnya, provider itu memang tidak pernah ada.

Efek samping yang bagus untuk diperhatikan: `I18nService` (`src/i18n/i18n.service.ts:5-12`) mendokumentasikan kenapa ia **tidak boleh** request-scoped — *"the primary surface — delivery notifications — is produced by the BullMQ worker (SimulationProcessor), which has NO HTTP request."* Kalau di Fase 2 kalimat itu terasa abstrak, sekarang ia konkret: proses worker benar-benar tidak punya request untuk diambil locale-nya, jadi `SimulationProcessor` harus membaca `User.locale` dari DB (`simulation.processor.ts:61-69`).

**Anchor:** `src/worker.ts:16-26` (dokstring + *"Scale workers and API instances separately"*), `:30-32` (`createApplicationContext`), `:34` (`enableShutdownHooks`), `:36-61` (metrics server mentah), `:62-68` (fail-open saat port bentrok). Pasangannya: `src/deliveries/deliveries.module.ts:43-44` dan `:87-97`. Script-nya ada di `package.json:18-19` (`worker` dan `worker:prod`).

**Kenapa dipakai di sini:** karena `SimulationProcessor` butuh seluruh domain — bukan cuma Prisma. Ia memanggil `DeliveriesService`, `DispatchService`, `NotificationsService`, dan `I18nService`. Menjalankannya di luar Nest berarti menginstansiasi tujuh service itu manual dan memelihara urutan dependensinya sendiri. `createApplicationContext` memberi kamu DI penuh dengan biaya nol.

**Alternatif:**
- **Satu proses saja (`npm run start:dev` tanpa env), seperti di dev.** Nol operasional, dan itu memang default lokal. Harganya muncul di produksi: setiap replica API juga jadi worker, sehingga saat 500 delivery simulasi jatuh tempo bersamaan, event loop yang sama yang melayani `POST /deliveries` sibuk menghitung posisi drone. Latensi p99 HTTP-mu jadi fungsi dari beban queue — dan kamu tidak bisa men-scale salah satunya tanpa yang lain.
- **Worker sebagai script Node polos** (`node dist/jobs/run-sim.js`, tanpa Nest). Boot lebih cepat (tidak ada scanning module graph) dan image bisa lebih kecil. Harganya: kamu kehilangan `onModuleInit` (yang dipakai `WatchdogScheduler`/`PartitionScheduler` untuk mendaftarkan repeatable job), kehilangan `enableShutdownHooks` (jadi SIGTERM memotong job aktif), dan harus menyalin manual konstruksi tujuh service tadi. Untuk worker yang hanya butuh satu koneksi DB, ini pilihan bagus; untuk yang meng-inject setengah aplikasi, tidak.
- **`@nestjs/microservices` dengan transport kustom.** Nest punya abstraksi microservice bawaan (`createMicroservice`) dengan pola `@MessagePattern`. Cocok kalau kamu memang butuh request/response antar-service. Harganya di sini: BullMQ bukan transport Nest yang didukung untuk delayed job, jadi kamu tetap harus menulis integrasi sendiri — sambil menanggung abstraksi ekstra yang tidak memberi apa-apa.

**Latihan:** buktikan pemisahannya dengan mematikan setengahnya.

```bash
PROCESS_ROLE=api npm run start:dev     # terminal 1
PROCESS_ROLE=worker npm run worker     # terminal 2
```

Buat satu delivery lewat API. Transisi status (`Delivery … → CONFIRMED`) muncul di terminal **worker**, bukan api. Sekarang matikan worker (Ctrl-C) dan buat delivery lagi: job ter-enqueue, tapi statusnya tidak pernah maju. Nyalakan worker lagi — dan perhatikan job yang tertunda tadi **dieksekusi menyusul**. Itu bukti pertama bahwa job-nya durabel, bukan timer. Verifikasi terakhir: `curl localhost:9091/metrics | head` dari terminal ketiga saat worker hidup; kamu akan melihat registry yang sama tanpa satu pun metrik HTTP request — karena worker memang tidak melayani HTTP.

---

### 6.3 BullMQ: producer, processor, dan opsi yang menentukan apakah sistemmu jujur

Dari sisi frontend, padanan terdekat `queue.add(..., { delay })` adalah `setTimeout`. Padanan itu benar secara **bentuk** dan salah secara **sifat**, dan seluruh nilai fase ini ada di selisihnya. `setTimeout` menyimpan niat di heap proses; BullMQ menyimpannya di *sorted set* Redis dengan skor = timestamp jatuh tempo. Proses mati, heap hilang; Redis tetap. Dokstring `SimulationService` menyatakannya persis: *"Schedules a delivery's lifecycle as durable, delayed BullMQ jobs in Redis (instead of in-process `setTimeout`). This survives restarts and lets any worker instance advance any delivery — the foundation for horizontal scaling."* (`src/deliveries/simulation/simulation.service.ts:34-38`).

Sisi **producer** ada di `simulation.service.ts:58-89`. `startSimulation` membangun dua array job — lima stage (`STAGES` di `simulation.constants.ts:56-65`, `delayMs` 10 s sampai 120 s) dan sekumpulan position tick — lalu mengirim keduanya sekaligus dengan `queue.addBulk`. `addBulk` bukan optimasi kosmetik: satu round-trip Redis untuk ~17 job alih-alih 17 round-trip, dan semua job masuk atau tidak sama sekali dari sudut pandang pemanggil.

Sisi **consumer** ada di `simulation.processor.ts:42-43`: `@Processor(SIM_QUEUE, { concurrency: SIM_WORKER_CONCURRENCY })` pada class yang `extends WorkerHost`. `WorkerHost` mewajibkan satu method `process(job)`, dan di `:71-83` method itu hanya bertindak sebagai router: `STAGE_JOB` → `handleStage`, `POSITION_JOB` → `handlePosition`, `KICKOFF_JOB` → `handleKickoff`. Concurrency default-nya 10 (`simulation.constants.ts:6-9`) dengan komentar yang benar secara operasional: *"Tune against the DB pool."* Naikkan concurrency di atas ukuran pool Prisma dan kamu hanya memindahkan antrean dari Redis ke connection pool.

Empat opsi di `JOB_OPTS` (`simulation.service.ts:20-28`) masing-masing menutup satu mode kegagalan:

| Opsi | Menutup apa |
|---|---|
| `attempts: 5` | Blip transien (DB reconnect, Redis hiccup) tidak menghilangkan transisi. |
| `backoff: { type: 'exponential', delay: 1000 }` | Retry tidak jadi thundering herd terhadap dependensi yang sedang sakit. |
| `removeOnComplete: { age: 3600, count: 1000 }` | Redis tidak tumbuh tanpa batas oleh job sukses. |
| `removeOnFail: { age: 24*3600, count: 5000 }` | Komentarnya menyebut alasannya: *"so a burst doesn't evict failure history"* — riwayat gagal bertahan 24 jam supaya masih bisa didiagnosis besok pagi. |

Lalu ada satu detail yang paling mudah dilewati dan paling berbahaya kalau dilewati: **`ENQUEUE_TIMEOUT_MS`** (`simulation.service.ts:30-32`). Komentarnya menyebut penyebabnya — *"the BullMQ offline queue retries forever"*. Koneksi Redis untuk queue sengaja dikonfigurasi `maxRetriesPerRequest: null` (`src/app.module.ts:126-138`, dengan alasan tertulis: *"required so queue commands don't error during reconnects"*), yang artinya `queue.addBulk()` saat Redis mati **tidak reject — ia menggantung**. Tanpa penjaga, `POST /deliveries` akan menggantung selamanya alih-alih gagal cepat. Penjaganya ada di `:162-174`: `Promise.race([p, timeout])` dengan `.finally(() => clearTimeout(timer))` supaya timer tidak bocor saat promise menang.

Dua konfigurasi ini — `maxRetriesPerRequest: null` di satu file dan `Promise.race` di file lain — adalah contoh sempurna dari sesuatu yang **hanya masuk akal kalau dibaca berpasangan**. Kalau kamu melihat salah satunya sendirian, keduanya terlihat aneh.

**Anchor:** `src/app.module.ts:126-138` (koneksi queue + komentar `maxRetriesPerRequest`), `src/deliveries/simulation/simulation.service.ts:20-28` (`JOB_OPTS`), `:30-32` (`ENQUEUE_TIMEOUT_MS` + alasannya), `:34-38` (dokstring "instead of in-process setTimeout"), `:58-89` (producer `addBulk` + `delay`), `:162-174` (`withTimeout`). Consumer: `src/deliveries/simulation/simulation.processor.ts:42-43`, `:71-83`, dan `:467-472` (`@OnWorkerEvent('failed')` yang mencatat `attemptsMade`). Konteks arsitektural: `ARCHITECTURE.md:13`.

**Kenapa dipakai di sini:** karena delivery Drovery adalah proses berdurasi menit, bukan detik. `AWAITING_HANDOFF` baru terjadi 120 detik setelah create (`simulation.constants.ts:64`), dan pada delivery terjadwal bisa 60 hari kemudian. Sistem yang menahan niat itu di memori proses akan kehilangan seluruh armada penerbangan setiap kali kamu men-deploy. `ARCHITECTURE.md:13` mencatatnya sebagai hard blocker #1 yang sekarang `✅ RESOLVED`.

**Alternatif:**
- **`setTimeout` / `@nestjs/schedule` in-process.** Nol infrastruktur, nol latensi enqueue, dan mudah di-debug. Dua kegagalan yang tidak bisa ditutup: (a) `kill -TERM` menghapus semua timer — sebuah deploy rutin akan membekukan setiap delivery yang sedang terbang; (b) timer hidup di satu proses, jadi menambah replica tidak menambah kapasitas pemrosesan, hanya menggandakan timer kalau kamu tidak hati-hati. Ini persis yang digantikan.
- **RabbitMQ / NATS JetStream.** Broker sungguhan: routing berbasis exchange, dead-letter queue asli, ack/nack eksplisit, dan backpressure yang lebih baik. Harganya konkret di stack ini: satu komponen infra baru yang harus di-deploy, dimonitor, dan di-backup — padahal Redis **sudah ada** untuk cache, throttler, dan pub/sub. BullMQ memakai Redis yang sama. Pilih RabbitMQ kalau kamu butuh topologi routing (fanout/topic exchange) yang BullMQ tidak punya.
- **Kafka.** Replay log, throughput sangat tinggi, retensi berbasis waktu. Salah untuk beban ini karena *delayed delivery* bukan primitif native Kafka — kamu harus mensimulasikannya dengan topik-per-interval atau consumer yang menahan offset, dan keduanya rapuh.
- **AWS SQS + EventBridge Scheduler.** Managed, tidak ada Redis untuk diurus, dan durabilitasnya bukan urusanmu. Harganya: lock-in ke satu cloud, granularitas delayed message SQS maksimal 15 menit (di atas itu butuh Step Functions atau EventBridge), dan biaya per-request pada beban satu tick per 5 detik per delivery jadi tidak sepele.
- **`pg-boss` (queue di atas Postgres).** Satu datastore lebih sedikit, dan enqueue bisa co-commit dengan transaksi bisnismu — itu keuntungan nyata yang menghapus seluruh kelas masalah dual-write. Harganya: memindahkan beban polling ke DB primary, yang di repo ini justru datastore yang paling ingin dilindungi (`SCALING-1M.md` menyebut single-primary writes sebagai plafon berikutnya).

Trade-off BullMQ juga disadari dan dicatat, bukan disembunyikan: `SCALING-1M.md:249-252` memperingatkan *"millions of future position/stage ticks live in BullMQ's delayed set"* dan meminta memori queue-Redis dihitung terhadap `concurrentDeliveries × ~17 delayed jobs`.

**Latihan:** buat "durable" jadi sesuatu yang kamu lihat, bukan yang kamu percaya. Ubah `STAGES` di `src/deliveries/simulation/simulation.constants.ts:56-65` supaya `delayMs` jauh lebih besar (mis. `600_000`), buat satu delivery, lalu:

```bash
redis-cli ZRANGE bull:delivery-simulation:delayed 0 -1 WITHSCORES
```

Kamu akan melihat job masa depan beserta skornya (epoch ms jatuh tempo). Restart worker — job tetap ada. Bandingkan dengan `setTimeout` yang tidak akan pernah memberimu output ini. Lalu batalkan delivery-nya dan jalankan perintah yang sama: entri itu hilang, karena `stopSimulation` (`simulation.service.ts:178-189`) menghapusnya per-`jobId`. Terakhir, matikan Redis (`docker compose stop redis`) dan panggil `POST /deliveries`: request harus gagal dalam ~2 detik dengan pesan yang menyebut `Redis unreachable?`, **bukan** menggantung. Kalau kamu hapus `withTimeout` dari `:85-89`, ia akan menggantung — coba, lalu kembalikan.

---

### 6.4 `jobId` deterministik = enqueue idempoten — dan kontra-contohnya

Ini konsep yang paling mudah salah dipahami sebagai "trik", padahal ia adalah keputusan desain dengan dua sisi. Aturannya: BullMQ menolak menambahkan job dengan `jobId` yang sudah ada di queue. Jadi kalau `jobId` kamu adalah fungsi murni dari data domain, memanggil enqueue dua kali menghasilkan **satu** job. Di `simulation.service.ts:70` dan `:82` kamu melihatnya:

```
jobId: `${deliveryId}:stage:${i}`
jobId: `${deliveryId}:pos:${j}`
```

Retry `POST /deliveries` yang gagal separuh jalan, dua replica yang berlomba, atau job kickoff yang di-retry — semuanya menghasilkan himpunan job yang sama, bukan dua kali lipat. Ini idempotency di **sisi enqueue**, dan ia berpasangan dengan idempotency di **sisi eksekusi** (CAS di `simulation.processor.ts:376-380`). Kamu butuh keduanya: yang pertama mencegah job ganda, yang kedua mencegah efek ganda kalau job yang sama dikirim ulang oleh mekanisme *stalled job recovery* BullMQ.

Sekarang bagian yang membuat konsep ini benar-benar dipahami, bukan dihafal: **kontra-contohnya**. `deferKickoff` (`simulation.service.ts:133-160`) sengaja memakai `jobId` **baru** setiap attempt (`-kickoff-r2`, `-r3`, …). Komentarnya di `:136-141` menjelaskan kenapa, dan ini layak dibaca pelan-pelan:

> *A NEW jobId per attempt (`-kickoff-r2`, `-r3`, …), because the original `${deliveryId}-kickoff` id is what makes the first enqueue idempotent — reusing it would be deduped against the job currently being processed and the hold would silently become a drop.*

Baca sekali lagi. Saat `handleKickoff` sedang berjalan, job `${deliveryId}-kickoff` **masih ada** di queue (statusnya *active*). Kalau handler itu memutuskan menunda penerbangan karena cuaca dan mencoba meng-enqueue ulang dengan id yang sama, BullMQ akan menganggapnya duplikat dan membuangnya — dan penundaan berubah jadi pembatalan diam-diam. Jadi: **id deterministik melindungimu dari duplikasi, tapi mencelakakanmu saat kamu memang ingin job baru.** Aturan praktisnya: id deterministik untuk *niat yang sama*, id baru untuk *attempt berikutnya dari niat yang sama*.

Detail turunan di `:140-141` juga bagus: nomor attempt ikut di **payload**, bukan di memori processor, *"so the budget survives a worker restart, rather than living in the processor's memory where a redeploy would reset it to zero and hold the delivery forever."* State yang hidup di memori worker adalah state yang hilang saat deploy.

Satu jebakan API yang terdokumentasi di repo dan akan menghematmu satu jam: `queue.add()` **menolak** custom `jobId` yang mengandung `:` (`simulation.service.ts:120-122` — *"Custom Id cannot contain :"*), sementara `addBulk` mentolerirnya. Itu sebabnya id kickoff memakai `-` dan id stage/pos memakai `:`. Inkonsistensi ini datang dari BullMQ, bukan dari Drovery, tapi kamu akan menabraknya kalau menulis producer baru.

Sisi eksekusi lengkapnya ada di `simulation.processor.ts:371-380`. Komentar di `:371-375` menyebut dua manfaat CAS sekaligus: *"(a) skips a delivery canceled/delivered/already-advanced concurrently — closing the cancel/resurrection race — and (b) makes a re-run (retry / stalled job re-delivery) a no-op instead of a duplicate transition or regression."* Himpunan status yang sah datang dari `statusesBefore()` (`simulation.constants.ts:23-27`) yang membaca urutan siklus hidup di `STATUS_ORDER` (`:11-21`) — jadi guard-nya bisa dibaca sebagai aturan bisnis, bukan angka versi buram.

#### Konsekuensi ketiga: idempotency menentukan URUTAN operasi

Bagian ini yang biasanya baru terasa di bulan kedua, dan repo ini sudah menuliskannya. Buka dokstring `handleKickoff` di `src/deliveries/simulation/simulation.processor.ts:97-110`. Ada dua batasan urutan, dan keduanya adalah **konsekuensi langsung** dari sifat idempoten yang kamu pilih:

> ***ENQUEUE BEFORE THE CAS.** startSimulation is idempotent (deterministic jobIds dedup), so a transient enqueue failure can retry. Flipping first would consume the SCHEDULED→PENDING transition, so the retry's CAS would no-op and the lifecycle jobs would never be enqueued — stranding the delivery forever.*

Pikirkan pelan-pelan. Job kickoff punya dua efek: (a) meng-enqueue ~17 job siklus hidup, dan (b) mem-flip `SCHEDULED → PENDING` lewat CAS. Kalau kamu melakukan (b) dulu lalu (a) gagal, retry job akan menjalankan CAS-nya lagi — dan CAS itu **no-op**, karena statusnya sudah `PENDING`. Handler-mu kemudian mengembalikan sukses tanpa pernah meng-enqueue apa pun. Delivery terjebak selamanya, dan tidak ada error di mana pun. Jadi urutannya harus: yang **idempoten** (enqueue) duluan, yang **sekali-pakai** (CAS) belakangan.

Batasan kedua bahkan lebih halus:

> ***CLAIM BEFORE THE CAS, RELEASE IF THE CAS LOSES.** The aircraft claim commits on a separate, non-partitioned row, so it does not roll back with anything. If the delivery was canceled during the pre-flight, the CAS matches nothing and the airframe has to be handed back explicitly or it is held forever.*

Klaim pesawat menulis ke `drones.activeDeliveryId` — baris di tabel **lain**, di transaksi **lain** (dan itu memang harus begitu; lihat 6.8 soal kenapa unique claim tidak bisa hidup di `deliveries`). Jadi ia tidak ikut rollback dengan apa pun. Kalau CAS kalah — misalnya pelanggan membatalkan selagi pre-flight berjalan — pesawatnya harus dilepas **secara eksplisit**, atau ia hilang dari armada.

Aturan umum yang bisa kamu bawa ke fitur mana pun: **dalam handler at-least-once, letakkan operasi idempoten sebelum operasi sekali-pakai, dan setiap efek yang tidak ikut transaksi CAS-mu butuh jalur kompensasi eksplisit.** Ini bukan trivia BullMQ; ini bentuk umum dari saga.

Terakhir, perhatikan apa yang terjadi **setelah** CAS berhasil. `simulation.processor.ts:401-402` memberi aturan yang halus: *"Side effects are best-effort: a transient failure must not fail the already-applied transition (which would skip on retry via the CAS above)."* Karena CAS sudah commit, retry job **tidak akan** mengulang transisi — jadi error yang lolos ke atas akan menghilangkan notifikasi itu selamanya. Karena itu setiap efek samping dibungkus `this.safe(...)` (`:459-465`). Ini bukan "menelan error karena malas"; ini konsekuensi logis dari idempotency yang kamu pilih.

**Anchor:** `src/deliveries/simulation/simulation.service.ts:70` & `:82` (id deterministik), `:120-122` (jebakan `:` di `queue.add`), `:133-160` (`deferKickoff` — kontra-contohnya, dokstring di `:136-141`), `:178-189` (`stopSimulation` menghapus per-id, hanya mungkin karena id-nya deterministik). Sisi eksekusi: `src/deliveries/simulation/simulation.processor.ts:371-380` (CAS + komentar), `src/deliveries/simulation/simulation.constants.ts:11-27` (`STATUS_ORDER` + `statusesBefore`), `simulation.processor.ts:401-402` dan `:459-465` (`safe()`). **Urutan operasi:** `simulation.processor.ts:97-110` — dua batasan ordering yang lahir dari idempotency, ditulis lengkap dengan skenario kegagalannya.

**Kenapa dipakai di sini:** karena `attempts: 5` sudah dinyalakan. Komentar `JOB_OPTS` di `simulation.service.ts:21-22` menyatakan kontrak dua arah itu secara harfiah. Kamu tidak boleh menyalakan retry tanpa membayar dengan idempotency, dan repo ini menuliskan hutangnya di tempat hutang itu dibuat.

**Alternatif:**
- **Tabel `processed_jobs` di Postgres (ledger idempotency).** Insert id job sebagai PK sebelum memproses; P2002 = sudah diproses. Lebih umum (bekerja untuk sumber apa pun, bukan hanya BullMQ) dan bisa **co-commit** dengan tulisan bisnismu — itulah yang dipakai untuk webhook Stripe di Fase 5. Harganya: satu baris DB per job. Untuk ~17 job per delivery pada volume Drovery, itu tabel yang tumbuh lebih cepat daripada tabel delivery itu sendiri.
- **Distributed lock (Redlock / `SET NX PX`).** Mencegah dua worker mengerjakan delivery yang sama bersamaan. Harganya: lock bisa kedaluwarsa **di tengah** operasi (worker lambat, GC pause), dan kamu tetap butuh guard di DB untuk kasus itu. CAS di baris DB otoritatif tanpa asumsi apa pun tentang waktu; lock tidak.
- **`SELECT … FOR UPDATE` (pessimistic).** Benar dan mudah dipikirkan. Harganya: memegang row lock selama seluruh transaksi (termasuk selama I/O jaringan kalau kamu tidak hati-hati) dan lebih mudah deadlock saat dua job mengunci baris dalam urutan berbeda. `updateMany` bersyarat adalah optimistic CAS satu round-trip tanpa lock yang dipegang.
- **Kolom `version` (optimistic locking ala JPA).** Setara secara semantik dengan CAS status. Harganya: guard-nya jadi angka buram — `where: { version: 7 }` tidak memberitahu pembaca aturan bisnis apa pun. Repo memilih membandingkan status domain langsung supaya `statusesBefore(stage.status)` bisa dibaca sebagai spesifikasi.

**Latihan:** buktikan bahwa satu baris `if (count === 0) return;` benar-benar bernilai. Di `src/deliveries/simulation/simulation.processor.spec.ts`, tambahkan spec yang memanggil `handleStage` **dua kali** dengan payload identik terhadap mock Prisma di mana `updateMany` mengembalikan `{ count: 1 }` pada panggilan pertama dan `{ count: 0 }` pada kedua. Assert `notificationsService.create` dipanggil tepat **sekali**. Lalu hapus sementara `if (count === 0) return;` di `simulation.processor.ts:380` dan jalankan lagi: spec-mu harus **merah**. Kembalikan. Kalau spec-mu tetap hijau setelah mutasi itu, spec-mu tidak menguji apa pun — perbaiki spec-nya, bukan kodenya.

Latihan kedua (lebih menantang): tulis spec untuk `deferKickoff` yang membuktikan `jobId` berbeda di attempt 2 dan 3. Lalu ubah `simulation.service.ts:151` jadi `jobId: \`${data.deliveryId}-kickoff\`` (id lama) dan jelaskan dalam satu paragraf, dengan merujuk `:136-141`, kenapa penundaan cuaca akan berubah jadi *drop* diam-diam.

---

### 6.5 Repeatable job scheduler: N replika, satu scheduler, dan kill switch yang menghapus

Sekarang naik satu tingkat: bukan job yang dijadwalkan sekali, tapi job yang harus **berulang selamanya**. Refleks pertama siapa pun yang datang dari Node adalah `setInterval`. Masalahnya langsung terlihat begitu kamu punya tiga worker: `setInterval` jalan di **setiap** replica, jadi scan yang seharusnya jalan sekali per menit jalan tiga kali per menit — dan tiga scan itu berebut baris yang sama.

BullMQ punya primitif untuk ini: `queue.upsertJobScheduler(id, { every }, template)`. Dokstring `WatchdogScheduler` (`src/delivery-watchdog/watchdog.scheduler.ts:19-24`) menyatakan properti yang didapat: *"Uses BullMQ's job scheduler (idempotent by id + Redis-coordinated), so N worker replicas + every restart converge on EXACTLY ONE scheduler and exactly one worker runs each tick."* Idempotent **by id** — jadi lima worker yang semuanya memanggil `upsertJobScheduler('watchdog-reap', …)` saat boot menghasilkan satu scheduler, bukan lima. Dan karena state-nya di Redis, restart tidak menggandakannya.

Yang membuat bagian ini layak dibaca berulang adalah **kill switch-nya**, `src/delivery-watchdog/watchdog.scheduler.ts:37-48`. Refleks normal untuk kill switch adalah:

```ts
if (!WATCHDOG_ENABLED) return;   // ← SALAH di sini
```

Komentar di `:38-41` menjelaskan kenapa itu bug: *"the persisted scheduler survives restarts, so a bare return would leave it running."* Pikirkan alurnya. Deploy #1 dengan `WATCHDOG_ENABLED=true` menulis scheduler ke Redis. Deploy #2 dengan `WATCHDOG_ENABLED=false` — kalau kodenya cuma `return`, tidak ada yang menghapus scheduler dari deploy #1, dan reaper **tetap jalan** meski kamu yakin sudah mematikannya. Jadi jalur "disabled" harus **aktif**: `await this.queue.removeJobScheduler(SCHEDULER_ID)` (`:42`), set gauge ke 0 (`:43`), dan log warning (`:44-46`).

Itu juga menjelaskan struktur module yang kelihatan aneh. `src/delivery-watchdog/delivery-watchdog.module.ts:11-18` menghabiskan delapan baris komentar untuk satu keputusan: scheduler **selalu** didaftarkan di worker tier, **tidak** di-gate pada kill switch — *"because it owns BOTH paths: upsert the repeatable scan when enabled, and tear down a previously-persisted scheduler when WATCHDOG_ENABLED=false (a flag-gated provider would never run that teardown)."* Provider yang di-gate flag tidak akan pernah menjalankan pembersihannya sendiri. Ini pola yang bisa kamu bawa ke mana-mana: **kalau sebuah komponen memiliki state persisten, komponen itu harus tetap hidup untuk bisa membongkar state-nya.**

Kill switch-nya sendiri (`src/delivery-watchdog/watchdog.constants.ts:6-12`) juga jujur soal keterbatasannya: *"Read once at import time, so toggling it requires a worker redeploy/restart"* — dan menawarkan tuas alternatif untuk situasi yang tidak butuh teardown (melebarkan `WATCHDOG_SILENCE_MS`). Ini konsisten dengan 6.1: flag yang dibaca saat import tidak bisa di-toggle runtime, dan repo mengakuinya alih-alih berpura-pura.

Dua gauge menutup lingkaran, dan alasannya ditulis di `src/metrics/metrics.service.ts:48-51`: *"a silent scheduler/processor death is otherwise invisible. last-scan drives `time() - gauge > N`; scheduler-registered drives `max(gauge) == 0` (or absent) across the worker fleet."* Dua sinyal berbeda untuk dua kegagalan berbeda — scheduler tidak pernah terdaftar vs scheduler terdaftar tapi tidak pernah jalan. Perhatikan juga `catch` di `:69-77`: sebuah Redis hiccup saat boot tidak boleh membunuh worker, tapi gauge ditinggal di 0 supaya kegagalannya **terlihat**, dengan catatan jujur bahwa re-registrasi hanya terjadi pada restart berikutnya, bukan otomatis.

Pola yang sama persis diulang tiga kali di repo: `WatchdogScheduler`, `PartitionScheduler` (`src/partition-maintenance/partition.scheduler.ts:19-24`, `:37-48`, `:49-62`), dan `RecurringScheduler` (`src/recurring-deliveries/recurring.scheduler.ts:15-20`). Membandingkan ketiganya adalah cara tercepat melihat mana yang esensial dan mana yang kebetulan.

**Anchor:** `src/delivery-watchdog/watchdog.scheduler.ts:19-24` (dokstring: N replika → satu scheduler), `:34-35` (guard tier), `:37-48` (kill switch yang **menghapus**), `:49-62` (`upsertJobScheduler` + `removeOnComplete: { count: 50 }` sebagai heartbeat yang bisa diinspeksi), `:63-65` (gauge terdaftar), `:69-77` (fail-open saat Redis hiccup). Module: `src/delivery-watchdog/delivery-watchdog.module.ts:11-18`. Kill switch: `src/delivery-watchdog/watchdog.constants.ts:6-12`. Gauge: `src/metrics/metrics.service.ts:48-55` (komentar) dan `:160-170` (definisi). Saudara kembarnya: `src/partition-maintenance/partition.scheduler.ts:19-24` dan `src/recurring-deliveries/recurring.scheduler.ts:15-20`.

**Kenapa dipakai di sini:** karena worker tier di-autoscale. Jumlah replica-nya berubah sepanjang hari, jadi tidak ada satu pun pod yang bisa ditunjuk sebagai "yang menjalankan cron". Koordinasi harus hidup di tempat yang dilihat semua replica — Redis — dan BullMQ sudah ada di sana.

**Alternatif:**
- **`@nestjs/schedule` (`@Cron`).** Cara paling umum di Nest, nol infrastruktur tambahan, sintaksnya enak. Kegagalannya spesifik dan pasti: cron in-process jalan di **setiap** replica. Dengan 3 worker, scan per-menit jadi 3 scan per menit yang berlomba. Kamu bisa menambahinya leader election atau Redlock, tapi begitu kamu melakukannya kamu sudah menulis ulang `upsertJobScheduler` dengan lebih banyak bug.
- **Kubernetes `CronJob`.** Satu Pod per tick, terisolasi penuh, dan riwayat eksekusinya terlihat di `kubectl get jobs`. Harganya: setiap tick membayar cold start Nest penuh (koneksi DB, module graph, Prisma client) — puluhan detik untuk pekerjaan 200 ms. Itu membuat interval sub-menit tidak praktis, dan watchdog di sini jalan tiap 60 detik (`watchdog.constants.ts:14-16`).
- **`node-cron` + Redlock.** Setara secara fungsi dengan yang ada sekarang. Harganya: kamu menambahkan satu mekanisme kedaluwarsa lock untuk di-debug (berapa TTL yang aman? apa yang terjadi kalau scan lebih lama dari TTL?), dan lebih banyak kode untuk hasil yang sama.
- **`pg_cron`.** Job dijadwalkan oleh Postgres sendiri; menghilangkan Redis dari jalur ini sepenuhnya. Harganya dua: (a) ia extension yang belum tentu tersedia di Postgres terkelola mana pun — `prisma/PARTITIONING.md:80` menyebut ini sebagai alasan eksplisit repo tidak memakainya; (b) logika bisnismu pindah ke SQL, jauh dari test suite, metrik, dan structured logging yang sudah kamu punya.

**Latihan (ini bagian dari capstone).** Buat scheduler baru bergaya sama untuk membersihkan `Device` yang basi. Tiru struktur `watchdog.scheduler.ts`: konstanta `*_QUEUE` / `*_ENABLED` / `SCHEDULER_ID`, provider di-gate `IS_WORKER_TIER`, gauge `schedulerRegistered` + `lastScan` di `MetricsService`.

Satu hambatan yang **sengaja** saya biarkan: buka `prisma/schema.prisma:879-892` dan lihat model `Device`. Ia hanya punya `createdAt` — tidak ada `lastSeenAt`. Jadi "device basi" tidak punya sinyal yang jelas. Kamu punya dua jalan jujur: (a) tambahkan kolom `lastSeenAt` lewat migration dan isi dari jalur push, atau (b) definisikan basi sebagai "createdAt lebih tua dari N hari **dan** token-nya tidak pernah berhasil dipakai" dan akui keterbatasannya di komentar. Pilih salah satu dan **tulis alasannya di komentar**. Ini persis dilema yang sama yang dihadapi watchdog di 6.6, dan itulah gunanya latihan ini.

Verifikasi: jalankan **dua** worker sekaligus (`PROCESS_ROLE=worker npm run worker` di dua terminal), tunggu beberapa tick, dan konfirmasi log scan-mu hanya muncul **sekali** per tick — di terminal yang berganti-ganti, bukan di keduanya. Lalu set `<PREFIX>_ENABLED=false`, restart kedua worker, dan konfirmasi dengan `redis-cli KEYS 'bull:<queue>:repeat*'` bahwa scheduler-nya benar-benar **hilang**, bukan sekadar tidak dipanggil.

---

### 6.6 Watchdog: sistem yang menyembuhkan diri, dan seni memilih sinyal

Ini konsep favorit saya di fase ini, karena ia mengajarkan sesuatu yang tidak ada di tutorial mana pun: **memilih sinyal yang benar lebih sulit daripada menulis kodenya.**

Masalahnya: sebuah drone yang kehilangan komunikasi di tengah penerbangan meninggalkan baris `Delivery` yang terjebak di `IN_TRANSIT` selamanya. Tidak ada yang akan memindahkannya — pengirim frame-nya mati. Kalau dibiarkan, pesawatnya tidak pernah dilepas, uang pelanggan tidak pernah dikembalikan, dan armada perlahan kehabisan drone yang "sibuk". Solusinya adalah scan berkala yang mereap delivery diam.

Pertanyaan sesungguhnya: **apa artinya "diam"?** Kandidat naif adalah `delivery.updatedAt`. Komentar di `src/delivery-watchdog/delivery-watchdog.ts:47-57` membongkar kenapa itu salah — dan ini paragraf yang harus kamu baca dua kali:

> *silence is gated on the TRACKING row's updatedAt (bumped by every position frame), NOT the delivery's updatedAt (which only moves on a PHASE change). A healthy long-haul flight sits in one phase for many minutes while streaming positions, so gating on delivery.updatedAt would make every such flight a permanent candidate and could crowd a genuinely-silent delivery out of the bounded batch (and out of the asc ordering), silently defeating the reaper.*

Perhatikan bahwa bug-nya **bukan** false-positive langsung. `delivery.updatedAt` yang basi tidak langsung membuat delivery sehat di-reap — ada re-check per-baris. Bug-nya lebih halus: setiap penerbangan sehat jadi kandidat permanen, batch dibatasi `WATCHDOG_BATCH = 200`, dan urutannya `asc` — jadi delivery yang **benar-benar** mati bisa terdorong keluar dari batch oleh 200 penerbangan sehat. Watchdog-nya tidak crash, tidak error, tidak alert. Ia hanya berhenti bekerja. Ini kelas bug yang tidak akan pernah kamu temukan lewat unit test yang menguji "satu delivery, satu hasil".

Aturannya, dinyatakan di `:54-55`: *"Gate AND order on the same signal the per-row decision uses"* — gerbang SQL, urutan, dan keputusan per-baris harus memakai sinyal yang **sama**. Query-nya (`:58-77`) mewujudkan itu dengan `OR` dua cabang: ada tracking row → pakai `tracking.updatedAt`; belum ada tracking row → jatuh ke `delivery.updatedAt`.

Pelajaran kedua, dan ini bug nyata yang tercatat: **CAS harus tidak lebih lebar daripada query kandidat.** Lihat `:94-98`:

> *Pass the watchdog's OWN candidate set as the CAS gate. The default (FAILABLE_STATUSES) is wider and includes AWAITING_HANDOFF, which this scan deliberately excludes — a drone at the door is waiting, not stuck. Without this, a row selected as IN_TRANSIT that reached handoff during the scan was still failed and auto-refunded.*

`AUDIT-LOG.md:509-514` mencatat insidennya dengan kalimat yang layak ditempel di dinding: *"A delivery picked up as IN_TRANSIT that reached handoff mid-scan was failed and auto-refunded while the customer was walking outside."* Perbaikannya adalah parameter `allowedStatuses` di `src/deliveries/deliveries.service.ts:1048-1063`, yang dokstringnya menjelaskan kenapa re-check per-baris **tidak cukup**: *"The per-row recheck could not catch it: it re-reads in-memory values from the original query, not the current status."* Nilai yang kamu baca di memori sudah basi begitu kamu membacanya; hanya CAS di DB yang otoritatif.

Dan pelajaran ketiga, tentang **heartbeat yang tidak berbohong** (`:132-136`):

> *stamp last-completed-scan AFTER the loop (not in a finally), so a persistently-failing candidate read leaves the gauge stale and an alert fires.*

Kalau kamu menaruh `metrics.watchdogLastScan.set(...)` di `finally`, gauge-nya akan naik setiap tick — termasuk tick yang gagal total. Alert `time() - gauge > N` jadi tidak pernah menyala, dan kamu punya dashboard hijau di atas sistem yang mati. Heartbeat harus mengukur **kesuksesan**, bukan **kehadiran**. Nuansanya: kegagalan per-baris **tetap** boleh melanjutkan heartbeat (`:110-116` mengisolasinya), karena satu baris rusak bukan berarti sweep-nya mati.

Terakhir, ruang lingkupnya (`:28-30`): watchdog hanya menyentuh `trackingSource: LIVE`. Delivery `SIMULATED` maju lewat job BullMQ tetap, jadi ia memang sah duduk lama di `IN_TRANSIT` — dan *"a queue outage would stop the watchdog too"*, jadi mereapnya adalah false-positive murni. Memilih ruang lingkup adalah bagian dari memilih sinyal.

**Anchor:** `src/delivery-watchdog/delivery-watchdog.ts:20-31` (dokstring + kenapa LIVE-only), `:47-57` (**paragraf sinyal** — baca dua kali), `:58-77` (query kandidat dengan `OR` dua cabang), `:83-84` (re-check defensif per-baris), `:94-103` (CAS yang lebih sempit), `:110-116` (isolasi kegagalan per-baris), `:132-136` (heartbeat setelah loop, bukan di `finally`). Pasangannya: `src/deliveries/deliveries.service.ts:1048-1063` (parameter `allowedStatuses` + kenapa ia ada), `src/delivery-watchdog/watchdog.constants.ts:18-24` (`WATCHDOG_SILENCE_MS` — *"THE critical safety knob"*) dan `:35-47` (`WATCHDOG_STUCK_STATUSES` yang sengaja mengecualikan `AWAITING_HANDOFF`). Cerita bug-nya: `AUDIT-LOG.md:509-514` dan tabel mutasi di `:531`.

**Kenapa dipakai di sini:** karena ini sistem yang menggerakkan benda fisik dan memegang uang. Delivery yang terjebak berarti drone yang tidak pernah dilepas (`Drone.activeDeliveryId` tetap terisi) dan pembayaran yang tidak pernah di-refund. Tidak ada operator manusia yang memantau 24 jam. Satu-satunya cara sistem sembuh adalah dengan menyembuhkan dirinya.

**Alternatif:**
- **Alert + intervensi manual** (Prometheus alert "delivery stuck > 10 menit" → PagerDuty). Nol risiko false-positive otomatis: manusia memutuskan. Harganya konkret: MTTR jadi menit-sampai-jam alih-alih 60 detik, drone tetap terkunci selama itu, dan kamu butuh orang yang siaga. Untuk operasi kecil ini masuk akal; untuk armada yang di-autoscale, tidak.
- **TTL di Redis per delivery** (set key dengan expiry, refresh tiap frame, reaksi pada event `expired`). Reaktif dan tanpa polling — lebih hemat daripada scan tiap menit. Harganya: notifikasi keyspace Redis adalah *at-most-once* dan tidak dijamin dikirim (kalau tidak ada subscriber saat expiry, event-nya hilang), jadi kamu butuh scan cadangan juga. Kamu berakhir dengan dua mekanisme, bukan satu.
- **Kolom `expectedNextFrameAt` + index parsial, di-scan lewat `pg_cron`.** Menghilangkan tier worker dari jalur ini. Harganya: keputusan reap (yang memicu refund dan pelepasan drone) pindah ke dalam SQL, tempat ia tidak bisa memakai `DeliveriesService.failExceptional` — jadi kamu harus menduplikasi seluruh logika terminasi di plpgsql, termasuk refund-nya. Itu duplikasi yang akan hanyut.
- **Timeout di sisi drone** (firmware mengirim "aku kehilangan link" sendiri). Sinyal paling akurat kalau berhasil sampai. Kegagalan telaknya: kasus yang ingin kamu tangkap justru kasus di mana drone tidak bisa mengirim apa pun. Sinyal dari pihak yang mati bukan sinyal.

**Latihan:** jalankan `npx jest src/delivery-watchdog` dan baca nama-nama test-nya — mereka membaca seperti daftar keputusan desain (`delivery-watchdog.spec.ts:142`: *"gates silence on the TRACKING row (not phase-change time), LIVE-only, excludes AWAITING_HANDOFF, bounded"*). Lalu lakukan mutation test yang sama dengan yang dicatat `AUDIT-LOG.md:531`: hapus argumen ketiga di pemanggilan `failExceptional` (`delivery-watchdog.ts:99-103`) supaya CAS kembali ke default yang lebih lebar, dan jalankan spec-nya. Test mana yang mati? Kembalikan.

Mutasi kedua, yang lebih menusuk: pindahkan `this.metrics.watchdogLastScan.set(...)` dari `:136` ke dalam blok `finally` yang membungkus seluruh `scanAndReap`. Semua test tetap hijau. Tulis spec baru yang **menangkap** mutasi itu (petunjuk: buat `prisma.delivery.findMany` melempar, lalu assert gauge **tidak** di-set). Itulah cara menemukan lubang test dan menutupnya — dan itu keterampilan yang lebih bernilai daripada konsep watchdog itu sendiri.

---

### 6.7 Health check: liveness vs readiness, dan kenapa membedakannya menyelamatkan armada

Ini konsep paling kecil di fase ini dan paling sering disalahpahami. Dari dunia mobile, padanan terdekatnya adalah dua pertanyaan berbeda tentang aplikasimu: "prosesnya masih hidup?" (kalau tidak, OS membunuhnya) versus "sudah siap menerima interaksi?" (kalau belum, splash screen ditahan). Di server, dua pertanyaan itu dijawab oleh dua endpoint dengan **konsekuensi yang berbeda secara radikal**.

- `GET /health` — **liveness**. Jawaban: "proses ini hidup." Kalau gagal, orchestrator **me-restart pod**.
- `GET /health/ready` — **readiness**. Jawaban: "boleh dikirimi traffic." Kalau gagal, orchestrator hanya **menarik pod dari Service** — tidak me-restart.

Sekarang bayangkan kamu menaruh cek database di liveness, dan Postgres berkedip 5 detik. Setiap pod di armada gagal liveness bersamaan, setiap pod di-restart bersamaan, dan saat Postgres kembali, kamu punya nol pod siap plus badai koneksi dari boot serentak. Kamu baru saja mengubah gangguan 5 detik jadi outage penuh. Itulah kenapa `src/health/health.controller.ts:17-26` (liveness) tidak menyentuh dependensi apa pun — ia hanya mengembalikan `uptime` dan timestamp.

Readiness (`:28-39`) melakukan sebaliknya: memanggil `healthService.check()` dan melempar `ServiceUnavailableException` (503) kalau ada yang mati. `src/health/health.service.ts:19-25` menjalankan kedua cek **paralel** dengan `Promise.all` — DB dan Redis, bukan berurutan, supaya latensi probe adalah maksimum dari keduanya, bukan jumlahnya. Dan `:27-34` sengaja `catch` → `false` alih-alih melempar, supaya endpoint mengembalikan status **terstruktur** (`{ database: false, redis: true }`) alih-alih stack trace. Perbedaan itu penting saat jam 3 pagi: kamu ingin tahu *yang mana* yang mati.

Detail berikutnya yang mudah terlewat: `src/health/health.controller.ts:9-13` memasang `@PublicApi()` dan `@SkipThrottle()`, dengan alasan tertulis — *"Public + un-throttled so orchestrator probes (k8s/load balancers) aren't blocked by auth or rate limits."* Probe tidak punya JWT, dan probe yang menabrak rate limiter akan melaporkan pod sehat sebagai mati.

Dan sekarang pertanyaan yang menyatukan 6.7 dengan 6.2: **apa probe untuk tier worker?** Worker tidak punya Express, jadi `/health` tidak ada di sana — server HTTP mentahnya hanya menjawab `/metrics` dan mengembalikan 404 untuk apa pun yang lain (`src/worker.ts:45-61`). Repo menjawabnya di `k8s/base/worker-deployment.yaml:39-48`, dan komentarnya layak dikutip utuh:

> *NO httpGet probes: the worker is a Nest application context with no HTTP server on :3000 — an httpGet /api/v1/health probe would always fail and drive it into CrashLoopBackOff. A cheap exec startupProbe catches a hung boot; the metrics port is for scraping, not health. (worker.ts exits non-zero on boot failure, so the kubelet restarts a dead process anyway.)*

Perhatikan tiga keputusan di dalamnya. Pertama, menyalin probe api ke worker adalah kesalahan yang **menghasilkan CrashLoopBackOff**, bukan sekadar probe yang tidak berguna. Kedua, port metrics **bukan** port health — menyalahgunakannya untuk liveness berarti scrape yang lambat bisa me-restart pod. Ketiga, kesehatan worker sebagian besar sudah dijaga oleh dua hal yang sudah kamu punya: proses yang keluar dengan kode non-zero saat boot gagal (`src/worker.ts:83-86`), dan gauge `schedulerRegistered` + `lastScan` dari 6.5. Untuk worker, **metrik adalah health check-nya** — dan itulah kenapa gauge di 6.5 bukan hiasan.

**Anchor:** `src/health/health.controller.ts:9-13` (`@PublicApi()` + `@SkipThrottle()` + alasannya), `:17-26` (liveness, nol dependensi), `:28-39` (readiness, 503). `src/health/health.service.ts:19-25` (`Promise.all`), `:27-34` (`catch` → `false`). Sisi worker: `k8s/base/worker-deployment.yaml:39-48` (**kenapa tidak ada `httpGet` probe sama sekali**) dan `src/worker.ts:83-86` (exit non-zero saat boot gagal). Analogi Compose-nya sudah kamu pakai: `docker-compose.yml:60-64` (healthcheck Redis) dan `:135-141` (`depends_on: condition: service_healthy`) — konsep yang sama, satu tingkat lebih rendah.

**Kenapa dipakai di sini:** repo ini punya tiga tier yang di-deploy sebagai Deployment terpisah dan di-scale otomatis. Rolling deploy hanya benar kalau orchestrator tahu kapan pod baru siap menerima traffic (readiness) — kalau tidak, ia mematikan pod lama sebelum yang baru bisa melayani. Dan restart-vs-drain harus dibedakan, atau kamu mendapat skenario armada di atas.

**Alternatif:**
- **`@nestjs/terminus`** (paket health-check resmi Nest). Punya indicator siap pakai untuk Prisma, HTTP, disk, dan memori, plus format response standar. Harganya di sini: satu dependensi + satu lapisan abstraksi untuk dua cek yang totalnya 15 baris. Ambil terminus kalau kamu punya delapan dependensi untuk dicek dan ingin format yang konsisten; tulis tangan kalau dua.
- **Satu endpoint `/health` saja.** Lebih sederhana, satu URL untuk dihafal. Harganya adalah tepat pemisahan restart-vs-drain di atas. Rolling deploy jadi kasar dan blip dependensi jadi restart massal.
- **`startupProbe` terpisah (k8s).** Berguna kalau boot lama — misal migrasi berjalan saat start — supaya liveness tidak membunuh pod yang masih booting. Di sini boot cepat dan migrasi dijalankan sebagai Job terpisah (`docker-compose.yml:140-141`, `migrate: condition: service_completed_successfully`), jadi tidak diperlukan.

**Latihan:** jalankan API, lalu:

```bash
curl -s localhost:3000/api/v1/health | jq
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/v1/health/ready   # 200
docker compose stop redis
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/v1/health/ready   # 503
curl -s localhost:3000/api/v1/health | jq                                      # tetap 200
```

Baris terakhir itu intinya: liveness tetap hijau saat Redis mati. Jelaskan dalam satu kalimat kenapa itu **perilaku yang benar**, bukan bug. Lalu, latihan yang lebih dalam: tambahkan cek MQTT ke readiness **tanpa** membuat readiness gagal saat MQTT sengaja dimatikan. Petunjuk: `MqttService.isMock()` (`src/mqtt/mqtt.service.ts:46-48`) harus dianggap sehat — hanya `isMock() === false && isConnected() === false` yang layak dilaporkan. Tulis spec-nya dan tulis di komentar kenapa itu tidak boleh mengembalikan 503 (petunjuk ada di `src/mqtt/mqtt.service.ts:20-29`: MQTT di repo ini fail-open, bukan dependensi kritis).

---

### 6.8 RANGE partitioning: retensi O(1), dan harga berantai composite PK

Ganti topik total: dari proses ke penyimpanan. Tidak ada padanan React untuk ini — ini murni PostgreSQL, dan saya tidak akan mengarang analogi yang menyesatkan. Yang bisa saya lakukan adalah menyebut idenya dulu, lalu harganya.

**Idenya:** satu tabel logis dipecah menjadi banyak tabel fisik, satu per bulan. `notifications` menjadi `notifications_y2026m06`, `notifications_y2026m07`, dan seterusnya, plus satu `notifications_default` sebagai jaring pengaman. Aplikasimu tetap menulis ke `notifications`; PostgreSQL yang merutekan baris ke anak yang benar berdasarkan `createdAt`. Manfaatnya dua: **pruning** (query per rentang waktu hanya menyentuh partisi relevan) dan — motivasi utama di sini — **retensi O(1)**. `prisma/migrations/20260801053057_add_flight_frames/migration.sql:8-11` menyatakannya untuk tabel dengan volume tertinggi:

> *this is the highest-volume table in the system by a wide margin — one row per telemetry tick… Retention has to be able to bare-DROP an aged month in O(1); an O(rows) cascade DELETE on a flight recorder is not a viable retention story.*

`DELETE FROM flight_frames WHERE recordedAt < now() - interval '6 months'` pada tabel 200 juta baris adalah operasi berjam-jam yang menghasilkan bloat dan menuntut `VACUUM`. `DROP TABLE flight_frames_y2026m02` adalah operasi metadata. Itu selisihnya.

**Harganya** dinyatakan dalam satu kalimat di `prisma/PARTITIONING.md:59-61`:

> *A range-partitioned table **requires the partition key in every unique/PK constraint.**

Dan dari satu kalimat itu, riaknya menyebar ke tempat-tempat yang kelihatannya sama sekali tidak berhubungan. Inilah rantainya — hafalkan bentuknya, karena ini pola yang akan kamu temui di setiap sistem yang memartisi:

1. **PK jadi composite.** `prisma/schema.prisma:352` — `@@id([id, createdAt])`, dengan `id` di depan supaya lookup by-id masih memakai index PK tiap anak.
2. **`findUnique({ where: { id } })` mati sebagai COMPILE error.** `prisma/PARTITIONING.md:62-65`: *"There is no single-column `id` unique anymore. `findUnique/update/delete({ where: { id } })` on a partitioned model won't compile."* Sekitar 22 call-site harus ditulis ulang jadi `findFirst` / `updateMany` / composite `id_createdAt`. Ini sebenarnya kabar **baik**: kompiler jadi jaring pengamanmu, dan `npm run build` menemukan setiap tempat yang terlewat.
3. **`trackingId @unique` tidak mungkin lagi** (tidak memuat partition key) → lahirlah `TrackingIdRegistry` (`prisma/schema.prisma:359-374`), tabel kecil **tidak** terpartisi yang memegang keunikan global. Yang cerdik: duplikat tetap memicu P2002 pada PK registry, jadi loop retry lama di `create()` tetap jalan tanpa perubahan.
4. **Setiap tabel anak butuh kolom `deliveryCreatedAt` + composite FK.** Lihat `prisma/migrations/20260619140000_partition_deliveries/migration.sql:28-32` (penambahan kolom + backfill) dan `:96-112` (enam composite FK ke `("id","createdAt")`).
5. **`Drone.activeDeliveryId` diletakkan di tabel `drones`, bukan `deliveries`.** `prisma/schema.prisma:178-182` menjelaskan: *"that table is RANGE-partitioned, and a partitioned table cannot carry a unique index that does not include its partition key."* Kalau di Fase 5 kamu bertanya kenapa lock claim ada di sisi drone, ini jawabannya.

Dan **partisi DEFAULT** adalah jaring pengaman yang membuat semua ini aman dioperasikan: `prisma/migrations/20260616120000_partition_notifications/migration.sql:135-137` membuat `notifications_default` yang menangkap `createdAt` apa pun, *"so an insert can NEVER fail with 'no partition found' even if maintenance lags."* Tanpa itu, maintenance yang telat = insert yang error. Dengan itu, maintenance yang telat = baris parkir sementara yang nanti dipindahkan.

Terakhir, dua aturan operasional keras di `prisma/PARTITIONING.md:66-71`: `prisma db push` **dan** `prisma db pull` dilarang. `push` akan mengubah tabel terpartisi jadi tabel biasa (menghapus datamu dalam prosesnya); `pull` tidak bisa merepresentasikan `PARTITION BY` dan malah memunculkan setiap partisi anak sebagai model Prisma tersendiri. Gerbangnya adalah CI drift check (`:72-76`).

**Anchor:** urutan baca yang saya sarankan, dari yang paling sederhana:
1. `prisma/schema.prisma:894-903` — komentar model `Notification`, kasus paling sederhana, seluruh kontrak dalam 10 baris.
2. `prisma/migrations/20260801053057_add_flight_frames/migration.sql:1-16` — dipartisi sejak lahir, tidak ada copy-swap yang mengaburkan idenya; catat peringatan di `:13-16` soal kolom `recordedAt` yang **bukan** partition key.
3. `prisma/migrations/20260616120000_partition_notifications/migration.sql:114-148` — copy-swap referensi (rename → create parent → DEFAULT → backfill → drain → drop).
4. `prisma/migrations/20260619140000_partition_deliveries/migration.sql:1-13` (WHY), `:15-26` (registry), `:28-32` (kolom anak), `:88-94` (DEFAULT + backfill + ensure), `:96-112` (composite FK) — perubahan paling invasif.
5. `prisma/PARTITIONING.md:57-79` sebagai daftar aturan, dan `:7-20` sebagai tabel enam tabel terpartisi.

Plus: `prisma/schema.prisma:281-289` (komentar `Delivery`), `:352` (`@@id`), `:359-374` (`TrackingIdRegistry`), `:178-182` (`Drone.activeDeliveryId`).

**Kenapa dipakai di sini:** karena `flight_frames` menulis satu baris per telemetry tick, dan `deliveries` adalah induk dari enam tabel anak. Tanpa partisi, retensi berarti cascade DELETE lintas tujuh tabel; dengan partisi, ia bisa jadi urutan `DROP TABLE`. `prisma/PARTITIONING.md:80` juga menegaskan pilihan sadar untuk tidak memakai extension: *"Maintenance (no pg_partman / pg_cron)"*.

**Alternatif:**
- **Satu tabel besar + index pada `createdAt`.** Paling sederhana, nol aturan baru, `findUnique` tetap hidup. Harganya muncul saat retensi: `DELETE` besar menghasilkan dead tuple dalam jumlah masif, autovacuum tertinggal, tabel membengkak, dan query planner mulai memilih rencana yang buruk. Plus tidak ada pruning — setiap query rentang-waktu menyentuh seluruh index.
- **Partisi `HASH(userId)`.** Distribusi baris rata (bagus untuk beban tulis paralel), dan tidak ada masalah "partisi bulan depan belum ada". Harganya telak untuk kasus ini: kamu **tidak bisa** menghapus data lama per-partisi, karena data lama tersebar merata di semua partisi. Partisi RANGE dipilih justru karena retensi, bukan karena beban.
- **Arsip ke object storage lewat job bulanan.** Retensi tanpa DDL rumit sama sekali, dan storage-nya jauh lebih murah. Harganya: query historis jadi jalur khusus (tidak bisa `SELECT` biasa), dan kamu butuh format arsip + kode restore yang harus diuji secara berkala.
- **`pg_partman` + `pg_cron`.** Standar industri, matang, jauh lebih sedikit kode untuk dirawat. Harganya dinyatakan repo secara eksplisit: keduanya extension yang belum tentu tersedia di Postgres terkelola, dan scheduler-nya hidup **di dalam database** — di luar jangkauan metrik, log terstruktur, dan alert yang sudah kamu punya di tier worker.

**Latihan:** jalankan skrip verifikasinya dan baca setiap assertion-nya.

```bash
psql "${DATABASE_URL%%\?*}" -v ON_ERROR_STOP=1 -f scripts/verify-partitions.sql
```

`scripts/verify-partitions.sql:7-11` menuliskan lima hal yang dibuktikan: struktur partisi, routing per bulan, penangkapan DEFAULT, penyembuhan lewat drain, dan drop retensi yang tidak pernah menyentuh DEFAULT. Semuanya non-destruktif (transaksi yang di-`ROLLBACK`).

Lalu, di `psql`, jawab satu pertanyaan sendiri:

```sql
INSERT INTO notifications (id, "userId", title, body, "createdAt")
VALUES (gen_random_uuid()::text, '<user-id-yang-ada>', 't', 'b', now() + interval '5 months');

SELECT tableoid::regclass FROM notifications WHERE title = 't';
```

Di partisi mana ia mendarat, dan **kenapa**? (Petunjuk: `PARTITION_MONTHS_AHEAD` default 3.) Terakhir, buka `src/notifications/notifications.service.ts` dan cari `markAsRead` — perhatikan ia memakai `updateMany` dengan scope `(id, userId)`, bukan `findUnique`. Coba ubah jadi `findUnique({ where: { id } })` dan jalankan `npx tsc --noEmit`: kamu akan melihat compile error yang dijanjikan `PARTITIONING.md:62-65`. Itu jaring pengamannya bekerja di depan matamu.

---

### 6.9 Maintenance partisi: DDL sebagai pekerjaan terjadwal

Partisi bukan fitur *set-and-forget*. Partisi bulan depan harus dibuat **sebelum** bulan depan tiba, dan partisi yang kedaluwarsa harus dibuang. Di repo ini pekerjaan itu adalah repeatable job BullMQ yang jalan tiap 6 jam (`src/partition-maintenance/partition.constants.ts:14-15`) — pemakaian job queue yang paling tidak terduga dan paling mengajarkan: **job bukan cuma untuk mengirim email.**

Alurnya per tabel per tick ada di `src/partition-maintenance/partition-maintenance.service.ts:31-56`, dan urutannya penting:

1. **`partition_drain_default(table)`** — pindahkan baris yang terlanjur parkir di DEFAULT ke anak bulanan yang benar. `prisma/PARTITIONING.md:86-89` menjelaskan kenapa ini **jalan pertama**: *"a bare `CREATE … PARTITION OF` fails when the DEFAULT already holds in-range rows, so the routine builds the child standalone, moves the rows, then ATTACHes."*
2. **`partition_ensure(table, PARTITION_MONTHS_AHEAD)`** — buat bulan berjalan + N bulan ke depan (default 3, ~90 hari runway).
3. **`partition_drop_old(table, retain)`** — hanya kalau retensi > 0.

Empat detail yang mengubah ini dari "kode maintenance biasa" jadi bahan belajar:

**(a) Race ATTACH-vs-INSERT, dan pelajaran lock mode terbaik di repo.** Baca `prisma/migrations/20260616121000_partition_attach_lock/migration.sql:1-22` utuh — 22 baris komentar yang menceritakan satu skenario lengkap. Ringkasnya: `attach_month` membangun anak standalone, `DELETE` baris in-range dari DEFAULT, lalu `ATTACH` (yang memindai DEFAULT untuk membuktikan tidak ada baris in-range tersisa). Dalam recovery yang telat — jendela forward habis, jadi anak bulan **berjalan** harus di-attach sementara insert terus datang — sebuah `INSERT` bisa commit ke DEFAULT persis di antara `DELETE` dan pemindaian `ATTACH`. `ATTACH` gagal, tick di-rollback, dan di bawah beban tulis berkelanjutan anak itu **mungkin tidak pernah ter-attach**.

Perbaikannya: `LOCK TABLE … IN SHARE ROW EXCLUSIVE MODE` pada DEFAULT **sebelum** `DELETE`. Kenapa mode itu tepat, dijelaskan di `:13-16`: ia konflik dengan `ROW EXCLUSIVE` (mode yang diambil `INSERT`) tapi **tidak** dengan `SELECT`. Jadi pembacaan tetap jalan, penulisan ditahan sebentar. Dan karena `DELETE` jalan **setelah** lock didapat, insert yang sempat commit selagi kita menunggu ikut terkuras. Tidak perlu retry. Catatan penutup di `:19-20` juga penting: scheduler single-worker berarti tidak ada kontensi maintenance-vs-maintenance, dan penulis biasa tidak pernah mengambil `SHARE ROW EXCLUSIVE`, jadi tidak ada deadlock dengan jalur insert.

**(b) Self-discovery kolom partisi — dan bug yang nyaris menghapus bulan yang salah.** `prisma/migrations/20260620160000_partition_routines_self_discover/migration.sql:6-13`:

> *Until now the routines hard-coded the literal "createdAt". That is WRONG for the children (their partition key is "deliveryCreatedAt"), and actively DANGEROUS for drone_commands, which has BOTH a "createdAt" audit column AND the "deliveryCreatedAt" partition key — the unfixed partition_drop_old would DELETE the wrong month.*

Rutinnya sekarang membaca `pg_partitioned_table.partattrs[0]` dari katalog. Pelajarannya melampaui partisi: **jangan menebak identitas kolom dari namanya**; tanyakan ke katalog.

**(c) `drop_old` bercabang berdasarkan ada-tidaknya FK masuk** (`prisma/migrations/20260620160000_partition_routines_self_discover/migration.sql:126-137`). Tanpa FK masuk → `DROP TABLE` O(1). Dengan FK (seperti `deliveries`) → `DELETE` sebulan lewat induk supaya cascade fan-out ke setiap anak, baru `DETACH` + `DROP`. Itu juga alasan **urutan array** di `src/partition-maintenance/partition.constants.ts:31-37`: anak-anak ko-partisi didaftarkan **sebelum** `deliveries`, supaya saat giliran `deliveries` tiba, lebih sedikit baris anak yang tersisa untuk di-cascade. Komentarnya tegas soal ini urusan **biaya**, bukan **kebenaran**.

**(d) `??`, bukan `||`.** Ini satu karakter yang layak satu subbagian sendiri. `partition.constants.ts:64-75`:

> *A per-table `retainMonths` wins over the global default INCLUDING an explicit 0 (never drop) — so `??`, never `||`. That single character is the whole difference between "audit history is never dropped" and "it is dropped whenever somebody tunes telemetry retention".*

Mekanismenya: `0 || 3 === 3`, tapi `0 ?? 3 === 0`. `admin_audit_logs` mem-pin `retainMonths: 0` (`:60`) justru supaya ia **tidak pernah** dibuang. Satu-satunya tabel yang volumenya akan memotivasi menyalakan retensi adalah `flight_frames`; tanpa override ini, menyetel retensi telemetri diam-diam ikut menghapus riwayat tindakan operator.

Observabilitasnya juga ditulis sebagai bagian desain, bukan tambahan. `partition-maintenance.service.ts:83-96` menempatkan pembacaan gauge `partitionDefaultRows` di `try` **sendiri**, dengan alasan: itu **sinyal kegagalan otoritatif** (baris masih parkir di DEFAULT = maintenance tertinggal), jadi kegagalan drain/ensure di atasnya tidak boleh membuatnya basi. Sementara heartbeat `partitionLastScan` (`:99-103`) hanya mendeteksi sweep yang **mati total** — komentarnya mengakui batas itu secara eksplisit. Dan `:57-66` menambahkan counter `partitionMaintenanceFailures` dengan catatan bagus: *"the swallow must be OBSERVABLE"* — try/catch per-tabel yang benar tetap harus meninggalkan jejak yang bisa di-alert.

**Anchor:** `src/partition-maintenance/partition-maintenance.service.ts:11-21` (dokstring: kenapa multi-replica safe), `:31-56` (drain → ensure → drop_old), `:41-43` (komentar `??`), `:57-66` (per-table catch + counter), `:83-96` (gauge otoritatif di `try` sendiri), `:99-103` (heartbeat + batasnya), `:106-122` (`callFn` dan kenapa nama fungsi dari allowlist literal). `src/partition-maintenance/partition.constants.ts:31-37` (**urutan array**), `:51-62` (daftar tabel + `admin_audit_logs` pinned 0), `:64-75` (`retentionFor` + `??`). SQL: `prisma/migrations/20260616121000_partition_attach_lock/migration.sql:1-22`, `prisma/migrations/20260620160000_partition_routines_self_discover/migration.sql:6-13` dan `:126-137`, `prisma/migrations/20260616120000_partition_notifications/migration.sql:17-112` (empat rutin). Runbook: `prisma/PARTITIONING.md:80-108`, `:119-126`, `:127-132`.

**Kenapa dipakai di sini:** karena repo memilih **tidak** memakai `pg_partman`/`pg_cron` (`PARTITIONING.md:80`), maka maintenance harus hidup di suatu tempat. Menaruhnya di tier worker berarti ia mewarisi seluruh infrastruktur yang sudah ada: koordinasi single-runner dari BullMQ, structured logging, metrik Prometheus, dan alert. `partition-maintenance.service.ts:19-21` menyebutnya: *"multi-replica safe because the scheduler runs exactly one tick at a time and the SQL is idempotent."*

**Alternatif:**
- **`pg_partman` + `pg_cron`.** Matang dan teruji; ratusan baris kodemu jadi beberapa baris konfigurasi. Dua harga konkret: keduanya extension yang harus di-install (RDS punya, beberapa layanan terkelola lain tidak), dan schedulernya hidup di dalam DB — kegagalannya tidak muncul di dashboard Grafana-mu dan tidak memicu alert yang sudah kamu punya.
- **Cron OS / Kubernetes CronJob yang memanggil `psql`.** Tidak butuh extension, dan sederhana untuk dibaca. Harganya: jalur deploy kedua dengan logging, metrik, dan alert terpisah — persis fragmentasi yang membuat "kenapa retensi tidak jalan bulan lalu?" jadi pertanyaan sulit.
- **Membuat partisi manual saat deploy.** Nol otomatisasi, nol komponen bergerak. Gagal telak saat tidak ada deploy selama sebulan — dan itu skenario yang normal untuk sistem stabil. Partisi DEFAULT menyelamatkan datamu (tidak ada insert yang error), tapi performanya jatuh karena semua tulisan baru masuk ke satu tabel yang tumbuh terus.
- **`DETACH PARTITION CONCURRENTLY` + arsip sebelum `DROP`.** Ini yang **direkomendasikan repo untuk produksi** (`prisma/PARTITIONING.md:156-162` dan komentar di `prisma/migrations/20260616120000_partition_notifications/migration.sql:86-89`). Lebih lambat, tapi tidak mengambil `ACCESS EXCLUSIVE` lock berat dan datanya masih bisa dipulihkan. Yang ada sekarang adalah versi dev-scale dari ini, dan repo mengatakannya terus terang.

**Latihan:**

```bash
npx jest src/partition-maintenance
```

Baca spec-nya — nama test-nya menjelaskan desainnya (`partition-maintenance.service.spec.ts:71`: *"isolates a per-table failure, increments the failure counter (alertable), and still stamps the heartbeat"*). Perhatikan bahwa test untuk `retentionFor` **sudah ada** di `:98-110`; jadi tugasmu bukan menulisnya, tapi membuktikan ia bernilai: ubah `??` jadi `||` di `partition.constants.ts:74`, jalankan lagi, dan konfirmasi test di `:99-105` **merah**. Kembalikan.

Lalu di `psql`:

```sql
SELECT partition_ensure('notifications', 6);   -- berapa anak baru dibuat?
SELECT partition_ensure('notifications', 6);   -- harus 0 — idempoten
```

Terakhir, latihan membaca lock: buka dua sesi `psql`. Di sesi A, `BEGIN; LOCK TABLE notifications_default IN SHARE ROW EXCLUSIVE MODE;` (jangan commit). Di sesi B, coba `INSERT` satu notification — ia akan menunggu. Lalu di sesi B lain, coba `SELECT count(*) FROM notifications_default` — ia **jalan**. Itulah tepatnya properti yang dipilih `prisma/migrations/20260616121000_partition_attach_lock/migration.sql:13-16`, sekarang kamu lihat sendiri. `ROLLBACK` di sesi A.

---

### 6.10 Seam "real-or-mock": satu pola untuk Stripe, MQTT, mail, dan storage

Konsep ini paling pendek tapi paling sering kamu pakai. Dari duniamu, padanan terdekatnya adalah plugin Capacitor yang punya implementasi web fallback: kodemu memanggil `Camera.getPhoto()` dan di browser ia membuka file picker alih-alih kamera native. Bedanya di sini adalah keputusannya tidak diambil oleh platform, melainkan oleh **ada-tidaknya sebuah env var**.

Polanya identik di empat tempat:

| Service | Sinyal | Anchor |
|---|---|---|
| Stripe | `STRIPE_SECRET_KEY` kosong | `src/stripe/stripe.service.ts:37-49` |
| MQTT | `MQTT_URL` kosong | `src/mqtt/mqtt.service.ts:46-48` + `:54-62` |
| Storage | `storage.provider` kosong | `src/storage/storage.service.ts:19-21` |
| Mail | `mail.provider` kosong | `src/mail/mail.service.ts:85-95` |

Dokstring `StripeService` (`src/stripe/stripe.service.ts:22-29`) menyebutnya sebagai pola standar codebase: *"When it is empty (dev/demo), the same methods return deterministic fake objects so the whole payment flow is exercisable without keys. Set keys in .env to go live — **no code change required**."* Kata kuncinya **deterministic** dan **no code change**. Ini bukan stub yang mengembalikan `null`; ia mengembalikan objek berbentuk benar sehingga alur pembayaran lengkap bisa dijalani.

`MqttService` menambahkan dimensi kedua: bukan hanya mock, tapi **fail-open**. Dokstringnya (`src/mqtt/mqtt.service.ts:20-29`) menyatakan dua kontrak sekaligus — inert saat `MQTT_URL` unset, *"so the default config + the whole test suite are untouched"*; dan saat URL ada tapi broker mati, *"a down broker degrades to HTTP-only, never crashes the process or blocks a request."* Bahkan `connect()` dibungkus try/catch (`:64-66`) karena URL yang malformed melempar **sinkron** dan akan membunuh `NestFactory` boot.

Efek praktis yang bisa kamu ukur sekarang: `npm test` jalan tanpa kunci Stripe, tanpa broker MQTT, tanpa bucket S3, tanpa SMTP. Itu properti yang menentukan apakah CI-mu bisa dijalankan orang baru di hari pertama.

Kaitannya dengan Fase 6: worker tier meng-inject `NotificationsService` dan `StripeService` juga. Kalau seam ini tidak ada, kamu tidak bisa menjalankan `PROCESS_ROLE=worker npm run worker` di laptop tanpa kredensial produksi — dan seluruh capstone fase ini mustahil.

**Anchor:** `src/stripe/stripe.service.ts:22-29` (dokstring yang menyebutnya pola standar) + `:37-49` (konstruktor memutuskan `isMock`). `src/mqtt/mqtt.service.ts:20-29` (dokstring inert + fail-open), `:46-48` (`isMock()`), `:54-62` (`onModuleInit` yang `return` lebih awal dengan log jelas), `:64-66` (try/catch di sekitar `connect`). `src/storage/storage.service.ts:19-21` dan `src/mail/mail.service.ts:85-95` — pola yang sama, dan perhatikan komentar jujur di `mail.service.ts:86-89` tentang risiko keamanan cabang dev-log itu di produksi.

**Kenapa dipakai di sini:** karena repo ini punya empat integrasi eksternal dan satu tujuan: siapa pun harus bisa `git clone` lalu `npm test` tanpa satu pun kredensial. `MqttModule` menegaskan sisi operasionalnya — inert kecuali `MQTT_URL` di-set.

**Alternatif:**
- **DI token + provider berbeda per environment** (`StripeRealService` vs `StripeMockService`, dipilih di module factory). Lebih bersih secara OOP, dan mock-nya tidak membawa kode real ke bundle. Harganya: menggandakan permukaan yang harus diuji (dua class harus tetap sinkron saat interface berubah) dan setiap unit test harus tahu provider mana yang aktif.
- **Library HTTP-mock (`nock` / `msw`).** Kontrol paling halus atas respons palsu, termasuk mensimulasikan error dan latensi — jelas lebih baik untuk *test*. Harganya: tidak menolong sama sekali saat `npm run start:dev` lokal; developer tetap butuh kunci asli untuk klik-klik alur di browser. Repo memilih mock yang hidup di **runtime**, bukan hanya di test.
- **Testcontainers (broker/DB sungguhan di Docker per test).** Fidelitas tertinggi — kamu menguji terhadap Mosquitto asli. Harganya: setiap suite membayar startup container (detik, bukan milidetik) dan CI wajib punya Docker daemon. Repo memakai broker asli hanya di `docker-compose.yml`, tidak di unit test.

**Latihan:** tambahkan seam yang sama untuk provider SMS fiktif. Buat `src/sms/sms.service.ts` dengan `get isMock()` yang membaca `config.get('sms.provider')`, daftarkan `sms: { provider: … }` di `src/config/configuration.ts`, lalu tulis spec yang membuktikan bahwa tanpa env apa pun `send()` hanya mencatat log dan **tidak pernah** `throw`. Bandingkan hasilmu dengan `src/mail/mail.service.spec.ts`. Verifikasi akhir: `npm test` tetap hijau setelah kamu menghapus seluruh isi `.env` kecuali `DATABASE_URL`.

---

### 6.11 Alternatif yang dibandingkan: peta keputusan fase ini

Subbagian ini bukan konsep baru — ini rekap yang sengaja dipisah, karena kamu meminta "apa alternatifnya" dan jawaban terbaik untuk pertanyaan itu adalah **satu tabel yang bisa kamu bantah**. Setiap baris di bawah sudah dibahas di atas; yang ditambahkan di sini adalah *kapan pilihan repo ini akan salah*.

| Keputusan repo | Alternatif utama | Kapan alternatifnya lebih baik |
|---|---|---|
| BullMQ (Redis) untuk delayed job | `setTimeout` / `@nestjs/schedule` | Job yang boleh hilang saat restart dan hanya jalan di satu proses — mis. cache warmer lokal. |
| BullMQ | `pg-boss` (queue di Postgres) | Kamu butuh enqueue yang **co-commit** dengan transaksi bisnis, dan volume job-nya rendah relatif terhadap kapasitas primary. |
| BullMQ | RabbitMQ / NATS | Kamu butuh topologi routing (topic/fanout exchange), dead-letter queue asli, atau konsumen di bahasa lain. |
| BullMQ | SQS + EventBridge | Kamu sudah all-in di AWS, tidak mau mengoperasikan Redis, dan granularitas delay ≥15 menit cukup. |
| `upsertJobScheduler` | `@nestjs/schedule` `@Cron` | Kamu hanya punya **satu** replica dan yakin akan tetap begitu. |
| `upsertJobScheduler` | k8s `CronJob` | Interval ≥ 15 menit, dan kamu ingin isolasi + riwayat eksekusi per-tick. |
| `upsertJobScheduler` | `pg_cron` | Pekerjaannya murni SQL, dan kamu punya extension-nya. |
| Partisi RANGE manual | `pg_partman` + `pg_cron` | Extension tersedia, dan kamu lebih suka sedikit kode daripada observabilitas terpadu. |
| Tiga tier di satu image | Repo terpisah per tier | Tim berbeda memiliki tier berbeda, dan kode domain yang dibagikan sedikit. |
| Tiga tier di satu image | Monorepo Nx/Turborepo | Kamu punya >3 aplikasi yang benar-benar berbeda, bukan tiga cara mem-boot satu aplikasi. |
| Health check tulis tangan | `@nestjs/terminus` | Kamu punya banyak dependensi untuk dicek dan ingin format response standar. |
| Seam `isMock` di runtime | `nock` / `msw` di test | Kamu butuh mensimulasikan error/latensi provider secara presisi dalam test. |

**Latihan:** pilih **dua** baris dari tabel ini yang menurutmu keputusan repo-nya paling bisa dibantah, dan tulis satu paragraf per baris yang berargumen untuk alternatifnya — dengan merujuk anchor di repo, bukan opini umum. Ini bukan latihan retorika: kalau kamu tidak bisa membangun kasus tandingannya, kamu belum benar-benar memahami trade-off-nya.

---

## Capstone

Tiga bukti yang harus **berjalan**, bukan dipahami. Semuanya bisa gagal di depan matamu, dan itu memang tujuannya.

### Bukti 1 — Durabilitas: bunuh API di tengah penerbangan

- [ ] Dua terminal jalan: `PROCESS_ROLE=api npm run start:dev` dan `PROCESS_ROLE=worker npm run worker`.
- [ ] Kamu bisa menunjukkan (dengan `console.log` di `deliveries.module.ts:44` atau dengan log boot) bahwa `RUN_PROCESSOR` bernilai berbeda di dua terminal.
- [ ] Buat satu delivery lewat API. Transisi status muncul **hanya** di terminal worker.
- [ ] `redis-cli ZRANGE bull:delivery-simulation:delayed 0 -1 WITHSCORES` memperlihatkan job masa depan beserta skornya.
- [ ] Matikan proses **api** (Ctrl-C) di tengah penerbangan. Nyalakan lagi. Delivery tetap sampai `AWAITING_HANDOFF` — karena yang menggerakkannya bukan API.
- [ ] Ulangi, tapi kali ini matikan **worker**. Delivery membeku. Nyalakan worker lagi: job tertunda dieksekusi menyusul. Kamu bisa menjelaskan kenapa ini bukti "durable" dan `setTimeout` tidak akan pernah memberikannya.
- [ ] Matikan Redis dan panggil `POST /deliveries`: request **gagal dalam ~2 detik** dengan pesan yang menyebut Redis, bukan menggantung. Hapus `withTimeout` dari `simulation.service.ts:85-89`, ulangi, dan konfirmasi ia menggantung. Kembalikan.

### Bukti 2 — Koordinasi: satu scheduler, banyak worker

- [ ] Ada modul baru buatanmu (mis. `src/device-reaper/`) dengan `*.constants.ts`, `*.scheduler.ts`, `*.processor.ts`, dan `*.module.ts`, mengikuti struktur `src/delivery-watchdog/`.
- [ ] Scheduler-nya di-gate `IS_WORKER_TIER`, memakai `upsertJobScheduler` dengan `SCHEDULER_ID` tetap, dan kill switch-nya **memanggil `removeJobScheduler`**, bukan sekadar `return`.
- [ ] Ada gauge `schedulerRegistered` + `lastScan` di `MetricsService`, dan `lastScan` di-set **setelah** loop, bukan di `finally`. Kamu bisa menjelaskan kenapa.
- [ ] **Dua** worker jalan bersamaan. Log scan-mu muncul **sekali** per tick, bukan dua kali. Kamu punya screenshot/paste log yang membuktikannya.
- [ ] Set `<PREFIX>_ENABLED=false`, restart kedua worker, dan `redis-cli KEYS 'bull:<queue>:repeat*'` mengembalikan **kosong**. Sekarang ubah kill switch jadi `if (!ENABLED) return;`, ulangi, dan konfirmasi scheduler-nya **masih ada**. Itu bug yang komentar `watchdog.scheduler.ts:38-41` cegah — kamu baru saja membuatnya sendiri.
- [ ] Di komentar kode, kamu menuliskan **sinyal apa** yang kamu pakai untuk "device basi" dan kenapa (lihat hambatan yang disebut di 6.5). Jawaban "createdAt lebih tua dari N hari" boleh — asal kamu menuliskan keterbatasannya.

### Bukti 3 — Partisi: hijau, lalu merah karena satu karakter

- [ ] `psql "${DATABASE_URL%%\?*}" -v ON_ERROR_STOP=1 -f scripts/verify-partitions.sql` selesai tanpa `RAISE EXCEPTION`. Kamu bisa menyebut lima hal yang dibuktikannya.
- [ ] `npm run prisma:drift-check` melaporkan *No difference*.
- [ ] `npx jest src/partition-maintenance` hijau.
- [ ] Ubah `??` jadi `||` di `partition.constants.ts:74`. Test di `partition-maintenance.service.spec.ts:99-105` menjadi **merah**. Kembalikan. (Test-nya sudah ada — tugasmu membuktikan ia bernilai, bukan menulisnya.)
- [ ] Tulis **satu** test tambahan yang belum ada: bahwa `retentionFor` menghormati override per-tabel yang **lebih besar** dari global (mis. `retentionFor({ table: 'x', retainMonths: 12 }, 6) === 12`), lalu mutasikan `??` → `entry.retainMonths && globalRetainMonths` dan konfirmasi test-mu menangkapnya.
- [ ] Kamu bisa menjelaskan, tanpa membuka kode, kenapa `admin_audit_logs` mem-pin `retainMonths: 0` dan apa yang akan terjadi tanpa pin itu saat seseorang menyetel `PARTITION_RETAIN_MONTHS=6`.

### Artefak tertulis

- [ ] Satu entri bergaya `AUDIT-LOG.md` untuk pekerjaanmu: **apa yang berubah**, **cacat apa yang ditutup**, **harga apa yang diterima**, dan `### Left undone`. Sertakan tabel mutasi (mutasi apa, test mana yang seharusnya mati, hasilnya). Kalau ada mutasi yang **tidak** membunuh test mana pun, catat itu — itu temuan, bukan kegagalan.

---

## Gerbang keluar

Kalau ada satu saja yang belum bisa kamu jawab tanpa membuka kode, jangan lanjut ke Fase 7.

**1. `SimulationProcessor` ada di daftar `providers` `DeliveriesModule`. Kenapa `console.log` di dalamnya tidak pernah muncul saat `PROCESS_ROLE=api`?**

<details><summary>Jawaban</summary>

Karena baris `...(RUN_PROCESSOR ? [SimulationProcessor] : [])` (`deliveries.module.ts:88`) menghasilkan array **kosong** saat `RUN_PROCESSOR` false. Provider-nya tidak "dimatikan" — ia tidak pernah didaftarkan. `RUN_PROCESSOR = IS_WORKER_TIER` (`:44`), dan `IS_WORKER_TIER` adalah konstanta module-level yang dibaca dari `process.env.PROCESS_ROLE` saat **import** (`process-role.ts:15,19`), sebelum DI container ada. Itu juga kenapa `import 'dotenv/config'` harus jadi baris pertama `main.ts` (`:1-3`).
</details>

**2. Kenapa `queue.addBulk()` dibungkus `Promise.race` dengan timeout 2 detik, padahal Redis "biasanya" cepat?**

<details><summary>Jawaban</summary>

Karena koneksi queue dikonfigurasi `maxRetriesPerRequest: null` (`app.module.ts:135`) agar perintah queue tidak error saat reconnect. Efek sampingnya: saat Redis benar-benar mati, `addBulk()` **menggantung selamanya** (offline queue retry tanpa batas) alih-alih reject. Tanpa `withTimeout` (`simulation.service.ts:162-174`), `POST /deliveries` akan menggantung, bukan gagal cepat. Ini kegagalan yang hanya bisa dipahami dengan membaca dua file berpasangan.
</details>

**3. `jobId` deterministik membuat enqueue idempoten. Kenapa `deferKickoff` justru sengaja memakai `jobId` BARU tiap attempt?**

<details><summary>Jawaban</summary>

Karena saat `handleKickoff` sedang berjalan, job `${deliveryId}-kickoff` masih ada di queue (statusnya active). Meng-enqueue ulang dengan id yang sama akan di-dedupe terhadap job yang sedang diproses itu, sehingga **penundaan berubah jadi drop diam-diam** (`simulation.service.ts:136-141`). Aturannya: id deterministik untuk niat yang sama; id baru untuk attempt berikutnya dari niat yang sama. Nomor attempt disimpan di payload, bukan di memori processor, supaya budget-nya selamat dari redeploy.
</details>

**4. Kenapa kill switch watchdog memanggil `removeJobScheduler` alih-alih `return` saja?**

<details><summary>Jawaban</summary>

Karena scheduler-nya **persisten di Redis** dan selamat dari restart (`watchdog.scheduler.ts:38-41`). Deploy sebelumnya sudah menulis scheduler; `return` polos tidak menghapusnya, jadi reaper tetap jalan meski kamu yakin sudah mematikannya. Konsekuensinya di level module: scheduler harus **tetap didaftarkan** di worker tier meski flag mati (`delivery-watchdog.module.ts:11-18`), karena provider yang di-gate flag tidak akan pernah menjalankan teardown-nya sendiri.
</details>

**5. Di `handleKickoff`, kenapa enqueue harus terjadi SEBELUM CAS — dan bukan sebaliknya?**

<details><summary>Jawaban</summary>

Karena enqueue **idempoten** (jobId deterministik mendedupe) sementara CAS **sekali pakai**. Kalau CAS jalan duluan lalu enqueue gagal, retry job akan menemukan status sudah `PENDING`, CAS-nya no-op, handler mengembalikan sukses — dan job siklus hidup tidak pernah ter-enqueue. Delivery terjebak selamanya tanpa satu pun error (`simulation.processor.ts:99-102`). Aturan umumnya: operasi idempoten duluan, operasi sekali-pakai belakangan. Batasan kedua di `:104-107` melengkapinya: klaim pesawat commit di baris terpisah yang tidak ikut rollback, jadi kalau CAS kalah, pesawatnya harus dilepas secara eksplisit.
</details>

**6. Dua kesalahan berbeda bisa merusak watchdog secara diam-diam: (a) menyaring kandidat dengan `delivery.updatedAt`, dan (b) memakai CAS default `FAILABLE_STATUSES`. Jelaskan keduanya, dan kenapa re-check per-baris tidak menyelamatkan (b).**

<details><summary>Jawaban</summary>

**(a) Sinyal salah.** `delivery.updatedAt` hanya bergerak saat **perubahan fase**, sementara penerbangan sehat duduk di satu fase berpuluh menit sambil terus mengirim posisi. Jadi setiap penerbangan sehat jadi kandidat permanen; batch dibatasi 200 (`WATCHDOG_BATCH`) dan diurut `asc`, sehingga delivery yang **benar-benar** mati bisa terdorong keluar dari batch — reaper berhenti bekerja tanpa satu error pun (`delivery-watchdog.ts:47-57`). Aturannya: gerbang, urutan, dan keputusan per-baris harus memakai sinyal yang **sama**.

**(b) CAS lebih lebar daripada query.** `FAILABLE_STATUSES` memuat `AWAITING_HANDOFF`, yang sengaja dikecualikan scan (drone di depan pintu sedang menunggu, bukan macet). Delivery yang terpilih sebagai `IN_TRANSIT` lalu mencapai handoff di tengah scan tetap lolos CAS dan di-refund otomatis (`AUDIT-LOG.md:509-514`). Re-check per-baris tidak menolong karena ia membaca nilai **in-memory dari query awal**, bukan status saat ini (`deliveries.service.ts:1060-1061`). Perbaikannya adalah parameter `allowedStatuses` (`deliveries.service.ts:1048-1063`). Aturan umumnya: CAS tidak boleh lebih lebar daripada query yang memilih barisnya.
</details>

**7. Aturan PostgreSQL apa yang menyebabkan `findUnique({ where: { id } })` mati, `TrackingIdRegistry` lahir, dan `Drone.activeDeliveryId` ada di tabel `drones`?**

<details><summary>Jawaban</summary>

Satu aturan: *"A range-partitioned table requires the partition key in every unique/PK constraint"* (`PARTITIONING.md:59-61`). Riaknya: PK jadi `@@id([id, createdAt])` → tidak ada lagi unique satu kolom `id` → `findUnique({where:{id}})` jadi **compile error**; `trackingId @unique` mustahil → lahir `TrackingIdRegistry` yang tidak terpartisi (`schema.prisma:359-374`); dan unique claim drone tidak bisa hidup di `deliveries` → dipindah ke `drones` (`schema.prisma:178-182`).
</details>

**8. Kenapa `partition_drain_default` harus jalan SEBELUM `partition_ensure`, dan kenapa `ATTACH` butuh `SHARE ROW EXCLUSIVE`?**

<details><summary>Jawaban</summary>

Drain duluan karena `CREATE … PARTITION OF` polos **gagal** kalau DEFAULT sudah memegang baris in-range (`PARTITIONING.md:86-89`); jadi rutinnya membangun anak standalone, memindahkan baris, baru `ATTACH`. Lock-nya dibutuhkan karena dalam recovery yang telat, sebuah `INSERT` bisa commit ke DEFAULT persis antara `DELETE` dan pemindaian `ATTACH` — membuat `ATTACH` gagal selamanya di bawah beban tulis. `SHARE ROW EXCLUSIVE` dipilih karena konflik dengan `ROW EXCLUSIVE` milik `INSERT` tapi **tidak** dengan `SELECT` (`prisma/migrations/20260616121000_partition_attach_lock/migration.sql:13-16`).
</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| `console.log` di `SimulationProcessor` tidak pernah muncul, dan kamu yakin worker-nya jalan | Provider-nya memang tidak terdaftar di proses itu — ini **bagian tersulit seluruh fase**. `RUN_PROCESSOR` dievaluasi saat import dari `process.env`, bukan dari `ConfigService` | `grep -rn "IS_WORKER_TIER" src/` lalu tambahkan `console.log('RUN_PROCESSOR =', RUN_PROCESSOR)` di bawah `deliveries.module.ts:44`. Kalau nilainya `false` di terminal yang kamu kira worker, `PROCESS_ROLE`-mu salah — atau `import 'dotenv/config'` bukan baris pertama `main.ts`/`worker.ts` |
| `PROCESS_ROLE` di `.env` diabaikan, tapi `PROCESS_ROLE=worker npm run worker` (inline) bekerja | `dotenv` di-load setelah module graph di-import, jadi flag import-time membaca `process.env` yang masih kosong | Cek baris 1 `src/main.ts` dan `src/worker.ts` — komentarnya (`main.ts:1-2`) menyebut persis kegagalan ini. Kalau kamu menambahkan import baru di atasnya, kamu baru saja memasang bug ini |
| Delivery tidak pernah maju, tidak ada error di mana pun | Job ter-enqueue tapi tidak ada consumer: worker mati, atau `PROCESS_ROLE=api` di kedua terminal | `redis-cli ZRANGE bull:delivery-simulation:delayed 0 -1 WITHSCORES` — kalau job-nya ada dan skornya sudah lewat, tidak ada yang mengambilnya. `redis-cli LLEN bull:delivery-simulation:wait` juga naik terus |
| `POST /deliveries` menggantung selamanya alih-alih error | `withTimeout` hilang/di-bypass, dan Redis tidak terjangkau. Offline queue BullMQ retry tanpa batas karena `maxRetriesPerRequest: null` | Matikan Redis dan panggil endpoint-nya. Harus gagal ~2 detik dengan pesan `enqueue simulation timed out after 2000ms (Redis unreachable?)` (`simulation.service.ts:168`). Kalau tidak, cek `:85-89` |
| Scan repeatable jalan N kali per tick padahal cuma butuh sekali | `setInterval`/`@Cron` in-process alih-alih `upsertJobScheduler`, atau `SCHEDULER_ID` berbeda per replica (mis. mengandung hostname/uuid) | `redis-cli KEYS 'bull:<queue>:repeat*'` — harus ada **satu** entri, bukan N. Kalau ada N, id-nya tidak deterministik |
| Kamu set `WATCHDOG_ENABLED=false` tapi reaper tetap jalan | Kill switch berbentuk `return` polos; scheduler yang sudah persisten di Redis tidak pernah dihapus | `redis-cli KEYS 'bull:delivery-watchdog:repeat*'` setelah restart. Kalau masih ada, teardown-nya tidak jalan (`watchdog.scheduler.ts:38-42`). Cek juga bahwa provider scheduler-nya tidak ikut di-gate flag (`delivery-watchdog.module.ts:11-18`) |
| Watchdog mereap delivery yang sehat, atau tidak mereap yang jelas mati | Sinyal salah (`delivery.updatedAt`), atau CAS lebih lebar daripada query kandidat | Untuk false-positive: cek argumen ketiga `failExceptional` (`delivery-watchdog.ts:99-103`) — tanpa `WATCHDOG_STUCK_STATUSES`, `AWAITING_HANDOFF` ikut kena (`AUDIT-LOG.md:509-514`). Untuk false-negative: hitung berapa kandidat yang dikembalikan query; kalau mentok 200 (`WATCHDOG_BATCH`), kamu kena masalah crowding di `delivery-watchdog.ts:50-54` |
| Dashboard heartbeat hijau tapi sistemnya jelas mati | `lastScan.set()` ditaruh di `finally`, jadi ia naik bahkan saat tick gagal total | Buat `prisma.delivery.findMany` melempar di spec, lalu assert gauge **tidak** berubah. Referensi: `delivery-watchdog.ts:132-136` dan `partition-maintenance.service.ts:99-103` |
| `prisma migrate dev` menghasilkan migration yang meng-un-partisi tabel | Prisma tidak bisa mengekspresikan `PARTITION BY`, jadi ia "memperbaiki" schema-mu | `npm run prisma:drift-check` harus melaporkan *No difference*. Kalau tidak, **jangan generate migration itu** (`PARTITIONING.md:72-76`). Dan jangan pernah `prisma db push`/`db pull` di environment terpartisi (`:65-71`) |
| `drovery_partition_default_rows > 0` dan tidak turun-turun | Maintenance tertinggal, jendela forward terlalu pendek, atau `ATTACH` gagal berulang karena race dengan INSERT | `SELECT count(*) FROM notifications_default;` di `psql`, lalu `SELECT partition_ensure('notifications', 3);` manual. Kalau `ATTACH` yang gagal, gejalanya baris menumpuk sementara log worker melaporkan kegagalan per-tabel — cek counter `drovery_partition_maintenance_failures` (`partition-maintenance.service.ts:57-66`) |
| Riwayat audit tiba-tiba terhapus setelah seseorang menyetel retensi telemetri | `retentionFor` memakai `||` alih-alih `??`, jadi `retainMonths: 0` jatuh ke global | Jalankan `npx jest src/partition-maintenance` dan lihat test di `:99-105`. `0 \|\| 6 === 6` tapi `0 ?? 6 === 0` (`partition.constants.ts:64-75`) |
| Pod worker masuk `CrashLoopBackOff` di Kubernetes padahal log-nya normal | Kamu menyalin `livenessProbe: httpGet: /api/v1/health` dari deployment api. Worker tidak punya Express — probe itu **selalu** gagal | `kubectl describe pod` → alasan restart adalah probe, bukan exit code. Bandingkan dengan `k8s/base/worker-deployment.yaml:39-48`: worker sengaja hanya punya `startupProbe` berbentuk `exec`. Untuk worker, sinyal kesehatannya adalah gauge `schedulerRegistered`/`lastScan`, bukan endpoint |
| Test suite butuh kunci Stripe / broker MQTT untuk jalan | Kode baru memanggil SDK langsung alih-alih lewat service yang punya seam `isMock` | Kosongkan `.env` kecuali `DATABASE_URL`, jalankan `npm test`. Setiap kegagalan menunjuk satu tempat yang melewati seam (`stripe.service.ts:37-49`, `mqtt.service.ts:46-48`) |

---

## Bacaan pendamping

Semua di repo `Drovery_Backend`, dan semuanya berisi **kenapa**, bukan **bagaimana**.

- **`src/common/process-role.ts:1-13`** — 13 baris komentar yang memuat seluruh taksonomi tier. Cari: kenapa `realtime` layak jadi peran tersendiri, dan kenapa perkenalannya *"purely additive"*.
- **`ARCHITECTURE.md` §0 dan §1** — cari baris `:13`, entri hard-blocker #1 yang mencatat migrasi `setTimeout` → BullMQ sebagai langkah pertama seluruh rencana scaling. Ini konteks yang membuat Fase 6 terasa seperti keputusan, bukan tugas.
- **`SCALING-1M.md:249-252`** — cari "Delayed-ZSET caveat". Satu paragraf yang mengakui batas BullMQ pada skala berikutnya dan memberi rumus kasar untuk menghitung memori queue-Redis. Contoh bagus dari trade-off yang disadari, bukan diabaikan.
- **`prisma/PARTITIONING.md`** — baca `:7-20` (tabel enam tabel + strateginya), `:57-79` (**daftar aturan Prisma yang tidak boleh dilanggar**), `:80-108` (alur maintenance + kenapa drain duluan), `:119-126` (override retensi + `??`), `:156-162` (apa yang direkomendasikan untuk produksi tapi belum dilakukan).
- **`prisma/migrations/20260616121000_partition_attach_lock/migration.sql:1-22`** — 22 baris komentar untuk satu `LOCK TABLE`. Cari: kenapa `SHARE ROW EXCLUSIVE` dan bukan mode lain, dan kenapa tidak perlu retry. Ini penjelasan lock mode terbaik di repo.
- **`prisma/migrations/20260620160000_partition_routines_self_discover/migration.sql:1-16`** — cari kalimat *"would DELETE the wrong month"*. Contoh nyata kenapa menebak identitas kolom dari namanya berbahaya.
- **`AUDIT-LOG.md:490-548`** — entri lengkap tentang penyempitan CAS watchdog, termasuk **tabel mutation test** di `:531` dan catatan jujur di `:534-538` bahwa satu mutasi awalnya lolos karena kesalahan penulis mutasinya sendiri. Baca bagian itu; ia mengajarkan cara tidak menipu diri saat menguji test-mu.
- **`src/delivery-watchdog/watchdog.constants.ts`** — 47 baris konstanta dengan komentar yang lebih panjang daripada kodenya. Cari: kenapa `WATCHDOG_SILENCE_MS` disebut *"THE critical safety knob"*, dan kenapa `WATCHDOG_STUCK_STATUSES` ditulis sebagai literal eksplisit alih-alih hasil filter.
- **`scripts/verify-partitions.sql:1-11`** — header yang menyebut lima assertion-nya. Baca sebelum menjalankan, supaya kamu tahu apa yang seharusnya kamu lihat.

Dokumentasi eksternal — hanya tiga, dan hanya kalau kamu benar-benar butuh:

- [BullMQ — Job Schedulers](https://docs.bullmq.io/guide/job-schedulers) — untuk memahami apa yang disimpan `upsertJobScheduler` di Redis dan kenapa ia idempotent by id.
- [PostgreSQL — Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html) — khususnya §5.12.2 (partition maintenance) dan catatan tentang partisi DEFAULT.
- [PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html) — tabel matriks konflik lock mode; buka bersamaan dengan `prisma/migrations/20260616121000_partition_attach_lock/migration.sql`.

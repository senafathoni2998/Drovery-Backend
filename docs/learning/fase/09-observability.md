# Fase 9 — Observability: melihat isi sistem saat ia rusak

> **Durasi** ~2 minggu (~28 jam) · **Mode** bedah · **Repo** `Drovery_Backend` (`src/metrics/`, `src/common/monitoring/`, `observability/`, `docker-compose.observability.yml`, blok pino di `src/app.module.ts`)

---

## Kenapa fase ini ada di sini

Delapan fase terakhir kamu menambah permukaan sistem terus-menerus. Fase 5 memberi kamu CAS dan
`updateMany(...).count === 0`. Fase 6 memberi worker terpisah dengan queue yang menyimpan pekerjaan
di Redis. Fase 7 memberi gerbang penerbangan berlapis. Fase 8 memberi socket yang hidup lama di
banyak replika. Setiap fase itu menambah satu tempat baru yang bisa rusak **tanpa ada satu pun
request HTTP yang gagal**. Job yang menumpuk di `delayed` tidak menaikkan angka 5xx. Scheduler
watchdog yang mati diam-diam tidak melempar exception. Socket yang di-drop karena backpressure tidak
muncul di access log. Itulah kenapa fase ini datang **sekarang**, bukan lebih awal: sebelum Fase 6-8
kamu belum punya apa pun yang bisa rusak secara senyap. Setelah Fase 8, hampir semua kegagalan
menarik di sistem ini adalah kegagalan senyap.

Kebiasaan lamamu — dan ini kebiasaan yang jujur untuk seorang frontend dev — adalah menyalakan
`console.log`, memuat ulang, dan membaca output. Itu bekerja karena di browser kamu adalah satu-satunya
pengguna, satu proses, dan kamu ada di sana persis saat bug terjadi. Tiga asumsi itu semuanya salah di
sini. Prosesnya ada empat jenis (`api`, `worker`, `realtime`, `ingest`), tiap jenis bisa punya banyak
replika, dan kejadian yang ingin kamu pahami terjadi jam tiga pagi saat kamu tidur. Observability
adalah cara menggeser pertanyaan dari "apa yang terjadi barusan?" menjadi "apa yang **sudah terjadi**,
dan siapa yang seharusnya dibangunkan?".

Ada satu alasan lagi yang lebih praktis, dan ini yang membuat urutannya wajib begini: **Fase 10 dan
11 tidak bisa dikerjakan tanpa fase ini**. Fase 11 akan menyuruh Kubernetes menaikkan jumlah worker
berdasarkan `drovery_queue_jobs`. Kalau metrik itu salah bentuk — kalau ia dijumlah ketika seharusnya
diambil maksimumnya — autoscaler akan mengalikan backlog dengan jumlah pod dan naik tak terkendali.
Sinyal yang dipakai untuk mengambil keputusan otomatis harus dipahami lebih dulu sebagai *metrik*,
baru boleh dipakai sebagai *tuas*. Komentar di `k8s/base/worker-scaledobject.yaml:51-53` sudah
menunggumu di sana, dan kamu harus sudah tahu kenapa ia benar sebelum sampai ke situ.

Satu peringatan jujur di depan: capstone fase ini memakai `docker compose` sebagai **resep**, padahal
Docker baru diajarkan penuh di Fase 10. Kamu tidak perlu paham layer, multi-stage, atau build context
untuk mengetik satu perintah `up -d` dan membuka `localhost:9090`. Kalau perintahnya gagal, itu bukan
kegagalan konsepmu — lompat ke bagian "Kalau nyangkut" dan ambil jalan tanpa container yang tersedia
di sana.

---

## Gerbang masuk

Kamu siap masuk fase ini kalau kamu bisa:

- [ ] Menjalankan `PROCESS_ROLE=worker npm run worker` dan menjelaskan, tanpa membuka kode, provider
      mana yang hidup di proses itu dan mana yang tidak — lalu membuktikan tebakanmu dengan
      `grep -rn "IS_WORKER_TIER\|IS_HTTP_TIER\|IS_INGEST_TIER" src/`.
- [ ] Menunjukkan di mana sebuah job BullMQ berpindah dari state `delayed` ke `waiting` ke `active`,
      dan menyebut kenapa `delayed` adalah mayoritas isi queue `delivery-simulation`.
- [ ] Menyebutkan dua gauge WebSocket yang sudah kamu pasang di Fase 8 (`drovery_ws_connections` dan
      `drovery_ws_support_connections`) dan proses mana yang mengekspornya.
- [ ] Menulis satu interceptor Nest dari nol yang membungkus response, dan menjelaskan urutannya
      relatif terhadap `AllExceptionsFilter`.
- [ ] Menjalankan `npx jest metrics` di `Drovery_Backend` dan mendapat hijau.
- [ ] Membuka `docker-compose.yml` dan menyebut service apa saja yang ada di sana, walau belum paham
      sintaks penuhnya.

Kalau butir pertama masih goyah, kembali ke Fase 6 dulu. Setengah dari kebingungan di fase ini
berasal dari lupa bahwa satu `AppModule` yang sama berperilaku berbeda tergantung proses yang
mem-boot-nya.

---

## Peta jalan mingguan

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| 1 (paruh awal) | Konsep 9.1–9.4: registry, tipe metrik, cardinality, interceptor | 7 | `curl -s localhost:3000/api/v1/metrics \| grep drovery_http` mengeluarkan histogram + counter dengan label `route` berbentuk template. Kamu sudah sengaja merusak label jadi `originalUrl` dan menghitung ledakan time series-nya, lalu mengembalikannya. |
| 1 (paruh akhir) | Konsep 9.5–9.6: worker `/metrics` mentah, Prometheus pull, dua target, `up` | 7 | Stack observability menyala; `http://localhost:9090/targets` menampilkan `drovery-api` dan `drovery-worker` keduanya **UP**, dengan label `tier` yang benar. |
| 2 (paruh awal) | Konsep 9.7–9.10: alert dua tingkat, Alertmanager, `max()` vs `sum()`, Grafana as code | 7 | Satu alert kamu buat **FIRING** sungguhan di `:9090/alerts` setelah mematikan dependensinya; panel Grafana barumu bertahan setelah `down && up -d`. |
| 2 (paruh akhir) | Konsep 9.11–9.15: metrik jujur, OTel lintas proses, Sentry vs OTel, pino, perbandingan alternatif | 7 | Dua terminal berjalan dengan `OTEL_EXPORTER=console`; kamu menempelkan dua baris span dengan `traceId` yang **identik** ke catatanmu, lalu satu pasang lagi setelah `injectTraceCarrier` dilumpuhkan. |

Total ~28 jam. Kalau kamu di 12 jam/minggu, geser blok 9.15 (perbandingan) ke akhir dan baca sambil
mengerjakan capstone — ia sintesis, bukan prasyarat apa pun.

---

## Konsep

### 9.1 prom-client: satu Registry, Counter vs Gauge vs Histogram, `collectDefaultMetrics`

Analogi paling dekat dari duniamu: sebuah `Registry` itu seperti satu store Redux untuk *angka
operasional*. Ia bukan tempat data bisnis; ia tempat kumpulan pengukur yang bisa dibaca sekaligus,
dalam satu format teks, oleh siapa pun yang bertanya. Di Drovery ada tepat **satu** registry, dibuat
sebagai field instance di `MetricsService`, dan setiap metrik didaftarkan ke sana secara eksplisit
lewat `registers: [this.registry]`. Ini pilihan sadar: `prom-client` punya registry global
(`register` default), dan kalau kamu memakainya, dua modul yang mendaftarkan nama metrik yang sama
akan saling menabrak dengan pesan error yang membingungkan.

Tiga tipe metrik, dan perbedaannya bukan gaya melainkan matematika:

- **Counter** — hanya naik, tidak pernah turun, reset ke 0 saat proses restart. Kamu tidak pernah
  membaca nilai mentahnya; kamu selalu membacanya lewat `rate(...)`. `drovery_http_requests_total`
  adalah contohnya. Angka "1.284.331" tidak berarti apa-apa; `rate(...[5m])` berarti "request per
  detik lima menit terakhir", dan itu yang dipakai alert.
- **Gauge** — bisa naik dan turun, mewakili *keadaan saat ini*. `drovery_ws_connections` (jumlah
  socket tracking yang terhubung sekarang) dan `drovery_queue_jobs` adalah gauge. Bacaan mentahnya
  bermakna.
- **Histogram** — mendistribusikan pengamatan ke bucket yang sudah ditentukan, sehingga kamu bisa
  menghitung persentil di sisi query. `drovery_http_request_duration_seconds` punya bucket
  `[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]`. Perhatikan bucket teratasnya 5 detik — apa pun
  yang lebih lambat dari itu jatuh ke `+Inf` dan `histogram_quantile` hanya bisa menebak. Ini bukan
  cacat, ini keputusan: bucket lebih banyak = lebih banyak time series.

`collectDefaultMetrics({ register: this.registry, prefix: 'drovery_' })` menambahkan puluhan metrik
runtime Node gratis: heap, RSS, CPU, file descriptor, dan yang paling berguna di sini —
`drovery_nodejs_eventloop_lag_p99_seconds`. Prefix `drovery_` itu bukan kosmetik: alert
`DroveryEventLoopLag` di `alerts.yml:70` mengandalkan nama yang sudah di-prefix, dan
`observability-config.spec.ts:45` mengunci nama itu sebagai kontrak.

**Anchor:**
- `src/metrics/metrics.service.ts:40` — `readonly registry = new Registry();`, satu-satunya registry
  di aplikasi.
- `src/metrics/metrics.service.ts:116` — `collectDefaultMetrics({ register: this.registry, prefix: 'drovery_' })`.
- `src/metrics/metrics.service.ts:118-133` — Histogram + Counter HTTP berdampingan; perhatikan
  keduanya memakai `labelNames` yang sama persis.
- `src/metrics/metrics.service.ts:135-151` — tiga metrik socket dari Fase 8; dua Gauge, satu Counter.
  Tanya dirimu kenapa `wsDroppedFrames` Counter dan bukan Gauge.
- `src/metrics/metrics.module.ts:13-15` — komentar kenapa module ini `@Global()`: supaya
  `MetricsService` bisa di-inject di mana pun (mis. `TrackingGateway`) tanpa tiap feature module
  meng-import ulang.

**Kenapa dipakai di sini:** dokstring kelasnya menyatakan perannya dengan satu kalimat
(`src/metrics/metrics.service.ts:29-31`): *"Owns a single Prometheus registry and the app's metrics.
Exposed at GET /api/v1/metrics (API) and :METRICS_PORT/metrics (worker)."* Kata **owns** di situ
penting — registry ini disajikan dari **dua** bootstrap berbeda (`src/main.ts` dan `src/worker.ts`),
jadi ia harus berupa provider DI yang bisa diambil dari `app.get(MetricsService)`, bukan singleton
modul yang di-import langsung.

**Alternatif:**
- **Registry global bawaan `prom-client`** (`import { register } from 'prom-client'`) — lebih sedikit
  kode, tapi setiap test yang membuat instance kedua `MetricsService` akan melempar
  `A metric with the name ... has already been registered`. Dengan registry per-instance,
  `metrics.service.spec.ts` bisa membangun `MetricsService` segar di tiap `beforeEach` tanpa
  `register.clear()` global yang bocor antar file test.
- **`@willsoto/nestjs-prometheus`** — module Nest siap pakai dengan decorator `@InjectMetric()`.
  Menghemat ~40 baris boilerplate, tapi kamu kehilangan kendali atas registry dan pemasangan
  `collect()` kustom jadi berputar-putar; repo ini butuh keduanya (lihat 9.3, 9.5), jadi wrapper-nya
  justru menambah lapisan yang harus dilawan.
- **Tidak pakai library, tulis endpoint teks sendiri** — mungkin untuk lima metrik, dan kamu akan
  menghabiskan sore hari mengimplementasi ulang bucket histogram dan format eksposisi 0.0.4 dengan
  bug escaping label. `prom-client` ^15.1.3 sudah di `package.json`.

**Latihan:** jalankan `npm run start:dev`, lalu
`curl -s localhost:3000/api/v1/metrics | grep -c "^drovery_"`. Catat angkanya. Sekarang hitung berapa
di antaranya yang **kamu** deklarasikan di `MetricsService` (`grep -c "new \(Counter\|Gauge\|Histogram\)" src/metrics/metrics.service.ts`)
dan berapa yang datang gratis dari `collectDefaultMetrics`. Selisihnya akan mengejutkanmu; itu ukuran
seberapa banyak observability yang kamu dapat dari satu baris.

---

### 9.2 Jebakan cardinality: label pakai TEMPLATE route, bukan URL mentah

Ini konsep paling penting di paruh pertama fase ini, dan satu-satunya yang benar-benar bisa membunuh
Prometheus di produksi.

Prometheus tidak menyimpan "satu metrik". Ia menyimpan satu **time series** untuk **setiap kombinasi
unik** nilai label. `drovery_http_requests_total{method="GET", status="200", route="/api/v1/deliveries"}`
adalah satu series. Ganti `status` jadi `500`, itu series kedua. Analogi terdekat dari React: bayangkan
`useMemo` dengan dependency array yang salah — bukannya satu nilai yang di-cache, kamu membuat entri
cache baru setiap render, dan memori naik terus sampai tab-nya mati. Bedanya: di sini yang mati adalah
Prometheus milik seluruh tim, bukan tab-mu.

Sekarang lihat apa yang terjadi kalau `route` diisi URL mentah. `/api/v1/deliveries/abc-123` dan
`/api/v1/deliveries/def-456` adalah dua nilai label berbeda. Setiap delivery yang pernah dibuka
menghasilkan satu time series **permanen** (Prometheus menahannya sampai retention habis). Seribu
delivery = seribu series untuk satu endpoint, dikali jumlah `status` yang pernah muncul, dikali
`method`. Itu namanya **unbounded cardinality**: jumlah series tumbuh seiring data, bukan seiring
kode.

Solusinya ada di `MetricsInterceptor`: ambil `req.route.path` — yang oleh Express diisi dengan
**pola** route yang cocok (`/deliveries/:id`), bukan URL yang diminta — lalu gabungkan dengan
`req.baseUrl` untuk mendapat prefix global (`/api/v1`). Hasilnya `/api/v1/deliveries/:id`, satu series
untuk sejuta delivery. Kalau tidak ada route yang cocok (404), labelnya jadi literal `'unmatched'` —
sengaja satu nilai konstan, bukan URL yang gagal, karena kalau tidak, scanner otomatis yang menembak
URL acak bisa meledakkan cardinality-mu dari luar.

**Anchor:**
- `src/metrics/metrics.service.ts:121-122` — komentarnya adalah kontraknya:
  *"Labelled by route TEMPLATE (e.g. /api/v1/deliveries/:id), never the raw URL — labelling raw
  paths is an unbounded-cardinality trap."*
- `src/metrics/metrics.interceptor.ts:31-33` — implementasinya:
  `req.route?.path ? (req.baseUrl || '') + req.route.path : 'unmatched'`.
- `src/metrics/metrics.interceptor.ts:14-16` — kenapa ini harus interceptor dan bukan middleware:
  *"Running as an interceptor (post-routing) also means `req.route.path` is populated"*. Middleware
  Express berjalan **sebelum** router memutuskan handler mana yang cocok, jadi di sana `req.route`
  masih `undefined`.
- `src/metrics/metrics.interceptor.ts:34-36` — endpoint `/metrics` sendiri dikecualikan, dengan alasan
  tertulis: *"it would be a self-referential series that grows with scrape frequency, not real traffic."*

**Kenapa dipakai di sini:** Drovery punya banyak route ber-ID (`/deliveries/:id`,
`/deliveries/:id/track`, `/admin/users/:id`) dan jumlah delivery tumbuh tanpa batas. Ini persis
bentuk sistem di mana kesalahan cardinality tidak terlihat di dev (kamu punya lima delivery) dan
mematikan di produksi (kamu punya lima ratus ribu). Karena itu larangannya ditulis di komentar tepat
di atas `labelNames`, bukan di dokumen terpisah.

**Alternatif:**
- **Label dengan `userId` atau `deliveryId`** — terlihat sangat berguna ("saya bisa lihat latensi per
  user!"). Trade-off konkret: 50.000 user aktif × 20 route × 8 status = 8 juta time series untuk satu
  metrik. Prometheus single-node praktis mulai bermasalah di angka jutaan; kamu akan kehilangan
  seluruh monitoring demi satu pertanyaan yang seharusnya dijawab log atau trace.
- **Menaruh `deliveryId` di log terstruktur, bukan metrik** — inilah pembagian tugas yang benar dan
  yang dipakai repo ini: metrik untuk agregat dengan cardinality rendah, log/trace untuk per-entitas.
  Biayanya: kamu perlu tempat penyimpanan log (Loki/CloudWatch) untuk query itu, dan latensi jawabnya
  detik, bukan milidetik.
- **Normalisasi URL dengan regex sendiri** (`url.replace(/[0-9a-f-]{36}/g, ':id')`) — bekerja tanpa
  bergantung pada Express, tapi rapuh: slug, kode promo, dan nomor invoice tidak berbentuk UUID dan
  akan lolos. `req.route.path` adalah kebenaran dari router itu sendiri, bukan tebakan.

**Latihan:** ini latihan "rusak dulu, baru percaya", dan wajib dikerjakan.
1. `curl -s localhost:3000/api/v1/metrics | grep -c drovery_http_requests_total` → catat angka awal.
2. Ubah `src/metrics/metrics.interceptor.ts:31-33` menjadi `const route = req.originalUrl;`.
3. Restart, lalu `GET /api/v1/deliveries/<id>` untuk **lima** id berbeda.
4. Scrape lagi dan hitung ulang. Lima series baru dari lima request.
5. Kalikan di kepalamu dengan jumlah delivery setahun. Kembalikan perubahannya
   (`git checkout src/metrics/metrics.interceptor.ts`).

---

### 9.3 Gauge yang di-collect ON SCRAPE, dan `withTimeout` karena `getJobCounts()` MENGGANTUNG

Ada dua cara mengisi sebuah gauge. Cara pertama, yang otomatis terpikir: `setInterval(() => gauge.set(await hitung()), 5000)`.
Cara kedua, yang dipakai repo ini: pasang fungsi `collect()` pada gauge, dan `prom-client` akan
memanggilnya **tepat saat Prometheus datang men-scrape**.

Padanan yang jujur dari duniamu: `setInterval` itu seperti polling di `useEffect` — kamu menghitung
terus-menerus entah ada yang melihat atau tidak, dan nilai yang kamu tampilkan selalu tertinggal
sampai satu tick. `collect()` itu lebih dekat ke render on-demand: pekerjaan hanya dilakukan ketika
ada yang benar-benar meminta. Dua konsekuensinya disebut eksplisit di dokstring:
*"so it never drifts and costs nothing while idle"*. Tidak melenceng karena nilainya dibaca pada detik
scrape, bukan pada tick timer terakhir; nol biaya saat idle karena tanpa scraper, `getJobCounts()`
tidak pernah dipanggil sama sekali.

Lalu datang bagian yang tidak akan pernah kamu duga sendiri, dan yang membuat blok kode ini layak
dibaca berulang. Koneksi Redis milik BullMQ dikonfigurasi dengan `maxRetriesPerRequest: null`
(`src/app.module.ts:135`) — itu **wajib** supaya perintah queue tidak error saat reconnect. Efek
sampingnya: ketika Redis mati, `getJobCounts()` tidak menolak (`reject`), ia **menggantung**
selamanya, karena perintahnya masuk ke offline queue ioredis dan menunggu koneksi kembali. Karena
`collect()` dipanggil di jalur request `/metrics`, satu Redis yang mati akan membuat **seluruh scrape
menggantung** — dan Prometheus akan melaporkan target itu `down` bukan karena aplikasinya mati, tapi
karena satu gauge tidak mau menyerah.

`withTimeout(p, 1000)` memecahkan itu dengan `Promise.race` melawan `setTimeout` yang menolak.
Perhatikan `.finally(() => clearTimeout(timer))` di baris terakhirnya: tanpa itu, setiap scrape
meninggalkan satu timer hidup selama sedetik — bocor kecil yang tumbuh dengan frekuensi scrape.
Dan perhatikan `catch {}` di dalam loop: ia menangkap per-queue, bukan per-scrape, dengan alasan yang
ditulis — satu queue yang lambat tidak boleh mengosongkan pembacaan queue lain.

**Anchor:**
- `src/metrics/metrics.service.ts:17-27` — `withTimeout`, termasuk `clearTimeout` di `.finally`.
- `src/metrics/metrics.service.ts:29-37` — dokstring yang menyatakan dua keputusan sekaligus
  (on-scrape, dan queue-global → `max()` bukan `sum()`).
- `src/metrics/metrics.service.ts:338-369` — gauge `drovery_queue_jobs` dengan `async collect()`.
- `src/metrics/metrics.service.ts:346-348` — inti pelajarannya, kutip lengkap: *"the BullMQ connection
  uses maxRetriesPerRequest:null + an offline queue, so getJobCounts() HANGS (doesn't reject) when
  Redis is down. Without this race the whole /metrics scrape would hang."*
- `src/metrics/metrics.service.ts:362-366` — `catch` yang melewati **satu** queue, bukan membatalkan
  seluruh response.
- `src/metrics/metrics.service.ts:332-337` — empat queue yang dipantau: simulation, recurring,
  watchdog, partition.

**Kenapa dipakai di sini:** `drovery_queue_jobs` bukan metrik hiasan — ia adalah sinyal yang dipakai
KEDA untuk menaikkan jumlah worker di Fase 11 (`k8s/base/worker-scaledobject.yaml:54-56`) **dan**
sinyal yang dipakai alert `DroveryQueueBacklog`. Metrik yang dipakai untuk mengambil keputusan
otomatis tidak boleh melenceng satu tick, dan tidak boleh menjatuhkan endpoint yang menyajikannya.
Kedua sifat itu yang dibayar oleh `collect()` + `withTimeout`.

**Alternatif:**
- **`setInterval` + `gauge.set()`** — paling umum di tutorial. Trade-off konkret: dengan interval 5
  detik dan scrape 15 detik, nilaimu bisa 5 detik basi setiap kali, dan sepuluh replika API akan
  memanggil `getJobCounts()` ke Redis yang sama setiap 5 detik selamanya — termasuk jam 3 pagi saat
  tidak ada satu pun scrape. Untungnya: `collect()` tidak pernah bisa menggantung request.
- **`AbortController` alih-alih `Promise.race`** — lebih rapi secara semantik (pekerjaannya benar-benar
  dibatalkan, bukan sekadar diabaikan). Masalahnya: `queue.getJobCounts()` BullMQ tidak menerima
  signal, jadi tidak ada yang bisa dibatalkan; `race` adalah alat yang tepat untuk API yang tidak
  cancelable.
- **`maxRetriesPerRequest: 2` pada koneksi queue** — akan membuat `getJobCounts()` menolak alih-alih
  menggantung, sehingga `withTimeout` tak perlu. Trade-off: itu akan merusak BullMQ. Blok
  `BullModule.forRootAsync` di `src/app.module.ts:126-138` menjelaskan kenapa `null` diperlukan —
  perintah queue harus bertahan melewati reconnect. Bandingkan dengan koneksi throttler di
  `src/app.module.ts:64-68` yang sengaja memakai `maxRetriesPerRequest: 2` karena kebutuhannya
  kebalikan: *"Throttle checks must fail fast rather than hang on a Redis blip."* Satu repo, dua
  koneksi Redis, dua kebijakan berbeda dan alasannya masing-masing tertulis.

**Latihan:** buktikan gantungannya.
1. Nyalakan API dan Redis, `time curl -s localhost:3000/api/v1/metrics > /dev/null`. Catat waktunya
   (harusnya puluhan milidetik).
2. Matikan Redis (`docker compose stop redis`).
3. Ulangi `time curl ...`. Ia akan selesai sekitar **1 detik** — itu `withTimeout` bekerja — dan
   response-nya tetap lengkap kecuali `drovery_queue_jobs`.
4. Sekarang ubah angka `1000` di `metrics.service.ts:357` menjadi `600000`, restart, ulangi. Curl-mu
   akan menggantung. Itulah bentuk kegagalan yang dicegah satu baris tersebut. Kembalikan.

---

### 9.4 `MetricsInterceptor` pakai `res.on('finish')`, bukan `rxjs tap`

Di Fase 2 kamu menulis interceptor dan belajar bahwa `next.handle().pipe(tap(...))` adalah cara Nest
untuk "lakukan sesuatu setelah handler selesai". Di sini repo sengaja **tidak** memakainya, dan
alasannya adalah salah satu detail paling halus di seluruh kurikulum ini.

Urutannya begini. Interceptor membungkus handler. Ketika handler melempar exception, stream-nya
selesai dengan error — dan `tap` (atau `catchError`) berjalan **pada saat itu**. Tapi status code
final belum ditentukan! `AllExceptionsFilter` yang berjalan **setelah** itulah yang memetakan
exception ke 400/403/409/500 dan memanggil `res.status(...)`. Jadi kalau kamu membaca
`res.statusCode` di dalam `tap`, kamu membaca nilai default (200) atau nilai perantara — dan setiap
error di aplikasimu akan tercatat sebagai sukses. Alert 5xx-mu tidak akan pernah menyala. Ini bug
yang tidak terlihat di test unit dan tidak terlihat sampai ada insiden yang tidak dilaporkan.

`res.on('finish')` adalah event Node HTTP yang menyala setelah byte terakhir response ditulis ke
socket — setelah filter, setelah semuanya. Pada titik itu `res.statusCode` sudah final, dan
`req.route` sudah terisi. Padanan mental dari duniamu: `tap` itu seperti membaca state di dalam
render, `res.on('finish')` itu seperti membacanya di cleanup `useEffect` — beda titik waktu, beda
kebenaran.

Ada bonus arsitektural: karena pencatatannya di event listener dan bukan di pipeline RxJS,
interceptor ini **mengembalikan `next.handle()` apa adanya**. Ia tidak menyentuh stream sama sekali,
jadi ia tidak bisa memperlambat atau mengubah response. Perhatikan juga `if (context.getType() !== 'http') return next.handle();`
di baris 23 — interceptor global ini juga kena panggilan WebSocket, dan di sana tidak ada `res`.

**Anchor:**
- `src/metrics/metrics.interceptor.ts:11-17` — dokstring dengan alasannya:
  *"NOT via an rxjs `tap`, because AllExceptionsFilter sets the final status code AFTER the handler's
  stream completes, so a tap would record the wrong status."*
- `src/metrics/metrics.interceptor.ts:30-45` — badan `res.on('finish')`, termasuk pengukuran durasi
  dengan `process.hrtime.bigint()` (bukan `Date.now()`, karena jam dinding bisa melompat).
- `src/metrics/metrics.interceptor.ts:23` — guard non-HTTP.
- `src/metrics/metrics.module.ts:30-33` — pendaftarannya sebagai `APP_INTERCEPTOR`, jadi ia berlaku
  global tanpa disebut di tiap controller.

**Kenapa dipakai di sini:** dua dari sembilan alert di `observability/alerts.yml` bergantung pada
label `status` yang benar (`DroveryHighErrorRateWarning`, `DroveryHighErrorRatePage`), dan satu lagi
bergantung pada `status="503"` yang spesifik (`DroveryReadinessFailing`, `alerts.yml:38`). Kalau
`status` salah, ketiganya senyap total — dan senyapnya tidak bisa dibedakan dari "sistem sehat". Itu
kelas bug terburuk di observability: monitoring yang tampak hijau justru karena ia rusak.

**Alternatif:**
- **Middleware Express (`app.use`)** — juga bisa memasang `res.on('finish')` dan berjalan lebih awal,
  jadi ia menangkap request yang ditolak sebelum routing. Trade-off konkret: `req.route` belum terisi
  di sana, jadi kamu kehilangan template route dan harus menormalisasi URL sendiri (lihat trade-off
  regex di 9.2).
- **`tap` + `catchError` di RxJS, membaca status dari exception** — bisa dibuat benar, tapi kamu harus
  menduplikasi seluruh logika pemetaan exception→status yang sudah ada di `AllExceptionsFilter`, dan
  keduanya akan berbeda diam-diam saat salah satunya diubah.
- **Mencatat metrik di dalam `AllExceptionsFilter` untuk error dan di `tap` untuk sukses** — dua
  tempat, dua jalur, dan setiap penambahan filter baru berisiko melewatkan salah satunya.
  `res.on('finish')` punya sifat yang membuatnya menang: ia menyala **sekali** untuk setiap response,
  bagaimana pun response itu dihasilkan.

**Latihan:** buat endpoint yang pasti error. Panggil route yang tidak ada
(`curl -i localhost:3000/api/v1/tidak-ada`) dan satu yang melempar 401 (`curl -i localhost:3000/api/v1/deliveries`
tanpa token). Lalu `curl -s localhost:3000/api/v1/metrics | grep drovery_http_requests_total` dan
pastikan kamu melihat `status="404"` dengan `route="unmatched"` dan `status="401"` dengan route
template. Sekarang ganti `res.on('finish', ...)` menjadi `tap` di dalam `next.handle().pipe(...)`,
ulangi, dan lihat `status` yang tercatat berubah menjadi `200`. Itu alert 5xx yang mati.

---

### 9.5 Worker tanpa HTTP server tetap menyajikan `/metrics` lewat `http.createServer` mentah

Worker Drovery di-boot dengan `NestFactory.createApplicationContext(AppModule)`, bukan
`NestFactory.create(...)`. Bedanya: yang pertama membangun seluruh DI container **tanpa** memasang
server HTTP. Itu benar secara arsitektur — worker tidak melayani request, ia menguras queue. Tapi
Prometheus adalah pull-based: ia hanya bisa mengambil metrik lewat HTTP. Worker tanpa HTTP = worker
tanpa metrik = tier yang paling penting untuk dipantau justru yang paling tidak terlihat.

Jalan keluarnya di repo ini sederhana dan jujur: `http.createServer` dari modul `http` bawaan Node,
melayani **satu** path, di port terpisah. Tidak ada Express, tidak ada Nest, tidak ada middleware.
Enam puluh baris kode yang seluruhnya bisa kamu baca dalam satu tarikan napas.

Yang paling layak ditiru dari blok ini bukan idenya, melainkan sikapnya terhadap kegagalan.
`server.on('error', ...)` di baris 64 menangkap `EADDRINUSE` dan **hanya mencatat log** — worker terus
menguras queue. Alasannya ditulis: metrics itu auxiliary. Kalau kamu tidak memasang handler `error`
pada server Node, event `error` yang tidak tertangani akan meng-crash proses. Bayangkan konsekuensinya:
port metrics bentrok → worker crash-loop → semua delivery berhenti diproses, karena endpoint
pemantauan. Itu monitoring yang membunuh sistem yang seharusnya ia awasi.

**Anchor:**
- `src/worker.ts:30-32` — `createApplicationContext`, bootstrap tanpa HTTP.
- `src/worker.ts:36-39` — alasannya: *"The worker has no Express server, but KEDA scales it on queue
  depth — so it serves the same metrics registry over a tiny raw HTTP server at /metrics (root path;
  no api/v1 prefix here)."* Perhatikan kalimat terakhir — ini yang membuat konfigurasi scrape kedua
  berbeda path.
- `src/worker.ts:40-44` — mengambil `MetricsService` dari container lewat `app.get(...)`; registry
  yang **sama persis** dengan yang dipakai API.
- `src/worker.ts:45-61` — server-nya: satu `if`, satu `GET /metrics`, sisanya 404.
- `src/worker.ts:62-68` — handler `error` yang menolak meng-crash worker.
- `src/config/configuration.ts:102-107` — `metrics.enabled` (default on, mati dengan
  `METRICS_ENABLED=false`) dan `metrics.port` (default 9091).
- `src/metrics/metrics.controller.ts:32-33` — sisi API dari gate yang sama, dengan komentar
  *"Match the worker's gate (worker.ts): enabled unless explicitly false."*

**Kenapa dipakai di sini:** worker adalah tier yang di-autoscale (Fase 11), dan sinyal autoscaling-nya
adalah `drovery_queue_jobs`. Tanpa endpoint ini, KEDA tidak punya apa pun untuk dibaca dari tier itu,
dan alert `DroveryTargetDown` tidak akan pernah tahu kalau seluruh armada worker menghilang.

**Alternatif:**
- **`NestFactory.create()` juga untuk worker** — kamu dapat controller, guard, Swagger, semuanya
  "gratis". Trade-off konkret: kamu juga dapat seluruh permukaan HTTP publik di proses yang seharusnya
  tidak menerima traffic sama sekali — dan `MetricsController` akan ikut prefix `/api/v1`, jadi
  konfigurasi scrape-nya berbeda dari yang sekarang untuk alasan yang salah. Plus overhead boot yang
  tidak diperlukan.
- **Pushgateway** — worker mendorong metriknya ke gateway pusat, Prometheus men-scrape gateway. Cocok
  untuk job yang mati sebelum sempat di-scrape (batch job). Trade-off: metrik jadi **stateful di
  gateway** — worker yang mati akan terus melaporkan nilai terakhirnya selamanya sampai dihapus
  manual, jadi kamu kehilangan `up == 0` yang justru mendeteksi kematian itu.
- **Sidecar exporter yang membaca Redis langsung** (`bull_exporter`) — nol perubahan di aplikasi, tapi
  ia harus tahu skema kunci internal BullMQ, yang bisa berubah antar versi minor; dan komentar
  `k8s/base/worker-scaledobject.yaml:3-7` menunjukkan persisnya bahaya itu — exporter berbasis `LLEN`
  buta terhadap sorted set `delayed`.

**Latihan:** jalankan `PROCESS_ROLE=worker npm run worker`, lalu di terminal lain:
`curl -s localhost:9091/metrics | grep drovery_queue_jobs` (ada) dan
`curl -s localhost:9091/metrics | grep drovery_http_requests_total` (**tidak ada** — worker tidak
melayani HTTP, jadi counter itu nol dan `prom-client` tidak mengeluarkan series tanpa sampel).
Sekarang `curl -i localhost:9091/health` → 404, karena server ini hanya kenal satu path. Terakhir:
jalankan worker kedua di terminal ketiga tanpa mengubah apa pun dan baca log-nya — kamu akan melihat
pesan dari `worker.ts:65-67`, dan worker kedua **tetap** menguras queue.

---

### 9.6 Prometheus pull-based: dua scrape job, label `tier`, dan bonus metric `up`

Setelah aplikasi mengekspor metrik, ada satu pergeseran model mental: aplikasimu **tidak mengirim**
apa pun. Prometheus datang mengetuk setiap 15 detik dan mengambil teks dari `/metrics`. Ini kebalikan
dari refleks frontend-mu (analytics, Crashlytics, Sentry — semua push).

Kenapa itu penting, dan bukan sekadar selera: dari model pull lahir metrik `up` **gratis**. Setiap
kali Prometheus berhasil men-scrape sebuah target, ia mencatat `up{job="drovery-worker", instance="worker:9091"} = 1`;
kalau gagal, `0`. Kamu tidak menulis satu baris kode pun untuk itu, dan itulah yang membuat alert
`DroveryTargetDown` (`alerts.yml:77-82`, ekspresinya harfiah `up == 0`) mungkin. Dalam model push,
"aplikasi berhenti mengirim" tidak bisa dibedakan dari "aplikasi tidak punya sesuatu untuk dikirim" —
kamu harus membangun deteksi ketiadaan sendiri.

Konfigurasi scrape-nya punya dua job karena dua tier punya bentuk berbeda, dan bedanya bukan
sembarangan:

| Job | Target | Path | Kenapa |
|---|---|---|---|
| `drovery-api` | `api:3000` | `/api/v1/metrics` | Controller Nest ikut global prefix |
| `drovery-worker` | `worker:9091` | `/metrics` | Server `http` mentah, tidak ada prefix |

Label `tier: api` / `tier: worker` yang ditempel di `static_configs` bukan hiasan. Ia dipakai tiga
kali di tempat lain: alert `DroveryEventLoopLag` merender `{{ $labels.tier }}` di ringkasannya
(`alerts.yml:74`), Alertmanager mengelompokkan dengan `group_by: ['alertname', 'tier']`
(`alertmanager.yml:22`), dan `inhibit_rules` memakai `equal: ['tier']` supaya penindasan alert hanya
berlaku dalam tier yang sama (`alertmanager.yml:42`). Sebuah label yang ditulis di satu file dan
dipakai di tiga keputusan di file lain — itulah bentuk kopling yang layak dipahami sebelum kamu
mengubahnya.

Satu keputusan lagi yang perlu kamu setujui secara sadar: endpoint `/metrics` **tidak** di-auth.
Scraper tidak membawa JWT dan memanggil sangat sering, jadi `@PublicApi()` + `@SkipThrottle()`.
Mitigasinya bukan auth, tapi jaringan.

**Anchor:**
- `observability/prometheus.yml:16-30` — dua scrape job; bandingkan `metrics_path` keduanya.
- `observability/prometheus.yml:22` dan `:30` — `labels: { tier: api }` / `{ tier: worker }`.
- `observability/prometheus.yml:1-3` — `scrape_interval: 15s` dan `evaluation_interval: 15s`; ingat
  angka ini saat membaca `for: 2m` di alert (2 menit = 8 evaluasi).
- `src/metrics/metrics.controller.ts:12-15` — keputusan auth dan mitigasinya:
  *"This is unauthenticated by design, so in production it should be network-restricted
  (cluster-internal Service / NetworkPolicy) and can be killed via METRICS_ENABLED=false."*
- `src/metrics/metrics.controller.ts:15-19` — kenapa `@Res()` **tanpa** `passthrough`: response
  di-commit langsung, melewati `TransformInterceptor` global; kalau tidak, Prometheus akan menerima
  `{success, data}` JSON dan gagal mem-parse format eksposisi 0.0.4.
- `observability/alerts.yml:77-82` — `up == 0` sebagai alert.
- `loadtest/metrics-probe.sh:9-15` — konsekuensi praktis dari endpoint tanpa auth: skrip probe bisa
  men-scrape lewat load balancer tanpa JWT.

**Kenapa dipakai di sini:** dokumen `ARCHITECTURE.md:140-141` mencatat bahwa dua target ini adalah
seluruh permukaan observability Drovery, dan `DEPLOY.md:228-235` memberikan tiga URL yang harus kamu
hafal minggu ini: Prometheus `:9090`, Alertmanager `:9093`, Grafana `:3001`.

**Alternatif:**
- **Push via StatsD/DogStatsD** — aplikasi mengirim UDP ke agent lokal. Enak untuk proses berumur
  pendek dan tidak butuh service discovery. Trade-off konkret: hilangnya `up`, hilangnya kemampuan
  gauge `collect()` on-scrape (9.3) karena tidak ada momen "scrape", dan UDP yang drop diam-diam saat
  agent kelebihan beban.
- **Service discovery (`kubernetes_sd_configs`) alih-alih `static_configs`** — yang benar untuk
  produksi, karena pod datang dan pergi. Di Compose, nama service Docker sudah stabil, jadi
  `static_configs` lebih sederhana dan tidak menyembunyikan apa pun. Kamu akan melihat versi
  discovery-nya di Fase 11.
- **OpenTelemetry Collector sebagai satu pintu untuk semua sinyal** — repo sudah punya seam OTel
  (9.12), jadi ini jalur upgrade yang wajar dan menyatukan metrik+trace+log. Trade-off: satu komponen
  lagi yang harus dijalankan, dikonfigurasi, dan di-debug, untuk keuntungan yang belum terasa di
  skala satu laptop.

**Latihan:** nyalakan stack:
`docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile observability up -d`.
Buka `http://localhost:9090/targets` dan pastikan **dua** target UP. Lalu di tab Graph, jalankan query
`up` — kamu akan melihat dua series dengan label `tier` yang berbeda. Sekarang `docker compose stop worker`,
tunggu ~20 detik, dan jalankan `up` lagi: satu series berubah jadi 0. Tunggu 2 menit dan buka
`/alerts` → `DroveryTargetDown` menjadi FIRING. Kamu baru saja melihat metrik yang tidak ditulis
siapa pun menyelamatkan pemantauanmu.

---

### 9.7 Alert rules: dua tingkat untuk metrik yang sama, dan `for:` sebagai anti-flapping

Alert bukan "kirim notifikasi kalau angkanya jelek". Alert adalah keputusan tentang **siapa yang
dibangunkan dan kapan**, dan biaya kesalahannya asimetris: alert yang terlalu sensitif melatih orang
untuk mengabaikannya, dan setelah itu alert yang benar pun tidak berguna lagi.

Repo ini menunjukkan dua teknik untuk menangani itu, keduanya terlihat di pasangan rule pertama:

**Dua tingkat untuk metrik yang sama.** Ekspresi `DroveryHighErrorRateWarning` dan
`DroveryHighErrorRatePage` identik kecuali angkanya: `> 0.02` selama `10m` dengan
`severity: warning`, versus `> 0.05` selama `5m` dengan `severity: critical`. Terjemahannya ke
bahasa manusia: "2% error yang bertahan sepuluh menit itu masalah yang perlu tiket besok pagi; 5%
yang bertahan lima menit itu masalah yang perlu seseorang bangun sekarang." Ambang lebih tinggi
mendapat `for:` lebih pendek — bukan kebetulan; makin parah gejalanya, makin sedikit bukti yang kamu
butuhkan sebelum bertindak.

**`for:` sebagai anti-flapping.** Sebuah rule tanpa `for:` menyala pada evaluasi pertama yang melewati
ambang. Dengan `scrape_interval: 15s`, satu spike 15 detik saat deploy sudah cukup untuk membangunkan
orang. `for: 10m` berarti kondisinya harus **terus** benar selama sepuluh menit berturut-turut
(40 evaluasi) sebelum status berpindah dari `PENDING` ke `FIRING`. Di UI Prometheus kamu bisa
melihat perbedaan itu langsung — dan melihat rule-mu duduk di `PENDING` adalah cara terbaik untuk
memahami apa yang sebenarnya diukur `for:`.

Perhatikan juga hal yang mudah terlewat: ekspresi error rate memakai `sum(rate(...))` di pembilang
**dan** penyebut. Membagi dua `rate()` memberi rasio bebas satuan, dan `sum()` menghilangkan semua
label sehingga hasilnya satu angka global. Bandingkan dengan `DroveryHighLatencyP99` yang justru
mempertahankan label lewat `sum by (le, route)` — karena p99 harus dihitung per route, dan `le`
adalah label bucket yang **wajib** dipertahankan agar `histogram_quantile` bisa bekerja. Menghapus
`le` dari `by` adalah kesalahan PromQL paling umum di histogram, dan hasilnya bukan error melainkan
angka yang salah diam-diam.

**Anchor:**
- `observability/alerts.yml:5-13` — warning 2%/10m.
- `observability/alerts.yml:14-21` — page 5%/5m, `severity: critical`.
- `observability/alerts.yml:24-32` — p99 dengan `sum by (le, route)`; komentar `:23` menyebut bahwa
  bucket teratas histogram adalah 5s (batas kejujuran metrik ini).
- `observability/alerts.yml:34-42` — readiness; komentar `:35-36` menjelaskan kenapa selectornya
  `route=~".*/health/ready"` dan bukan literal: label `route` membawa prefix global, jadi selector
  harus prefix-agnostik.
- `observability/prometheus.yml:8-14` — blok `alerting:` yang mengirim rule ke Alertmanager, dengan
  cerita bug nyatanya: *"Without this block the nine rules in alerts.yml evaluated and fired into the
  Prometheus UI and nowhere else — three of them are `severity: critical`, so the stack could detect
  an outage and page nobody."*
- `observability/alerts.yml:86-94` — contoh alert yang lahir dari sifat kode, bukan dari template:
  partition maintenance menelan kegagalan per-tabel supaya satu tabel rusak tidak menjatuhkan yang
  lain — jadi satu-satunya sinyal yang tersisa adalah counter kegagalan.
- `observability/alerts.yml:95-98` — dan contoh alert yang sengaja **tidak** dibuat, dengan syarat
  kapan ia boleh dibuat.

**Kenapa dipakai di sini:** komentar di `observability/prometheus.yml:8-10` adalah pelajaran terbaik di file ini
karena ia mendokumentasikan kegagalan yang benar-benar terjadi di repo: sembilan rule yang valid,
tiga di antaranya critical, semuanya berjalan sempurna dan tidak memanggil siapa pun selama entah
berapa lama. Alert tanpa `alerting:` block adalah alert yang hanya menghibur orang yang kebetulan
sedang membuka Prometheus UI.

**Alternatif:**
- **Grafana Alerting** — rule dibuat lewat UI, dengan preview grafik saat menulis ekspresi. Trade-off
  konkret: rule menjadi baris di database Grafana, bukan file di git — tidak bisa di-review di PR,
  tidak ikut `git bisect`, dan hilang kalau volume Grafana dihapus. Repo ini memilih file justru
  karena ia ingin `observability-config.spec.ts` bisa mem-parse-nya di CI (9.10).
- **Alert langsung di kode aplikasi** (mis. `if (errorRate > 0.05) sendSlack()`) — reaksinya instan
  dan tidak butuh infra. Trade-off: setiap replika mengirim sendiri, jadi sepuluh pod = sepuluh pesan
  untuk satu insiden; tidak ada dedupe, tidak ada silence saat maintenance, dan proses yang mati tidak
  bisa melaporkan kematiannya sendiri.
- **Satu tingkat alert saja** (langsung critical di 5%) — lebih sedikit noise, dan lebih sedikit kabel.
  Trade-off: kamu kehilangan sinyal "sesuatu mulai memburuk" yang berumur jam-jaman, yang biasanya
  jendela terbaik untuk memperbaiki masalah sebelum ia jadi insiden.

**Latihan:** buat alert baru sendiri di `observability/alerts.yml`, di group `drovery-workers`, untuk
gauge heartbeat watchdog:
```yaml
- alert: DroveryWatchdogStale
  expr: time() - max(drovery_watchdog_last_scan_timestamp_seconds) > 600
  for: 5m
  labels: { severity: warning }
  annotations:
    summary: 'Watchdog has not completed a scan in 10m'
```
Lalu jalankan `npx jest observability-config`. Spec itu akan **menolak** kalau nama metrikmu tidak
ada di daftar `emitted` (`observability-config.spec.ts:39-51`) — itu fitur, bukan halangan: tambahkan
nama metriknya ke daftar itu hanya setelah kamu memastikan aplikasi benar-benar mengemit nama
tersebut (`grep -n "drovery_watchdog_last_scan" src/metrics/metrics.service.ts`). Terakhir,
`docker compose restart prometheus`, matikan worker, dan tonton rule-mu duduk di `PENDING` selama
lima menit sebelum `FIRING`.

---

### 9.8 Alertmanager: `group_by`, `inhibit_rules`, dan kenapa receiver sengaja kosong

Prometheus mengevaluasi rule; Alertmanager memutuskan apa yang **sampai ke manusia**. Pemisahan itu
ada karena tiga masalah yang tidak bisa diselesaikan di level rule:

**Grouping.** Sepuluh replika API yang semuanya mengalami lonjakan 5xx akan menghasilkan sepuluh alert
identik. `group_by: ['alertname', 'tier']` menjadikannya **satu** notifikasi. Tapi perhatikan `tier`
di daftar itu: masalah di api dan masalah di worker tetap dipisah, karena keduanya butuh penanganan
berbeda. Ini keputusan yang harus kamu ambil sadar setiap kali — group terlalu lebar dan dua insiden
berbeda tampak seperti satu; terlalu sempit dan kamu kebanjiran.

**Inhibition.** Kalau tier `worker` mati total, ia akan memicu `DroveryTargetDown` **dan**
`DroveryEventLoopLag` **dan** — kalau tier itu melayani HTTP — alert latensi dan error rate. Empat
notifikasi untuk satu sebab. `inhibit_rules` menekan yang gejala saat yang sebab sedang menyala, dan
komentar di file menuliskannya dalam satu kalimat yang layak dihafal: *"Page once about the cause,
not three times about the symptoms."* Perhatikan `equal: ['tier']` — penindasan hanya berlaku dalam
tier yang sama, jadi worker yang mati tidak menyembunyikan masalah api yang sungguhan. Ada satu
inhibit lagi yang lebih halus: `DroveryHighErrorRatePage` menekan `DroveryHighErrorRateWarning`,
karena kalau paging sudah terbuka, tiket warning-nya hanya bising.

**Receiver kosong yang disengaja.** Ini bagian yang akan membuatmu berpikir file-nya belum selesai.
Kedua receiver (`critical`, `warning`) tidak punya satu pun konfigurasi pengiriman — hanya blok
komentar berisi contoh Slack, PagerDuty, dan webhook. Alasannya ditulis lengkap di kepala file:
Alertmanager **tidak** mengekspansi environment variable, jadi `${WEBHOOK}` akan diambil sebagai
string literal dan membuat prosesnya gagal start. Dan kesimpulannya: *"Empty beats a fake URL that
logs delivery errors forever."* Receiver kosong tetap receiver yang valid — kamu tetap mendapat
grouping, inhibition, dan silence di `:9093`.

**Anchor:**
- `observability/alertmanager.yml:19-26` — `route` dasar: `group_by`, `group_wait: 30s`,
  `group_interval: 5m`, `repeat_interval: 12h`.
- `observability/alertmanager.yml:28-35` — sub-route untuk `severity = "critical"`: `group_wait` 10
  detik (lebih cepat) dan `repeat_interval` 1 jam (lebih sering diingatkan).
- `observability/alertmanager.yml:37-42` — inhibit target-down, dengan `equal: ['tier']`.
- `observability/alertmanager.yml:44-46` — inhibit page → warning.
- `observability/alertmanager.yml:8-14` — catatan panjang tentang kenapa receiver kosong.
- `observability/alertmanager.yml:48-73` — blok Slack/PagerDuty/webhook siap di-uncomment.
- `docker-compose.observability.yml:34-35` — konsekuensinya di Compose: *"No env vars: Alertmanager
  does not expand them in its config."*
- `DEPLOY.md:237-246` — versi prosa dari semua ini, plus konfirmasi bahwa perilaku ini disengaja.

**Kenapa dipakai di sini:** `DEPLOY.md:223-226` menjelaskan bahwa Alertmanager ditambahkan justru
untuk menutup lubang yang dijelaskan di 9.7. Dan `DEPLOY.md:248-254` menambahkan kejujuran yang
jarang ada di dokumentasi: `DroveryReadinessFailing` hanya mengcover Redis peran **cache**; kalau kamu
memecah `queue`, `pubsub`, dan `throttle` ke host terpisah (yang didukung
`src/config/configuration.ts`), readiness diam-diam berhenti mengcover peran yang dipisah, dan alert
itu tidak akan menyala untuknya. Batas cakupan alert yang **ditulis** jauh lebih berharga daripada
alert yang diasumsikan lengkap.

**Alternatif:**
- **Prometheus langsung ke PagerDuty** — tidak mungkin; Prometheus memang tidak punya integrasi
  notifikasi, itu desainnya. Blok siap-pakai ada di `alertmanager.yml:58-61` kalau kamu mau memasang
  PagerDuty lewat Alertmanager.
- **Grafana OnCall / Opsgenie sebagai pengganti Alertmanager** — menambahkan jadwal on-call, eskalasi,
  dan aplikasi ponsel yang benar-benar membangunkan orang. Trade-off: layanan berbayar, dan grouping
  serta inhibition harus dikonfigurasi ulang di sana dengan model yang berbeda.
- **Sentry/Crashlytics saja** — bagus untuk error aplikasi per-issue dengan stack trace. Trade-off
  konkret: buta total terhadap SLO agregat — Sentry tidak bisa memberitahumu bahwa 3% request 5xx
  atau bahwa satu tier menghilang (`up == 0`), karena proses yang mati tidak mengirim event.

**Latihan:** nyalakan stack, lalu `docker compose stop postgres`. Amati di `http://localhost:9090/alerts`:
`DroveryReadinessFailing` (butuh 2 menit) muncul. Sekarang buka `http://localhost:9093` dan lihat
bagaimana Alertmanager mengelompokkannya. Berikutnya `docker compose stop worker` juga, tunggu, dan
perhatikan alert dari tier worker: `DroveryTargetDown` muncul, tapi alert gejala di tier yang sama
ditekan. Terakhir, buat sebuah URL di `https://webhook.site`, uncomment blok `webhook_configs` di
`alertmanager.yml:64-66`, isi URL-nya, `docker compose restart alertmanager`, dan lihat payload JSON
alert masuk ke sana. Itu momen "alert saya benar-benar memanggil sesuatu".

---

### 9.9 `max()` bukan `sum()` pada gauge queue-global

Ini kesalahan satu kata yang mengalikan kenyataan dengan jumlah pod, dan ia muncul **dua kali** di
repo: di alert dan di autoscaler. Karena itu ia layak jadi konsepnya sendiri.

Faktanya: `getJobCounts()` bertanya ke **Redis**, dan Redis menyimpan satu queue bersama. Jadi setiap
replika yang menjalankan `collect()` mendapat angka yang **sama persis**. Kalau ada tiga replika API,
Prometheus akan punya tiga time series `drovery_queue_jobs{queue="delivery-simulation", state="waiting"}`
— satu per `instance` — dan ketiganya bernilai, katakanlah, 400.

Sekarang: `sum(...)` atas ketiganya = 1200. `max(...)` = 400. Yang benar adalah 400. Backlog-nya satu,
dilaporkan tiga kali.

Kenapa ini berbahaya dan bukan sekadar salah: nilainya dipakai KEDA untuk menghitung jumlah replika
yang diinginkan (`desired = ceil(backlog / threshold)`, threshold 50). Dengan `sum()`, tiga replika
melaporkan 1200 → KEDA menaikkan jadi 24 replika → 24 replika melaporkan angka yang sama 400 masing-masing
→ `sum()` = 9600 → KEDA naik ke maksimum. Loop umpan balik positif yang seluruhnya lahir dari satu
kata. Dan gejalanya di dashboard justru terlihat seperti "sistem sedang dibanjiri" — kamu akan
mencari beban yang tidak ada.

Ada satu detail turunan yang halus: `max()` telanjang **menghapus semua label**. Untuk
`DroveryQueueFailedClimbing`, ringkasannya merender `{{ $labels.queue }}` — jadi ia harus memakai
`max by (queue) (...)`. Komentarnya di file mengakui bahwa hari ini perilakunya identik karena hanya
ada satu queue yang failed-nya dipantau, tapi bentuknya dibuat benar sejak awal.

**Anchor:**
- `src/metrics/metrics.service.ts:328-331` — sumber faktanya di sisi aplikasi: *"getJobCounts is
  queue-global, so every replica exports the SAME value (KEDA queries with max(), not sum())."*
- `src/metrics/metrics.service.ts:33-36` — pernyataan yang sama di dokstring kelas.
- `observability/alerts.yml:46-52` — komentar + ekspresi `max(...waiting) + max(...delayed) > 1000`.
- `observability/alerts.yml:57-60` — `max by (queue) (...)` dengan alasan kenapa `by` diperlukan.
- `k8s/base/worker-scaledobject.yaml:51-56` — query KEDA yang identik, dengan komentar
  *"max(), NOT sum(): every replica exports the same queue-global gauge, so sum() over N pods would
  multiply the backlog by the pod count."* (Kamu akan kembali ke file ini di Fase 11.)
- `src/metrics/observability-config.spec.ts:32-36` — spec yang mengunci bentuk `max by (queue)` supaya
  tidak ada yang "menyederhanakannya" jadi `max()` telanjang.
- `loadtest/metrics-probe.sh:10-15` — konsekuensi yang sama di skrip pengukuran: *"do NOT sum across
  replicas"*.

**Kenapa dipakai di sini:** ini satu-satunya tempat di seluruh kurikulum di mana pilihan fungsi
agregasi PromQL menentukan apakah cluster produksi meledak atau tidak. Repo memperlakukannya sesuai
bobot itu: fakta ditulis di kode yang mengemit, aturannya diulang di alert, diulang lagi di manifest
KEDA, dan dikunci oleh test.

**Alternatif:**
- **`avg()`** — juga menghasilkan 400, dan secara matematis benar untuk kasus ini. Trade-off konkret:
  kalau satu replika gagal men-scrape queue-nya (ingat `catch` per-queue di 9.3, yang menghasilkan
  ketiadaan series, bukan nol), `avg` atas replika yang tersisa masih 400 — tapi kalau ada replika
  yang melaporkan angka **basi** karena scrape-nya tertunda, `avg` menariknya ke bawah sementara
  `max` konservatif ke atas. Untuk autoscaling, salah ke atas lebih aman daripada salah ke bawah.
- **Mengekspor gauge queue hanya dari SATU proses** (mis. hanya worker replika pertama) — maka `sum()`
  jadi benar. Trade-off: kamu butuh mekanisme leader election untuk memilih siapa yang mengekspor,
  dan saat leader-nya mati kamu kehilangan sinyal autoscaling sepenuhnya sampai leader baru terpilih.
  `max()` tidak butuh koordinasi apa pun.
- **`sum()` pada gauge yang memang per-replika** — dan ini penting supaya kamu tidak mengambil
  pelajaran yang salah: `drovery_ws_connections` **harus** dijumlah, karena setiap replika socket
  melaporkan koneksinya sendiri. Lihat panel dashboard di `observability/grafana/dashboards/drovery-api.json`
  yang memakai `sum(drovery_ws_connections)`. Aturannya bukan "selalu max", tapi "tanyakan dulu:
  apakah setiap replika melaporkan bagiannya sendiri, atau melaporkan keseluruhan yang sama?".

**Latihan:** dengan stack observability menyala, jalankan
`docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile observability up -d --scale worker=3`.
Di Prometheus, jalankan tiga query berurutan dan catat ketiganya:
`drovery_queue_jobs{queue="delivery-simulation", state="waiting"}` (kamu akan lihat beberapa series
dengan nilai identik), lalu `sum(...)`, lalu `max(...)`. Buat 50 delivery lewat API supaya angkanya
tidak nol. Tulis satu paragraf di catatanmu: berapa lipat `sum()` melebih-lebihkan kenyataan, dan
berapa replika yang akan diminta KEDA dari masing-masing angka.

---

### 9.10 Grafana provisioning-as-code: dashboard sebagai JSON yang di-commit

Kalau kamu pernah membangun dashboard Grafana dengan klik-klik, kamu tahu perasaan menemukannya
hilang setelah container di-recreate. Repo ini menghindari itu dengan cara yang sama seperti kamu
menghindari state UI yang tidak persisten: menjadikannya file.

Ada dua lapis konfigurasi, dan membedakan keduanya adalah setengah dari pemahaman:

1. **Provisioning** (`observability/grafana/provisioning/`) — memberitahu Grafana *dari mana* ia harus
   memuat datasource dan dashboard. Ini yang di-mount ke `/etc/grafana/provisioning`.
2. **Dashboard** (`observability/grafana/dashboards/*.json`) — isi dashboardnya sendiri, di-mount ke
   `/var/lib/grafana/dashboards`, path yang disebut oleh file provisioning di lapis 1.

Datasource ditandai `editable: false`. Artinya: kalau seseorang mengubah URL Prometheus lewat UI,
Grafana menolak. Ini mencegah kelas kegagalan "dashboard di produksi menunjuk Prometheus staging dan
tidak ada yang tahu selama tiga minggu". Provider dashboard justru `allowUiUpdates: true` — jadi kamu
boleh mengedit lewat UI untuk eksplorasi, tapi `updateIntervalSeconds: 30` berarti file di disk
adalah kebenaran dan akan memuat ulang secara berkala.

Bagian yang paling layak diperhatikan: isi dashboardnya **mencerminkan alert satu-per-satu**. Panel
"5xx error rate (SLO < 2%)" memakai ekspresi PromQL yang persis sama dengan
`DroveryHighErrorRateWarning`. Panel "Waiting + delayed backlog (alert > 1000)" memakai ekspresi yang
persis sama dengan `DroveryQueueBacklog` — termasuk `max()`-nya. Panel workers pertama diberi judul
"BullMQ jobs by state (the KEDA scale signal)". Jadi dashboard di sini bukan koleksi grafik menarik;
ia adalah versi visual dari sinyal-sinyal yang dipakai untuk paging dan autoscaling. Kalau kamu
menatap satu panel dan angkanya naik, kamu tahu persis alert mana yang sedang mendekat.

**Anchor:**
- `observability/grafana/provisioning/datasources/prometheus.yml:1-8` — delapan baris; perhatikan
  `url: http://prometheus:9090` (nama service Docker, bukan localhost) dan `editable: false` di `:8`.
- `observability/grafana/provisioning/dashboards/dashboards.yml:1-12` — provider file, `folder: Drovery`,
  `path: /var/lib/grafana/dashboards`.
- `docker-compose.observability.yml:52-55` — **dua** mount berbeda plus volume `grafanadata`; kalau
  kamu salah satu mount-nya, dashboard tidak muncul dan tidak ada pesan error yang jelas.
- `observability/grafana/dashboards/drovery-api.json` — enam panel; cocokkan ekspresi panel "5xx error
  rate (SLO < 2%)" dengan `observability/alerts.yml:6-8` baris per baris.
- `observability/grafana/dashboards/drovery-workers.json` — enam panel; panel "Scrape targets up"
  memakai `up`, metrik gratis dari 9.6.
- `docker-compose.observability.yml:43-51` — kredensial `admin/admin` dan `GF_USERS_ALLOW_SIGN_UP: 'false'`.

**Kenapa dipakai di sini:** dashboard sebagai file berarti ia bisa di-review di PR (kamu bisa melihat
diff query PromQL), bisa di-`git bisect` saat panel berhenti menampilkan data, dan bisa **divalidasi
di CI** — yang persis dilakukan `observability-config.spec.ts:63-66` (JSON valid) dan `:38-61` (semua
nama metrik yang dirujuk benar-benar diemit aplikasi).

**Alternatif:**
- **Klik-klik di UI dan simpan ke database Grafana** — jauh lebih cepat untuk eksplorasi, dan kamu
  memang harus melakukannya saat merancang panel. Trade-off konkret: hilang saat volume dihapus,
  tidak muncul di code review, dan tidak ada yang bisa memberitahumu bahwa panelmu merujuk metrik yang
  sudah kamu hapus dari kode tiga bulan lalu.
- **Grafonnet / Jsonnet / Terraform provider** — dashboard sebagai kode yang bisa diparametrisasi
  (satu template untuk sepuluh service). Trade-off: satu toolchain lagi (jsonnet compiler) untuk
  dua dashboard; keuntungannya baru terasa di angka belasan dashboard.
- **Grafana Cloud** — nol operasional, dashboard aman di luar mesinmu. Trade-off: berbayar di atas
  free tier, dan seluruh metrik operasionalmu keluar dari mesin/jaringanmu — untuk sistem yang
  memproses pembayaran, itu keputusan yang perlu persetujuan, bukan default.

**Latihan:** ini adalah latihan "buktikan hilangnya", dan ia menjadi bagian capstone.
1. Buka `http://localhost:3001` (admin/admin) → folder "Drovery" → dashboard "Drovery — API".
2. Tambahkan satu panel baru lewat UI (mis. `sum(rate(drovery_http_requests_total{status=~"4.."}[5m]))`),
   simpan.
3. `docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile observability down`
   lalu `up -d`. Panelmu hilang.
4. Sekarang tambahkan panel yang sama ke `observability/grafana/dashboards/drovery-api.json` sebagai
   objek di array `panels` (salin struktur panel yang sudah ada, ganti `id`, `title`, `gridPos.y`,
   dan `targets[0].expr`). Naikkan `version`.
5. `down && up -d` lagi. Kali ini ia bertahan. Jalankan `npx jest observability-config` untuk
   memastikan JSON-mu valid dan nama metrikmu terdaftar.

---

### 9.11 Metrik yang jujur: gauge yang membaca 0 sebelum diisi, dan heartbeat yang tidak boleh di `finally`

Ini konsep yang paling jarang diajarkan dan yang paling membedakan observability yang berguna dari
observability yang menipu. Sebuah metrik bisa **benar secara teknis** dan **berbohong secara
operasional**. Repo ini punya dua contoh yang sangat bagus, dan keduanya didokumentasikan panjang di
tempat kejadian.

**Contoh pertama: `airspaceZonesInForce`.** Gauge ini menyimpan jumlah zona udara terlarang yang
sedang berlaku. Godaannya jelas: bikin alert `drovery_airspace_zones_in_force == 0`, karena registry
kosong berarti seed gagal atau tabel ter-truncate, dan itu berbahaya — sistem akan menerbangkan drone
ke mana saja. Tapi alert itu **tidak sah**, dan sepuluh baris komentar di
`metrics.service.ts:96-107` menjelaskan kenapa: Gauge `prom-client` tanpa label membaca **0 dari
proses start** sampai `.set()` pertama. Jadi tiga keadaan yang sangat berbeda terbaca identik:

1. Registry memang kosong (bahaya nyata).
2. Replika API ini belum pernah melayani satu quote pun, jadi cache-nya belum pernah diisi (normal).
3. Ini proses **worker** — ia membangun `AppModule` yang sama dan menyajikan registry yang sama di
   `:9091/metrics`, tapi tidak pernah memanggil `inForceZones()` sama sekali (normal, selamanya).

Poin ketiga adalah kejutan dari Fase 6 yang datang menagih: satu `MetricsService`, empat jenis proses,
dan sebagian metrik hanya bermakna di sebagian proses. Kesimpulan komentar itu: alert `== 0` harus
dibatasi pada replika yang **diketahui** pernah melayani quote, atau dipasangkan dengan sinyal
terpisah "cache pernah terisi".

Dan ada lapis kedua yang sama pentingnya di `airspace.service.ts:65-75`: `.set()` dipanggil **di dalam
cabang `if (!cached)`**, yang hanya tercapai ketika query benar-benar **resolve**. Kalau query gagal,
fungsinya melempar dan gauge tetap di nilai lamanya. Komentarnya menjelaskan taruhannya:
*"A stale reading is recoverable; a confident '0 restricted zones' produced by a DB blip is the exact
false all-clear the throw above exists to prevent."* Pembacaan basi bisa dipulihkan; nol yang
percaya diri adalah lampu hijau palsu.

**Contoh kedua: heartbeat watchdog setelah loop, bukan di `finally`.** `watchdogLastScan` adalah
gauge berisi timestamp scan terakhir yang **selesai**, dan ia menggerakkan alert bergaya
`time() - gauge > N`. Kalau `.set()` diletakkan di blok `finally`, ia akan menyala **bahkan ketika
scan-nya gagal total** — jadi watchdog yang setiap kali gagal membaca kandidat akan tetap terlihat
sehat selamanya. Repo meletakkannya persis setelah loop, dan komentar di
`delivery-watchdog.ts:132-135` mengeja konsekuensinya: kegagalan yang persisten meninggalkan gauge
basi sehingga alert menyala, sementara tick parsial (kegagalan per-baris yang sudah diisolasi) tetap
dianggap selesai dan memajukan heartbeat.

Perhatikan bahwa dua contoh ini menuju arah yang berlawanan, dan itu bukan inkonsistensi: pada
airspace, kegagalan harus meninggalkan nilai **lama** (jangan publikasikan nol palsu); pada
heartbeat, kegagalan harus meninggalkan nilai **lama** juga (jangan publikasikan kesegaran palsu).
Aturannya sama: **jangan pernah menulis nilai yang tampak menenangkan dari jalur yang gagal.**

**Anchor:**
- `src/metrics/metrics.service.ts:96-107` — sepuluh baris komentar tentang kenapa `== 0` tidak sah.
  Baca seluruhnya, ini teks paling padat di file itu.
- `src/metrics/metrics.service.ts:322-326` — teks `help` gauge-nya sendiri membawa peringatan itu,
  sehingga muncul di output `/metrics` dan di autocomplete Grafana.
- `src/serviceability/airspace.service.ts:65-75` — `.set()` di dalam cabang `if (!cached)`, dengan
  penjelasan taruhannya.
- `src/delivery-watchdog/delivery-watchdog.ts:132-136` — heartbeat setelah loop, dengan alasan
  eksplisit menolak `finally`.
- `src/metrics/metrics.service.ts:48-51` — komentar yang menyebut kedua gauge watchdog sebagai
  pasangan: last-scan untuk `time() - gauge > N`, scheduler-registered untuk `max(gauge) == 0`.
- `observability/alerts.yml:95-98` — contoh ketiga: gauge retention partisi sengaja **tidak**
  di-alert secara statis, karena dengan `PARTITION_RETAIN_MONTHS=0` partisi lama memang tumbuh secara
  desain; syarat kapan alert itu boleh dibuat ditulis di sana.

**Kenapa dipakai di sini:** Drovery menerbangkan benda di udara dan memproses pembayaran. Alert palsu
yang menenangkan di domain ini bukan gangguan, ia bahaya. Dan alert yang berisik akan dimatikan
seseorang dalam dua minggu, lalu tidak dinyalakan lagi. Komentar-komentar ini adalah cara repo
menolak keduanya.

**Alternatif:**
- **Pakai Gauge dengan nilai awal `NaN`/tidak diset sama sekali** — `prom-client` tidak punya
  "gauge yang belum ada" untuk gauge tanpa label; begitu dideklarasikan ia mengekspor 0.
  Trade-off yang tersedia: beri gauge itu **label** (mis. `{replica_ready="true"}`) sehingga
  series-nya baru lahir saat `.set()` pertama, dan `absent()` bisa membedakan "belum pernah" dari
  "benar-benar nol". Biayanya: satu label lagi dan query alert yang lebih rumit.
- **Gauge kedua sebagai "cache pernah terisi"** (`drovery_airspace_cache_filled` 0/1) — persis yang
  disarankan komentar. Alert jadi `drovery_airspace_zones_in_force == 0 and drovery_airspace_cache_filled == 1`.
  Trade-off: satu metrik lagi yang harus dijaga konsisten dengan yang pertama; kalau salah satunya
  lupa di-set, alert diam lagi.
- **Cek di CI alih-alih di runtime** — komentar di `:96-97` menyebut bahwa semua guard lain di
  permukaan ini memang hidup di CI, terhadap database yang baru `migrate deploy`. Trade-off: CI tidak
  tahu apa yang terjadi pada database produksi jam 3 pagi; runtime tahu tapi tidak bisa membedakan
  ketiga keadaan di atas. Repo memakai keduanya dan menuliskan batas masing-masing.

**Latihan:** dua bagian.
1. Jalankan **worker** saja (`PROCESS_ROLE=worker npm run worker`) dan
   `curl -s localhost:9091/metrics | grep drovery_airspace_zones_in_force`. Kamu akan melihat `0`.
   Sekarang bayangkan alert `== 0` yang menyala dari sini, selamanya, di setiap pod worker. Tulis
   satu kalimat kenapa itu akan membuat tim mematikan alertnya dalam seminggu.
2. Buka `src/delivery-watchdog/delivery-watchdog.ts`, pindahkan `this.metrics.watchdogLastScan.set(...)`
   dari baris 136 ke dalam blok `finally` yang membungkus seluruh method. Jalankan
   `npx jest delivery-watchdog` — perhatikan spec mana yang berubah maknanya
   (`delivery-watchdog.spec.ts` memeriksa `toHaveBeenCalledTimes(1)` di enam skenario berbeda). Lalu
   kembalikan, dan tulis kenapa versi `finally` membuat alert kesegaran menjadi tidak berguna.

---

### 9.12 OpenTelemetry: satu `traceId` melintasi API → queue → worker → DB

Sampai sini kamu punya dua dari tiga sinyal: metrik (agregat, cardinality rendah) dan log
(per-kejadian). Yang hilang adalah **trace**: satu permintaan diikuti melintasi semua komponen yang
menanganinya, dengan waktu per langkah.

Auto-instrumentation HTTP bisa menyambung request→request lintas service. Tapi arsitektur Drovery
punya jurang yang tidak bisa diseberangi otomatis: **queue**. Ketika `POST /api/v1/deliveries` selesai,
ia meninggalkan 17 job di Redis (5 stage + 12 position tick). Worker mengambilnya beberapa detik
kemudian, di proses yang berbeda, dan memulai konteks yang benar-benar baru. Pertanyaan "tulisan DB
yang lambat ini berasal dari request create yang mana?" jadi tidak terjawab.

Repo menjembataninya dengan dua fungsi yang sangat kecil dan sangat spesifik:

- **`injectTraceCarrier(data)`** — di sisi producer. Ia menyalin konteks trace aktif (format W3C
  `traceparent`) ke dalam `data._carrier` dan mengembalikan objek **baru**. Perhatikan `_carrier`
  hanya menempel di data job, tidak di database, tidak di response.
- **`withJobSpan(jobName, carrier, fn)`** — di sisi consumer. Ia meng-`extract` konteks dari carrier,
  membuka span dengan `SpanKind.CONSUMER`, dan menjalankan handler di dalamnya. Semua span pg/ioredis
  yang lahir di dalam `fn` otomatis bersarang di bawahnya dan berbagi `traceId` yang sama.

Dua sifat implementasinya layak ditiru di kode apa pun:

**Nol biaya saat mati.** Ketika tracing nonaktif, `injectTraceCarrier` mengembalikan
**referensi yang sama persis** (`if (!traceReady || !otelApi) return data;`). Bukan salinan — referensi
yang sama. Payload job benar-benar byte-identical, dan `tracing.spec.ts:24` menguncinya dengan
`expect(out).toBe(data)`. Ini bukan mikro-optimasi: kalau job data berubah bentuk saat tracing menyala,
kamu punya dua sistem berbeda dan `jobId` deterministik-mu bisa berubah perilaku.

**Fail-open.** Seluruh `start()` dibungkus `try/catch`, dan di `catch` semua state di-reset supaya
tidak ada yang tertinggal setengah terpasang. Alasannya ditulis: *"a bad OTLP endpoint or an
instrumentation incompat must degrade to untraced, NOT crash boot"* — dan ingat, modul ini di-import
**sebelum** `AppModule`, jadi kegagalan di sini akan membunuh aplikasi sebelum satu provider pun
dibuat.

Terakhir, hal yang paling mudah dilanggar tanpa sadar: **urutan import**. Instrumentation OTel bekerja
dengan mem-*patch* modul (`pg`, `ioredis`, `http`, `express`) pada saat `require`. Kalau `AppModule`
di-import lebih dulu, modul-modul itu sudah ter-cache dalam bentuk aslinya dan patch tidak berlaku —
tracing menyala, tapi span database tidak pernah muncul. Karena itu komentar di `main.ts:8` dan
`worker.ts:5` berbunyi identik: **"MUST stay above the AppModule import"**.

**Anchor:**
- `src/main.ts:4-9` dan `src/worker.ts:2-6` — urutan import Sentry → tracing → AppModule, dengan
  peringatan yang sama di kedua file.
- `src/common/monitoring/tracing.ts:1-4` — kenapa `require()` malas alih-alih `import`: SDK hanya
  dimuat kalau tracing dinyalakan.
- `src/common/monitoring/tracing.ts:46-49` — kebijakan fail-open, dan kenapa taruhannya lebih besar
  daripada Sentry.
- `src/common/monitoring/tracing.ts:162-174` — `injectTraceCarrier`, termasuk `return data` (referensi
  sama) di jalur mati.
- `src/common/monitoring/tracing.ts:176-212` — `withJobSpan`, `propagation.extract` +
  `SpanKind.CONSUMER` + `recordException` + `span.end()` di `finally`.
- `src/deliveries/simulation/simulation.service.ts:56-66` — sisi producer; komentar `:56-57`
  menyebut sifat pass-through-nya.
- `src/deliveries/simulation/simulation.processor.ts:71-85` — sisi consumer; perhatikan carrier dibaca
  dari `job.data._carrier` dan seluruh dispatch dibungkus.
- `src/common/monitoring/tracing.ts:99-106` — `/metrics` dan `/health` diabaikan supaya scrape tiap 15
  detik tidak membanjiri trace store.
- `src/common/monitoring/tracing.ts:114-117` dan `:153-160` — `ParentBasedSampler` di atas
  `TraceIdRatioBased`, 5% di production dan 100% di dev. `ParentBased` penting di sini: worker
  **menghormati** keputusan sampling producer, jadi trace lintas proses tidak terpotong separuh.
- `src/common/monitoring/tracing.spec.ts:21-26` — kontrak "referensi yang sama" yang dikunci test.
- `ARCHITECTURE.md:143` — klaim hasilnya: *"one `traceId` spans the create request → queue → worker →
  DB (verified live with the console exporter)."*

**Kenapa dipakai di sini:** karena inilah satu-satunya cara menjawab pertanyaan yang akan kamu punya
di Fase 11 saat sesuatu lambat: apakah lambatnya di API, di antrian, atau di worker? Metrik memberitahu
**bahwa** ada yang lambat; trace memberitahu **di mana**.

**Alternatif:**
- **Correlation id manual** — generate UUID di request, ikutkan di `job.data`, log di semua tempat.
  Setengahnya sudah ada lewat `genReqId` di `src/app.module.ts:89-95`. Trade-off konkret: murah, tanpa
  dependensi, tanpa collector — tapi kamu hanya dapat *korelasi log*, bukan waterfall latensi
  per-span. Kamu bisa tahu langkah mana yang terjadi, bukan langkah mana yang memakan 800ms.
- **Sentry Performance** — satu vendor untuk error + trace, setup paling ringan. Trade-off: lihat 9.13
  — di repo ini Sentry dan OTel standalone tidak bisa hidup berdampingan, jadi memilihnya berarti
  melepaskan kebebasan mengekspor span ke Tempo/Jaeger.
- **Datadog APM / New Relic** — auto-instrumentation paling lengkap, termasuk jembatan queue untuk
  banyak library. Trade-off: berbayar per host dan mengunci vendor; OTel adalah spesifikasi netral
  yang bisa diarahkan ke backend mana pun dengan mengganti satu exporter.
- **eBPF (Pixie, Cilium Hubble)** — nol perubahan kode, melihat semua traffic di level kernel.
  Trade-off konkret: buta terhadap batas queue — jurang yang justru jadi masalah utama di sini —
  karena tidak ada koneksi jaringan antara producer dan consumer, hanya key di Redis.

**Latihan:** ini latihan inti fase, dan ia bagian dari capstone. Tanpa infra apa pun:
```bash
TRACING_ENABLED=true OTEL_EXPORTER=console npm run start:dev                    # terminal 1
TRACING_ENABLED=true OTEL_EXPORTER=console PROCESS_ROLE=worker npm run worker   # terminal 2
```
Buat satu delivery. Di terminal 1 cari span bernama `POST /api/v1/deliveries` dan catat `traceId`-nya.
Di terminal 2 cari span `bullmq.process stage` dan catat `traceId`-nya. **Harus identik.** Setelah
itu, di `simulation.service.ts:60`, ganti `injectTraceCarrier({...})` dengan objek polos `{...}` dan
ulangi. `traceId` worker sekarang berbeda — dan itulah persisnya seluruh pekerjaan satu fungsi tadi.
Kembalikan perubahannya, lalu jalankan `npx jest tracing` untuk memastikan kontrak pass-through masih
utuh.

---

### 9.13 Sentry vs OTel: satu pemilik provider global, dan `shutdownTracing()` saat SIGTERM

Ada satu baris di repo ini yang menghemat berjam-jam debugging bagi siapa pun yang membacanya:

```ts
export const tracingEnabled = wanted && !sentryEnabled;
```

Latar belakangnya begini. OpenTelemetry API punya **satu** tracer provider global per proses, satu
propagator global, satu context manager global. `@sentry/node` — kapan pun `SENTRY_DSN` di-set —
mendaftarkan ketiganya tanpa syarat, **bahkan pada `tracesSampleRate: 0`**. Jadi kalau kamu memasang
NodeSDK standalone di samping Sentry, salah satu dari keduanya akan diam-diam kalah. Gejalanya adalah
yang paling menyiksa di seluruh observability: **"tracing menyala tapi tidak ada span"**. Tidak ada
error, tidak ada warning, hanya kekosongan. Kamu akan mencurigai config exporter, firewall, sampling,
dan versi library — semuanya salah alamat.

Repo menyelesaikannya di **konfigurasi**, bukan di runtime: satu boolean yang membuat konflik itu
mustahil terjadi, plus `console.warn` yang memberitahu apa yang harus dilakukan kalau kamu meminta
keduanya. Rekomendasinya bahkan ditulis di dokstring: *"leave SENTRY_DSN unset and set
TRACING_ENABLED → OTel owns tracing."*

Bagian kedua konsep ini lebih mudah dilupakan dan sama mahalnya. `BatchSpanProcessor` (yang dipakai
saat exporter OTLP) **menahan span di memori** dan mengirimnya berkelompok. Kalau proses menerima
SIGTERM dan mati tanpa flush, span dari menit terakhir sebelum shutdown hilang — dan menit terakhir
sebelum deploy atau sebelum crash biasanya persis menit yang paling kamu butuhkan. Karena itu
`shutdownTracing()` dipanggil di handler SIGTERM/SIGINT di **kedua** entrypoint. Perhatikan bahwa di
`worker.ts` ia digabung dengan `server.close()` dalam satu `onShutdown` — metrics server dan trace
flush ditutup bersama, di samping `app.enableShutdownHooks()` milik Nest yang menguras job aktif.

**Anchor:**
- `src/common/monitoring/tracing.ts:24` — barisnya sendiri.
- `src/common/monitoring/tracing.ts:14-18` — alasan lengkapnya: *"@sentry/node, whenever a DSN is set,
  registers the GLOBAL OTel tracer provider/propagator/context manager unconditionally (even at
  tracesSampleRate 0), so a standalone SDK would be ignored or conflict. Pick one owner."*
- `src/common/monitoring/tracing.ts:34-40` — `console.warn` yang menyebutkan solusinya, bukan sekadar
  mengeluh.
- `src/common/monitoring/sentry.ts:3-9` — aturan urutan yang sama untuk Sentry: `Sentry.init` harus
  jalan sebelum module graph di-import.
- `src/common/monitoring/sentry.ts:10-12` — `sentryEnabled = Boolean(dsn)`; satu-satunya sumber
  kebenaran yang dibaca `tracing.ts`.
- `src/common/monitoring/sentry.ts:24-31` — `captureException` yang `return` lebih awal saat nonaktif:
  pola "real-or-mock" yang sama seperti seluruh integrasi eksternal di repo ini.
- `src/common/monitoring/tracing.ts:220-228` — `shutdownTracing()`, best-effort, no-op saat mati.
- `src/main.ts:78-83` dan `src/worker.ts:72-78` — dua tempat pemanggilannya.

**Kenapa dipakai di sini:** ini konflik nyata antara dua library yang keduanya "benar" secara
individual, dan tidak ada pesan error yang akan memberitahumu. Repo memilih membuatnya mustahil
terjadi ketimbang membuatnya bisa didebug.

**Alternatif:**
- **Sentry saja, dengan `SENTRY_TRACES_SAMPLE_RATE > 0`** — satu dashboard untuk error dan performance,
  setup paling sedikit, dan error otomatis terhubung ke trace-nya. Trade-off konkret: kamu terikat
  model sampling dan retensi Sentry, dan tidak bisa mengekspor span ke Tempo/Jaeger kalau nanti mau
  self-host.
- **`@sentry/opentelemetry` bridge** — paket resmi yang menjembatani keduanya: span OTel dikirim ke
  Sentry. Trade-off: satu paket + konfigurasi propagator lagi, dan kamu tetap kehilangan kebebasan
  memilih backend trace karena tujuannya tetap Sentry.
- **Tidak pakai error tracker sama sekali, andalkan log terstruktur** — repo sebenarnya bisa: pino
  sudah menstempel `trace_id` di setiap baris (9.14), jadi Loki atau CloudWatch Insights bisa
  menggantikan sebagian fungsinya. Trade-off: tidak ada grouping per-issue, tidak ada "error ini
  pertama muncul di rilis v1.4.2 dan menimpa 340 user", tidak ada alert per-issue baru.

**Latihan:** buktikan konfliknya dengan mata sendiri.
1. `TRACING_ENABLED=true OTEL_EXPORTER=console npm run start:dev` → catat baris
   `[tracing] OpenTelemetry enabled (...)` dari `tracing.ts:132-134`.
2. Hentikan, lalu jalankan lagi dengan tambahan `SENTRY_DSN=https://x@example.invalid/1`. Kamu akan
   melihat peringatan dari `tracing.ts:37-39` dan **tidak ada satu pun span** OTel di console.
3. Sekarang tulis spec baru bergaya `tracing.spec.ts` yang mengunci kontrak Sentry: `captureException`
   adalah no-op saat `SENTRY_DSN` tidak di-set. Petunjuknya sudah ada di `sentry.ts:29` — buat spec-nya
   menjadi kontrak, bukan kebetulan.

---

### 9.14 pino: `mixin` untuk `trace_id`, `genReqId`, dan `redact` untuk field pembawa kredensial

Log adalah sinyal ketiga, dan yang paling mudah dianggap remeh karena kamu sudah menulis ribuan
`console.log` seumur hidupmu. Perbedaannya di sini cuma satu tapi mengubah segalanya: **log
terstruktur adalah JSON, bukan kalimat**. Baris `Delivery abc-123 failed` tidak bisa di-query;
`{"msg":"delivery failed","deliveryId":"abc-123","level":50}` bisa difilter, diagregasi, dan
dihubungkan.

Repo memasang `nestjs-pino` di `AppModule` dengan empat konfigurasi yang masing-masing menyelesaikan
satu masalah nyata:

**`mixin` → `trace_id`.** Setiap baris log otomatis distempel dengan trace id yang sedang aktif.
Inilah jahitan yang menyatukan tiga sinyal: kamu melihat spike di metrik, membuka trace yang lambat,
lalu memfilter log dengan `trace_id` itu dan mendapat semua baris yang dihasilkan permintaan tersebut
di **semua** proses. Perhatikan `mixin` mengembalikan `{}` kalau tracing mati — tidak ada field
kosong yang mengotori setiap baris.

**`genReqId` → `X-Request-Id`.** Kalau header `x-request-id` datang dari luar (mis. dari nginx atau
dari klien mobile-mu), ia dipakai; kalau tidak, `randomUUID()`. Lalu ia **dipantulkan kembali** di
response header. Ini memberimu kemampuan konkret: user melapor lewat support, kamu minta request id
dari log klien, dan kamu punya kunci untuk mencari sisi server.

**`redact` → jangan pernah mencatat kredensial.** Daftarnya eksplisit: `authorization`, `cookie`,
`x-ingest-key`, `set-cookie`, dan enam field body (`password`, `newPassword`, `currentPassword`,
`token`, `refreshToken`, `code`). Komentarnya jujur soal kenapa daftarnya ditulis padahal body
memang tidak diserialisasi secara default: *"an interceptor or a future error serializer can pull
them in — so the credential-bearing fields are listed explicitly rather than relied on being absent."*
Ini pola pertahanan yang benar: jangan andalkan sesuatu yang kebetulan tidak ada hari ini.

**`serializers.req` → hapus `?token=` dari URL.** Ini spesifik Drovery dan datang dari Fase 8:
handshake WebSocket menaruh JWT di query string (karena browser tidak bisa memasang header di
`new WebSocket(...)`). Tanpa serializer ini, setiap koneksi socket akan menuliskan JWT lengkap ke
log — kredensial yang bisa dipakai ulang, tersimpan permanen di log store.

**Anchor:**
- `src/app.module.ts:79-88` — `LoggerModule.forRoot` + `mixin` yang memanggil `activeTraceId()`.
- `src/app.module.ts:89-95` — `genReqId` dengan penerimaan header masuk dan pemantulan
  `X-Request-Id`.
- `src/app.module.ts:96-111` — komentar + daftar `redact`.
- `src/app.module.ts:112-118` — `serializers.req` dengan `redactTokenInUrl`.
- `src/app.module.ts:119-122` — `pino-pretty` di dev, JSON mentah di production. Kalau kamu bertanya
  "kenapa log produksi tidak enak dibaca" — karena ia tidak dibaca manusia, ia dibaca mesin.
- `src/common/redact.ts` — implementasi `redactTokenInUrl`; dipakai juga oleh
  `src/common/filters/http-exception.filter.ts:11`, jadi jalur error pun bersih.
- `src/common/monitoring/tracing.ts:214-218` — `activeTraceId()` yang jadi sumber `mixin`.
- `ARCHITECTURE.md:137` — ringkasannya di dokumen arsitektur.

**Kenapa dipakai di sini:** tanpa `trace_id` di log, tiga sinyalmu adalah tiga pulau. Dengan itu,
mereka satu alur investigasi. Dan tanpa `redact`, setiap insiden yang kamu selidiki juga menjadi
insiden kebocoran kredensial.

**Alternatif:**
- **Logger bawaan Nest (`Logger`)** — nol konfigurasi, output enak dibaca. Trade-off konkret: teks,
  bukan JSON — jadi tidak bisa difilter per field di log store, tidak ada request id otomatis, dan
  tidak ada redaction. Untuk satu proses di laptop itu cukup; untuk empat jenis proses berkali-lipat
  replika, tidak.
- **winston** — ekosistem transport paling luas (file rotation, syslog, banyak SaaS langsung).
  Trade-off: jauh lebih lambat daripada pino di jalur panas (pino menyerialkan di worker thread dan
  menghindari alokasi), dan pino punya integrasi Nest yang lebih rapi lewat `nestjs-pino`.
- **Kirim log langsung ke SaaS dari aplikasi** (transport HTTP) — tidak perlu agent. Trade-off: aplikasimu
  jadi bergantung pada ketersediaan SaaS itu di jalur request, dan buffer log yang penuh saat SaaS
  lambat bisa menekan memori proses. Konvensi container adalah menulis ke stdout dan membiarkan
  platform yang mengumpulkan.

**Latihan:** jalankan API dengan tracing menyala
(`TRACING_ENABLED=true OTEL_EXPORTER=console npm run start:dev`) dan `NODE_ENV=production` supaya
output-nya JSON mentah. Panggil satu endpoint dan periksa satu baris log: ia harus punya `trace_id`
dan `reqId`. Lalu panggil `POST /api/v1/auth/login` dengan password apa pun dan cari string
password-mu di seluruh output (`| grep -i "<password-mu>"`) — harus nihil. Terakhir, hapus sementara
`'req.body.password'` dari daftar `redact` di `src/app.module.ts:105`, dan buat satu error yang
menyeret body ke log; lihat perbedaannya. Kembalikan.

---

### 9.15 Alternatif yang dibandingkan: peta keputusan observability

Ini bukan konsep baru melainkan sintesis — dan ia ada di sini karena kamu meminta "apa alternatifnya"
sejak awal. Setelah empat belas subbagian, kamu punya cukup konteks untuk membaca tabel ini sebagai
keputusan, bukan sebagai daftar nama.

| Keputusan | Pilihan Drovery | Alternatif utama | Trade-off yang menentukan |
|---|---|---|---|
| Transport metrik | Pull (Prometheus scrape) | Push (StatsD/DogStatsD/Pushgateway) | Pull memberi `up` gratis dan memungkinkan gauge `collect()` on-scrape; push perlu agent di tiap node dan tidak bisa membedakan "mati" dari "tidak ada data" |
| Client library | `prom-client` langsung | `@willsoto/nestjs-prometheus` | Wrapper menghemat boilerplate tapi menghalangi registry kustom + `collect()`; repo butuh keduanya untuk disajikan dari dua bootstrap |
| Health check | Controller tulis tangan | `@nestjs/terminus` | Terminus memberi indicator siap pakai (DB/Redis/disk) + format response standar; repo memilih ~40 baris tulis tangan agar bentuk 503-nya persis cocok dengan selector alert `status="503"` di `alerts.yml:38` |
| Alert disimpan di | File YAML di git | Grafana Alerting (UI/DB) | File bisa di-review di PR dan divalidasi CI (`observability-config.spec.ts`); UI lebih enak ditulis tapi hilang bersama volume dan tak terlihat di diff |
| Routing notifikasi | Alertmanager | Langsung dari aplikasi / OnCall SaaS | Alertmanager memberi dedupe, grouping, inhibit, silence gratis dan lokal; SaaS memberi jadwal on-call yang benar-benar membangunkan orang tapi berbayar |
| Tracing | OTel standalone | Sentry Performance / Datadog APM / eBPF | OTel netral vendor dan bisa menjembatani queue; Sentry paling ringan tapi merebut provider global (9.13); eBPF nol kode tapi buta terhadap batas queue |
| Korelasi lintas proses | W3C context di `job.data._carrier` | Correlation id manual (UUID) | UUID manual murah dan sudah setengah ada lewat `genReqId`, tapi hanya memberi korelasi log — bukan waterfall latensi per-span |
| Backend semuanya | Self-host lokal | Datadog / New Relic / Grafana Cloud | SaaS menghapus kerja operasional tapi berbayar per host dan memindahkan data operasional keluar dari mesinmu; stack lokal ini jalan penuh di laptop dengan biaya nol |

**Anchor:**
- `src/health/health.controller.ts:9-13` dan `:28-39` — health check tulis tangan; bandingkan bentuk
  response 503-nya dengan selector `status="503"` di `observability/alerts.yml:38`.
- `src/metrics/observability-config.spec.ts:4-10` — kenapa "alert sebagai file" memberi kemampuan yang
  tidak dimiliki "alert sebagai state UI": *"Guards the observability config against the silent
  'parses fine but matches zero series' class of bug (promtool/JSON-lint can't catch a label/route
  that doesn't exist on the live metric)."*
- `src/metrics/observability-config.spec.ts:18-30` — dua kelas kesalahan yang dikunci: label
  `status_code` (nama dari library lain) dan selector readiness tanpa prefix.
- `package.json` — versi nyata yang dipakai: `prom-client ^15.1.3`, `@sentry/node ^9.47.1`,
  `nestjs-pino ^4.6.1`, dan sepuluh paket `@opentelemetry/*` yang dipin ketat.

**Kenapa dipakai di sini:** pilihan-pilihan di kolom kedua semuanya bisa berjalan di satu laptop tanpa
akun berbayar, dan semuanya menghasilkan artefak yang bisa di-review. Itu batasan sadar untuk repo
portfolio; batasan yang berbeda akan menghasilkan tabel yang berbeda, dan sekarang kamu punya alat
untuk mengevaluasinya sendiri.

**Alternatif:** (dari sudut pandang berbeda — kalau Drovery adalah produk komersial dengan tim on-call)
- **Ganti seluruh baris "self-host lokal" dengan Grafana Cloud atau Datadog** — hemat berminggu-minggu
  kerja operasional (upgrade, retention, storage, HA Prometheus). Biaya konkret: tagihan per host
  yang tumbuh dengan jumlah replika — persis dimensi yang kamu autoscale — jadi biaya observability
  naik tepat saat traffic naik.
- **Pertahankan Prometheus tapi tambahkan Thanos/Mimir untuk retention panjang** — Prometheus
  single-node menyimpan data lokal dengan retention terbatas; Thanos memindahkannya ke object storage
  dan memberi query lintas cluster. Biaya konkret: tiga komponen baru (sidecar, store gateway,
  compactor) yang semuanya harus dipantau — kamu butuh observability untuk observability-mu.

**Latihan:** ambil satu baris dari tabel di atas — yang paling kamu tidak setujui — dan tulis satu
halaman argumen tandingan yang **berlabuh pada kode Drovery**, bukan pada preferensi. Contoh yang baik:
"health check seharusnya pakai Terminus, karena X di `health.service.ts` akan jadi Y baris lebih
sedikit, dan selector alert bisa disesuaikan dengan mengubah `alerts.yml:38` menjadi Z." Kalau kamu
tidak bisa menyebut nomor baris di argumenmu, argumennya belum selesai.

---

## Capstone

Stack observability lokal berjalan:

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml \
  --profile observability up -d
```

Kriteria penerimaan. Setiap butir bisa **gagal di depan mata** — kalau ia tidak bisa gagal, ia bukan
kriteria.

**Prasyarat: stack hidup**
- [ ] `http://localhost:9090/targets` menampilkan **dua** target dan keduanya `UP`.
- [ ] Query `up` di Prometheus mengembalikan dua series dengan label `tier="api"` dan `tier="worker"`.
- [ ] `http://localhost:9093` (Alertmanager) dan `http://localhost:3001` (Grafana, admin/admin) bisa
      dibuka, dan folder "Drovery" berisi dua dashboard.

**Hasil 1 — Counter buatan sendiri, terpasang di empat titik, tampil di panel yang bertahan**
- [ ] `drovery_push_sent_total{result}` dideklarasikan di `MetricsService` sebagai `Counter`, dengan
      `registers: [this.registry]` dan komentar satu-dua baris yang menjelaskan **kenapa `result`
      adalah label yang cardinality-nya aman** (berapa nilai yang mungkin? sebutkan semuanya).
- [ ] Ia di-increment di **empat** cabang berbeda di `src/notifications/notifications.service.ts`
      (semua ada di dalam `sendPushToUser`, baris 239-322): tidak ada token Expo (`:260`), request ke
      Expo gagal (`:293-297`), token dilaporkan `DeviceNotRegistered` (`:303-311`), dan blok `catch`
      terluar (`:317-321`). Beri nilai `result` yang berbeda untuk masing-masing.
- [ ] `curl -s localhost:3000/api/v1/metrics | grep drovery_push_sent_total` menampilkan minimal satu
      series setelah kamu memicu satu notifikasi.
- [ ] Ada satu panel baru di `observability/grafana/dashboards/drovery-api.json` yang memplot
      `sum by (result) (rate(drovery_push_sent_total[5m]))`.
- [ ] Panel itu **masih ada** setelah
      `docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile observability down && ... up -d`.
      (Kalau ia hilang, kamu menyimpannya lewat UI, bukan ke file — ulangi 9.10.)
- [ ] `npx jest observability-config` **hijau** — artinya kamu sudah menambahkan
      `drovery_push_sent_total` ke daftar `emitted` di `observability-config.spec.ts:39-51`, dan JSON
      dashboardmu masih valid.

**Hasil 2 — alert baru yang benar-benar FIRING**
- [ ] Ada satu rule baru di `observability/alerts.yml` dengan `for:` yang masuk akal dan `labels.severity`
      yang kamu bisa pertanggungjawabkan.
- [ ] Kamu mematikan dependensinya (`docker compose stop <service>`), dan di `http://localhost:9090/alerts`
      rule itu terlihat berpindah `PENDING` → `FIRING`. Screenshot atau catat waktunya.
- [ ] Alert itu muncul di Alertmanager `:9093`, terkelompok sesuai `group_by`.
- [ ] Kamu bisa menjelaskan, tanpa membuka file, kenapa alertmu **tidak** memakai `sum()` (kalau ia
      menyentuh gauge queue-global) atau kenapa `sum()` justru benar (kalau ia menyentuh gauge
      per-replika).
- [ ] `npx jest observability-config` tetap hijau.

**Hasil 3 — satu `traceId` melintasi dua proses**
- [ ] Dua terminal berjalan dengan `TRACING_ENABLED=true OTEL_EXPORTER=console` (satu API, satu
      `PROCESS_ROLE=worker`).
- [ ] Kamu punya dua baris tersalin di catatanmu: span `POST /api/v1/deliveries` dari terminal 1 dan
      span `bullmq.process stage` dari terminal 2, dengan `traceId` yang **identik karakter per
      karakter**.
- [ ] Kamu melumpuhkan `injectTraceCarrier` di `simulation.service.ts:60`, mengulang, dan mencatat
      pasangan `traceId` yang **berbeda** — plus satu paragraf yang menjelaskan apa yang hilang.
- [ ] Kamu mengembalikan perubahan itu dan `npx jest tracing` hijau
      (`expect(out).toBe(data)` masih terpenuhi).
- [ ] Kamu menjalankan sekali dengan `SENTRY_DSN` di-set dan mencatat peringatan dari
      `tracing.ts:37-39` beserta hilangnya seluruh span.

**Verifikasi akhir**
- [ ] `npx jest metrics tracing observability-config` seluruhnya hijau.
- [ ] `git diff --stat` menunjukkan kamu menyentuh minimal: `metrics.service.ts`,
      `notifications.service.ts`, `observability/alerts.yml`,
      `observability/grafana/dashboards/drovery-api.json`, `observability-config.spec.ts`.

---

## Gerbang keluar

Kalau ada satu pun yang belum bisa kamu jawab tanpa membuka kode, jangan lanjut ke Fase 10.

**1. Kenapa `MetricsInterceptor` memakai `res.on('finish')` dan bukan `tap` RxJS — dan apa yang rusak kalau salah?**
<details><summary>Jawaban</summary>
`AllExceptionsFilter` menetapkan status code final **setelah** stream handler selesai. `tap` berjalan
sebelum itu, jadi ia merekam status yang salah (biasanya 200) untuk setiap request yang gagal. Yang
rusak: tiga alert yang bergantung pada label `status` (`DroveryHighErrorRateWarning`,
`DroveryHighErrorRatePage`, `DroveryReadinessFailing`) jadi senyap total — dan senyapnya tidak bisa
dibedakan dari "sistem sehat". Lihat `src/metrics/metrics.interceptor.ts:11-17`.
</details>

**2. Kamu punya tiga replika worker. Query mana yang benar untuk backlog queue, `sum()` atau `max()`, dan kenapa?**
<details><summary>Jawaban</summary>
`max()`. `getJobCounts()` bertanya ke Redis, yang menyimpan satu queue bersama, jadi **setiap** replika
mengekspor nilai yang sama persis. `sum()` mengalikan backlog dengan jumlah pod. Konsekuensi nyatanya
bukan cuma angka salah di dashboard: KEDA memakai query yang sama untuk memutuskan jumlah replika, jadi
`sum()` menciptakan loop umpan balik positif — makin banyak pod, makin besar angkanya, makin banyak pod.
Lihat `src/metrics/metrics.service.ts:328-331` dan `k8s/base/worker-scaledobject.yaml:51-56`.
Pengecualian penting: gauge yang memang per-replika (`drovery_ws_connections`) **harus** dijumlah.
</details>

**3. Kenapa `getJobCounts()` dibungkus `withTimeout(..., 1000)`, padahal biasanya kita membiarkan promise gagal sendiri?**
<details><summary>Jawaban</summary>
Karena ia tidak gagal. Koneksi BullMQ memakai `maxRetriesPerRequest: null` + offline queue ioredis
(wajib supaya perintah queue bertahan melewati reconnect), jadi saat Redis mati `getJobCounts()`
**menggantung** tanpa batas alih-alih menolak. Karena `collect()` berjalan di jalur request `/metrics`,
tanpa race itu seluruh scrape akan menggantung dan Prometheus melaporkan target `down` karena satu
gauge. Lihat `src/metrics/metrics.service.ts:346-348`.
</details>

**4. Kenapa alert `drovery_airspace_zones_in_force == 0` tidak sah?**
<details><summary>Jawaban</summary>
Gauge `prom-client` tanpa label membaca 0 dari proses start sampai `.set()` pertama. Jadi tiga keadaan
terbaca identik: registry benar-benar kosong (bahaya), replika API yang belum pernah melayani quote
(normal), dan **setiap proses worker** — yang membangun `AppModule` yang sama dan menyajikan registry
yang sama di `:9091`, tapi tidak pernah memanggil `inForceZones()` (normal selamanya). Alert harus
dibatasi pada replika yang diketahui pernah melayani quote, atau dipasangkan dengan gauge terpisah
"cache pernah terisi". Lihat `src/metrics/metrics.service.ts:96-107`.
</details>

**5. Kenapa `import` tracing harus berada di atas `import { AppModule }` di `main.ts` dan `worker.ts`?**
<details><summary>Jawaban</summary>
Instrumentation OTel bekerja dengan mem-patch modul (`http`, `express`, `pg`, `ioredis`) pada saat
`require`. Kalau `AppModule` di-import lebih dulu, modul-modul itu sudah masuk cache require dalam
bentuk aslinya dan patch tidak berlaku. Gejalanya: tracing tampak menyala, tapi span database dan
Redis tidak pernah muncul. Komentarnya berbunyi harfiah *"MUST stay above the AppModule import"* di
`src/main.ts:8` dan `src/worker.ts:5`.
</details>

**6. Kenapa `tracingEnabled = wanted && !sentryEnabled`, bukan dua flag independen?**
<details><summary>Jawaban</summary>
OpenTelemetry API punya satu provider/propagator/context manager global per proses. `@sentry/node`
mendaftarkan ketiganya tanpa syarat begitu `SENTRY_DSN` di-set — **bahkan pada `tracesSampleRate: 0`**.
Kalau keduanya hidup, salah satu diam-diam kalah dan menghasilkan nol span tanpa pesan error apa pun.
Repo menyelesaikannya di konfigurasi (satu boolean + `console.warn` yang menyebut solusinya) supaya
konflik itu mustahil terjadi. Lihat `src/common/monitoring/tracing.ts:14-24` dan `:34-40`.
</details>

**7. Kenapa `receivers` di `alertmanager.yml` sengaja kosong, dan apa yang tetap kamu dapat darinya?**
<details><summary>Jawaban</summary>
Alertmanager tidak mengekspansi environment variable di config-nya; `${WEBHOOK}` akan diambil literal
dan membuat prosesnya gagal start. Receiver kosong adalah receiver yang valid: kamu tetap mendapat
grouping, inhibition, dan silence di `:9093` — hanya pengirimannya yang tidak ada. Kalimat repo-nya:
*"Empty beats a fake URL that logs delivery errors forever."* Lihat `observability/alertmanager.yml:8-14`.
</details>

**8. Apa yang dilakukan `injectTraceCarrier` saat tracing mati, dan kenapa detail itu dikunci oleh test?**
<details><summary>Jawaban</summary>
Ia mengembalikan **referensi yang sama persis** — bukan salinan (`return data`). Artinya payload job
byte-identical antara mode tracing menyala dan mati, jadi dev/test/CI tidak berubah perilaku sama
sekali. `tracing.spec.ts:24` menguncinya dengan `expect(out).toBe(data)` — `toBe`, bukan `toEqual`.
Lihat `src/common/monitoring/tracing.ts:167-174`.
</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| `docker compose ... up -d` gagal atau mesinmu kehabisan RAM | Stack penuh (Postgres + Redis + api + worker + Prometheus + Alertmanager + Grafana) berat untuk laptop 8 GB — ini risiko yang diakui di depan | Jalankan tanpa container dulu: `npm run start:dev` + `npm run worker` di host, lalu jalankan **hanya** Prometheus dengan `prometheus.yml` yang target-nya diubah ke `host.docker.internal:3000` / `:9091`. Kamu kehilangan Grafana tapi tetap dapat 9.6–9.9. |
| Target `drovery-worker` `DOWN` padahal worker jalan | Salah satu dari tiga: worker di-boot dengan `PROCESS_ROLE` yang salah, port 9091 sudah dipakai proses lain, atau `METRICS_ENABLED=false` | Baca log worker — kalau port bentrok, ada pesan dari `src/worker.ts:65-67` dan worker **tetap hidup** (metrics-nya saja yang mati). Verifikasi langsung: `curl -sv localhost:9091/metrics`. Cek `metrics.enabled` di `src/config/configuration.ts:105`. |
| Metrikmu ada di `/metrics` tapi panel Grafana kosong | Nama metrik di panel tidak sama dengan yang diemit — biasanya lupa prefix `drovery_`, atau label yang dipakai di selector tidak ada di metrik itu | Jalankan ekspresi panelmu langsung di Prometheus `:9090/graph`. Kalau nihil, hapus selector satu per satu sampai ada data — selector terakhir yang kamu hapus adalah pelakunya. Lalu jalankan `npx jest observability-config`, yang memang dibuat untuk kelas bug ini (`observability-config.spec.ts:4-10`). |
| Alert-mu tidak pernah FIRING walau kondisinya jelas terpenuhi | `for:` belum terlampaui (ia butuh kondisi benar **berturut-turut**), atau ekspresinya mengembalikan nol series bukan `false` | Buka `:9090/alerts` dan lihat statusnya — `PENDING` berarti ekspresinya benar dan kamu hanya perlu menunggu; `INACTIVE` berarti ekspresinya tidak menghasilkan apa-apa. Uji ekspresinya sendiri di tab Graph. Ingat `evaluation_interval: 15s` (`observability/prometheus.yml:3`): `for: 2m` = 8 evaluasi. |
| Alert FIRING di Prometheus tapi tidak ada apa pun di Alertmanager | Blok `alerting:` hilang atau salah target — ini bug nyata yang pernah terjadi di repo ini | Cek `observability/prometheus.yml:11-14` menunjuk `alertmanager:9093`. Lalu `:9090/status` → bagian Alertmanagers harus menampilkan satu endpoint. Kalau kosong, Prometheus tidak tahu ke mana harus mengirim. Ceritanya ada di `observability/prometheus.yml:8-10`. |
| Tracing menyala (`[tracing] OpenTelemetry enabled`) tapi tidak ada satu pun span | `SENTRY_DSN` ikut terbaca dari `.env`-mu, jadi Sentry merebut provider global; atau import tracing berada di bawah `AppModule` | Cari baris peringatan dari `tracing.ts:37-39` di awal log. Kalau ada, `unset SENTRY_DSN` dan ulangi. Kalau tidak ada peringatan tapi span database tetap kosong, periksa urutan import di `src/main.ts:4-9` — patch `pg`/`ioredis` gagal kalau modulnya sudah ter-require. |
| Span muncul di API tapi `traceId` worker selalu berbeda | `injectTraceCarrier` tidak terpasang di producer, atau `job.data._carrier` hilang di perjalanan | `console.log(job.data)` di awal `simulation.processor.ts:71` — kalau `_carrier` tidak ada, masalahnya di producer (`simulation.service.ts:60`). Kalau ada tapi `traceId` tetap beda, tracing di proses worker tidak aktif — cek env-nya. |
| Panelmu hilang setelah `down && up -d` | Kamu menyimpannya lewat UI Grafana, bukan ke file JSON | Buka `observability/grafana/dashboards/drovery-api.json` dan cari judul panelmu. Kalau tidak ada, ia hanya hidup di volume `grafanadata` yang terhapus. Ini persis yang latihan 9.10 minta kamu buktikan. |
| `npx jest observability-config` merah setelah kamu menambah alert | Spec menolak nama metrik yang tidak ada di daftar `emitted`, atau kamu memakai label `status_code` alih-alih `status` | Baca pesan error-nya; `unknown` berisi nama metrik yang dirujuk config tapi tidak ada di daftar. Verifikasi aplikasi benar-benar mengemitnya (`grep -n "<nama>" src/metrics/metrics.service.ts`) **sebelum** menambahkannya ke daftar — menambahkan tanpa verifikasi membuat spec-nya jadi teater. Lihat `observability-config.spec.ts:38-61`. |
| Kamu bingung metrik mana yang bermakna di proses mana | Satu `AppModule` di-boot oleh empat jenis proses; sebagian metrik hanya diisi di sebagian tier | Ini kesulitan terbesar area ini, dan sudah kamu temui di Fase 6. Gambar ulang tabel provider × `PROCESS_ROLE`, tapi kali ini baris = metrik (`drovery_http_*`, `drovery_queue_jobs`, `drovery_ws_*`, `drovery_airspace_*`, `drovery_watchdog_*`). Verifikasi dengan membandingkan output `curl localhost:3000/api/v1/metrics` dan `curl localhost:9091/metrics` berdampingan. |

---

## Bacaan pendamping

Semua di `Drovery_Backend` kecuali disebut lain.

- **`ARCHITECTURE.md:135-143`** (§10 "Observability — you can't scale what you can't see") — daftar
  lengkap enam pilar observability repo ini dan status masing-masing. Baca `:143` pelan-pelan: ia
  merangkum seluruh konsep 9.12 dan 9.13 dalam satu paragraf, termasuk klaim "verified live with the
  console exporter" yang capstone-mu ulangi.
- **`DEPLOY.md:221-254`** (§Alerting) — versi operasional dari 9.7 dan 9.8: kenapa Alertmanager
  ditambahkan, apa yang kamu dapat dari receiver kosong, dan — yang paling berharga — batas cakupan
  `DroveryReadinessFailing` yang ditulis terus terang.
- **`src/metrics/metrics.service.ts:29-37` dan `:96-107`** — dua blok komentar terpadat di seluruh
  area ini. Yang pertama menetapkan dua keputusan arsitektural dalam empat baris; yang kedua adalah
  contoh terbaik di repo tentang bagaimana menuliskan **batas kejujuran** sebuah metrik.
- **`observability/alertmanager.yml:1-14`** — baca sebagai esai, bukan config. Empat belas baris
  komentar yang menjelaskan sebuah bug, sebuah keterbatasan tool, dan sebuah keputusan desain yang
  mengikutinya.
- **`k8s/base/worker-scaledobject.yaml:1-10` dan `:51-56`** — kamu belum akan menjalankan ini sampai
  Fase 11, tapi bacalah sekarang: ia menunjukkan metrik yang kamu pelajari minggu ini berubah menjadi
  tuas yang menggerakkan infrastruktur, dan mengulang aturan `max()` vs `sum()` dengan kata-kata yang
  sedikit berbeda.
- **`src/metrics/observability-config.spec.ts`** — 67 baris, baca seluruhnya. Ini contoh langka
  "test terhadap konfigurasi", dan dokstringnya (`:4-10`) menamai kelas bug yang ia cegah dengan tepat.
- **`loadtest/metrics-probe.sh:1-20`** — komentar kepala skrip ini menjelaskan kenapa mengukur drain
  dari **gauge** backlog dan bukan dari counter `completed` (yang di-cap ~1000 oleh `removeOnComplete`).
  Contoh bagus tentang memilih metrik yang benar untuk pertanyaan yang benar.

Dokumentasi resmi, hanya tiga dan hanya kalau benar-benar perlu:

- [PromQL: operator agregasi](https://prometheus.io/docs/prometheus/latest/querying/operators/#aggregation-operators)
  — untuk memahami apa yang dilakukan `by`/`without` pada label, yang menjelaskan kenapa
  `max by (queue)` berbeda dari `max`.
- [Prometheus: alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
  — khususnya semantik `for:` dan perbedaan status `INACTIVE`/`PENDING`/`FIRING`.
- [W3C Trace Context](https://www.w3.org/TR/trace-context/) — format `traceparent` yang persis
  disalin `injectTraceCarrier` ke `job.data._carrier`. Baca hanya bagian §3.2; sisanya tidak kamu
  butuhkan.

# Peta Belajar — `backend:delivery-domain` (Drovery)

> **Untuk siapa:** frontend dev Ionic React + Capacitor. Kamu sudah paham React, TypeScript, dan konsumsi REST dari sisi klien.
> **Yang BELUM kamu temui di frontend:** state machine yang dipaksakan di database, konkurensi multi-proses, job queue durabel, saga/kompensasi uang, WebSocket dari sisi server, dan "physical resource" (drone) yang bisa bocor.
>
> **Kalimat kunci area ini:** di frontend, mengubah status adalah `setState('IN_TRANSIT')` — satu penulis, satu proses, tidak ada lawan. Di sini, mengubah status adalah **balapan** antara worker simulasi, telemetri drone sungguhan, watchdog, admin, dan customer — dan pemenangnya ditentukan oleh Postgres, bukan oleh JavaScript.

---

## Peta wilayah (sekilas, sebelum masuk ke konsep)

```
                       CreateDeliveryDto (HTTP)
                              │
        ┌─────────────────────▼──────────────────────┐
        │ DeliveriesService.create()                 │
        │  1. assertWeightWithinCap  (fisika)        │
        │  2. resolveCoords          (GeoService)    │
        │  3. assertServiceable      (Serviceability)│
        │  4. pricingService.estimate                │
        │  5. promo + wallet         (uang)          │
        │  6. dispatchService.dispatch (klaim drone) │
        │  7. $transaction: delivery + registry      │
        │  8. enqueue simulasi ATAU biarkan telemetri│
        └────────────────────────────────────────────┘
                 │                        │
        SIMULATED│                        │LIVE
                 ▼                        ▼
      SimulationProcessor          TelemetryService.ingest()
      (BullMQ, worker tier)        (HTTP /ingest + MQTT, api tier)
                 │                        │
                 └──────► CAS status ◄────┘   (satu pemenang)
                              │
                    TrackingService.updateTracking
                              │
                    TrackingPublisher → Redis pub/sub
                              │
                    TrackingSubscriber → TrackingGateway (WS)
                              │
                        HP customer

  Pengaman: DeliveryWatchdog (telemetri senyap) · OrphanReaperService (uang nyangkut)
```

---

## 1. Delivery sebagai State Machine (bukan sekadar kolom `status`)

- **Prasyarat:** —
- **Anchor:**
  - `prisma/schema.prisma:241` — `enum DeliveryStatus` (13 status, dengan komentar yang menjelaskan mana yang *branch*, mana yang *transient*, mana yang *terminal*).
  - `src/deliveries/simulation/simulation.constants.ts:13` — `STATUS_ORDER`: jalur bahagia yang **linear**.
  - `src/deliveries/simulation/simulation.constants.ts:24` — `statusesBefore(target)`: "hanya boleh maju dari status yang lebih awal".
  - `src/deliveries/delivery-exceptions.ts:17,28,37,47` — empat himpunan status: `FAILABLE_STATUSES`, `TERMINAL_STATUSES`, `RETURNABLE_STATUSES`, `POSITION_FROZEN_STATUSES`.
- **Kenapa dipakai di sini:** Komentar di `delivery-exceptions.ts:3-9` menyatakan alasannya secara eksplisit: status pengecualian (`RETURNING`, `DELIVERY_FAILED`, `RETURNED_TO_BASE`) sengaja diletakkan **DI LUAR** `STATUS_ORDER` — *"so the monotonic forward CAS can never enter them and a terminal can't be resurrected."* Artinya, aturan "jangan pernah menghidupkan kembali delivery yang sudah selesai" tidak dijaga oleh `if` yang tersebar, melainkan oleh **bentuk data**: karena `RETURNING` tidak ada di `STATUS_ORDER`, `statusesBefore()` secara matematis tidak mungkin menghasilkannya.
  Perhatikan juga bahwa himpunan-himpunan ini dipisah menurut **pertanyaan yang mereka jawab**, bukan menurut kemiripan nama:
  - `FAILABLE_STATUSES` = "drone sedang terbang" (boleh di-FAIL),
  - `RETURNABLE_STATUSES` = "drone sudah memegang paket" (boleh pulang membawa barang; `DRONE_ASSIGNED` tidak masuk karena belum ambil paket — lihat `delivery-exceptions.ts:35-36`),
  - `POSITION_FROZEN_STATUSES` = "marker di peta tidak boleh bergerak lagi" — dan `RETURNING` **sengaja absen** di sini (`delivery-exceptions.ts:45-46`) karena user harus melihat drone terbang pulang.

  Satu status yang sama bisa masuk himpunan A tapi tidak B. Itu inti pemodelan domain: satu enum, banyak sudut pandang.
- **Alternatif:**
  - **String bebas / boolean berlapis (`isDelivered`, `isCanceled`, `isFailed`)** — cara paling umum di app kecil. Tradeoff: kombinasi mustahil jadi *representable* (`isDelivered && isCanceled`), dan tidak ada satu tempat pun yang bisa ditanya "status apa saja yang terminal?". Di sini itu akan mematikan `adminForceCancel` (`deliveries.service.ts:975-981`) yang bergantung pada `TERMINAL_STATUSES` sebagai daftar tunggal.
  - **Library state machine (XState, `javascript-state-machine`)** — transisi jadi deklaratif dan bisa divisualisasi. Tradeoff: mesinnya hidup **di memori proses**, sedangkan di sini ada 3+ proses (api, worker, realtime) yang bersaing atas satu baris DB. XState akan tetap butuh CAS di bawahnya, jadi ia menambah lapisan tanpa menghapus masalah utamanya.
  - **Kolom `status` + tabel `delivery_status_transitions` (event sourcing ringan)** — riwayat lengkap gratis. Tradeoff: setiap pembacaan status jadi agregasi; repo ini memilih "current state di baris + `FlightFrame` sebagai append-only log terpisah" (`flight-recorder.service.ts:68`), yaitu hybrid.
- **Latihan:** Buat file `docs/state-machine.md` berisi diagram Mermaid `stateDiagram-v2` dari `DeliveryStatus`. Turunkan panahnya **dari kode**, bukan dari tebakan: panah hijau dari `STATUS_ORDER`, panah merah dari `FAILABLE_STATUSES → DELIVERY_FAILED`, `RETURNABLE_STATUSES → RETURNING → RETURNED_TO_BASE`, dan `CANCELABLE_STATUSES → CANCELED` (`deliveries.service.ts:103`). Lalu jawab tertulis: **status mana saja yang bisa dimasuki lebih dari satu aktor berbeda?** (petunjuk: `DELIVERY_FAILED` punya 4 pemanggil).

---

## 2. Validasi di boundary vs invariant di service (kenapa DTO saja tidak cukup)

- **Prasyarat:** #1
- **Anchor:**
  - `src/deliveries/dto/create-delivery.dto.ts:20` — `class-validator` decorators (`@IsIn`, `@Matches`, `@Min`).
  - `src/common/package-limits.ts` — `assertWeightWithinCap()` beserta komentar panjangnya.
  - `src/deliveries/deliveries.service.ts:211` dan `:218` — dua assert pertama di dalam `create()`, sebelum I/O apa pun.
  - `src/deliveries/delivery-schedule.ts:40` — `isValidPickupDate()`.
- **Kenapa dipakai di sini:** Ini pelajaran yang **tidak akan pernah kamu temui** di Ionic React, karena di frontend "input" selalu datang dari form. Komentar di `package-limits.ts` menuliskan bug aslinya: *"`MAX_WEIGHT_KG` existed since the beginning with ZERO call sites: the only enforcement was a react-hook-form validator in the mobile app, so any direct API call could book a 500 kg 'Small' package."* Dan alasan kenapa decorator DTO saja tetap tidak cukup: *"`create()` is also reached by reorder, favorite-order and the recurring materializer, all of which hand-build a `CreateDeliveryDto` in-process and therefore never pass through the ValidationPipe."*

  Buktinya bisa kamu lihat langsung: `recurring.materializer.ts:140` (`toCreateDto`) dan `deliveries.service.ts:1391` (`reorder`) sama-sama memanggil `create()` dengan objek buatan tangan. `ValidationPipe` Nest hanya berjalan di boundary HTTP.

  Kasus kedua lebih halus lagi: `@Matches(PICKUP_DATE_RE)` hanya mengecek **bentuk**. `delivery-schedule.ts:26-39` menjelaskan `2026-02-31` lolos regex, lalu `Date.UTC` diam-diam menggulungnya jadi 3 Maret — *"delivery scheduled for a day the client never asked for"*. Regex tidak bisa mengekspresikan tahun kabisat; satu-satunya tes jujur adalah membangun tanggalnya dan mengecek ia tidak bergeser (`isValidPickupDate`, `:40-49`).
- **Alternatif:**
  - **Zod / Valibot sebagai schema tunggal** — bisa dipakai di controller *dan* di dalam service, jadi jalur non-HTTP ikut tervalidasi. Tradeoff: kehilangan integrasi otomatis dengan Swagger/`@nestjs/swagger` dan `ValidationPipe`; repo ini memilih `class-validator` (default Nest) + assert manual untuk jalur internal.
  - **Constraint di database (`CHECK (package_weight <= ...)`)** — paling tidak bisa dilanggar. Tradeoff: pesan errornya jelek (P2010 mentah), tidak bisa dilokalkan seperti `error.delivery.package.weight_exceeds_cap`, dan aturan per-ukuran (`MAX_WEIGHT_KG[size]`) sulit diekspresikan.
  - **Percaya validasi klien saja** — inilah keadaan awal repo, dan komentarnya adalah post-mortem-nya.
- **Latihan:** Tambahkan aturan baru: `packageTypes` yang berisi `'healthcare'` wajib disertai `receiver` non-kosong minimal 3 karakter. Implementasikan **dua kali** — sekali sebagai decorator di `CreateDeliveryDto`, sekali sebagai assert di awal `create()`. Lalu tulis satu spec di `deliveries.service.spec.ts` yang memanggil `reorder()` atas delivery lama dengan `receiver: 'X'` dan buktikan hanya versi service yang menangkapnya.

---

## 3. Data server-authoritative: geocode menang atas koordinat klien

- **Prasyarat:** #2
- **Anchor:**
  - `src/deliveries/deliveries.service.ts:559-577` — blok JSDoc `resolveCoords`, khususnya baris berlabel `SECURITY`.
  - `src/deliveries/deliveries.service.ts:610` — `assertCoordAgreesWithAddress()`.
  - `src/deliveries/dto/create-delivery.dto.ts:77-79` dan `:104-113` — komentar "Advisory only" dan catatan tentang field yang **dihapus**.
  - `src/geo/geo.service.ts:42` — `geocode()` dengan cache positif/negatif.
- **Kenapa dipakai di sini:** Komentar `:563-570` menuliskan eksploitnya persis: *"This used to be 'client-supplied coords win', which meant the distance fee — the largest single component of the price (`PER_KM_RATE × haversine`) — was computed from a number the caller chose. Posting `fromLat/fromLng === toLat/toLng` zeroed it, and the same coords were then handed to `assertServiceable`, so the geofence was passed by construction rather than checked."*

  Dua kerugian sekaligus dari satu field: **harga jadi nol** dan **geofence jadi bohong**. Perbaikannya bukan "validasi lebih ketat", melainkan **memindahkan sumber kebenaran**: alamat di-geocode server-side, koordinat klien hanya dipakai sebagai sinyal *input sanity* (kalau menyimpang > 1 km → 400).

  Perhatikan `create-delivery.dto.ts:104-113`: `trackingSource` dan `droneId` **dulunya ada di DTO publik**. Komentarnya: *"both were operator concerns sitting in a customer's request body."* Ini pola yang berulang di seluruh repo — pertanyaan "siapa yang berhak memutuskan ini?" lebih penting daripada "apakah nilainya valid?".

  Pelajaran tambahan di `geo.service.ts:56-63`: membedakan `not_found` (provider menjawab: alamat tidak ada) dari `failed` (provider tidak menjawab). Hanya yang pertama boleh di-negative-cache — *"caching it for `GEO_MISS_TTL_S` would turn one transient blip into an hour of hard failures"*, karena delivery **fail-closed** pada lokasi yang tak terselesaikan.
- **Alternatif:**
  - **Percaya koordinat klien, geocode hanya sebagai fallback** — 1 round-trip lebih hemat per create. Tradeoff: persis lubang harga di atas. Komentar `:572-573` memilih sebaliknya secara eksplisit: *"correctness beats a saved round-trip on a money path."*
  - **Geocode asinkron di worker (terima dulu, backfill kemudian)** — latensi create turun drastis; ini bahkan tercatat sebagai rencana di `ARCHITECTURE.md:70`. Tradeoff: harga dan serviceability tidak bisa diputuskan saat create, jadi kamu butuh status `PRICING_PENDING` dan mekanisme pembatalan otomatis kalau alamatnya ternyata di luar area.
  - **Provider berbayar (Google Geocoding / Mapbox) alih-alih Nominatim** — akurasi rooftop, tanpa limit 1 req/detik. Tradeoff: biaya per panggilan; repo memakai Nominatim + cache Redis 30 hari (`geo.service.ts:11`) yang cocok untuk portfolio, dan `ARCHITECTURE.md §2` menandai penggantian provider sebagai pekerjaan yang tersisa.
- **Latihan:** Jalankan `npx jest src/deliveries/deliveries.service.spec.ts -t coord` untuk melihat tes yang ada. Lalu tulis tes baru: klien mengirim `fromAddress: "Bandung"` **dan** `fromLat/fromLng` yang berjarak 5 km dari hasil geocode mock → harapkan `AppBadRequestException` dengan key `error.delivery.coords.address_mismatch`. Setelah itu, coba naikkan `MAX_COORD_DEVIATION_KM` dari 1 ke 50 dan jelaskan tertulis serangan apa yang kembali terbuka.

---

## 4. Gerbang berlapis + kebijakan fail-closed vs fail-open

- **Prasyarat:** #3
- **Anchor:**
  - `src/deliveries/deliveries.service.ts:631-687` — `assertServiceable()`: pemetaan hasil ke **422 (hard, non-retryable)** vs **503 + `retryAfter` (soft, retryable)**.
  - `src/serviceability/serviceability.service.ts:43` — `checkServiceability()`: urutan HARD → HARD → HARD → SOFT.
  - `src/serviceability/serviceability.service.ts:76-116` — blok fail-**closed** airspace (baca komentarnya utuh; ada "OPEN QUESTION" yang jujur di dalamnya).
  - `src/serviceability/weather.service.ts:108-118` — `failOpen` cuaca.
  - `src/serviceability/airspace.service.ts:39-52` — cache **baris**, bukan cache **jawaban**.
  - `src/serviceability/serviceability.constants.ts:26-41` — `DEFAULT_MAX_ROUTE_KM` dan kenapa ia terpisah dari feasibility per-pesawat.
- **Kenapa dipakai di sini:** Ini konsep paling "engineering judgment" di area ini, dan repo menuliskan alasannya dengan tegas di `serviceability.service.ts:77-81`: *"Weather is advisory and fails open: an unreachable forecast must not ground the fleet. Airspace is not advisory. If we cannot read the zone list we do not know whether this route crosses restricted airspace, and the only safe answer to 'I don't know' is no. **Do not 'fix' this into consistency with weather.**"*

  Dua dependensi eksternal, dua kebijakan kegagalan yang **berlawanan**, dan alasannya ditulis di tempat kejadian supaya orang berikutnya tidak "merapikannya".

  `serviceability.constants.ts:26-41` menambahkan pelajaran kedua: check "in service area" tidak membatasi **jarak**. Dengan `SERVICE_AREA_GLOBAL=true`, rute Jakarta→London lolos semua gerbang, dihargai, dan diterima. Karena itu ada `ROUTE_TOO_LONG` sebagai **batas fisika** yang berlaku di waktu quote — terpisah dari feasibility per-airframe di `dispatch/` yang lebih ketat lagi. Dua batas, dua tingkat pengetahuan.

  Dan `airspace.service.ts:41-51` adalah bug halus yang layak dibaca dua kali: yang di-cache adalah **rows** hasil query, bukan hasil filter "sedang berlaku". Kalau yang di-cache adalah jawabannya, zona TFR yang dijadwalkan aktif pukul 14:00 baru berlaku setelah TTL habis — *"That was the only fail-open window in a service written to fail closed."*
- **Alternatif:**
  - **Semua dependensi fail-open** — uptime maksimal. Tradeoff: pesawat terbang ke zona terlarang saat DB kedip.
  - **Semua dependensi fail-closed** — paling aman. Tradeoff: satu API cuaca down = seluruh armada grounded; jelas tidak proporsional untuk sinyal yang sifatnya saran.
  - **Circuit breaker + cache stale-while-revalidate untuk airspace** — kompromi: pakai daftar zona lama saat DB down, dengan batas umur. Tradeoff: butuh keputusan "seberapa basi masih aman", dan komentar di `:104-109` justru menandai bahwa klasifikasi transient-vs-permanen untuk kasus ini **masih salah** hari ini (blip DB diperlakukan permanen → refund).
  - **PostGIS + `ST_DWithin`** menggantikan geometri manual (`routeNearCircle`, `:218`). Tradeoff: benar secara geodesik dan bisa diindeks, tapi mengunci ke ekstensi Postgres dan membuat logikanya tak lagi bisa diuji sebagai fungsi murni.
- **Latihan:** Di `src/serviceability/serviceability.service.spec.ts`, tambahkan tes: `airspace.inForceZones()` di-mock melempar error → harapkan hasil `serviceable: false`, `codes: ['NO_FLY_ZONE']`, dan `messageKey === 'error.serviceability.AIRSPACE_UNVERIFIED'`. Lalu tes pasangannya untuk cuaca: `weather.getConditions()` melempar → harapkan `serviceable: true`. Tulis satu paragraf: kenapa dua mock yang "sama-sama gagal" menghasilkan dua jawaban berlawanan?

---

## 5. Compare-And-Set (CAS) di database — primitif konkurensi inti repo ini

- **Prasyarat:** #1
- **Anchor:**
  - `src/deliveries/deliveries.service.ts:876-897` — `cancel()`: komentar "SINGLE-WINNER CAS, and it runs BEFORE any cleanup" + post-mortem race-nya.
  - `src/deliveries/simulation/simulation.processor.ts:371-380` — CAS monoton di `handleStage`.
  - `src/deliveries/deliveries.service.ts:1482-1495` — CAS `AWAITING_HANDOFF → DELIVERED` di `confirmHandoff`.
  - `src/deliveries/deliveries.service.ts:1448-1478` — CAS bersyarat untuk **counter** (`handoffAttempts`), TOCTOU-safe.
  - `src/recurring-deliveries/recurring.materializer.ts:83-88` — CAS atas **cursor** waktu.
- **Kenapa dipakai di sini:** Polanya selalu sama dan layak kamu hafal:

  ```ts
  const { count } = await prisma.delivery.updateMany({
    where: { id, status: { in: <himpunan yang diizinkan> } },  // prasyarat
    data:  { status: <status baru> },
  });
  if (count === 0) { /* kalah balapan / status sudah berubah */ }
  ```

  `where` membawa **seluruh prasyarat**, jadi Postgres yang memutuskan siapa menang — bukan `if` di JavaScript. Komentar di `cancel()` (`:878-884`) adalah post-mortem yang paling jelas di repo: *"This used to be: read, then three network round-trips of cleanup, then an UNCONDITIONAL status write... a lost race both refunded a delivery that had already completed AND overwrote its terminal status with CANCELED."*

  Konsekuensi turunannya yang sama pentingnya: karena `count > 0` hanya terjadi pada **satu** pemanggil, semua efek samping mahal (refund, notifikasi, pelepasan drone) diletakkan **setelah** CAS — sehingga otomatis "exactly once" tanpa distributed lock. Lihat `failExceptional` (`:1147-1181`): `if (matched === 0) return null;` lalu baru `cleanupAfterTermination` + `announceException`.

  Ada juga catatan kejujuran teknis yang bagus untuk dibaca: `:1080-1084` mengakui bahwa membaca status lalu CAS **bukan** jaminan atomik di isolation level READ COMMITTED — *"it is a read-then-CAS, not a guarantee"* — dan menjelaskan kenapa `FOR UPDATE` tidak dipakai di jalur itu.
- **Alternatif:**
  - **`SELECT ... FOR UPDATE` (pessimistic lock)** — benar dan mudah dinalar. Tradeoff: memegang lock baris selama transaksi; kalau ada I/O jaringan di dalamnya (refund Stripe, MQTT), lock ikut ditahan — persis yang dihindari `:1104-1105` (*"the cleanup that follows is deliberately OUTSIDE, because it does network I/O"*).
  - **Kolom `version` (optimistic locking ala JPA/TypeORM)** — deteksi konflik generik. Tradeoff: butuh baca-dulu untuk tahu versinya, dan retry loop di aplikasi. CAS berbasis status lebih murah *dan* lebih ekspresif: `where` sekaligus mendokumentasikan transisi mana yang legal.
  - **Redis distributed lock (Redlock)** — bisa mengunci lintas resource. Tradeoff: menambah komponen yang bisa gagal, dan kebenarannya bergantung pada clock; di sini Postgres sudah jadi sumber kebenaran, jadi menaruh kunci di tempat lain justru menambah mode kegagalan.
  - **Serializable isolation** — Postgres yang menolak transaksi berkonflik. Tradeoff: throughput turun dan aplikasi tetap harus menangani `40001` serialization failure.
- **Latihan:** Tulis tes race di `deliveries.service.spec.ts`: panggil `Promise.all([svc.confirmHandoff(u, id, code), svc.confirmHandoff(u, id, code)])` dengan `updateMany` di-mock mengembalikan `{count:1}` pada panggilan pertama dan `{count:0}` pada kedua. Pastikan `dispatchService.release` dipanggil **tepat sekali** dan pemanggil kedua menerima `AppConflictException`. Lalu rusak kodenya: pindahkan `release()` ke **sebelum** CAS, jalankan lagi, dan catat apa yang bocor.

---

## 6. Inti domain sebagai fungsi murni, terpisah dari I/O

- **Prasyarat:** #4
- **Anchor:**
  - `src/dispatch/flight-feasibility.ts:1-11` — header file: *"Pure geometry + energy arithmetic. No I/O, no Prisma, no Nest."*
  - `src/dispatch/flight-feasibility.ts:56` `missionDistanceKm` · `:98` `usableRangeKm` · `:143` `assessFeasibility` · `:181` `rankCandidates`.
  - `src/deliveries/telemetry/energy.ts:59` — `assessRecall()`, yang **memakai ulang** `usableRangeKm`.
  - `src/deliveries/simulation/preflight.ts:42` — `classifyPreflight()`; `:76` — `holdExhausted()`.
  - `src/recurring-deliveries/recurrence.ts:62` — `computeNextOccurrence()`.
  - `src/dispatch/dispatch.constants.ts:1-6` — *"Every number here is a SAFETY margin, not a preference."*
- **Kenapa dipakai di sini:** Alasan di `energy.ts:1-6` sangat spesifik dan bukan teori: *"deciding whether an aircraft still has the energy to reach its base is the one calculation in this system whose failure mode is a drone on someone's roof, and it should be testable without a database, a delivery or a telemetry frame."*

  Yang lebih penting untuk dipelajari adalah **pemakaian ulang lintas modul**. `flight-feasibility.ts:99-102` menjelaskan kenapa `usableRangeKm` sengaja menerima tipe `Pick<...>` yang sempit: *"saying so lets the in-flight recall check (`telemetry/energy.ts`) share this exact function instead of growing a second energy model that would drift from it."* Dan `energy.ts:56-58`: *"an aircraft is sent out on a budget, and recalled when that same budget stops covering the return. Two separate energy models would eventually disagree, and the disagreement would be discovered in the field."*

  Satu fungsi, dua pemakaian yang berlawanan arah (berangkat vs pulang), satu definisi energi. Ini adalah versi domain-nya dari "single source of truth".

  Perhatikan juga `preflight.ts:69-78`: `holdExhausted` **sengaja** dipisah dari `classifyPreflight` — *"whether the weather is bad and whether we have run out of patience are different questions, and folding them together made the retry budget invisible at the call site."*
- **Alternatif:**
  - **Menaruh perhitungan di dalam service ber-`@Injectable()`** — konsisten dengan gaya Nest, mudah di-mock. Tradeoff: setiap tes butuh `Test.createTestingModule`, dan godaan untuk menyelipkan `prisma.xxx` ke tengah rumus jadi besar.
  - **Menghitung di SQL** (`ORDER BY` dengan ekspresi jarak) — 1 round-trip, ranking di DB. Tradeoff: `dispatch.constants.ts:58-61` menjelaskan mengapa tidak: *"feasibility needs geometry SQL cannot express"* — makanya ada `CANDIDATE_LIMIT = 50` yang membatasi baris yang ditarik lalu diranking in-process.
  - **Rules engine / tabel konfigurasi di DB untuk margin keselamatan** — operator bisa mengubah tanpa deploy (persis yang dilakukan untuk zona airspace!). Tradeoff: nilai-nilai di `dispatch.constants.ts` adalah margin fisika, bukan kebijakan bisnis; menaruhnya di DB berarti seseorang bisa mengetik `RANGE_RESERVE_FRACTION = 0` pada jam 2 pagi.
- **Latihan:** Tanpa menyentuh database, tulis tes properti sederhana di `src/dispatch/flight-feasibility.spec.ts`: untuk 1000 kombinasi acak `(rangeKm, batteryPercent, payloadKg)`, buktikan `usableRangeKm` **selalu** `>= 0` dan **selalu** monoton naik terhadap `batteryPercent`. Lalu ubah `PAYLOAD_RANGE_PENALTY` dari `0.35` ke `1.2` dan jelaskan kenapa clamp di `:114` (`Math.min(1, ...)`) menyelamatkan sistem dari range negatif.

---

## 7. Job queue durabel + idempotensi (BullMQ), pengganti `setTimeout`

- **Prasyarat:** #1, #5
- **Anchor:**
  - `src/deliveries/simulation/simulation.service.ts:34-38` — JSDoc kelas: kenapa BullMQ, bukan `setTimeout`.
  - `src/deliveries/simulation/simulation.service.ts:20-28` — `JOB_OPTS`: `attempts: 5`, backoff eksponensial, retensi berbasis umur.
  - `src/deliveries/simulation/simulation.service.ts:58-83` — `jobId` **deterministik** (`${deliveryId}:stage:${i}`).
  - `src/deliveries/simulation/simulation.service.ts:143-160` — `deferKickoff`: kenapa jobId **harus berbeda** per attempt.
  - `src/deliveries/simulation/simulation.service.ts:162-174` — `withTimeout` (`ENQUEUE_TIMEOUT_MS`) supaya create tidak menggantung saat Redis mati.
  - `src/deliveries/deliveries.module.ts:44,88` — `RUN_PROCESSOR = IS_WORKER_TIER`: consumer hanya hidup di tier worker.
- **Kenapa dipakai di sini:** `ARCHITECTURE.md:13` menempatkan ini sebagai **blocker nomor satu** yang sudah dibereskan: simulasi in-memory berbasis `setTimeout` → job BullMQ durabel. Bukti verifikasinya ada di `ARCHITECTURE.md:50`: *"created a delivery (17 delayed jobs), killed the API mid-flight (jobs remained in Redis), started a fresh instance — the delivery still reached DELIVERED with proof recorded."*

  Dua hal yang berpasangan dan wajib kamu pahami bersamaan:
  1. **Queue = at-least-once.** Job bisa dijalankan dua kali (retry, stalled-job redelivery). Itu aman **hanya karena** handler-nya CAS-based: `simulation.processor.ts:371-375` — *"makes a re-run (retry / stalled job re-delivery) a no-op instead of a duplicate transition or regression."* Konsep #5 dan #7 saling menopang; salah satu tanpa yang lain berbahaya.
  2. **`jobId` deterministik = enqueue idempoten.** Enqueue dua kali dengan id sama → satu job. Karena itu `stopSimulation` (`:178`) bisa menghapus job berdasarkan id yang dihitung ulang, tanpa menyimpan referensi.

  Dan kontra-contohnya ada di `deferKickoff` (`:135-141`): id yang sama justru **berbahaya** di sana — *"reusing it would be deduped against the job currently being processed and the hold would silently become a drop"* — maka setiap attempt dapat suffix `-r2`, `-r3`. Idempotensi lewat id bukan aturan buta; ia harus dipikirkan per kasus.

  Satu lagi yang sangat "production": `preflightAttempt` ikut di **payload job**, bukan di memori worker (`simulation.constants.ts:85-90`) — *"otherwise a redeploy resets it and a delivery grounded by weather is held forever."*
- **Alternatif:**
  - **`setTimeout` / `@nestjs/schedule` in-process** — nol infrastruktur. Tradeoff: hilang saat restart, tidak bisa horizontal scale (N replika = N timer untuk delivery yang sama).
  - **`pg_cron` / tabel job di Postgres (`SKIP LOCKED`)** — tanpa Redis, transaksional bersama data. Tradeoff: delayed job berskala besar membebani tabel yang sama dengan beban OLTP; tidak ada dashboard seperti Bull Board.
  - **Temporal / AWS Step Functions (workflow engine)** — durable execution sungguhan, retry dan kompensasi jadi first-class; secara konsep inilah yang paling cocok untuk saga di #13. Tradeoff: satu komponen infrastruktur besar lagi, dan `Redis` sudah ada di sini untuk cache + pub/sub.
  - **Kafka** — throughput ekstrem, replay log. Tradeoff: tidak punya "delayed job" native (butuh trik), dan ini adalah orkestrasi per-entity, bukan stream analitik.
- **Latihan:** Jalankan `docker compose up -d redis postgres`, lalu `npm run start:dev`. Buat satu delivery lewat `POST /deliveries`, dan **sebelum 70 detik** matikan proses (Ctrl-C). Cek Redis: `redis-cli --scan --pattern 'bull:delivery-simulation:*'`. Hidupkan lagi dan buktikan delivery tetap mencapai `AWAITING_HANDOFF`. Lalu ubah `jobId` di `startSimulation` menjadi `${deliveryId}:stage:${i}:${Date.now()}`, buat dua delivery yang sama, dan jelaskan duplikasi apa yang muncul.

---

## 8. Dua produsen, satu kontrak: `SIMULATED` vs `LIVE`

- **Prasyarat:** #5, #7
- **Anchor:**
  - `prisma/schema.prisma:272-279` — `enum TrackingSource` beserta komentar *"never both drive one delivery (the choice is fixed at create())"*.
  - `src/deliveries/telemetry/telemetry.service.ts:39-51` — JSDoc kelas: *"reimplements none of them. Safety follows for free."*
  - `src/deliveries/telemetry/telemetry.constants.ts:3-10` — kenapa drone mengirim **PHASE**, bukan `DeliveryStatus`.
  - `src/deliveries/telemetry/telemetry.service.ts:107` (guard LIVE-only) dan `:114` (kepemilikan drone↔delivery).
  - `src/deliveries/deliveries.service.ts:524-529` — sisi berpasangannya: LIVE **tidak** meng-enqueue job simulasi.
  - `src/deliveries/telemetry/drone-auth.guard.ts:20-37` — auth aktor non-manusia (shared key + HMAC bertimestamp), fail-closed.
  - `src/deliveries/telemetry/mqtt-telemetry.subscriber.ts:9-17` — transport kedua, core yang sama.
- **Kenapa dipakai di sini:** Ini pelajaran arsitektur terbaik di area ini untuk seorang frontend dev, karena ia menunjukkan cara memperkenalkan **hardware sungguhan** tanpa mengubah kontrak API sedikit pun. `ARCHITECTURE.md:56`: *"a real drone now is an interchangeable producer for the same tracking contract... reuses the **same** monotonic CAS + `TrackingService` + `TrackingPublisher`, so the API and mobile contracts don't change."*

  Yang paling elegan adalah **kosakata wire yang sengaja berbeda**. `telemetry.constants.ts:3-10`: drone mengirim `'ARRIVED'`, bukan `'AWAITING_HANDOFF'`. Karena `PHASE_TO_STATUS` (`:36-42`) **tidak punya entri yang menghasilkan `DELIVERED`**, secara struktural mustahil bagi drone (atau penyerang yang memegang kunci ingest) untuk menyatakan paket sudah diterima. `DELIVERED` hanya bisa dicapai lewat OTP dari penerima (`confirmHandoff`). Keamanan lewat **bentuk peta**, bukan lewat `if`.

  Guard-nya juga berlapis dan tiap lapis menjawab pertanyaan berbeda:
  - `DroneAuthGuard` — "apakah kamu gateway yang sah?" (kunci + HMAC atas `timestamp.method.url.rawBody`, `:86-95` — mengikat method+URL supaya signature tidak bisa di-*retarget* ke route lain),
  - `trackingSource !== LIVE` → 403 — "apakah delivery ini memang digerakkan telemetri?",
  - `assignedDroneId !== droneId` → 403 — "apakah kamu drone yang ditugaskan untuk delivery ini?"
- **Alternatif:**
  - **Satu jalur saja (selalu LIVE)** — tidak ada mode simulasi. Tradeoff: mustahil demo/CI tanpa hardware; `dispatch.constants.ts:8-20` menjelaskan `LIVE_DISPATCH` default OFF justru untuk itu.
  - **Drone mengirim `DeliveryStatus` mentah** — lebih sedikit pemetaan. Tradeoff: drone bisa mengirim `DELIVERED` atau `CANCELED`; seluruh jaminan di atas hilang.
  - **mTLS / sertifikat per-perangkat** menggantikan shared key. Tradeoff: benar untuk skala armada, tapi butuh PKI; `drone-auth.guard.ts:35-36` menyatakan penundaan itu secara sadar: *"a rotatable shared key is proportionate for a portfolio backend with no hardware."*
  - **MQTT sebagai satu-satunya transport** — lebih hemat untuk perangkat IoT. Tradeoff: butuh broker; repo menjadikannya **transport opsional kedua** yang memanggil `ingest()` yang sama (`mqtt-telemetry.subscriber.ts:53`), jadi tes yang sama meng-cover keduanya.
- **Latihan:** Aktifkan `LIVE_DISPATCH=true` dan `INGEST_API_KEY=dev-key`, seed satu `Drone` airworthy, buat delivery, lalu kirim frame telemetri berurutan dengan `curl` (`phase: CONFIRMED` → `ASSIGNED` → `PICKUP` → `IN_TRANSIT` → `ARRIVED`). Setelah itu **kirim ulang** frame `PICKUP` dan buktikan status **tidak mundur**. Terakhir, kirim `phase: 'DELIVERED'` dan jelaskan kenapa TypeScript menolaknya bahkan sebelum runtime.

---

## 9. Klaim & pelepasan resource fisik (dispatch engine)

- **Prasyarat:** #5, #6
- **Anchor:**
  - `src/dispatch/dispatch.service.ts:67-82` — JSDoc kelas: sejarah `drone-${uuidv4()}` yang tidak mereferensikan baris apa pun.
  - `src/dispatch/dispatch.service.ts:173-253` — `selectAndClaim()`: re-entrancy check → ranking → loop klaim CAS.
  - `src/dispatch/dispatch.service.ts:135-159` — `release()` + `ReleaseOutcome`.
  - `src/deliveries/deliveries.service.ts:121-128` — `type AircraftDisposition = ReleaseOutcome | 'STILL_AIRBORNE'`.
  - `src/deliveries/deliveries.service.ts:1497-1502` — pelepasan di jalur **sukses**, dengan post-mortem-nya.
  - `src/deliveries/deliveries.service.ts:1156-1174` — dua alasan independen untuk **tidak** mengembalikan pesawat ke pool.
- **Kenapa dipakai di sini:** Konsep yang benar-benar absen dari dunia frontend: sebuah baris database mewakili **benda fisik yang bisa hilang**. Repo menuliskan tiga bug asli, dan ketiganya layak dibaca sebagai satu cerita:

  1. **Jalur sukses tidak melepaskan apa-apa** (`deliveries.service.ts:1497-1501`): *"every terminal path had a release except the one that actually happens, so a healthy fleet lost one airframe per completed delivery until every drone was permanently 'in flight' and dispatch had nothing left to assign."*
  2. **Jalur gagal melepaskan terlalu cepat** (`:1294-1299`): `RETURNING` adalah terminal untuk *uang*, bukan untuk *pesawat* — drone masih di udara membawa paket. Karena itu ada nilai ketiga `STILL_AIRBORNE` yang bukan `ReleaseOutcome`, dan pelepasan sesungguhnya terjadi di `completeReturnToBase` (`:1229`).
  3. **`RECIPIENT_UNAVAILABLE` bukan salah pesawat, tapi pesawatnya tetap terbang** (`:1156-1167`): *"'The airframe is not at fault' and 'the airframe is parked' are different questions; only the second one licenses a release."*

  Ranking-nya juga mengajarkan optimasi **global vs lokal** (`flight-feasibility.ts:168-179`): kunci utama adalah **kapasitas terkecil yang mencukupi**, bukan yang terdekat — *"Sending the 5 kg heavy-lift airframe to carry a 200 g envelope is locally optimal and globally wrong: it is the only aircraft that can take the next heavy booking."*

  Dan `selectAndClaim:178-194` menangani kasus yang tidak terpikirkan pemula: pemanggil yang **sudah** memegang klaim (retry BullMQ, re-run `create()`), karena `activeDeliveryId` UNIQUE — tanpa cek re-entrant, retry akan meranking pesawat lain, kena P2002, dan pesawat pertama tertahan selamanya.
- **Alternatif:**
  - **Tabel `drone_reservations` terpisah dengan TTL** — klaim kedaluwarsa sendiri, jadi kebocoran sembuh otomatis. Tradeoff: butuh sweeper, dan TTL yang salah bisa menjual pesawat yang sedang terbang.
  - **Redis lock per drone** — klaim cepat, tanpa membebani Postgres. Tradeoff: kepemilikan pesawat jadi *tidak durabel*; kalau Redis kehilangan key, dua delivery memegang satu airframe.
  - **Antrian penugasan (assign lewat worker, bukan sinkron saat create)** — create jadi cepat dan tidak pernah ditolak karena armada penuh. Tradeoff: customer tidak langsung tahu bookingnya diterima; repo memilih menolak di depan (`saturationError`, `:268`) dan **membedakan** "tidak akan pernah bisa" (`NO_CAPACITY`) dari "tidak sekarang" (`UNAVAILABLE`) — karena hanya perbedaan itu yang bisa ditindaklanjuti customer.
  - **Ranking di SQL** — lihat tradeoff di konsep #6.
- **Latihan:** Seed 3 drone dengan `maxPayloadKg` 1, 5, dan 25. Buat delivery 0.2 kg dan buktikan lewat log `Dispatched drone ...` bahwa yang dipilih adalah drone 1 kg. Lalu tulis tes di `dispatch.service.spec.ts` yang memaksa `updateMany` mengembalikan `{count:0}` untuk kandidat pertama dan `{count:1}` untuk kedua — buktikan kandidat kedua yang diklaim, bukan lempar error. Terakhir, hapus baris `await this.dispatchService.release(...)` di `confirmHandoff` dan jalankan suite: tes mana yang gagal?

---

## 10. Realtime fan-out: WebSocket gateway + Redis pub/sub + hot store

- **Prasyarat:** #7, #8
- **Anchor:**
  - `src/deliveries/tracking/tracking.gateway.ts:29-42` — JSDoc: kenapa `ws` (bukan socket.io) dan bagaimana ia horizontal-scalable.
  - `src/deliveries/tracking/tracking.publisher.ts:34-40` — publisher hidup di **worker**; *"the worker has no WS server, so it can't deliver to clients directly."*
  - `src/deliveries/tracking/tracking.subscriber.ts:36-49` — himpunan `desired` + `rearmAll()`, post-mortem "satu kedipan Redis membuat klien tuli permanen".
  - `src/deliveries/tracking/tracking.gateway.ts:172-185` — status frame **tidak pernah** di-drop; position frame di-drop saat backpressure.
  - `src/deliveries/tracking/position-coalescer.ts:6-17` — coalescing 10 Hz → N Hz, status selalu lewat.
  - `src/deliveries/tracking/tracking-hot-store.ts:28-38` dan `:100-107` — posisi panas di Redis + **fallback yang load-bearing**.
  - `src/deliveries/deliveries.service.ts:774-788` — overlay posisi hot ke hasil `findOne` (polling sebagai fallback WS).
- **Kenapa dipakai di sini:** Ini tempat pengetahuan frontend-mu paling berguna sekaligus paling menipu. Kamu tahu WebSocket dari sisi klien; yang baru adalah bahwa **socket-nya dipegang oleh replika yang berbeda dari yang menghitung update**. Solusinya (`ARCHITECTURE.md:77`): *"This decouples 'who computed the update' from 'who holds the socket.'"*

  Tiga keputusan yang harus kamu bawa pulang:
  1. **Bukan semua frame sama pentingnya.** `tracking.gateway.ts:172-176`: *"A STATUS transition is NEVER dropped: it's recoverable only via a poll, and a terminal status FREEZES position so no later frame supersedes it. Only the position stream is lossy (the next frame supersedes a dropped one)."* Pembagian yang sama diulang di coalescer (`position-coalescer.ts:12-15`). Dua komponen berbeda, satu aturan domain.
  2. **Backpressure adalah masalah server.** Klien lambat → `client.bufferedAmount` membengkak → OOM. `WS_MAX_BUFFERED_BYTES` (`realtime.constants.ts:19`) membuang position frame untuk socket itu saja.
  3. **Optimasi bisa merusak sistem lain.** `tracking-hot-store.ts:100-107` adalah komentar paling penting di file itu: kalau posisi hanya ditulis ke Redis, maka `tracking.updatedAt` berhenti bergerak saat Redis down — dan watchdog (#11) membaca kolom itu untuk memutuskan drone mana yang "senyap". Efeknya: *"a sustained outage would freeze every LIVE delivery's updatedAt at once and mass-false-reap healthy in-flight drones."* Karena itu ada fallback tulis langsung ke Postgres.
- **Alternatif:**
  - **socket.io + `@socket.io/redis-adapter`** — room, reconnect, dan fallback polling gratis. Tradeoff: protokol non-standar (butuh klien socket.io), overhead lebih besar; repo memilih `ws` mentah + adapter Nest (`WsAdapter`) dan menulis fan-out-nya sendiri.
  - **Server-Sent Events (SSE)** — jauh lebih sederhana, jalan di atas HTTP/2, auto-reconnect bawaan browser. Tradeoff: satu arah; di sini klien perlu mengirim `subscribe`/`unsubscribe` (`tracking.gateway.ts:125,154`).
  - **Polling murni (`GET /deliveries/:id` tiap 3 detik)** — paling tahan banting; repo tetap menyediakannya sebagai fallback dan bahkan meng-overlay posisi hot supaya poll tetap segar (`deliveries.service.ts:774`). Tradeoff: N klien × frekuensi = beban DB linier.
  - **Managed pub/sub (Ably, Pusher, AWS AppSync)** — tanpa mengurus reconnect/backpressure. Tradeoff: biaya per pesan dan vendor lock-in.
  - **Redis Streams / sharded pub/sub** — repo sudah menyiapkan jalurnya lewat `resolvePubSubMode` (`common/pubsub/pubsub-transport`), karena classic pub/sub tidak menskala di Redis Cluster.
- **Latihan:** Jalankan app, sambungkan dua klien WS ke `ws://localhost:3000/?token=<jwt>` (pakai `wscat`), keduanya `subscribe` ke delivery yang sama, dan amati keduanya menerima frame. Lalu set `POSITION_PUSH_HZ=1`, ulangi, dan hitung selisih frekuensi frame posisi vs frame status. Terakhir, matikan Redis di tengah sesi dan hidupkan lagi — buktikan `rearmAll()` memulihkan langganan (cari log `re-arming N subscription(s)`).

---

## 11. Watchdog: sistem yang menyembuhkan dirinya sendiri

- **Prasyarat:** #5, #8, #10
- **Anchor:**
  - `src/delivery-watchdog/delivery-watchdog.ts:20-31` — JSDoc kelas: apa yang dijaga dan kenapa `SIMULATED` dikecualikan.
  - `src/delivery-watchdog/delivery-watchdog.ts:46-77` — query kandidat, dengan komentar panjang tentang **sinyal mana** yang dipakai untuk "senyap".
  - `src/delivery-watchdog/watchdog.constants.ts:35-47` — `WATCHDOG_STUCK_STATUSES` dan kenapa ia **bukan** subset otomatis dari `FAILABLE_STATUSES`.
  - `src/deliveries/deliveries.service.ts:1050-1062` — parameter `allowedStatuses` di `failExceptional` dan post-mortem-nya.
  - `src/delivery-watchdog/delivery-watchdog.ts:132-136` — heartbeat gauge diletakkan **setelah** loop, bukan di `finally`.
  - `src/delivery-watchdog/watchdog.scheduler.ts:19-24` — `upsertJobScheduler` supaya N replika = 1 penjadwal.
- **Kenapa dipakai di sini:** Watchdog mengajarkan kelas bug yang tidak ada padanannya di frontend: **false positive pada mekanisme keselamatan**. Tiga di antaranya tertulis lengkap:

  1. **Sinyal yang salah.** Awalnya "senyap" diukur dari `delivery.updatedAt` — padahal kolom itu hanya bergerak saat **fase** berubah. `:49-57`: *"A healthy long-haul flight sits in one phase for many minutes while streaming positions, so gating on `delivery.updatedAt` would make every such flight a permanent candidate and could crowd a genuinely-silent delivery out of the bounded batch."* Sinyal yang benar adalah `tracking.updatedAt` (naik tiap frame posisi) — dan komentarnya menekankan: **gate dan ORDER BY harus memakai sinyal yang sama** dengan keputusan per-baris.
  2. **CAS lebih lebar daripada query.** `deliveries.service.ts:1055-1062`: `FAILABLE_STATUSES` memuat `AWAITING_HANDOFF`, tapi query watchdog sengaja mengecualikannya (*"a drone hovering at the door is not 'stuck', it is waiting for a person"*). Karena CAS-nya lebih lebar, delivery yang naik ke handoff **di tengah scan** tetap di-fail dan di-refund. Perbaikannya: watchdog mengoper himpunannya sendiri ke CAS.
  3. **Heartbeat yang berbohong.** `:132-136`: kalau gauge di-set di `finally`, scan yang selalu gagal tetap terlihat sehat. Diletakkan setelah loop supaya alert `time() - gauge > N` benar-benar menyala.

  Perhatikan juga bahwa watchdog **tidak menulis status sendiri** — ia memanggil `failExceptional` yang sama dengan telemetri dan admin, jadi refund + notifikasi otomatis exactly-once tanpa kode tambahan (konsep #5 berbuah di sini).
- **Alternatif:**
  - **Tanpa watchdog, andalkan operator** — nol kompleksitas. Tradeoff: delivery yang nyangkut kelihatan seperti delivery yang sedang berjalan bagi customer, selamanya.
  - **TTL / job "deadline" per delivery** (enqueue job "fail kalau belum selesai jam X" saat create) — tidak perlu scan berkala. Tradeoff: deadline harus di-cancel/re-schedule tiap transisi; scan berkala lebih sederhana dan otomatis mencakup baris yang terlewat.
  - **Postgres `LISTEN/NOTIFY` atau CDC (Debezium)** — reaktif, bukan polling. Tradeoff: "tidak terjadi apa-apa selama 10 menit" justru **bukan** event — ketiadaan sinyal memang paling alami dideteksi dengan scan.
  - **`@nestjs/schedule` `@Cron`** menggantikan repeatable job BullMQ. Tradeoff: setiap replika akan menjalankan tick-nya sendiri; `upsertJobScheduler` (Redis-coordinated) memastikan satu tick untuk seluruh fleet.
- **Latihan:** Set `WATCHDOG_SCAN_INTERVAL_MS=5000` dan `WATCHDOG_SILENCE_MS=15000`. Buat delivery LIVE, kirim beberapa frame telemetri, lalu **berhenti**. Amati log `watchdog: reaped stuck ...` dan cek saldo wallet user bertambah (refund). Setelah itu ulangi, tetapi majukan delivery ke `AWAITING_HANDOFF` sebelum berhenti — buktikan ia **tidak** di-reap, dan tunjukkan baris kode mana yang mencegahnya.

---

## 12. Command outbox backend → drone (issue / poll / ack)

- **Prasyarat:** #5, #8, #11
- **Anchor:**
  - `src/deliveries/commands/drone-command.service.ts:42-48` — JSDoc kelas: *"The command row is a durable audit/outbox, NOT a second source of truth — the Delivery row stays authoritative."*
  - `src/deliveries/commands/drone-command.service.ts:73` `issue()` · `:214` `fetchPending()` · `:275` `ack()`.
  - `src/deliveries/commands/drone-command.service.ts:331-342` — klaim single-winner `FETCHED → ACKED/REJECTED`.
  - `src/deliveries/commands/drone-command.service.ts:347-386` — ack yang diterima tapi transisinya no-op → dicatat `superseded`, bukan `acked`.
  - `src/deliveries/commands/command.constants.ts:40-51` — `COMMAND_TYPE_TO_LEGAL_STATUSES` memetakan tiap tipe ke himpunan status milik transisi yang sudah ada.
  - `src/delivery-watchdog/delivery-watchdog.ts:177-236` — `reconcileStrandedAcks()`.
  - `src/deliveries/telemetry/flight-recorder.service.ts:144-211` — pemanggil **otomatis** (`adminId: null`), plus damper vs dedupe otoritatif.
- **Kenapa dipakai di sini:** Ini contoh **outbox pattern** yang paling mudah dicerna, dan repo menegaskan batasnya: perintah tidak pernah mengubah delivery. Yang mengubah delivery adalah **ack**, lewat `beginReturnToBase` / `failExceptional` yang sama persis dengan telemetri dan admin (`ARCHITECTURE.md:132`). Efeknya: satu jalur transisi, satu tempat refund, satu tempat comms.

  Tiga detail yang layak ditiru:
  - **Dedupe otoritatif ada di indeks database**, bukan di kode. `flight-recorder.service.ts:155-161`: cooldown in-memory disebut *"Write-rate damper only. The AUTHORITATIVE dedupe is the partial unique index allowing one open command per delivery... it is an optimisation, so it does not need to be correct across replicas, and making it shared state would give it a failure mode it does not deserve."* Ini cara berpikir yang berbeda dari "semua harus konsisten".
  - **Metrik harus bisa membedakan hal yang berbeda.** `:389-396`: penolakan asli dari drone (`rejected`) dipisahkan dari ack yang transisinya keburu didahului (`superseded`) — *"collapsing them would blind an operator to actual fleet refusals."*
  - **Crash di antara dua langkah punya pemulih.** Ack sudah diklaim tapi transisi belum sempat jalan → `reconcileStrandedAcks` mengulang transisi idempoten itu setelah `COMMAND_RECONCILE_GRACE_MS`, supaya niat operator tidak hilang atau salah-atribusi jadi reap MECHANICAL biasa.
- **Alternatif:**
  - **Push langsung ke drone (MQTT/WebSocket) tanpa baris DB** — latensi terendah. Tradeoff: kalau drone offline, perintah hilang; repo tetap melakukan push MQTT (`:164-176`) tapi **fail-open**, dengan baris DB + poll HTTP sebagai fallback durabel.
  - **Perintah langsung mengubah `Delivery.status` saat issue** — lebih sedikit langkah. Tradeoff: status akan berbohong (delivery "RETURNING" padahal drone belum menerima perintahnya).
  - **Transactional outbox penuh + dispatcher terpisah** — repo punya versi ini juga untuk hal lain (`OutboxService`, dipakai di `deliveries.service.ts:459-468` untuk referral). Tradeoff: butuh worker pengirim; untuk perintah drone, poll-dari-perangkat justru lebih cocok karena perangkatnya di belakang NAT.
  - **gRPC bidirectional stream ke drone** — real-time dua arah. Tradeoff: butuh koneksi persisten yang mahal untuk perangkat bertenaga baterai.
- **Latihan:** Dengan `LIVE_DISPATCH=true`, terbangkan satu delivery sampai `IN_TRANSIT`. Sebagai admin, issue `RETURN_TO_BASE`. Lalu **poll dua kali** sebagai drone (`GET /ingest/commands?droneId=...`) dan buktikan baris yang sama dikembalikan (`FETCHED`, at-least-once). Ack sekali → delivery jadi `RETURNING`. Ack lagi → harapkan 409. Terakhir, hentikan proses tepat setelah ack pertama (sebelum `appliedTransition` di-patch) dan buktikan watchdog memperbaikinya.

---

## 13. Saga, kompensasi, dan reconciliation (uang yang tidak boleh nyangkut)

- **Prasyarat:** #5, #7, #9
- **Anchor:**
  - `src/deliveries/deliveries.service.ts:86-101` — komentar `DELIVERY_DEBIT_FIRST`: aturan "tidak ada satu `$transaction` yang co-commit state dari shard-key berbeda".
  - `src/deliveries/deliveries.service.ts:225-235` — `deliveryId` di-*mint* di aplikasi, sebelum baris ada, supaya idempotency key uang bisa diketahui lebih dulu.
  - `src/deliveries/deliveries.service.ts:353-403` — blok reservasi debit-first + `catch` yang mengompensasi.
  - `src/deliveries/deliveries.service.ts:171-189` — `compensateReservations()`; `:198-204` — `releaseClaimedAircraft()`.
  - `src/deliveries/deliveries.service.ts:1287-1333` — `cleanupAfterTermination()`: satu tempat refund untuk **semua** jalur terminal.
  - `src/deliveries/orphan-reaper/orphan-reaper.service.ts:13-18` dan `:36-73` — sweep rekonsiliasi dengan anti-join SQL mentah.
- **Kenapa dipakai di sini:** Konsep tersulit di area ini, dan repo menjelaskannya dengan sangat baik. Masalahnya: `create()` harus menulis ke *user-rooted state* (saldo wallet, kuota promo) **dan** *delivery-rooted state* (baris delivery). Selama keduanya di-commit dalam satu `$transaction`, database tidak bisa di-shard. Jadi flag `DELIVERY_DEBIT_FIRST` memindahkan potongan uang ke transaksi sendiri **sebelum** transaksi delivery — dan konsekuensinya adalah kompensasi manual.

  Baca `catch` di `:381-393` pelan-pelan; ia mengandung wawasan yang jarang ditulis orang: *"a `$transaction` can COMMIT and then have its awaited promise REJECT (a post-commit driver/connection error), landing HERE in-process with the money already moved."* Karena itu **seluruh** blok dibungkus, bukan hanya bagian debit — kalau tidak, slot promo bisa terkonsumsi tanpa delivery dan tanpa tagihan.

  Lalu ada dua tingkat jaring pengaman:
  - **Sinkron** — `compensateReservations()` + `releaseClaimedAircraft()` untuk kegagalan in-process (idempoten, jadi aman dipanggil tanpa syarat).
  - **Asinkron** — `OrphanReaperService.sweep()` untuk **crash proses**, satu-satunya kasus yang lolos dari kompensasi sinkron.

  Reaper-nya sendiri mengajarkan pelajaran query: anti-join didorong ke SQL (`:37-47`) karena *"Selecting EVERY CHECKOUT_SPEND debit and filtering per-candidate would saturate the bounded, unordered `take` with legitimate debits at scale, crowding genuine orphans out of the LIMIT so they're never reaped — defeating the safety net."* Dan `reapIfOrphan` **memeriksa ulang** saat kompensasi (`:106-113`), karena transaksi delivery bisa saja commit setelah query kandidat.
- **Alternatif:**
  - **Satu transaksi ACID untuk semuanya** (default hari ini, flag OFF) — paling sederhana dan paling benar. Tradeoff: mengunci semua state ke satu shard; komentar `:86-92` menyebut ini persis sebagai hal yang menghalangi `shardCount > 1`.
  - **Two-phase commit (XA)** — atomik lintas resource. Tradeoff: koordinator jadi SPOF, dan Postgres+Redis+Stripe tidak berbagi koordinator.
  - **Temporal / Step Functions** — saga sebagai kode workflow durabel; kompensasi jadi first-class alih-alih `try/catch` manual. Tradeoff: infrastruktur besar (lihat #7).
  - **Event sourcing + eventual consistency penuh** — tidak ada saga karena tidak ada transaksi lintas agregat. Tradeoff: menulis ulang seluruh domain, dan setiap pembacaan jadi proyeksi.
- **Latihan:** Set `DELIVERY_DEBIT_FIRST=true`. Di `deliveries.service.spec.ts`, mock `prisma.delivery.create` melempar error non-P2002 dan verifikasi bahwa `promoService.releaseForDelivery`, `walletService.refundForDelivery`, **dan** `dispatchService.release` ketiganya terpanggil. Lalu hapus baris `await this.releaseClaimedAircraft(...)` di `:490` dan jelaskan tertulis: apa yang bocor, dan kenapa rollback transaksi **tidak** menyelamatkannya (petunjuk: tabel `drones` bukan bagian dari transaksi itu).

---

## 14. Delivery terjadwal & berulang: cursor CAS, at-most-once, dan zona waktu

- **Prasyarat:** #1, #7, #9
- **Anchor:**
  - `src/deliveries/deliveries.service.ts:257-268` — keputusan `SCHEDULED` vs `PENDING` (`SCHEDULE_THRESHOLD_MS`, `MAX_SCHEDULE_DAYS`).
  - `src/deliveries/simulation/simulation.processor.ts:87-111` — JSDoc `handleKickoff`: **dua** batasan urutan (enqueue-sebelum-CAS, klaim-sebelum-CAS).
  - `src/deliveries/simulation/simulation.processor.ts:187-220` — `catch` di sekitar CAS kickoff: kapan boleh melepas pesawat dan kapan **tidak boleh**.
  - `src/recurring-deliveries/recurring.materializer.ts:83-104` — CAS atas cursor `nextRunAt` + strategi **at-most-once**.
  - `src/recurring-deliveries/recurring.materializer.ts:76-80` — occurrence yang terlewat di-*collapse* jadi satu lompatan.
  - `src/deliveries/delivery-schedule.ts:85-126` — `tzOffsetMs` + `zonedWallClockToUtc`.
  - `src/recurring-deliveries/recurrence.ts:50-61` — trik "noon-anchored UTC" untuk menghitung hari dalam seminggu.
- **Kenapa dipakai di sini:** Tiga pelajaran berbeda menumpuk di sini.

  **(a) Urutan operasi adalah desain, bukan selera.** `simulation.processor.ts:99-107` menyebutkan dua aturan dan alasannya: enqueue dulu karena kalau CAS duluan, retry akan no-op dan job siklus hidup tidak pernah masuk (*"stranding the delivery forever"*); klaim dulu karena klaim ada di baris terpisah yang tidak ikut rollback.

  **(b) Kegagalan ambigu harus dipilih arah amannya.** `:187-204` — promise yang reject **bukan** bukti statement tidak commit. Kalau melepas pesawat secara buta, kamu mengubah kebocoran (bisa dipulihkan operator) menjadi double-booking (tidak bisa). Maka: *"release only on PROOF the transition did not happen."*

  **(c) At-most-once vs at-least-once adalah pilihan bisnis.** `recurring.materializer.ts:100-103`: cursor sengaja dimajukan **sebelum** `create()`, karena *"create() is non-idempotent (new trackingId + Stripe intent), so a failure/crash here skips this one occurrence rather than risking a duplicate on a retry."* Kehilangan satu pengiriman terjadwal < menagih customer dua kali. Bandingkan dengan queue (#7) yang memilih at-least-once — kebalikannya, dan itu benar karena handler-nya idempoten.

  Zona waktu-nya juga bukan main-main: `recurrence.ts:75-79` menjelaskan bahwa `"2026-06-30"` mem-parse ke UTC midnight = 07:00 WIB, yang **bukan** awal hari WIB — jadi `startDate`/`endDate` harus di-anchor ke hari WIB.
- **Alternatif:**
  - **`node-cron` per schedule di memori** — sederhana. Tradeoff: N replika = N eksekusi; hilang saat restart.
  - **`RRULE` (RFC 5545) via `rrule.js`** — mendukung recurrence rumit (bulanan, "Senin ke-3", pengecualian). Tradeoff: repo hanya butuh DAILY/WEEKLY (`recurrence.ts:6`), dan implementasi sendiri membuat perilaku zona waktunya eksplisit dan bisa diuji.
  - **Menyimpan waktu sebagai `TIMESTAMPTZ` + `AT TIME ZONE` di SQL** — biarkan Postgres yang menangani. Tradeoff: logika kalender tersebar ke query; repo memusatkannya di `delivery-schedule.ts` supaya dipakai bersama oleh scheduled dan recurring.
  - **At-least-once + idempotency key pada `create()`** (mis. `recurringId + occurrenceISO` sebagai unique) — tidak ada occurrence yang hilang **dan** tidak ada duplikat. Ini peningkatan nyata yang mungkin; tradeoff-nya adalah kolom + indeks unik baru dan penanganan P2002 di materializer.
- **Latihan:** Buat recurring schedule `WEEKLY`, `daysOfWeek: [1]` (Senin), `timeOfDay: "23:30"`. Tulis tes di `recurrence.spec.ts` yang memanggil `computeNextOccurrence` dengan `TZ=UTC` dan `NOTIFICATIONS_TZ=Asia/Jakarta`, dan buktikan hasilnya adalah Senin **menurut kalender WIB** — bukan Selasa UTC. Lalu buat schedule yang `nextRunAt`-nya sudah lewat 3 hari, jalankan materializer, dan buktikan hanya **satu** lompatan cursor yang terjadi (bukan 3 delivery sekaligus).

---

## 15. Audit di dalam transaksi, dan aturan yang sengaja dilanggar

- **Prasyarat:** #5, #13
- **Anchor:**
  - `src/deliveries/deliveries.service.ts:953-962` — komentar di atas `$transaction` milik `adminForceCancel`: pengakuan eksplisit bahwa aturan shard-key dilanggar, beserta harganya.
  - `src/deliveries/deliveries.service.ts:1050-1089` — kontrak parameter `auditWithinTx` di `failExceptional` (termasuk peringatan READ COMMITTED di `:1080-1084`).
  - `src/deliveries/deliveries.service.ts:964-1002` — **dua** CAS terpisah, bukan satu, karena `updateMany` tidak bisa melaporkan baris mana yang cocok.
  - `src/deliveries/commands/drone-command.service.ts:76-93` — kontrak `auditWithinTx` yang sama untuk `issue()`.
  - `src/deliveries/deliveries.service.ts:94-100` — pointer yang menjelaskan kenapa pengecualian ini didokumentasikan di satu tempat saja.
- **Kenapa dipakai di sini:** Ini konsep "senior" dan pas ditaruh terakhir, karena ia tentang **bagaimana menulis keputusan, bukan hanya kode**. Repo punya aturan global (satu `$transaction` tidak boleh menggabungkan state dari shard-key berbeda), lalu melanggarnya satu kali dengan sadar untuk audit log admin. Alasannya (`:958-962`): *"an audit row that can commit apart from the action it records is the exact defect this exists to remove, and the cost is that `admin_audit_logs` would be pinned to the delivery shard if shardCount ever goes above 1. **Recorded here so it is found as a decision rather than rediscovered as an accident.**"*

  Detail teknis yang menyertainya juga instruktif:
  - **`updateMany` tidak memberi tahu baris apa yang ia ubah.** Karena disposisi pesawat bergantung pada status **asal**, satu CAS dipecah jadi dua (pre-launch dulu, lalu in-flight) sehingga jawabannya terbaca dari CAS mana yang menang (`:964-1002`).
  - **Kejujuran soal jaminan.** `:1080-1084` mengakui window sub-milidetik di mana audit bisa mencatat status yang basi, menjelaskan kenapa `FOR UPDATE` tidak dipakai, dan menutup dengan: *"but it is a read-then-CAS, not a guarantee."* Menuliskan batas ketepatan sendiri adalah tanda kode yang matang.
  - **Biaya hanya dibayar yang butuh.** Pembacaan `firedFrom` di-*gate* pada adanya callback, supaya watchdog yang mereap massal tidak membayar satu indexed read per baris (`:1113-1115`).
- **Alternatif:**
  - **Audit lewat trigger Postgres** — mustahil terlewat, bahkan oleh migrasi manual. Tradeoff: tidak tahu *siapa* aktornya (user id ada di aplikasi), dan logika audit jadi tak terlihat dari kode TypeScript.
  - **Audit lewat event/outbox setelah commit** — tidak mengunci shard. Tradeoff: persis cacat yang dihindari — aksi bisa commit tanpa audit-nya kalau proses mati di antara keduanya.
  - **Nest interceptor global yang mencatat semua request admin** — nol perubahan di service. Tradeoff: mencatat *permintaan*, bukan *transisi yang benar-benar terjadi*; force-cancel yang kalah CAS akan tetap tercatat seolah berhasil.
  - **`RETURNING` clause / `$queryRaw` untuk mendapatkan status lama** — menghapus kebutuhan read-then-CAS dan menutup window READ COMMITTED. Tradeoff: keluar dari type-safety Prisma untuk jalur itu; kandidat perbaikan yang bagus untuk latihan di bawah.
- **Latihan:** Ganti pola read-then-CAS di `failExceptional` dengan satu `$queryRaw` `UPDATE ... WHERE status IN (...) RETURNING id, status AS fired_from`, dan buktikan lewat tes bahwa `firedFrom` sekarang benar-benar berasal dari baris yang di-update. Lalu tulis di `AUDIT-LOG.md` gaya repo ini: apa yang berubah, cacat apa yang ditutup, dan biaya apa yang kamu terima (petunjuk: kamu kehilangan tipe hasil dari Prisma dan harus memetakan enum sendiri).

---

## Jalur baca yang disarankan (urutan file, bukan urutan konsep)

1. `src/deliveries/delivery-exceptions.ts` — 78 baris, seluruh kosakata domain ada di sini.
2. `src/deliveries/simulation/simulation.constants.ts` — jalur bahagia + `statusesBefore`.
3. `src/deliveries/deliveries.service.ts` — baca `create()` (`:206`) dan `cancel()` (`:858`) dulu; sisanya belakangan.
4. `src/dispatch/flight-feasibility.ts` — file terbaik untuk memahami "kenapa keputusan ini murni".
5. `src/serviceability/serviceability.service.ts` — fail-closed vs fail-open dalam satu method.
6. `src/deliveries/telemetry/telemetry.service.ts` — bagaimana produsen kedua masuk tanpa mengubah kontrak.

## Bagian yang paling mungkin membuatmu tersangkut

**Bahwa transisi status adalah balapan, bukan penugasan** — dan bahwa pertanyaan susulannya ("apa yang terjadi pada drone fisik ketika transisi ini menang atau kalah?") sama pentingnya dengan transisinya sendiri. Di React, `setState` selalu berhasil dan tidak ada yang bocor kalau kamu lupa membersihkan. Di sini, `updateMany({where:{status:{in:[...]}}}) → count` adalah primitif konkurensi, `count === 0` berarti "aktor lain menang", dan setiap jalur yang berakhir **wajib** menjawab: apakah pesawatnya kembali ke pool (`RETURN_TO_FLEET`), di-grounded (`GROUND_FOR_INSPECTION`), atau masih di udara (`STILL_AIRBORNE`). Tiga bug asli di `deliveries.service.ts` (`:1497`, `:1294`, `:1156`) semuanya lahir dari melewatkan pertanyaan kedua itu.

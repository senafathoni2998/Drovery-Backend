# Fase 7 — Domain penerbangan: gerbang berlapis, pesawat fisik, dan dua produsen satu kontrak

> **Durasi** ~2 minggu (~26 jam) · **Mode** bedah · **Repo** `Drovery_Backend` (satu titik singgung ke `Drovery_Admin` di konsep 7.13)

> Semua path di dokumen ini relatif terhadap folder `Drovery_Backend/`, kecuali disebut lain.
> Anchor merujuk ke tag git `curriculum-baseline`. Kalau kamu sudah mengubah repo, `git stash` dulu
> atau baca lewat `git show curriculum-baseline:src/....`

---

## Kenapa fase ini ada di sini

Sampai Fase 6 kamu sudah punya semua *primitif*-nya, tapi belum punya *ceritanya*. Fase 5 mengajarkan
bahwa `updateMany({ where: { id, status: { in: [...] } } }).count` adalah cara Postgres memilih satu
pemenang di antara banyak penulis. Fase 6 mengajarkan bahwa proses yang menjalankan transisi itu bisa
mati di tengah jalan dan job-nya tetap selamat karena ada di Redis. Dua-duanya adalah jawaban atas
pertanyaan "bagaimana". Fase ini adalah pertanyaan "apa" dan "kenapa": **transisi mana yang legal,
siapa yang berhak memutuskannya, dan apa yang terjadi pada benda fisik seberat 8 kg di udara ketika
transisi itu menang atau kalah.**

Alasan urutannya tepat di sini, bukan lebih awal: hampir setiap keputusan domain di Drovery
*mengandaikan* CAS. `failExceptional` bisa dipanggil oleh empat aktor berbeda (telemetri drone,
watchdog, admin, dan handoff OTP yang habis percobaan) dan tetap hanya me-refund sekali — bukan karena
ada distributed lock, tapi karena efek sampingnya diletakkan **setelah** CAS. Kalau kamu membaca
`failExceptional` sebelum Fase 5, kamu akan melihat `if (matched === 0) return null` sebagai
pengecekan defensif biasa, bukan sebagai gerbang exactly-once. Sebaliknya, kalau kamu membacanya
sekarang, seluruh file berubah bentuk: setiap `count` adalah pengumuman siapa pemenangnya.

Yang mustahil dipahami tanpa fase ini ada tiga. Pertama, **kenapa dua dependensi eksternal yang
sama-sama gagal menghasilkan dua jawaban berlawanan** — airspace fail-CLOSED, cuaca fail-OPEN — dan
kenapa "merapikannya jadi konsisten" adalah bug, bukan refactor. Kedua, **kenapa sebuah baris database
bisa bocor**: `Drone.activeDeliveryId` adalah kolom UNIQUE, dan satu jalur terminal yang lupa
melepaskannya membuat satu pesawat hilang dari armada selamanya. Ada tiga bug asli soal ini di repo,
semuanya tercatat di komentar. Ketiga, **kenapa drone mengirim `PHASE` dan bukan `DeliveryStatus`** —
sebuah keputusan kosakata yang membuat `DELIVERED` mustahil dicapai penyerang yang memegang kunci
ingest, bukan lewat `if`, tapi lewat bentuk sebuah `Record<>`.

Fase ini juga tempat kamu berhenti menjadi pembaca kode dan mulai menjadi pembaca *keputusan*.
Hampir semua yang kamu baca minggu ini punya komentar yang menuliskan post-mortem-nya sendiri:
"ini dulunya begini, akibatnya begitu, jangan dikembalikan". Kemampuan membedakan komentar yang
menjelaskan *apa* (buang saja, kodenya sudah jelas) dari komentar yang menjelaskan *kenapa keputusan
ini dan bukan yang jelas-jelas lebih sederhana* adalah keterampilan yang dibayar. Ambil di sini.

---

## Gerbang masuk

Kamu siap masuk fase ini kalau kamu bisa:

- [ ] Menulis satu CAS Prisma dari ingatan — `updateMany` dengan seluruh prasyarat di `where`, lalu
      cabang `count === 0` — dan menjelaskan kenapa `release()`/refund harus di **bawah** cabang itu,
      bukan di atas.
- [ ] Menjelaskan apa yang **tidak** ikut rollback ketika `prisma.$transaction` gagal (petunjuk:
      baris di tabel `drones`, job di Redis, HTTP call ke Stripe).
- [ ] Menjalankan `LIVE_DISPATCH` dan `SIM_WORKER_CONCURRENCY` dari `.env`, membedakan tier `api`
      dan `worker` lewat `PROCESS_ROLE`, dan tahu proses mana yang menjalankan watchdog.
- [ ] Membaca satu `@Processor` BullMQ dan menunjukkan di mana `jobId` deterministik membuat enqueue
      jadi idempoten — serta satu tempat di repo yang justru **wajib** memakai jobId berbeda tiap attempt.
- [ ] Membuka `prisma/schema.prisma`, menemukan `model Drone`, dan menjelaskan apa akibat operasional
      dari `activeDeliveryId` bertipe unique nullable.
- [ ] Menjalankan `npx jest src/deliveries` sampai hijau di mesinmu, tanpa Docker menyala kalau perlu
      (semua spec di fase ini murni unit test).

Kalau ada satu butir yang belum bisa, itu bukan alasan menunda seluruh fase — tapi butir pertama
adalah wajib. Tanpa itu, seluruh Fase 7 akan terbaca sebagai daftar aturan hafalan.

---

## Peta jalan mingguan

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| 1 (paruh awal) | Kosakata & gerbang: state machine sebagai himpunan (7.1), validasi boundary vs invariant (7.2), trust boundary geocode (7.3) | 7 | `docs/state-machine.md` berisi diagram Mermaid yang panahnya diturunkan dari kode; satu spec baru yang menangkap `reorder()` yang lolos ValidationPipe |
| 1 (paruh akhir) | Kebijakan kegagalan: fail-closed vs fail-open (7.4), pemetaan 422/503 (7.5), inti domain murni (7.6) | 6 | Dua spec berpasangan di `serviceability.service.spec.ts` yang membuktikan airspace-gagal ≠ cuaca-gagal; satu property test di `flight-feasibility.spec.ts` |
| 2 (paruh awal) | Pesawat sebagai resource: klaim & pelepasan (7.7), ranking global (7.8), dua produsen satu kontrak (7.9), auth mesin (7.10) | 7 | Penerbangan LIVE pertama dari `curl`; log `Dispatched drone ...` menunjukkan drone terkecil yang mencukupi |
| 2 (paruh akhir) | Kanal balik & waktu: command outbox (7.11), terjadwal & berulang (7.12), airspace sebagai data (7.13), sidang alternatif (7.14) + capstone | 6 | Siklus issue→poll→ack→409 lewat `curl`; watchdog me-reap + refund; satu aturan domain buatan sendiri sebagai fungsi murni + spec-nya |

Total ~26 jam. Kalau minggu pertama molor, potong 7.11 dan 7.12 jadi bacaan saja — keduanya bukan
prasyarat fase mana pun sesudahnya. Jangan potong 7.4 atau 7.7; itu poros fase ini.

---

## Konsep

### 7.1 State machine utuh: satu enum, banyak himpunan

Di React kamu terbiasa dengan satu sumber kebenaran per komponen: `const [status, setStatus] =
useState('idle')`, dan yang menjaga transisinya adalah disiplin — plus mungkin satu `switch` di
reducer. Analogi terdekat yang jujur di dunia yang kamu kenal adalah `useReducer` dengan action type:
reducer adalah satu-satunya tempat transisi diputuskan. Di sini analoginya berhenti tepat di situ,
karena reducer-nya bukan JavaScript, melainkan klausa `WHERE` di Postgres, dan "action"-nya datang
dari lima proses yang tidak saling kenal.

Yang benar-benar baru dan patut kamu bawa pulang bukan "ada enum status". Itu biasa. Yang baru adalah:
**satu enum melahirkan banyak himpunan, dan tiap himpunan menjawab satu pertanyaan operasional yang
berbeda.** Buka `src/deliveries/delivery-exceptions.ts` — 78 baris, dan seluruh kosakata domain ada di
sana. `FAILABLE_STATUSES` menjawab "apakah ada drone di udara?" `RETURNABLE_STATUSES` menjawab
"apakah drone sudah memegang paketnya?" `POSITION_FROZEN_STATUSES` menjawab "apakah marker di peta
boleh bergerak lagi?" Satu status bisa masuk himpunan A tapi tidak B, dan itulah intinya.

Contoh paling tajam: `DRONE_ASSIGNED` ada di `FAILABLE_STATUSES` tapi **tidak** di
`RETURNABLE_STATUSES`. Alasannya ditulis di tempat: drone belum mengambil paket, jadi "pulang membawa
barang" bukan transisi yang punya arti. Contoh kedua: `RETURNING` sengaja **absen** dari
`POSITION_FROZEN_STATUSES`, karena user harus melihat drone-nya terbang pulang di peta. Kalau kamu
menyusun himpunan-himpunan ini berdasarkan kemiripan nama ("semua status terminal, semua status
transient"), kamu akan salah di dua tempat itu.

Lapisan kedua yang lebih halus: status pengecualian (`RETURNING`, `DELIVERY_FAILED`,
`RETURNED_TO_BASE`) sengaja diletakkan **di luar** `STATUS_ORDER`. Karena `statusesBefore(target)`
hanyalah `STATUS_ORDER.slice(0, i)`, secara matematis tidak mungkin CAS monoton menghasilkan salah
satu dari ketiganya. Aturan "terminal tidak boleh dihidupkan kembali" tidak dijaga oleh `if` yang
tersebar di sepuluh file — ia dijaga oleh **bentuk data**. Ini pola yang akan kamu lihat berulang kali
minggu ini: keamanan lewat struktur, bukan lewat pengecekan.

**Anchor:**
- `prisma/schema.prisma:241` — `enum DeliveryStatus`, 13 nilai. Baca komentar di `:251-254`: mana yang
  *branch*, mana yang *transient*, mana yang *terminal*.
- `src/deliveries/delivery-exceptions.ts:3-9` — header file yang menyatakan alasan penempatan di luar
  `STATUS_ORDER`.
- `src/deliveries/delivery-exceptions.ts:17`, `:28`, `:37`, `:47` — empat himpunan. Baca komentar di
  atas masing-masing, terutama `:35-36` (kenapa `DRONE_ASSIGNED` dikeluarkan) dan `:43-46` (kenapa
  `RETURNING` dikeluarkan).
- `src/deliveries/simulation/simulation.constants.ts:13` — `STATUS_ORDER`, jalur bahagia yang linear.
- `src/deliveries/simulation/simulation.constants.ts:24` — `statusesBefore()`, tiga baris yang
  menjadi mesin monotonisitas seluruh sistem.
- `src/deliveries/deliveries.service.ts:103` — `CANCELABLE_STATUSES`, himpunan kelima yang hidup di
  service karena hanya dipakai `cancel()`.
- `src/deliveries/delivery-exceptions.ts:60` — `isDroneFaultReason()`, satu `switch` yang memutuskan
  siapa yang di-refund.

**Kenapa dipakai di sini:** komentar `delivery-exceptions.ts:3-9` menyatakannya tanpa basa-basi —
status pengecualian ada di luar `STATUS_ORDER` *"so the monotonic forward CAS can never enter them and
a terminal can't be resurrected."* Perhatikan bahwa ini bukan klaim tentang niat baik pemrogram; ini
klaim tentang apa yang secara struktural bisa terjadi. Dan `adminForceCancel` (`deliveries.service.ts:978`)
bergantung pada `TERMINAL_STATUSES` sebagai **daftar tunggal** di klausa `notIn`-nya: kalau besok ada
terminal baru, ia otomatis ikut terlindungi dari resurrection tanpa ada yang perlu ingat.

**Alternatif:**
- **Boolean berlapis (`isDelivered`, `isCanceled`, `isFailed`)** — cara paling umum di app kecil, dan
  bekerja sampai tidak. Trade-off konkret: kombinasi mustahil jadi *representable* — `isDelivered &&
  isCanceled` adalah state yang bisa ditulis dan tidak ada yang mencegahnya — dan tidak ada satu
  tempat pun yang bisa ditanya "status apa saja yang terminal?". Konsekuensi langsung di repo ini:
  `adminForceCancel` harus menyebut satu per satu, dan terminal ke-5 yang lahir enam bulan lagi akan
  terlewat.
- **XState / `javascript-state-machine`** — transisi jadi deklaratif, bisa divisualisasi, dan
  guard-nya terbaca. Trade-off konkret: mesinnya hidup **di memori satu proses**, sedangkan di sini
  ada tiga proses (api, worker, ingest) yang bersaing atas satu baris. XState tetap butuh CAS di
  bawahnya untuk menyelesaikan balapan, jadi ia menambah satu lapisan tanpa menghapus masalah
  utamanya — dan menambah satu tempat baru yang bisa tidak sinkron dengan `STATUS_ORDER`.
- **Event sourcing ringan: tabel `delivery_status_transitions`** — riwayat lengkap gratis, audit
  gratis, dan "siapa yang mengubah ini" terjawab sendiri. Trade-off konkret: setiap pembacaan status
  jadi agregasi, dan `where: { status: { in: [...] } }` — primitif konkurensi seluruh repo — tidak
  punya padanan yang murah. Repo memilih hybrid: current state di baris + `FlightFrame` sebagai log
  append-only terpisah (`src/deliveries/telemetry/flight-recorder.service.ts`).

**Latihan:** Buat `docs/state-machine.md` berisi diagram Mermaid `stateDiagram-v2`. Turunkan panahnya
**dari kode**, bukan dari tebakan: panah hijau dari `STATUS_ORDER`, panah merah dari
`FAILABLE_STATUSES → DELIVERY_FAILED`, `RETURNABLE_STATUSES → RETURNING → RETURNED_TO_BASE`, dan
`CANCELABLE_STATUSES → CANCELED`. Verifikasi: jalankan
`grep -rn "status: DeliveryStatus\." src/deliveries src/delivery-watchdog | grep updateMany -A2`
(atau cari manual tiap `data: { status:`) dan pastikan setiap tulisan status di repo punya panah yang
sesuai di diagrammu. Lalu jawab tertulis: **status mana yang bisa dimasuki lebih dari satu aktor?**
(petunjuk: hitung pemanggil `failExceptional` — ada empat.)

---

### 7.2 Validasi di boundary vs invariant di service

Ini pelajaran yang **tidak akan pernah kamu temui** di Ionic React, dan aku ingin jujur soal itu: di
frontend, "input" selalu datang dari form yang kamu sendiri render. Kalau kamu memasang
`react-hook-form` validator, itu memang satu-satunya pintu. Tidak ada padanan yang jujur untuk konsep
ini di dunia klien — yang ada justru kebalikannya, dan kebalikannya itulah yang jadi bug.

Bug aslinya tertulis di `src/common/package-limits.ts:7-10`: konstanta `MAX_WEIGHT_KG` sudah ada sejak
awal repo dengan **nol call site**. Satu-satunya penegakannya adalah validator react-hook-form di
aplikasi mobile — *"so any direct API call could book a 500 kg 'Small' package."* Panggil endpoint-nya
langsung dari `curl`, dan sistem menerima paket 500 kg untuk ukuran "Small", menghitung harganya,
dan mencoba menugaskan drone.

Sampai sini kamu mungkin berpikir: ya sudah, tambahkan decorator di DTO. Tapi itu masih kurang, dan
alasannya adalah bagian yang paling berharga di konsep ini. Komentar yang sama melanjutkan: *"`create()`
is also reached by reorder, favorite-order and the recurring materializer, all of which hand-build a
`CreateDeliveryDto` in-process and therefore never pass through the ValidationPipe."* `ValidationPipe`
Nest adalah komponen **boundary HTTP**. Ia berjalan di antara body request dan controller. Objek yang
dibangun tangan di dalam proses tidak pernah lewat sana.

Buktinya bisa kamu lihat langsung: `recurring.materializer.ts:140` (`toCreateDto`) dan
`deliveries.service.ts:1391` (`reorder` memanggil `this.create(...)`) sama-sama menyusun
`CreateDeliveryDto` sebagai object literal biasa. TypeScript senang; `class-validator` tidak pernah
dipanggil.

Kasus keduanya lebih halus dan lebih menarik. `@Matches(PICKUP_DATE_RE)` di DTO hanya mengecek
**bentuk**. String `"2026-02-31"` lolos regex `^\d{4}-\d{2}-\d{2}$` dengan sempurna — lalu `Date.UTC`
diam-diam menggulungnya jadi 3 Maret. Komentar di `delivery-schedule.ts:31` menyebutnya persis:
*"delivery scheduled for a day the client never asked for"*. Regex tidak bisa mengekspresikan tahun
kabisat. Satu-satunya tes jujur adalah **membangun tanggalnya dan mengecek ia tidak bergeser** — itu
persis isi `isValidPickupDate` di `:40-49`.

Dan ada cerita ketiga yang lebih mahal lagi, di `delivery-schedule.ts:14-18`: karena
`computeScheduledFor()` mengembalikan `null` untuk apa pun yang tidak bisa ia parse, dan `create()`
memperlakukan `null` sebagai "kirim sekarang", format yang salah **tidak gagal dengan berisik — ia
menerbangkan drone sekarang dan tetap menjawab 201**. Aplikasi mobile sempat mengirim `"Jul 30, 2026"`
dan `"09:30 AM"` melawan regex ini, dan itulah kenapa setiap delivery terjadwal terbang seketika.

**Anchor:**
- `src/common/package-limits.ts:4-17` — JSDoc yang menuliskan post-mortem-nya; `:18`
  `assertWeightWithinCap()`.
- `src/deliveries/deliveries.service.ts:206` — `create()`; `:211` dan `:218` — dua assert pertama,
  sebelum I/O apa pun.
- `src/deliveries/dto/create-delivery.dto.ts:55` — `@Matches(PICKUP_DATE_RE)`, yang hanya bentuk.
- `src/deliveries/delivery-schedule.ts:26-39` — JSDoc yang menjelaskan tiga string yang lolos regex;
  `:40` `isValidPickupDate()`.
- `src/deliveries/delivery-schedule.ts:10-22` — kenapa regex diekspor dari file parser-nya, dan cerita
  "setiap scheduled delivery terbang seketika".
- `src/recurring-deliveries/recurring.materializer.ts:140` — `toCreateDto()`, DTO buatan tangan.
- `src/deliveries/deliveries.service.ts:1391` — `reorder()` memanggil `create()` dengan literal.

**Kenapa dipakai di sini:** karena `create()` di repo ini bukan handler HTTP, ia adalah **use case**.
Ada empat pemanggil: controller (lewat ValidationPipe), `reorder`, favorite-order, dan recurring
materializer. Menaruh invariant di DTO berarti menegakkannya untuk satu dari empat. Perhatikan juga
pembagian tanggung jawab yang eksplisit di `package-limits.ts:15-16`: *"An unknown size is not this
function's error to raise: `@IsIn(PACKAGE_SIZES)` on the DTO owns that."* Jadi bukan "semua validasi
pindah ke service" — melainkan **bentuk tetap di DTO, invariant domain di service.**

**Alternatif:**
- **Zod / Valibot sebagai schema tunggal** — satu schema dipakai di controller *dan* dipanggil ulang
  di dalam service, jadi jalur non-HTTP ikut tervalidasi tanpa menulis assert manual. Trade-off
  konkret: kamu kehilangan integrasi otomatis dengan `@nestjs/swagger` (dokumen OpenAPI di repo ini
  lahir dari metadata `class-validator`/`class-transformer` yang sama), sehingga kamu harus
  menghasilkan schema OpenAPI sendiri atau memasang `zod-to-openapi`. Untuk repo yang menjual Swagger
  sebagai kontrak lintas-repo, itu biaya nyata.
- **`CHECK` constraint di database** — paling tidak bisa dilanggar; bahkan migrasi manual pun kena.
  Trade-off konkret: pesan errornya jadi `P2010` mentah yang tidak bisa dilokalkan ke
  `error.delivery.package.weight_exceeds_cap` (bandingkan `package-limits.ts:26-29`), dan aturan
  per-ukuran `MAX_WEIGHT_KG[size]` butuh `CHECK` multi-cabang yang berubah setiap kali daftar ukuran
  bertambah — artinya satu migration per perubahan tabel harga.
- **Percaya validasi klien saja** — inilah keadaan awal repo ini, dan komentar di `package-limits.ts`
  adalah post-mortem-nya. Trade-off konkret: nol biaya sampai ada satu pemanggil yang bukan
  aplikasimu — dan setiap API publik pada akhirnya punya pemanggil itu.

**Latihan:** Tambahkan aturan baru: `packageTypes` yang mengandung `'healthcare'` wajib punya
`receiver` non-kosong minimal 3 karakter. Implementasikan **dua kali** — sekali sebagai decorator di
`CreateDeliveryDto`, sekali sebagai assert di awal `create()`. Lalu tulis satu spec di
`src/deliveries/deliveries.service.spec.ts` yang memanggil `reorder()` atas delivery lama dengan
`receiver: 'X'`. Verifikasi: hanya versi service yang menangkapnya; matikan sementara baris assert di
service dan pastikan spec-mu **merah**. Kalau tetap hijau, spec-mu memvalidasi lewat jalur HTTP dan
kamu belum membuktikan apa pun.

---

### 7.3 Trust boundary: data server-authoritative

Pertanyaan yang harus kamu bawa masuk ke setiap DTO mulai sekarang bukan "apakah nilai ini valid?"
melainkan **"siapa yang berhak memutuskan nilai ini?"** Dua pertanyaan itu terlihat mirip dan
jawabannya sering berbeda 180 derajat.

Contohnya di repo ini punya nilai uang yang bisa dihitung. Dulu `create()` memakai koordinat dari
klien kalau ada. Komponen terbesar dari harga adalah biaya jarak: `PER_KM_RATE × haversine(from, to)`.
Kirim `fromLat/fromLng === toLat/toLng`, jaraknya nol, biayanya nol. Dan koordinat yang sama itu
lalu diteruskan ke `assertServiceable`, jadi geofence dilewati **by construction**, bukan diperiksa.
Satu field, dua kerugian: harga jadi nol dan geofence jadi bohong.

Perbaikannya bukan "validasi lebih ketat" — itu jebakan yang akan kamu temui berkali-kali. Perbaikannya
adalah **memindahkan sumber kebenaran**: alamat di-geocode di server, dan hasil geocode itulah yang
dipakai untuk harga, serviceability, dan rute penerbangan. Koordinat klien turun pangkat menjadi
sinyal *input sanity*: kalau menyimpang lebih dari 1 km dari geocode alamat yang diketik user, salah
satu dari keduanya keliru, dan 400 lebih baik daripada diam-diam terbang ke centroid jalan.

Pola yang sama muncul di tempat kedua. `trackingSource` dan `droneId` **dulu ada di DTO publik**.
Artinya customer mana pun yang login bisa mendeklarasikan delivery-nya `LIVE` dan menamai pesawat
yang menerbangkannya — dan `droneId` itu kemudian menjadi MQTT topic tempat perintah operator
dipublikasikan. Komentarnya menyebut ini dengan kalimat yang layak kamu hafal: *"both were operator
concerns sitting in a customer's request body."*

Detail ketiga yang lebih teknis tapi sama pentingnya ada di `GeoService`. Ia membedakan `not_found`
(provider menjawab: alamat itu tidak ada) dari `failed` (provider tidak menjawab sama sekali). Hanya
yang pertama boleh masuk negative cache. Alasannya di `geo.service.ts:57-63`: caching kegagalan
selama `GEO_MISS_TTL_S` akan *"turn one transient blip into an hour of hard failures"* — karena
delivery **fail-closed** pada lokasi yang tidak terselesaikan, satu jam itu adalah satu jam penolakan
untuk setiap alamat yang kebetulan diminta saat blip.

**Anchor:**
- `src/deliveries/deliveries.service.ts:559-577` — JSDoc `resolveCoords`, khususnya blok berlabel
  `SECURITY` di `:563-569` yang menuliskan eksploitnya persis.
- `src/deliveries/deliveries.service.ts:610` — `assertCoordAgreesWithAddress()`; ambang di `:119`
  (`MAX_COORD_DEVIATION_KM = 1`) dengan JSDoc `:113-118`.
- `src/deliveries/dto/create-delivery.dto.ts:77-79` — komentar "Advisory only".
- `src/deliveries/dto/create-delivery.dto.ts:104-112` — catatan tentang `trackingSource` dan `droneId`
  yang **dihapus** dari DTO, beserta apa yang bisa dilakukan penyerang dengan keduanya.
- `src/geo/geo.service.ts:42` — `geocode()`; `:22-26` — tipe `GeocodeOutcome` tiga cabang; `:57-63` —
  aturan negative caching.
- `src/recurring-deliveries/recurring.materializer.ts:156-160` — jadwal berulang sengaja **tidak**
  meneruskan koordinat tersimpan, dan alasannya bukan sekadar kerapian.

**Kenapa dipakai di sini:** karena ini jalur uang. Komentar `:571-572` menutup perdebatan
performa dengan satu kalimat: kedua alamat di-geocode di **setiap** create, `GeoService` punya cache,
dan *"correctness beats a saved round-trip on a money path."* Perhatikan juga bahwa fail-closed di
sini bukan kebetulan: geocode gagal → koordinat `undefined` → `assertServiceable` menolak dengan
`UNRESOLVED_LOCATION`. Tidak ada fallback ke koordinat klien, *"because that is exactly the trust
boundary being closed here."*

**Alternatif:**
- **Percaya koordinat klien, geocode hanya sebagai fallback** — hemat satu round-trip per create dan
  latensi turun. Trade-off konkret: persis lubang harga di atas kembali terbuka; siapa pun yang bisa
  memanggil API bisa membeli pengiriman lintas kota seharga tarif dasar.
- **Geocode asinkron di worker (terima dulu, backfill kemudian)** — latensi `create()` turun drastis
  dan Nominatim tidak lagi ada di jalur kritis. Trade-off konkret: harga dan serviceability tidak bisa
  diputuskan saat create, jadi kamu butuh status baru (`PRICING_PENDING`), UI yang menampilkan "harga
  menyusul", dan mekanisme pembatalan otomatis untuk alamat yang ternyata di luar area — plus jalur
  refund untuk yang terlanjur dibayar.
- **Provider berbayar (Google Geocoding / Mapbox) menggantikan Nominatim** — akurasi rooftop, tanpa
  batas 1 request/detik, SLA. Trade-off konkret: biaya per panggilan yang tumbuh linier terhadap
  jumlah quote, sementara repo ini memakai Nominatim + cache Redis 30 hari (`geo.service.ts:11`) yang
  memang cocok untuk beban portofolio.

**Latihan:** Jalankan `npx jest src/deliveries/deliveries.service.spec.ts -t coord` untuk melihat tes
yang sudah ada. Lalu tulis tes baru: klien mengirim `fromAddress: "Bandung"` **dan** `fromLat/fromLng`
yang berjarak 5 km dari hasil geocode mock. Harapkan `AppBadRequestException` dengan key
`error.delivery.coords.address_mismatch`. Verifikasi lanjutan: naikkan `MAX_COORD_DEVIATION_KM` dari 1
ke 50, jalankan lagi, dan tulis satu paragraf tentang serangan apa yang kembali terbuka pada radius
50 km (petunjuk: berapa jauh Jakarta dari Bandung, dan berapa `SERVICE_AREAS` radiusnya).

---

### 7.4 Gerbang berlapis + kebijakan kegagalan PER-DEPENDENCY

Ini konsep paling "engineering judgment" di seluruh fase, dan kalau kamu hanya boleh membawa pulang
satu hal dari minggu ini, ambil yang ini.

`checkServiceability()` menjalankan empat gerbang berurutan, dan urutannya adalah desain, bukan
selera: HARD service area → HARD panjang rute → HARD no-fly zone → SOFT cuaca. Tiga yang pertama
short-circuit, karena kalau rutenya di luar area, tidak ada gunanya memanggil API cuaca.

Yang membuat file ini layak dibaca dua kali adalah bahwa **dua dependensi eksternal diberi kebijakan
kegagalan yang berlawanan, dan alasannya ditulis di tempat kejadian**. Cuaca fail-OPEN: kalau API
cuaca tidak menjawab, delivery tetap lanjut. Airspace fail-CLOSED: kalau tabel zona tidak bisa dibaca,
delivery ditolak. Komentarnya (`serviceability.service.ts:77-81`):

> *"Weather is advisory and fails open: an unreachable forecast must not ground the fleet. Airspace is
> not advisory. If we cannot read the zone list we do not know whether this route crosses restricted
> airspace, and the only safe answer to 'I don't know' is no. **Do not 'fix' this into consistency
> with weather.**"*

Kalimat terakhir itu ditulis untuk orang berikutnya — mungkin kamu — yang membuka file ini, melihat
dua `try/catch` yang berbeda perilakunya, dan merasa gatal ingin menyeragamkan. Ini adalah contoh
sempurna dari komentar yang tidak menjelaskan *apa* (kodenya jelas) tapi menjelaskan *kenapa jangan
diubah*.

Pelajaran kedua ada di gerbang panjang rute. Cek "in service area" **tidak membatasi jarak**. Dengan
`SERVICE_AREA_GLOBAL=true`, semua titik di bumi ada "di dalam area", jadi rute Jakarta→London — sekitar
11.000 km — lolos semua gerbang, dihargai, dan diterima. Bahkan dengan geofence menyala, dua hub-nya
berjarak ~120 km, jadi pickup Jakarta + dropoff Bandung in-area di kedua ujung dan tetap tidak bisa
diterbangkan. Karena itu ada `ROUTE_TOO_LONG` sebagai **batas fisika di waktu quote**, terpisah dari
feasibility per-airframe di `src/dispatch/` yang jauh lebih ketat. Dua batas, dua tingkat pengetahuan:
yang satu bilang "tidak ada drone yang akan pernah kami operasikan bisa melakukan ini", yang satu lagi
bilang "pesawat *ini*, dengan baterai *sekarang*, tidak bisa".

Pelajaran ketiga adalah kejujuran yang jarang ditulis orang. Di dalam blok fail-closed itu ada
komentar berlabel `OPEN QUESTION` (`:102-109`) yang mengakui bahwa klasifikasinya **masih salah hari
ini**: blip DB sesaat diperlakukan sebagai HARD dan non-retryable, jadi di pre-flight ia meng-ABORT
dan me-refund delivery yang sudah dibayar — perlakuan yang sama dengan rute yang memang melintasi
airspace terlarang selamanya. Kalimat penutupnya: *"Blocking is still the right answer; only the
retryability is wrong."* Ini bukan TODO malas. Ini pemisahan yang tepat antara "keputusan ini benar"
dan "konsekuensi turunannya belum benar".

Satu lagi yang halus, dan menjadi jembatan ke konsep 7.13: `airspace.service.ts` men-cache **rows**
hasil query, bukan **jawaban** hasil filter. Kalau yang di-cache adalah jawabannya, zona TFR yang
dijadwalkan aktif pukul 14:00 baru berlaku setelah TTL habis — *"That was the only fail-open window in
a service written to fail closed."*

**Anchor:**
- `src/serviceability/serviceability.service.ts:21-33` — JSDoc kelas: dua HARD, satu SOFT.
- `src/serviceability/serviceability.service.ts:43` — `checkServiceability()`, seluruh urutan gerbang
  ada dalam satu method yang bisa dibaca sekali duduk.
- `src/serviceability/serviceability.service.ts:75-116` — blok fail-closed airspace. Baca utuh,
  termasuk `OPEN QUESTION` di `:102-109`.
- `src/serviceability/serviceability.service.ts:118-127` — komentar "DO NOT delete the two endpoint
  checks as redundant", lengkap dengan hitungan ~1 rute dari 2000 pada lintang 70-84°. Contoh langka
  komentar yang mengakui bahwa **ketiadaan tes yang gagal bukan bukti kode itu mati**.
- `src/serviceability/serviceability.service.ts:159-164` — `catch` cuaca yang fail-open.
- `src/serviceability/weather.service.ts:112` — objek `failOpen` (`flyable: true`) yang dikembalikan
  di tiga jalur kegagalan berbeda.
- `src/serviceability/serviceability.constants.ts:26-41` — JSDoc `DEFAULT_MAX_ROUTE_KM` dan kenapa ia
  terpisah dari feasibility per-pesawat.
- `src/deliveries/simulation/preflight.ts:42` — `classifyPreflight()`: gerbang yang sama dijalankan
  ulang tepat sebelum rotor berputar, dan hanya `weatherHold` yang menghasilkan `HOLD`.

**Kenapa dipakai di sini:** karena "gagal" bukan satu kategori. Sebuah dependensi yang tidak menjawab
memberi tahumu **tidak ada informasi**, dan apa yang harus kamu lakukan dengan ketidaktahuan itu
sepenuhnya bergantung pada apa yang gagal kamu ketahui. Tidak tahu cuacanya: paling buruk kamu
menerbangkan drone ke angin kencang yang seharusnya menunda. Tidak tahu zona terlarangnya: paling
buruk kamu menerbangkan drone ke ruang udara bandara. Proporsionalitasnya tidak sama, jadi
kebijakannya tidak boleh sama.

**Alternatif:**
- **Semua dependensi fail-open** — uptime maksimal, dan tidak ada satu pun booking yang ditolak
  karena masalah infrastruktur. Trade-off konkret: satu kedipan Postgres = seluruh armada terbang
  tanpa pemeriksaan airspace selama kedipan itu. Karena airspace dibaca dari tabel, kedipan itu
  bukan hipotetis.
- **Semua dependensi fail-closed** — paling aman, paling mudah dijelaskan ke auditor. Trade-off
  konkret: OpenWeather down (di luar kendalimu, dan terjadi) = 100% booking ditolak sampai ia
  kembali. Untuk sinyal yang sifatnya saran, itu memindahkan kegagalan pihak ketiga menjadi outage
  produkmu sendiri.
- **Circuit breaker + `stale-while-revalidate` untuk airspace** — kompromi: pakai daftar zona lama
  saat DB down, dengan batas umur eksplisit. Trade-off konkret: kamu harus menjawab "seberapa basi
  masih aman" dengan satu angka, dan angka itu adalah janji keselamatan. Repo sudah setengah jalan ke
  sana — cache-nya menyimpan rows dengan TTL — tapi sengaja **tidak** menyajikan cache basi saat query
  gagal (`airspace.service.ts:65-67`).
- **PostGIS + `ST_DWithin`** menggantikan geometri manual (`routeNearCircle`, `:218`). Trade-off
  konkret: benar secara geodesik (menghapus seluruh kelas error proyeksi yang dibahas di `:118-127`)
  dan bisa diindeks lewat GiST, tapi mengunci deployment ke ekstensi Postgres tertentu — dan logika
  yang hari ini adalah fungsi murni yang bisa diuji tanpa database berpindah ke SQL, di mana ia hanya
  bisa diuji dengan database menyala.

**Latihan:** Di `src/serviceability/serviceability.service.spec.ts`, tambahkan **dua tes berpasangan**.
(a) `airspace.inForceZones()` di-mock melempar error → harapkan `serviceable: false`,
`codes: ['NO_FLY_ZONE']`, dan `messageKey === 'error.serviceability.AIRSPACE_UNVERIFIED'`.
(b) `weather.getConditions()` di-mock melempar error → harapkan `serviceable: true`.
Verifikasi: kedua tes hijau. Lalu balik kebijakannya di kode (jadikan airspace fail-open), jalankan
lagi, dan pastikan tes (a) merah. Tutup dengan satu paragraf tertulis: kenapa dua mock yang
"sama-sama gagal" harus menghasilkan dua jawaban berlawanan? Paragraf ini adalah bagian dari capstone,
jadi simpan.

---

### 7.5 Pemetaan hasil ke 422 (hard) vs 503 + retryAfter (soft)

Kamu sudah menulis banyak `catch (e)` di sisi klien. Pertanyaan yang selalu muncul di sana: **boleh
diulang atau tidak?** Kalau boleh, tampilkan tombol "Coba lagi". Kalau tidak, tampilkan pesan dan
jangan beri harapan palsu. Konsep ini adalah sisi server dari pertanyaan itu — dan alasan kenapa
memilih status code bukan soal selera.

`assertServiceable` menerjemahkan hasil `ServiceabilityResult` menjadi HTTP:

- **422 Unprocessable Entity** untuk blocker keras — di luar area, no-fly zone, rute terlalu panjang,
  lokasi tak terselesaikan. Semuanya akan tetap benar satu jam lagi. Mengulang adalah pemborosan.
- **503 Service Unavailable + `retryAfter: 1800`** untuk weather hold. Angin kencang 30 menit lagi
  mungkin sudah reda. Klien bisa menjadwalkan ulang, atau menampilkan "coba lagi setengah jam lagi".

Yang penting: perbedaan itu **bisa ditindaklanjuti klien**. Bukan estetika. Aplikasi mobile bisa
menampilkan tombol yang berbeda, dan recurring materializer bisa memutuskan apakah occurrence ini
layak diulang.

Pola pemisahan yang sama muncul lagi di dispatch, dan itu bukan kebetulan — komentarnya secara
eksplisit menyebut ia meniru pemisahan pre-flight. `DISPATCH_NO_CAPACITY_KEY` berarti "tidak ada
pesawat di armada yang bisa mengangkat ini, menunggu tidak akan mengubahnya". `DISPATCH_UNAVAILABLE_KEY`
berarti "sekarang tidak ada yang bebas". Dan `isPermanentDispatchRefusal()` (`dispatch.service.ts:57`)
sengaja diletakkan **tepat di sebelah** tempat error itu dilempar, *"so the two cannot drift apart"* —
karena kalau predikatnya hidup di file lain, cepat atau lambat seseorang menambah kode error baru dan
lupa memperbarui predikatnya.

Ada satu detail presentasi yang bagus untuk dipelajari. Blocker biasanya menurunkan message key dari
kodenya: `error.serviceability.NO_FLY_ZONE`. Tapi jalur fail-closed airspace **menimpa** key itu
dengan `error.serviceability.AIRSPACE_UNVERIFIED`, sementara `code` yang dikirim ke mesin tetap
`NO_FLY_ZONE`. Alasannya ada di `serviceability.service.ts:89-100`: key `NO_FLY_ZONE` menginterpolasi
`{zoneName}`, dan di sini tidak ada zona — yang ada adalah daftar zona yang tidak terbaca. Versi
sebelumnya mengirim frasa Inggris literal sebagai `zoneName`, yang berarti kalimat berbahasa Indonesia
mengandung potongan Inggris yang tidak diterjemahkan. **Dua situasi bisa berbagi kode mesin tanpa
berbagi kalimat manusia.**

**Anchor:**
- `src/deliveries/deliveries.service.ts:631-636` — JSDoc `assertServiceable`; `:637` methodnya.
- `src/deliveries/deliveries.service.ts:659-661` — pemetaan `weatherHold ? 503 : 422`.
- `src/deliveries/deliveries.service.ts:666-673` — komentar tentang `messageKey` yang boleh ditimpa
  blocker, dan kenapa `code` tetap lewat tanpa berubah.
- `src/deliveries/deliveries.service.ts:684` — `retryAfter: 1800`, hanya untuk weather hold.
- `src/serviceability/serviceability.service.ts:169-186` — `blocked()`, satu pabrik hasil dengan
  parameter `messageKey` opsional yang JSDoc-nya menyebut ia *"Omitted by every blocker but the
  fail-closed airspace one."*
- `src/dispatch/dispatch.service.ts:44` dan `:46` — dua key penolakan dispatch.
- `src/dispatch/dispatch.service.ts:57` — `isPermanentDispatchRefusal()`, pemisahan yang sama
  ditanyakan ke armada alih-alih ke cuaca.
- `src/dispatch/dispatch.service.ts:255-267` — JSDoc `saturationError`, termasuk alasan kenapa semua
  penyebab transien **sengaja** dikumpulkan jadi satu pesan (informasi armada bocor ke customer).

**Kenapa dipakai di sini:** karena `create()` adalah endpoint yang dipanggil oleh tiga klien berbeda
(mobile, admin, recurring materializer di dalam proses), dan ketiganya harus mengambil keputusan
berbeda atas kegagalan yang berbeda. Lihat `recurring.materializer.ts:121-127`: kegagalan per-occurrence
(weather 503, out-of-area 422) *"are not schedule faults — log and move on"*. Tanpa pemisahan itu,
satu badai akan mematikan jadwal berulang, atau satu alamat yang salah akan terus dicoba selamanya.

**Alternatif:**
- **Selalu 400 Bad Request untuk semua penolakan** — paling sederhana, satu kode untuk semua.
  Trade-off konkret: klien tidak bisa membedakan "input kamu salah" dari "sistem kami sedang tidak
  bisa" — sehingga retry otomatis di `apiClient` mobile akan mengulang permintaan yang tidak akan
  pernah berhasil, atau tidak mengulang permintaan yang seharusnya diulang.
- **200 OK dengan `{ success: false, reason }` di body** — populer di API internal, dan menghindari
  perdebatan status code. Trade-off konkret: seluruh infrastruktur yang membaca status code berhenti
  bekerja — retry policy di klien, metrik `http_requests_total{status}` yang jadi dasar alert di Fase
  9, dan interceptor error global yang sudah kamu bangun di Fase 2. Kamu membayar dengan menulis ulang
  penanganan error di tiga tempat.
- **`Retry-After` sebagai HTTP header alih-alih field body** — lebih standar, dipahami proxy dan
  browser. Trade-off konkret: envelope `{ success, data }` yang jadi kontrak lintas-repo sejak Fase 2
  tidak membawa header ke klien mobile (`apiClient` hanya membuka body), jadi kamu harus menambah
  jalur baca header di tiga klien. Repo memilih menaruhnya di body agar satu envelope cukup.

**Latihan:** Panggil `POST /api/v1/deliveries` dengan `toAddress` yang jelas di luar area (misalnya
`"Surabaya"`) dan catat status + body-nya. Lalu paksa weather hold: di
`src/serviceability/weather.service.ts`, sementara buat `flyable` mengembalikan `false` dengan
`condition: 'storm'`, dan panggil lagi. Verifikasi: yang pertama 422 tanpa `retryAfter`, yang kedua
503 **dengan** `retryAfter: 1800`. Terakhir, tulis di catatanmu: kalau kamu adalah `useDelivery` hook
di aplikasi mobile, kode berbeda apa yang kamu jalankan untuk masing-masing?

---

### 7.6 Inti domain sebagai fungsi murni

Kamu sudah punya refleks ini, meski mungkin belum menamainya. Di React, fungsi seperti
`formatCurrency(n)` atau `computeTotal(items)` kamu taruh di `utils/` dan uji tanpa merender apa pun.
Yang berbeda di sini adalah **taruhannya**, dan repo menuliskannya dengan kalimat yang tidak akan
kamu lupakan (`src/deliveries/telemetry/energy.ts:3-6`):

> *"deciding whether an aircraft still has the energy to reach its base is the one calculation in this
> system whose failure mode is a drone on someone's roof, and it should be testable without a
> database, a delivery or a telemetry frame."*

`src/dispatch/flight-feasibility.ts` adalah file terbaik di repo untuk memahami ini. Header-nya:
*"Pure geometry + energy arithmetic. No I/O, no Prisma, no Nest."* Tidak ada `@Injectable()`, tidak ada
import Prisma, tidak ada `async`. Semuanya fungsi biasa yang menerima angka dan mengembalikan angka.

Isinya sendiri mengajarkan domain yang mungkin belum pernah kamu pikirkan. `missionDistanceKm` menghitung
**tiga leg**, bukan satu: posisi sekarang → pickup, pickup → dropoff, dropoff → home base. Leg ketiga
tidak bisa ditawar, dan komentarnya menjelaskan kenapa dengan kalimat yang menyelesaikan perdebatan:
*"A drone that reaches the dropoff and cannot return is not a successful delivery, it is a crash site
with a parcel next to it."* Leg pertama adalah yang paling sering dilupakan: pengiriman 2 km itu murah,
kecuali satu-satunya pesawat bebas parkir 15 km dari titik pickup.

`usableRangeKm` menerapkan tiga reduksi berurutan atas angka `rangeKm` yang tertulis di baris database:
dikali persentase baterai, dikali derate payload (mengangkat beban memakan energi), dikali sisa setelah
reserve 25%. Semua konstantanya ada di `dispatch.constants.ts`, yang headernya menyatakan: *"Every
number here is a SAFETY margin, not a preference."*

Tapi bagian yang paling layak kamu tiru bukan kemurniannya — melainkan **pemakaian ulang lintas
modul**. Perhatikan tanda tangan `usableRangeKm`: parameternya bukan `FeasibilityAircraft` utuh,
melainkan `Pick<FeasibilityAircraft, 'rangeKm' | 'maxPayloadKg' | 'batteryPercent'>`. Ini sengaja, dan
komentarnya menjelaskan kenapa (`:99-101`): jangkauan tidak bergantung pada **di mana** pesawatnya
berada, dan dengan menyatakan itu di tipe, pengecekan recall in-flight di `telemetry/energy.ts` bisa
memakai **fungsi yang sama persis** alih-alih menumbuhkan model energi kedua yang akan menyimpang.

Baca ini pelan-pelan, karena ini adalah "single source of truth" versi domain: satu pesawat
**diberangkatkan** dengan sebuah budget energi, dan **dipanggil pulang** ketika budget yang sama
berhenti menutupi perjalanan pulang. Dua model energi terpisah pada akhirnya akan tidak sepakat, dan
*"the disagreement would be discovered in the field"* — yaitu, oleh drone yang jatuh.

Satu detail terakhir yang bagus: di `assessRecall`, margin keselamatan diterapkan pada **jarak**, bukan
pada jangkauan (`energy.ts:88-90`). Membesarkan jarak-ke-rumah adalah arah konservatif; mengecilkan
jangkauan akan membuat baterai rendah terlihat lebih baik. Aritmetika yang sama, arah yang berlawanan.

**Anchor:**
- `src/dispatch/flight-feasibility.ts:1-11` — header file, tiga kalimat yang menjelaskan pertanyaan apa
  yang sebenarnya dijawab file ini.
- `src/dispatch/flight-feasibility.ts:56` `missionDistanceKm` · `:98` `usableRangeKm` · `:143`
  `assessFeasibility` · `:181` `rankCandidates`.
- `src/dispatch/flight-feasibility.ts:99-101` — komentar `Pick<>` yang sempit dan alasannya.
- `src/dispatch/flight-feasibility.ts:114` — `Math.min(1, ...)` yang menjaga derate tidak melewati 100%.
- `src/deliveries/telemetry/energy.ts:54-57` — kalimat "satu budget, dua arah".
- `src/deliveries/telemetry/energy.ts:59` — `assessRecall()`, yang memanggil `usableRangeKm` yang sama.
- `src/dispatch/dispatch.constants.ts:1-5` — "Every number here is a SAFETY margin"; `:32`, `:39`,
  `:48` — tiga konstanta beserta pembenaran fisiknya masing-masing.
- `src/deliveries/simulation/preflight.ts:69-75` — `holdExhausted` sengaja dipisah dari
  `classifyPreflight`: *"whether the weather is bad and whether we have run out of patience are
  different questions."*

**Kenapa dipakai di sini:** karena perhitungan ini adalah satu-satunya bagian sistem yang
kegagalannya tidak bisa di-rollback. Transaksi bisa dibatalkan, uang bisa dikembalikan, status bisa
diperbaiki admin. Drone yang kehabisan baterai di atas kota tidak. Memisahkannya jadi fungsi murni
berarti kamu bisa menjalankan 1000 kombinasi input dalam milidetik, tanpa database, di CI, setiap
commit.

**Alternatif:**
- **Menaruh perhitungan di dalam service ber-`@Injectable()`** — konsisten dengan gaya Nest di
  seluruh repo, dan bisa di-mock lewat DI. Trade-off konkret: setiap tes butuh
  `Test.createTestingModule({...})` dengan provider palsu — bandingkan dengan
  `flight-feasibility.spec.ts` yang bisa langsung memanggil fungsi. Lebih penting: begitu ada
  `constructor(private prisma: PrismaService)`, godaan menyelipkan satu query ke tengah rumus jadi
  besar, dan rumus yang menyentuh I/O tidak lagi bisa diuji 1000 kali dalam satu detik.
- **Menghitung dan meranking di SQL** (`ORDER BY` dengan ekspresi jarak) — satu round-trip, ranking di
  DB, tidak ada batas kandidat. Trade-off konkret: `dispatch.constants.ts:58-63` menjelaskan
  penolakannya — *"feasibility needs geometry SQL cannot express"* — dan itu sebabnya ada
  `CANDIDATE_LIMIT = 50` yang membatasi baris yang ditarik lalu diranking in-process. Menulis derate
  payload + reserve + tiga leg haversine sebagai ekspresi SQL bisa dilakukan, tapi hasilnya adalah
  logika keselamatan yang hidup di string dan hanya bisa diuji dengan Postgres menyala.
- **Rules engine / tabel konfigurasi untuk margin keselamatan** — operator bisa mengubah tanpa deploy,
  persis yang dilakukan untuk zona airspace di 7.13. Trade-off konkret: nilai di `dispatch.constants.ts`
  adalah **margin fisika**, bukan kebijakan bisnis. Menaruhnya di DB berarti ada orang yang bisa
  mengetik `RANGE_RESERVE_FRACTION = 0` pukul dua pagi dan tidak ada review yang menghentikannya.
  Perbedaan "data yang boleh diubah operator" vs "konstanta yang butuh review" adalah keputusan
  keselamatan, bukan keputusan kenyamanan.

**Latihan:** Tanpa menyentuh database, tulis property test sederhana di
`src/dispatch/flight-feasibility.spec.ts`: untuk 1000 kombinasi acak `(rangeKm, batteryPercent,
payloadKg)`, buktikan `usableRangeKm` **selalu** `>= 0` dan **selalu** monoton naik terhadap
`batteryPercent`. Verifikasi mutasi: ubah `PAYLOAD_RANGE_PENALTY` dari `0.35` ke `1.2` dan jalankan
lagi. Tesmu harus tetap hijau — lalu hapus `Math.min(1, ...)` di `:114` dan jalankan sekali lagi.
Tulis satu paragraf: clamp itu menyelamatkan sistem dari apa, dan kenapa jangkauan **negatif** lebih
berbahaya daripada jangkauan nol.

---

### 7.7 Klaim & pelepasan resource fisik

Konsep yang benar-benar absen dari dunia frontend, dan aku tidak akan mencari analogi yang
dipaksakan: **sebuah baris database di sini mewakili benda fisik yang bisa hilang.** Yang paling dekat
dari pengalamanmu mungkin adalah `useEffect` cleanup yang lupa dipanggil — tapi di React, konsekuensi
lupa cleanup adalah memory leak yang hilang saat halaman di-refresh. Di sini, konsekuensinya adalah
satu pesawat seharga puluhan juta yang tercatat "sedang terbang" selamanya dan tidak pernah bisa
ditugaskan lagi.

Mekanismenya sederhana dan elegan: `Drone.activeDeliveryId` adalah kolom **UNIQUE nullable**. Kalau
`null`, pesawat bebas. Kalau berisi id delivery, pesawat itu terikat pada delivery tersebut, dan
database sendiri yang menjamin tidak ada dua delivery memegang satu pesawat. Klaimnya adalah CAS yang
sudah kamu kenal dari Fase 5 — dengan `where` yang membawa **seluruh** prasyarat: `airworthy: true`,
`status: AVAILABLE`, `activeDeliveryId: null`, `maxPayloadKg >= payloadKg`.

Repo mencatat **tiga bug asli** soal pelepasan, dan ketiganya layak dibaca sebagai satu cerita:

**Bug 1 — jalur sukses tidak melepaskan apa pun.** Komentar di `deliveries.service.ts:1497-1501`:
*"every terminal path had a release except the one that actually happens, so a healthy fleet lost one
airframe per completed delivery until every drone was permanently 'in flight' and dispatch had nothing
left to assign."* Baca ulang bagian "except the one that actually happens" — jalur gagal, jalur
dibatalkan, jalur di-abort admin semuanya punya `release()`. Jalur yang paling sering terjadi,
`confirmHandoff` sukses, tidak punya. Ini adalah kelas bug klasik: kamu menulis penanganan untuk kasus
yang kamu pikirkan (kegagalan) dan lupa kasus yang kamu asumsikan (keberhasilan).

**Bug 2 — jalur gagal melepaskan terlalu cepat.** `RETURNING` adalah terminal untuk **uang**, bukan
untuk **pesawat**. Customer sudah di-refund, sisi finansial delivery ditutup — tapi drone-nya masih di
udara, membawa paket, terbang pulang. Melepaskannya di titik itu berarti menyerahkan pesawat yang
sedang terbang ke booking berikutnya. Karena itu lahir nilai ketiga yang bukan `ReleaseOutcome`:
`AircraftDisposition = ReleaseOutcome | 'STILL_AIRBORNE'`. Pelepasan sesungguhnya terjadi di
`completeReturnToBase` (`:1223`), dan di sana ia di-`GROUND_FOR_INSPECTION`, bukan dikembalikan ke pool
— karena apa pun yang membatalkan pengiriman itu belum didiagnosis.

**Bug 3 — "bukan salah pesawat" ≠ "pesawat sudah parkir".** `RECIPIENT_UNAVAILABLE` artinya penerima
tidak muncul. Itu bukan salah pesawatnya. Tapi pesawatnya tetap melayang di atas taman orang asing
sambil memegang paket mereka. Kalimat yang menyelesaikan kebingungan ini ada di `:1166-1167`: *"'The
airframe is not at fault' and 'the airframe is parked' are different questions; only the second one
licenses a release."* Dua pertanyaan, dua jawaban, dan hanya satu yang memberi izin melepas.

Ada satu lagi yang tidak terpikirkan pemula: **re-entrancy**. `selectAndClaim` dimulai dengan mencari
apakah delivery ini **sudah** memegang pesawat. Kenapa? Karena `activeDeliveryId` UNIQUE. Kalau
pemanggil sempat mengklaim lalu mati sebelum mencatatnya (retry BullMQ, `create()` yang dijalankan
ulang), tanpa cek ini ia akan meranking pesawat **lain**, mencoba menulis klaim kedua untuk delivery
yang sama, kena `P2002` — dan pesawat pertama tertahan selamanya. Cek re-entrant mengubah blip yang
bisa dipulihkan menjadi tidak-terjadi-apa-apa: *"If this delivery already holds one, that IS its
aircraft."*

**Anchor:**
- `src/dispatch/dispatch.service.ts:67-82` — JSDoc kelas, termasuk sejarah `drone-${uuidv4()}` yang
  tidak mereferensikan baris apa pun, dan `droneId` yang dulu ada di DTO publik.
- `src/dispatch/dispatch.service.ts:37-41` — `type ReleaseOutcome`: `RETURN_TO_FLEET` vs
  `GROUND_FOR_INSPECTION`.
- `src/dispatch/dispatch.service.ts:120-134` — JSDoc `release()`; perhatikan kenapa
  `GROUND_FOR_INSPECTION` juga mematikan `airworthy`, bukan hanya mengubah status.
- `src/dispatch/dispatch.service.ts:173` — `selectAndClaim()`; `:178-194` — blok re-entrancy;
  `:228-250` — loop klaim CAS yang pindah ke kandidat berikutnya saat kalah balapan.
- `src/deliveries/deliveries.service.ts:121-128` — `type AircraftDisposition` dan JSDoc-nya.
- `src/deliveries/deliveries.service.ts:1497-1502` — pelepasan di jalur sukses, dengan post-mortem-nya.
- `src/deliveries/deliveries.service.ts:1156-1174` — dua alasan independen untuk **tidak**
  mengembalikan pesawat ke pool.
- `src/deliveries/deliveries.service.ts:1198-1201` — `beginReturnToBase` yang sengaja
  mempertahankan klaim; `:1223` `completeReturnToBase` dan `:1229` pelepasannya.
- `src/deliveries/deliveries.service.ts:1292-1302` — `cleanupAfterTermination`: satu tempat yang
  memutuskan disposisi pesawat untuk **semua** jalur terminal.
- `src/deliveries/simulation/simulation.processor.ts:187-220` — kegagalan **ambigu**: promise yang
  reject bukan bukti statement tidak commit. *"release only on PROOF the transition did not happen."*

**Kenapa dipakai di sini:** karena ini adalah satu-satunya tempat di sistem di mana "lupa
membersihkan" tidak bisa dipulihkan oleh restart. Job yang hilang bisa di-enqueue ulang, cache yang
basi bisa di-invalidate, tapi pesawat yang tercatat terbang padahal parkir hanya bisa diperbaiki
manusia yang melihat baris database. Perhatikan bahwa pilihan repo di titik ambigu selalu sama:
**lebih baik bocor daripada double-booking**, karena kebocoran bisa dipulihkan operator dan
double-booking tidak.

**Alternatif:**
- **Tabel `drone_reservations` terpisah dengan TTL** — klaim kedaluwarsa sendiri, jadi kebocoran
  sembuh otomatis tanpa intervensi. Trade-off konkret: kamu butuh sweeper (satu job terjadwal lagi),
  dan TTL yang terlalu pendek akan **menjual pesawat yang sedang terbang** — mengubah kelas bug
  "bocor" (aman) menjadi "double-booking" (tidak aman). Untuk misi berdurasi variabel, memilih satu
  angka TTL yang benar untuk semua misi adalah masalah yang sama sulitnya dengan masalah aslinya.
- **Redis lock per drone** — klaim cepat, tidak membebani Postgres, dan bisa punya TTL bawaan.
  Trade-off konkret: kepemilikan pesawat jadi **tidak durabel**. Redis di repo ini adalah cache +
  queue + pub/sub; ia boleh kehilangan data saat restart tanpa merusak apa pun. Menaruh kepemilikan
  armada di sana berarti satu `FLUSHALL` yang tidak disengaja = dua delivery memegang satu pesawat,
  dan Postgres tidak punya cara mengetahuinya.
- **Penugasan lewat antrian (assign di worker, bukan sinkron saat create)** — `create()` jadi cepat
  dan tidak pernah ditolak karena armada penuh. Trade-off konkret: customer tidak langsung tahu
  bookingnya diterima, jadi kamu butuh status "menunggu penugasan" dan jalur notifikasi kalau
  akhirnya gagal. Repo memilih menolak di depan, **dan** membedakan "tidak akan pernah bisa"
  (`NO_CAPACITY`) dari "tidak sekarang" (`UNAVAILABLE`) — karena hanya perbedaan itu yang bisa
  ditindaklanjuti customer.

**Latihan:** Seed tiga drone lewat `POST /api/v1/admin/drones` dengan `maxPayloadKg` 1, 5, dan 25
(field wajib: `serial`, `model`, `maxPayloadKg`, `rangeKm`, `homeBaseLat`, `homeBaseLng`). Dengan
`LIVE_DISPATCH=true`, buat delivery 0.2 kg dan verifikasi lewat log `Dispatched drone ...` bahwa yang
dipilih adalah drone 1 kg. Lalu tulis tes di `src/dispatch/dispatch.service.spec.ts` yang memaksa
`prisma.drone.updateMany` mengembalikan `{count: 0}` untuk kandidat pertama dan `{count: 1}` untuk
kedua — buktikan kandidat kedua yang diklaim, bukan error yang dilempar. Verifikasi mutasi terakhir:
hapus baris `await this.dispatchService.release(deliveryId, 'RETURN_TO_FLEET');` di `confirmHandoff`
(`:1502`), jalankan `npx jest src/deliveries`, dan catat tes mana yang mati. Kalau tidak ada yang
mati, kamu baru saja menemukan lubang di test suite — tutup sendiri.

---

### 7.8 Ranking global vs lokal: kapasitas terkecil yang mencukupi

Ini konsep pendek tapi berisi satu ide yang akan mengubah cara kamu menulis fungsi `sort` selamanya.

Naluri pertama saat memilih drone untuk sebuah pengiriman adalah "ambil yang terdekat". Itu optimal
secara lokal: misinya jadi paling pendek, energinya paling hemat, pengirimannya paling cepat.
Repo memilih kunci pengurutan yang berbeda, dan komentarnya menjelaskan kenapa dengan satu contoh yang
langsung menutup perdebatan (`flight-feasibility.ts:171-175`):

> *"Primary key is SMALLEST SUFFICIENT CAPACITY, not nearest. Sending the 5 kg heavy-lift airframe to
> carry a 200 g envelope is locally optimal and globally wrong: it is the only aircraft that can take
> the next heavy booking, and while it is out carrying an envelope that booking gets rejected."*

Jarak tetap dipakai — sebagai **tie-break**. Di antara pesawat yang kapasitasnya sama-sama pas, yang
terdekat yang berangkat. Dan ada tie-break ketiga di `id` supaya urutannya deterministik; alasannya
juga ditulis: tanpa itu, dua pesawat identik akan terurut sesuai apa pun yang dikembalikan database,
dan tes yang mengklaim pesawat mana yang diklaim jadi **flaky, bukan salah**. Perbedaan antara "tes
gagal kadang-kadang" dan "tes gagal" itu penting, dan menutupnya dengan tie-break deterministik
adalah kebiasaan bagus.

Ada satu keputusan lagi yang berpasangan dengan ini dan mudah terlewat. Query kandidat memakai
`orderBy: [{ maxPayloadKg: 'asc' }, { id: 'asc' }]` dan `take: CANDIDATE_LIMIT` (50). Kenapa urutannya
menaik? Karena kalau armadanya lebih besar dari 50, baris yang **dibuang** adalah pesawat heavy-lift —
yang memang paling tidak ingin kita tugaskan. Batas yang aman gagal ke arah yang benar.

**Anchor:**
- `src/dispatch/flight-feasibility.ts:168-179` — JSDoc `rankCandidates`, seluruh argumennya.
- `src/dispatch/flight-feasibility.ts:181` — `rankCandidates()`; `:195-203` — comparator tiga tingkat
  (kapasitas → jarak misi → id).
- `src/dispatch/dispatch.service.ts:220-223` — `orderBy` menaik + `take: CANDIDATE_LIMIT`, dengan
  komentar tentang baris mana yang dibuang.
- `src/dispatch/dispatch.constants.ts:58-64` — `CANDIDATE_LIMIT` dan kenapa ranking dilakukan
  in-process.
- `src/dispatch/dispatch.constants.ts:50-56` — `MAX_CLAIM_ATTEMPTS = 8`: *"Losing 8 races in a row
  means the fleet is saturated, and one more attempt will not help."*

**Kenapa dipakai di sini:** karena armada adalah **sumber daya bersama yang langka dan heterogen**.
Optimasi per-permintaan (yang terdekat, tercepat) mengabaikan permintaan berikutnya yang belum datang.
Ini adalah versi domain dari argumen yang sama dengan kenapa kamu tidak mengalokasikan seluruh RAM
untuk satu proses hanya karena proses itu yang sedang berjalan.

**Alternatif:**
- **Terdekat dulu (nearest-first)** — misi paling pendek, energi paling irit, dan gampang dijelaskan
  ke operator. Trade-off konkret: pada armada campuran, pesawat heavy-lift akan sering jadi yang
  terdekat (karena mereka juga paling sering menganggur di hub), dan setiap booking berat berikutnya
  ditolak dengan `NO_CAPACITY` padahal armadanya mampu. Kamu menukar beberapa ratus meter dengan
  booking yang hilang.
- **Ranking di SQL** — satu round-trip, tanpa `CANDIDATE_LIMIT`, dan urutannya bisa diindeks.
  Trade-off konkret: lihat 7.6 — feasibility butuh geometri tiga leg + derate payload yang tidak bisa
  diekspresikan SQL tanpa menulis ulang seluruh rumus keselamatan sebagai ekspresi string. Kamu juga
  kehilangan kemampuan menjalankan ranking di property test.
- **Bobot komposit (skor = a×kapasitas + b×jarak)** — bisa disetel, dan terasa "lebih pintar".
  Trade-off konkret: dua angka setelan yang tidak punya arti fisik, sehingga tidak ada yang bisa
  menjawab "kenapa `b = 0.3`?" saat insiden. Comparator berjenjang (`||`) yang dipakai repo bisa
  dijelaskan kalimat per kalimat: kapasitas dulu, lalu jarak, lalu id.

**Latihan:** Di `src/dispatch/flight-feasibility.spec.ts`, tulis tes dengan tiga pesawat: A
(`maxPayloadKg: 25`, parkir 1 km dari pickup), B (`maxPayloadKg: 5`, parkir 10 km), C
(`maxPayloadKg: 1`, parkir 20 km). Untuk paket 0.2 kg, buktikan `rankCandidates` mengembalikan
`[C, B, A]`. Verifikasi lanjutan: untuk paket 3 kg, buktikan hasilnya `[B, A]` — C hilang karena
`CAPACITY`, bukan karena `RANGE`. Lalu balik comparator (jarak dulu, kapasitas kemudian), jalankan
lagi, dan catat kedua tes itu mati.

---

### 7.9 Dua produsen, satu kontrak: `SIMULATED` vs `LIVE`

Ini pelajaran arsitektur terbaik di fase ini untuk seorang frontend dev, karena ia menunjukkan cara
memasukkan **hardware sungguhan** ke dalam sistem tanpa mengubah satu baris pun kontrak API.

Idenya: setiap delivery punya satu diskriminator `trackingSource` yang ditetapkan sekali di
`create()` dan tidak pernah berubah. `SIMULATED` berarti `SimulationProcessor` (job BullMQ di tier
worker) yang menggerakkan statusnya. `LIVE` berarti telemetri drone sungguhan yang masuk lewat
`POST /ingest/telemetry`. Keduanya **tidak pernah** menggerakkan satu delivery yang sama — dan itu
dijamin oleh dua hal yang berpasangan: LIVE tidak pernah meng-enqueue job simulasi
(`deliveries.service.ts:529`), dan telemetri menolak delivery non-LIVE dengan 403
(`telemetry.service.ts:107`).

Yang membuat ini elegan bukan diskriminatornya, melainkan bahwa `TelemetryService` **tidak
mengimplementasikan ulang apa pun**. Ia memakai CAS monoton yang sama (`statusesBefore`),
`TrackingService.updateTracking` yang sama, `TrackingPublisher` yang sama. JSDoc-nya menyimpulkan
konsekuensinya dalam empat kata: *"Safety follows for free."* Pesan out-of-order, duplikat, atau
basi menjadi no-op tanpa satu baris kode tambahan, karena CAS-nya sudah menjamin itu untuk simulasi.

Dan bagian yang paling patut kamu curi: **kosakata wire yang sengaja berbeda**. Drone tidak mengirim
`DeliveryStatus`. Ia mengirim `DronePhase` — kosakata kecil milik perangkat: `CONFIRMED`, `ASSIGNED`,
`PICKUP`, `IN_TRANSIT`, `ARRIVED`. Peta `PHASE_TO_STATUS` menerjemahkannya ke status internal, dan peta
itu **tidak punya satu pun entri yang menghasilkan `DELIVERED`**.

Pikirkan implikasinya. Seorang penyerang yang berhasil mendapatkan `INGEST_API_KEY` dan
`INGEST_HMAC_SECRET` tetap **tidak bisa** menyatakan paket sudah diterima. Bukan karena ada `if
(phase === 'DELIVERED') throw`. Karena `Record<HappyPhase, DeliveryStatus>` tidak punya kunci untuk
itu, dan `DronePhase` adalah union tertutup dari 8 string. Kirim `phase: 'DELIVERED'` dan TypeScript
menolaknya saat kompilasi; kirim lewat JSON mentah dan DTO menolaknya di boundary. `DELIVERED` hanya
bisa dicapai lewat OTP dari penerima di `confirmHandoff`. **Keamanan lewat bentuk peta, bukan lewat
`if`.**

Guard-nya berlapis, dan tiap lapis menjawab pertanyaan berbeda — kebiasaan yang layak ditiru:
1. `DroneAuthGuard` — "apakah kamu gateway yang sah?" (konsep 7.10)
2. `trackingSource !== LIVE` → 403 — "apakah delivery ini memang digerakkan telemetri?"
3. `assignedDroneId !== droneId` → 403 — "apakah kamu drone yang ditugaskan untuk delivery ini?"

Kunci yang valid tapi `droneId` yang salah tetap ditolak di lapis ketiga.

**Anchor:**
- `prisma/schema.prisma:272-279` — `enum TrackingSource` dengan komentar *"never both drive one
  delivery (the choice is fixed at create())"*.
- `src/deliveries/telemetry/telemetry.constants.ts:3-10` — JSDoc yang menjelaskan kenapa drone
  mengirim PHASE; `:36-42` — `PHASE_TO_STATUS`, tanpa `DELIVERED`.
- `src/deliveries/telemetry/telemetry.constants.ts:19-23` — `EXCEPTION_PHASES` sengaja dipisah supaya
  peta happy-path tetap linear.
- `src/deliveries/telemetry/telemetry.service.ts:39-51` — JSDoc kelas: *"reimplements none of them.
  Safety follows for free."*
- `src/deliveries/telemetry/telemetry.service.ts:107` (guard LIVE-only) dan `:114` (kepemilikan
  drone↔delivery).
- `src/deliveries/telemetry/telemetry.service.ts:159-163` — CAS monoton yang identik dengan simulasi.
- `src/deliveries/deliveries.service.ts:524-529` — sisi berpasangannya: LIVE tidak meng-enqueue job.
- `src/deliveries/telemetry/mqtt-telemetry.subscriber.ts:9-17` — transport kedua, core yang sama.
- `src/dispatch/dispatch.constants.ts:7-24` — `liveDispatchEnabled()` dan kenapa default-nya OFF.

**Kenapa dipakai di sini:** `ARCHITECTURE.md:56` merangkumnya — *"a real drone now is an
interchangeable producer for the same tracking contract... reuses the **same** monotonic CAS +
`TrackingService` + `TrackingPublisher`, so the API and mobile contracts don't change."* Aplikasi
mobile tidak tahu dan tidak perlu tahu apakah drone di petanya nyata atau simulasi. Itu adalah definisi
abstraksi yang benar.

**Alternatif:**
- **Satu jalur saja (selalu LIVE)** — tidak ada mode simulasi, tidak ada dua jalur untuk dipelihara.
  Trade-off konkret: mustahil menjalankan demo, CI, atau development tanpa hardware. `LIVE_DISPATCH`
  default OFF ada persis untuk itu — dev, CI, dan setiap deployment demo menjalankan simulasi, dan
  test suite tidak butuh satu pun drone.
- **Drone mengirim `DeliveryStatus` mentah** — lebih sedikit pemetaan, satu kosakata untuk semua.
  Trade-off konkret: drone (atau siapa pun yang memegang kuncinya) bisa mengirim `DELIVERED` atau
  `CANCELED`. Seluruh jaminan struktural di atas hilang, dan kamu harus menggantinya dengan allowlist
  di runtime — yang bisa lupa diperbarui saat status baru lahir.
- **Satu tabel status terpisah per produsen, digabung saat baca** — sim menulis ke tabelnya, drone ke
  tabelnya, pembaca merge. Trade-off konkret: kamu memindahkan konflik dari waktu tulis (di mana
  Postgres bisa menyelesaikannya dengan CAS) ke waktu baca (di mana kamu harus menulis aturan merge
  sendiri, dan aturan itu akan berbeda di API, di WS gateway, dan di admin).
- **MQTT sebagai satu-satunya transport** — lebih hemat untuk perangkat IoT bertenaga baterai, dan
  QoS-nya sudah memikirkan koneksi buruk. Trade-off konkret: butuh broker yang harus di-deploy,
  di-monitor, dan diamankan; repo menjadikannya **transport opsional kedua** yang memanggil `ingest()`
  yang sama, jadi satu suite tes meng-cover keduanya.

**Latihan:** Aktifkan `LIVE_DISPATCH=true` dan `INGEST_API_KEY=dev-key`, seed satu drone airworthy,
buat delivery, lalu kirim frame telemetri berurutan dengan `curl` ke `POST /api/v1/ingest/telemetry`:
`phase: 'CONFIRMED'` → `'ASSIGNED'` → `'PICKUP'` → `'IN_TRANSIT'` → `'ARRIVED'`. Verifikasi lewat
`GET /api/v1/deliveries/:id` bahwa statusnya sampai `AWAITING_HANDOFF`. Lalu **kirim ulang** frame
`PICKUP` dan buktikan statusnya tidak mundur (response `applied: false`). Terakhir, tambahkan
`phase: 'DELIVERED'` di sebuah file `.ts` yang memanggil `ingest()` dan jalankan `npx tsc --noEmit` —
tulis pesan error compiler-nya di catatanmu, karena itu adalah bukti bahwa jaminannya struktural.

---

### 7.10 Auth aktor non-manusia: `DroneAuthGuard`

Semua auth yang kamu tulis sejauh ini — di Fase 2, dan di aplikasi Ionic-mu — mengandaikan ada
**manusia** di ujung sana: ada login, ada password, ada token yang mewakili identitas orang. Drone
bukan orang. Ia tidak bisa login, tidak punya password yang bisa diketik, dan tidak ada yang bisa
menekan "izinkan" di layarnya.

Jadi route ingest ditandai `@Public()` — yang berarti `JwtAuthGuard` global melewatinya — dan
`DroneAuthGuard` menjadi gerbang sesungguhnya. Perhatikan: `@Public()` di sini **bukan** "boleh
diakses siapa saja". Ia berarti "JWT pengguna tidak relevan di sini". Itu perbedaan yang penting dan
sering disalahpahami.

Postur guard-nya **fail-closed**, dan alasannya ditulis: kalau `INGEST_API_KEY` tidak dikonfigurasi,
endpoint-nya **mati total** — setiap request ditolak. Bandingkan dengan kebiasaan umum "kalau secret
kosong, lewati pengecekan" yang membuat deployment yang salah konfigurasi jadi endpoint terbuka.
Di sini, konfigurasi yang belum diisi menghasilkan sistem yang tidak bisa didorong siapa pun.

Autentikasinya dua lapis:
1. **Shared key** dibandingkan dengan waktu konstan. Perhatikan `constantTimeEquals` di `:117-121`:
   kedua sisi di-SHA-256 dulu ke panjang tetap, supaya panjang maupun isi secret tidak bocor lewat
   timing — **dan** supaya `timingSafeEqual` tidak melempar saat panjangnya beda.
2. **HMAC-SHA256 bertimestamp**, hanya kalau `INGEST_HMAC_SECRET` diisi. Di sinilah detailnya menarik.

Payload yang ditandatangani bukan sekadar body. Ia adalah
`${timestamp}.${method}.${url}.` + rawBody. Tiga bagian, tiga tujuan berbeda:
- **timestamp** + jendela toleransi 5 menit → frame yang direkam tidak bisa diputar ulang besok.
- **method + URL** → tanda tangan yang direkam untuk satu route tidak bisa **di-retarget** ke route
  lain. Ini krusial untuk kanal command (7.11), di mana selektornya ada **di luar** body:
  `?droneId=` ada di query string poll, dan `:id` ada di path ack. Tanpa mengikat URL, tanda tangan
  yang sah untuk ack command A bisa dipakai untuk ack command B.
- **rawBody** (byte mentah, bukan hasil re-serialize) → agar `JSON.stringify` yang mengurutkan kunci
  berbeda tidak merusak kecocokan.

Ini adalah postur yang sama persis dengan webhook Stripe yang kamu bedah di Fase 5. Kalau kamu
merasa déjà vu, itu memang disengaja: dua aktor mesin, satu pola.

Satu catatan jujur: JSDoc di `:30-34` menyebut HMAC atas `${timestamp}.${rawBody}`, sementara
implementasinya di `:88-91` sudah mengikat method dan URL juga. Komentarnya tertinggal satu langkah di
belakang kode. Kalau kamu mau menyumbang perbaikan kecil ke repo minggu ini, itu kandidat yang bagus —
dan pengalaman menemukan komentar yang basi lewat pembacaan sendiri jauh lebih berharga daripada
diberi tahu.

**Anchor:**
- `src/deliveries/telemetry/drone-auth.guard.ts:20-37` — JSDoc kelas: kenapa `@Public()`, kenapa
  fail-closed, dan kenapa mTLS ditunda.
- `src/deliveries/telemetry/drone-auth.guard.ts:48-54` — cabang "key tidak dikonfigurasi → endpoint
  dinonaktifkan".
- `src/deliveries/telemetry/drone-auth.guard.ts:65-74` — jendela kesegaran diperiksa **sebelum** HMAC
  (yang mahal) dihitung.
- `src/deliveries/telemetry/drone-auth.guard.ts:79-91` — komentar + kode pengikatan method+URL.
- `src/deliveries/telemetry/drone-auth.guard.ts:112-121` — `constantTimeEquals` dan alasan hashing
  kedua sisi.
- `src/deliveries/telemetry/telemetry.constants.ts:72-78` — nama header + `INGEST_SIGNATURE_TOLERANCE_MS`.
- `src/deliveries/telemetry/telemetry.controller.ts:18-22` — JSDoc controller: *"a drone is not a user"*.
- `src/deliveries/commands/command.controller.ts:25-30` — guard yang sama dipakai ulang untuk kanal
  command, dua route berbeda.

**Kenapa dipakai di sini:** karena keputusan yang diambil komentarnya adalah keputusan
proporsionalitas, dan itu ditulis terang-terangan: *"Per-device certs / mTLS are deferred
(fleet-scale); a rotatable shared key is proportionate for a portfolio backend with no hardware."*
Ini bukan "kami malas". Ini "kami tahu bentuk yang benar untuk skala armada, dan kami memilih yang
proporsional untuk skala sekarang, secara sadar, tertulis". Itu adalah kalimat yang membedakan
engineer dari orang yang menyalin tutorial.

**Alternatif:**
- **mTLS / sertifikat per perangkat** — setiap drone punya identitas kriptografis sendiri, pencabutan
  per-perangkat mungkin, dan kunci yang bocor hanya mengorbankan satu pesawat. Trade-off konkret:
  butuh PKI — CA, penerbitan, rotasi, CRL/OCSP — plus terminasi TLS yang tidak memutus rantai
  sertifikat di edge (Caddy/nginx harus meneruskan client cert). Untuk armada nol perangkat, itu
  infrastruktur yang tidak melindungi apa pun.
- **JWT jangka pendek per drone** — bisa dicabut, bisa membawa klaim (`droneId` di dalam token,
  bukan di body), dan reuse pola yang sudah ada. Trade-off konkret: butuh endpoint penerbitan token
  dan kredensial jangka panjang untuk menukarnya — jadi kamu tetap punya shared secret, hanya
  ditambah satu lapis. Untuk perangkat yang mengirim frame 10 Hz, siklus refresh token juga jadi
  mode kegagalan baru.
- **Signature atas body saja (tanpa timestamp/URL)** — paling sederhana untuk dibuat gateway.
  Trade-off konkret: frame yang direkam bisa diputar ulang kapan saja, dan tanda tangan yang sah
  untuk satu route bisa dipakai di route lain yang selektornya ada di URL. Kedua lubang itu persis
  yang ditutup `:79-91`.

**Latihan:** Baca `src/deliveries/telemetry/drone-auth.guard.spec.ts` untuk melihat bentuk request
yang sah. Lalu buktikan tiga penolakan dengan `curl`: (a) tanpa header `x-ingest-key` → 401;
(b) dengan key benar tapi `x-ingest-timestamp` yang mundur 10 menit (dengan `INGEST_HMAC_SECRET`
diisi) → 401 "outside tolerance"; (c) tanda tangan sah untuk `POST /ingest/telemetry` dipakai untuk
`POST /ingest/commands/<id>/ack` → 401. Verifikasi (c) adalah yang paling instruktif: hapus sementara
`method` dan `url` dari `signedPayload` di `:88-91`, ulangi, dan buktikan sekarang ia **diterima**.
Kembalikan kodenya.

---

### 7.11 Command outbox backend → drone: issue / poll / ack

Sejauh ini arahnya satu jalur: drone bicara, backend mendengar. Konsep ini adalah arah sebaliknya —
operator ingin menyuruh pesawat yang sedang terbang untuk pulang atau membatalkan misi. Dan di sinilah
**outbox pattern** muncul dalam bentuk yang paling mudah dicerna.

Aturan intinya satu kalimat, dan ia menyelamatkanmu dari seluruh kelas bug: **perintah tidak pernah
mengubah delivery.** Yang mengubah delivery adalah **ack**-nya. `issue()` hanya menulis satu baris
`DroneCommand` berstatus `PENDING`. Drone mem-poll (`GET /ingest/commands?droneId=`), baris itu
berpindah ke `FETCHED`. Drone meng-ack (`POST /ingest/commands/:id/ack`), dan **ack itulah** yang
memanggil `beginReturnToBase` atau `failExceptional` — transisi yang sama persis yang dipakai
telemetri, watchdog, dan admin. Satu jalur transisi, satu tempat refund, satu tempat notifikasi.

Kenapa itu penting? Karena kalau `issue()` langsung mengubah status jadi `RETURNING`, statusnya
**berbohong**: delivery tercatat sedang pulang padahal drone-nya belum menerima perintah apa pun —
bisa jadi sedang di luar jangkauan sinyal.

Tiga detail yang layak kamu tiru:

**(a) Dedupe otoritatif ada di indeks database, bukan di kode.** Flight recorder bisa memicu
auto-return sendiri saat baterai kritis, dan telemetri masuk 10 Hz. Ada cooldown in-memory yang
mencegah 10 INSERT gagal per detik — tapi komentarnya (`flight-recorder.service.ts:156-161`) sangat
tegas soal statusnya: *"Write-rate damper only. The AUTHORITATIVE dedupe is the partial unique index
allowing one open command per delivery... it is an optimisation, so it does not need to be correct
across replicas, and making it shared state would give it a failure mode it does not deserve."*
Baca ulang kalimat terakhir. Cara berpikir "semua state harus konsisten lintas replika" adalah refleks
yang mahal; di sini repo secara sadar memilih state yang **boleh salah**, karena kebenarannya dijamin
di tempat lain.

**(b) Metrik harus bisa membedakan hal yang berbeda.** Ack yang ditolak drone (`rejected`) dipisahkan
dari ack yang diterima tapi transisinya keburu didahului aktor lain (`superseded`). Alasannya:
*"collapsing them would blind an operator to actual fleet refusals."* Kalau kedua kasus itu dihitung
dalam satu counter, dashboard yang menunjukkan lonjakan penolakan tidak bisa dibedakan dari dashboard
yang menunjukkan bahwa watchdog kebetulan lebih cepat.

**(c) Crash di antara dua langkah punya pemulih.** Ack sudah mengklaim baris (`FETCHED → ACKED`) tapi
proses mati sebelum transisi delivery-nya jalan. Baris itu jadi "stranded": ACKED tapi
`appliedTransition: false`. Watchdog punya `reconcileStrandedAcks()` yang mengulang transisi
idempoten itu setelah `COMMAND_RECONCILE_GRACE_MS` (2 menit). Tanpa itu, niat operator hilang senyap —
atau lebih buruk, delivery-nya nanti di-reap watchdog sebagai `MECHANICAL` biasa dan salah atribusi.

Satu lagi yang bagus: `COMMAND_TYPE_TO_LEGAL_STATUSES` memetakan tiap tipe perintah ke **himpunan
status milik transisi yang sudah ada** — `RETURN_TO_BASE` → `RETURNABLE_STATUSES`, `ABORT` →
`FAILABLE_STATUSES`. Bukan daftar baru yang bisa menyimpang. Konsep 7.1 berbuah di sini.

**Anchor:**
- `src/deliveries/commands/drone-command.service.ts:42-48` — JSDoc kelas: *"The command row is a
  durable audit/outbox, NOT a second source of truth — the Delivery row stays authoritative."*
- `src/deliveries/commands/drone-command.service.ts:73` `issue()` · `:214` `fetchPending()` · `:275`
  `ack()`.
- `src/deliveries/commands/drone-command.service.ts:117-124` — gerbang fail-fast atas status legal,
  dengan catatan bahwa CAS saat ack tetap yang otoritatif.
- `src/deliveries/commands/drone-command.service.ts:243-263` — CAS `PENDING → FETCHED`, termasuk
  cabang "kalah balapan → baca ulang kebenaran, jangan asumsikan".
- `src/deliveries/commands/drone-command.service.ts:331-342` — klaim single-winner `FETCHED → ACKED`.
- `src/deliveries/commands/drone-command.service.ts:347-386` — ack yang diterima tapi transisinya
  no-op → dicatat sebagai `REJECTED`, bukan `ACKED` yang menyesatkan.
- `src/deliveries/commands/drone-command.service.ts:389-397` — pemisahan `rejected` vs `superseded`.
- `src/deliveries/commands/command.constants.ts:40-51` — `COMMAND_TYPE_TO_LEGAL_STATUSES`; `:19` TTL;
  `:26` grace reconcile; `:33-38` himpunan status "open".
- `src/deliveries/telemetry/flight-recorder.service.ts:131-143` — JSDoc `maybeRecall`: kenapa butuh
  baterai **dan** posisi, dan kenapa armada yang tidak mengirim baterai tidak dapat auto-return.
- `src/deliveries/telemetry/flight-recorder.service.ts:156-161` — damper vs dedupe otoritatif.
- `src/deliveries/telemetry/flight-recorder.service.ts:196-198` — `adminId: null`, "platform yang
  melakukannya".
- `src/delivery-watchdog/delivery-watchdog.ts:177-236` — `reconcileStrandedAcks()`.

**Kenapa dipakai di sini:** karena drone ada di belakang NAT dan koneksi seluler yang putus-sambung.
Kamu tidak bisa "push" ke sana dengan andal. `ARCHITECTURE.md:132` merangkumnya: baris DB + poll HTTP
adalah fallback durabel, sementara push MQTT (`drone-command.service.ts:160-165`) adalah optimasi
latensi yang **fail-open** — kalau publish gagal, perintahnya tetap sampai lewat poll berikutnya.

**Alternatif:**
- **Push langsung ke drone (MQTT/WebSocket) tanpa baris DB** — latensi terendah, tidak ada tabel yang
  tumbuh. Trade-off konkret: kalau drone offline saat perintah dikirim, perintahnya **hilang** dan
  operator tidak tahu. Repo tetap melakukan push MQTT, tapi sebagai jalur cepat di atas outbox
  durabel, bukan sebagai gantinya.
- **Perintah langsung mengubah `Delivery.status` saat issue** — satu langkah lebih sedikit, dan UI
  admin langsung menunjukkan hasilnya. Trade-off konkret: status berbohong sampai drone benar-benar
  menerimanya, dan kalau drone tidak pernah menerimanya, tidak ada yang mengembalikan status itu.
  Kamu menukar satu langkah dengan kelas bug "delivery `RETURNING` selamanya padahal drone terus
  terbang ke dropoff".
- **gRPC bidirectional stream ke drone** — dua arah, real-time, dengan flow control bawaan.
  Trade-off konkret: butuh koneksi persisten yang mahal untuk perangkat bertenaga baterai, dan
  perangkat di belakang NAT tetap harus yang memulai koneksi — jadi kamu membayar biaya koneksi
  terbuka terus-menerus untuk menghemat latensi beberapa detik pada perintah yang jarang.
- **Transactional outbox penuh + dispatcher terpisah** — repo punya versi ini juga untuk hal lain
  (`OutboxService`, dipakai untuk referral). Trade-off konkret: butuh worker pengirim yang jalan
  terus; untuk perintah drone, poll-dari-perangkat justru **lebih cocok** karena perangkatnya yang
  tahu kapan ia online.

**Latihan:** Dengan `LIVE_DISPATCH=true`, terbangkan satu delivery sampai `IN_TRANSIT` (lewat frame
telemetri seperti di 7.9). Sebagai admin, issue `RETURN_TO_BASE`. Lalu **poll dua kali** sebagai drone
dan verifikasi baris yang sama dikembalikan dengan status `FETCHED` — itu at-least-once yang bekerja.
Ack sekali → delivery jadi `RETURNING`. Ack lagi → harapkan 409 `error.command.not_awaiting_ack`.
Verifikasi terakhir dan paling instruktif: di `ack()`, sisipkan `throw new Error('crash')` tepat
**setelah** CAS klaim di `:332-339` dan sebelum `beginReturnToBase`. Jalankan ack sekali (ia akan
500), lalu turunkan `COMMAND_RECONCILE_GRACE_MS` jadi `5_000`, tunggu satu tick watchdog, dan buktikan
delivery-nya tetap sampai `RETURNING` — dengan log `watchdog: reconciled stranded ...`.

---

### 7.12 Delivery terjadwal & berulang: cursor CAS, at-most-once, dan jebakan WIB

Tiga pelajaran berbeda menumpuk di sini, dan ketiganya berdiri sendiri.

**(a) Urutan operasi adalah desain, bukan selera.** Saat jendela pickup sebuah delivery `SCHEDULED`
tiba, job kickoff harus melakukan tiga hal: menjalankan pre-flight check, mengklaim pesawat,
meng-enqueue job siklus hidup, lalu CAS `SCHEDULED → PENDING`. Urutannya punya **dua** batasan yang
masing-masing punya alasan:

- *Enqueue sebelum CAS.* `startSimulation` idempoten (jobId deterministik), jadi kegagalan enqueue
  bisa di-retry. Kalau CAS duluan, retry-nya akan no-op — transisi sudah terpakai — dan job siklus
  hidupnya **tidak pernah masuk**, *"stranding the delivery forever."*
- *Klaim sebelum CAS, lepas kalau CAS kalah.* Klaim pesawat commit di baris terpisah yang tidak ikut
  rollback bersama apa pun. Kalau delivery-nya dibatalkan saat pre-flight berjalan, CAS-nya tidak
  cocok dan pesawat harus dikembalikan **eksplisit**.

**(b) Kegagalan ambigu harus dipilih arah amannya.** Ini bagian terbaik dari seluruh file. Promise yang
reject **bukan bukti** statement tidak commit — bisa saja transaksinya commit lalu koneksinya putus
saat mengirim balasan. Kalau kamu melepas pesawat secara buta di `catch`, kamu mengubah **kebocoran**
(yang bisa dipulihkan operator, dan yang klaim re-entrant-nya bahkan akan pungut kembali sendiri saat
retry) menjadi **double-booking** (yang tidak bisa dipulihkan). Aturannya: *"release only on PROOF the
transition did not happen"* — baca ulang status, dan lepas hanya kalau ia masih `SCHEDULED`.

**(c) At-most-once vs at-least-once adalah pilihan bisnis, bukan pilihan teknis.** Materializer jadwal
berulang memajukan cursor `nextRunAt` **sebelum** memanggil `create()`. Kenapa? Karena `create()`
non-idempoten — ia menerbitkan `trackingId` baru dan intent Stripe baru. Kalau proses mati di antara
keduanya, satu occurrence **hilang**, dan itu dipilih sadar: *"a failure/crash here skips this one
occurrence rather than risking a duplicate on a retry."*

Bandingkan dengan queue di Fase 6 yang memilih **at-least-once**. Itu kebalikannya, dan keduanya
benar — karena handler queue idempoten (CAS-based), sedangkan `create()` tidak. Prinsipnya: pilih
arah kegagalan berdasarkan mana yang lebih murah dimaafkan bisnis. Kehilangan satu pengiriman
terjadwal < menagih customer dua kali.

Cursor-nya sendiri dijaga CAS: `where: { id, active: true, nextRunAt: cursor }`. Kalau dua worker
berlomba, hanya satu yang cocok. Dan occurrence yang terlewat (misalnya sistem mati tiga hari)
di-*collapse* jadi satu lompatan ke occurrence masa depan berikutnya, bukan tiga delivery sekaligus.

**Jebakan zona waktu**-nya juga bukan main-main, dan ini yang akan menggigitmu kalau kamu terbiasa
`new Date(string)`. String `"2026-06-30"` mem-parse ke UTC midnight, yang di WIB adalah pukul **07:00
pagi** — jadi ia **bukan** awal hari WIB. Kalau `startDate` di-anchor ke UTC midnight, occurrence
antara 00:00 dan 07:00 WIB di hari pertama akan hilang. Repo mengatasinya dengan meng-anchor kedua
batas ke hari WIB (`recurrence.ts:75-79`), dan dengan trik "noon-anchored UTC" untuk menghitung hari
dalam seminggu: tanggal yang dibangun pada 12:00 UTC jauh dari batas midnight mana pun, jadi
`getUTCDay()` membaca hari yang sama dengan kalender WIB.

**Anchor:**
- `src/deliveries/deliveries.service.ts:257-268` — keputusan `SCHEDULED` vs `PENDING`
  (`SCHEDULE_THRESHOLD_MS`, `MAX_SCHEDULE_DAYS`).
- `src/deliveries/delivery-schedule.ts:53` `SCHEDULE_THRESHOLD_MS = 60_000` (dan alasannya: menyerap
  clock skew antara api dan worker) · `:57` `MAX_SCHEDULE_DAYS = 60`.
- `src/deliveries/delivery-schedule.ts:85-109` `tzOffsetMs` · `:111-126` `zonedWallClockToUtc`,
  termasuk pengakuan jujur bahwa ia bisa meleset satu jam di dekat transisi DST (dan kenapa itu
  diterima untuk WIB).
- `src/deliveries/simulation/simulation.processor.ts:87-111` — JSDoc `handleKickoff`: dua batasan
  urutan beserta alasan masing-masing.
- `src/deliveries/simulation/simulation.processor.ts:187-220` — `catch` di sekitar CAS kickoff:
  kapan boleh melepas pesawat dan kapan tidak boleh.
- `src/recurring-deliveries/recurring.materializer.ts:83-88` — CAS atas cursor waktu.
- `src/recurring-deliveries/recurring.materializer.ts:76-81` — collapse occurrence yang terlewat.
- `src/recurring-deliveries/recurring.materializer.ts:100-103` — strategi at-most-once dan alasannya.
- `src/recurring-deliveries/recurrence.ts:50-61` — JSDoc `computeNextOccurrence`, termasuk trik
  noon-anchored; `:62` fungsinya; `:75-79` — anchor `startDate`/`endDate` ke hari WIB.
- `src/dispatch/dispatch.service.ts:89-104` — kenapa delivery terjadwal **tidak** mengklaim pesawat
  saat create: *"You do not hold an airframe out of service for three weeks."*

**Kenapa dipakai di sini:** karena waktu adalah satu-satunya input yang tidak bisa kamu mock di
produksi. Setiap keputusan di sini adalah tentang apa yang terjadi ketika proses mati **di tengah**
sesuatu yang punya tenggat. Dan zona waktu adalah tempat di mana kode yang "jalan di laptopku"
paling sering berbeda dengan kode yang jalan di server ber-`TZ=UTC`.

**Alternatif:**
- **`node-cron` per schedule di memori** — sederhana, tidak butuh tabel cursor. Trade-off konkret:
  N replika = N eksekusi untuk jadwal yang sama (tiga pod = tiga delivery per occurrence), dan semua
  jadwal hilang saat restart sampai ada yang memuatnya ulang.
- **`RRULE` (RFC 5545) via `rrule.js`** — mendukung recurrence rumit: bulanan, "Senin ke-3",
  pengecualian tanggal, dan format yang sudah dipahami kalender. Trade-off konkret: repo hanya butuh
  `DAILY`/`WEEKLY`, dan perilaku zona waktu `rrule.js` (yang bekerja dalam "floating time" kecuali
  kamu memasang plugin) adalah lapisan kompleksitas baru tepat di area yang paling rawan bug di sini.
  Implementasi sendiri membuat perilaku WIB-nya eksplisit dan bisa diuji baris per baris.
- **`TIMESTAMPTZ` + `AT TIME ZONE` di SQL** — biarkan Postgres yang mengurus kalender; ia benar dan
  tahu tabel zona waktu. Trade-off konkret: logika kalender tersebar ke query, sehingga
  `computeNextOccurrence` tidak bisa lagi diuji sebagai fungsi murni — dan `delivery-schedule.ts`
  yang hari ini dipakai bersama oleh jalur terjadwal **dan** berulang harus dipecah dua.
- **At-least-once + idempotency key pada `create()`** (misalnya `recurringId + occurrenceISO` sebagai
  unique) — tidak ada occurrence yang hilang **dan** tidak ada duplikat. Ini peningkatan nyata yang
  mungkin. Trade-off konkret: satu kolom + satu indeks unik baru pada tabel yang **dipartisi** (jadi
  unique global butuh registry terpisah, persis seperti `TrackingIdRegistry` di Fase 6), plus
  penanganan `P2002` sebagai sukses di materializer.

**Latihan:** Buat recurring schedule `WEEKLY`, `daysOfWeek: [1]` (Senin), `timeOfDay: "23:30"`. Tulis
tes di `src/recurring-deliveries/recurrence.spec.ts` yang memanggil `computeNextOccurrence` dengan
`TZ=UTC` dan `NOTIFICATIONS_TZ=Asia/Jakarta`, dan buktikan hasilnya adalah Senin **menurut kalender
WIB** — bukan Selasa UTC. Verifikasi kedua: buat schedule yang `nextRunAt`-nya sudah lewat 3 hari,
jalankan materializer, dan buktikan hanya **satu** lompatan cursor yang terjadi (bukan tiga delivery
sekaligus). Verifikasi ketiga (mutasi): pindahkan `await this.createInstance(...)` ke **sebelum** CAS
cursor di `:84-87`, jalankan `recurring.materializer.spec.ts`, dan catat apa yang berubah — lalu tulis
kalimat yang menjelaskan kenapa urutan aslinya adalah pilihan bisnis.

---

### 7.13 Config jadi data: airspace zones di tabel

Ini konsep terbaru di repo (Fase 12 increment 5 menurut penomoran internal repo), dan ia adalah studi
kasus lengkap tentang **kapan sebuah konstanta harus menjadi baris database**.

Dulu, zona terlarang adalah dua lingkaran hardcoded di `serviceability.constants.ts`. Masalahnya
ditulis di spec desainnya dengan tiga poin: tidak ada dimensi ketinggian, tidak ada dimensi waktu
(TFR untuk sebuah acara atau insiden tidak bisa diekspresikan sama sekali), dan **tidak ada cara
mengubahnya tanpa deploy**. Kalimat pemutusnya ada di tabel keputusan: *"A no-fly zone that needs a
deploy is not data."*

Yang menarik bukan migrasinya ke tabel — itu bagian yang mudah. Yang menarik adalah **tiga keputusan
turunan** yang muncul karenanya, dan ketiganya adalah pelajaran yang bisa kamu bawa ke fitur lain.

**Keputusan 1: `active` terpisah dari jendela waktu.** Sebuah zona punya `activeFrom`/`activeUntil`
(kapan ia berlaku) **dan** `active` (saklar operator). Keduanya sengaja tidak digabung, karena
operator butuh dua hal berbeda: mematikan zona **sekarang** tanpa mengedit tanggalnya, dan
mempersiapkan TFR masa depan tanpa ia langsung hidup. `isZoneInForce(zone, now)` adalah **satu**
definisi "sedang berlaku" yang menggabungkan keduanya — dan sengaja diekspor karena dua permukaan
menjawab pertanyaan yang sama: `AirspaceService` (yang memutuskan rute diblokir atau tidak) dan
`AdminService.listAirspaceZones` (yang melaporkan `inForce` ke konsol operator). Komentarnya:
*"A console showing protection that the router is not applying — or the reverse — is worse than no
console field at all."*

**Keputusan 2: cache menyimpan ROWS, bukan JAWABAN.** Ini bug yang sudah pernah ada dan sudah
diperbaiki, dan ia layak dibaca dua kali. Serviceability berjalan di setiap quote, jadi ada cache TTL
30 detik. Kalau yang di-cache adalah hasil filter "sedang berlaku", maka jendela waktunya dievaluasi
sekali per pengisian cache — sehingga TFR yang dijadwalkan mulai berlaku pukul 14:00 **baru berlaku
setelah TTL habis**, di setiap instance, termasuk instance yang membuatnya. Komentarnya:
*"That was the only fail-open window in a service written to fail closed."* Perbaikannya: filter
dijalankan **setelah** cache, terhadap `now` milik pemanggil. TTL sekarang hanya membatasi visibilitas
**tulisan**, bukan mengaburkan **jam**.

**Keputusan 3: DELETE adalah deaktivasi, bukan penghapusan baris.** Route `DELETE /admin/airspace/:id`
menulis `active: false` dan mengembalikan **200 dengan baris yang sudah dinonaktifkan**, bukan 204.
Alasannya: *"a zone that once existed is part of the record of why a past delivery was refused, and
hard-deleting it makes that refusal unexplainable afterwards."* Ini adalah pola yang berulang di
seluruh repo — data yang menjelaskan keputusan masa lalu tidak boleh dihapus.

Ada satu bug asli di area ini yang sangat instruktif dan baru ditutup. `assertZoneBounds` menolak
jendela terbalik hanya kalau **kedua** batas ada. Bandara yang di-seed menyimpan `activeFrom: null`,
jadi satu `PATCH {"activeUntil":"2020-01-01T00:00:00Z"}` diterima dengan 200 — dan Soekarno-Hatta
keluar dari kekuatan hukum pada refresh cache berikutnya, sementara `GET /admin/airspace` masih
melaporkan `active: true`. Satu PATCH, satu bandara tidak lagi terlindungi, tidak ada satu pun tes
yang menangkapnya. Perbaikannya juga mengajarkan sesuatu: validasi dijalankan terhadap **nilai
gabungan** (patch + baris tersimpan), bukan terhadap patch saja.

**Anchor:**
- `docs/superpowers/specs/2026-08-02-airspace-as-data-design.md:22-31` — tabel keputusan: geometri,
  ketinggian, mode kegagalan, caching, permukaan admin, seeding. Baca kolom "Why".
- `docs/superpowers/specs/2026-08-02-airspace-as-data-design.md:57-58` — kenapa `active` terpisah dari
  jendela waktu; `:60-70` — "the altitude honesty problem": ketinggian dimodelkan tapi sengaja tidak
  menggerbangi planning, karena quote tidak punya ketinggian.
- `src/serviceability/airspace.service.ts:15-22` — JSDoc kelas: service ini **tidak** memutuskan apa
  arti kegagalan; ia melempar, dan pemanggilnya yang berkebijakan.
- `src/serviceability/airspace.service.ts:26-29` dan `:39-52` — cache ROWS bukan JAWABAN, dua kali
  ditulis supaya tidak bisa dilewatkan.
- `src/serviceability/airspace.service.ts:65-75` — cache hanya diisi saat query **resolve**, dan gauge
  metrik hanya di-set di cabang yang sama: *"a confident '0 restricted zones' produced by a DB blip is
  the exact false all-clear the throw above exists to prevent."*
- `src/serviceability/airspace.constants.ts:46-62` — JSDoc `isZoneInForce`: satu predikat, dua
  pemanggil, tanpa drift; `:63` fungsinya.
- `src/serviceability/airspace.constants.ts:1-15` — `AIRSPACE_CACHE_TTL_MAX_MS`: override absurd
  **ditolak**, bukan di-clamp, karena *"clamping would honor half of an override that was plainly a
  mistake."*
- `src/serviceability/serviceability.constants.ts:11-21` — komentar di tempat konstanta lama berdiri,
  yang menjelaskan ke mana ia pindah dan kenapa migration yang men-seed dua bandara itu load-bearing.
- `src/admin/admin.service.ts:750` `listAirspaceZones` (menghitung `inForce`) · `:822-825` validasi
  atas nilai **gabungan** · `:883-894` JSDoc deaktivasi · `:895` `deactivateAirspaceZone`.
- `src/admin/admin.service.ts:1042` — `dropZoneCacheAfterCommit()`, invalidasi setelah setiap tulisan.
- `src/admin/admin.controller.ts:180-182` dan `:208-209` — komentar route: DELETE = deaktivasi, dan
  kenapa 200 bukan 204.

**Kenapa dipakai di sini:** karena ini adalah contoh terbaik di repo tentang perbedaan antara
**konstanta** dan **data**. Bandingkan langsung dengan 7.6: margin keselamatan di `dispatch.constants.ts`
sengaja **tidak** dipindahkan ke DB, dengan alasan tertulis. Zona airspace **dipindahkan**, juga
dengan alasan tertulis. Kriterianya bukan "mana yang lebih fleksibel" melainkan "siapa yang berhak
mengubah ini, dan seberapa cepat mereka membutuhkannya?" Operator butuh mendeklarasikan TFR darurat
dalam hitungan menit; tidak ada yang butuh mengubah fraksi reserve baterai tanpa review.

**Alternatif:**
- **Tetap konstanta + deploy** — nol infrastruktur, dan setiap perubahan lewat code review, tes, dan
  git history. Trade-off konkret: TFR darurat butuh siklus build+release penuh (menit sampai jam),
  yang untuk pembatasan ruang udara adalah jendela di mana pesawat tetap terbang ke sana. Untuk
  bandara permanen ini tidak masalah; untuk insiden ini fatal.
- **File konfigurasi yang di-reload (YAML/JSON + watcher)** — bisa diubah tanpa deploy, dan tetap
  bisa di-diff. Trade-off konkret: file itu harus sampai ke **setiap** replika, jadi kamu butuh
  ConfigMap Kubernetes + rollout, atau volume bersama — dan tidak ada audit trail tentang siapa yang
  mengubahnya. Repo mendapat audit gratis karena setiap tulisan zona co-commit dengan `AdminAuditLog`.
- **Polygon alih-alih lingkaran** — merepresentasikan TFR nyata dengan tepat; TFR sungguhan bukan
  lingkaran. Trade-off konkret: geometri `inCircle`/`routeNearCircle` yang sudah teruji harus diganti
  dengan point-in-polygon + irisan segmen-poligon, yang materially lebih besar dan (kalau lewat
  PostGIS) memindahkan logikanya keluar dari fungsi murni. Spec-nya menyebut himpunan lingkaran
  sebagai aproksimasi yang memadai — keputusan cakupan yang ditulis, bukan kelalaian.
- **Cache dengan invalidasi lewat pub/sub lintas replika** — tulisan langsung terlihat di semua
  instance, tidak perlu menunggu TTL. Trade-off konkret: menambah ketergantungan Redis pada permukaan
  yang **fail-closed**; kalau bus pesan mati, kamu harus memutuskan apakah cache jadi tidak sah
  (semua request gagal) atau tetap dipakai (kembali ke masalah semula). TTL 30 detik memberi jaminan
  yang lebih lemah tapi tanpa mode kegagalan baru.

**Latihan:** Sebagai admin, `POST /api/v1/admin/airspace` sebuah zona radius 5 km di atas koordinat
pickup demomu, dengan `activeFrom` **2 menit ke depan**. Segera coba buat delivery — harus berhasil.
Tunggu 2 menit (jangan restart apa pun, jangan tunggu TTL), coba lagi — harus ditolak `NO_FLY_ZONE`.
Verifikasi: itulah bukti cache menyimpan rows, bukan jawaban. Lalu balik desainnya — pindahkan
`rows.filter(isZoneInForce)` ke **dalam** `fetchActiveRows` dan cache hasil filternya — ulangi
eksperimen, dan catat berapa lama zonanya baru berlaku. Terakhir, `DELETE /api/v1/admin/airspace/:id`
dan verifikasi lewat `GET` bahwa barisnya **masih ada** dengan `active: false`.

---

### 7.14 Alternatif dibandingkan: sidang pendek delapan pilihan

Bagian ini bukan konsep baru — ia adalah tempat kamu mengumpulkan alternatif yang tersebar di 7.1–7.13
menjadi satu tabel yang bisa kamu pertahankan dalam wawancara atau code review. Aku sengaja menuliskan
kolom "kapan ia menang", karena alternatif yang tidak pernah menang bukan alternatif, ia adalah straw
man.

| Alternatif | Menggantikan | Trade-off konkret | Kapan ia justru menang |
|---|---|---|---|
| **XState** | Himpunan status di `delivery-exceptions.ts` (7.1) | Mesin hidup di memori satu proses; tetap butuh CAS di bawahnya untuk menyelesaikan balapan lintas-proses | State machine UI, wizard multi-langkah, atau backend single-writer tanpa balapan — di sana visualisasi dan guard deklaratif adalah keuntungan bersih |
| **Event sourcing** | Kolom `status` + `FlightFrame` (7.1) | Setiap pembacaan status jadi agregasi; `where: { status: { in } }` — primitif konkurensi seluruh repo — kehilangan padanan murah | Domain yang pertanyaan utamanya adalah "bagaimana kita sampai ke sini" (ledger, compliance), bukan "apa keadaannya sekarang" |
| **PostGIS `ST_DWithin`** | `routeNearCircle` manual (7.4) | Benar secara geodesik dan bisa diindeks GiST, tapi mengunci ke ekstensi Postgres dan memindahkan logika keluar dari fungsi murni | Zona poligon, ribuan zona, atau rute lintas benua di mana error proyeksi equirectangular jadi nyata |
| **Tabel reservasi ber-TTL** | `Drone.activeDeliveryId` UNIQUE (7.7) | Butuh sweeper; TTL terlalu pendek = menjual pesawat yang sedang terbang — mengubah bug "bocor" jadi bug "double-booking" | Resource dengan durasi pemakaian yang seragam dan pendek (slot booking, kursi), bukan misi berdurasi variabel |
| **Redis lock per drone** | Klaim CAS di Postgres (7.7) | Kepemilikan jadi tidak durabel; Redis kehilangan key = dua delivery satu pesawat, dan Postgres tidak punya cara tahu | Lock berumur detik untuk koordinasi (leader election, rate limit) di mana kehilangan lock artinya "ulangi", bukan "kehilangan pesawat" |
| **mTLS per perangkat** | Shared key + HMAC (7.10) | Butuh PKI penuh: penerbitan, rotasi, pencabutan, dan client cert yang selamat melewati edge proxy | Armada nyata dengan puluhan perangkat, di mana kunci yang bocor harus bisa dicabut per pesawat |
| **RRULE (RFC 5545)** | `computeNextOccurrence` sendiri (7.12) | Perilaku zona waktu library adalah lapisan baru tepat di area paling rawan bug; repo hanya butuh DAILY/WEEKLY | Begitu produk butuh "Senin ke-3 setiap bulan", pengecualian tanggal, atau interop dengan kalender eksternal |
| **Circuit breaker + stale-while-revalidate** | Fail-closed murni airspace (7.4) | Kamu harus menjawab "seberapa basi masih aman" dengan satu angka, dan angka itu adalah janji keselamatan | Dependensi yang datanya berubah lambat **dan** yang outage-nya sering — di mana menolak semua request lebih merugikan daripada memakai data 5 menit lalu |

**Anchor:** setiap baris tabel punya rujukan di konsep asalnya; yang paling padat untuk dibaca ulang
adalah `src/serviceability/serviceability.service.ts:75-116` (fail-closed vs fail-open),
`src/dispatch/dispatch.service.ts:67-82` (kenapa klaim ada di Postgres), dan
`src/deliveries/telemetry/drone-auth.guard.ts:35-36` (penundaan mTLS yang ditulis sebagai keputusan).

**Kenapa dipakai di sini:** karena kamu meminta "apa alternatifnya" sebagai bagian dari cara belajarmu,
dan satu-satunya cara memverifikasi bahwa kamu benar-benar memahami sebuah alternatif adalah bisa
menyebut **kapan ia menang**. Kalau jawabanmu untuk setiap alternatif adalah "tidak, yang di repo lebih
baik", kamu belum memahami keduanya — kamu sedang membela pilihan yang sudah ada.

**Alternatif:** (untuk bagian ini sendiri) — kamu bisa saja melewatkan sidang ini dan langsung ke
capstone. Trade-off konkret: kamu akan bisa menjalankan sistemnya tapi tidak bisa mempertahankan
desainnya, dan itu persis perbedaan antara mengerjakan tiket dan memimpin keputusan teknis. Alternatif
kedua: menulis satu ADR (Architecture Decision Record) per baris tabel alih-alih tabel tunggal.
Trade-off: lebih lengkap dan lebih mudah dirujuk belakangan, tapi delapan dokumen di minggu terakhir
fase adalah cara efektif untuk tidak menyelesaikan capstone.

**Latihan:** Pilih **dua** baris dari tabel di atas dan tulis masing-masing satu paragraf yang
bentuknya persis seperti komentar-komentar di repo ini: apa yang berubah, cacat apa yang ditutup,
biaya apa yang diterima. Verifikasi: minta seseorang (atau dirimu seminggu kemudian) membaca paragraf
itu tanpa membuka kode dan menjawab "kalau begitu kapan aku harus memilih yang satunya?" Kalau
paragrafmu tidak bisa menjawab itu, ia masih iklan, belum keputusan.

---

## Capstone

Satu penerbangan LIVE dikendalikan sepenuhnya dari terminal. Setiap butir di bawah adalah **perilaku
yang bisa gagal di depan matamu** — bukan pemahaman yang bisa kamu klaim.

**Persiapan**
- [ ] `LIVE_DISPATCH=true` dan `INGEST_API_KEY=dev-key` terpasang; backend menyala; `GET
      /api/v1/health/ready` menjawab 200.
- [ ] Tiga drone di-seed lewat `POST /api/v1/admin/drones` dengan `maxPayloadKg` 1, 5, dan 25 —
      ketiganya `airworthy`, baterai di atas 25%, dan home base di area Bandung
      (`DEFAULT_COORDS` di `simulation.constants.ts`).

**Dispatch**
- [ ] Buat delivery 0.2 kg. Log menampilkan `Dispatched drone <id> for delivery <id>`, dan `<id>`
      itu adalah drone **1 kg** — bukan yang terdekat, bukan yang terbesar.
- [ ] `GET /api/v1/admin/drones` menunjukkan drone 1 kg berstatus `IN_FLIGHT` dengan
      `activeDeliveryId` terisi; dua lainnya masih `AVAILABLE` dengan `activeDeliveryId: null`.
- [ ] Buat delivery kedua 3 kg. Ia mendapat drone **5 kg**. (Kalau ia mendapat drone 25 kg,
      comparator-mu rusak.)

**Telemetri**
- [ ] Kirim frame berurutan `CONFIRMED → ASSIGNED → PICKUP → IN_TRANSIT → ARRIVED` lewat `curl` ke
      `POST /api/v1/ingest/telemetry`. Status delivery berakhir di `AWAITING_HANDOFF`.
- [ ] Kirim ulang frame `PICKUP`. Response `applied: false`, dan `GET /api/v1/deliveries/:id` **tidak**
      mundur.
- [ ] Kirim frame tanpa header `x-ingest-key` → 401. Kirim dengan `droneId` milik drone lain → 403.
- [ ] Tulis satu file `.ts` yang memanggil `telemetry.ingest({ ..., phase: 'DELIVERED' })`, jalankan
      `npx tsc --noEmit`, dan tempel pesan error compiler-nya ke catatanmu.

**Watchdog + refund**
- [ ] Set `WATCHDOG_SCAN_INTERVAL_MS=5000` dan `WATCHDOG_SILENCE_MS=15000`. Terbangkan delivery baru
      sampai `IN_TRANSIT`, lalu **berhenti mengirim frame**.
- [ ] Log menampilkan `watchdog: reaped stuck ...`; status delivery jadi `DELIVERY_FAILED`.
- [ ] Saldo wallet user bertambah (refund berjalan) — verifikasi lewat endpoint wallet, bukan lewat
      asumsi.
- [ ] `GET /api/v1/admin/drones` menunjukkan `activeDeliveryId` kembali `NULL` untuk drone itu, dan
      statusnya `MAINTENANCE` dengan `airworthy: false` (karena lost-comms adalah drone-fault).

**Aturan domain buatan sendiri**
- [ ] Satu aturan domain baru, ditulis sebagai **fungsi murni** di file tanpa import Prisma/Nest,
      dengan spec-nya sendiri. Contoh yang layak: `requiresColdChain(packageTypes, missionMinutes)`
      yang menolak paket `healthcare` untuk misi di atas N menit, atau
      `nightFlightAllowed(nowWib, zoneKinds)`.
- [ ] Spec-nya punya minimal satu kasus batas yang **gagal** kalau kamu balik satu operator
      perbandingan. Buktikan dengan membalikkannya, menjalankan tes, lalu mengembalikannya.

**Jawaban tertulis**
- [ ] Satu paragraf: dua mock yang sama-sama melempar error — `airspace.inForceZones()` dan
      `weather.getConditions()` — menghasilkan dua jawaban berlawanan. Kenapa? Jawaban yang hanya
      mengulang "yang satu hard yang satu soft" tidak lulus; jawaban yang lulus menyebut **informasi
      apa yang hilang** pada masing-masing kegagalan dan **apa konsekuensi fisik** dari menebak salah.
- [ ] Satu entri bergaya `AUDIT-LOG.md`: apa yang kamu ubah minggu ini, cacat apa yang ditutup, harga
      apa yang kamu terima, dan bagian `### Left undone`.

---

## Gerbang keluar

Kalau kamu belum bisa menjawab ini tanpa membuka kode, **jangan lanjut ke Fase 8**. Fase 8 (realtime
sisi server) mengandaikan kamu sudah tahu siapa yang menghitung sebuah update sebelum bertanya siapa
yang memegang socket-nya.

**1. `AWAITING_HANDOFF` ada di `FAILABLE_STATUSES` tapi sengaja dikecualikan dari query kandidat
watchdog. Apa akibatnya, dan bagaimana repo menutupnya?**

<details><summary>Jawaban</summary>

CAS-nya lebih **lebar** daripada query yang memilih barisnya. Delivery yang naik ke `AWAITING_HANDOFF`
di tengah scan tetap cocok dengan CAS dan di-fail + di-refund — padahal drone yang melayang di depan
pintu bukan "nyangkut", ia menunggu orang. Penutupnya: `failExceptional` menerima parameter
`allowedStatuses`, dan watchdog mengoper himpunannya sendiri yang lebih sempit
(`deliveries.service.ts:1055-1063`). Pelajaran umumnya: kalau query pemilih dan CAS memakai himpunan
yang berbeda, yang lebih lebar akan menang di kondisi balapan.
</details>

**2. Kenapa `RETURNING` tidak melepaskan pesawat, padahal customer sudah di-refund di titik itu?**

<details><summary>Jawaban</summary>

Karena `RETURNING` adalah terminal untuk **uang**, bukan untuk **pesawat**. Drone masih di udara,
membawa paket, terbang pulang. Melepas klaimnya berarti dispatch engine boleh memilihnya untuk booking
baru saat ia masih terbang. Karena itu ada nilai ketiga `STILL_AIRBORNE` yang bukan `ReleaseOutcome`
(`deliveries.service.ts:121-128`), dan pelepasan sesungguhnya terjadi di `completeReturnToBase`
(`:1229`) — dengan `GROUND_FOR_INSPECTION`, bukan `RETURN_TO_FLEET`.
</details>

**3. Sebutkan dua jalur ke `create()` yang tidak pernah melewati `ValidationPipe`, dan satu invariant
yang akan bocor kalau kamu hanya menaruhnya di DTO.**

<details><summary>Jawaban</summary>

`reorder()` (`deliveries.service.ts:1391`) dan `RecurringMaterializer.toCreateDto()`
(`recurring.materializer.ts:140`) — ditambah favorite-order. Ketiganya membangun `CreateDeliveryDto`
sebagai object literal di dalam proses. Invariant yang bocor: batas berat per ukuran paket
(`assertWeightWithinCap`) — yang dulu memang bocor, karena satu-satunya penegakannya adalah validator
react-hook-form di aplikasi mobile. Pembagian yang benar: **bentuk** di DTO (`@IsIn`, `@Matches`),
**invariant domain** di service.
</details>

**4. Kenapa `phase: 'DELIVERED'` mustahil, dan di lapisan mana kemustahilan itu ditegakkan?**

<details><summary>Jawaban</summary>

Di lapisan **tipe dan bentuk data**, bukan di lapisan pengecekan. `DronePhase` adalah union tertutup
dari 8 string yang tidak memuat `'DELIVERED'` (`telemetry.constants.ts:11-25`), dan
`PHASE_TO_STATUS: Record<HappyPhase, DeliveryStatus>` tidak punya satu pun entri yang menghasilkan
`DeliveryStatus.DELIVERED` (`:36-42`). Jadi TypeScript menolaknya saat kompilasi, dan DTO menolaknya
di boundary HTTP. `DELIVERED` hanya bisa dicapai lewat OTP penerima di `confirmHandoff`. Bandingkan
dengan pendekatan `if (phase === 'DELIVERED') throw` — yang bisa lupa diperbarui saat ada phase baru.
</details>

**5. Cache airspace menyimpan rows, bukan jawaban. Bug apa yang dicegah, dan apa yang **tetap**
dibatasi TTL?**

<details><summary>Jawaban</summary>

Dicegah: TFR yang dijadwalkan mulai berlaku pukul 14:00 baru benar-benar memblokir setelah TTL habis
di setiap instance — satu-satunya jendela fail-**open** di service yang ditulis untuk fail-closed.
Karena filter `isZoneInForce` dijalankan **setelah** cache terhadap `now` milik pemanggil, zona yang
masuk masa berlaku langsung berlaku di panggilan berikutnya tanpa re-read. Yang **tetap** dibatasi
TTL: visibilitas **tulisan** — zona baru yang dibuat di replika A butuh sampai 30 detik untuk terlihat
di replika B (replika A sendiri langsung, karena `dropZoneCacheAfterCommit`).
</details>

**6. Materializer berulang memilih at-most-once, queue BullMQ memilih at-least-once. Keduanya benar.
Apa yang membedakan?**

<details><summary>Jawaban</summary>

Idempotensi handler-nya. Handler job simulasi berbasis CAS monoton, jadi menjalankannya dua kali
adalah no-op — aman memilih at-least-once. `create()` **tidak** idempoten: ia menerbitkan `trackingId`
baru dan payment intent baru, jadi menjalankannya dua kali berarti menagih customer dua kali.
Materializer karena itu memajukan cursor **sebelum** `create()` (`recurring.materializer.ts:100-103`):
crash di titik itu melewatkan satu occurrence, bukan menduplikasi satu tagihan. Aturannya: pilih arah
kegagalan berdasarkan mana yang lebih murah dimaafkan bisnis, bukan berdasarkan mana yang lebih rapi.
</details>

**7. Di `handleKickoff`, promise transaksi reject. Kenapa melepas pesawat secara buta itu salah?**

<details><summary>Jawaban</summary>

Karena promise yang reject **bukan bukti** statement tidak commit — transaksi bisa saja commit lalu
koneksinya gagal saat mengirim balasan. Kalau transisinya ternyata mendarat, delivery-nya `PENDING`
dan terikat pesawat itu; melepasnya berarti menyerahkan pesawat yang sebentar lagi terbang ke pool.
Aturannya (`simulation.processor.ts:201`): *release only on PROOF the transition did not happen* —
baca ulang statusnya, lepas hanya kalau ia masih `SCHEDULED`. Prinsip umumnya: kebocoran bisa
dipulihkan operator (dan klaim re-entrant akan memungutnya kembali saat retry); double-booking tidak
bisa.
</details>

**8. Kenapa margin keselamatan dispatch tetap konstanta sementara zona airspace jadi baris database?**

<details><summary>Jawaban</summary>

Kriterianya bukan fleksibilitas melainkan **siapa yang berhak mengubahnya dan seberapa cepat mereka
butuh**. Operator butuh mendeklarasikan TFR darurat dalam hitungan menit, dan zona adalah data
operasional yang berubah — jadi ia jadi tabel, dengan audit dan invalidasi cache. `RANGE_RESERVE_FRACTION`
dan kawan-kawan adalah margin **fisika** yang tidak seharusnya berubah tanpa review; menaruhnya di DB
berarti ada yang bisa mengetik `0` pukul dua pagi tanpa satu pun mata melihat
(`dispatch.constants.ts:1-5`).
</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| Kamu bisa mengikuti setiap file, tapi tidak bisa memprediksi apa yang terjadi kalau dua hal berjalan bersamaan | Kamu masih membaca transisi status sebagai **penugasan** (`setState`), bukan sebagai **balapan**. Ini adalah satu-satunya blocker sejati fase ini | Ambil satu transisi mana pun dan jawab dua pertanyaan berturut-turut: (1) siapa saja yang bisa memicunya? (2) apa yang terjadi pada **pesawat fisik** kalau transisi ini kalah? Tiga bug asli di `deliveries.service.ts` (`:1497`, `:1294`, `:1156`) semuanya lahir dari melewatkan pertanyaan kedua |
| Test-mu hijau tapi kamu tidak yakin apa yang ia buktikan | Kamu menguji lewat jalur yang salah — misalnya memvalidasi lewat controller (yang punya ValidationPipe) padahal yang ingin kamu buktikan adalah invariant service | Rusak kodenya. Hapus baris assert yang sedang kamu uji dan jalankan lagi. Kalau tetap hijau, tes itu tidak menguji apa yang kamu kira. Ini metode wajib mulai fase ini |
| Delivery LIVE-mu tidak bergerak sama sekali walau frame terkirim dan dijawab 200 | `applied: false` — frame diterima tapi tidak diterapkan. Tiga sebab paling umum, berurutan: `trackingSource` bukan `LIVE` (403), `assignedDroneId` tidak cocok (403), atau phase yang kamu kirim tidak "lebih maju" dari status sekarang (200 tapi no-op) | Baca body response, bukan status code-nya saja. Lalu `GET /api/v1/deliveries/:id` dan bandingkan `status` sekarang dengan `statusesBefore(PHASE_TO_STATUS[phase])` — CAS-nya cocok nol baris kalau statusnya tidak ada di himpunan itu |
| Armada habis padahal cuma beberapa delivery selesai | Ada jalur terminal yang tidak melepaskan klaim. Ini bug nomor satu di area dispatch dan sudah pernah terjadi di jalur **sukses** | `SELECT id, serial, status, "activeDeliveryId" FROM drones WHERE "activeDeliveryId" IS NOT NULL;` lalu cek status tiap delivery yang disebut. Kalau ada yang sudah terminal, kamu menemukan jalur yang lupa `release()` |
| Watchdog me-reap delivery yang sehat | Sinyal "senyap" yang salah, atau CAS yang lebih lebar dari query kandidat | Cek kolom apa yang di-gate: harus `tracking.updatedAt` (naik tiap frame posisi), bukan `delivery.updatedAt` (hanya naik saat **fase** berubah — penerbangan jarak jauh yang sehat duduk di satu fase bermenit-menit). Gate dan `ORDER BY` **wajib** memakai sinyal yang sama |
| Delivery terjadwal langsung terbang, bukan di jam yang diminta | Format `pickupDate`/`pickupTime` tidak cocok regex, sehingga `computeScheduledFor` mengembalikan `null`, dan `null` berarti "kirim sekarang" — gagal senyap dengan 201 | Ini bug asli: aplikasi mobile sempat mengirim `"Jul 30, 2026"` / `"09:30 AM"`. Uji langsung: `node -e "console.log(/^\d{4}-\d{2}-\d{2}$/.test('Jul 30, 2026'))"`. Lalu cek `delivery-schedule.ts:14-18` |
| Zona airspace baru tidak berpengaruh sampai beberapa puluh detik | Normal — TTL cache 30 detik membatasi visibilitas **tulisan** lintas replika. Yang **tidak** normal adalah zona yang jendela waktunya baru terbuka tapi tidak langsung berlaku | Untuk membedakan keduanya: buat zona dengan `activeFrom` di masa depan dekat. Kalau ia baru berlaku setelah TTL habis, filter-nya sudah pindah ke dalam cache dan kamu sedang melihat satu-satunya jendela fail-open di service fail-closed |
| Ack command menjawab 200 tapi delivery tidak berubah | Ini bukan bug — ack diterima tapi transisinya keburu didahului aktor lain (telemetri atau watchdog). Barisnya dicatat `REJECTED` dengan metrik `superseded`, bukan `acked` | Cek `resultNote` baris command-nya: `'delivery no longer in a commandable state'`. Kalau sudah lewat `COMMAND_RECONCILE_GRACE_MS` dan `appliedTransition` masih `false` **serta** statusnya `ACKED`, barulah itu ack yang stranded — dan watchdog yang seharusnya memperbaikinya |

---

## Bacaan pendamping

Semua di dalam repo, dan semuanya berisi **kenapa**, bukan **apa**:

- `src/deliveries/delivery-exceptions.ts` — 78 baris, seluruh kosakata domain. Cari: kenapa satu status
  bisa masuk himpunan A tapi tidak B.
- `src/dispatch/flight-feasibility.ts` — file terbaik di repo untuk memahami "kenapa keputusan ini
  murni". Cari: kalimat tentang drone yang sampai dropoff tapi tidak bisa pulang.
- `src/serviceability/serviceability.service.ts` — fail-closed dan fail-open dalam satu method. Cari:
  kalimat *"Do not 'fix' this into consistency with weather"* dan blok `OPEN QUESTION` di bawahnya.
- `src/deliveries/telemetry/telemetry.service.ts` — bagaimana produsen kedua masuk tanpa mengubah
  kontrak. Cari: *"reimplements none of them. Safety follows for free."*
- `src/deliveries/telemetry/energy.ts` — 101 baris tentang kenapa satu model energi dipakai dua arah.
  Cari: paragraf tentang dua model yang akhirnya tidak sepakat, dan di mana ketidaksepakatan itu
  ditemukan.
- `docs/superpowers/specs/2026-08-02-airspace-as-data-design.md` — bagaimana sebuah keputusan desain
  ditulis **sebelum** kodenya. Cari: tabel Decisions dan bagian "The altitude honesty problem", yang
  menolak mengklaim lebih dari yang bisa dibuktikan.
- `ARCHITECTURE.md:56` dan `:132` — ringkasan dua paragraf tentang telemetri LIVE dan kanal command,
  dengan penanda ✅/🟡/📐 yang membedakan yang sudah jalan dari yang baru dirancang.
- `AUDIT-LOG.md` — cari entri airspace terbaru. Cari: bagian `### Left undone`, karena membaca apa
  yang **sengaja belum dikerjakan** mengajarkan lebih banyak daripada membaca apa yang selesai.
- `git log --oneline -8` lalu `git show dcf1a13` — commit message tentang satu `PATCH` yang bisa
  mengeluarkan bandara dari perlindungan. Cari: bagaimana penulisnya membagi perbaikan jadi (a) dan
  (b), dan mengoreksi klaim berlebih di `AUDIT-LOG.md` di commit yang sama.

Tautan eksternal, hanya kalau benar-benar perlu:
- [Prisma — Transactions & concurrency](https://www.prisma.io/docs/orm/prisma-client/queries/transactions) —
  untuk memastikan pemahamanmu tentang apa yang `updateMany` jamin dan tidak jamin.
- [PostgreSQL — Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) —
  bab Read Committed, kalau pertanyaan "kenapa read-then-CAS bukan jaminan" masih mengganjal.

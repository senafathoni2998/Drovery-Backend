# Fase 5 — Konkurensi dan uang: database yang memutuskan siapa menang

> **Durasi** ~3,5 minggu (~45 jam) · **Mode** bedah · **Repo** `Drovery_Backend` (`src/wallet`, `src/promo`, `src/payments`, `src/stripe`, `src/outbox`, `src/deliveries`, `src/prisma`, `src/cache`, `src/admin/audit`, `src/auth`, `AUDIT-LOG.md`)

> Semua anchor di dokumen ini merujuk ke tag git `curriculum-baseline`. Sebelum mulai:
> `git -C Drovery_Backend checkout curriculum-baseline` (atau `git switch -c fase-05 curriculum-baseline`).
> Mulai fase ini kamu akan mengubah repo, jadi nomor baris akan bergeser — itu wajar; yang tidak boleh
> bergeser adalah pemahamanmu tentang *kenapa* baris itu ada.

---

## Kenapa fase ini ada di sini

Sampai Fase 4 kamu selalu jadi satu-satunya penulis. Di React, `setState('IN_TRANSIT')` selalu berhasil:
tidak ada proses lain yang berebut variabel itu, dan kalau kamu lupa membersihkan sesuatu, paling buruk
komponen re-render. Di Fase 3 kamu belajar transaksi — "semua berhasil atau tidak ada yang terjadi" —
tapi transaksi hanya menjawab pertanyaan *atomicity*, bukan pertanyaan *siapa yang menang*. Kamu bisa
membungkus `read` lalu `write` dalam satu `$transaction` dan tetap kehilangan balapan, karena di
isolation level default PostgreSQL (Read Committed) `SELECT`-mu memotret keadaan **saat itu**, dan
keadaan itu sudah basi ketika `UPDATE`-mu jalan.

Fase ini datang tepat setelah Fase 3 dan 4 karena ia butuh dua hal yang baru saja kamu punya, dan tidak
lebih: transaksi (Fase 3) dan constraint unik sebagai aturan yang dipaksakan database (Fase 3). Arahnya
memang begitu — CAS butuh transaksi, transaksi tidak butuh CAS. Sebaliknya, hampir semua yang datang
sesudahnya butuh fase ini. Worker BullMQ di Fase 6 aman di-retry hanya kalau handler-nya idempoten;
"retry aman" tanpa idempotensi adalah dusta yang dicetak di README. Domain penerbangan di Fase 7 penuh
transisi status yang diperebutkan empat aktor sekaligus (worker simulasi, telemetri drone, watchdog,
admin). Realtime di Fase 8 mengirim status yang dihitung salah satu pemenang balapan itu. Kalau Fase 5
tidak mendarat, semua fase sesudahnya berubah jadi menyalin pola tanpa tahu apa yang dilindunginya.

Ada satu hal lagi yang mustahil dipahami tanpa fase ini: **kenapa repo ini bentuknya begitu.** Kalau
kamu membuka `deliveries.service.ts` hari ini tanpa model mental CAS, kamu akan melihat `updateMany`
di tempat yang "seharusnya" `update`, dua `updateMany` berturut-turut yang kelihatan duplikat, kunci
string aneh seperti `debit:<id>`, tabel bernama `webhook_events` yang isinya cuma id dan tipe, dan
sebuah "orphan reaper" yang menyapu uang nyangkut setiap beberapa menit. Semuanya kelihatan seperti
over-engineering. Setelah fase ini, tiap satu di antaranya adalah jawaban atas satu pertanyaan yang
sangat spesifik, dan hampir semuanya lahir dari bug nyata yang tercatat di komentar kodenya sendiri.

Terakhir, alasan jujur kenapa fase ini paling panjang dan paling berat: ini **lompatan model mental
terbesar seluruh kurikulum**. Bukan NestJS, bukan Kubernetes. Peta konsep `be-domain.md` menuliskannya
di bagian "yang paling mungkin membuatmu tersangkut": *"Bahwa transisi status adalah balapan, bukan
penugasan"*. Kalau di minggu kedua kamu masih merasa `if (delivery.status === 'PENDING')` itu masuk
akal, jangan lanjut — ulangi latihan dua-sesi `psql` di 5.2 sampai kamu bisa memprediksi outputnya
sebelum menekan Enter.

---

## Gerbang masuk

Kamu siap masuk fase ini kalau bisa:

- [ ] Menulis `await prisma.$transaction(async (tx) => { ... })` dan menjelaskan kenapa memakai
      `this.prisma` (bukan `tx`) di dalam callback itu adalah bug hening — lalu membuktikannya dengan
      satu `throw` di tengah transaksi dan mengecek di `psql` baris mana yang selamat.
- [ ] Membuka `prisma/schema.prisma:228` dan menjelaskan, tanpa membaca komentarnya, apa yang terjadi
      kalau dua request bersamaan mencoba menulis `activeDeliveryId` yang sama.
- [ ] Menjalankan `npm test` di `Drovery_Backend` sampai hijau, dan menyebut satu file `*.spec.ts`
      yang test-nya memakai mock Prisma (bukan database sungguhan).
- [ ] Membaca `AllExceptionsFilter` dan menjelaskan jalur sebuah `AppConflictException` dari service
      sampai jadi JSON HTTP 409 ber-`messageKey`.
- [ ] Menjelaskan beda `@unique` di Prisma dengan `if (sudahAda) throw` di service — dan menyebut
      kode error Prisma yang muncul kalau constraint-nya dilanggar.
- [ ] Menjalankan `npx prisma studio`, membuka tabel `wallet_transactions`, dan menunjuk kolom mana
      yang menyimpan saldo setelah transaksi (bukan saldo sekarang).

Kalau salah satu belum bisa, itu bukan aib — itu petunjuk bahwa Fase 3 belum selesai. Kembali dulu.

---

## Peta jalan mingguan

Total ~45 jam. Angka jam di bawah dikalibrasi pada 13 jam/minggu; kalau kamu di 15 jam/minggu, fase ini
selesai dalam 3 minggu penuh.

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| 1 | **Primitifnya.** 5.1 CAS · 5.2 Read Committed · 5.3 kosakata state machine sebagai data | 13 | Dua sesi `psql` yang membuktikan satu `UPDATE 1` dan satu `UPDATE 0` atas saldo yang sama. Satu diagram Mermaid `DeliveryStatus` yang panahnya **diturunkan dari kode**, bukan ditebak. Satu test balapan `cancel()` vs `confirmHandoff()` yang hijau. |
| 2 | **Uang yang tidak boleh dobel.** 5.4 idempotency · 5.5 at-least-once · 5.6 Stripe webhook utuh · 5.7 outbox | 13 | Tabel klasifikasi seluruh `grep -rn "P2002" src/`. Webhook yang dipanggil dua kali dengan id sama dan menjawab `duplicate: true`. Satu event outbox yang kamu paksa duplikasi dan buktikan saldo **tidak** bertambah dua kali. |
| 3 | **Yang bocor keluar transaksi.** 5.8 saga debit-first + reaper · 5.11 audit-in-tx · 5.12 utang rotasi refresh | 13 | Delivery yang gagal setelah debit committed, lalu kamu tunjukkan saldo kembali (kompensasi sinkron) dan — dengan proses dimatikan di tengah — kembali lewat `OrphanReaperService.sweep()`. Satu skenario reuse-detection yang menutup seluruh sesi. |
| 4 (setengah) | **Batas kepercayaan & bukti.** 5.9 read replica · 5.10 cache · 5.13 mutation testing · 5.14 tabel alternatif + capstone | 6 | Laporan mutasi 5 baris + minimal satu test baru yang kamu tulis karena mutasi tidak terbunuh. Satu entri `AUDIT-LOG.md` lengkap dengan `### Left undone`. |

Catatan jujur: minggu 1 sering melar jadi 1,5 minggu. Itu normal dan lebih baik daripada memaksakan
jadwal — sisa fase ini bersandar penuh pada minggu 1.

---

## Konsep

### 5.1 Compare-and-swap: `updateMany` + periksa `count`

Di React kamu punya satu penulis. Analogi terdekat yang jujur sebenarnya bukan dari React, tapi dari
sesuatu yang kamu sudah pakai tanpa menamainya: **optimistic UI dengan rollback**. Kamu kirim aksi,
server yang memutuskan, dan kamu siap membatalkan tampilan kalau ternyata kalah. CAS adalah versi
server-side dari sikap itu — bedanya, di sini "yang memutuskan" adalah PostgreSQL, dan jawabannya
datang sebagai satu angka: berapa baris yang terkena.

Bentuknya selalu sama dan layak kamu hafal sampai jadi refleks:

```ts
const { count } = await prisma.delivery.updateMany({
  where: { id, status: { in: ALLOWED } },   // SELURUH prasyarat masuk ke WHERE
  data:  { status: NEXT },
});
if (count === 0) { /* kalah balapan, atau status sudah berubah */ }
```

Tidak ada `SELECT` dulu. Tidak ada `if` di JavaScript yang memutuskan boleh atau tidak. Prasyaratnya
**ikut turun ke SQL**, jadi tidak ada jendela waktu antara "cek" dan "tulis" yang bisa diselipi aktor
lain. Ini yang membuat `count` bukan sekadar informasi, melainkan **hasil pertandingan**.

Konsekuensi kedua sama pentingnya dengan yang pertama, dan ini yang paling sering dilewatkan orang:
karena `count > 0` hanya terjadi pada **satu** pemanggil, semua efek samping mahal — refund, notifikasi,
pelepasan drone — harus diletakkan **setelah** CAS. Dengan begitu efek itu otomatis terjadi tepat sekali,
tanpa distributed lock apa pun. Balik urutannya, dan kamu punya delivery yang di-refund dua kali.

**Anchor:** `src/deliveries/deliveries.service.ts:876-897` — komentar di `cancel()` adalah post-mortem
paling jelas di repo ini: *"This used to be: read, then three network round-trips of cleanup, then an
UNCONDITIONAL status write — the only transition in this file without a CAS… a lost race both refunded
a delivery that had already completed AND overwrote its terminal status with CANCELED."* Perhatikan
urutannya di `:885-888` (CAS) lalu `:903` (`cleanupAfterTermination`) — cleanup di **bawah**, bukan di atas.
Pasangan bacanya: `src/deliveries/deliveries.service.ts:1482-1502` (`confirmHandoff`: CAS
`AWAITING_HANDOFF → DELIVERED`, lalu `dispatchService.release` yang komentarnya menyebut *"Runs behind
the single-winner CAS, so exactly once"*), dan `src/wallet/wallet.service.ts:65-75` (CAS atas **saldo**,
bukan status: `where: { id, creditBalance: { gte: amt } }`).

**Kenapa dipakai di sini:** karena ada N replica api + M worker, dan tidak ada satu proses pun yang boleh
menganggap hasil `SELECT`-nya masih benar saat ia `UPDATE`. `deliveries.service.ts:880-884` menyebut
persis kenapa read di atas CAS itu hanya *advisory*: *"the delivery can be dispatched, delivered or
failed while those round-trips are in flight"*. CAS muncul di `cancel`, `adminForceCancel`,
`failExceptional`, `confirmHandoff`, klaim drone (`src/dispatch/dispatch.service.ts:229-243`), klaim
outbox (`src/outbox/outbox.service.ts:95-103`), dan penghitung percobaan OTP
(`deliveries.service.ts:1447-1457`). Satu pola, tujuh tempat.

**Alternatif:**
- **`SELECT … FOR UPDATE` (pessimistic lock).** Benar dan paling mudah dinalar — kamu kunci barisnya,
  kerjakan, lepas. Harganya konkret di repo ini: cleanup setelah terminasi melakukan I/O jaringan
  (refund, MQTT, tulis queue), dan `deliveries.service.ts:1104-1105` menyatakan cleanup itu *"deliberately
  OUTSIDE"* transaksi. Dengan `FOR UPDATE` kamu memegang row lock melintasi panggilan Stripe; satu
  timeout Stripe 30 detik = satu baris terkunci 30 detik = pool koneksi habis.
- **Kolom `version` (optimistic locking ala JPA/TypeORM).** Generik, jalan untuk semua tabel. Harganya:
  kamu **wajib** membaca dulu untuk tahu versinya (satu round-trip ekstra per transisi), dan `WHERE
  version = 7` tidak mendokumentasikan apa pun. `WHERE status IN ('PENDING','CONFIRMED','SCHEDULED')`
  sekaligus jadi spesifikasi transisi mana yang legal — dan itu yang dibaca reviewer berikutnya.
- **Redlock (distributed lock di Redis).** Perlu kalau sumber daya yang diperebutkan bukan baris
  database. Harganya: kebenarannya bergantung pada asumsi jam dinding dan pada Redis yang hidup;
  menambah komponen yang bisa gagal untuk melindungi data yang sumber kebenarannya ada di tempat lain.
  Di sini Postgres sudah jadi wasit, jadi memindahkan kunci ke Redis justru menambah mode kegagalan.

**Latihan:** Buka `src/deliveries/deliveries.service.spec.ts` dan cari test yang menyentuh
`confirmHandoff`. Tambahkan satu test baru: panggil
`Promise.all([svc.confirmHandoff(u, id, code), svc.confirmHandoff(u, id, code)])` dengan mock
`delivery.updateMany` mengembalikan `{ count: 1 }` pada panggilan pertama dan `{ count: 0 }` pada kedua.
Buktikan `dispatchService.release` dipanggil **tepat sekali** dan pemanggil kedua menerima
`AppConflictException`. Verifikasi: `npx jest src/deliveries/deliveries.service.spec.ts`. Lalu rusak
kodenya — pindahkan `await this.dispatchService.release(...)` di `:1502` ke **sebelum** blok CAS di
`:1484` — jalankan lagi, dan catat apa yang bocor.

---

### 5.2 Read Committed: kenapa `UPDATE` yang menunggu lock menguji ulang `WHERE`-nya

Tidak ada padanan jujur untuk ini di dunia React/Ionic. Yang paling dekat cuma intuisi salah:
"transaksi = mutex". Bukan. PostgreSQL default berjalan di isolation level **Read Committed**, dan
aturannya begini: setiap *statement* mendapat snapshot baru saat ia mulai. Dua `SELECT` di dalam satu
transaksi yang sama bisa melihat data berbeda kalau di antaranya ada transaksi lain yang commit.

Yang membuat CAS aman justru satu perilaku spesifik Read Committed pada `UPDATE`. Kalau dua transaksi
mencoba meng-`UPDATE` baris yang sama, yang kedua **menggantung** menunggu row lock yang pertama.
Setelah yang pertama commit, yang kedua tidak langsung menulis: ia **membaca ulang** baris itu versi
terbaru, lalu **menguji ulang klausa `WHERE`-nya** terhadap nilai baru itu. Kalau `WHERE`-nya tidak lagi
cocok, ia melaporkan `UPDATE 0`. Di situlah `count === 0` lahir.

Kalimat paling ringkas soal ini di seluruh repo ada di outbox — dan bukan kebetulan, karena di sanalah
dua worker benar-benar berebut baris yang sama tiap 5 detik.

**Anchor:** `src/outbox/outbox.service.ts:85-93` — *"The claim is a conditional UPDATE
(PENDING→PROCESSING, attempts++) — under **Read Committed** a second concurrent worker re-evaluates the
predicate after the first commits, sees PROCESSING, and matches 0 rows, so exactly one worker owns each
row (no double-dispatch)."* Pasangannya adalah pengakuan jujur di
`src/deliveries/deliveries.service.ts:1079-1084`: baca-lalu-CAS **bukan** jaminan atomik —
*"a telemetry commit landing between the SELECT and the UPDATE would have the audit row say
DRONE_ASSIGNED while the CAS actually fired from PICKUP_IN_PROGRESS. Sub-millisecond window, and not
worth a FOR UPDATE lock on this path — but it is a read-then-CAS, not a guarantee."*

**Kenapa dipakai di sini:** repo ini nyaris tidak pernah menaikkan isolation level dan nyaris tidak
pernah memakai lock eksplisit. Keduanya adalah keputusan yang bisa diambil **hanya kalau** kamu tahu
persis apa yang dijamin Read Committed dan apa yang tidak. Yang dijamin: satu `UPDATE` dengan prasyarat
di `WHERE` punya tepat satu pemenang. Yang tidak dijamin: `SELECT` lalu `UPDATE` sebagai dua statement,
bahkan di dalam satu transaksi.

**Alternatif:**
- **`SERIALIZABLE`.** Database mendeteksi konflik dan membatalkan salah satu transaksi (Prisma
  memunculkannya sebagai `P2034`; Postgres sebagai `40001`). Kamu tidak perlu menulis CAS sama sekali.
  Harganya dua: kamu **wajib** menulis loop retry di aplikasi (dan menguji loop itu), dan throughput
  turun saat kontensi tinggi karena abort-rate naik. Ada harga ketiga yang spesifik untuk repo ini —
  PgBouncer dalam mode `transaction` (rencananya di depan Postgres, lihat `prisma.service.ts:31-32`)
  membuat asumsi sesi jadi rumit.
- **`REPEATABLE READ`.** Snapshot konsisten sepanjang transaksi, jadi laporan multi-query tidak
  "bergerak" di tengah. Harganya: `UPDATE` atas baris yang berubah sejak snapshot langsung gagal dengan
  *"could not serialize access"* — jadi kamu tetap butuh retry, tanpa mendapat perlindungan penuh
  `SERIALIZABLE`.
- **Advisory lock Postgres (`pg_advisory_xact_lock`).** Kunci bernama, di dalam database yang sama, tanpa
  kolom tambahan. Harganya: kuncinya tidak berhubungan dengan baris mana pun, jadi tidak ada yang
  mencegah jalur kode ketiga menulis tanpa mengambil kunci itu — perlindungannya bersifat konvensi,
  sedangkan `WHERE` di CAS bersifat struktural.

**Latihan:** Buka **dua** terminal `psql` ke database dev. Ambil satu user dan set saldonya persis 10.
Sesi A: `BEGIN; UPDATE users SET "creditBalance" = "creditBalance" - 10 WHERE id='<id>' AND
"creditBalance" >= 10;` — **jangan commit**. Sesi B: jalankan perintah yang persis sama, dan amati ia
menggantung. Sekarang `COMMIT;` di A, lalu lihat B. Prediksi dulu sebelum melihat: `UPDATE 1` atau
`UPDATE 0`? Ulangi eksperimen dengan `ROLLBACK;` di A dan jelaskan kenapa hasil B berbeda. Verifikasi
akhir: `SELECT "creditBalance" FROM users WHERE id='<id>';` harus 0, tidak pernah −10.

---

### 5.3 Kosakata state machine sebagai DATA

Di frontend kamu terbiasa menaruh aturan status di `if`. Di sini aturannya ditaruh di **bentuk data**:
beberapa array konstanta yang tiap satunya menjawab satu pertanyaan berbeda tentang status yang sama.
Padanan terdekat yang kamu punya: `const ROUTES = [...]` yang dipakai sekaligus untuk render menu dan
untuk guard — satu sumber, dua konsumen. Bedanya di sini konsumennya adalah klausa `WHERE` sebuah CAS.

Ada lima himpunan, dan pemisahannya **bukan** berdasarkan kemiripan nama melainkan berdasarkan
pertanyaan yang dijawab:

| Himpunan | Pertanyaan yang dijawab |
|---|---|
| `STATUS_ORDER` | urutan jalur bahagia — "boleh maju dari status mana saja?" |
| `FAILABLE_STATUSES` | "drone sedang terbang" — boleh di-FAIL |
| `TERMINAL_STATUSES` | "sudah selesai" — tidak boleh dibangkitkan lagi |
| `RETURNABLE_STATUSES` | "drone sudah memegang paket" — boleh pulang membawa barang |
| `POSITION_FROZEN_STATUSES` | "marker di peta tidak boleh bergerak lagi" |

Satu status bisa masuk himpunan A tapi tidak B, dan justru di situlah pelajarannya. `RETURNING` ada di
`FAILABLE_STATUSES` (penerbangan pulang yang mati mekanis harus bisa mencapai terminal sungguhan) tapi
**sengaja absen** dari `POSITION_FROZEN_STATUSES` (user harus melihat dronenya terbang pulang).
`DRONE_ASSIGNED` ada di `FAILABLE_STATUSES` tapi tidak di `RETURNABLE_STATUSES` — belum ambil paket,
jadi tidak ada yang perlu dipulangkan.

Bagian paling elegan: status pengecualian sengaja diletakkan **di luar** `STATUS_ORDER`. Karena
`statusesBefore(target)` hanya bisa mengembalikan elemen `STATUS_ORDER`, CAS maju-monoton **secara
matematis tidak mungkin** memasuki `RETURNING`, `DELIVERY_FAILED`, atau `RETURNED_TO_BASE`. Aturan
"jangan pernah menghidupkan kembali delivery yang sudah selesai" tidak dijaga oleh `if` yang tersebar —
ia dijaga oleh bentuk array.

**Anchor:** `src/deliveries/delivery-exceptions.ts:3-9` — *"These statuses are BRANCHES off the linear
happy path and are deliberately OUTSIDE STATUS_ORDER (simulation.constants.ts), so the monotonic forward
CAS can never enter them and a terminal can't be resurrected."* Lalu keempat himpunannya di `:17-23`,
`:28-33`, `:37-41`, `:47-53` — baca komentar di atas masing-masing, tiap satunya menjelaskan sebuah
pengecualian yang tampak sewenang-wenang sampai kamu baca alasannya. Jalur bahagianya di
`src/deliveries/simulation/simulation.constants.ts:13-21` dan fungsi `statusesBefore` di `:24-26`.
Cermin sisi database: `prisma/schema.prisma:251-254` mengulang alasan yang sama di komentar `enum
DeliveryStatus`.

**Kenapa dipakai di sini:** karena satu daftar status yang salah lebar langsung jadi bug uang. Ini bukan
hipotesis — `deliveries.service.ts:1055-1061` mencatatnya: `FAILABLE_STATUSES` memuat `AWAITING_HANDOFF`,
tapi query kandidat watchdog sengaja mengecualikannya (*"a drone hovering at the door is not 'stuck', it
is waiting for a person"*). Karena CAS-nya lebih lebar daripada query yang memilih barisnya, delivery
yang diambil sebagai `IN_TRANSIT` lalu mencapai handoff di tengah sweep tetap lolos CAS dan **di-fail
plus di-refund otomatis** sementara customernya sedang berjalan keluar. Perbaikannya: parameter
`allowedStatuses` supaya query dan CAS memakai satu daftar yang sama.

**Alternatif:**
- **Boolean berlapis (`isDelivered`, `isCanceled`, `isFailed`).** Cara paling umum di app kecil dan
  paling mudah ditulis. Harganya konkret: kombinasi mustahil jadi *representable* (`isDelivered &&
  isCanceled`), dan tidak ada satu tempat pun yang bisa ditanya "status apa saja yang terminal?" —
  `adminForceCancel` (`deliveries.service.ts:978`) bergantung pada `TERMINAL_STATUSES` sebagai daftar
  tunggal dan akan mustahil ditulis benar.
- **Library state machine (XState).** Transisi jadi deklaratif dan bisa divisualisasi otomatis.
  Harganya: mesinnya hidup **di memori proses**, sementara di sini ada 3+ proses yang bersaing atas satu
  baris DB. XState tetap butuh CAS di bawahnya, jadi ia menambah satu lapisan tanpa menghapus masalah
  utamanya.
- **Tabel `delivery_status_transitions` (event sourcing ringan).** Riwayat lengkap gratis, dan
  "siapa mengubah apa kapan" jadi query biasa. Harganya: tiap pembacaan status jadi agregasi, dan CAS
  atas "status sekarang" jadi jauh lebih rumit. Repo ini memilih hybrid — current state di baris,
  `FlightFrame` sebagai append-only log terpisah.

**Latihan:** Buat `docs/state-machine.md` berisi diagram Mermaid `stateDiagram-v2` untuk
`DeliveryStatus`. Turunkan tiap panah **dari kode**, bukan dari tebakan: panah jalur bahagia dari
`STATUS_ORDER`, panah `FAILABLE_STATUSES → DELIVERY_FAILED`, `RETURNABLE_STATUSES → RETURNING →
RETURNED_TO_BASE`, dan `CANCELABLE_STATUSES → CANCELED` (`deliveries.service.ts:103-107`). Verifikasi:
tiap panah harus bisa kamu tunjuk baris kodenya. Lalu jawab tertulis satu pertanyaan — **status mana
yang bisa dimasuki lebih dari satu aktor berbeda?** (petunjuk: `grep -n "DELIVERY_FAILED" src/ -r` dan
hitung pemanggil `failExceptional`).

---

### 5.4 Idempotency: kunci deterministik + `@unique`, dan P2002 sebagai SUKSES

Padanan yang kamu sudah tahu: tombol "Bayar" yang di-double-tap. Di mobile kamu menyelesaikannya dengan
`disabled` state. Itu berhasil karena hanya ada satu tombol di satu perangkat. Begitu pengirimnya adalah
Stripe, BullMQ, atau drone di belakang NAT yang koneksinya putus setelah mengirim tapi sebelum menerima
respons, tidak ada `disabled` yang bisa kamu pasang. Yang tersisa hanya satu strategi: **buat efeknya
tidak berbahaya kalau terjadi dua kali.**

Repo ini melakukannya dengan resep yang sama persis di mana-mana, dan resep itu punya tiga langkah:

1. Buat kunci **deterministik** dari sesuatu yang stabil — bukan `uuid()` baru, bukan timestamp.
2. Taruh `@unique` di atas kolom kuncinya, supaya **database** yang menolak duplikat, bukan `if`.
3. Perlakukan `P2002` (unique violation) sebagai **sukses**, bukan error.

Langkah 3 adalah yang paling melawan naluri. Di frontend, error adalah error. Di sini, `P2002` pada
jalur idempoten berarti "efek ini sudah pernah terjadi" — yang persis hasil yang kamu inginkan.

Daftar kuncinya di repo ini enak dihafal karena polanya seragam: `debit:<deliveryId>`,
`refund:<deliveryId>`, `exception-refund:<deliveryId>`, `referral-referrer:<referralId>`,
`referral-referee:<referralId>`, `outbox-referral:<deliveryId>`. Semuanya berbentuk `<maksud>:<id yang
stabil>`.

Ada satu prasyarat halus yang gampang terlewat: supaya kunci `debit:<deliveryId>` bisa dipakai, `id`
delivery harus sudah diketahui **sebelum** barisnya ada. Karena itu id-nya di-*mint* di aplikasi, bukan
oleh `@default(uuid())` database.

**Anchor:** `prisma/schema.prisma:789` (`idempotencyKey String? @unique // e.g. refund:<deliveryId>,
referral-referrer:<refId>`) dan komentar modelnya di `:773-776`. Sisi kodenya:
`src/wallet/wallet.service.ts:23-24` (kontrak: *"The optional idempotencyKey (unique) makes a retried
reward/refund a no-op via P2002"*), `:139-155` (`refundForDelivery` — `catch` yang mengembalikan
`return` diam-diam pada P2002), dan `src/deliveries/deliveries.service.ts:225-235` — blok komentar
paling padat soal ini: *"minting it HERE makes every money idempotency key (`debit:<id>`, the promo
redemption's `deliveryId`, `refund:<id>`) knowable BEFORE the row exists… Generated ONCE, so it stays
stable across the trackingId-collision retry loop — a re-run can never mint a second id and
double-debit."*

**Kenapa dipakai di sini:** karena uang. `wallet.service.ts:175-186` menunjukkan versi paling ketat dari
ide ini: sebelum meng-kredit balik biaya kartu, ia menjalankan CAS `COMPLETED → REFUNDED` atas baris
`Payment`, dan **hanya kalau CAS itu menang** kreditnya jalan. Komentarnya menyebut dua hal yang
dicegahnya sekaligus: mencetak kredit padahal kartunya tidak pernah ditagih, dan bentrok dengan jalur
refund goodwill admin — *"whichever refunds first flips the row; the other matches 0, so the card charge
returns to the wallet AT MOST ONCE."* Perhatikan urutan yang ditulis eksplisit: *"The status write must
precede the credit so the count===0 short-circuit prevents the credit entirely."*

**Alternatif:**
- **Dedupe di Redis (`SET key NX EX 86400`).** Jauh lebih cepat dan tidak membebani primary database.
  Harganya: Redis bisa kehilangan kunci (eviction saat memori penuh, restart tanpa persistence) → efek
  dobel pada saldo. Untuk apa pun yang menyentuh uang, repo ini konsisten memilih database. Untuk
  dedupe yang efeknya cuma "kirim push notification dua kali", Redis pilihan yang wajar.
- **Tabel dedupe terpusat (satu tabel untuk semua jenis operasi).** Satu tempat untuk dilihat, mudah
  dibersihkan. Harganya dua: satu tabel panas jadi titik kontensi tulis, dan ia tetap **tidak** menutup
  kasus "crash setelah menulis baris dedupe, sebelum efeknya" — kecuali baris dedupe dan efeknya
  co-commit, yang berarti kamu kembali ke desain repo ini.
- **Kunci unik menempel pada baris efeknya (yang dipakai di sini untuk uang internal).** Tidak ada tabel
  tambahan, dan dedupe otomatis co-commit dengan efeknya karena keduanya **baris yang sama**. Harganya:
  hanya bisa dipakai kalau efeknya memang menghasilkan satu baris; untuk webhook eksternal yang efeknya
  adalah `UPDATE`, kamu tetap butuh tabel terpisah (lihat 5.6).

**Latihan:** Jalankan `grep -rn "P2002" src/` dan buat tabel dengan tiga kolom: file:baris ·
diperlakukan sebagai (sukses / retry / 409 ke user) · alasannya satu kalimat. Kamu akan menemukan
ketiganya. Verifikasi pemahamanmu dengan menjelaskan kenapa `src/deliveries/commands/drone-command.service.ts:179-185`
memilih 409 sementara `src/outbox/outbox.service.ts:128-134` memilih sukses, padahal keduanya
`P2002` dari partial-unique index.

---

### 5.5 At-least-once di setiap batas — exactly-once tidak ada

Ini bukan konsep teknis melainkan **sikap**, dan ia mengubah cara kamu membaca semua kode integrasi.
Klaimnya: di sistem terdistribusi, "kirim tepat sekali" tidak bisa dijamin oleh transport mana pun.
Yang bisa dijamin cuma dua ekstrem — *at-most-once* (mungkin hilang) atau *at-least-once* (mungkin
dobel). "Exactly-once" yang dijual broker selalu berarti "at-least-once + dedupe di sisi konsumen",
dan begitu efeknya keluar ke database eksternal, dedupe itu jadi tanggung jawabmu lagi.

Alasan fisiknya sederhana dan layak kamu simpan: pengirim yang tidak menerima ACK tidak bisa
membedakan "pesanku hilang" dari "ACK-nya yang hilang". Satu-satunya pilihan adalah kirim ulang (dobel)
atau menyerah (hilang). Tidak ada opsi ketiga.

Di Drovery, batas-batas ini semuanya at-least-once:

| Batas | Kenapa bisa dobel | Yang membuatnya aman |
|---|---|---|
| Webhook Stripe | Stripe mengirim ulang sampai dapat 2xx, dan bisa **acak urutan** | `WebhookEvent.id` = id event sebagai PK + `ADVANCE_FROM` (5.6) |
| BullMQ job | job di-retry (`attempts`), worker bisa mati setelah kerja sebelum ack | `jobId` deterministik + CAS monoton (Fase 6) |
| Outbox dispatcher | crash antara klaim dan apply; klaim basi di-reap | idempotensi handler-nya sendiri (5.7) |
| Ack drone | perangkat di belakang NAT, koneksi putus setelah ack terkirim | partial-unique "satu perintah terbuka per delivery" → P2002 → 409 |
| Frame telemetri | jaringan seluler, retry klien | CAS monoton + `POSITION_FROZEN_STATUSES` |

Perhatikan pengecualiannya, karena ini yang membuktikan kamu benar-benar paham: materializer recurring
delivery sengaja memilih **at-most-once**. Cursor `nextRunAt` dimajukan **sebelum** `create()`
dipanggil, karena `create()` tidak idempoten (trackingId baru + PaymentIntent baru). Kehilangan satu
pengiriman terjadwal lebih murah daripada menagih customer dua kali. At-least-once vs at-most-once
adalah **keputusan bisnis**, bukan default teknis.

**Anchor:** `src/outbox/outbox.service.ts:30-35` — *"AT-LEAST-ONCE: a handler may run more than once
(crash between claim and apply, a reaped stale claim, etc.), so every handler MUST be idempotent."*
Sisi Stripe: `prisma/schema.prisma:613-617` — *"Stripe delivers webhooks AT-LEAST-ONCE and can reorder
them"*. Sisi drone: `src/deliveries/commands/drone-command.service.ts:179-185`. Angka-angka retry-nya
di `src/outbox/outbox.constants.ts:43` (`OUTBOX_MAX_ATTEMPTS`), `:50` (`OUTBOX_CLAIM_LEASE_MS` —
visibility timeout), `:58` (`OUTBOX_RECOVERY_BACKOFF_MS`), `:67` (`OUTBOX_MAX_RECOVERY_ATTEMPTS`).

**Kenapa dipakai di sini:** karena sekali kamu menerima klaim ini, desain berubah. Kamu berhenti mencari
"transport yang tidak pernah dobel" dan mulai bertanya, untuk tiap handler: *"kalau ini jalan dua kali,
apa yang rusak?"* Kalau jawabannya "tidak ada", selesai. Kalau jawabannya "saldo naik dua kali", kamu
butuh kunci idempoten (5.4) atau CAS (5.1).

**Alternatif:**
- **Kafka transactions / idempotent producer.** Betul-betul memberi exactly-once — **di dalam Kafka**.
  Harganya: begitu efeknya keluar ke Postgres, jaminan itu berhenti di perbatasan, dan kamu kembali
  butuh kunci idempoten. Plus satu klaster Kafka untuk dioperasikan.
- **At-most-once di semua batas (fire-and-forget, tanpa retry).** Tidak pernah dobel, sederhana sekali.
  Harganya: kehilangan diam-diam. Di jalur uang ini tidak bisa diterima — `outbox.service.ts:175-181`
  mencatat bug nyatanya, *"a money-bearing event lost to a burst of TRANSIENT failures… was silently
  dropped"*.
- **Two-phase commit (XA) melintasi Postgres + Stripe + Redis.** Secara teori menghilangkan
  seluruh kelas masalah. Harganya: Stripe tidak berbicara XA (dan tidak akan), koordinatornya jadi
  single point of failure, dan transaksi in-doubt harus diselesaikan manual saat koordinator mati.

**Latihan:** Ambil satu handler dan uji klaim ini secara empiris. Set `DELIVERY_OUTBOX_REFERRAL=true`
dan `OUTBOX_DISPATCH_ENABLED=false`, buat delivery pertama untuk user yang punya referral `PENDING`,
lalu `SELECT * FROM outbox_events;` — barisnya `PENDING`, saldo belum bertambah. Nyalakan dispatcher,
tunggu satu tick (5 detik, `OUTBOX_DISPATCH_INTERVAL_MS`), cek lagi: `PROCESSED` + dua baris
`wallet_transactions`. Sekarang **paksa** duplikasi: `UPDATE outbox_events SET status='PENDING',
"claimedAt"=NULL;`. Verifikasi: saldo **tidak** bertambah lagi. Lalu telusuri baris kode mana persis
yang mencegahnya (ada dua kandidat — temukan keduanya).

---

### 5.6 Stripe webhook utuh: rawBody, fail-closed, event id sebagai PK, `ADVANCE_FROM`

Webhook adalah satu-satunya tempat di sistem ini di mana **pihak luar menulis ke databasemu**. Padanan
frontend-nya: deep link yang masuk ke app-mu dari luar. Kamu tidak mengontrol siapa yang mengirimnya,
berapa kali, atau dalam urutan apa. Bedanya, di sini efeknya adalah status pembayaran.

Ada empat lapis yang harus dipahami bersamaan, dan itulah kenapa webhook diajarkan **utuh** di sini
alih-alih dipecah dua.

**Lapis 1 — `rawBody`.** Stripe menandatangani **byte mentah** request. Kalau body-nya sudah di-parse
jadi objek lalu di-`JSON.stringify` ulang, urutan kunci dan spasi bisa berubah dan signature-nya tidak
akan cocok. Karena itu Nest di-boot dengan `rawBody: true` dan controller membaca `req.rawBody`.

**Lapis 2 — verifikasi signature yang fail-closed.** `constructEvent` menolak bekerja dalam dua keadaan:
saat mock mode (menolak memproses event tanpa tanda tangan) dan saat `STRIPE_WEBHOOK_SECRET` kosong.
Yang kedua penting: memverifikasi terhadap secret kosong akan **diam-diam menerima payload apa pun**.
Menolak lebih baik daripada menerima sampah.

**Lapis 3 — event id sebagai primary key.** Tabel `webhook_events` isinya cuma `id`, `type`, `createdAt`.
PK-nya adalah id event Stripe (`evt_…`). Event yang dikirim ulang otomatis bentrok → P2002 → di-skip.
Ini persis resep 5.4, hanya kuncinya datang dari pihak luar.

**Lapis 4 — `ADVANCE_FROM` sebagai CAS monoton.** Stripe bisa mengirim event **acak urutan**. Tanpa
penjagaan, `processing` yang datang terlambat akan menurunkan pembayaran yang sudah `COMPLETED`, dan
`payment_failed` yang dikirim ulang bisa memicu refund atas kartu yang sudah tertagih. Solusinya bukan
"urutkan berdasarkan timestamp" (tidak bisa dipercaya) melainkan: batasi `WHERE` pada status-status
sebelumnya yang legal. Event yang basi mencocokkan 0 baris dan jadi no-op yang aman.

Dan yang menyatukan semuanya: **lapis 3 dan lapis 4 harus satu transaksi.** Kalau baris dedupe ditulis
di transaksi terpisah dari update status, crash di antaranya berarti event tercatat "sudah diproses"
padahal update-nya tidak pernah terjadi — dan Stripe tidak akan mengirim ulang. Pembayaran hilang
selamanya.

**Anchor:** `src/main.ts:22-26` (`rawBody: true` dengan komentar alasannya) ·
`src/payments/webhook.controller.ts:34-43` (`req.rawBody ?? Buffer.from(...)`, lalu `constructEvent`
dalam `try/catch` yang memetakan ke 400) · `src/stripe/stripe.service.ts:174-195` (dua penolakan
fail-closed; `:182-184`: *"Never verify against an empty secret — that would silently accept any
payload"*) · `prisma/schema.prisma:613-624` (`WebhookEvent`, PK = id event) ·
`src/payments/payments.service.ts:21-40` (blok komentar `ADVANCE_FROM` — baca utuh; ia menjelaskan
kenapa `REFUNDED: []` dan kenapa `COMPLETED` boleh menang bahkan atas `FAILED`) ·
`src/payments/payments.service.ts:221-247` (dedupe + status write dalam **satu** `$transaction`, dengan
alasannya: *"a crash between the two re-processes on Stripe's redelivery instead of silently dropping
the update"*).

**Kenapa dipakai di sini:** karena `AUDIT-PLAN.md:64-67` mencatat keadaan awalnya — 1.073 test hijau
sementara **tidak satu pun pembayaran pernah benar-benar ditangkap**. Mock mode (`stripe.isMock`)
membuat `createPaymentIntent` langsung mengembalikan `status: 'succeeded'`, jadi setiap demo dan setiap
test melewati jalur pembayaran yang tidak melakukan apa-apa. Itu sebabnya keempat lapis di atas ditulis
dengan komentar sepanjang itu: jalur ini nyaris tidak pernah dieksekusi dalam pengembangan sehari-hari,
jadi kebenarannya harus dijamin oleh struktur, bukan oleh test hijau.

**Alternatif:**
- **Polling Stripe API alih-alih webhook** (`GET /payment_intents/:id` tiap N detik). Tidak ada
  signature, tidak ada rawBody, tidak ada masalah urutan — statusnya selalu yang terbaru. Harganya:
  latensi (kamu tahu N detik terlambat) dan rate limit; pada 10 ribu pembayaran aktif ini tidak muat.
- **Terima webhook lalu enqueue ke BullMQ, proses asinkron.** Respons 200 instan ke Stripe (bagus untuk
  batas timeout mereka) dan retry jadi urusan queue. Harganya: kamu memindahkan masalah, tidak
  menghapusnya — job queue juga at-least-once, jadi `WebhookEvent` + `ADVANCE_FROM` tetap dibutuhkan,
  ditambah satu hop yang bisa gagal.
- **Simpan seluruh payload event (bukan cuma id + type).** Audit trail lengkap, bisa replay dari nol
  kalau logikanya berubah. Harganya: tabel tumbuh cepat dan berisi PII pembayaran; komentar
  `schema.prisma:617` justru menekankan tabel ini sengaja *"low volume — one row per distinct event"*
  dan tidak dipartisi karena itu.

**Latihan:** Panggil endpoint webhook dua kali dengan body yang sama (id event sama) memakai `curl`.
Verifikasi respons kedua mengandung `duplicate: true` (`payments.service.ts:243`) dan bahwa
`payments.status` **tidak** berubah dua kali. Lalu lakukan mutasi: pindahkan `tx.webhookEvent.create`
di `:228-230` ke **luar** `$transaction` (jadi `this.prisma.webhookEvent.create` sebelum blok
transaksi), jalankan `npx jest src/payments`, dan catat apakah ada test yang mati. Terlepas dari
hasilnya, tulis satu paragraf skenario crash yang membuat sebuah pembayaran hilang selamanya —
sebutkan detik ke berapa prosesnya mati.

---

### 5.7 Transactional Outbox: dual-write problem

Padanan yang jujur dari dunia frontend: menyimpan aksi offline ke local storage lalu mengirimnya saat
online. Kamu tidak mengirim langsung, kamu **menulis niatnya** dulu ke tempat yang tahan mati, dan
proses lain yang mengirim. Outbox adalah versi server-side dari itu, dengan satu perbedaan penting:
"tempat yang tahan mati" adalah database yang **sama** dengan tempat data bisnismu, sehingga keduanya
bisa commit bersama.

Masalah yang dipecahkannya punya nama: **dual-write problem.** Kamu tidak bisa menulis ke database DAN
mengirim pesan ke sistem lain secara atomik. Dua opsi naif keduanya rusak:

- **Publish setelah commit** → proses mati tepat setelah commit, sebelum publish. Event hilang selamanya.
- **Publish sebelum commit** → transaksi di-rollback, tapi event sudah terkirim. Efek hantu: uang
  dikirim untuk pesanan yang tidak ada.

Solusinya: tulis "niat" itu sebagai **baris di database yang sama**, di dalam transaksi yang sama.
Ia ikut commit atau ikut rollback — tidak ada keadaan di antara. Worker terpisah kemudian membacanya
dan menerapkannya.

Yang harus kamu pahami betul, dan yang paling sering disalahpahami: **status baris outbox BUKAN
otoritas dedupe.** `status = 'PROCESSED'` hanyalah optimasi liveness — supaya dispatcher tidak
memungut baris yang sama berulang kali. Otoritas dedupe yang sesungguhnya adalah idempotensi handler
itu sendiri (untuk referral: CAS `PENDING → REWARDED` plus kunci unik `WalletTransaction`). Karena itu,
saat apply menghasilkan P2002, itu **sukses**, bukan gagal.

Siklus hidupnya patut ditiru untuk pola apa pun yang sejenis: `PENDING → PROCESSING` (CAS klaim,
`attempts++`) → crash → klaim kedaluwarsa di-reap kembali ke `PENDING` → habis percobaan → `FAILED` →
dan `FAILED` **tetap** di-replay setelah backoff panjang sampai plafon.

**Anchor:** `prisma/schema.prisma:626-643` (blok komentar `TRANSACTIONAL OUTBOX` — rumusan masalahnya:
*"a single tx can't span shards"*) · `src/outbox/outbox.service.ts:25-36` (kontrak at-least-once +
kalimat "status is a LIVENESS optimization, NOT the dedupe authority") · `:47-63` (`enqueueWithinTx` —
perhatikan ia menerima `tx`, bukan memakai `this.prisma`) · `:85-103` (klaim CAS + Read Committed) ·
`:108-135` (apply + mark dalam satu `$transaction`, lalu `catch` yang memperlakukan P2002 sebagai
sukses) · `:153-173` (reaper klaim basi) · `:175-196` (`requeueRecoverableFailed`) · sisi produsen di
`src/deliveries/deliveries.service.ts:450-475`, khususnya alasan kunci per-delivery di `:464-466`:
*"Per-delivery key dedupes the tracking-id retry loop (a collision rolls the whole tx back + re-runs
this block → same key → P2002 on retry)."*

**Kenapa dipakai di sini:** ini bukan "queue yang lebih baik". `SCALING-1M.md:111-116` menyebutnya
**HARD BLOCKER**: `create()`'s `$transaction` hari ini meng-co-commit `delivery` + `trackingIdRegistry`
+ `promo.redeem` + `wallet.debit` + `referral.grant`. Baris delivery berakar di shard delivery;
wallet/promo/referral berakar di shard user. Satu `$transaction` tidak bisa melintasi shard — jadi
selama kelimanya di satu transaksi, database ini **tidak bisa di-shard sama sekali**. Outbox adalah
langkah pertama membongkarnya, dan referral dipilih duluan justru karena ia paling jinak: kredit murni
tanpa mode kegagalan.

**Alternatif:**
- **Publish langsung ke queue setelah commit.** Satu baris kode, nol tabel tambahan. Harganya persis
  dual-write problem: crash di antara commit dan publish menghilangkan event selamanya. Kalau eventnya
  "kirim email selamat datang", ini trade-off yang sah. Kalau eventnya "beri kredit $10", tidak.
- **CDC / log-based (Debezium membaca WAL Postgres).** Nol beban di jalur tulis dan tidak perlu tabel
  outbox sama sekali — perubahan baris ditangkap dari write-ahead log. Harganya: infrastruktur besar
  (Kafka + connector + schema registry) dan eventnya berbentuk *row change* (`UPDATE users SET
  credit_balance = 30`), bukan *intent* bisnis (`REFERRAL_REWARD untuk user X`). Konsumen jadi harus
  merekonstruksi maksud dari diff.
- **`LISTEN`/`NOTIFY` PostgreSQL.** Sangat ringan, nol dependency baru, dan notifikasi ikut semantik
  transaksi (hanya terkirim saat commit). Harganya fatal untuk kasus ini: **tidak durable** — kalau
  tidak ada listener yang terhubung saat notifikasi dikirim, ia hilang begitu saja. Cocok sebagai
  *pemicu* ("ada kerjaan baru, bangun") di atas tabel outbox, bukan sebagai pengganti tabelnya.

**Latihan:** Baca `src/outbox/outbox.service.ts:94-151` sekali lagi, lalu jawab tertulis: kenapa klaim
(`:95-102`) berada **di luar** `$transaction` sementara apply + mark (`:109-119`) di dalamnya? Apa yang
rusak kalau klaim ikut masuk ke transaksi yang sama? Verifikasi jawabanmu dengan memindahkannya ke
dalam dan menjalankan `npx jest src/outbox/outbox.service.spec.ts`. Kalau semua test tetap hijau, kamu
baru menemukan lubang test — tulis test yang membunuh mutasi itu.

---

### 5.8 Saga debit-first: kompensasi sinkron + rekonsiliasi asinkron

Ini konsep tersulit di fase ini, dan repo menjelaskannya lebih baik daripada kebanyakan buku. Tidak ada
padanan frontend yang jujur — di React tidak ada yang namanya "aku sudah menulis separuh, dan yang
separuh lagi gagal, dan aku tidak bisa membatalkan yang pertama".

Masalahnya persis lanjutan dari 5.7. Selama potongan saldo dan pembuatan delivery ada di satu
`$transaction`, atomicity-nya gratis: gagal salah satu, mundur semua. Begitu keduanya dipisah ke dua
transaksi (yang **wajib** kalau mau shard), atomicity itu hilang dan kamu harus menuliskannya sendiri.
Itulah saga: rangkaian transaksi lokal, masing-masing dengan **kompensasi** yang membatalkannya.

Kenapa "debit-first" (potong dulu, baru buat delivery) dan bukan sebaliknya? Karena arah kegagalannya
yang mahal berbeda. Kalau delivery dibuat dulu lalu debit gagal, platform sudah mengirim drone untuk
pesanan yang tidak dibayar — kerugian tidak bisa dipulihkan. Kalau debit duluan lalu delivery gagal,
yang terjadi adalah uang customer nyangkut — buruk, tapi **bisa dikembalikan**. Saga selalu dirancang
supaya kegagalannya jatuh ke arah yang bisa dikompensasi.

Lalu ada wawasan yang jarang ditulis orang, dan ini bagian terbaik dari kode ini: **sebuah
`$transaction` bisa COMMIT lalu promise-nya REJECT.** Error driver/koneksi setelah commit mendarat di
`catch`-mu dengan uang yang sudah benar-benar berpindah. Karena itu **seluruh** blok reservasi
dibungkus `try`, bukan cuma bagian debit-nya — kalau tidak, slot promo bisa terkonsumsi tanpa delivery
dan tanpa tagihan.

Dua tingkat jaring pengaman, dan pembagian tugasnya tegas:

- **Sinkron** — `compensateReservations()` + `releaseClaimedAircraft()` untuk kegagalan **in-process**.
  Keduanya idempoten dan no-op saat barisnya tidak ada, jadi aman dipanggil tanpa syarat di setiap jalur
  gagal.
- **Asinkron** — `OrphanReaperService.sweep()` untuk **crash proses**, satu-satunya kasus yang lolos
  dari kompensasi sinkron (tidak ada `catch` yang jalan kalau prosesnya mati).

**Anchor:** `src/deliveries/deliveries.service.ts:86-101` (aturan dan flag `DELIVERY_DEBIT_FIRST`) ·
`:225-235` (id di-mint di aplikasi — prasyarat A1) · `:353-403` (blok reservasi debit-first) ·
**`:381-393`** (baca `catch` ini pelan-pelan: *"a `$transaction` can COMMIT and then have its awaited
promise REJECT (a post-commit driver/connection error), landing HERE in-process with the money already
moved"*) · `:171-189` (`compensateReservations`) · `:191-204` (`releaseClaimedAircraft`) ·
`:486-490` (kenapa klaim pesawat **tidak** ikut rollback: *"The claim committed on the `drones` table
(a separate, non-partitioned row) so this rollback does not undo it… the aircraft would be held out of
service permanently"*) · `src/deliveries/orphan-reaper/orphan-reaper.service.ts:13-18`, `:37-47`
(anti-join didorong ke SQL, dengan alasannya), `:103-113` (re-check saat kompensasi).

**Kenapa dipakai di sini:** `SCALING-1M.md:119` mencatat bahwa desain ini menang setelah dibandingkan
dengan dua alternatif dalam panel desain — dan menuliskan kenapa yang lain kalah. Yang juga penting:
seluruhnya **inert by default**. `DELIVERY_DEBIT_FIRST` default OFF, jadi perilaku hari ini byte-identical
dengan satu transaksi lama. Ini pola yang berulang di repo: seam dipasang lebih dulu, flag dibalik nanti,
supaya perubahan besar tidak dilakukan saat sistem sedang kepanasan.

**Alternatif:**
- **Satu transaksi ACID untuk semuanya** (default hari ini, flag OFF). Paling sederhana dan paling
  benar. Harganya satu dan besar: seluruh state terkunci ke satu shard, selamanya. Sah dipilih sampai
  kamu benar-benar butuh shard — dan `SCALING-1M.md:102-105` bahkan menegaskan urutannya, *"Sharding is
  the last lever, not the first."*
- **Reserve-then-settle (hold saldo dengan TTL, settle setelah delivery jadi).** Jaminannya setara.
  Harganya, dan ini alasan repo menolaknya (`SCALING-1M.md:119`): state-nya lebih banyak, TTL-nya jadi
  *load-bearing untuk uang* (angka yang salah = kerugian), dan race auto-release vs settle bisa membuat
  platform **under-charge**.
- **Temporal / AWS Step Functions.** Saga jadi kode workflow durabel; kompensasi first-class, retry dan
  timeout bawaan, riwayat eksekusi bisa dilihat. Harganya: satu klaster/layanan lagi untuk dioperasikan
  dan dibayar, plus seluruh domain harus ditulis ulang sebagai activity. Untuk dua kompensasi yang
  masing-masing satu panggilan fungsi idempoten, ini terlalu besar.
- **Event sourcing penuh + eventual consistency.** Tidak ada saga karena tidak ada transaksi lintas
  agregat. Harganya: menulis ulang seluruh domain, dan setiap pembacaan jadi proyeksi.

**Latihan:** Set `DELIVERY_DEBIT_FIRST=true`. Di `src/deliveries/deliveries.service.spec.ts`, mock
`prisma.delivery.create` melempar error non-P2002 dan verifikasi bahwa `promoService.releaseForDelivery`,
`walletService.refundForDelivery`, **dan** `dispatchService.release` ketiganya terpanggil. Lalu hapus
baris `await this.releaseClaimedAircraft(dispatched.droneId, deliveryId);` di `:490`, jalankan lagi, dan
jelaskan tertulis: apa yang bocor, dan kenapa rollback transaksi **tidak** menyelamatkannya. Terakhir,
jalankan `npx jest src/deliveries/orphan-reaper` dan jawab: kenapa `reapIfOrphan` membaca ulang
keberadaan delivery di `:109-113` padahal query kandidat sudah memfilternya?

---

### 5.9 Read replica: empat larangan dan fallback ke primary

Replika adalah salinan read-only yang **tertinggal beberapa milidetik** dari primary. Padanan yang kamu
kenal: cache yang tidak pernah kamu invalidate, hanya saja usianya diukur dalam milidetik dan diatur oleh
replikasi, bukan olehmu. Manfaatnya membebaskan primary dari beban baca. Harganya: kamu bisa membaca data
basi.

Yang membuat bagian ini layak dihafal bukan mekanismenya — itu cuma client Prisma kedua — melainkan
**empat larangannya**. Semuanya adalah cara staleness berubah dari "angka dashboard telat 200 ms" (tidak
apa-apa) jadi "user membelanjakan saldo dua kali" (fatal):

1. **Jangan pernah menyuapi CAS.** Kalau nilai yang kamu baca dipakai untuk menyusun `WHERE` sebuah CAS,
   ia harus dari primary. Baca basi → CAS yang menang atas prasyarat yang sudah tidak berlaku.
2. **Jangan pernah untuk dibandingkan atau di-increment.** Saldo, kuota, counter.
3. **Jangan pernah untuk mengotorisasi tulisan.** Cek kepemilikan, cek role.
4. **Jangan pernah dikembalikan tepat setelah tulis.** User yang tidak melihat perubahannya sendiri akan
   menekan tombolnya lagi.

Dua detail rekayasanya bagus dan patut ditiru. **Fallback**: kalau replika mati, baca diulang ke primary
**sekali**, dan hanya untuk error kelas koneksi — error query nyata seperti P2002 tetap dilempar. Jadi
replika mati = lebih lambat, bukan 5xx. **Per-tier**: hanya proses `api` dan `dev` yang membuka pool
replika; worker dan realtime tidak, karena pool koneksi yang tidak terpakai tetap memakan anggaran
`max_connections`.

Ada juga satu jebakan implementasi yang sangat spesifik dan layak dibaca: kliennya dibaca dari **field
privat**, bukan getter, karena Prisma Client adalah `Proxy` yang menangkap pengambilan properti apa pun
sebagai model delegate — sebuah getter bernama `reader` akan diam-diam terbayangi.

**Anchor:** `src/prisma/prisma.service.ts:68-79` — keempat larangan ditulis persis di sana: *"NEVER route
a read that feeds a CAS, is compared/incremented, authorizes a write, or is returned right after a write
through here — keep those on `this`."* Plus catatan Proxy di `:76-78`. Implementasi fallback di `:80-95`;
klasifikasi error koneksi di `:97-108` (`P1001/P1002/P1008/P1017` + `ECONNREFUSED/ETIMEDOUT/ENOTFOUND`).
Pemisahan tier di `:37-48`. Contoh pemakaian yang **benar** dan komentarnya:
`src/wallet/wallet.service.ts:202-205` — *"Pure display read (balance + ledger), never feeds a
debit/credit CAS → read replica… The authoritative spend/refund CAS always runs on the primary inside a
`$transaction`."* Bandingkan dengan `src/wallet/wallet.service.ts:234-237` yang secara sadar menahan
`ensureReferralCode` di primary karena ia baca-lalu-tulis.

**Kenapa dipakai di sini:** karena `SCALING-1M.md:95-98` menghitung bahwa setiap tulis panas menyalur ke
satu primary, dan pada 2 juta DAU modelnya menunjukkan ~17 ribu tulis/detik. Memindahkan baca yang
toleran lag ke replika adalah tuas termurah yang tersedia. Tapi tuas itu hanya aman kalau garis batasnya
jelas — dan itulah kenapa larangannya ditulis di JSDoc, bukan di wiki yang tidak dibaca siapa pun.

**Alternatif:**
- **Baca semuanya dari primary.** Konsistensi sempurna, nol aturan untuk dilanggar. Harganya: primary
  jadi plafon kapasitas untuk baca **dan** tulis sekaligus, dan pada beban di atas kamu kehabisan jauh
  lebih cepat.
- **Read-your-writes routing (sticky ke primary selama N detik setelah tulis per sesi).** Menutup kelas
  bug "user tidak melihat perubahannya sendiri" tanpa mengorbankan semua baca. Harganya: butuh state
  per-sesi (di Redis atau cookie), dan N detik itu jadi angka tebakan yang harus benar.
- **Replikasi sinkron.** Tidak ada lag sama sekali, jadi keempat larangan itu lenyap. Harganya: setiap
  commit menunggu replika mengonfirmasi → latensi tulis naik, dan satu replika yang lambat menahan
  seluruh primary.

**Latihan:** Cari **semua** pemanggilan `readWithFallback` di `src/` (`grep -rn "readWithFallback" src/`).
Untuk masing-masing, uji terhadap keempat larangan dan tulis satu kalimat vonis. Lalu tantang dirimu:
`src/users/users.service.ts:64-69` (`getStats`) memakai replika sementara `getProfile` (`:27-48`) tidak.
Jelaskan kenapa pembedaan itu benar — dan kenapa `getStats` tetap memanggil `getProfile` lebih dulu.

---

### 5.10 Redis cache-aside: fail-open, TTL, invalidasi, negative caching, dan cache ROWS

Cache-aside kamu sudah kenal dari React Query / SWR: cek cache → miss → fetch → isi cache. Yang baru di
sini adalah empat keputusan **di sekitarnya**, dan tiap satunya lahir dari bug nyata.

**(1) Fail-open.** Setiap error Redis ditelan dan diperlakukan sebagai miss. Cache mati = request lebih
lambat, bukan request gagal. Ini didukung konfigurasi klien `enableOfflineQueue: false` — gagal cepat,
jangan menggantungkan request menunggu Redis yang tidak akan menjawab.

**(2) Apa yang boleh masuk cache.** Bukan "apa pun yang lambat", melainkan "apa yang tidak jadi dasar
keputusan otorisasi". Profil user aman di-cache karena responsnya data profil stabil — tanpa saldo,
tanpa id Stripe — dan `role` di sana hanya untuk tampilan; gerbang otoritatifnya adalah `RolesGuard`
yang membaca role segar dari DB dan **tidak pernah** membaca cache ini.

**(3) Invalidasi eksplisit + TTL, dua alat untuk dua jalur.** TTL 60 detik membatasi jalur perubahan yang
jarang (admin mengubah role); `cache.del()` di jalur update mengurus perubahan yang harus langsung
terlihat oleh pemiliknya sendiri.

**(4) Negative caching yang benar.** Ini yang paling halus. Ada beda besar antara "provider menjawab:
alamat tidak ada" (boleh di-cache, itu fakta tentang alamatnya) dan "provider tidak menjawab" (**tidak
boleh**, itu fakta tentang jaringan). Meng-cache yang kedua mengubah satu kedipan jaringan jadi satu jam
kegagalan keras — karena delivery **fail-closed** pada lokasi yang tak terselesaikan.

**(5) Cache ROWS, bukan JAWABAN.** Puncaknya. `AirspaceService` menyimpan **baris** hasil query, dan
menjalankan filter "sedang berlaku" **setelah** cache, pada setiap panggilan. Kalau yang di-cache adalah
hasil filternya, zona TFR yang dijadwalkan aktif pukul 14:00 baru berlaku setelah TTL habis — di
**setiap** instance, termasuk instance yang membuatnya. Aturan umumnya: **cache-lah input yang mahal,
jangan keputusan yang bergantung waktu.**

**Anchor:** `src/cache/cache.service.ts:6-10` (kontrak fail-open) dan `:17-48` (get/set/del — perhatikan
ketiganya `try/catch` yang menelan) · `src/users/users.service.ts:9-16` (apa yang aman di-cache, dengan
alasan RolesGuard), `:27-48` (cache-aside), `:59-60` (invalidasi) · `src/geo/geo.service.ts:22-30` (tipe
`GeocodeOutcome` yang memisahkan `not_found` dari `failed`) dan `:57-63` (*"caching it for GEO_MISS_TTL_S
would turn one transient blip into an hour of hard failures"*) ·
`src/serviceability/airspace.service.ts:26-29` dan `:39-52` — *"Caching the filtered list instead — the
shape this started as — evaluates the window once per fill, so a zone entering force by the clock… stays
unenforced for up to a full TTL on EVERY instance… That was the only fail-open window in a service
written to fail closed."* Batas TTL-nya di `src/serviceability/airspace.constants.ts:1-15` dan fungsi
murni `resolveAirspaceCacheTtlMs` di `:30-37`, yang komentarnya menyebut bug lamanya: `Number(env) ||
30_000` salah **dua arah** (membuang `0` eksplisit, meloloskan negatif).

**Kenapa dipakai di sini:** karena dua dari tiga belas "kelas bug berulang" repo ini adalah bug cache —
`ad5cc50 fix(geo): never negative-cache a provider failure` dan `6af2846 fix(airspace): cache the ROWS,
not the answer`. Pelajaran gabungannya satu kalimat: kegagalan sementara tidak boleh jadi jawaban yang
di-cache, dan cache jawaban ≠ cache data.

**Alternatif:**
- **Write-through / write-behind.** Cache selalu sinkron dengan tulis, jadi tidak ada jendela stale.
  Harganya: setiap jalur tulis harus tahu tentang cache (kopling naik), dan write-behind bisa kehilangan
  data saat proses mati sebelum flush. Cache-aside menang di sini karena sederhana dan aman.
- **Cache in-process (`Map` + TTL), seperti yang dipakai `AirspaceService`.** Nol latensi jaringan dan
  nol dependency. Harganya nyata dan diakui repo: ia **per-pod**, jadi dengan 10 pod kamu punya 10 versi,
  dan `invalidate()` dari satu pod tidak menyentuh sembilan lainnya. Untuk Redis, invalidasi berlaku
  global.
- **Pub/sub invalidation** (kirim pesan ke semua pod untuk membuang cache in-process). Menghapus jendela
  staleness lintas-pod tanpa memindahkan cache ke jaringan. Harganya: satu mekanisme lagi yang bisa rusak
  diam-diam — dan repo ini punya dua bug "langganan tidak di-re-arm setelah blip Redis" yang membuktikan
  itu bukan kekhawatiran teoretis.

**Latihan:** Matikan Redis (`docker compose stop redis`) selagi aplikasi berjalan, lalu panggil
`GET /users/me`. Verifikasi request **tetap sukses** dan hanya ada log peringatan dari `CacheService`.
Nyalakan lagi. Lalu, mutasi: di `src/serviceability/airspace.service.ts`, pindahkan
`rows.filter((z) => isZoneInForce(z, now))` dari `:63` ke **dalam** `fetchActiveRows` (jadi cache
menyimpan hasil filter). Jalankan `npx jest src/serviceability`. Kalau semua tetap hijau, tulis test
baru yang membunuh mutasi itu: isi cache pada `t0` dengan zona ber-`activeFrom` di `t0 + 1 menit`, lalu
panggil `inForceZones(t0 + 2 menit)` dan harapkan zona itu **ada**.

---

### 5.11 Audit log di dalam transaksi: allowlist, co-commit, snapshot role

Ini konsep "senior" dan pas ditaruh di sini, karena ia bukan tentang menulis kode melainkan tentang
**menuliskan keputusan**. Empat keputusan bertumpuk, semuanya beralasan eksplisit.

**(1) Co-commit, bukan best-effort.** Baris audit ditulis lewat `recordWithinTx(tx, entry)` yang menerima
transaction client **milik pemanggil**. Jadi baris audit tidak bisa commit terpisah dari mutasi yang
dicatatnya. Kalau audit gagal, aksi operatornya ikut mundur — dan itu memang yang diinginkan: mutasi yang
terjadi tanpa catatan siapa pelakunya adalah keadaan yang justru ingin dibuat mustahil.

**(2) Allowlist, bukan denylist.** Field mana yang boleh ditangkap ke `before`/`after`/`args` didaftar
satu per satu per aksi. Bedanya load-bearing: denylist berarti field baru yang ditambahkan ke DTO nanti
akan **mulai muncul** di audit log sampai ada yang ingat mengecualikannya. Allowlist gagal ke arah aman.

**(3) `actorRole` di-snapshot.** Karena `RolesGuard` membaca role segar dari DB setiap request dan role
bisa berubah setelahnya, pertanyaan "siapa yang ADMIN saat itu" tidak bisa dijawab dari baris `users`
hari ini.

**(4) Tanpa FK ke `users`, sengaja.** `onDelete: SetNull` akan *"preserve the row while destroying its
single most important field"*. Kolom biasa tidak bisa di-null-kan oleh cascade.

Dan yang paling instruktif: **aturan repo yang sengaja dilanggar satu kali, dengan alasan tertulis.**
Ada aturan global — satu `$transaction` tidak boleh meng-co-commit state yang berakar di shard-key
berbeda. `adminForceCancel` melanggarnya: `AdminAuditLog` berakar di aktor, delivery berakar di delivery.
Pelanggarannya diambil sadar, harganya dihitung, dan ditulis di tempat kejadian.

**Anchor:** `src/admin/audit/admin-audit.constants.ts:13-23` (allowlist, dengan kalimat *"a denylist means
a field added to a DTO later starts appearing in the audit log until somebody remembers to exclude it.
This fails closed instead."*) · `src/admin/audit/admin-audit.service.ts:32-48` (kontrak paling tajam di
repo: write **wajib** memakai `tx` pemanggil, dan *"A write that reached for `this.prisma` instead would
still compile, and would still pass a test that… passes the same object as both the injected client and
the transaction — only a test built to tell them apart catches it"*) dan `:53-71` (`recordWithinTx`) ·
`prisma/schema.prisma:1001-1008` (tanpa FK, dengan alasannya) dan `:1017-1019` (`actorRole` snapshot) ·
`src/deliveries/deliveries.service.ts:953-962` — **pelanggaran yang didokumentasikan**: *"Recorded here
so it is found as a decision rather than rediscovered as an accident."* · `:964-1002` (dua CAS terpisah,
bukan satu, karena `updateMany` tidak bisa melaporkan baris mana yang cocok) · aturan induknya di
`docs/superpowers/specs/2026-08-02-operator-audit-log-design.md:121-125`.

**Kenapa dipakai di sini:** karena audit adalah tempat semua konsep fase ini bertemu. Ia butuh CAS (agar
yang tercatat adalah transisi yang benar-benar terjadi, bukan permintaan yang dikirim), butuh transaksi
(agar tidak bisa hilang), butuh kejujuran soal Read Committed (`:1079-1084` mengakui jendela sub-milidetik
di mana `firedFrom` bisa basi), dan butuh kesadaran shard-key (5.7, 5.8).

**Alternatif:**
- **Trigger Postgres.** Mustahil terlewat, bahkan oleh migrasi manual atau `psql` langsung. Harganya:
  trigger tidak tahu **siapa** aktornya — koneksi dipakai bersama lewat pool/PgBouncer, jadi tidak ada
  "user saat ini" yang bisa dibaca. Dan logikanya pindah ke tempat yang tidak ikut di-review bersama
  diff kode.
- **Nest interceptor global yang mencatat semua request admin.** Nol perubahan di service, satu tempat.
  Harganya menentukan: ia mencatat **permintaan**, bukan **transisi yang benar-benar terjadi** — sebuah
  force-cancel yang kalah CAS akan tetap tercatat seolah berhasil.
- **Audit asinkron (outbox / CDC ke warehouse).** Tidak mengunci shard, nol biaya di jalur panas.
  Harganya persis cacat yang dihindari: baris audit bisa hilang tepat saat transaksinya gagal atau
  prosesnya mati — yaitu momen yang paling perlu dicatat.
- **`RETURNING` clause via `$queryRaw`.** Menghapus kebutuhan read-then-CAS dan menutup jendela READ
  COMMITTED di `:1079-1084` sepenuhnya. Harganya: keluar dari type-safety Prisma untuk jalur itu dan
  memetakan enum sendiri. Ini kandidat perbaikan nyata, bukan alternatif teoretis.

**Latihan:** Ganti pola read-then-CAS di `failExceptional` (`:1116-1146`) dengan satu `$queryRaw`
berbentuk `UPDATE ... WHERE status IN (...) RETURNING id, status AS fired_from`, dan buktikan lewat test
bahwa `firedFrom` sekarang benar-benar berasal dari baris yang di-update. Verifikasi: tulis test yang
mensimulasikan commit lain mendarat di antara SELECT dan UPDATE (mock `findFirst` mengembalikan status
lama, `updateMany` mengembalikan `count: 1`) — test itu harus **gagal** pada kode lama dan **lulus**
pada kode baru. Lalu tulis entri `AUDIT-LOG.md` gaya repo ini: apa yang berubah, cacat apa yang ditutup,
biaya apa yang kamu terima.

---

### 5.12 Menutup utang Fase 2: atomisitas rotasi refresh + reuse detection

Di Fase 2 kamu memasang rotasi refresh token: tiap refresh token sekali pakai, disimpan sebagai hash,
ditukar dengan pasangan baru. Waktu itu kamu belum punya kosakata untuk mengklaim apa pun soal
atomisitas. Sekarang punya, jadi utangnya dibuka.

Ada dua cacat yang saling memperburuk, dan keduanya tercatat sebagai **regresi yang ditemukan lewat
review adversarial atas diff sendiri**.

**Cacat 1 — rotasi tidak atomik.** Revoke token lama dan insert token baru adalah dua tulisan. Gagal di
antara keduanya meninggalkan user memegang token yang sudah revoked tanpa penerus. Perbaikannya:
`$transaction([revoke, insert])`.

**Cacat 2 — `revokedAt` punya terlalu banyak arti.** Reuse detection bekerja begini: token yang **ada**,
**milik user ini**, dan **sudah revoked** berarti sedang di-replay — entah oleh pemilik sah yang
mengulang, entah oleh penyerang dengan token curian. Dari sini keduanya tidak bisa dibedakan, jadi
langkah amannya adalah mematikan seluruh keluarga token dan memaksa login ulang.

Masalahnya: kalau `logout()` juga menstempel `revokedAt`, maka baris revoked bisa berarti dua hal
berbeda, dan skenario multi-device biasa jadi bencana. Reset password di HP → semua token revoked →
login lagi → tablet bangun dan mengirim token pra-reset → *family-kill* menghancurkan sesi yang **baru
saja** dibuat, plus mencatat peringatan pelanggaran keamanan atas sesuatu yang tidak pernah terjadi.

Solusinya bukan menambah `if`, tapi mempersempit makna: **jalur jinak menghapus baris, bukan
menstempelnya.** Dengan begitu `revokedAt` hanya berarti satu hal — "digantikan oleh rotasi" — dan
itulah yang membuat reuse detection aman. Menghapus juga tidak lebih lemah daripada me-revoke: baris
yang tidak ada gagal di lookup sejak awal.

Perhatikan bagaimana kedua cacat berinteraksi: rotasi non-atomik saja hanya menyusahkan; digabung dengan
reuse detection, ia jadi **cara memicu family-kill pada user yang tidak salah apa-apa**. Ini pelajaran
umum yang layak dibawa — fitur keamanan baru bisa mengubah bug lama yang "kecil" jadi besar.

**Anchor:** `src/auth/auth.service.ts:169-185` (blok REUSE DETECTION, termasuk kenapa scoping ke
`record.userId === userId` mencegah orang asing memakai hash tebakan untuk melogout orang lain) ·
`:205-220` (`logout` — *"DELETES the row rather than stamping `revokedAt`. That keeps `revokedAt` meaning
exactly one thing — 'superseded by rotation'"*) · `:370-400` (`rotateTokens` — `$transaction` dengan
alasan tertulis: *"a failure between them leaves the caller holding a token that is revoked with no
successor — and with reuse detection in place, their next retry would then look like a replay and log
out every one of their devices"*) · `:292-296` (jalur bulk revoke di reset password, yang juga DELETE,
"for the same reason as logout()"). Cerita lengkapnya di `AUDIT-LOG.md:301-313`.

**Kenapa dipakai di sini:** karena penjelasannya bersandar penuh pada dua ide yang baru ada di fase ini —
atomisitas dua tulisan, dan "dua penulis berebut satu baris". Mengajarkannya di Fase 2 berarti meminta
kamu percaya klaim yang tidak bisa kamu uji. Sekarang kamu bisa.

**Alternatif:**
- **Refresh token tanpa rotasi (satu token berumur panjang).** Paling sederhana, tidak ada reuse
  detection yang perlu ditulis. Harganya: token curian berlaku sampai kedaluwarsa, dan kamu tidak punya
  sinyal apa pun bahwa pencurian terjadi. Rotasi memberi sinyal itu gratis.
- **Token family id + generation counter** (pola yang dipakai banyak IdP). Alih-alih menghapus/menstempel
  baris per token, tiap keluarga punya id dan counter; replay terdeteksi dari generation yang mundur.
  Harganya: satu tabel/kolom lagi dan logika yang lebih banyak, tapi kamu dapat riwayat rotasi yang bisa
  diaudit — sesuatu yang hilang saat kamu memilih DELETE.
- **Access token yang bisa dicabut langsung (cek `passwordChangedAt` tiap request).** Menutup jendela
  paparan 15 menit sepenuhnya. Harganya persis alasan repo menolaknya (`AUDIT-LOG.md:296-299`):
  `JwtStrategy.validate` hari ini tidak melakukan I/O sama sekali, dan pengecekan itu menambah satu
  round-trip database **ke setiap request terautentikasi**.

**Latihan:** Tulis test di `src/auth/auth.service.spec.ts` untuk skenario multi-device di atas: user
punya dua refresh token aktif → `logout()` dengan token pertama → lalu `refreshTokens()` dengan token
kedua. Harapkan **sukses**, bukan family-kill. Verifikasi test itu **gagal** kalau kamu mengubah
`logout()` dari `deleteMany` jadi `updateMany({ data: { revokedAt: new Date() } })`. Itu bukti bahwa
`revokedAt` bermakna tunggal adalah properti yang dijaga test, bukan kebetulan.

---

### 5.13 Metode verifikasi: mutation testing manual — test hijau bukan bukti

Ini bagian yang mengubah cara kamu bekerja setelah fase ini, dan ia layak diperlakukan sebagai konsep
teknis, bukan sebagai nasihat.

Klaimnya keras: **test hijau bukan bukti kebenaran.** Buktinya ada di repo ini sendiri, dengan angka.
Pada saat audit dilakukan: 1.073 test lulus, tiga repo typecheck bersih, lint bersih — sementara satu
fitur user-facing utuh (support ticket) tidak bisa dijangkau sama sekali dan **tidak ada satu pun
pembayaran yang pernah ditangkap**. `supportApi.createTicket` punya test yang lulus dan **nol call site**.

Cara memeriksa apakah test-mu benar-benar bernilai cuma satu: **rusak kodenya dengan sengaja, lalu lihat
apakah ada test yang mati.** Kalau tidak ada yang mati, test itu tidak menjaga perilaku yang kamu kira
dijaganya — dan kamu baru saja menemukan lubang.

Repo ini menjalankan sweep 15 mutasi sebelum merge, dan yang penting bukan angkanya melainkan **aturan
anti-menipu-dirinya**:

- Jalankan **seluruh file spec**, bukan `jest -t "nama test"`. Filter bisa menyembunyikan test yang
  seharusnya menangkapnya.
- Jalankan `tsc --noEmit` dulu dan pastikan tetap di baseline error-nya. Mutasi yang membuat kompilasi
  gagal bukan mutasi, itu typo.
- Perlakukan run yang mengeksekusi **nol test** sebagai **gagal**, bukan lulus. Ini jebakan paling umum:
  path spec salah ketik → "0 tests, 0 failures" → tercatat sebagai "terbunuh".
- Pastikan teks yang kamu edit muncul **tepat sekali** di file, supaya mutasi yang diam-diam tidak
  terpasang tidak bisa diskor sebagai terbunuh.

Mutasi yang paling berguna untuk kode konkurensi ada empat bentuk: **hapus satu klausa `where`** (apakah
CAS-nya benar-benar diuji?), **balik operator perbandingan** (`>` → `>=`), **pindahkan sebuah tulisan
keluar dari transaksi** (apakah co-commit diuji, atau cuma "fungsinya dipanggil"?), dan **hapus sebuah
kompensasi** (apakah jalur gagal diuji sama sekali?).

**Anchor:** `AUDIT-PLAN.md:62-71` — §1.1 *"The test suite will not catch your mistakes"*, termasuk
angka 1.073 test itu · `AUDIT-LOG.md:2069-2078` — protokolnya: *"the harness treats a run that executed
zero tests as a failure rather than a pass"* dan *"Each edit asserts its anchor text occurs exactly once,
so a silently-unapplied mutation cannot be scored as killed."* Contoh mutasi yang mereka jalankan ada di
baris-baris berikutnya, dan beberapa di antaranya persis mutasi yang akan kamu jalankan di capstone.
Contoh test yang **hijau karena alasan salah** ada di kelas bug "Test hijau karena mock, bukan karena
benar": `prisma` dan `prisma.txClient` adalah `jest.fn` yang sama, jadi hanya assertion identitas yang
bisa melihat bedanya — persis yang diperingatkan `admin-audit.service.ts:38-43`.

**Kenapa dipakai di sini:** karena kode konkurensi adalah kode yang **paling mudah terlihat benar dan
paling sulit dibuktikan benar**. Satu klausa `where` yang hilang tidak mengubah satu pun hasil test yang
menguji jalur bahagia. Mutation testing adalah satu-satunya cara murah untuk melihatnya.

**Alternatif:**
- **Gate coverage persentase (mis. 80%).** Otomatis, tidak butuh disiplin manusia. Harganya persis §1.1:
  coverage tinggi dengan mock yang salah. `supportApi.createTicket` punya coverage; ia tetap tidak
  terpanggil dari mana pun.
- **Stryker Mutator (mutation testing otomatis untuk JS/TS).** Menjalankan ratusan mutasi tanpa kamu
  mengetik. Harganya: sangat lambat pada suite sebesar ini (tiap mutasi = satu run), dan mutasi yang
  dihasilkannya sintaktis (`+` → `-`) sementara mutasi yang penting di sini semantik ("pindahkan tulisan
  ini keluar transaksi") — yang tidak bisa dihasilkan otomatis.
- **Integration test dengan database sungguhan (Testcontainers).** Menangkap kelas bug yang mock tidak
  bisa: constraint nyata, isolation nyata, race nyata. Harganya: lambat, butuh Docker di CI, dan
  setup/teardown per test jadi pekerjaan tersendiri. Ini pelengkap yang benar untuk fase ini, bukan
  pengganti mutation testing.

**Latihan:** Pilih satu file spec yang **kamu** tulis di fase ini. Terapkan satu mutasi (hapus satu
klausa `where`), jalankan seluruh file spec-nya (bukan `jest -t`), dan catat apakah ada yang merah.
Verifikasi disiplinnya: jalankan juga `npx tsc -p tsconfig.json --noEmit` sebelum jest dan pastikan
jumlah error-nya sama dengan sebelum mutasi. Kalau spec-nya hijau, kamu menemukan lubang — tutup, lalu
ulangi mutasinya untuk membuktikan test barumu benar-benar membunuh.

---

### 5.14 Alternatif dibandingkan: peta keputusan konkurensi

Konsep terakhir bukan teknik baru melainkan **peta**. Kamu sudah bertemu semua alternatif ini
berserakan di 5.1–5.13; di sini mereka disatukan supaya kamu bisa menjawab pertanyaan yang akan ditanya
orang dalam wawancara dan dalam review desain: *"kenapa CAS, kenapa bukan X?"*

| Pilihan | Menang kalau | Harganya, konkret | Di repo ini |
|---|---|---|---|
| **CAS (`updateMany` + `count`)** | prasyaratnya bisa diekspresikan sebagai `WHERE` atas baris yang sama | tidak bisa melaporkan baris mana yang cocok → `adminForceCancel` harus dipecah jadi dua CAS (`deliveries.service.ts:964-1002`) | pilihan default; 7+ tempat |
| **`SELECT … FOR UPDATE`** | kamu butuh membaca **lalu** memutuskan, dan keputusannya tidak muat di `WHERE` | memegang row lock melintasi I/O jaringan; `deliveries.service.ts:1104-1105` menolaknya persis karena cleanup memanggil Stripe/MQTT | ditolak, dengan alasan tertulis |
| **`SERIALIZABLE` + retry** | logika transaksinya rumit dan kamu tidak mau menulis guard manual | wajib loop retry (`P2034`) yang harus diuji; throughput turun saat kontensi; PgBouncer transaction-pooling memperumit asumsi sesi | tidak dipakai |
| **Kolom `version`** | kamu butuh proteksi generik untuk semua field, bukan cuma status | satu round-trip baca ekstra; `WHERE version=7` tidak mendokumentasikan transisi legal | tidak dipakai |
| **Redlock (Redis)** | sumber daya yang diperebutkan bukan baris database | correctness bergantung asumsi jam; Redis jadi SPOF untuk kebenaran, bukan cuma performa | ditolak |
| **Transactional Outbox** | efeknya harus atomik dengan tulisan bisnis tapi diterapkan di tempat/waktu lain | satu tabel + satu dispatcher untuk dioperasikan dan dimonitor | dipakai (referral) |
| **CDC / Debezium** | kamu butuh nol beban di jalur tulis dan sudah punya Kafka | Kafka + connector; event berbentuk *row change*, bukan *intent* bisnis | dipertimbangkan untuk pelaporan lintas shard |
| **`LISTEN`/`NOTIFY`** | kamu cuma butuh **pemicu** ringan, bukan jaminan pengiriman | tidak durable — hilang kalau tidak ada listener terhubung | tidak dipakai |
| **Dedupe di Redis (`SET NX`)** | efek dobelnya tidak menyentuh uang | eviction/restart = kunci hilang = efek dobel | ditolak untuk uang |
| **Two-phase commit (XA)** | semua peserta bicara XA dan kamu mengontrol semuanya | Stripe tidak bicara XA; koordinator jadi SPOF; transaksi in-doubt diselesaikan manual | tidak mungkin di sini |
| **Temporal / Step Functions** | sagamu banyak, panjang, dan butuh visibilitas eksekusi | satu layanan lagi untuk dioperasikan; domain ditulis ulang sebagai activity | terlalu besar untuk 2 kompensasi |

Aturan praktis yang bisa kamu bawa keluar dari tabel ini, dan yang dipegang repo secara konsisten:
**jadikan database wasit tunggal setiap kali bisa.** Setiap kali kebenaran dipindahkan ke tempat lain
(Redis, koordinator, memori proses), kamu menambah satu komponen yang kegagalannya merusak data, bukan
sekadar memperlambat.

**Anchor:** kolom "Di repo ini" bisa kamu verifikasi satu per satu:
`src/deliveries/deliveries.service.ts:1104-1105` (kenapa bukan `FOR UPDATE`) ·
`src/outbox/outbox.service.ts:25-36` (kenapa outbox) · `prisma/schema.prisma:626-643` (dual-write) ·
`SCALING-1M.md:111-116` (kenapa satu transaksi besar memblokir shard) dan `:119` (kenapa debit-first
menang atas reserve-then-settle dan user-home-shard).

**Kenapa dipakai di sini:** karena kamu secara eksplisit ingin tahu alternatifnya, dan satu-satunya cara
memverifikasi bahwa kamu paham sebuah alternatif adalah bisa menyebut **harganya dengan angka atau
skenario**, bukan "tergantung kebutuhan".

**Alternatif:** (untuk peta ini sendiri) — kamu bisa juga menyusunnya berdasarkan *sumbu kegagalan* alih
alih *mekanisme*: apa yang terjadi kalau proses mati, kalau jaringan putus, kalau dua penulis datang
bersamaan, kalau pesan datang terbalik. Susunan itu lebih baik untuk mendesain sistem baru; susunan di
atas lebih baik untuk membaca sistem yang sudah ada.

**Latihan:** Tulis satu file `docs/learning/catatan/05-alternatif.md` yang menyalin tabel di atas, lalu
**tambahkan satu kolom**: "kapan aku akan memilih ini di proyekku sendiri". Isi tiap baris dengan
skenario konkret dari pengalamanmu (mis. "queue notifikasi di app Ionic yang tidak menyentuh uang →
dedupe Redis cukup"). Verifikasi: minta dirimu sendiri menjawab, untuk tiap baris, satu pertanyaan —
*apa gejala yang akan kulihat kalau aku salah memilih ini?* Kalau tidak bisa dijawab, kamu belum paham
harganya.

---

## Capstone

Dua artefak. Keduanya harus bisa **gagal di depan matamu** — bukan "dipahami".

### Artefak 1 — Suite test balapan tulisan sendiri

Buat file `src/deliveries/race.spec.ts` (atau tambahkan blok `describe` di spec yang ada). Kriteria
penerimaan:

- [ ] **Dua pemanggil bersamaan atas satu delivery.** Satu test menjalankan
      `Promise.all([svc.cancel(u, id), svc.confirmHandoff(u, id, code)])`. Tepat satu boleh berhasil.
- [ ] **Yang kalah mendapat 409**, bukan 500 dan bukan sukses diam-diam. Assert kelas exception-nya
      (`AppConflictException`) **dan** `messageKey`-nya.
- [ ] **Efek samping terjadi tepat sekali.** `expect(dispatchService.release).toHaveBeenCalledTimes(1)`
      dan `expect(walletService.refundForDelivery).toHaveBeenCalledTimes(1)`. Ini yang paling sering
      dilupakan: assert **jumlah**, bukan cuma "pernah dipanggil".
- [ ] **Satu test yang membuktikan urutan.** Buktikan bahwa `release` dipanggil **setelah** `updateMany`
      yang mengembalikan `count: 1` — mis. dengan `jest.fn` yang mencatat urutan panggilan ke satu array
      bersama.
- [ ] **Satu test untuk jalur uang debit-first.** Dengan `DELIVERY_DEBIT_FIRST=true`, mock
      `prisma.delivery.create` melempar error non-P2002 dan assert ketiga kompensasi terpanggil
      (`promoService.releaseForDelivery`, `walletService.refundForDelivery`, `dispatchService.release`).
- [ ] Seluruh file lulus dengan `npx jest src/deliveries/race.spec.ts`, dan
      `npx tsc -p tsconfig.json --noEmit` tetap di baseline error-nya.

### Artefak 2 — Laporan mutasi

Buat `docs/learning/catatan/05-mutasi.md`. Terapkan **lima mutasi berikut satu per satu** (kembalikan
kode ke keadaan bersih setelah tiap mutasi — `git checkout --` adalah temanmu):

| # | Mutasi | File |
|---|---|---|
| 1 | Hapus klausa `status: { in: CANCELABLE_STATUSES }` dari CAS `cancel()` | `src/deliveries/deliveries.service.ts:886` |
| 2 | Hapus `idempotencyKey: \`debit:${created.id}\`` dari pemanggilan `debitWithinTx` | `src/deliveries/deliveries.service.ts:447` |
| 3 | Keluarkan `tx.webhookEvent.create` dari `$transaction` (jadikan `this.prisma.webhookEvent.create` sebelum blok) | `src/payments/payments.service.ts:228` |
| 4 | Hapus `await this.compensateReservations(deliveryId);` di jalur `catch` reservasi | `src/deliveries/deliveries.service.ts:394` |
| 5 | Ganti `??` jadi `||` di `retentionFor` | `src/partition-maintenance/partition.constants.ts:74` |

Untuk tiap mutasi catat, dalam tabel:

- [ ] Perintah yang dijalankan (**seluruh file spec**, bukan `jest -t`), dan bahwa `tsc --noEmit` tetap
      di baseline **sebelum** jest dijalankan.
- [ ] Jumlah test yang dieksekusi. **Nol test = GAGAL, bukan lulus.** Kalau angkanya nol, path spec-mu
      salah.
- [ ] Nama test yang mati (atau "tidak ada").
- [ ] Untuk setiap mutasi yang **tidak membunuh test apa pun**: tulis test baru yang membunuhnya,
      tempel diff-nya, dan buktikan test itu merah dengan mutasi terpasang dan hijau tanpanya.

Prediksi jujur: mutasi 3 dan 5 kemungkinan besar tidak membunuh apa pun. Itu bukan kegagalanmu — itu
hasil yang paling berharga dari latihan ini.

### Penutup — satu entri `AUDIT-LOG.md`

Tulis satu entri bergaya `AUDIT-LOG.md` (template resminya di `AUDIT-PLAN.md:603-643`) dengan
**semua** bagian ini terisi:

- [ ] `## Phase 5 (belajar) — Konkurensi & uang — DONE` + Date/Session/Branch
- [ ] `### What changed` — tiap baris berbentuk `path/to/file.ts:LINE — apa dan kenapa`
- [ ] `### Verification` — hasil `tsc`, `lint`, jumlah test, plus baris **Manual:** yang menyebut apa
      yang benar-benar kamu jalankan di luar suite (dua sesi `psql`, webhook `curl` dobel, Redis dimatikan)
- [ ] `### Decisions made` — minimal satu keputusan yang sesi berikutnya tidak boleh balik diam-diam
- [ ] `### Deviations from the plan`
- [ ] **`### Left undone / follow-ups`** — bagian ini wajib dan tidak boleh kosong. Kalau kosong, kamu
      belum jujur.
- [ ] `### Next`

---

## Gerbang keluar

Kalau salah satu pertanyaan ini belum bisa kamu jawab **tanpa membuka kode**, jangan lanjut ke Fase 6.

**1. Kenapa `count === 0` dari sebuah `updateMany` aman diperlakukan sebagai "aku kalah balapan", padahal
tidak ada lock yang kamu ambil?**

<details><summary>Jawaban</summary>

Karena di Read Committed, `UPDATE` yang menunggu row lock akan **membaca ulang** baris setelah lock
dilepas, lalu **menguji ulang klausa `WHERE`-nya** terhadap nilai terbaru. Kalau prasyaratnya sudah tidak
cocok, ia melaporkan 0 baris. Jadi lock-nya ada — diambil dan dilepas oleh PostgreSQL untuk satu
statement — kamu hanya tidak menuliskannya. Yang penting: seluruh prasyarat harus ada **di dalam
`WHERE`**, bukan di `if` JavaScript sebelumnya. `outbox.service.ts:88-92`.
</details>

**2. Kenapa efek samping mahal (refund, release drone, notifikasi) selalu diletakkan SETELAH CAS, tidak
sebelum dan tidak di dalam transaksi?**

<details><summary>Jawaban</summary>

**Setelah**, karena `count > 0` hanya terjadi pada satu pemanggil — jadi efeknya otomatis exactly-once
tanpa distributed lock. Diletakkan sebelum CAS, semua pemanggil menjalankannya (double refund). **Di
luar transaksi**, karena efek-efek itu melakukan I/O jaringan; memegang transaksi terbuka melintasi
panggilan Stripe/MQTT akan menahan lock dan menghabiskan pool koneksi —
`deliveries.service.ts:1104-1105` menyebutnya *"deliberately OUTSIDE"*.
</details>

**3. Kenapa P2002 diperlakukan sebagai SUKSES di `outbox.service.ts` tapi sebagai 409 di
`drone-command.service.ts`?**

<details><summary>Jawaban</summary>

Karena artinya berbeda bagi pemanggilnya. Di outbox, P2002 berarti "efek ini sudah pernah diterapkan"
— tepat hasil yang diinginkan dari sebuah retry at-least-once, jadi baris ditandai `PROCESSED` alih-alih
di-retry jadi FAILED palsu. Di drone command, P2002 dari partial-unique "satu perintah terbuka per
delivery" berarti "admin lain baru saja mengirim perintah" — itu informasi yang harus sampai ke manusia
yang menekan tombol, jadi 409.
</details>

**4. Apa itu dual-write problem, dan kenapa "publish setelah commit" tidak menyelesaikannya?**

<details><summary>Jawaban</summary>

Dual-write problem: kamu tidak bisa menulis ke database DAN mengirim pesan ke sistem lain secara atomik.
"Publish setelah commit" gagal karena proses bisa mati **di antara** commit dan publish — datanya ada,
eventnya tidak akan pernah terkirim, dan tidak ada yang tahu. "Publish sebelum commit" gagal ke arah
sebaliknya (event hantu untuk transaksi yang di-rollback). Outbox menyelesaikannya dengan menjadikan
"niat mengirim" sebagai baris di database yang sama, sehingga ia ikut commit atau ikut rollback.
</details>

**5. Sebutkan empat larangan rute baca ke read replica, dan berikan satu contoh kegagalan konkret untuk
salah satunya.**

<details><summary>Jawaban</summary>

Jangan pernah untuk baca yang (1) menyuapi CAS, (2) dibandingkan/di-increment, (3) mengotorisasi
tulisan, (4) dikembalikan tepat setelah tulis. Contoh untuk (2): baca saldo dari replika yang tertinggal
300 ms, user baru saja membelanjakan saldonya di request sebelumnya, replika masih menunjukkan saldo
lama → sistem mengizinkan pembelanjaan kedua. `prisma.service.ts:68-74`.
</details>

**6. Kenapa `logout()` MENGHAPUS baris refresh token alih-alih menstempel `revokedAt`?**

<details><summary>Jawaban</summary>

Supaya `revokedAt` bermakna **tepat satu hal**: "digantikan oleh rotasi". Reuse detection menyimpulkan
serangan dari adanya baris revoked yang di-replay; kalau logout juga menghasilkan baris revoked, skenario
multi-device biasa (reset di HP, tablet mengirim token lama) akan memicu family-kill dan menghancurkan
sesi yang baru saja dibuat, plus mencatat peringatan keamanan palsu. Menghapus juga tidak lebih lemah —
baris yang tidak ada gagal di lookup. `auth.service.ts:205-213`.
</details>

**7. Kenapa `AirspaceService` menyimpan ROWS di cache dan menjalankan filter "sedang berlaku" setelahnya,
bukan menyimpan hasil filternya?**

<details><summary>Jawaban</summary>

Karena "sedang berlaku" bergantung pada **waktu**. Kalau yang disimpan adalah hasil filter, jendela waktu
dievaluasi sekali per pengisian cache, sehingga zona yang mulai berlaku karena jam (TFR terjadwal) tidak
aktif sampai satu TTL penuh berlalu — di **setiap** instance, termasuk yang membuatnya. Aturan umumnya:
cache input yang mahal, jangan keputusan yang bergantung waktu. `airspace.service.ts:42-48`.
</details>

**8. Kenapa `adminForceCancel` memakai DUA `updateMany` berurutan alih-alih satu dengan `notIn`
gabungan?**

<details><summary>Jawaban</summary>

Karena `updateMany` tidak bisa melaporkan **baris mana** yang ia cocokkan, sedangkan disposisi pesawat
bergantung pada status **asal**: dibatalkan sebelum lepas landas → `RETURN_TO_FLEET`; dibatalkan saat
mengudara → `GROUND_FOR_INSPECTION` (pesawat masih di atas sana dengan paketnya). Memecah jadi dua CAS
membuat jawabannya terbaca dari **CAS mana yang menang**. Gabungan keduanya persis sama dengan
`notIn: TERMINAL_STATUSES` lama, jadi apa yang boleh dibatalkan tidak berubah — hanya nasib airframe-nya.
`deliveries.service.ts:964-1002`.
</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| Test balapanmu **selalu hijau**, bahkan setelah kamu hapus klausa `where` dari CAS | Mock Prisma-mu mengembalikan `{count: 1}` tanpa peduli isi `where` — jadi testmu tidak menguji CAS, ia menguji bahwa `updateMany` dipanggil | Assert **argumennya**: `expect(prisma.delivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: CANCELABLE_STATUSES } }) }))`. Lalu jalankan mutasi #1 dari capstone dan pastikan test itu merah. |
| Test "audit ditulis di dalam transaksi" hijau, padahal kamu memindahkan tulisannya ke `this.prisma` | `prisma` dan `tx` adalah **objek `jest.fn` yang sama** di mock-mu, jadi tidak ada assertion yang bisa membedakannya | Ini kelas bug yang tercatat di repo (`admin-audit.service.ts:38-43`). Buat mock di mana `tx` adalah objek **berbeda**, lalu assert identitas: `expect(auditService.recordWithinTx).toHaveBeenCalledWith(txObject, expect.anything())`. |
| `count === 0` di jalur yang "seharusnya tidak mungkin kalah", padahal cuma kamu yang memakai sistemnya | Prasyarat di `WHERE` lebih sempit daripada keadaan nyata baris — mis. status sudah maju karena worker simulasi, atau kamu membandingkan `Float` uang yang kena pembulatan | `SELECT status, "creditBalance" FROM ... WHERE id='<id>';` **tepat sebelum** memanggil. Untuk uang, ingat `round2()` di `wallet.service.ts:13-15` — `9.999999` tidak `>= 10`. |
| Saldo bertambah dua kali setelah retry | Kunci idempotensi tidak deterministik (mengandung `uuid()` atau timestamp), atau `@unique`-nya tidak ada di migration meski ada di schema | `\d wallet_transactions` di `psql` dan cari `UNIQUE` pada `idempotencyKey`. Lalu `SELECT "idempotencyKey", count(*) FROM wallet_transactions GROUP BY 1 HAVING count(*) > 1;` |
| Uang terpotong tapi delivery tidak pernah ada, dan tidak ada yang mengembalikannya | Proses mati **di antara** transaksi reservasi dan transaksi delivery — kompensasi sinkron tidak jalan karena `catch` tidak pernah dieksekusi | Ini justru kasus yang dirancang untuk `OrphanReaperService`. Cek `ORPHAN_GRACE_MS` sudah lewat, lalu panggil `sweep()` manual dan baca lognya. Kalau kandidatnya tidak muncul, jalankan query anti-join di `orphan-reaper.service.ts:49-63` langsung di `psql`. |
| Webhook Stripe menjawab 400 terus di lokal | `constructEvent` fail-closed di dua tempat: mock mode menolak event tanpa tanda tangan, dan secret kosong ditolak | Cek `STRIPE_WEBHOOK_SECRET` terisi, lalu `stripe listen --forward-to localhost:3000/payments/webhook`. Jangan "perbaiki" dengan melewati verifikasi — itu persis lubang yang `stripe.service.ts:182-184` tutup. |
| Perubahan zona airspace/role tidak terlihat di pod lain | Cache in-process bersifat **per-pod**; `invalidate()` hanya membersihkan pod yang menerima request | Jalankan dua instance, ubah lewat satu, baca lewat yang lain, dan tunggu sampai TTL habis. Ini bukan bug — ini trade-off yang diakui repo (`src/admin/admin.service.ts:1035-1040`). Keputusannya: pindah ke Redis, atau tambah pub/sub invalidation. |
| Kamu mengubah kode, semua test hijau, tapi kamu tidak yakin apa pun | Persis kondisi §1.1: hijau bukan bukti | Jalankan protokol 5.13. Pilih satu klaim yang kamu percaya dijaga test, rusak kodenya, dan lihat. Kalau tidak ada yang mati, kamu baru menemukan pekerjaan sebenarnya. |

Satu catatan tentang bagian tersulit fase ini. Bukan CAS-nya — sintaksnya satu baris. Yang sulit adalah
**pertanyaan susulannya**: setelah kamu tahu siapa yang menang, apa yang terjadi pada dunia fisik? Apakah
pesawatnya kembali ke pool (`RETURN_TO_FLEET`), di-grounded (`GROUND_FOR_INSPECTION`), atau masih di
udara (`STILL_AIRBORNE`)? Tiga bug asli di `deliveries.service.ts` — jalur sukses `confirmHandoff` yang
tidak melepas pesawat, `cleanupAfterTermination` yang melepas pesawat yang masih terbang, dan
`failExceptional` yang mengembalikan pesawat bermasalah ke pool — semuanya lahir dari melewatkan
pertanyaan kedua itu, bukan dari salah menulis CAS-nya.

---

## Bacaan pendamping

**Di dalam repo — ini sumber "kenapa" yang sesungguhnya.**

| File | Yang dicari di sana |
|---|---|
| `src/deliveries/delivery-exceptions.ts` (78 baris) | Seluruh kosakata domain fase ini dalam satu file pendek. Baca komentar di atas tiap array — masing-masing menjelaskan satu pengecualian yang tampak sewenang-wenang. |
| `src/outbox/outbox.service.ts:25-36` | Definisi at-least-once terbaik di repo, plus kalimat "status bukan otoritas dedupe" yang harus kamu bisa ulangi dari ingatan. |
| `src/prisma/prisma.service.ts:68-79` | Empat larangan read replica, ditulis sebagai JSDoc di tempat pemakaiannya. Contoh bagus tentang di mana aturan operasional seharusnya hidup. |
| `src/deliveries/deliveries.service.ts:86-101` | Aturan shard-key, flag `DELIVERY_DEBIT_FIRST`, dan pointer ke satu pengecualian yang sengaja diambil. Perhatikan kalimat terakhirnya soal kenapa tidak ada nomor baris di situ. |
| `src/deliveries/deliveries.service.ts:381-393` | Paragraf terbaik di seluruh repo tentang kegagalan ambigu: transaksi yang commit lalu promise-nya reject. |
| `src/admin/audit/admin-audit.service.ts:32-48` | Kontrak "write wajib memakai `tx` pemanggil", plus penjelasan kenapa test naif tidak bisa menangkap pelanggarannya. |
| `SCALING-1M.md` §2 (`:93-136`) | Kenapa satu `$transaction` besar adalah HARD BLOCKER, dan bagaimana tiga desain saga dibandingkan sebelum satu dipilih. Baca setelah 5.7 dan 5.8. |
| `AUDIT-PLAN.md:62-71` (§1.1) | Angka 1.073 test hijau di atas fitur yang tidak bisa dijangkau. Baca ini sebelum menulis test apa pun di fase ini. |
| `AUDIT-PLAN.md:603-643` (§5) | Template entri `AUDIT-LOG.md` yang harus kamu pakai di capstone. |
| `AUDIT-LOG.md:2069-2078` | Protokol mutation testing beserta aturan anti-menipu-dirinya. |
| `AUDIT-LOG.md:301-313` | Cerita lengkap dua regresi rotasi refresh token — rotasi non-atomik dan `revokedAt` yang bermakna ganda. |
| `docs/superpowers/specs/2026-08-02-operator-audit-log-design.md:77-93`, `:121-125` | Kenapa `actorUserId` tanpa FK, kenapa `actorRole` di-snapshot, dan aturan "audit co-commit dengan transisi, bukan dengan cleanup". |

**Dokumentasi resmi — hanya tiga, dan hanya karena benar-benar perlu.**

- [PostgreSQL: Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) —
  baca **hanya** §13.2.1 (Read Committed). Paragraf tentang `UPDATE` yang membaca ulang baris setelah
  menunggu lock adalah satu-satunya bagian yang wajib; sisanya bisa menunggu.
- [Prisma: Error reference](https://www.prisma.io/docs/orm/reference/error-reference) — untuk memastikan
  arti `P2002`, `P2034`, dan kode kelas koneksi `P1001`/`P1002`/`P1008`/`P1017` yang dipakai
  `isConnectionError`.
- [Stripe: Webhook signature verification](https://docs.stripe.com/webhooks/signatures) — khususnya
  bagian kenapa payload **mentah** yang ditandatangani; itu menjelaskan `rawBody: true` di `main.ts`.

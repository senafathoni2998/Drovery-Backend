# Peta Belajar — `backend:data-layer` (PostgreSQL + Prisma di Drovery)

> Untuk pembaca: developer frontend Ionic React + Capacitor. Kamu sudah paham React,
> TypeScript, dan cara **meng-konsumsi** REST. Yang belum: bagaimana data itu **disimpan**,
> **dijamin benar**, dan **tetap cepat saat jumlahnya jutaan**.
>
> Analogi pembuka yang dipakai sepanjang dokumen ini:
> - **`schema.prisma`** = deklarasi tipe TypeScript-mu, tapi untuk database. Satu file, jadi
>   sumber kebenaran.
> - **`prisma/migrations/*`** = commit history untuk struktur database. Sama seperti git:
>   berurutan, tidak boleh diedit setelah dipakai orang lain.
> - **Prisma Client** = "SDK" yang di-generate dari schema itu, type-safe, mirip `fetch`
>   wrapper yang kamu tulis di app tapi ke database.
>
> Satu hal yang membedakan repo ini dari tutorial: **komentar di dalam kode menyebutkan
> ALASAN**, bukan cuma apa. Setiap konsep di bawah dikutip dari komentar/dokumen asli,
> bukan dari teori umum. Kalau kamu cuma punya waktu membaca satu file, baca
> `prisma/schema.prisma` dari atas ke bawah — itu sudah setengah kurikulum.

**Urutan file untuk pemula (baca berurutan):**

1. `prisma/schema.prisma` — peta seluruh domain
2. `prisma/migrations/20260326134037_init/migration.sql` — SQL mentah yang Prisma hasilkan
3. `src/prisma/prisma.service.ts` — bagaimana client dipakai di NestJS
4. `prisma/seed.ts` — data awal + konsekuensi partisi
5. `src/cache/cache.service.ts` — caching paling sederhana yang bisa ada
6. `prisma/PARTITIONING.md` — runbook operasional (baca terakhir, setelah 1–5)

---

## 1. Model → Tabel: `schema.prisma` sebagai peta

- **Prasyarat:** —
- **Anchor:** `prisma/schema.prisma:1-7` (blok `generator` + `datasource`),
  `prisma/schema.prisma:17-70` (`model User` → `@@map("users")`),
  `prisma.config.ts:4-13` (URL database + perintah seed, Prisma 7).
- **Kenapa dipakai di sini:** Satu file mendeklarasikan ~30 tabel. `provider = "postgresql"`
  di baris 6 memilih dialek SQL-nya; `generator client { provider = "prisma-client-js" }`
  yang menghasilkan tipe TypeScript yang dipakai seluruh `src/`. Perhatikan `@@map("users")`
  di `schema.prisma:69`: nama model di TypeScript **PascalCase singular** (`User`), nama
  tabel di database **snake_case plural** (`users`). Ini konsisten di semua model
  (`@@map("delivery_ratings")`, `@@map("promo_codes")`, …) — dua konvensi penamaan yang
  berbeda dijembatani sekali di sini, bukan di setiap query.
  Di Prisma 7 URL database **tidak** ada di `datasource`; ia dibaca dari `prisma.config.ts:7`
  (`process.env.DATABASE_URL`) — jadi schema aman di-commit tanpa kredensial.
- **Alternatif:**
  - **TypeORM / MikroORM (decorator di kelas entity)** — schema tersebar di banyak file
    entity, lebih "Nest-y", tapi kamu kehilangan satu file yang bisa dibaca sebagai peta,
    dan migration generator-nya jauh lebih rapuh.
  - **Drizzle ORM** — schema ditulis sebagai TypeScript murni (tanpa DSL baru, tanpa langkah
    `generate`), SQL yang dihasilkan lebih transparan; tapi tooling migration + introspeksi
    lebih mentah dan tidak ada `prisma studio`.
  - **SQL mentah + `pg`** — kontrol penuh, nol abstraksi; harganya: tidak ada type-safety,
    setiap query manual, dan tidak ada migration tooling.
- **Latihan:** Buka `schema.prisma` dan buat daftar semua `@@map(...)`. Lalu jalankan
  `npx prisma studio` dan cocokkan: apakah setiap nama tabel yang kamu lihat di Studio ada
  di daftarmu? Tabel apa yang muncul di database tapi TIDAK ada di daftar? (Jawaban: partisi
  anak seperti `notifications_y2026m06` — lihat konsep #17, dan itulah alasan
  `prisma db pull` dilarang di repo ini.)

---

## 2. Kolom: tipe, default, nullable, dan tipe khas PostgreSQL

- **Prasyarat:** #1
- **Anchor:** `prisma/schema.prisma:18-47` (`User`: `String @id @default(uuid())`,
  `DateTime @default(now())`, `DateTime @updatedAt`),
  `prisma/schema.prisma:324` (`packageTypes String[]` — array native PG),
  `prisma/schema.prisma:537` (`routeJson Json?`),
  `prisma/schema.prisma:869` (`content String @db.VarChar(2000)`),
  `prisma/schema.prisma:960` (`phase String? @db.VarChar(32)`),
  `prisma/migrations/20260326134037_init/migration.sql:8-21` (hasil SQL-nya).
- **Kenapa dipakai di sini:** Tanda `?` = nullable, tanpa `?` = `NOT NULL`. Bandingkan
  `schema.prisma:20` (`name String` — wajib) vs `:21` (`phone String?` — opsional). Lalu
  lihat SQL yang dihasilkan di `init/migration.sql:11` (`"name" TEXT NOT NULL`) vs `:12`
  (`"phone" TEXT`). Ini pemetaan 1:1 yang harus kamu bisa baca dua arah.
  Tipe khusus punya alasan eksplisit: `@db.VarChar(2000)` di `schema.prisma:869` membatasi
  isi pesan chat di **level database**, bukan cuma di DTO — validasi aplikasi bisa di-bypass
  oleh script/seed, batas kolom tidak. `Json?` di `:537` dipakai untuk `routeJson` karena
  bentuk rute berubah-ubah dan tidak pernah di-query per-field.
  `packageTypes String[]` (`:324`) memakai array native PostgreSQL, bukan tabel join —
  karena nilainya tag pendek yang selalu dibaca sekaligus bersama delivery-nya.
- **Alternatif:**
  - **`Json` vs kolom terpisah** — `Json` fleksibel tanpa migration, tapi tidak bisa
    di-index/di-constraint dengan mudah dan tidak type-safe. Repo ini memakai `Json` hanya
    untuk payload buram (`AdminAuditLog.before/after/args` di `schema.prisma:1026-1031`,
    `OutboxEvent.payload` di `:649`) — data yang memang tidak pernah di-filter di SQL.
  - **`String[]` vs tabel relasi `package_types`** — tabel relasi memungkinkan query
    "semua delivery bertipe healthcare" dengan index yang bagus + integritas referensial;
    array lebih murah untuk baca-tulis sekaligus. Trade-off: array tidak bisa punya FK.
  - **`Float` vs `Decimal` untuk uang** — repo ini memakai `Float` (`creditBalance` di
    `schema.prisma:41`, `amount` di `:785`). Itu keputusan yang **berisiko** untuk uang
    (binary floating point tidak eksak); mitigasinya terlihat di `src/wallet/wallet.service.ts:13-15`
    (`round2()` dipanggil di setiap tulis) dan `CHECK (creditBalance >= 0)` di database.
    `Decimal` (`NUMERIC`) akan menghilangkan seluruh kelas bug ini dengan harga: aritmetika
    lebih lambat dan tipe `Decimal.js` di client, bukan `number` biasa.
- **Latihan:** Cari semua kolom bertipe `Float` di `schema.prisma` yang menyimpan **uang**
  (petunjuk: `creditBalance`, `amount`, `balanceAfter`, `estimatedPrice`, `discountValue`,
  `finalTotal`). Tulis catatan singkat: kalau kamu mengubahnya jadi `Decimal @db.Decimal(12,2)`,
  file `.ts` mana saja yang akan gagal compile? (Jalankan `npx prisma generate && npm run build`
  di branch percobaan untuk melihat jawabannya — jangan commit.)

---

## 3. Primary key & unique constraint: identitas baris

- **Prasyarat:** #2
- **Anchor:** `prisma/schema.prisma:18-19` (`id String @id @default(uuid())`,
  `email String @unique`), `prisma/schema.prisma:44` (`referralCode String? @unique`),
  `prisma/schema.prisma:221` (`ingestKeyHash String? @unique`),
  `prisma/schema.prisma:224-228` (**`activeDeliveryId String? @unique` — unique sebagai LOCK**),
  `prisma/schema.prisma:618-624` (`WebhookEvent.id` = id event Stripe sebagai PK),
  `prisma/schema.prisma:890` (`@@unique([userId, pushToken])` — unique gabungan).
- **Kenapa dipakai di sini:** Ini konsep terpenting sebelum masuk ke concurrency. Komentar di
  `schema.prisma:178-182` menjelaskannya paling jelas:
  > `activeDeliveryId` **is the claim AND the lock**: it is UNIQUE, so the database itself
  > refuses to let one aircraft hold two deliveries.
  Jadi `@unique` bukan sekadar validasi — ia **aturan bisnis yang dipaksakan oleh database**,
  yang tetap berlaku walau ada 10 pod API yang race secara bersamaan. Kode aplikasi tidak
  bisa memberi jaminan itu; `if (sudahDipakai) throw` selalu punya celah antara cek dan tulis.
  `WebhookEvent` (`:618-624`) memakai ide yang sama secara ekstrem: **PK-nya adalah id event
  Stripe**, jadi event yang dikirim ulang otomatis bentrok. Baca komentarnya:
  > Stripe delivers webhooks AT-LEAST-ONCE and can reorder them, so the event id (evt_…) is
  > the PK: a redelivered event collides (P2002) and is skipped, making the handler
  > effectively-once.
  `@@unique([userId, pushToken])` di `:890` mengajarkan unique **gabungan**: satu user boleh
  punya banyak device, satu push token boleh muncul di banyak user (jarang, tapi mungkin),
  yang dilarang hanya **pasangan** yang sama dua kali.
- **Alternatif:**
  - **UUID vs auto-increment `Int`** — auto-increment lebih kecil dan lebih cepat di index,
    tapi bocor informasi (jumlah user bisa ditebak dari id) dan tidak bisa dibuat client-side.
    Repo ini butuh yang kedua: `SCALING-1M.md §2` mencatat "pre-generate `deliveryId` in
    `create()`" agar kunci idempotensi uang bisa diketahui **sebelum** baris ada — mustahil
    dengan auto-increment.
  - **UUIDv4 vs UUIDv7/ULID** — v4 acak total sehingga insert menyebar ke seluruh B-tree
    (page split lebih banyak); v7/ULID terurut waktu sehingga insert lebih ramah cache.
    Untuk tabel append-heavy seperti `flight_frames` ini ukuran yang nyata.
  - **Cek di aplikasi (`findFirst` lalu `create`)** — mudah dibaca, tapi bukan jaminan:
    dua request bersamaan sama-sama lolos cek. Constraint database adalah satu-satunya
    jawaban yang benar; itu yang dipakai di sini secara konsisten.
- **Latihan:** Di `psql`, jalankan `INSERT INTO drones (...) ` dua kali dengan
  `"activeDeliveryId"` yang sama (isi kolom NOT NULL lain dengan nilai dummy). Baca pesan
  error PostgreSQL-nya. Lalu cari di `src/dispatch/dispatch.service.ts:181` bagaimana kode
  menerjemahkan error itu — komentarnya menyebut kenapa P2002 di sini "turns a recoverable
  blip into a …".

---

## 4. Relasi & foreign key: `1:N`, `1:1`, dan arti `onDelete`

- **Prasyarat:** #3
- **Anchor:** `prisma/schema.prisma:49-67` (daftar relasi di `User`),
  `prisma/schema.prisma:91-95` (`SavedAddress` → `User`, `onDelete: Cascade`),
  `prisma/schema.prisma:864-867` (`SupportChatMessage.senderUser`, **`onDelete: SetNull`**),
  `prisma/schema.prisma:1001-1008` (`AdminAuditLog.actorUserId` — **sengaja TANPA FK**),
  `prisma/schema.prisma:459-461` (`RecurringDelivery.lastDeliveryId` — "provenance only;
  intentionally NO FK"),
  `prisma/migrations/20260326134037_init/migration.sql` (bagian `AddForeignKey`).
- **Kenapa dipakai di sini:** Tiga pilihan `onDelete` diajarkan dengan kontras yang tajam
  dalam satu repo:
  - **`Cascade`** (`schema.prisma:94`): hapus user → alamat tersimpan ikut hilang. Benar,
    karena data itu tidak punya makna tanpa pemiliknya.
  - **`SetNull`** (`schema.prisma:864-866`): hapus user → pesan support tetap ada, pengirimnya
    jadi `null`. Komentarnya: *"SetNull (not Cascade) so deleting a user preserves the readable
    thread."* Thread percakapan tetap bisa dibaca.
  - **Tanpa FK sama sekali** (`schema.prisma:1001-1008`) — ini yang paling instruktif:
    > `actorUserId` carries NO foreign key… for an audit log SetNull is the wrong trade: it
    > preserves the row while destroying its single most important field… A plain column
    > cannot be nulled by a cascade.
    Jadi keputusan "pakai FK atau tidak" adalah keputusan **produk**, bukan gaya coding.
  Perhatikan juga sisi Prisma vs sisi SQL: di Prisma satu relasi ditulis dua kali (field
  `user User @relation(...)` di anak, dan `savedAddresses SavedAddress[]` di induk), tapi di
  SQL hanya ada satu `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`. Array di sisi induk itu
  **virtual** — tidak ada kolom untuknya.
- **Alternatif:**
  - **FK dengan `ON DELETE CASCADE` vs soft-delete (`deletedAt`)** — cascade menghapus
    beneran (bagus untuk GDPR, buruk untuk audit); soft-delete menyimpan semuanya tapi setiap
    query harus ingat `WHERE deletedAt IS NULL` (dan sekali lupa = kebocoran data).
    Repo ini memakai pola ketiga untuk `AirspaceZone` (`schema.prisma:1076-1080`):
    *"Deactivation is also how a zone is 'deleted' — the row is kept, because a zone that once
    existed is part of why a past delivery was refused."*
  - **Tanpa FK sama sekali (integritas dijaga aplikasi)** — dipakai MongoDB dan sebagian sistem
    ber-shard. Lebih cepat menulis, tapi setiap bug aplikasi meninggalkan baris yatim yang
    tidak akan pernah dideteksi. Repo ini memilih ini hanya di tempat yang alasannya ditulis
    (`schema.prisma:461`, `:710`, `:787`) — dan `SCALING-1M.md §2` menjelaskan bahwa ketiadaan
    FK itulah yang **memungkinkan** saga debit-first nanti.
- **Latihan:** Buat user baru lewat `prisma/seed.ts`, tambahkan satu `SavedAddress` dan satu
  `SupportChatMessage` untuknya, lalu `DELETE FROM users WHERE id='…'` di `psql`. Catat apa
  yang terjadi pada kedua baris itu. Ulangi dengan menambahkan baris `admin_audit_logs`
  ber-`actorUserId` sama — kenapa baris itu selamat tanpa error FK?

---

## 5. Enum: himpunan nilai yang dipaksakan database

- **Prasyarat:** #2
- **Anchor:** `prisma/schema.prisma:11-15` (`enum Role`),
  `prisma/schema.prisma:241-258` (`DeliveryStatus` — perhatikan komentar tentang cabang
  exception), `prisma/schema.prisma:263-270` (`DeliveryFailureReason` + alasan refund),
  `prisma/schema.prisma:34-37` (**`locale String @default("en")` — sengaja BUKAN enum**),
  `prisma/migrations/20260809133410_add_airspace_zones/migration.sql:4-10`
  (`ALTER TYPE … ADD VALUE`).
- **Kenapa dipakai di sini:** Enum di PostgreSQL adalah **tipe baru** (`CREATE TYPE`), bukan
  string dengan validasi. Nilai di luar daftar ditolak database. Repo ini memakainya untuk
  state machine (`DeliveryStatus`) dan komentarnya menjelaskan struktur yang tidak terlihat
  dari daftar nilainya:
  > Exception outcomes — BRANCHES off the happy path, deliberately OUTSIDE `STATUS_ORDER`
  > (simulation.constants.ts) so the monotonic forward CAS can never enter them and a
  > terminal can't be resurrected.
  Kontras terbaiknya ada di `schema.prisma:34-37`: `locale` **sengaja tidak** dijadikan enum —
  > A plain string (not an enum) so the set extends without a migration; I18nService
  > normalizes any unknown value to the default ('en').
  Itu aturan praktis yang bisa kamu bawa: **enum untuk himpunan yang berubahnya butuh review
  kode; string untuk himpunan yang tumbuh bebas.**
  Biaya enum terlihat di `add_airspace_zones/migration.sql:4-10`: menambah satu nilai butuh
  `ALTER TYPE … ADD VALUE`, alias sebuah migration.
- **Alternatif:**
  - **Tabel lookup (`statuses` dengan FK)** — nilai bisa ditambah/dihapus tanpa DDL dan bisa
    membawa metadata (label, urutan, warna); harganya JOIN di setiap query dan hilangnya
    type-safety enum di TypeScript.
  - **`String` + `CHECK (status IN (...))`** — mirip enum, mengubahnya lebih mudah
    (`ALTER … DROP/ADD CONSTRAINT`) tapi Prisma tidak akan menghasilkan tipe union untukmu.
  - **`String` polos + validasi di DTO** — pilihan `locale` di atas; paling fleksibel,
    paling tidak aman. Repo ini menutup lubangnya dengan normalisasi di `I18nService`.
- **Latihan:** Tambahkan nilai `SUSPENDED` ke `enum DroneStatus`, jalankan
  `npx prisma migrate dev --name add_drone_suspended`, lalu **baca file migration yang
  dihasilkan**. Bandingkan dengan `add_airspace_zones/migration.sql:5-7`. Kenapa PostgreSQL
  tidak mengizinkan `ALTER TYPE … ADD VALUE` di dalam transaksi yang sama dengan pemakaiannya?

---

## 6. Index: kenapa ada, dan kenapa urutan kolomnya penting

- **Prasyarat:** #3, #4
- **Anchor:** `prisma/schema.prisma:103-104` (`@@index([userId])` + `@@index([userId, isDefault])`),
  `prisma/schema.prisma:419` (`@@index([droneId, status])` — komentar: *"hot poll predicate:
  one drone's open queue"*),
  `prisma/schema.prisma:481` (`@@index([active, nextRunAt])` — *"hot scan predicate"*),
  `prisma/schema.prisma:662` (`@@index([status, createdAt])` — *"Supports the dispatcher claim
  … and the reaper"*),
  `prisma/schema.prisma:968-969` (dua index di `FlightFrame`),
  `prisma/schema.prisma:235` (`@@index([status, airworthy])`).
- **Kenapa dipakai di sini:** Setiap `@@index` di repo ini punya komentar yang menyebut **query
  mana** yang dilayaninya. Itu tepat cara berpikir yang benar: index bukan hiasan, ia jawaban
  atas satu `WHERE`/`ORDER BY` yang nyata. Contoh paling jelas `schema.prisma:660-662`:
  index `(status, createdAt)` melayani DUA query sekaligus di
  `src/outbox/outbox.service.ts:71-76` (`WHERE status='PENDING' ORDER BY createdAt`) dan
  `:157-163` (reaper: `WHERE status='PROCESSING'`).
  **Urutan kolom** adalah pelajaran intinya: index `(userId, isDefault)` bisa dipakai untuk
  `WHERE userId = ?` saja (prefix kiri), tapi index `(isDefault, userId)` tidak bisa. Karena
  itu `SavedAddress` bisa punya `@@index([userId])` yang sebenarnya redundan — cek sendiri
  apakah masih perlu.
  Perhatikan juga bahwa `@unique` **otomatis membuat index** (lihat `init/migration.sql`:
  setiap `CREATE UNIQUE INDEX`), jadi kamu tidak perlu menambahkan `@@index` di atas kolom
  yang sudah `@unique`.
- **Alternatif:**
  - **B-tree (default) vs GIN** — untuk `packageTypes String[]` atau kolom `Json`, B-tree
    tidak berguna; GIN (`@@index([packageTypes], type: Gin)`) mendukung operator `@>`.
    Harganya: index lebih besar dan tulis lebih lambat.
  - **Partial index** (`WHERE status IN ('PENDING','FETCHED')`) — jauh lebih kecil kalau hanya
    sebagian kecil baris yang di-query. Repo ini memakainya sebagai *unique*, lihat konsep #7.
  - **Covering index (`INCLUDE`)** — menghindari lookup ke heap; tidak dipakai di sini dan
    memang belum perlu pada volume ini.
  - **Tanpa index** — tulis lebih cepat, baca `O(n)`. Setiap index adalah pajak pada setiap
    `INSERT`/`UPDATE`; itu sebabnya tabel append-heavy seperti `flight_frames` hanya punya
    dua (`schema.prisma:968-969`), bukan lima.
- **Latihan:** Di `psql`, jalankan
  `EXPLAIN ANALYZE SELECT * FROM saved_addresses WHERE "userId" = '<id>' AND "isDefault" = true;`
  Catat apakah PostgreSQL memilih `saved_addresses_userId_isDefault_idx`. Lalu jalankan
  `EXPLAIN ANALYZE SELECT * FROM saved_addresses WHERE "isDefault" = true;` — index yang sama
  dipakai atau tidak? Jelaskan hasilnya dengan aturan "prefix kiri".

---

## 7. Constraint yang Prisma tidak bisa ungkapkan: `CHECK` & partial unique index

- **Prasyarat:** #3, #6
- **Anchor:**
  `prisma/migrations/20260613050000_add_wallet_referrals/migration.sql:10-11`
  (`CHECK ("creditBalance" >= 0)` + komentar *"Defense-in-depth: the spend CAS guards balance
  >= amount; this backstops it."*),
  `prisma/migrations/20260613042513_add_promo_codes/migration.sql:62-66`
  (partial unique per-user),
  `prisma/migrations/20260613231012_add_drone_commands/migration.sql:39-42`
  (satu perintah terbuka per delivery),
  `prisma/schema.prisma:721-724` (komentar yang **melarang** menambahkan `@@unique` di Prisma),
  `prisma/schema.prisma:39-41` (sisi model dari CHECK itu).
- **Kenapa dipakai di sini:** Ini titik di mana kamu harus berhenti percaya bahwa schema Prisma
  = seluruh schema database. Dua constraint terpenting di repo ini **tidak ada** di
  `schema.prisma`, hanya di file `migration.sql`, dan komentarnya menjelaskan kenapa:
  > A PARTIAL unique index (promoCodeId,userId) WHERE status='REDEEMED' enforces the per-user
  > limit (=1) race-free; it is hand-added in migration.sql because Prisma can't express a
  > partial unique. **(Do NOT add `@@unique` here — a full unique would block
  > cancel-then-reapply.)** — `schema.prisma:721-724`
  Baca kalimat terakhir itu dua kali: unique penuh akan **benar secara teknis tapi salah secara
  produk** — user yang membatalkan pesanan tidak bisa memakai kode promo itu lagi.
  Pola yang sama di `drone_commands`: `WHERE "status" IN ('PENDING','FETCHED')` berarti "boleh
  banyak perintah yang sudah selesai, hanya boleh satu yang masih terbuka". Dua admin yang
  menekan tombol bersamaan → P2002 → HTTP 409 (`src/deliveries/commands/drone-command.service.ts:179-182`).
  Konsekuensi operasional: constraint semacam ini **tidak terlihat** oleh `prisma migrate diff`
  sebagai bagian dari model, jadi ia gampang hilang saat seseorang menulis ulang migration.
  Itulah kenapa keduanya diberi komentar besar di dua tempat (schema + migration).
- **Alternatif:**
  - **Validasi di service (`findFirst` lalu `throw`)** — mudah, tapi bocor di bawah concurrency.
    Repo ini justru memakai partial unique **sebagai** mekanisme concurrency-nya.
  - **`SELECT … FOR UPDATE` (pessimistic lock)** — benar juga, tapi menahan lock lebih lama dan
    membuat throughput turun; partial unique tidak memerlukan lock apa pun.
  - **Trigger PL/pgSQL** — bisa mengekspresikan aturan apa pun, tapi tersembunyi dari pembaca
    schema dan sulit di-debug. Repo ini memakai plpgsql hanya untuk maintenance partisi
    (konsep #18), bukan untuk aturan bisnis.
- **Latihan:** Di `psql`, ambil satu user dan jalankan
  `UPDATE users SET "creditBalance" = -1 WHERE id = '<id>';`. Baca error-nya. Lalu cari di
  `src/wallet/wallet.service.ts:65-75` mekanisme lapis-pertama yang seharusnya tidak pernah
  membiarkannya sampai ke sana — dan jawab: kalau lapis pertama sudah benar, kenapa CHECK-nya
  tetap ada?

---

## 8. Migration = DDL berversi (plus backfill, urutan, dan gerbang drift)

- **Prasyarat:** #1–#7
- **Anchor:** `prisma/migrations/` (38 folder, terurut timestamp),
  `prisma/migrations/20260326134037_init/migration.sql` (baseline yang di-generate),
  `prisma/migrations/20260613050000_add_wallet_referrals/migration.sql:13-18`
  (**backfill SEBELUM unique index**),
  `prisma/migrations/20260801030416_add_drone_fleet_entity/migration.sql:42-91`
  (**backfill SEBELUM foreign key**, dengan alasan panjang),
  `prisma/migrations/20260809133410_add_airspace_zones/migration.sql:35-43`
  (data migration yang *load-bearing*),
  `prisma/PARTITIONING.md:72-76` (gerbang drift CI),
  `package.json:26-31` (`prisma:migrate`, `db:reset`, `prisma:drift-check`).
- **Kenapa dipakai di sini:** Sebuah migration adalah **satu langkah tidak bisa diulang** yang
  mengubah struktur database, disimpan sebagai SQL mentah dan dijalankan berurutan di setiap
  environment (`prisma migrate deploy`). Sekali dipakai orang lain, isinya tidak boleh diedit —
  sama persis dengan commit yang sudah di-push.
  Tiga pelajaran yang hanya bisa dipelajari dari migration nyata:
  1. **Urutan operasi menentukan berhasil/gagal.** `add_wallet_referrals/migration.sql:13-18`
     mengisi `referralCode` untuk semua user lama **sebelum** membuat unique index — kalau
     dibalik, index gagal karena banyak `NULL`… atau lebih buruk, semua baris punya nilai sama.
     `add_drone_fleet_entity/migration.sql:42-56` lebih ekstrem lagi:
     > Adding the FK below against a POPULATED table would fail on every one of them, so
     > materialise an aircraft row for each distinct id first.
     Dan pilihan nilai backfill-nya pun disengaja: *"maxPayloadKg 0 and homeBase 0,0 are NOT
     NULL placeholders chosen to be obviously unusable rather than plausibly wrong"*.
  2. **Migration bisa memindahkan DATA, bukan cuma struktur.**
     `add_airspace_zones/migration.sql:35-43` memindahkan dua zona bandara dari sebuah konstanta
     TypeScript ke tabel — dan komentarnya menandai bahayanya:
     > This is load-bearing. Task 3 deletes that constant, and without these rows the geometry
     > would simply find no zones — the airspace this system protects would open silently, with
     > every test still green.
  3. **Drift gate.** Karena banyak DDL di repo ini ditulis tangan (partisi, partial unique),
     harus ada yang memastikan schema dan database tidak berpisah jalan:
     `npm run prisma:drift-check` = `prisma migrate diff --from-config-datasource
     --to-schema prisma/schema.prisma --exit-code`, harus "No difference".
- **Alternatif:**
  - **`prisma db push`** — langsung menyamakan database dengan schema, tanpa file riwayat.
    Cepat untuk prototipe; di repo ini **DILARANG KERAS** (`PARTITIONING.md:65-71`) karena
    ia akan membuat ulang tabel terpartisi sebagai tabel biasa — kehilangan data dan kontrak.
  - **Flyway / Liquibase / node-pg-migrate** — migration SQL murni tanpa ORM; kontrol penuh dan
    dukungan repeatable migration, tapi kehilangan sinkronisasi otomatis dengan tipe TypeScript.
  - **Auto-sync ORM (`synchronize: true` di TypeORM)** — nyaman di dev, berbahaya di produksi
    (bisa menghapus kolom diam-diam). Sama kelasnya dengan `db push`.
- **Latihan:** Tambahkan kolom `nickname String?` ke `model Drone`, jalankan
  `npx prisma migrate dev --name add_drone_nickname`, baca SQL yang dihasilkan, lalu jalankan
  `npm run prisma:drift-check` (harus bersih). Sekarang **secara manual** tambahkan
  `CREATE INDEX drones_nickname_idx ON drones(nickname);` ke file migration itu, reset
  database (`npm run db:reset`), dan jalankan drift-check lagi. Apakah masih bersih? Kenapa?
  (Ini menunjukkan kelas objek apa yang bisa "hilang" dari pandangan Prisma.)

---

## 9. Seed & reference data

- **Prasyarat:** #8
- **Anchor:** `prisma/seed.ts:15-46` (`upsert` idempoten untuk user + admin),
  `prisma/seed.ts:136-156` (**find-or-create karena `deliveries` terpartisi**),
  `prisma/seed.ts:187-218` (promo code yang "mirror" migration),
  `prisma/migrations/20260613042513_add_promo_codes/migration.sql:68-74`
  (`INSERT … ON CONFLICT DO NOTHING`),
  `prisma.config.ts:10-12` (`migrations.seed`).
- **Kenapa dipakai di sini:** Seed harus **idempoten** — bisa dijalankan berkali-kali tanpa
  menggandakan data. Repo ini memakai dua teknik: `upsert` di sisi Prisma (`seed.ts:15`,
  `:189`) dan `ON CONFLICT ("code") DO NOTHING` di sisi SQL (`add_promo_codes:74`).
  Yang paling instruktif adalah `seed.ts:136-145`, karena ia memperlihatkan **konsekuensi nyata
  partisi** jauh sebelum kamu membaca bab partisi:
  > `deliveries` is partitioned (composite PK) so trackingId is no longer a unique-where;
  > idempotent find-or-create, and the trackingId-registry row (which the service create()
  > writes) must be created here too since the seed bypasses the service.
  Perhatikan juga garis batas kepemilikan yang disebut di `schema.prisma:666-668`: promo code
  adalah *reference data* yang sumber kebenarannya ada di **migration**, dan `seed.ts` hanya
  menegaskannya ulang untuk dev lokal.
- **Alternatif:**
  - **Seed lewat migration saja** — data ikut ter-deploy ke semua environment secara otomatis
    dan ter-versi; tapi tidak bisa dijalankan ulang sesuka hati dan tidak cocok untuk data demo.
  - **Fixture per-test (factory)** — isolasi test jauh lebih baik; tapi tidak memberi database
    dev yang bisa langsung dipakai dari aplikasi mobile.
  - **Dump SQL** — cepat dan realistis; tapi buram, tidak bisa di-review, dan cepat basi
    terhadap schema.
- **Latihan:** Jalankan `npm run prisma:seed` **dua kali** berturut-turut. Hitung baris di
  `deliveries` dan `tracking_id_registry` setelah masing-masing run — harus sama. Lalu hapus
  blok `if (existing) continue;` di `seed.ts:145`, jalankan lagi, dan lihat error apa yang
  muncul dari `trackingIdRegistry.create` (petunjuk: kode error Prisma-nya sama dengan yang
  dipakai untuk retry di `deliveries.service.ts`).

---

## 10. `PrismaService`: client, connection pool, DI, dan siklus hidup

- **Prasyarat:** #1, dasar NestJS DI (dari area `backend:framework`)
- **Anchor:** `src/prisma/prisma.service.ts:30-35` (pool + `PrismaPg` adapter + `omit`),
  `src/prisma/prisma.service.ts:14-16` (`READER_OMIT` — kolom rahasia disembunyikan di level client),
  `src/prisma/prisma.service.ts:110-130` (`onModuleInit` → `$connect`),
  `src/prisma/prisma.service.ts:132-149` (**`onApplicationShutdown`, bukan `onModuleDestroy`**),
  `src/prisma/prisma.module.ts:4-9` (`@Global()`).
- **Kenapa dipakai di sini:** `PrismaService extends PrismaClient` — jadi di seluruh aplikasi
  kamu meng-inject satu objek yang **adalah** client-nya. `@Global()` di `prisma.module.ts:4`
  berarti modul lain tidak perlu meng-import `PrismaModule`.
  Dua detail yang layak dihafal:
  1. **Connection pool**, `prisma.service.ts:33-34`:
     > Bound the per-instance primary pool. With N replicas, N × max must stay under Postgres
     > `max_connections` — or point DATABASE_URL at PgBouncer.
     Ini konsep baru buatmu: server tidak membuka koneksi baru per request, ia meminjam dari
     kolam terbatas. Jumlah pod × `DATABASE_POOL_MAX` adalah anggaran koneksi yang nyata.
  2. **Kapan menutup koneksi**, `prisma.service.ts:132-145` — komentarnya adalah cerita bug
     yang sesungguhnya:
     > Disconnecting in onModuleDestroy therefore pulled the database out from under every job
     > still draining — so each deploy killed the in-flight work that `enableShutdownHooks`
     > exists to protect.
     Pelajaran: urutan shutdown itu nyata dan bisa merusak data.
  `READER_OMIT` (`:14-16`) menunjukkan pertahanan berlapis lagi: hash OTP handoff disembunyikan
  di level **client**, sehingga tidak ada query yang bisa tanpa sengaja mengembalikannya —
  hanya jalur `confirmHandoff` yang secara eksplisit meminta (`omit: {…: false}`) di primary.
- **Alternatif:**
  - **Instansiasi `new PrismaClient()` di setiap service** — setiap instance membuka pool
    sendiri; dengan cepat menghabiskan `max_connections`. Ini kesalahan paling umum pemula.
  - **Pool di sisi database (PgBouncer)** vs pool di aplikasi — PgBouncer memusatkan anggaran
    koneksi (wajib saat pod banyak), tapi mode `transaction` melarang prepared statement
    tertentu dan session state. `SCALING-1M.md §5` menghitung plafonnya: *"≈ 94 api nodes on
    one pooler"*.
  - **Prisma driver adapter (`@prisma/adapter-pg`, dipakai di sini) vs engine bawaan** —
    adapter memakai driver `pg` Node sehingga pool bisa dikonfigurasi langsung dan cocok untuk
    serverless; engine bawaan (Rust) punya pooling sendiri yang kurang bisa diatur.
- **Latihan:** Jalankan aplikasi dengan `DATABASE_POOL_MAX=1`, lalu tembak endpoint list
  delivery dengan 20 request paralel (`for i in {1..20}; do curl … & done`). Amati latensi.
  Naikkan ke `10`, ulangi. Lalu jelaskan: di titik mana menambah pool berhenti membantu, dan
  kenapa `max_connections` PostgreSQL jadi batas kerasnya.

---

## 11. Transaksi: atomicity dan apa yang IKUT di-rollback

- **Prasyarat:** #10, #4
- **Anchor:** `src/deliveries/deliveries.service.ts:405-502` (`$transaction` interaktif +
  loop retry trackingId),
  `src/payments/payments.service.ts:221-247` (webhook + status ditulis dalam satu tx),
  `src/deliveries/deliveries.service.ts:483-491` (**apa yang TIDAK ikut rollback**),
  `prisma/migrations/20260619140000_partition_deliveries/migration.sql:10-13`
  (satu migration = satu transaksi).
- **Kenapa dipakai di sini:** Transaksi = "semua berhasil, atau tidak ada yang terjadi".
  `deliveries.service.ts:405-410` menyebut daftarnya:
  > The delivery row + the trackingId-registry row (+ any promo/credit/referral balance
  > mutations) commit in ONE transaction… so there's never an orphan delivery, an over-counted
  > code, or an unregistered id.
  Tapi bagian yang paling berharga untuk dipelajari justru **batas** transaksi.
  `deliveries.service.ts:486-489`:
  > The claim committed on the `drones` table (a separate, non-partitioned row) so this
  > rollback does not undo it, and every later release is keyed on a delivery row that will
  > never exist — the aircraft would be held out of service permanently.
  Artinya: klaim drone terjadi **sebelum** transaksi dan tidak ikut mundur — jadi harus ada
  kompensasi manual (`releaseClaimedAircraft`). Ini pintu masuk ke pola *saga*: begitu satu
  efek samping keluar dari transaksi, kamu wajib menulis kebalikannya sendiri.
  Pelajaran ketiga: `$transaction(async (tx) => …)` memberi `tx` yang **wajib** dipakai untuk
  semua query di dalamnya. Kalau kamu memakai `this.prisma` di dalam callback itu, query-nya
  jalan di koneksi lain dan **tidak** ikut rollback — bug hening klasik. Lihat bagaimana semua
  helper menerimanya sebagai parameter: `walletService.debitWithinTx(tx, …)`,
  `promoService.redeemWithinTx(tx, …)`, `outbox.enqueueWithinTx(tx, …)`.
- **Alternatif:**
  - **`$transaction([...])` (array/batch)** — lebih sederhana dan satu round-trip, tapi kamu
    tidak bisa memakai hasil query pertama untuk menyusun query kedua. `create()` butuh
    `created.id` dan `created.createdAt`, jadi harus interaktif.
  - **Tanpa transaksi + kompensasi (saga)** — satu-satunya pilihan ketika penulisan menyeberang
    shard/service; `SCALING-1M.md §2` menyebut ini "HARD BLOCKER" dan memilih **debit-first
    saga** setelah membandingkan tiga desain. Lebih skalabel, jauh lebih banyak state.
  - **Transaksi panjang yang mencakup panggilan HTTP eksternal** — jangan. Perhatikan
    `deliveries.service.ts:504-513`: pembuatan PaymentIntent Stripe dilakukan **di luar**
    transaksi, best-effort. Memegang lock database selama menunggu API pihak ketiga adalah
    cara tercepat menghabiskan pool.
- **Latihan:** Di `deliveries.service.ts`, sisipkan `throw new Error('boom')` tepat sebelum
  `return created;` (`:476`). Buat satu delivery lewat API. Lalu cek `psql`: apakah ada baris
  di `deliveries`? Di `tracking_id_registry`? Di `drones` — apakah `activeDeliveryId` sudah
  kembali `NULL`? Hapus `throw` itu setelah selesai.

---

## 12. Kontrol concurrency: CAS (conditional update) dan isolation level

- **Prasyarat:** #11, #3
- **Anchor:** `src/wallet/wallet.service.ts:56-75` (debit CAS: `updateMany` + `count === 0`),
  `src/wallet/wallet.service.ts:93-115` (referral `PENDING→REWARDED` CAS),
  `src/promo/promo.service.ts:100-117` (**raw SQL CAS**, dengan alasan kenapa `updateMany`
  tidak cukup),
  `src/outbox/outbox.service.ts:85-103` (klaim CAS + penjelasan Read Committed),
  `src/deliveries/deliveries.service.ts:1084` (catatan `FOR UPDATE` yang tidak dipakai).
- **Kenapa dipakai di sini:** Repo ini nyaris tidak pernah memakai lock eksplisit. Polanya
  selalu sama — **compare-and-swap**: satu `UPDATE … WHERE <kondisi lama>` lalu periksa berapa
  baris yang terkena.
  ```ts
  const { count } = await tx.user.updateMany({
    where: { id: userId, creditBalance: { gte: amt } },   // syarat ikut dalam WHERE
    data:  { creditBalance: { decrement: amt } },
  });
  if (count === 0) throw new AppConflictException('error.wallet.insufficient_credits');
  ```
  (`wallet.service.ts:65-75`) — tidak ada jendela antara "cek saldo" dan "kurangi saldo",
  karena keduanya satu pernyataan. `count` adalah cara database memberitahu siapa yang menang.
  `outbox.service.ts:85-92` menjelaskan **kenapa ini aman di isolation level default**:
  > The claim is a conditional UPDATE (PENDING→PROCESSING, attempts++) — under **Read Committed**
  > a second concurrent worker re-evaluates the predicate after the first commits, sees
  > PROCESSING, and matches 0 rows, so exactly one worker owns each row (no double-dispatch).
  Itu penjelasan Read Committed paling ringkas yang akan kamu temui: `UPDATE` yang menunggu
  lock akan **membaca ulang** baris setelah lock dilepas, lalu menguji ulang `WHERE`-nya.
  Dan `promo.service.ts:100-108` mengajarkan batas Prisma:
  > This is a raw UPDATE because (a) Prisma `updateMany` can't compare `timesRedeemed` against
  > the `maxRedemptions` **COLUMN** (the prior CAS compared it against the validateForRedeem
  > SNAPSHOT, so a concurrently-lowered cap was over-redeemed)…
  Perbandingan kolom-vs-kolom memaksa turun ke `$executeRaw`. Itu bukan kegagalan desain,
  itu tahu kapan abstraksi habis.
- **Alternatif:**
  - **Pessimistic lock (`SELECT … FOR UPDATE`)** — menahan baris sampai commit; benar dan mudah
    dipikirkan, tapi mengurangi paralelisme dan bisa deadlock. `deliveries.service.ts:1084`
    mencatat jalur yang "would want a FOR UPDATE lock… but it is a read-then-CAS, not a
    guarantee" — pengakuan jujur atas trade-off yang diambil.
  - **`Serializable` isolation** — database mendeteksi konflik dan membatalkan salah satu
    transaksi (kode `P2034` di Prisma); kamu tidak perlu menulis CAS, tapi kamu **wajib**
    menulis loop retry, dan throughput turun saat kontensi tinggi.
  - **Optimistic locking dengan kolom `version`** — pola ORM klasik (`WHERE version = ?`);
    setara CAS tapi butuh kolom tambahan di setiap tabel.
  - **Lock terdistribusi via Redis** — perlu kalau sumber daya bukan baris database;
    kelemahannya: Redis jadi single point of failure untuk correctness. Repo ini memilih
    database sebagai wasit tunggal setiap kali bisa.
- **Latihan:** Buka **dua** sesi `psql`. Di sesi A: `BEGIN; UPDATE users SET "creditBalance" =
  "creditBalance" - 10 WHERE id='<id>' AND "creditBalance" >= 10;` (jangan commit). Di sesi B:
  jalankan perintah yang sama persis dan amati bahwa ia **menggantung**. Commit di A, lalu
  lihat di B: berapa `UPDATE 0`/`UPDATE 1` yang dilaporkan? Ulangi dengan saldo yang cuma cukup
  untuk satu pihak dan jelaskan hasilnya memakai kutipan Read Committed di atas.

---

## 13. Idempotency & pengiriman at-least-once

- **Prasyarat:** #3, #11, #12
- **Anchor:** `prisma/schema.prisma:613-624` (`WebhookEvent` — id Stripe sebagai PK),
  `src/payments/payments.service.ts:221-247` (dedupe + status dalam satu tx),
  `prisma/schema.prisma:786-789` (`WalletTransaction.idempotencyKey String? @unique`),
  `src/wallet/wallet.service.ts:23-24` + `:44-53`,
  `src/deliveries/deliveries.service.ts:446-448` (`idempotencyKey: \`debit:${created.id}\``),
  `prisma/schema.prisma:650-652` (`OutboxEvent.idempotencyKey`).
- **Kenapa dipakai di sini:** Di sistem terdistribusi, "kirim tepat sekali" tidak ada. Yang ada:
  **at-least-once** (mungkin dobel) + **idempotent handler** (dobel tidak berbahaya).
  Repo ini mengimplementasikannya dengan satu trik yang konsisten: **buat kunci deterministik
  dari sesuatu yang stabil, taruh `@unique` di atasnya, lalu perlakukan P2002 sebagai sukses.**
  - Stripe: kuncinya id event (`evt_…`) → `WebhookEvent.id` (`schema.prisma:618`).
  - Debit dompet: kuncinya `debit:<deliveryId>` (`deliveries.service.ts:447`).
  - Refund: `refund:<deliveryId>` (`schema.prisma:789`).
  - Outbox: `outbox-referral:<deliveryId>` (`deliveries.service.ts:466`) —
    dengan alasan yang spesifik: *"Per-delivery key dedupes the tracking-id retry loop (a
    collision rolls the whole tx back + re-runs this block → same key → P2002 on retry)."*
  Perhatikan juga **di mana** baris dedupe ditulis: `payments.service.ts:227-232` menaruh
  `webhookEvent.create` dan `payment.updateMany` di **transaksi yang sama** —
  > so the event is marked processed only once the update commits, and a crash between the two
  > re-processes on Stripe's redelivery instead of silently dropping the update.
  Kalau ditulis di dua transaksi terpisah, crash di antaranya = update hilang selamanya.
- **Alternatif:**
  - **Dedupe di Redis (`SET key NX EX`)** — jauh lebih cepat dan tidak membebani database, tapi
    Redis bisa kehilangan kunci (eviction/restart) → efek dobel pada uang. Untuk hal yang
    menyentuh saldo, repo ini konsisten memilih database.
  - **Tabel dedupe terpisah vs kunci unik pada baris efeknya** — repo ini memakai keduanya:
    tabel terpisah untuk webhook eksternal (`webhook_events`, low volume — lihat komentar
    `schema.prisma:617`), kunci unik menempel pada baris ledger untuk uang internal.
  - **Exactly-once semantics dari broker (mis. Kafka transactions)** — ada, tapi hanya berlaku
    di dalam Kafka; begitu efeknya keluar ke database eksternal kamu kembali butuh kunci
    idempoten.
- **Latihan:** Panggil endpoint webhook Stripe dua kali dengan body yang sama (id event sama)
  memakai `curl`. Verifikasi respons kedua mengandung `duplicate: true`
  (`payments.service.ts:244`), dan bahwa `payments.status` **tidak** berubah dua kali. Lalu
  ubah kode agar `webhookEvent.create` dipanggil di luar `$transaction` — dan tulis skenario
  crash yang membuat pembayaran hilang.

---

## 14. Read replica: memisahkan baca dari tulis (dan kapan TIDAK boleh)

- **Prasyarat:** #10, #12
- **Anchor:** `src/prisma/prisma.service.ts:25-28` + `:42-65` (client kedua, hanya untuk tier
  tertentu), `src/prisma/prisma.service.ts:68-95` (`readWithFallback` + aturan pemakaian),
  `src/prisma/prisma.service.ts:97-108` (`isConnectionError` — kode `P1001/P1002/P1008/P1017`),
  `src/users/users.service.ts:68-96` (contoh pemakaian: statistik dashboard),
  `src/prisma/prisma.service.ts:74-79` (catatan Proxy: kenapa field, bukan getter).
- **Kenapa dipakai di sini:** Replika adalah salinan read-only yang **tertinggal beberapa
  milidetik** dari primary. Itu membebaskan primary dari beban baca, dengan harga: kamu bisa
  membaca data basi. Aturannya ditulis eksplisit di `prisma.service.ts:68-73`:
  > Run a LAG-TOLERANT read (owner-scoped lists/stats/polls) against the read replica…
  > **NEVER route a read that feeds a CAS, is compared/incremented, authorizes a write, or is
  > returned right after a write through here — keep those on `this`.**
  Empat larangan itu layak dihafal — semuanya adalah cara staleness berubah dari "angka
  dashboard telat 200ms" (tidak apa-apa) menjadi "user membelanjakan saldo dua kali" (fatal).
  Dua detail rekayasa yang bagus:
  - **Fallback**, `:86-94`: kalau replika mati, baca diulang ke primary **sekali**, hanya untuk
    error kelas koneksi — error query nyata seperti P2002 tetap dilempar. Jadi replika mati =
    lebih lambat, bukan 5xx.
  - **Per-tier**, `:36-48`: hanya tier `api` dan `dev` yang membuka pool replika. Worker dan
    realtime tidak, *"so they must not open a reader pool they'd never use"* — pool koneksi
    yang tidak terpakai tetap memakan anggaran `max_connections`.
- **Alternatif:**
  - **Baca semuanya dari primary** — konsistensi sempurna, sederhana; primary jadi plafon.
  - **Read-your-writes routing (sticky ke primary selama N detik setelah tulis)** — menutup
    kelas bug "user tidak melihat perubahannya sendiri" tanpa mengorbankan semua baca; butuh
    state per-session.
  - **Cache (konsep #15)** — memindahkan baca sepenuhnya keluar dari database; staleness lebih
    besar tapi bisa di-invalidate secara eksplisit. Repo ini memakai keduanya untuk kelas baca
    yang berbeda.
  - **Sinkron replication** — tidak ada lag, tapi setiap commit menunggu replika → latensi tulis
    naik dan replika yang lambat menahan primary.
- **Latihan:** Baca ulang `users.service.ts:64-99`. `getStats` memakai `readWithFallback`, tapi
  `getProfile` (`:27-48`) tidak. Jelaskan kenapa pembedaan itu benar. Lalu cari SATU pemanggilan
  `readWithFallback` lain di `src/` dan uji apakah ia melanggar salah satu dari empat larangan
  di atas.

---

## 15. Redis caching: cache-aside, TTL, fail-open, dan invalidasi

- **Prasyarat:** #10, #14
- **Anchor:** `src/cache/cache.service.ts:6-10` (kontrak **fail-open**),
  `src/cache/cache.service.ts:17-48` (`get`/`set`/`del`),
  `src/cache/cache.module.ts:14-31` (`maxRetriesPerRequest: 2`, `enableOfflineQueue: false`),
  `src/users/users.service.ts:9-16` (kunci + TTL + **apa yang aman di-cache**),
  `src/users/users.service.ts:27-62` (cache-aside + invalidasi eksplisit di `updateProfile`),
  `src/geo/geo.service.ts:9-12` + `:55-71` (**negative caching**, dan apa yang TIDAK boleh
  di-negative-cache),
  `src/serviceability/airspace.service.ts:26-29` + `:39-88` (**cache ROWS, bukan JAWABAN**),
  `src/serviceability/airspace.constants.ts:15` (`AIRSPACE_CACHE_TTL_MAX_MS`).
- **Kenapa dipakai di sini:** Pola dasarnya *cache-aside*: cek cache → miss → baca database →
  isi cache. Lihat `users.service.ts:32-47`. Yang membuat repo ini layak dipelajari adalah
  empat keputusan di sekitarnya:
  1. **Fail-open.** `cache.service.ts:8-10`: *"any Redis error is swallowed and treated as a
     miss, so a cache outage degrades to the uncached path rather than breaking the request."*
     Didukung konfigurasi di `cache.module.ts:22-23` (`enableOfflineQueue: false`) — gagal
     cepat, jangan menggantung request.
  2. **Apa yang boleh masuk cache.** `users.service.ts:11-14`: *"Safe to cache: the response is
     stable profile data only — no balance, no Stripe id — and the role here is display-only
     (the authoritative gate is the DB-resolved RolesGuard, which never reads this cache)."*
     Jadi cache tidak boleh jadi sumber keputusan otorisasi.
  3. **Invalidasi.** `users.service.ts:59-60`: tulis → `cache.del(profileKey(userId))`. TTL 60
     detik membatasi jalur perubahan yang jarang (admin ubah role); invalidasi eksplisit
     mengurus jalur yang butuh langsung terlihat.
  4. **Negative caching, hati-hati.** `geo.service.ts:57-63` membedakan "geocoder menjawab:
     tidak ada" (boleh di-cache 1 jam) dari "geocoder tidak menjawab" (**tidak boleh**):
     > caching it for GEO_MISS_TTL_S would turn one transient blip into an hour of hard
     > failures — deliveries fail closed on an unresolved location.
  Puncaknya `airspace.service.ts:26-29` + `:39-52`, cache in-process (bukan Redis) yang
  menyimpan **baris**, bukan hasil filternya:
  > Caching the filtered list instead — the shape this started as — evaluates the window once
  > per fill, so a zone entering force by the clock (a pre-staged TFR) stays unenforced for up
  > to a full TTL on EVERY instance… Keep the filter here, after the cache, not inside the fill.
  Ini pelajaran umum: **cache-lah input yang mahal, bukan keputusan yang bergantung waktu.**
- **Alternatif:**
  - **Write-through / write-behind** — cache selalu sinkron dengan tulis; lebih kompleks dan
    write-behind bisa kehilangan data. Cache-aside menang karena sederhana dan aman.
  - **Cache in-process (Map + TTL)** — nol latensi jaringan, tapi **per-pod**: dengan 10 pod
    kamu punya 10 versi. `AirspaceService` memakainya dan mengakui konsekuensinya di
    `src/admin/admin.service.ts:1036-1043`: instance lain tetap menyajikan barisnya sendiri
    sampai TTL habis. Untuk Redis, invalidasi berlaku global.
  - **Pub/sub invalidation** — kirim pesan ke semua pod untuk membuang cache in-process;
    menghilangkan jendela staleness dengan harga satu mekanisme lagi yang bisa rusak.
  - **Tanpa cache, andalkan replika (#14)** — lebih konsisten, tapi tidak menghilangkan
    round-trip database. `SCALING-1M.md §5` menyebut *"Cache is under-leveraged"* dan
    merekomendasikan cache-aside TTL pendek pada endpoint read-hot.
- **Latihan:** Matikan Redis (`docker compose stop redis` atau hentikan servicenya) sementara
  aplikasi berjalan, lalu panggil `GET /users/me`. Verifikasi request **tetap sukses** dan
  hanya ada log peringatan dari `CacheService`. Nyalakan lagi. Lalu tambahkan cache-aside untuk
  satu endpoint baca lain (mis. daftar `SavedAddress`) lengkap dengan invalidasi di jalur
  create/update/delete-nya — dan tulis satu kalimat yang menjelaskan kenapa data itu aman
  di-cache, meniru `users.service.ts:9-14`.

---

## 16. Transactional Outbox: kenapa pola ini ada

- **Prasyarat:** #11, #12, #13
- **Anchor:** `prisma/schema.prisma:626-664` (komentar blok + `model OutboxEvent`),
  `src/outbox/outbox.service.ts:25-36` (kontrak at-least-once),
  `src/outbox/outbox.service.ts:47-63` (`enqueueWithinTx`),
  `src/outbox/outbox.service.ts:85-151` (`processOne`: klaim → apply → mark, satu tx),
  `src/outbox/outbox.service.ts:155-196` (reaper klaim basi + `requeueRecoverableFailed`),
  `src/outbox/outbox.constants.ts:39-68` (semantik `attempts`, lease, backoff, ceiling),
  `src/deliveries/deliveries.service.ts:450-475` (produsen, di balik feature flag).
- **Kenapa dipakai di sini:** Masalah aslinya ditulis di `schema.prisma:626-636`:
  > `create()`'s `$transaction` today co-commits the delivery with USER-ROOTED balance
  > mutations (promo / wallet-debit / referral) — **a single tx can't span shards** once the
  > delivery lives on a different physical shard than the user. The fix: write the side-effect
  > as an OutboxEvent row INSIDE the delivery's tx (atomic, same shard), and let a worker-tier
  > dispatcher apply it to the user's shard asynchronously + idempotently.
  Jadi outbox bukan "queue yang lebih baik" — ia jawaban untuk **dual-write problem**: kamu
  tidak bisa menulis ke database DAN mengirim pesan ke sistem lain secara atomik. Solusinya:
  tulis "niat" itu sebagai baris di database yang sama (`enqueueWithinTx`, `outbox.service.ts:50-63`),
  sehingga ia ikut commit atau ikut rollback. Worker terpisah kemudian membacanya.
  Bagian yang harus kamu pahami betul: **status baris bukan otoritas dedupe.**
  `outbox.service.ts:31-35`:
  > The OutboxEvent.status is a LIVENESS optimization, NOT the dedupe authority — the dedupe
  > authority is the handler's own idempotency (for the referral: the PENDING→REWARDED CAS +
  > the unique WalletTransaction idempotency keys).
  Karena itu P2002 saat apply diperlakukan **sukses**, bukan gagal (`:124-135`).
  Siklus hidupnya lengkap dan patut ditiru: `PENDING → PROCESSING` (CAS klaim, `attempts++`),
  crash → klaim kedaluwarsa di-reap kembali ke `PENDING` (`:155-173`), habis percobaan →
  `FAILED`, lalu — dan ini perbaikan yang komentarnya jelaskan sebagai bug nyata
  (`:175-185`) — `FAILED` **tetap** di-replay setelah backoff panjang sampai plafon
  `OUTBOX_MAX_RECOVERY_ATTEMPTS`, supaya *"a money-bearing event lost to a burst of TRANSIENT
  failures … was silently dropped"* tidak terjadi lagi.
- **Alternatif:**
  - **Publish langsung ke queue setelah commit** — sederhana; kalau proses mati tepat setelah
    commit dan sebelum publish, event **hilang selamanya**. Ini persis dual-write problem.
  - **Publish sebelum commit** — event terkirim untuk transaksi yang lalu di-rollback: efek
    hantu (uang dikirim untuk pesanan yang tidak ada).
  - **CDC / log-based (Debezium membaca WAL)** — tidak butuh tabel outbox dan nol beban di
    jalur tulis; harganya infrastruktur besar (Kafka + connector) dan event berbentuk *row
    change*, bukan *intent* bisnis. `SCALING-1M.md §2` menyebutnya untuk pelaporan lintas shard.
  - **Listen/Notify PostgreSQL** — ringan, tapi tidak durable: notifikasi hilang kalau tidak ada
    listener yang terhubung.
- **Latihan:** Set `DELIVERY_OUTBOX_REFERRAL=true` dan `OUTBOX_DISPATCH_ENABLED=false`, lalu
  buat delivery pertama untuk user yang punya referral `PENDING`. Cek `SELECT * FROM
  outbox_events;` — barisnya `PENDING` dan saldo belum bertambah. Nyalakan dispatcher, tunggu
  satu tick (5 detik), cek lagi: status `PROCESSED` dan dua baris `wallet_transactions` muncul.
  Sekarang paksa duplikasi: `UPDATE outbox_events SET status='PENDING', "claimedAt"=NULL;` dan
  amati bahwa saldo **tidak** bertambah lagi — lalu telusuri baris kode mana yang mencegahnya.

---

## 17. Table partitioning: `RANGE` per bulan, dan harga composite PK

- **Prasyarat:** #3, #4, #6, #8
- **Anchor:** `prisma/PARTITIONING.md:7-28` (tabel apa saja + strateginya),
  `prisma/PARTITIONING.md:57-79` (**aturan Prisma yang tidak boleh dilanggar**),
  `prisma/migrations/20260616120000_partition_notifications/migration.sql:114-148`
  (copy-swap, referensi implementasi),
  `prisma/migrations/20260619140000_partition_deliveries/migration.sql:1-113`
  (perubahan paling invasif: fan-out composite FK ke 6 anak),
  `prisma/schema.prisma:281-289` + `:352` (`@@id([id, createdAt])`),
  `prisma/schema.prisma:359-374` (`TrackingIdRegistry` — solusi keunikan global),
  `prisma/schema.prisma:894-903` (`Notification` — versi paling sederhana untuk dibaca lebih dulu),
  `prisma/migrations/20260801053057_add_flight_frames/migration.sql:1-52`
  (dipartisi sejak lahir — jauh lebih mudah dibaca daripada copy-swap).
- **Kenapa dipakai di sini:** Partisi = satu tabel logis dipecah menjadi banyak tabel fisik
  (satu per bulan). Manfaatnya dua: **pruning** (query per rentang waktu hanya menyentuh
  partisi yang relevan) dan — yang jadi motivasi utama di sini — **retensi O(1)**:
  `schema.prisma:934-936`:
  > this is the highest-volume child in the system (one row per telemetry tick), so an aged
  > month has to be a bare **O(1) DROP** rather than an O(rows) cascade DELETE.
  Harga yang harus dibayar adalah pelajaran terpenting seluruh area ini:
  > A range-partitioned table **requires the partition key in every unique/PK constraint.**
  > — `PARTITIONING.md:58-60`
  Konsekuensinya beruntun:
  1. PK jadi composite `@@id([id, createdAt])` — `id`-first supaya lookup by-id masih memakai
     index PK tiap anak (`schema.prisma:352`).
  2. `findUnique/update/delete({ where: { id } })` **hilang** dan tidak bisa di-compile lagi
     (`PARTITIONING.md:62-65`); ~22 call-site harus ditulis ulang jadi `findFirst` /
     `updateMany` / composite `id_createdAt`. Kompiler jadi jaring pengamannya —
     `PARTITIONING.md:249-251`: *"the regenerated client makes it a COMPILE error… so
     `npm run build` is the backstop."*
  3. `trackingId @unique` tidak mungkin lagi (tidak memuat partition key) → lahir
     `TrackingIdRegistry`, tabel kecil **tidak** terpartisi yang memegang keunikan global
     (`schema.prisma:359-374`). Cerdiknya: duplikat tetap memicu P2002, jadi loop retry lama
     di `create()` tetap jalan tanpa perubahan.
  4. Setiap tabel anak butuh kolom `deliveryCreatedAt` + composite FK
     (`partition_deliveries/migration.sql:28-57` dan `:96-113`).
  5. `Drone.activeDeliveryId` diletakkan di `drones`, bukan `deliveries` — `schema.prisma:179-182`:
     *"that table is RANGE-partitioned, and a partitioned table cannot carry a unique index
     that does not include its partition key."*
  Dan **partisi DEFAULT** (`notifications/migration.sql:135-137`) adalah jaring pengaman:
  insert tidak pernah gagal karena "no partition found", walau maintenance telat.
  Terakhir, aturan operasional yang keras: `prisma db push` **dan** `db pull` dilarang
  (`PARTITIONING.md:65-71`) — `push` mengubahnya kembali jadi tabel biasa, `pull` tidak bisa
  merepresentasikan `PARTITION BY` dan malah memunculkan tiap partisi anak sebagai model.
- **Alternatif:**
  - **Satu tabel besar + index pada `createdAt`** — paling sederhana; menghapus data lama jadi
    `DELETE` besar yang menghasilkan bloat dan butuh `VACUUM`, dan tidak ada pruning.
  - **Partisi berdasarkan `HASH(userId)`** — distribusi rata (bagus untuk beban), tapi tidak
    bisa menghapus data lama per-partisi. `shard-key.ts:11-13` menyebut kenapa dua sumbu ini
    berbeda: partisi = penyimpanan/retensi, shard = beban tulis.
  - **Arsip ke object storage / tabel dingin lewat cron** — retensi tanpa DDL rumit; harganya
    query historis jadi jalur khusus.
  - **`pg_partman` + `pg_cron`** — otomatisasi partisi standar industri. Repo ini sengaja
    tidak memakainya (`PARTITIONING.md:80`: *"Maintenance (no pg_partman / pg_cron)"*) karena
    keduanya extension yang belum tentu ada di Postgres terkelola mana pun; lihat konsep #18.
- **Latihan:** Jalankan
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-partitions.sql` dan baca setiap
  `RAISE NOTICE`-nya — script ini membuktikan routing, DEFAULT, drain, dan drop tanpa perlu
  data berskala besar. Lalu di `psql`: insert satu notification dengan `"createdAt"` 5 bulan ke
  depan dan jalankan `SELECT tableoid::regclass FROM notifications WHERE id='…';` — di partisi
  mana ia mendarat, dan kenapa?

---

## 18. Maintenance partisi & retensi: DDL sebagai pekerjaan terjadwal

- **Prasyarat:** #17, dasar BullMQ (dari area `backend:jobs`)
- **Anchor:** `prisma/migrations/20260616120000_partition_notifications/migration.sql:17-112`
  (rutin `partition_attach_month` / `_ensure` / `_drain_default` / `_drop_old`),
  `prisma/migrations/20260616121000_partition_attach_lock/migration.sql:1-20`
  (**race ATTACH-vs-INSERT dan `SHARE ROW EXCLUSIVE`**),
  `prisma/migrations/20260620160000_partition_routines_self_discover/migration.sql:1-13`
  dan `:83-144` (self-discovery kolom partisi + cabang FK di `drop_old`),
  `src/partition-maintenance/partition-maintenance.service.ts:11-104`,
  `src/partition-maintenance/partition.constants.ts:51-75` (**urutan array & `??` vs `||`**),
  `prisma/PARTITIONING.md:110-132` (env knob + metrik).
- **Kenapa dipakai di sini:** Partisi bukan fitur "set-and-forget": partisi bulan depan harus
  dibuat **sebelum** bulan depan tiba. Servicenya melakukan tiga langkah per tabel per tick
  (`partition-maintenance.service.ts:31-56`): `drain_default` → `ensure` → `drop_old`.
  Empat detail yang mengubah ini dari kode maintenance biasa jadi bahan belajar:
  1. **Urutan drain sebelum ensure**, `PARTITIONING.md:86-89`: *"Runs first: a bare `CREATE …
     PARTITION OF` fails when the DEFAULT already holds in-range rows, so the routine builds
     the child standalone, moves the rows, then ATTACHes."*
  2. **Race yang nyata.** `partition_attach_lock/migration.sql:6-20` menceritakan skenario
     lengkap: dalam recovery yang telat, sebuah `INSERT` bisa commit ke DEFAULT persis di
     antara `DELETE` dan `ATTACH`, membuat `ATTACH` gagal selamanya di bawah beban tulis.
     Solusinya `LOCK TABLE … IN SHARE ROW EXCLUSIVE MODE` — konflik dengan `INSERT`
     (`ROW EXCLUSIVE`) tapi **tidak** dengan `SELECT`. Ini pelajaran lock-mode terbaik di repo.
  3. **Self-discovery kolom partisi.** `routines_self_discover/migration.sql:6-9`:
     > That is WRONG for the children… and actively DANGEROUS for `drone_commands`, which has
     > BOTH a "createdAt" audit column AND the "deliveryCreatedAt" partition key — the unfixed
     > `partition_drop_old` would **DELETE the wrong month**.
     Rutinnya kini membaca `pg_partitioned_table.partattrs[0]` dari katalog.
  4. **Retensi: `??`, bukan `||`.** `partition.constants.ts:64-75`:
     > That single character is the whole difference between "audit history is never dropped"
     > and "it is dropped whenever somebody tunes telemetry retention".
     Karena `0 || 3 === 3` tapi `0 ?? 3 === 0`. `admin_audit_logs` mem-pin `retainMonths: 0`.
  Dan `drop_old` bercabang berdasarkan ada-tidaknya FK masuk
  (`routines_self_discover/migration.sql:111-138`): tanpa FK → `DROP TABLE` O(1); dengan FK
  (seperti `deliveries`) → `DELETE` sebulan lewat induk agar cascade jalan, baru `DETACH` +
  `DROP`. Itu juga alasan urutan array di `partition.constants.ts:51-62`.
  Observabilitas ditulis sebagai bagian desain, bukan tambahan: `partitionDefaultRows > 0`
  adalah **sinyal kegagalan otoritatif** (`partition-maintenance.service.ts:84-96`), sementara
  heartbeat `partitionLastScan` hanya mendeteksi sweep yang mati total.
- **Alternatif:**
  - **`pg_partman` + `pg_cron`** — matang, teruji, jauh lebih sedikit kode. Butuh extension
    ter-install (tidak selalu tersedia di Postgres terkelola) dan job scheduler-nya hidup di
    dalam database, bukan di tier worker yang sudah kamu monitor.
  - **Cron OS / Kubernetes CronJob** — tidak butuh extension, tapi jadi jalur deploy kedua
    dengan logging/metrik/alert terpisah. Repo ini memakai BullMQ repeatable job supaya
    sekoordinasi dengan watchdog yang sudah ada (`partition-maintenance.service.ts:19-21`).
  - **Membuat partisi manual saat deploy** — nol otomatisasi, gagal saat tidak ada deploy
    selama sebulan. Partisi DEFAULT menyelamatkan datamu, tapi performanya jatuh.
  - **`DETACH PARTITION CONCURRENTLY` + arsip sebelum `DROP`** — direkomendasikan repo untuk
    produksi (`PARTITIONING.md:160-162`); lebih lambat, tapi tidak mengambil lock berat dan
    datanya masih bisa dipulihkan.
- **Latihan:** Jalankan `npx jest src/partition-maintenance` dan baca test-nya. Lalu di `psql`:
  `SELECT partition_ensure('notifications', 6);` dan lihat berapa partisi baru dibuat;
  jalankan lagi dan pastikan hasilnya `0` (idempoten). Terakhir, tulis test baru untuk
  `retentionFor()` yang membuktikan `retentionFor({ table: 'x', retainMonths: 0 }, 6) === 0` —
  lalu ubah `??` jadi `||` di `partition.constants.ts:74` dan lihat test-mu gagal.

---

## 19. Sharding: sumbu skala yang berbeda dari partisi

- **Prasyarat:** #17, #11, #16
- **Anchor:** `src/common/sharding/shard-key.ts:1-19` (blok WHY),
  `src/common/sharding/shard-key.ts:21-30` (`fnv1a32`),
  `src/common/sharding/shard-key.ts:32-46` (`deliveryShard` — `shardCount=1` selalu 0),
  `src/common/sharding/shard-key.ts:48-61` (`shardedTrackingChannel` — nama channel legacy
  dipertahankan), `src/common/sharding/shard-key.spec.ts:25-62`,
  `SCALING-1M.md:93-136` (§2 — rencana lengkap + "HARD BLOCKER").
- **Kenapa dipakai di sini:** Ini konsep terakhir karena hanya masuk akal setelah kamu paham
  transaksi dan partisi. **Partisi** memecah satu tabel di dalam SATU database (untuk
  penyimpanan & retensi). **Shard** memecah data ke BANYAK database (untuk kapasitas tulis).
  `shard-key.ts:10-16` menyatakan dua syarat fungsi shard:
  > - **STABLE across processes** — the worker that publishes a position frame and the api
  >   replica that subscribes to it MUST compute the SAME shard for the same deliveryId…
  > - **INDEPENDENT of partition keys** — Delivery is RANGE(createdAt)-partitioned for
  >   storage/retention; the WRITE-shard is a DIFFERENT axis (load), so it hashes the stable
  >   id, not createdAt.
  Karena itu FNV-1a dipilih: *"pure, dependency-free… identical output in any language"* —
  ia harus bisa dihitung ulang di Node, di SQL routing layer, atau di sidecar, dan menghasilkan
  angka yang sama.
  Dua keputusan rekayasa yang layak ditiru untuk fitur skala apa pun:
  - **Inert by default.** `shardCount === 1` selalu `return 0` (`:44`) dan
    `shardedTrackingChannel` mengembalikan nama channel lama persis (`:57-59`). Jadi kode ini
    sudah ada di produksi hari ini **tanpa mengubah apa pun** — seam-nya siap sebelum
    dibutuhkan.
  - **Fail loud.** `shardCount` non-positif melempar (`:39-43`): *"a misconfigured fan-out must
    fail loud, never silently route everything to shard 0 under a 'sharded' flag."*
  Dan yang paling penting untuk dipahami: **sharding diblokir oleh transaksi, bukan oleh
  routing.** `SCALING-1M.md:110-114`:
  > `create()`'s `$transaction` co-commits `delivery` + `trackingIdRegistry` + `promo.redeem`
  > + `wallet.debit` + `referral.grant`… A single `$transaction` **cannot span shards**, so the
  > ShardRouter is *not* an inert flag — landing it and flipping `shardCount>1` corrupts
  > balances. **This refactor — not the router code — is the real Phase-3 work.**
  Di situlah outbox (#16) dan saga debit-first berhubungan langsung: keduanya adalah pekerjaan
  membongkar transaksi itu, satu efek samping per waktu.
- **Alternatif:**
  - **Scale-up (mesin primary lebih besar)** — selalu coba ini dulu; nol perubahan kode, plafon
    keras. `SCALING-1M.md:100-105` bahkan menegaskan urutannya: pindahkan dulu firehose posisi
    ke Redis (§3), *"Sharding is the last lever, not the first."*
  - **Citus / Aurora Limitless / CockroachDB / Spanner** — sharding transparan, transaksi lintas
    shard tetap jalan; harganya vendor lock-in, biaya, dan SQL yang punya batasan sendiri.
    Disebut sebagai "transparent-distributed path later" di `SCALING-1M.md:130-136`.
  - **Shard by `userId` (user-home-shard)** — menghilangkan saga wallet sepenuhnya, tapi
    `SCALING-1M.md:118` menolaknya: *"trades even load for hot-shard skew and still leaves the
    global `promoCode.timesRedeemed` counter cross-shard."*
  - **Consistent hashing** ketimbang modulo — resharding hanya memindahkan sebagian kecil kunci;
    modulo memindahkan hampir semuanya saat `shardCount` berubah. Trade-off yang disadari:
    modulo jauh lebih sederhana dan repo ini belum pernah resharding.
- **Latihan:** Jalankan `npx jest src/common/sharding` dan baca test distribusi
  (`shard-key.spec.ts:46-57`). Lalu tulis script kecil yang menghitung `deliveryShard(id, 4)`
  untuk 100.000 uuid dan cetak histogramnya — seberapa rata? Terakhir, ubah `shardCount` dari
  4 ke 5 dan hitung berapa persen id yang **berpindah** shard. Itulah biaya resharding dengan
  modulo, dan alasan consistent hashing ada.

---

## Bagian tersulit (dan cara melewatinya)

**Konsekuensi berantai dari composite primary key setelah partisi.** Bukan konsep partisinya
yang sulit — "pecah tabel per bulan" mudah dibayangkan. Yang membingungkan adalah bahwa satu
aturan PostgreSQL (*"setiap unique/PK harus memuat partition key"*) merembet ke belasan tempat
yang tampaknya tidak berhubungan: `findUnique({ where: { id } })` yang tiba-tiba tidak bisa
di-compile; kolom `deliveryCreatedAt` yang muncul di 6 tabel anak; lahirnya `TrackingIdRegistry`
yang kelihatan seperti duplikasi tak berguna; `Drone.activeDeliveryId` yang "aneh" ditaruh di
tabel drone; partial unique yang harus menyerap partition key; dan `seed.ts` yang mendadak
harus menulis dua baris.

Cara melewatinya: **baca dalam urutan ini** —
1. `prisma/schema.prisma:894-920` (`Notification`, kasus paling sederhana),
2. `prisma/migrations/20260801053057_add_flight_frames/migration.sql` (dipartisi sejak lahir —
   tidak ada copy-swap yang mengaburkan idenya),
3. baru `prisma/migrations/20260619140000_partition_deliveries/migration.sql` (fan-out penuh),
4. lalu `prisma/PARTITIONING.md:57-79` sebagai daftar aturan.

Setiap kali kamu bingung "kenapa kode ini begitu?", tanyakan: *apakah tabelnya terpartisi?*
Sembilan dari sepuluh keanehan di data layer ini jawabannya itu.

# Fase 3 — Masuk repo asli: data layer sebagai kontrak, bukan sebagai penyimpanan

> **Durasi** ~2,5 minggu (~32 jam) · **Mode** bedah · **Repo** `Drovery_Backend` (pertama kalinya kamu menyentuh repo produksi)

---

## Kenapa fase ini ada di sini

Dua fase terakhir kamu habiskan di sandbox `learn-nest/` yang kamu bangun sendiri: module, provider, DI, guard, filter, envelope. Itu disengaja — kamu belajar mekanika NestJS di tempat yang boleh kamu rusak. Fase 3 adalah pintu masuk ke `Drovery_Backend`, dan pintu itu sengaja dibuka di **data layer**, bukan di controller. Alasannya sederhana dan tidak romantis: controller bisa kamu tulis ulang di sore hari, tapi kolom yang sudah punya 200.000 baris tidak bisa. Schema adalah bagian sistem yang **paling mahal diubah belakangan**, jadi itu bagian yang paling layak kamu pahami paling awal.

Ada alasan kedua yang lebih penting. Mulai fase depan (Fase 5 — konkurensi dan uang) kamu akan bertemu pola yang di React tidak punya padanan sama sekali: `updateMany(...).count === 0` yang artinya "aktor lain menang". Pola itu **berdiri di atas database**, bukan di atas TypeScript. `@unique` pada `Drone.activeDeliveryId` bukan validasi — ia lock. `CHECK ("creditBalance" >= 0)` bukan pengaman kedua yang basa-basi — ia jaring terakhir ketika CAS-mu bocor. Kalau kamu masuk Fase 5 tanpa merasakan bahwa constraint database adalah *aturan bisnis yang dipaksakan mesin lain*, seluruh fase itu akan terasa seperti mantra yang kamu salin. Fase 3 memasang fondasi itu: constraint dulu, balapan belakangan.

Alasan ketiga bersifat sosial, bukan teknis. Repo ini menulis alasannya sendiri — di komentar schema, di file migration, di `ARCHITECTURE.md`, di `AUDIT-LOG.md` sepanjang 2.297 baris. Tapi dokumen yang sama juga memuat rencana yang **belum dibangun** dan klaim yang **sudah dibantah**, dengan nada percaya diri yang persis sama. Repo ini bahkan punya commit yang isinya memperbaiki dokumennya sendiri (`8793ca9 docs(audit): correct three untrue claims`). Jadi keterampilan "membaca penanda status" — `✅` vs `🟡` vs `📐` — bukan pelengkap fase ini; ia adalah keterampilan bertahan hidup untuk sepuluh fase berikutnya. Kalau kamu mempercayai satu tabel di `SCALING-1M.md` mentah-mentah, kamu akan menghabiskan seminggu mencari kode yang memang belum pernah ditulis.

Yang mustahil dipahami tanpa fase ini: kenapa `findUnique({ where: { id } })` tidak bisa di-compile untuk `Delivery`; kenapa ada tabel bernama `tracking_id_registry` yang kelihatan seperti duplikasi tak berguna; kenapa `activeDeliveryId` ditaruh di tabel `drones` padahal isinya id delivery; kenapa satu transaksi yang di-rollback tetap meninggalkan pesawat dalam keadaan terklaim. Empat keanehan itu punya satu akar yang sama, dan akarnya ada di lapisan ini.

---

## Gerbang masuk

Kamu siap masuk Fase 3 kalau kamu bisa:

- [ ] Menjalankan `docker compose up -d postgres` (atau menunjuk `DATABASE_URL` ke Postgres terkelola), lalu `npx prisma migrate deploy && npm run prisma:seed` di `Drovery_Backend` sampai selesai tanpa error — dan menjelaskan bedanya `migrate deploy` dengan `migrate dev`.
- [ ] Membuka `psql "$DATABASE_URL"`, menjalankan `\dt`, dan menemukan tabel `users` — tanpa membuka Prisma Studio.
- [ ] Menjelaskan, tanpa membuka kode, apa yang dilakukan `@Injectable()` + constructor injection di NestJS, dan siapa yang membuat instance-nya.
- [ ] Membaca satu module Nest di sandbox-mu dan menunjukkan dari mana sebuah provider berasal ketika modulnya tidak meng-import apa pun (jawaban yang benar menyebut `@Global()`).
- [ ] Menulis satu query Prisma sederhana (`findMany` dengan `where` + `select`) dan membaca tipe hasilnya di editor tanpa menebak.
- [ ] Menjalankan `npm test` di `Drovery_Backend` dan melihatnya hijau. (Kalau merah sejak awal, selesaikan itu dulu — kamu butuh baseline yang bersih untuk tahu bahwa kerusakan berikutnya adalah ulahmu.)

Kalau salah satu butir masih goyah — terutama DI dan `@Global()` — kembali ke Fase 2 sebentar. Fase ini akan menyuruhmu meng-inject `PrismaService` di hari pertama.

---

## Peta jalan mingguan

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| **1** | Membaca `schema.prisma` dari atas ke bawah sebagai peta domain. PK, unique, relasi/FK, enum, index. Semua di `psql` + Prisma Studio, **belum menulis migration**. | 13 | Satu file catatan `docs/learning/catatan-schema.md` berisi: daftar seluruh `@@map`, tiga contoh `onDelete` dengan alasannya, dan lima `@@index` beserta query yang dilayaninya (kutip komentarnya). |
| **2** | Constraint di luar Prisma (`CHECK`, partial unique), migration sebagai DDL berversi, urutan backfill, gerbang drift, seed idempoten. Mulai menulis migration percobaan di branch sendiri. | 13 | Dua migration percobaan yang **dibuang** (`npm run db:reset`): satu benar, satu sengaja salah urutan sampai gagal — plus transkrip error-nya. `npm run prisma:drift-check` bersih. |
| **3 (setengah)** | `PrismaService` (pool, adapter, `onApplicationShutdown`), transaksi dan batasnya, membaca repo secara skeptis. Kerjakan capstone. | 6–7 | Capstone: satu migration berkualitas-merge + lampiran `EXPLAIN ANALYZE` sebelum/sesudah + satu paragraf "Left undone" bergaya `AUDIT-LOG.md` untuk pekerjaanmu sendiri. |

Total ~32 jam. Kalau minggu 2 molor jadi dua minggu, biarkan — urutan backfill adalah hal yang lebih baik kamu pelajari dari error nyata daripada dari paragraf ini.

Aturan main sepanjang fase: **kerjakan di branch sendiri**, jangan commit ke `main`, dan pakai `npm run db:reset` sesering yang kamu mau. Database dev-mu adalah alat bantu belajar, bukan aset.

---

## Konsep

### 3.1 Membaca `schema.prisma` sebagai peta domain

Padanan paling jujur dari `prisma/schema.prisma` di duniamu adalah file `types.ts` besar yang jadi sumber kebenaran bentuk data seluruh aplikasi — dengan satu perbedaan yang mengubah segalanya: file ini bukan cuma dokumentasi tipe, ia **menghasilkan dua hal sekaligus**. Dari file ini Prisma meng-generate SDK TypeScript (yang kamu pakai di `src/`), dan dari file ini juga lahir SQL yang membentuk tabel sungguhan. Kalau di React kamu salah menulis tipe, yang rusak cuma autocomplete. Di sini, salah menulis satu baris berarti salah membentuk tabel yang akan diisi jutaan baris.

Angkanya konkret: 1.089 baris, 31 `model`, 20 `enum`. Itu terdengar banyak sampai kamu sadar bahwa hampir setiap model punya komentar blok di atasnya yang menjelaskan **kenapa ia berbentuk seperti itu** — dan komentar itulah kurikulum sesungguhnya. Baca `schema.prisma` seperti kamu membaca README, bukan seperti kamu membaca konfigurasi.

Dua konvensi penamaan hidup berdampingan di sini dan dijembatani tepat satu kali. Di TypeScript, model bernama `User` (PascalCase, tunggal). Di database, tabelnya bernama `users` (snake_case, jamak) — dipetakan oleh `@@map("users")`. Ini konsisten di semua model: `@@map("delivery_ratings")`, `@@map("promo_codes")`, `@@map("tracking_id_registry")`. Konsekuensinya: kalau kamu menulis SQL mentah di `psql`, kamu memakai nama tabel; kalau kamu menulis Prisma, kamu memakai nama model. Bingung antara keduanya adalah kesalahan hari pertama yang normal.

Satu detail Prisma 7 yang layak dicatat: blok `datasource` di `schema.prisma:5-7` **tidak memuat URL database**. URL-nya dibaca dari `prisma.config.ts:7` (`process.env.DATABASE_URL`), jadi schema aman di-commit tanpa kredensial. Perintah seed juga pindah ke sana (`prisma.config.ts:10-12`) — walaupun blok lama `"prisma": { "seed": ... }` masih tertinggal di `package.json:112-114`. Dua tempat yang sama-sama terlihat benar, satu yang benar-benar dibaca. Komentarnya menyebutkan itu terus terang.

**Anchor:**
- `prisma/schema.prisma:1-7` — blok `generator client` + `datasource db`. Perhatikan `provider = "postgresql"`: itu yang memilih dialek SQL-nya, dan itu yang membuat `String[]` serta `enum` native mungkin.
- `prisma/schema.prisma:17-69` — `model User` dari `{` sampai `@@map("users")` di baris 69. Ini model rujukanmu untuk semua yang lain.
- `prisma/schema.prisma:49-67` — daftar relasi `User`. Semua field ini **virtual**: tidak ada satu pun kolom untuknya di tabel `users`.
- `prisma.config.ts:4-13` — URL + perintah seed, Prisma 7.

**Kenapa dipakai di sini:** satu file yang bisa dibaca sebagai peta seluruh domain adalah aset besar untuk repo yang dikerjakan sendirian dan diserahkan ke sesi berikutnya. `AUDIT-PLAN.md` berulang kali merujuk ke schema sebagai orientasi tercepat. Kalau schema tersebar di 31 file entity, "apa saja yang ada di sistem ini" jadi pertanyaan yang butuh setengah jam, bukan lima menit.

**Alternatif:**
- **TypeORM / MikroORM (decorator di kelas entity).** Lebih "Nest-y" — entity-nya kelas biasa dengan `@Column()`, dan repository-nya di-inject seperti provider lain. Trade-off konkret: kamu kehilangan satu file yang bisa dibaca sebagai peta, dan migration generator TypeORM terkenal menghasilkan diff yang meleset saat kolom di-rename (ia melihatnya sebagai drop + add, alias kehilangan data). Prisma juga bisa salah di situ, tapi ia memaksamu membaca SQL-nya sebelum apply.
- **Drizzle ORM.** Schema ditulis sebagai TypeScript murni — tanpa DSL baru, tanpa langkah `generate`, dan SQL yang dihasilkan jauh lebih mudah ditebak. Trade-off konkret: tidak ada `prisma studio`, tooling introspeksi lebih mentah, dan pola `$transaction(async (tx) => …)` yang di repo ini dipakai di jantung `create()` harus kamu susun sendiri.
- **SQL mentah + driver `pg`.** Kontrol penuh, nol abstraksi, nol biaya generate. Trade-off konkret: setiap query kehilangan type-safety (`rows[0].creditBalance` bertipe `any`), dan tidak ada migration tooling sama sekali — kamu menulis dan mengurutkan file SQL sendiri, termasuk tabel `_migrations`-nya.

**Latihan:** buat daftar seluruh `@@map(...)` di `schema.prisma` (`grep -n "@@map" prisma/schema.prisma` boleh, tapi tulis ulang daftarnya sendiri supaya kamu benar-benar membacanya). Lalu jalankan `psql "$DATABASE_URL" -c "\dt"` dan cocokkan. **Verifikasi:** jumlah tabel di `psql` akan LEBIH BANYAK daripada daftarmu. Cari tabel yang tidak ada di daftar (petunjuk: namanya berakhiran seperti `_y2026m06`) dan catat pertanyaanmu — jawabannya di 3.10 dan tuntas di Fase 6.

---

### 3.2 Primary key & unique: identitas baris, dan unique sebagai LOCK

Ini konsep terpenting di seluruh fase. Bacalah bagian ini dua kali.

`@id` adalah primary key: identitas baris. Di repo ini hampir selalu `String @id @default(uuid())` (`prisma/schema.prisma:18`). `@unique` kelihatannya cuma sepupu yang lebih lemah — "nilai ini tidak boleh kembar" — dan di React kamu akan mengurusnya dengan validasi form. Di sini ia sesuatu yang lain sama sekali.

Buka `prisma/schema.prisma:178-182` dan baca komentarnya:

> `activeDeliveryId` is the claim AND the lock: it is UNIQUE, so the database itself refuses to let one aircraft hold two deliveries.

Renungkan bentuk kalimat itu. Kolom `activeDeliveryId` ada di tabel `drones`, isinya id delivery yang sedang diterbangkan pesawat itu, dan ia `@unique` (`schema.prisma:228`). Artinya: **tidak ada dua drone yang bisa memegang delivery yang sama, dan tidak ada satu drone yang bisa memegang dua delivery** — bukan karena ada `if` di kode, tapi karena PostgreSQL akan menolak baris kedua. Kalau ada sepuluh pod API yang menerima sepuluh request bersamaan, sembilan di antaranya akan gagal dengan error yang sama, dan itu justru yang diinginkan.

Kenapa ini penting untukmu sekarang: di React, `setState` selalu menang. Tidak ada aktor lain. Di sini, "cek dulu lalu tulis" adalah bug, bukan gaya. Pola `const dipakai = await findFirst(...); if (dipakai) throw; await create(...)` punya jendela di antara dua baris itu, dan jendela itu diukur dalam milidetik yang sangat cukup untuk request kedua menyelinap. Constraint database adalah satu-satunya jawaban yang benar, dan repo ini memakainya secara konsisten. Fase 5 akan membangun seluruh model konkurensinya di atas kalimat ini.

Bentuk ekstrem dari ide yang sama ada di `schema.prisma:613-624`: model `WebhookEvent` yang **primary key-nya adalah id event Stripe** (`evt_…`). Komentarnya:

> Stripe delivers webhooks AT-LEAST-ONCE and can reorder them, so the event id (evt_…) is the PK: a redelivered event collides (P2002) and is skipped, making the handler effectively-once.

Jadi PK di sini bukan "nomor urut baris", melainkan **kunci idempotensi**. Kirim ulang event yang sama → bentrok → dilewati. Tidak ada pengecekan manual sama sekali. `P2002` adalah kode error Prisma untuk pelanggaran unique constraint; hafalkan sekarang, kamu akan melihatnya puluhan kali.

Terakhir, unique **gabungan**: `@@unique([userId, pushToken])` di `schema.prisma:890`. Satu user boleh punya banyak device; satu push token secara teori bisa muncul di lebih dari satu user; yang dilarang cuma **pasangan** yang sama muncul dua kali. Ini bukan "dua kolom unique", ini "satu unique atas dua kolom" — perbedaan yang gampang salah dibaca.

**Anchor:**
- `prisma/schema.prisma:178-182` — komentar "the claim AND the lock". Ini kalimat kunci fase ini.
- `prisma/schema.prisma:224-228` — komentar + field `activeDeliveryId String? @unique`. Perhatikan juga alasan kenapa ia **bukan** relasi Prisma.
- `prisma/schema.prisma:613-624` — `WebhookEvent`, PK = id event Stripe.
- `prisma/schema.prisma:221` — `ingestKeyHash String? @unique`: kredensial per-pesawat, disimpan sebagai hash, unik supaya satu kunci tidak bisa dipakai dua airframe.
- `prisma/schema.prisma:890` — `@@unique([userId, pushToken])`.
- `src/dispatch/dispatch.service.ts:178-184` — bagaimana kode memperlakukan constraint itu: klaim yang **re-entrant**, karena "menulis klaim kedua untuk delivery yang sama raises P2002" dan itu akan mengubah blip yang bisa dipulihkan jadi kegagalan permanen.

**Kenapa dipakai di sini:** komentar `schema.prisma:179-182` menyebut alasan teknis yang tidak akan kamu tebak sendiri — constraint itu diletakkan di `drones` dan bukan di `deliveries` karena *"that table is RANGE-partitioned, and a partitioned table cannot carry a unique index that does not include its partition key"*. Artinya letak sebuah constraint bisa ditentukan oleh keputusan penyimpanan di tabel lain. Simpan pengetahuan itu; ia akan muncul lagi di 3.10.

**Alternatif:**
- **Auto-increment `Int` sebagai PK.** Lebih kecil (4–8 byte vs 16), lebih cepat di index, dan enak dibaca manusia. Trade-off konkret: nilainya baru ada **setelah** `INSERT`, jadi kamu tidak bisa membuat kunci idempotensi seperti `debit:<deliveryId>` sebelum barisnya lahir — padahal `deliveries.service.ts` justru butuh itu (`src/deliveries/deliveries.service.ts:447`). Plus id-nya bocor informasi: pelanggan bisa menebak berapa order yang kamu punya dari nomor order-nya.
- **UUIDv7 / ULID ketimbang UUIDv4.** v4 acak total, jadi setiap insert mendarat di posisi acak dalam B-tree dan memicu page split lebih sering. v7/ULID terurut waktu, jadi insert menempel di ujung index — nyata bedanya di tabel append-heavy seperti `flight_frames`. Trade-off konkret: id jadi bisa dipakai menebak waktu pembuatan baris (bocor metadata), dan dukungan bawaan Prisma-nya belum sematang `uuid()`.
- **Cek unik di aplikasi (`findFirst` lalu `create`).** Enak dibaca, error message-nya bisa kamu karang sendiri, tidak butuh migration. Trade-off konkret: **bocor di bawah concurrency** — dua request bersamaan sama-sama lolos cek. Ini bukan trade-off yang bisa diterima untuk klaim pesawat atau saldo; repo ini memakai constraint database untuk keduanya.

**Latihan:** di `psql`, ambil satu drone (`SELECT id, "activeDeliveryId" FROM drones LIMIT 1;`), lalu coba jalankan `UPDATE drones SET "activeDeliveryId" = 'X' WHERE id = '<drone-1>';` dan `UPDATE drones SET "activeDeliveryId" = 'X' WHERE id = '<drone-2>';` berturut-turut. **Verifikasi:** perintah kedua gagal dengan `duplicate key value violates unique constraint "drones_activeDeliveryId_key"`. Salin pesan error itu ke catatanmu — Prisma menerjemahkannya jadi `P2002`, dan `src/deliveries/commands/drone-command.service.ts:179-185` menunjukkan bagaimana kode mengubah P2002 jadi HTTP 409.

---

### 3.3 Relasi & foreign key: `Cascade`, `SetNull`, dan sengaja TANPA FK

Foreign key adalah janji: "nilai di kolom ini pasti ada di tabel sana." Database yang menegakkannya. Di Prisma, satu relasi ditulis **dua kali** — field `user User @relation(fields: [userId], ...)` di sisi anak, dan array `savedAddresses SavedAddress[]` di sisi induk — tapi di SQL yang lahir cuma **satu** `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`. Array di sisi induk itu virtual; tidak ada kolomnya. Ini sumber kebingungan hari pertama yang sangat umum, jadi catat sekarang.

Bagian yang benar-benar layak dipelajari adalah `onDelete`. Repo ini memakai **tiga** jawaban berbeda, dan ketiganya punya alasan yang tertulis:

**`Cascade`** — `prisma/schema.prisma:94`: hapus user → alamat tersimpannya ikut hilang. Benar, karena `SavedAddress` tidak punya makna tanpa pemiliknya.

**`SetNull`** — `prisma/schema.prisma:863-867`: hapus user → pesan support-nya tetap ada, pengirimnya jadi `null`. Komentarnya: *"SetNull (not Cascade) so deleting a user preserves the readable thread."* Kalau ini `Cascade`, menghapus satu user akan melubangi percakapan yang isinya juga milik agen support.

**Tanpa FK sama sekali** — dan ini yang paling instruktif. `prisma/schema.prisma:1001-1008`:

> `actorUserId` carries NO foreign key… for an audit log SetNull is the wrong trade: it preserves the row while destroying its single most important field… A plain column cannot be nulled by a cascade.

Baca ulang: untuk audit log, `SetNull` **secara teknis benar tapi secara produk salah**. Baris audit yang kehilangan "siapa pelakunya" adalah baris audit yang tidak berguna. Jadi kolomnya sengaja dibiarkan sebagai `String` polos tanpa FK, supaya tidak ada cascade yang bisa menyentuhnya. Keputusan "pakai FK atau tidak" ternyata keputusan **produk**, bukan gaya coding.

Pola tanpa-FK yang sama muncul di dua tempat lain dengan alasan berbeda: `RecurringDelivery.lastDeliveryId` (`schema.prisma:461` — *"provenance only; intentionally NO FK"*) dan `WalletTransaction.deliveryId` (`schema.prisma:787`). Alasannya di situ bukan audit, melainkan persiapan sharding: `SCALING-1M.md` §2 menjelaskan bahwa ketiadaan FK inilah yang **memungkinkan** saga debit-first nanti — sebuah FK lintas-shard mustahil ditegakkan.

Ada pola keempat yang perlu kamu kenali: **tidak menghapus sama sekali**. `AirspaceZone` (`schema.prisma:1076-1080`) tidak punya jalur delete; menonaktifkan zona adalah caranya "menghapus", dan komentarnya menjelaskan kenapa: *"a zone that once existed is part of why a past delivery was refused."*

**Anchor:**
- `prisma/schema.prisma:91-95` — `SavedAddress` → `User`, `onDelete: Cascade`.
- `prisma/schema.prisma:863-867` — `SupportChatMessage.senderUser`, `onDelete: SetNull` + alasannya.
- `prisma/schema.prisma:306-307` — `Delivery.assignedDrone`, `onDelete: SetNull`: hapus pesawat, delivery tetap ada tanpa pesawat.
- `prisma/schema.prisma:1001-1008` — `AdminAuditLog.actorUserId`, sengaja tanpa FK.
- `prisma/schema.prisma:461` dan `:787` — dua kolom lain tanpa FK, alasan berbeda (provenance / persiapan shard).
- `prisma/migrations/20260326134037_init/migration.sql` — cari bagian `-- AddForeignKey` dan hitung: satu relasi Prisma = satu `ALTER TABLE` di sini.

**Kenapa dipakai di sini:** ketiga pilihan itu ada dalam satu repo dengan kontras yang tajam, jadi kamu bisa membandingkannya tanpa berpindah proyek. Dan `schema.prisma:1003-1008` adalah contoh langka dari komentar yang menyebutkan **alternatif yang ditolak beserta alasannya** — bukan cuma apa yang dipilih.

**Alternatif:**
- **Soft-delete (`deletedAt DateTime?`) menggantikan cascade.** Semua data tersimpan, "penghapusan" bisa dibatalkan, audit selamat. Trade-off konkret: **setiap** query di seluruh repo harus ingat `WHERE "deletedAt" IS NULL`, dan sekali lupa artinya kebocoran data ke user lain. Prisma tidak punya global filter bawaan yang aman untuk ini, jadi disiplinnya manual di ~96 endpoint.
- **Tanpa FK sama sekali di seluruh sistem (integritas dijaga aplikasi).** Ini yang dilakukan MongoDB dan banyak sistem ber-shard. Insert lebih cepat (tidak ada pengecekan referensi), dan sharding jadi mungkin. Trade-off konkret: setiap bug aplikasi meninggalkan baris yatim yang **tidak akan pernah terdeteksi** — tidak ada yang mengeluh, datanya cuma pelan-pelan jadi sampah. Repo ini memilih ini hanya di tiga tempat, dan ketiganya diberi komentar.
- **`ON DELETE RESTRICT` (default SQL).** Hapus induk ditolak selama masih ada anak. Aman dan eksplisit. Trade-off konkret: penghapusan user jadi operasi multi-langkah yang harus kamu tulis sendiri dengan urutan yang benar, dan setiap tabel anak baru menambah satu langkah yang mudah terlupa.

**Latihan:** lewat `psql`, buat satu user dummy, lalu satu `saved_addresses`, satu `support_chat_messages` (butuh `support_tickets` dulu), dan satu `admin_audit_logs` dengan `"actorUserId"` = id user itu. Jalankan `DELETE FROM users WHERE id = '<id>';`. **Verifikasi:** alamat hilang, pesan support masih ada dengan `senderUserId` NULL, baris audit masih ada **dengan `actorUserId` utuh**. Kalau `DELETE` gagal, baca constraint mana yang mengeluh — itu jawaban yang sama berharganya.

---

### 3.4 Enum PostgreSQL vs `String` polos

Di TypeScript, `type Status = 'PENDING' | 'DONE'` adalah union type: dicek saat compile, hilang saat runtime. Di PostgreSQL, `enum` adalah **tipe baru yang benar-benar ada di database** (`CREATE TYPE "DeliveryStatus" AS ENUM (...)`). Nilai di luar daftar ditolak oleh mesin, bukan oleh linter. Ini padanan yang mendekati, tapi bedanya penting: union TypeScript-mu tidak akan menghentikan script migrasi data yang menulis `'pendng'`; enum PostgreSQL akan.

Repo ini memakai enum untuk hal yang bentuknya himpunan tertutup — dan `DeliveryStatus` (`schema.prisma:241-258`) adalah contoh terbaiknya karena komentarnya menjelaskan struktur yang **tidak terlihat dari daftar nilainya**:

> Exception outcomes — BRANCHES off the happy path, deliberately OUTSIDE `STATUS_ORDER` (simulation.constants.ts) so the monotonic forward CAS can never enter them and a terminal can't be resurrected.

Jadi 12 nilai itu sebenarnya dua kelompok: jalur bahagia yang berurutan (`PENDING → CONFIRMED → … → DELIVERED`) dan cabang pengecualian (`RETURNING`, `DELIVERY_FAILED`, `RETURNED_TO_BASE`) yang **sengaja tidak masuk urutan**. Kamu tidak akan menebak itu dari nama-namanya. (Mekanisme "monotonic forward CAS" yang dimaksud adalah materi Fase 5; cukup catat sekarang bahwa daftar enum ini dirancang untuk melayaninya.)

Kontras yang paling mengajari ada di `schema.prisma:34-37`. Kolom `locale` — daftar bahasa — justru **sengaja bukan enum**:

> A plain string (not an enum) so the set extends without a migration; I18nService normalizes any unknown value to the default ('en').

Itu memberi kamu aturan praktis yang bisa dibawa ke proyek mana pun: **enum untuk himpunan yang penambahannya memang butuh review kode; string untuk himpunan yang tumbuh bebas.** Menambah bahasa keempat tidak boleh butuh DDL; menambah status delivery keempat belas memang harus.

Harga enum terlihat jelas di `prisma/migrations/20260809133410_add_airspace_zones/migration.sql:4-10`: menambah tiga nilai ke `AdminAuditAction` butuh tiga `ALTER TYPE … ADD VALUE`, alias sebuah migration, alias sebuah deploy.

**Anchor:**
- `prisma/schema.prisma:11-15` — `enum Role` (`USER` / `AGENT` / `ADMIN`), enum paling kecil untuk mulai membaca.
- `prisma/schema.prisma:241-258` — `DeliveryStatus`, dengan komentar cabang pengecualian di `:251-254`.
- `prisma/schema.prisma:260-270` — `DeliveryFailureReason`, dan komentar yang menyebut alasan mana yang memicu refund.
- `prisma/schema.prisma:34-37` — `locale`, contoh sengaja-bukan-enum.
- `prisma/migrations/20260809133410_add_airspace_zones/migration.sql:4-10` — harga menambah nilai enum.

**Kenapa dipakai di sini:** `DeliveryStatus` adalah state machine yang dibaca oleh worker, watchdog, dan admin sekaligus. Kalau ia `String`, satu typo di satu tempat menghasilkan delivery yang tidak akan pernah cocok dengan `WHERE status = 'IN_TRANSIT'` mana pun dan macet selamanya tanpa error. Enum mengubah kelas bug itu dari "hening" jadi "gagal saat menulis".

**Alternatif:**
- **Tabel lookup (`statuses` + FK).** Nilai bisa ditambah/dihapus tanpa DDL, dan barisnya bisa membawa metadata (label terlokalisasi, urutan, warna badge). Trade-off konkret: setiap query yang mau menampilkan label butuh JOIN, dan kamu kehilangan union type di TypeScript — `delivery.status` jadi `string`, sehingga `switch` tanpa `default` tidak lagi dicek exhaustive oleh compiler.
- **`String` + `CHECK (status IN (...))`.** Hampir sekuat enum di sisi database, dan mengubah daftarnya lebih murah (`DROP CONSTRAINT` + `ADD CONSTRAINT`, bukan `ALTER TYPE` yang tidak bisa menghapus nilai). Trade-off konkret: Prisma tidak tahu apa-apa soal `CHECK`, jadi tipe yang di-generate tetap `string` — kamu kehilangan seluruh bantuan editor.
- **`String` polos + validasi di DTO.** Paling fleksibel, nol biaya migration. Trade-off konkret: validasi DTO hanya berlaku di jalur HTTP; seed, script maintenance, dan worker bisa menulis apa saja. Repo ini menerima trade-off itu untuk `locale` **hanya karena** ada normalisasi terpusat di `I18nService` yang memetakan nilai tak dikenal ke `'en'`.

**Latihan:** tambahkan nilai `SUSPENDED` ke `enum DroneStatus` di `schema.prisma`, lalu jalankan `npx prisma migrate dev --create-only --name add_drone_suspended` dan **baca file SQL yang dihasilkan** sebelum apply-nya. **Verifikasi:** file itu berisi `ALTER TYPE "DroneStatus" ADD VALUE 'SUSPENDED';` dan tidak menyentuh tabel `drones` sama sekali. Lalu buang percobaan itu (`npm run db:reset` setelah menghapus folder migration-nya dan mengembalikan `schema.prisma`).

---

### 3.5 Index: satu index = satu `WHERE` yang nyata

Analogi yang jujur: index database adalah daftar isi buku. Tanpanya, mencari satu bab berarti membuka setiap halaman (`Seq Scan`). Dengan daftar isi, kamu lompat langsung (`Index Scan`). Yang **tidak** punya padanan di React: setiap daftar isi tambahan harus ikut diperbarui setiap kali satu halaman diubah. Index bukan gratis — ia pajak pada setiap `INSERT` dan `UPDATE`.

Yang membuat repo ini layak dibedah: hampir setiap `@@index` punya komentar yang menyebut **query mana** yang dilayaninya. Itu persis cara berpikir yang benar. Contoh:

- `prisma/schema.prisma:419` — `@@index([droneId, status]) // hot poll predicate: one drone's open queue`
- `prisma/schema.prisma:481` — `@@index([active, nextRunAt]) // hot scan predicate`
- `prisma/schema.prisma:660-662` — `@@index([status, createdAt])` dengan komentar dua baris: *"Supports the dispatcher claim (WHERE status=PENDING ORDER BY createdAt) and the reaper (WHERE status=PROCESSING)."* Satu index, dua query nyata.

Pelajaran intinya adalah **urutan kolom**, dan namanya *aturan prefix kiri*. Index `(userId, isDefault)` bisa melayani `WHERE "userId" = ?` (karena `userId` adalah prefix kiri), bisa melayani `WHERE "userId" = ? AND "isDefault" = true`, tapi **tidak** bisa melayani `WHERE "isDefault" = true` sendirian. Bayangkan buku telepon yang diurutkan (nama belakang, nama depan): mencari semua "Budi" tanpa tahu nama belakangnya berarti membaca seluruh buku.

Karena itu ada pertanyaan menarik yang bisa kamu jawab sendiri di repo ini: `SavedAddress` punya **dua** index, `@@index([userId])` dan `@@index([userId, isDefault])` (`schema.prisma:103-104`). Menurut aturan prefix kiri, yang pertama tampak redundan — index kedua sudah melayani `WHERE userId = ?`. Apakah ia benar-benar bisa dibuang? Jawab dengan `EXPLAIN`, bukan dengan opini. (Index yang lebih sempit memang sedikit lebih kecil dan lebih cepat di-scan; pertanyaannya apakah selisih itu sepadan dengan biaya tulisnya.)

Dua hal lagi yang perlu kamu tahu sekarang. Pertama, `@unique` **otomatis membuat index** — tidak perlu menambahkan `@@index` di atas kolom yang sudah `@unique`; lihat sendiri di `prisma/migrations/20260326134037_init/migration.sql`, setiap unique jadi `CREATE UNIQUE INDEX`. Kedua, tabel yang paling banyak ditulis justru paling sedikit index-nya: `FlightFrame` (satu baris per tick telemetri) hanya punya dua (`schema.prisma:968-969`), bukan lima.

**Anchor:**
- `prisma/schema.prisma:103-104` — dua index `SavedAddress`; bahan latihan prefix kiri.
- `prisma/schema.prisma:419` — index dengan komentar "hot poll predicate".
- `prisma/schema.prisma:660-662` — satu index melayani dua query, keduanya disebut namanya.
- `prisma/schema.prisma:235` — `@@index([status, airworthy])` di `drones`: predikat pemilihan pesawat.
- `prisma/schema.prisma:968-969` — dua index di tabel tersibuk sistem.
- `prisma/schema.prisma:1034-1036` — tiga index di `admin_audit_logs`, masing-masing untuk satu bentuk pencarian audit yang berbeda.

**Kenapa dipakai di sini:** repo ini punya sedikit sekali index dibanding jumlah tabelnya, dan itu disengaja. Komentar-komentar itu berfungsi sebagai kontrak: kalau nanti seseorang menghapus query yang dilayani sebuah index, komentar itulah yang memberitahu bahwa index-nya juga boleh ikut hilang. Index tanpa komentar adalah index yang tidak akan pernah berani dihapus siapa pun.

**Alternatif:**
- **Partial index** (`CREATE INDEX … WHERE "status" = 'PENDING'`). Jauh lebih kecil kalau hanya sebagian kecil baris yang pernah di-query — index outbox misalnya hanya perlu memuat baris `PENDING`/`PROCESSING`, bukan jutaan `PROCESSED`. Trade-off konkret: hanya dipakai planner kalau predikat query-mu **cocok atau lebih sempit** dari `WHERE`-nya; query yang mencari `PROCESSED` akan mengabaikannya total. Repo ini memakai bentuk ini sebagai *unique*, bukan sebagai index baca — lihat 3.6.
- **GIN ketimbang B-tree.** Untuk `packageTypes String[]` (`schema.prisma:324`) atau kolom `Json`, B-tree tidak berguna — GIN yang mendukung operator "mengandung" (`@>`). Trade-off konkret: index GIN jauh lebih besar dan memperlambat tulis lebih terasa; untuk kolom yang **selalu dibaca sekaligus bersama barisnya** dan tidak pernah difilter, biayanya tidak ada gunanya. Itu sebabnya kolom itu tidak punya index apa pun.
- **Tidak membuat index sama sekali.** Tulis lebih cepat, penyimpanan lebih kecil, tidak ada yang perlu dirawat. Trade-off konkret: baca jadi `Seq Scan` — di 1.000 baris tidak terasa, di 1.000.000 baris satu endpoint list bisa berubah dari 3 ms jadi 900 ms, dan biasanya kamu baru tahu di produksi.

**Latihan:** di `psql`, jalankan
`EXPLAIN ANALYZE SELECT * FROM saved_addresses WHERE "userId" = '<id>' AND "isDefault" = true;`
lalu
`EXPLAIN ANALYZE SELECT * FROM saved_addresses WHERE "isDefault" = true;`
**Verifikasi:** query pertama menyebut nama index (`…_userId_isDefault_idx`), query kedua kemungkinan besar `Seq Scan`. Tulis satu paragraf yang menjelaskan hasilnya memakai aturan prefix kiri. Catatan jujur: di tabel yang isinya cuma beberapa baris, PostgreSQL sering memilih `Seq Scan` **walaupun** index-nya cocok — karena membaca 5 baris memang lebih murah daripada membuka index. Kalau itu terjadi, isi tabelnya dengan ~50.000 baris dummy dulu (`INSERT INTO saved_addresses SELECT …` dari `generate_series`), lalu `ANALYZE saved_addresses;` dan ulangi. Ini bukan gangguan — ini pelajaran tersendiri tentang kenapa benchmark di database kosong selalu bohong.

---

### 3.6 Constraint yang Prisma tak bisa ungkapkan: `CHECK` dan partial unique index

Di sinilah kamu harus berhenti percaya bahwa `schema.prisma` = seluruh schema database. Dua constraint terpenting di repo ini **tidak ada** di `schema.prisma`. Mereka hanya ada di file `migration.sql`, ditulis tangan, dan kalau seseorang menulis ulang migration-nya tanpa membaca komentar, mereka akan hilang tanpa satu test pun berubah warna.

**`CHECK`** adalah aturan per-baris yang ditegakkan database. Contohnya `prisma/migrations/20260613050000_add_wallet_referrals/migration.sql:10-11`:

```sql
-- Defense-in-depth: the spend CAS guards balance >= amount; this backstops it.
ALTER TABLE "users" ADD CONSTRAINT "users_creditBalance_nonneg" CHECK ("creditBalance" >= 0);
```

Perhatikan kata "backstops". Lapis pertamanya ada di `src/wallet/wallet.service.ts:65-75` — `updateMany` dengan `where: { creditBalance: { gte: amt } }`, yang tidak punya jendela antara "cek saldo" dan "kurangi saldo". `CHECK`-nya ada untuk saat lapis pertama itu salah ditulis, di-bypass oleh script, atau dilewati oleh jalur baru yang lupa. Pertanyaan yang layak kamu jawab sendiri: kalau lapis pertama sudah benar, kenapa `CHECK`-nya tetap ada? (Jawaban singkat: karena "sudah benar" adalah klaim tentang kode hari ini, sedangkan `CHECK` adalah klaim tentang data selamanya.)

**Partial unique index** adalah unique yang hanya berlaku untuk sebagian baris. Ini yang tidak bisa diungkapkan Prisma sama sekali, dan repo ini memakainya sebagai **mekanisme concurrency**, bukan sekadar validasi. Dua contoh:

```sql
-- prisma/migrations/20260613042513_add_promo_codes/migration.sql:62-66
CREATE UNIQUE INDEX "promo_redemptions_active_per_user_key"
  ON "promo_redemptions"("promoCodeId", "userId")
  WHERE "status" = 'REDEEMED';
```

Artinya: satu user boleh punya banyak baris redemption untuk satu kode promo, tapi hanya boleh **satu** yang berstatus `REDEEMED`. Dan komentar di `prisma/schema.prisma:721-724` melarang keras memperbaikinya jadi `@@unique` Prisma:

> **(Do NOT add `@@unique` here — a full unique would block cancel-then-reapply.)**

Baca kalimat itu dua kali. Unique penuh akan **benar secara teknis tapi salah secara produk**: user yang membatalkan pesanan lalu memesan ulang tidak akan bisa memakai kode promonya lagi, karena baris `RELEASED` yang lama masih memblokir.

Contoh kedua, `prisma/migrations/20260613231012_add_drone_commands/migration.sql:39-42`: `WHERE "status" IN ('PENDING', 'FETCHED')` — boleh banyak perintah yang sudah selesai, hanya boleh satu yang masih terbuka per delivery. Dua admin yang menekan "Return to base" bersamaan → salah satunya kena P2002 → diterjemahkan jadi HTTP 409 di `src/deliveries/commands/drone-command.service.ts:179-185`. Tidak ada lock, tidak ada antrian, tidak ada `findFirst` — cuma satu index.

Konsekuensi operasionalnya: constraint semacam ini **tidak terlihat** oleh Prisma sebagai bagian dari model, jadi ia gampang menguap saat migration ditulis ulang. Karena itu keduanya diberi komentar besar di **dua** tempat (schema *dan* migration). Tirulah kebiasaan itu di capstone-mu.

**Anchor:**
- `prisma/migrations/20260613050000_add_wallet_referrals/migration.sql:10-11` — `CHECK` saldo + kata "defense-in-depth".
- `prisma/schema.prisma:39-41` — sisi model dari `CHECK` itu; komentarnya menyebut constraint yang tidak bisa ia tulis.
- `prisma/migrations/20260613042513_add_promo_codes/migration.sql:62-66` — partial unique per-user.
- `prisma/schema.prisma:721-724` — larangan menambahkan `@@unique`, lengkap dengan alasan produknya.
- `prisma/migrations/20260613231012_add_drone_commands/migration.sql:39-42` — satu perintah terbuka per delivery.
- `src/wallet/wallet.service.ts:65-75` — lapis pertama yang di-backstop oleh `CHECK`.

**Kenapa dipakai di sini:** karena alternatifnya (`SELECT … FOR UPDATE`, atau cek di service) sama-sama lebih mahal atau lebih bocor. Partial unique tidak mengambil lock apa pun; pemenang ditentukan oleh index, dan yang kalah dapat error yang jelas.

**Alternatif:**
- **Validasi di service (`findFirst` lalu `throw`).** Pesan errornya bisa diatur, tidak butuh SQL mentah, gampang di-unit-test dengan Prisma yang di-mock. Trade-off konkret: bocor di bawah concurrency — dan justru di jalur promo/perintah drone itulah dua request bersamaan paling mungkin terjadi (double-tap di mobile, dua admin di dashboard).
- **`SELECT … FOR UPDATE` (pessimistic lock).** Benar juga, dan lebih mudah dipikirkan karena berurutan. Trade-off konkret: lock ditahan sampai transaksi commit, jadi throughput jatuh saat banyak request menyentuh baris yang sama, dan kamu membuka kemungkinan deadlock kalau dua jalur mengunci dalam urutan berbeda.
- **Trigger PL/pgSQL.** Bisa mengekspresikan aturan apa pun, termasuk yang melibatkan banyak tabel. Trade-off konkret: tersembunyi dari siapa pun yang membaca `schema.prisma`, tidak muncul di stack trace aplikasi, dan sulit di-debug saat perilakunya mengejutkan. Repo ini memakai plpgsql **hanya** untuk maintenance partisi, tidak pernah untuk aturan bisnis.

**Latihan:** di `psql`, jalankan `UPDATE users SET "creditBalance" = -1 WHERE id = '<id>';`. **Verifikasi:** gagal dengan `new row for relation "users" violates check constraint "users_creditBalance_nonneg"`. Lalu buktikan partial unique-nya: masukkan dua baris `promo_redemptions` dengan `(promoCodeId, userId)` sama — satu berstatus `RELEASED`, satu `REDEEMED` (harus berhasil), lalu tambahkan satu lagi berstatus `REDEEMED` (harus gagal). Kalau kamu bisa menjelaskan kenapa baris `RELEASED` tidak ikut memblokir, kamu sudah paham partial unique.

---

### 3.7 Migration sebagai DDL berversi: urutan, backfill, dan gerbang drift

Analogi terbaiknya adalah git — dan analogi itu bertahan lebih jauh dari biasanya. Folder `prisma/migrations/` berisi 37 folder bertimestamp, masing-masing satu file `migration.sql`, dijalankan **berurutan** di setiap environment lewat `prisma migrate deploy`. Sekali sebuah migration sudah dijalankan di mesin orang lain, isinya **tidak boleh diedit** — sama persis dengan commit yang sudah di-push. Kalau kamu salah, kamu menulis migration baru yang memperbaikinya, bukan mengubah yang lama.

Ada tiga pelajaran yang hanya bisa dipelajari dari migration nyata, dan ketiganya ada di repo ini.

**Pertama: urutan operasi menentukan berhasil atau gagal.** Lihat `prisma/migrations/20260613050000_add_wallet_referrals/migration.sql:13-18`. Kolom `referralCode` ditambahkan sebagai nullable, lalu **semua user lama diisi kodenya**, baru setelah itu `CREATE UNIQUE INDEX`. Kalau urutannya dibalik, index-nya gagal — atau lebih buruk, kalau backfill-nya menulis nilai yang sama untuk semua orang, migration-nya gagal di tengah dan kamu punya database setengah jadi.

Versi paling instruktifnya ada di `prisma/migrations/20260801030416_add_drone_fleet_entity/migration.sql:42-91`, dengan komentar sepanjang 15 baris:

> Adding the FK below against a POPULATED table would fail on every one of them, so materialise an aircraft row for each distinct id first.

Kolom `deliveries.assignedDroneId` selama ini string bebas berisi `drone-<uuid>` yang tidak merujuk apa pun. Menambahkan FK ke tabel `drones` yang belum punya baris-baris itu = gagal untuk **setiap** baris. Jadi migration itu: buat tabel → isi satu baris pesawat untuk tiap id yang pernah dipakai (`:57-70`) → pulihkan klaim in-flight (`:72-87`) → **baru** pasang FK (`:91`).

Yang paling layak ditiru adalah pilihan **nilai** backfill-nya:

> maxPayloadKg 0 and homeBase 0,0 are NOT NULL placeholders chosen to be obviously unusable rather than plausibly wrong

Pesawat hasil backfill sengaja dibuat "jelas rusak" (payload 0 kg tidak akan cocok dengan paket apa pun, dan statusnya `GROUNDED`), bukan "kelihatan masuk akal". Data placeholder yang terlihat wajar adalah bom waktu.

**Kedua: migration bisa memindahkan DATA, bukan cuma struktur.** `prisma/migrations/20260809133410_add_airspace_zones/migration.sql:35-43` memindahkan dua zona bandara dari sebuah konstanta TypeScript ke dalam tabel, dan komentarnya menandai bahayanya:

> This is load-bearing. Task 3 deletes that constant, and without these rows the geometry would simply find no zones — the airspace this system protects would open silently, with every test still green.

Ini contoh sempurna dari kelas bug yang paling menakutkan: sistem gagal **membuka**, bukan menutup, dan seluruh test tetap hijau.

**Ketiga: gerbang drift.** Karena banyak DDL di sini ditulis tangan (partial unique, `CHECK`, partisi), harus ada yang memastikan `schema.prisma` dan database sungguhan tidak berpisah jalan. Itu tugas `npm run prisma:drift-check` (`package.json:31`), yang isinya:

```
prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Ia berjalan di CI **setelah** `prisma migrate deploy` (`.github/workflows/ci.yml:63-69`) dan harus melaporkan "No difference". Komentar di workflow-nya menyebut apa yang sedang dijaga: *"A non-empty diff means a schema/migration change is trying to un-partition a table (or a `db push`/`db pull` mangled the schema) — fail the build."*

Alur kerja praktismu di fase ini:

```bash
# 1. ubah prisma/schema.prisma
npx prisma migrate dev --create-only --name add_sesuatu   # hasilkan SQL-nya, JANGAN apply
# 2. buka file migration.sql yang baru, sisipkan backfill/CHECK/partial unique dengan urutan yang benar
npx prisma migrate dev                                     # baru apply
npm run prisma:drift-check                                 # harus "No difference"
npm run build && npm test
```

`--create-only` adalah kebiasaan yang harus kamu bentuk sekarang: ia memberi kamu kesempatan membaca dan menyunting SQL sebelum ia menyentuh apa pun.

**Anchor:**
- `prisma/migrations/20260613050000_add_wallet_referrals/migration.sql:13-18` — backfill **sebelum** unique index.
- `prisma/migrations/20260801030416_add_drone_fleet_entity/migration.sql:42-56` — komentar alasan; `:57-70` backfill; `:91` FK dipasang terakhir.
- `prisma/migrations/20260809133410_add_airspace_zones/migration.sql:35-43` — data migration yang *load-bearing*.
- `prisma/migrations/20260619140000_partition_deliveries/migration.sql:10-13` — *"ONE transaction (Prisma wraps it): an abort rolls back to the pre-migration plain table"* — satu file migration = satu transaksi.
- `package.json:26-31` — semua script Prisma yang akan kamu pakai.
- `.github/workflows/ci.yml:63-69` — gerbang drift di CI, lengkap dengan alasannya.
- `prisma/PARTITIONING.md:66-71` — larangan `prisma db push` **dan** `db pull`.

**Kenapa dipakai di sini:** repo ini punya objek database yang tidak bisa dinyatakan Prisma (partisi, partial unique, `CHECK`, rutin plpgsql). Tanpa gerbang drift, satu `prisma migrate dev` yang dijalankan sembarangan bisa menghasilkan migration yang mengembalikan tabel terpartisi jadi tabel biasa — dan itu kehilangan data, bukan cuma kehilangan performa.

**Alternatif:**
- **`prisma db push`.** Langsung menyamakan database dengan schema, tanpa file riwayat, tanpa nama. Sangat enak untuk prototipe hari pertama. Trade-off konkret: **dilarang keras di repo ini** (`prisma/PARTITIONING.md:66-71`) karena ia akan membuat ulang tabel terpartisi sebagai tabel biasa — dan di proyek mana pun ia berarti kamu tidak punya cara memutar ulang perubahan atau menerapkannya ke produksi secara terkendali.
- **Flyway / Liquibase / node-pg-migrate.** Migration SQL murni, tanpa ORM. Kontrol penuh, dukungan *repeatable migration* (file yang dijalankan ulang setiap kali berubah — cocok untuk view dan function), dan tim DBA sudah mengenalnya. Trade-off konkret: tidak ada sinkronisasi otomatis dengan tipe TypeScript, jadi kolom baru tidak akan pernah membuat `npm run build` gagal — kompiler berhenti jadi jaring pengaman.
- **`synchronize: true` ala TypeORM.** Schema mengikuti entity otomatis saat boot. Trade-off konkret: sekelas dengan `db push`, dan lebih berbahaya karena berjalan **otomatis saat aplikasi start** — satu rename properti di produksi bisa berarti satu `DROP COLUMN` yang diam.

**Latihan:** tambahkan `nickname String?` ke `model Drone`, jalankan `npx prisma migrate dev --create-only --name add_drone_nickname`, baca SQL-nya, lalu apply dan jalankan `npm run prisma:drift-check` — harus bersih. Sekarang eksperimen keduanya: **secara manual** tambahkan `CREATE INDEX drones_nickname_idx ON drones("nickname");` ke file migration itu, jalankan `npm run db:reset`, lalu drift-check lagi. **Verifikasi:** catat hasilnya apa adanya. Lalu ulangi dengan `CREATE UNIQUE INDEX … WHERE "nickname" IS NOT NULL;` (partial). Dua percobaan ini menunjukkan kelas objek mana yang **terlihat** oleh Prisma dan mana yang **tidak** — dan yang tidak terlihat itulah yang bisa hilang diam-diam saat migration ditulis ulang. Bukti pendukungnya: repo ini punya dua partial unique dan satu `CHECK` di database, dan CI-nya tetap melaporkan "No difference".

---

### 3.8 Seed idempoten, dan garis kepemilikan reference data

*Idempoten* artinya: dijalankan sekali atau sepuluh kali, hasilnya sama. Untuk seed, ini bukan kemewahan — kamu akan menjalankannya berkali-kali sehari selama fase ini.

Repo ini memakai dua teknik, di dua lapisan berbeda. Di sisi Prisma, `upsert` (`prisma/seed.ts:15-46`): "kalau email ini sudah ada, update; kalau belum, buat". Di sisi SQL, `ON CONFLICT ("code") DO NOTHING` (`prisma/migrations/20260613042513_add_promo_codes/migration.sql:68-74`): "kalau bentrok, diam saja".

Yang paling instruktif justru `prisma/seed.ts:136-156`, karena ia memperlihatkan konsekuensi nyata dari sebuah keputusan penyimpanan yang belum kamu pelajari:

> `deliveries` is partitioned (composite PK) so trackingId is no longer a unique-where; idempotent find-or-create, and the trackingId-registry row (which the service create() writes) must be created here too since the seed bypasses the service.

Dua hal terjadi di situ. Pertama, `upsert` **tidak bisa dipakai** karena `upsert` butuh `where` yang unique, dan `trackingId` bukan lagi unique (alasannya di 3.10). Jadi polanya turun jadi `findFirst` → `if (existing) continue` → `create`. Kedua — dan ini yang gampang terlewat — seed harus menulis **dua** baris: `deliveries` dan `tracking_id_registry`, karena ia melewati `DeliveriesService.create()` yang biasanya mengurus keduanya. Setiap kali seed menembus service dan menulis langsung ke database, kamu mewarisi kewajiban service itu.

Ada juga garis kepemilikan yang perlu kamu pegang. `prisma/schema.prisma:666-668` menyatakannya:

> NOTE: no admin CRUD surface yet — codes are reference data seeded via the migration (and prisma/seed.ts). Admin management is deferred.

Jadi: **reference data** (kode promo, zona airspace) sumber kebenarannya di **migration** — karena ia harus ada di semua environment, ikut ter-deploy, dan ter-versi. **Data demo** (user `demo@drovery.com`, tiga delivery contoh) hidup di **seed** — karena ia hanya untuk dev lokal. `prisma/seed.ts:187-218` sengaja menduplikasi kode promo dari migration, dan komentarnya menegaskan siapa yang berkuasa: *"the migration is the source of truth; these upserts re-assert for local seeds."*

**Anchor:**
- `prisma/seed.ts:15-46` — `upsert` untuk user demo dan admin.
- `prisma/seed.ts:136-156` — find-or-create karena partisi + kewajiban menulis baris registry; `:145` adalah `if (existing) continue;`.
- `prisma/seed.ts:187-218` — kode promo yang "mirror" migration, dengan komentar kepemilikan.
- `prisma/migrations/20260613042513_add_promo_codes/migration.sql:68-74` — `INSERT … ON CONFLICT DO NOTHING`, sisi migration-nya.
- `prisma.config.ts:10-12` — dari mana perintah seed dibaca di Prisma 7.

**Kenapa dipakai di sini:** karena `npm run db:reset` menjalankan migration + seed sekaligus, dan karena pengembang (kamu) akan menjalankan seed berulang kali tanpa reset. Seed yang tidak idempoten berarti setiap kali kamu jalankan, jumlah delivery demo bertambah tiga — dan satu jam kemudian kamu bertanya-tanya kenapa daftar delivery-mu berisi 27 item.

**Alternatif:**
- **Seed lewat migration saja.** Data ikut ter-deploy ke semua environment otomatis dan ter-versi bersama schema. Trade-off konkret: tidak bisa dijalankan ulang sesuka hati (migration hanya jalan sekali), dan sangat tidak cocok untuk data demo yang ingin kamu buang-dan-buat berkali-kali. Repo ini memakai ini **hanya** untuk reference data.
- **Fixture per-test (factory function).** Setiap test membuat datanya sendiri, jadi test tidak pernah bergantung pada isi seed dan bisa jalan paralel. Trade-off konkret: kamu tidak punya database dev yang langsung bisa dipakai dari aplikasi mobile — dan repo ini butuh itu, karena verifikasi manual (`AUDIT-PLAN.md:62-71`) adalah bagian dari protokolnya.
- **Dump SQL (`pg_dump` dari database yang sudah bagus).** Cepat, realistis, dan memuat kasus aneh yang tidak akan kamu karang sendiri. Trade-off konkret: buram (tidak bisa di-review sebagai diff yang bermakna), cepat basi terhadap schema, dan gampang tidak sengaja memuat data pribadi.

**Latihan:** jalankan `npm run prisma:seed` **dua kali** berturut-turut. Hitung barisnya di antara dua run: `SELECT count(*) FROM deliveries;` dan `SELECT count(*) FROM tracking_id_registry;`. **Verifikasi:** kedua angka sama persis setelah run kedua. Sekarang hapus baris `if (existing) continue;` di `prisma/seed.ts:145`, jalankan sekali lagi, dan baca error-nya — kode error Prisma yang muncul adalah kode yang sama yang dipakai untuk retry di `deliveries.service.ts`. Kembalikan barisnya.

---

### 3.9 `PrismaService`: pool, driver adapter, `READER_OMIT`, dan urutan shutdown

Di aplikasi Ionic-mu, tiap `fetch` membuka koneksi HTTP dan menutupnya; kamu tidak pernah memikirkannya. Di sisi server, koneksi ke PostgreSQL itu mahal (proses baru di sisi database), jadi tidak ada koneksi baru per request. Yang ada **connection pool**: sekumpulan koneksi yang dibuka sekali lalu dipinjam-pakai. Ini konsep yang tidak punya padanan di dunia frontend, jadi pelan-pelan.

`src/prisma/prisma.service.ts:30-35` adalah tempatnya:

```ts
const max = parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max });
super({ adapter: new PrismaPg(pool as any), omit: READER_OMIT });
```

dengan komentar di `:31-32`:

> Bound the per-instance primary pool. With N replicas, N × max must stay under Postgres `max_connections` — or point DATABASE_URL at PgBouncer.

Aritmetikanya nyata: kalau kamu menjalankan 10 pod API dan tiap pod punya `max: 10`, kamu memakai 100 koneksi, sementara PostgreSQL default hanya mengizinkan 100 total (dan sebagian sudah dipakai worker + tool). Pod ke-11 akan gagal boot dengan error yang membingungkan. Anggaran koneksi adalah hal yang harus kamu hitung, bukan kamu harapkan.

`PrismaService extends PrismaClient` — jadi objek yang kamu inject **adalah** client-nya; `this.prisma.user.findMany()` bekerja langsung. Dan `src/prisma/prisma.module.ts:4-9` menandainya `@Global()`, artinya modul lain tidak perlu meng-import `PrismaModule`. Ini penjelasan kenapa `PrismaService` bisa muncul di constructor mana pun tanpa import yang kelihatan.

Dua detail lagi yang layak dihafal.

**`READER_OMIT`** (`:14-16`) — hash OTP serah-terima dan penghitung percobaannya disembunyikan di level **client**, bukan di level query. Artinya tidak ada satu pun `findMany` di seluruh repo yang bisa tidak sengaja mengembalikannya; hanya jalur `confirmHandoff` yang secara eksplisit memintanya kembali. Ini pola pertahanan berlapis yang bagus ditiru: default-nya aman, pengecualiannya eksplisit dan sedikit.

**Urutan shutdown** (`:132-149`) — dan ini cerita bug sungguhan, bukan teori. Komentarnya:

> Nest runs onModuleDestroy -> beforeApplicationShutdown -> onApplicationShutdown, and @nestjs/bullmq closes its workers in onApplicationShutdown. Disconnecting in onModuleDestroy therefore pulled the database out from under every job still draining — so each deploy killed the in-flight work that `enableShutdownHooks` exists to protect.

Terjemahannya: dulu `PrismaService` menutup koneksi di `onModuleDestroy`, yang berjalan **lebih dulu** daripada penutupan worker BullMQ. Hasilnya, setiap deploy membunuh job yang sedang berjalan — persis kebalikan dari tujuan graceful shutdown. Perbaikannya satu kata: `onApplicationShutdown`. Commit-nya masih bisa kamu baca: `5bdfec4 fix(prisma): disconnect on application shutdown, not module destroy`.

Pelajaran umum yang harus kamu bawa: **lifecycle hook punya urutan, dan urutan itu bisa merusak data.** Ini kelas bug yang tidak akan pernah ditangkap unit test.

**Anchor:**
- `src/prisma/prisma.service.ts:30-35` — pool + driver adapter + `omit`.
- `src/prisma/prisma.service.ts:14-16` — `READER_OMIT`, kolom rahasia disembunyikan di level client.
- `src/prisma/prisma.service.ts:110-130` — `onModuleInit` → `$connect()`, dan kenapa replika yang mati tidak boleh membunuh boot.
- `src/prisma/prisma.service.ts:132-149` — `onApplicationShutdown` + cerita bug deploy lengkapnya.
- `src/prisma/prisma.module.ts:4-9` — `@Global()`.
- `.env.example:9-10` — `DATABASE_POOL_MAX` beserta catatan PgBouncer.

**Kenapa dipakai di sini:** karena satu instance client dipakai bersama seluruh aplikasi. Objek `readerClient` di `:25-28` (read replica) adalah materi Fase 5 — cukup ketahui sekarang bahwa ia ada, bahwa ia `null` di dev, dan bahwa aturan pemakaiannya ditulis eksplisit di `:68-79`.

**Alternatif:**
- **`new PrismaClient()` di setiap service.** Terlihat sederhana dan menghilangkan satu lapisan DI. Trade-off konkret: setiap instance membuka pool sendiri — 15 service = 150 koneksi dari satu proses, dan `max_connections` habis sebelum kamu punya user kedua. Ini kesalahan paling umum pemula Prisma + Nest.
- **PgBouncer (pool di sisi database) ketimbang pool di aplikasi.** Memusatkan anggaran koneksi, wajib begitu jumlah pod banyak, dan sudah disiapkan di `docker-compose.yml`. Trade-off konkret: mode `transaction` melarang prepared statement tertentu dan session state (`SET`, advisory lock lintas-statement), jadi beberapa hal yang jalan di dev bisa gagal di produksi. Ini materi Fase 10.
- **Prisma driver adapter (`@prisma/adapter-pg`, yang dipakai di sini) vs engine bawaan Rust.** Adapter memakai driver `pg` Node, jadi pool bisa dikonfigurasi langsung dan perilakunya bisa kamu lihat di satu tempat. Trade-off konkret: kamu bergantung pada dua library yang harus cocok versinya, dan sebagian optimasi engine bawaan tidak berlaku.

**Latihan:** jalankan aplikasi dengan `DATABASE_POOL_MAX=1`, lalu tembak satu endpoint list dengan 20 request paralel: `for i in $(seq 1 20); do curl -s -o /dev/null -w "%{time_total}\n" <url> & done; wait`. Catat sebaran waktunya. Ulangi dengan `DATABASE_POOL_MAX=10`. **Verifikasi:** dengan pool 1, waktu total request ke-20 kira-kira 20× waktu satu request; dengan pool 10 jauh lebih rata. Lalu jawab: di titik mana menambah pool berhenti membantu, dan kenapa `max_connections` PostgreSQL adalah batas kerasnya?

---

### 3.10 Transaksi: atomicity, `tx` yang wajib, dan APA YANG TIDAK IKUT ROLLBACK

Transaksi adalah janji "semua berhasil, atau tidak ada yang terjadi". Padanan terdekat di duniamu: `Promise.all` yang kalau satu gagal, semua efeknya dibatalkan — kecuali `Promise.all` tidak bisa membatalkan apa pun, dan transaksi bisa. Itulah bedanya.

Contoh terbaik di repo ini adalah `src/deliveries/deliveries.service.ts:405-415` (komentar) dan `:421` (`$transaction`-nya):

> The delivery row + the trackingId-registry row (+ any promo/credit/referral balance mutations) commit in ONE transaction… so there's never an orphan delivery, an over-counted code, or an unregistered id.

Di dalam satu transaksi itu: baris delivery dibuat, baris registry tracking id dibuat, kode promo ditandai terpakai, saldo dompet didebit, hadiah referral diberikan. Kalau debit saldo gagal (saldo kurang), **semuanya** mundur — tidak ada delivery yatim, tidak ada kode promo yang terhitung terpakai padahal ordernya batal.

Aturan mekanis yang wajib kamu pegang: `$transaction(async (tx) => …)` memberi kamu objek `tx`, dan **setiap** query di dalam callback itu harus memakai `tx`, bukan `this.prisma`. Kalau kamu memakai `this.prisma` di dalam callback, query itu jalan di koneksi lain, di luar transaksi, dan **tidak ikut rollback**. Ini bug hening klasik: kodenya terlihat benar, test dengan Prisma yang di-mock tetap hijau (karena `prisma` dan `tx` adalah `jest.fn` yang sama), dan datanya rusak diam-diam. Repo ini bahkan punya commit untuk kelas bug ini: `6345608 fix(audit): assert WHICH client each call site hands the audit service`. Perhatikan bagaimana setiap helper menerima `tx` sebagai parameter pertama: `walletService.debitWithinTx(tx, …)`, `promoService.redeemWithinTx(tx, …)`, `outbox.enqueueWithinTx(tx, …)`. Penamaan `…WithinTx` itu bukan gaya; itu pengingat.

Tapi bagian paling berharga dari konsep ini bukan apa yang **ikut** rollback, melainkan apa yang **tidak**. Baca `src/deliveries/deliveries.service.ts:486-489`:

> The claim committed on the `drones` table (a separate, non-partitioned row) so this rollback does not undo it, and every later release is keyed on a delivery row that will never exist — the aircraft would be held out of service permanently.

Klaim pesawat terjadi **sebelum** transaksi dimulai (karena dispatch harus memilih pesawat untuk menghitung rutenya). Jadi kalau transaksi gagal, klaim itu tetap tertulis, dan pesawatnya akan dianggap sibuk selamanya. Solusinya bukan sihir database melainkan kode kompensasi manual: `releaseClaimedAircraft(...)` di `:490`. Ini pintu masuk ke pola **saga**, dan aturannya bisa kamu hafalkan sekarang:

> Begitu satu efek samping keluar dari transaksi, kamu wajib menulis kebalikannya sendiri.

Efek samping lain yang berada **di luar** transaksi secara sengaja: pembuatan PaymentIntent Stripe (`:504-513`), dijalankan setelah transaksi commit dan bersifat best-effort. Alasannya operasional: memegang transaksi database sambil menunggu API pihak ketiga adalah cara tercepat menghabiskan connection pool — satu API Stripe yang lambat 3 detik akan menahan satu koneksi selama 3 detik, dikali jumlah request.

Satu hal terakhir. Di sinilah kamu akan bertemu keanehan yang saya janjikan di pembuka: `Delivery` **tidak punya** `findUnique({ where: { id } })`. Penyebabnya satu aturan PostgreSQL — tabel yang di-partisi RANGE **wajib memuat partition key di setiap unique/PK constraint** (`prisma/PARTITIONING.md:59-61`). Akibatnya PK `Delivery` jadi composite `@@id([id, createdAt])` (`schema.prisma:352`), `trackingId` tidak bisa lagi unique sehingga lahir tabel `TrackingIdRegistry` (`schema.prisma:359-374`), dan `activeDeliveryId` harus tinggal di tabel `drones`. Seluruh cerita partisinya adalah materi **Fase 6**; yang perlu kamu lakukan sekarang cuma mengenali gejalanya dan tahu di mana jawabannya. Komentar `schema.prisma:281-289` adalah ringkasan terbaiknya.

**Anchor:**
- `src/deliveries/deliveries.service.ts:405-415` — daftar apa saja yang co-commit dalam satu transaksi.
- `src/deliveries/deliveries.service.ts:421-477` — isi `$transaction`-nya; perhatikan **setiap** query memakai `tx`.
- `src/deliveries/deliveries.service.ts:486-490` — apa yang **tidak** ikut rollback, dan kompensasinya.
- `src/deliveries/deliveries.service.ts:504-513` — Stripe sengaja di luar transaksi.
- `src/wallet/wallet.service.ts:65-75` — contoh helper `…WithinTx` yang menerima `tx` dan melempar untuk membatalkan seluruh transaksi.
- `prisma/schema.prisma:281-289` — komentar "PARTITIONED TABLE" yang menjelaskan kenapa `findUnique` hilang.
- `prisma/PARTITIONING.md:59-65` — aturannya, dalam dua bullet.

**Kenapa dipakai di sini:** `create()` harus memakai `$transaction` **interaktif** (callback), bukan bentuk array, karena ia butuh `created.id` dan `created.createdAt` dari query pertama untuk menyusun query berikutnya (baris registry, kunci idempotensi `debit:<id>`). Ini alasan teknis yang spesifik, bukan preferensi.

**Alternatif:**
- **`$transaction([...])` bentuk array/batch.** Satu round-trip, lebih sederhana, tidak bisa lupa memakai `tx`. Trade-off konkret: kamu tidak bisa memakai hasil query pertama untuk menyusun query kedua — yang persis dibutuhkan di sini, jadi bentuk ini tidak bisa dipakai untuk `create()`.
- **Tanpa transaksi + kompensasi (saga).** Satu-satunya pilihan begitu penulisan menyeberang database/shard/service. `SCALING-1M.md` §2 menyebut transaksi ini "HARD BLOCKER" untuk sharding dan memilih desain *debit-first saga*. Trade-off konkret: jauh lebih skalabel, tapi kamu menukar satu jaminan database dengan state tambahan (reservasi, kompensasi, rekonsiliasi) yang harus kamu tulis, uji, dan monitor sendiri.
- **Transaksi yang mencakup panggilan HTTP eksternal.** Terlihat paling "benar" (semua atau tidak sama sekali, termasuk pembayaran). Trade-off konkret: jangan. Lock dan koneksi ditahan selama latensi pihak ketiga, dan pihak ketiga tidak punya kewajiban cepat. Repo ini menaruh Stripe di luar dan menerima konsekuensinya secara sadar.

**Latihan:** di `src/deliveries/deliveries.service.ts`, sisipkan `throw new Error('boom');` tepat sebelum `return created;` (`:476`). Buat satu delivery lewat API. **Verifikasi** di `psql`: `SELECT count(*) FROM deliveries;` tidak bertambah, `tracking_id_registry` juga tidak — tapi periksa `SELECT id, "activeDeliveryId", status FROM drones WHERE "activeDeliveryId" IS NOT NULL;`. Apakah pesawatnya sudah dilepas? Telusuri jalur mana yang melepasnya dan pada baris berapa. Hapus `throw`-nya setelah selesai (`git diff` sebelum commit adalah temanmu).

---

### 3.11 Membaca repo secara skeptis: `✅` vs `🟡` vs `📐`, dan bagian `Left undone`

Ini bukan konsep teknis. Ini keterampilan, dan mungkin yang paling bernilai dari seluruh fase.

Repo ini menulis alasannya sendiri di enam dokumen tingkat-repo, satu runbook, satu rencana perbaikan (`AUDIT-PLAN.md`), dan satu log append-only sepanjang 2.297 baris (`AUDIT-LOG.md`). Masalahnya: **file yang sama memuat tiga jenis klaim yang berbeda**, dan bahasanya sama-sama percaya diri. Ada yang sudah dibangun dan diverifikasi, ada yang baru dirancang, dan ada yang sudah dibantah oleh entri berikutnya.

Karena itu ada sistem penanda:

| Penanda | Artinya |
|---|---|
| `✅` | sudah dibangun **dan** diverifikasi |
| `🟡` | separuh jalan — baca kalimat setelahnya, biasanya menyebut sisa pekerjaannya |
| `📐` / "Designed here, built later" | baru desain, **belum ada kodenya** |
| `**ILLUSTRATIVE**` / `FILL FROM RUN` | angka placeholder, bukan hasil pengukuran |
| `### Left undone / follow-ups` | utang teknis yang **diakui**, per increment, di `AUDIT-LOG.md` |

Contoh paling murni ada di `SCALING-1M.md:63-91`: satu tabel berjudul "✅ Built + verified in this PR" (`:67`) dan satu lagi "📐 Designed here, built later" (`:81`), lengkap dengan kolom *Verified* dan *Prerequisite*. Dokumen itu sengaja dibentuk supaya **tidak bisa dipakai untuk over-claim**. Bandingkan dengan `ARCHITECTURE.md:11-16`, yang menandai empat "hard blocker" awal — tiga `✅`, satu `🟡` (geocoding: sudah di-cache Redis, tapi swap ke provider komersial belum).

Lalu ada disiplin yang lebih dalam lagi. `AUDIT-PLAN.md:62-71` membuka dengan kalimat yang harus kamu tempel di dinding:

> Baseline at audit time: **1,073 tests passing, all three repos typecheck clean, lint clean** — while an entire user-facing feature (support tickets) was unreachable and no payment had ever been captured. `supportApi.createTicket` has its own passing test and zero call sites.

Test hijau bukan bukti. Karena itu protokolnya punya tiga lapis: (a) *acceptance criteria* berbentuk perilaku, bukan coverage; (b) verifikasi manual yang **dicatat isinya** — lihat `AUDIT-LOG.md:2049-2062`, yang mencantumkan isi tabel `airspace_zones` sungguhan, bukan sekadar "sudah dicek"; (c) **mutation testing** sebelum merge (`AUDIT-LOG.md:2069-2078`: 15 mutasi, 15 tertangkap), dengan aturan anti-menipu-diri: *"the harness treats a run that executed zero tests as a failure rather than a pass"*.

Dan bagian yang paling berguna untukmu sebagai pembaca baru adalah `### Left undone / follow-ups` — ada 16 bagian seperti itu di `AUDIT-LOG.md`, satu per increment. Di sanalah repo mengakui apa yang belum beres. Contoh dari yang terbaru (`:2236-2289`): "In-flight breach detection against `floorM`/`ceilingM` … **nothing reads it**" dan "The `@IsOptional()` null hole is repo-wide, not local to airspace." Itu bukan bug tersembunyi; itu bug yang **diketahui, ditulis, dan ditunda dengan alasan** — dan membacanya lebih cepat daripada menemukannya sendiri.

Aturan menulisnya juga tegas (`AUDIT-PLAN.md:638-644`): *"Never rewrite a past entry. Append a correcting entry instead."* Log ini append-only, jadi kesalahan lama tetap terlihat — dan itu fitur, bukan kelalaian.

**Anchor:**
- `SCALING-1M.md:63-91` — dua tabel: `✅` (dari `:67`) dan `📐` (dari `:81`). Baca sebelum apa pun soal skala.
- `ARCHITECTURE.md:11-16` — TL;DR empat hard blocker dengan status terkini, satu di antaranya `🟡`.
- `AUDIT-PLAN.md:62-71` — §1.1 "The test suite will not catch your mistakes".
- `AUDIT-PLAN.md:603-644` — template entri log 8 bagian + aturan mainnya.
- `AUDIT-LOG.md:2049-2062` — contoh blok *Verification* yang mencantumkan bukti, bukan klaim (termasuk `prisma:drift-check: No difference detected`).
- `AUDIT-LOG.md:2069-2078` — protokol mutation testing.
- `AUDIT-LOG.md:2187-2225` — bagian "What the review caught"; puncaknya di `:2219-2225`, di mana menghapus satu module dari `admin.module.ts` meninggalkan *"94 green tests over an application that cannot boot"*.
- `AUDIT-LOG.md:2236-2289` — bagian `Left undone` terbaru; bacaan wajib sebelum kamu mengira sesuatu belum pernah dipikirkan.

**Kenapa dipakai di sini:** repo ini punya tiga audiens — dirinya sendiri di sesi berikutnya, dua repo klien, dan seorang reviewer. Penanda status adalah cara satu-satunya supaya dokumen tetap berguna setelah enam bulan tanpa berubah jadi iklan.

**Alternatif:**
- **ADR (Architecture Decision Records).** Satu file kecil per keputusan, bernomor, berstatus `proposed/accepted/superseded`. Trade-off konkret: jauh lebih mudah di-*diff* dan di-*supersede* satu per satu, tapi kamu kehilangan narasi lintas-keputusan — "kenapa sharding ditunda" hanya masuk akal kalau §2 dan §3 `SCALING-1M.md` dibaca berurutan.
- **Wiki / Notion.** Enak diedit, bisa dibaca non-developer, punya pencarian yang bagus. Trade-off konkret: tidak ikut di-review bersama PR dan tidak punya `git blame` — jadi klaim yang salah tidak akan pernah ketahuan lewat perubahan kode, dan dokumennya perlahan berbohong tanpa ada yang tahu kapan mulai.
- **Hanya commit message.** Repo ini juga melakukannya, dan kualitasnya tinggi (`6af2846 fix(airspace): cache the ROWS, not the answer — and make an empty read alertable`). Trade-off konkret: commit sangat bagus menjawab "kenapa baris ini berubah", tapi tidak bisa menjawab "apa status keseluruhan sistem hari ini" tanpa membaca ratusan commit.

**Latihan:** ambil satu baris `🟡` dari `ARCHITECTURE.md:11-16` (geocoding) dan satu baris `✅` (real-time tracking). Untuk masing-masing, **buktikan** statusnya di kode: cari `CacheService` di `src/cache/` dan `TrackingSubscriber` di `src/deliveries/tracking/`. **Verifikasi:** tulis lima kalimat yang menjawab "apakah penandanya jujur?", lalu cari di `AUDIT-LOG.md` bagian `Left undone` mana yang membahas sisa pekerjaannya. Kalau kamu menemukan penanda yang menurutmu terlalu optimistis, itu temuan yang sah — catat di catatanmu dengan bukti barisnya.

---

### 3.12 Alternatif yang dibandingkan: ringkasan keputusan data layer

Subbagian ini berbeda dari yang lain. Ia tidak memperkenalkan konsep baru; ia mengumpulkan **keputusan** yang tersebar di sebelas konsep sebelumnya jadi satu tabel yang bisa kamu bawa ke proyekmu sendiri. Kamu ingin tahu struktur dan alasan pemilihan teknologi — ini bagiannya.

| Keputusan | Pilihan Drovery | Alternatif utama | Harga yang diterima |
|---|---|---|---|
| ORM | Prisma 7 + driver adapter `pg` | TypeORM/MikroORM (decorator), Drizzle (TS murni), `pg` mentah | Butuh langkah `generate`; DSL sendiri; sebagian SQL (partial unique, `CHECK`, partisi) harus ditulis tangan di luar model |
| Bentuk PK | `String @id @default(uuid())` (UUIDv4) | auto-increment `Int`, UUIDv7/ULID | Index lebih besar; insert menyebar acak di B-tree; ditukar dengan id yang bisa dibuat **sebelum** insert |
| Penghapusan | `Cascade` / `SetNull` / tanpa FK, dipilih per-relasi | soft-delete `deletedAt` global, `RESTRICT` di mana-mana | Tidak ada satu aturan yang berlaku umum — tiap relasi harus dipikirkan dan alasannya ditulis |
| Uang | `Float` (`creditBalance`, `amount`, `estimatedPrice`, `finalTotal`) | `Decimal @db.Decimal(12,2)` (`NUMERIC`) | **Berisiko.** Floating point tidak eksak; dimitigasi `round2()` di setiap tulis + `CHECK >= 0`, bukan dihilangkan |
| Himpunan nilai | enum PG untuk state machine, `String` untuk `locale` | tabel lookup, `CHECK … IN (...)` | Menambah nilai enum = migration + deploy |
| Aturan yang Prisma tak bisa tulis | partial unique + `CHECK` di `migration.sql` | cek di service, `FOR UPDATE`, trigger plpgsql | Tidak terlihat di `schema.prisma`; harus dikomentari di dua tempat supaya tidak menguap |
| Perubahan schema | `prisma migrate` + gerbang drift di CI | `db push`, Flyway/Liquibase, `synchronize: true` | Setiap perubahan butuh file SQL yang di-review; `db push`/`db pull` dilarang keras |
| Reference data | migration = sumber kebenaran; seed = penegasan lokal | seed-only, dump SQL, fixture per-test | Duplikasi yang disengaja antara `migration.sql` dan `seed.ts`, dijaga oleh komentar |

Dua baris di tabel itu layak dibicarakan lebih jujur.

**`Float` untuk uang adalah keputusan yang berisiko, dan repo ini tahu itu.** Binary floating point tidak bisa merepresentasikan `0.1` secara eksak, jadi penjumlahan berulang bisa menghasilkan `10.000000000000002`. Mitigasinya terlihat di `src/wallet/wallet.service.ts:13-15` — fungsi `round2()` yang dipanggil di **setiap** tulis — plus `CHECK ("creditBalance" >= 0)` di database. Itu mengurangi kelas bugnya, tidak menghapusnya. `Decimal @db.Decimal(12,2)` akan menghapusnya sepenuhnya, dengan harga: aritmetika lebih lambat, dan tipe di client jadi objek `Decimal` (bukan `number`), yang berarti setiap perhitungan harga, setiap komponen React yang menampilkan angka, dan setiap serialisasi JSON harus diubah. Itu bukan alasan untuk tidak melakukannya; itu ukuran biayanya.

**Prisma vs Drizzle** adalah pilihan yang paling mungkin kamu hadapi lagi di proyek berikutnya. Ringkasan yang bisa ditindaklanjuti: Prisma menang kalau kamu menghargai satu file sebagai peta domain, `prisma studio`, dan migration tooling yang matang; Drizzle menang kalau kamu banyak menulis SQL yang tidak biasa (window function, CTE rekursif, partial index) dan tidak mau bertengkar dengan abstraksi. Repo ini sudah menunjukkan batas Prisma di tiga tempat — partial unique yang ditulis tangan, `CHECK` yang tidak bisa dimodelkan, dan partisi yang harus disembunyikan dari `db pull`. Menyadari batas itu **bukan** kegagalan desain; yang gagal adalah tidak menyadarinya.

**Anchor:**
- `prisma/schema.prisma:41`, `:332`, `:685`, `:715`, `:785` — kolom-kolom uang bertipe `Float`.
- `src/wallet/wallet.service.ts:13-15` — `round2()`, mitigasi yang dipilih.
- `prisma/migrations/20260613050000_add_wallet_referrals/migration.sql:10-11` — jaring keduanya.
- `prisma/schema.prisma:721-724` dan `prisma/PARTITIONING.md:59-65` — dua tempat di mana batas Prisma dinyatakan terang-terangan.
- `SCALING-1M.md:63-91` — contoh format yang memisahkan "sudah dibangun" dari "baru dirancang"; tiru bentuk ini kalau kamu menulis dokumen keputusan sendiri.

**Kenapa dipakai di sini:** karena hampir setiap baris tabel di atas punya kalimat "cost, accepted" atau "deliberately deferred" di dalam repo. Kamu bisa membaca keputusan **beserta harganya**, yang jarang tersedia di proyek open-source mana pun.

**Alternatif (cara mencatat keputusan seperti ini):**
- **Komentar di dalam kode, seperti repo ini.** Muncul persis di tempat orang berikutnya akan menyentuhnya, dan ikut ter-review bersama diff. Trade-off konkret: tersebar — untuk menjawab "apa saja keputusan data layer kita", kamu harus grep, dan komentar bisa jadi usang tanpa ada yang menyadarinya. Repo ini punya commit khusus untuk masalah itu (`2fd23c5 … pin what comments claimed`).
- **ADR terpisah di `docs/adr/`.** Satu keputusan satu file, bisa di-supersede, mudah di-index. Trade-off konkret: berjarak dari kode, jadi orang yang mengedit `schema.prisma` tidak otomatis melihatnya — dan ADR yang tidak dibaca sama tidak bergunanya dengan yang tidak ditulis.

**Latihan:** cari **semua** kolom `Float` di `schema.prisma` yang menyimpan uang (mulai dari lima anchor di atas). Di branch percobaan, ubah salah satunya jadi `Decimal @db.Decimal(12,2)`, jalankan `npx prisma generate && npm run build`. **Verifikasi:** catat berapa file `.ts` yang gagal compile dan file mana saja. Angka itu adalah ukuran biaya migrasi ke `Decimal` — dan sekarang kamu punya jawaban berbasis bukti, bukan opini. Jangan commit; `git checkout -- .` setelah selesai.

---

## Capstone

**Target:** satu migration berkualitas-merge mendarat di branch-mu di `Drovery_Backend`, dengan lampiran bukti.

Saran isi (boleh kamu ganti asal memenuhi semua kriteria): tabel `drone_inspections` — riwayat inspeksi kelaikan per pesawat — plus satu kolom `lastInspectedAt` di `drones`.

Kriteria penerimaan. Setiap butir ditulis supaya bisa **gagal di depan matamu**; kalau kamu tidak bisa membuatnya gagal, kamu belum mengujinya.

- [ ] **Migration dibuat dengan `--create-only` lalu disunting tangan.** Buktinya: file `migration.sql`-mu memuat SQL yang tidak mungkin dihasilkan Prisma (backfill dan/atau `CHECK`), dan `git log` menunjukkan kamu tidak pernah mengedit migration yang sudah ter-apply di tempat lain.
- [ ] **Kolom baru pada tabel yang sudah berisi data.** `drones` sudah punya baris dari seed. Kolom barumu nullable dulu, lalu diisi backfill.
- [ ] **Backfill berada SEBELUM constraint yang bergantung padanya.** Uji kegagalannya: pindahkan blok `ADD CONSTRAINT … FOREIGN KEY` ke atas backfill, jalankan `npm run db:reset`, dan **rekam pesan error PostgreSQL-nya** di lampiranmu. Lalu kembalikan urutannya. Kalau migration-mu tetap sukses dalam urutan terbalik, backfill-mu tidak load-bearing — rancang ulang.
- [ ] **Satu index dengan alasan tertulis di komentar**, menyebut query nyata yang dilayaninya (mis. `WHERE "droneId" = ? ORDER BY "inspectedAt" DESC`), meniru gaya `prisma/schema.prisma:660-662`.
- [ ] **Satu `CHECK` constraint** yang ditulis tangan di `migration.sql` (mis. `CHECK ("hoursAtInspection" >= 0)`), **plus komentar di `schema.prisma`** yang menyebutkan keberadaannya — karena Prisma tidak bisa menampilkannya. Uji kegagalannya: `INSERT` satu baris yang melanggar dan salin error-nya.
- [ ] **Seed idempoten.** Tambahkan data demo untuk tabel barumu di `prisma/seed.ts`. Uji: jalankan `npm run prisma:seed` dua kali dan buktikan `SELECT count(*)` identik. Uji kegagalannya: hapus penjaga idempotensinya, jalankan lagi, salin error-nya, kembalikan.
- [ ] **`npm run prisma:drift-check` bersih** ("No difference"). Kalau tidak bersih, jangan "perbaiki" dengan `db push` — cari tahu objek mana yang Prisma lihat dan kamu tidak modelkan.
- [ ] **`npm run build` bersih dan `npm test` hijau**, dengan jumlah test yang sama atau lebih banyak dari baseline yang kamu catat di gerbang masuk.
- [ ] **Lampiran `EXPLAIN ANALYZE` sebelum/sesudah** untuk query yang dilayani index-mu. Isi tabelnya dengan cukup baris (≥ 20.000) dan jalankan `ANALYZE` dulu, jika tidak planner akan memilih `Seq Scan` dan bukti-mu tidak berarti apa-apa. Yang harus terlihat: node berubah dari `Seq Scan` jadi `Index Scan`/`Bitmap Index Scan`, dan `actual time` turun secara berarti.
- [ ] **Satu paragraf `### Left undone / follow-ups`** untuk pekerjaanmu sendiri, dengan gaya `AUDIT-LOG.md:2236-2289`: spesifik, bisa ditindaklanjuti, dan jujur. Contoh yang baik: "tidak ada endpoint yang membaca tabel ini — kolomnya masih dokumentasi"; contoh yang buruk: "bisa ditingkatkan nanti".

Bonus (tidak wajib, tapi kalau kamu mengerjakannya kamu sudah setara kontributor): tambahkan satu **partial unique index** yang ditulis tangan (mis. paling banyak satu inspeksi yang belum selesai per pesawat: `CREATE UNIQUE INDEX … ON drone_inspections("droneId") WHERE "completedAt" IS NULL;`), lengkap dengan komentar larangan `@@unique` di `schema.prisma` bergaya `:721-724`, dan sebuah test yang membuktikan baris kedua ditolak.

---

## Gerbang keluar

Jawab tanpa membuka kode. Kalau ada satu saja yang tidak bisa, ulangi bagiannya sebelum masuk Fase 4.

**1. Kenapa `Drone.activeDeliveryId` bertipe `String?` polos dan bukan relasi Prisma ke `Delivery`, dan kenapa `@unique`-nya ada di tabel `drones` bukan di `deliveries`?**

<details><summary>Jawaban</summary>

Karena `deliveries` adalah tabel yang di-partisi RANGE berdasarkan `createdAt`, dan PostgreSQL mewajibkan setiap unique/PK constraint pada tabel terpartisi memuat partition key-nya. Unique atas `deliveryId` saja mustahil di sana. Foreign key ke tabel itu juga harus membawa `deliveryCreatedAt`. Jadi constraint-nya pindah ke `drones`, yang tidak terpartisi — dan di situ ia berfungsi sebagai lock: satu pesawat tidak bisa memegang dua delivery, dan satu delivery tidak bisa dipegang dua pesawat. Lihat `prisma/schema.prisma:178-182` dan `:224-228`.
</details>

**2. Apa bedanya `onDelete: SetNull` dan tanpa FK sama sekali, dan kenapa `AdminAuditLog.actorUserId` memilih yang kedua?**

<details><summary>Jawaban</summary>

`SetNull` tetap sebuah FK: database menjamin nilainya merujuk baris yang ada, dan ketika induknya dihapus, kolomnya di-null-kan. Tanpa FK, tidak ada jaminan apa pun — tapi juga tidak ada cascade yang bisa menyentuhnya. Untuk audit log, `SetNull` "menyimpan barisnya sambil menghancurkan field terpentingnya" — baris audit tanpa pelaku tidak berguna. Kolom biasa tidak bisa di-null-kan oleh cascade. `prisma/schema.prisma:1001-1008`.
</details>

**3. Kamu punya index `(userId, isDefault)`. Query mana yang bisa memakainya dan mana yang tidak?**

<details><summary>Jawaban</summary>

Bisa: `WHERE userId = ?`, dan `WHERE userId = ? AND isDefault = true`. Tidak bisa (secara efisien): `WHERE isDefault = true` sendirian, karena `isDefault` bukan prefix kiri index. Aturannya: index B-tree multi-kolom hanya berguna kalau query menyentuh kolom-kolom pertamanya secara berurutan. Catatan tambahan: pada tabel yang sangat kecil, planner boleh saja memilih `Seq Scan` walaupun index-nya cocok — itu bukan bantahan terhadap aturannya.
</details>

**4. Kenapa `CHECK ("creditBalance" >= 0)` tetap ada padahal CAS di `wallet.service.ts` sudah menjamin saldo tidak akan negatif?**

<details><summary>Jawaban</summary>

Karena CAS adalah jaminan tentang **satu jalur kode hari ini**, sedangkan `CHECK` adalah jaminan tentang **data selamanya**. Jalur baru, script maintenance, seed, atau perbaikan manual di `psql` tidak lewat CAS itu. Komentar migration-nya menyebutnya "defense-in-depth: the spend CAS guards balance >= amount; this backstops it" (`prisma/migrations/20260613050000_add_wallet_referrals/migration.sql:10`).
</details>

**5. Kenapa backfill harus dijalankan sebelum menambahkan unique index atau foreign key, dan apa yang terjadi kalau urutannya dibalik?**

<details><summary>Jawaban</summary>

Constraint diverifikasi terhadap **seluruh baris yang sudah ada** saat ia dibuat. Unique index atas kolom yang semua barisnya masih `NULL` atau bernilai sama akan gagal (atau lolos tapi salah). FK ke tabel yang belum punya baris rujukannya akan gagal untuk setiap baris. Dan karena satu file migration dibungkus satu transaksi, kegagalan itu membatalkan seluruh migration — di produksi berarti deploy gagal. Contohnya `prisma/migrations/20260613050000_add_wallet_referrals/migration.sql:13-18` dan `prisma/migrations/20260801030416_add_drone_fleet_entity/migration.sql:42-91`.
</details>

**6. Apa yang dilakukan `npm run prisma:drift-check`, dan kenapa gerbang itu perlu di repo ini secara khusus?**

<details><summary>Jawaban</summary>

Ia menjalankan `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` dan harus melaporkan "No difference" — artinya database sungguhan dan `schema.prisma` sepakat. Perlu di sini karena banyak DDL ditulis tangan (partisi, partial unique, `CHECK`, rutin plpgsql); tanpa gerbang itu, satu `migrate dev` yang ceroboh bisa menghasilkan migration yang mengembalikan tabel terpartisi jadi tabel biasa. `.github/workflows/ci.yml:63-69`.
</details>

**7. Di dalam `this.prisma.$transaction(async (tx) => { … })`, apa yang terjadi kalau kamu memakai `this.prisma` alih-alih `tx`?**

<details><summary>Jawaban</summary>

Query itu berjalan di koneksi lain, di luar transaksi. Ia commit sendiri dan **tidak ikut rollback** ketika transaksi dibatalkan. Bug ini hening: kodenya terlihat benar, dan unit test dengan Prisma yang di-mock biasanya tetap hijau karena `prisma` dan `tx` adalah objek mock yang sama. Karena itu semua helper di repo ini bernama `…WithinTx` dan menerima `tx` sebagai parameter pertama.
</details>

**8. `create()` gagal dan transaksinya di-rollback. Apa yang TIDAK ikut mundur, dan siapa yang membereskannya?**

<details><summary>Jawaban</summary>

Klaim pesawat di tabel `drones` — ia commit sebelum transaksi dimulai, jadi rollback tidak menyentuhnya; kalau dibiarkan, pesawatnya "sibuk" selamanya karena delivery yang jadi kunci pelepasannya tidak akan pernah ada. Yang membereskannya adalah kode kompensasi eksplisit, `releaseClaimedAircraft(...)`, dipanggil di setiap jalur throw. PaymentIntent Stripe juga di luar transaksi, tapi ke arah sebaliknya (dibuat setelah commit, best-effort). `src/deliveries/deliveries.service.ts:486-490` dan `:504-513`.
</details>

**9. Kamu membaca sebuah baris di `SCALING-1M.md` yang menjelaskan ShardRouter dengan sangat rinci. Apa yang harus kamu cek sebelum mencari kodenya?**

<details><summary>Jawaban</summary>

Penanda statusnya. `SCALING-1M.md:63-91` memisahkan tabel "✅ Built + verified in this PR" dari "📐 Designed here, built later"; banyak hal di dokumen itu ada di tabel kedua. Setelah penanda, cek bagian `### Left undone / follow-ups` pada increment terkait di `AUDIT-LOG.md`, baru cek kodenya. Urutan tiga langkah itu (penanda → left undone → kode) adalah keterampilan paling bernilai dari fase ini.
</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| `findUnique({ where: { id } })` pada `Delivery`/`Notification`/`AdminAuditLog` tidak bisa di-compile, dan tipenya menuntut `id_createdAt` | Tabelnya di-partisi RANGE, jadi PK-nya composite `@@id([id, createdAt])` — `id` sendirian bukan lagi unique | Baca `prisma/schema.prisma:281-289` (Delivery) atau `:894-903` (Notification). Konfirmasi di `psql`: `\d+ deliveries` akan menampilkan `Partition key: RANGE ("createdAt")`. Perbaikannya: `findFirst` / `updateMany` / composite `id_createdAt`. Cerita lengkapnya di Fase 6 |
| `prisma:drift-check` melaporkan perbedaan setelah kamu menyunting `migration.sql` tangan | Kamu menambahkan objek yang **dimodelkan** Prisma (index penuh, kolom, unique biasa) tanpa menuliskannya juga di `schema.prisma` — bukan objek yang tidak terlihat (`CHECK`, partial unique) | Baca output diff-nya; ia menyebutkan objek yang mau dihapus/dibuat. Kalau ia ingin `DROP INDEX` sesuatu yang sengaja kamu buat, pindahkan definisinya ke `schema.prisma` sebagai `@@index`, atau ubah jadi bentuk yang memang tidak dimodelkan Prisma |
| `prisma migrate dev` menawarkan me-**reset** database, atau bilang "drift detected" padahal kamu tidak mengubah apa-apa | Kamu mengedit isi migration yang **sudah ter-apply** (checksum berubah), atau kamu — atau sebuah tutorial — pernah menjalankan `prisma db push` | Cek `SELECT migration_name, checksum FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;`. Di database dev, jalan keluarnya `npm run db:reset`. Aturannya: migration yang sudah ter-apply diperlakukan seperti commit yang sudah di-push |
| Migration gagal di tengah dengan `violates foreign key constraint` atau `could not create unique index … duplicate key` | Urutan salah: constraint dipasang sebelum data dibereskan | Baca nama constraint di pesan error, lalu cari barisnya di file migration-mu. Pindahkan blok backfill ke atasnya. Rujukan pola: `prisma/migrations/20260801030416_add_drone_fleet_entity/migration.sql:42-91` |
| `npm run prisma:seed` yang kedua melempar `P2002` | Ada jalur seed yang memakai `create` tanpa penjaga idempotensi — sering pada tabel sekunder yang gampang terlupa (registry, ledger) | Baca nama constraint di error-nya untuk tahu tabel mana. Bandingkan dengan pola `prisma/seed.ts:136-156`, yang harus menulis **dua** baris karena ia melewati service |
| Transaksi di-rollback tapi datanya tetap berubah | Ada query di dalam callback yang memakai `this.prisma`, bukan `tx` — atau efeknya memang terjadi di luar transaksi | Grep `this.prisma` di dalam blok `$transaction` pada file yang kamu sentuh. Di test, assert **identitas client** yang diterima helper (repo ini punya commit khusus untuk itu: `6345608`). Kalau efeknya memang di luar (klaim pesawat), yang kurang adalah kompensasinya, bukan transaksinya |
| Aplikasi gagal boot dengan error koneksi setelah kamu menambah replica/pod | `jumlah proses × DATABASE_POOL_MAX` melewati `max_connections` PostgreSQL | `SHOW max_connections;` dan `SELECT count(*) FROM pg_stat_activity;` di `psql`. Baca `src/prisma/prisma.service.ts:31-32`. Solusi jangka pendek: turunkan `DATABASE_POOL_MAX`; jangka panjang: PgBouncer (Fase 10) |
| Kamu menghabiskan sejam mencari kode untuk fitur yang dijelaskan rinci di sebuah dokumen, dan kodenya tidak ada | Fitur itu bertanda `📐 Designed here, built later` (atau `🟡` separuh jalan) | Cek penanda status di tabel `SCALING-1M.md:63-91` atau `ARCHITECTURE.md:11-16`, lalu bagian `Left undone` di increment terkait `AUDIT-LOG.md`. Ini bukan kesalahanmu — ini alasan konsep 3.11 ada |
| Semua test hijau tapi kamu tidak yakin perubahanmu benar-benar teruji | Suite ini didominasi unit test dengan Prisma yang di-mock; test bisa hijau untuk alasan yang salah | Terapkan **satu** mutasi manual pada kode yang baru kamu tulis (balik `>=` jadi `>`, hapus satu klausa `where`), jalankan **seluruh file spec**-nya (bukan `jest -t`). Kalau tetap hijau, kamu baru menemukan lubang test. Rujukan: `AUDIT-PLAN.md:62-71` dan `AUDIT-LOG.md:2069-2078` |

**Bagian yang memang paling membingungkan di fase ini**, dan tidak apa-apa kalau kamu tersandung: konsekuensi berantai dari composite primary key. Bukan konsep partisinya yang sulit — "pecah tabel per bulan" gampang dibayangkan. Yang membingungkan adalah satu aturan PostgreSQL merembet ke belasan tempat yang tampak tidak berhubungan: `findUnique` yang hilang, kolom `deliveryCreatedAt` yang muncul di enam tabel anak, `TrackingIdRegistry` yang kelihatan seperti duplikasi tak berguna, `activeDeliveryId` yang "aneh" ditaruh di tabel drone, dan `seed.ts` yang mendadak harus menulis dua baris.

Cara melewatinya: **baca dalam urutan ini** —
1. `prisma/schema.prisma:894-920` (`Notification` — kasus paling sederhana, tanpa tabel anak),
2. `prisma/migrations/20260801053057_add_flight_frames/migration.sql` (dipartisi sejak lahir, tidak ada copy-swap yang mengaburkan idenya),
3. baru `prisma/migrations/20260619140000_partition_deliveries/migration.sql` (fan-out penuh ke enam anak),
4. lalu `prisma/PARTITIONING.md:57-79` sebagai daftar aturannya.

Dan setiap kali kamu bingung "kenapa kode ini begitu?", tanyakan dulu: *apakah tabelnya terpartisi?* Sembilan dari sepuluh keanehan di data layer ini jawabannya itu. Pembahasan tuntasnya ada di Fase 6, bersama maintenance-nya.

---

## Bacaan pendamping

Semua di dalam repo, semua berisi "kenapa":

- **`prisma/schema.prisma`, dibaca berurutan dari baris 1** — cari komentar blok di atas tiap model, bukan daftar kolomnya. Kalau kamu cuma punya waktu membaca satu file di fase ini, ini file-nya.
- **`prisma/migrations/20260801030416_add_drone_fleet_entity/migration.sql:42-91`** — cari kenapa nilai backfill sengaja dibuat "obviously unusable rather than plausibly wrong".
- **`prisma/migrations/20260809133410_add_airspace_zones/migration.sql:35-43`** — cari arti "load-bearing" untuk sebuah data migration, dan bagaimana sistem bisa gagal **membuka** dengan semua test tetap hijau.
- **`prisma/PARTITIONING.md:57-79`** — cari daftar aturan Prisma yang tidak boleh dilanggar; empat bullet, semuanya akan kamu langgar sekali sebelum percaya.
- **`src/prisma/prisma.service.ts:132-149`** — cari cerita bug deploy yang membunuh job yang sedang berjalan, dan kenapa perbaikannya cuma mengganti nama satu lifecycle hook.
- **`src/deliveries/deliveries.service.ts:405-513`** — cari batas transaksi: apa yang co-commit, apa yang tidak, dan siapa yang mengompensasi.
- **`ARCHITECTURE.md:11-16` + `SCALING-1M.md:63-91`** — cari cara sebuah dokumen dibentuk supaya tidak bisa dipakai untuk over-claim.
- **`AUDIT-PLAN.md:62-71` dan `:603-644`** — cari kenapa "1.073 test hijau" pernah berdampingan dengan satu fitur yang tidak bisa dijangkau sama sekali, dan template log yang lahir dari situ.
- **`AUDIT-LOG.md:2236-2289`** — cari bagaimana utang teknis ditulis supaya berguna: spesifik, punya alasan penundaan, dan menyebut di mana keputusannya dikodekan.
- **`.github/workflows/ci.yml:47-79`** — cari urutan gerbangnya: `migrate deploy` → drift-check → build → test, dan alasan drift-check berjalan setelah migrate.

Dokumentasi resmi, hanya tiga dan hanya kalau perlu:

- [Prisma — Migrate: `--create-only` dan menyunting SQL](https://www.prisma.io/docs/orm/prisma-migrate) — untuk alur "generate lalu sunting" yang jadi kebiasaan intimu di fase ini.
- [PostgreSQL — `CREATE INDEX`, termasuk partial index](https://www.postgresql.org/docs/16/sql-createindex.html) — bagian *Index Uniqueness Checks* dan predikat `WHERE`. Repo ini memakai Postgres 16.
- [PostgreSQL — Constraints (`CHECK`, `UNIQUE`, `FOREIGN KEY`)](https://www.postgresql.org/docs/16/ddl-constraints.html) — rujukan pendek untuk semantik `ON DELETE`.

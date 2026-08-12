# Fase 0 — Nyalakan sistemnya

> Baris meta: **Durasi** ~0,6 minggu (~8 jam) · **Mode** bedah (jalankan & baca, belum mengubah apa pun) · **Repo** ketiganya — `Drovery_Backend`, `Drovery_Admin`, `Drovery_Mobile`

> **Konvensi anchor di dokumen ini.** Path tanpa awalan repo = `Drovery_Backend` (tempat file ini hidup).
> Path yang dimulai `Drovery_Admin/` atau `Drovery_Mobile/` = repo tetangga. Semua nomor baris merujuk
> tag git `curriculum-baseline`. Kalau kamu sudah mengubah repo, baca anchor lewat
> `git show curriculum-baseline:<path> | sed -n '<awal>,<akhir>p'`.

---

## Kenapa fase ini ada di sini

Ini fase pertama, jadi tidak ada "fase sebelumnya" yang bisa dijadikan alasan. Yang bisa dijadikan
alasan adalah fase **sesudahnya**. Fase 1 memintamu menulis `@Module` pertama di sandbox `learn-nest/`
buatanmu sendiri; Fase 3 memintamu membedah `prisma/schema.prisma` yang panjangnya 835 baris; Fase 5
memintamu membuktikan bahwa dua proses yang berebut satu baris database hanya menghasilkan satu
pemenang. Ketiganya mengandaikan satu hal yang sama dan jarang dikatakan: **ada sistem hidup yang bisa
kamu tabrak.** Kalau `docker compose up` belum pernah selesai di laptopmu, seluruh sisa kurikulum
berubah jadi membaca kode orang lain — kegiatan yang terasa produktif dan hasilnya tipis.

Ada alasan kedua yang lebih spesifik ke kurikulum ini, dan ini yang jujur: **Fase 1 memakai Docker
sebagai resep, padahal Docker baru diajarkan di Fase 10.** Itu utang yang disengaja. Kamu hanya perlu
mengetik satu perintah, bukan memahaminya. Tapi kalau perintah itu gagal — WSL2 rewel, disk penuh,
daemon tidak jalan, port 3000 sudah dipakai — kamu berhenti di minggu pertama karena masalah
infrastruktur, bukan karena masalah belajar. Karena itu setengah dari fase ini bukan tentang
menjalankan Docker, tapi tentang **menyiapkan jalur cadangan yang sudah terbukti jalan** sebelum kamu
membutuhkannya. Membuktikannya sekarang, saat tidak ada tekanan, jauh lebih murah daripada
membuktikannya nanti sambil frustrasi.

Alasan ketiga: repo ini punya kebiasaan yang tidak biasa — ia **mencatat kesalahannya sendiri**.
`AUDIT-PLAN.md:62-71` membuka dengan kalimat "The test suite will not catch your mistakes" dan
menceritakan bahwa 1.073 test hijau berdampingan dengan satu fitur user-facing yang tidak bisa
dijangkau sama sekali. `SCALING-1M.md:8-13` menandai angka-angkanya sendiri sebagai **ILLUSTRATIVE**.
`AUDIT-LOG.md` punya 17 bagian `### Left undone / follow-ups`. Kalau kamu masuk ke repo ini dengan
refleks "dokumentasi = kebenaran", kamu akan menghabiskan berminggu-minggu mempercayai klaim yang
repo-nya sendiri sudah bantah di file sebelah. Keterampilan membaca skeptis itu harus dipasang
**sekarang**, di fase yang tidak menuntut apa-apa selain membaca, bukan nanti saat kamu sudah sibuk.

Yang mustahil dipahami tanpa fase ini: bentuk sistemnya. Bukan detail — bentuknya. Bahwa ada tujuh
container, bahwa satu delivery bergerak sendiri setelah kamu berhenti menyentuhnya, bahwa proses yang
menggerakkannya **bukan** proses yang melayani HTTP-mu. Setiap konsep di 13 fase berikutnya adalah
jawaban atas pertanyaan "kenapa bentuknya begitu?". Kalau kamu belum pernah melihat bentuknya, kamu
sedang menghafal jawaban tanpa pernah mendengar pertanyaannya.

---

## Gerbang masuk

Kamu siap masuk Fase 0 kalau kamu bisa:

- [ ] Menjalankan `git clone`, `git log --oneline`, dan `git show <tag>:<path>` dari terminal tanpa membuka dokumentasi.
- [ ] Menjelaskan beda `npm install` dan `npm ci` ke rekan, dan menunjukkan file mana yang dibaca masing-masing.
- [ ] Membaca respons JSON dari `curl` dan menyebutkan status code-nya tanpa membuka Postman.
- [ ] Menjalankan satu aplikasi Ionic React di perangkat Android fisik — artinya kamu sudah punya refleks "device dan laptop harus satu jaringan".
- [ ] Menyebutkan berapa RAM bebas di laptopmu dan berapa sisa disk. (Serius: stack ini menyalakan 7 container sekaligus. Di bawah 8 GB RAM, siapkan jalur cadangan di §0.3 sebagai jalur utama, bukan cadangan.)
- [ ] Menerima bahwa 8 jam ke depan tidak menghasilkan satu baris kode pun yang kamu tulis sendiri — dan tetap mengerjakannya.

---

## Peta jalan mingguan

Total 8 jam. Kalau kamu bekerja 12–15 jam/minggu, ini selesai dalam 3–4 hari kerja santai atau satu
akhir pekan penuh. Jangan dipadatkan jadi satu malam: dua dari empat sesi di bawah **butuh waktu
tunggu** (build image, `expo start`, satu delivery menyelesaikan siklusnya).

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---:|---|
| 1 · sesi A | Prasyarat, versi, dan `docker compose up --build` sampai selesai | 2,0 | Output `docker compose ps` yang menampilkan 7 service; file `tebakan-service.md` berisi tebakanmu tentang fungsi masing-masing (ditulis **sebelum** membaca apa pun) |
| 1 · sesi B | Jalur cadangan (Postgres + Redis terkelola) + empat titik verifikasi hidup | 2,0 | `npm run start:dev` jalan tanpa Docker sama sekali; empat respons tersimpan: `/health`, `/health/ready`, `/metrics`, `/docs` |
| 1 · sesi C | Admin console di `:5174` dan Mobile di Expo Go | 2,0 | Screenshot login admin sebagai `admin@drovery.com`; daftar tertulis fitur mobile yang mati senyap beserta baris repo yang membuktikannya |
| 1 · sesi D | Satu delivery end-to-end + membaca repo secara skeptis + buku catatan | 2,0 | Rekaman satu delivery berpindah status sendiri; `docs/catatan/00.md` berisi 10 pertanyaan "aku belum ngerti kenapa…" |

**Kalau sesi A gagal total** (Docker tidak mau jalan sama sekali): lompat ke sesi B, kerjakan jalur
cadangan sebagai jalur utama, lalu kembali ke sesi A kapan pun Docker sudah beres. Fase 1–2 dikerjakan
di sandbox `learn-nest/` dan **tidak butuh Docker** kalau kamu punya satu `DATABASE_URL` yang hidup.
Docker baru benar-benar wajib di Fase 10.

---

## Konsep

### 0.1 Prasyarat & versi: Node ≥22.12, Docker Engine + compose plugin, psql client, git

Kamu sudah kenal masalah ini dari sisi mobile: `capacitor.config.ts` bilang satu hal, Android Gradle
Plugin bilang hal lain, dan yang menang adalah yang dibaca toolchain — bukan yang ditulis di README.
Di sini polanya identik, dan kebetulan repo Drovery memberimu contohnya di menit pertama.

Ada **tiga** sumber yang menyebut versi Node, dan mereka tidak sepakat. `.nvmrc` berisi `22.12.0`.
`package.json` memasang `"engines": { "node": ">=22.12.0" }`. Tapi tabel Prerequisites di
`README.md:89-95` menulis `Node.js >= 20.x`, `PostgreSQL >= 15.x`, dan menandai Docker sebagai
"Optional but recommended". Mana yang benar? Yang dibaca mesin: `.nvmrc` (dibaca `nvm use`) dan
`engines` (dicek npm). Tabel README itu tulisan manusia yang tidak ikut berubah saat repo naik ke
Node 22 — dan `Drovery_Mobile/README.md:60` bahkan sudah tahu itu, karena ia menulis "Node.js 20+ dan
npm 10+ (Expo SDK 54; **the Drovery backend pins 22.12**)".

Jangan lewati ini sebagai remeh. Ini contoh pertama dari pola yang akan kamu temui belasan kali
sepanjang kurikulum, dan §0.9 adalah bab yang mengajarkan cara menanganinya secara sistematis. Untuk
sekarang cukup satu aturan praktis: **kalau dokumen dan file konfigurasi berselisih, percayai file
yang dibaca mesin.**

Empat alat yang benar-benar kamu butuhkan di fase ini:

| Alat | Kenapa | Cek |
|---|---|---|
| Node 22.12+ | `engines` di `package.json:8-10`; Prisma 7 dan NestJS 11 mengandaikannya | `node -v` |
| Docker Engine + plugin `compose` | `docker compose` (dua kata) adalah plugin v2; `docker-compose` (tanda hubung) adalah tool Python lama yang **tidak** mengerti sebagian sintaks di repo ini | `docker compose version` |
| Klien `psql` | Untuk mengintip database; container Postgres di compose **tidak** mem-publish port ke host (lihat §0.2) | `psql --version` |
| git | Anchor kurikulum ini menunjuk tag `curriculum-baseline` | `git -C Drovery_Backend tag -l` |

**Anchor:** `.nvmrc:1` — satu baris, `22.12.0`; bandingkan dengan `package.json:8-10` (`engines`) dan
`README.md:89-95` (tabel yang menyebut `>= 20.x`). Buka ketiganya berdampingan dan lihat sendiri
selisihnya.

**Kenapa dipakai di sini:** repo ini menjalankan proses yang sama di empat tempat berbeda — laptopmu,
container, GitHub Actions, dan (nanti) Kubernetes. `.nvmrc` + `engines` adalah cara termurah membuat
keempatnya sepakat tanpa siapa pun harus mengingat angka. Kalau versi Node bergeser diam-diam, yang
pecah biasanya bukan kode aplikasi melainkan binary engine Prisma — dan kegagalannya muncul **saat
runtime**, bukan saat build, yang membuatnya mahal untuk didiagnosis.

**Alternatif:**
- **Volta** (`"volta": { "node": "22.12.0" }` di `package.json`) alih-alih `.nvmrc` + nvm. Trade-off
  konkret: Volta mengganti versi Node **otomatis** saat kamu `cd` ke folder, jadi tidak mungkin lupa
  `nvm use`; harganya, versinya sekarang hidup di `package.json` dan setiap perubahan versi jadi diff
  di file yang juga berisi dependency — commit-nya lebih berisik dan `nvm` (yang lebih umum di tim
  Indonesia) tidak membacanya.
- **Devcontainer / GitHub Codespaces** — satu `devcontainer.json` mengunci Node, psql, dan Docker-in-Docker
  sekaligus, jadi "works on my machine" hilang total. Harganya: kamu tidak pernah belajar apa yang
  sebenarnya dipasang (yang justru tujuan Fase 10), dan Codespaces gratisan hanya 60 jam/bulan —
  Fase 10–11 sendiri akan menghabiskan lebih dari itu.
- **Tidak mengunci sama sekali, pakai Node apa pun yang ada** — nol setup hari ini; harganya persis
  yang di atas: kegagalan Prisma yang muncul di runtime dengan pesan `binaryTarget` yang tidak
  menyebut kata "versi Node" sama sekali, dan kamu akan mencari di tempat yang salah selama satu jam.

**Latihan:** jalankan keempat perintah cek di tabel dan tempel hasilnya di catatanmu. Lalu jawab
tertulis dalam tiga kalimat: dari tiga sumber versi Node yang berselisih, mana yang akan **membuat
build gagal** kalau tidak dipatuhi, dan mana yang hanya salah tulis? Verifikasi jawabanmu: pasang
Node 20 lewat `nvm install 20 && nvm use 20`, jalankan `npm ci` di `Drovery_Backend`, dan baca
apakah npm menolak atau hanya memperingatkan. Kembalikan ke 22 setelah selesai.

---

### 0.2 Jalur cepat: `docker compose up --build` dan membaca arti tiap service SEBELUM mengerti isinya

Padanan yang jujur dari duniamu: `docker-compose.yml` di sini kira-kira seperti `capacitor.config.ts`
plus daftar plugin native — ia mendeklarasikan **komponen apa saja yang harus hidup** dan bagaimana
mereka saling menemukan, bukan logika aplikasi. Padanan yang **tidak** jujur: ini bukan `npm run dev`
yang lebih besar. `npm run dev` menyalakan satu proses. Perintah ini menyalakan tujuh, dan dua di
antaranya adalah **aplikasi yang sama dengan peran berbeda**.

Perintahnya satu baris:

```bash
cd Drovery_Backend
docker compose up --build
```

Build pertama makan waktu (beberapa menit; ia menjalankan `npm ci` di dalam image). Setelah selesai,
di terminal lain:

```bash
docker compose ps
```

Kamu akan melihat tujuh baris. **Sebelum membaca penjelasan apa pun**, tulis tebakanmu tentang fungsi
masing-masing ke file `tebakan-service.md`. Ini bukan formalitas — Fase 10 akan memintamu membandingkan
tebakan itu dengan pemahamanmu delapan bulan kemudian, dan perbandingan itu hanya bernilai kalau
tebakannya ditulis saat kamu benar-benar belum tahu.

Beberapa fakta mekanik yang layak kamu lihat langsung, karena semuanya akan jadi konsep utuh nanti:

- **Header file ini menggambar topologinya sendiri.** `docker-compose.yml:1-14` berisi diagram ASCII
  arus data plus catatan bahwa api dan worker sengaja boot di `NODE_ENV=production` "to exercise the
  real prod path". Itu keputusan, bukan kelalaian — dan konsekuensinya ada di §0.3.
- **`migrate` adalah job sekali jalan, bukan service.** `docker-compose.yml:84-92`: ia menjalankan
  `npx prisma migrate deploy && npx prisma db seed` lalu **exit 0**, dengan `restart: 'no'`. Di
  `docker compose ps` ia akan tampil `Exited (0)` — itu **sukses**, bukan crash. Api dan worker baru
  boleh start setelahnya (`docker-compose.yml:117-118`, `condition: service_completed_successfully`).
- **`api` dan `worker` adalah image yang sama.** Lihat `docker-compose.yml:99` (`PROCESS_ROLE: api`,
  dengan komentar "enqueue-only — does NOT process jobs") lalu `docker-compose.yml:124` dan `:127`
  (`command: ['node','dist/src/worker']`, `PROCESS_ROLE: worker`). Ini ide besar yang akan jadi Fase 6.
- **Hanya `api` yang mem-publish port ke host.** `docker-compose.yml:119-120` (`'3000:3000'`) adalah
  satu-satunya blok `ports:` di seluruh file. Postgres, PgBouncer, Redis, dan Mosquitto **tidak bisa
  dijangkau dari laptopmu** — `psql -h localhost -p 5432` akan gagal, dan `npm run prisma:studio` dari
  host juga gagal. Jalan masuknya lewat container: `docker compose exec postgres psql -U postgres -d drovery`.
  Ini jebakan nomor satu di fase ini dan tidak ditulis di README mana pun.

**Anchor:** `docker-compose.yml:1-14` — diagram topologi + cara pakai di komentar header. Lalu telusuri
daftar service-nya: `postgres` (`:17`), `pgbouncer` (`:34`), `redis` (`:55`), `mosquitto` (`:69`),
`migrate` (`:84`), `api` (`:94`), `worker` (`:122`), dan blok `volumes:` di `:143-146`. Bandingkan
dengan `README.md:524-546` yang menjelaskan hal yang sama dalam prosa.

**Kenapa dipakai di sini:** `docker-compose.yml:1-6` menyatakan tujuannya sebagai "Full local stack
mirroring the production topology" — bukan sekadar "cara cepat menyalakan Postgres". Itu bedanya besar:
setiap komponen di sini ada karena satu masalah produksi tertentu, dan Fase 10 akan membedah tiap
alasannya satu per satu. Yang paling tidak intuitif dan paling penting sudah tertulis di
`docker-compose.yml:31-33`: PgBouncer "multiplexes many app clients onto a small Postgres server-side
pool — this is what lets the API/worker tiers autoscale without exhausting Postgres `max_connections`".
Kamu belum perlu paham kalimat itu. Kamu perlu **melihatnya sekarang** supaya delapan bulan lagi ia
terasa seperti jawaban atas pertanyaan yang sudah kamu punya.

Satu lagi contoh baca-skeptis, gratis: `README.md:531` mendaftar isi stack sebagai
"postgres + pgbouncer + redis + migrate + api + worker" — **enam** service. Compose punya **tujuh**;
`mosquitto` (`docker-compose.yml:69`) tidak disebut. Bukan bug, cuma README yang tertinggal satu
increment. Tapi kalau kamu memakai README sebagai daftar periksa, kamu akan bingung melihat container
yang tidak kamu harapkan.

**Alternatif:**
- **Pasang Postgres + Redis langsung di host** (`apt install postgresql redis`). Trade-off konkret:
  boot ~2 detik alih-alih ~40 detik dan RAM jauh lebih ringan; harganya, versinya tidak tercatat di
  repo (laptopmu Postgres 14, CI Postgres 16), dan kamu **tidak mendapat PgBouncer maupun Mosquitto**
  — dua komponen yang jadi materi Fase 10. Untuk Fase 1–3 ini pilihan yang sangat masuk akal.
- **Satu container Postgres saja** (`docker run ... postgres:15`, persis resep `README.md:163-172`).
  Trade-off: paling ringan dari semua opsi Docker dan cukup untuk Fase 1–3; harganya, Redis tetap
  harus kamu urus sendiri (`ARCHITECTURE.md:58`: "⚠️ Redis is now required to run the backend"), dan
  kamu tidak pernah melihat topologi tujuh-service yang jadi konteks setengah kurikulum ini.
- **Podman + `podman compose`** — daemonless dan rootless, jadi tidak perlu menaruh user-mu di grup
  `docker` (yang secara praktis setara root). Harganya: `deploy.resources.limits` yang dipakai
  `docker-compose.nodes.yml` di Fase 11 berperilaku berbeda, dan sebagian besar jawaban Stack Overflow
  yang akan kamu cari saat macet mengandaikan Docker Desktop.

**Latihan:** jalankan `docker compose up --build` sampai `api` menampilkan baris
`Drovery API running on http://localhost:3000/api/v1`. Lalu, di terminal lain, buktikan tiga klaim di
atas: (a) `docker compose ps` menunjukkan `migrate` sebagai `Exited (0)`; (b)
`docker compose exec api printenv PROCESS_ROLE` mencetak `api` sementara
`docker compose exec worker printenv PROCESS_ROLE` mencetak `worker`; (c) `psql -h localhost -p 5432 -U postgres`
dari host **gagal**, tapi `docker compose exec postgres psql -U postgres -d drovery -c '\dt'`
menampilkan daftar tabel. Tempel ketiga output itu di catatanmu.

---

### 0.3 JALUR CADANGAN wajib: satu `DATABASE_URL` terkelola + `npm run start:dev`

Tidak ada padanan jujur dari dunia mobile untuk bab ini, jadi saya sebut apa adanya: ini bukan konsep
teknis, ini **manajemen risiko**. Kurikulum ini bertaruh bahwa Docker jalan di laptopmu selama 26
minggu. Taruhan itu bisa kalah — WSL2 kehabisan memori, Docker Desktop minta lisensi, disk penuh di
tengah `npm ci`. Kalau taruhannya kalah di minggu ke-2, kamu berhenti. Karena itu jalur cadangannya
dibuktikan **hari ini**, bukan saat dibutuhkan.

Bentuknya: backend jalan langsung di host lewat `npm run start:dev` (`package.json:15`), dan dua
dependensi eksternalnya menunjuk ke layanan terkelola gratis di internet.

Yang sering salah dipahami: kamu butuh **dua**, bukan satu.

1. **Postgres terkelola** — Neon, Supabase, atau apa pun yang memberimu satu connection string.
   Masuk ke `DATABASE_URL` (bandingkan bentuknya di `.env.example:7`).
2. **Redis terkelola** — Upstash atau setara. `.env.example:26` menandai bagiannya dengan tegas:
   `# ==================== REDIS (required — queue + cache + rate limiting) ====================`,
   dan `ARCHITECTURE.md:58` mengulanginya sebagai peringatan: *"⚠️ **Redis is now required** to run
   the backend (the queue connects on boot)."* Backend **tidak akan boot** tanpa Redis. Ini bukan
   opsional dan bukan degradasi anggun — ia konsekuensi keputusan arsitektur di
   `ARCHITECTURE.md:38-58` yang akan kamu bedah utuh di Fase 6.

Urutan yang bekerja:

```bash
cd Drovery_Backend
cp .env.example .env
# edit .env: DATABASE_URL → Neon/Supabase, REDIS_HOST/REDIS_PORT → Upstash (+ REDIS_TLS=true)
npm ci
npm run prisma:generate
npm run prisma:migrate      # prisma migrate dev
npm run prisma:seed         # ts-node prisma/seed.ts
npm run start:dev
```

Dua hal yang akan menggigitmu di sini, dan keduanya adalah keputusan sadar repo:

- **Boot gagal-cepat kalau env kurang.** `src/config/validation.ts:21-30` memvalidasi `PORT`,
  `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` dengan `class-validator` dan **melempar** kalau
  ada yang kosong. Aplikasi tidak boot separuh jalan lalu gagal saat request pertama; ia menolak
  berdiri. Kamu akan menulis mekanisme ini sendiri di Fase 2.
- **`.env.example` sengaja tidak lolos guard produksi.** `.env.example:21` berisi
  `JWT_SECRET=change-me-to-a-random-secret`. Di `NODE_ENV=development` itu diterima; tapi
  `src/config/validation.ts:32-42` menolak boot kalau `NODE_ENV=production` dan secret-nya kurang dari
  24 karakter atau mengandung kata `change`/`example`/`placeholder`. Karena `docker-compose.yml:97`
  memasang `NODE_ENV: production`, compose harus membawa secret sendiri — dan memang begitu
  (`docker-compose.yml:108-109`), dengan peringatan di `docker-compose.yml:12-14` bahwa nilai itu
  "strong-enough-to-boot **LOCAL** values — never use them anywhere real". Jalur cadanganmu jalan di
  `development`, jadi kamu tidak akan bertemu guard ini. Ketahui saja bahwa ia ada.

Yang **hilang** di jalur cadangan, dan harus kamu terima sadar: tidak ada PgBouncer (Fase 10), tidak
ada Mosquitto/MQTT (Fase 8), dan `api` + `worker` jalan sebagai **satu proses** karena `PROCESS_ROLE`
tidak diset — `src/common/process-role.ts:10` menyebut mode itu "unset → dev: everything runs in one
process". Untuk Fase 1–5 itu tidak masalah. Mulai Fase 6 kamu perlu dua proses, dan itu masih bisa:
`npm run start:dev` di satu terminal, `npm run worker` (`package.json:18`) di terminal lain.

**Anchor:** `.env.example:26-32` — blok Redis yang menandai dirinya "required", termasuk baris
komentar untuk managed Redis (`REDIS_PASSWORD`, `REDIS_TLS=true`) yang justru kamu butuhkan di jalur
ini. Pasangannya: `src/config/validation.ts:21-30` (fail-fast) dan `ARCHITECTURE.md:58` (kenapa Redis
wajib).

**Kenapa dipakai di sini:** karena kurikulum ini sudah mencatat risikonya sendiri. Docker dipakai di
Fase 1 sebagai resep, tiga fase sebelum ia diajarkan; itu utang yang diakui, dan jalur cadangan adalah
pembayarannya. Ada alasan kedua yang lebih halus: menjalankan backend **tanpa** Docker sekali saja
membuatmu melihat batas yang sebenarnya. Ketika Fase 10 menjelaskan apa yang Docker berikan, kamu
punya pembanding nyata — kamu pernah merasakan versi tanpanya.

**Alternatif:**
- **Postgres lokal via `apt install postgresql`.** Trade-off: latency ~0,2 ms alih-alih ~40 ms ke Neon
  (dan Fase 5 akan menjalankan test konkurensi yang terasa lambat lewat internet); harganya, tidak
  bisa diakses dari perangkat lain, dan kamu tetap harus mengurus versi + user + permission sendiri.
- **Satu container Postgres + satu container Redis** (`docker run`), tanpa compose. Trade-off: masih
  butuh Docker — jadi bukan jalur cadangan sejati untuk kasus "Docker rusak"; tapi ini titik tengah
  yang bagus kalau yang bermasalah cuma *compose stack-nya* yang berat, bukan daemon-nya.
- **SQLite.** Terdengar menggoda, dan jawabannya tegas: **tidak bisa.** Repo ini memakai enum PostgreSQL,
  `RANGE` partitioning, partial-unique index, dan `plpgsql` — Prisma tidak akan mengompilasi
  schema-nya ke SQLite. Saya sebut alternatif ini justru untuk menutupnya, karena ia refleks pertama
  banyak orang.

**Latihan:** matikan Docker sepenuhnya (`sudo systemctl stop docker` atau tutup Docker Desktop), lalu
jalankan seluruh urutan di atas sampai `npm run start:dev` mencetak
`Drovery API running on http://localhost:3000/api/v1`. Verifikasi bahwa ia benar-benar tanpa Docker:
`docker ps` harus gagal atau kosong. Lalu buktikan Redis memang wajib — hapus `REDIS_HOST` dari `.env`,
restart, dan catat apa yang terjadi (boot gagal? boot tapi `/health/ready` merah?). Tulis persisnya,
karena §0.4 akan memakai hasil ini.

---

### 0.4 Verifikasi hidup: `/health`, `/health/ready`, `/metrics`, dan Swagger

Dari sisi frontend kamu terbiasa dengan satu pertanyaan: "server-nya nyala nggak?" Backend membedakan
itu jadi **dua pertanyaan yang jawabannya bisa berbeda**, dan bedanya menentukan apakah orchestrator
me-*restart* prosesmu atau cuma mengeluarkannya sementara dari load balancer.

- `GET /api/v1/health` — **liveness**. "Proses ini hidup dan melayani." Implementasinya
  `src/health/health.controller.ts:17-26`: mengembalikan `status`, `uptime`, `timestamp`. Tidak
  menyentuh database sama sekali. Sengaja.
- `GET /api/v1/health/ready` — **readiness**. "Dependensi kritis terjangkau." `:28-39` memanggil
  `HealthService.check()` dan **melempar 503** kalau salah satu gagal. `src/health/health.service.ts:19-25`
  menunjukkan apa yang dicek: database (`SELECT 1`) dan Redis (`cache.ping()`), paralel.
- `GET /api/v1/metrics` — permukaan Prometheus.
- Swagger — **`http://localhost:3000/api/v1/docs`**, bukan `/docs`.

Titik keempat itu perlu ditegaskan karena mudah salah: `src/main.ts:38-40` memasang global prefix
`api/v1`, dan `src/common/swagger.ts:185` menghitung path docs sebagai `` `${prefix}/docs` ``. Jadi
docs ikut prefix. `ROADMAP.md:7` menyebutkan alamat lengkapnya (`/api/v1/docs` + `/api/v1/docs-json`).
Kalau kamu buka `localhost:3000/docs` kamu akan dapat 404 dan menyimpulkan Swagger mati.

Sekarang bagian yang paling mengajar. Jalankan keempatnya dan **perhatikan bentuk responsnya**:

```bash
curl -s localhost:3000/api/v1/health | head -c 200 ; echo
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/v1/health/ready
curl -s localhost:3000/api/v1/metrics | head -5
```

`/health` datang terbungkus `{"success":true,"data":{...},"timestamp":"..."}`. `/metrics` datang
sebagai teks polos `# HELP ...`. Kenapa berbeda? Jawabannya ditulis di komentar
`src/metrics/metrics.controller.ts:9-19`: controller itu memakai `@Res()` **tanpa** `passthrough`,
yang "commits the response directly, bypassing ALL response-phase interceptors (incl. the global
`TransformInterceptor`'s `{success,data}` envelope, **which Prometheus could not parse**)". Satu
keputusan kecil, alasannya eksplisit, dan konsekuensinya kelihatan di terminalmu dalam dua detik.
Envelope itu sendiri adalah kontrak lintas-repo yang jadi materi Fase 2.

**Anchor:** `src/health/health.controller.ts:17-26` (liveness) dan `:28-39` (readiness yang melempar
`ServiceUnavailableException`). Komentarnya di `:9-10` menyebut alasan keduanya `@PublicApi()` +
`@SkipThrottle()`: *"so orchestrator probes (k8s/load balancers) aren't blocked by auth or rate
limits."* Lalu `src/metrics/metrics.controller.ts:9-19` untuk alasan `/metrics` tidak terbungkus.

**Kenapa dipakai di sini:** karena pemisahan liveness/readiness bukan gaya-gayaan — ia mencegah satu
kelas outage yang spesifik. Kalau `/health/ready` dipasang sebagai probe *liveness*, maka satu blip
database akan membuat orchestrator me-*restart* **seluruh armada** — padahal database yang bermasalah,
bukan aplikasinya, dan restart tidak memperbaiki apa pun sementara semua koneksi hilang. Karena
readiness terpisah, pod yang dependensinya sakit hanya dikeluarkan dari rotasi Service dan masuk lagi
sendiri saat sembuh. Kamu akan memasang tiga probe ke dua endpoint ini di Fase 11; sekarang cukup
melihat bahwa yang satu mengecek DB dan yang satu tidak.

**Alternatif:**
- **Satu endpoint `/health` yang mengecek semuanya.** Trade-off: lebih sedikit kode dan tidak ada yang
  bisa salah pasang; harganya persis skenario di atas — orchestrator tidak punya cara membedakan
  "restart aku" dari "jangan kirim trafik dulu", dan blip DB 30 detik berubah jadi rolling restart
  armada.
- **`@nestjs/terminus`** — modul health resmi Nest dengan indicator siap pakai untuk Prisma, Redis,
  disk, memory. Repo ini **tidak** memakainya (cek `package.json`: tidak ada `terminus`) dan menulis
  ~35 baris sendiri. Trade-off: terminus memberimu indicator gratis + format respons baku; harganya,
  format itu (`{status, info, error, details}`) bukan bentuk yang dipakai `HealthChecks` di sini, satu
  dependency lagi di jalur boot, dan untuk dua pengecekan sepanjang lima baris, biayanya lebih besar
  daripada manfaatnya.
- **LB cukup cek port TCP terbuka.** Trade-off: nol kode di aplikasi dan bekerja untuk bahasa apa pun;
  harganya, "port terbuka" ≠ "bisa melayani" — proses Node yang event loop-nya macet tetap menerima
  koneksi TCP, jadi LB akan terus mengirim trafik ke pod yang sudah mati secara fungsional.

**Latihan:** simpan keempat respons ke file. Lalu buat readiness gagal secara terkendali: kalau kamu
di compose, `docker compose stop postgres`; kalau di jalur cadangan, ubah `DATABASE_URL` ke port yang
salah dan restart. Sekarang panggil **kedua** endpoint dan catat status code-nya. Yang benar:
`/api/v1/health` tetap **200**, `/api/v1/health/ready` jadi **503**. Kalau keduanya berubah, kamu salah
membaca endpoint mana yang mana. Nyalakan lagi dan pastikan `/health/ready` kembali 200 sendiri tanpa
restart aplikasi — itu inti readiness.

---

### 0.5 Menjalankan Drovery_Admin di `:5174` dan login dengan akun seed

Ini bagian yang paling akrab: Vite + React 19 + TypeScript. Kalau kamu pernah menjalankan `npm run dev`
di proyek Vite, kamu sudah bisa mengerjakan bab ini. Yang perlu diperhatikan hanya **tiga sambungan**
antara admin dan backend, karena tiga-tiganya adalah tempat orang tersangkut di jam pertama.

```bash
cd Drovery_Admin
cp .env.example .env
npm ci
npm run dev        # http://localhost:5174
```

Port `5174` bukan default Vite (5173). Ia diset eksplisit di `Drovery_Admin/vite.config.ts:7-9`
dengan komentar `// distinct from the mobile/other dev servers` — karena tiga repo ini memang
dirancang untuk hidup bersamaan di satu laptop.

Tiga sambungan itu:

1. **Base URL.** `Drovery_Admin/.env.example:3` menetapkan
   `VITE_API_BASE_URL=http://localhost:3000/api/v1` — perhatikan bahwa prefix `/api/v1` **ikut di
   dalam** base URL, sama seperti di mobile. Salah di sini menghasilkan 404 di setiap request.
2. **CORS.** `Drovery_Admin/README.md:17-18` menjelaskan kenapa ini jalan tanpa konfigurasi:
   backend memakai `origin: '*'` ketika `CORS_ORIGINS` tidak diset (`src/main.ts:42-53`). Untuk kamu
   yang datang dari Capacitor: aplikasi native tidak punya CORS sama sekali, jadi ini adalah
   pertama kalinya CORS benar-benar relevan di proyek ini. Fase 10 akan menunjukkan cara repo ini
   akhirnya **menghilangkan** CORS di produksi — bukan dengan mematikannya, tapi dengan menyajikan
   admin dan API dari satu origin lewat Caddy.
3. **Akun.** Seed membuat dua user. `prisma/seed.ts:13-19` membuat `demo@drovery.com` / `demo123`
   (role default `USER`), dan `prisma/seed.ts:33-45` membuat `admin@drovery.com` / `admin123` dengan
   `role: 'ADMIN'` (`:36` di jalur update, `:41` di jalur create) — komentar `:32` menyebut
   *"role set out-of-band, never via signup"*, yang artinya
   tidak ada endpoint publik yang bisa menaikkan role seseorang. Login admin console dengan akun
   **demo** akan ditolak; `Drovery_Admin/README.md:26-27` menulisnya: *"A `USER` account is rejected
   (staff only); an `AGENT` sees only the Support inbox."*

**Anchor:** `Drovery_Admin/vite.config.ts:7-9` (port + alasannya), `Drovery_Admin/.env.example:3`
(base URL berikut prefix), dan `prisma/seed.ts:33-45` (akun admin + role). Untuk melihat apa yang
sebenarnya dilakukan klien terhadap respons backend, buka `Drovery_Admin/src/api/client.ts:127` —
satu baris, `return (json as ApiEnvelope<T>).data;`. Itu sisi klien dari envelope yang kamu lihat di
§0.4.

**Kenapa dipakai di sini:** admin console adalah **jendela paling cepat** ke dalam sistem. Mobile
menunjukkan satu delivery dari sudut pandang satu pelanggan; admin menunjukkan seluruh armada, dan ia
punya halaman untuk hampir setiap konsep yang akan kamu pelajari. Lihat `Drovery_Admin/src/layout/navItems.tsx:29-56`:
`NAV_ITEMS` mendaftar Dashboard, Deliveries, Promos, Users, Fleet, Support — masing-masing dengan
daftar `roles`. Komentar di atasnya (`:25-28`) menjelaskan kenapa nav dan guard dibaca dari **satu**
list: *"a new page cannot appear in the nav without a guard, or be guarded differently from how it is
advertised."* Itu pola yang layak kamu ingat, dan jadi materi Fase 12.

Sambil di sini, latih mata skeptismu lagi. `Drovery_Admin/README.md:56` mendaftar isi `pages/` sebagai
"Login, Dashboard, ComingSoon, NotFound", dan bagian Roadmap `:63-69` hanya mencentang "Foundation" —
seolah Deliveries, Promos, Users, dan Support belum ada. Lalu jalankan `ls Drovery_Admin/src/pages`:
ada `Dashboard`, `Deliveries`, `Fleet`, `Login`, `NotFound`, `Promos`, `Support`, `Users`. README-nya
tertinggal beberapa increment. Kode menang.

**Alternatif:**
- **Jalankan admin dari image produksinya** (`Drovery_Admin/Dockerfile` + `nginx.conf`) alih-alih
  `npm run dev`. Trade-off: kamu melihat bundle yang sebenarnya dikirim ke operator, termasuk hasil
  `manualChunks` di `Drovery_Admin/vite.config.ts:17-38`; harganya, tidak ada HMR — setiap perubahan butuh rebuild
  image, jadi tidak cocok untuk belajar. Fase 10 memakai jalur ini.
- **Lewati admin sepenuhnya, pakai Swagger UI di `/api/v1/docs`.** Trade-off: kamu bisa memanggil 96
  endpoint termasuk yang belum punya UI, dan tombol **Authorize** menyimpan tokenmu; harganya, kamu
  tidak melihat *alur kerja operator* — urutan halaman yang menjelaskan kenapa endpoint-endpoint itu
  ada. Untuk Fase 0 pakai keduanya; admin untuk melihat, Swagger untuk menusuk.

**Latihan:** login ke `http://localhost:5174` sebagai `admin@drovery.com` / `admin123` dan buka
halaman **Deliveries**. Kamu harus melihat 6 delivery hasil seed. Lalu buktikan gerbang role-nya nyata:
logout, login lagi sebagai `demo@drovery.com` / `demo123`, dan catat persis apa yang terjadi (ditolak
di mana — di form login, atau setelah token didapat?). Verifikasi jawabanmu dengan membuka tab Network
di DevTools dan melihat request mana yang terakhir berhasil.

---

### 0.6 Menjalankan Drovery_Mobile di Expo Go — dan mencatat SEKARANG fitur mana yang mati senyap

Di sinilah refleks Ionic-mu paling berbahaya, jadi saya mulai dengan padanan yang jujur dan padanan
yang bohong sekaligus.

**Jujur:** `npx expo start` ≈ `ionic serve` + `npx cap run android` digabung. Expo Go ≈ menjalankan
aplikasimu di dalam shell yang sudah terpasang di HP, seperti Ionic DevApp dulu. `EXPO_PUBLIC_*`
≈ variabel yang di-*inline* saat bundling — sama persis dengan `process.env.X` di Vite: dibaca saat
build, bukan saat runtime, jadi mengubahnya menuntut restart dev server.

**Bohong:** "Expo Go = emulator, jadi semua fitur jalan." Tidak. Expo Go adalah aplikasi yang **sudah
dikompilasi lebih dulu** dengan sekumpulan modul native tetap. Kalau aplikasimu butuh modul native yang
tidak ada di dalamnya, modul itu tidak bisa muncul begitu saja — kamu butuh *dev build*. Ini padanan
paling dekat dengan "plugin Capacitor yang butuh `npx cap sync` dan build ulang APK", tapi dengan
perbedaan penting: di Capacitor kamu memang membangun APK-mu sendiri setiap kali, jadi masalah ini
tidak pernah muncul. Di Expo Go, kamu memakai APK **orang lain**.

Konsekuensinya sudah didaftar repo-nya sendiri di `Drovery_Mobile/README.md:158-163` (bagian
**Caveats**), dan inilah dua fitur yang akan mati senyap di layarmu:

- **Stripe PaymentSheet** — `Drovery_Mobile/README.md:161`: *"needs a dev build (`eas build …`), not Expo Go. The
  manual card form works in Expo Go when `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is empty."* Jadi biarkan
  key itu kosong, dan kamu akan mendapat form kartu manual, bukan sheet native.
- **Google Maps** — `Drovery_Mobile/README.md:160`: kuncinya masih placeholder. Buktinya di
  `Drovery_Mobile/app.json:25-26`: `"googleMaps": { "apiKey": "YOUR_GOOGLE_MAPS_API_KEY" }`. Peta akan
  kosong/abu-abu, bukan error. **Diam-diam**, dan itu kata kuncinya.

Tulis kedua hal ini di catatanmu **sekarang**, sebelum kamu melihat layar kosong dan menghabiskan dua
jam mengira kamu salah setup. Itu seluruh tujuan bab ini.

Setup-nya:

```bash
cd Drovery_Mobile
cp .env.example .env
npm ci
npx expo start        # scan QR dengan Expo Go
```

Sekarang bagian yang menentukan apakah aplikasi bicara ke backend-mu atau tidak. `INTEGRATION.md:22-34`
menyebutnya *"the #1 setup gotcha"* dan memberi tabelnya:

| App jalan di | `EXPO_PUBLIC_API_URL` |
|---|---|
| Perangkat fisik (Expo Go) | `http://<LAN-IP-laptopmu>:3000/api/v1` |
| Emulator Android | `http://10.0.2.2:3000/api/v1` |
| Simulator iOS / web | `http://localhost:3000/api/v1` |

`10.0.2.2` adalah alias loopback host di emulator Android — sama seperti yang kamu pakai di Ionic
untuk menembak dev server dari emulator. Kalau kamu pakai HP fisik, HP dan laptop harus satu Wi-Fi,
dan `localhost` di HP menunjuk ke HP itu sendiri.

Kalau `EXPO_PUBLIC_API_URL` tidak diset sama sekali, `Drovery_Mobile/config/env.ts:18-21` memasang
fallback `http://192.168.1.7:3000/api/v1` — **IP LAN milik mesin developer aslinya**, di-hardcode.
Di jaringanmu, IP itu hampir pasti bukan siapa-siapa, dan aplikasimu akan timeout tanpa pesan yang
menyebut IP tersebut.

**Anchor:** `Drovery_Mobile/README.md:158-163` — daftar Caveats, sumber utama bab ini. Pasangannya:
`Drovery_Mobile/app.json:25-26` (bukti key Maps masih placeholder), `Drovery_Mobile/config/env.ts:18-21`
(fallback LAN IP), dan `INTEGRATION.md:22-34` (tabel URL per target + peringatan bahwa Expo hanya
meng-*inline* variabel berawalan `EXPO_PUBLIC_`).

**Kenapa dipakai di sini:** ada satu jebakan lagi yang lebih halus dari dua di atas, dan ia contoh
sempurna dari keterampilan yang akan kamu bangun di §0.9. `Drovery_Mobile/.env.example:5` menyetel
`EXPO_PUBLIC_AUTH_MODE=mock`. `Drovery_Mobile/README.md:101` mendaftarkannya sebagai variabel konfigurasi dengan
default `mock`, dijelaskan sebagai "offline demo, hardcoded creds". `Drovery_Mobile/config/env.ts:25` benar-benar
membacanya (walau default-nya `'api'`, bukan `'mock'` — dokumennya sudah salah di titik ini).
`Drovery_Mobile/features/auth/services/authService.ts:172-184` benar-benar bercabang atasnya. Semuanya tampak hidup.

Lalu jalankan ini:

```bash
grep -rn "authService" --include=*.ts --include=*.tsx . | grep -v node_modules
```

Satu hasil: baris `export` di file itu sendiri. **Nol call site.** `Drovery_Mobile/contexts/AuthContext.tsx:70`
memanggil `api.post('/auth/login', …)` langsung ke backend, tidak lewat `authService` sama sekali. Jadi
`EXPO_PUBLIC_AUTH_MODE` tidak melakukan apa pun — mode "mock" tidak ada.

Dan repo ini **sudah tahu**: `INTEGRATION.md:198` mendaftarkannya di bawah "Still open" sebagai
*"Dead mobile code (`features/auth/services/authService.ts`, `authApi.ts`)."* Jadi satu dokumen sudah
membantahnya sementara tiga tempat lain masih mengiklankannya. Inilah bentuk asli dari masalah yang
`AUDIT-PLAN.md:62-71` rumuskan: kode yang punya test hijau, punya dokumentasi, dan nol pemakai.
Kamu baru saja mengulangi penyelidikan yang sama dengan satu perintah `grep`.

**Alternatif:**
- **Dev build lewat EAS** (`eas build --profile development`) alih-alih Expo Go. Trade-off: Stripe
  PaymentSheet dan Google Maps hidup, jadi kamu melihat aplikasi yang sebenarnya; harganya, satu build
  cloud makan 10–25 menit, butuh akun Expo, dan setiap penambahan modul native menuntut build ulang.
  Untuk Fase 0 tidak sepadan — untuk Fase 4 (React Native & Expo) baru sepadan.
- **Emulator Android alih-alih HP fisik.** Trade-off: `10.0.2.2` selalu benar sehingga masalah LAN IP
  hilang total, dan kamu bisa merekam layar dengan mudah untuk capstone; harganya, emulator makan
  ~2 GB RAM di atas 7 container, dan performa peta/animasi menyesatkan.
- **Lewati mobile, buat delivery lewat Swagger.** Trade-off: paling cepat dan cukup untuk melihat
  worker bekerja; harganya, kamu tidak melihat *kontrak antar-repo* yang jadi seluruh isi
  `INTEGRATION.md` — dan menurut peta bug repo ini, hampir setiap bug nyata hidup di seam antar-repo,
  bukan di dalam satu repo.

**Latihan:** jalankan aplikasi di Expo Go, set `EXPO_PUBLIC_API_URL` ke LAN IP laptopmu, dan login
dengan `demo@drovery.com` / `demo123`. Verifikasi bahwa login itu **benar-benar** menembak backend-mu,
bukan mock: sambil login, pantau `docker compose logs -f api` (atau terminal `start:dev`) dan cari
baris `POST /api/v1/auth/login`. Kalau tidak ada barisnya, aplikasimu tidak menunjuk ke backend-mu —
periksa IP-nya. Lalu jalankan `grep` di atas sendiri dan tempel hasilnya di catatan, di bawah judul
"kode mati pertama yang kutemukan sendiri".

---

### 0.7 Satu delivery: dari mobile → admin console → digerakkan worker

Ini puncak fase. Semua yang di atas hanya persiapan untuk satu pengamatan tunggal: **kamu berhenti
menyentuh sistem, dan sistemnya terus bergerak.**

Alurnya:

1. Di mobile, buat satu delivery lewat layar Confirmation. `INTEGRATION.md:90` memetakannya:
   layar itu memanggil `POST /deliveries`, dan menyebutnya *"the real 'create delivery'"*. Isi
   pickup/dropoff dengan alamat di Jakarta atau Bandung — `INTEGRATION.md:146` menyebut area layanan
   mencakup Jabodetabek + Bandung, dan permintaan di luar itu ditolak `422 OUT_OF_AREA`.
2. Buka admin console → **Deliveries**. Delivery barumu muncul di sana.
3. Sekarang **tutup aplikasi mobile** dan tonton kolom status di admin. Refresh tiap ~15 detik.

Yang akan kamu lihat, dan waktunya bisa kamu prediksi sebelum melihatnya, karena tertulis di
`src/deliveries/simulation/simulation.constants.ts:56-65`:

| Detik ke- | Status |
|---:|---|
| 10 | `CONFIRMED` |
| 25 | `DRONE_ASSIGNED` |
| 45 | `PICKUP_IN_PROGRESS` |
| 70 | `IN_TRANSIT` |
| 120 | `AWAITING_HANDOFF` |

Dan di situ ia **berhenti**. Bukan bug. Komentar di `:61-63` menjelaskannya: *"Terminal AUTO stage:
the drone arrives and waits. The final transition to `DELIVERED` (+ proof) happens only when the
recipient confirms the handoff OTP via `POST /deliveries/:id/confirm-handoff` — the sim never
auto-delivers."* `AUDIT-PLAN.md:44-45` menyebut `AWAITING_HANDOFF` sebagai *"the defining moment of
the product: an aircraft is hovering, burning battery, waiting for a human to come outside."* Kalau
kamu ingin melihatnya sampai `DELIVERED`, konfirmasi handoff dari mobile dengan kode 6 digit yang
diberikan saat create.

Pertanyaan yang harus kamu tanyakan sendiri: **siapa yang menggerakkannya?** Bukan aplikasi mobile —
sudah kamu tutup. Bukan `api` — ia hanya melayani HTTP. Jawabannya container `worker`, dan kamu bisa
membuktikannya:

```bash
docker compose logs -f worker
```

Ini poros yang membedakan backend dari frontend, dan `ARCHITECTURE.md:38-52` menceritakan kenapa
bentuknya begitu. Dulu lifecycle dijalankan `setTimeout` di dalam proses Node — *"so you couldn't run
more than one instance and a restart stranded every in-flight delivery"* (`:40-42`). Sekarang ia
sekumpulan delayed job di Redis, diproses tier terpisah. `ARCHITECTURE.md:50` mencatat verifikasinya:
*"created a delivery (17 delayed jobs), killed the API mid-flight (jobs remained in Redis), started a
fresh instance — the delivery still reached `DELIVERED` with proof recorded."*

Kamu bisa mengulangi eksperimen itu **hari ini**, tanpa memahami satu baris pun kodenya. Itu latihannya.

**Anchor:** `src/deliveries/simulation/simulation.constants.ts:56-65` — array `STAGES` dengan
`delayMs` tiap transisi, plus komentar `:61-63` yang menjelaskan kenapa `AWAITING_HANDOFF` terminal.
Pasangannya: `ARCHITECTURE.md:38-52` (kenapa job durabel menggantikan `setTimeout`, termasuk catatan
verifikasi di `:50`) dan `AUDIT-PLAN.md:33-45` (diagram lifecycle lengkap + cabang eksepsi —
"memorize this", katanya, dan ia benar).

**Kenapa dipakai di sini:** karena satu pengamatan ini adalah **premis** dari enam fase berikutnya.
Fase 5 (konkurensi) hanya masuk akal kalau kamu sudah melihat bahwa ada lebih dari satu aktor yang
bisa mengubah satu baris delivery. Fase 6 (worker) hanya masuk akal kalau kamu sudah melihat proses
yang berbeda menggerakkan status. Fase 8 (realtime) hanya masuk akal kalau kamu sudah tahu bahwa
"siapa yang menghitung update" bukan "siapa yang memegang socket". Semua itu satu hal yang sama:
**pekerjaan berlanjut setelah request selesai.** Kalau kamu belum pernah melihatnya, kamu akan
membaca semua penjelasan itu sebagai teori.

**Alternatif:**
- **Buat delivery lewat `curl`/Swagger, bukan mobile.** Trade-off: 30 detik alih-alih 10 menit, dan
  kamu bisa mengulanginya sepuluh kali sambil mengubah payload; harganya, kamu tidak melihat kontrak
  antar-repo bekerja dan tidak menemukan jebakan `EXPO_PUBLIC_API_URL` — yang justru akan menyerangmu
  di Fase 12 saat kamu benar-benar mengirim fitur ke ketiga repo.
- **Pakai 6 delivery hasil seed, jangan buat baru.** Trade-off: langsung ada data untuk dilihat di
  admin tanpa menyalakan mobile sama sekali; harganya, delivery seed **tidak bergerak** — tidak ada
  job yang di-enqueue untuknya, jadi kamu kehilangan justru satu-satunya hal yang fase ini ingin
  tunjukkan.
- **Delivery `LIVE` lewat `POST /ingest/telemetry`** alih-alih `SIMULATED`. Trade-off: ini jalur drone
  sungguhan, dan kamu yang menentukan setiap posisi; harganya, tidak ada yang bergerak sendiri —
  kamu jadi simulatornya, jadi pelajaran "sistem bergerak tanpa aku" justru hilang. Simpan untuk Fase 7.

**Latihan:** setelah delivery-mu mencapai `IN_TRANSIT`, jalankan `docker compose stop worker`. Tunggu
60 detik. Refresh admin — status **tidak** berubah. Lalu `docker compose start worker` dan tunggu lagi.
Status harus melompat maju ke tahap yang seharusnya sudah lewat. Catat tiga hal: berapa lama worker
mati, status sebelum dan sesudah, dan apakah ada tahap yang **terlewat**. (Kalau ada yang terlewat,
kamu baru menemukan pertanyaan yang bagus — tulis di daftar sepuluh pertanyaanmu; jawabannya ada di
Fase 6.)

---

### 0.8 Orientasi tiga repo: peta direktori, batas antar-repo, dan `INTEGRATION.md` sebagai kontrak

Kamu sudah menjalankan ketiganya. Sekarang letakkan mereka dalam satu gambar.

```
Drovery_Mobile  (Expo/RN)  ─┐
                            ├──► Drovery_Backend  ──► Postgres · Redis · Mosquitto
Drovery_Admin   (Vite/MUI) ─┘        (api + worker, satu image)
```

`README.md:14-18` memberi tabelnya berikut ukuran masing-masing: backend 28 modul / 96 endpoint /
25 model, mobile Expo SDK 54, admin Vite + React 19 + MUI 7 + Redux Toolkit. `AUDIT-PLAN.md:22-26`
memberi versi yang lebih berguna untuk navigasi: path absolut tiap repo plus jumlah file.

Batas antar-repo ada persis di satu tempat: **HTTP + WebSocket**. Tidak ada shared package, tidak ada
monorepo, tidak ada tipe yang di-*import* lintas repo. Setiap repo mendeklarasikan ulang bentuk data
yang sama di sisinya sendiri. Itu keputusan dengan harga, dan harganya sudah dibayar — peta konsep repo
ini mencatat satu kelas bug bernama "kontrak antar-repo dengan format berbeda": mobile mengirim
`"Jul 26, 2026"`, backend mem-*parse* `YYYY-MM-DD`, gagal diam-diam, dan **setiap delivery terjadwal
terbang sekarang**. Rantai lengkapnya ditelusuri baris demi baris di `AUDIT-PLAN.md:244-255`, dan
kalimat penutupnya adalah salah satu yang paling tajam di repo ini: *"The data looks right; the
aircraft is already gone."*

Yang menjaga batas itu (sejauh dokumen bisa menjaga) adalah `INTEGRATION.md`. Ia menyebut dirinya
*"the source of truth for how the two repos talk to each other"* (`INTEGRATION.md:12`) dan berisi:
base URL + prefix (`§1`), siklus token (`§2`), envelope respons (`§3`), peta endpoint ↔ aksi mobile
(`§4`, tabel panjang), serviceability (`§5`), model data (`§6`), cara menjalankan keduanya (`§7`), dan
status celah yang diketahui (`§8`).

Dan sekarang bagian yang harus kamu lihat dengan mata terbuka: **dokumen itu sendiri sudah tertinggal
di beberapa titik.** Tiga contoh yang bisa kamu verifikasi dalam lima menit:

| Klaim di `INTEGRATION.md` | Yang sebenarnya |
|---|---|
| `:3` — *"Drovery is a **two-repo system**"* | Tiga repo. `README.md:14-18` mendaftar ketiganya; `Drovery_Admin` bahkan punya seksi admin sendiri di backend. |
| `:40` — *"JWT, **binary** (no roles)"* | Ada role. `prisma/seed.ts:41` menyetel `role: 'ADMIN'`; `src/app.module.ts:189-193` mendaftarkan `RolesGuard` sebagai `APP_GUARD` ketiga; `Drovery_Admin/src/layout/navItems.tsx:29-56` mem-*gate* tiap halaman per role. |
| `:148` dan `:200` — *"The in-memory simulation still means a backend restart strands in-flight deliveries"* | Sudah diperbaiki. `ARCHITECTURE.md:13` menandainya ✅ RESOLVED, dan kamu **sudah membuktikannya sendiri** di latihan §0.7. |

Ini bukan alasan untuk membuang `INTEGRATION.md`. Bagian `§3` (envelope) dan `§4` (peta endpoint)
masih akurat dan sangat berguna. Ini alasan untuk membaca setiap dokumen dengan satu pertanyaan
menempel: *"kapan kalimat ini ditulis, dan apa yang berubah sejak itu?"*

**Anchor:** `INTEGRATION.md:1-12` (tabel repo + klaim "source of truth"), `INTEGRATION.md:56-76`
(envelope sukses vs error — perhatikan bahwa error **sengaja tidak dibungkus**), dan
`INTEGRATION.md:189-198` (bagian "Status of known gaps", termasuk pengakuan kode mati di mobile yang
kamu temukan sendiri di §0.6).

**Kenapa dipakai di sini:** karena `§3` adalah satu-satunya kontrak yang dipegang **ketiga** repo, dan
kamu sudah melihat ketiga sisinya hari ini. Sisi backend: `src/main.ts:69` memasang
`TransformInterceptor` secara global. Sisi admin: `Drovery_Admin/src/api/client.ts:127` membuka
bungkusnya dengan `(json as ApiEnvelope<T>).data`. Sisi mobile: `INTEGRATION.md:64` mengutip kode
klien yang bergantung padanya, `json.data !== undefined ? json.data : json`. Tiga repo, satu bentuk
data, tidak ada tipe bersama — hanya kesepakatan yang ditulis di satu file Markdown. Itu kekuatan
sekaligus kerapuhan arsitektur ini, dan Fase 2 akan membongkar sisi backend-nya utuh.

**Alternatif:**
- **Codegen dari OpenAPI.** Repo ini sudah menerbitkan spec di `/api/v1/docs-json`, dan
  `src/common/swagger.ts:78-84` bahkan sengaja menulis ulang setiap respons 2xx jadi
  `allOf[ApiEnvelopeDto, {data}]` supaya spec cocok dengan runtime. Trade-off: klien hasil generate
  tidak akan pernah salah bentuk, dan perubahan endpoint muncul sebagai error TypeScript di klien;
  harganya, satu langkah build baru di dua repo klien, dan tipe hasil generate biasanya lebih berisik
  daripada tipe tulisan tangan.
- **Shared types package** (satu npm package berisi DTO, dipakai ketiga repo). Trade-off: satu sumber
  kebenaran yang benar-benar dipaksakan compiler; harganya, ketiga repo jadi terkopel versi — merilis
  perubahan tipe menuntut publikasi paket dan bump di dua repo lain sebelum apa pun bisa di-deploy,
  yang untuk tim satu orang berarti gesekan tanpa manfaat.
- **Contract test (Pact atau setara).** Trade-off: kontraknya jadi **executable**, jadi ketidakcocokan
  `"Jul 26, 2026"` vs `YYYY-MM-DD` gagal di CI, bukan di produksi; harganya, satu tool + broker baru,
  dan kamu tetap harus menulis ekspektasi kontrak dengan tangan.

**Latihan:** buka `INTEGRATION.md:82-99` (tabel endpoint ↔ layar mobile). Pilih tiga baris. Untuk
masing-masing, buktikan endpoint-nya benar-benar ada dengan memanggilnya dari Swagger UI
(`http://localhost:3000/api/v1/docs`, tekan **Authorize** dengan `accessToken` dari `POST /auth/login`).
Lalu cari **satu** baris di tabel itu yang menurutmu meragukan dan verifikasi dengan `grep -rn` di
`Drovery_Mobile/`. Tulis hasilnya — akurat, atau tertinggal seperti tiga contoh di atas?

---

### 0.9 Cara membaca repo ini secara skeptis: ✅ / 🟡 / 📐 dan `Left undone`

Sepanjang delapan bab di atas kamu sudah menemukan enam dokumen yang menyimpang dari kode. Itu bukan
kebetulan dan bukan kelalaian tim — itu keadaan normal repo berumur yang berkembang cepat. Bab ini
mengubah temuan-temuan itu dari kejutan jadi **prosedur**.

Repo ini memberimu alat bantu yang tidak biasa: **penanda status**, dan ia memakainya konsisten.

| Penanda | Artinya |
|---|---|
| `✅` | sudah dibangun **dan** diverifikasi |
| `🟡` | separuh jalan — baca kalimat setelahnya, biasanya menyebut sisa pekerjaannya |
| `📐` "Designed here, built later" | baru desain, **belum ada kodenya** |
| `**ILLUSTRATIVE**` / `FILL FROM RUN` | angka placeholder, bukan hasil pengukuran |
| `### Left undone / follow-ups` | utang teknis yang diakui, per increment |

Contoh paling murni ada di `SCALING-1M.md:63-91`, §1 berjudul *"What this PR ships vs. what it
designs"*. Dua tabel berturutan: satu untuk "✅ Built + verified in this PR" (`:67`), satu untuk
"📐 Designed here, built later" (`:80`) — yang kedua bahkan punya kolom *Prerequisite*. Struktur itu
membuat dokumennya **tidak bisa dipakai untuk over-claim**, karena klaim dan rencana duduk di tabel
berbeda.

Contoh kejujuran kedua ada di `SCALING-1M.md:8-13`: *"**The numbers in this doc are ILLUSTRATIVE.**
Every per-node ceiling … is a conservative **placeholder** marked `FILL FROM RUN`."* Angka-angka di
dokumen skala itu bukan hasil pengukuran, dan dokumennya bilang begitu di paragraf pertama.

Contoh ketiga adalah TL;DR `ARCHITECTURE.md:11-16`: empat blocker awal, tiga ✅ dan satu 🟡. Yang 🟡
(geocoding) menyebutkan sisa pekerjaannya di kalimat yang sama. Ini yang harus jadi refleks: begitu
melihat 🟡, **baca kalimat sesudahnya**, karena di situlah sisa pekerjaannya.

Dan alat terakhir, yang paling berharga: `AUDIT-LOG.md` punya **17** bagian `### Left undone /
follow-ups`. Ini bukan daftar keinginan — ini pengakuan cacat yang ditulis oleh orang yang baru saja
menyelesaikan pekerjaannya. Contoh dari yang terbaru, `AUDIT-LOG.md:2243-2254`: fail-closed pada
pengecekan airspace mengembalikan kode `NO_FLY_ZONE` yang non-retryable, sehingga **blip database
sementara** membatalkan + me-refund delivery berbayar. Kalimat penutupnya layak dihafal:
*"Failing closed is right; reusing a non-retryable code for a transient cause is the flaw."*

Kenapa ini ada di Fase 0 dan bukan nanti? Karena `AUDIT-PLAN.md:62-71` menjelaskan taruhannya, dan
angkanya menakutkan: *"1,073 tests passing, all three repos typecheck clean, lint clean — while an
entire user-facing feature (support tickets) was unreachable and no payment had ever been captured.
`supportApi.createTicket` has its own passing test and zero call sites."* Kalau bukti terkuat yang
biasa kamu percayai — suite hijau — bisa berdampingan dengan fitur yang tidak bisa dijangkau, maka
kamu butuh prosedur verifikasi lain **sejak hari pertama**.

Prosedurnya tiga langkah, dan kamu sudah menjalankannya empat kali hari ini tanpa diberi tahu:

1. **Cek penanda statusnya.** ✅ / 🟡 / 📐 / ILLUSTRATIVE.
2. **Cek `### Left undone` pada increment terkait di `AUDIT-LOG.md`.**
3. **Cek kodenya.** Untuk klaim "fitur X ada", langkah paling murah adalah `grep -rn` mencari **call
   site**, bukan definisi. Definisi yang tidak dipanggil adalah kode mati — dan kamu sudah menemukan
   satu di §0.6.

**Anchor:** `SCALING-1M.md:63-91` (dua tabel ✅ vs 📐) dan `SCALING-1M.md:8-13` (peringatan
ILLUSTRATIVE). Lalu `AUDIT-PLAN.md:62-71` (§1.1 — kenapa suite hijau tidak cukup) dan
`AUDIT-LOG.md:2236-2254` (contoh nyata bagian *Left undone*, dengan cacat yang diakui sendiri).

**Kenapa dipakai di sini:** karena satu file di repo ini bisa memuat **tiga hal sekaligus** — yang
sudah jalan, yang baru dirancang, dan yang sudah dibantah — dan bahasanya sama-sama percaya diri di
ketiganya. `AUDIT-PLAN.md:638-643` menetapkan aturan yang membuat lapisan-lapisan itu tetap terlihat:
*"Never rewrite a past entry. Append a correcting entry instead"* dan *"If you discover the plan is
wrong, fix this file **and** record the change under Deviations so the disagreement is visible."*
Konsekuensinya nyata di riwayat commit: `8793ca9 docs(audit): correct three untrue claims` dan
`0e7a650 … correct the doc's own miscounts` adalah commit yang memperbaiki **dokumen**, bukan kode.

**Alternatif:**
- **ADR (Architecture Decision Records)** — satu file kecil bernomor per keputusan, berstatus
  `proposed/accepted/superseded`. Trade-off: jauh lebih mudah di-*diff* dan di-*supersede*, dan
  "keputusan ini sudah digantikan" jadi eksplisit; harganya, narasi lintas-keputusan hilang — di repo
  ini "kenapa sharding ditunda" hanya masuk akal kalau §2 dan §3 `SCALING-1M.md` dibaca berurutan.
- **Wiki / Notion.** Trade-off: non-developer bisa ikut mengedit dan pencariannya lebih baik;
  harganya, tidak ikut di-*review* di PR dan tidak punya `git blame` — klaim salah tidak akan pernah
  ketahuan lewat commit, jadi persis enam ketidakcocokan yang kamu temukan hari ini tidak akan
  terdeteksi selamanya.
- **Hanya pesan commit.** Repo ini juga melakukannya, dan pesannya kalimat penuh (mis.
  `6af2846 fix(airspace): cache the ROWS, not the answer — and make an empty read alertable`).
  Trade-off: selalu sinkron dengan kode karena lahir bersamanya; harganya, commit tidak bisa menjawab
  "apa status keseluruhan sistem hari ini" — untuk itu kamu perlu dokumen yang dirawat.

**Latihan:** ambil satu baris `🟡` dari `ARCHITECTURE.md:14` (Geocoding) dan satu baris `✅` dari
`ARCHITECTURE.md:15` (Real-time tracking). Untuk masing-masing, buktikan statusnya di kode: cari
`CacheService` di `src/cache/` dan `TrackingSubscriber` di `src/deliveries/tracking/`. Tulis lima
kalimat: apakah penandanya jujur? Lalu cari di `AUDIT-LOG.md` bagian *Left undone* mana yang
membahasnya (`grep -n "Left undone" AUDIT-LOG.md` memberi 17 kandidat; baca yang increment-nya
relevan). Simpan sebagai entri pertama di buku catatanmu.

---

### 0.10 Menyiapkan buku catatan belajar: satu file per fase, dan kebiasaan mencatat yang BELUM terjawab

Tidak ada padanan dari dunia frontend untuk bab ini, dan saya sengaja menaruhnya terakhir karena ia
paling mudah dilewati dan paling mahal kalau dilewati.

Selama 13 fase ke depan kamu akan menghasilkan lebih banyak **pertanyaan** daripada jawaban, dan
sebagian besar pertanyaan itu terjawab tiga sampai delapan fase kemudian. Kalau tidak ditulis, dua
hal terjadi: (a) kamu lupa pernah bingung, jadi kamu tidak pernah merasakan momen "oh, jadi begitu";
(b) kamu tidak punya cara mengukur kemajuan selain "sudah sampai fase berapa" — metrik terburuk yang
ada.

Bentuknya, dan pinjam saja bentuk yang sudah dipakai repo ini:

```
Drovery_Backend/docs/catatan/
  00.md   ← fase ini
  01.md
  ...
```

Repo ini punya **template log yang sudah matang** di `AUDIT-PLAN.md:610-636`, dengan delapan bagian:
*What changed · Verification · Decisions made · Deviations from the plan · Left undone / follow-ups ·
Next*. Perhatikan bahwa `### Verification` (`:619-623`) memisahkan hasil suite dari verifikasi manual
(*"Manual: what you actually exercised, beyond the suites — see §1.1"*), dan bahwa
`### Left undone / follow-ups` (`:631-632`) dijelaskan sebagai *"specific, actionable — this is what
the next session picks up"*. Kedua bagian itulah yang membuat log ini berguna dan bukan buku harian.

Untuk Fase 0, tiga bagian saja sudah cukup:

1. **Apa yang kamu jalankan dan hasilnya** — output `docker compose ps`, empat respons verifikasi
   hidup, screenshot admin, rekaman delivery bergerak.
2. **Ketidakcocokan yang kamu temukan sendiri** — kamu sudah punya minimal enam kandidat dari bab-bab
   di atas. Tulis dalam format: klaim, letaknya (file:baris), bukti tandingannya (file:baris).
3. **Sepuluh pertanyaan "aku belum ngerti kenapa…"** — ini yang akan kamu bawa sepanjang kurikulum.

Bentuk pertanyaan yang bagus itu spesifik dan bisa dijawab. Bandingkan:

- ❌ "Apa itu PgBouncer?" — bisa dijawab Google dalam 30 detik, jadi tidak layak jadi pertanyaanmu.
- ✅ "Kenapa `migrate` konek ke `postgres:5432` langsung (`docker-compose.yml:88`) padahal `api`
  lewat `pgbouncer:5432` (`:101`)? Apa yang rusak kalau disamakan?" — ini pertanyaan yang jawabannya
  butuh Fase 10 dan mengubah cara kamu berpikir.

Kalau kamu kesulitan sampai sepuluh, ambil dari yang sudah muncul di fase ini: kenapa ada tujuh
container tapi hanya satu yang punya port ke host? Kenapa `worker` tidak punya `ports:` sama sekali
tapi punya `/metrics` sendiri? Kenapa `/metrics` tidak terbungkus envelope padahal `/health` iya?
Kenapa satu delivery butuh 17 job dan bukan satu? Kenapa `AWAITING_HANDOFF` berhenti dan menunggu?

**Anchor:** `AUDIT-PLAN.md:603-636` — template log delapan bagian, sumber bentuk catatanmu.
Aturannya di `AUDIT-PLAN.md:638-644`, terutama *"Never rewrite a past entry. Append a correcting entry
instead."* Untuk melihat template itu dipakai sungguhan: `grep -n "^## Phase" AUDIT-LOG.md` mendaftar
entri-entrinya; buka satu (mis. `AUDIT-LOG.md:1940`, "Phase 12 (increment 5) — Airspace as data")
dan lihat kedelapan bagiannya terisi.

**Kenapa dipakai di sini:** karena aturan "jangan tulis ulang entri lama" adalah yang membuat log ini
punya nilai yang tidak dimiliki dokumentasi biasa: ia merekam **apa yang kamu kira benar saat itu**.
Delapan bulan lagi kamu akan membaca tebakanmu tentang tujuh service di §0.2 dan melihat persis apa
yang berubah di kepalamu — dan itu satu-satunya bukti belajar yang tidak bisa dipalsukan. Mulai Fase 5,
kurikulum ini mewajibkan setiap capstone menghasilkan satu entri bergaya `AUDIT-LOG.md`; Fase 0 adalah
tempat kebiasaannya dibentuk saat taruhannya masih nol.

**Alternatif:**
- **Notion / Obsidian di luar repo.** Trade-off: tautan dua arah, pencarian jauh lebih baik, bisa
  menempel gambar tanpa membesarkan repo; harganya, catatannya tidak ikut `git log` — kamu kehilangan
  kemampuan menjawab "apa yang aku tahu pada commit ini", yang justru satu-satunya alasan format ini
  ada. Kalau kamu tetap memilih ini, minimal simpan sepuluh pertanyaannya di repo.
- **Issue tracker (GitHub Issues).** Trade-off: tiap pertanyaan bisa ditutup dengan tautan ke commit
  yang menjawabnya — umpan balik yang memuaskan; harganya, tidak ikut di-*review* bersama diff dan
  memaksa setiap catatan jadi "actionable", padahal sebagian besar catatan belajar berbentuk
  "aku belum ngerti" yang bukan tugas siapa pun.
- **Hanya pesan commit.** Trade-off: nol file tambahan dan selalu terikat perubahan nyata; harganya,
  di Fase 1–2 kamu bekerja di sandbox `learn-nest/` dan di Fase 0 kamu tidak mengubah apa pun sama
  sekali — jadi tidak ada commit untuk ditumpangi.

**Latihan:** buat `docs/catatan/00.md` dengan ketiga bagian di atas terisi. Verifikasi kualitasnya
dengan satu tes: berikan daftar sepuluh pertanyaanmu ke orang lain (atau baca ulang besok pagi) dan
cek berapa yang bisa dijawab dengan satu pencarian Google. Kalau lebih dari tiga, pertanyaanmu terlalu
umum — ganti dengan yang menyebut file dan baris, seperti contoh ✅ di atas.

---

## Capstone

Bukan "pahami sistemnya". Enam hal berikut bisa **gagal di depan matamu**, dan kalau gagal kamu tahu
persis mana yang gagal.

- [ ] **Satu delivery menyelesaikan siklusnya tanpa disentuh.** Rekaman layar atau tiga screenshot
      bertanda waktu: delivery dibuat dari mobile (bukan dari seed, bukan dari curl), muncul di
      admin console **Deliveries**, dan berpindah minimal dari `PENDING` ke `AWAITING_HANDOFF` sendiri
      sementara aplikasi mobile sudah kamu tutup.
      **Gagal kalau:** status berhenti di `PENDING` (worker mati atau tidak pernah start) — cek
      `docker compose logs worker`.
- [ ] **Bukti bahwa yang menggerakkan adalah worker, bukan api.** Output `docker compose logs worker`
      yang menampilkan pemrosesan job, di rentang waktu yang sama dengan perubahan status di atas.
      **Gagal kalau:** log worker kosong sementara status tetap maju — berarti kamu jalan di mode
      `PROCESS_ROLE` unset (satu proses), dan capstone ini belum membuktikan apa pun.
- [ ] **`tebakan-service.md` berisi tujuh baris**, satu per service di `docker compose ps`, masing-masing
      dengan tebakanmu dalam satu kalimat. Ditulis **sebelum** membaca `README.md:524-546`. File ini
      akan dibuka lagi di Fase 10 — beri tanggal.
      **Gagal kalau:** kamu menulisnya setelah membaca penjelasan. Tidak ada yang bisa mengeceknya
      selain kamu, dan itulah kenapa aku menyebutnya di sini.
- [ ] **Jalur cadangan terbukti jalan, dengan Docker mati.** Bukti: output `docker ps` yang gagal atau
      kosong, berdampingan dengan `curl -s localhost:3000/api/v1/health/ready` yang mengembalikan
      **200** dan `checks` berisi `database: true, redis: true`.
      **Gagal kalau:** `checks.redis` bernilai `false` — kamu belum menyiapkan Redis terkelola, dan
      jalur cadanganmu akan runtuh di Fase 6 saat BullMQ dibutuhkan.
- [ ] **Empat titik verifikasi hidup tersimpan**, termasuk **satu** respons `/health/ready` bernilai
      **503** yang kamu buat sendiri dengan mematikan database, dan bukti bahwa `/health` tetap 200
      pada saat yang sama.
      **Gagal kalau:** keduanya berubah bersamaan — kamu memanggil endpoint yang sama dua kali.
- [ ] **`docs/catatan/00.md`** berisi: (a) daftar service + tebakanmu; (b) langkah persis jalur cadangan
      yang kamu buktikan, sampai bisa diulang orang lain; (c) sepuluh pertanyaan "aku belum ngerti
      kenapa…", minimal lima di antaranya menyebut `file:baris`; dan (d) minimal **tiga** ketidakcocokan
      dokumen-vs-kode yang kamu verifikasi sendiri, dalam format klaim → letak → bukti tandingan.
      **Gagal kalau:** ketiga ketidakcocokan itu kamu salin dari dokumen ini tanpa membukanya sendiri.
      Fase 3 akan memintamu melakukan hal yang sama tanpa panduan.

---

## Gerbang keluar

Tujuh pertanyaan. Kalau ada yang belum bisa kamu jawab **tanpa membuka kode**, jangan lanjut ke Fase 1
— ulangi bab yang bersangkutan dulu.

**1. Kamu menjalankan `docker compose up --build`. Berapa service yang hidup, dan mana yang statusnya
`Exited (0)` justru karena berhasil?**

<details><summary>Jawaban</summary>

Tujuh: `postgres`, `pgbouncer`, `redis`, `mosquitto`, `migrate`, `api`, `worker`. `migrate` yang
`Exited (0)` — ia one-shot job (`docker-compose.yml:84-92`) yang menjalankan
`prisma migrate deploy && prisma db seed` lalu keluar, dengan `restart: 'no'`. `api` dan `worker`
menunggu exit sukses itu lewat `condition: service_completed_successfully`
(`docker-compose.yml:117-118`). Kalau `migrate` gagal, api tidak akan pernah start.

</details>

**2. Kenapa `psql -h localhost -p 5432` dari laptopmu gagal padahal container `postgres` jelas jalan?**

<details><summary>Jawaban</summary>

Karena hanya `api` yang mem-publish port ke host (`docker-compose.yml:119-120`, `'3000:3000'`). Itu
satu-satunya blok `ports:` di seluruh file. Postgres, PgBouncer, Redis, dan Mosquitto hanya bisa
dijangkau dari dalam network Compose, memakai **nama service** sebagai hostname. Jalan masuk dari
host: `docker compose exec postgres psql -U postgres -d drovery`.

</details>

**3. Apa beda `/api/v1/health` dan `/api/v1/health/ready`, dan kenapa memakai yang salah sebagai probe
liveness itu berbahaya?**

<details><summary>Jawaban</summary>

`/health` = liveness: prosesnya hidup dan melayani, tanpa menyentuh dependensi apa pun. `/health/ready`
= readiness: mengecek database (`SELECT 1`) dan Redis (`ping`), dan **melempar 503** kalau salah satu
gagal. Kalau readiness dipasang sebagai probe liveness, satu blip database membuat orchestrator
me-*restart* seluruh armada — padahal yang sakit database, restart tidak memperbaikinya, dan semua
koneksi hilang percuma. Dengan pemisahan ini, pod yang dependensinya sakit hanya dikeluarkan dari
rotasi dan masuk lagi sendiri saat sembuh.

</details>

**4. Kamu tutup aplikasi mobile setelah membuat delivery, tapi statusnya terus maju. Proses mana yang
melakukannya, dan di mana pekerjaan itu disimpan selama ia menunggu?**

<details><summary>Jawaban</summary>

Container `worker` (`PROCESS_ROLE: worker`, `docker-compose.yml:122-127`). Pekerjaannya berupa
**delayed job di Redis**, bukan timer di memori proses. `ARCHITECTURE.md:40-48` menjelaskan bahwa dulu
ini `setTimeout` di dalam proses Node — sehingga hanya bisa satu instance dan restart menelantarkan
setiap delivery yang sedang terbang. Karena job hidup di Redis, mematikan worker hanya
**menghentikan sementara**: nyalakan lagi dan ia melanjutkan.

</details>

**5. Aplikasi mobile-mu "berhasil login" tapi setiap layar lain kosong atau error. Sebutkan dua
penyebab paling mungkin, dan bagaimana membedakannya dalam satu langkah.**

<details><summary>Jawaban</summary>

(a) `EXPO_PUBLIC_API_URL` menunjuk ke tempat yang salah — kalau tidak diset, `Drovery_Mobile/config/env.ts:18-21`
memakai fallback hardcoded `192.168.1.7`, IP mesin developer aslinya. (b) HP dan laptop tidak satu
jaringan, atau kamu memakai `localhost` di perangkat fisik (yang menunjuk ke HP itu sendiri).
Membedakannya dalam satu langkah: pantau log api (`docker compose logs -f api`) saat kamu login. Kalau
tidak ada baris `POST /api/v1/auth/login`, request-mu tidak pernah sampai — masalah alamat/jaringan.
Kalau ada, masalahnya di sisi lain.

</details>

**6. Apa arti `📐 Designed here, built later` di `SCALING-1M.md`, dan apa dua langkah verifikasi yang
harus kamu jalankan sebelum mempercayai klaim apa pun di repo ini?**

<details><summary>Jawaban</summary>

📐 = baru dirancang, **belum ada kodenya**. `SCALING-1M.md:63-91` sengaja memisahkan yang sudah jadi
(tabel ✅, `:67`) dari yang baru dirancang (tabel 📐, `:80`, lengkap dengan kolom *Prerequisite*)
supaya dokumennya tidak bisa dipakai over-claim. Dua langkah verifikasi: (1) cek bagian
`### Left undone / follow-ups` pada increment terkait di `AUDIT-LOG.md`; (2) cek kodenya — dan untuk
klaim "fitur X ada", cari **call site**-nya, bukan definisinya. Definisi tanpa call site adalah kode
mati, dan `AUDIT-PLAN.md:62-71` menunjukkan justru pola itu yang lolos dari 1.073 test hijau.

</details>

**7. `INTEGRATION.md` menyebut dirinya "the source of truth" untuk komunikasi antar-repo. Sebutkan
satu klaim di dalamnya yang sudah tidak benar, dan bagaimana kamu tahu.**

<details><summary>Jawaban</summary>

Pilih salah satu (semuanya sudah kamu verifikasi di §0.8):
`:3` menyebut sistem ini "two-repo" — sebenarnya tiga (`README.md:14-18`).
`:40` menyebut auth "binary (no roles)" — `RolesGuard` terdaftar sebagai `APP_GUARD` di
`src/app.module.ts:189-193`, dan seed membuat user ber-`role: 'ADMIN'` (`prisma/seed.ts:41`).
`:148`/`:200` masih menyebut simulasi in-memory sebagai blocker #1 — `ARCHITECTURE.md:13` menandainya
✅ RESOLVED, dan kamu membuktikannya sendiri dengan mematikan worker lalu menyalakannya lagi.

Cara tahu: bandingkan klaim dengan kode atau dengan dokumen yang lebih baru, jangan dengan dokumen
yang sama. Bagian `§3` (envelope) dan `§4` (peta endpoint) di file itu masih akurat — dokumen
tertinggal biasanya tertinggal *sebagian*, bukan seluruhnya.

</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| `docker compose up` berhenti di `migrate` dengan `Exited (1)`, dan `api` tidak pernah start | Migrasi atau seed gagal. `api` sengaja menunggu `service_completed_successfully` (`docker-compose.yml:117-118`), jadi kegagalan `migrate` **memblokir** seluruh stack — ini fitur, bukan bug | `docker compose logs migrate`. Kalau errornya soal koneksi, periksa `postgres` sudah `healthy` (`docker compose ps`); healthcheck-nya `pg_isready` di `docker-compose.yml:25-29`. Kalau errornya soal schema, jalankan ulang dari nol: `docker compose down -v && docker compose up --build` |
| `psql`, DBeaver, atau `npm run prisma:studio` dari host tidak bisa konek ke Postgres compose | Hanya `api` yang mem-publish port (`docker-compose.yml:119-120`). Postgres tidak terjangkau dari host, dan ini tidak disebut di README mana pun | `docker compose port postgres 5432` → tidak mengembalikan apa-apa. Solusi: `docker compose exec postgres psql -U postgres -d drovery`, atau tambahkan blok `ports: ['5432:5432']` ke service `postgres` **secara lokal saja** (jangan commit) |
| Backend menolak boot dengan error validasi, padahal `.env` sudah ada | `src/config/validation.ts:21-30` gagal-cepat kalau `PORT`, `DATABASE_URL`, `JWT_SECRET`, atau `JWT_REFRESH_SECRET` kosong. Kalau `NODE_ENV=production`, `:32-42` juga menolak secret <24 karakter atau yang mengandung `change`/`example`/`placeholder` — dan `.env.example:21` persis begitu | Baca pesan errornya: ia menyebut nama variabelnya. Kalau pesannya "weak or a placeholder", kamu tidak sengaja jalan di `NODE_ENV=production` — periksa `.env` baris pertama |
| Backend boot tapi `/health/ready` 503 dengan `redis: false`, atau tidak boot sama sekali di jalur cadangan | Redis **wajib**, bukan opsional. `.env.example:26` menandainya "required — queue + cache + rate limiting" dan `ARCHITECTURE.md:58` menulisnya sebagai peringatan. Jalur cadangan butuh Postgres terkelola **dan** Redis terkelola | `curl -s localhost:3000/api/v1/health/ready \| jq .data.checks` (atau baca body 503-nya). Kalau `redis: false`, periksa `REDIS_HOST`/`REDIS_PORT`, dan untuk Upstash pastikan `REDIS_TLS=true` |
| `/docs` mengembalikan 404, jadi kamu kira Swagger dimatikan | Docs ikut global prefix. `src/main.ts:38-40` memasang `api/v1`, dan `src/common/swagger.ts:185` menghitung path sebagai `` `${prefix}/docs` `` | Buka `http://localhost:3000/api/v1/docs`. Kalau tetap 404, periksa `SWAGGER_ENABLED` — `src/common/swagger.ts:182` mengembalikan `null` kalau nilainya persis `'false'` |
| Mobile "login berhasil" tapi semua data kosong; kamu curiga sedang di mode mock | Tidak ada mode mock. `EXPO_PUBLIC_AUTH_MODE` dibaca (`Drovery_Mobile/config/env.ts:25`) dan `Drovery_Mobile/features/auth/services/authService.ts:172-184` bercabang atasnya, tapi `authService` **tidak pernah diimpor** — `Drovery_Mobile/contexts/AuthContext.tsx:70` memanggil backend langsung. `INTEGRATION.md:198` sudah mendaftarkannya sebagai kode mati | `grep -rn "authService" --include=*.ts --include=*.tsx . \| grep -v node_modules` → hanya baris `export`-nya sendiri. Penyebab sebenarnya hampir pasti `EXPO_PUBLIC_API_URL` (lihat baris berikutnya) |
| Mobile timeout di setiap request, tanpa pesan yang menyebut alamat | `EXPO_PUBLIC_API_URL` tidak diset, sehingga `Drovery_Mobile/config/env.ts:18-21` memakai fallback hardcoded `192.168.1.7` — IP mesin developer aslinya. Atau kamu mengubahnya tapi tidak me-restart Expo: nilainya di-*inline* saat bundling, bukan dibaca saat runtime (`INTEGRATION.md:24`) | Tampilkan nilai efektifnya di layar atau `console.log(ENV.API_URL)`, lalu bandingkan dengan `ip addr` di laptop. Setelah mengubah `.env`, hentikan `expo start` dan jalankan ulang — reload saja tidak cukup |
| Peta di layar tracking kosong/abu-abu, dan tombol bayar tidak memunculkan sheet native | Keduanya **butuh dev build**, bukan Expo Go — dan keduanya gagal **diam-diam**. `Drovery_Mobile/README.md:160-161` mendaftarnya; kunci Maps masih placeholder di `Drovery_Mobile/app.json:25-26` | Ini bukan kesalahanmu dan tidak perlu diperbaiki di Fase 0. Catat saja. Kalau ingin memastikan bukan hal lain, cek bahwa layar **non-peta** (Orders, Profile) terisi normal — kalau ya, backend-mu baik-baik saja |
| Delivery mandek di `AWAITING_HANDOFF` dan tidak pernah `DELIVERED` | Ini **desain**, bukan kegagalan. `src/deliveries/simulation/simulation.constants.ts:61-63`: *"the sim never auto-delivers"* — transisi terakhir butuh konfirmasi OTP handoff dari penerima | Kirim `POST /deliveries/:id/confirm-handoff` dengan kode 6 digit yang diberikan saat create (atau lakukan dari layar mobile). Kalau kodenya hilang, buat delivery baru — hash-nya tidak pernah diekspos ulang |
| Admin console menolak login padahal password benar | Kamu memakai `demo@drovery.com` (role `USER`). Admin console staff-only: `Drovery_Admin/README.md:26-27` menyatakannya, dan gerbangnya nyata di `Drovery_Admin/src/layout/navItems.tsx:29-56` + `RolesGuard` di backend | Login dengan `admin@drovery.com` / `admin123` (`prisma/seed.ts:33-45`). Kalau tetap gagal, seed belum jalan — cek `docker compose logs migrate` atau jalankan `npm run prisma:seed` |
| Sebuah dokumen menjanjikan fitur yang tidak ada saat kamu coba | Tiga dokumen di repo ini tertinggal beberapa increment: `Drovery_Admin/README.md:56,63-69` (daftar halaman + roadmap), `INTEGRATION.md:3,40,148`, dan `README.md:531`. Ini pola, bukan insiden | Jalankan prosedur §0.9: (1) cek penanda ✅/🟡/📐; (2) `grep -n "Left undone" AUDIT-LOG.md` dan baca increment terkait; (3) `grep -rn` mencari **call site**-nya di kode. Kalau nol call site, fiturnya tidak ada — sekalipun test-nya hijau |

---

## Bacaan pendamping

Semua di dalam repo. Baca dalam urutan ini; masing-masing satu kalimat tentang apa yang kamu cari.

1. **`README.md:8-58`** — gambaran sistem tiga-repo plus diagram topologi dan tiga "Engineering
   highlights"; baca untuk mengenali **kosakata** yang akan muncul di 13 fase berikutnya, bukan untuk
   memahaminya sekarang.
2. **`docker-compose.yml:1-14`** — komentar header dengan diagram arus data dan alasan
   `NODE_ENV=production` di stack lokal; ini peta yang paling cepat menjelaskan apa yang baru saja
   kamu nyalakan.
3. **`ARCHITECTURE.md:11-16`** — TL;DR empat blocker awal beserta penanda statusnya sekarang; cari
   di sini contoh pertama bagaimana repo ini menyatakan "sudah selesai" vs "separuh jalan".
4. **`ARCHITECTURE.md:38-58`** — §1 utuh tentang kenapa `setTimeout` diganti job durabel, termasuk
   catatan verifikasi di `:50` dan peringatan jujur di `:58` bahwa Redis sekarang wajib; ini cerita
   di balik apa yang kamu tonton di §0.7.
5. **`INTEGRATION.md:16-34` dan `:56-76`** — kontrak wire (base URL, prefix, ports) dan envelope
   respons; dua bagian yang **masih akurat** dan akan kamu pakai terus mulai Fase 2.
6. **`AUDIT-PLAN.md:14-56`** — §0 orientasi: apa produk ini sebenarnya, diagram lifecycle delivery
   yang diminta dihafal (`:33-45`), dan vonis audit dalam satu paragraf; baca untuk mendapat model
   mental produknya sebelum menyentuh kodenya.
7. **`AUDIT-PLAN.md:60-81`** — §1.1 dan §1.2, dua halaman yang menjelaskan kenapa suite hijau dan mode
   mock keduanya bisa menipu; ini fondasi seluruh kebiasaan skeptis yang kamu bangun di §0.9.
8. **`SCALING-1M.md:8-13` dan `:63-91`** — peringatan ILLUSTRATIVE dan dua tabel ✅ vs 📐; **skim
   saja**, isinya jauh di depanmu — yang kamu cari adalah *bentuk* dokumennya, bukan isinya.

Tiga tautan eksternal, hanya kalau benar-benar perlu:

- [Docker Compose file reference](https://docs.docker.com/reference/compose-file/) — untuk memastikan
  arti `depends_on.condition`, satu-satunya sintaks compose yang benar-benar perlu kamu percayai di
  fase ini.
- [Expo — Environment variables](https://docs.expo.dev/guides/environment-variables/) — aturan
  `EXPO_PUBLIC_` yang di-*inline* saat build; dikutip langsung oleh `Drovery_Mobile/config/env.ts:7`.
- [Neon](https://neon.tech) atau [Supabase](https://supabase.com), plus [Upstash](https://upstash.com) —
  tiga layanan gratis untuk jalur cadangan di §0.3. Kamu butuh **satu Postgres dan satu Redis**, bukan
  salah satunya.

---

> **Sebelum lanjut ke Fase 1.** Fase 1 dikerjakan di sandbox `learn-nest/` buatanmu sendiri, **bukan**
> di Drovery. Yang kamu bawa dari fase ini bukan pengetahuan tentang NestJS — melainkan sebuah sistem
> yang bisa kamu nyalakan kapan saja, jalur cadangan yang sudah terbukti, dan sepuluh pertanyaan yang
> belum terjawab. Ketiganya akan dipakai terus. Jangan hapus `tebakan-service.md`.

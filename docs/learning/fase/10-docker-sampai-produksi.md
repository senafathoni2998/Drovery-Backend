# Fase 10 — Container sampai produksi di satu kotak: Docker, Compose, PgBouncer, edge, CI/CD

> **Durasi** ~2,5 minggu (~32 jam) · **Mode** tuntas · **Repo** `Drovery_Backend` (`Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker-compose.prod.yml`, `deploy/Caddyfile`, `.github/workflows/`, `scripts/`, `DEPLOY.md`)

Analogi induk yang dipakai sepanjang fase ini — pegang erat-erat, dia bekerja lebih jauh dari yang kamu kira:

| Yang kamu sudah tahu (Ionic + Capacitor + Android) | Padanannya di fase ini |
|---|---|
| `npm run build` → folder `www/` yang dikirim ke `android/app/src/main/assets` | `npm run build` → folder `dist/` di tahap *builder* Dockerfile |
| **APK/AAB** = artefak yang dikirim ke device | **Docker image** = artefak yang dikirim ke server |
| `capacitor.config.ts` + override per-platform | `docker-compose.yml` + overlay `-f docker-compose.prod.yml` |
| Play Store: internal track (mutable) vs production release (versionCode terkunci) | tag image `:latest` (mutable) vs `:v1.0.0` / `:sha-<short>` (immutable) |
| Emulator yang menjalankan app-mu | `docker compose up` yang menjalankan **seluruh sistem** di laptopmu |
| Aplikasi Android jalan sebagai uid-nya sendiri di sandbox | `USER nodejs` uid 1001 di `Dockerfile:56` |

Satu ide besar yang mengikat semuanya, dan yang membuat fase ini pendek padahal cakupannya lebar:

> **Satu image, banyak peran.** `Dockerfile:64` membangun **satu** artefak. Peran node ditentukan `command` + env `PROCESS_ROLE` yang sudah kamu kenal sejak Fase 6 (`src/common/process-role.ts:19-26`). `api`, `worker`, dan `migrate` adalah image yang **sama persis**. Semua topologi yang akan kamu susun di sini, dan seluruh Fase 11 (Kubernetes), cuma variasi dari satu kalimat: "berapa replika dari peran mana, dan siapa tetangganya."

---

## Kenapa fase ini ada di sini

Di Fase 0 kamu mengetik `docker compose up postgres` sebagai **resep**. Kamu tidak tahu apa itu image, apa itu volume, dan kenapa perintah itu bekerja. Itu utang yang sengaja diambil supaya kamu bisa menulis endpoint pertama di minggu pertama alih-alih menghabiskan minggu pertama memasang Postgres. Fase ini adalah tempat utang itu dibayar penuh — dan dibayar dengan bunga, karena sekarang kamu punya sistem yang jauh lebih menarik untuk di-container-kan daripada satu Postgres kosong.

Kenapa TEPAT setelah Fase 9 (Observability), dan bukan lebih awal? Karena container yang tidak bisa kamu lihat isinya adalah kotak hitam yang lebih buruk daripada `npm run start:dev` di terminal. Di Fase 9 kamu membangun `/api/v1/metrics`, `/api/v1/health`, dan `/api/v1/health/ready`. Ketiganya sekarang berubah fungsi: `HEALTHCHECK` di `Dockerfile:60-61` memanggil `/api/v1/health`, dan `depends_on: condition: service_healthy` di `docker-compose.yml:110-118` **menolak menyalakan api** sampai jawaban itu keluar. Endpoint yang kemarin cuma "bagus untuk debugging" hari ini jadi bagian dari mesin start-up. Kalau urutan fase dibalik, kamu akan memasang healthcheck ke endpoint yang belum kamu pahami — persis cargo cult yang ingin dihindari kurikulum ini.

Ada tiga hal yang **mustahil** dipahami tanpa fase ini. Pertama, kenapa Drovery bisa mengklaim "autoscale" sama sekali. Jawabannya bukan di kode aplikasi, melainkan di enam baris env PgBouncer (`docker-compose.yml:42-44`) — dan sebelum kamu melihat sendiri `pg_stat_activity` tidak bergerak saat `--scale api=6`, klaim itu cuma slogan. Kedua, kenapa `Drovery_Admin` tidak punya satu pun header CORS di production. Sebagai frontend dev kamu sudah menghabiskan berjam-jam hidupmu melawan CORS; di sini CORS **lenyap**, bukan di-disable, dan mekanismenya ada di 21 baris `deploy/Caddyfile`. Ketiga, kenapa migrasi database punya `DATABASE_URL` yang **berbeda** dari aplikasi (`docker-compose.yml:88` vs `:101`). Itu bukan kelalaian konfigurasi; itu konsekuensi langsung dari transaction pooling, dan repo menulisnya dua kali supaya tidak ada yang "merapikan"-nya (`docker-compose.yml:82-83`, `k8s/base/migrate-job.yaml:31-32`).

Dan fase ini adalah **prasyarat keras Fase 11**. Kubernetes yang akan kamu temui nanti bukan konsep baru; ia adalah `docker-compose.yml` yang sama, ditulis ulang untuk banyak mesin — `k8s/README.md:3-5` menyatakannya terang-terangan: *"Kustomize base + overlays mirroring the `docker-compose.yml` topology."* Setiap kebingungan yang kamu biarkan hidup di sini akan muncul lagi di sana dalam bentuk YAML yang tiga kali lebih panjang. Selesaikan di sini, di mana `docker compose logs` masih menjawab dalam sedetik.

---

## Gerbang masuk

Kamu siap masuk fase ini kalau kamu bisa:

- [ ] **Menjelaskan tanpa membuka kode** kenapa `PROCESS_ROLE=worker` mematikan controller HTTP tapi **tidak** mematikan Prisma, dan menyebut file mana yang jadi satu-satunya sumber kebenarannya (Fase 6 — `src/common/process-role.ts:19-26`).
- [ ] **Menjalankan `npx prisma migrate deploy`** ke database yang benar-benar kosong sampai sukses, lalu menjelaskan kenapa `prisma db push` dilarang di repo ini (Fase 3 — `prisma/PARTITIONING.md`).
- [ ] **Membedakan `/api/v1/health` dan `/api/v1/health/ready`** dan menyebutkan persis apa yang dicek masing-masing, tanpa membuka `src/health/health.controller.ts:17-39`.
- [ ] **Menunjukkan satu metrik** dari `curl -s localhost:3000/api/v1/metrics` yang nanti jadi sinyal autoscaling, dan menjelaskan kenapa metriknya di-`max()` bukan `sum()` (Fase 9).
- [ ] **Menjelaskan apa yang terjadi** kalau dua replika api menjalankan `updateMany({ where: { status: 'PENDING' } })` yang sama pada baris yang sama (Fase 5 — CAS). Fase ini akan menyuruhmu menjalankan enam replika sekaligus; kalau model mental CAS belum mendarat, kamu akan mengira container yang salah.
- [ ] **Menjalankan `docker compose version`** dan mendapat `v2.x`. Bukan `docker-compose` (v1, Python). Fitur yang dipakai fase ini — `!reset []`, `depends_on: condition:`, `deploy.resources` di luar Swarm — tidak ada atau berperilaku beda di v1.

Catatan mesin, jujur di depan: fase ini menyalakan Postgres + PgBouncer + Redis + Mosquitto + api + worker + Caddy + admin secara bersamaan. Sediakan **≥ 8 GB RAM bebas** dan ~15 GB disk. Kalau laptopmu tidak sanggup, jalankan tanpa service `mosquitto` dan `admin` (Caddy akan 502 untuk root — itu tidak apa-apa selama `/api/*` jalan), dan tunda `--scale api=6` ke sesi terpisah.

---

## Peta jalan mingguan

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| **1** | Image sebagai artefak: layer & caching, multi-stage, `.dockerignore`, hardening (10.1–10.4) | 13 | `docker build -t drovery-backend:lat1 .` sukses. Tiga angka waktu build tercatat (dingin / ubah `src/` / ubah `package.json`). `docker run --rm drovery-backend:lat1 id` → `uid=1001`. Satu `Dockerfile.alpine` yang **gagal** dengan pesan engine Prisma, disimpan sebagai bukti. |
| **2** | Sistem sebagai graph: Compose, healthcheck, **PgBouncer**, overlay, Caddy (10.5–10.9) | 13 | `docker compose up` dari state bersih dengan urutan `postgres healthy → pgbouncer healthy → migrate Exited(0) → api start` terekam. Tabel `pg_stat_activity` untuk `--scale api=3` vs `api=6`. `https://drovery.local/api/v1/health` menjawab `{"status":"ok"}` tanpa satu pun header CORS. |
| **3 (separuh)** | Pipeline & pemulihan: CI, CD/tagging, runbook backup, peta alternatif (10.10–10.13) | 6 | Satu PR dengan CI hijau (setelah sengaja dibuat merah di gerbang `prisma:drift-check`). Satu file `.dump` terverifikasi, satu arsip rusak yang **ditolak**, satu angka RTO tercatat. Satu halaman perbandingan sembilan persimpangan. |

Total 32 jam. Alokasi di dalam Minggu 2 sengaja timpang: **berikan ~5 jam penuh untuk 10.7 (PgBouncer)**. Itu satu-satunya konsep di fase ini yang tidak punya padanan di dunia frontend, dan peta konsep menandainya sebagai bagian tersulit seluruh area infra.

### Urutan membaca file (bukan urutan alfabet)

Fase ini menyentuh 11 file. Bacalah dengan urutan ini — masing-masing menjawab pertanyaan yang dibuka file sebelumnya:

```
Dockerfile              → "apa artefaknya?"                       (10.1–10.4)
.dockerignore           → "apa yang TIDAK boleh masuk artefak?"   (10.3)
docker-compose.yml      → "siapa tetangganya, dan siapa siap dulu?" (10.5–10.7)
docker-compose.prod.yml → "apa bedanya di production?"            (10.8)
deploy/Caddyfile        → "siapa yang menghadap internet?"        (10.9)
.env.prod.example       → "apa yang harus diisi manusia?"         (10.8–10.9)
.github/workflows/ci.yml→ "apa yang dicek robot sebelum merge?"   (10.10)
        …/publish.yml   → "bagaimana artefaknya keluar?"          (10.11)
        …/deploy.yml    → "siapa yang menekan tombol?"            (10.11)
scripts/backup.sh       → "kalau semuanya hilang?"                (10.12)
scripts/restore.sh      → "apa buktinya tidak hilang?"            (10.12)
DEPLOY.md               → benang merah semuanya; baca dua kali    (semua)
```

Lima file compose lain di repo (`loadtest`, `nodes`, `observability`) **bukan** wilayah fase ini. `observability` sudah kamu pakai di Fase 9; `loadtest` dan `nodes` menunggu di Fase 11. Kalau kamu tergoda membukanya sekarang, tahan — mereka melapis di atas base yang belum kamu kuasai.

---

## Konsep

### 10.1 Layer & layer caching: kenapa `npm ci` harus di atas `COPY . .`

Docker image bukan satu blob. Ia tumpukan **layer**, satu per instruksi `RUN`/`COPY`/`ADD`, dan tiap layer punya cache key dari isi input-nya. Analogi yang paling jujur dari duniamu bukan Gradle build cache (itu per-task dan bisa acak urutannya), melainkan **git**: kalau kamu mengubah satu commit di tengah sejarah, semua commit sesudahnya dapat hash baru — bukan karena isinya berubah, tapi karena posisinya bergeser. Cache Docker persis begitu: satu layer invalid, **semua layer setelahnya** ikut invalid. Cache itu linear dan tak bisa melompat.

Konsekuensinya menentukan urutan penulisan Dockerfile. `Dockerfile:16-19` menyalin **hanya** `package*.json` + folder `prisma`, lalu menjalankan `npm ci`. Baru setelah itu, di `Dockerfile:23`, seluruh source disalin. Kalau dua blok itu dibalik, mengubah satu baris komentar di `src/main.ts` akan meng-invalidate `COPY . .`, yang meng-invalidate `npm ci`, yang berarti membangun ulang seluruh `node_modules` — beberapa menit, setiap kali, untuk perubahan yang tidak menyentuh satu pun dependency.

`Dockerfile:1` (`# syntax=docker/dockerfile:1`) memilih frontend BuildKit modern. Itu bukan hiasan: BuildKit yang membuat cache bisa **diekspor keluar mesin**, dan di CI itulah yang dipakai (`.github/workflows/ci.yml:104-105`: `cache-from: type=gha` / `cache-to: type=gha,mode=max`). Layer `npm ci` yang di-cache di GitHub Actions bertahan lintas run — jadi urutan yang benar di file ini menghemat waktu di laptopmu **dan** di setiap PR.

**Anchor:** `Dockerfile:16-19` — lihat komentarnya persis: *"Install deps against the lockfile first (better layer caching)."* Lalu bandingkan posisinya dengan `Dockerfile:23-24` (`COPY . .` + `npm run build`). Anchor pendamping: `Dockerfile:1` dan `.github/workflows/ci.yml:98-105` (job `docker` yang mengaktifkan cache GHA).

**Kenapa dipakai di sini:** Repo ini membangun image di tiga tempat berbeda — laptopmu, job `docker` di `ci.yml` (`push: false`, cuma validasi), dan `publish.yml` yang benar-benar mendorong ke registry. Ketiganya membayar harga urutan yang salah. Perhatikan juga `Dockerfile:18` (`COPY prisma ./prisma`) ikut naik ke atas: `npx prisma generate` di `Dockerfile:22` butuh `schema.prisma`, dan menaruhnya di blok yang sama membuat perubahan schema — yang jarang — jadi satu-satunya pemicu regenerasi client.

**Alternatif:**
- **Tidak pakai Docker sama sekali** — deploy source ke VPS, `npm ci` di sana, jalankan dengan `pm2` atau unit `systemd`. Lebih sedikit yang dipelajari dan lebih sedikit yang bisa rusak untuk **satu** server. Harganya konkret: versi Node, versi `openssl`, dan binary engine Prisma jadi tanggung jawab server; "works on my machine" kembali persis di titik yang paling mahal (lihat 10.2). Dan `--scale api=3` tidak ada padanannya.
- **Buildpacks (Paketo, `pack`) atau Nixpacks** — nol Dockerfile, deteksi otomatis. Harganya: kamu kehilangan kontrol eksplisit atas tiga hal yang di repo ini justru sengaja dipilih — kapan `prisma generate` jalan, user non-root uid **1001** yang harus cocok dengan k8s (`k8s/base/api-deployment.yaml:21`), dan `HEALTHCHECK` yang di-bake ke image.
- **`npm install` alih-alih `npm ci`** — lebih toleran saat lockfile tidak sinkron. Justru itu masalahnya: `npm ci` **menolak** kalau `package-lock.json` tidak cocok dengan `package.json` dan menghapus `node_modules` dulu, jadi build-nya reproducible. `npm install` bisa diam-diam menaikkan versi minor dependency saat image dibangun, dan image yang kamu uji hari Senin bukan image yang kamu deploy hari Jumat.
- **`RUN --mount=type=cache,target=/root/.npm npm ci`** (cache mount BuildKit) — mempercepat bahkan saat lockfile berubah, karena tarball npm tetap tersimpan. Harganya: cache-nya lokal ke builder, tidak ikut ke image, dan perilakunya berbeda antara laptop dan runner CI — jadi angka yang kamu ukur di laptop tidak bisa dipakai memprediksi CI.

**Latihan (ukur sendiri, jangan percaya angka orang):**
```bash
cd /home/darth-zelantus/Documents/Project_Pribadi/Drovery_Backend
docker builder prune -af                       # mulai dari nol
time docker build -t drovery-backend:lat1 .    # (A) build dingin
# ubah satu baris komentar di src/main.ts
time docker build -t drovery-backend:lat2 .    # (B) perhatikan step `npm ci` → CACHED
# tambahkan satu dependency remeh di package.json + npm install untuk memperbarui lockfile
time docker build -t drovery-backend:lat3 .    # (C) npm ci jalan penuh lagi
```
Verifikasi: di run (B) baris `RUN npm ci` harus berlabel `CACHED`; di (C) tidak. Tulis tiga angka A/B/C di catatanmu — selisih B vs C adalah nilai ekonomi satu keputusan urutan baris. Kembalikan `package.json` setelah selesai.

---

### 10.2 Multi-stage build, dan kenapa `node:22-slim` (glibc) BUKAN `alpine` (musl)

Multi-stage punya padanan sempurna di duniamu: kamu tidak mengirim seluruh folder proyek Ionic ke device, kamu mengirim APK release. Tahap `builder` di `Dockerfile:8-24` adalah "mesin build"-mu: seluruh devDependencies, TypeScript compiler, Prisma CLI. Tahap `runtime` di `Dockerfile:35-64` adalah "APK"-nya: ia hanya menyalin hasil (`Dockerfile:45-48` — `node_modules`, `dist`, `prisma`, `package.json`). Source `.ts`, cache build, dan toolchain tidak pernah ikut.

Bagian kedua tidak punya padanan sama sekali, dan ini alasan paling spesifik-proyek di seluruh fase. Prisma tidak mengirim query engine sebagai JavaScript; ia mengirim **binary** yang di-compile per target (`debian-openssl-3.0.x`, `linux-musl-openssl-3.0.x`, dan seterusnya). Alpine memakai **musl** libc, Debian memakai **glibc**. Kalau kamu memilih `node:22-alpine`, kamu harus mengurus `binaryTargets` di `schema.prisma`, memasang `libc6-compat`, dan mencocokkan versi openssl — dan **kegagalannya tidak muncul saat build**. Image-nya sukses. `docker push` sukses. Yang gagal adalah query pertama di production, jam 2 pagi.

Repo memilih ukuran image lebih besar demi nol gesekan itu, dan menulis alasannya langsung di file. `Dockerfile:11-14` dan `Dockerfile:39-41` memasang `openssl` + `ca-certificates` di **kedua** tahap, karena Prisma butuh openssl saat `generate` maupun saat konek.

Ada satu trade-off yang diakui terbuka di `Dockerfile:30-33`: devDependencies **sengaja tidak** di-prune, karena peran `migrate` menjalankan `prisma db seed` yang butuh `ts-node`. Komentarnya bahkan menuliskan jalan keluarnya kalau suatu saat ukuran image jadi masalah — *"build a separate migration image and `npm prune --omit=dev` here"*. Baca itu sebagai contoh keputusan sadar, bukan kelalaian. Bandingkan dengan `Dockerfile:49-54`, yang menceritakan bug nyata: `prisma db seed` sempat exit 1 karena Prisma 7 membaca perintah seed dari `prisma.config.ts` (bukan `package.json`), dan perintah itu butuh `tsconfig.json` — dua file kecil yang lupa disalin ke tahap runtime.

**Anchor:** `Dockerfile:3-8` (komentar builder — kalimat *"debian-slim (glibc) avoids the musl/openssl binary-target friction Prisma hits on Alpine"* ada di `:5-6`), `Dockerfile:26-35` (komentar runtime + catatan devDependencies di `:30-33`), `Dockerfile:45-48` (empat `COPY --from=builder`), `Dockerfile:49-54` (cerita bug seed).

**Kenapa dipakai di sini:** Karena Drovery memakai Prisma dengan driver adapter dan menjalankan migrasi **dari image yang sama** (`docker-compose.yml:86`). Kegagalan engine Prisma di Alpine tidak akan tertangkap oleh CI yang cuma membangun image (`ci.yml:98-103`, `push: false`) — build-nya hijau. Ia baru tertangkap saat container benar-benar menyentuh database, yaitu di tempat paling mahal.

**Alternatif:**
- **`node:22-alpine`** — image sekitar 5× lebih kecil (puluhan MB vs ratusan). Harganya: `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` harus ditambahkan ke `schema.prisma`, `apk add libc6-compat openssl` wajib, dan setiap upgrade Prisma berpotensi memindahkan target yang benar. Untuk repo yang meng-upgrade Prisma sekali setahun, hemat 300 MB tidak sebanding satu insiden runtime.
- **`gcr.io/distroless/nodejs22`** — permukaan serangan terkecil: tidak ada shell, tidak ada package manager. Harganya di repo ini **langsung membunuh dua hal**: `HEALTHCHECK ... CMD wget -qO- ...` (`Dockerfile:60-61`) butuh `wget`, dan `command: ['sh', '-c', 'npx prisma migrate deploy && npx prisma db seed']` (`docker-compose.yml:86`) butuh `sh`. Kamu harus memindahkan healthcheck ke orchestrator dan menulis ulang perintah migrate sebagai dua container.
- **Single-stage** — Dockerfile-nya tinggal setengah dan lebih mudah dibaca pemula. Harganya: source `.ts` lengkap, cache npm, dan seluruh toolchain TypeScript ikut terkirim ke production. Untuk repo dengan komentar arsitektur sepadat ini, itu berarti mengirim dokumen desain internal ke server yang menghadap internet.

**Latihan:**
```bash
docker image ls drovery-backend                      # catat ukurannya
sed 's/node:22-slim/node:22-alpine/g' Dockerfile > Dockerfile.alpine
docker build -f Dockerfile.alpine -t drovery-backend:alpine .
docker run --rm drovery-backend:alpine node -e "require('@prisma/client')"
```
Verifikasi: build-nya bisa saja **sukses**; yang harus kamu tangkap adalah pesan error saat `require` atau saat query pertama. Salin pesannya ke catatanmu — itu bukti konkret dari komentar `Dockerfile:5-6`, dan satu-satunya cara membuat kalimat itu berhenti terdengar seperti mitos. Hapus `Dockerfile.alpine` setelah selesai (atau simpan di luar git).

---

### 10.3 `.dockerignore` sebagai kontrol keamanan, bukan sekadar optimasi

Sekilas `.dockerignore` terlihat seperti `.gitignore` versi Docker, dan sebagian memang begitu. Tapi ada satu perbedaan yang mengubah kategorinya dari "optimasi" jadi "kontrol keamanan": file yang lolos ke build context bisa **ter-bake permanen ke dalam layer image**, dan image itu di-push ke registry publik oleh `publish.yml`. Menghapus file di layer berikutnya tidak menghapusnya dari image — layer sebelumnya tetap ada dan bisa diekstrak siapa pun yang menarik image itu.

Padanannya di duniamu: menaruh keystore Android atau `google-services.json` berisi kunci server ke dalam APK. APK itu bisa dibongkar. Docker image lebih mudah lagi dibongkar.

`.dockerignore:7-9` adalah tiga baris paling penting di file itu:
```
.env
.env.*
!.env.example
```
Baris 7-8 adalah deny-list, baris 9 mengecualikan satu file yang memang aman (dan berguna) untuk ikut. Konsumen risikonya konkret: `publish.yml:35` mendorong image ke `senaahmad2998/drovery-backend` di Docker Hub. Kalau `.env` production ikut, kredensial Postgres dan `JWT_SECRET` jadi publik dalam satu `docker pull`.

Bagian kedua lebih membosankan tapi tetap nyata. `COPY . .` di `Dockerfile:23` menyalin **seluruh** build context. Tanpa baris `node_modules` (`.dockerignore:1`), folder `node_modules` host-mu — yang mungkin berisi binary untuk arsitektur berbeda — ikut terkirim ke daemon, lalu **menimpa** hasil `npm ci` yang baru saja dibangun di dalam image. Itu bukan hipotesis; itu kegagalan klasik yang menghasilkan error engine yang terlihat persis seperti masalah Alpine di 10.2, padahal penyebabnya beda total.

**Anchor:** `.dockerignore:1-20` (baca seluruhnya, hanya 20 baris), khususnya `:1` (`node_modules`), `:4-5` (`.git`, `.github`), dan `:7-9` (blok `.env`). Pasangannya: `Dockerfile:23` (`COPY . .`) dan `.github/workflows/publish.yml:35` (tujuan push).

**Kenapa dipakai di sini:** Karena repo ini punya `.env` **asli** di working directory (lihat listing repo — file `.env` 488 byte ada di sana, tidak di-commit ke git tapi ada di disk). `.gitignore` melindungi git; `.dockerignore` melindungi image. Keduanya diperlukan, dan mereka **bukan** file yang sama.

**Alternatif:**
- **Buang `.dockerignore`, pakai `COPY` eksplisit** (`COPY src ./src`, `COPY prisma ./prisma`, dst.). Aman juga dan lebih mudah diaudit dalam satu pandang. Harganya: setiap folder top-level baru harus diingat dan ditambahkan, dan lupa satu berarti build gagal (fail-loud, itu bagus) — tapi konfigurasi Nest yang membaca file di runtime (`mosquitto/`, `observability/`) jadi mudah terlewat. `.dockerignore` adalah deny-list yang gagalnya lebih aman untuk repo yang strukturnya masih tumbuh.
- **Andalkan secret scanning di registry** (Docker Scout, Trivy) — menangkap `.env` yang sudah terlanjur masuk. Harganya: itu deteksi **setelah** push, dan sebuah tag yang sudah publik selama 20 menit harus diperlakukan sebagai bocor. Pencegahan di build context dan deteksi di registry saling melengkapi; yang kedua tidak menggantikan yang pertama.
- **Build context remote** (`docker build https://github.com/...`) — daemon menarik langsung dari git, jadi apa pun yang tidak di-commit otomatis tidak ikut. Harganya: kamu tidak bisa membangun perubahan yang belum di-commit, jadi iterasi lokal mati.

**Latihan:**
```bash
docker build -t dz-test .                     # baca baris "transferring context: ... B"
# komentari baris `node_modules` di .dockerignore
docker build -t dz-test2 .                    # bandingkan angka transferring context
```
Lalu buktikan sisi keamanannya:
```bash
docker run --rm --entrypoint sh drovery-backend:lat1 -c 'ls -a /app | grep -c "^\.env$" || echo "0 — .env tidak ada di image"'
```
Verifikasi: hasilnya harus `0`. Kembalikan `.dockerignore` setelah selesai — dan perhatikan bahwa satu baris komentar bisa mengubah image dari aman jadi bocor.

---

### 10.4 Runtime hardening: uid 1001, `HEALTHCHECK`, dan `CMD` yang sengaja bisa ditimpa

Container yang jalan sebagai root adalah proses root di kernel **host**. Isolasinya nyata tapi tidak absolut; sebuah escape lewat volume mount atau bug runtime langsung memberi akses istimewa di mesinnya. Di Android kamu tidak pernah memikirkan ini karena setiap app otomatis dapat uid sendiri. Di Docker, default-nya justru kebalikannya, dan kamu harus memintanya.

`Dockerfile:42-43` membuat group + user `nodejs` dengan **uid 1001**, dan `Dockerfile:56` (`USER nodejs`) memindahkan semua instruksi setelahnya ke user itu. Angka 1001 bukan acak: `k8s/base/api-deployment.yaml:21` menuliskan `runAsUser: 1001` dengan komentar *"matches the Dockerfile's nodejs user"*. Kalau keduanya tidak cocok, file yang ditulis container di volume jadi tak terbaca oleh proses berikutnya — kegagalan yang mahal untuk didiagnosis karena gejalanya adalah permission error, bukan crash.

`HEALTHCHECK` di `Dockerfile:60-61` di-**bake ke image**. Artinya `docker compose ps` bisa menampilkan kolom status `healthy`/`unhealthy` tanpa konfigurasi tambahan, dan itulah yang dibaca `depends_on: condition: service_healthy` di 10.6. Perhatikan detail kecil yang mudah terlewat: `Dockerfile:40` memasang `wget` **khusus** supaya healthcheck ini punya alat untuk jalan — image `node:22-slim` tidak membawanya. Perhatikan juga `--start-period=20s`: selama 20 detik pertama, kegagalan healthcheck **tidak** dihitung sebagai retry. Prisma + Nest butuh waktu boot, dan tanpa start period container akan ditandai unhealthy sebelum sempat hidup.

Yang paling instruktif justru `CMD` di `Dockerfile:64`. Ia ditulis sebagai `CMD` polos, bukan `ENTRYPOINT`, dan komentarnya di `Dockerfile:63` menjelaskan kenapa: *"Default role = API. The worker service overrides this with: node dist/src/worker."* `ENTRYPOINT` akan mengunci binary; `CMD` polos bisa **diganti total** oleh orchestrator. Itulah yang membuat "satu image, banyak peran" bekerja secara mekanis: `docker-compose.yml:124` menimpanya jadi `node dist/src/worker`, dan `docker-compose.yml:86` menimpanya jadi perintah migrasi.

**Anchor:** `Dockerfile:39-43` (apt install + `groupadd`/`useradd` uid 1001), `Dockerfile:56-57` (`USER nodejs`, `EXPOSE 3000`), `Dockerfile:59-61` (komentar + `HEALTHCHECK`), `Dockerfile:63-64` (komentar + `CMD`). Pasangan lintas-fase: `k8s/base/api-deployment.yaml:19-23` (blok `securityContext` yang mencocokkan uid).

**Kenapa dipakai di sini:** Karena image ini benar-benar dipakai untuk tiga peran berbeda di Compose dan empat di k8s. Kalau `CMD` dikunci sebagai `ENTRYPOINT`, `docker-compose.yml:86` dan `:124` harus memakai `--entrypoint` yang lebih canggung, atau repo harus membangun tiga image — yang tepat menghancurkan prinsip di `k8s/README.md:3-5`.

**Alternatif:**
- **Healthcheck hanya di orchestrator, tidak di image.** Lebih fleksibel per-environment, dan repo ini sebenarnya melakukan **keduanya**: image punya default, tapi k8s menggantinya dengan **tiga** probe berbeda (`k8s/base/api-deployment.yaml:39-53`). Alasannya konkret: `HEALTHCHECK` Docker cuma punya satu konsep sehat, sedangkan k8s membedakan *startup* / *readiness* / *liveness*. Harganya kalau kamu hanya pakai orchestrator: `docker run` polos jadi buta, dan `docker compose ps` kehilangan kolom yang paling sering kamu pelototi selama fase ini.
- **`ENTRYPOINT ["node"]` + `CMD ["dist/src/main"]`** — mengunci binary sehingga `docker run image dist/src/worker` cukup menyebut argumen. Lebih rapi secara semantik. Harganya di repo ini: `docker-compose.yml:86` yang butuh `sh -c` untuk merangkai dua perintah (`migrate deploy && db seed`) tidak lagi bisa memakai `command:` biasa.
- **Jalan sebagai root, kendalikan di orchestrator** (`user: "1001:1001"` di Compose, `runAsUser` di k8s). Fleksibel per-deployment. Harganya: `docker run` polos jadi root lagi, dan `runAsNonRoot: true` di k8s akan **menolak** pod yang image-nya tidak menyatakan user non-numerik — jadi kamu memindahkan kewajiban ke tempat yang lebih mudah dilupakan.

**Latihan:**
```bash
docker run --rm drovery-backend:lat1 id          # harus uid=1001(nodejs) gid=1001(nodejs)
docker inspect --format '{{json .Config.Healthcheck}}' drovery-backend:lat1
docker compose up -d postgres pgbouncer redis mosquitto migrate api
watch -n2 'docker compose ps'
```
Verifikasi: pelototi kolom status service `api` berpindah dari `starting` → `healthy`. Waktu transisinya kira-kira sepanjang `--start-period=20s` plus satu `--interval=30s`. Lalu coba `docker run --rm drovery-backend:lat1 touch /etc/passwd` — harus ditolak dengan `Permission denied`. Itu uid 1001 yang bekerja.

---

### 10.5 Compose sebagai service graph: DNS internal, named volume, dan Redis untuk tiga peran

Sampai titik ini kamu punya satu image. `docker-compose.yml` adalah tempat image itu jadi **sistem**. Padanan terdekatnya bukan `capacitor.config.ts` (itu overlay, lihat 10.8) melainkan hal yang tidak ada di duniamu: sebuah deklarasi topologi yang sekaligus menyediakan **DNS internal**.

Ini bagian yang paling sering bikin heran orang yang datang dari frontend. `docker-compose.yml:101` menulis `postgresql://postgres:postgres@pgbouncer:5432/...`. `pgbouncer` di situ adalah **nama service**, dan Compose menjadikannya hostname yang bisa di-resolve dari container mana pun di network yang sama. Tidak ada file hosts yang kamu tulis, tidak ada IP yang kamu hardcode. Dan karena resolvernya mengembalikan **A-record per replika**, `--scale api=3` otomatis menghasilkan tiga alamat di balik satu nama — fakta yang akan jadi jebakan penting di Fase 11.

Header file (`docker-compose.yml:1-14`) menggambar topologinya dalam ASCII, dan gambar itu adalah cetak biru untuk seluruh sisa kurikulum. Tiga mekanik yang layak kamu kunyah pelan:

**Named volume ≠ container.** `docker-compose.yml:143-146` mendeklarasikan `pgdata`, `redisdata`, `mosquittodata`. Volume hidup terpisah dari container, jadi `docker compose down` lalu `up` **tidak** menghapus data. `DEPLOY.md:113-114` menyandarkan seluruh cerita rollback pada fakta ini: *"Rollback = set `TAG` back to the previous version and re-run the pull flow. Postgres/Redis data persist in named volumes across restarts."* Yang menghapus data adalah `docker compose down -v` — satu huruf, konsekuensi total.

**Satu Redis, tiga peran.** Komentar `docker-compose.yml:6` menyebutnya langsung: *"queue + cache + rate-limit"*. Satu instance melayani BullMQ (durabilitas job), cache-aside (fail-open), dan penghitung throttle (RPS tertinggi). Itu keputusan yang benar untuk satu kotak dan **salah** pada skala tertentu, dan repo tahu itu: `src/config/configuration.ts:69-72` sudah menyiapkan seam `queue` / `cache` / `pubsub` / `throttle` yang masing-masing bisa diarahkan ke host berbeda, dan `SCALING-1M.md:232-237` menuliskan urutan pemisahannya berdasarkan blast radius — `throttle` dulu, lalu `pubsub`, lalu `queue`, terakhir `cache`. Ada juga jebakan tersembunyi yang dicatat di `DEPLOY.md:248-254`: alert `DroveryReadinessFailing` hanya mengcover Redis peran *cache*, jadi begitu kamu memisahkan peran, readiness diam-diam berhenti mengcover yang dipisah.

**Mosquitto ada karena alasan yang sangat spesifik.** `docker-compose.yml:66-68`: *"Mosquitto 2 supports MQTT5 shared subscriptions, so each ingest frame is processed by exactly ONE api replica."* Tanpa shared subscription, menambah replika api berarti setiap frame telemetri diproses berkali-kali. Itu contoh sempurna dari "pilihan komponen infra ditentukan oleh invariant domain", bukan oleh selera.

Satu klarifikasi yang menghemat kebingungan berjam-jam: **nama service ≠ nama container**. `pgbouncer` adalah nama service dan sekaligus hostname di network internal. Nama container-nya sesuatu seperti `drovery-backend-pgbouncer-1` — itu yang muncul di `docker ps`, dan itu **bukan** yang kamu tulis di connection string. Saat scaling, nama container bertambah (`-2`, `-3`) tapi nama service tetap satu, dan resolvernya mengembalikan semua alamat di baliknya. Kalau kamu pernah menulis `postgres://...@drovery-backend-pgbouncer-1:5432` karena itu yang kamu lihat di `docker ps`, itu akan bekerja hari ini dan pecah begitu kamu scale.

**Anchor:** `docker-compose.yml:1-14` (header + diagram topologi), `docker-compose.yml:101` (`@pgbouncer:5432` — DNS internal), `docker-compose.yml:143-146` (blok `volumes:`), `docker-compose.yml:6` (Redis tiga peran), `docker-compose.yml:66-68` (alasan Mosquitto). Pendamping: `DEPLOY.md:113-114`, `src/config/configuration.ts:63-72` (seam per-concern beserta komentar urutan pemisahannya).

**Kenapa dipakai di sini:** `k8s/README.md:3` menyatakan k8s manifest-nya *"mirroring the `docker-compose.yml` topology"*. File ini bukan alat bantu belajar yang nanti dibuang — ia adalah spesifikasi topologi yang diterjemahkan ke Kubernetes di Fase 11. Setiap service di sini punya padanan Deployment/Service di sana, kecuali Postgres/PgBouncer/Redis yang sengaja **tidak** ada di k8s (`k8s/README.md:45-49`: diasumsikan managed).

**Alternatif:**
- **Pasang Postgres/Redis langsung di host** (`apt install postgresql redis`). Sedikit lebih cepat (tanpa lapisan network container) dan sudah kamu kenal. Harganya: versinya tidak tercatat di repo, jadi rekan tim yang punya Postgres 14 akan menemui bug yang tidak bisa kamu reproduksi; dan `docker compose down -v` yang mengembalikan sistem ke keadaan bersih dalam 5 detik tidak punya padanan.
- **`docker run` manual + `--link`** — bisa, dan kamu akan tahu persis apa yang terjadi. Harganya: `--link` sudah deprecated, urutan start harus kamu urus sendiri di shell script, dan tidak ada satu file yang bisa di-review di PR sebagai "beginilah bentuk sistemnya".
- **Managed services bahkan untuk lokal** (Neon/Upstash) — nol resource di laptop, cocok untuk mesin 8 GB. Harganya: latency tiap query lewat internet membuat pengukuran apa pun tidak berarti, kamu tidak bisa menjalankan `pg_stat_activity` di 10.7, dan seluruh pelajaran PgBouncer hilang karena poolernya bukan milikmu.

**Latihan:**
```bash
docker compose up -d
docker compose exec api getent hosts pgbouncer
docker compose exec api getent hosts postgres
docker compose exec api sh -c 'apt-get -v >/dev/null 2>&1; getent hosts redis'
```
Lalu buktikan volume:
```bash
docker compose exec postgres psql -U postgres -d drovery -c "select count(*) from users;"
docker compose down            # TANPA -v
docker compose up -d && sleep 20
docker compose exec postgres psql -U postgres -d drovery -c "select count(*) from users;"   # angka SAMA
docker compose down -v         # sekarang dengan -v
docker compose up -d           # perhatikan migrate + seed jalan lagi dari nol
```
Verifikasi: angka `count(*)` bertahan lintas `down`/`up`, dan nol lagi setelah `down -v`. Kalau kamu tidak pernah melihat perbedaan itu dengan mata sendiri, `-v` akan menghapus data yang salah suatu hari nanti.

---

### 10.6 Healthcheck protokol asli, `depends_on` berkondisi, dan one-shot job `migrate`

`depends_on` polos hanya menjamin **urutan start** — Compose menyalakan B setelah A. Ia tidak menjamin A **siap**. Container Postgres yang baru saja `docker start` sudah "berjalan" beberapa detik sebelum bisa menerima koneksi. Padanan di duniamu: `useEffect(() => { fetch(...) }, [])` yang jalan sebelum token selesai dimuat dari storage — komponennya sudah mount, tapi prasyaratnya belum ada.

Repo ini memakai bentuk berkondisi, dan blok yang paling padat pelajarannya ada di `docker-compose.yml:110-118`:
```yaml
depends_on:
  redis:    { condition: service_healthy }
  pgbouncer:{ condition: service_healthy }
  mosquitto:{ condition: service_healthy }
  migrate:  { condition: service_completed_successfully }
```
Dua kondisi, dua tugas berbeda:

**`service_healthy`** menunggu healthcheck service itu lulus. Perhatikan bahwa healthcheck-nya **bukan** "cek port terbuka" — semuanya perintah protokol asli: `pg_isready -U postgres -d drovery` (`docker-compose.yml:26`), `redis-cli ping` (`:61`), `mosquitto_pub -h 127.0.0.1 -t healthcheck -m ok` (`:77`). Bedanya penting: port TCP yang terbuka tidak berarti Postgres sudah selesai recovery, dan `pg_isready` tahu bedanya. PgBouncer punya healthcheck-nya sendiri (`:50`) yang menembak dirinya sendiri di `127.0.0.1:5432` — jadi "pgbouncer healthy" berarti pooler-nya sudah menerima koneksi, bukan sekadar prosesnya hidup.

**`service_completed_successfully`** adalah pola **one-shot job**. Service `migrate` (`docker-compose.yml:84-92`) menjalankan `npx prisma migrate deploy && npx prisma db seed`, lalu **exit 0**, dan `restart: 'no'` (`:92`) memastikan Compose tidak menghidupkannya lagi. api dan worker baru boleh start setelah exit code itu nol. Tanpa gerbang ini, api bisa boot ke database yang tabelnya belum ada — dan gejalanya (`relation "users" does not exist` di log api) menuduh tempat yang salah.

Satu detail di `migrate` yang layak digarisbawahi sekarang dan akan kembali di 10.7: ia konek **langsung ke `postgres:5432`** (`docker-compose.yml:88`), bukan ke pgbouncer, dengan komentar di `:82-83` — *"DDL + migration advisory locks bypass the transaction pooler by design."* Itu bukan penyederhanaan; itu keharusan.

**Anchor:** `docker-compose.yml:25-29` (healthcheck postgres), `:49-53` (healthcheck pgbouncer ke dirinya sendiri), `:60-64` (redis), `:75-80` (mosquitto), `:82-92` (service `migrate` lengkap dengan komentar dan `restart: 'no'`), dan yang terpenting `:110-118` (blok `depends_on` milik api). Bandingkan dengan `:135-141` (worker — sama, tapi tanpa mosquitto).

**Kenapa dipakai di sini:** Karena Drovery punya seed yang harus jalan **tepat sekali** dan migrasi yang mengandung DDL partisi. Menjalankan migrasi dari entrypoint aplikasi berarti N replika mencoba migrasi bersamaan; job terpisah membuatnya deterministik. Pola yang sama muncul lagi sebagai `Job` Kubernetes di Fase 11 (`k8s/base/migrate-job.yaml`), termasuk perbedaan penting: di prod seed **dikecualikan** (`k8s/base/migrate-job.yaml:29` — `# seed excluded in prod`), sejalan dengan peringatan `DEPLOY.md:91-93`.

**Alternatif:**
- **`wait-for-it.sh` / `dockerize` di entrypoint** — jalan di mana saja, termasuk Swarm dan k8s yang **mengabaikan** `depends_on`. Harganya: logika tunggu jadi tersebar di setiap image, dan setiap image harus tahu daftar dependensinya — pengetahuan topologi bocor ke dalam artefak yang seharusnya netral.
- **Retry di level aplikasi** (boot ulang sampai DB siap, dengan backoff) — paling tangguh di production, karena ia juga menangani database yang **hilang di tengah jalan**, bukan cuma yang belum siap. Harganya di konteks belajar: log jadi berisik dan urutan start tidak deterministik, jadi kamu tidak bisa melihat sekuens `postgres → pgbouncer → migrate → api` dengan jelas. Idealnya kamu punya keduanya; repo ini memilih gerbang eksplisit karena topologinya adalah materi ajarnya.
- **Migrasi di dalam entrypoint aplikasi** — satu service lebih sedikit. Harganya persis seperti di atas: dengan `--scale api=3`, tiga proses menjalankan `migrate deploy` bersamaan dan kamu bergantung sepenuhnya pada advisory lock Prisma untuk menyelamatkanmu — advisory lock yang, ironisnya, adalah hal yang rusak kalau koneksinya lewat pooler (10.7).

**Latihan:** Dari state benar-benar bersih, jalankan di **foreground** supaya urutannya terbaca:
```bash
docker compose down -v
docker compose up            # jangan -d; baca lognya
```
Verifikasi: kamu harus melihat berurutan — `postgres` healthy, `pgbouncer` healthy, `migrate` menjalankan migrasi lalu `exited with code 0`, baru api/worker boot. Lalu rusak dengan sengaja: ubah `docker-compose.yml:86` menjadi
```yaml
command: ['sh', '-c', 'npx prisma migrate deploy && exit 1']
```
dan `docker compose up` lagi. Verifikasi: api **tidak pernah** start, dan Compose menyebutkan dependensi yang gagal. Kembalikan baris itu setelah selesai.

---

### 10.7 PgBouncer & transaction pooling — konsep tersulit di fase ini

Mulailah dengan kejujuran: **tidak ada padanan yang jujur untuk ini di dunia frontend.** Yang paling dekat adalah batas 6 koneksi per origin di HTTP/1.1, dan analogi itu justru menyesatkan, karena koneksi HTTP murah dan koneksi Postgres tidak. Sisihkan intuisimu dan bangun model baru dari fakta.

**Fakta 1: satu koneksi Postgres = satu proses sistem operasi.** Bukan thread, bukan entri di tabel — proses penuh dengan memori privat sekitar 5–10 MB. `max_connections` default sekitar 100. Ini bukan angka konfigurasi yang malas dinaikkan; ia mencerminkan biaya nyata. Menaikkannya ke 2000 tidak membuat Postgres melayani 2000 klien; ia membuat Postgres menghabiskan waktunya melakukan context switch antar 2000 proses.

**Fakta 2: setiap replika aplikasi membawa pool-nya sendiri.** `docker-compose.yml:102` menetapkan `DATABASE_POOL_MAX: 10` untuk api, `:129` menetapkan `5` untuk worker. Hitung: 3 api + 3 worker = 45 koneksi. Naikkan ke 20 replika api (`k8s/base/api-hpa.yaml:11` → `maxReplicas: 20`) dan kamu sudah di 200+. Postgres menolak sebelum autoscaler-mu selesai bekerja. **Inilah kenapa "autoscale" tanpa pooler adalah klaim kosong.**

**Fakta 3: PgBouncer duduk di tengah dan berbohong dengan sopan kepada kedua sisi.** `docker-compose.yml:42-44`:
```yaml
POOL_MODE: transaction
MAX_CLIENT_CONN: 1000
DEFAULT_POOL_SIZE: 20
```
Aplikasi melihat 1000 slot klien. Postgres hanya pernah melihat 20 koneksi. Rasionya 50:1. Komentar di `docker-compose.yml:31-33` menyatakan tesisnya langsung: *"Multiplexes many app clients onto a small Postgres server-side pool — this is what lets the API/worker tiers autoscale without exhausting Postgres `max_connections`."*

Angka-angkanya, disusun berdampingan supaya bedanya kelihatan:

| Topologi | Koneksi yang **diminta** aplikasi | Tanpa pooler → dilihat Postgres | Dengan pooler → dilihat Postgres |
|---|---|---|---|
| 1 api + 1 worker | 10 + 5 = 15 | 15 | ≤ 20 |
| 3 api + 3 worker | 30 + 15 = 45 | 45 | ≤ 20 |
| 6 api + 3 worker | 60 + 15 = 75 | 75 | ≤ 20 |
| 20 api + 5 worker (`api-hpa.yaml:11`) | 200 + 25 = 225 | **ditolak** (default `max_connections` ~100) | ≤ 20 |

Kolom terakhir yang tidak bergerak itulah yang akan kamu buktikan sendiri di latihan bawah. Kolom ketiga adalah alasan kenapa autoscaling tanpa pooler bukan sekadar "kurang optimal", melainkan **mustahil**: tier yang menambah replika untuk menyerap trafik justru meruntuhkan database yang dilayaninya.

**Fakta 4 — dan ini inti kesulitannya: `transaction` mode membuang state sesi.** Dalam mode `transaction`, koneksi server dikembalikan ke pool **di akhir setiap transaksi**, bukan di akhir sesi. Itu yang memberi rasio tinggi. Harganya: apa pun yang hidup di level *sesi* jadi tidak bisa diandalkan — prepared statement lintas transaksi, `SET` yang kamu harapkan bertahan, `LISTEN/NOTIFY`, dan **advisory lock ber-scope sesi**. Query berikutnya dari klien yang sama bisa mendarat di koneksi server yang berbeda, dan lock yang kamu pegang tadi ada di koneksi lain.

Prisma memakai advisory lock ber-scope sesi untuk menyerialkan migrasi. Karena itu migrasi **wajib** bypass pooler, dan repo menuliskannya di dua tempat supaya tidak ada yang menganggapnya inkonsistensi konfigurasi lalu "memperbaikinya": `docker-compose.yml:82-83` dan `k8s/base/migrate-job.yaml:31-32` (*"Migrations hit Postgres DIRECTLY — DDL + Prisma's session-scoped advisory locks break through PgBouncer transaction pooling"*). Di Kubernetes ia bahkan jadi key Secret terpisah: `DATABASE_URL` untuk aplikasi, `DATABASE_URL_DIRECT` untuk migrasi (`k8s/base/secrets.env.example:8-11`).

Repo juga menghitung batas atas dari susunan ini secara eksplisit — `SCALING-1M.md:246-248`: *"The PgBouncer ceiling is `floor((1000 − workerNodes×5)/10) ≈ 94 api nodes` on one pooler"*, dengan resep lanjutannya: satu PgBouncer per write-shard. Angka 94 itu berguna bukan karena tepat, tapi karena ia menunjukkan bahwa **poolernya sendiri punya ceiling**, dan kamu tahu di mana.

**Anchor:** `docker-compose.yml:31-33` (komentar tesis — baca ini dulu, sebelum apa pun), `:42-44` (`POOL_MODE` / `MAX_CLIENT_CONN` / `DEFAULT_POOL_SIZE`), `:102` (`DATABASE_POOL_MAX: 10` di api) dan `:129` (`5` di worker), `:82-83` + `:88` (migrate bypass pooler), `k8s/base/secrets.env.example:8-11` (dua URL, dua tujuan), `SCALING-1M.md:246-248` (ceiling numerik), `k8s/README.md:56-57` (gotcha yang sama, ditulis ulang untuk cluster).

**Kenapa dipakai di sini:** Karena seluruh cerita skala Drovery bergantung padanya. `ARCHITECTURE.md:90` menaruh PgBouncer sebagai item **pertama** di daftar perbaikan skala: *"Essential once N instances > a handful."* Dan karena tanpa memahami mode `transaction`, kamu tidak akan pernah bisa membaca komentar migrate sebagai keharusan — kamu akan membacanya sebagai kelalaian dan memperbaikinya, lalu menghabiskan satu malam mencari tahu kenapa `prisma migrate deploy` menggantung.

**Alternatif:**
- **`POOL_MODE: session`** — kompatibilitas 100% dengan Postgres: advisory lock, prepared statement, `LISTEN` semua jalan, dan migrasi tidak perlu URL terpisah. Harganya menghapus seluruh alasan memasang pooler: satu klien memegang satu koneksi server sepanjang sesinya, jadi 45 klien tetap 45 koneksi Postgres. Rasio multiplexing ≈ 1:1.
- **`POOL_MODE: statement`** — rasio tertinggi (koneksi dikembalikan tiap statement). Harganya mematikan: transaksi multi-statement **dilarang total**, dan seluruh jalur uang Drovery bersandar pada `$transaction` interaktif — `deliveries.service.ts:362` dan `:374` merangkai promo redemption dan wallet debit sebagai reservasi yang harus co-commit sebelum delivery dibuat. Untuk repo ini bukan "kurang cocok" — mustahil.
- **Pgpool-II** — pooling + load-balance ke read replica + query cache dalam satu komponen. Harganya: jauh lebih berat, konfigurasinya besar, dan ia punya mode failover yang bisa mengambil keputusan yang tidak kamu duga. Repo memilih PgBouncer (satu fungsi, ~2 MB RSS) dan menangani read replica di **level aplikasi** lewat `readWithFallback()` (`ARCHITECTURE.md:92`) — pemisahan tanggung jawab yang membuat masing-masing bisa dipahami sendiri.
- **Supavisor / RDS Proxy / Cloud SQL connector** — managed, tidak ada yang perlu kamu operasikan, dan biasanya sudah HA. Harganya: vendor lock-in pada connection string, dan — untuk fase ini fatal — **tidak bisa dijalankan di laptop**, jadi latihan `pg_stat_activity` di bawah tidak akan pernah kamu lakukan.
- **Tanpa pooler, naikkan `max_connections` ke 500.** Kadang benar untuk beban kecil dengan koneksi berumur panjang. Harganya: ~5-10 MB × 500 = 2,5-5 GB RAM habis hanya untuk backend proses yang mayoritas idle, dan performa turun jauh sebelum slot terakhir terpakai.

**Latihan (ini latihan terpenting di seluruh fase — jangan dilewati):**
```bash
docker compose up -d --scale api=3
sleep 30
docker compose exec postgres psql -U postgres -d drovery \
  -c "select count(*), application_name from pg_stat_activity group by 2 order by 1 desc;"

docker compose up -d --scale api=6
sleep 30
docker compose exec postgres psql -U postgres -d drovery \
  -c "select count(*), application_name from pg_stat_activity group by 2 order by 1 desc;"
```
Verifikasi bagian satu: jumlah koneksi ke Postgres **tidak** naik dua kali lipat. Ia terikat `DEFAULT_POOL_SIZE: 20`. Tulis kedua angka itu berdampingan — itu satu-satunya bukti empiris dari kalimat di `docker-compose.yml:31-33`.

Lalu buktikan sisi mahalnya. Ubah `docker-compose.yml:88` dari `@postgres:5432` menjadi `@pgbouncer:5432`, lalu:
```bash
docker compose down
docker compose up migrate
```
Verifikasi bagian dua: baca error-nya sampai selesai. Yang kamu lihat adalah advisory lock Prisma yang pecah di transaction pooling — bukan bug, melainkan konsekuensi yang sudah ditulis di komentar `:82-83`. **Kembalikan ke `@postgres:5432`.** Simpan pesan error itu di catatanmu; ia akan muncul lagi di Fase 11 dalam bentuk `Job` yang gagal.

---

### 10.8 Overlay Compose: pelapisan `-f`, `!reset []`, dan interpolasi env

Compose menggabungkan file `-f` **secara berurutan**; file berikutnya menambah atau menimpa field file sebelumnya. Padanan yang paling jujur di duniamu adalah `tsconfig.json` dengan `extends` — satu base, beberapa turunan yang cuma menuliskan **selisihnya**. Padanan kedua yang juga bekerja: `capacitor.config.ts` dengan blok override per-platform.

Repo ini punya lima file compose dan mereka **dilapis**, bukan dipilih salah satu. Untuk fase ini kamu hanya butuh dua:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
Tiga file lainnya (`loadtest`, `nodes`, `observability`) adalah wilayah Fase 9 dan Fase 11.

Tiga idiom yang harus kamu kenali dengan mata tertutup:

**`!reset []`** — merge Compose secara default **menggabungkan** list. Untuk benar-benar **menghapus** `ports: ['3000:3000']` yang datang dari base, kamu perlu `!reset`. `docker-compose.prod.yml:43` memakainya dengan alasan yang ditulis di baris yang sama: *"fronted by Caddy — no host port"*. Yang menarik: `docker-compose.loadtest.yml:17` memakai idiom **yang sama** untuk alasan yang **berbeda** — *"no host-port conflict when scaling"*, karena satu host port tidak bisa dibagi tiga replika. Idiom yang sama, dua masalah yang tidak berhubungan; kalau kamu hafal idiomnya tanpa alasannya, kamu akan salah menerapkannya.

**`${VAR:?pesan}`** — gagal-keras kalau env tidak diset, dengan pesan yang kamu tulis sendiri. Repo memakainya untuk **semua** secret: `POSTGRES_PASSWORD` (`docker-compose.prod.yml:19`, `:24`), `JWT_SECRET` dan `JWT_REFRESH_SECRET` (`:46-47`, `:62-63`), `DOMAIN` (`:87`). Ini lapisan pertama; lapisan kedua adalah boot guard aplikasi yang menolak secret lemah di production (`DEPLOY.md:37`). Dua gerbang untuk kesalahan yang sama, di dua waktu berbeda — satu saat `docker compose config`, satu saat proses boot.

**`${VAR:-default}`** — nilai default kalau tidak diset. Dipakai untuk hal yang punya default aman: `${DOCKER_REGISTRY:-drovery}/drovery-backend:${TAG:-latest}` (`:35`, `:40`, `:57`, `:69`) dan `CORS_ORIGINS: ${CORS_ORIGINS:-}` (`:49`). Perhatikan komentar di `:48`: *"Same-origin admin needs no CORS; set this only if you serve the console on another host"* — default kosong di sini adalah pernyataan arsitektur, bukan kemalasan.

Satu keputusan kecil yang mudah terlewat: `docker-compose.prod.yml:35` memberi service `migrate` **image yang sama** dengan api dan worker, dengan komentar di `:32-33` — *"Reuses the backend image so it isn't built/pulled twice."* Itu prinsip "satu image, banyak peran" yang muncul lagi, kali ini sebagai penghematan bandwidth deploy.

**Anchor:** `docker-compose.prod.yml:1-13` (header + cara pakai persis), `:19` (`${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}`), `:35` + `:40` (referensi image dengan dua default), `:43` (`ports: !reset []`), `:46-47` (dua secret fail-hard), `:87` (`DOMAIN:?`). Pembanding: `docker-compose.loadtest.yml:17` (`!reset []` dengan alasan berbeda). Pendamping: `.env.prod.example:1-25` (semua variabel yang dituntut, beserta cara membuatnya).

**Kenapa dipakai di sini:** Karena satu topologi harus melayani empat kebutuhan (dev, prod, load test, node isolation) tanpa duplikasi. Duplikasi file compose penuh berarti perubahan healthcheck harus disalin empat kali, dan drift-nya pasti terjadi. Pola yang identik muncul lagi di Fase 11 sebagai Kustomize base + overlays — jadi jam yang kamu habiskan memahami merge di sini terbayar dua kali.

**Alternatif:**
- **File compose terpisah dan lengkap per environment.** Tidak ada sihir merge; apa yang kamu baca adalah apa yang jalan. Harganya: empat salinan blok healthcheck Postgres, dan tiga di antaranya akan tertinggal saat kamu memperbaiki satu.
- **`extends:`** (dikembalikan di Compose v2) — reuse per-**service**, bukan per-file. Lebih granular dan bisa lintas file. Harganya: tidak bisa "tambah service baru khusus environment ini" semudah overlay — di prod kamu menambahkan `admin` dan `caddy` yang tidak ada di base sama sekali, dan itu wilayah overlay, bukan `extends`.
- **Langsung Kustomize/Helm, lewati Compose.** Konsisten dengan production sejak hari pertama. Harganya: butuh cluster hidup untuk iterasi, dan siklus "ubah satu baris → lihat hasilnya" naik dari 5 detik jadi menit. Repo memilih Compose untuk laptop dan Kustomize untuk cluster, lalu **sengaja membuat keduanya bercermin** supaya transfer belajarnya langsung.

**Latihan:** Tidak perlu daemon untuk yang ini.
```bash
cp .env.prod.example .env.prodtest
set -a && . ./.env.prodtest && set +a
docker compose -f docker-compose.yml -f docker-compose.prod.yml config | less
```
Verifikasi: cari service `api` di YAML hasil merge dan buktikan dua hal — blok `ports` **hilang** (efek `!reset []`), dan `image:` **muncul** dengan tag yang di-resolve. Lalu:
```bash
unset DOMAIN
docker compose -f docker-compose.yml -f docker-compose.prod.yml config
```
Verifikasi: baca pesan gagalnya — ia harus berisi kalimat yang ditulis di `docker-compose.prod.yml:87`, bukan pesan generik. Itulah gunanya `${VAR:?pesan}` dibanding `${VAR}` polos.

---

### 10.9 Caddy sebagai edge: HTTPS otomatis, dan single-origin yang membuat CORS LENYAP

Ini konsep yang paling akan terasa personal buatmu. Sebagai frontend dev kamu sudah menghabiskan waktu melawan CORS: preflight yang gagal, `Access-Control-Allow-Credentials` yang lupa, `*` yang tidak boleh dipakai bersama credential. Di setup production Drovery, **tidak ada satu pun header CORS**. Dan itu bukan karena CORS di-disable — CORS tidak pernah terpicu, karena browser hanya melihat **satu origin**.

Mekanismenya seluruhnya ada di 21 baris `deploy/Caddyfile`:
```
{$DOMAIN} {
  @ws { header Connection *Upgrade*; header Upgrade websocket }
  handle @ws     { reverse_proxy api:3000  }
  handle /api/*  { reverse_proxy api:3000  }
  handle         { reverse_proxy admin:80  }
}
```
`https://drovery.example.com/api/v1/deliveries` dan `https://drovery.example.com/dashboard` adalah origin yang **sama** bagi browser. Yang membedakan tujuan mereka adalah Caddy, dan browser tidak pernah tahu. `DEPLOY.md:16-18` menyatakannya: *"Caddy serves one origin: WebSocket upgrades (tracking + support) and `/api/*` go to the API; everything else is the admin SPA. So there's no CORS and the admin image isn't tied to a domain."*

Kalimat terakhir itu adalah bonus kedua yang mudah terlewat: karena admin memanggil `/api/v1/...` relatif, image admin **tidak perlu di-build ulang per domain**. Tidak ada `VITE_API_URL` yang di-bake ke bundle. Satu image admin, dipakai di staging dan production dan `drovery.local`-mu.

Tiga detail teknis yang harus kamu perhatikan:

**Matcher `@ws` mencocokkan HEADER, bukan path** (`deploy/Caddyfile:11-14`). Alasannya ditulis di `:10`: *"Any WebSocket handshake, whatever its path, goes to the API gateways."* WS tracking mobile menempel di root `/`, sementara support chat di `/ws/support` — kalau matcher-nya berbasis path, salah satu akan nyasar ke SPA admin dan handshake-nya gagal dengan cara yang membingungkan (HTTP 200 dengan HTML, bukan 101).

**`handle` bersifat mutually-exclusive dan berurutan.** Blok pertama yang cocok menang, sisanya tidak dievaluasi. Karena itu urutan `@ws` → `/api/*` → catch-all bukan gaya penulisan, melainkan logika. Menukar `handle /api/*` dengan `handle {}` membuat semua request — termasuk `/api/v1/health` — mendarat di admin.

**`caddy_data` wajib persisten** (`docker-compose.prod.yml:90` + `:93-94`). Caddy mengurus sertifikat Let's Encrypt otomatis dan menyimpan kunci + sertifikatnya di `/data`. Kalau volume itu bukan named volume, setiap `docker compose down` membuang sertifikat, dan restart berikutnya meminta sertifikat baru. Let's Encrypt punya rate limit ACME (per domain, per minggu), dan kamu akan menabraknya lalu terkunci tanpa HTTPS selama berjam-jam.

**Anchor:** `deploy/Caddyfile:1-6` (komentar routing — tiga baris yang merangkum seluruh keputusan), `:10-17` (komentar + matcher `@ws` + handler-nya), `:19-22` (`handle /api/*`), `:24-27` (catch-all ke admin). Pasangannya di Compose: `docker-compose.prod.yml:76-91` (service caddy, satu-satunya yang memegang port publik 80/443 di `:83-85`) dan `:93-95` (volume `caddy_data` / `caddy_config`). Sumber "kenapa": `DEPLOY.md:16-18`, dan `.env.prod.example:17-19` (kapan `CORS_ORIGINS` justru **perlu** diisi).

**Kenapa dipakai di sini:** Karena Drovery punya tiga jenis klien di satu domain — SPA admin (statis), REST API, dan **WebSocket** yang harus bisa upgrade. Reverse proxy yang tidak meneruskan header upgrade dengan benar akan membuat fitur live tracking (yang kamu bangun di Fase 8) mati diam-diam. Caddy juga dipilih karena auto-TLS bawaan: di VPS satu kotak, satu komponen yang tidak perlu cron renew adalah satu insiden yang tidak akan terjadi.

**Alternatif:**
- **nginx + certbot** — paling umum, dokumentasinya paling banyak, kontrol paling detail. Harganya konkret: TLS otomatis butuh cron/timer untuk `certbot renew` **plus** reload nginx setelahnya, dan kalau reload-nya lupa dipasang, sertifikat diperbarui di disk tapi nginx tetap menyajikan yang lama sampai restart berikutnya — kegagalan senyap yang muncul 90 hari kemudian. (Catatan: repo tetap memakai nginx untuk LB load test di `loadtest/nginx.conf`, karena di sana yang dibutuhkan cuma round-robin dan tidak ada TLS.)
- **Traefik** — auto-TLS juga, plus service discovery dari label Docker sehingga tidak perlu file konfigurasi terpisah. Harganya untuk fase ini: konfigurasi tersebar sebagai label di `docker-compose.yml`, jadi kamu tidak bisa membaca "seluruh aturan routing" dalam satu file 28 baris. Untuk belajar, file eksplisit menang.
- **Cloudflare Tunnel / managed LB** — TLS, DDoS, dan WAF di edge tanpa membuka port 80/443 sama sekali. Harganya: dependensi eksternal yang harus hidup untuk sistemmu bisa diakses, dan kamu tidak belajar apa pun tentang reverse proxy — padahal itu keterampilan yang dipakai lagi di Fase 11 (Ingress).
- **Node melayani TLS sendiri** (`https.createServer` dengan sertifikat). Satu proses lebih sedikit. Harganya: Node bukan terminator TLS yang efisien, kamu harus menulis sendiri logika renewal, dan kamu kehilangan routing SPA/API — jadi CORS kembali.

**Latihan (tanpa domain publik):**
```bash
echo "127.0.0.1 drovery.local" | sudo tee -a /etc/hosts
cp .env .env.dev.bak            # WAJIB — repo ini sudah punya .env dev; jangan menimpanya begitu saja
cp .env.prod.example .env
# isi .env: DOMAIN=drovery.local, lalu POSTGRES_PASSWORD/JWT_SECRET/JWT_REFRESH_SECRET dari openssl rand
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
curl -k https://drovery.local/api/v1/health
curl -k -sD - -o /dev/null https://drovery.local/api/v1/health | grep -i "access-control" ; echo "exit=$?"
```
Verifikasi: request pertama menjawab `{"status":"ok"}`. Request kedua tidak menemukan satu pun header `Access-Control-*` — itu bukan bug, itu inti pelajarannya. (Caddy akan memakai sertifikat internal yang self-signed untuk `.local`; `-k` yang menerimanya.)

Lalu rusak dengan sengaja: tukar urutan `handle /api/*` (`:19-22`) dan `handle {}` (`:24-27`) di `deploy/Caddyfile`, jalankan `docker compose -f docker-compose.yml -f docker-compose.prod.yml restart caddy`, dan ulangi `curl`. Verifikasi: kamu mendapat HTML SPA, bukan JSON. Itu `handle` yang mutually-exclusive. Kembalikan urutannya.

---

### 10.10 CI di GitHub Actions: service container, gerbang drift, dan lint yang sengaja non-blocking

Untuk kamu yang selama ini merilis app lewat build lokal, CI adalah "checklist yang dijalankan robot pada setiap PR". `.github/workflows/ci.yml` menjalankan lima gerbang, dan yang menarik bukan bahwa ia ada — melainkan **keputusan-keputusan** yang tertulis di dalamnya.

**Service container dengan health option.** `ci.yml:21-37` menyalakan Postgres 16 dan Redis 7 nyata di samping job, masing-masing dengan `--health-cmd` (`:29-31`, `:35-37`). Itu adalah `depends_on: condition: service_healthy` (10.6) versi GitHub Actions — konsep yang sama, sintaks berbeda. Alasan memakai database asli ditulis di `ci.yml:14-16`: *"with real Postgres + Redis so the migrations are validated against a live database."* Bukan mock.

**Gerbang drift adalah yang paling menarik.** `ci.yml:68-69` menjalankan `npm run prisma:drift-check`, yaitu `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` (`package.json:31`). Komentar di `ci.yml:63-67` menjelaskan bahwa ini gerbang **durabilitas partisi**: tabel `notifications` ter-partisi RANGE, dan satu-satunya perbedaan yang diizinkan dari model view Prisma adalah perubahan composite PK yang di-diff **bersih**. Diff yang tidak kosong berarti ada perubahan schema yang mencoba meng-*un-partition* tabel, atau `db push`/`db pull` yang mengacak schema. Ini contoh CI yang menjaga **invariant arsitektur**, bukan sekadar "tes hijau". Perhatikan urutannya: drift check jalan **setelah** `migrate deploy` (`:60-61`), supaya yang dibandingkan adalah database hidup vs `schema.prisma`.

**Lint sengaja non-blocking.** `ci.yml:71-73` menjalankan eslint dengan `continue-on-error: true`, dan nama step-nya sendiri adalah dokumentasinya: *"Lint (non-blocking until the no-unsafe-any cleanup lands)"*. Ini trade-off yang **didokumentasikan, bukan disembunyikan**. Bandingkan dengan menghapus lint dari CI sama sekali: informasinya hilang. Bandingkan dengan membuatnya blocking hari ini: seluruh PR merah karena utang lama, dan orang akan belajar mengabaikan warna merah.

**`concurrency` + `cancel-in-progress: true`** (`ci.yml:9-11`) membatalkan run lama saat kamu push beruntun ke ref yang sama. Ingat baik-baik nilai `true` ini — di 10.11 kamu akan melihat workflow yang sengaja memilih `false`, dan alasannya penting.

**Ada satu step yang tidak akan kamu duga ada di CI.** `ci.yml:78-81` menjalankan dua script model kapasitas (`loadtest/capacity-model-1m.mjs`, `capacity-model-multiregion.mjs`) dan membuang output-nya ke `/dev/null`. Nama step-nya menjelaskan tujuannya: *"Capacity models smoke (keep the 1M+ projections from rotting)"*. Ia tidak menguji sistem; ia menguji bahwa **dokumen proyeksi skala masih bisa dijalankan**. Angka di `SCALING-1M.md` berasal dari script itu, dan script yang tidak pernah dijalankan lagi akan diam-diam berhenti bekerja saat dependensinya berubah — lalu angka di dokumen jadi klaim yang tidak bisa direproduksi siapa pun. Ini contoh CI yang menjaga **dokumentasi**, dan pola yang layak kamu tiru.

**Job `docker` terpisah** (`ci.yml:90-105`) dengan `needs: test` (`:92`) membangun image sebagai **validasi saja** (`push: false` di `:102`). Publikasi dilakukan workflow lain. Perhatikan `cache-from`/`cache-to: type=gha` (`:104-105`) — itulah tempat pelajaran 10.1 membayar dirinya di setiap PR.

Perhatikan juga apa yang **tidak** ada: tidak ada job yang menjalankan `docker compose up`. CI menguji kode terhadap Postgres/Redis nyata, dan menguji `Dockerfile` bisa dibangun — tapi tidak pernah menguji topologi Compose secara utuh. Itu lubang yang diketahui, dan tempat menutupnya adalah workflow `manifests.yml` untuk sisi Kubernetes (Fase 11) — bukan di sini.

**Anchor:** `.github/workflows/ci.yml:9-11` (concurrency), `:14-16` (kenapa DB asli), `:21-37` (service container + health options), `:57-61` (generate → migrate deploy), `:63-69` (komentar durabilitas partisi + drift check), `:71-73` (lint non-blocking), `:78-81` (smoke capacity model), `:90-105` (job docker + cache GHA). Pendamping: `package.json:31` (perintah drift-check persisnya).

**Kenapa dipakai di sini:** Karena repo ini punya satu invariant yang tidak bisa dijaga oleh unit test — bahwa tabel yang ter-partisi tetap ter-partisi. Test aplikasi akan lulus dengan tabel biasa. Hanya diff schema-vs-database yang bisa menangkapnya, dan hanya kalau ia jalan terhadap database yang benar-benar sudah dimigrasikan.

**Alternatif:**
- **GitLab CI / CircleCI / Jenkins** — konsep identik (job, cache, service container), sintaks berbeda. GitHub Actions dipilih karena repo-nya di GitHub dan runner-nya gratis untuk repo publik. Harganya: `type=gha` untuk cache Docker adalah fitur khusus Actions; memindahkannya ke GitLab berarti menulis ulang strategi cache dengan registry cache.
- **Menjalankan `docker compose up` di CI alih-alih service container.** Lebih dekat ke lokal, satu definisi topologi untuk semua tempat. Harganya: lebih lambat (build image dulu), dan health-gating harus kamu tulis manual dengan loop `until docker compose ps | grep healthy` — persis yang di-handle `--health-cmd` secara deklaratif.
- **SQLite atau mock untuk database test** — jauh lebih cepat, tidak butuh service container. Harganya fatal di repo ini: SQLite tidak punya partisi, tidak punya advisory lock, tidak punya `information_schema` yang sama. Gerbang drift check — alasan utama CI ini ada — jadi mustahil.

**Latihan:** Buktikan gerbangnya bekerja dengan membuatnya **merah dulu**.
```bash
git checkout -b coba/drift
# ubah satu field di prisma/schema.prisma (mis. tambah kolom opsional) TANPA membuat migration
npm run prisma:drift-check          # jalankan lokal dulu — lihat exit code non-nol
git commit -am "coba drift" && git push -u origin coba/drift
```
Verifikasi: buka PR-nya dan pastikan step *"Prisma drift check (schema ⇔ DB must match)"* **gagal**, sementara step di atasnya hijau. Lalu buat migration yang benar (`npx prisma migrate dev`), push lagi, dan pastikan hijau. Kalau kamu tidak pernah melihat gerbangnya merah, kamu tidak tahu ia terpasang.

---

### 10.11 CD: tiga strategi tag, deploy manual by design, dan rollback = pin TAG lama

Sekarang analogi Play Store terbayar penuh. `.github/workflows/publish.yml:32-39` memakai `docker/metadata-action` untuk menghasilkan **tiga jenis tag sekaligus** dari satu build:

| Tag | Sifat | Padanan Play Store | Kapan dipakai |
|---|---|---|---|
| `:latest` (`type=raw`) | **mutable** — bergerak tiap push | internal track yang selalu build terbaru | staging box, iterasi cepat |
| `:sha-<short>` (`type=sha,format=short`) | **immutable**, telusur ke commit | build spesifik yang kamu bagikan ke tester | debugging "versi mana yang jalan?" |
| `:vX.Y.Z` (`type=ref,event=tag`) | **immutable**, sengaja dirilis manusia | production release dengan versionCode | prod sungguhan |

`DEPLOY.md:141-143` menuliskan aturan pakainya: *"`:latest` is convenient but mutable (it moves on every push) — fine for a staging box. For real prod, pin a release (`TAG=v1.0.0`, or a `:sha-<short>`) so a deploy is reproducible and rollback is exact."*

Dan itulah definisi rollback di sistem ini: **set `TAG` ke versi sebelumnya dan jalankan ulang flow pull** (`DEPLOY.md:113`). Tidak ada `git revert`, tidak ada rebuild. Itu bekerja **karena** data ada di named volume yang tidak ikut dibuang (10.5) — dua konsep yang terlihat tidak berhubungan ternyata satu paket.

**Deploy manual by design.** `.github/workflows/deploy.yml:11-17` hanya punya trigger `workflow_dispatch` dengan input `tag`. Komentarnya di `:3-5` menjelaskan: *"MANUAL by default (click 'Run workflow' after a release) so a human gates each prod deploy"*, dan menyebutkan persis apa yang harus kamu pikirkan kalau mau mengotomatiskannya — `DEPLOY.md:134-137` menambahkan catatan timing: workflow deploy harus jalan **setelah** kedua publish workflow (backend + admin) selesai, kalau tidak kamu menarik tag yang belum ada.

**`concurrency: deploy-vps` dengan `cancel-in-progress: false`** (`deploy.yml:19-21`). Bandingkan dengan CI yang memilih `true` (`ci.yml:11`). Bedanya bukan gaya: membatalkan run CI yang usang itu hemat dan aman; membatalkan **deploy di tengah jalan** meninggalkan VPS dengan sebagian container sudah di-restart dan sebagian belum. Group name-nya juga bukan per-ref melainkan konstanta `deploy-vps` — hanya satu deploy boleh menyentuh kotak itu pada satu waktu, dari branch mana pun.

**Deploy-nya sendiri sengaja membosankan.** Isi `deploy.yml:33-41` seluruhnya adalah:
```bash
set -e
cd "$VPS_PATH"
export DOCKER_REGISTRY=senaahmad2998
export TAG="<input tag>"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$COMPOSE pull
$COMPOSE up -d
$COMPOSE ps
```
Tujuh baris. Tidak ada logika kondisional, tidak ada template, tidak ada langkah yang hanya ada di CI. Itu **persis** perintah yang kamu jalankan manual di 10.8 — yang berarti kalau deploy gagal, kamu bisa SSH sendiri dan menjalankan baris yang sama untuk melihat error yang sama. Pipeline yang melakukan hal berbeda dari yang bisa kamu lakukan dengan tangan adalah pipeline yang tidak bisa kamu debug.

Detail secret yang layak diperhatikan: publish butuh **satu** secret (`DOCKERHUB_TOKEN`), karena username bukan rahasia dan di-hardcode (`publish.yml:7-8`, `:29`). Deploy butuh **empat** (`DEPLOY.md:121-128`): `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PATH`. Semakin sedikit secret, semakin sedikit yang bisa bocor — dan menandai yang tidak rahasia sebagai tidak rahasia adalah bagian dari higiene itu.

**Anchor:** `.github/workflows/publish.yml:3-8` (komentar: apa yang di-push, dan satu secret saja), `:9-13` (trigger: branch, tag `v*`, dispatch), `:32-39` (`metadata-action` + tiga strategi tag), `:41-47` (build-push dengan cache GHA). `.github/workflows/deploy.yml:3-5` (manual by design), `:11-17` (`workflow_dispatch` + input `tag`), `:19-21` (concurrency tanpa cancel), `:27-41` (ssh-action yang menjalankan `pull && up -d && ps`). Sumber "kenapa": `DEPLOY.md:130-137`, `:141-143`, `:113-114`.

**Kenapa dipakai di sini:** Karena sistem ini punya **dua** image dari **dua** repo (`drovery-backend` dan `drovery-admin`) yang harus versinya sejalan. Satu variabel `TAG` di `.env` VPS mengendalikan keduanya sekaligus (`docker-compose.prod.yml:35`, `:40`, `:57`, `:69`) — jadi "deploy" dan "rollback" adalah operasi yang atomik secara konseptual, bukan tarian dua repo.

**Alternatif:**
- **GitOps (ArgoCD / Flux)** — cluster menarik manifest dari git, jadi keadaan yang diinginkan selalu bisa dibaca dari repo dan drift diperbaiki sendiri. Harganya: butuh Kubernetes. Repo sudah menyiapkan kaitnya (`k8s/base/migrate-job.yaml` punya anotasi `argocd.argoproj.io/hook: PreSync`), jadi ini jalur upgrade yang wajar setelah Fase 11 — bukan sebelum.
- **`docker context` atau `ssh` langsung dari runner, tanpa `appleboy/ssh-action`** — satu dependensi pihak ketiga lebih sedikit di jalur yang memegang kunci SSH production. Harganya: kamu menulis sendiri penanganan `known_hosts`, propagasi exit code, dan timeout — tiga hal yang kalau salah membuat deploy "hijau" padahal gagal.
- **PaaS (Fly.io / Render / Railway)** — `git push` dan selesai; TLS, rollback, dan health check disediakan. Harganya untuk kurikulum ini fatal: kamu tidak belajar edge proxy, tidak belajar pooler, dan tidak pernah melihat `pg_stat_activity`. Untuk produk nyata dengan tim kecil, ini sering jawaban yang benar — tapi tahu **apa** yang kamu serahkan adalah gunanya fase ini.
- **GHCR (`ghcr.io`) alih-alih Docker Hub** — autentikasi otomatis lewat `GITHUB_TOKEN`, jadi nol secret manual, dan tidak ada rate limit pull anonim. Repo memilih Docker Hub karena konsumennya ada di dua repo berbeda dan namespace-nya lebih mudah dibagikan. (Menariknya, overlay prod k8s justru memakai GHCR: `k8s/overlays/prod/kustomization.yaml:8`.)

**Latihan (tidak perlu VPS):** Jalankan `docker/metadata-action` di kepalamu untuk tiga kejadian, lalu verifikasi.
1. push ke `main`
2. push tag `v1.2.0`
3. `workflow_dispatch` dari tab Actions

Tulis daftar tag yang **kamu duga** dihasilkan masing-masing berdasarkan `publish.yml:36-39`. Verifikasi: jalankan workflow-nya dari tab Actions (opsi 3 tidak butuh apa-apa) dan baca output step `meta` di log — bandingkan dengan dugaanmu. Yang paling sering salah ditebak adalah kejadian 2: `type=raw,value=latest` **tetap** berlaku, jadi `v1.2.0` juga memindahkan `:latest`.

Lanjutan yang aman dijalankan lokal — simulasikan rollback tanpa server:
```bash
TAG=v0.1.0 docker compose -f docker-compose.yml -f docker-compose.prod.yml config | grep "image:.*drovery"
TAG=latest docker compose -f docker-compose.yml -f docker-compose.prod.yml config | grep "image:.*drovery"
```
Verifikasi: satu variabel mengubah keempat referensi image sekaligus. Itulah bentuk mekanis dari "rollback = pin TAG lama".

---

### 10.12 Runbook backup: "backup yang belum pernah di-restore adalah harapan, bukan backup"

Kalimat itu bukan slogan yang saya karang; ia ada di `scripts/backup.sh:6-7` dan diulang di `DEPLOY.md:158-159`. Dan konteksnya penting: sebelum script ini ada, seluruh cerita backup repo ini adalah satu baris `pg_dump > backup.sql` — tanpa kompresi, tanpa retensi, tanpa verifikasi, dan yang paling penting **tanpa prosedur restore**, sehingga jalur pemulihannya belum pernah sekali pun dijalankan.

Tidak ada padanan yang jujur di dunia frontend untuk ini. Yang paling dekat: kamu tidak pernah percaya sebuah release build sampai kamu memasangnya di device sungguhan. Sama persis — kecuali di sini, hari kamu "memasangnya" adalah hari terburuk dalam karirmu, dan kamu tidak boleh menemukan masalahnya saat itu.

Empat keputusan di script ini layak dibedah satu per satu:

**Verifikasi otomatis, langsung setelah dump.** `scripts/backup.sh:43-47` menjalankan `pg_restore --list "$OUT" >/dev/null`. Perintah itu mem-parse *table of contents* arsip, jadi file yang terpotong atau korup gagal **sekarang**, bukan jam 3 pagi. Kalau gagal, file-nya dihapus dan exit non-nol. Bandingkan dengan mengecek ukuran file: dump yang terpotong di tengah tetap besar.

**Guard "nol tabel = gagal".** `backup.sh:49-58` menghitung entri `TABLE DATA` dan menolak arsip yang punya kurang dari satu. Komentarnya menjelaskan skenarionya: *"A dump that verifies but contains no tables means we pointed at an empty or wrong database."* Arsip kosong itu **valid** secara format; hanya guard ini yang membedakannya dari sukses.

**Retensi dijalankan PALING AKHIR, dan hanya setelah sukses.** `backup.sh:60-65`. Komentarnya adalah pelajaran operasional yang tidak diajarkan di mana pun: *"Retention runs LAST and only after a verified success, so a run of failures can never age out the last good backup."* Bayangkan urutan terbalik: script gagal 15 hari berturut-turut, tapi retensi tetap jalan tiap hari — pada hari ke-15 backup baik terakhirmu terhapus oleh script backup-mu sendiri.

**Guard destruktif dicek SEBELUM file dibaca.** `scripts/restore.sh:34-41` menolak restore ke database sungguhan kecuali `CONFIRM=i-understand-this-overwrites`, dan pengecekan itu berada **di atas** verifikasi arsip (`:43-47`). Komentarnya: *"A refusal should be immediate and unambiguous, and should not depend on anything else having succeeded."*

Mode default `restore.sh` adalah **rehearsal**: ia membuat database scratch, me-restore ke sana, lalu memverifikasi hasilnya benar-benar berguna — jumlah tabel, `users` dan `deliveries` bisa di-query, dan **partisi anak `deliveries` masih ada** (`restore.sh:81-98`). Yang dicetak adalah **elapsed time**, dan itu RTO-mu yang sebenarnya. Bukan estimasi, bukan SLA di dokumen: angka dari mesinmu.

Dan bagian yang paling mendidik dari seluruh runbook ini adalah judul `DEPLOY.md:208-217` — **"What is still missing"**: tidak ada point-in-time recovery, backup default tersimpan di disk yang sama dengan database, dan tidak ada alert untuk backup basi. Mendaftarkan kekurangan yang **diketahui** adalah bentuk kejujuran teknis yang jarang; tirulah.

**Anchor:** `scripts/backup.sh:6-7` (tesisnya), `:30-32` (kenapa `-Fc` dan `--no-owner`), `:43-47` (verifikasi `pg_restore --list`), `:49-58` (guard nol tabel), `:60-65` (retensi paling akhir). `scripts/restore.sh:15-19` (peringatan partisi: **jangan** `prisma migrate deploy` ke database hasil restore), `:34-41` (guard `CONFIRM` paling awal), `:81-98` (verifikasi rehearsal + RTO). Sumber "kenapa": `DEPLOY.md:154-217`, khususnya `:186-189` (apa yang diverifikasi rehearsal) dan `:208-217` (yang masih kurang).

**Kenapa dipakai di sini:** Karena `deliveries` dan tabel anaknya **ter-partisi RANGE**, dan DDL anaknya dimiliki oleh routine `partition_*`, bukan Prisma (`prisma/PARTITIONING.md`). Itu membuat restore di sistem ini punya jebakan spesifik yang tidak ada di aplikasi biasa: dump custom-format membawa parent + children + attachment, jadi `pg_restore` mereproduksi semuanya — tapi kalau kamu "membantu" dengan menjalankan `prisma migrate deploy` sesudahnya, kamu akan merusak yang baru saja kamu pulihkan. `restore.sh:15-19` menuliskan peringatan itu di header script, bukan di wiki yang tidak akan dibaca.

**Alternatif:**
- **Snapshot managed (RDS automated backup / Cloud SQL)** — PITR bawaan, retensi otomatis, nol script untuk dioperasikan. Harganya: vendor lock-in, dan — ini yang sering dilupakan — kamu **tetap** harus menguji restore-nya secara berkala. Snapshot yang tidak pernah di-restore adalah harapan yang lebih mahal.
- **`pg_basebackup` + WAL archiving** — memberi PITR sungguhan, yaitu tepat kekurangan yang diakui di `DEPLOY.md:210-212`. Harganya: butuh storage WAL yang terus tumbuh, `archive_command` yang harus andal (kegagalannya membuat WAL menumpuk sampai disk penuh), dan prosedur pemulihan yang jauh lebih panjang dari satu perintah `pg_restore`.
- **`pg_dump --format=plain`** — file SQL yang bisa dibaca mata dan di-grep. Harganya: tidak terkompresi (berkali lipat lebih besar), dan tidak bisa restore selektif per tabel. `backup.sh:30-32` memilih `-Fc` justru untuk kedua alasan itu, plus `--no-owner --no-privileges` supaya restore ke role dengan nama berbeda tetap jalan — *"which is exactly the situation you are in during an incident."*

**Latihan (tiga langkah, jalankan semuanya):**

Kedua script butuh `pg_dump` / `pg_restore` / `psql` versi 16 **dan bash** (`set -Eeuo pipefail`, `[[ ]]`). Kalau host-mu belum punya klien Postgres 16, jalankan lewat container `postgres:16` (Debian, punya bash — image `postgres:16-alpine` di stack tidak punya):

```bash
mkdir -p /tmp/bk
NET=$(docker network ls --format '{{.Name}}' | grep default | grep -i drovery)   # cari nama network Compose
RUN="docker run --rm --network $NET -v $PWD/scripts:/scripts:ro -v /tmp/bk:/tmp/bk \
     -e DATABASE_URL=postgres://postgres:postgres@postgres:5432/drovery postgres:16 bash"

# 1. ambil backup terverifikasi
$RUN -c 'BACKUP_DIR=/tmp/bk /scripts/backup.sh'

# 2. rehearsal — catat baris "elapsed"
$RUN -c '/scripts/restore.sh /tmp/bk/drovery-*.dump'

# 3. rusak arsipnya, dan buktikan verifikasi menolaknya
cp /tmp/bk/drovery-*.dump /tmp/bk/rusak.dump && truncate -s 1000 /tmp/bk/rusak.dump
$RUN -c '/scripts/restore.sh /tmp/bk/rusak.dump'; echo "exit=$?"
```
(Kalau host-mu **sudah** punya klien Postgres 16, buang seluruh pembungkus `$RUN` dan pakai `DATABASE_URL=postgres://postgres:postgres@localhost:5432/drovery ./scripts/backup.sh` langsung.)

Verifikasi:
- Langkah 1 mencetak `backup.sh: ok — <bytes> bytes, <N> tables with data` dengan **N > 0**.
- Langkah 2 mencetak `delivery partitions:` dengan angka **> 0** (nol berarti partisi tidak selamat — persis yang diperingatkan `restore.sh:15-19`) dan sebuah angka `elapsed`. **Catat angka itu; itu RTO-mu.**
- Langkah 3 harus exit **non-nol** dengan pesan *"is not a readable archive"*. Kalau langkah 3 sukses, verifikasimu tidak bekerja dan seluruh runbook ini teater.

---

### 10.13 Peta alternatif: sembilan persimpangan, dan kenapa repo ini belok ke sini

Konsep terakhir bukan teknologi baru — ia keterampilan. Kamu meminta "alasan pemilihan teknologi dan alternatifnya", dan cara terbaik memverifikasi bahwa kamu benar-benar memahaminya adalah menuliskannya sendiri, dengan trade-off yang bisa ditindaklanjuti. Ini juga latihan membaca repo: setiap keputusan di bawah punya jejak tertulis di file, dan kemampuan menemukan jejak itu lebih tahan lama daripada hafal jawabannya.

Sembilan persimpangan yang dilewati fase ini:

| # | Persimpangan | Pilihan repo | Harga yang diterima | Jejaknya di repo |
|---|---|---|---|---|
| 1 | Docker vs pm2/systemd di server | Docker | image lebih besar, satu lapisan lagi untuk dipelajari | `Dockerfile:5-6` |
| 2 | Dockerfile vs buildpacks | Dockerfile tulis tangan | harus mengurus sendiri user, healthcheck, prisma generate | `Dockerfile:26-34` |
| 3 | slim vs alpine vs distroless | `node:22-slim` | ratusan MB lebih besar dari alpine | `Dockerfile:5-6`, `:60-61` (butuh `wget`) |
| 4 | `depends_on.condition` vs `wait-for-it.sh` | condition | tidak portabel ke k8s (yang mengabaikannya) | `docker-compose.yml:110-118` |
| 5 | `pool_mode` transaction vs session vs statement | transaction | state sesi hilang → migrasi harus bypass pooler | `docker-compose.yml:42`, `:82-83` |
| 6 | PgBouncer vs Pgpool-II vs RDS Proxy/Supavisor | PgBouncer | tidak ada load-balance read replica bawaan (ditangani aplikasi) | `ARCHITECTURE.md:90`, `:92` |
| 7 | Caddy vs nginx+certbot vs Traefik vs Cloudflare Tunnel | Caddy | ekosistem/dokumentasi lebih kecil dari nginx | `DEPLOY.md:16-18` |
| 8 | Docker Hub vs GHCR | Docker Hub (backend/admin), GHCR (overlay k8s) | satu secret manual + rate limit pull anonim | `publish.yml:7-8`, `k8s/overlays/prod/kustomization.yaml:8` |
| 9 | Deploy SSH manual vs GitOps vs PaaS | SSH, di-gate manusia | tidak self-healing, tidak auditable seperti GitOps | `deploy.yml:3-5`, `DEPLOY.md:134-137` |

**Anchor:** `DEPLOY.md:139-149` (bagian "Notes" — lima keputusan operasional beserta alasannya dalam satu layar), `ARCHITECTURE.md:89-92` (daftar "Fix (in order)" yang menempatkan PgBouncer sebagai langkah pertama dan read replica sebagai langkah yang sudah selesai), `k8s/README.md:45-49` ("What's intentionally NOT here" — daftar hal yang **sengaja** tidak ada, dengan alasannya).

**Kenapa dipakai di sini:** Karena repo ini secara konsisten menuliskan *harga* dari setiap pilihan, bukan hanya pilihannya. `Dockerfile:30-33` mengakui image jadi lebih besar demi seed. `ci.yml:71` mengakui lint belum blocking. `DEPLOY.md:208-217` mendaftar apa yang masih kurang dari backup. Pola itu — "keputusan + harga + apa yang belum" — adalah bentuk dokumen yang membuat repo ini bisa dibaca setahun kemudian, dan itu keterampilan yang bisa kamu bawa ke mana pun.

**Alternatif (cara mencatat keputusan, bukan cara memilih teknologi):**
- **ADR terpisah** (`docs/adr/0001-pilih-pgbouncer.md`, format Michael Nygard) — satu file per keputusan, punya status (proposed/accepted/superseded), mudah di-review sebagai unit. Harganya: keputusannya hidup **jauh** dari kode yang menjalankannya, jadi orang yang mengedit `docker-compose.yml` tidak akan melihatnya. Repo ini memilih komentar in-file justru karena itu.
- **Tidak dicatat sama sekali, andalkan git blame + PR description** — nol pemeliharaan. Harganya: `git blame` memberitahu *siapa* dan *kapan*, hampir tidak pernah *kenapa*; dan PR description hilang begitu repo dipindah atau di-mirror.
- **Wiki / Notion terpisah** — bisa panjang, bisa punya gambar, bisa dibaca non-engineer. Harganya paling mahal dan paling pasti: ia basi. Komentar yang salah di file yang kamu edit akan terlihat; halaman wiki yang salah tidak akan.

**Latihan:** Tulis satu halaman (maksimal satu layar) berjudul "Sembilan persimpangan Drovery, dan yang akan saya pilih beda". Untuk **tiga** baris dari tabel di atas, tuliskan: (a) pilihan repo, (b) satu skenario konkret di mana pilihan itu salah, (c) apa yang akan kamu pilih di skenario itu dan **berapa** harganya. Verifikasi: setiap poin (b) harus menyebut angka atau kondisi yang bisa diamati — "kalau tim punya 3 environment dan tidak ada satu pun yang pakai Kubernetes", bukan "kalau kebutuhannya berbeda". Kalau kamu tidak bisa menulis angka, kamu belum memahami trade-off-nya; kembali ke konsepnya.

---

## Capstone

Satu stack berbentuk production hidup di laptopmu, plus tiga bukti yang **bisa gagal di depan mata**. Kriteria penerimaan:

**A. Stack production di satu kotak**

- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` dengan `DOMAIN=drovery.local` di `.env` berjalan sampai semua service `healthy` dan `migrate` menunjukkan `Exited (0)`.
- [ ] `curl -k https://drovery.local/api/v1/health` menjawab `{"status":"ok"}`. HTTPS jalan (sertifikat internal Caddy diterima dengan `-k`).
- [ ] `curl -k https://drovery.local/` mengembalikan HTML SPA admin, **bukan** JSON API.
- [ ] Sebuah WebSocket handshake ke `wss://drovery.local/` mendapat HTTP `101`, bukan `200` dengan HTML. (Uji dengan `websocat -k wss://drovery.local/` atau dari DevTools browser.)
- [ ] Respons dari `/api/*` **tidak** mengandung satu pun header `Access-Control-*`. Buktikan dengan `curl -k -sD - -o /dev/null https://drovery.local/api/v1/health | grep -ci access-control` → hasilnya `0`.
- [ ] Kamu bisa menunjukkan di `docker compose -f ... config` bahwa service `api` **tidak** punya `ports` — dan menjelaskan dalam satu kalimat kenapa.

**B. Bukti 1 — pooler benar-benar melakukan multiplexing (dan migrasi benar-benar butuh bypass)**

- [ ] Tabel dua kolom tercatat: hasil `select count(*), application_name from pg_stat_activity group by 2` pada `--scale api=3` dan pada `--scale api=6`. Jumlah koneksi ke Postgres **tidak** menggandakan.
- [ ] `docker compose exec pgbouncer psql -h 127.0.0.1 -p 5432 -U postgres pgbouncer -c "SHOW POOLS;"` (atau `SHOW STATS;`) menunjukkan jumlah klien jauh melebihi jumlah koneksi server. Kalau perintah `SHOW` tidak tersedia di image ini, `pg_stat_activity` sudah cukup — catat alasannya.
- [ ] Service `migrate` diarahkan ke `@pgbouncer:5432`, dijalankan, dan **error advisory lock-nya disalin utuh** ke catatan. Lalu dikembalikan ke `@postgres:5432` dan dibuktikan sukses lagi.

**C. Bukti 2 — CI yang gerbangnya terbukti bekerja**

- [ ] Satu PR terbuka dengan seluruh job hijau, termasuk step *"Prisma drift check (schema ⇔ DB must match)"*.
- [ ] Screenshot atau link ke run **sebelumnya** yang **merah tepat di step drift check** karena schema diubah tanpa migration. Gerbang yang belum pernah merah adalah gerbang yang belum terbukti terpasang.
- [ ] Kamu bisa menjelaskan kenapa step lint yang berwarna kuning/merah **tidak** menggagalkan build, dan menunjuk baris yang menyebabkannya.

**D. Bukti 3 — backup yang sudah pernah di-restore**

- [ ] Satu file `.dump` diambil dengan `scripts/backup.sh` dan output-nya mencantumkan jumlah tabel > 0.
- [ ] Salinan arsip itu dirusak (`truncate -s 1000`) dan `scripts/restore.sh` **menolaknya** dengan exit non-nol. Pesan penolakannya tercatat.
- [ ] Rehearsal dijalankan sampai `rehearsal PASSED`, dengan `delivery partitions` > 0, dan **angka `elapsed` tercatat sebagai RTO** di catatanmu.

**E. Artefak tulis**

- [ ] Satu halaman "Sembilan persimpangan" dari latihan 10.13.
- [ ] Satu entri bergaya `AUDIT-LOG.md`: apa yang kamu ubah selama fase ini, cacat apa yang tertutup, harga apa yang kamu terima, dan bagian **`### Left undone`** yang jujur. (Kandidat kuat untuk `Left undone`: tidak ada PITR, backup masih di disk yang sama, `.env` production belum di secret manager.)

Kalau satu pun butir di B, C, atau D tidak pernah kamu lihat **gagal** dulu, capstone-nya belum selesai. Bukti bahwa sebuah gerbang bekerja adalah pernah melihatnya menolak sesuatu.

---

## Gerbang keluar

Kalau kamu belum bisa menjawab ini tanpa membuka kode, **jangan** lanjut ke Fase 11 — seluruh Kubernetes di sana dibangun di atas jawaban-jawaban ini.

**1. Kenapa `COPY package*.json ./` + `npm ci` harus berada di atas `COPY . .`, dan apa persisnya yang terjadi kalau dibalik?**

<details><summary>Jawaban</summary>

Cache layer Docker bersifat linear: satu layer invalid membuat semua layer sesudahnya invalid. Kalau `COPY . .` di atas, mengubah satu baris di `src/` meng-invalidate layer itu, dan karena itu `npm ci` di bawahnya ikut dibangun ulang — seluruh `node_modules` dari nol, setiap kali. Dengan urutan repo (`Dockerfile:16-19` lalu `:23`), `npm ci` hanya dibangun ulang saat `package.json`/`package-lock.json` benar-benar berubah. Efeknya juga terasa di CI karena cache layer diekspor lewat `cache-to: type=gha` (`ci.yml:104-105`).
</details>

**2. Kenapa image ini `node:22-slim` dan bukan `node:22-alpine`, dan kapan kegagalan pilihan yang salah muncul?**

<details><summary>Jawaban</summary>

Prisma mengirim query engine sebagai **binary** yang di-compile per target libc/openssl. Alpine memakai musl, Debian-slim memakai glibc. Komentar `Dockerfile:5-6` menyebutnya *"avoids the musl/openssl binary-target friction Prisma hits on Alpine"*. Kegagalannya muncul **saat runtime**, bukan saat build — image-nya sukses dibangun dan di-push; yang gagal adalah query pertama. Karena itu juga `openssl` dipasang di **kedua** tahap (`Dockerfile:11-14`, `:39-41`).
</details>

**3. Apa persisnya yang dicegah `.dockerignore:7-8`, dan siapa konsumen risikonya?**

<details><summary>Jawaban</summary>

Baris `.env` dan `.env.*` mencegah file environment ter-bake ke dalam layer image. Konsumen risikonya adalah `publish.yml:35`, yang mendorong image ke `senaahmad2998/drovery-backend` di Docker Hub — image publik. Layer tidak bisa "dihapus" setelahnya; siapa pun yang `docker pull` bisa mengekstraknya. Baris `:9` (`!.env.example`) mengecualikan satu file yang memang aman ikut. Perhatikan ini **berbeda** dari `.gitignore`: yang satu melindungi repo, yang satu melindungi artefak.
</details>

**4. Apa beda tugas `condition: service_healthy` dan `condition: service_completed_successfully`, dan yang mana dipakai untuk `migrate`?**

<details><summary>Jawaban</summary>

`service_healthy` menunggu healthcheck service lulus — dipakai untuk dependensi yang **terus hidup** (postgres, pgbouncer, redis, mosquitto), dan healthcheck-nya perintah protokol asli (`pg_isready`, `redis-cli ping`, `mosquitto_pub`), bukan cek port. `service_completed_successfully` menunggu container **selesai dengan exit 0** — dipakai untuk `migrate` (`docker-compose.yml:117-118`), yang menjalankan `migrate deploy && db seed` lalu keluar (`restart: 'no'` di `:92`). Tanpa gerbang kedua, api bisa boot ke database yang tabelnya belum ada.
</details>

**5. Dengan `DEFAULT_POOL_SIZE: 20`, berapa koneksi yang dilihat Postgres saat `--scale api=10`? Dan kenapa `migrate` tidak boleh lewat pgbouncer?**

<details><summary>Jawaban</summary>

Tetap terikat 20 (per pasangan user/database), bukan 100. Itu seluruh gunanya pooler: aplikasi melihat `MAX_CLIENT_CONN: 1000`, Postgres melihat 20 — karena satu koneksi Postgres adalah satu proses OS seharga ~5-10 MB. `migrate` harus bypass karena `POOL_MODE: transaction` mengembalikan koneksi server ke pool di akhir **setiap transaksi**, sehingga state ber-scope sesi hilang — termasuk **advisory lock** yang dipakai Prisma untuk menyerialkan migrasi. Ditulis di `docker-compose.yml:82-83` dan diulang di `k8s/base/migrate-job.yaml:31-32`; di k8s bahkan jadi key Secret terpisah `DATABASE_URL_DIRECT`.
</details>

**6. Kenapa `ports: !reset []` diperlukan di overlay prod, dan kenapa alasannya BERBEDA dari `!reset []` di overlay loadtest?**

<details><summary>Jawaban</summary>

Merge Compose secara default **menggabungkan** list, jadi `ports` dari base tidak bisa dihapus dengan menimpanya — butuh `!reset`. Di prod (`docker-compose.prod.yml:43`) alasannya: Caddy yang memegang satu-satunya port publik, jadi api tidak boleh terekspos ke host. Di loadtest (`docker-compose.loadtest.yml:17`) alasannya berbeda total: satu host port tidak bisa dibagi tiga replika, jadi `--scale api=3` akan gagal dengan "port is already allocated". Idiom sama, dua masalah yang tidak berhubungan.
</details>

**7. Di mana persisnya CORS "hilang" pada setup prod, dan apa harga dari pilihan itu?**

<details><summary>Jawaban</summary>

Di `deploy/Caddyfile:19-27`: `/api/*` dan catch-all SPA disajikan dari **domain yang sama**, jadi browser melihat satu origin dan tidak pernah memicu CORS. Bukan di-disable — tidak pernah terpicu. Bonusnya (`DEPLOY.md:16-18`): image admin tidak terikat domain, jadi tidak ada `VITE_API_URL` yang di-bake. Harganya: kamu sekarang punya satu komponen tambahan (Caddy) yang wajib hidup, urutan `handle` jadi logika yang bisa salah, dan volume `caddy_data` (`docker-compose.prod.yml:90`) wajib persisten atau kamu akan menabrak rate limit ACME. Kalau admin dilayani dari host lain, `CORS_ORIGINS` (`:49`) harus diisi kembali.
</details>

**8. Kenapa retensi backup dijalankan paling akhir, dan kenapa `pg_restore --list` yang jadi verifikasi, bukan cek ukuran file?**

<details><summary>Jawaban</summary>

Retensi terakhir + hanya setelah verifikasi sukses (`backup.sh:60-62`) supaya deretan kegagalan tidak menghapus backup baik terakhir — kalau retensi jalan duluan, script yang gagal 15 hari berturut-turut akan memusnahkan satu-satunya arsip yang berguna. `pg_restore --list` mem-parse *table of contents* arsip, jadi ia menangkap file yang terpotong atau korup (`backup.sh:43-47`); ukuran file tidak — dump yang terputus di tengah tetap besar. Ditambah guard "0 tabel = gagal" (`:49-58`), karena arsip dari database kosong itu valid secara format tapi tidak berguna.
</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| `docker compose up` berhenti; `migrate` exit 1 dengan pesan soal seed command / ts-node | Tahap runtime tidak punya `prisma.config.ts` + `tsconfig.json`. Prisma 7 membaca perintah seed dari `prisma.config.ts` (bukan `package.json`), dan perintahnya `ts-node prisma/seed.ts`. Ini bug nyata yang tercatat di `Dockerfile:49-52`. | `docker run --rm --entrypoint sh drovery-backend:lat1 -c 'ls /app'` — kedua file harus ada. Kalau kamu memangkas `Dockerfile:53-54`, gejala ini yang muncul. |
| Service `api` tidak pernah start, `docker compose ps` menunjukkannya "created" selamanya | Salah satu dependensi tidak pernah jadi `healthy`, atau `migrate` exit non-nol. `depends_on` berkondisi tidak akan menyerah — ia menunggu. | `docker compose ps` (lihat kolom status tiap service), lalu `docker inspect --format '{{json .State.Health}}' <container>` untuk membaca output healthcheck terakhir. `docker compose logs migrate` untuk yang one-shot. |
| Error engine Prisma saat runtime, padahal build sukses | (a) base image musl/alpine (10.2), atau (b) `node_modules` host ikut ter-copy dan menimpa hasil `npm ci` karena `.dockerignore:1` hilang (10.3). Gejala keduanya mirip. | `docker run --rm <img> node -e "require('@prisma/client')"`. Lalu cek: `docker build .` — baca angka `transferring context`; kalau ratusan MB, `node_modules` ikut. |
| `prisma migrate deploy` menggantung atau gagal dengan pesan soal lock | `DATABASE_URL` service `migrate` mengarah ke `pgbouncer`. Advisory lock ber-scope sesi pecah di `POOL_MODE: transaction`. | Periksa `docker-compose.yml:88` — harus `@postgres:5432`, bukan `@pgbouncer:5432`. Ini disengaja dan ditulis di `:82-83`; jangan "rapikan". |
| `https://<domain>/api/v1/health` mengembalikan HTML SPA | Urutan blok `handle` di `deploy/Caddyfile` tertukar. `handle` bersifat mutually-exclusive — blok pertama yang cocok menang, dan catch-all `handle {}` cocok dengan segalanya. | `docker compose ... exec caddy caddy fmt /etc/caddy/Caddyfile` lalu baca urutannya. `handle /api/*` (`:20`) harus **di atas** `handle {}` (`:25`). |
| Sertifikat diminta ulang tiap restart; akhirnya kena error rate limit dari Let's Encrypt | Volume `caddy_data` bukan named volume, atau ikut terhapus oleh `docker compose down -v`. Kunci + sertifikat ACME hidup di `/data`. | `docker volume ls \| grep caddy` — `caddy_data` harus ada dan bertahan lintas `down`/`up`. Lihat `docker-compose.prod.yml:90` dan `:93-94`. Saat bereksperimen, pakai domain `.local` (sertifikat internal) supaya tidak menyentuh ACME publik. |
| `docker compose ... config` gagal dengan "set POSTGRES_PASSWORD in .env" | Itu bukan bug — itu `${VAR:?pesan}` yang bekerja (`docker-compose.prod.yml:19`). Compose tidak membaca `.env` untuk interpolasi kalau kamu menjalankannya dari direktori lain. | Jalankan dari root repo (Compose auto-load `.env` di direktori kerja), atau `set -a && . ./.env && set +a` dulu. Pesan yang muncul harus persis kalimat di file — kalau generik, variabelnya beda. |
| `--scale api=3` gagal: "port is already allocated" | Base mengikat `3000:3000` (`docker-compose.yml:119-120`) dan satu host port tidak bisa dibagi tiga replika. | Ini persis alasan `!reset []` ada di overlay (`docker-compose.loadtest.yml:17`, `docker-compose.prod.yml:43`). Untuk scaling, layer salah satu overlay itu — jangan hapus `ports` dari base. |
| CI merah di step "Prisma drift check" padahal test lolos | Schema diubah tanpa membuat migration, atau seseorang menjalankan `prisma db push`/`db pull` yang mengacak schema — termasuk mencoba meng-*un-partition* tabel. Ini gerbang yang memang dirancang menangkap itu (`ci.yml:63-67`). | Jalankan `npm run prisma:drift-check` lokal untuk pesan yang sama tanpa menunggu CI. Perbaiki dengan `npx prisma migrate dev`, bukan dengan menghapus step-nya. |
| Deploy "hijau" di Actions tapi VPS masih menjalankan versi lama | `TAG` di `.env` VPS tidak berubah, atau `pull` menarik `:latest` yang belum diperbarui karena workflow publish belum selesai saat deploy dijalankan. | SSH ke VPS: `docker compose -f docker-compose.yml -f docker-compose.prod.yml config \| grep image:` untuk melihat tag yang benar-benar dipakai, lalu `docker image inspect --format '{{.Created}}'`. Catatan timing ini ditulis di `DEPLOY.md:134-137`. |
| Semua data hilang setelah kamu "membersihkan" | `docker compose down -v`. Satu huruf. `-v` menghapus named volume, dan seed jalan lagi dari nol. | `docker volume ls` sebelum dan sesudah. Biasakan mengetik `down` tanpa `-v` sebagai default, dan `down -v` hanya sebagai keputusan sadar (10.5). Di production, inilah kenapa runbook backup di 10.12 ada. |
| `docker compose up` di `docker-compose.prod.yml` mencoba mem-*build* `admin` dan gagal | Overlay prod punya `build: { context: ../drovery-admin }` (`docker-compose.prod.yml:70-71`). Kalau kamu tidak meng-clone repo admin sebagai **sibling**, build-nya tidak menemukan konteks. | `ls ../drovery-admin`. Jalur `--build` menuntut sibling itu ada (`DEPLOY.md:52-58`); jalur `pull` tidak (set `DOCKER_REGISTRY` dan `TAG`, lalu `pull` + `up -d` tanpa `--build`). |
| Healthcheck api `unhealthy` padahal `curl localhost:3000/api/v1/health` dari host sukses | Healthcheck jalan **di dalam** container (`Dockerfile:60-61`, menembak `localhost:3000` milik container itu sendiri). Kalau `PORT` di-override ke nilai lain lewat env, healthcheck masih menembak 3000. | `docker compose exec api printenv PORT` dan bandingkan dengan port di `Dockerfile:61`. Di `docker-compose.yml:98` nilainya memang 3000 — kalau kamu mengubahnya di overlay, healthcheck harus ikut diubah di level Compose. |

---

## Bacaan pendamping

Semua di `Drovery_Backend`. Baca dengan pertanyaan di tangan, bukan dari atas ke bawah.

- **`DEPLOY.md`** — runbook deploy lengkap. Cari: bagian **"Notes"** (`:139-149`) untuk lima keputusan operasional beserta harganya dalam satu layar, dan **"What is still missing"** (`:208-217`) sebagai contoh cara menulis kekurangan yang diketahui tanpa mengaburkannya.
- **`Dockerfile`** (komentar, bukan instruksinya) — cari tiga blok komentar: `:3-7` (kenapa glibc), `:26-34` (kenapa devDependencies tidak di-prune, dan apa jalan keluarnya), `:49-52` (bug seed yang benar-benar terjadi).
- **`docker-compose.yml:1-14`** — header dengan diagram topologi ASCII. Cari: bentuk sistem yang akan kamu lihat lagi di `k8s/` sebagai Deployment dan Service.
- **`docker-compose.prod.yml:1-13`** — cari: perintah persis untuk kedua jalur deploy (build di VPS vs pull image), dan daftar variabel `.env` yang wajib.
- **`.env.prod.example`** — cari: apa saja yang wajib diisi, cara membuatnya (`openssl rand -hex 24/32`), dan **kapan** `CORS_ORIGINS` justru perlu diisi (`:17-19`).
- **`scripts/backup.sh` + `scripts/restore.sh`** (header keduanya) — cari: kalimat *"A backup you have never restored is a hope, not a backup"* (`backup.sh:6-7`) dan peringatan partisi di `restore.sh:15-19` yang bisa merusak restore-mu kalau diabaikan.
- **`SCALING-1M.md` §5 "Queue / Redis / cache / connections"** (`:230-248`) — cari: urutan memecah Redis per-concern berdasarkan blast radius, dan angka ceiling PgBouncer (`≈ 94 api nodes`) beserta cara menghitungnya.
- **`ARCHITECTURE.md:89-92`** — cari: daftar "Fix (in order)" yang menempatkan PgBouncer sebagai langkah **pertama**, dan penjelasan `readWithFallback()` sebagai alasan repo tidak butuh pooler yang bisa load-balance.
- **`k8s/README.md:1-5` dan `:45-49`** — jembatan ke Fase 11. Cari: kalimat *"mirroring the docker-compose.yml topology"*, dan daftar hal yang **sengaja tidak ada** di manifest k8s (Postgres/PgBouncer/Redis diasumsikan managed).
- **`prisma/PARTITIONING.md`** — cari: kenapa `prisma db push` dilarang, supaya peringatan di `restore.sh:15-19` terbaca sebagai konsekuensi, bukan aturan sewenang-wenang.

Tiga tautan eksternal yang benar-benar perlu (sisanya jangan — jawabannya ada di repo):

- [PgBouncer — pool modes](https://www.pgbouncer.org/features.html) — tabel resmi fitur mana yang rusak di mode `transaction` vs `statement`. Ini satu-satunya rujukan yang lebih lengkap dari komentar repo untuk konsep 10.7.
- [Docker — Dockerfile best practices: build cache](https://docs.docker.com/build/cache/) — model formal cache invalidation yang mendasari 10.1.
- [Caddy — reverse_proxy directive](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) — untuk memahami matcher dan urutan `handle` di luar tiga kasus yang dipakai `deploy/Caddyfile`.

---

**Setelah fase ini:** Fase 11 (Skala & Kubernetes) menerjemahkan `docker-compose.yml` yang baru saja kamu kuasai menjadi Deployment, Service, Ingress, dan Job — dengan tiga jenis probe menggantikan satu `HEALTHCHECK`, `resources.requests` yang menghidupkan HPA, dan `Job` migrate yang memakai `DATABASE_URL_DIRECT` dengan alasan yang **sudah** kamu pahami. Bawa serta: catatan `pg_stat_activity`-mu, pesan error advisory lock, dan angka RTO. Ketiganya akan dipakai lagi.

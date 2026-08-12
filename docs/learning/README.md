# Kurikulum Drovery — dari Frontend ke Full-Stack

Jalur belajar 14 fase yang dibangun **dari ketiga repo Drovery yang sebenarnya**, bukan dari tutorial umum.
Setiap konsep berlabuh pada file nyata, setiap "kenapa" diambil dari komentar dan dokumen keputusan yang
sudah ada di repo ini, dan setiap fase berakhir pada sesuatu yang bisa gagal di depan matamu.

Disusun 12 Agustus 2026. Baseline repo: tag git `curriculum-baseline`.

---

## Untuk siapa ini ditulis

Frontend developer dengan skill **Ionic React + Capacitor**, mayoritas Android, yang ingin melebar ke
backend dan infrastruktur. Diasumsikan kamu sudah nyaman dengan React, hooks, TypeScript dasar, git, dan
konsumsi REST dari sisi klien. Diasumsikan kamu **belum** pernah menyentuh dependency injection, ORM,
desain schema SQL, message queue, WebSocket dari sisi server, container, atau Kubernetes.

Budget yang diasumsikan: **12–15 jam/minggu**.

---

## Satu hal yang perlu diluruskan di depan

Kalau kamu ke sini mencari Next.js: **Next.js tidak dipakai di repo Drovery mana pun.** Stack sebenarnya:

| Repo | Stack | Ukuran |
|---|---|---|
| `Drovery_Backend` | NestJS 11 · Prisma 7 · PostgreSQL 16 · Redis/BullMQ · MQTT · Docker · Kubernetes · OpenTelemetry | 346 file TS, ~41.700 baris, 38 migrasi, ~30 tabel |
| `Drovery_Mobile` | **Expo SDK 54** (React Native 0.81 + expo-router) — bukan React Native CLI | 34 route, 13 feature module |
| `Drovery_Admin` | **Vite 7 + React 19 + MUI 7 + Redux Toolkit + React Router 7** — bukan Next.js | 8 halaman, ~20 file test |

Next.js tetap diajarkan — di **Fase 13**, sebagai modul tersendiri, dengan cara memindahkan satu halaman
admin yang sudah kamu kuasai penuh ke App Router. Itu urutan yang disengaja: kamu baru bisa menilai apa
yang Next.js *berikan* kalau kamu sudah tahu persis apa yang ia *gantikan*.

---

## Bentuk kurikulumnya, dan kenapa begitu

Tulang punggungnya **spiral / vertical slice**: kamu punya sesuatu yang jalan sejak minggu pertama, lalu
irisan yang sama dilewati ulang dengan makin dalam. Tapi tiga mode dipakai bergantian:

- **Fase 1–2 — bangun dari nol.** Di sandbox `learn-nest/` buatanmu sendiri, bukan di Drovery. Setiap
  baris kamu ketik sendiri. Tujuannya supaya `app.module.ts` asli nanti terbaca sebagai daftar keputusan,
  bukan sebagai mantra.
- **Fase 3–11 — bedah repo asli.** Kamu masuk ke Drovery dan membongkarnya area demi area. Repo ini punya
  dokumentasi rationale yang tidak biasa tebalnya; itu aset utama kurikulum ini.
- **Fase 12–13 — kirim yang nyata.** Satu fitur menembus ketiga repo dengan proses repo-nya sendiri, lalu
  satu port ke Next.js.

Dua topik sengaja diajarkan **tuntas dalam blok penuh**, bukan spiral: PostgreSQL dan Kubernetes. Keduanya
buruk kalau dipelajari sepotong-sepotong — setengah paham indexing atau setengah paham probe menghasilkan
kepercayaan diri yang salah.

---

## Tangga 14 fase

| # | Fase | Minggu | Mode | Fokus |
|---|---|---:|---|---|
| **0** | [Nyalakan sistemnya](fase/00-nyalakan-sistemnya.md) | 0,6 | bedah | Ketiga repo hidup di laptopmu; jalur cadangan disiapkan |
| **1** | [Irisan pertama: endpoint saya, tabel saya, layar saya](fase/01-irisan-pertama.md) | 1,5 | dari nol | Module, DI, decorator, controller, Prisma, migration pertama |
| **2** | [Pipeline & identitas](fase/02-pipeline-dan-identitas.md) | 2 | dari nol | Guard, interceptor, filter, i18n, JWT, refresh rotation |
| **3** | [Data layer sebagai kontrak](fase/03-data-layer.md) | 2,5 | bedah | Schema, constraint, index, migration, transaksi |
| **4** | [Dari WebView ke native: React Native & Expo](fase/04-react-native-expo.md) | 2,5 | bedah + bangun | Apa yang transfer dari Ionic, apa yang tidak |
| **5** | [**Konkurensi & uang**](fase/05-konkurensi-dan-uang.md) | 3,5 | bedah | CAS, idempotency, outbox, saga, webhook Stripe |
| **6** | [Satu graph, banyak proses](fase/06-worker-dan-job-durabel.md) | 2 | bedah | PROCESS_ROLE, BullMQ, watchdog, partitioning |
| **7** | [Domain penerbangan](fase/07-domain-penerbangan.md) | 2 | bedah | State machine, gerbang berlapis, klaim pesawat fisik |
| **8** | [Realtime dari sisi server](fase/08-realtime-sisi-server.md) | 2,5 | bedah | WS gateway, Redis pub/sub, backpressure, drain |
| **9** | [Observability](fase/09-observability.md) | 2 | bedah | Prometheus, alert, Grafana, OpenTelemetry, pino |
| **10** | [Docker sampai produksi](fase/10-docker-sampai-produksi.md) | 2,5 | tuntas | Image, Compose, PgBouncer, Caddy, CI/CD, backup |
| **11** | [Bukti skala & Kubernetes](fase/11-skala-dan-kubernetes.md) | 2,5 | tuntas | k6, Deployment, probe, Kustomize, HPA/KEDA/PDB |
| **12** | [Fitur nyata end-to-end](fase/12-fitur-end-to-end.md) | 2,5 | fitur nyata | Backend → Admin console (Redux/MUI) → Mobile |
| **13** | [Next.js App Router](fase/13-nextjs-app-router.md) | 1,5 | fitur nyata | RSC, Server Actions, middleware — dan apa yang hilang |

**Total ±30 minggu di 12 jam/minggu. ±24 minggu (5,5 bulan) di 15 jam/minggu.**

Angka itu tidak saya kecilkan supaya terlihat muat. Kalau kamu butuh lebih pendek, tiga blok berikut sudah
diverifikasi **bukan prasyarat fase mana pun** dan aman dipotong: MQTT `$share` + mode pub/sub sharded
(Fase 8), blok k6/`cpuset`/capacity-model (Fase 11), dan recurring delivery + timezone (Fase 7). Memotong
ketiganya membawa total ke ±24 minggu di 12 jam/minggu.

---

## Fase 5 adalah porosnya

Kalau ada satu fase yang menentukan apakah kurikulum ini berhasil, itu Fase 5.

Di React, `setState` selalu menang. Di sini, `updateMany({where: {id, status: {in: ALLOWED}}})` mengembalikan
`count`, dan `count === 0` berarti **aktor lain menang duluan**. Perubahan status bukan penugasan — ia
balapan antar-proses yang wasitnya PostgreSQL. Empat aktor independen berebut memajukan satu delivery:
worker simulasi BullMQ, telemetri drone sungguhan, watchdog reaper, dan HTTP dari admin/pelanggan.

Tiga bug kebocoran armada yang nyata dan terdokumentasi di `src/deliveries/deliveries.service.ts` — jalur
sukses yang tidak melepas apa pun, abort yang melepas pesawat yang masih terbang, kegagalan tanpa-kesalahan
yang mengembalikan pesawat yang masih di udara — ketiganya lahir dari melewatkan pertanyaan kedua:
*"kalau transisi ini menang atau kalah, apa yang terjadi pada pesawat fisiknya?"*

Fase 5 dijatah 3,5 minggu, lebih panjang dari perkiraan awal. **Kalau harus molor, molorlah di sini.**
Fase 6–8 akan berubah jadi menyalin pola tanpa paham kalau Fase 5 tidak mendarat.

---

## Aturan main

**Jangan lompat fase.** Setiap fase punya *Gerbang masuk* (kemampuan yang harus sudah ada) dan *Gerbang
keluar* (pertanyaan yang harus bisa dijawab tanpa membuka kode). Gerbang keluar bukan formalitas — ia
dipasang tepat di tempat yang, kalau dilewati, akan membuat fase berikutnya terasa seperti sihir.

**Capstone harus benar-benar dikerjakan.** Setiap capstone dirancang supaya bisa *gagal di depan matamu*:
sesuatu berjalan, sesuatu ter-deploy, atau sebuah test mati saat kode sengaja dirusak. Membaca dan mengangguk
tidak menghasilkan apa-apa.

**Mulai Fase 5, tulis entri gaya `AUDIT-LOG.md`** setiap kali menyelesaikan fase: apa yang berubah, cacat apa
yang ditutup, harga yang diterima, dan bagian `Left undone`. Keterampilan paling bernilai dari repo ini justru
kemampuan membedakan mana yang sudah jalan, mana yang baru dirancang, dan mana yang sudah dibantah.

**Baca repo secara skeptis.** Dokumen di sini memakai penanda ✅ (dibangun + diverifikasi), 🟡 (sebagian),
📐 (baru dirancang, belum dibangun). Jangan percaya klaim mentah-mentah — periksa penandanya.

---

## Anchor dan tag baseline

Seluruh kurikulum menunjuk kode dengan format `path/file.ts:123`. Mulai Fase 3 kamu akan **mengubah** repo,
jadi nomor baris akan bergeser. Karena itu ketiga repo sudah ditandai:

```bash
git -C Drovery_Backend show curriculum-baseline:src/deliveries/deliveries.service.ts | sed -n '1490,1510p'
```

Selalu baca anchor terhadap tag itu, bukan terhadap working tree. Menghapusnya kalau sudah tidak perlu:
`git tag -d curriculum-baseline`.

| Repo | Commit baseline |
|---|---|
| Drovery_Backend | `1fa283c` |
| Drovery_Mobile | `d02d4e8` |
| Drovery_Admin | `21c4790` |

(Tag-nya *annotated*, jadi `git rev-parse curriculum-baseline` mengembalikan hash objek tag, bukan
commit. Pakai `git rev-parse curriculum-baseline^{commit}` kalau butuh commit-nya.)

---

## Peta konsep

Folder [`peta/`](peta/) berisi hasil pemetaan mendalam ketiga repo — 143 konsep dengan anchor, rationale,
alternatif, dan latihan untuk masing-masing. Fase-fase di atas adalah *kurasi* dari peta ini; kalau kamu
ingin menggali satu area lebih dalam dari yang dijatah kurikulum, sumbernya ada di sini.

| File | Isi | Konsep |
|---|---|---:|
| [`00-inventaris-konsep.md`](peta/00-inventaris-konsep.md) | Penalaran penyusunan tangga + inventaris gabungan | — |
| [`be-core.md`](peta/be-core.md) | Pipeline request & identitas: module, DI, guard, filter, i18n, JWT | 14 |
| [`be-domain.md`](peta/be-domain.md) | Domain pengiriman: state machine, gerbang, dispatch, watchdog | 15 |
| [`be-data.md`](peta/be-data.md) | PostgreSQL & Prisma: schema, index, transaksi, outbox, partisi | 19 |
| [`be-async.md`](peta/be-async.md) | Di luar siklus request: BullMQ, WebSocket, MQTT, Stripe, metrik | 17 |
| [`be-infra.md`](peta/be-infra.md) | Docker, Compose, PgBouncer, CI/CD, Kubernetes, autoscaling | 24 |
| [`mobile.md`](peta/mobile.md) | Expo/React Native — ditulis sebagai *delta* dari Ionic + Capacitor | 20 |
| [`admin.md`](peta/admin.md) | Vite + React + MUI + Redux Toolkit + React Router | 15 |
| [`docs.md`](peta/docs.md) | Rekaman keputusan: apa yang dipilih, apa yang ditolak, harga yang dibayar | 19 |

---

## Risiko yang diketahui

Kurikulum ini bisa gagal. Ini titik-titik rawannya, ditulis terbuka supaya kamu mengenalinya saat terjadi:

1. **Fase 1 memakai Docker sebelum Docker diajarkan (Fase 10).** Kalau Docker atau WSL2 rewel di minggu
   pertama, justru momentum awal yang mati. → Siapkan `DATABASE_URL` Postgres terkelola (Neon/Supabase)
   sebagai jalur cadangan **di Fase 0**, sebelum dibutuhkan.
2. **Fase 5 adalah tebing.** Kalau di akhir Fase 5 kamu masih menganggap transisi status sebagai penugasan,
   berhenti dan ulangi. Fase 6–8 tidak akan mendarat.
3. **Fase 1–2 tidak menghasilkan satu pun kontribusi ke repo asli.** 3,5 minggu di sandbox bisa terasa
   bukan kerja nyata, dan godaan melompat langsung ke Drovery besar. Gejala melompat baru muncul di Fase 5,
   saat sudah terlambat.
4. **DI dan decorator bisa terasa sihir selama berminggu-minggu** bagi orang yang terbiasa dengan import
   eksplisit. Kalau di akhir Fase 2 kamu masih bertanya "siapa yang memanggil `@Public()`", jangan lanjut.
5. **Refleks Ionic memetakan React Native terlalu optimistis** ("React juga kan?") sampai bertemu tanpa DOM,
   tanpa CSS cascade, dan Expo Go yang gagal senyap pada native module. Fase 4 sengaja dibuat 2,5 minggu
   untuk ini; kalau kamu ingin benar-benar menguasai RN, ia perlu diperluas.
6. **Ops mendalam mengandaikan mesin yang mampu.** kind + KEDA + Prometheus + Grafana + stack Compose penuh
   butuh RAM besar, dan `loadtest/run.sh` butuh Linux + sudo. Di laptop 8 GB, Fase 11 akan runtuh.
7. **Sumber "kenapa" yang sebenarnya berbahasa Inggris teknis yang padat** — komentar kode, `ARCHITECTURE.md`,
   `SCALING-1M.md`, dan `AUDIT-LOG.md` yang 2.297 baris. Kurikulum ini berbahasa Indonesia, tapi ia
   mengandaikan kamu nyaman membaca prosa teknis Inggris panjang.
8. **Titik drop-out paling rawan bukan di awal, tapi minggu 8–16 (Fase 5–8):** paling padat, paling banyak
   infrastruktur yang harus hidup bersamaan, paling sedikit yang bisa dipamerkan. Capstone tiga fase itu
   sengaja dibuat berbentuk demo yang bisa direkam — tunjukkan ke orang lain, itu bagian dari desainnya.
9. **Redux Toolkit diajarkan di Fase 12 lalu sebagian dibuang di Fase 13.** Bisa terasa sia-sia. Framing yang
   benar adalah "memilih rumah untuk tiap jenis state", bukan "belajar Redux".

---

## Mulai dari mana

Buka [Fase 0 — Nyalakan sistemnya](fase/00-nyalakan-sistemnya.md). Target akhir pekan ini: satu delivery yang
kamu buat dari aplikasi mobile, muncul di admin console, dan statusnya berubah sendiri karena worker.

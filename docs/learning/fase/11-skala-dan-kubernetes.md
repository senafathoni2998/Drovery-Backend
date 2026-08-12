# Fase 11 — Bukti skala dan Kubernetes: sinyal autoscaler harus mengukur yang benar-benar habis

> Baris meta: **Durasi** ~2,5 minggu (~33 jam) · **Mode** tuntas · **Repo** `Drovery_Backend` (`loadtest/`, `docker-compose.loadtest.yml`, `docker-compose.nodes.yml`, `k8s/`, `.github/workflows/manifests.yml`, `SCALING-1M.md`)

---

## Kenapa fase ini ada di sini

Fase 10 berhenti tepat di titik yang enak dan berbahaya: kamu punya satu kotak yang jalan. Image
sudah dibangun, Compose sudah melapis, PgBouncer sudah multiplexing, Caddy sudah memegang HTTPS,
CI sudah hijau. Semua sudah **bisa** di-scale. Yang belum kamu punya adalah **bukti** bahwa ia
benar-benar scale. Dan itu bukan detail kosmetik: seluruh argumen PgBouncer di Fase 10 —
"multiplexing 1000 klien ke 20 koneksi supaya tier api/worker bisa autoscale" — adalah janji yang
belum pernah ditagih. Fase 11 menagihnya.

Ada alasan kedua yang lebih tajam. Membuktikan scaling di laptop ternyata **penuh jebakan yang
menghasilkan angka yang terlihat benar dan sebenarnya bohong**. nginx yang me-resolve DNS sekali
saat startup akan membuat `--scale api=3` tampak tidak berpengaruh, dan kesimpulanmu jadi
"arsitekturnya tidak scale" — padahal yang tidak scale cuma load balancer-mu. Rate limiter yang
disimpan di Redis dan dibagi antar replika akan membuat 2 replika terlihat identik dengan 1, dan
kesimpulanmu jadi hal yang sama. `cpuset` yang dipakai menggantikan `cpus` akan membuat menambah
replika justru **menurunkan** throughput. Tiga jebakan itu semua ada di repo ini dengan
komentarnya, dan tidak satu pun bisa kamu temukan sendiri tanpa dituntun. Kalau kamu langsung
lompat ke Kubernetes tanpa melewatinya, kamu akan membawa cluster berisi autoscaler yang bekerja
di atas pengukuran yang salah.

Kenapa tepat setelah Fase 10 dan bukan sebelumnya: Kubernetes di repo ini bukan teknologi baru,
melainkan **cermin dari topologi Compose yang sudah kamu kenal**. `k8s/README.md:3-5` menyatakannya
sendiri — base + overlays yang "mirroring the docker-compose.yml topology", dengan satu image yang
perannya dipilih `command` + `PROCESS_ROLE`. Deployment adalah service Compose plus replika.
Service adalah DNS internal Compose. Ingress adalah Caddy. Kustomize overlay adalah `-f` overlay.
Job `migrate` adalah service `migrate` dengan `restart: 'no'`. Kalau Fase 10 mendarat, Fase 11
hanya menambah **empat** hal yang benar-benar baru: tiga jenis probe (Docker cuma punya satu),
urutan shutdown yang eksplisit, `resources.requests` sebagai basis perhitungan HPA, dan
autoscaler yang bisa memakai sinyal selain CPU.

Yang mustahil dipahami tanpa fase ini: **kenapa satu sistem butuh tiga autoscaler yang berbeda**.
Ini kalimat inti seluruh fase. `docs.md` merumuskannya dengan tepat — pelajarannya bukan "pakai
KEDA", melainkan *"sinyal skala harus mengukur hal yang benar-benar habis di tier itu"*. api
kehabisan CPU (kamu akan melihat sendiri bcrypt cost-12 menabrak dinding di k6). worker kehabisan
**waktu**, bukan CPU — jobnya menunggu di Redis, dan CPU worker bisa nyaris nol sementara antrian
menumpuk sepuluh ribu. realtime kehabisan **file descriptor dan heap** — socket tracking mengirim
sekitar satu frame per lima detik, jadi CPU-nya hampir nol persis saat ia paling penuh. Tiga tier,
tiga sumber daya, tiga sinyal. Kalau kamu memaksakan HPA-CPU ke ketiganya, dua dari tiga akan salah
dengan cara yang tidak menimbulkan error apa pun — hanya kegagalan diam saat trafik puncak.

---

## Gerbang masuk

Kamu siap kalau bisa:

- [ ] Menjelaskan tanpa membuka file kenapa service `migrate` di `docker-compose.yml` konek ke
      `postgres:5432` dan bukan `pgbouncer:5432` — **dan** mereproduksi error yang muncul kalau
      kamu mengarahkannya ke pooler.
- [ ] Menjalankan `docker compose -f docker-compose.yml -f docker-compose.loadtest.yml config`
      dan menunjuk, untuk minimal tiga field, dari file mana nilai finalnya berasal.
- [ ] Menyalakan stack dengan `--scale api=3` dan membuktikan lewat `docker compose ps` bahwa ada
      tiga container api hidup dengan status `healthy`.
- [ ] Menjelaskan mekanisme `PROCESS_ROLE`: satu image, empat peran, dan menunjuk baris di
      `src/common/process-role.ts` yang memutuskan apakah sebuah proses menjalankan processor
      BullMQ atau tidak.
- [ ] Melakukan `curl -s localhost:3000/api/v1/metrics | grep drovery_queue_jobs` dan membaca
      arti label `state="waiting"` vs `state="delayed"` (ini datang dari Fase 6 dan Fase 9 —
      kalau kabur, ulang bagian itu dulu, karena seluruh sinyal KEDA berdiri di atasnya).
- [ ] Memastikan mesinmu memenuhi syarat kerasnya: Linux dengan Docker + akses `sudo`
      (`loadtest/run.sh` butuh keduanya), dan RAM cukup untuk kind + KEDA + Prometheus di atas
      stack Compose. Ini asumsi yang paling sering meleset di fase ini; baca bagian
      "Kalau nyangkut" nomor 9 sekarang, bukan nanti.

---

## Peta jalan mingguan

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| 1 | Membuktikan scaling di satu kotak: nginx LB + jebakan resolver, `LOADTEST_BYPASS_THROTTLE`, k6 (`ramping-vus`, threshold, amortisasi auth), `cpus` vs `cpuset`, sweep, capacity model | 13 | Tabel `sweep.sh` untuk api=1,2,3 dengan kolom per-node req/s; satu run ulang memakai `proxy_pass` literal yang memperlihatkan "scaling" palsu; satu paragraf verdict tier mana yang mengikat |
| 2 | Dari Compose ke cluster: kind + overlay `local`, Deployment/Service/Ingress, tiga probe, urutan shutdown, `resources.requests`, Kustomize base+overlay, Job `migrate` + `kubectl wait` | 13 | Cluster kind hidup dengan tiga tier; `kubectl wait` untuk Job migrate hijau; worker sengaja diberi probe httpGet lalu CrashLoopBackOff direproduksi dan dicabut |
| 3 (setengah) | Tiga sinyal autoscaling (HPA CPU, KEDA queue depth, KEDA socket count), PDB, validasi manifest di CI, dan bab baca: kenapa sharding adalah tuas terakhir | 7 | HPA menaikkan replika api saat ditembak beban; KEDA menaikkan worker mengikuti queue depth (diverifikasi dengan query PromQL yang sama); `kubeconform` + `--dry-run=server` hijau untuk ketiga overlay |

Catatan jujur soal jam: minggu 1 adalah minggu paling melelahkan karena setiap run k6 memakan
2-5 menit dan `sweep.sh` menjalankan tiga run berurutan. Sediakan blok waktu panjang, bukan
potongan 45 menit. Minggu 2 sebaliknya: banyak menunggu image ter-load ke kind, sedikit berpikir.

---

## Konsep

### 11.1 nginx sebagai load balancer, dan jebakan resolver yang membuat `--scale` terlihat sia-sia

Di dunia Ionic, kalau kamu memanggil `https://api.example.com/...` lewat `fetch`, resolusi DNS
diurus sistem operasi dan kamu tidak pernah memikirkannya. Di sini kamu **menjadi** infrastrukturnya,
dan nginx punya satu perilaku yang mengejutkan: kalau host upstream ditulis literal
(`proxy_pass http://api:3000;`), nginx me-resolve nama itu **sekali saat startup** dan menyimpan
IP-nya untuk selamanya. Docker DNS akan dengan senang hati mengembalikan tiga A-record untuk
`api` saat kamu `--scale api=3`, tapi nginx sudah mengunci satu.

Efeknya jahat karena tidak ada error. Semua request sukses. Latensi wajar. Cuma satu container yang
bekerja dan dua menganggur, dan kamu menyimpulkan "menambah replika tidak menambah throughput,
berarti arsitektur ini tidak scale". Kesimpulan salah tentang sistem yang benar, gara-gara satu
baris config di komponen yang bukan bagian dari sistemnya.

Perbaikannya kecil dan tidak intuitif: taruh host di dalam **variabel** nginx. Variabel memaksa
nginx melakukan resolusi per-request lewat resolver yang kamu tunjuk — di Docker itu
`127.0.0.11`, DNS embedded milik daemon. Itu sebabnya `loadtest/nginx.conf` punya dua baris yang
kelihatan bertele-tele padahal load-bearing.

**Anchor:** `loadtest/nginx.conf:1-4` — komentar yang menjelaskan seluruh trik ini
(*"Using a VARIABLE in proxy_pass forces nginx to re-resolve `api` via Docker's embedded DNS
(127.0.0.11) per request … This is what lets `--scale api=N` actually distribute load."*);
`loadtest/nginx.conf:11` — `resolver 127.0.0.11 valid=5s ipv6=off;`, resolver plus TTL 5 detik;
`loadtest/nginx.conf:16-17` — `set $api "api:3000";` lalu `proxy_pass http://$api;`, dua baris
yang bisa saja satu baris kalau bukan karena ini.

**Kenapa dipakai di sini:** LB ini ada semata-mata karena base `docker-compose.yml` mengikat api
ke satu host port, dan satu host port tidak bisa dibagi tiga replika.
`docker-compose.loadtest.yml:8-13` menuliskan alasannya: overlay ini *"fronts the scaled `api`
replicas with an nginx round-robin LB (the base binds api to a host port, which can't be shared
across replicas — `!reset []` clears it so scaling works)"*, dan `docker-compose.loadtest.yml:17`
adalah `ports: !reset []` itu sendiri. Perhatikan juga `access_log off` di `loadtest/nginx.conf:10` dengan
komentarnya: tier api yang memancarkan metrik per-request, LB sengaja dibuat ramping supaya ia
tidak jadi bottleneck yang kamu ukur tanpa sadar.

**Alternatif:**
- **Traefik atau HAProxy sebagai LB.** Keduanya punya service discovery Docker native, jadi tidak
  perlu trik variabel sama sekali — Traefik membaca label container, HAProxy punya `server-template`
  + resolver DNS. Harganya konkret: Traefik butuh konfigurasi via label yang tersebar di
  `docker-compose.yml` (lebih sulit dibaca saat belajar, dan kamu kehilangan satu file config yang
  bisa di-diff), HAProxy butuh blok `resolvers` + `server-template` sendiri yang lebih panjang dari
  empat baris nginx ini untuk kebutuhan yang cuma round-robin.
- **`deploy.replicas` + Swarm routing mesh.** LB built-in di level kernel, tidak perlu container LB
  sama sekali. Harganya: Swarm praktis mati (tidak ada HPA, KEDA, PDB, operator), dan yang lebih
  penting untuk fase ini — routing mesh menyembunyikan mekanismenya, jadi kamu tidak akan pernah
  melihat jebakan resolver yang justru pelajarannya.
- **Service ClusterIP Kubernetes.** Ini yang sebenarnya dipakai di production
  (`k8s/base/api-service.yaml:6-10`): load balancing di level kernel via kube-proxy, tanpa proses LB
  sama sekali. Harganya: butuh cluster untuk iterasi, jadi tidak cocok untuk loop
  "ubah-jalankan-lihat" yang kamu butuhkan minggu ini. Compose + nginx adalah versi laptopnya.

**Latihan:** Nyalakan `sudo bash loadtest/run.sh` sekali supaya stack hidup. Lalu tembak
20 request: `for i in $(seq 1 20); do curl -s localhost:8088/api/v1/health >/dev/null; done`, dan
hitung distribusinya per container dengan
`docker compose -f docker-compose.yml -f docker-compose.loadtest.yml logs api | grep -c "health"`
per container id. Sekarang rusak sengaja: ganti `loadtest/nginx.conf:16-17` jadi
`proxy_pass http://api:3000;` literal, `docker compose ... restart lb`, ulangi hitungannya.
**Verifikasi:** distribusi pertama tersebar mendekati merata; distribusi kedua seluruhnya jatuh ke
satu container. Simpan kedua angka itu — kamu akan memakainya lagi di capstone.

---

### 11.2 `LOADTEST_BYPASS_THROTTLE`: kenapa flag yang melemahkan rate limit justru harus ada, dan kenapa ia tidak bisa melemahkan produksi

Ini jebakan kedua, dan bentuknya persis sama dengan yang pertama: dua replika akan terlihat
identik dengan satu, tanpa error apa pun. Penyebabnya berbeda. Rate limiter global di Drovery
disimpan di **Redis** dan karena itu **dibagi antar semua replika**. Bukan per-proses. Jadi kalau
k6 menembak dari satu IP, limit per-IP itu ditabrak pada agregat — menambah replika tidak menambah
kuota, dan throughput terkunci di angka yang sama berapa pun jumlah node-nya.

Kalau kamu datang dari frontend, ini mungkin momen "oh" pertama fase ini: rate limiter yang benar
memang **harus** berbagi state antar replika (kalau tidak, penyerang cukup mengirim request lebih
banyak untuk mendapatkan kuota lebih besar). Sifat yang membuatnya benar untuk keamanan adalah
sifat yang membuatnya merusak pengukuran scaling. Dua kebutuhan yang bertabrakan, dan repo ini
menyelesaikannya dengan flag yang **hanya bisa hidup di luar produksi**.

Yang perlu kamu perhatikan adalah bentuk pengamanannya: bukan satu guard, tapi dua lapis
independen. Lapis pertama menolak bypass di runtime kalau `NODE_ENV === 'production'`. Lapis kedua
menolak **boot** sama sekali kalau flag itu diset di produksi. Lapis kedua penting karena ia gagal
keras dan terlihat: kamu tidak akan pernah punya produksi yang diam-diam berjalan tanpa rate
limit, kamu akan punya produksi yang menolak start dengan pesan yang jelas.

**Anchor:** `src/common/guards/loadtest-throttle.guard.ts:7-15` — komentar yang menyatakan
masalahnya (*"The throttler is Redis-backed and SHARED across replicas, so a single k6 IP saturates
the per-IP limit in seconds and 2 replicas would show the SAME throughput as 1 — masking horizontal
scaling"*) dan menyatakan kedua lapis pengamanannya;
`src/common/guards/loadtest-throttle.guard.ts:19-27` — implementasi `shouldSkip` yang mensyaratkan
`NODE_ENV !== 'production'`; `src/config/validation.ts:44-49` — guard boot yang melempar
`'LOADTEST_BYPASS_THROTTLE must not be set in production — it disables rate limiting'`;
`src/config/validation.spec.ts:84-99` — dua test yang mengunci kedua sisi perilaku itu.

**Kenapa dipakai di sini:** `docker-compose.loadtest.yml:19-20` menyalakan dua env sekaligus —
`NODE_ENV: staging` **dan** `LOADTEST_BYPASS_THROTTLE: 'true'` — dan urutan itu bukan kebetulan:
tanpa `NODE_ENV` non-produksi, flag-nya tidak berefek apa pun. `loadtest/README.md:17-22`
merumuskan tujuannya dalam satu kalimat: bypass ada *"so the per-IP rate limiter doesn't cap all k6
traffic (one source IP) to the throttle limit and **mask horizontal scaling**"*. Overlay Kubernetes
melakukan hal yang sama dengan cara yang sama: `k8s/overlays/loadtest/kustomization.yaml:10-18`
memerge `NODE_ENV=development` + `LOADTEST_BYPASS_THROTTLE=true` ke dalam ConfigMap, dengan
komentar yang menyebut guard `validation.ts` secara eksplisit.

**Alternatif:**
- **Tembak dari banyak IP sumber.** Ini yang dilakukan load test "sungguhan" — beberapa generator di
  beberapa host, jadi limit per-IP tidak pernah jadi ceiling dan tidak perlu flag apa pun. Harganya
  konkret: kamu butuh minimal 3-5 mesin atau satu cloud load-testing service berbayar, dan repo ini
  memilih batasan sadar "provable di kind/minikube dengan $0". Di satu laptop, opsi ini mustahil.
- **Naikkan limit throttle jadi sangat besar untuk semua environment.** Tidak perlu flag, tidak perlu
  guard. Harganya: kamu mengubah perilaku **produksi** demi kenyamanan pengukuran, dan ketika suatu
  hari kamu lupa menurunkannya lagi, tidak ada yang gagal — sistem hanya kehilangan proteksi diam-diam.
  Bandingkan dengan desain sekarang, di mana produksi menolak boot.
- **Kecualikan endpoint yang dipakai load test dari throttling (`@SkipThrottle` permanen).** Persis
  yang dilakukan `/health` dan `/metrics` (`src/health/health.controller.ts:9-13`,
  `src/metrics/metrics.controller.ts:12-19`). Harganya: journey k6 memakai `/auth/signup` dan
  `/deliveries` — endpoint bisnis nyata yang justru **harus** di-throttle di produksi. Mengecualikan
  mereka permanen adalah lubang keamanan; mengecualikan lewat flag non-produksi bukan.

**Latihan:** Jalankan `sudo SCENARIO=io VUS=100 bash loadtest/run.sh` dan catat `http_reqs .../s`.
Lalu hapus baris `LOADTEST_BYPASS_THROTTLE: 'true'` dari `docker-compose.loadtest.yml:20`, ulangi
run yang persis sama. **Verifikasi:** angka kedua jauh lebih rendah **dan** `http_req_failed` naik
karena munculnya 429. Terakhir, buktikan lapis kedua: set `NODE_ENV: production` di
`docker-compose.loadtest.yml:19` sambil flag tetap menyala, jalankan `docker compose ... up api`,
dan baca pesan gagal boot-nya. Kembalikan ketiga baris setelah selesai.

---

### 11.3 k6: `ramping-vus`, threshold, dan amortisasi auth — p95 yang seluruhnya milik bcrypt

k6 adalah generator beban yang skripnya JavaScript, jadi bagian sintaksnya tidak akan menahanmu.
Yang baru adalah **model eksekusinya**: kamu tidak menulis loop, kamu mendeklarasikan sebuah
*executor* dan k6 yang mengatur berapa VU (virtual user) hidup pada detik ke berapa. `ramping-vus`
menaikkan VU dari 0 ke target selama fase RAMP, menahannya selama HOLD, lalu menurunkannya. Yang
penting untuk dipahami: setiap VU adalah loop independen yang menjalankan fungsi `default` berulang
kali, jadi "50 VU" bukan "50 request" melainkan "50 journey yang berjalan bersamaan terus-menerus".

Bagian yang benar-benar mengajar di fase ini bukan k6-nya, melainkan **apa yang ditemukan** saat
dijalankan. Repo ini punya hasil run nyata yang tercatat, dan hasilnya kontra-intuitif: p95 global
5,66 detik terhadap SLO 1500 ms — kelihatan seperti kegagalan total. Padahal begitu dipecah per
langkah, gambarnya terbalik: signup p95 **7,72 detik**, sementara create 659 ms, get 323 ms, list
248 ms. Satu langkah menelan seluruh anggaran latensi, dan langkah itu adalah bcrypt cost-12 yang
memang **sengaja** dibuat mahal secara CPU.

Di sinilah keputusan yang harus kamu tiru: jawabannya **bukan** menurunkan `BCRYPT_SALT_ROUNDS=12`.
Itu akan memperbaiki angka dan memperburuk sistem — regresi keamanan yang dibeli dengan grafik yang
lebih enak dilihat. Yang dilakukan repo ini adalah memindahkan biaya itu **ke luar loop yang
diukur**: `scenario-io.js` melakukan login untuk sekolam user **sekali saja** di `setup()`, lalu
setiap iterasi memakai ulang JWT. Hasilnya: satu skenario yang mengukur dinding CPU (auth), dan
satu skenario yang mengukur ceiling I/O (create + list + get), tanpa satu baris pun `src/auth`
disentuh.

**Anchor:** `loadtest/scenario.js:23-35` — blok `scenarios.journey` dengan `executor: 'ramping-vus'`
dan tiga stage (`RAMP` → `HOLD` → turun 10s); `loadtest/scenario.js:36-42` — komentar jujur
*"Local single-machine targets … Tighten for cloud"* di atas `thresholds`;
`loadtest/scenario.js:17-21` — empat `Trend` per langkah (`step_signup`, `step_create_delivery`,
`step_list`, `step_get_one`) yang membuat pemecahan di atas mungkin;
`loadtest/scenario-io.js:1-17` — header yang menjelaskan amortisasi auth dan menegaskan
*"src/auth is UNTOUCHED (the bcrypt cost is paid once here, never weakened)"*;
`loadtest/README.md:207-229` — tabel hasil run nyata dan kalimat kesimpulannya
(*"NOT something to 'fix' by weakening the hash cost"* di `:227`).

**Kenapa dipakai di sini:** k6 dijalankan sebagai **container** supaya tidak ada instalasi di host
(`docker-compose.loadtest.yml:38-43`), dan `profiles: ['load']` di `:40` mencegahnya ikut jalan
pada `docker compose up` biasa — sesuatu yang akan sangat mengganggu kalau tidak ada. Dua detail
operasional di `loadtest/run.sh:66-84` layak dibaca pelan-pelan: `--no-deps` ada karena tanpa itu
`compose run` akan **diam-diam me-rescale api/worker kembali ke 1** saat merekonsiliasi dependensi
(bug pengukuran yang mustahil kamu curigai sendiri), dan exit code 99 dari k6 (artinya sebuah
threshold terlanggar) sengaja **ditangkap** dan tidak dibiarkan mematikan script — kalau tidak,
pengukuran drain worker sesudahnya, yang adalah deliverable inti, akan hilang.

**Alternatif:**
- **Apache JMeter.** Ekosistem plugin paling luas dan punya GUI untuk menyusun skenario. Harganya
  konkret: model thread-per-VU di JVM berarti 500 VU ≈ 500 thread, jadi generatornya sendiri jadi
  bottleneck jauh lebih cepat daripada k6 (Go, goroutine); dan skenarionya file XML yang praktis
  tidak bisa di-review di PR — bandingkan dengan `scenario-io.js` yang bisa kamu baca sekarang juga.
- **Artillery.** YAML-first, Node-native, paling cepat untuk mulai dan sudah familier kalau kamu
  datang dari JS. Harganya: engine-nya JS single-thread, jadi pada beban tinggi generatornya
  menyentuh langit-langit sebelum sistemnya — persis kegagalan yang diperingatkan
  `docker-compose.nodes.yml:89-93`.
- **`autocannon` atau `wrk`.** Sangat ringan, sempurna untuk mengukur satu endpoint. Harganya: tidak
  bisa memodelkan journey berbilang langkah dengan token yang berpindah antar-request — dan seluruh
  temuan bcrypt di atas hanya muncul karena journey-nya multi-langkah dan tiap langkah punya Trend
  sendiri.

**Latihan:** Jalankan dua kali: `sudo bash loadtest/run.sh` (skenario `auth`) lalu
`sudo SCENARIO=io VUS=100 bash loadtest/run.sh`. Catat empat angka: p95 global masing-masing,
`step_signup` p95 dari run pertama, dan `step_create_delivery` p95 dari run kedua. **Verifikasi:**
tulis satu paragraf yang menjawab "kenapa run kedua jauh lebih baik padahal kode aplikasinya
identik byte-per-byte?" Kalau jawabanmu menyebut kata "optimasi", ulangi — jawabannya harus
menyebut **di mana** biaya bcrypt dibayar, bukan berapa besarnya.

---

### 11.4 `cpus` (quota) vs `cpuset` (pinning): kesalahan yang membalikkan kesimpulan benchmark

Tanpa batasan apa pun, `--scale api=3` bukan berarti "tiga node". Itu tiga proses yang **berebut**
empat core yang sama. Throughput totalnya mungkin naik sedikit, mungkin tidak, dan yang pasti:
kamu tidak bisa mengatribusikan angka apa pun ke "satu replika". Padahal seluruh capacity model
berdiri di atas satu bilangan bernama "per-node throughput". Jadi sebelum mengukur, replika harus
dijadikan **node berukuran diketahui**.

Docker bisa melakukan itu dengan cgroup, dan di sinilah ada dua tombol yang namanya mirip dan
efeknya berlawanan. `cpus: '0.6'` adalah **quota**: jatah waktu CPU sebesar 60% dari satu core,
yang boleh ditempatkan scheduler di core mana pun. `cpuset: "0,1"` adalah **pinning**: container
hanya boleh jalan di core 0 dan 1, titik. Untuk uji scaling, quota benar dan pinning **salah**,
dan salahnya tidak halus: kalau semua replika di-pin ke daftar core yang sama, menambah replika
hanya menambah **kontensi**, sehingga grafikmu akan menurun dan kamu akan menyimpulkan bahwa
menambah node memperburuk sistem. Kesimpulan yang persis terbalik dari kenyataan.

Pelajaran ketiga di file ini datang dari kegagalan nyata dan bukan dari teori: **CPU dibatasi,
memori tidak**. Alasannya asimetris — cgroup yang kehabisan CPU cuma di-*throttle* (lambat, tapi
hidup), sementara cgroup yang kehabisan memori di-**OOM-kill** (mati). Dan pembatasan heap V8 yang
terlalu rendah pernah membuat worker concurrency-10 crash-loop sampai *"the SIM backlog froze at
exactly the enqueued count with zero drain"* — antrian membeku persis di angka yang di-enqueue,
karena worker-nya tidak pernah benar-benar hidup untuk mempromosikan job delayed. Gejala yang
terlihat seperti bug antrian, penyebabnya batas memori.

**Anchor:** `docker-compose.nodes.yml:9-16` — pernyataan masalah (*"'api=3' was really three threads
CONTENDING for 4 cores, and a single replica's throughput wasn't attributable"*);
`docker-compose.nodes.yml:18-27` — blok padat tentang `cpus` vs `cpuset`, plus peringatan agar tidak
"memperbaiki" `deploy.resources.limits` kembali ke `cpus:`/`mem_limit:` legacy (mitos "deploy hanya
untuk Swarm" berlaku untuk docker-compose v1 Python, bukan Compose v2);
`docker-compose.nodes.yml:38-47` — alasan memori diberi headroom, termasuk kejadian SIM backlog beku;
`docker-compose.nodes.yml:48-56` — limit api per replika (`API_CPUS` default 0.6);
`docker-compose.nodes.yml:89-93` — daftar yang sengaja **tidak** dibatasi, dengan kalimat kuncinya:
*"a CPU-throttled generator silently under-drives the system and you'd measure the generator's
ceiling, not the system's."*

**Kenapa dipakai di sini:** overlay ini harus jadi file **ketiga** dalam rantai `-f`, dan
`loadtest/run.sh:29-34` melakukannya otomatis ketika `NODES=1` — kalau kamu menyusunnya manual dan
salah urutan, limitnya tidak menang. Budgetnya sengaja over-subscribed di kotak 4-core
(`docker-compose.nodes.yml:29-34`: api 3×0.6 + worker 3×0.4 + pg 1.0 + pgb 0.5 + redis 0.5 = 5.0
di atas 4 core), dengan alasan yang ditulis terang: `cpus` adalah **ceiling**, bukan reservasi, jadi
over-subscription tidak apa-apa dan kontensi host-core yang muncul **itulah** ceiling yang dicari
tes ini. `loadtest/README.md:153-157` menutupnya dengan kejujuran yang jarang: apa yang metode ini
**tidak** bisa buktikan adalah skala lintas-mesin sungguhan — satu kernel yang dipartisi cgroup
tidak punya NIC hop, NUMA, atau page cache per host. Yang harus dibaca adalah **bentuk kurvanya**,
bukan angka mentahnya.

**Alternatif:**
- **`cpuset: "0,1"` (pinning).** Benar dan bahkan lebih baik untuk mikro-benchmark yang peduli
  cache-locality dan varians rendah — satu proses, satu core, hasil sangat repeatable. Harganya di
  konteks ini fatal: untuk N replika kamu harus menulis daftar core berbeda per replika secara
  manual, dan `--scale` tidak bisa melakukannya (semua replika mewarisi `cpuset` yang sama). Jadi
  bukan cuma "kurang cocok" — secara mekanis tidak bisa dipakai dengan `--scale`.
- **VM atau mesin fisik terpisah sungguhan.** Satu-satunya cara mengukur NIC hop, NUMA, dan page
  cache per host — yaitu tiga hal yang diakui hilang di `loadtest/README.md:155-157`. Harganya:
  minimal tiga VM cloud kecil selama beberapa jam per sweep, ditambah orkestrasi manual untuk
  menaruh replika di host yang benar. Berbayar, dan lebih lambat untuk loop belajar.
- **`resources.requests`/`limits` Kubernetes.** Hal yang sama, di cluster (lihat 11.9). Harganya:
  butuh cluster yang sudah jalan sebelum kamu bisa mengukur apa pun, sementara overlay Compose ini
  memberi umpan balik dalam hitungan detik. Urutan di fase ini sengaja: ukur di Compose dulu,
  pindahkan angkanya ke k8s belakangan.

**Latihan:** Jalankan `sudo NODES=1 bash loadtest/run.sh`, lalu di terminal lain jalankan
`docker stats --no-stream` saat k6 sedang menembak. **Verifikasi:** kolom `CPU %` untuk tiap
container api harus mentok di sekitar 60%, bukan 100% atau lebih — itu quota 0.6 yang bekerja.
Sekarang ubah `docker-compose.nodes.yml:52` jadi `cpus: '0.3'`, ulangi, dan konfirmasi plafonnya
ikut turun. Terakhir, sebagai latihan membaca: jelaskan dengan satu kalimat kenapa mengubah baris
itu menjadi `cpuset: "0"` akan membuat `--scale api=3` **menurunkan** total throughput.

---

### 11.5 Capacity model: satu angka load test berbohong, dan angka yang belum diukur harus ditandai

Ini konsep yang paling tidak teknis dan paling dewasa di fase ini. Klaim "sistem ini bisa melayani
100 ribu pengguna" tidak bisa dibuktikan oleh satu angka dari satu laptop. Yang bisa dilakukan
adalah: ukur **per-node** throughput di node berukuran diketahui, proyeksikan ke permintaan yang
diasumsikan, lalu keluarkan satu jawaban yang benar-benar bisa dipertanggungjawabkan — **tier mana
yang mengikat lebih dulu**. Bukan "berapa node", karena itu bergantung pada angka yang belum kamu
punya. Tapi "tier mana yang habis duluan" bertahan bahkan ketika konstantanya masih perkiraan.

Yang membuat repo ini layak ditiru adalah kejujuran mekanisnya: ia **menandai angkanya sendiri**
sebagai belum terukur. `SCALING-1M.md:8-13` membuka dengan peringatan bahwa seluruh angka di
dokumen itu ILLUSTRATIVE dan tiap per-node ceiling adalah placeholder konservatif bertanda
`FILL FROM RUN`. Skrip modelnya mencetak peringatan yang sama di output setiap kali dijalankan.
Bandingkan dengan pola yang jauh lebih umum di industri: satu deck berisi angka percaya diri yang
sumbernya sudah tidak ada yang ingat.

Untuk kamu yang datang dari frontend, padanan terdekat yang jujur adalah bundle-size budget:
"berapa KB JS yang boleh dikirim" hanya berguna kalau kamu tahu angka mana yang diukur di device
nyata dan angka mana yang tebakan. Bedanya, di sini konsekuensi tebakan yang tidak ditandai adalah
memutuskan sharding database — keputusan yang tidak bisa dibatalkan dengan mudah.

**Anchor:** `loadtest/CAPACITY-MODEL.md:13-29` — bagian *"Why one load-test number lies"* dengan
tabel yang memecah p95 5,66 s jadi signup 7,72 s vs I/O 248-659 ms;
`loadtest/CAPACITY-MODEL.md:31-53` — tiga konstanta terukur (`perNodeIoRps`, `perWorkerJobsPerSec`,
`bcryptCost12MsPerHash`) beserta cara mengukurnya, termasuk peringatan bahwa angka otomatis dari
drain probe adalah **floor**, bukan kapasitas, ketika worker masih sanggup mengejar;
`loadtest/CAPACITY-MODEL.md:55-57` — pernyataan bahwa default yang dikirim adalah placeholder
konservatif, bukan pengukuran node terdedikasi;
`loadtest/capacity-model.mjs:42-43` — konstanta `perNodeIoRps: 220` dengan tanda `FILL FROM RUN`
tepat di komentar di atasnya; `loadtest/capacity-model.mjs:390-392` — baris `VERDICT:` yang
mencetak jumlah node **dan** "Tightest tier" dengan persen headroom-nya;
`loadtest/capacity-model-1m.mjs:295-298` — peringatan ILLUSTRATIVE yang dicetak ke stdout;
`loadtest/capacity-model-1m.mjs:371-383` — blok yang memilih tier dengan shard terbanyak dan
mencetaknya sebagai *"the binding NEW ceiling"*.

**Kenapa dipakai di sini:** `sweep.sh` dan model ini adalah satu pasangan. `loadtest/sweep.sh:2-9`
menyatakan tujuannya: menjalankan skenario I/O murni pada budget CPU per-replika **tetap** untuk
api=1,2,3, lalu menabulasi req/s total dan per-node — karena *"per-node req/s stays ~flat"* berarti
scaling linear bersih, dan **penurunan** per-node berarti ada tier bersama yang jadi ceiling. Titik
belok itulah input yang dibutuhkan model (`--perNodeIoRps`). `loadtest/sweep.sh:56-60` mencetak
instruksi membaca tabelnya langsung di terminal, jadi kamu tidak perlu mengingatnya.

**Alternatif:**
- **Satu angka k6 saja, tanpa model.** Nol usaha tambahan, dan itu yang dilakukan mayoritas orang.
  Harganya persis bagian "why one number lies": p95 5,66 s akan kamu laporkan sebagai kegagalan
  sistem, padahal jalur I/O-nya sehat sempurna — dan reaksi yang paling mungkin (menurunkan salt
  rounds) adalah regresi keamanan.
- **Benchmark di cloud sungguhan dengan node kelas produksi.** Angkanya absolut dan tidak perlu
  disertai catatan kaki. Harganya: biaya per jam untuk beberapa node × jumlah iterasi eksperimen,
  dan repo ini memilih batasan sadar hardware-free supaya seluruh klaimnya bisa diverifikasi ulang
  oleh siapa pun di kind/minikube dengan $0.
- **Tanpa model sama sekali, scale saat kepanasan.** Nol usaha di muka, dan untuk sistem kecil ini
  sering rasional. Harganya spesifik: kamu tidak tahu **tier mana** yang mengikat lebih dulu, jadi
  saat kepanasan kamu akan menambah replika api (yang paling gampang) sementara yang habis adalah
  koneksi PgBouncer atau kedalaman antrian — dan menambah api justru memperburuknya.

**Latihan:** Jalankan `node loadtest/capacity-model.mjs --dau=100000` lalu
`node loadtest/capacity-model-1m.mjs --dau=2000000 --liveSharePct=20 --liveFrameHz=2`. Catat baris
`VERDICT:` masing-masing. **Verifikasi:** sekarang turunkan satu dial —
`node loadtest/capacity-model-1m.mjs --dau=2000000 --liveSharePct=20 --liveFrameHz=1` — dan
pastikan tier yang mengikat berubah atau jumlah shard-nya turun tajam. Tulis satu paragraf yang
memisahkan: mana angka yang **diukur** (dari run k6-mu sendiri) dan mana yang masih placeholder
`FILL FROM RUN`.

---

### 11.6 Kubernetes Deployment, Service, dan Ingress sebagai cermin topologi Compose

Momen paling melegakan di fase ini adalah menyadari bahwa kamu tidak sedang belajar sistem baru.
Kamu sedang belajar **kosakata kedua untuk topologi yang sudah kamu jalankan**. Peta padanannya
hampir satu-ke-satu:

| Compose | Kubernetes | Yang berubah |
|---|---|---|
| service `api` dengan `command` + `PROCESS_ROLE` | `Deployment` `drovery-api` | replika dikelola controller, bukan flag `--scale` |
| `--scale api=3` | `spec.replicas` (lalu diambil alih HPA) | angka bisa diubah oleh autoscaler, bukan hanya kamu |
| DNS internal Compose (`api:3000`) | `Service` ClusterIP (`drovery-api:80`) | load balancing di kernel, bukan di nginx |
| Caddy / nginx LB | `Ingress` + ingress-controller | routing berbasis host + path, TLS lewat cert-manager |
| service `migrate` dengan `restart: 'no'` | `Job` `drovery-migrate` | ada `backoffLimit`, `ttlSecondsAfterFinished` |
| overlay `-f docker-compose.prod.yml` | Kustomize overlay `k8s/overlays/prod` | patch berbentuk JSON patch, bukan merge YAML |

Yang benar-benar baru cuma empat, dan tiga di antaranya dapat subbagiannya sendiri di bawah:
probe (11.7), urutan shutdown (11.8), `resources.requests` sebagai basis HPA (11.9), dan Ingress
yang memisahkan jalur WebSocket dari jalur HTTP. Yang terakhir menarik karena Drovery memakai
**dua** Ingress untuk **satu** host: `/api/v1` masuk ke tier api, sisanya (termasuk upgrade
WebSocket di root) masuk ke tier realtime — dan itu bekerja karena nginx-ingress memenangkan prefix
yang lebih spesifik.

**Anchor:** `k8s/README.md:3-5` — pernyataan prinsipnya (*"Kustomize base + overlays mirroring the
docker-compose.yml topology. One container image (drovery-backend) runs every role — the role is
chosen by the container command + PROCESS_ROLE"*); `k8s/base/api-deployment.yaml:28-34` — container
dengan `command: ['node','dist/src/main']` dan `PROCESS_ROLE: api`, persis pasangan
`docker-compose.yml:99`; `src/common/process-role.ts:1-13` — taksonomi empat peran yang membuat satu
image cukup; `k8s/base/api-service.yaml:6-10` — ClusterIP port 80 → targetPort `http`;
`k8s/base/api-ingress.yaml:9-19` — `ingressClassName: nginx` dengan path `/api/v1` prefix;
`k8s/base/realtime-ingress.yaml:1-3` — komentar yang menjelaskan pembagian rute
(*"The api Ingress keeps /api/* (a more specific prefix wins in nginx-ingress)"*);
`k8s/base/realtime-ingress.yaml:9-11` — `proxy-read-timeout: '3600'` karena socket tracking
panjang-umur dan mayoritas menganggur; `k8s/base/realtime-ingress.yaml:25-32` — path `/` sebagai
prefix paling tidak spesifik.

**Kenapa dipakai di sini:** `k8s/README.md:45-49` menyatakan apa yang **sengaja tidak ada** di
sini, dan ini penting supaya kamu tidak mencarinya: Postgres, PgBouncer, dan Redis diasumsikan
managed atau di-deploy terpisah, begitu juga Prometheus/KEDA/metrics-server/ingress-nginx yang
dianggap cluster add-on. Konsekuensi praktisnya disebutkan jujur di
`k8s/overlays/local/kustomization.yaml:28-31`: pod akan **tetap NotReady** sampai dependensi itu
tersedia — *"correct behaviour, but easy to misdiagnose"*. Baca kalimat itu sebelum kamu panik di
hari pertama kind.

**Alternatif:**
- **Docker Swarm.** Jauh lebih sederhana: `docker stack deploy` memakai file compose yang hampir
  sama, routing mesh built-in, tidak perlu belajar kosakata baru. Harganya spesifik untuk fase ini:
  tidak ada HPA, tidak ada KEDA, tidak ada PodDisruptionBudget, tidak ada operator — yaitu persis
  empat hal yang jadi materi minggu 3. Swarm juga praktis berhenti dikembangkan.
- **HashiCorp Nomad.** Satu binary, jauh lebih ringan dari k8s, dan modelnya (job → group → task)
  bisa dipelajari dalam sehari. Harganya: ekosistem autoscaler dan ingress jauh lebih tipis —
  padanan KEDA praktis harus kamu tulis sendiri lewat Nomad Autoscaler plugin, dan komunitasnya
  seperlima.
- **Tetap di Compose pada satu VPS.** Persis yang dilakukan `docker-compose.prod.yml` dan yang sudah
  kamu bangun di Fase 10. Untuk mayoritas produk ini pilihan yang benar. Harganya, dan ini kuantitatif:
  ceiling-nya adalah satu mesin. Saat kamu butuh replika yang bertahan ketika satu host mati, atau
  autoscaling yang bergerak tanpa kamu di depan laptop, Compose tidak punya jawaban.

**Latihan:** Jalankan `kubectl kustomize k8s/overlays/local > /tmp/local.yaml`, lalu buka file itu
dan buat pemetaan tertulis: untuk setiap `kind:` yang muncul, tulis service Compose mana yang
menjadi padanannya (atau tulis "tidak ada padanan" — akan ada beberapa). **Verifikasi:** kamu harus
menemukan minimal empat objek yang **tidak** punya padanan Compose sama sekali. Kalau kamu hanya
menemukan satu atau dua, kamu melewatkan sesuatu.

---

### 11.7 Tiga probe, tiga tujuan: startup memberi waktu, readiness menarik dari Service, liveness me-restart

Di Docker, `HEALTHCHECK` cuma ada satu. Ia menjawab satu pertanyaan biner: sehat atau tidak. Di
Kubernetes ada tiga probe, dan menyamakannya adalah salah satu bug operasional paling mahal yang
bisa kamu buat — karena efeknya baru terlihat saat sistem sedang tertekan, yaitu saat kamu paling
tidak ingin kejutan.

Bedanya bukan soal *apa* yang dicek, tapi *apa akibatnya kalau gagal*:

- **`startupProbe`** — "boleh mulai dihitung belum?" Selama ia belum lulus, liveness dan readiness
  **tidak dijalankan sama sekali**. Gunanya untuk aplikasi yang boot-nya lama (Prisma connect + Nest
  module init) supaya liveness tidak membunuhnya di tengah boot. Gagal terus → pod di-restart.
- **`readinessProbe`** — "boleh dikirimi trafik?" Gagal → pod **dikeluarkan dari endpoint Service**,
  tapi **tidak** di-restart. Ini yang benar untuk "database sedang tidak terjangkau": pod itu tidak
  rusak, ia cuma tidak bisa melayani sekarang.
- **`livenessProbe`** — "prosesnya masih waras?" Gagal → pod **di-restart**. Ini harus mengecek hal
  yang hanya bisa diperbaiki dengan restart.

Kesalahan klasiknya: memakai endpoint readiness (yang mengecek DB dan Redis) sebagai liveness.
Saat database sempat down 30 detik, seluruh armada pod akan di-restart — menambah badai koneksi
tepat di saat database sedang sekarat, dan mengubah gangguan sementara jadi outage penuh. Drovery
memisahkannya dengan dua endpoint berbeda dan komentarnya jelas.

**Anchor:** `k8s/base/api-deployment.yaml:38-42` — komentar *"Give Prisma + Nest up to 60s to boot
before liveness can kill the pod"* di atas `startupProbe` (`periodSeconds: 5` × `failureThreshold:
12` = 60 detik); `k8s/base/api-deployment.yaml:43-48` — `readinessProbe` ke `/api/v1/health/ready`;
`k8s/base/api-deployment.yaml:49-53` — `livenessProbe` ke `/api/v1/health`;
`src/health/health.controller.ts:17-26` — endpoint `live()` yang hanya membuktikan proses hidup
(uptime + timestamp, tidak menyentuh dependensi apa pun);
`src/health/health.controller.ts:28-39` — endpoint `ready()` yang memanggil `healthService.check()`
dan melempar `ServiceUnavailableException` (503) kalau ada dependensi yang mati;
`src/health/health.controller.ts:9-13` — `@PublicApi()` + `@SkipThrottle()` dengan alasannya
(probe orchestrator tidak membawa JWT dan tidak boleh kena rate limit).

Dan bagian yang paling mengajar: **worker sengaja TIDAK punya probe httpGet sama sekali.**

**Anchor:** `k8s/base/worker-deployment.yaml:39-48` — komentar
*"NO httpGet probes: the worker is a Nest application context with no HTTP server on :3000 — an
httpGet /api/v1/health probe would always fail and drive it into CrashLoopBackOff"*, diikuti
`startupProbe` berbasis `exec` yang menjalankan `pgrep -f "dist/src/worker"`;
`k8s/README.md:51-55` — gotcha yang sama diulang di daftar "the ones that actually bite".

**Kenapa dipakai di sini:** ini konsekuensi langsung dari arsitektur "satu image, banyak peran"
yang sudah kamu kenal dari Fase 10. `src/common/process-role.ts:19-26` menunjukkan bahwa
`IS_HTTP_TIER` bernilai `false` untuk peran `worker` — jadi worker benar-benar tidak punya server
HTTP di port 3000. Ia hanya punya server mini di 9091 untuk metrics
(`k8s/base/worker-deployment.yaml:15-19` mengatur anotasi scrape ke port itu). Probe httpGet ke
3000 di worker bukan "kurang tepat" — ia **pasti** gagal, selamanya, dan pod-nya akan restart
berulang sampai kamu mencabutnya. Karena itu capstone fase ini menyuruhmu **sengaja
mereproduksinya**: bug yang pernah kamu lihat dengan mata sendiri tidak akan kamu buat lagi.

**Alternatif:**
- **Satu endpoint untuk semua probe.** Konfigurasi paling pendek, dan sering dilakukan.
  Harganya kuantitatif: kalau endpoint itu mengecek DB, blip database 30 detik akan me-restart
  seluruh armada; kalau ia tidak mengecek DB, pod yang kehilangan koneksi Redis akan tetap menerima
  trafik dan mengembalikan 500 ke pengguna. Tidak ada pilihan tunggal yang benar untuk keduanya —
  itulah kenapa probe-nya tiga.
- **Hanya `livenessProbe`, tanpa `startupProbe`, dengan `initialDelaySeconds` besar.** Bisa jalan
  dan lebih sedikit YAML. Harganya: `initialDelaySeconds` adalah angka mati — kalau boot ternyata
  butuh 70 detik pada node yang sibuk, pod di-restart tepat sebelum ia selesai boot, dan restart
  membuat node makin sibuk. `startupProbe` memberi jendela yang **habis saat lulus**, bukan jendela
  tetap.
- **Probe `exec` untuk semua tier (seperti yang dipakai worker).** Konsisten dan tidak butuh HTTP.
  Harganya: `exec` menjalankan proses baru di dalam container setiap periode — untuk tier api dengan
  20 replika dan periode 10 detik itu 120 fork per menit, dan ia tidak bisa membedakan "proses hidup"
  dari "proses hidup tapi event loop macet". httpGet bisa.

**Latihan:** Di kind dengan overlay local, jalankan
`kubectl -n drovery describe pod -l role=api` dan baca bagian Events dari atas ke bawah; catat
urutan probe mana yang muncul lebih dulu. **Verifikasi:** sekarang tambahkan blok
`livenessProbe: { httpGet: { path: /api/v1/health, port: 9091 } }` ke
`k8s/base/worker-deployment.yaml`, `kubectl apply -k k8s/overlays/local`, dan tunggu.
Pod worker harus masuk `CrashLoopBackOff` dalam ~2 menit; `kubectl -n drovery describe pod -l
role=worker` harus menunjukkan `Liveness probe failed`. Cabut kembali blok itu dan pastikan pod
kembali `Running`. Simpan output `describe`-nya — ini salah satu bukti capstone.

---

### 11.8 Urutan shutdown: `preStop` lebih dulu, lalu SIGTERM, dan grace period berbeda per tier

Mematikan pod yang sedang melayani trafik ternyata punya balapan yang tidak kelihatan. Saat kamu
menghapus pod, dua hal terjadi **paralel**, bukan berurutan: kubelet mengirim SIGTERM ke container,
**dan** endpoint controller mulai mencabut pod itu dari daftar endpoint Service. Karena paralel,
ada jendela di mana proses sudah mulai shutdown tapi LB masih mengirim request ke sana — dan
pengguna melihat error.

`preStop` adalah hook yang dijalankan **sebelum** SIGTERM. Isinya di sini sesederhana `sleep 5`,
dan itu memang trik yang benar: ia tidak melakukan apa-apa, ia hanya **menunda** SIGTERM cukup lama
supaya pencabutan endpoint selesai lebih dulu. Setelah itu, proses bisa mati tenang.

Angka keduanya, `terminationGracePeriodSeconds`, adalah batas kesabaran total: dari mulai proses
terminasi sampai SIGKILL. Ia harus **melebihi** `preStop` + waktu drain aplikasi. Dan di sinilah
Drovery mengajarkan sesuatu: angka itu **berbeda per tier**, karena "apa yang harus selesai" berbeda
per tier.

| Tier | grace | `preStop` | Yang harus selesai dulu |
|---|---|---|---|
| api | 40 s | `sleep 5` | request HTTP yang sedang berjalan + shutdown hook Prisma/BullMQ |
| worker | 90 s | — | job BullMQ yang sedang diproses (in-flight) |
| realtime | 120 s | `sleep 10` | ribuan socket WS dilepas baik-baik supaya klien reconnect dengan backoff |

**Anchor:** `k8s/base/api-deployment.yaml:25-26` — `terminationGracePeriodSeconds: 40` dengan
komentar *"Must exceed preStop sleep + the app's drain time (BullMQ/pg shutdown hooks)"*;
`k8s/base/api-deployment.yaml:54-56` — `lifecycle.preStop` dengan komentar *"Let the load balancer
deregister this pod before it gets SIGTERM"*; `k8s/base/worker-deployment.yaml:26-27` — grace 90
detik, *"Longer than the api: let in-flight BullMQ jobs finish on SIGTERM before SIGKILL"*;
`k8s/base/realtime-deployment.yaml:30-32` — grace 120 detik untuk *"thousands of long-lived WS
clients"*; `k8s/base/realtime-deployment.yaml:65-67` — `preStop: sleep 10`, lebih panjang dari api.

**Kenapa dipakai di sini:** angka-angka ini bukan tebakan, ia mencerminkan invariant dari fase-fase
sebelumnya. 90 detik untuk worker masuk akal karena kamu tahu dari Fase 6 bahwa job BullMQ punya
durasi nyata dan mematikannya di tengah berarti job diulang (at-least-once). 120 detik untuk realtime
masuk akal karena kamu tahu dari Fase 8 bahwa socket yang diputus paksa akan reconnect serentak —
badai yang bisa menjatuhkan pod berikutnya. Perhatikan juga bahwa `preStop` realtime lebih panjang
(10 s vs 5 s) dengan alasan tertulis: *"give in-flight sockets a moment after deregistration"*.

**Alternatif:**
- **Tidak pakai `preStop` sama sekali, andalkan aplikasi menangani SIGTERM dengan tidur dulu.**
  Bisa dan bahkan lebih eksplisit — logikanya ada di kode, bukan di YAML. Harganya: setiap peran
  harus mengimplementasikannya, dan kalau satu peran lupa, kegagalannya berbentuk 502 sporadis saat
  deploy yang hampir mustahil dilacak. `preStop` berlaku untuk container apa pun, termasuk yang
  bukan kodemu.
- **Grace period seragam untuk semua tier (misalnya 120 detik semua).** Satu angka, tidak perlu
  berpikir. Harganya kuantitatif: rolling update tier api jadi 3× lebih lambat tanpa manfaat apa pun
  (request HTTP selesai dalam hitungan detik), dan pada armada 20 replika itu selisih menit yang
  nyata setiap deploy.
- **Grace period sangat pendek (10 detik) + andalkan retry klien.** Deploy tercepat. Harganya
  spesifik untuk sistem ini: job BullMQ yang dibunuh di tengah akan dijalankan ulang, dan meskipun
  handler-nya idempoten (Fase 6), pekerjaan terbuang; dan socket WS yang diputus serentak
  menghasilkan badai reconnect yang persis ingin dihindari `k8s/base/realtime-scaledobject.yaml:34-40`.

**Latihan:** Dengan overlay local jalan, buka dua terminal. Terminal A:
`kubectl -n drovery get pods -l role=api -w`. Terminal B:
`kubectl -n drovery delete pod <nama-pod-api>` sambil mencatat waktu. **Verifikasi:** pod harus
bertahan di `Terminating` selama beberapa detik sebelum hilang — itu `preStop` + drain. Sekarang
ubah `k8s/base/api-deployment.yaml:26` jadi `terminationGracePeriodSeconds: 3` (lebih pendek dari
`preStop` sleep 5), apply, dan ulangi. Amati bahwa pod dibunuh **sebelum** `preStop` selesai —
itulah bug yang komentar `:25` mencegah. Kembalikan ke 40.

---

### 11.9 `resources.requests.cpu` wajib ada, karena HPA menghitung utilization = usage / request

Ini konsep kecil dengan konsekuensi besar, dan bentuk kegagalannya adalah **diam**. HPA berbasis CPU
tidak bekerja dengan "persen dari core mesin". Ia bekerja dengan `usage / request`. Kalau
`resources.requests.cpu` tidak ada, penyebutnya tidak ada, dan HPA melaporkan `<unknown>` di kolom
TARGETS lalu berhenti melakukan apa pun. Tidak ada error, tidak ada event, tidak ada alert. Kamu
punya autoscaler yang terpasang rapi dan tidak pernah menaikkan satu pod pun.

Padanan yang jujur dari dunia frontend: tidak ada. `request` bukan batas dan bukan alokasi nyata —
ia lebih mirip *deklarasi niat* yang dipakai dua sistem berbeda untuk dua hal berbeda: scheduler
memakainya untuk memutuskan pod muat di node mana, dan HPA memakainya sebagai penyebut. `limits`
yang di sebelahnya adalah hal yang benar-benar berbeda: itu ceiling cgroup, padanan langsung dari
`cpus:` di `docker-compose.nodes.yml` yang sudah kamu pakai di 11.4.

Konsekuensi yang tidak intuitif: `requests.cpu: 100m` dengan `averageUtilization: 65` berarti HPA
menambah pod ketika rata-rata pemakaian melewati **65 milicore**, bukan 65% dari satu core. Angka
request yang terlalu kecil membuat HPA hipersensitif; terlalu besar membuatnya tuli.

**Anchor:** `k8s/base/api-deployment.yaml:57-60` — `resources` dengan komentar tepat di atasnya:
*"cpu REQUEST is mandatory — the HPA computes utilization as usage/request"*, `requests: { cpu:
100m, memory: 256Mi }` dan `limits: { cpu: 500m, memory: 512Mi }`;
`k8s/base/api-hpa.yaml:12-18` — metrik `Resource` cpu dengan `averageUtilization: 65`;
`k8s/base/api-hpa.yaml:31-32` — dua baris penutup yang menyatakan prasyaratnya secara eksplisit:
*"Requires metrics-server in-cluster … Dropping the api's resources.requests.cpu disables this HPA
(reports `<unknown>`)."*

**Kenapa dipakai di sini:** perhatikan bahwa tier realtime **sengaja** memilih angka yang berbeda
bentuknya. `k8s/base/realtime-deployment.yaml:68-72` memberi `requests: { cpu: 100m, memory: 512Mi }`
dan `limits: { cpu: 500m, memory: 1Gi }` dengan komentar: *"Memory-weighted, NOT cpu: each socket
costs heap + an FD, but idle sockets use little CPU. cpu request stays small (KEDA, not CPU, drives
scaling)."* Ini contoh bagus bahwa `requests` bukan cuma formalitas — ia menyatakan **apa yang
langka di tier itu**. Pasangannya di `:42-46`: `NODE_OPTIONS=--max-old-space-size=768` dipasang
karena default V8 mengukur heap dari RAM **host**, bukan dari limit cgroup, jadi tanpa itu proses
akan di-OOM-kill kernel sebelum V8 merasa perlu GC. Itu versi Kubernetes dari kegagalan yang sudah
kamu baca di `docker-compose.nodes.yml:38-47`.

**Alternatif:**
- **Tidak menetapkan `requests` dan memakai HPA berbasis custom metric (misalnya req/s).** Sah, dan
  untuk banyak layanan lebih bermakna daripada CPU. Harganya: kamu butuh sumber metrik custom
  (prometheus-adapter atau KEDA) yang harus dioperasikan sendiri, dan scheduler kehilangan informasi
  untuk menempatkan pod — node bisa over-committed sampai OOM.
- **`requests` = `limits` (kelas QoS Guaranteed).** Memberi jaminan penjadwalan terkuat dan pod
  paling terakhir di-evict saat node tertekan. Harganya kuantitatif: kalau `requests.cpu` dinaikkan
  dari 100m ke 500m untuk menyamai limit, node yang sama menampung **5× lebih sedikit** pod,
  dan HPA jadi jauh lebih lambat bereaksi karena penyebutnya besar.
- **Vertical Pod Autoscaler (VPA) yang menyetel `requests` otomatis.** Menghapus tebakan manual.
  Harganya konkret dan disebut di peta: VPA dan HPA **berkonflik** kalau memakai metrik yang sama —
  VPA menaikkan request, yang menurunkan utilization terhitung, yang membuat HPA menurunkan replika,
  yang menaikkan beban per pod, yang membuat VPA menaikkan request lagi.

**Latihan:** Dengan overlay local jalan dan metrics-server aktif, jalankan
`kubectl -n drovery get hpa -w` di satu terminal. **Verifikasi awal:** kolom TARGETS harus
menunjukkan angka seperti `3%/65%`, bukan `<unknown>/65%`. Sekarang hapus baris
`requests: { cpu: 100m, memory: 256Mi }` dari `k8s/base/api-deployment.yaml:59`, apply, dan tunggu
1-2 menit. **Verifikasi:** TARGETS berubah jadi `<unknown>/65%` dan tidak ada event error apa pun di
`kubectl -n drovery describe hpa drovery-api` selain `FailedGetResourceMetric`. Kembalikan barisnya.

---

### 11.10 Kustomize: base + overlay sebagai perbedaan, name suffix hash, dan peringatan Secret

Kalau Fase 10 sudah mendarat, konsep ini gratis: Kustomize adalah pola yang sama dengan pelapisan
`-f docker-compose.yml -f docker-compose.prod.yml`. Satu base yang berisi topologi, beberapa overlay
yang berisi **perbedaan**. Filosofinya identik: overlay bukan salinan, overlay adalah delta.

Tiga overlay di repo ini punya kepribadian yang jelas dan layak dibaca berdampingan:

| Overlay | Yang diubah | Untuk apa |
|---|---|---|
| `local` | tag image `ci`, HPA `maxReplicas` → 4, secret dev kuat-tapi-buang, host Ingress `api.drovery.local` | kind/minikube |
| `prod` | image GHCR ber-tag, HPA `minReplicas: 3`, PDB → 50%, host asli, **tanpa** secret | cluster nyata |
| `loadtest` | tag `ci`, `NODE_ENV=development` + `LOADTEST_BYPASS_THROTTLE=true`, replika **dikunci** | eksperimen A/B terkontrol |

Yang khas Kustomize dan tidak ada padanannya di Compose adalah **name suffix hash**. ConfigMap yang
dihasilkan `configMapGenerator` mendapat sufiks berupa hash dari isinya. Ubah satu literal, nama
ConfigMap berubah, referensi di Deployment ikut berubah, dan Deployment yang berubah memicu rolling
update. Tanpa mekanisme ini, mengubah ConfigMap tidak melakukan apa-apa: pod lama terus memakai env
lama sampai kamu me-restart mereka secara manual — kegagalan diam yang sangat sering menipu.

**Anchor:** `k8s/base/kustomization.yaml:21-34` — `configMapGenerator` dengan komentar kuncinya
*"The name gets a content hash so a change rolls the pods"*;
`k8s/base/kustomization.yaml:36-41` — `secretGenerator` dengan catatan bahwa overlay menggantinya;
`k8s/overlays/local/kustomization.yaml:6-11` dan `:20-26` — image tag `ci` dan patch `maxReplicas`
jadi 4; `k8s/overlays/prod/kustomization.yaml:6-9` dan `:11-21` — GHCR + tiga patch (minReplicas 3,
PDB 50%, host produksi); `k8s/overlays/loadtest/kustomization.yaml:24-31` — replika dikunci untuk
perbandingan bersih, dan `:33-35` yang menyuruh `kubectl scale` manual alih-alih membiarkan HPA
bergerak selama eksperimen.

Dan peringatan yang paling penting untuk dibaca sebelum kamu tergoda:
**Anchor:** `k8s/base/secrets.env.example:1-5` — *"EXAMPLE ONLY — never put real secrets in git …
Kubernetes Secrets are base64, NOT encrypted at rest unless etcd encryption is enabled"*;
`k8s/overlays/prod/kustomization.yaml:23-29` — larangan menaruh nilai asli, plus catatan teknis
yang berguna: kalau Secret dikelola di luar (External Secrets / Sealed Secrets), matikan generator
base dan set `generatorOptions: { disableNameSuffixHash: true }` supaya nama Secret stabil.

**Kenapa dipakai di sini:** perhatikan bahwa `loadtest` overlay **mengunci** replika
(`api: 2`, `worker: 3`) alih-alih membiarkan autoscaler bekerja. Alasannya ditulis di `:33-35` dan
ini prinsip eksperimen yang bagus: autoscaler yang bergerak selama pengukuran **merusak
eksperimennya** — kamu tidak lagi tahu berapa node yang sebenarnya melayani beban saat angka itu
tercatat. Untuk perbandingan A/B, variabel yang tidak kamu uji harus dipaku.

**Alternatif:**
- **Helm.** Templating penuh (loop, conditional, `values.yaml` berjenjang), ekosistem chart raksasa,
  dan punya **hook ordering asli** — sesuatu yang justru dibutuhkan Job migrate (lihat 11.11) dan
  yang tidak dimiliki Kustomize. Harganya konkret: Go template di dalam YAML berarti kesalahan
  indentasi baru ketahuan saat `helm template` di-render, dan hasil render sulit di-diff terhadap
  cluster. Repo ini menyimpan anotasi hook Helm (`k8s/base/migrate-job.yaml:11-13`) supaya migrasi ke
  Helm nanti tidak perlu menulis ulang.
- **YAML mentah lengkap per environment.** Nol tooling, hasilnya persis apa yang kamu baca. Harganya
  spesifik: perubahan pada probe api harus disalin ke tiga file, dan drift antar-environment bukan
  kemungkinan melainkan kepastian — bug yang muncul hanya di prod karena satu file lupa diperbarui.
- **jsonnet / cdk8s / Pulumi.** Bahasa pemrograman penuh untuk menghasilkan manifest; paling kuat
  untuk konfigurasi yang benar-benar kompleks (puluhan service, matriks region). Harganya: satu
  runtime tambahan di CI, dan orang yang membaca repo harus tahu bahasa itu sebelum bisa menjawab
  "apa isi ConfigMap prod?" — sementara `kubectl kustomize` menjawabnya tanpa dependensi apa pun.

**Latihan:** Jalankan `kubectl kustomize k8s/overlays/local > /tmp/local.yaml` dan
`kubectl kustomize k8s/overlays/prod > /tmp/prod.yaml`, lalu `diff /tmp/local.yaml /tmp/prod.yaml`.
**Verifikasi:** identifikasi minimal empat perbedaan dan kaitkan tiap perbedaan ke baris patch
penyebabnya di file overlay. Lanjut: ubah satu literal di `k8s/base/kustomization.yaml:31`
(`SIM_WORKER_CONCURRENCY=10` → `=11`), render ulang overlay local, dan konfirmasi bahwa **sufiks
hash nama ConfigMap berubah** dan referensi di ketiga Deployment ikut berubah. Kembalikan.

---

### 11.11 `migrate` sebagai Job: hook ordering yang inert, dan kenapa `kubectl wait` adalah gerbang sesungguhnya

Di Compose kamu sudah punya pola ini: service `migrate` yang jalan sampai selesai lalu exit 0, dan
`depends_on: condition: service_completed_successfully` yang menahan api/worker sampai itu terjadi.
Kubernetes punya padanan objeknya (`Job`), tapi **tidak** punya padanan `depends_on`-nya. Dan di
situlah jebakannya.

`k8s/base/migrate-job.yaml` memasang anotasi `helm.sh/hook: pre-install,pre-upgrade` dan
`argocd.argoproj.io/hook: PreSync`. Kalau kamu membacanya sepintas, kamu akan menyimpulkan bahwa
urutan sudah terjamin. Ia tidak. Anotasi itu **hanya berarti sesuatu bagi Helm dan ArgoCD**. Di
bawah `kubectl apply -k`, mereka cuma string di metadata — Kubernetes membuat Job dan Deployment
**bersamaan**, dan pod api bisa boot ke database yang tabelnya belum ada. Repo ini menyatakan itu
terang-terangan di komentarnya, dan itu detail kejujuran yang layak ditiru: anotasi yang tidak aktif
di jalur yang sedang dipakai **diberi label** sebagai tidak aktif.

Gerbang sesungguhnya karena itu adalah perintah manual: `kubectl wait --for=condition=complete`.
Ini bukan workaround jelek, ini konsekuensi jujur dari memilih `kubectl apply -k` sebagai jalur
deploy.

**Anchor:** `k8s/base/migrate-job.yaml:1-4` — komentar pembuka yang menyuruh menggerbangi rollout
dengan `kubectl wait`; `k8s/base/migrate-job.yaml:9-14` — anotasi hook dengan komentar
*"Effective only under Helm/ArgoCD; inert under plain `kubectl apply -k`"*;
`k8s/base/migrate-job.yaml:16-18` — `backoffLimit: 3`, `activeDeadlineSeconds: 300`,
`ttlSecondsAfterFinished: 600`; `k8s/base/migrate-job.yaml:29-35` — perintah
`npx prisma migrate deploy` dengan komentar *"seed excluded in prod"* dan env `DATABASE_URL` yang
mengambil nilainya dari key **`DATABASE_URL_DIRECT`**;
`k8s/README.md:36-38` — perintah gerbangnya:
`kubectl -n drovery wait --for=condition=complete job/drovery-migrate --timeout=180s`;
`k8s/base/secrets.env.example:8-11` — dua URL berdampingan dengan komentar yang membedakan
*"App traffic -> PgBouncer (transaction pooling)"* vs *"Migrations -> Postgres DIRECT (bypass the
pooler for DDL/advisory locks)"*.

**Kenapa dipakai di sini:** `DATABASE_URL_DIRECT` adalah konsep PgBouncer dari Fase 10 yang muncul
lagi, kali ini sebagai key Secret terpisah. Kalau alasannya sudah kabur, ini pengingatnya:
`POOL_MODE: transaction` (`docker-compose.yml:42`) mengembalikan koneksi server ke pool di akhir
setiap transaksi, jadi apa pun yang bergantung pada **state sesi** rusak — dan advisory lock milik
Prisma migrate persis seperti itu. Perhatikan juga perbedaan yang halus dengan Compose: di lokal,
`migrate` juga menjalankan `prisma db seed` (`docker-compose.yml:86`), sementara di k8s seed
**dikecualikan**. Itu keputusan sadar, bukan kelalaian.

**Alternatif:**
- **initContainer di setiap Deployment.** Urutannya otomatis dijamin Kubernetes, tanpa perintah
  manual. Harganya kuantitatif: dengan 20 replika api, **20 proses** menjalankan `migrate deploy`
  bersamaan setiap rollout — mengandalkan advisory lock Prisma untuk saling menunggu, dan
  memperlambat setiap rollout dengan pekerjaan yang 19 kali sia-sia.
- **Pindah ke Helm atau ArgoCD supaya hook-nya benar-benar aktif.** Ini jalan keluar yang paling
  "benar", dan repo sudah menyiapkan anotasinya. Harganya: satu tooling penuh untuk dipelajari dan
  dioperasikan, dan untuk fase belajar ini `kubectl wait` mengajarkan lebih banyak — kamu melihat
  gerbangnya, bukan mempercayainya.
- **Tool migrasi terpisah (Flyway / Liquibase / Atlas).** Punya fitur ordering dan rollback yang jauh
  lebih kaya, plus dry-run migrasi. Harganya spesifik untuk repo ini: Prisma sudah jadi sumber
  kebenaran schema, dan gerbang `prisma:drift-check` di CI (Fase 10) menjaganya — menambah tool kedua
  berarti dua sumber kebenaran yang harus disinkronkan manual.

**Latihan:** Di kind, apply overlay local **tanpa** `kubectl wait`, lalu segera jalankan
`kubectl -n drovery logs -l role=api --tail=50`. **Verifikasi:** kemungkinan besar kamu melihat
error Prisma tentang relasi/tabel yang belum ada. Sekarang `kubectl delete -k k8s/overlays/local`,
apply ulang, dan kali ini jalankan
`kubectl -n drovery wait --for=condition=complete job/drovery-migrate --timeout=180s` sebelum
memeriksa log. Bandingkan keduanya. Bonus: jalankan `kubectl -n drovery get jobs` 10 menit setelah
Job selesai dan konfirmasi ia sudah hilang — itu `ttlSecondsAfterFinished: 600`.

---

### 11.12 Tiga sinyal autoscaling: HPA CPU untuk api, KEDA queue depth untuk worker, KEDA socket count untuk realtime

Ini puncak fase, dan kalau kamu hanya boleh membawa satu kalimat pulang, ambil ini:
**sinyal autoscaler harus mengukur sumber daya yang benar-benar habis di tier itu.**

Kenapa satu mekanisme tidak cukup? Karena tiga tier di Drovery kehabisan tiga hal berbeda, dan
masing-masing punya cara gagal yang khas kalau kamu memakai sinyal yang salah:

**api → HPA on CPU 65%.** Tier HTTP stateless yang memang CPU-bound — kamu sudah membuktikannya
sendiri di 11.3 dengan bcrypt cost-12. `behavior`-nya sengaja **asimetris**: naik seketika
(`stabilizationWindowSeconds: 0`, *"react to traffic spikes immediately"*), turun pelan-pelan (300
detik, *"avoid thrash on transient dips"*). Asimetri ini adalah pola yang berlaku umum: biaya
terlambat naik adalah pengguna kena error; biaya terlambat turun adalah beberapa pod menganggur.

**worker → KEDA on queue depth via Prometheus.** Di sini ada temuan yang benar-benar spesifik dan
tidak akan kamu temukan di tutorial mana pun. KEDA punya scaler Redis native (`listLength`) yang
melakukan `LLEN` pada list. Tapi BullMQ menyimpan job **delayed** di sorted set
(`bull:delivery-simulation:delayed`) dan hanya job **waiting** di list. Jadi scaler native itu
**buta** terhadap backlog delayed — *"which is the majority of this queue"*. Kamu akan punya
autoscaler yang melaporkan antrian kosong sementara puluhan ribu job menunggu gilirannya. Karena
itu repo ini memakai scaler Prometheus dan query gauge aplikasi sendiri.

Dan di query itu ada aturan kedua yang halus: **`max()`, bukan `sum()`**. Gauge `drovery_queue_jobs`
bersifat **queue-global** — setiap replika melaporkan angka yang sama persis, karena mereka semua
menanyakan Redis yang sama. `sum()` atas N pod akan mengalikan backlog dengan N, dan autoscaler-mu
akan berakselerasi ke maxReplicas karena kesalahan aritmetika.

**realtime → KEDA on socket count.** CPU buta di sini justru karena tier ini sehat: socket tracking
mengirim sekitar satu frame per lima detik, jadi seribu socket yang menganggur nyaris tidak terlihat
di CPU sementara mereka menghabiskan FD dan heap. Dua keputusan yang sangat spesifik-domain menyertai
ini: `restoreToOriginalReplicaCount: false` (kalau ScaledObject dihapus atau direkonsiliasi, KEDA
**tidak boleh** menyentak Deployment kembali ke baseline — itu akan memutus semua klien serentak),
dan scale-down super konservatif (satu pod per 120 detik dengan jendela stabilisasi 600 detik).

**Anchor:** `k8s/base/api-hpa.yaml:12-18` — metrik CPU 65%; `k8s/base/api-hpa.yaml:19-30` — blok
`behavior` asimetris dengan kedua komentarnya;
`k8s/base/worker-scaledobject.yaml:1-10` — penjelasan panjang kenapa Prometheus dan bukan scaler
Redis native, plus peringatan *"KEDA creates and OWNS the HPA 'keda-hpa-drovery-worker' … do NOT
also define an HPA targeting drovery-worker"*;
`k8s/base/worker-scaledobject.yaml:24-27` — `fallback` yang menahan 3 replika kalau Prometheus tak
terjangkau tiga kali berturut-turut; `k8s/base/worker-scaledobject.yaml:43-56` — trigger Prometheus
dengan `threshold: '50'` per replika, `ignoreNullValues`, dan query
`max(drovery_queue_jobs{...state="waiting"}) + max(drovery_queue_jobs{...state="delayed"})`;
`k8s/base/worker-scaledobject.yaml:51-53` — komentar `max()` vs `sum()`;
`k8s/base/realtime-scaledobject.yaml:1-5` — kenapa bukan CPU;
`k8s/base/realtime-scaledobject.yaml:22-26` — `restoreToOriginalReplicaCount: false` dan alasannya;
`k8s/base/realtime-scaledobject.yaml:34-40` — scale-down 1 pod per 120 s / window 600 s;
`k8s/base/realtime-scaledobject.yaml:46-47` — `threshold: '20000'` dengan perintah jujur untuk
memakukannya ke *"a measured sockets-per-node knee (a ws soak test), not a guess"*;
`k8s/base/realtime-scaledobject.yaml:50-57` — kenapa query menjumlahkan **dua** gauge
(`drovery_ws_connections` + `drovery_ws_support_connections`);
`src/metrics/metrics.service.ts:135-140` dan `:147-152` — definisi kedua gauge itu;
`src/metrics/metrics.service.ts:338-343` — definisi `drovery_queue_jobs` dengan label `queue`+`state`.

**Kenapa dipakai di sini:** aturan `max()` bukan hanya berlaku untuk KEDA — ia muncul lagi di alert.
`observability/alerts.yml:46-52` memakai ekspresi PromQL yang **identik** untuk
`DroveryQueueBacklog`, dengan komentar yang menyatakan alasan yang sama dan menambahkan konteks
*"KEDA scales at 50 waiting/replica up to 20 replicas → alert near the ceiling."* Jadi alert dan
autoscaler membaca sinyal yang sama, dan itu disengaja: kalau autoscaler sudah mentok, alert
berbunyi. Ada juga peringatan lanjutan di `SCALING-1M.md:249-252` yang layak dibaca sekarang: jutaan
tick posisi masa depan hidup di delayed-set BullMQ, jadi pada skala besar kamu perlu memastikan
`ScaledObject` tidak sekadar mengikuti backlog **simulasi** dan mengira itu beban nyata.

**Alternatif:**
- **HPA CPU di semua tier.** Satu mekanisme, tidak perlu memasang KEDA sama sekali. Harganya
  spesifik per tier: worker akan tampak idle (CPU rendah) tepat saat antrian menumpuk, karena job-nya
  sedang **menunggu** Redis, bukan menghitung; dan realtime akan di-*churn* naik-turun oleh lonjakan
  create-RPS yang tidak ada hubungannya dengan jumlah socket — dan setiap scale-down memutus ribuan
  klien.
- **HPA custom metrics lewat prometheus-adapter, tanpa KEDA.** Bisa scale on queue depth dengan
  komponen yang lebih sedikit konsepnya. Harganya konkret: kamu mengelola API aggregation layer
  sendiri (APIService `custom.metrics.k8s.io`), menulis aturan mapping metrik di ConfigMap adapter,
  dan kamu tidak mendapat scale-to-zero maupun `fallback` — dua hal yang di sini dipakai
  (`k8s/base/worker-scaledobject.yaml:24-27`).
- **Cluster Autoscaler atau Karpenter.** Sering dikira alternatif; sebenarnya **komplementer**.
  HPA/KEDA menambah **pod**, Cluster Autoscaler menambah **node** ketika pod tidak muat. Harganya:
  tanpa keduanya, HPA-mu akan menjadwalkan pod yang `Pending` selamanya di cluster yang penuh —
  autoscaling yang tidak menghasilkan kapasitas.
- **Scaling manual (`kubectl scale`).** Prediktabel dan gratis. Harganya: gagal tepat saat trafik
  puncak, yaitu saat kamu paling tidak siap. Menariknya, ini justru yang **direkomendasikan** overlay
  loadtest (`k8s/overlays/loadtest/kustomization.yaml:33-35`) — karena untuk eksperimen A/B,
  prediktabilitas lebih berharga daripada responsivitas.

**Latihan:** Ini latihan dua bagian; keduanya masuk capstone.
(a) HPA: dengan overlay local dan metrics-server aktif, jalankan `kubectl -n drovery get hpa -w` lalu
tembak Ingress dengan k6 atau `hey`. **Verifikasi:** kolom TARGETS naik melewati 65% dan REPLICAS
bertambah, mentok di 4 (patch `k8s/overlays/local/kustomization.yaml:20-23`).
(b) KEDA: pasang KEDA + Prometheus di cluster, buat backlog dengan membuat beberapa delivery, lalu
jalankan query PromQL **yang persis sama** dengan yang ada di `k8s/base/worker-scaledobject.yaml:54-56` di UI
Prometheus. **Verifikasi:** angka yang kamu lihat di Prometheus harus cocok dengan
`kubectl -n drovery get scaledobject drovery-worker -o yaml` bagian status, dan jumlah replika worker
harus mendekati `ceil(backlog / 50)`. Terakhir, ganti `max(` jadi `sum(` di query Prometheus (di UI
saja, jangan di file) dan lihat angkanya melonjak sebanyak jumlah pod — itu bug yang komentar
`:51-53` mencegah.

---

### 11.13 PodDisruptionBudget: untuk disruption **sukarela**, yang tidak diatur `behavior` HPA

Ini konsep kecil yang gampang dilewati, dan lubang yang ditutupinya nyata. `behavior` di HPA/KEDA
mengatur seberapa cepat **autoscaler** mengubah jumlah replika. Ia tidak mengatur apa pun tentang
kejadian lain yang juga menghapus pod: node di-drain untuk maintenance, cluster-autoscaler
mengecilkan node pool, upgrade node bergulir. Kejadian-kejadian itu disebut **voluntary disruption**,
dan tanpa PDB, scheduler boleh mengusir semua pod sebuah Deployment sekaligus.

Untuk tier realtime, itu berarti seluruh armada socket putus serentak — persis skenario yang
seluruh konfigurasi scale-down konservatif di 11.12 berusaha hindari. Menyetel scale-down pelan
tapi lupa PDB adalah menutup pintu depan dan membiarkan pintu belakang terbuka.

Perhatikan bahwa dua PDB di repo ini memakai **field yang berbeda**, dan itu disengaja.

**Anchor:** `k8s/base/api-pdb.yaml:6-9` — `minAvailable: 1` dengan peringatan penting
*"Must stay BELOW the running replica count or voluntary evictions wedge — keep api replicas >= 2
wherever this PDB is active"*; `k8s/base/realtime-pdb.yaml:1-4` — komentar yang menyatakan cakupan
PDB (*"the HPA behavior block governs KEDA scaling, NOT node-level evictions"*) dan alasan memilih
`maxUnavailable` (*"scales sensibly with the KEDA-driven replica count"*);
`k8s/overlays/prod/kustomization.yaml:16-18` — patch yang menaikkan PDB api ke `50%` di produksi.

**Kenapa dipakai di sini:** perbedaan `minAvailable` vs `maxUnavailable` bukan gaya. `minAvailable: 1`
adalah angka absolut: kalau replika turun ke 1 (misalnya HPA menurunkannya di jam sepi), PDB akan
**memblokir semua eviction** dan `kubectl drain` akan menggantung selamanya — itu arti kata "wedge"
di komentarnya. `maxUnavailable: 1` bersifat relatif: berapa pun jumlah replikanya, satu boleh
pergi. Untuk tier yang jumlah replikanya digerakkan KEDA dan bisa berkisar dari 1 sampai 50,
`maxUnavailable` adalah pilihan yang tidak bisa mengunci dirinya sendiri.

**Alternatif:**
- **Tanpa PDB sama sekali.** Satu objek lebih sedikit, dan untuk tier yang benar-benar stateless
  dengan retry klien yang baik, sering tidak apa-apa. Harganya spesifik untuk realtime: satu
  `kubectl drain` pada node yang kebetulan menampung tiga pod realtime memutus tiga pod-worth socket
  serentak, dan reconnect serentak itu bisa menjatuhkan pod yang tersisa.
- **PDB dengan `minAvailable: 100%`.** Menjamin nol disruption sukarela. Harganya konkret dan sering
  mengejutkan: `kubectl drain` menjadi **mustahil**, upgrade node terhenti, dan cluster-autoscaler
  tidak bisa mengecilkan node pool sama sekali — kamu menukar ketersediaan dengan
  ketidakmampuan memelihara cluster.
- **Mengandalkan `terminationGracePeriodSeconds` panjang saja.** Ini yang sering dikira cukup. Grace
  period membuat tiap pod mati dengan **sopan**; ia tidak membatasi **berapa banyak** pod yang mati
  bersamaan. Dua mekanisme berbeda untuk dua pertanyaan berbeda; kamu butuh keduanya.

**Latihan:** Di kind, jalankan `kubectl -n drovery get pdb` dan baca kolom `ALLOWED DISRUPTIONS`.
**Verifikasi:** dengan `replicas: 2` untuk api dan `minAvailable: 1`, angkanya harus `1`. Sekarang
`kubectl -n drovery scale deploy/drovery-api --replicas=1` dan periksa lagi — angkanya jadi `0`, dan
`kubectl drain` pada node itu akan menggantung. Itulah "wedge" yang diperingatkan
`k8s/base/api-pdb.yaml:7-8`, terlihat langsung. Kembalikan ke 2.

---

### 11.14 Validasi manifest di CI: kubeconform offline plus kind `--dry-run=server` untuk menangkap CRD KEDA

YAML Kubernetes gampang salah dan kesalahannya sering baru muncul saat `apply` ke cluster nyata —
yaitu saat paling mahal. Repo ini memakai **dua lapis** dengan pembagian tugas yang eksplisit, dan
pembagian itu sendiri yang jadi pelajarannya.

Lapis pertama, **kubeconform**: validasi schema offline, cepat, dijalankan atas hasil
`kubectl kustomize` setiap overlay. Ia tahu bentuk `Deployment`, `Service`, `HorizontalPodAutoscaler`
bawaan Kubernetes. Yang ia **tidak** tahu adalah CRD pihak ketiga — dan `ScaledObject` milik KEDA
persis itu. Jadi ia di-`-skip`.

Lapis kedua, **kind + `kubectl apply --dry-run=server`**: menyalakan cluster sungguhan sekali pakai,
memasang CRD KEDA, lalu mengirim manifest ke API server asli untuk divalidasi **admission**-nya
tanpa benar-benar membuat objek. Ini yang menangkap `ScaledObject` yang lolos lapis pertama.

Yang bagus dari desain ini: kedua lapis **saling menyebut**. Komentar di tempat `-skip ScaledObject`
langsung menunjuk siapa yang menutupi celah itu, jadi orang yang membacanya tidak menyimpulkan
"ScaledObject tidak divalidasi".

**Anchor:** `.github/workflows/manifests.yml:3-8` — filter `paths: ['k8s/**', ...]` supaya workflow
hanya jalan saat manifest berubah; `.github/workflows/manifests.yml:11-35` — job `schema` yang
merender tiap overlay lalu memanggil kubeconform;
`.github/workflows/manifests.yml:28-33` — komentar `-skip ScaledObject` yang menunjuk job kedua
(*"KEDA's CRD schema isn't in the default set; the kind dry-run job validates it against the
installed CRDs instead"*); `.github/workflows/manifests.yml:37-56` — job `dryrun` dengan
`needs: schema`; `.github/workflows/manifests.yml:47-48` — pemasangan CRD KEDA sebelum dry-run;
`.github/workflows/manifests.yml:51-52` — namespace dibuat lebih dulu karena objek namespaced butuh
namespace-nya ada untuk server dry-run; `k8s/README.md:68-69` — kalimat penutup yang mengunci
lingkarannya: setiap overlay memang divalidasi di CI.

**Kenapa dipakai di sini:** perhatikan `needs: schema` di `:39`. Urutan ini hemat: kalau ada typo
sederhana, job kedua yang mahal (menyalakan cluster kind) tidak pernah jalan. Ini pola CI yang
umum dan layak ditiru — taruh gerbang yang murah dan cepat lebih dulu.

**Alternatif:**
- **`kubectl apply --dry-run=client`.** Paling cepat dan tidak butuh apa pun. Harganya konkret: ia
  hanya memeriksa YAML bisa di-parse dan struktur dasarnya; field yang **tidak dikenal** lolos diam-
  diam. `replicas: two` akan tertangkap (tipe salah), tapi `raplicas: 2` (typo nama field) tidak.
- **`kubeval`.** Pendahulu kubeconform dengan antarmuka mirip. Harganya: sudah tidak dirawat aktif,
  jadi schema untuk versi Kubernetes baru tidak tersedia, dan ia lebih lambat karena mengunduh
  schema per-run tanpa cache yang baik.
- **OPA/Gatekeeper atau Kyverno.** Ini bukan pengganti melainkan lapis **ketiga**: validasi
  *kebijakan*, bukan schema — misalnya "setiap pod harus `runAsNonRoot`", "setiap Deployment harus
  punya `resources.requests`". Harganya: satu komponen lagi di cluster (Kyverno berjalan sebagai
  admission webhook, jadi ia ada di jalur kritis setiap apply). Untuk repo ini, ini langkah lanjut
  yang wajar — perhatikan bahwa aturan `resources.requests.cpu` wajib (11.9) adalah kandidat
  sempurna untuk kebijakan Kyverno.

**Latihan:** Jalankan lapis pertama secara lokal:
`kubectl kustomize k8s/overlays/local > /tmp/local.yaml` lalu
`kubeconform -strict -summary -skip ScaledObject /tmp/local.yaml`. **Verifikasi:** hijau. Sekarang
buat dua kesalahan berbeda dan bandingkan reaksinya: (1) ubah
`k8s/base/api-deployment.yaml:7` jadi `replicas: two`, jalankan ulang — kubeconform harus menolak;
(2) kembalikan, lalu ubah `k8s/base/worker-scaledobject.yaml:48` jadi `treshold: '50'` (typo di
dalam CRD KEDA), jalankan ulang — kubeconform akan **lolos**, dan hanya `--dry-run=server` dengan
CRD terpasang yang menangkapnya. Tulis satu kalimat yang menjelaskan kenapa.

---

### 11.15 (bab baca) Sharding sebagai tuas terakhir: hard blocker-nya adalah `$transaction` lintas shard, bukan kode router

Konsep ini **tidak untuk dikerjakan**. Ia untuk dibaca, dipahami, dan disimpan. Alasannya: ini
keputusan arsitektur paling dewasa di repo, dan bentuknya bukan teknologi melainkan **urutan**.

Temuan capacity model-nya kontra-intuitif dan dinyatakan terang: pada 2 juta DAU dengan beban
murni simulasi, semuanya masih muat di satu shard database. Yang memaksa shard pertama kali bukan
DAU mentah, melainkan **firehose telemetri drone LIVE** — hasil kali `liveSharePct × liveFrameHz`.
Karena itu yang dibangun duluan adalah hot-store posisi di Redis + checkpoint batch (L1), yang
**menunda** sharding, bukan router shard (L2). Kalimatnya: *"Sharding is the last lever, not the
first."*

Dan blok yang paling berharga adalah **HARD BLOCKER**-nya. `create()` di Drovery menjalankan satu
`$transaction` yang meng-commit bersama: baris `delivery` (berakar pada shard-delivery) plus
`wallet.debit`, `promo.redeem`, `referral.grant` (berakar pada shard-user). Satu `$transaction`
Prisma **tidak bisa melintasi shard**. Jadi `ShardRouter` bukan flag inert: mendaratkannya lalu
menyalakan `shardCount>1` akan **merusak saldo**. Kalimat penutupnya adalah pelajaran yang bisa kamu
bawa ke proyek mana pun: *"This refactor — not the router code — is the real Phase-3 work."*

Pekerjaan yang benar-benar sulit sering kali bukan yang terlihat sulit.

**Anchor:** `SCALING-1M.md:8-13` — peringatan ILLUSTRATIVE yang harus kamu baca sebelum apa pun;
`SCALING-1M.md:63-89` — tabel *"Built + verified in this PR"* vs *"Designed here, built later"*,
masing-masing dengan kolom Verified dan Prerequisite (ini contoh paling murni dari dokumen yang
menolak over-claim); `SCALING-1M.md:102-105` — L1 (offload firehose posisi) dan kalimat
*"Sharding is the last lever, not the first."*; `SCALING-1M.md:106-109` — L2 (`ShardRouter` tipis di
**atas** `prisma.service.ts`); `SCALING-1M.md:111-115` — blok HARD BLOCKER;
`SCALING-1M.md:117-121` — panel desain yang memilih **debit-first saga** dan menuliskan yang
**ditolak** beserta alasannya, ditutup daftar KILLER RISKS;
`SCALING-1M.md:246-248` — ceiling PgBouncer yang dihitung eksplisit
(*"floor((1000 − workerNodes×5)/10) ≈ 94 api nodes on one pooler"*, dengan resep satu pooler per
write-shard); `SCALING-1M.md:280-283` — rekomendasi hash-sharding dulu, geo-sharding hanya kalau
residensi data benar-benar dituntut.

**Kenapa dipakai di sini:** angka 94 node di `:246-248` adalah penutup lingkaran dari Fase 10.
Kamu sudah tahu `MAX_CLIENT_CONN: 1000` dan `DEFAULT_POOL_SIZE: 20` di `docker-compose.yml:43-44`,
dan `DATABASE_POOL_MAX: 10` untuk api (`docker-compose.yml:102`) vs `5` untuk worker (`:129`).
Sekarang kamu bisa menghitung sendiri kapan pooler jadi ceiling, dan jawabannya bukan "entah
kapan" melainkan sebuah bilangan yang bisa kamu cek. Itu bentuk pengetahuan yang berbeda.

**Alternatif:**
- **Citus / Aurora Limitless / CockroachDB / Spanner.** Distribusi transparan: SQL lintas-shard tetap
  jalan, jadi HARD BLOCKER di atas hilang sepenuhnya. Repo mencatatnya sebagai jalur yang wajar
  nanti. Harganya konkret: kunci ke platform, dan perilaku transaksi yang berbeda (Cockroach memakai
  serializable dengan retry, jadi pola CAS dari Fase 5 harus ditinjau ulang).
- **Shard duluan, benahi transaksi belakangan.** Paling cepat terlihat "scalable" dan paling menggoda
  saat ada tekanan. Harganya dinyatakan langsung di repo: saldo rusak. Bukan "mungkin bermasalah" —
  `wallet.debit` yang commit di shard user sementara `delivery` gagal commit di shard delivery
  menghasilkan uang yang hilang tanpa jejak.
- **Geo-sharding lebih dulu.** Masuk akal kalau ada kewajiban residensi data. Harganya:
  `SCALING-1M.md:280-283` merekomendasikan hash dulu karena hash memberi distribusi merata tanpa
  matematika rebalancing, sementara geo memberi distribusi yang mengikuti populasi — artinya
  hot-shard di kota besar, dan pekerjaan rebalancing yang tidak pernah selesai.

**Latihan:** Baca §2 dan §3 `SCALING-1M.md`, lalu gambar di kertas urutan langkah debit-first saga
(A1 → A2 → A3) dan tandai, untuk **setiap** langkah, titik crash mana yang meninggalkan reservasi
yatim dan siapa yang membersihkannya. **Verifikasi:** cocokkan gambarmu dengan kode nyata di
`src/deliveries/orphan-reaper/`. Kalau ada langkah yang tidak punya pembersih di kode, kamu salah
membaca — atau kamu menemukan sesuatu yang layak dicatat.

---

### 11.16 Peta alternatif: kapan pilihan repo ini salah untukmu

Setiap konsep di atas sudah punya bagian Alternatif sendiri. Subbagian ini adalah **ringkasan
keputusan** — bukan pengulangan, melainkan satu tabel yang bisa kamu bawa ke proyek berikutnya
ketika konteksnya berbeda dari Drovery. Nilai fase ini bukan "pakai KEDA", tapi bisa menjawab
"kapan tidak".

| Keputusan repo | Alternatif utama | Ambang pindah yang konkret |
|---|---|---|
| k6 (`loadtest/scenario.js`) | JMeter, Artillery, Locust, `autocannon` | Pindah ke `autocannon`/`wrk` kalau yang diuji **satu endpoint tanpa auth**. Tetap di k6 begitu journey punya ≥2 langkah dengan token — itu yang memunculkan temuan bcrypt |
| `cpus` quota (`docker-compose.nodes.yml:52`) | `cpuset` pinning, VM terpisah | Pindah ke VM/mesin terpisah begitu kamu perlu mengukur NIC hop atau NUMA — diakui hilang di `loadtest/README.md:155-157` |
| Kustomize | Helm, jsonnet/cdk8s, YAML mentah | Pindah ke Helm begitu kamu butuh **hook ordering asli** (migrate Job) atau mendistribusikan chart ke pihak lain. Anotasi hook sudah tersedia di `k8s/base/migrate-job.yaml:11-13` |
| KEDA | prometheus-adapter, HPA CPU saja, scaling manual | Tetap di HPA CPU kalau semua tier-mu CPU-bound. Pindah ke KEDA begitu ada satu tier yang habis pada sumber daya lain (antrian, socket, lag consumer) |
| HPA + KEDA (pod) | Cluster Autoscaler / Karpenter (node) | Bukan pilihan — **keduanya** dibutuhkan. Tanpa autoscaler node, HPA menghasilkan pod `Pending` di cluster penuh |
| Tanpa VPA | VPA untuk menyetel `requests` | Jangan pasang VPA pada Deployment yang sama dengan HPA-CPU: keduanya bergerak di metrik yang sama dan saling mengejar |
| kubeconform + kind dry-run | kubeval, `--dry-run=client`, OPA/Kyverno | Tambahkan Kyverno (bukan ganti) begitu kamu punya aturan organisasi seperti "semua Deployment wajib `resources.requests`" |
| Kubernetes | Swarm, Nomad, tetap Compose 1 VPS | Tetap di Compose sampai kamu butuh (a) bertahan saat satu host mati, atau (b) scaling yang bergerak tanpa kamu di depan laptop. `DEPLOY.md:148` menyebut ambang ini sendiri: *"for real multi-node, see `k8s/` (HPA + KEDA)"* |

**Anchor:** `k8s/README.md:45-49` — daftar eksplisit apa yang **sengaja tidak ada** di manifest ini
(Postgres/PgBouncer/Redis dan add-on cluster), yang adalah pernyataan batas ruang lingkup;
`k8s/README.md:51-66` — lima gotcha yang dipilih repo sebagai "the ones that actually bite", yaitu
daftar prioritas versi penulisnya sendiri; `SCALING-1M.md:63-89` — tabel ships-vs-designs yang
memisahkan apa yang sudah terbukti dari apa yang baru dirancang.

**Kenapa dipakai di sini:** repo ini konsisten menuliskan **yang ditolak** berikut alasannya, bukan
hanya yang dipilih. Itu keterampilan membaca yang paling bernilai dari seluruh materi ini: sebelum
mempercayai klaim mana pun di dokumen ini, cek penanda statusnya, cek bagian
`### Left undone / follow-ups` di `AUDIT-LOG.md`, lalu cek kodenya.

**Alternatif:** untuk cara **merekam** keputusan seperti tabel di atas, ada dua bentuk lain yang
lazim. **ADR (Architecture Decision Records)** — satu file bernomor per keputusan dengan status
`proposed/accepted/superseded`; lebih mudah di-diff dan di-supersede, tapi kehilangan narasi lintas
keputusan yang di sini justru intinya (alasan menunda sharding hanya masuk akal kalau §2 dan §3
dibaca berurutan). **Wiki/Notion** — mudah diedit siapa pun, tapi tidak ikut di-review di PR dan
tidak punya `git blame`, jadi klaim yang salah tidak akan pernah ketahuan lewat commit.

**Latihan:** Ambil satu baris dari tabel di atas dan tulis 5 kalimat yang mempertahankan
**alternatifnya** untuk sebuah proyek hipotetis milikmu sendiri (misalnya: aplikasi internal 200
pengguna, satu VPS, tanpa tim ops). **Verifikasi:** kalau argumenmu berakhir di "tergantung
kebutuhan", ulangi — setiap kalimat harus menyebut angka, batasan, atau kegagalan konkret.

---

## Capstone

Dua deliverable. Keduanya berbentuk perilaku yang bisa gagal di depan matamu.

**Deliverable 1 — bukti scaling di satu kotak.**

- [ ] `sudo bash loadtest/sweep.sh` selesai untuk api=1, 2, 3 dengan `NODES=1` dan menghasilkan tabel
      akhir berisi kolom `total req/s`, `per-node req/s`, dan `scaling`.
- [ ] Kamu menuliskan satu paragraf **verdict**: tier mana yang mengikat lebih dulu, dan **apa
      buktinya** dari tabel itu (per-node datar = belum ada yang mengikat; per-node turun = ada tier
      bersama yang jadi ceiling). Paragraf yang menyebut "kelihatannya" tanpa merujuk angka = gagal.
- [ ] Satu run ulang dengan `loadtest/nginx.conf:16-17` diganti `proxy_pass http://api:3000;`
      literal, dengan bukti bahwa distribusi request jatuh ke satu container — memperlihatkan
      "scaling" palsu yang akan kamu simpulkan kalau tidak tahu jebakan resolver.
- [ ] Satu run dengan `LOADTEST_BYPASS_THROTTLE` dimatikan, memperlihatkan bahwa 2 replika terlihat
      identik dengan 1 (dan `http_req_failed` naik karena 429).
- [ ] `node loadtest/capacity-model.mjs --perNodeIoRps=<angka dari sweep-mu>` dijalankan, dan baris
      `VERDICT:`-nya kamu bandingkan dengan hasil default. Kamu bisa menunjuk mana angka yang kamu
      **ukur** dan mana yang masih `FILL FROM RUN`.

**Deliverable 2 — cluster kind hidup dengan overlay `local`.**

- [ ] `kubectl -n drovery wait --for=condition=complete job/drovery-migrate --timeout=180s` kembali
      hijau, **dan** kamu punya bukti (log) dari percobaan sebelumnya tanpa `wait` yang menunjukkan
      pod api error karena tabel belum ada.
- [ ] Ketiga tier `Running`: `kubectl -n drovery get pods -l app=drovery` menampilkan api, worker,
      dan realtime.
- [ ] HPA bergerak: `kubectl -n drovery get hpa -w` menunjukkan TARGETS naik melewati 65% saat
      Ingress ditembak beban, dan REPLICAS bertambah sampai mentok 4.
- [ ] KEDA menaikkan worker mengikuti queue depth, **dan** kamu memverifikasinya dengan menjalankan
      query PromQL yang **persis sama** dengan `k8s/base/worker-scaledobject.yaml:54-56` di UI
      Prometheus — angka di kedua tempat harus cocok.
- [ ] CrashLoopBackOff worker direproduksi dengan sengaja: sebuah probe `httpGet` dipasang ke worker,
      pod masuk `CrashLoopBackOff`, `kubectl describe` menunjukkan probe yang gagal, lalu probe itu
      dicabut dan pod kembali `Running`. Simpan output `describe`-nya.
- [ ] `kubeconform -strict -summary -skip ScaledObject` hijau untuk **ketiga** overlay
      (`local`, `prod`, `loadtest`), dan `kubectl apply --dry-run=server` (dengan CRD KEDA terpasang)
      juga hijau untuk ketiganya.
- [ ] Bonus yang layak dikerjakan: ubah satu literal di `k8s/base/kustomization.yaml` dan buktikan
      pod ter-roll otomatis karena sufiks hash ConfigMap berubah — lalu buktikan sebaliknya dengan
      mengedit ConfigMap langsung via `kubectl edit` dan melihat pod **tidak** bergerak.

---

## Gerbang keluar

Kalau salah satu dari ini belum bisa kamu jawab tanpa membuka kode, jangan lanjut ke Fase 12.

**1. Kenapa `--scale api=3` bisa tidak menaikkan throughput sama sekali, padahal ketiga container
benar-benar hidup dan sehat? Sebutkan dua penyebab yang berbeda.**

<details><summary>Jawaban</summary>

(a) nginx me-resolve `api` **sekali saat startup** kalau host ditulis literal di `proxy_pass`, jadi
semua request jatuh ke satu IP. Fix-nya memakai variabel + `resolver 127.0.0.11`
(`loadtest/nginx.conf:1-4`, `:11`, `:16-17`).
(b) Rate limiter global disimpan di **Redis dan dibagi antar replika**, jadi k6 dari satu IP menabrak
limit yang sama berapa pun jumlah replikanya — *"2 replicas would show the SAME throughput as 1"*
(`src/common/guards/loadtest-throttle.guard.ts:7-15`). Fix-nya `LOADTEST_BYPASS_THROTTLE=true` pada
`NODE_ENV` non-produksi.
</details>

**2. Kenapa `cpus` benar dan `cpuset` salah untuk uji scaling, dan kenapa memori justru diberi
headroom alih-alih dibatasi ketat?**

<details><summary>Jawaban</summary>
`cpus` adalah **quota** waktu CPU yang boleh ditempatkan scheduler di core mana pun, jadi menambah
replika menambah throughput. `cpuset` **mem-pin** ke daftar core tetap; semua replika akan berbagi
core yang sama, jadi menambah replika hanya menambah kontensi — kurvanya terbalik
(`docker-compose.nodes.yml:18-23`). Memori tidak dibatasi ketat karena cgroup yang kehabisan CPU
hanya di-*throttle*, sementara yang kehabisan memori di-**OOM-kill**; dan `--max-old-space-size` yang
rendah pernah membuat worker crash-loop sampai backlog SIM membeku dengan nol drain
(`docker-compose.nodes.yml:38-47`).
</details>

**3. Sebutkan tiga probe Kubernetes dan **akibat** kegagalan masing-masing. Kenapa worker Drovery
tidak punya probe `httpGet` sama sekali?**

<details><summary>Jawaban</summary>
`startupProbe` gagal → pod di-restart, dan selama ia belum lulus dua probe lain tidak dijalankan
(memberi Prisma+Nest waktu boot, `k8s/base/api-deployment.yaml:38-42`). `readinessProbe` gagal → pod
dikeluarkan dari endpoint Service **tanpa** restart (`:43-48`, menunjuk `/health/ready` yang 503
kalau DB/Redis mati). `livenessProbe` gagal → pod **di-restart** (`:49-53`, menunjuk `/health` yang
hanya membuktikan proses hidup). Worker tidak punya server HTTP di :3000 sama sekali
(`src/common/process-role.ts:19-26`: `IS_HTTP_TIER` false untuk peran worker), jadi probe httpGet akan
**selalu** gagal → CrashLoopBackOff. Diganti `exec` startupProbe (`k8s/base/worker-deployment.yaml:39-48`).
</details>

**4. Kenapa `resources.requests.cpu` wajib ada untuk HPA, dan apa yang terlihat kalau ia hilang?**

<details><summary>Jawaban</summary>
HPA menghitung utilization sebagai `usage / request`. Tanpa `request`, penyebutnya tidak ada; HPA
melaporkan `<unknown>` di kolom TARGETS dan berhenti bekerja **tanpa error apa pun**
(`k8s/base/api-deployment.yaml:57-59` dan `k8s/base/api-hpa.yaml:31-32`). Ini kegagalan diam — autoscaler terpasang
rapi dan tidak pernah menaikkan satu pod pun.
</details>

**5. Kenapa KEDA scaler Redis native tidak dipakai untuk worker, dan kenapa query-nya memakai
`max()` bukan `sum()`?**

<details><summary>Jawaban</summary>
BullMQ menyimpan job **delayed** di sorted set dan hanya **waiting** di list. Scaler
`listLength` melakukan `LLEN` pada list, jadi ia **buta** terhadap backlog delayed — *"which is the
majority of this queue"* (`k8s/base/worker-scaledobject.yaml:3-7`). `max()` dipakai karena gauge
`drovery_queue_jobs` bersifat **queue-global**: setiap replika melaporkan angka yang sama, jadi
`sum()` atas N pod akan mengalikan backlog dengan N dan membuat autoscaler over-scale
(`:51-53`, aturan yang sama muncul di `observability/alerts.yml:46-52`).
</details>

**6. Kenapa tier realtime tidak boleh di-scale dengan CPU, dan apa arti
`restoreToOriginalReplicaCount: false`?**

<details><summary>Jawaban</summary>
Socket tracking panjang-umur mayoritas menganggur (≈1 frame per 5 detik), jadi CPU buta terhadap
ceiling yang sebenarnya: FD, heap, dan event loop (`k8s/base/realtime-scaledobject.yaml:1-5`). Dan lonjakan
create-RPS tidak boleh meng-*churn* node pemegang socket, karena setiap scale-down memutus klien
massal. `restoreToOriginalReplicaCount: false` berarti kalau ScaledObject dihapus atau
direkonsiliasi, KEDA **tidak** menyentak Deployment kembali ke baseline replicas — kalau ia
menyentak, semua klien putus serentak (`:22-26`).
</details>

**7. Anotasi `helm.sh/hook` ada di `migrate-job.yaml`. Kenapa ia tidak menjamin urutan di
lingkungan ini, dan apa gerbang sesungguhnya?**

<details><summary>Jawaban</summary>
Anotasi itu hanya berarti bagi Helm dan ArgoCD; di bawah `kubectl apply -k` ia **inert** — Job dan
Deployment dibuat bersamaan dan pod api bisa boot ke database tanpa tabel
(`k8s/base/migrate-job.yaml:9-14`, komentarnya menyatakannya sendiri). Gerbang sesungguhnya adalah
`kubectl -n drovery wait --for=condition=complete job/drovery-migrate --timeout=180s`
(`k8s/README.md:36-38`).
</details>

**8. Kenapa `PodDisruptionBudget` dibutuhkan padahal HPA sudah punya `behavior` scale-down yang
konservatif? Dan kenapa api memakai `minAvailable` sementara realtime memakai `maxUnavailable`?**

<details><summary>Jawaban</summary>
`behavior` hanya mengatur **autoscaler**; ia tidak mengatur disruption **sukarela** seperti node
drain, upgrade node, atau cluster-autoscaler scale-in — tanpa PDB, scheduler boleh mengusir semua
pod sekaligus (`k8s/base/realtime-pdb.yaml:1-3`). `minAvailable: 1` adalah angka absolut dan akan
**memblokir semua eviction** kalau replika turun ke 1, sehingga `kubectl drain` menggantung —
karena itu ada peringatan menjaga replika api ≥ 2 (`k8s/base/api-pdb.yaml:6-8`). `maxUnavailable: 1` bersifat
relatif dan *"scales sensibly with the KEDA-driven replica count"* (`k8s/base/realtime-pdb.yaml:4`), cocok
untuk tier yang jumlah replikanya bisa 1 sampai 50.
</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| `--scale api=3` tidak menaikkan throughput; semua request sukses, latensi wajar | nginx me-resolve upstream sekali saat startup (`proxy_pass` literal), atau `resolver` hilang | Hitung request per container: `docker compose -f docker-compose.yml -f docker-compose.loadtest.yml logs api \| grep -c health` per container id. Kalau satu container dapat semua, itu jebakan resolver (`loadtest/nginx.conf:1-4`) |
| 2 replika menghasilkan angka **identik** dengan 1 replika, dan ada 429 di ringkasan k6 | Rate limiter Redis dibagi antar replika; bypass tidak aktif karena flag hilang **atau** `NODE_ENV=production` | `docker compose ... exec api printenv NODE_ENV LOADTEST_BYPASS_THROTTLE` — keduanya harus terisi dan `NODE_ENV` harus non-produksi (`src/common/guards/loadtest-throttle.guard.ts:19-27`) |
| Throughput api **turun** saat replika ditambah | `cpuset` dipakai menggantikan `cpus`, atau host benar-benar kehabisan core (budget default over-subscribed di 4 core) | `docker stats --no-stream` saat beban jalan: kalau total CPU% semua container mendekati 400% di kotak 4-core, kamu mengukur kontensi host. Turunkan `API_CPUS` ke 0.4 (`docker-compose.nodes.yml:29-34`) |
| `compose run k6` selesai tapi angkanya jauh lebih rendah dari yang kamu harapkan | `compose run` merekonsiliasi dependensi dan **diam-diam me-rescale api/worker kembali ke 1** | Jalankan `docker compose ps` **saat** k6 berjalan dan hitung container api. Fix-nya `--no-deps`, sudah ada di `loadtest/run.sh:66-79` — jangan menjalankan `compose run` manual tanpanya |
| Antrian SIM membeku persis di jumlah yang di-enqueue, drain nol | Worker crash-loop karena batas memori terlalu ketat atau `--max-old-space-size` terlalu rendah — kejadian nyata yang tercatat | `docker compose ps` cari kolom restart yang bertambah, lalu `docker compose logs worker \| tail -50` cari OOM. Jangan cap heap V8 di overlay nodes (`docker-compose.nodes.yml:38-47`) |
| Pod worker `CrashLoopBackOff` di kind | Probe `httpGet` dipasang ke worker; worker tidak punya server HTTP di :3000 | `kubectl -n drovery describe pod -l role=worker` → cari `Liveness probe failed` / `Readiness probe failed`. Cabut probe httpGet; pakai `exec` (`k8s/base/worker-deployment.yaml:39-48`) |
| Pod api `NotReady` selamanya di kind, tanpa CrashLoop | Postgres/PgBouncer/Redis memang **sengaja tidak ada** di manifest; readiness 503 karena dependensi tak terjangkau | `kubectl -n drovery logs -l role=api \| tail -30` dan `curl` ke `/api/v1/health/ready` dari dalam pod. Ini *"correct behaviour, but easy to misdiagnose"* (`k8s/overlays/local/kustomization.yaml:28-31`) |
| Pod api error "table does not exist" tepat setelah `kubectl apply -k` | Job migrate belum selesai; anotasi hook Helm/Argo **inert** di bawah `kubectl apply -k` | `kubectl -n drovery get job drovery-migrate` — kalau `COMPLETIONS` belum `1/1`, itu penyebabnya. Selalu `kubectl wait` (`k8s/base/migrate-job.yaml:9-14`, `k8s/README.md:36-38`) |
| HPA menampilkan `<unknown>/65%` dan tidak pernah bergerak | `metrics-server` belum terpasang, **atau** `resources.requests.cpu` hilang dari Deployment | `kubectl top pods -n drovery` — kalau error, metrics-server absen (`minikube addons enable metrics-server`). Kalau `top` jalan tapi HPA tetap `<unknown>`, cek `requests.cpu` (`k8s/base/api-hpa.yaml:31-32`) |
| KEDA tidak menaikkan worker meski antrian jelas menumpuk | Prometheus tidak menjangkau/menscrape worker, query tidak cocok label, atau `serverAddress` salah | Jalankan query di `k8s/base/worker-scaledobject.yaml:54-56` langsung di UI Prometheus. Kalau kosong, cek anotasi scrape `k8s/base/worker-deployment.yaml:15-19` dan label `queue` yang harus cocok dengan konstanta `SIM_QUEUE` |
| Replika worker melonjak ke maxReplicas padahal backlog kecil | Query memakai `sum()` alih-alih `max()` — backlog dikalikan jumlah pod | Bandingkan hasil `sum(drovery_queue_jobs{...})` dan `max(...)` di UI Prometheus; selisihnya harus tepat sebesar jumlah pod yang mengekspor gauge (`k8s/base/worker-scaledobject.yaml:51-53`) |
| ConfigMap diubah tapi pod tetap memakai env lama | Perubahan dilakukan lewat `kubectl edit configmap`, bukan lewat `kustomization.yaml` — sufiks hash tidak berubah, jadi Deployment tidak berubah | `kubectl -n drovery get deploy drovery-api -o yaml \| grep drovery-config` dan bandingkan sufiks hash-nya sebelum/sesudah `kubectl kustomize` (`k8s/base/kustomization.yaml:21`) |
| `kubectl drain` menggantung tanpa progres | PDB `minAvailable` sama dengan atau melebihi jumlah replika yang jalan | `kubectl -n drovery get pdb` → kolom `ALLOWED DISRUPTIONS` = 0. Naikkan replika atau turunkan `minAvailable` (`k8s/base/api-pdb.yaml:6-8`) |
| `kubeconform` hijau tapi `kubectl apply` ditolak API server | Typo di dalam CRD KEDA — `ScaledObject` di-`-skip` oleh kubeconform karena schema-nya tidak ada di set default | Jalankan lapis kedua: `kubectl apply --dry-run=server` dengan CRD KEDA terpasang (`.github/workflows/manifests.yml:28-33`, `:47-48`) |

Satu catatan tambahan yang tidak muat di tabel: **kalau mesinmu tidak sanggup**. kind + KEDA +
Prometheus + metrics-server di atas stack Compose butuh RAM yang lumayan, dan `loadtest/run.sh`
butuh Linux dengan `sudo`. Kalau kamu di Windows/macOS dengan 8 GB, jalan keluar yang paling murah
adalah memisahkan minggu 1 (Compose + k6, cukup Docker) dari minggu 2-3 (kind, bisa di VM Linux
kecil atau cluster cloud satu node). Jangan memaksa keduanya jalan bersamaan — kamu akan menghabiskan
waktu men-debug OOM host, bukan belajar autoscaling.

---

## Bacaan pendamping

Semua di `Drovery_Backend`. Baca terhadap tag `curriculum-baseline`, bukan working tree-mu, karena
mulai Fase 3 kamu sudah mengubah repo ini.

- `loadtest/README.md` — baca §"Three scenarios" (`:85-104`) untuk memahami kenapa satu journey
  campuran menyembunyikan kebenaran, lalu §"Sample result" (`:207-229`) untuk melihat angka nyata
  dan kalimat yang menolak "memperbaikinya" dengan melemahkan hash.
- `loadtest/CAPACITY-MODEL.md` — cari bagian *"Why one load-test number lies"* (`:13-29`): satu
  halaman yang mengubah cara kamu membaca setiap angka benchmark selamanya.
- `docker-compose.nodes.yml` — blok komentar `:9-47` adalah teks terpadat di seluruh repo soal
  metodologi pengukuran; baca seluruhnya sekali, pelan.
- `k8s/README.md` — bagian "Gotchas (the ones that actually bite)" (`:51-66`) adalah lima jebakan
  yang dipilih penulisnya sendiri sebagai paling mahal; kalau kamu hanya punya 10 menit, baca ini.
- `k8s/base/worker-scaledobject.yaml` — komentar `:1-10` adalah penjelasan terbaik di repo tentang
  "kenapa sinyal yang kelihatan benar bisa buta".
- `SCALING-1M.md` — §1 (`:63-89`) untuk melihat bagaimana sebuah dokumen memisahkan yang sudah
  terbukti dari yang baru dirancang; §2 (`:93-121`) untuk HARD BLOCKER sharding.
- `observability/alerts.yml` — `:46-52` untuk melihat alert dan autoscaler membaca sinyal yang sama
  persis, dengan aturan `max()` yang sama.
- `loadtest/RESULTS-host-load.md` — hasil run docker-free dengan semua flag skala menyala
  (`:17-30`); berguna sebagai pembanding kalau angka Compose-mu terasa aneh.
- `AUDIT-LOG.md` — cari bagian `### Left undone / follow-ups` pada increment yang menyentuh
  `k8s/` atau `loadtest/`; di situ tertulis apa yang **diakui** belum selesai.

Dokumentasi resmi, hanya kalau benar-benar perlu:

- [Kubernetes — Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
  — untuk tabel field probe yang lengkap; konsepnya sudah kamu dapat dari 11.7.
- [KEDA — Prometheus scaler](https://keda.sh/docs/latest/scalers/prometheus/) — untuk daftar field
  `metadata` yang tersedia di trigger.
- [Kustomize — generatorOptions](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/generatoroptions/)
  — khusus untuk `disableNameSuffixHash` yang disebut `k8s/overlays/prod/kustomization.yaml:26-28`.

---

**Berikutnya:** Fase 12 — kirim satu fitur nyata menembus tiga repo (backend → admin console →
mobile), dengan proses repo-nya sendiri: spec, acceptance criteria berupa perilaku, mutation
testing sebelum merge, dan entri `AUDIT-LOG.md` yang tidak pernah ditulis ulang. Setelah tiga fase
ops berturut-turut, itu akan terasa seperti pulang.

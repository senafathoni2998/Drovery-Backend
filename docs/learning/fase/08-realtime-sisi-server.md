# Fase 8 — Realtime dari sisi server: socket, fan-out lintas replika, backpressure

> **Durasi** ~2,5 minggu (~33 jam) · **Mode** bedah (repo asli) · **Repo** `Drovery_Backend` (utama) · `Drovery_Mobile` + `Drovery_Admin` dibaca sebagai klien pembanding
>
> Semua anchor merujuk ke tag git `curriculum-baseline`. Kalau kamu sudah mengubah repo di fase
> sebelumnya, baca anchor terhadap tag itu: `git show curriculum-baseline:src/main.ts | less`.

---

## Kenapa fase ini ada di sini

Kamu sudah pernah memakai WebSocket — dari sisi klien. `new WebSocket(url)`, `onmessage`,
reconnect kalau putus. Di dunia itu ada satu server (abstrak, jauh, "backend") dan satu socket.
Model mental itu **tidak salah**, tapi ia menyembunyikan seluruh masalah yang jadi isi fase ini.
Masalahnya cuma satu kalimat: **update dihitung di proses A, socket-nya dipegang proses B.**

Fase ini datang tepat setelah Fase 6 dan Fase 7 karena keduanya menciptakan masalah itu. Di Fase 6
kamu memisahkan proses: `PROCESS_ROLE` menentukan potongan mana dari `AppModule` yang hidup, dan
`SimulationProcessor` pindah ke worker. Di Fase 7 kamu melihat siapa yang benar-benar **menghitung**
perubahan posisi dan status — worker (simulasi) dan ingest telemetry (drone LIVE). Sekarang lihat
akibatnya: worker tidak punya HTTP server sama sekali (`NestFactory.createApplicationContext`, ingat?),
jadi ia **secara fisik tidak bisa** mengirim frame ke klien. Sementara klien tersambung ke satu dari N
replika api yang dipilih load balancer secara acak. Tanpa jembatan, klien A tidak akan pernah tahu
drone-nya bergerak.

Yang mustahil dipahami tanpa fase ini bukan "cara bikin gateway WebSocket di NestJS" — itu 30 baris.
Yang mustahil adalah **empat properti operasional** yang hanya muncul kalau socketnya hidup berjam-jam
di server yang di-scale:

1. **Fan-out lintas proses.** Redis Pub/Sub bukan hiasan arsitektur; tanpa itu WebSocket di sistem
   multi-replika hanya berfungsi di dev (satu proses, semuanya kebetulan ada di tempat yang sama).
2. **Langganan yang bisa mati diam-diam.** Satu kedipan Redis pernah membuat klien "tersambung tapi
   tuli seumur hidup socket-nya". Bug ini nyata, tercatat, dan diperbaiki di repo ini.
3. **Klien lambat bisa membunuh pod.** Ini konsep yang paling asing buat orang frontend, karena di
   browser `bufferedAmount` naik lalu tab-mu yang lambat — di server, buffer yang tumbuh tanpa batas
   memakan heap Node dan yang mati adalah pod beserta 20.000 socket **orang lain**.
4. **Mematikan proses adalah peristiwa yang punya UX.** `close(1001)` vs `1006` menentukan apakah
   deploy-mu mulus atau menghasilkan badai reconnect.

Satu catatan urutan: Fase 9 (Observability) baru mengajarkan Prometheus dengan benar. Fase ini
**memakai** dua metrik (`drovery_ws_connections`, `drovery_ws_dropped_frames_total`) semata sebagai
alat ukur — cukup `curl` + `grep`. Kalau dibalik, kamu belajar metrik tanpa punya satu pun fenomena
menarik untuk diukur.

---

## Gerbang masuk

Kamu siap masuk fase ini kalau kamu bisa:

- [ ] Menjalankan dua proses berdampingan — `PROCESS_ROLE=api npm run start:dev` dan
      `PROCESS_ROLE=worker npm run worker` — lalu **menunjukkan di terminal mana** baris
      `Delivery ... → PICKED_UP` muncul, dan menjelaskan kenapa di situ.
- [ ] Menyebutkan dari ingatan apa yang dilakukan `IS_HTTP_TIER`, `IS_WORKER_TIER`, dan
      `IS_INGEST_TIER`, serta kenapa ketiganya konstanta yang dibaca **saat import**, bukan lewat
      `ConfigService`.
- [ ] Menjelaskan kenapa `worker.ts` memakai `NestFactory.createApplicationContext` dan apa yang
      hilang karenanya.
- [ ] Menunjuk baris di `simulation.processor.ts` tempat CAS (`updateMany` + `if (count === 0) return`)
      terjadi, dan menjelaskan kenapa transisi status **di-commit lebih dulu** sebelum efek samping.
- [ ] Membuka satu delivery lewat `GET /api/v1/deliveries/:id`, membaca `tracking` di dalamnya, dan
      menyebutkan proses mana yang menulis `droneLat`/`droneLng` ke sana.
- [ ] Menjalankan `redis-cli` terhadap Redis lokalmu dan melihat isi salah satu key BullMQ
      (`redis-cli ZRANGE bull:delivery-simulation:delayed 0 -1 WITHSCORES`).

Kalau butir ke-2 atau ke-4 masih perlu buka kode, kembali dulu ke Fase 6. Seluruh fase ini bersandar
pada "provider mana hidup di proses mana".

---

## Peta jalan mingguan

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| 1 | Gateway `ws` mentah + `WsAdapter`, auth handshake, dua gateway per path, graceful drain | 13 | `wscat` tersambung ke `ws://localhost:3000/?token=<JWT>`, menerima `tracking:update`; tanpa token → close `1008`; SIGTERM → close `1001`. Rekam terminalnya. |
| 2 | Redis Pub/Sub lintas replika, `rearmAll()`, mode `sharded`, hot store + polling backstop | 13 | Dua proses api (port beda) + satu worker; `redis-cli PSUBSCRIBE 'delivery:*:update'` menampilkan lalu lintas; Redis di-bounce → log `re-arming N subscription(s)` muncul dan frame kembali mengalir. |
| 3 (setengah) | Backpressure + coalescer, MQTT `$share`, push fan-out, capstone + catatan SSE | 7 | `WS_MAX_BUFFERED_BYTES=1024` + klien `socket.pause()` → `drovery_ws_dropped_frames_total` naik sementara frame status tetap sampai; catatan tertulis "kapan SSE lebih baik". |

Total ~33 jam. Minggu 2 adalah yang terberat dan paling banyak menunggu container — sisakan buffer di
sana, bukan di minggu 3.

---

## Konsep

### 8.1 WebSocket gateway dengan `ws` mentah + `WsAdapter` — kenapa BUKAN socket.io

Analogi yang jujur dari duniamu: ini seperti memilih `fetch` polos vs Axios. Keduanya bicara HTTP,
tapi Axios menambah interceptor, transform, dan konvensi error sendiri. Bedanya, di WebSocket
pilihan itu **mengubah protokol di kabel**, bukan cuma API-nya. socket.io bukan WebSocket dengan
gula — ia protokol tersendiri (Engine.IO) yang **kebetulan** memakai WebSocket sebagai transport.
Klien `new WebSocket(...)` biasa tidak bisa bicara dengannya sama sekali.

NestJS default-nya socket.io. Repo ini menimpanya satu baris di bootstrap:

```ts
// src/main.ts:33-36
// Use the raw 'ws' adapter for the tracking gateway. Without this, Nest would
// default to socket.io (also installed), which doesn't speak the {event,data}
// protocol our ws clients use — they'd connect but never receive frames.
app.useWebSocketAdapter(new WsAdapter(app));
```

Perhatikan frasa "(also installed)". Kedua paket ada di `package.json` (`@nestjs/platform-ws:44` dan
`@nestjs/platform-socket.io:43`), jadi ini keputusan sadar, bukan keterbatasan. Kalimat "they'd
connect but never receive frames" adalah gejala persis yang akan kamu lihat kalau baris itu hilang:
handshake sukses, lalu sunyi. Itu jenis bug yang menghabiskan sore.

Protokol gateway ini JSON polos `{event, data}`, dan kamu bisa membaca kontraknya dari sisi klien:
`Drovery_Mobile/services/api/trackingSocket.ts:6-18` mendefinisikan `TrackingUpdate` dengan komentar
"Mirrors the backend TrackingUpdatePayload". Sisi admin mencatat satu ketidakkonsistenan yang harus
kamu tahu: `Drovery_Admin/src/api/supportSocket.ts:62-64` — ACK datang sebagai `{event,data}`, tapi
**broadcast** chat datang sebagai payload telanjang tanpa field `event`, karena
`SupportChatGateway.deliverToLocalClients` mengirim `JSON.stringify(frame)` apa adanya
(`src/support/chat/support-chat.gateway.ts:215-219`) sedangkan tracking membungkusnya
(`src/deliveries/tracking/tracking.gateway.ts:171`). Dua gateway, dua bentuk wire — inkonsistensi
nyata di repo, bukan kesalahan bacaanmu.

**Anchor:**
- `src/main.ts:33-36` — komentar + `app.useWebSocketAdapter(new WsAdapter(app))`. Baca komentarnya
  sebagai jawaban langsung atas pertanyaan "kenapa bukan socket.io".
- `src/deliveries/tracking/tracking.gateway.ts:29-43` — dokstring `TrackingGateway`
  (*"('ws', not socket.io — main.ts installs WsAdapter)"*) lalu `@WebSocketGateway()` tanpa opsi
  (path default `/`).
- `src/deliveries/tracking/tracking.gateway.ts:40-42` — kenapa tidak ada opsi `cors`: *"the 'ws'
  library ignores it — access is gated entirely by the JWT handshake check"*.
- `src/deliveries/tracking/tracking.gateway.ts:167-191` — `deliverToLocalClients`, tempat frame
  `{event:'tracking:update', data}` dibentuk.

**Kenapa dipakai di sini:** tiga alasan yang bisa dibuktikan dari repo, bukan preferensi.
(1) **Protokol** — klien mobile & admin bicara `{event,data}` JSON polos, terlihat di
`trackingSocket.ts` dan `supportSocket.ts`. (2) **Berat per-koneksi** — tier `realtime` dirancang
menahan puluhan ribu socket per pod; `k8s/base/realtime-scaledobject.yaml:46` memakai
`threshold: '20000'` socket per replika, dan komentarnya menyuruh mem-*pin* angka itu ke hasil soak
test, bukan tebakan. `ws` adalah lapisan tipis di atas protokol WebSocket; socket.io menambah state,
heartbeat, dan buffer sendiri per koneksi. (3) **Nilai jual socket.io tidak dibutuhkan** — fitur
andalannya, Redis adapter untuk broadcast antar-node, sudah digantikan mekanisme fan-out sendiri
(8.4) yang juga dipakai support chat dan bisa di-switch ke mode `sharded`.

**Alternatif:**
- **socket.io + `@socket.io/redis-adapter`.** Dapat auto-reconnect, room, acknowledgement, dan
  fallback HTTP long-polling **gratis** — berguna kalau ada proxy korporat yang memblokir upgrade WS.
  Trade-off konkret: klien **wajib** memakai library socket.io (mobile & admin harus ganti dependensi
  dan versi client-server harus cocok), memori per koneksi lebih besar sehingga angka 20.000
  socket/pod di `realtime-scaledobject.yaml:46` harus diturunkan, dan mode `sharded` Redis 7
  (8.6) tidak bisa dipilih karena adapter menyembunyikan verb PUBLISH/SUBSCRIBE-nya.
- **µWebSockets.js.** Jauh lebih efisien per socket (implementasi C++), realistis menaikkan langit-langit
  socket/pod beberapa kali lipat. Harganya: keluar dari abstraksi `@nestjs/websockets` (`@SubscribeMessage`,
  `OnGatewayConnection` tidak berlaku — kamu menulis handler sendiri), plus binary native masuk ke image
  Docker, yang di Fase 10 berarti base image `node:22-slim` harus diverifikasi ulang.
- **Server-Sent Events (SSE).** Lihat 8.14 — ini kandidat serius untuk *tracking* dan itulah yang jadi
  bahan catatan penutup capstone.

**Latihan:** sambungkan klien mentah, tanpa library apa pun.

```bash
# ambil JWT dulu lewat POST /api/v1/auth/login, lalu:
npx wscat -c "ws://localhost:3000/?token=<JWT>"
> {"event":"subscribe","data":{"deliveryId":"<id>"}}
```

Kamu harus menerima `{"event":"subscribed","data":{...}}` lalu aliran `tracking:update` selama
simulasi jalan. Verifikasi: jalankan lagi tanpa `?token=` — koneksi ditutup `1008`. Lalu **hapus**
baris `src/main.ts:36`, restart, dan ulangi: `wscat` gagal di handshake. Itu demonstrasi langsung
dari komentar `main.ts:33-35`. Kembalikan setelahnya (`git checkout src/main.ts`).

---

### 8.2 Auth di handshake: token di query string, dan konsekuensinya di log

Di HTTP kamu terbiasa `Authorization: Bearer <token>`. Di WebSocket dari browser, itu **tidak bisa**:
`new WebSocket(url)` tidak menerima parameter header, spesifikasi WHATWG tidak menyediakannya, dan
tidak ada polyfill yang memperbaikinya. Ini batas platform, bukan kemalasan Drovery. (React Native
punya implementasi yang menerima headers, tapi backend harus melayani browser dan admin web juga,
jadi jalur terendah yang menang.)

Konsekuensinya token pindah ke query string, dan itu menciptakan masalah baru: **URL masuk log.**
Access log, error tracker, proxy — semuanya senang mencatat URL. Kalau `?token=<JWT valid 15 menit>`
ikut tercatat, kamu menaruh kredensial di tempat yang retensinya berbulan-bulan dan aksesnya jauh
lebih luas daripada database. Repo menutupnya di dua tempat: gateway tidak pernah mencatat URL, dan
pino punya serializer yang menyensor.

Satu detail halus di `handleConnection` mudah terlewat: cek `client.readyState !== WebSocket.OPEN`
**setelah** `verifyAsync`. Verifikasi JWT itu async, dan klien bisa memutus di tengah-tengah; kalau
itu terjadi `handleDisconnect` sudah jalan duluan (tanpa `userId`, jadi tidak `dec()`), sehingga
`inc()` yang jalan belakangan membuat gauge `drovery_ws_connections` naik selamanya tanpa pasangan
turun. Gauge bocor adalah sumber alert palsu yang paling sulit dilacak — dan di Fase 11, gauge itu
yang menggerakkan KEDA.

**Anchor:**
- `src/deliveries/tracking/tracking.gateway.ts:36-38` — dokstring menyebut alasannya:
  *"the client authenticates with a JWT in the handshake query (ws://host/?token=...) — browsers
  can't set WS headers"*.
- `src/deliveries/tracking/tracking.gateway.ts:75-97` — implementasinya: parse `URL`, ambil
  `token`, `verifyAsync`, guard `readyState` di `:88`, `client.close(1008, 'Unauthorized')` di `:95`.
- `src/deliveries/tracking/tracking.gateway.ts:84-87` — komentar tentang race gauge yang barusan
  dijelaskan. Baca pelan-pelan; ini contoh bagus "kenapa satu baris `if` ada".
- `src/deliveries/tracking/tracking.gateway.ts:91-92` — *"Never log the URL (it carries the token);
  log only the user."*
- `src/common/redact.ts:1-9` — `redactTokenInUrl`, regex satu baris + dokstring yang menjelaskan
  ancamannya.
- `src/app.module.ts:112-118` — serializer pino yang memasang fungsi itu ke setiap `req.url`.
- `src/deliveries/tracking/tracking.gateway.ts:125-152` — ownership **dicek ulang per delivery**
  saat subscribe (`this.deliveries.findOne` di `:137`), bukan cuma di handshake; pesan error-nya
  sengaja generik di `:139-140` supaya tidak membocorkan apakah delivery itu ada.

**Kenapa dipakai di sini:** karena satu JWT valid tidak berarti "boleh melihat delivery ini". Handshake
membuktikan *siapa*, `findOne` membuktikan *boleh apa* — dan komentar di `:38` menyebut targetnya:
*"parity with GET /deliveries/track"*, artinya jalur WS tidak boleh lebih longgar daripada jalur HTTP
yang sudah ada. Ini pola yang harus kamu bawa: **transport baru tidak boleh jadi pintu belakang untuk
otorisasi.**

Ada utang yang jujur dicatat repo dan harus kamu tahu: `AUDIT-LOG.md:825-829` — *"Item 5 (WS session
revalidation) NOT done. `tracking.gateway.ts:81` still authenticates once at connect, so logout and
token expiry never terminate a live stream."* Socket yang dibuka jam 9 pagi tetap hidup jam 5 sore
walau token-nya kedaluwarsa dan penggunanya sudah logout. Alasannya ditulis: revalidasi menambah I/O
per-frame atau periodik ke jalur panas, dan sebaiknya dirancang bersama keputusan `passwordChangedAt`
dari fase auth. Kamu boleh tidak setuju — tapi tahu bahwa itu keputusan, bukan kelalaian.

**Alternatif:**
- **Ticket sekali pakai.** Klien `POST /ws-ticket` (pakai header Authorization normal), dapat token
  acak berumur 30 detik, lalu `ws://host/?ticket=<x>`. Yang bocor ke log cuma ticket yang sudah mati.
  Trade-off konkret: satu round-trip HTTP tambahan sebelum tiap reconnect — dan klien di sini
  reconnect dengan backoff sampai 5 kali (`trackingSocket.ts:53-60`), jadi setiap badai reconnect
  jadi badai HTTP juga; plus butuh penyimpanan ticket (Redis lagi) dan satu jalur kedaluwarsa lagi.
- **Auth setelah koneksi terbuka** (frame `{event:'auth',data:{token}}` sebagai pesan pertama).
  Token tidak pernah menyentuh URL sama sekali. Trade-off: server harus menahan socket
  ter-autentikasi-sebagian dengan timeout sendiri, dan itu permukaan DoS gratis — seribu koneksi yang
  tidak pernah mengirim frame auth tetap memakan file descriptor. Dengan model sekarang, socket tanpa
  token mati di `handleConnection`, sebelum masuk map apa pun.
**Latihan:** buktikan penyensoran benar-benar jalan. Jalankan API dengan `NODE_ENV=production`
(supaya pino mengeluarkan JSON, bukan pino-pretty), sambungkan `wscat` dengan token, lalu cari
token itu di seluruh output log: `npm run start:prod 2>&1 | grep -o 'token=[^&" ]*'`. Yang boleh
muncul hanya `token=***`. Lalu **rusak sengaja**: komentari baris `src/app.module.ts:115` dan ulangi —
kamu akan melihat JWT utuh di log. Kembalikan. Bonus: tulis unit test untuk `redactTokenInUrl` yang
mencakup `?token=x`, `?a=1&token=x`, `?TOKEN=x` (regex-nya `gi`), dan URL tanpa token.

---

### 8.3 Dua gateway berdampingan lewat path

Padanan yang paling dekat dari duniamu: React Router. Satu server HTTP, banyak route, yang menentukan
komponen mana yang render adalah pathname. Di sini persis sama, hanya saja yang dirutekan adalah
**HTTP upgrade request**, dan yang me-render adalah gateway.

`WsAdapter` milik `@nestjs/platform-ws` merutekan upgrade berdasarkan pathname **persis** (bukan
prefix). Jadi `@WebSocketGateway()` tanpa opsi memegang `/`, dan `@WebSocketGateway({ path: '/ws/support' })`
memegang `/ws/support`. Keduanya berbagi satu HTTP server, satu port, satu proses.

Yang menarik bukan mekanismenya, tapi **apa yang berbeda di antara keduanya**:

| | `TrackingGateway` (`/`) | `SupportChatGateway` (`/ws/support`) |
|---|---|---|
| Siapa yang publish | **worker** (menghitung update) | **api** (menerima pesan dari socket) |
| Arah data | server → klien saja | dua arah (`@SubscribeMessage('message')`) |
| Bentuk broadcast | `{event:'tracking:update', data}` | payload telanjang, tanpa `event` |
| Backpressure | ya (posisi lossy) | tidak (setiap pesan chat penting) |
| Otorisasi | `deliveries.findOne` per delivery | ownership tiket + role, di-resolve sekali |

Baris "siapa yang publish" paling penting. Untuk tracking, publisher hidup di worker karena di
situlah update dihitung. Untuk chat, publisher hidup **di mana-mana** — disengaja: dokstring
`SupportChatPublisher` menjelaskan bahwa surface agent/admin di tier mana pun bisa menyuntik pesan
`AGENT` lewat publisher yang sama, tanpa mengubah gateway.

**Anchor:**
- `src/support/chat/support-chat.gateway.ts:38-54` — dokstring menjelaskan routing by exact
  pathname *"so it coexists with the tracking gateway at '/'"*, lalu
  `@WebSocketGateway({ path: '/ws/support' })` di `:54`.
- `src/support/chat/support-chat.gateway.ts:101-104` — role di-resolve **sekali per koneksi**, dengan
  alasan tertulis: *"the JWT does not carry it, and sockets are long-lived"*.
- `src/support/chat/support-chat.gateway.ts:99` — guard `readyState` yang sama seperti 8.2, kali ini
  untuk gauge `wsSupportConnections`.
- `src/support/chat/support-chat.publisher.ts:59-67` — kenapa publisher chat **bukan** milik gateway.
- `src/support/support.module.ts:14` + `:28` — gate `IS_API` (alias `IS_HTTP_TIER`): gateway +
  subscriber hanya didaftarkan di tier HTTP; publisher didaftarkan di semua tier.
- `k8s/base/realtime-ingress.yaml:19` dan `:25` — dua path di Ingress, `/ws/support` lebih spesifik,
  root sebagai prefix paling longgar. Di `:10`, `proxy-read-timeout: '3600'` — tanpa ini nginx memutus
  socket yang idle 60 detik (bandingkan `api-ingress.yaml:6` yang memang `'60'`).

**Kenapa dipakai di sini:** karena alternatifnya (satu gateway melayani dua domain lewat field
`type` di payload) akan menggabungkan dua kebijakan yang berbeda secara fundamental — tracking boleh
kehilangan frame, chat tidak. Begitu keduanya berbagi `deliverToLocalClients`, aturan "posisi boleh
di-drop" akan bocor ke chat, atau aturan "jangan pernah drop" akan bocor ke tracking dan mengembalikan
risiko OOM. Path terpisah = dua kelas = dua kebijakan yang tidak bisa saling menabrak.

**Alternatif:**
- **Satu gateway, satu socket, multiplexing lewat field `channel` di payload.** Klien cuma perlu satu
  koneksi (hemat FD di server: 20.000 pengguna = 20.000 socket, bukan 40.000). Trade-off konkret:
  kamu harus menulis sendiri lapisan routing + per-channel subscription state, dan aturan
  backpressure jadi per-pesan (harus baca isi payload untuk tahu boleh di-drop atau tidak) alih-alih
  per-gateway. Kode `deliverToLocalClients` yang sekarang 20 baris akan jadi 60.
- **Dua port berbeda** (tracking di 3000, chat di 3001). Isolasi paling tegas — chat yang bocor memori
  tidak menyeret tracking. Trade-off: dua Service + dua Ingress + dua konfigurasi TLS di k8s, dan
  KEDA harus punya dua `ScaledObject`; sekarang satu `ScaledObject` menjumlahkan **kedua** gauge
  (`realtime-scaledobject.yaml:56-57`) karena keduanya berbagi budget FD/heap pod yang sama.
**Latihan:** buktikan dua gateway benar-benar terpisah. Buka dua terminal:

```bash
npx wscat -c "ws://localhost:3000/?token=<JWT>"            # tracking
npx wscat -c "ws://localhost:3000/ws/support?token=<JWT>"  # chat
```

Kirim `{"event":"subscribe","data":{"deliveryId":"<id>"}}` ke terminal **kedua** dan amati: kamu
tidak akan pernah mendapat `subscribed`, karena `SupportChatGateway.handleSubscribe` mengharapkan
`ticketId`. Lalu ubah `@WebSocketGateway({ path: '/ws/support' })` jadi `@WebSocketGateway()`,
restart, dan lihat apa yang terjadi (petunjuk: dua gateway berebut path yang sama — catat perilaku
persisnya, itu bagian dari pelajarannya). Kembalikan.

---

### 8.4 Redis Pub/Sub sebagai fan-out lintas replika

Ini inti fase. Tidak ada padanan yang jujur di dunia frontend — di React, "state ada di satu tempat"
adalah aksioma. Di sini, **state siapa-tersambung-ke-siapa tersebar di N proses yang tidak saling
kenal**, dan tidak ada satu pun dari mereka yang tahu gambaran utuhnya.

Bentuk masalahnya:

```
worker menghitung: delivery d-42 pindah ke IN_TRANSIT
  ├─ worker TIDAK punya HTTP server (createApplicationContext) → tidak punya socket
  └─ klien pemilik d-42 tersambung ke api replica #3 (dipilih LB, acak)
```

Solusinya klasik dan cuma tiga bagian: **publisher** menulis ke channel Redis, **subscriber** di
setiap replika mendengar channel itu, **gateway** menyiarkan ke socket lokalnya. Yang layak dipelajari
bukan bahwa mereka ada, tapi tiga keputusan desain di dalamnya.

**(1) Nama channel adalah satu sumber kebenaran.** `trackingChannel(deliveryId)` didefinisikan di
publisher, lalu **di-import** oleh subscriber. Kalau string `delivery:${id}:update` ditulis dua kali,
suatu hari akan ada typo dan gejalanya adalah "frame hilang tanpa error" — mode kegagalan terburuk.

**(2) Koneksi subscribe wajib terpisah.** Ini bukan gaya, ini aturan protokol Redis: begitu sebuah
koneksi masuk mode subscribe, ia hanya boleh menjalankan perintah subscribe/unsubscribe/ping.
Kalau kamu memakai koneksi yang sama untuk `GET`/`SET`, Redis akan menolak. Makanya publisher dan
subscriber masing-masing `new Redis(...)` sendiri, terpisah pula dari koneksi cache dan koneksi
BullMQ.

**(3) Subscriber tidak boleh meng-import gateway.** Kalau keduanya saling meng-inject, DI container
Nest gagal boot dengan circular dependency. Repo memutusnya lewat inversi callback: gateway
mendaftarkan fungsinya dengan `subscriber.onUpdate(handler)` di `onModuleInit`. Rasanya mirip
`useImperativeHandle` di React — pemilik state memberi tahu anak "panggil aku lewat ini".

**Anchor:**
- `src/deliveries/tracking/tracking.publisher.ts:34-40` — dokstring menyatakan masalahnya persis:
  *"Lives in the WORKER (where the simulation runs) — the worker has no WS server, so it can't
  deliver to clients directly."* Baca juga *"Fail-open: a publish error never breaks the delivery
  simulation (polling remains authoritative)."*
- `src/deliveries/tracking/tracking.publisher.ts:29-32` — `trackingChannel`, dengan komentar
  *"Single source of truth for the per-delivery channel name."*
- `src/deliveries/tracking/tracking.subscriber.ts:26-31` — dokstring: *"Holds a DEDICATED ioredis
  subscriber connection (a client in subscribe mode can't run normal commands)"*.
- `src/deliveries/tracking/tracking.gateway.ts:67-73` — bridging tanpa DI cycle:
  `this.subscriber.onUpdate((deliveryId, data) => this.deliverToLocalClients(deliveryId, data))`.
- `src/deliveries/tracking/tracking.subscriber.ts:120-130` + `:132-136` — subscribe/unsubscribe
  **dinamis**: hanya channel delivery yang benar-benar ditonton klien lokal.
- `src/deliveries/tracking/tracking.gateway.ts:143-149` dan `:99-107` — pemicunya: subscriber
  Redis dinyalakan saat klien lokal **pertama** untuk sebuah delivery, dimatikan saat yang terakhir
  pergi.
- `src/deliveries/deliveries.module.ts:88` vs `:91` — bukti pemisahan tier: `SimulationProcessor` di
  worker, `[TrackingGateway, TrackingSubscriber]` di tier HTTP. `TrackingPublisher` (baris `:78-79`)
  tidak di-gate sama sekali — ia hidup di semua tier, karena `DeliveriesService` (api) juga
  memublikasikan transisi exception di `src/deliveries/deliveries.service.ts:1361-1367`.
- `ARCHITECTURE.md:75-83` — §3, ringkasan desain ini dalam prosa, plus daftar "next".

**Kenapa dipakai di sini:** Redis **sudah ada** di stack untuk BullMQ, cache, dan throttler.
Menambah pub/sub di atasnya berarti nol komponen infrastruktur baru. `SCALING-1M.md:29-31` mencatat
harga dari keputusan itu dengan jujur: *"The single Redis carrying four concerns (queue + cache +
pub/sub + throttler) — a single-threaded saturation point and a shared failure domain"*. Jadi ini
bukan "Redis itu solusi terbaik", melainkan "Redis itu solusi yang tidak menambah kotak baru, dan
kami tahu kapan itu akan patah".

**Alternatif:**
- **Sticky session / consistent hashing di load balancer** — semua socket untuk satu delivery
  diarahkan ke pod yang sama, sehingga fan-out tidak dibutuhkan sama sekali. Trade-off konkret: tier
  jadi **stateful**, sehingga setiap scale-down memutus klien yang kebetulan ada di pod itu (dan
  `realtime-scaledobject.yaml:34-40` sudah bersusah payah membuat scale-down selambat mungkin justru
  karena itu), plus worker yang menghitung update tetap harus tahu pod mana yang memegang delivery —
  masalahnya cuma pindah tempat, tidak hilang.
- **NATS.** Dirancang khusus untuk pub/sub: sharding subject, backpressure di level broker, dan
  latensi lebih baik pada fan-out besar. `SCALING-1M.md:299` menyebutnya sebagai opsi Phase 2
  eksplisit. Trade-off: satu sistem baru untuk di-deploy, dimonitor, dan diamankan — dan tim ini
  belum punya satu pun jam operasional dengan NATS.
- **Postgres `LISTEN/NOTIFY`** — nol infra baru sama sekali. Trade-off yang membunuh: payload
  dibatasi 8 KB, dan setiap notifikasi membebani DB **primary** — datastore yang seluruh
  `SCALING-1M.md` justru berusaha lindungi. Menaruh firehose telemetry di sana persis kebalikan dari
  tujuan arsitekturnya.
- **Kafka** — replay log, ordering per-partisi, throughput sangat tinggi. Trade-off: fan-out ke
  subscriber ephemeral canggung di Kafka (tiap replika butuh consumer group sendiri, berumur
  sependek pod); ia unggul untuk konsumen stabil yang butuh riwayat, bukan "siapa pun yang kebetulan
  online sekarang".

**Latihan:** buktikan fan-out lintas proses dengan mata sendiri. Jangan pakai `docker compose --scale
api=2` — `docker-compose.yml:119-120` memetakan `'3000:3000'` secara tetap, jadi replika kedua akan
gagal bind. Pakai tiga terminal:

```bash
PROCESS_ROLE=api PORT=3000 npm run start:dev     # api #1
PROCESS_ROLE=api PORT=3001 npm run start:dev     # api #2
PROCESS_ROLE=worker npm run worker               # worker
```

Sambungkan `wscat` ke **3001**, subscribe ke sebuah delivery, lalu buat delivery itu lewat API di
**3000**. Frame tetap sampai. Terminal keempat untuk melihat busnya:

```bash
redis-cli PSUBSCRIBE 'delivery:*:update'
```

Verifikasi: matikan **worker** saja — `wscat` sunyi, tapi `GET /api/v1/deliveries/:id` masih menjawab
(polling tetap hidup, lihat 8.11). Lalu matikan `TrackingSubscriber` dengan menjalankan api #2 sebagai
`PROCESS_ROLE=worker`— gateway-nya tidak akan didaftarkan sama sekali dan handshake gagal. Itu
`deliveries.module.ts:91` bekerja.

---

### 8.5 `rearmAll()`: satu kedipan Redis pernah membuat klien tuli permanen

Ini bug nyata di repo ini, tercatat lengkap, dan sejauh ini pelajaran paling berharga di seluruh fase.
Baca ceritanya dulu, kodenya belakangan.

Koneksi subscriber dibangun dengan `enableOfflineQueue: false`. Artinya: kalau Redis tak terjangkau,
perintah **tidak diantre** — ia langsung reject. Ini pilihan yang benar (mengantre perintah subscribe
selama outage 10 menit akan meledakkan memori), tapi ia punya konsekuensi.

Kode lama melakukan ini: `subscribe(channel).catch(e => log.warn(...))` — log, lalu lanjut. Padahal
gateway sudah menaruh socket ke `this.subscriptions` dan sudah membalas `{event:'subscribed'}`. Jadi:

1. Klien diberi tahu "kamu live".
2. Tidak ada channel yang terdaftar di Redis.
3. Tidak ada yang pernah retry — dan lebih buruk, **entri map yang tidak kosong membuat subscriber
   berikutnya untuk delivery yang sama memakai ulang entri itu** alih-alih memanggil
   `subscribeToDelivery` lagi.

Hasilnya, dalam kalimat `AUDIT-LOG.md:773-774`: *"One blink deafened those clients for the life of
their socket."* Bukan crash, bukan error di log klien, bukan metrik yang naik. Cuma sunyi yang
terlihat seperti "kayaknya dronenya lagi diam".

Perbaikannya dua baris konsep: **simpan niat, pasang ulang saat sambungan pulih.** Ada `Set` bernama
`desired` berisi channel yang replika ini *ingin* dengarkan. `subscribeToDelivery` menambahkan ke
`desired` **sebelum** memanggil SUBSCRIBE (urutan ini adalah fix-nya — kalau ditambahkan sesudah,
subscribe yang gagal tidak meninggalkan jejak apa pun). Dan `sub.on('ready', () => this.rearmAll())`
memasang ulang semuanya setiap kali ioredis menyambung kembali.

Ada catatan meta di audit log yang layak dibaca sebagai pelajaran testing: `AUDIT-LOG.md:794-798` —
versi pertama test-nya **mengimplementasikan ulang loop re-arm di dalam spec**, jadi ia menguji
salinannya sendiri, bukan kodenya. Perbaikannya: ekstrak `rearmAll()` keluar dari handler `'ready'`
supaya spec memanggil method asli. Itu sebabnya `rearmAll()` publik, dengan komentar *"Extracted
from the event handler so it is testable without a live Redis."*

**Anchor:**
- `src/deliveries/tracking/tracking.subscriber.ts:36-50` — dokstring `desired`, cerita bug lengkap
  dalam 15 baris. Ini salah satu komentar terbaik di repo; baca dua kali.
- `src/deliveries/tracking/tracking.subscriber.ts:120-130` — `subscribeToDelivery`, dengan komentar
  *"Record the intent FIRST"* di `:122-123`.
- `src/deliveries/tracking/tracking.subscriber.ts:102-118` — `rearmAll()`, termasuk baris log
  `tracking redis ready — re-arming ${n} subscription(s)` di `:110-112` (itulah string yang kamu cari
  di capstone).
- `src/deliveries/tracking/tracking.subscriber.ts:75` — `this.sub.on('ready', () => this.rearmAll())`.
- `src/deliveries/tracking/tracking.subscriber.ts:64-70` — `enableOfflineQueue: false` di `:69`,
  penyebab akarnya.
- `src/support/chat/support-chat.subscriber.ts:43-57` — dokstring identik di gateway kedua; polanya
  memang disalin sengaja.
- `src/mqtt/mqtt.service.ts:87-88` — pola yang **sama** untuk MQTT: re-arm setiap subscription pada
  event `'connect'`. Komentar `tracking.subscriber.ts:47-48` menunjuk ke sini: *"the same thing
  MqttService does on 'connect'"*.
- `AUDIT-LOG.md:761` (judul fase audit), `:768-775` (apa yang berubah), `:801-806` (kenapa re-arm
  dipilih ketimbang rollback map gateway).

**Kenapa dipakai di sini:** karena alternatifnya lebih buruk untuk pengguna. Rencana awal menyarankan
`await` subscribe lalu rollback entri map gateway kalau gagal. Keputusan yang diambil
(`AUDIT-LOG.md:803-806`): *"Rolling back turns a transient outage into a hard client error;
re-arming turns it into a delay. The client is told `subscribed` and — once Redis is back — that
becomes true, which is the honest behaviour for a reconnecting transport."* Ini cara berpikir yang
harus kamu tiru: pertanyaannya bukan "mana yang lebih benar secara teknis", tapi "kegagalan mana yang
lebih baik dialami pengguna".

**Alternatif:**
- **`enableOfflineQueue: true`** — ioredis mengantre perintah selama disconnect dan mengirimnya saat
  pulih; masalahnya hilang tanpa kode tambahan. Trade-off konkret: antrean itu tidak berbatas, jadi
  outage panjang di tier dengan puluhan ribu socket berarti puluhan ribu perintah SUBSCRIBE menumpuk
  di heap — mengganti mode gagal "diam" dengan mode gagal "OOM". Dan urutannya tidak dijamin cocok
  dengan klien yang sudah pergi di tengah outage.
- **Polling ulang berkala** (`setInterval` 30 detik yang mem-*reconcile* `desired` vs channel aktif).
  Menutup lebih banyak kasus daripada event `'ready'` (mis. subscribe yang hilang tanpa disconnect
  penuh). Trade-off: satu timer lagi per replika yang bekerja saat tidak ada masalah, dan latensi
  pemulihan jadi sampai 30 detik alih-alih segera.
**Latihan:** reproduksi bug-nya, lalu buktikan fix-nya.

1. Sambungkan `wscat`, subscribe ke sebuah delivery, pastikan frame mengalir.
2. `docker compose stop redis` (atau `redis-cli SHUTDOWN NOSAVE` kalau Redis lokal).
3. `docker compose start redis`. Cari di log api: `tracking redis ready — re-arming 1 subscription(s)`.
   Frame harus kembali mengalir tanpa klien reconnect.
4. Sekarang **rusak sengaja**: pindahkan `this.desired.add(channel)` di
   `tracking.subscriber.ts:124` ke **setelah** `pubSubSubscribe(...)`. Jalankan
   `npx jest tracking.subscriber` — test *"keeps the channel in the desired set when the subscribe
   fails"* harus **gagal**. Itulah satu baris yang menutup bug ini.
5. Kembalikan, jalankan spec lagi, hijau.

`AUDIT-LOG.md:835-836` mencatat bahwa re-arm ini *"has never been exercised against a real Redis
restart"* dan menyarankan melakukannya sekali dengan tangan. Langkah 1-3 di atas adalah tugas itu —
kamu akan jadi orang pertama yang menjalankannya.

---

### 8.6 Batas Pub/Sub klasik di Redis Cluster, dan mode `sharded`

Ini konsep yang paling berlawanan dengan intuisi di fase ini, dan sayangnya juga yang paling mudah
menghasilkan kegagalan diam.

Intuisi normal: "Redis Cluster punya banyak node, jadi menambah node = menambah kapasitas". Untuk
GET/SET itu benar — key dibagi ke 16.384 hash slot, tiap node memiliki sebagian. Untuk pub/sub
**klasik**, itu salah. Karena subscriber boleh tersambung ke node mana pun, Redis Cluster harus
menyiarkan setiap PUBLISH ke **setiap** node supaya pesannya pasti ketemu subscriber-nya. Artinya
throughput pub/sub dibatasi oleh **satu** node, dan menambah node justru memperburuk egress internal.

Redis 7.0 menambahkan *sharded pub/sub*: `SPUBLISH` / `SSUBSCRIBE`. Channel diperlakukan seperti key —
di-hash ke slot, dirutekan hanya ke node pemilik slot itu. Firehose akhirnya terpartisi.

Repo memberi seam tipis supaya modenya bisa dibalik lewat env, bukan lewat perubahan kode. Tapi ada
jebakan yang **wajib** kamu pahami sebelum menyentuhnya:

> **`SPUBLISH` hanya sampai ke `SSUBSCRIBE`. Tidak pernah ke `SUBSCRIBE` klasik.**

Kalau worker (publisher) memakai `sharded` dan api (subscriber) memakai `standard`, tidak akan ada
error di mana pun. Publisher sukses, subscriber sehat, koneksi hidup, `/health/ready` hijau. Frame
cuma tidak pernah sampai. Ini persis mode kegagalan yang paling mahal untuk didiagnosis, dan itulah
sebabnya komentar di kode menulis **UNIFORM CONFIG** dengan huruf kapital.

Ada lapisan kedua dari jebakan yang sama di sisi ioredis: pesan sharded datang sebagai event
`'smessage'`, bukan `'message'`. Dua event yang berbeda. Mendengarkan yang salah = nol pesan
(bukan duplikat, bukan error). Repo mengekstrak `wireMessageListener` supaya pemetaan mode→event bisa
diuji tanpa Redis hidup.

**Anchor:**
- `src/common/pubsub/pubsub-transport.ts:4-24` — dokumentasi lengkap `standard` vs `sharded`,
  termasuk kalimat kunci di `:10-14`: *"classic pub/sub does NOT shard: every PUBLISH is propagated
  to EVERY node ... so pub/sub throughput is capped by a single node"*.
- `src/common/pubsub/pubsub-transport.ts:21-23` — peringatan **UNIFORM CONFIG**.
- `src/common/pubsub/pubsub-transport.ts:29-39` — `resolvePubSubMode`, **fail-safe**: apa pun selain
  string persis `'sharded'` jadi `'standard'`. Typo `REDIS_PUBSUB_MODE=shrded` tidak akan diam-diam
  mengganti protokol wire.
- `src/common/pubsub/pubsub-transport.ts:41-46` — `pubSubMessageEvent`, dengan komentar *"listening
  on the wrong one yields zero messages (never duplicates)"*.
- `src/deliveries/tracking/tracking.subscriber.ts:80-89` — `wireMessageListener`, ekstraksi demi
  testability.
- `src/deliveries/tracking/tracking.publisher.ts:45-47` dan `tracking.subscriber.ts:53-55` — kenapa
  default field-nya `'standard'`: supaya unit test yang menyuntik mock (melewati `onModuleInit`)
  tetap byte-identical.
- `src/config/configuration.ts:61` — `pubsubMode: process.env.REDIS_PUBSUB_MODE ?? 'standard'`.
- `.env.example:33-38` — dokumentasi operator, termasuk *"MUST be identical on the worker (publisher)
  and api/realtime (subscriber) tiers."*
- `SCALING-1M.md:206-213` — catatan kejujuran: mode sharded **benar** di Redis standalone 7+, tapi
  baru benar-benar **mendistribusikan** setelah klien `Redis.Cluster` dipasang (follow-up yang belum
  dikerjakan).

**Kenapa dipakai di sini:** karena flip-nya harus tersedia **sebelum** dibutuhkan. `SCALING-1M.md:299`
menaruhnya di Phase 2 (300k→1M pengguna): *"Flip REDIS_PUBSUB_MODE=sharded (and wire the Redis
Cluster client) or move to a broker."* Menulis seam ini sekarang, saat default-nya `standard` dan
perilakunya byte-identical, jauh lebih murah daripada menulisnya saat sedang insiden. Perhatikan
polanya — sama seperti `POSITION_PUSH_HZ` dan `WS_MAX_BUFFERED_BYTES`: **fitur skala dikirim dalam
keadaan mati, dengan default yang tidak mengubah apa pun.**

**Alternatif:**
- **Redis Cluster tanpa sharded pub/sub, terima batas satu node.** Nol perubahan kode. Trade-off
  terukur: `loadtest/capacity-model-1m.mjs` (disebut di `SCALING-1M.md:71`) memodelkan Redis pub/sub
  egress sebagai salah satu dari empat langit-langit; kalau kamu tidak flip, itu jadi langit-langit
  yang tercapai duluan, dan satu-satunya obat setelah itu adalah migrasi broker saat trafik penuh.
- **Broker sungguhan (NATS / Kafka) sejak awal.** Sharding, backpressure, dan observability fan-out
  yang jauh lebih matang. Trade-off: satu sistem baru sebelum ada bukti Redis-nya patah — dan
  seluruh repo ini konsisten menunda infra baru sampai batasnya terukur, bukan diperkirakan.
**Latihan:** buat kegagalan diam itu terjadi, supaya kamu mengenali gejalanya seumur hidup.
Jalankan worker dengan `REDIS_PUBSUB_MODE=sharded` dan api dengan default (`standard`). Redis lokal
harus versi 7+ (`redis-cli INFO server | grep redis_version`). Subscribe lewat `wscat`, jalankan
simulasi. Amati: **tidak ada error di mana pun**, tidak ada log warn, `/health/ready` hijau — frame
cuma tidak datang. Konfirmasi busnya memang hidup dengan `redis-cli SSUBSCRIBE 'delivery:<id>:update'`
(perhatikan: `SSUBSCRIBE`, bukan `PSUBSCRIBE` — pola glob tidak berlaku di mode sharded, dan itu
sendiri konsekuensi yang layak dicatat). Lalu samakan modenya di kedua sisi dan frame kembali.
Tulis dua kalimat di catatanmu tentang bagaimana kamu akan mendeteksi ini di produksi.

---

### 8.7 Backpressure: `bufferedAmount`, dan aturan frame status yang tidak boleh dilanggar

Kamu mungkin pernah melihat `WebSocket.bufferedAmount` di browser dan mengabaikannya. Di server ia
adalah pengaman antara satu pengguna 3G dan sebuah pod yang mati.

Mekanikanya begini. `client.send(message)` tidak menunggu paketnya sampai — ia menaruh byte di buffer
kirim socket dan langsung kembali. Kalau klien membacanya lebih lambat daripada kamu menulis, TCP
menahan aliran, dan buffer itu **tumbuh**. Di browser, yang membengkak adalah memori tab pengguna
itu. Di server, yang membengkak adalah heap Node — dan ketika Node kehabisan heap, yang mati bukan
klien lambat itu, tapi **pod beserta ~20.000 socket orang lain**. Satu pengguna di kereta yang masuk
terowongan menjatuhkan seluruh node.

Guard-nya sederhana: sebelum `send`, cek `client.bufferedAmount`. Kalau sudah lewat watermark, buang
frame ini dan hitung. Yang **tidak** sederhana adalah pengecualiannya, dan di situlah pelajarannya:

> Frame yang membawa `status` **tidak pernah** di-drop.

Alasannya ditulis di kodenya dan layak dihafal: frame posisi bersifat **lossy** — frame berikutnya
datang sedetik lagi dan menggantikan yang hilang, jadi UI-nya hanya sedikit tersendat. Frame status
bersifat **non-lossy** — tidak ada frame berikutnya yang menggantikan `DELIVERED`, dan status terminal
justru **membekukan** posisi sehingga tidak akan ada frame posisi lagi. Kalau kamu drop transisi
status, satu-satunya jalan pulih adalah polling (8.11). Klien yang tidak polling akan menampilkan
"sedang dalam perjalanan" selamanya.

Bedakan ini dari intuisi frontend: di React kamu terbiasa berpikir "data lama vs data baru". Di sini
sumbunya berbeda: **"apakah ada yang akan menggantikannya?"** Kalau ya, boleh dibuang. Kalau tidak,
haram.

**Anchor:**
- `src/deliveries/tracking/tracking.gateway.ts:167-191` — seluruh `deliverToLocalClients`.
- `src/deliveries/tracking/tracking.gateway.ts:172-176` — komentar aturan status:
  *"A STATUS transition is NEVER dropped: it's recoverable only via a poll, and a terminal status
  FREEZES position so no later frame supersedes it."*
- `src/deliveries/tracking/tracking.gateway.ts:180-185` — guard-nya sendiri: komentar *"drop a
  POSITION frame to a socket whose send buffer is already backed up (a slow client), rather than
  growing it unbounded toward an OOM"*, lalu `if (!isStatusFrame && client.bufferedAmount >
  WS_MAX_BUFFERED_BYTES) { this.metrics?.wsDroppedFrames.inc(); continue; }`.
- `src/deliveries/tracking/tracking.gateway.ts:179` — `if (client.readyState !== WebSocket.OPEN)
  continue;` — jangan mengirim ke socket yang sedang menutup.
- `src/deliveries/tracking/realtime.constants.ts:13-20` — `WS_MAX_BUFFERED_BYTES`, default 1 MiB,
  NaN-safe (`Number(x) || default` — perhatikan idiom ini, ia menutup `undefined` dan `'abc'`
  sekaligus).
- `src/metrics/metrics.service.ts:45-47` — deklarasi `wsDroppedFrames` dengan interpretasinya:
  *"a non-zero rate flags slow clients / a fan-out node under pressure"*.
- `src/metrics/metrics.service.ts:141-145` — registrasi counter `drovery_ws_dropped_frames_total`.
- `src/deliveries/tracking/tracking.gateway.spec.ts` — dua test yang mengunci perilakunya:
  *"drops a POSITION frame to a backed-up (slow) socket"* dan *"always sends a STATUS transition,
  even to a backed-up socket"*.
- `SCALING-1M.md:204-205` — asal-usul desainnya: *"a per-socket `bufferedAmount` watermark so a slow
  client can't balloon node memory"*.

**Kenapa dipakai di sini:** karena tier realtime adalah satu-satunya tier di sistem ini yang memegang
state jangka panjang milik ribuan orang sekaligus. Untuk tier api, satu request lambat merugikan satu
request. Untuk tier realtime, satu socket lambat merugikan semua penghuni pod. Sifat "blast radius"
itulah yang membuat guard ini wajib di sini dan tidak wajib di tempat lain.

**Alternatif:**
- **Tutup socket klien lambat** (`client.terminate()`) alih-alih drop frame. Lebih tegas melindungi
  memori, dan klien akan reconnect. Trade-off konkret: menghukum pengguna berjaringan buruk dengan
  putus berulang, dan di klien Drovery setiap reconnect punya budget maksimal 5 percobaan
  (`Drovery_Mobile/services/api/trackingSocket.ts:53-60`) — habiskan budget itu dan tracking-nya
  turun ke polling. Drop frame posisi tidak terasa sama sekali di UI.
- **Antrean per-klien dengan batas ukuran + prioritas.** Kontrol lebih halus: kamu bisa menyimpan 1
  frame posisi terakhir dan seluruh frame status, lalu mengirim saat buffer longgar. Trade-off: kamu
  menulis ulang informasi yang `bufferedAmount` sudah berikan gratis, plus struktur data per socket
  (memori × 20.000) dan siklus hidupnya sendiri untuk di-debug.
**Latihan:** paksa backpressure terjadi. Buat file `slow-client.mjs`:

```js
import WebSocket from 'ws';
const ws = new WebSocket(`ws://localhost:3000/?token=${process.env.JWT}`);
ws.on('open', () => {
  ws.send(JSON.stringify({ event: 'subscribe', data: { deliveryId: process.env.DID } }));
  // berhenti membaca socket → buffer sisi server menumpuk
  setTimeout(() => ws._socket.pause(), 500);
});
```

Jalankan api dengan `WS_MAX_BUFFERED_BYTES=1024 POSITION_PUSH_HZ=0`, jalankan simulasi, lalu:

```bash
curl -s localhost:3000/api/v1/metrics | grep drovery_ws_dropped_frames_total
```

Angkanya harus naik. Verifikasi bagian yang lebih penting: di `slow-client.mjs`, ganti `pause()`
dengan pause 5 detik lalu `resume()`, dan pastikan frame yang membawa `status` **tetap** kamu terima
setelah resume, sementara frame posisi di antaranya hilang. Lalu **rusak sengaja**: hapus
`!isStatusFrame &&` dari `tracking.gateway.ts:182` dan jalankan `npx jest tracking.gateway` — test
*"always sends a STATUS transition, even to a backed-up socket"* harus gagal.

---

### 8.8 Coalescing menurunkan beban BUS; backpressure menurunkan beban SOCKET

Dua mekanisme yang terlihat mirip ("keduanya membuang frame posisi") tapi menyelesaikan masalah yang
berbeda, di tempat yang berbeda, dengan pemicu yang berbeda. Membedakannya adalah setengah dari
pemahaman fase ini.

|  | `PositionCoalescer` (`POSITION_PUSH_HZ`) | Backpressure (`WS_MAX_BUFFERED_BYTES`) |
|---|---|---|
| Ada di | **publisher** (worker/ingest) | **gateway** (tier HTTP/realtime) |
| Melindungi | bus Redis + seluruh downstream | memori satu pod |
| Dipicu oleh | laju frame terlalu tinggi | satu socket yang lambat |
| Berlaku untuk | semua klien delivery itu | hanya socket yang macet |
| Default | 0 = pass-through | 1 MiB |

Kasus konkretnya: drone LIVE bisa mengirim telemetry 10 Hz. Tanpa coalescer, 10 Hz × N delivery
menghantam Redis, lalu digandakan ke setiap replika, lalu ke setiap socket. `SCALING-1M.md:206-220`
menghitung penghematannya: menurunkan ke 1 Hz memotong egress ~36×. Backpressure tidak menolong di
sini sama sekali — buffer socket klien cepat tidak akan pernah melewati watermark, jadi 10 frame per
detik tetap dikirim ke setiap socket.

Sebaliknya, kalau ada satu klien di terowongan, coalescer tidak menolong: laju 1 Hz pun tetap
menumpuk di socket yang tidak membaca apa pun.

Yang elegan dari `PositionCoalescer` adalah ia **objek murni tanpa Redis** — `Map` + `setInterval`,
sehingga bisa diuji dengan fake timer, dan aturannya identik dengan aturan gateway: transisi status
**tidak pernah** di-coalesce, ia terbit segera **dan** membuang posisi yang sedang di-buffer untuk
delivery itu (supaya frame posisi basi tidak mendarat *setelah* transisi dan membuat drone terlihat
bergerak setelah `DELIVERED`).

**Anchor:**
- `src/deliveries/tracking/position-coalescer.ts:6-17` — dokstring dengan tiga aturannya.
- `src/deliveries/tracking/position-coalescer.ts:35-43` — `submit()`: cabang status
  (`payload.status !== undefined`) menghapus buffer lalu mengirim segera; cabang posisi mem-buffer
  latest-wins per delivery.
- `src/deliveries/tracking/position-coalescer.ts:60-65` — `ensureTimer` + `this.timer.unref?.()`
  dengan komentar *"Never keep the process alive just for the flush timer."* Detail kecil yang
  menyelamatkan `npm test` dari hang.
- `src/deliveries/tracking/position-coalescer.ts:53-58` — `stop()` **flush dulu**, baru berhenti;
  dipanggil dari `tracking.publisher.ts:93-96` di `onModuleDestroy`. Tanpa flush, frame terakhir
  sebelum SIGTERM hilang.
- `src/deliveries/tracking/tracking.publisher.ts:69-78` — titik percabangan: `if (this.coalescer.active)`
  fire-and-forget (timer tidak bisa di-`await`), else publish langsung dan **di-await** —
  *"byte-identical to before"*.
- `src/deliveries/tracking/realtime.constants.ts:4-11` — `POSITION_PUSH_HZ`, default 0.
- `src/deliveries/tracking/position-coalescer.spec.ts` — lima test dengan fake timers; yang paling
  penting: *"publishes a STATUS transition IMMEDIATELY and supersedes a buffered position"*.

**Kenapa dipakai di sini:** perhatikan bahwa **keduanya default OFF/inert**. Header
`realtime.constants.ts:1-2` menyatakannya: *"Both default to OFF/inert, so unset env = today's
behaviour, byte-identical."* Ini disiplin yang layak ditiru: fitur skala dikirim lebih dulu dalam
keadaan mati, terbukti tidak mengubah perilaku, lalu dinyalakan saat metrik memintanya. Kalau kamu
menunggu sampai butuh baru menulisnya, kamu menulis kode kritis di bawah tekanan.

**Alternatif:**
- **Coalescing di sisi klien** (klien throttle render, server kirim apa adanya). Nol perubahan
  server. Trade-off: beban bus Redis dan egress jaringan tidak berkurang sedikit pun — yang justru
  jadi langit-langit di `SCALING-1M.md`. Menghemat CPU render, bukan uang bandwidth.
- **Coalescing di subscriber (tier HTTP), bukan publisher.** Setiap replika bisa punya laju sendiri.
  Trade-off: pesan tetap melewati Redis dengan laju penuh, jadi bottleneck yang sesungguhnya tidak
  tersentuh; kamu memindahkan penghematan ke tempat yang paling murah dan melewatkan yang paling
  mahal.
- **Adaptif, bukan Hz tetap** (turunkan laju hanya saat backlog terdeteksi). Optimal secara teoritis.
  Trade-off: butuh sinyal umpan balik dari Redis/socket yang belum ada, dan perilaku sistem jadi
  tergantung beban — artinya bug yang hanya muncul saat ramai, jenis yang paling sulit direproduksi.
  Konstanta tetap membosankan dan bisa diuji.

**Latihan:** ukur bedanya. Jalankan `redis-cli PSUBSCRIBE 'delivery:*:update'` dan hitung frame per
detik untuk satu delivery simulasi (`| ts | ...` atau cukup hitung manual selama 10 detik). Lalu
restart **worker** dengan `POSITION_PUSH_HZ=1` dan ulangi — laju di bus harus turun ke ~1/detik
sementara transisi status tetap datang seketika. Verifikasi tambahan: pastikan `wscat` yang terhubung
ke api tetap menerima **semua** transisi status di kedua konfigurasi. Bonus: jalankan
`npx jest position-coalescer` dan baca kelima test-nya sebagai spesifikasi perilaku.

---

### 8.9 Graceful drain: `close(1001)` saat SIGTERM, bukan `1006` + thundering herd

Di dunia HTTP, mematikan proses itu mudah: berhenti menerima koneksi baru, selesaikan request yang
sedang jalan (biasanya < 1 detik), keluar. Di dunia socket, tidak ada "request yang sedang jalan" —
yang ada 20.000 koneksi yang menurut definisinya tidak akan pernah selesai sendiri. Deploy adalah
peristiwa yang **terasa oleh pengguna**, dan bentuk rasanya kamu yang menentukan.

Dua skenario:

- **Proses mati begitu saja.** Klien mendeteksi TCP putus dan mendapat close code `1006` (abnormal
  closure). Semua klien pod itu mendeteksinya pada **saat yang hampir sama**, dan semuanya reconnect
  pada saat yang hampir sama. Itu **thundering herd** — pod pengganti yang baru naik langsung
  dihantam 20.000 handshake + 20.000 `verifyAsync` + 20.000 `findOne` sekaligus. Kalau reconnect-nya
  tidak ber-jitter, herd itu bisa memantul: pod baru kewalahan, mati, herd pindah.
- **Proses menutup rapi.** Setiap socket menerima `close(1001, 'server draining')`. `1001` = "going
  away", kode standar untuk "server ini pamit, bukan kamu yang bermasalah". Klien tahu ini bukan
  error dan bisa reconnect dengan backoff ber-jitter.

Nest menyediakan hook-nya: `onApplicationShutdown()`. Yang **wajib** ada supaya hook itu dipanggil
adalah `app.enableShutdownHooks()` di bootstrap — tanpa itu, Nest tidak memasang listener SIGTERM
sama sekali dan hook-mu diam.

Sisi k8s-nya berpasangan (kamu bedah di Fase 11; sekarang cukup lihat bentuknya): `preStop: sleep 10`
memberi waktu agar pod dihapus dari endpoint Service **sebelum** SIGTERM tiba, dan
`terminationGracePeriodSeconds: 120` memastikan kernel tidak SIGKILL di tengah drain.

**Anchor:**
- `src/deliveries/tracking/tracking.gateway.ts:109-123` — `onApplicationShutdown()` dengan dokstring
  lengkap: *"Send each socket a 1001 'going away' close so clients reconnect cleanly (jittered) to
  another realtime pod, instead of a 1006 abnormal closure + a thundering-herd reconnect."*
  Perhatikan `this.server?.clients ?? []` dan `try/catch` — best-effort, shutdown tidak boleh gagal
  karena drain gagal.
- `src/support/chat/support-chat.gateway.ts:123-136` — pasangannya di gateway kedua.
- `src/main.ts:74-76` — `app.enableShutdownHooks()`, tanpa ini hook di atas tidak pernah jalan.
- `src/main.ts:78-83` — SIGTERM juga men-flush span OTel (`shutdownTracing`); kamu akan mendalami ini
  di Fase 9, catat saja sekarang bahwa SIGTERM punya beberapa penumpang.
- `k8s/base/realtime-deployment.yaml:31-32` — `terminationGracePeriodSeconds: 120` dengan komentar
  *"Must exceed the preStop sleep + app drain."*
- `k8s/base/realtime-deployment.yaml:65-67` — `preStop: sleep 10`, *"Longer preStop than api: give
  in-flight sockets a moment after deregistration."* (Bandingkan `api-deployment.yaml:56`: `sleep 5`.)
- `k8s/base/realtime-scaledobject.yaml:22-26` — `restoreToOriginalReplicaCount: false`, dengan alasan
  *"that would mass-disconnect every client at once"*.
- `k8s/base/realtime-scaledobject.yaml:34-40` — scale-down: window stabilisasi 600 detik, maksimum
  **1 pod per 120 detik**. Bandingkan scale-up: window 0, 4 pod per 30 detik. Asimetri itu disengaja.
- `Drovery_Mobile/services/api/trackingSocket.ts:53-60` — sisi klien: `baseDelayMs: 1000`,
  `factor: 2`, `jitterMs: 250`, `maxAttempts: 5`. Jitter itu bagian dari kontrak yang sama.
- `src/deliveries/tracking/tracking.gateway.spec.ts` — test *"closes every socket with a 1001
  going-away (graceful drain)"* dan *"is a no-op when no ws server is attached"*.

**Kenapa dipakai di sini:** karena tier ini akan di-scale otomatis, dan **setiap scale-down memutus
massal**. `realtime-scaledobject.yaml:1-5` menyebutnya: *"a create-RPS spike must not churn
socket-holding nodes (every scale-down mass-disconnects clients)"*. Kalau setiap pemutusan itu
`1006`, autoscaler yang bekerja normal akan terasa seperti gangguan berulang. `1001` mengubah
peristiwa infrastruktur jadi peristiwa yang bisa ditangani klien dengan anggun.

**Alternatif:**
- **Tidak drain sama sekali, andalkan reconnect klien.** Nol kode. Trade-off konkret: badai reconnect
  serempak dan budget 5 percobaan di klien bisa habis kalau pod pengganti belum siap — dan saat
  budget habis, `trackingSocket.ts:25` melaporkan `'drop-exhausted'` sehingga hook turun ke polling
  4 detik. Deploy jadi terasa sebagai "tracking mendadak lambat" oleh sebagian pengguna.
- **Drain bertahap** (tutup 5% socket tiap 500 ms alih-alih semuanya sekaligus). Menyebarkan beban
  reconnect ke pod lain lebih halus daripada jitter klien saja. Trade-off: drain jadi memakan waktu
  yang harus muat di `terminationGracePeriodSeconds` (20.000 socket @ 5%/500ms ≈ 10 detik — masih
  muat di 120 detik, jadi ini sebenarnya kandidat perbaikan nyata), dan kamu menambah timer yang
  harus benar saat proses sedang mati.
**Latihan:** amati kedua kode close dengan mata sendiri.

```bash
npx wscat -c "ws://localhost:3000/?token=<JWT>"
# di terminal lain:
kill -TERM $(pgrep -f "dist/src/main|nest start")
```

`wscat` harus mencetak `Disconnected (code: 1001, reason: "server draining")`. Sekarang bandingkan:
sambungkan lagi, lalu `kill -9` proses yang sama — kamu akan melihat `1006`. Verifikasi ketiga:
komentari `app.enableShutdownHooks()` di `src/main.ts:76`, restart, dan `kill -TERM` lagi — kamu
akan dapat `1006` walaupun `onApplicationShutdown` masih ada di kode. Itu membuktikan hook tanpa
`enableShutdownHooks()` adalah kode mati. Kembalikan.

---

### 8.10 Hot store posisi di Redis, dan fallback Postgres yang *load-bearing*

Konsep ini sebenarnya milik area data, tapi ia ada di sini karena baru masuk akal setelah kamu paham
siapa yang menulis posisi dan seberapa sering.

Masalahnya: setiap tick simulasi (dan setiap frame drone LIVE) melakukan satu `UPSERT` ke tabel
`DeliveryTracking` di Postgres **primary** — datastore yang paling ingin dilindungi. Untuk satu
delivery simulasi itu ~12 upsert; untuk drone 10 Hz jauh lebih banyak. Hot store memindahkan tulisan
itu ke Redis (`HSET` + tandai *dirty*), lalu satu scan checkpoint di tier worker mengalirkannya ke
Postgres per interval — mengubah 12 tulisan jadi 1.

Sampai sini biasa. Yang membuat konsep ini layak dipelajari serius adalah **cabang `catch`-nya**.

Ingat watchdog dari Fase 7: ia mereap (dan **merefund**) delivery LIVE yang `tracking.updatedAt`-nya
lebih tua dari `WATCHDOG_SILENCE_MS`. Sekarang perhatikan: dengan hot store menyala, satu-satunya
yang memajukan `updatedAt` adalah **checkpoint dari Redis**. Kalau Redis mati, `updatedAt` seluruh
delivery LIVE membeku **serempak**, dan watchdog akan menganggap semua drone yang sehat itu hilang
kontak — lalu me-reap dan merefund mereka semua. Redis blip 2 menit menjadi insiden uang.

Makanya `catch` di `writePosition` **menulis langsung ke Postgres** — persis perilaku hot-store-OFF.
Komentarnya diberi label `FALLBACK (load-bearing)` supaya tidak ada yang "merapikannya" jadi sekadar
`logger.warn`. Dan penutupnya cerdas: kalau Postgres **juga** mati, tidak ada false reap yang bisa
terjadi — karena watchdog membaca Postgres, jadi ia tidak bisa jalan juga.

Ada lapisan pengaman kedua: `assertCheckpointSafe()` gagal **loud saat boot** kalau
`CHECKPOINT_INTERVAL_MS × 4 >= WATCHDOG_SILENCE_MS`. Misconfiguration yang akan mempersenjatai
watchdog untuk mereap drone sehat ditolak sebelum proses hidup, bukan ditemukan saat insiden.

**Anchor:**
- `src/deliveries/tracking/tracking-hot-store.ts:28-39` — dokstring: sisi producer, sisi checkpoint,
  sisi reader, dan *"Inert unless TRACKING_HOT_STORE=redis"*.
- `src/deliveries/tracking/tracking-hot-store.ts:96-131` — cabang `catch` dan komentar
  `FALLBACK (load-bearing)` di `:100-107`. Baca seluruh tujuh baris komentar itu; ini contoh terbaik
  di repo tentang "kenapa satu blok try/catch tidak boleh disederhanakan".
- `src/deliveries/tracking/tracking-hot-store.ts:149-196` — `drainCheckpoints`: `SPOP` di `:158`
  (atomic claim, jadi lintas replika worker tiap delivery di-flush **tepat satu** kali), dan re-mark
  dirty di `:184-186` kalau satu upsert gagal.
- `src/deliveries/tracking/tracking-hot-store.constants.ts:21-31` — `CHECKPOINT_INTERVAL_MS` dengan
  label `LOAD-BEARING SAFETY INVARIANT`.
- `src/deliveries/tracking/tracking-hot-store.constants.ts:51-70` — `assertCheckpointSafe()`, gagal
  loud di boot.
- `src/deliveries/tracking/tracking.service.ts:14-40` — sisi baca: `readWithFallback` (read replica)
  lalu **overlay** posisi hot di `:24-31`, supaya polling tidak mundur ke posisi checkpoint terakhir.
- `src/deliveries/tracking/tracking-checkpoint.scheduler.ts:18-25` — repeatable scheduler BullMQ,
  polanya identik dengan `WatchdogScheduler` dari Fase 6, dan `RUN_PROCESSOR = IS_WORKER_TIER` di
  `:16`.
- `AUDIT-LOG.md:820-824` — gap yang **disadari**: `SPOP` mengambil batch acak tanpa aging, jadi di
  atas ~5.000 delivery LIVE satu delivery bisa kelaparan melewati `WATCHDOG_SILENCE_MS` dan
  di-false-reap. Solusinya (ZSET ber-aging + gauge backlog) sudah dirancang tapi belum dikerjakan.

**Kenapa dipakai di sini:** karena ia mengajarkan pola berpikir yang berbeda dari fase-fase
sebelumnya. Sampai sekarang kamu belajar "optimasi = pindahkan beban ke tempat yang lebih murah".
Di sini kamu belajar bagian keduanya: **setiap kali kamu memindahkan sebuah tulisan, kamu memutus
sebuah sinyal yang dipakai orang lain.** `tracking.updatedAt` bukan sekadar kolom; ia detak jantung
yang dibaca watchdog. Sebelum mengoptimasi apa pun, pertanyaannya adalah "siapa yang membaca efek
samping dari tulisan yang sedang saya hilangkan?"

**Alternatif:**
- **Tidak pakai hot store (default hari ini).** Nol kompleksitas, nol mode kegagalan baru,
  `updatedAt` selalu jujur. Trade-off terukur: ~12 upsert per delivery simulasi ke primary, dan itu
  memang salah satu langit-langit yang `SCALING-1M.md` §3 identifikasi. Kalau kamu tidak berada di
  jalur menuju ratusan ribu pengguna, ini pilihan yang benar.
- **Ganti sinyal watchdog** — misalnya baca kesegaran dari Redis hot key alih-alih
  `tracking.updatedAt`. Menghapus alasan keberadaan fallback Postgres itu sepenuhnya. Trade-off:
  watchdog jadi bergantung pada Redis, sehingga Redis mati = watchdog buta (bukan false-reap, tapi
  no-reap — delivery benar-benar nyangkut jadi tidak ketahuan); dan kamu menukar satu mode gagal
  dengan mode gagal lain, bukan menghapusnya.
**Latihan:** buktikan fallback itu load-bearing dengan cara paling langsung: hapus dan lihat
akibatnya. Jalankan dengan `TRACKING_HOT_STORE=redis`, buat delivery LIVE, lalu matikan Redis
sementara simulasi jalan. Amati `SELECT "updatedAt" FROM "DeliveryTracking" WHERE "deliveryId"='<id>'` —
`updatedAt` harus **tetap maju** (lewat jalur fallback). Sekarang komentari blok `try` Postgres di
`tracking-hot-store.ts:108-125`, ulangi, dan amati `updatedAt` membeku. Hitung: dengan
`WATCHDOG_SILENCE_MS` yang berlaku, berapa lama sampai watchdog akan mereap? Verifikasi terakhir:
jalankan dengan `CHECKPOINT_INTERVAL_MS` yang terlalu besar (mis. `600000`) dan konfirmasi proses
**menolak boot** dengan pesan dari `assertCheckpointSafe()`.

---

### 8.11 Polling sebagai backstop yang sengaja dipertahankan

Ini keputusan produk, bukan keputusan teknis, dan ia yang membuat semua yang di atas boleh gagal.

WebSocket di sistem ini bersifat **aditif**. `GET /api/v1/deliveries/:id` tidak berubah sedikit pun
saat WS dikirim, dan tulisan Postgres per tick tetap terjadi. Artinya: Redis mati, publisher error,
subscriber belum re-arm, frame di-drop backpressure — semuanya turun ke jalur yang sudah terbukti,
bukan ke layar kosong.

Itulah alasan kamu melihat kata "fail-open" berulang kali di kode fan-out. `TrackingPublisher`
menelan error publish (`tracking.publisher.ts:88-90`) dengan alasan tertulis *"polling remains
authoritative"*. Hot store menelan error Redis. Gateway menelan error `send`. Tidak satu pun jalur
realtime yang boleh menggagalkan sesuatu yang sudah benar.

Sisi klien sudah berevolusi lebih jauh daripada `ARCHITECTURE.md:80` (yang masih menulis *"The mobile
app still polls"*). Di baseline sekarang `Drovery_Mobile` sudah **WS-primary / poll-fallback**: socket
jadi sumber utama, polling 4 detik menyala hanya kalau socket tidak tersedia atau kehabisan budget
reconnect. Perbedaan doc vs kode ini normal di repo hidup: percaya kode, pakai doc untuk memahami niat.

**Anchor:**
- `ARCHITECTURE.md:80` — *"Polling coexists ... WS is purely additive, so polling stays the source
  of truth and the backstop on a Redis blip."*
- `src/deliveries/tracking/tracking.publisher.ts:34-40` — *"Fail-open: a publish error never breaks
  the delivery simulation (polling remains authoritative)."*
- `src/deliveries/tracking/tracking.publisher.ts:80-91` — `doPublish` yang menelan error jadi
  `logger.warn`.
- `Drovery_Mobile/features/delivery/hooks/useDeliveryTracking.ts:35-43` — dokstring
  **WS-PRIMARY / POLL-FALLBACK** lengkap dengan aturannya.
- `Drovery_Mobile/features/delivery/hooks/useDeliveryTracking.ts:18` — `POLL_INTERVAL_MS = 4000`.
- `Drovery_Mobile/services/api/trackingSocket.ts:20-25` — lima `UnavailableReason`, masing-masing
  jalur turun ke poll.
- `Drovery_Mobile/features/delivery/hooks/useDeliveryTracking.ts:145-148` — komentar `reconcile`:
  satu `getById` otoritatif setelah transisi non-terminal, *"to backfill eta/proof/payment/
  failureReason the push omits"*. Ini mengungkap sesuatu penting: frame WS **parsial** (lihat
  `TrackingUpdatePayload` di `tracking.publisher.ts:19-27` — cuma 5 field), jadi HTTP tetap
  dibutuhkan untuk gambar utuh, bukan sekadar sebagai cadangan.

**Kenapa dipakai di sini:** karena realtime adalah lapisan yang paling banyak bagian bergeraknya dan
paling sering rusak di produksi. Merancang sistem di mana kegagalannya berarti "sedikit lebih lambat"
alih-alih "rusak" adalah keputusan arsitektur paling berharga di seluruh fase ini. Perhatikan juga
bahwa `TrackingUpdatePayload` sengaja **tidak** membawa objek delivery penuh — itu menjaga frame
tetap kecil (penting untuk backpressure di 8.7) sekaligus memaksa klien tetap punya jalur HTTP.

**Alternatif:**
- **WS-only, hapus polling.** Hemat: 5.000 klien × 1 request/4 detik = 1.250 rps yang lenyap. Trade-off
  konkret: setiap kegagalan realtime jadi kegagalan produk, dan kamu memindahkan semua beban
  keandalan ke jalur yang **paling** kompleks. Juga: frame WS parsial, jadi kamu harus membesarkan
  payload untuk membawa semua field — persis lawan dari 8.7.
- **Cache snapshot tracking di Redis dengan TTL 1-2 detik** (disebut di `ARCHITECTURE.md:104`).
  Polling tetap ada tapi jadi murah: 5.000 poller memukul satu key cache, bukan Postgres. Trade-off:
  data bisa basi sampai 2 detik, satu key panas lagi di Redis yang sudah memikul empat peran, dan
  invalidasi harus benar saat status berubah.
**Latihan:** matikan realtime dan pastikan produk tetap jalan. Jalankan API + worker, buat delivery,
lalu `docker compose stop redis`. Cek: (a) `wscat` sunyi; (b) `curl` ke
`GET /api/v1/deliveries/:id` **tetap** mengembalikan `tracking` yang bergerak; (c) log worker berisi
`publish failed: ...` sebagai `warn`, bukan error yang menggagalkan job. Sekarang **rusak sengaja**:
ubah `tracking.publisher.ts:88-90` supaya `throw e` alih-alih `logger.warn`, ulangi dengan Redis
mati, dan amati simulasi delivery **berhenti maju**. Itu satu blok catch yang memisahkan "realtime
mati" dari "produk mati". Kembalikan.

---

### 8.12 MQTT sebagai transport kedua + MQTT5 `$share`

Sampai sini semua transport melayani manusia. MQTT melayani **drone** — dan lawan bicaranya
mengubah semua kalkulasinya: perangkat berbaterai, jaringan seluler tidak stabil, firmware terbatas.
Di sana protokolnya harus ringan, punya QoS, dan brokernya (Mosquitto) sudah jadi standar IoT.

Tapi bagian yang wajib benar-benar kamu pahami bukan MQTT-nya, melainkan `$share`. MQTT default-nya
**broadcast**: setiap subscriber ke `drovery/telemetry/+` menerima **setiap** frame. Dengan 5 replika
api, satu frame telemetry diproses 5 kali — 5× validasi, 5× tulisan DB, 5× publish ke Redis, dan
lima CAS yang saling berebut. Bukan cuma boros; itu salah.

MQTT5 *shared subscriptions* menyelesaikannya di broker: subscribe ke `$share/<group>/<filter>` dan
broker mengirim tiap pesan ke **tepat satu** anggota grup. Semantiknya setara consumer group di
Kafka.

Detail desain yang elegan dan gampang salah dibaca: handler didaftarkan dengan **bare filter**
(`drovery/telemetry/+`), dan pembungkusan `$share` hanya terjadi saat subscribe ke broker. Alasannya:
topik yang **datang** adalah `drovery/telemetry/drone-1` — tanpa prefix `$share` sama sekali. Jadi
dispatch harus mencocokkan filter aslinya. Kalau kamu menyimpan filter yang sudah dibungkus, tidak
akan ada pesan yang pernah cocok.

Dan perhatikan filosofinya konsisten dengan 8.11: MQTT **fail-open**. `MqttService` inert kalau
`MQTT_URL` kosong, connect-nya non-blocking, semua event transport hanya `warn`, dan broker mati
berarti degradasi ke HTTP-only — bukan crash.

**Anchor:**
- `src/mqtt/mqtt.constants.ts:15-18` — `sharedFilter`, tiga baris yang berisi seluruh konsepnya:
  *"Wrap a filter as an MQTT5 shared subscription so the broker delivers each message to exactly ONE
  member of the group (one api replica), not every subscriber."*
- `src/mqtt/mqtt.service.ts:16-30` — dokstring: inert, fail-open, re-arm on reconnect, dan
  *"Subscribers register a BARE filter ... but dispatch matches the incoming topic against the bare
  filter."*
- `src/mqtt/mqtt.service.ts:102-107` — `subscribe()` menyimpan bare filter ke `this.handlers`.
- `src/mqtt/mqtt.service.ts:109-117` — `armSubscription()`: di sinilah `$share` dibungkus, dengan
  `{ qos: 1 }` (at-least-once → idempotency dari Fase 5 tetap wajib).
- `src/mqtt/mqtt.service.ts:87-88` — re-arm pada `'connect'`; pola yang sama dengan `rearmAll()` di 8.5.
- `src/config/configuration.ts:136-139` — *"MQTT5 SHARED SUBSCRIPTIONS ($share/<group>/…) so EXACTLY
  ONE api replica processes each ingest frame (no N× duplicate processing across the API tier).
  Disable (MQTT_SHARED=false) only for a v3.1.1-only broker — then run a single ingest owner."*
- `src/deliveries/telemetry/mqtt-telemetry.subscriber.ts:9-17` — adapter transport tipis di atas inti
  `TelemetryService.ingest` yang **sama** dengan HTTP: *"a drop-in second producer"*.
- `src/deliveries/deliveries.module.ts:95-97` — ingest hanya di `IS_INGEST_TIER` (api + dev), **tidak**
  di realtime — komentarnya: *"which fans OUT, it doesn't ingest"*.
- `src/deliveries/telemetry/telemetry.service.ts:217-223` — dari ingest, jalur kembali ke
  `publishUpdate` — MQTT masuk, WebSocket keluar, di satu proses.
- `src/metrics/metrics.service.ts:217-224` — `drovery_mqtt_frames_total{flow,result}`, alat ukur untuk
  latihan di bawah.
- `docker-compose.yml:105-107` — tier api di Compose sudah menyala dengan `MQTT_SHARED: 'true'`.

**Kenapa dipakai di sini:** karena ia contoh paling bersih di repo tentang "satu inti, banyak
transport". `TelemetryService.ingest` tidak tahu apakah frame datang lewat HTTP atau MQTT — semua
validasi, semua gerbang keselamatan, semua CAS ada di satu tempat. Transport hanyalah adapter tipis.
Bandingkan dengan godaan yang wajar: menulis handler MQTT terpisah "karena bentuk datanya beda
sedikit". Itu cara paling cepat mendapat dua aturan keselamatan yang menyimpang perlahan.

**Alternatif:**
- **HTTP POST `/ingest/telemetry`** — sudah ada dan tetap jadi jalur default. Sederhana, debuggable
  dengan `curl`, satu jalur auth. Trade-off: tiap frame membayar TCP+TLS handshake (kecuali
  keep-alive terjaga, yang tidak realistis di jaringan seluler yang berpindah sel), boros baterai
  untuk perangkat yang mengirim 1 Hz.
- **MQTT tanpa `$share`, dengan satu pod ingest khusus.** Bekerja, dan itu escape hatch yang
  komentar `configuration.ts:138` sebutkan untuk broker v3.1.1. Trade-off konkret: pod itu jadi
  single point of failure dan tidak bisa di-autoscale — kamu menukar duplikasi dengan ketersediaan.
- **Kafka consumer group.** Semantik "tepat satu konsumen per partisi" setara `$share`, plus replay
  dan ordering. Trade-off: client Kafka terlalu berat untuk firmware drone berbatas daya —
  kandidatnya lenyap di sisi perangkat, bukan di sisi server.
**Latihan:** buktikan `$share` mencegah duplikasi. Jalankan broker (`docker compose up mosquitto`),
lalu **dua** proses api dengan `MQTT_URL=mqtt://localhost:1883 MQTT_SHARED=true` di port berbeda.

```bash
mosquitto_pub -h localhost -t 'drovery/telemetry/drone-1' \
  -m '{"droneId":"drone-1","lat":-6.2,"lng":106.8}'
```

Jumlahkan `drovery_mqtt_frames_total{flow="telemetry"}` dari `/metrics` **kedua** proses: totalnya
harus **1**. Lalu set `MQTT_SHARED=false` di keduanya, restart, ulangi — totalnya jadi **2**. Itulah
duplikasi yang `$share` cegah, dan sekarang kamu bisa membayangkan bentuknya di 5 replika. Bonus
tanpa broker: tulis unit test untuk `MqttService.topicMatches` yang mencakup `+`, `#`, dan kasus
jumlah segmen tidak sama.

---

### 8.13 Fan-out push notification: fire-and-forget yang benar

Push notification adalah "realtime untuk klien yang tidak sedang terbuka". Kamu sudah kenal sisi
klien-nya dari Capacitor/Expo. Sisi servernya punya tiga pelajaran yang tidak kelihatan dari sana.

**(1) Notifikasi adalah efek samping, bukan bagian kebenaran transaksi.** Baris in-app **selalu**
dibuat (feed harus lengkap), push dikirim dengan `void this.maybeSendPush(...)` — sengaja tidak
di-`await`. Push gagal, Expo lambat, preferensi mematikannya, quiet hours menahannya: tidak satu pun
boleh menggagalkan pembuatan notifikasi.

Hubungkan ini ke CAS dari Fase 5, karena di situlah letak bahayanya. Di worker, transisi status sudah
di-commit lewat CAS **sebelum** efek samping dijalankan. Artinya kalau efek samping melempar error
dan job di-retry, CAS akan mencocokkan 0 baris dan handler langsung `return` — **efek samping itu
hilang selamanya**. Makanya `simulation.processor.ts` membungkus tiap efek samping dengan `safe()`.

Ada asimetri yang layak kamu perhatikan dan pertanyakan: di `simulation.processor.ts:426`,
`publishUpdate` **tidak** dibungkus `safe()`, sedangkan di `deliveries.service.ts:1361` ia dibungkus.
Yang pertama aman karena `doPublish` sudah menelan errornya sendiri (8.11); yang kedua adalah sabuk
pengaman kedua. Pertahanan berlapis, bukan inkonsistensi — tapi kamu harus membuka dua file untuk
tahu itu.

**(2) Batas provider adalah kontrak keras.** Expo **menolak** request berisi lebih dari 100 pesan,
jadi kode meng-chunk 100. Ini bukan optimasi; melewatinya berarti seluruh batch gagal.

**(3) Waktu itu lokal.** Quiet hours adalah waktu dinding. Container jalan di UTC. Mengevaluasi
"jangan ganggu jam 22-07" di UTC menggeser jendela setiap pengguna Indonesia ~7 jam — pengguna
diganggu jam 3 pagi dan dibiarkan senyap jam 3 sore. `currentServiceHour()` memakai
`Intl.DateTimeFormat` dengan timezone terkonfigurasi (default `Asia/Jakarta`), lengkap dengan dua
penanganan tepi: ICU tertentu merender tengah malam sebagai `"24"`, dan TZ string salah harus
degradasi ke waktu server, bukan crash.

**Anchor:**
- `src/notifications/notifications.service.ts:114-127` — baris in-app selalu dibuat (`:114-115`
  komentarnya), lalu `void this.maybeSendPush(...)` di `:127` dengan kontrak di `:125-126`:
  *"fire-and-forget; a failed/absent/suppressed push never breaks creation"*.
- `src/notifications/notifications.service.ts:11-13` — `EXPO_PUSH_CHUNK_SIZE = 100` dengan alasan
  *"Expo HARD-rejects a push request carrying more than 100 messages"*.
- `src/notifications/notifications.service.ts:274-315` — loop chunking, parsing tiket, pengumpulan
  `deadTokens` untuk tiket `DeviceNotRegistered`.
- `src/notifications/notifications.service.ts:339-358` — `reapDeadDevices`, idempotent, tidak pernah
  melempar. Tanpa ini, token mati menumpuk dan menggelembungkan setiap fan-out berikutnya.
- `src/notifications/notifications.service.ts:212-233` — `currentServiceHour()` dengan alasan
  timezone-nya, plus normalisasi `% 24` dan `catch` yang degradasi.
- `src/notifications/notifications.service.ts:207-209` — wrap-around window: `22 → 7` ditangani
  dengan `hour >= start || hour < end`. Uji ini; salah tanda di sini berarti kebalikan total.
- `src/deliveries/simulation/simulation.processor.ts:401-402` — *"Side effects are best-effort: a
  transient failure must not fail the already-applied transition (which would skip on retry via the
  CAS above)."*
- `src/deliveries/simulation/simulation.processor.ts:459-465` — `safe()`.
- `src/deliveries/simulation/simulation.processor.ts:426-432` vs
  `src/deliveries/deliveries.service.ts:1361-1367` — asimetri `safe()` yang dibahas di atas.

**Kenapa dipakai di sini:** karena push adalah fan-out **ketiga** di sistem ini (setelah Redis
pub/sub dan MQTT), dan ia satu-satunya yang keluar ke pihak ketiga dengan latensi tak terduga.
Menaruhnya di jalur kritis berarti mengikat transaksi database ke waktu respons server orang lain —
satu Expo lambat = row lock lama = insiden yang penyebabnya di luar kendalimu.

**Alternatif:**
- **Queue push khusus, KEDA-scaled.** Ini rekomendasi tertulis repo sendiri di `SCALING-1M.md:271`.
  Manfaat konkret: tahan lonjakan, retry per-device, dan push jadi terlihat di metrik queue depth
  seperti job lain. Trade-off: satu queue + satu processor lagi untuk dirawat. Repo belum
  mengerjakannya — gap yang **disadari dan dicatat**, bukan diabaikan.
- **FCM / APNs langsung.** Menghapus perantara Expo dan limitnya. Trade-off konkret: kamu mengurus
  sertifikat APNs (kedaluwarsa tahunan), service account FCM, dan **dua** format payload berbeda —
  pekerjaan operasional nyata yang dibayar setiap tahun.
- **Outbox pattern untuk push.** Infrastrukturnya sudah ada di repo (dipakai referral reward), jadi
  ini bukan pekerjaan dari nol. Manfaat: at-least-once yang durabel — push tidak hilang saat proses
  mati di antara commit dan pengiriman. Trade-off: satu baris DB per notifikasi, di database yang
  seluruh dokumen scaling berusaha lindungi.
**Latihan:** buat pengiriman push bisa diamati. Tambahkan Counter
`drovery_push_sent_total{result}` (`ok` / `failed` / `suppressed` / `dead_token`) di `MetricsService`,
increment di empat titik yang sesuai di `NotificationsService`, lalu tulis spec yang memalsukan
`global.fetch` agar mengembalikan tiket `DeviceNotRegistered` dan meng-assert (a) counter `dead_token`
naik dan (b) `prisma.device.deleteMany` dipanggil. Verifikasi kedua: tulis spec untuk `inQuietHours`
yang membuktikan window `22 → 7` benar pada jam 23 **dan** jam 3 **dan** jam 12 (yang terakhir harus
`false`).

---

### 8.14 Papan banding: kapan transport lain lebih baik

Konsep ini adalah tempat semua alternatif dari 8.1-8.13 duduk berdampingan, karena capstone menuntut
satu catatan tertulis: *kapan SSE akan lebih baik dari WS di sistem ini, dan kapan tidak.* Jangan
tulis catatan itu sebelum tabel ini masuk akal buatmu.

| Opsi | Menang kalau | Kalah kalau | Biaya migrasi di Drovery |
|---|---|---|---|
| **`ws` + Redis pub/sub** (sekarang) | butuh dua arah + kontrol penuh atas backpressure & mode pub/sub | tim kecil yang tidak mau merawat fan-out sendiri | — |
| **socket.io + redis-adapter** | butuh room/ack/fallback long-polling gratis, ada proxy yang blokir WS | butuh 20k socket/pod dan mode sharded | ganti klien di mobile **dan** admin; turunkan `threshold` di `realtime-scaledobject.yaml:46` |
| **SSE** | aliran **satu arah** (tracking!), reconnect otomatis by spec, lolos proxy, tidak butuh `proxy-read-timeout` khusus | butuh dua arah (support chat), butuh banyak stream per klien (HTTP/1.1 batas 6 koneksi/origin) | gateway tracking jadi controller `text/event-stream`; chat **tetap** WS → dua mekanisme |
| **Sticky session** | fan-out tidak diinginkan sama sekali | tier harus stateless & bisa scale-down mulus | hapus publisher/subscriber, tapi worker tetap perlu tahu pod pemegang delivery |
| **NATS / Kafka** | fan-out melewati langit-langit satu node Redis | belum ada bukti Redis-nya patah | satu sistem infra baru; `pubsub-transport.ts` jadi adapter ketiga |
| **Managed (Ably / Pusher)** | ingin socket + presence + history tanpa mengurus tier realtime | biaya per-koneksi pada 100k+ socket, atau data tidak boleh keluar | hapus tier realtime & KEDA; auth jadi token signing ke pihak ketiga |
| **µWebSockets.js** | langit-langit socket/pod adalah batas biaya utama | ingin tetap di abstraksi `@nestjs/websockets` | tulis ulang kedua gateway; binary native masuk image (Fase 10) |
| **FCM/APNs langsung** | ingin lepas dari limit & perantara Expo | tidak mau mengurus sertifikat + dua payload | ganti `sendPushToUser`, tambah kredensial per platform |

**Anchor:**
- `src/deliveries/tracking/tracking.publisher.ts:19-27` — `TrackingUpdatePayload`: 5 field, semuanya
  **satu arah**. Ini bukti terkuat bahwa tracking secara teknis adalah kasus SSE.
- `src/support/chat/support-chat.gateway.ts:178-213` — `@SubscribeMessage('send')`: klien
  **mengirim** dan servernya memvalidasi + menyimpan + mem-publish. Ini bukti terkuat bahwa chat
  bukan kasus SSE.
- `ARCHITECTURE.md:30` — diagram menyebut tier itu *"Realtime tier (WS/SSE)"*; SSE memang sudah ada
  di ruang solusi sejak awal, bukan ide baru.
- `k8s/base/realtime-ingress.yaml:10` — `proxy-read-timeout: '3600'`, biaya operasional yang khas WS
  dan sebagian besar hilang dengan SSE (yang punya mekanisme keep-alive sendiri lewat komentar `:`).
- `k8s/base/realtime-scaledobject.yaml:46-47` dan `:50-57` — angka yang berubah kalau transportnya
  berubah.
- `SCALING-1M.md:299` — jalur eskalasi resmi: *"Flip REDIS_PUBSUB_MODE=sharded ... or move to a
  broker."*

**Kenapa dipakai di sini:** karena "kenapa teknologi X dipilih" adalah salah satu tujuan eksplisit
kurikulum ini, dan jawaban yang berguna selalu berbentuk **apa yang harus diubah kalau pilihannya
lain**, bukan daftar fitur. Kolom terakhir tabel di atas adalah bagian yang sebenarnya bernilai.

**Alternatif:** seluruh tabel di atas. Dua yang paling sering salah dipilih:
- **SSE untuk tracking, WS tetap untuk chat.** Menang: tracking memang satu arah, reconnect otomatis
  by spec, `proxy-read-timeout: '3600'` tidak lagi wajib. Kalah: kamu merawat **dua** mekanisme
  realtime + dua jalur fan-out, dan pada HTTP/1.1 klien terbatas ~6 koneksi per origin.
- **Managed (Ably/Pusher) menggantikan tier realtime.** Menang: tidak ada tier socket, KEDA, atau
  `pubsub-transport.ts` untuk dirawat. Kalah: harga per-koneksi pada 20.000+ socket/pod bukan lagi
  biaya marjinal, dan auth berubah jadi token signing ke pihak ketiga.

**Latihan:** tulis catatan capstone-nya sekarang, maksimal 300 kata, dengan struktur:
(1) satu paragraf kapan SSE menang di sistem ini — sebutkan `TrackingUpdatePayload` dan
`realtime-ingress.yaml:10` sebagai bukti; (2) satu paragraf kapan tidak — sebutkan
`@SubscribeMessage('send')` di support chat dan batas 6 koneksi HTTP/1.1 per origin; (3) satu kalimat rekomendasi
untuk Drovery hari ini beserta alasannya. Verifikasi: berikan catatanmu ke orang lain (atau baca
ulang tiga hari kemudian) dan pastikan setiap klaim bisa ditelusuri ke satu anchor.

---

## Capstone

Empat demo + satu catatan. Semuanya harus bisa **gagal di depan mata** — kalau kriteria bisa dicentang
tanpa risiko gagal, itu bukan kriteria.

**Setup:** dua proses api (port 3000 & 3001) + satu worker + Redis. Jangan pakai
`docker compose --scale api=2` (port mapping tetap di `docker-compose.yml:119-120`).

### 1. Fan-out lintas proses
- [ ] `wscat` #1 tersambung ke **:3000**, `wscat` #2 ke **:3001**, keduanya `subscribe` ke delivery
      yang **sama** dan menerima `{"event":"subscribed",...}`.
- [ ] Delivery dibuat lewat :3000; **kedua** `wscat` menerima frame `tracking:update` yang identik,
      dihitung oleh worker (yang tidak punya HTTP server sama sekali).
- [ ] `redis-cli PSUBSCRIBE 'delivery:*:update'` menampilkan pesan yang sama, satu kali per frame
      (bukan dua kali — publisher cuma satu).
- [ ] Kamu bisa menunjukkan di kode **baris mana** yang membuat gateway hidup di :3000/:3001 dan
      tidak di worker (`deliveries.module.ts:91`).

### 2. Re-arm setelah Redis mati
- [ ] Dengan klien ter-subscribe, `docker compose stop redis`. `wscat` **tetap tersambung** (socket
      tidak putus — Redis bukan jalur socket).
- [ ] `docker compose start redis`. Log api memuat `tracking redis ready — re-arming 1 subscription(s)`.
- [ ] Frame kembali mengalir **tanpa** klien reconnect.
- [ ] Mutasi: pindahkan `this.desired.add(channel)` ke setelah `pubSubSubscribe(...)`;
      `npx jest tracking.subscriber` **gagal**. Kembalikan; hijau lagi.

### 3. Backpressure yang selektif
- [ ] Api jalan dengan `WS_MAX_BUFFERED_BYTES=1024 POSITION_PUSH_HZ=0`; klien Node yang
      `socket.pause()` tersambung dan ter-subscribe.
- [ ] `curl -s localhost:3000/api/v1/metrics | grep drovery_ws_dropped_frames_total` menunjukkan
      angka **naik** selama simulasi.
- [ ] Setelah `resume()`, klien **tetap menerima** frame yang membawa `status` — termasuk status
      terminal. Buktikan dengan menyalin output frame-nya.
- [ ] Mutasi: hapus `!isStatusFrame &&` dari `tracking.gateway.ts:182`;
      `npx jest tracking.gateway` **gagal** pada test *"always sends a STATUS transition"*.

### 4. Graceful drain
- [ ] `kill -TERM` ke proses api → `wscat` mencetak close code **1001** dengan reason
      `server draining`.
- [ ] `kill -9` ke proses api → `wscat` mencetak **1006**. Kamu bisa menjelaskan bedanya untuk
      pengguna.
- [ ] Dengan `app.enableShutdownHooks()` dikomentari, `kill -TERM` menghasilkan **1006** — kamu bisa
      menjelaskan kenapa hook-nya tidak jalan.

### 5. Catatan tertulis
- [ ] ≤300 kata: kapan SSE lebih baik dari WS di sistem ini, kapan tidak, dan rekomendasi untuk
      Drovery hari ini.
- [ ] Setiap klaim menunjuk ke satu anchor nyata (`file:baris`).
- [ ] Catatan itu menyebut **apa yang harus berubah** kalau rekomendasinya diadopsi, bukan hanya
      "lebih cocok".

**Peregangan opsional** (jangan menunda Fase 9 karenanya): jalankan worker dengan
`REDIS_PUBSUB_MODE=sharded` sementara api tetap `standard`, lalu tulis satu paragraf tentang cara
**mendeteksi** kegagalan diam itu di produksi — metrik apa yang kamu tambahkan, dan kenapa
`drovery_ws_connections` saja tidak cukup.

---

## Gerbang keluar

Kalau ada satu saja yang belum bisa kamu jawab tanpa membuka kode, jangan lanjut ke Fase 9.

**1. Worker menghitung `IN_TRANSIT` untuk delivery d-42. Klien pemilik d-42 tersambung ke api replica
#3. Runut perjalanan lengkap frame itu, sebutkan setiap komponen dan proses tempatnya hidup.**

<details><summary>Jawaban</summary>

`SimulationProcessor` (worker) → CAS berhasil → `TrackingPublisher.publishUpdate` (worker, `tracking.publisher.ts:69`)
→ `PUBLISH delivery:d-42:update` ke Redis → `TrackingSubscriber` di **setiap** replika HTTP yang
ter-subscribe ke channel itu menerima event `'message'` → `dispatch()` mem-parse dan memanggil handler
yang didaftarkan gateway lewat `onUpdate` (`tracking.gateway.ts:67-73`) → `deliverToLocalClients`
(`:167-191`) mengirim `{event:'tracking:update', data}` ke socket lokal yang ada di
`this.subscriptions.get('d-42')`. Replika yang tidak punya klien untuk d-42 tidak pernah subscribe ke
channel itu, jadi tidak menerima apa pun.
</details>

**2. Redis mati 20 detik lalu hidup lagi. Tanpa `rearmAll()`, apa yang dialami klien — dan kenapa
gejalanya begitu sulit dideteksi?**

<details><summary>Jawaban</summary>

Socket klien **tidak putus** (Redis bukan jalur socket), jadi klien tetap merasa "connected".
SUBSCRIBE yang gagal saat outage tidak diantre (`enableOfflineQueue: false`) dan dulu hanya di-log.
Gateway sudah menjawab `subscribed` dan entri map-nya tidak kosong, sehingga subscriber berikutnya
untuk delivery yang sama memakai ulang entri itu alih-alih subscribe lagi. Hasilnya: klien tuli
seumur hidup socket-nya, tanpa error, tanpa metrik yang naik, tanpa reconnect. Terlihat seperti
"drone-nya lagi diam" (`tracking.subscriber.ts:36-50`, `AUDIT-LOG.md:768-775`).
</details>

**3. Apa yang membedakan frame yang boleh di-drop dari yang tidak? Berikan aturannya dalam satu
kalimat, lalu alasannya.**

<details><summary>Jawaban</summary>

Aturan: frame boleh di-drop kalau **ada frame berikutnya yang akan menggantikannya**. Posisi lossy —
frame berikutnya datang ~1 detik lagi. Status non-lossy — tidak ada yang menggantikan `DELIVERED`,
dan status terminal justru **membekukan** posisi sehingga tidak akan ada frame posisi lagi;
pemulihannya hanya lewat polling. Implementasinya: `isStatusFrame` di `tracking.gateway.ts:176`, dan
aturan yang sama diulang di `PositionCoalescer.submit` (`position-coalescer.ts:36`).
</details>

**4. `POSITION_PUSH_HZ` dan `WS_MAX_BUFFERED_BYTES` sama-sama membuang frame posisi. Kapan yang satu
menolong dan yang lain tidak?**

<details><summary>Jawaban</summary>

Coalescer ada di **publisher** dan menurunkan beban **bus** — ia menolong saat produsen terlalu cepat
(drone LIVE 10 Hz), dan menolong **semua** klien delivery itu sekaligus. Backpressure ada di
**gateway** dan menurunkan beban **satu socket** — ia menolong saat satu klien lambat, dan tidak
berpengaruh sama sekali pada laju di bus. Drone 10 Hz + semua klien cepat: backpressure tidak pernah
terpicu. Drone 1 Hz + satu klien di terowongan: coalescer tidak menolong sama sekali.
</details>

**5. Publisher `sharded`, subscriber `standard`. Apa yang terjadi, dan bagaimana kamu mendiagnosisnya?**

<details><summary>Jawaban</summary>

Tidak ada error di mana pun: publish sukses, subscriber sehat, health check hijau — frame cuma tidak
pernah sampai. `SPUBLISH` hanya dikirim ke listener `SSUBSCRIBE`, dan di ioredis pesannya datang
sebagai event `'smessage'`, bukan `'message'` (`pubsub-transport.ts:21-23`, `:41-46`). Diagnosis:
cek `REDIS_PUBSUB_MODE` di **semua** tier (log boot mencetak modenya —
`tracking.publisher.ts:66` dan `tracking.subscriber.ts:77`), lalu `SSUBSCRIBE` manual di
`redis-cli` untuk memastikan busnya hidup.
</details>

**6. Kenapa `close(1001)` penting, dan apa yang membuat hook-nya benar-benar dipanggil?**

<details><summary>Jawaban</summary>

`1001` = "going away": klien tahu ini pamit server, bukan error, sehingga reconnect ber-jitter ke pod
lain. `1006` (abnormal) membuat semua klien pod mendeteksi putus pada saat yang sama → thundering
herd ke pod pengganti, dan budget reconnect klien (5 percobaan,
`trackingSocket.ts:53-60`) bisa habis → turun ke polling. Hook-nya adalah
`onApplicationShutdown()` di `tracking.gateway.ts:115`, dan ia hanya dipanggil kalau
`app.enableShutdownHooks()` ada di bootstrap (`main.ts:76`) — tanpa itu Nest tidak memasang listener
SIGTERM sama sekali.
</details>

**7. Hot store menyala dan Redis mati. Kenapa `writePosition` menulis ke Postgres di cabang `catch`
alih-alih sekadar `logger.warn`?**

<details><summary>Jawaban</summary>

Dengan hot store ON, satu-satunya yang memajukan `tracking.updatedAt` adalah checkpoint dari Redis.
Watchdog mereap **dan merefund** delivery LIVE yang `updatedAt`-nya lebih tua dari
`WATCHDOG_SILENCE_MS`. Jadi outage Redis akan membekukan `updatedAt` semua delivery LIVE serempak
dan memicu **mass false-reap** — Redis blip menjadi insiden uang. Fallback menulis langsung ke
Postgres, persis perilaku hot-store-OFF (`tracking-hot-store.ts:100-107`). Penutupnya: kalau Postgres
juga mati, watchdog (yang membaca Postgres) tidak bisa jalan, jadi tidak ada false reap yang mungkin.
</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| `wscat` connect lalu langsung `1008` | Token tidak ada, kedaluwarsa, atau `jwt.secret` di proses ini beda dari yang menerbitkan | Decode JWT-mu di jwt.io dan cek `exp`. Cocokkan `JWT_SECRET` di kedua terminal — dua proses api dengan secret berbeda adalah kesalahan klasik saat menjalankan port 3000 & 3001. |
| Handshake gagal total (bukan 1008 — koneksi ditolak) | `app.useWebSocketAdapter(new WsAdapter(app))` hilang → Nest jatuh ke socket.io | `grep -n useWebSocketAdapter src/main.ts`. Gejala khasnya: klien socket.io bisa connect, `wscat` tidak. Ini persis yang komentar `main.ts:33-35` peringatkan. |
| Handshake sukses, `subscribed` diterima, tapi tidak ada frame | Tiga kandidat berurutan: (a) worker tidak jalan; (b) publisher & subscriber beda `REDIS_PUBSUB_MODE`; (c) langganan belum di-re-arm setelah Redis blip | Cek berurutan: (a) `redis-cli PSUBSCRIBE 'delivery:*:update'` — ada lalu lintas? kalau tidak, worker/publisher yang bermasalah. (b) Baca log boot kedua proses: `TrackingPublisher ready (pubsub mode: ...)` vs `TrackingSubscriber ready (pubsub mode: ...)` — harus sama. (c) Cari `re-arming N subscription(s)` di log setelah Redis kembali. |
| Frame sampai di dev (satu proses) tapi hilang begitu dipisah api+worker | Model mental "satu proses" masih terbawa — di dev semua provider hidup di proses yang sama, jadi fan-out Redis tidak terlihat perannya | Ini **bagian tersulit fase ini** (lihat di bawah). Buat tabel provider × `PROCESS_ROLE`, verifikasi dengan `grep -rn "IS_HTTP_TIER\|IS_WORKER_TIER\|IS_INGEST_TIER" src/`. Lalu tambahkan `console.log` sementara di `deliveries.module.ts:91` dan bandingkan nilainya di dua terminal. |
| `drovery_ws_connections` naik terus, tidak pernah turun | Gauge bocor: `inc()` jalan untuk socket yang `dec()`-nya tidak pernah jalan | Baca `tracking.gateway.ts:84-88` dan `:106`. `dec()` hanya jalan kalau `client.userId` sudah di-set — itulah gunanya guard `readyState` sebelum `inc()`. Kalau kamu mengubah urutan baris di sana, kamu menciptakan kebocoran ini. |
| `drovery_ws_dropped_frames_total` naik di produksi | Bisa klien lambat (normal, sedikit), bisa node sedang tertekan (tidak normal) | Bandingkan dengan `drovery_ws_connections`: rasio drop per socket yang tinggi di **semua** pod ≠ satu pengguna 3G. Komentar `metrics.service.ts:45-47` menyebut kedua interpretasi. Kalau merata, curigai coalescer mati (`POSITION_PUSH_HZ=0`) pada drone LIVE cepat. |
| Setelah `TRACKING_HOT_STORE=redis`, delivery LIVE tiba-tiba di-reap + refund massal | `updatedAt` membeku karena checkpoint tidak jalan, atau `CHECKPOINT_INTERVAL_MS` terlalu besar | Cek proses boot: kalau `CHECKPOINT_INTERVAL_MS × 4 >= WATCHDOG_SILENCE_MS`, `assertCheckpointSafe()` seharusnya sudah menolak boot. Kalau boot lolos tapi reap tetap terjadi, kandidat berikutnya adalah starvation `SPOP` yang tercatat di `AUDIT-LOG.md:820-824` — di atas ~5k delivery LIVE, batch acak tanpa aging bisa melewatkan satu delivery berkali-kali. |
| MQTT: satu frame telemetry diproses dua kali | `MQTT_SHARED=false`, atau broker tidak mendukung MQTT5 shared subscription | Cek `drovery_mqtt_frames_total{flow="telemetry"}` di **semua** replika dan jumlahkan; harus 1 per frame publish. Cek juga log boot `MqttService connecting to ... (shared=true)`. Mosquitto 2 mendukungnya; broker v3.1.1 tidak (`configuration.ts:138`). |
| Deploy menyebabkan lonjakan error di klien | Drain tidak jalan: klien dapat `1006`, semua reconnect serempak | Uji lokal dengan `kill -TERM` dan pastikan `1001`. Di k8s, cek `preStop` + `terminationGracePeriodSeconds` di `realtime-deployment.yaml:31-32` dan `:65-67` — grace period harus melebihi preStop + waktu drain. |
| `npm test` menggantung setelah menyentuh coalescer | Timer `setInterval` menahan event loop | `position-coalescer.ts:64` memakai `this.timer.unref?.()` justru untuk ini. Kalau kamu menulis timer baru di jalur ini, `unref()` bukan opsional. |

**Bagian tersulit di fase ini** (dan ini bukan soal WebSocket sama sekali): **satu file `AppModule`
yang sama berperilaku berbeda tergantung proses yang mem-boot-nya.** Kamu akan membaca
`deliveries.module.ts`, melihat `TrackingGateway` di daftar `providers`, dan menyimpulkan "berarti
worker punya gateway juga" — lalu bingung berjam-jam kenapa `TrackingPublisher` "tidak mengirim ke
klien". Kondisinya ada di `...(IS_HTTP_TIER ? [...] : [])` di baris 91, dievaluasi **saat import**,
dari `process.env`, sebelum DI container ada.

Cara menaklukkannya, sebelum menyentuh kode apa pun: buka `src/common/process-role.ts`, `src/main.ts`,
dan `src/worker.ts` berdampingan, lalu gambar tabel — baris = provider (`TrackingGateway`,
`TrackingSubscriber`, `TrackingPublisher`, `SimulationProcessor`, `MqttTelemetrySubscriber`,
`TrackingCheckpointScheduler`), kolom = empat nilai `PROCESS_ROLE` (`api`, `worker`, `realtime`,
unset), isi = hidup/mati. Verifikasi tebakanmu dengan
`grep -rn "IS_WORKER_TIER\|IS_HTTP_TIER\|IS_INGEST_TIER" src/`. Setelah tabel itu benar di kepalamu,
sisa fase ini terasa seperti konsekuensi logis, bukan kumpulan trik.

---

## Bacaan pendamping

Semua di repo, semuanya berisi **kenapa** — bukan tutorial.

- `ARCHITECTURE.md` §3 (baris 75-83) — desain fan-out ini dalam prosa, plus daftar "next at very
  high fan-out". Cari kalimat *"This decouples 'who computed the update' from 'who holds the socket'"* —
  itu tesis seluruh fase dalam satu baris.
- `SCALING-1M.md` §4 (baris 192-229) — batas pub/sub di Redis Cluster, desain tier realtime, dan
  catatan kejujuran tentang apa yang sharded mode **belum** lakukan tanpa klien Cluster.
- `AUDIT-LOG.md` §"Phase 9 — Realtime durability" (baris 761-840) — bug re-arm dari gejala sampai
  keputusan, plus tiga item yang **sengaja tidak** dikerjakan. Baca bagian "Decisions made"
  (`:800-812`) untuk melihat bagaimana dua opsi yang sama-sama benar ditimbang.
- `src/common/pubsub/pubsub-transport.ts:4-24` dan
  `src/deliveries/tracking/realtime.constants.ts:1-20` — komentar yang mengajarkan sharded pub/sub
  dan cara menulis "kenapa" untuk sebuah env var; baca sebagai dokumen, bukan kode.
- `k8s/base/realtime-scaledobject.yaml` + `k8s/base/realtime-deployment.yaml` — komentar YAML padat
  berisi alasan teknis. Kamu membedahnya di Fase 11; sekarang baca komentarnya saja untuk melihat
  konsekuensi operasional dari keputusan yang barusan kamu pelajari.
- `Drovery_Mobile/services/api/trackingSocket.ts` dan `Drovery_Admin/src/api/supportSocket.ts` —
  dua klien untuk gateway yang kamu bedah. Bacalah untuk melihat kontrakmu dari sisi lain, terutama
  bagaimana keduanya menangani `1008` (berbeda! mobile mencoba refresh token sekali, admin
  menganggapnya fatal — lihat `AUDIT-LOG.md:814-819`).

Dokumentasi eksternal, hanya kalau benar-benar perlu:

- [Redis: Sharded Pub/Sub](https://redis.io/docs/latest/develop/pubsub/) — untuk memastikan
  pemahamanmu tentang `SPUBLISH`/`SSUBSCRIBE` dan hash slot benar.
- [RFC 6455 §7.4.1 — Close codes](https://datatracker.ietf.org/doc/html/rfc6455#section-7.4.1) —
  daftar resmi `1001`, `1006`, `1008`. Perhatikan bahwa `1006` **tidak pernah** dikirim di kabel; ia
  dihasilkan lokal oleh klien saat koneksi putus abnormal. Itu sebabnya kamu tidak bisa "mengirim
  1006" dan itu sebabnya `1001` harus eksplisit.

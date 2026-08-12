# Fase 13 — Modul Next.js: memindahkan satu halaman admin ke App Router

> Baris meta: **Durasi** ~1,5 minggu (~20 jam) · **Mode** fitur nyata · **Repo** `drovery-admin-next/` (baru, kamu yang bikin) · `Drovery_Admin` (sumber port, read-only) · `Drovery_Backend` (tidak diubah)

---

## Kenapa fase ini ada di sini

Fase 12 menutup lingkaran: kamu mengirim satu fitur dari schema Prisma sampai ke tombol di konsol
operator, dan di sana kamu belajar Redux Toolkit, `useApi`, `useMutation`, `useListParams`, serta
`NAV_ITEMS` sebagai satu sumber kebenaran untuk nav **dan** guard. Artinya sekarang ada satu halaman
di dunia ini yang kamu kuasai sampai ke baris — `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx`,
552 baris, dua read paralel, empat mutasi destruktif, empat dialog konfirmasi, dan satu komentar
post-mortem tentang bug yang pernah membuat dispatcher mengirim perintah dua kali ke pesawat yang
sudah patuh.

Itulah kenapa Next.js datang **sekarang** dan bukan lebih awal. Belajar Next.js dengan `create-next-app`
lalu bikin blog adalah cara paling efisien untuk salah paham: kamu akan mengira App Router adalah
"router yang lebih enak", karena blog memang tidak punya sesi, tidak punya role, tidak punya empat
mutasi yang bisa mengubah saldo orang, dan tidak punya WebSocket. Halaman Drovery punya semuanya.
Kalau kamu mem-port halaman ini, setiap klaim Next.js langsung diuji terhadap sesuatu yang bisa gagal
di depan mata: apakah waterfall benar-benar hilang, apakah bug `d67ac40` benar-benar jadi mustahil,
apakah guard di server benar-benar lebih kuat, dan apa yang **rusak** (jawabannya: WebSocket-nya, dan
itu bukan detail kecil).

Yang mustahil dipahami tanpa fase ini adalah **batas eksekusi**. Sepanjang karier Ionic React kamu,
seluruh kode React yang kamu tulis berjalan di satu tempat: browser (atau WebView Android). Tidak
pernah ada pertanyaan "ini jalan di mana". App Router memasukkan pertanyaan itu ke dalam setiap file
yang kamu buka, dan jawabannya menentukan apa yang boleh kamu tulis: `useState` ilegal di satu sisi,
`process.env.DATABASE_URL` ilegal di sisi lain, dan `'use client'` adalah satu-satunya penanda batasnya.
Model mental ini tidak bisa dibaca; ia harus dialami lewat error "You're importing a component that
needs `useState`" saat jam 11 malam.

Terakhir, jujur soal posisi: ini fase **penutup**, dan itu artinya kamu mengerjakannya dengan energi
paling rendah setelah dua belas fase. Jangan jadikan ini "bikin ulang seluruh Drovery_Admin di Next".
Cakupannya sengaja satu halaman plus satu layout plus satu middleware. Keluaran yang paling berharga
dari fase ini bukan kodenya — melainkan dokumen dua halaman di akhir yang menyebut, dengan angka,
apa yang kamu dapat dan apa yang kamu bayar. Dokumen itu yang akan kamu pakai lima tahun ke depan
setiap kali ada yang bertanya "kenapa nggak pakai Next.js aja?".

---

## Gerbang masuk

Kamu siap masuk fase ini kalau kamu bisa:

- [ ] Menjalankan `Drovery_Admin` (`npm run dev`), login sebagai admin seed, membuka satu delivery,
      dan **menjelaskan tanpa membuka kode** kenapa halaman itu menembakkan dua request GET, bukan satu.
- [ ] Menunjukkan di mana sesi disimpan dan siapa yang membacanya — dari `tokenStorage.ts` ke
      `client.ts` (bearer) ke `authSlice.ts` (Redux) ke `ProtectedRoute` — dan menyebut satu alasan
      teknis kenapa Redux (bukan Context) dipilih untuk itu.
- [ ] Menjelaskan kenapa `rolesForPath('/deliveries/dr-1')` mengembalikan `['ADMIN']` dan bukan
      `[]`, dan kenapa guard klien itu **bukan** keamanan.
- [ ] Menulis satu Server Component… bukan. Yang ini belum. Tapi kamu **harus** bisa menulis
      `async function` yang menjalankan dua `fetch` paralel dengan `Promise.all` dan menangani satu
      di antaranya gagal — di Node polos, tanpa React. Kalau ini masih ragu, selesaikan dulu.
- [ ] Menyebut apa yang terjadi kalau backend `RolesGuard` dilepas: request mana yang tiba-tiba lolos,
      dan kenapa UI tidak bisa menambalnya.
- [ ] Menjalankan `docker build -t drovery-admin .` di `Drovery_Admin/` sampai sukses, lalu
      menjelaskan kenapa image finalnya nginx dan bukan Node.

Kalau lebih dari satu butir di atas masih perlu buka kode, ulangi bacaan Fase 12 dulu. Fase ini
memakai halaman itu sebagai *baseline* pembanding — kalau baselinenya belum jelas, perbandingannya
tidak bermakna.

---

## Peta jalan mingguan

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| 1 (hari 1–2) | Scaffold `drovery-admin-next/`, route group `(console)`, layout berlapis, `loading.tsx`/`error.tsx`. Cari batas `'use client'` dengan sengaja memicu errornya. | 5 | `/deliveries/[id]` merender halaman kosong dengan shell + sidebar; sengaja bikin satu error "needs useState" lalu perbaiki, dan catat pesan errornya. |
| 1 (hari 3–4) | Auth pindah ke cookie `httpOnly`: Server Action login, `middleware.ts` sebagai guard, `homePathForRole` dipindah. | 5 | Buka `/deliveries/x` tanpa login → redirect ke `/login` **tanpa HTML halaman terkirim** (buktikan lewat tab Network: dokumen pertama sudah 307/302). |
| 1 (hari 5–7) | Bagian baca: `async function Page()` + `Promise.all` untuk delivery + command history. Semua kartu read-only jadi RSC. | 4 | Halaman detail tampil penuh dengan **nol** JS komponen untuk kartu-kartu itu; `view-source` sudah memuat data. |
| 2 (hari 1–3) | Server Action `forceCancel` + `useActionState` + `revalidatePath`; dialog konfirmasi tetap klien. | 5 | Force-cancel jalan; panel aksi **dan** tabel riwayat perintah keduanya segar setelah satu aksi, tanpa dua `refetch()`. |
| 2 (hari 4–5) | Ukur, tulis dokumen perbandingan, daftar utang (dipimpin masalah token WS). | 3 | `COMPARISON.md` dua halaman + angka bundle dari `next build` vs `vite build`. |
| **Total** | | **22** | |

22 jam untuk 1,5 minggu di ~14 jam/minggu. Kalau kamu tersendat di batas `'use client'` (dan
kemungkinan besar iya), ambil jam tambahan dari hari 4–5 minggu 2 dan potong ambisi dokumennya —
dokumen 1,5 halaman yang jujur lebih baik daripada 4 halaman yang mengulang marketing Vercel.

---

## Konsep

### 13.1 Model eksekusi App Router: Server Component sebagai default, `'use client'` sebagai batas yang menular ke bawah

Di Ionic React ada satu tempat eksekusi: WebView. Di App Router ada dua, dan **default-nya dibalik**
dari semua yang pernah kamu tulis. Setiap file di dalam `app/` adalah Server Component sampai ada
`'use client'` di baris pertama. Server Component dirender jadi output di server, dikirim sebagai
data, dan **kodenya tidak pernah masuk bundle browser**. Itu berarti `humanizeEnum`, `fmt`, dan
seluruh JSX kartu di `DeliveryDetailPage` bisa hilang total dari yang diunduh operator.

Padanan paling jujur dari pengalamanmu bukan React sama sekali — melainkan **plugin Capacitor**.
Saat kamu memanggil `Camera.getPhoto()`, ada batas: sisi JS memanggil, sisi native mengeksekusi, dan
yang menyeberang hanya data yang bisa di-serialize. `'use client'` adalah batas yang sama, hanya
arahnya terbalik: server yang di luar, klien yang di dalam. Konsekuensi yang bikin orang tersandung
minggu pertama: **props yang menyeberang dari Server ke Client harus serializable**. Kamu tidak bisa
mengoper `deliveryActions` sebagai fungsi ke komponen klien; kamu mengoper `DeliveryActions` (objek
boolean) hasil pemanggilannya — dan kebetulan `deliveryActions.ts` memang sudah berbentuk begitu.

Bagian "menular ke bawah" adalah yang paling sering salah dipahami. `'use client'` bukan properti
satu komponen; ia menandai **titik masuk** ke graph klien. Semua yang di-`import` oleh file
ber-`'use client'` ikut masuk bundle klien, sedalam apa pun. Ini yang bikin MUI menyakitkan (lihat
13.7): satu `<Button>` MUI menarik Emotion, dan Emotion adalah CSS-in-JS runtime. Tapi ada jalan
keluar yang tidak intuitif: komponen klien boleh menerima **`children` berisi Server Component**.
Jadi `<ActionPanel>{serverRenderedCards}</ActionPanel>` tetap merender kartu di server, karena
`children` sudah jadi output sebelum menyeberang, bukan komponen yang perlu dieksekusi klien.

Cara paling cepat menginternalisasi ini: hitung. Buka `DeliveryDetailPage.tsx` dan tandai tiap blok
dengan S (server) atau C (klien). Blok `226-345` — Route, Package, Customer, Schedule, Payment,
Tracking, Proof, Rating — semuanya S: nol `useState`, nol handler. Blok `348-384` (panel tombol) dan
keempat `ConfirmDialog` di `435-549` semuanya C: ada `onClick`, ada state dialog. Blok `386-432`
(tabel riwayat) S. Perbandingan S:C itulah yang akan jadi angka di dokumen capstone-mu.

**Anchor:** `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx:226-345` — delapan
`SectionCard` berturut-turut tanpa satu pun hook atau handler; ini blok yang jadi Server Component
apa adanya. Bandingkan dengan `:348-384` (panel aksi, empat `onClick`) dan `:88-93` (lima `useState`)
yang wajib `'use client'`.
**Anchor:** `Drovery_Admin/src/features/deliveries/deliveryActions.ts:27-44` — fungsi murni
`AdminDelivery → DeliveryActions`, tanpa React, tanpa fetch. Ini satu-satunya modul di halaman itu
yang bisa dipanggil di **kedua** sisi tanpa perubahan sebaris pun; catat itu, karena ia jadi bukti
bahwa memisahkan logika domain dari komponen terbayar saat model eksekusinya berubah.

**Kenapa dipakai di sini:** halaman ini adalah kandidat terbaik di seluruh repo justru karena
komposisinya timpang. Peta konsep menyebutnya *"perubahan paling menguntungkan"* (map-admin baris
945): 120 baris kartu read-only berbanding ~90 baris interaktivitas. Untuk konsol operator, itu berarti
sebagian besar berat halaman bisa berhenti di server. Dan tidak seperti `/support/:id` yang punya
WebSocket, halaman ini tidak menyeret masalah realtime ke dalam eksperimen — kamu bisa mempelajari
batas eksekusi tanpa sekaligus melawan lubang token.

**Alternatif:**
- **Semua `'use client'` di root layout** (praktis mengubah Next jadi SPA dengan file routing).
  Trade-off konkret: kamu tetap dapat routing berbasis folder dan `next dev`, tapi kehilangan
  seluruh alasan pindah — bundle tidak menyusut, waterfall tetap ada, dan kamu membayar proses Node
  di produksi untuk sesuatu yang nginx bisa layani gratis. Ini pilihan yang **valid** kalau tujuanmu
  cuma DX; katakan itu terus terang alih-alih menyebutnya "migrasi ke RSC".
- **Astro dengan island `client:load`**: batasnya eksplisit per-komponen di JSX pemanggil
  (`<Panel client:load />`) alih-alih per-file. Menang: batasnya terlihat di tempat pemakaian,
  jadi tidak ada "menular" yang mengejutkan. Kalah: tidak ada Server Actions, jadi seluruh sisi
  tulis kembali ke `fetch` klien — persis yang mau kamu hapus di 13.4.
- **Tetap satu model eksekusi, pindahkan berat ke build time** (SSG penuh). Tidak berlaku di sini:
  data delivery berubah tiap detik, dan `README.md:37-40` menempatkan backend sebagai otoritas —
  tidak ada yang bisa di-*prerender*.

**Latihan:** buat `drovery-admin-next/app/(console)/deliveries/[id]/page.tsx` yang cuma merender
`<h1>{id}</h1>` dan `console.log('render')`. Jalankan `next dev`, buka halamannya, lalu cari log itu:
ia muncul di **terminal**, bukan di DevTools. Sekarang tambahkan `const [x] = useState(0)` di file
yang sama dan salin pesan error lengkapnya ke catatanmu — pesan itu adalah peta batas yang akan kamu
baca puluhan kali. Terakhir, pecah jadi dua file: `page.tsx` (server) dan `Panel.tsx` (`'use client'`),
dan buktikan `console.log` di masing-masing muncul di tempat berbeda.

---

### 13.2 Routing berbasis folder: `app/(console)/deliveries/[id]/page.tsx`, route group, layout berlapis, `loading.tsx` & `error.tsx`

Di `Drovery_Admin`, seluruh rute adalah **satu file data**: `src/router/router.tsx:38-57`, sebuah array
objek yang bisa kamu baca sekali dan langsung tahu bentuk aplikasinya. Di App Router, tabel itu lenyap
sebagai file dan menjadi struktur folder. Ini pertukaran yang nyata, bukan peningkatan murni: kamu
kehilangan kemampuan membaca seluruh peta rute dalam 20 baris, dan kamu mendapat kemustahilan
"rute terdaftar tapi filenya tidak ada" (dan sebaliknya).

Empat konvensi yang perlu kamu petakan dari yang sudah kamu tahu:

`layout.tsx` ≈ **layout route** react-router. Di `router.tsx:40-55` ada objek `{ element: <ProtectedRoute />, children: [...] }` **tanpa `path`** — rute yang hanya membungkus. `app/(console)/layout.tsx` melakukan hal yang sama, dan tanda kurung pada `(console)` adalah **route group**: folder yang mengelompokkan tanpa menambah segmen URL. Jadi `app/(console)/deliveries/[id]/page.tsx` tetap menghasilkan URL `/deliveries/:id`. Ini padanan langsung dari layout route tanpa `path`.

`loading.tsx` ≈ **`<Suspense fallback>` yang otomatis**. `AppLayout.tsx:101-106` membungkus `<Outlet />` dengan `<Suspense fallback={<PageLoader />}>`, dan komentar di `router.tsx:9-11` menjelaskan strateginya: shell tetap eager supaya *"protected pages load with the nav still visible."* Di App Router kamu menulis `app/(console)/deliveries/[id]/loading.tsx`, dan Next yang memasang boundary-nya. Efeknya identik: sidebar tetap terlihat, isi halaman yang berganti.

`error.tsx` ≈ cabang error yang selama ini kamu tulis tangan. Di `DeliveryDetailPage.tsx:111-133` ada blok `if (error && !delivery)` lengkap dengan tombol Retry. Itu jadi `error.tsx` — dan perhatikan satu aturan yang menjebak: **`error.tsx` wajib `'use client'`**, karena ia menerima prop `reset` (sebuah fungsi) dan harus menjadi error boundary React yang sungguhan.

`not-found.tsx` ≈ `NotFoundPage` di rute `*`, tapi lebih baik: fungsi `notFound()` dari `next/navigation` bisa dipanggil **dari dalam data fetching**, jadi delivery yang 404 di backend langsung merender halaman not-found, bukan alert error generik.

**Anchor:** `Drovery_Admin/src/router/router.tsx:38-57` — tabel rute yang akan lenyap. Perhatikan
`:40-55`: layout route tanpa `path`, persis yang jadi `app/(console)/layout.tsx`.
**Anchor:** `Drovery_Admin/src/router/router.tsx:9-11` — komentar strategi Suspense; salin kalimatnya
ke `loading.tsx`-mu sebagai komentar, supaya jelas bahwa perilakunya sengaja dipertahankan.
**Anchor:** `Drovery_Admin/src/layout/AppLayout.tsx:101-106` — `<Suspense>` + `<Outlet />` yang
digantikan. Anak-anak `layout.tsx` menerima `children`, bukan `<Outlet />`; itu satu-satunya
perbedaan mekanis.
**Anchor:** `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx:103-135` — **tiga** cabang
render (`loading && !delivery`, `error && !delivery`, `!delivery`) yang seluruhnya digantikan
`loading.tsx` + `error.tsx` + `notFound()`. Hitung barisnya sebelum dan sesudah; ini salah satu
angka paling meyakinkan di dokumen capstone.

**Kenapa dipakai di sini:** perhatikan detail di `:103` — `loading && !delivery`, bukan `loading`.
Komentar peta konsep menjelaskan alasannya: saat **re**fetch, data lama tetap tampil supaya layar
tidak berkedip kosong. Ini nuansa yang **hilang** kalau kamu memindahkannya mentah-mentah ke
`loading.tsx`: `loading.tsx` muncul pada navigasi ke segment, bukan pada revalidasi. Jadi
perilakunya sebenarnya jadi lebih baik secara default (revalidasi tidak menampilkan skeleton sama
sekali), tapi kamu harus tahu itu terjadi karena mekanismenya berbeda, bukan karena kamu berhasil
memindahkan `!data`. Catat perbedaan ini; ini contoh sempurna "kelas bug yang hilang karena struktur".

**Alternatif:**
- **Satu `layout.tsx` di root, tanpa route group.** Lebih sedikit folder. Kalah konkret: `/login`
  akan ikut mewarisi shell sidebar, jadi kamu harus menulis `if (pathname === '/login')` di layout —
  persis jenis percabangan yang route group hapus. Di `Drovery_Admin` masalah ini sudah diselesaikan
  dengan menaruh `/login` **di luar** layout route (`router.tsx:39`); `(console)` adalah cara App
  Router mengekspresikan hal yang sama.
- **`app/deliveries/[id]/page.tsx` tanpa group, `/login` di `app/login/page.tsx` dengan root layout
  minimal + layout kedua di `app/deliveries/layout.tsx`.** Berfungsi, tapi shell harus diduplikasi
  di setiap cabang konsol (`/promos`, `/users`, `/fleet`, `/support`) begitu kamu mem-port halaman
  kedua. Route group ada persis untuk menghindari itu.
- **Tetap tabel rute sebagai data** — mungkin di Next hanya lewat konvensi manual (mis. sebuah
  `routes.ts` yang cuma dipakai untuk nav). Menang: kamu bisa mempertahankan invariant
  `NAV_ITEMS` (nav = guard) yang jadi pelajaran terbaik `Drovery_Admin`. Kalah: file itu tidak lagi
  **menghasilkan** rute, jadi ia bisa menyimpang dari folder — invariantnya jadi konvensi, bukan
  mekanisme. Kamu akan butuh test yang membandingkan `NAV_ITEMS` dengan isi folder.

**Latihan:** bikin struktur `app/(console)/layout.tsx`, `app/(console)/deliveries/[id]/page.tsx`,
`app/(console)/deliveries/[id]/loading.tsx`, `app/(console)/deliveries/[id]/error.tsx`, dan
`app/login/page.tsx`. Buktikan tiga hal: (1) `/login` **tidak** memakai shell konsol; (2) menambahkan
`await new Promise(r => setTimeout(r, 3000))` di `page.tsx` membuat `loading.tsx` muncul sementara
sidebar tetap ada; (3) `throw new Error('boom')` di `page.tsx` memunculkan `error.tsx` **dan** tombol
`reset()`-nya benar-benar mencoba ulang. Kalau salah satu tidak terjadi, kamu salah taruh file —
dan itu memang jenis kesalahan yang paling sering di App Router.

---

### 13.3 Data fetching di RSC: `export default async function Page()` + `Promise.all`

Halaman detail sekarang menembakkan dua request lewat dua `useApi` (`DeliveryDetailPage.tsx:76-86`).
Keduanya paralel satu sama lain, tapi keduanya **berurutan setelah** rangkaian ini: browser minta
`/deliveries/abc` → nginx kirim `index.html` → unduh entry chunk → React mount → router cocokkan rute
→ unduh chunk halaman (`React.lazy` di `router.tsx:17-19`) → komponen mount → `useEffect` jalan →
**baru** dua `fetch` berangkat. Itu waterfall empat lapis sebelum byte data pertama diminta.

Di RSC, `Page` adalah `async function` dan datanya diambil **sebelum** ada HTML sama sekali:

```tsx
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [delivery, commands] = await Promise.all([
    getDelivery(id),
    getCommands(id),
  ]);
  // ...
}
```

Dua hal yang wajib kamu ketahui sebelum menulis baris pertama, karena keduanya berubah di Next 15 dan
sebagian besar tutorial di internet masih memakai bentuk lama. Pertama, **`params` dan `searchParams`
adalah Promise** — harus di-`await`. Kedua, **`fetch` tidak lagi di-cache secara default** di Next 15;
di Next 14 default-nya `force-cache`, yang untuk konsol operator adalah bencana diam-diam (kamu akan
melihat status delivery basi dan mengira backend-nya salah). Verifikasi versi yang kamu pasang
sebelum percaya salah satu perilaku ini.

`Promise.all` di sini bukan optimasi kosmetik: kalau kamu menulis dua `await` berurutan, kamu
menciptakan waterfall **baru** di server yang sebelumnya tidak ada di klien — dan ini kemunduran yang
sangat mudah tidak disadari, karena di localhost dengan latensi 1 ms tidak terasa apa-apa. Ukur
dengan `curl` ke backend yang sengaja diperlambat, jangan mengandalkan perasaan.

Satu hal yang **hilang** dan harus kamu akui: `refetch()`. `useApi` memberi tombol Refresh yang
memuat ulang sesuai kemauan operator, dan itu bukan aksesori — `README.md:43-44` dan seluruh halaman
konsol dirancang di sekitarnya karena datanya *"selalu basi"*. Di RSC, penggantinya ada dua:
`router.refresh()` dari komponen klien kecil, atau `revalidatePath()` dari Server Action (13.4).
Tombol Refresh di header (`DeliveryDetailPage.tsx:208-210`) karena itu **tetap** jadi komponen klien
— salah satu dari sedikit yang tersisa.

**Anchor:** `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx:76-86` — dua `useApi`, path
`/admin/deliveries/${id}` di `:81` dan `/admin/deliveries/${id}/commands` di `:86`. Ini dua fetch yang
kamu gabung jadi satu `Promise.all`.
**Anchor:** `Drovery_Admin/src/hooks/useApi.ts:22-46` — effect-nya. Perhatikan `:23` dan `:43-45`:
flag `active` + cleanup, yang ada murni untuk mencegah response lama menimpa yang baru saat `path`
berubah. Seluruh masalah itu **lenyap** di RSC: tidak ada komponen yang bisa unmount di tengah fetch,
tidak ada race. Ini kelas bug kedua yang hilang secara struktural.
**Anchor:** `Drovery_Backend/src/admin/admin.controller.ts:74-78` dan `:120-124` — dua endpoint yang
kamu panggil. Keduanya di bawah `@Roles(Role.ADMIN)` tingkat kelas (`:53-55`), jadi request dari
server-mu tetap harus membawa identitas — ini yang menghubungkan 13.3 ke 13.6.
**Anchor:** `Drovery_Admin/src/api/client.ts:86-128` — `apiFetch`. Di sisi Next, versi server-nya
jauh lebih pendek: tidak ada `refreshInFlight` (`:48-50`), tidak ada `unauthorizedHandler`, tapi
**harus** menambahkan header dari cookie. Tulis ulang, jangan salin.

**Kenapa dipakai di sini:** peta konsep menyebut halaman ini *"perubahan paling menguntungkan"*
karena dua fetch-nya sudah paralel di klien — jadi keuntungannya bukan paralelisasi, melainkan
**hilangnya empat lapis di depannya**. Bandingkan dengan `DashboardPage` yang cuma satu read: di sana
keuntungannya lebih kecil. Halaman inilah yang membuat angka-mu bisa dipertahankan.

**Alternatif:**
- **`loader` react-router 7 di SPA yang ada sekarang.** Ini alternatif yang paling sering dilupakan
  dan paling murah: `loader` memulai fetch **paralel dengan** navigasi, jadi lapisan "mount lalu
  fetch" hilang tanpa pindah framework sama sekali. Peta konsep sudah mencatat kenapa repo ini tidak
  memakainya (`map-admin` Konsep 6): `loader` sulit membaca auth dari Redux dan tombol Refresh manual
  jadi butuh `useRevalidator`. Trade-off konkret: kamu menghapus satu lapis waterfall (dari empat jadi
  tiga) dengan biaya ~2 jam kerja; RSC menghapus semuanya dengan biaya ~20 jam + proses Node di produksi.
- **TanStack Query dengan `prefetchQuery` di route loader.** Dapat cache, dedup, dan
  `invalidateQueries` yang menghapus bug `d67ac40` — tanpa server. Kalah: JS-nya tetap terkirim
  seluruhnya, dan kamu menambah ~13 KB. Menang: bisa dikerjakan dalam satu sore dan tidak mengubah
  model deployment sama sekali.
- **Server Component yang mem-fetch berurutan** (dua `await` terpisah). Bukan alternatif desain,
  melainkan bug yang menyamar. Sebutkan di sini supaya kamu mengenalinya saat melihatnya di kode
  orang lain: latensi total jadi jumlah, bukan maksimum.

**Latihan:** tulis `page.tsx` versi berurutan (dua `await` terpisah) dan versi `Promise.all`. Tambahkan
`await new Promise(r => setTimeout(r, 400))` di dalam helper fetch-mu untuk mensimulasikan latensi
jaringan nyata. Ukur dengan `curl -w '%{time_total}\n' -o /dev/null -s http://localhost:3001/deliveries/<id>`
sepuluh kali untuk masing-masing versi, dan catat mediannya. Kalau selisihnya bukan ~400 ms, cari tahu
kenapa — kemungkinan besar salah satu fetch-mu ter-cache.

---

### 13.4 Server Actions (`'use server'`) + `useActionState` + `revalidatePath`

Ini bagian yang paling berbeda dari apa pun yang pernah kamu tulis, dan tidak ada padanan jujurnya di
Ionic/Capacitor. Yang paling dekat — dan tetap jauh — adalah memanggil Cloud Function: kamu memanggil
sesuatu yang bentuknya fungsi, tapi eksekusinya di mesin lain. Bedanya, di sini tidak ada endpoint yang
kamu definisikan, tidak ada URL yang kamu ketik, dan tidak ada `fetch`. Kamu menulis fungsi `async`
dengan `'use server'` di atasnya, mengoper referensinya ke komponen klien, dan bundler yang membuat
jembatan RPC-nya.

Bandingkan dengan yang ada sekarang. Sisi tulis halaman ini adalah `useMutation` (`useMutation.ts:17-42`)
yang membungkus method `adminApi`. Kontraknya ditulis eksplisit di docstring `:12-16`: *"`run` resolves
to the result, or `undefined` if the call threw (the error is captured, never rethrown), so callers can
branch on the result without a try/catch."* Buah dari keputusan itu terlihat di `DeliveryDetailPage.tsx:171-187`
— empat handler, masing-masing satu baris: `if (await cancelM.run(d.id)) refresh();`.

Di App Router, pasangannya adalah Server Action + `useActionState` (React 19; `Drovery_Admin` sudah di
React 19.2, jadi hook-nya sudah kamu kenal kalau pernah menyentuhnya):

```tsx
// app/(console)/deliveries/[id]/actions.ts
'use server';
export async function forceCancelAction(prev: State, formData: FormData): Promise<State> {
  const id = String(formData.get('id'));
  try {
    await adminFetch(`/admin/deliveries/${id}/force-cancel`, { method: 'POST' });
  } catch (e) {
    return { error: messageOf(e) };          // menggantikan useMutation.error
  }
  revalidatePath(`/deliveries/${id}`);        // menggantikan refreshAll()
  return { error: null };
}
```

Dan di klien: `const [state, action, pending] = useActionState(forceCancelAction, { error: null })`.
`pending` menggantikan `useMutation.loading` (yang dipakai `ConfirmDialog.tsx` untuk mengubah label
jadi "Working…" dan mengunci tombol Cancel), `state.error` menggantikan `useMutation.error` yang
dirender **di dalam** dialog.

Sekarang bagian yang membuat fase ini layak dikerjakan. Ada bug nyata di repo ini, commit
`d67ac40 fix(admin): Refresh reloads the drone command history too`, dan post-mortemnya ditulis
utuh di kode:

> *"The header button used to call `refetch` alone, which reloads the delivery but NOT the drone
> command history — so a dispatcher watching for an ABORT ack saw PENDING forever and issued a second
> command to an aircraft that had already obeyed the first."*

Perbaikannya adalah `refreshAll()` — sebuah fungsi yang memanggil **dua** refetch, dan yang harus
**diingat** setiap kali seseorang menambah `useApi` ketiga ke halaman ini. `revalidatePath('/deliveries/'+id)`
tidak menyegarkan "dua query"; ia membatalkan **seluruh segment** dan merender ulang halamannya. Tidak
ada daftar yang bisa ketinggalan, karena tidak ada daftar. Kelas bug ini bukan diperbaiki — ia jadi
tidak bisa diekspresikan. Itu perbedaan antara "bug fix" dan "perubahan struktural", dan ini contoh
terbaik yang punya repo ini.

Jujur soal harganya: Server Action adalah **endpoint POST publik** yang dibuat otomatis. Nama fungsinya
tidak jadi keamanan. Setiap Server Action wajib memvalidasi sesi dan otoritasnya sendiri, persis seperti
controller. Untungnya di Drovery gerbang sungguhannya ada di backend (`RolesGuard`), jadi Server
Action-mu hanya meneruskan cookie — tapi kalau suatu hari kamu memindahkan logika bisnis ke dalam
Server Action, itu berarti kamu memindahkan permukaan serangan juga.

**Anchor:** `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx:140-147` — `refreshAll` beserta
komentar post-mortem tiga barisnya. Baca utuh sebelum menulis Server Action pertamamu; ini alasan
kenapa `revalidatePath` bukan sekadar sintaks yang lebih pendek.
**Anchor:** `Drovery_Admin/src/hooks/useMutation.ts:12-16` — kontrak "never rethrow". Server Action
punya kontrak berbeda: ia **mengembalikan** state, jadi errornya jadi nilai balik, bukan state hook.
Bandingkan bentuknya.
**Anchor:** `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx:154-169` — `openDialog` yang
me-`reset()` **keempat** mutation supaya error aksi sebelumnya tidak nyangkut di dialog berikutnya.
Dengan `useActionState`, tiap aksi punya state sendiri yang di-scope ke form-nya — reset manual ini
sebagian besar lenyap. Sebagian, bukan seluruhnya: kamu tetap perlu memikirkan apa yang terjadi saat
dialog ditutup lalu dibuka lagi.
**Anchor:** `Drovery_Admin/src/components/ConfirmDialog.tsx:45`, `:55-59`, dan `:69-71` — tiga
titik yang harus kamu penuhi dari `useActionState`: dialog tidak bisa ditutup saat request berjalan
(`onClose={loading ? undefined : onClose}`), error tampil **di dalam** dialog sebagai `<Alert>`, dan
label tombol berubah jadi `'Working…'` sambil `disabled`. Komponen ini bisa dipakai ulang nyaris apa
adanya — cuma sumber prop-nya yang berganti dari `useMutation` ke `useActionState`.
**Anchor:** `Drovery_Backend/src/admin/admin.controller.ts:80-87` — endpoint force-cancel dan komentar
di atasnya: *"These three ground aircraft and move money, so they are recorded against the operator
who called them."* Ini kenapa identitas di Server Action bukan formalitas: audit trail backend
mencatat siapa yang memanggil, dan kalau cookie-nya tidak diteruskan, `@AuditActor` tidak punya siapa-siapa.

**Kenapa dipakai di sini:** karena empat aksi halaman ini destruktif dan tidak bisa dibatalkan
(force-cancel, fail, refund, perintah ke pesawat yang sedang terbang), dan karena bug yang terjadi di
sini bukan "tabel tidak update" melainkan "perintah kedua dikirim ke pesawat yang sudah patuh".
`revalidatePath` menyelesaikan kelas masalah itu di tingkat mekanisme.

**Alternatif:**
- **Route Handler (`app/api/.../route.ts`) + `fetch` dari klien.** Endpoint eksplisit, mudah
  dites dengan `curl`, dan tidak ada sihir bundler. Trade-off konkret: kamu menulis ulang seluruh
  `useMutation` + `apiFetch` di sisi klien (JS-nya kembali terkirim), dan invalidasi kembali manual —
  jadi bug `d67ac40` bisa terjadi lagi. Ini pada dasarnya SPA dengan langkah tambahan.
- **`useMutation` TanStack Query + `invalidateQueries(['delivery', id])`.** Menghapus kelas bug yang
  sama dengan `revalidatePath`, tanpa server sama sekali. Biayanya ~13 KB dan satu
  `QueryClientProvider`; keuntungannya bisa dipasang di `Drovery_Admin` yang ada **hari ini** tanpa
  mengubah deployment. Kalau satu-satunya masalah yang mau kamu selesaikan adalah `d67ac40`, ini
  jawaban yang benar dan Next.js adalah berlebihan — katakan itu di dokumen capstone.
- **`router.refresh()` dari komponen klien setelah mutasi.** Lebih sederhana dari `revalidatePath`
  dan tidak butuh Server Action. Kalah: hanya menyegarkan tab browser yang melakukan aksi; kalau
  suatu saat ada dua operator membuka delivery yang sama, `revalidatePath` (yang membatalkan cache
  di server) berperilaku benar sementara `router.refresh()` tidak.
- **Tetap `useMutation` + panggil ulang `router.refresh()`.** Bentuk paling malas dari port ini;
  berfungsi, tapi kamu membayar Next.js dan tidak mendapat satu pun jaminan strukturalnya.

**Latihan:** port **satu** aksi saja — `forceCancel` — jadi Server Action dengan `revalidatePath`.
Lalu buktikan klaimnya, jangan percaya: buka halaman detail sebuah delivery yang punya riwayat
perintah, jalankan force-cancel, dan pastikan **tabel riwayat perintah ikut berubah** tanpa kamu
menulis apa pun yang menyebut "commands". Setelah itu, uji negatifnya: matikan backend, jalankan
aksinya, dan pastikan error-nya muncul **di dalam dialog** (bukan halaman error penuh) — kalau
halamanmu jadi `error.tsx`, berarti kamu melempar dari Server Action alih-alih mengembalikan state.

---

### 13.5 `middleware.ts` sebagai guard: redirect sebelum HTML terkirim

`Drovery_Admin` punya dua guard yang pembagian tugasnya ditulis eksplisit. `ProtectedRoute` menjawab
"apakah ada sesi staff?" satu kali untuk seluruh subtree (`ProtectedRoute.tsx:8-12`: loading → spinner,
unauthenticated → `/login`, role `USER` → layar "staff only", selain itu → `<AppLayout />`).
`RequireRole` menjawab "boleh masuk halaman **ini**?" per rute, dan docstring-nya (`RequireRole.tsx:7-18`)
adalah dokumen desain terbaik di repo itu:

> *"Without it every authenticated user landed on `/` — the ADMIN-only Dashboard — so an AGENT signing
> in to work support tickets hit a permanent 403 with nothing in their sidebar to explain it. Rather
> than showing them an error, send them where they can actually work."*

Keduanya berjalan **setelah** browser mengunduh dan menjalankan aplikasi. Artinya HTML halaman terlarang
tetap terkirim, chunk-nya tetap diunduh, dan redirect terjadi sebagai kedipan. Untuk konsol internal itu
bukan lubang keamanan (gerbang sungguhannya `RolesGuard` backend), tapi ia tetap kerja sia-sia yang
terlihat.

`middleware.ts` di root proyek Next berjalan **sebelum** response dibuat. Ia membaca cookie, memutuskan,
dan mengembalikan `NextResponse.redirect(...)` — browser menerima 307 dan tidak pernah melihat sebaris
pun HTML halaman itu. Ini keunggulan **struktural**, bukan optimasi: tidak ada cara SPA meniru ini,
karena SPA baru punya kesempatan berpikir setelah HTML-nya sampai. Peta konsep menyebutnya dengan tepat
(map-admin baris 391-392): *"guard jalan di edge, HTML halaman terlarang tidak pernah terkirim."*

Kabar baiknya, logika yang perlu dipindah nyaris tidak berubah. `navItems.tsx:59-65` (`rolesForPath`,
dengan pencocokan prefix terpanjang) dan `:71-73` (`homePathForRole`) adalah fungsi murni atas array
`NAV_ITEMS` — tidak menyentuh React, tidak menyentuh Redux. Kamu menyalin filenya (buang import ikon
MUI-nya, atau pisahkan datanya dari ikonnya) dan memanggilnya di middleware:

```ts
// middleware.ts
export function middleware(req: NextRequest) {
  const session = readSession(req.cookies);           // 13.6
  if (!session) return NextResponse.redirect(new URL('/login', req.url));
  const allowed = rolesForPath(req.nextUrl.pathname);
  if (allowed.length > 0 && !allowed.includes(session.role)) {
    return NextResponse.redirect(new URL(homePathForRole(session.role), req.url));
  }
}
export const config = { matcher: ['/((?!_next|login|favicon.ico).*)'] };
```

Satu jebakan yang wajib kamu ketahui sebelum menaruh apa pun di sini: middleware berjalan di runtime
terbatas (Edge runtime secara default). Tidak ada modul Node lengkap, tidak ada akses database, dan
verifikasi JWT harus memakai library yang jalan di WebCrypto (`jose`, bukan `jsonwebtoken`). Kalau
sesimu berbentuk JWT dari backend Drovery, kamu punya dua pilihan: verifikasi tanda tangannya di
middleware dengan `jose` (butuh secret yang sama — pertimbangkan baik-baik), atau **jangan** verifikasi
di middleware sama sekali dan perlakukan middleware murni sebagai UX (baca role dari cookie terpisah
yang non-sensitif), sambil menyerahkan otoritas penuh ke `RolesGuard` backend. Pilihan kedua lebih
jujur dengan arsitektur Drovery dan lebih sedikit permukaan salahnya.

**Anchor:** `Drovery_Admin/src/layout/navItems.tsx:59-65` — `rolesForPath` dengan komentarnya:
*"Longest match first so '/deliveries/:id' resolves to '/deliveries', not '/'."* Fungsi inilah yang
pindah nyaris apa adanya; salin **beserta** komentarnya.
**Anchor:** `Drovery_Admin/src/layout/navItems.tsx:67-73` — `homePathForRole`. Docstring-nya
menjelaskan kenapa AGENT dikirim ke `/support` alih-alih diberi 403.
**Anchor:** `Drovery_Admin/src/layout/navItems.tsx:18-28` — docstring `NAV_ITEMS`: *"Deriving both
from this list means a new page cannot appear in the nav without a guard, or be guarded differently
from how it is advertised."* Invariant ini **harus** kamu pertahankan di Next; kalau tidak, kamu
menukar satu keunggulan struktural dengan yang lain dan hasil bersihnya nol.
**Anchor:** `Drovery_Admin/src/layout/RequireRole.tsx:25-30` — termasuk proteksi loop:
`home === pathname ? null : <Navigate .../>`. Di middleware, loop redirect jauh lebih berbahaya
(browser akan berhenti dengan `ERR_TOO_MANY_REDIRECTS`); pertahankan penjagaan ini.
**Anchor:** `Drovery_Backend/src/common/guards/roles.guard.ts:9-15` — docstring gerbang sungguhannya,
dan `:34-40` yang membaca role **fresh dari DB** tiap request karena JWT tidak membawa role. Ini
detail penting untuk middleware-mu: role di cookie bisa basi, role di backend tidak. Kalau operator
di-demote saat sedang bekerja, middleware-mu akan salah dan backend yang benar — dan itu **boleh**,
selama kamu tahu dan menuliskannya.

**Kenapa dipakai di sini:** karena `Drovery_Admin` punya tiga role dengan aturan yang benar-benar
berbeda (`navItems.tsx:29-56`: `AGENT` boleh `/support` tapi tidak `/deliveries`), dan karena backend
memperkuat pembagian itu di dua controller berbeda — `admin.controller.ts:53` (`@Roles(Role.ADMIN)`)
vs `admin-support.controller.ts:29` (`@Roles(Role.AGENT, Role.ADMIN)`). Jadi guard di middleware punya
sesuatu yang nyata untuk dijaga, bukan contoh mainan.

**Alternatif:**
- **Cek sesi di `layout.tsx` server + `redirect()`.** Tidak butuh middleware sama sekali, dan bisa
  membaca database/backend penuh (bukan Edge runtime). Trade-off konkret: pengecekan terjadi saat
  render, jadi Next sudah mulai membangun halaman sebelum memutuskan — lebih boros dari 307 dari
  middleware, tapi selisihnya kecil di aplikasi internal. Menang telak dalam kejelasan: satu tempat,
  runtime penuh, mudah dites.
- **Guard per-halaman di tiap `page.tsx`.** Setara secara fungsi, dan **kalah persis pada bug yang
  sudah pernah terjadi di repo ini**: commit `042841a fix(nav): guard every protected route` ada
  karena seseorang lupa. Struktur folder App Router justru memperburuknya — tidak ada satu file pun
  yang menampilkan daftar rute untuk di-audit.
- **Serahkan sepenuhnya ke backend** (tidak ada guard di frontend, biarkan 403 muncul). Paling
  sedikit kode dan tidak mungkin menyimpang dari otoritas. Kalah pada masalah yang tertulis di
  `RequireRole.tsx:11-14`: AGENT mendarat di halaman yang 403 selamanya tanpa penjelasan. Guard
  frontend ada untuk **navigasi**, bukan keamanan — kalau kamu menghapusnya, kamu menghapus UX-nya.
- **Cek di `middleware.ts` **dan** di layout.** Sabuk pengaman ganda, seperti `useSupportSocket` yang
  memakai ref **dan** `useCallback` stabil. Biayanya duplikasi kecil; untungnya, kalau matcher
  middleware salah (sangat mudah terjadi), layout masih menangkap.

**Latihan:** pasang middleware-nya, lalu buktikan klaim "HTML tidak pernah terkirim" dengan cara yang
tidak bisa dibantah. Buka DevTools → Network → centang **Preserve log**, kosongkan cookie, dan navigasi
ke `/deliveries/<id>`. Request dokumen pertama harus berstatus **307**, dengan header `Location: /login`,
dan **tanpa** response body berisi markup halaman. Lalu bandingkan dengan `Drovery_Admin`: di sana
request pertama 200 dengan `index.html` penuh. Simpan dua screenshot itu untuk dokumen capstone —
ini satu-satunya klaim Next.js di fase ini yang bisa kamu buktikan dalam satu gambar.

---

### 13.6 Sesi pindah dari `localStorage` ke cookie `httpOnly` — dan lubang WebSocket yang tercipta

Ini konsep dengan konsekuensi terbesar di seluruh fase, dan satu-satunya yang **membuat sesuatu jadi
lebih buruk**. Baca bagian ini dua kali.

Sekarang, sesi hidup di `localStorage` (`tokenStorage.ts:1-3`), dibaca oleh `apiFetch` untuk memasang
bearer (`client.ts:92-94`), dan dicerminkan ke Redux supaya bisa dibaca komponen (`authSlice.ts:24-29`
membaca `getToken()` **secara sinkron** di initial state — itulah kenapa reload tidak berkedip ke
`/login`). Semuanya di klien, semuanya bisa dibaca JavaScript.

Di App Router, sesi harus bisa dibaca **server**, karena server yang mem-fetch datanya (13.3) dan
middleware yang menjaga rutenya (13.5). Satu-satunya mekanisme yang otomatis ikut di setiap request ke
origin yang sama adalah **cookie**. Dan begitu kamu di cookie, `httpOnly` menjadi pilihan default yang
benar: JS tidak bisa membacanya, jadi XSS tidak bisa mencuri token. Ini peningkatan keamanan yang nyata,
bukan teoretis.

Alurnya jadi: form login `'use client'` → Server Action → `POST /auth/login` ke backend → backend
mengembalikan `{ accessToken, refreshToken }` **di body** (backend Drovery tidak mengeluarkan cookie
sama sekali — lihat anchor) → Server Action menyimpannya sendiri lewat `cookies().set(...)` → `redirect('/')`
dari server. Perhatikan di Next 15+ `cookies()` adalah **async**: `const jar = await cookies()`.

Sekarang lubangnya, dan ini bukan hipotetis. `Drovery_Admin` punya WebSocket untuk live chat support,
dan cara ia mengautentikasi adalah **query string**:

```ts
ws = new Impl(`${wsBaseUrl}/ws/support?token=${encodeURIComponent(token)}`);
```

Itu `supportSocket.ts:215`. Sisi backend mencocokkan persis: gateway membaca `url.searchParams.get('token')`
dan menutup dengan `close(1008, 'Unauthorized')` kalau tidak ada. Dengan token di cookie `httpOnly`,
**JS klien tidak punya apa pun untuk ditaruh di query string itu.** Halaman `/support/:id` yang di-port
akan konek, ditolak 1008, dan `supportSocket.ts:188-198` memperlakukan 1008 sebagai terminal (tidak
reconnect) — jadi chip status akan berbunyi "Offline" selamanya sementara REST-nya baik-baik saja.
Kegagalannya diam, dan itu jenis kegagalan terburuk.

Ada tiga jalan keluar, dan tak satu pun gratis:

1. **Endpoint tiket WS berumur pendek.** Halaman (server) meminta `POST /auth/ws-ticket`, backend
   mengembalikan token sekali-pakai berumur ~30 detik, halaman mengoper string itu sebagai prop ke
   komponen klien, klien memakainya di query string. Perlu perubahan **backend** — endpoint baru dan
   validasinya di gateway. Ini pilihan yang benar untuk produksi.
2. **Biarkan upgrade WebSocket mewarisi cookie.** Handshake WS adalah HTTP, jadi cookie same-origin
   ikut terkirim; gateway membacanya dari header `Cookie` alih-alih query string. Juga perlu
   perubahan backend, tapi lebih kecil. Batasannya: harus benar-benar same-origin (di produksi Drovery
   memang begitu — lihat `deploy/Caddyfile:24-27`), dan `SameSite` harus diatur benar.
3. **Jangan port `/support/:id` di fase ini.** Ini yang direkomendasikan, dan capstone-mu memang tidak
   menyentuhnya. Tapi kamu **wajib** menulis lubangnya di daftar utang, karena inilah yang akan
   menghantam kalau ada yang memutuskan "ayo port sisanya".

Yang harus kamu bawa dari sini adalah pola pikirnya, bukan solusinya: perubahan yang tampak murni
peningkatan (`localStorage` → `httpOnly`) bisa mematahkan subsistem yang letaknya tiga folder jauhnya,
karena keduanya diam-diam berbagi asumsi "token bisa dibaca JS". Peta konsep sudah mengingatkan ini
(map-admin baris 912: *"Jangan lewatkan ini saat merencanakan port"*) — dan tetap saja mudah terlewat.

**Anchor:** `Drovery_Admin/src/api/tokenStorage.ts:1-3` dan `:7` — sesi di `localStorage`, beserta
alasannya. Ini yang kamu buang.
**Anchor:** `Drovery_Admin/src/api/client.ts:92-94` — pemasangan bearer. Di Next, ini pindah ke helper
server yang membaca `await cookies()`.
**Anchor:** `Drovery_Admin/src/api/supportSocket.ts:215` — `?token=${encodeURIComponent(token)}`.
Baris inilah yang patah. Buka file-nya dan lihat sendiri sebelum melanjutkan.
**Anchor:** `Drovery_Backend/src/support/chat/support-chat.gateway.ts:49-52` — komentar keamanannya:
*"the global HTTP JwtAuthGuard does NOT guard WS, so the client authenticates with a JWT in the
handshake query (ws://host/ws/support?token=...)"*. Dan `:87-110` — `handleConnection`, dengan
`url.searchParams.get('token')` di `:90` dan `client.close(1008, 'Unauthorized')` di `:109`.
**Anchor:** `Drovery_Backend/src/auth/auth.controller.ts:47-53` — `POST /auth/login` mengembalikan
`AuthTokensDto` di **body**, tanpa `Set-Cookie`. Ini kenapa Server Action-mu harus menyetel cookie-nya
sendiri; jangan mengira backend akan melakukannya.
**Anchor:** `Drovery_Backend/src/main.ts:42-53` — kebijakan CORS: allowlist **dengan** `credentials: true`
kalau `corsOrigins` diisi, wildcard tanpa credentials kalau tidak. Kalau app Next-mu jalan di port
berbeda saat dev (dan ya, begitu), request server-ke-server tidak kena CORS sama sekali — tapi
request klien kena. Ini sumber kebingungan klasik: setengah aplikasimu tiba-tiba tidak peduli CORS.
**Anchor:** `Drovery_Admin/src/api/client.ts:48-50` — single-flight refresh. Komentar aslinya:
*"a burst of concurrent 401s triggers exactly ONE /auth/refresh, and every caller awaits the same
result."* Di server, masalah ini **kembali muncul dalam bentuk lain**: kalau dua RSC fetch bersamaan
sama-sama kena 401, keduanya akan mencoba refresh, dan karena backend **merotasi** refresh token, yang
kedua memakai token yang sudah dibakar. Peta konsep menandai ini sebagai "masalah baru di server"
(map-admin baris 913). Rencanakan: refresh di middleware (satu tempat, satu request) alih-alih di
helper fetch.

**Kenapa dipakai di sini:** karena tanpa cookie, tidak ada satu pun bagian lain dari fase ini yang
bisa jalan — server tidak punya identitas untuk mem-fetch `/admin/deliveries/:id` yang dijaga
`@Roles(Role.ADMIN)`. Cookie bukan pilihan gaya; ia prasyarat mekanis dari 13.3 dan 13.5.

**Alternatif:**
- **Access token di memori (variabel modul) + refresh token di cookie `httpOnly`.** Kompromi populer:
  XSS tidak bisa mencuri refresh token, dan access token tetap bisa dibaca JS — jadi WebSocket tetap
  bisa memakai `?token=`. Trade-off konkret: satu request refresh di **setiap** page load, dan access
  token tetap dapat dicuri XSS selama sesi berjalan (walau umurnya pendek). Untuk Drovery ini
  sebenarnya jalan tengah yang sangat masuk akal, dan patut kamu sebut di dokumen capstone.
- **Tetap `localStorage`, teruskan token ke server lewat header dari komponen klien.** Menggagalkan
  seluruh tujuan: server tidak bisa mem-fetch saat render awal karena belum ada JS yang berjalan.
  Kamu akan kembali ke waterfall. Sebut ini hanya untuk menutupnya.
- **Sesi server-side dengan session id di cookie** (token backend disimpan di Redis, cookie hanya
  membawa id). Menang: bisa dicabut seketika, cookie tidak membawa apa-apa yang berharga, dan
  endpoint tiket WS jadi trivial (server sudah pegang tokennya). Kalah: butuh Redis untuk app admin
  (Drovery sudah punya Redis, jadi biayanya lebih rendah dari biasanya) dan satu komponen stateful
  lagi yang harus hidup.
- **Cookie non-`httpOnly`.** Server bisa baca, klien bisa baca, WebSocket selamat. Kalah: kamu
  membuang satu-satunya keuntungan keamanan dari pindah ke cookie, dan mendapat semua kerugiannya
  (CSRF jadi relevan). Jangan.

**Latihan:** implementasikan login → cookie → RSC fetch, lalu uji tiga hal berurutan. (1) Setelah
login, jalankan `document.cookie` di console browser dan **pastikan token tidak muncul di sana** —
itu bukti `httpOnly` bekerja. (2) Muat ulang halaman detail dan pastikan datanya tetap tampil (cookie
ikut terkirim di request dokumen). (3) Yang paling penting: tulis file `NOTES-ws.md` sepanjang satu
paragraf yang menjelaskan, dengan menyebut `supportSocket.ts:215` dan
`support-chat.gateway.ts:90`, kenapa `/support/:id` tidak bisa di-port tanpa perubahan backend, dan
opsi mana yang kamu pilih seandainya harus. Paragraf itu masuk ke dokumen capstone hampir apa adanya.

---

### 13.7 Apa yang HILANG: Redux, "satu image statis untuk domain mana pun", dan MUI/Emotion yang menyeret batas klien

Fase 12 mengajarkan Redux Toolkit; fase ini menghapusnya dari halaman yang di-port. Itu terasa sia-sia
kalau dibingkai sebagai "belajar RTK", dan sama sekali tidak sia-sia kalau dibingkai sebagai
**memilih rumah untuk tiap jenis state**. Peta konsep menyusun empat rumah itu (map-admin baris 992-999):
session state → Redux; server state → `useApi`; view state (page/search/filter) → URL; ephemeral UI
state → `useState` lokal.

App Router mengubah **dua** dari empat. Session state pindah ke cookie + server, jadi rumah Redux jadi
kosong: `store.ts:5-12` hanya mendaftarkan satu reducer (`auth`), jadi menghapus sesi berarti menghapus
store-nya. Server state pindah ke RSC, jadi `useApi` lenyap. Yang **tidak** berubah: URL tetap rumah
yang benar untuk view state (13.8), dan `useState` tetap rumah yang benar untuk dialog terbuka. Kalau
kamu bisa mengucapkan kalimat itu tanpa membuka catatan, Fase 12 dan 13 sudah membayar dirinya sendiri.

Kerugian kedua lebih konkret dan lebih mahal. `Dockerfile:7-11` di `Drovery_Admin` menulis keputusan
desain paling instruktif di repo itu:

> *"API base defaults to RELATIVE (/api/v1): the SPA calls its own origin and the edge proxy (Caddy)
> forwards /api + /ws to the backend — so this image works on ANY domain with no rebuild and needs no CORS."*

Hasilnya: image final adalah `nginx:1.27-alpine` berisi file statis (`Dockerfile:14-17`), tanpa Node
sama sekali, jalan di domain mana pun tanpa rebuild, dan tanpa CORS. `next start` menggantikan semua
itu dengan proses Node yang harus hidup, di-restart, di-monitor, dan diberi memori. Untuk konsol
internal dengan segelintir operator, itu **kemunduran operasional** yang harus kamu akui dengan angka:
bandingkan `docker images` keduanya, dan bandingkan konsumsi RAM saat idle.

Kerugian ketiga adalah MUI. Emotion (yang dipakai MUI 7) adalah CSS-in-JS **runtime**: ia menghasilkan
kelas saat komponen dirender. Itu berarti hampir setiap komponen MUI menarik batas klien, sehingga
"kartu read-only jadi RSC murni" tidak segratis kedengarannya — `<Card>`, `<Typography>`, `<Chip>`
semuanya perlu perhatian. MUI menyediakan `@mui/material-nextjs` dengan `AppRouterCacheProvider` untuk
menangani injeksi style di App Router (subpath import-nya bervariasi per-major Next, mis.
`@mui/material-nextjs/v15-appRouter` — periksa dokumen versi yang kamu pasang, jangan salin dari sini
membabi buta). Ini bekerja, tapi ia menambal gesekan alih-alih menghapusnya, dan inilah alasan nyata
kenapa banyak tim yang pindah ke App Router juga pindah dari MUI ke Tailwind atau Panda (zero-runtime).

**Anchor:** `Drovery_Admin/src/app/store.ts:5-12` — satu reducer. Lihat sendiri betapa kecilnya yang
hilang; ini bukan tragedi, ini konfirmasi bahwa Redux di sana memang sengaja dijaga minimal.
**Anchor:** `Drovery_Admin/src/App.tsx:15-24` — wiring `setUnauthorizedHandler(() => dispatch(sessionExpired()))`.
Ini alasan **terkuat** Redux dipakai di repo itu: ia ditulis dari luar React, dari dalam `catch` sebuah
`fetch`. Di App Router masalah itu tidak ada karena 401 ditangani di server. Perhatikan polanya:
argumen terkuat untuk sebuah tool bisa menguap bukan karena tool-nya buruk, tapi karena masalahnya
pindah tempat.
**Anchor:** `Drovery_Admin/Dockerfile:7-11` — komentar "any domain, no rebuild, no CORS" beserta
`ARG VITE_API_BASE_URL=/api/v1`. Dan `:14-17` — stage runtime nginx tanpa Node.
**Anchor:** `Drovery_Admin/nginx.conf:16-19` — `try_files $uri $uri/ /index.html`, SPA history
fallback yang jadi tidak relevan (Next punya routing server sendiri). Dan `:9-14` — cache satu tahun
untuk `/assets/` ber-hash konten, yang Next lakukan sendiri untuk `/_next/static`.
**Anchor:** `Drovery_Backend/deploy/Caddyfile:24-27` — `handle { reverse_proxy admin:80 }`. Blok inilah
yang harus berubah jadi `reverse_proxy admin:3000` (atau port apa pun `next start`-mu) — perubahan
satu baris, tapi maknanya: edge sekarang meneruskan ke aplikasi, bukan ke file server.
**Anchor:** `Drovery_Admin/src/theme/theme.ts:4-20` — seluruh tema muat 17 baris. File ini butuh
`'use client'` di App Router; salah satu port termurah di fase ini, dan contoh paling ringkas dari
"Emotion menyeret batas klien".

**Kenapa dipakai di sini:** karena tanpa bagian ini, capstone-nya jadi iklan. Setiap keputusan
arsitektur yang jujur punya kolom biaya, dan Drovery kebetulan punya biaya yang **bisa diukur** —
ukuran image, jumlah proses, satu baris Caddyfile, dan satu library UI yang tidak cocok. Dokumen yang
menyebut keempatnya lebih berguna bagi tim daripada dokumen yang menyebut "lebih cepat".

**Alternatif:**
- **Pertahankan Redux di Next untuk state UI global** (mis. sidebar collapsed, preferensi tabel).
  Bisa, dan tidak salah. Trade-off konkret: `<Provider>` adalah komponen klien, jadi ia harus
  dipasang serendah mungkin di pohon — kalau kamu taruh di root layout, seluruh aplikasi jadi klien
  dan kamu membatalkan RSC. Untuk satu boolean sidebar, `useState` di komponen klien kecil + cookie
  untuk persistensi jauh lebih murah.
- **`output: 'export'` untuk mempertahankan image statis.** Lihat 13.9 — ini secara teknis
  mengembalikan properti nginx, tapi mematikan Server Actions, middleware, dan `cookies()`, yaitu
  tiga dari empat hal yang kamu port. Sebutkan dan tutup.
- **Tailwind (atau Panda/vanilla-extract) menggantikan MUI.** Menang besar di RSC: zero-runtime,
  jadi komponen presentasional tetap server. Kalah konkret dan mahal: `Drovery_Admin` memakai MUI
  untuk `Table`, `TablePagination`, `Select`, `Dialog`, `Autocomplete` — semua itu adalah komponen
  perilaku, bukan sekadar style, dan Tailwind tidak menyediakannya. Kamu akan menambah headless
  library (Radix/Base UI) dan menulis ulang. Untuk port satu halaman, biayanya tidak sepadan; untuk
  migrasi penuh, ini pertanyaan yang jujur.
- **Serve app Next sebagai standalone output** (`output: 'standalone'`) di image `node:22-slim`.
  Bukan menghapus proses Node, tapi memperkecil image-nya secara signifikan dengan menyalin hanya
  dependency yang benar-benar dipakai. Kalau kamu tetap pindah, ini yang harus dipakai — dan ukur
  hasilnya melawan ~50 MB image nginx.

**Latihan:** ukur, jangan berdebat. (1) `docker images` untuk `drovery-admin` (nginx) vs image Next-mu
dengan `output: 'standalone'`; catat selisihnya. (2) Jalankan keduanya dan bandingkan RSS saat idle
(`docker stats --no-stream`). (3) Ubah satu baris di `deploy/Caddyfile:26` supaya menunjuk ke app
Next-mu, jalankan, dan pastikan `/api/*` masih ke backend sementara halaman lain ke Next. (4) Hapus
`'use client'` dari file tema dan salin pesan error-nya — itu demonstrasi paling ringkas dari
"Emotion adalah runtime klien".

---

### 13.8 `searchParams` sebagai prop halaman, dan kenapa `SearchField` butuh `useTransition`

`useListParams` (`useListParams.ts:42-70`) adalah salah satu hook terbaik di `Drovery_Admin`, dan
docstring-nya bukan penjelasan gaya melainkan bug report yang ditulis ulang sebagai kode:

> *"It used to be `useState` — `useSearchParams` appeared nowhere in the console — so an operator
> working a failed-delivery queue restarted from page 1 unfiltered after every single record they
> opened, a refresh lost their place, and nobody could share a link to 'the failed queue, page 3'."*

Kabar baiknya: **App Router setuju sepenuhnya**. URL tetap rumah yang benar untuk view state, dan di
RSC ia bahkan menjadi lebih fundamental — halaman menerima `searchParams` sebagai **prop**, dan server
merender ulang saat URL berubah. Tidak ada hook, tidak ada state kedua yang harus disinkronkan. Ingat
bentuknya di Next 15+: `searchParams: Promise<{ [key: string]: string | string[] | undefined }>`,
harus di-`await`.

Kabar buruknya ada di kalimat "server merender ulang". Di SPA, mengetik di `SearchField` mengubah URL,
`useApi` melihat key-nya berubah, dan satu request data berangkat. Di RSC, setiap commit pencarian
adalah **round-trip server** yang mengembalikan payload RSC. Tanpa penanganan, konsolmu akan terasa
**lebih lambat** daripada versi Vite-nya — dan itu regresi yang akan langsung dirasakan operator yang
mengetik tracking id sepanjang lima karakter.

Tiga hal yang menahannya, dan ketiganya harus ada:

1. **Debounce yang sudah ada.** `SearchField.tsx:5-9` sudah menjelaskan alasannya:
   *"a five-character tracking id is one query rather than five."* Ini jadi jauh lebih penting, bukan
   kurang. Pertahankan apa adanya.
2. **`useTransition`.** Bungkus `router.replace(url, { scroll: false })` dalam `startTransition`,
   dan pakai `isPending` untuk memberi indikasi halus (opasitas tabel turun, spinner kecil). Tanpa
   ini, React akan menahan input saat menunggu — persis kebalikan dari yang kamu mau.
3. **Pola "adjust state during render" yang sudah ada.** `SearchField.tsx:24-31` — 
   `if (value !== lastValue) { setLastValue(value); setDraft(value); }` dengan komentar yang
   menjelaskan kenapa bukan `useEffect`. Pola ini **tetap berlaku** dan tetap benar di App Router.

Halaman capstone-mu (`/deliveries/:id`) sebenarnya tidak punya `searchParams`, jadi konsep ini kamu
kerjakan sebagai eksperimen kecil di `/deliveries` (daftar) tanpa harus mem-port halamannya penuh.
Itu disengaja: kamu perlu **merasakan** latensi round-trip sekali, supaya klaim "RSC lebih cepat" di
dokumenmu punya kualifikasi yang jujur ("lebih cepat untuk load awal; lebih lambat untuk interaksi
yang mengubah URL, kecuali ditangani").

**Anchor:** `Drovery_Admin/src/hooks/useListParams.ts:4-14` — docstring dengan tiga kerugian konkret
yang jadi alasan hook ini ada. Ketiganya tetap berlaku; App Router tidak mengubah satu pun.
**Anchor:** `Drovery_Admin/src/hooks/useListParams.ts:45` —
`const page = Math.max(0, Number(sp.get('page') ?? '1') - 1);`. URL 1-based (ramah manusia), state
0-based (yang diminta `TablePagination` MUI). Konversi ini tetap kamu butuhkan, hanya pindah tempat.
**Anchor:** `Drovery_Admin/src/hooks/useListParams.ts:56-57` — `setSp(merged, { replace: true })`
dengan komentar *"paging and typing should not each add a browser-history entry."* Di Next, ini jadi
`router.replace`, bukan `router.push`. Salah pilih di sini menghasilkan tombol Back yang harus ditekan
dua belas kali.
**Anchor:** `Drovery_Admin/src/hooks/useListParams.ts:67-68` — `setQ`/`setFilter` mereset page.
Alasannya di `:12-13`: *"staying on page 7 of a result set that no longer has seven pages shows an
empty table and looks like a bug."* Aturan ini pindah apa adanya.
**Anchor:** `Drovery_Admin/src/components/SearchField.tsx:24-31` dan `:33-37` — pola
adjust-during-render dan effect debounce-nya. Komponen ini bisa dipakai ulang di Next dengan
`'use client'` dan mengganti `onChange` jadi pemanggil `router.replace` di dalam `startTransition`.
**Anchor:** `Drovery_Admin/src/pages/Deliveries/DeliveriesListPage.tsx:38-45` — pemakaiannya:
`useListParams()` lalu `toQueryString(...)` sebagai key `useApi`. Di RSC, dua langkah ini jadi satu:
`searchParams` langsung membentuk URL backend.

**Kenapa dipakai di sini:** karena ini satu-satunya tempat di seluruh port yang bisa membuat
aplikasinya **terasa lebih buruk**, dan karena penyebabnya struktural (round-trip), bukan bug yang
bisa ditambal. Peta konsep menandainya untuk `/deliveries` (map-admin baris 942-943):
*"tanpa `useTransition` + `loading.tsx`, terasa lebih lambat daripada SPA sekarang."*

**Alternatif:**
- **Filter di klien saja** (ambil semua data, saring di browser). Menghapus round-trip sepenuhnya.
  Trade-off konkret: hanya jalan sampai beberapa ribu baris, dan `/admin/deliveries` di Drovery adalah
  daftar yang terus tumbuh dengan paginasi backend. Tidak berlaku.
- **`nuqs`** — library type-safe untuk search params dengan dukungan App Router, termasuk opsi
  `shallow: false` dan integrasi transition. Menang: menghapus cast manual seperti
  `filter as DeliveryStatus | ''` (`DeliveriesListPage.tsx:41`) dan mengurus transition untukmu.
  Kalah: satu dependency lagi untuk sesuatu yang di repo ini muat dalam 70 baris.
- **Simpan filter di cookie, bukan URL.** Server bisa membacanya tanpa round-trip navigasi. Kalah
  telak pada tiga hal yang persis disebut docstring `useListParams`: tidak bisa di-share, tidak
  sinkron dengan tombol Back, dan dua tab browser saling menimpa. Ini contoh bagus "solusi yang
  memecahkan masalah teknis dengan mengorbankan alur kerja".
- **`useOptimistic` untuk daftar.** Tidak berlaku untuk pencarian (kamu tidak tahu hasilnya sebelum
  server menjawab), tapi berlaku untuk aksi tulis. Sebut di sini supaya kamu tidak salah pakai.

**Latihan:** buat `app/(console)/deliveries/page.tsx` minimal (tabel polos, tanpa MUI kalau perlu)
yang menerima `searchParams` dan mem-fetch daftar. Pasang `SearchField` versi klien tanpa
`useTransition` dulu, ketik cepat, dan **rasakan** input-nya tersendat. Lalu bungkus dengan
`startTransition` dan rasakan lagi. Terakhir, throttle jaringan ke "Slow 3G" di DevTools dan ulangi
keduanya — di sanalah perbedaannya berhenti jadi teori. Catat kesanmu dalam satu kalimat untuk dokumen
capstone; kalimat itu lebih berharga daripada benchmark mana pun.

---

### 13.9 Alternatif yang dibandingkan: tetap di Vite SPA, `output: 'export'`, Remix / React Router framework mode, TanStack Router/Start

Konsep terakhir bukan teknik, melainkan disiplin: setelah 20 jam mem-port, kamu akan punya bias
alami untuk membenarkan pekerjaanmu. Bagian ini ada untuk melawan itu, dan hasilnya adalah setengah
dari dokumen capstone.

Pertanyaan yang harus dijawab dokumenmu bukan "apakah Next.js bagus" melainkan **"masalah apa yang
kamu punya, dan apa cara termurah menyelesaikannya"**. Untuk `Drovery_Admin`, daftar masalah nyatanya
pendek dan semuanya terdokumentasi di kode: (a) waterfall empat lapis pada load halaman; (b) kelas bug
invalidasi manual (`d67ac40`); (c) guard klien yang mengirim HTML halaman terlarang; (d) bundle MUI
yang ikut terunduh untuk kartu read-only. Untuk tiap masalah, tanyakan cara termurah — dan tulis
jawabannya walau jawabannya "tidak perlu pindah framework".

**Anchor:** `Drovery_Admin/Dockerfile:7-11` — properti "satu image, semua domain, no CORS" yang jadi
taruhan utama dari keputusan ini.
**Anchor:** `Drovery_Backend/docker-compose.prod.yml:11-13` dan `:67-74` — bagaimana admin dipasang
di sistem produksi: satu service, `depends_on: api`, di belakang Caddy. Baca ini sebelum memutuskan;
"pindah framework" di sini berarti mengubah topologi produksi seluruh sistem, bukan cuma satu repo.
**Anchor:** `Drovery_Admin/src/router/router.tsx:12-27` — sepuluh `React.lazy`, satu chunk per rute.
Ini yang sudah ada hari ini; bandingkan dengan chunking otomatis Next sebelum mengklaim perbaikan.

**Kenapa dipakai di sini:** karena `Drovery_Admin` adalah kasus di mana jawaban jujurnya kemungkinan
besar **"jangan pindah"**, dan menuliskan itu setelah mem-port satu halaman jauh lebih kredibel
daripada menuliskannya tanpa pernah mencoba. Pengguna konsol ini adalah staff dengan jaringan bagus
dan browser desktop; bundle size bukan prioritas nomor satu. Argumen terkuat untuk Next.js di sini
bukan performa, melainkan (b) dan (c) — dan (b) bisa diselesaikan TanStack Query dalam satu sore.

**Alternatif** (ini isi konsepnya):

- **Tetap di Vite SPA + TanStack Query + `loader` react-router.** Biaya: ~1-2 hari kerja, +13 KB
  bundle, nol perubahan deployment. Dapat: kelas bug (b) hilang lewat `invalidateQueries`, dan satu
  lapis waterfall (a) hilang lewat `loader`. Tidak dapat: (c) dan (d). **Ini opsi dengan rasio
  manfaat/biaya tertinggi untuk repo ini**, dan dokumenmu harus mengatakannya.
- **Next.js App Router `output: 'export'`.** Mempertahankan image statis `Dockerfile:7-11` dan
  deployment nginx. Tapi static export mematikan Server Actions (build gagal dengan `ExportError`
  eksplisit), middleware (dinonaktifkan dengan peringatan), serta `cookies()`/`headers()` — karena
  tidak ada server saat request. Server Component tetap berjalan, tapi hanya **saat build**, jadi
  data delivery yang berubah tiap detik tidak bisa diambil di sana. Artinya: (b) dan (c) tidak
  didapat, dan (a) hanya sebagian. Kesimpulan tegas: untuk kasus ini `output: 'export'` menghapus
  alasan pindah. Sebut ini di dokumen supaya tidak ada yang mengusulkannya sebagai "yang terbaik dari
  dua dunia".
- **Remix / React Router 7 framework mode.** Model yang sangat cocok dengan repo ini: `loader` untuk
  baca, `action` untuk tulis, revalidasi otomatis setelah action (yang menyelesaikan (b) dengan
  mekanisme yang sama bersihnya dengan `revalidatePath`), dan progressive enhancement lewat `<form>`.
  Yang lebih penting: `Drovery_Admin` **sudah** memakai react-router 7, jadi migrasinya inkremental —
  tabel rute di `router.tsx:38-57` tetap bisa dibaca sebagai data. Trade-off konkret: kamu tetap butuh
  proses Node di produksi (kerugian yang sama dengan Next), dan kamu **tidak** mendapat RSC, jadi
  seluruh JS komponen tetap terkirim — (d) tidak terselesaikan. Untuk konsol operator internal, (d)
  adalah masalah paling tidak penting dari keempatnya. Ini pesaing terkuat Next.js di sini.
- **TanStack Router (SPA) atau TanStack Start (fullstack).** Router-nya memberi type-safety penuh
  untuk route params **dan** search params — persis masalah yang sekarang ditambal dengan cast manual
  `filter as DeliveryStatus | ''` (`DeliveriesListPage.tsx:41`), plus loader terintegrasi dengan
  TanStack Query. Trade-off konkret: ekosistem lebih kecil, dan Start masih jauh lebih muda daripada
  Next/Remix — untuk alat internal itu risiko yang bisa diterima, untuk produk berumur panjang belum
  tentu.
- **Astro + island.** Sangat baik untuk halaman yang mayoritas statis. Tidak cocok di sini: konsol ini
  hampir seluruhnya *authenticated, dynamic, interaktif*. Sebut dan tutup.

**Latihan:** tulis tabel 4 kolom di `COMPARISON.md`: masalah (a-d) × opsi (Vite+RQ, Next full, Remix,
`output:'export'`), isi tiap sel dengan "ya / tidak / sebagian" **plus** estimasi jam. Lalu tulis satu
paragraf rekomendasi yang dimulai dengan kalimat "Untuk Drovery_Admin hari ini, saya akan …". Kalau
rekomendasimu bukan "pindah penuh ke Next", itu bukan kegagalan fase ini — itu **hasil** fase ini.

---

## Capstone

`/deliveries/:id` berjalan di aplikasi Next.js App Router terpisah (`drovery-admin-next/`) yang
menembak backend Drovery yang **sama**, tanpa satu baris pun perubahan di `Drovery_Backend`.

Kriteria penerimaan — tiap butir adalah perilaku yang bisa gagal di depan mata:

- [ ] **Bagian baca sepenuhnya RSC.** Buka DevTools → Network → filter JS. Chunk yang diunduh untuk
      halaman detail **tidak** mengandung string `'Proof of delivery'`, `'Customer rating'`, atau
      `humanizeEnum`. Kalau ada, ada komponen yang tidak sengaja jadi klien — cari `'use client'` yang
      terlalu tinggi di pohon.
- [ ] **Satu `Promise.all` di server.** Nyalakan log request di backend (atau tambahkan delay 400 ms
      di helper fetch): kedua request harus berangkat dalam jendela waktu yang sama, bukan berurutan.
      Kalau latensi halaman ≈ 800 ms alih-alih ≈ 400 ms, kamu menulis dua `await` terpisah.
- [ ] **`view-source` sudah memuat data.** `curl -s http://localhost:3001/deliveries/<id> | grep <trackingId>`
      harus menemukan tracking id-nya di HTML. Di `Drovery_Admin` perintah yang sama tidak menemukan
      apa pun — sertakan kedua output di dokumen.
- [ ] **Satu Server Action force-cancel + `revalidatePath`.** Jalankan force-cancel pada delivery yang
      punya riwayat perintah, lalu pastikan **panel aksi berubah (tombol jadi disabled sesuai
      `deliveryActions`) DAN tabel riwayat perintah ikut segar** — tanpa kamu menulis apa pun yang
      menyebut command history di Server Action itu. Ini bukti bug `d67ac40` jadi tidak bisa
      diekspresikan.
- [ ] **Error mutasi muncul di dalam dialog, bukan sebagai `error.tsx`.** Matikan backend, jalankan
      force-cancel: dialog tetap terbuka, pesan errornya tampil di dalamnya, tombol Cancel kembali
      aktif. Kalau halaman jadi error boundary penuh, Server Action-mu melempar alih-alih mengembalikan
      state.
- [ ] **Double-submit tertahan.** Klik tombol konfirmasi dua kali cepat; hanya satu request POST yang
      berangkat (`pending` dari `useActionState` harus mengunci tombolnya, seperti
      `ConfirmDialog.tsx` mengunci saat `loading`).
- [ ] **`middleware.ts` memblokir sebelum HTML dikirim.** Kosongkan cookie, buka `/deliveries/<id>`:
      request dokumen pertama berstatus **307** dengan `Location: /login`, tanpa body markup halaman.
      Ulangi sebagai role yang tidak berhak: harus diarahkan ke `homePathForRole`-nya, bukan diberi 403.
- [ ] **Tidak ada loop redirect.** Login sebagai role yang `homePathForRole`-nya sama dengan path yang
      sedang dijaga; browser tidak boleh berhenti dengan `ERR_TOO_MANY_REDIRECTS`. (Ini yang dijaga
      `RequireRole.tsx:29`.)
- [ ] **`loading.tsx` dan `error.tsx` menggantikan tiga cabang render.** Tunjukkan diff barisnya:
      `DeliveryDetailPage.tsx:103-135` (33 baris) vs dua file kecil. Sidebar harus tetap terlihat saat
      `loading.tsx` tampil.
- [ ] **Cookie benar-benar `httpOnly`.** `document.cookie` di console browser tidak menampilkan token.
- [ ] **Dokumen perbandingan 2 halaman** (`COMPARISON.md`) berisi: (1) JS yang tidak lagi dikirim ke
      browser, **diukur** — total transfer JS untuk halaman detail di kedua versi, dengan cache
      dikosongkan; (2) kelas bug yang hilang, dengan nama commit dan mekanisme penggantinya
      (`d67ac40` → `revalidatePath`; race `useApi.ts:23,43-45` → tidak ada komponen yang unmount);
      (3) daftar utang yang tercipta, **dipimpin** oleh masalah token WebSocket di bawah cookie
      `httpOnly` dengan rujukan ke `supportSocket.ts:215` dan `support-chat.gateway.ts:90`, diikuti
      hilangnya image statis (`Dockerfile:7-11`), MUI/Emotion, dan risiko refresh-token race di server;
      (4) satu paragraf rekomendasi jujur dari 13.9.

Yang **tidak** termasuk capstone (dan sebaiknya tidak kamu kerjakan): `/support/:id`, `/promos`,
`/users`, `/fleet`, tema MUI yang rapi, dan test. Batas ini disengaja.

---

## Gerbang keluar

Kalau salah satu pertanyaan berikut belum bisa kamu jawab tanpa membuka kode, jangan anggap fase ini
selesai. (Ini fase terakhir, jadi "lanjut" berarti "menganggap dirimu paham" — taruhannya justru lebih
tinggi.)

**1. Kenapa `'use client'` disebut "menular ke bawah", dan bagaimana `children` menembus aturan itu?**

<details><summary>Jawaban</summary>

`'use client'` menandai **titik masuk** ke graph klien: semua yang di-`import` file itu ikut masuk
bundle klien, sedalam apa pun rantai import-nya. Yang **tidak** ikut adalah `children` (dan prop
lain berisi elemen), karena elemen sudah menjadi output sebelum menyeberang — bukan komponen yang
perlu dieksekusi klien. Jadi `<ClientPanel>{serverCards}</ClientPanel>` tetap merender `serverCards`
di server. Ini pola utama untuk menjaga MUI tidak menyeret seluruh halaman ke klien.
</details>

**2. Kenapa `revalidatePath` membuat bug `d67ac40` mustahil, sementara `refreshAll()` cuma
memperbaikinya?**

<details><summary>Jawaban</summary>

`refreshAll()` (`DeliveryDetailPage.tsx:144-147`) adalah **daftar** yang harus diingat: ia memanggil
`refetch()` dan `refetchCommands()`. Menambah `useApi` ketiga berarti seseorang harus ingat menambah
baris ketiga; kalau lupa, bug yang sama kembali (dispatcher melihat PENDING selamanya dan mengirim
perintah kedua ke pesawat yang sudah patuh). `revalidatePath('/deliveries/'+id)` tidak menyegarkan
query-query; ia membatalkan **seluruh segment** dan merender ulang halamannya dari awal. Tidak ada
daftar yang bisa ketinggalan karena tidak ada daftar. Bug-nya bukan diperbaiki — ia jadi tidak bisa
diekspresikan.
</details>

**3. Apa **persisnya** yang patah kalau sesi pindah ke cookie `httpOnly`, dan kenapa gagalnya diam?**

<details><summary>Jawaban</summary>

`supportSocket.ts:215` mengautentikasi WebSocket lewat query string:
`${wsBaseUrl}/ws/support?token=...`, dan token itu dibaca dari JS. Cookie `httpOnly` tidak bisa dibaca
JS, jadi tidak ada yang bisa ditaruh di sana. Backend (`support-chat.gateway.ts:90`) tidak menemukan
token dan menutup dengan `close(1008, 'Unauthorized')` (`:109`); sisi klien memperlakukan 1008 sebagai
terminal dan tidak reconnect (`supportSocket.ts:188-198`). Gagalnya diam karena halaman **tetap
berfungsi** dari REST — hanya chip statusnya berbunyi "Offline" selamanya. Perbaikannya butuh
perubahan backend: endpoint tiket WS berumur pendek, atau upgrade WS yang membaca cookie dari header.
</details>

**4. Kenapa `output: 'export'` bukan "yang terbaik dari dua dunia"?**

<details><summary>Jawaban</summary>

Ia mengembalikan properti image statis (`Dockerfile:7-11`: satu image, semua domain, no CORS), tapi
mematikan justru tiga hal yang jadi alasan port ini: Server Actions (build gagal dengan `ExportError`),
middleware (dinonaktifkan dengan peringatan), dan `cookies()`/`headers()` (tidak ada server saat
request). Server Component tetap berjalan tapi hanya saat **build**, jadi data delivery yang berubah
tiap detik tidak bisa diambil di sana. Yang tersisa cuma routing berbasis folder — biaya penuh
migrasi, nyaris nol manfaat.
</details>

**5. Empat "rumah state" di `Drovery_Admin` — mana yang berubah di App Router, mana yang tidak, dan
kenapa?**

<details><summary>Jawaban</summary>

Session state (Redux `authSlice`) → **berubah**: pindah ke cookie + server, karena server yang perlu
membacanya untuk fetch dan middleware. Server state (`useApi`) → **berubah**: pindah ke `await` di
dalam `async function Page()`. View state (page/search/filter di URL, `useListParams`) → **tidak
berubah**: URL tetap rumah yang benar, dan RSC bahkan memperkuatnya lewat prop `searchParams`.
Ephemeral UI state (dialog terbuka, draft form) → **tidak berubah**: `useState` di komponen klien.
Dua dari empat berubah, dan yang berubah adalah dua yang punya "sisi server"-nya.
</details>

**6. Kalau ukuran bundle bukan prioritas dan tim punya waktu satu sore, masalah mana dari daftar
(a)-(d) yang kamu selesaikan, dan dengan apa?**

<details><summary>Jawaban</summary>

(b) kelas bug invalidasi manual — dengan TanStack Query dan `invalidateQueries(['delivery', id])`.
Biayanya ~13 KB, satu `QueryClientProvider` di `main.tsx`, dan `renderWithProviders` harus
membungkusnya untuk test. Manfaatnya identik dengan `revalidatePath` untuk masalah ini, tanpa
mengubah deployment sama sekali. Kalau kamu punya satu sore, itu yang kamu kerjakan — bukan migrasi
framework.
</details>

**7. Kenapa guard di `middleware.ts` lebih kuat daripada `ProtectedRoute`, dan kenapa **tetap** bukan
gerbang sungguhannya?**

<details><summary>Jawaban</summary>

Lebih kuat karena berjalan sebelum response dibuat: browser menerima 307 dan tidak pernah menerima
HTML halaman terlarang — sesuatu yang mustahil untuk SPA, yang baru bisa berpikir setelah HTML-nya
sampai. Tetap bukan gerbang sungguhannya karena gerbangnya ada di backend: `RolesGuard`
(`roles.guard.ts:34-40`) membaca role **fresh dari DB** setiap request, karena JWT tidak membawa role
— jadi demote berlaku seketika. Middleware membaca cookie yang bisa basi. `README.md:39-40`
menuliskannya: *"The authoritative gate is always the backend `RolesGuard` — the UI role only decides
which nav to render."*
</details>

**8. Setelah port, interaksi apa yang jadi **lebih lambat** daripada versi Vite, dan kenapa itu
struktural?**

<details><summary>Jawaban</summary>

Apa pun yang mengubah URL untuk mengubah data — pencarian dan paginasi di halaman daftar. Di SPA,
ketikan yang commit memicu satu request data JSON. Di RSC, ia memicu round-trip server yang
mengembalikan payload RSC untuk segment tersebut. Ini struktural karena render-nya memang ada di
server; tidak bisa ditambal, hanya bisa disamarkan — dengan debounce yang sudah ada
(`SearchField.tsx:5-9`), `useTransition` supaya input tidak tersendat, dan `loading.tsx` supaya
transisinya punya umpan balik.
</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| `Error: You're importing a component that needs useState. It only works in a Client Component...` di file yang menurutmu tidak pakai hook | Batas `'use client'` menular: file-mu meng-`import` sesuatu (biasanya komponen MUI, atau `theme.ts`) yang butuh runtime klien. Ini kebingungan nomor satu di minggu pertama, dan pesannya menunjuk file **yang meng-import**, bukan yang salah. | Baca jejak import di pesan error dari bawah ke atas sampai menemukan modul pertama yang butuh klien. Lalu putuskan: pindahkan `'use client'` **lebih rendah** (ke komponen kecil), atau ubah struktur jadi `<ClientWrapper>{serverChildren}</ClientWrapper>`. Jangan pernah menaikkan `'use client'` ke layout untuk "menyelesaikannya" — itu membatalkan seluruh fase. |
| Halaman detail terasa lebih lambat dari versi Vite, latensi ≈ dua kali lipat | Dua `await` berurutan alih-alih `Promise.all`. Di localhost tidak terasa; dengan backend nyata langsung terasa. | Tambahkan `await new Promise(r => setTimeout(r, 400))` di helper fetch-mu dan ukur dengan `curl -w '%{time_total}\n' -o /dev/null -s`. Kalau hasilnya ≈ 0,8 s, kamu berurutan; `Promise.all` harus ≈ 0,4 s. |
| Data delivery tampak basi — status tidak berubah padahal backend sudah berubah | `fetch` ter-cache. Di Next 14 default-nya `force-cache`; di Next 15 tidak lagi, tapi konfigurasi segment atau `fetchCache` bisa mengembalikannya. Untuk konsol operator ini berbahaya: peta konsep menegaskan datanya *"selalu basi"* dan tiap halaman punya Refresh manual justru karena itu. | Cek versi Next di `package.json`, lalu paksa eksplisit: `fetch(url, { cache: 'no-store' })`. Kalau statusnya langsung benar, itu penyebabnya. Jangan andalkan default — tulis eksplisit di helper fetch-mu, satu kali. |
| `ERR_TOO_MANY_REDIRECTS` setelah memasang `middleware.ts` | Matcher middleware ikut menangkap `/login` (atau `/_next/*`), jadi redirect ke `/login` memicu middleware lagi. Atau `homePathForRole` mengembalikan path yang sedang dijaga — kasus yang persis dijaga `RequireRole.tsx:29` (`home === pathname ? null : ...`). | Log `req.nextUrl.pathname` di baris pertama middleware dan lihat urutannya di terminal. Perbaiki `config.matcher` untuk mengecualikan `/login`, `/_next`, dan aset; lalu port ulang penjagaan loop dari `RequireRole.tsx:28-29`. |
| Chip "Live" di halaman support (kalau kamu nekat mem-portnya) berbunyi Offline selamanya, tapi thread REST normal | Cookie `httpOnly` — tidak ada token yang bisa ditaruh di `?token=` (`supportSocket.ts:215`); gateway menutup dengan 1008 (`support-chat.gateway.ts:109`), dan 1008 diperlakukan terminal tanpa reconnect (`supportSocket.ts:188-198`). | Buka tab Network → filter WS. Handshake-nya akan muncul lalu tertutup dengan close code 1008. Ini bukan bug yang bisa kamu perbaiki di frontend; catat di daftar utang dan jangan port halaman itu di fase ini. |
| Server Action jalan, tapi backend mengembalikan 401/403 | Cookie tidak diteruskan ke backend. Server Action berjalan di Node, dan `fetch` di sana **tidak** otomatis membawa cookie browser — kamu harus membacanya sendiri (`await cookies()`) dan memasangnya sebagai header `Authorization`. | Log header yang kamu kirim (jangan log tokennya — gateway backend sendiri sengaja tidak melakukannya, lihat komentar `support-chat.gateway.ts:106`). Bandingkan dengan yang dikirim `client.ts:92-94`. Ingat semua route `/admin/*` di bawah `@Roles(Role.ADMIN)` (`admin.controller.ts:53`). |
| Setelah force-cancel, panel aksi tidak berubah walau data di DB sudah berubah | `revalidatePath` tidak dipanggil, dipanggil dengan path yang salah (harus persis path segment: `/deliveries/${id}`), atau dipanggil **setelah** `redirect()`. | Tambahkan `console.log` di `page.tsx`; setelah aksi, log itu harus muncul lagi di terminal. Kalau tidak muncul, halamannya tidak dirender ulang. |
| Sesi hilang setiap kali proses dev di-restart, atau dua tab saling membuang | Refresh token dirotasi backend dan dua request bersamaan sama-sama mencoba refresh — masalah yang di SPA diselesaikan single-flight (`client.ts:48-50`), dan yang kembali dalam bentuk baru di server. | Log setiap panggilan `/auth/refresh` di backend. Kalau ada dua dalam jendela milidetik yang sama, itu penyebabnya. Pindahkan refresh ke **middleware** (satu tempat, satu request per navigasi) alih-alih ke helper fetch yang dipanggil beberapa kali per render. |

---

## Bacaan pendamping

Semuanya di dalam repo, dan semuanya berisi **"kenapa"**, bukan "bagaimana":

- `Drovery_Backend/docs/learning/peta/admin.md` baris **899-987** — bagian "apa yang berubah kalau
  di-port ke Next.js App Router". Tabel lintas-halaman dan catatan per-halaman; ini silabus mentah
  fase ini, baca lagi setelah selesai untuk melihat mana yang ternyata meleset.
- `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx:140-147` — post-mortem `d67ac40`. Cari
  di sini kalimat yang menjelaskan **konsekuensi operasional** sebuah bug invalidasi: bukan "tabel
  tidak update", melainkan perintah kedua ke pesawat yang sudah patuh.
- `Drovery_Admin/src/layout/RequireRole.tsx:7-18` — docstring paling informatif di repo itu. Cari
  alasan kenapa redirect lebih baik daripada 403 untuk manusia yang sedang bekerja.
- `Drovery_Admin/src/hooks/useListParams.ts:4-14` — bug report yang ditulis sebagai kode. Cari tiga
  kerugian konkret dari menaruh view state di `useState`; ketiganya tetap berlaku di App Router.
- `Drovery_Admin/Dockerfile:7-11` — cari kalimat "works on ANY domain with no rebuild and needs no
  CORS"; itu properti yang kamu bayar untuk pindah.
- `Drovery_Backend/deploy/Caddyfile:3-27` — cari bagaimana satu origin dibagi antara API, WebSocket,
  dan konsol; ini yang harus kamu ubah kalau app Next-mu menggantikan container admin.
- `Drovery_Backend/src/common/guards/roles.guard.ts:9-15` — cari kenapa role dibaca fresh dari DB tiap
  request, dan apa artinya untuk role yang kamu simpan di cookie.
- `Drovery_Backend/src/support/chat/support-chat.gateway.ts:49-52` — cari kalimat tentang autentikasi
  handshake lewat query (*"the global HTTP JwtAuthGuard does NOT guard WS"*); ini akar dari utang
  terbesar yang kamu ciptakan.
- `Drovery_Admin/README.md:37-44` — tiga bullet "How it works". Cari kalimat *"The authoritative gate
  is always the backend `RolesGuard`"*; tempel di atas `middleware.ts`-mu.

Dokumentasi eksternal — hanya tiga, dan hanya karena APInya berubah antar-major sehingga hafalan
berbahaya:

- Next.js — [File conventions: `page.tsx`](https://nextjs.org/docs/app/api-reference/file-conventions/page)
  untuk bentuk `params`/`searchParams` sebagai Promise.
- Next.js — [`cookies()`](https://nextjs.org/docs/app/api-reference/functions/cookies) untuk bentuk
  async-nya dan aturan di mana boleh ditulis (Server Action / Route Handler saja).
- Next.js — [Static exports: unsupported features](https://nextjs.org/docs/app/guides/static-exports)
  supaya klaim di 13.9 bisa kamu verifikasi sendiri, bukan mengutip dokumen ini.

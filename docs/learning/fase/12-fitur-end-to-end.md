# Fase 12 — Kirim fitur nyata end-to-end: backend → admin console → mobile

> **Durasi** ~2,5 minggu (~31 jam) · **Mode** fitur nyata · **Repo** `Drovery_Backend` (module + migration + spec + `AUDIT-LOG.md` + `INTEGRATION.md`), `Drovery_Admin` (halaman operator + test Vitest), `Drovery_Mobile` (satu layar/field konsumen)

---

## Kenapa fase ini ada di sini

Dua belas fase sebelumnya (0 sampai 11) membangun kemampuan yang, kalau dilihat satu-satu, semuanya "setengah". Kamu bisa membuat module NestJS (Fase 1-2), mendesain tabel dan menulis migration (Fase 3), memenangkan balapan dengan CAS (Fase 5), memindahkan efek samping ke job durabel (Fase 6), menyiarkan perubahan lewat WebSocket (Fase 8), memasang metrik (Fase 9), dan mengemasnya jadi container yang jalan di Kubernetes (Fase 10-11). Yang belum pernah kamu lakukan: **menjahit semuanya jadi satu fitur yang dipakai orang**, lalu mengoperasikannya dari sebuah layar, lalu mengonsumsinya dari HP. Fitur nyata tidak berhenti di endpoint yang mengembalikan `201`. Ia berhenti di operator yang menekan tombol dan pelanggan yang melihat angkanya benar.

Kenapa TEPAT di sini, dan bukan lebih awal? Karena tiga hal yang jadi tulang punggung fase ini baru masuk akal setelah fase-fase sebelumnya. Pertama, `deliveryActions()` di admin (`Drovery_Admin/src/features/deliveries/deliveryActions.ts:20-26`) adalah **cermin dari gating CAS backend** — kamu tidak bisa menilai apakah cermin itu jujur kalau kamu belum pernah menulis CAS-nya sendiri di Fase 5. Kedua, `useApi` di admin dan `apiClient` di mobile sama-sama membuka amplop `{ success, data }` yang dipasang `TransformInterceptor` di Fase 2 — tanpa itu, "unwrap envelope" cuma mantra. Ketiga, dan yang paling menentukan: fase ini menuntut kamu memakai **proses repo-nya sendiri** (acceptance criteria berupa perilaku → kerja → verifikasi manual dicatat → mutation testing → entri `AUDIT-LOG.md`), dan proses itu hanya punya arti kalau kamu sudah pernah merasakan test hijau yang berbohong. `AUDIT-PLAN.md:64-67` menuliskannya tanpa basa-basi: *"1,073 tests passing, all three repos typecheck clean, lint clean — while an entire user-facing feature (support tickets) was unreachable and no payment had ever been captured."*

Apa yang **mustahil dipahami** tanpa fase ini? Satu ide, dan ia bukan tentang library: **setiap potongan state punya rumah yang benar, dan menaruhnya di rumah yang salah adalah kesalahan arsitektur paling mahal di klien.** Sesi hidup di Redux karena ia dibaca dari mana-mana *dan* ditulis dari luar React. Data server hidup di `useApi` karena ia harus selalu segar. Page/search/filter hidup di **URL** karena operator harus bisa kembali dari halaman detail tanpa kehilangan antrean. Dialog yang terbuka hidup di `useState` lokal karena ia mati bersama komponennya. Datang dari Ionic React, refleks yang wajar adalah menaruh semuanya di `useState`, atau semuanya di satu global store. Repo ini menolak keduanya dan **menuliskan alasannya di docstring**, bukan di wiki. Itu satu-satunya cara kamu akan benar-benar memahaminya: dengan membaca alasan yang ditulis orang yang pernah kena bug-nya.

Ide kedua yang cuma bisa didapat di sini: **kontrak wire-format lintas repo bisa gagal tanpa suara.** Mobile pernah mengirim `"Jul 30, 2026"` ke backend yang mem-parse `YYYY-MM-DD`; parsing gagal, `computeScheduledFor()` mengembalikan `null`, dan `create()` memperlakukan `null` sebagai "berangkatkan sekarang". Respons tetap `201`. Kolom `pickupDate` yang tersimpan *terlihat benar*. Setiap pengiriman "terjadwal" diam-diam terbang seketika. Kamu bisa hafal seluruh NestJS dan tetap mengirim bug ini kalau kamu tidak pernah melihat ketiga repo sekaligus.

---

## Gerbang masuk

Kamu siap masuk Fase 12 kalau kamu bisa:

- [ ] Menulis satu module NestJS baru dari nol (module + controller + service + DTO ber-validasi), mendaftarkannya di `AppModule`, dan menjelaskan kenapa `admin.module.spec.ts` ada — yaitu kenapa module yang lupa di-import bisa lolos 94 test hijau.
- [ ] Menulis satu Prisma migration yang menambah kolom + index, menjalankannya, dan **membenarkan** index-nya dengan menyebut query mana yang memakainya (bukan "biar cepat").
- [ ] Mengubah satu status dengan CAS (`updateMany` + `where` yang memuat status lama) dan menjelaskan apa artinya `count === 0` — tanpa membuka kode Fase 5.
- [ ] Menjalankan ketiga repo bersamaan di satu mesin: backend (`npm run start:dev` + Postgres + Redis), admin (`npm run dev`), mobile (`npm run android` di emulator), lalu login sebagai ADMIN di admin console dan sebagai USER di app.
- [ ] Membaca satu entri di `AUDIT-LOG.md` dan menyebut, tanpa bantuan, mana bagian "apa yang berubah", mana "harga yang diterima", dan mana `### Left undone`.
- [ ] Menjalankan satu file spec backend penuh (bukan `jest -t`) dan menjelaskan kenapa `jest -t` dilarang saat mutation testing.

Kalau butir keempat gagal (tiga repo tidak bisa hidup bersamaan), **selesaikan itu dulu**. Fase ini tidak bisa dikerjakan dari satu repo saja, dan itu memang intinya.

---

## Peta jalan mingguan

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| 1 | **Bedah admin console.** Empat rumah state; Redux Toolkit + `createAsyncThunk` + single-flight refresh; data router + `NAV_ITEMS`; `useApi`/`useMutation`/`ConfirmDialog`; URL sebagai state. Tulis 2 test Vitest terhadap halaman yang **sudah ada**. | 12 | Kamu bisa menambah satu rute admin baru (halaman kosong) yang otomatis terjaga role-nya, dan test `navItems.test.ts` tetap hijau. Satu test Vitest baru yang query-nya berbasis role. |
| 2 | **Kirim fitur.** Backend: module + DTO + migration + transisi ber-CAS + efek samping via job/outbox + satu metrik + key i18n en/id + spec (termasuk satu test balapan). Admin: halaman/panel yang mengoperasikannya. | 13 | Endpoint hidup, satu baris baru di tabel, satu halaman admin yang bisa menekan tombolnya, filter yang hidup di URL, `ConfirmDialog` untuk aksi destruktif. |
| 3 (setengah) | **Tutup lingkaran.** Mobile: satu layar/field yang mengonsumsi field baru dengan wire format benar. Mutation testing. Entri `AUDIT-LOG.md`. Demo end-to-end. Tulis perbandingan alternatif. | 6 | App Android menampilkan field barunya dengan format yang benar; ≥8 mutasi dijalankan dan dicatat mana yang lolos; satu entri `AUDIT-LOG.md` bergaya repo; satu halaman perbandingan alternatif dengan angka dari mesinmu. |

Total ~31 jam. Kalau di minggu 2 backend-nya melar (biasanya karena migration atau test balapan), **potong lingkup fiturnya**, jangan potong minggu 3 — mutation testing dan `AUDIT-LOG` adalah bagian yang paling banyak mengajarkan.

---

## Konsep

### 12.1 Empat rumah state di klien

Di Ionic React kamu punya satu refleks: `useState` untuk semuanya, dan kalau butuh dibagi, angkat ke Context. Di console operator ini, refleks itu menghasilkan empat kelas bug yang berbeda, karena ada **empat jenis state yang sifatnya berbeda**:

1. **Session state** (user, role, status auth) → **Redux** (`Drovery_Admin/src/features/auth/authSlice.ts`). Alasannya bukan "karena Redux keren": ia dibaca oleh komponen yang tersebar dan tidak sekeluarga (`ProtectedRoute`, `RequireRole`, `AppLayout`, `LoginPage`), **dan** ia ditulis dari **luar** React — `api/client.ts` memanggil `unauthorizedHandler?.()` dari dalam sebuah `catch` fetch.
2. **Server state** (daftar delivery, tiket, promo) → **`useApi` per-halaman**. Alasannya: datanya operasional dan berubah tiap detik. Operator **ingin** menarik data terbaru secara sadar, jadi hampir setiap halaman punya tombol Refresh eksplisit (`Drovery_Admin/src/pages/Dashboard/DashboardPage.tsx:43`).
3. **View state** (page, search, filter) → **URL** (`useListParams`). Alasannya ditulis sebagai bug report di docstring: kembali dari detail tidak boleh kehilangan antrean, refresh tidak boleh kehilangan posisi, dan link "antrean gagal, halaman 3" harus bisa dibagikan.
4. **Ephemeral UI state** (dialog mana yang terbuka, draft form) → **`useState` lokal**. Alasannya: ia mati bersama komponennya, dan menaruhnya di store global cuma mengotori `RootState`.

Padanan yang jujur dari duniamu: ini persis seperti memutuskan apakah sebuah nilai disimpan di `@capacitor/preferences`, di state komponen, atau di query string — hanya saja di sini keempat pilihannya punya konsekuensi yang bisa kamu lihat dalam satu sesi kerja operator. Yang **tidak** ada padanannya: gagasan "state yang ditulis dari luar React". Di app Ionic, hampir semua penulisan state datang dari handler React. Di sini, sebuah 401 di tengah `fetch` harus bisa merobohkan sesi.

**Anchor:** `Drovery_Admin/README.md:43-44` — *"**State** — Redux Toolkit holds the auth session; server data is fetched per-page via the `useApi` hook (loading / error / refetch)."* Ini kalimat pembagi tugasnya, ditulis eksplisit. Lalu `Drovery_Admin/src/hooks/useListParams.ts:4-14` untuk rumah ketiga, dan `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx:88-93` untuk rumah keempat (lima `useState` yang semuanya ephemeral: dialog mana yang terbuka, alasan gagal, jumlah refund, tipe command).

**Kenapa dipakai di sini:** karena konsol ini kecil (12 halaman) tapi punya empat sumber perubahan yang independen: aksi operator, respons server, tombol Back browser, dan **jaringan yang tiba-tiba menolak token**. Sebuah `useState` tunggal tidak punya cara menjawab keempatnya. Perhatikan bukti negatifnya di repo: `PromosListPage.tsx:53` masih memakai `useState(0)` untuk page sementara empat halaman lain memakai `useListParams()`. Itu bukan gaya — itu satu halaman yang kehilangan tiga properti (share-able, refresh-safe, Back-friendly) yang dimiliki empat halaman lainnya.

**Alternatif:**
- **Semua di satu global store (Redux/Zustand), termasuk data server.** Menang: satu tempat untuk debug, DevTools menampilkan semuanya. Kalah konkret: kamu harus menulis sendiri invalidasi cache, dan `RootState` jadi berisi `deliveriesPage7Loading: boolean` — state yang seharusnya mati saat halaman unmount tapi tidak mati. Di repo ini `store.ts` sengaja tidak mendaftarkan middleware apa pun, dan itu keputusan sadar.
- **Semua di `useState` komponen** (refleks Ionic). Menang: nol konsep baru. Kalah konkret: `client.ts:116` tidak punya cara memanggil setter React dari dalam `fetch` catch — kamu butuh event emitter atau ref global, yaitu membangun ulang Redux dengan tangan.
- **TanStack Query untuk server state + Context untuk sesi.** Ini kombinasi yang paling banyak dipakai orang di 2026 dan jujur saja, untuk konsol *sekecil* ini, ia pilihan yang sangat masuk akal. Kalah pada satu titik spesifik: memanggil "logout" dari `api/client.ts` lewat Context butuh trik yang sama seperti di atas.

**Latihan:** ambil kertas, daftar sepuluh nilai yang dipegang `DeliveryDetailPage` (buka `DeliveryDetailPage.tsx:72-98`), dan untuk masing-masing tulis satu huruf: S (session), V (server), U (URL), E (ephemeral). Lalu verifikasi tebakanmu terhadap kode. Yang paling sering salah tebak: `commands` (server, bukan ephemeral) dan `cmdType` (ephemeral, meski nilainya *diturunkan* dari data server di baris 165). Kalau ada yang kamu tempatkan berbeda dari repo, tulis satu paragraf kenapa penempatanmu lebih baik — beberapa memang bisa diperdebatkan.

---

### 12.2 Redux Toolkit: `configureStore`, `RootState` di-INFER, `createSlice` + Immer, typed hooks

Kalau kamu pernah dengar "Redux itu boilerplate", yang kamu dengar adalah Redux 2018. Redux Toolkit menghapus hampir semuanya. Tapi yang penting bukan itu — yang penting adalah **kenapa Redux, dan bukan Context**, di repo yang cuma menyimpan satu objek sesi.

Mulai dari yang paling tidak biasa buat orang React: **tipenya di-infer dari store, bukan ditulis manual.**

```ts
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

Artinya, menambah slice kedua di `configureStore` otomatis memperluas `RootState` tanpa kamu menyentuh satu anotasi tipe pun. Ini kebalikan dari refleks TypeScript pemula (tulis interface dulu, implementasikan kemudian), dan lebih tahan drift.

`createSlice` memakai Immer, yang membuat reducer **terlihat** seperti mutasi:

```ts
sessionExpired(state) {
  clearToken();
  state.user = null;
  state.status = 'unauthenticated';
  state.error = null;
}
```

Itu bukan mutasi. RTK membungkus reducer dengan `produce()`, jadi kamu menulis mutasi pada sebuah *draft* dan mendapat objek baru. Kalau kamu pernah gemas menulis `{ ...state, nested: { ...state.nested, x: 1 } }` di `useReducer`, ini obatnya.

**Anchor:**
- `Drovery_Admin/src/app/store.ts:5-12` — `configureStore` dengan satu reducer, lalu dua baris `type` yang di-infer. Perhatikan: **tidak ada middleware apa pun** yang didaftarkan. Redux di sini sengaja dijaga tetap kecil.
- `Drovery_Admin/src/app/hooks.ts:5-7` — `useDispatch.withTypes<AppDispatch>()` / `useSelector.withTypes<RootState>()`. Ini API react-redux v9; kalau kamu menemukan tutorial dengan `TypedUseSelectorHook`, itu pola lama.
- `Drovery_Admin/src/features/auth/authSlice.ts:73-78` — `sessionExpired`, tempat Immer bekerja.
- `Drovery_Admin/src/api/client.ts:13-14` + `:116` — argumen terkuatnya: *"Registered by the app so a 401 anywhere can drive a global logout/redirect without the client importing the Redux store (avoids a circular dependency)."* Lalu di `:116`, `unauthorizedHandler?.()` dipanggil **dari dalam `apiFetch`**, jauh dari React.
- Konsumen: `ProtectedRoute.tsx:15`, `AppLayout.tsx:29`, `RequireRole.tsx:20`.

**Kenapa dipakai di sini:** tiga sifat sesi auth membuatnya kandidat sempurna untuk store global, dan sifat ketiga adalah yang biasanya terlewat. (a) Dibaca oleh komponen yang tersebar dan tidak sekeluarga. (b) Perlu di-*preload* untuk test — `renderWithProviders.tsx:28-31` membangun store baru per-test dengan `preloadedState`, jadi setiap test halaman bisa "sudah login" tanpa mensimulasikan login. (c) **Ditulis dari luar React.** Dengan Context, memanggil setter dari `api/client.ts` butuh trik (ref global / event emitter). Dengan Redux, `store.dispatch` adalah fungsi biasa yang bisa dipanggil dari mana saja — dan repo ini bahkan tidak melakukannya langsung: ia mendaftarkan callback (`setUnauthorizedHandler`) supaya `client.ts` tidak perlu meng-import store sama sekali.

Dan aku harus jujur: **untuk *hanya* auth, Context sebenarnya pilihan yang sangat masuk akal, dan RTK di sini agak berlebih.** Repo mobile membuktikannya — `Drovery_Mobile/contexts/AuthContext.tsx` menyelesaikan masalah yang sama dengan Context + `useState`, dan masalah "dipanggil dari luar React" diselesaikan dengan callback registry `setOnLogout` (`Drovery_Mobile/services/api/apiClient.ts:33-35`). Dua repo, satu masalah, dua jawaban, keduanya benar.

Letakkan keduanya bersebelahan dan strukturnya identik — yang berbeda cuma siapa yang memegang state di ujung callback:

```
admin:   apiFetch (401) → unauthorizedHandler?.()   → App.tsx: dispatch(sessionExpired())
mobile:  request  (401) → onLogout?.()              → AuthContext: logout()  [useState]
```

Dua-duanya membalik arah dependensi lewat sebuah **registry callback**, supaya modul HTTP tidak perlu meng-import modul state. Kamu akan bertemu bentuk yang persis sama di backend saat Nest meng-inject provider — hanya saja di sana pendaftarannya dilakukan container, bukan oleh sebuah `useEffect`. Bandingkan ketiganya dan kamu akan mengerti dependency injection lebih dalam daripada dari tutorial mana pun.

**Alternatif:**
- **React Context + `useReducer`** — nol dependency. Kalah konkret: setiap perubahan context me-rerender **semua** consumer (tidak ada selector granular), dan tidak ada DevTools time-travel. Untuk `AuthContext` mobile yang value-nya berubah 2-3 kali seumur sesi, kerugian rerender itu nol; untuk store yang berubah tiap detik, ia mahal.
- **Zustand** (~1 KB) — `useStore(s => s.user)` sudah granular tanpa provider, dan `store.getState()`/`setState()` bisa dipanggil dari luar React, jadi ia menyelesaikan poin (c) dengan cara yang sama. Kalah: DevTools kurang kaya, dan konvensinya lebih longgar sehingga di tim besar gampang berantakan.
- **RTK Query** — sudah ikut terpasang di `@reduxjs/toolkit`, jadi nol dependency baru; ia akan menghapus `useApi`, `useMutation`, dan semua `refetch()` manual. Kalah: kurva `createApi`/`tagTypes` lebih curam daripada 37 baris `useApi.ts`, dan cache-nya justru **tidak diinginkan** di konsol yang datanya harus selalu segar.

**Latihan:** tambahkan slice kedua `uiSlice` dengan satu field `sidebarCollapsed: boolean` + action `toggleSidebar`. Daftarkan di `store.ts`, konsumsi di `AppLayout.tsx` untuk menyempitkan `DRAWER_WIDTH` (`AppLayout.tsx:22`). Lalu **buktikan typed hooks bekerja**: ketik `useAppSelector((s) => s.ui.sidebarColapsed)` dengan typo sengaja dan lihat TypeScript menolaknya, padahal kamu tidak menulis satu anotasi tipe pun. Cara verifikasi: `npm run build` harus gagal dengan pesan yang menyebut `sidebarColapsed`.

---

### 12.3 `createAsyncThunk` + siklus sesi: single-flight refresh dan reload yang tidak berkedip

Ini bagian paling padat di admin, dan ia memecahkan dua masalah yang kelihatannya kecil sampai kamu jadi operator yang sedang menangani antrean.

**Masalah pertama: reload halaman berkedip ke `/login`.** Kalau initial state Redux adalah "belum login" dan baru diperbaiki setelah `GET /users/me` selesai, maka setiap `F5` membuat operator melihat form login selama setengah detik sebelum dilempar balik. Jawabannya ada di satu baris:

```ts
status: getToken() ? 'loading' : 'unauthenticated',
```

Initial state **membaca `localStorage` secara sinkron**. Kalau ada token, status langsung `'loading'`, dan `ProtectedRoute` merender spinner, bukan redirect. Ini ide yang sama persis dengan `isLoading: true` di `Drovery_Mobile/contexts/AuthContext.tsx:25` — aplikasi harus bisa membedakan "belum tahu apakah user login" dari "sudah tahu bahwa user tidak login". Dua repo, satu pelajaran.

**Masalah kedua: refresh token yang dirotasi + request paralel.** `DeliveryDetailPage` menembakkan **dua** `useApi` bersamaan (`DeliveryDetailPage.tsx:76-86`). Kalau access token kedaluwarsa, keduanya kena 401 pada saat yang sama. Tanpa perlindungan, keduanya akan memanggil `/auth/refresh` — dan karena backend **merotasi** refresh token, panggilan kedua memakai token yang sudah dibakar panggilan pertama → gagal → sesi mati, padahal seharusnya hidup. Jawabannya adalah **single-flight**:

```ts
// Single-flight refresh: a burst of concurrent 401s triggers exactly ONE /auth/refresh, and
// every caller awaits the same result.
let refreshInFlight: Promise<boolean> | null = null;
```

Satu promise dibagi ke semua pemanggil. Yang datang belakangan me-`await` promise yang sama, bukan membuat request baru.

Padanan dari duniamu: ini adalah pola yang persis sama dengan "jangan panggil `Camera.getPhoto()` dua kali kalau user tap dobel" — hanya saja di sini biayanya bukan dua dialog, melainkan sesi yang mati.

**Masalah ketiga, dan ini yang paling sering salah dipahami: 401 tidak selalu berarti "sesi habis".** Repo mobile menemukannya lebih dulu. Endpoint `POST /deliveries/:id/confirm-handoff` menerima kode 6 digit dari penerima paket; kode yang salah dijawab `401`. Kalau interceptor memperlakukan semua `401` sebagai token kedaluwarsa, maka salah ketik satu digit akan memicu refresh, gagal, lalu **melempar pelanggan keluar dari aplikasi** — di depan kurir, sambil memegang paket. Jawabannya adalah flag per-request:

```ts
confirmHandoff(id: string, code: string) {
  return api.post<ApiDelivery>(`/deliveries/${id}/confirm-handoff`, { code },
    { noAuthRetry: true });
}
```

Admin menyelesaikan varian masalah yang sama dengan cara berbeda: di sana `path.startsWith('/auth/')` diperlakukan **terminal** — sebuah `401` pada `/auth/login` berarti password salah, bukan sesi habis, jadi jangan pernah coba di-refresh. Dua repo, dua bentuk aturan yang sama: **kamu harus mendeklarasikan endpoint mana yang boleh menjawab 401 sebagai jawaban domain.** Kalau fitur capstone-mu punya endpoint semacam itu, ini keputusan yang harus kamu ambil sadar dan catat.

**Anchor:**
- `Drovery_Admin/src/features/auth/authSlice.ts:24-29` — initial state yang membaca token sinkron.
- `Drovery_Admin/src/features/auth/authSlice.ts:34-53` — thunk `login`: POST `/auth/login` → `setTokens(...)` → **lalu** `GET /users/me`. Komentar di `:34-36` menjelaskan kenapa dua request: response login tidak memuat `role`, padahal `role` yang menentukan seluruh navigasi.
- `Drovery_Admin/src/features/auth/authSlice.ts:83-107` — `extraReducers` menangani `pending`/`fulfilled`/`rejected` dari dua thunk. Tiga action untuk satu thunk adalah inti `createAsyncThunk`.
- `Drovery_Admin/src/features/auth/authSlice.ts:113-132` — `logout`: revoke refresh token di server (best-effort), lalu `dispatch(sessionExpired())`. Komentarnya: *"a failed revoke still clears the client."* Bandingkan dengan `Drovery_Mobile/contexts/AuthContext.tsx:28-40` yang identik semangatnya (*"logout must succeed locally regardless"*).
- `Drovery_Admin/src/api/client.ts:48-74` — single-flight refresh.
- `Drovery_Admin/src/api/client.ts:102-118` — kebijakan 401: `/auth/*` bersifat terminal (tidak di-refresh), selain itu refresh sekali lalu retry; parameter `retry` mencegah loop tak berujung.
- Sejarahnya: commit `67b62ff fix(auth): transparent session refresh + server-side logout revoke`.

**Kenapa dipakai di sini:** masalahnya konkret dan operasional. Access token berumur pendek; tanpa refresh transparan, operator yang sedang menangani antrean delivery gagal akan **dilempar ke `/login` di tengah kerja**. Dan sekarang perhatikan varian yang lebih halus di mobile: `Drovery_Mobile/services/api/apiClient.ts:10-13` menambahkan flag `noAuthRetry`, dengan alasan yang wajib kamu ingat: *"For endpoints where a 401 is a legitimate domain outcome, e.g. a wrong handoff code on /confirm-handoff."* Artinya, **401 tidak selalu berarti "sesi habis"**. Tanpa flag itu, salah ketik kode handoff 6 digit akan melempar pelanggan keluar dari aplikasi (`Drovery_Mobile/features/delivery/services/deliveryApi.ts:22-31`).

**Alternatif:**
- **Thunk manual (`redux-thunk` polos)** — kamu menulis sendiri tiga action type + tiga dispatch. `createAsyncThunk` menghasilkannya otomatis dan memberi `rejectWithValue` (dipakai di `authSlice.ts:51,64`) supaya pesan error backend sampai ke UI. Kalah cuma di volume kode, tapi volumenya nyata: 3 thunk × ~15 baris.
- **Token di cookie `httpOnly`** — lebih aman terhadap XSS karena JS tidak bisa membaca token. Trade-off konkret di repo ini: WebSocket-nya mengirim token lewat query string, dan itu mustahil kalau token tidak terbaca JS; plus cookie cross-origin butuh `SameSite=None; Secure` + CORS `credentials`.
- **Refresh proaktif berdasarkan `exp` di JWT** (dekode token, refresh sebelum kedaluwarsa) — menghindari 401 sama sekali. Kalah: butuh parsing JWT di klien, dan kamu **tetap** butuh jalur reaktif untuk token yang dicabut server lebih awal. Jadi ia menambah kode tanpa menghapus kode.

**Latihan:** tulis `Drovery_Admin/src/api/client.test.ts` yang membuktikan single-flight. Mock `globalThis.fetch` supaya endpoint biasa mengembalikan 401 sekali lalu 200, dan `/auth/refresh` mengembalikan pasangan token baru. Tembakkan **tiga** `apiFetch` bersamaan lewat `Promise.all`, lalu assert `/auth/refresh` dipanggil **tepat sekali** dan ketiga promise resolve. Setelah hijau, **hapus sementara** guard `if (!refreshInFlight)` di `client.ts:107` dan jalankan lagi — test harus merah. Itu penjelasan terbaik kenapa guard-nya ada. (Test ini belum ada di repo; ia menjaga invariant paling rapuh di seluruh lapisan auth.)

---

### 12.4 react-router 7 data router + `NAV_ITEMS` sebagai SATU sumber kebenaran

Kalau kamu terbiasa dengan `IonRouterOutlet` dan route sebagai JSX, bentuk di sini akan terasa asing selama sepuluh menit lalu masuk akal selamanya: **tabel rute adalah data, bukan JSX.**

```ts
export const router = createBrowserRouter([
  { path: '/login', element: withSuspense(<LoginPage />) },
  {
    element: <ProtectedRoute />,          // ← layout route: TANPA path
    children: [ /* semua rute terlindungi */ ],
  },
  { path: '*', element: withSuspense(<NotFoundPage />) },
]);
```

Objek tanpa `path` itu adalah **layout route**: rute yang tidak mencocokkan URL, hanya membungkus. Konsekuensinya besar: `ProtectedRoute` dievaluasi **sekali** untuk seluruh subtree, dan `AppLayout` (shell + sidebar) tetap ter-mount saat berpindah halaman — hanya `<Outlet />` yang berganti. Komentar di `router.tsx:9-11` menyebut hasilnya: *"protected pages load with the nav still visible."*

Perhatikan juga strategi Suspense-nya, karena ia langsung mengikuti bentuk rutenya. Sepuluh halaman di-`lazy()` (satu chunk per rute), tapi **boundary**-nya berbeda tergantung apakah rute itu punya shell bersama: rute di dalam `AppLayout` berbagi satu `<Suspense>` yang dipasang di sekitar `<Outlet />`, sementara `/login` dan `*` — yang hidup di luar shell — masing-masing dibungkus `withSuspense()` sendiri. Kalau kamu memasang `Suspense` di tempat yang salah, gejalanya spesifik: seluruh sidebar ikut hilang saat berpindah halaman.

Dua guard, dua pertanyaan berbeda. `ProtectedRoute` menjawab **"apakah ada sesi staff?"** dan punya empat keluaran: `loading` → spinner; `unauthenticated` → `<Navigate to="/login" replace />`; role `USER` → layar "This console is for staff only" + tombol Sign out; selain itu → `<AppLayout />`. Kasus ketiga itu detail yang bagus: melempar orang yang **sudah** login ke `/login` akan membingungkan, jadi ia dapat penjelasan, bukan redirect. `RequireRole` menjawab pertanyaan kedua — **"boleh masuk halaman INI?"** — per rute.

Tapi pelajaran arsitektur terbaik di repo ini bukan itu. Ia ada di `navItems.tsx`, dan ia **bukan** tentang keamanan.

**Anchor:**
- `Drovery_Admin/src/router/router.tsx:40-55` — layout route + children.
- `Drovery_Admin/src/router/router.tsx:9-11` + `:12-27` + `:29-32` — komentar strategi Suspense, sepuluh `lazy(() => import(...))`, dan `withSuspense()` untuk rute di luar `AppLayout`.
- `Drovery_Admin/src/layout/ProtectedRoute.tsx:8-12` — docstring yang menyebut keempat keadaan itu, berurutan.
- `Drovery_Admin/src/router/router.tsx:43-45` — komentar yang menutup lingkaran: *"Allowed roles come from NAV_ITEMS, so the sidebar and the guards cannot disagree."*
- `Drovery_Admin/src/layout/AppLayout.tsx:103-105` — `<Suspense fallback={<PageLoader />}><Outlet /></Suspense>`, lubang tempat child route dirender.
- `Drovery_Admin/src/layout/navItems.tsx:18-28` — docstring: *"Deriving both from this list means a new page cannot appear in the nav without a guard, or be guarded differently from how it is advertised."*
- `Drovery_Admin/src/layout/navItems.tsx:59-65` — `rolesForPath`, **urut dari path terpanjang**, dengan komentar *"so '/deliveries/:id' resolves to '/deliveries', not '/'."*
- `Drovery_Admin/src/layout/RequireRole.tsx:7-18` — docstring paling informatif di repo: *"Without it every authenticated user landed on `/` — the ADMIN-only Dashboard — so an AGENT signing in to work support tickets hit a permanent 403 with nothing in their sidebar to explain it. Rather than showing them an error, send them where they can actually work."*
- `Drovery_Admin/src/layout/RequireRole.tsx:23` — `if (!user) return null; // ProtectedRoute owns the unauthenticated case.` Batas tanggung jawab ditulis eksplisit.
- `Drovery_Admin/src/layout/ProtectedRoute.tsx:35-49` — kasus role `USER`: **bukan** redirect, melainkan layar penjelasan + tombol Sign out. Melempar ke `/login` akan membingungkan orang yang *sudah* login.
- Sejarahnya di git: `d0eb80a` → `a4195b2` → `042841a fix(nav): guard every protected route` → `8a271e1`.

**Kenapa dipakai di sini:** `README.md:39-40` tegas — *"The authoritative gate is always the backend `RolesGuard` — the UI role only decides which nav to render."* Guard di klien murni **UX**: mencegah operator mendarat di halaman yang pasti 403. Nilai desain `NAV_ITEMS` adalah menghapus satu **kelas** bug, bukan satu bug: sebelumnya nav difilter per-role tapi rute tidak dijaga, sehingga keduanya bisa (dan memang) menyimpang. Dengan satu daftar, "mendaftarkan halaman ke sidebar" **adalah** "menjaga rutenya". Buktinya ada di test `navItems.test.ts:27-32`: *"The nav entry and the route guard come from the same list, so adding the page to the sidebar is what guarded it."*

Bandingkan dengan versi mobile dari masalah yang sama: `Drovery_Mobile/app/_layout.tsx:40-41` menuliskan aturannya dalam satu kalimat — *"when auth state and the current route disagree, the route moves."* Dua repo, dua mekanisme (satu daftar rute vs satu daftar segmen publik), satu prinsip.

**Alternatif:**
- **Guard di dalam tiap halaman** (`if (user.role !== 'ADMIN') return <Forbidden/>`) — mudah dilupakan saat menambah halaman. Ini persis bug yang di-fix commit `042841a`, jadi bukan hipotesis.
- **HOC `withRole(Component, ['ADMIN'])`** — setara secara fungsi, tapi daftar role tersebar di 8 file alih-alih 1, sehingga nav dan guard bisa menyimpang lagi. Kamu menukar satu file yang membosankan dengan delapan file yang bisa berbeda pendapat.
- **`loader` react-router + `redirect()`** — guard berjalan **sebelum** komponen dirender, jadi tidak ada kedip render-lalu-redirect. Trade-off konkret: loader tidak bisa membaca Redux dengan mudah; ia harus membaca `store.getState()` langsung, yang memutus decoupling yang sengaja dibangun di `client.ts:13-14`.
- **Middleware server (Next.js)** — guard jalan di edge, HTML halaman terlarang **tidak pernah terkirim**. Ini keunggulan struktural yang tidak bisa ditiru SPA, dan ia jadi salah satu argumen utama Fase 13.

**Latihan:** tambahkan role keempat `'SUPPORT_LEAD'` ke `Drovery_Admin/src/models/enums.ts:4-6`, beri akses `/support` **dan** `/users` di `NAV_ITEMS`, lalu jalankan `npx vitest run`. Test `navItems.test.ts:48-52` (*"never sends a role to a page it cannot open"*) akan mem-verifikasi invariant-nya secara otomatis — **tanpa kamu menulis test baru**, karena test itu di-loop atas semua role. Verifikasi: tambahkan role kelima yang **tidak** punya entri nav sama sekali dan pastikan test itu jadi merah. Lalu kembalikan semuanya.

---

### 12.5 `useApi`, `useMutation`, `ConfirmDialog` — dan bug `d67ac40` sebagai argumen terkuat untuk TanStack Query

`useApi` adalah 37 baris. Bacalah utuh sekali; ia mengajarkan lebih banyak tentang `useEffect` daripada dokumentasi React.

```ts
useEffect(() => {
  let active = true;
  setLoading(true); setError(null);
  apiFetch<T>(path)
    .then((result) => { if (active) { setData(result); setLoading(false); } })
    .catch((e) => { if (active) { setError(...); setLoading(false); } });
  return () => { active = false; };
}, [path, tick]);
```

Dua trik yang perlu kamu kuasai. **Pertama, `path` sebagai cache key.** Halaman tidak pernah memanggil `refetch()` saat ganti halaman atau filter — mereka cukup mengubah string path, dan `[path, tick]` di dependency array yang mengurus sisanya (`DeliveriesListPage.tsx:43-45`). **Kedua, flag `active`.** Kalau `path` berubah sebelum request lama selesai, response lama **tidak boleh** menimpa yang baru. Ini race condition klasik yang di app Ionic biasanya baru ketahuan saat user mengetik cepat di search box.

`useMutation` punya satu keputusan kontrak yang mengubah semua callsite:

> *"`run` resolves to the result, or `undefined` if the call threw (the error is captured, never rethrown), so callers can branch on the result without a try/catch."*

Hasilnya, seluruh aksi destruktif jadi satu baris: `if (await cancelM.run(d.id)) refresh();`. Tanpa `try/catch`, tanpa `.catch()`.

**Anchor:**
- `Drovery_Admin/src/hooks/useApi.ts:22-46` — effect lengkap dengan `active` + cleanup; `:24-29` menjelaskan kenapa `eslint-disable react-hooks/set-state-in-effect` ada di sana (reset ke loading saat key berubah memang disengaja).
- `Drovery_Admin/src/hooks/useApi.ts:18,20` — `tick` + `refetch = () => setTick(t => t + 1)`: memaksa effect jalan ulang lewat state dummy.
- `Drovery_Admin/src/pages/Dashboard/DashboardPage.tsx:48-67` — pola render bertingkat: error (dengan tombol Retry) → `loading && !data` spinner → `data &&` konten. Perhatikan `!data`: saat **re**fetch, data lama tetap tampil, jadi layar tidak berkedip kosong.
- `Drovery_Admin/src/hooks/useMutation.ts:12-16` — docstring kontraknya.
- `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx:95-98` — **empat** mutation berdampingan, masing-masing punya `loading`/`error` sendiri.
- `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx:154-169` — `openDialog()` me-`reset()` semua mutation dulu, supaya error dari aksi sebelumnya tidak nyangkut di dialog berikutnya. Dan `:161-166` — default command dipilih dari `actions.canReturnToBase`, dengan komentar *"so confirming without touching the dropdown can't send a guaranteed-409 request."*
- `Drovery_Admin/src/components/ConfirmDialog.tsx:45` — `onClose={loading ? undefined : onClose}`: dialog tidak bisa ditutup saat request berjalan. Dan `:71` — label berubah jadi `'Working…'`, tombol Cancel ikut disabled. Ini mencegah double-submit ke endpoint yang idempotensinya bergantung backend.
- **Bug `d67ac40`** — `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx:140-143`, layak dibaca utuh:
  > *"The header button used to call `refetch` alone, which reloads the delivery but NOT the drone command history — so a dispatcher watching for an ABORT ack saw PENDING forever and issued a second command to an aircraft that had already obeyed the first."*

**Kenapa dipakai di sini:** konsol ini **hampir tidak butuh cache**. Datanya operasional dan berubah tiap detik; setiap halaman punya tombol Refresh eksplisit karena operator *ingin* menarik data terbaru secara sadar. Fitur unggulan react-query — `staleTime`, background refetch, cache — di sini bernilai rendah atau malah berbahaya (menampilkan status delivery basi ke orang yang mengendalikan pesawat).

Tapi yang **hilang** karena tidak pakai library juga nyata, dan repo ini tidak menyembunyikannya. Tidak ada dedup: `DeliveryDetailPage` menembakkan dua request tiap mount tanpa berbagi apa pun. Tidak ada retry otomatis. Tidak ada refetch-on-window-focus. Dan yang paling mahal: **invalidasi manual dan rawan lupa**. Bug `d67ac40` adalah bukti terkuatnya. Halaman itu punya dua `useApi`; tombol Refresh cuma memanggil satu. Dengan `invalidateQueries(['delivery', id])`, **kelas** bug ini tidak bisa terjadi — bukan karena programmer-nya ingat, tapi karena strukturnya tidak mengizinkan. Ini contoh sempurna dari perbedaan "bug yang diperbaiki" dan "kelas bug yang dihapus", dan kamu akan menemui perbedaan itu lagi di §12.11.

**Alternatif:**
- **TanStack Query** — `useQuery({ queryKey, queryFn })` menggantikan `useApi` nyaris 1:1, plus cache, dedup, retry, dan `invalidateQueries` yang menghapus kelas bug di atas. Biaya konkret: ~13 KB, satu `QueryClientProvider` lagi di `main.tsx`, dan `renderWithProviders` harus membungkus `QueryClientProvider` dengan `retry: false` supaya test tidak menunggu 3 kali retry. Untuk konsol sebesar ini, ini upgrade yang paling layak.
- **SWR** — lebih kecil (~4 KB), API `useSWR(key, fetcher)` sangat mirip `useApi`. Kalah di mutasi/invalidasi terstruktur, yang justru masalah di repo ini.
- **`useEffect` + `useState` telanjang di tiap halaman** — apa yang digantikan `useApi`. Artinya 9 salinan logika cleanup/race yang sama, dan cukup satu salinan yang lupa `active` untuk mengembalikan race condition-nya.
- **Toast/snackbar global untuk error mutasi** (mis. `notistack`) — lebih ringkas. Kalah untuk aksi destruktif: error yang menempel **di dalam dialog** membuat operator tetap melihat konteksnya dan bisa langsung memperbaiki input, sementara toast menghilang setelah 4 detik.

**Latihan:** port **satu** halaman — `DeliveryDetailPage` — ke TanStack Query: dua `useQuery` dan `queryClient.invalidateQueries` di keempat mutasi. Hapus `refreshAll()` (`DeliveryDetailPage.tsx:144-147`). Verifikasi dua hal: (1) test `DeliveryDetailPage.test.tsx` tetap hijau setelah `renderWithProviders` dibungkus `QueryClientProvider`; (2) tunjukkan — dengan menghapus satu invalidasi lalu menjalankan ulang test — bahwa bug `d67ac40` sekarang **ditangkap oleh test**, bukan oleh ingatan. Kalau tidak ada test yang merah, kamu baru menemukan lubang test.

---

### 12.6 URL sebagai state: `useListParams`

Ini bukan preferensi gaya. Ini bug report yang ditulis ulang sebagai kode, dan docstring-nya menyebut tiga kerugian konkret:

> *"It used to be `useState` — `useSearchParams` appeared nowhere in the console — so an operator working a failed-delivery queue restarted from page 1 unfiltered after every single record they opened, a refresh lost their place, and nobody could share a link to 'the failed queue, page 3'."*

Untuk konsol operator, ketiganya adalah **kegagalan alur kerja**, bukan ketidaknyamanan kecil.

Padanan dari duniamu: kalau kamu pernah membuat halaman list di Ionic dan user mengeluh "kenapa tiap balik dari detail, filternya hilang?", ini jawabannya — dan jawabannya bukan `sessionStorage`.

Yang membuat pola ini bekerja tanpa satu pun `useEffect` di halaman adalah cara ia disambung ke `useApi`:

```ts
const { page, q, filter, setPage, setQ, setFilter } = useListParams();
const status = filter as DeliveryStatus | '';
const { data, loading, error, refetch } = useApi<Paginated<AdminDelivery>>(
  `/admin/deliveries?${toQueryString(page, LIMIT, q, 'status', status)}`,
);
```

URL berubah → `useListParams` mengembalikan nilai baru → string path berubah → dependency `useApi` berubah → fetch jalan. Tidak ada state ketiga, tidak ada sinkronisasi manual, tidak ada `useEffect(() => { fetch() }, [page, q, filter])` yang bisa lupa satu dependency. Perhatikan juga `toQueryString()` sengaja dibuat **standalone** (bukan bagian dari hook) supaya halaman bisa memanggilnya inline di dalam template literal — dan supaya ia bisa diuji sendiri.

Satu jebakan yang pasti kamu temui: **URL 1-based, state 0-based.** URL menulis `?page=3` karena itu yang dibaca manusia dan dibagikan; `TablePagination` MUI menghitung dari 0. Konversinya ada di dua tempat (`useListParams.ts:45` saat membaca, `:66` saat menulis), dan salah satu arah yang lupa dikonversi menghasilkan off-by-one yang cuma terlihat di halaman kedua.

**Anchor:**
- `Drovery_Admin/src/hooks/useListParams.ts:4-14` — docstring dengan tiga kerugian di atas, plus alasan reset page.
- `Drovery_Admin/src/hooks/useListParams.ts:45` — `const page = Math.max(0, Number(sp.get('page') ?? '1') - 1);` URL 1-based (ramah manusia), state 0-based (yang diminta `TablePagination` MUI). Detail kecil yang gampang salah.
- `Drovery_Admin/src/hooks/useListParams.ts:56-57` — `setSp(merged, { replace: true })` dengan komentar *"paging and typing should not each add a browser-history entry."* Tanpa `replace`, satu sesi filter menghasilkan 30 entri history dan tombol Back jadi tidak berguna.
- `Drovery_Admin/src/hooks/useListParams.ts:67-68` — `setQ`/`setFilter` **mereset page ke kosong**; docstring `:12-13` menjelaskan: *"staying on page 7 of a result set that no longer has seven pages shows an empty table and looks like a bug."*
- `Drovery_Admin/src/hooks/useListParams.ts:26-40` — `toQueryString()` sengaja standalone, dipanggil inline oleh halaman untuk membentuk key `useApi`.
- `Drovery_Admin/src/components/SearchField.tsx:5-9` — debounce: *"a five-character tracking id is one query rather than five."*
- `Drovery_Admin/src/components/SearchField.tsx:24-31` — pola **"adjust state during render"**: `if (value !== lastValue) { setLastValue(value); setDraft(value); }`. Komentarnya menjelaskan kenapa bukan `useEffect`: *"setState inside an effect triggers a second render pass, and the lint rule that flags it is right to."* Ini pola resmi React untuk derived state dan wajib kamu kuasai.
- Git: `2a70ffe feat(admin): hold list page, filter and search in the URL`, `8083fae feat(admin): debounced search input`.

**Kenapa dipakai di sini:** ia bersinergi langsung dengan `useApi`. Karena key `useApi` **adalah** path lengkap beserta query string, mengubah URL otomatis memicu fetch — tidak ada state ketiga yang harus disinkronkan. Perhatikan bahwa `page`, `q`, dan `filter` **tidak pernah** disimpan di `useState` halaman mana pun (kecuali `PromosListPage`, yang belum dimigrasi). URL adalah satu-satunya sumber. Dan `SearchField` menunjukkan pembagian yang tepat: ketikan tetap di state lokal (responsif, tiap keystroke) sementara URL hanya menerima nilai yang sudah "berhenti" setelah 300 ms.

**Alternatif:**
- **`useState` di komponen halaman** — apa yang masih dipakai `PromosListPage.tsx:53`. Paling sederhana, dan kalah tepat pada tiga hal di docstring. Kamu bisa mengukurnya: buka `/promos`, pindah ke halaman 2, tekan `F5`, lihat kamu kembali ke halaman 1.
- **Simpan di Redux/Zustand** — bertahan saat navigasi dalam-app, tapi tetap hilang saat refresh dan tetap tidak bisa di-share. Menambah state global untuk sesuatu yang sudah punya tempat alami.
- **`sessionStorage`** — bertahan saat refresh, tapi tidak bisa di-share dan tidak sinkron dengan tombol Back. Kamu menyelesaikan satu dari tiga masalah dengan menambah satu sumber kebenaran.
- **`nuqs`** — library type-safe untuk search params (parser + serializer per-key); ia menghapus cast manual `filter as DeliveryStatus | ''` di `DeliveriesListPage.tsx:41`. Biaya: satu dependency lagi untuk hook 70 baris.
- **`useDeferredValue` untuk debounce** — tidak butuh timer, tapi ia menunda **render**, bukan **request**; kamu tetap dapat satu request per keystroke. Salah alat di sini, dan ini contoh bagus bahwa "hook baru" ≠ "pengganti".

**Latihan:** migrasikan `PromosListPage.tsx:53` dari `useState(0)` ke `useListParams()`. Perhatikan blok `submit` (`PromosListPage.tsx:81-94`) yang mengandung komentar cerdik *"setPage changes the useApi key → refetch; only refetch explicitly when already on page 0"* — pastikan logika itu tetap benar setelah page pindah ke URL. Verifikasi: tulis test yang me-render dengan `initialEntries: ['/promos?page=2']` dan meng-assert `apiFetch` dipanggil dengan `page=3` (URL 1-based → API 1-based, state 0-based di tengah). Kalau kamu salah off-by-one, test ini yang akan memberitahumu.

---

### 12.7 Invariant domain sebagai fungsi murni di klien: `deliveryActions`

Ini konsep yang paling berharga untuk dibawa ke semua proyekmu setelah ini, dan ia bisa diringkas jadi satu aturan:

> **Duplikasi aturan bisnis di klien hanya aman kalau ia CERMIN, bukan PENJAGA.**

`deliveryActions()` adalah fungsi murni `AdminDelivery → DeliveryActions`. Tanpa React, tanpa fetch, tanpa state. Ia menduplikasi gating CAS backend — dan repo ini **mengakuinya secara tertulis** di docstring:

> *"Which operator actions to ENABLE for a delivery, mirroring the backend CAS gating (src/deliveries/delivery-exceptions.ts + commands/command.constants.ts). The server is still authoritative — these only keep the UI from offering an action it would obviously reject."*

Kenapa duplikasi ini boleh, padahal duplikasi biasanya dosa? Karena **kalau cermin ini basi, yang terjadi paling buruk adalah**: tombol yang seharusnya aktif jadi mati, atau request yang pasti ditolak terkirim dan `409`-nya tampil di dialog. **Bukan** operasi ilegal yang lolos. Bandingkan dengan `RolesGuard` backend, di mana cermin yang basi berarti lubang keamanan.

Pola yang sama muncul sekali lagi di validasi form, dan bentuknya layak ditiru: `validatePromoForm(form, mode)` mengembalikan **objek error, bukan boolean**. Halaman menghitungnya tiap render dan memakai `disabled={loading || hasErrors}`, jadi tidak ada state validasi yang bisa basi. Dua sifat aturan itu menjelaskan kenapa ia ditulis tangan alih-alih memakai schema library: ia **kondisional per-mode** (`code` wajib hanya saat `mode === 'create'`) dan **antar-field** (`endsAt` harus setelah `startsAt`). Ada juga aturan halus yang cuma bisa diketahui dari API: pada `buildUpdateBody`, field numerik/tanggal yang kosong **dihilangkan dari body**, karena API tidak bisa meng-`null`-kan field — jadi "kosong" berarti "pertahankan nilai sekarang", bukan "hapus".

**Anchor:**
- `Drovery_Admin/src/features/deliveries/deliveryActions.ts:20-26` — docstring inti di atas.
- `Drovery_Admin/src/features/deliveries/deliveryActions.ts:27-43` — implementasinya, 17 baris, nol React.
- `Drovery_Admin/src/models/enums.ts:82-105` — konstanta yang dicerminkan: `TERMINAL_STATUSES`, `FAILABLE_STATUSES`, `RETURNABLE_STATUSES`, masing-masing dengan komentar yang **menunjuk file backend sumbernya**.
- `Drovery_Admin/src/models/enums.ts:99-100` — nuansa yang mudah salah: *"RETURN_TO_BASE is legal on a NARROWER set than ABORT (which is failable) ... excludes DRONE_ASSIGNED + RETURNING."*
- `Drovery_Admin/src/features/deliveries/deliveryActions.ts:39-42` — `canRefund` justru **longgar**, dengan alasan tertulis: refund backend adalah goodwill wallet credit yang diizinkan terlepas dari status pembayaran; satu-satunya penjaga keras adalah idempotensi.
- `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx:382` — kalimat yang menutup panel aksi di UI: *"Actions are gated by the delivery's status; the server makes the final call."* Ditulis **untuk operator**, bukan untuk developer.
- `Drovery_Admin/src/features/promos/promoForm.ts:8` — *"All numeric/date fields are strings while editing (TextField values); parsed on submit."*
- `Drovery_Admin/src/features/promos/promoForm.ts:69-106` — `validatePromoForm` yang mengembalikan objek error; `:75-79` aturan kondisional per-mode, `:101-103` aturan antar-field.
- `Drovery_Admin/src/features/promos/promoForm.ts:127-129` — *"the API can't null them, so blank means 'keep current value'."*
- Sisi mobile dari masalah yang sama, dan versinya yang lebih rapuh: `Drovery_Mobile/features/delivery/screens/CreateDeliveryScreen/validators.ts:8-9` — *"Mirrors the backend's MAX_WEIGHT_KG (src/common/constants/index.ts). Kept in sync by hand today — if these ever diverge, the server rejects what this form allowed."*

**Kenapa dipakai di sini:** pemisahan ini membuat logika paling rumit di konsol bisa **diuji tanpa merender apa pun**. `deliveryActions.test.ts` menguji legalitas per-command dalam beberapa puluh baris; melakukannya lewat render dialog MUI butuh 2-3× lebih banyak baris dan puluhan detik. Dan efeknya bukan cuma kecepatan test: karena aturannya hidup di satu fungsi, `DeliveryDetailPage.tsx:165` bisa memakai `actions.canReturnToBase` untuk memilih default dropdown — satu invariant, dua pemakaian, nol duplikasi di dalam repo klien.

**Alternatif:**
- **Logika di dalam komponen** (`disabled={d.status !== 'IN_TRANSIT' && ...}`) — apa yang biasa terjadi. Hasilnya kondisi 4 baris di JSX yang hanya bisa diuji lewat render, dan yang tidak bisa dipakai ulang untuk memilih default dropdown.
- **Bagikan konstanta lewat package npm bersama** (`@drovery/contracts`) — menghapus risiko cermin basi **seluruhnya**, karena hanya ada satu definisi. Biaya konkret: butuh monorepo atau registry privat; ketiga repo Drovery saat ini terpisah, dan mengubahnya berarti mengubah alur rilis tiga repo.
- **Generate dari OpenAPI** (`openapi-typescript`) — tipe DTO selalu sinkron. Kalah untuk kasus **ini**: `FAILABLE_STATUSES` bukan bagian dari tipe response, ia aturan transisi. OpenAPI tidak mengekspornya, jadi ia menyelesaikan drift tipe tapi bukan drift aturan.
- **Tidak menduplikasi sama sekali** (semua tombol selalu aktif, biarkan server menolak) — paling jujur secara arsitektur, nol risiko cermin basi. Kalah di UX yang bisa diukur: operator baru tahu aksinya ilegal **setelah** mengonfirmasi dialog, dan untuk aksi bernama "Force cancel" itu detik-detik yang menegangkan.
- **Zod / Yup / Valibot** untuk bagian validasi form — schema deklaratif + inferensi tipe + pesan error otomatis. Menang telak di form besar dengan aturan per-field yang independen. Kalah di `promoForm` yang **kondisional per-mode** dan **antar-field**: di Zod keduanya berarti `superRefine`, yang tidak lebih ringkas dari ~35 baris `if` yang sudah ada — kamu menambah satu dependency dan satu konsep untuk hasil yang sama panjangnya.
- **React Hook Form** — mengelola state form + validasi + `isDirty`/`isValid`, menghapus `PromoFormState` dan seluruh setter-nya. Trade-off konkret: RHF memakai uncontrolled input demi performa, sedangkan form di sini kecil dan **butuh** controlled — nilai `discountType` mengubah adornment `%`/`$` pada field di sebelahnya secara langsung.

**Latihan:** `deliveryActions` belum punya `canRetryDispatch`. Tambahkan aturannya (misal: legal hanya saat `status === 'CONFIRMED'` dan `assignedDroneId === null`), tulis test-nya di `deliveryActions.test.ts` **sebelum** menyentuh komponen apa pun, baru tambahkan tombolnya di panel `DeliveryDetailPage.tsx`. Verifikasi: seluruh logika sudah hijau sebelum satu piksel dirender. Lalu tugas kedua yang lebih penting — buka `Drovery_Backend/src/deliveries/delivery-exceptions.ts` dan **buktikan** bahwa `FAILABLE_STATUSES` di admin masih cermin yang jujur hari ini. Kalau ternyata sudah menyimpang, kamu baru menemukan bug nyata; catat di `AUDIT-LOG` capstone-mu.

---

### 12.8 Vitest + Testing Library: `renderWithProviders`, `preloadedState`, query berbasis role, mock di satu chokepoint

Empat pola, dan semuanya bisa langsung kamu bawa ke proyek Ionic-mu.

**(a) Satu helper render yang mereplikasi produksi.** `renderWithProviders` membangun **store baru per-test** (bukan store global — isolasi), lalu membungkus `Provider` → `ThemeProvider` → `MemoryRouter`. Urutannya sama persis dengan `main.tsx` + `App.tsx`. Kalau helper ini berbeda dari produksi, semua test-mu menguji aplikasi yang tidak ada.

**(b) `preloadedState` menggantikan "login dulu".** `authedAdmin()` mengembalikan potongan `RootState` yang berisi admin yang sudah login. Ini alasan praktis nomor satu memilih Redux untuk sesi: kamu bisa mem-*preload* sesi tanpa menjalankan alur login di setiap test.

**(c) Query berbasis role, bukan `data-testid`.** Ini tempat MUI **membayar dirinya sendiri**. Kamu tidak memilih MUI karena tampilannya; kamu memilihnya karena `Dialog`, `Select`, dan `Table`-nya sudah punya peran ARIA yang benar, sehingga test bisa menanyakan hal yang sama dengan yang ditanyakan pengguna: *"tombol bernama Force cancel"*, *"combobox bernama Command"*.

**(d) Mock di satu chokepoint terjauh.** Karena `apiFetch` adalah satu-satunya jalur keluar ke jaringan, `vi.mock('../../api/client')` satu kali mem-mock **seluruh** read + mutation halaman.

Ada tiga trik kecil yang akan langsung kamu pakai. **Fixture sebagai factory ber-override**: setiap fixture berbentuk `(over: Partial<T> = {}): T => ({ ...default, ...over })`, dipanggil sebagai `fx.delivery({ status: 'DELIVERED' })` — jadi test hanya menyebut field yang **relevan bagi test itu**, dan menambah field baru ke DTO tidak memecahkan 20 test sekaligus. **`findBy*` untuk menunggu async**: `await screen.findByText('DRV-0001')` menunggu promise `useApi` resolve tanpa `waitFor` manual. **Promise yang tidak pernah selesai untuk menguji loading state**: `mockFetch.mockReturnValue(new Promise(() => {}))` mengunci halaman di keadaan loading, jadi kamu bisa meng-assert spinner-nya ada tanpa balapan dengan resolusi.

**Anchor:**
- `Drovery_Admin/src/test/renderWithProviders.tsx:23-49` — helper terpenting di repo; store per-test di `:28-31`.
- `Drovery_Admin/src/test/renderWithProviders.tsx:32-38` — opsi `routePath`: kalau diisi, UI dipasang di dalam `<Routes><Route path={routePath}>` supaya `useParams()` benar-benar resolve.
- `Drovery_Admin/src/test/renderWithProviders.tsx:52-62` — `authedAdmin()` sebagai `preloadedState`.
- `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.test.tsx:8-9` — *"The api client is the single chokepoint: both the useApi reads (delivery + commands) and the adminApi mutations call apiFetch. Mock it once and resolve per-path."*
- `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.test.tsx:24-29` — `mockFetch.mockImplementation((path) => ...)` untuk menjawab per-path. Pola ini berulang identik di 7 file test.
- `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.test.tsx:134-152` — query berbasis role pada MUI `Select`, termasuk detail penting: opsi dirender ke **portal**, jadi query lewat `screen`, bukan `within(dialog)`.
- `Drovery_Admin/src/pages/Users/UsersListPage.test.tsx:47-55` — `within()` untuk mempersempit: *"Scope the role assertions to each user's row so the Role-filter Select cannot satisfy the query."*
- `Drovery_Admin/src/test/fixtures.ts:1` + `:16-25` — pola factory ber-override (*"Sample API response objects for render tests. Each is a factory taking overrides."*).
- `Drovery_Admin/src/pages/Dashboard/DashboardPage.test.tsx:22-28` — promise yang tidak pernah selesai untuk mengunci loading state, lalu `getByRole('progressbar')`.
- `Drovery_Admin/src/api/supportSocket.test.ts:96-102` — pelajaran negatifnya, ditulis di dalam test itu sendiri: *"this test asserted a BARE payload the gateway never emits, so it passed against dead code."*
- `Drovery_Admin/vite.config.ts:42-51` — konfigurasi test **di file yang sama** dengan konfigurasi build; `:46-49` menjelaskan `testTimeout: 20000` dengan jujur (*"MUI dialog/select/portal render tests are heavy"*).

**Kenapa dipakai di sini:** Vitest dipilih karena ia **berbagi config, resolver, dan transform pipeline dengan Vite**. Praktisnya: `import.meta.env`, alias, plugin React, dan TS jalan identik di test dan produksi — tanpa `ts-jest` atau `moduleNameMapper` yang harus dirawat terpisah. Bandingkan dengan sisi mobile, di mana `jest-expo` **harus** merawat `transformIgnorePatterns` dan folder `__mocks__/` manual karena native module tidak ada di Node.

Dan ada pelajaran negatif yang wajib kamu bawa: `supportSocket.test.ts:96-102` mendokumentasikan test yang **lulus terhadap dead code** selama berbulan-bulan — ia mem-fixture bentuk frame yang gateway tidak pernah kirim, jadi ia hijau sementara setiap pesan masuk pelanggan diam-diam dibuang dan chip status tetap membaca "Live". Test hanya sekuat asumsimu tentang kontrak eksternal. Ini juga argumen paling kuat untuk melengkapi unit test dengan satu-dua test kontrak nyata — dan untuk menulis apa yang kamu **verifikasi manual** di entri `AUDIT-LOG`, bukan hanya berapa test yang hijau.

**Alternatif:**
- **MSW (Mock Service Worker)** — mock di level jaringan, bukan modul. Ini upgrade paling berharga untuk repo ini, dan alasannya spesifik: `vi.mock('../../api/client')` **melewati** `client.ts` sepenuhnya, sehingga unwrap envelope, penanganan 401, dan single-flight refresh **tidak pernah teruji** di test halaman mana pun. Biaya: setup handler + satu lapisan lagi yang bisa salah konfigurasi.
- **`@testing-library/user-event`** (bukan `fireEvent`) — mensimulasikan interaksi lebih realistis. Repo ini memakai `fireEvent.mouseDown` untuk membuka MUI `Select`, yang sebenarnya workaround yang tidak diperlukan dengan `user-event`. Trade-off: `user-event` async dan lebih lambat, dan `testTimeout: 20000` sudah menandakan test suite ini tidak punya banyak ruang.
- **Playwright / Cypress E2E** — menguji sistem sungguhan termasuk backend; **satu-satunya** cara menangkap bug seperti double-`JSON.stringify` di `fleetApi` (`Drovery_Admin/src/api/admin.ts:85,90` — body sudah di-`JSON.stringify` sekali oleh `apiFetch` di `client.ts:99`, jadi ini dobel; test `FleetListPage.test.tsx` tidak menangkapnya karena `apiFetch` di-mock). Biaya: lambat, butuh backend hidup, flaky.

**Latihan:** ganti `vi.mock('../../api/client')` di `DashboardPage.test.tsx` dengan MSW: pasang handler untuk `GET */admin/overview` yang mengembalikan envelope **lengkap** `{ success: true, data: fx.overview() }`. Test harus tetap hijau — dan sekarang ia juga membuktikan `apiFetch` benar membuka envelope. Verifikasi tambahan: tambahkan test kedua di mana handler mengembalikan `401` dan assert bahwa handler yang didaftarkan lewat `setUnauthorizedHandler` benar-benar terpanggil. Sebelum MSW, test itu **tidak mungkin** ditulis.

---

### 12.9 Sisi mobile secukupnya: `EXPO_PUBLIC_*`, `apiClient`, `expo-secure-store`, `AuthGate`

Kamu tidak akan belajar React Native di fase ini — itu Fase 4. Yang kamu butuhkan di sini cuma empat hal, karena fitur capstone-mu harus sampai ke layar HP.

**(a) `EXPO_PUBLIC_*` di-inline saat bundling.** Ini beda tajam dari Ionic. Di Vite/Webpack kamu masih bisa menaruh runtime config di `index.html` atau memuatnya lewat fetch. Di React Native, nilai `process.env.EXPO_PUBLIC_*` **dijahit ke dalam bundle JS**, jadi mengubah `.env` tanpa restart dev server tidak berefek sama sekali. Dan ada nuansa yang akan menggigitmu di hari pertama sebagai orang Android: host backend berbeda per target — `10.0.2.2` untuk **emulator Android** (alias loopback host), `localhost` untuk simulator iOS, IP LAN untuk device fisik lewat Expo Go.

**(b) `apiClient` tulis tangan yang membuka envelope.** Satu baris yang menyambungkan repo mobile ke repo backend:

```ts
// Unwrap TransformInterceptor wrapper: { success, data, timestamp }
return (json.data !== undefined ? json.data : json) as T;
```

Ini sisi mobile dari kontrak yang sama dengan `client.ts:127` di admin. Tiga repo, satu amplop.

**(c) `expo-secure-store` untuk token.** JWT tidak boleh di `AsyncStorage` (plaintext di sandbox app). `expo-secure-store` menulis ke **Android Keystore / iOS Keychain**, terenkripsi at-rest. Ini padanan langsung dari `capacitor-secure-storage-plugin` yang biasa kamu pakai — bedanya, di RN modul ini bagian dari SDK resmi dan tidak lewat WebView bridge.

**(d) `AuthGate` di layout.** Aturannya satu kalimat: *"when auth state and the current route disagree, the route moves."*

**Anchor:**
- `Drovery_Mobile/config/env.ts:4-7` — *"Expo only inlines env vars that are prefixed with `EXPO_PUBLIC_` into the JS bundle. Plain `.env` vars (e.g. `API_URL`) are NOT visible to React Native at runtime."*
- `Drovery_Mobile/config/env.ts:12-15` — tiga host per target (emulator / simulator / device fisik). Ini sumber bug nomor satu saat pertama menyambungkan app ke backend lokal.
- `Drovery_Mobile/config/env.ts:23-38` — `ENV` sebagai satu objek `as const`: satu tempat membaca config, sehingga bisa di-mock utuh dalam test.
- `Drovery_Mobile/services/api/apiClient.ts:125-126` — unwrap envelope.
- `Drovery_Mobile/services/api/apiClient.ts:80-81` + `:130-132` — timeout manual lewat `AbortController`, dinormalkan jadi `ApiError(0, 'Request timed out')` supaya UI hanya perlu menangani satu jenis error.
- `Drovery_Mobile/services/api/apiClient.ts:29-31` + `:95-114` — single-flight refresh versi mobile (`isRefreshing` + `refreshPromise`), plus jalur 401 yang menghormati `noAuthRetry`.
- `Drovery_Mobile/services/api/tokenStorage.ts:1-34` — `saveTokens`/`getTokens`/`clearTokens` di atas `SecureStore`.
- `Drovery_Mobile/contexts/AuthContext.tsx:42-47` — `setOnLogout(() => { logout(); })`. Ini **dependency injection paling sederhana yang mungkin**: `apiClient` perlu memanggil `logout()`, tapi `AuthContext` meng-import `apiClient`, jadi arah dependensinya dibalik lewat callback registry. Persis semangat `setUnauthorizedHandler` di admin.
- `Drovery_Mobile/contexts/AuthContext.tsx:50-66` — efek hidrasi: baca token → `GET /users/me` → baru `isLoading: false`.
- `Drovery_Mobile/app/_layout.tsx:13-17` — detail yang sangat mudah salah: `""` (route index) **sengaja tidak** dimasukkan ke `PUBLIC_SEGMENTS`. Kalau dimasukkan, cold start dalam keadaan logout mendarat di `""`, gate menganggapnya publik, dan user menatap spinner selamanya dengan `/login` tak terjangkau.
- `Drovery_Mobile/app/_layout.tsx:29-42` — dua bug nyata yang digabung jadi satu mekanisme; baca utuh.
- `Drovery_Mobile/app/_layout.tsx:48-51` — `if (isLoading) return;` dengan alasan: mengambil keputusan sebelum hidrasi selesai akan melempar user yang sudah login ke `/login` untuk satu frame.

**Kenapa dipakai di sini:** karena capstone-mu harus mendarat di layar. Fitur backend yang tidak pernah dilihat pelanggan adalah endpoint, bukan fitur — dan `AUDIT-PLAN.md:64-67` sudah menunjukkan bagaimana sebuah fitur bisa punya test hijau, tipe bersih, dan **nol call site**.

**Alternatif:**
- **`expo-constants` + `extra` di `app.json`** — nilai bisa berbeda per profil build EAS tanpa `.env`. Kalah: nilainya tetap statis per build dan kamu kehilangan kenyamanan `.env` lokal. Repo ini memakai keduanya: `EXPO_PUBLIC_*` untuk config app, `Constants.expoConfig.extra` untuk hal yang memang hanya ada di build (project id EAS untuk push token).
- **Remote config (fetch config saat startup)** — bisa diubah tanpa rilis ulang. Kalah: satu request blocking sebelum app siap, dan URL fetch-nya sendiri tetap harus hard-coded, jadi kamu tidak menghapus masalahnya, cuma memindahkannya satu tingkat.
- **`@react-native-async-storage/async-storage` untuk token** — lebih cepat dan tanpa batas ukuran praktis, tapi **tidak terenkripsi**. Cocok untuk preferensi UI; salah untuk JWT.
- **axios di mobile** — interceptor bawaan, `transformResponse`, dan yang paling nyata: **progress upload**. Untuk kebutuhan sekarang (satu interceptor 401, satu unwrap) `fetch` cukup dan menghemat ~13 kB; tapi kalau nanti butuh progress bar untuk foto proof-of-delivery, axios/`XMLHttpRequest` menang telak karena `fetch` tidak punya upload progress.
- **Redirect per screen (`<Redirect href="/login" />` di tiap route)** alih-alih `AuthGate` — eksplisit dan lokal, tapi harus diulang di ±25 file dan mudah lupa saat menambah screen. Ini persis kelas bug yang dihapus `NAV_ITEMS` di admin, dalam bentuk lain.

**Latihan:** ubah satu nilai di `Drovery_Mobile/.env` (`EXPO_PUBLIC_API_URL`), **jangan** restart dev server, lalu reload app dan buktikan nilainya tidak berubah. Setelah itu restart dan buktikan berubah. Lalu simulasikan bug kedua yang didokumentasikan `AuthGate`: panggil `logout()` saat kamu sedang berada di `/track-on-map?id=...`, verifikasi kamu terlempar ke `/login` **dan** polling tracking berhenti. Terakhir, komentari sementara blok `if (!isAuthenticated && !isPublic)` di `app/_layout.tsx:56-57`, ulangi, dan hubungkan apa yang kamu lihat dengan komentar di `:36-38`.

---

### 12.10 Kontrak wire-format lintas repo

Ini bagian yang paling banyak menyelamatkan produksi, dan ia tidak punya padanan sama sekali di dunia satu-repo. Tiga aturan, masing-masing lahir dari bug nyata.

**(a) Nilai yang kamu PEGANG dan KIRIM selalu wire format. Yang dibaca manusia diproduksi di titik tampilan.**

Bug-nya: app mengirim `"Jul 30, 2026"` dan `"09:30 AM"`. Backend memvalidasi dengan dua regex ketat; kalau gagal, `computeScheduledFor()` mengembalikan `null` dan `create()` memperlakukan `null` sebagai "berangkatkan sekarang". Respons tetap `201`. Dan bagian paling jahat: `new Date("Jul 30, 2026")` **kebetulan parse**, jadi `pickupDate` yang tersimpan terlihat benar di semua layar. Datanya kelihatan benar; pesawatnya sudah pergi.

Turunannya: `toWireDate` sengaja **tidak** memakai `toISOString().slice(0,10)`, karena itu mengonversi ke UTC dulu — user di UTC+7 (yaitu kamu) yang memilih tanggal 30 sebelum jam 07:00 pagi akan mengirim tanggal 29.

**(b) `Record<DeliveryStatus, …>` mengubah drift runtime jadi compile error.**

Kalau backend menambah status baru dan mobile hanya punya `switch` dengan `default`, statusnya akan dirender sebagai "Pending"/step 0 dan tidak ada yang tahu. Dengan `Record<DeliveryStatus, …>`, menambah status ke union memaksa **setiap** tempat yang memetakan status untuk gagal compile sampai ditangani.

**(c) Jangan hitung ulang harga di klien.**

Ada nisan tertulis di repo untuk fungsi yang dihapus: *"an unavailable quote must read as unavailable, not cheap."* Fungsi harga lokal itu tidak punya suku jarak sama sekali, dan ia dipakai sebagai fallback **di layar yang seluruh tujuannya menampilkan harga**. Kalau kuotasi server tidak tersedia, jawaban yang benar adalah "tidak tersedia" — bukan angka yang kebetulan lebih murah.

**(d) Satu formatter untuk satu konsep tampilan.**

Ini turunan dari (a) yang sering dianggap sepele. App ini dulu punya **empat** formatter mata uang, dan dua di antaranya duduk di layar yang sama: bar harga checkout menampilkan `"$37"` sementara kartu promo tepat di atasnya menampilkan total yang **sama** sebagai `"Rp37.000"` — angka USD dilewatkan formatter `id-ID` dengan `"Rp"` yang di-hard-code. Pelajarannya sama dengan aturan (a): kalau nilai wire dan nilai tampilan boleh diproduksi di banyak tempat, cepat atau lambat dua tempat akan tidak sepakat, dan yang melihatnya lebih dulu adalah pelanggan.

**Anchor:**
- `Drovery_Mobile/features/delivery/utils/pickupDateTime.ts:1-17` — komentar bug paling instruktif di seluruh tiga repo. Baca utuh, dua kali.
- `Drovery_Mobile/features/delivery/utils/pickupDateTime.ts:29-40` — `toWireDate` dan alasan menghindari `toISOString()`.
- `Drovery_Backend/src/deliveries/delivery-schedule.ts:10-22` — sisi backend dari kontrak yang sama, dengan alasan mengapa regex-nya diekspor dari sana: *"exported from HERE so a validator can never drift from the parser below."* Ini teknik yang sama dengan `NAV_ITEMS`: satu deklarasi, dua konsumen.
- `Drovery_Backend/AUDIT-PLAN.md:247-255` — **rantai bug yang ditelusuri lengkap**, langkah demi langkah dari picker mobile sampai `isScheduled = false`. Ini contoh terbaik di repo tentang cara menulis diagnosis.
- `Drovery_Mobile/services/deliveryStatus.ts:3-10` — *"Typed as a Record<DeliveryStatus, …>, so adding a backend status is a COMPILE error until it's handled everywhere — which is exactly the drift that previously left the exception statuses ... rendering as 'Pending' / step 0."*
- `Drovery_Mobile/features/delivery/screens/PriceEstimationScreen/pricing.ts:36-39` — batu nisan `calcBreakdownLocal`.
- `Drovery_Mobile/utils/currency.ts:1-11` — cerita empat formatter, termasuk alasan parameter `currency` tetap ada meski backend saat ini selalu USD: *"so that when the server does start returning a currency, call sites pass it through instead of every screen inventing its own symbol again."*
- `Drovery_Backend/INTEGRATION.md:56-74` — kontrak envelope yang dipegang tiga repo, termasuk catatan penting: *"There is **no pagination `meta`** — a paginated handler returns `{ items, total, page, limit }` directly under `data`."*
- Commit: `3eae8ab fix(deliveries): validate pickupDate/pickupTime shape on CreateDeliveryDto`.

**Kenapa dipakai di sini:** karena inilah satu-satunya kelas bug yang **tidak bisa** ditemukan dari dalam satu repo. Backend punya test hijau (DTO-nya menerima string). Mobile punya test hijau (picker-nya mengembalikan string). Yang salah adalah **ruang di antara keduanya**, dan tidak ada suite yang memiliki ruang itu. Itu sebabnya `INTEGRATION.md` menyebut dirinya *"the source of truth for how the two repos talk to each other"* — dokumen adalah tempat kontrak itu tinggal, karena tidak ada compiler yang memilikinya.

**Alternatif:**
- **Skema bersama** (`openapi-typescript` dari Swagger backend, atau paket npm `@drovery/contracts`) — satu sumber tipe, drift mustahil. Biaya konkret: langkah codegen di CI ketiga repo, file generated yang besar, dan koordinasi versi antar-repo saat backend berubah. Ada catatan tambahan di `ROADMAP.md:7`: karena envelope-nya runtime-only, OpenAPI harus di-**post-process** supaya spec-nya ikut membungkus — kalau tidak, klien hasil codegen akan men-deserialize bentuk yang salah.
- **Validasi runtime dengan `zod`** — respons di-*parse*, bukan sekadar di-*cast*. Menangkap perubahan backend saat runtime alih-alih membuat UI `undefined` diam-diam. Kandidat kuat untuk `Drovery_Mobile/services/api/types.ts` yang sekarang hanya `interface`. Biaya: parsing di setiap response (kecil), dan kamu harus memutuskan apa yang dilakukan saat parse gagal — menampilkan error keras di app produksi biasanya lebih buruk daripada field kosong.
- **Kirim epoch millis / ISO-8601 penuh** alih-alih dua field string `pickupDate` + `pickupTime` — menghapus **seluruh** kelas bug ini. Kalah: butuh perubahan backend + migrasi data + koordinasi rilis tiga klien, yang bukan pilihan saat bug itu ditemukan.
- **Contract testing (Pact)** — konsumen mendeklarasikan ekspektasinya, provider memverifikasinya di CI. Ini jawaban "benar" secara industri. Kalah untuk proyek satu orang: butuh broker, dan biaya perawatannya melebihi 96 endpoint milik satu tim.

**Latihan:** tambahkan status baru `'DIVERTED'` ke `DeliveryStatus` di `Drovery_Mobile/services/api/types.ts:29-43`, lalu jalankan `npx tsc --noEmit`. Catat **semua** file yang gagal compile — itulah nilai konkret dari `Record<DeliveryStatus, …>`, dan hitungannya adalah angka yang bisa kamu tulis di perbandingan alternatifmu. Perbaiki satu per satu, lalu kembalikan perubahannya. Latihan kedua: kirim `pickupDate: "Aug 30, 2026"` ke `POST /deliveries` dengan `curl` terhadap backend lokal, dan buktikan sendiri apa yang terjadi sekarang (setelah `3eae8ab`) versus apa yang **dulu** terjadi.

---

### 12.11 Proses repo: acceptance criteria berupa perilaku, verifikasi manual yang dicatat, mutation testing, `AUDIT-LOG` yang tidak pernah ditulis ulang

Ini bagian yang paling mudah dilewati dan paling banyak mengubah cara kerjamu. Repo ini **menolak "test hijau" sebagai bukti**, dan ia punya alasan yang tercatat:

> *"1,073 tests passing, all three repos typecheck clean, lint clean (backend has 98 warnings, 0 errors) — while an entire user-facing feature (support tickets) was unreachable and no payment had ever been captured. ... `supportApi.createTicket` has its own passing test and zero call sites."*

Gantinya tiga lapis:

**(a) Acceptance criteria berupa PERILAKU, bukan coverage.** "Operator menekan Force cancel pada delivery `IN_TRANSIT`, statusnya jadi `CANCELED`, wallet pelanggan bertambah, dan tombolnya jadi disabled" — itu kriteria. "Coverage 85%" bukan.

**(b) Verifikasi manual live yang DICATAT.** Bukan "saya sudah coba, jalan kok". `AUDIT-LOG.md` mencantumkan isi tabel sungguhan setelah verifikasi, sehingga sesi berikutnya bisa memeriksa klaimnya.

**(c) Mutation testing SEBELUM merge.** Kamu merusak kode dengan sengaja dan mencatat test mana yang mati. Kalau tidak ada yang mati, kamu baru menemukan lubang test. Dan repo ini menulis aturan anti-menipu-diri untuk harness-nya:

> *"the harness treats a run that executed zero tests as a failure rather than a pass"* dan *"Each edit asserts its anchor text occurs exactly once, so a silently-unapplied mutation cannot be scored as killed."*

Dua aturan itu ada karena keduanya pernah terjadi.

Kalau kamu bingung mutasi apa yang harus dicoba, ini menu yang terbukti produktif di repo ini — semuanya diambil dari sweep nyata yang tercatat, bukan dikarang:

| Mutasi | Apa yang ia uji |
|---|---|
| Balik `>` jadi `>=` (atau sebaliknya) pada batas waktu/altitude | Apakah test-mu memaku **inklusivitas** batasnya, atau cuma nilai di tengah |
| Hapus satu klausa `where` (mis. `{ active: true }` → `{}`) | Apakah test-mu benar-benar memilih baris yang benar, atau kebetulan cuma ada satu baris di fixture |
| Hapus klausa status dari `where` sebuah CAS | Apakah ada test balapan sungguhan, atau cuma test jalur bahagia |
| Pindahkan sebuah `release()` / `invalidate()` ke **dalam** transaksi | Apakah test-mu peduli pada urutan efek, bukan cuma hasil akhirnya |
| Ganti `this.prisma.txClient` jadi `this.prisma` di dalam callback transaksi | Apakah test-mu meng-assert **klien mana** yang dipakai — kalau keduanya `jest.fn` yang sama, hanya assertion identitas yang bisa melihat bedanya |
| Kembalikan `[]` alih-alih melempar saat dependency gagal | Apakah kebijakan fail-open/fail-closed-mu benar-benar terkunci |
| Hapus satu `await` (`return await` → `return`) | Apakah jalur peringatan/log yang bergantung pada penyelesaian promise benar-benar diuji |
| Hapus satu key dari katalog `id.ts` | Apakah drift guard i18n-mu hidup |

**Anchor:**
- `Drovery_Backend/AUDIT-PLAN.md:62-71` — §1.1 *"The test suite will not catch your mistakes"*.
- `Drovery_Backend/AUDIT-PLAN.md:603-636` — protokol log wajib, dengan template 8 bagian: *What changed* / *Verification* / *Decisions made* / *Deviations from the plan* / *Left undone / follow-ups* / *Next*. **Pakai template ini apa adanya untuk capstone-mu.**
- `Drovery_Backend/AUDIT-PLAN.md:638-644` — **Rules**: *"Never rewrite a past entry. Append a correcting entry instead."* dan *"If you discover the plan is wrong, fix this file **and** record the change under Deviations so the disagreement is visible."*
- `Drovery_Backend/AUDIT-LOG.md:2069-2074` — laporan mutation testing sungguhan: 15 mutasi, 15 tertangkap, dengan aturan harness di atas.
- `Drovery_Backend/AUDIT-LOG.md:2219-2225` — hasil mutasi yang paling mengubah pikiran: *"removing `ServiceabilityModule` from `admin.module.ts` compiles clean and leaves **94 green tests over an application that cannot boot**"*.
- `Drovery_Backend/AUDIT-LOG.md:2236-2260` — contoh `### Left undone / follow-ups` yang benar: bukan daftar TODO, melainkan **utang yang diakui beserta alasan penundaannya**. Perhatikan kalimat seperti *"Failing closed is right; reusing a non-retryable code for a transient cause is the flaw"* — mengakui apa yang benar sekaligus apa yang salah.
- `Drovery_Backend/src/i18n/catalog.completeness.spec.ts:8-12` — contoh test yang menjaga kelas invariant, bukan satu kasus: *"every message key the app renders MUST exist in EVERY supported locale. If someone adds a delivery stage, a failure reason, or an FAQ without a catalog entry, this fails CI instead of printing a raw key in production."*

**Kenapa dipakai di sini:** karena satu-satunya cara membuktikan sebuah test **bernilai** adalah merusak kode yang seharusnya ia jaga. Dan karena `AUDIT-LOG.md` yang append-only adalah satu-satunya cara sebuah proyek bisa jujur pada dirinya sendiri: commit `8793ca9 docs(audit): correct three untrue claims` dan `0e7a650 ... correct the doc's own miscounts` adalah commit yang memperbaiki **dokumen**, bukan kode. Kamu tidak akan melihat itu di kebanyakan repo, dan itulah kenapa kebanyakan repo tidak tahu apa yang sebenarnya jalan.

**Alternatif:**
- **Issue tracker (Jira/GitHub Issues)** — bisa dicari, punya assignee dan due date. Kalah konkret: tidak berada di dalam repo, jadi ia tidak ikut di-review bersama diff, dan "keputusan yang tidak boleh dibalik diam-diam" tidak bisa duduk berdampingan dengan kodenya.
- **Gate coverage %** di CI — otomatis dan murah. Kalah persis pada §1.1: coverage tinggi dengan mock yang salah. `supportApi.createTicket` punya test dan nol call site; coverage-nya bagus.
- **Hanya code review manusia** — menangkap desain dan niat. Kalah: tidak menangkap "test ini akan tetap hijau kalau kodenya dibalik", yang justru inti mutation testing. Reviewer membaca kode yang ada, bukan kode yang mungkin salah.
- **Stryker (mutation testing otomatis)** — menghasilkan ratusan mutan tanpa kerja manual, dengan skor mutasi yang bisa di-gate di CI. Kalah untuk fase ini: ia lambat pada suite sebesar ini, dan yang lebih penting — **mutasi manual yang kamu pilih sendiri memaksamu merumuskan invariant apa yang sebenarnya kamu jaga**, dan itu pelajarannya.

**Latihan:** pilih satu file spec backend yang kamu tulis di minggu 2. Terapkan **satu** mutasi manual (balik sebuah `>` jadi `>=`, hapus satu klausa `where`, atau pindahkan `release()` ke sebelum CAS), jalankan **seluruh file spec-nya** (bukan `jest -t`), dan catat apakah ada yang merah. Kalau hijau, kamu baru menemukan lubang test — tulis test yang membunuhnya. Verifikasi tambahan: pastikan `jest` benar-benar menjalankan test (baca angka "Tests: N passed"), karena run yang mengeksekusi **nol** test akan terlihat seperti sukses.

---

### 12.12 Alternatif dibandingkan: menulis keputusan, bukan menghafalnya

Kamu bilang kamu ingin tahu alternatifnya. Konsep terakhir fase ini adalah keterampilan yang membuat pengetahuan itu berguna: **menulis perbandingan dengan angka dari mesinmu sendiri.**

Cara repo ini melakukannya bisa kamu tiru langsung. Perhatikan bahwa hampir setiap keputusan besar di ketiga repo ditulis dalam bentuk yang sama: **apa yang dipilih · apa yang ditolak · harga apa yang diterima.** Bukan "tergantung kebutuhan", melainkan kalimat seperti *"cost, accepted"* atau *"the flaw is X, deliberately deferred"*.

Tujuh perbandingan yang harus kamu tulis untuk capstone (masing-masing 1 paragraf + minimal satu angka yang kamu ukur sendiri):

| # | Perbandingan | Angka yang harus kamu ukur |
|---|---|---|
| 1 | Context vs Zustand vs Redux Toolkit vs RTK Query vs TanStack Query | Berapa baris kode yang hilang/bertambah kalau `useApi` + `useMutation` diganti TanStack Query di **satu** halaman? Berapa KB bundle bertambah (`npm run build`, bandingkan `dist/assets/`)? |
| 2 | `fetch` wrapper vs axios | Ukuran `client.ts` (baris) vs ukuran axios gzip; lalu satu kemampuan konkret yang hilang (upload progress). |
| 3 | MUI vs Tailwind + shadcn/ui | Hitung berapa query berbasis role di test repo yang **hanya** bekerja karena MUI memberi peran ARIA benar (`grep -r "getByRole" src/ \| wc -l`). Itu biaya yang harus kamu bayar ulang kalau pindah. |
| 4 | `useListParams` buatan sendiri vs `nuqs` | Berapa cast `as` manual yang hilang? (Mulai dari `DeliveriesListPage.tsx:41`.) |
| 5 | `vi.mock` chokepoint vs MSW | Berapa jalur kode di `client.ts` yang **tidak pernah** dieksekusi test halaman hari ini? (Unwrap envelope, 401, single-flight — hitung barisnya.) |
| 6 | Mirror manual vs `openapi-typescript` | Berapa file yang saat ini menduplikasi bentuk backend? Mulai dari `Drovery_Admin/src/models/enums.ts`, `Drovery_Admin/src/models/admin.ts`, `Drovery_Mobile/services/api/types.ts`, `Drovery_Mobile/.../validators.ts:8-15`. |
| 7 | Mutation testing manual vs Stryker vs gate coverage | Waktu wall-clock satu run mutasi manual (8 mutasi) vs waktu satu run suite penuh. |

**Anchor:**
- `Drovery_Backend/AUDIT-PLAN.md:638-644` — aturan main menulis keputusan: jangan tulis ulang, tambahkan koreksi; kalau rencananya salah, catat ketidaksepakatannya supaya terlihat.
- `Drovery_Admin/src/api/admin.ts:78-80` — contoh komentar keputusan yang bagus dan pendek: kenapa mendaftarkan pesawat itu penting sama sekali (*"with an empty registry there is no aircraft to claim"*).
- `Drovery_Admin/src/features/deliveries/deliveryActions.ts:39-42` — contoh menuliskan **kenapa aturan ini sengaja lebih longgar**, bukan cuma apa aturannya.
- `Drovery_Mobile/features/delivery/screens/CreateDeliveryScreen/validators.ts:8-9` — contoh menuliskan **utang** dengan jujur: *"Kept in sync by hand today — if these ever diverge, the server rejects what this form allowed."*

**Kenapa dipakai di sini:** karena "aku tahu alternatifnya" tanpa angka adalah hafalan, dan hafalan akan basi dalam 18 bulan. Yang tidak basi adalah **metode**: ukur di mesinmu, tulis harga yang kamu terima, tandai apa yang belum kamu ukur. Repo ini bahkan punya penanda formal untuk yang terakhir — `**ILLUSTRATIVE**` / `FILL FROM RUN` untuk angka placeholder, supaya dokumennya tidak bisa dipakai untuk over-claim.

**Alternatif (cara mengambil keputusan, bukan teknologinya):**
- **Spike/prototype 2 jam per opsi** — paling meyakinkan karena menghasilkan angka nyata dari kodemu sendiri. Kalah: mahal, dan hasilnya cuma valid untuk potongan kecil yang kamu prototipekan (satu halaman ≠ dua belas halaman).
- **ADR (Architecture Decision Records)** — satu file kecil per keputusan, bernomor, berstatus `proposed/accepted/superseded`. Menang: mudah di-diff dan di-*supersede*. Kalah di repo ini: kehilangan narasi lintas-keputusan yang justru inti (misal "kenapa sharding ditunda" hanya masuk akal kalau dua bagian dibaca berurutan).
- **Benchmark publik / artikel perbandingan** — cepat dan gratis. Kalah: hampir selalu diukur pada beban yang bukan bebanmu, dan hampir tidak pernah menyebut biaya perawatan.

**Latihan:** kerjakan baris #1 dan #5 dari tabel di atas **sekarang**, sebelum capstone. Keduanya bisa diukur dalam 45 menit dan keduanya akan mengubah keputusan yang kamu ambil di minggu 2. Verifikasi: tulis hasilnya sebagai dua paragraf di file scratch, masing-masing memuat minimal satu angka dan satu kalimat "harga yang saya terima".

---

## Capstone

Satu fitur nyata mendarat di branch dengan CI hijau di **ketiga** repo. Pilih sesuatu yang kecil tapi menembus semua lapisan — contoh yang bagus: *"operator bisa menunda (hold) sebuah delivery `CONFIRMED` selama N menit dengan alasan, pelanggan melihat status HOLD beserta alasannya di app"*.

Kriteria penerimaan berbentuk perilaku yang **bisa gagal di depan matamu**:

**Backend**
- [ ] `POST /admin/deliveries/:id/hold` mengembalikan `200` untuk delivery `CONFIRMED`, dan `409` untuk delivery yang sudah `IN_TRANSIT` — **dibuktikan dengan dua `curl`, bukan dua test**.
- [ ] Transisinya ber-CAS: `updateMany` dengan `where` yang memuat status lama. Jalankan dua request bersamaan (`curl ... & curl ... & wait`) dan buktikan **tepat satu** yang berhasil; yang kedua dapat `409`.
- [ ] Ada satu spec yang menguji balapan itu (dua pemanggilan konkuren, satu menang), dan spec itu **merah** kalau klausa status dihapus dari `where`.
- [ ] Migration menambah kolom (mis. `holdUntil`, `holdReason`) plus **satu index atau constraint yang kamu benarkan tertulis** — sebutkan query mana yang memakainya. Index tanpa pembenaran = tidak diterima.
- [ ] Efek sampingnya (notifikasi/email/pembatalan hold otomatis) lewat **job durabel atau outbox**, bukan `setTimeout` in-process. Bunuh proses worker di tengah dan buktikan job-nya tetap jalan setelah restart.
- [ ] Satu metrik baru terdaftar dan muncul di endpoint metrics setelah kamu memicu fitur itu sekali (`curl -s localhost:3000/api/v1/metrics | grep <nama_metrik>` — ingat `metrics` ikut global prefix `api/v1` yang dipasang di `src/main.ts:38-40`).
- [ ] Key i18n ada di **`en` DAN `id`**; `catalog.completeness.spec.ts` hijau. Hapus satu key dari `id.ts` dan pastikan spec itu **merah** sebelum kamu kembalikan.
- [ ] DTO menolak `null` pada field yang memetakan kolom `NOT NULL` — ingat `@IsOptional()` melewatkan `null`, bukan hanya `undefined` (`AUDIT-LOG.md:2255-2260`).

**Admin**
- [ ] Satu halaman atau panel yang mengoperasikannya, terjaga role lewat `NAV_ITEMS` (bukan `if` di dalam komponen).
- [ ] Filter/page/search hidup di **URL**: buka halaman, filter, masuk detail, tekan Back → filter masih ada. Tekan `F5` → masih ada. Salin URL ke tab baru → sama.
- [ ] Aksi destruktifnya lewat `ConfirmDialog`, dengan error tampil **di dalam dialog** dan dialog tidak bisa ditutup saat request berjalan.
- [ ] Tombol Refresh memuat ulang **semua** yang halaman itu tampilkan (jangan ulangi `d67ac40`).
- [ ] Minimal satu test Vitest yang query-nya **berbasis role** (`getByRole('button', { name: /…/i })`), memakai `renderWithProviders` + `preloadedState`, dan mem-mock `api/client` sebagai chokepoint.
- [ ] `deliveryActions`-mu (atau ekuivalennya) adalah fungsi murni dengan test tanpa React, dan docstring-nya menyebut file backend yang ia cermin.

**Mobile**
- [ ] Satu layar atau field yang mengonsumsi field baru itu, dengan format wire yang **benar** (bukan string tampilan).
- [ ] Kalau ada status baru: ia masuk ke `Record<DeliveryStatus, …>` dan `npx tsc --noEmit` bersih.
- [ ] Tidak ada penghitungan ulang harga/aturan di klien untuk hal yang server sudah putuskan.
- [ ] Jalankan di emulator Android sungguhan. Screenshot layarnya.

**Proses**
- [ ] ≥8 mutasi dijalankan sebelum merge, dicatat satu per satu: apa yang dimutasi, test mana yang mati. Yang **lolos** ditulis juga, beserta test baru yang kamu tambahkan untuk membunuhnya.
- [ ] Satu entri `AUDIT-LOG.md` memakai template `AUDIT-PLAN.md:610-636`: *What changed* (dengan `path/file.ts:LINE`), *Verification* (tsc/lint/test ketiga repo **plus** apa yang kamu uji manual), *Decisions made*, *Deviations*, `### Left undone / follow-ups`, *Next*.
- [ ] `INTEGRATION.md` diperbarui kalau kontrak wire berubah.
- [ ] Satu halaman perbandingan alternatif (tabel §12.12), dengan minimal 4 dari 7 baris terisi angka nyata dari mesinmu.
- [ ] Demo langsung: backend jalan → tekan tombol di admin → lihat perubahannya di app Android, dalam satu rekaman layar tanpa potongan.

**Cara ia GAGAL di depan mata** — kalau salah satu ini terjadi, capstone belum selesai: dua request bersamaan sama-sama sukses; tombol Back menghapus filter; entri `AUDIT-LOG` tidak punya `Left undone` (tidak mungkin nol — kalau kamu merasa nol, kamu belum melihat cukup dalam); ada mutasi yang lolos dan tidak ditutup; atau app Android menampilkan tanggal yang berbeda dari yang tersimpan di database.

---

## Gerbang keluar

Jawab tanpa membuka kode. Kalau ada yang belum bisa, **jangan lanjut ke Fase 13**.

**1. Sebutkan empat rumah state di klien, dan untuk masing-masing satu properti yang HILANG kalau kamu menaruhnya di rumah yang salah.**

<details><summary>Jawaban</summary>

(1) **Session → Redux**: yang hilang kalau di `useState` adalah kemampuan menulisnya dari **luar React** (`api/client.ts` saat 401) dan mem-*preload*-nya di test. (2) **Server state → `useApi`**: kalau ditaruh di store global, yang hilang adalah kematian otomatis saat halaman unmount, dan `RootState` terisi state loading per-halaman. (3) **View state → URL**: kalau di `useState`, hilang tiga properti — share-able, refresh-safe, dan sinkron dengan tombol Back. (4) **Ephemeral UI → `useState` lokal**: kalau di store global, ia hidup lebih lama dari komponennya, jadi error dialog lama muncul di dialog baru.
</details>

**2. Kenapa `refreshInFlight` (single-flight) ada, dan apa yang persisnya rusak tanpa itu?**

<details><summary>Jawaban</summary>

Karena backend **merotasi** refresh token: setiap `/auth/refresh` yang sukses membakar token lama. `DeliveryDetailPage` menembakkan dua `useApi` bersamaan; kalau keduanya kena 401 dan masing-masing memanggil refresh, panggilan kedua memakai token yang sudah dibakar → gagal → sesi mati padahal seharusnya hidup. Single-flight membuat semua pemanggil me-`await` satu promise yang sama.
</details>

**3. `NAV_ITEMS` mencegah kelas bug apa — dan kenapa ia BUKAN mekanisme keamanan?**

<details><summary>Jawaban</summary>

Kelas bug: nav dan guard menyimpang. Sebelumnya sidebar difilter per-role tapi rute tidak dijaga, jadi AGENT mendarat di `/` (Dashboard ADMIN-only) dan kena 403 permanen tanpa entri sidebar yang menjelaskan. Dengan satu daftar, "mendaftarkan halaman ke sidebar" **adalah** "menjaga rutenya". Ia bukan keamanan karena gerbang otoritatif selalu `RolesGuard` di backend; guard klien hanya mencegah operator mendarat di halaman yang pasti 403 (`README.md:39-40`).
</details>

**4. Kenapa duplikasi aturan backend di `deliveryActions` boleh, sementara duplikasi aturan role di klien tidak boleh dianggap keamanan? Apa bedanya?**

<details><summary>Jawaban</summary>

Bedanya adalah **arah kegagalan**. Kalau `deliveryActions` basi, kegagalan terburuknya adalah tombol mati yang seharusnya hidup, atau request yang pasti ditolak dan `409`-nya tampil di dialog — bukan operasi ilegal yang lolos, karena server tetap otoritatif. Cermin aman kalau ia hanya bisa gagal ke arah lebih ketat atau ke arah "server menolak". Yang tidak boleh adalah cermin yang jadi satu-satunya penjaga.
</details>

**5. Bug `d67ac40` (Refresh tidak memuat ulang command history) — kenapa TanStack Query membuatnya mustahil, dan kenapa repo ini tetap tidak memakainya?**

<details><summary>Jawaban</summary>

Mustahil karena invalidasi berbasis key: `invalidateQueries(['delivery', id])` menyegarkan **semua** query di bawah key itu, jadi tidak ada daftar manual yang bisa ketinggalan satu entri. Repo tidak memakainya karena fitur unggulan react-query (cache, `staleTime`, background refetch) bernilai rendah atau berbahaya di konsol yang datanya operasional dan harus selalu segar — dan `useApi` cuma 37 baris. Itu keputusan yang masuk akal, dan tetap punya harga; harganya adalah bug ini.
</details>

**6. Ceritakan rantai bug penjadwalan senyap dari picker mobile sampai drone berangkat. Berapa titik di rantai itu yang mengembalikan error?**

<details><summary>Jawaban</summary>

Mobile mengirim `"Jul 30, 2026"` + `"09:30 AM"` → DTO backend (saat itu) tidak memvalidasi bentuknya → `ISO_DATE` tidak cocok dengan `.slice(0,10)`, `HH_MM` gagal karena anchor `$` pada `" PM"` → `computeScheduledFor()` mengembalikan `null` → `leadMs = 0` → `isScheduled = false` → status `PENDING` → dispatch segera. **Nol** titik yang mengembalikan error: responsnya `201`, dan `new Date("Jul 30, 2026")` kebetulan parse sehingga data tersimpan terlihat benar.
</details>

**7. Apa dua aturan anti-menipu-diri pada harness mutation testing repo ini, dan kenapa keduanya ada?**

<details><summary>Jawaban</summary>

(1) *"a run that executed zero tests is a failure rather than a pass"* — karena run yang tidak menjalankan test apa pun akan terlihat seperti "tidak ada yang merah", yaitu skor sempurna palsu. (2) *"Each edit asserts its anchor text occurs exactly once"* — karena kalau teks yang mau dimutasi tidak ditemukan (atau ditemukan di dua tempat), mutasinya tidak benar-benar diterapkan, dan test yang hijau akan dicatat sebagai "mutasi tertangkap" padahal tidak ada yang dirusak.
</details>

**8. Apa isi wajib sebuah entri `AUDIT-LOG.md`, dan aturan apa yang berlaku pada entri lama?**

<details><summary>Jawaban</summary>

Delapan bagian: header (Date/Session/Branch), *What changed* (dengan `path:LINE`), *Verification* (tsc/lint/test **plus** verifikasi manual), *Decisions made*, *Deviations from the plan*, *Left undone / follow-ups*, *Next*. Aturannya: **jangan pernah menulis ulang entri lama** — tambahkan entri koreksi. Kalau rencananya yang salah, perbaiki `AUDIT-PLAN.md` **dan** catat perubahannya di *Deviations* supaya ketidaksepakatannya terlihat.
</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| Setelah `F5` di admin, kamu terlempar ke `/login` sekejap lalu balik lagi | Initial state Redux tidak membaca token secara sinkron, jadi `status` sudah `'unauthenticated'` sebelum `loadCurrentUser` selesai | Buka `authSlice.ts:24-29`. Ubah sementara `getToken() ? 'loading' : 'unauthenticated'` jadi `'unauthenticated'` saja, reload, dan lihat kedipnya muncul. Versi mobilnya: `isLoading: true` di `AuthContext.tsx:25` + `if (isLoading) return;` di `app/_layout.tsx:51`. |
| Sesi mati acak setelah beberapa menit menganggur, padahal refresh token masih valid | Dua request paralel sama-sama memicu `/auth/refresh`; token dirotasi, panggilan kedua memakai token yang sudah dibakar | Buka DevTools → Network, filter `refresh`. Kalau muncul **dua** dalam satu burst, guard `refreshInFlight` (`client.ts:107`) tidak bekerja. Reproduksi paling mudah di `DeliveryDetailPage` yang punya dua `useApi`. |
| Halaman detail menampilkan status baru tapi command history tetap basi setelah Refresh | Persis bug `d67ac40`: tombol Refresh cuma memanggil satu dari dua `refetch` | Baca `DeliveryDetailPage.tsx:140-147`. Cara umum memeriksanya di halamanmu sendiri: hitung berapa `useApi` yang dipanggil halaman itu, lalu hitung berapa yang di-`refetch` tombol Refresh. Angkanya harus sama. |
| Test halaman hijau, tapi fiturnya tidak bekerja di browser | Mock di chokepoint (`vi.mock('../../api/client')`) melewati seluruh `client.ts`, jadi unwrap envelope, 401, dan single-flight **tidak pernah teruji** | Ini bukan hipotesis: `AUDIT-PLAN.md:64-67` mencatat 1.073 test hijau atas fitur yang tidak bisa dijangkau, dan `AUDIT-LOG.md:2219-2225` mencatat 94 test hijau atas aplikasi yang tidak bisa boot. Verifikasi: jalankan alurnya manual sekali, lalu tulis apa yang kamu lakukan di *Verification*. |
| Delivery "terjadwal" berangkat sekarang, tapi `pickupDate` di database terlihat benar | Klien mengirim string tampilan, bukan wire format; parser backend menyerah dan `null` diperlakukan sebagai "berangkatkan sekarang" | `Drovery_Mobile/features/delivery/utils/pickupDateTime.ts:1-17` dan rantai lengkapnya di `AUDIT-PLAN.md:247-255`. Verifikasi cepat: `curl` `POST /deliveries` dengan `pickupDate: "Aug 30, 2026"` dan lihat status yang tersimpan. |
| Tanggal yang dipilih user meleset satu hari | `toISOString().slice(0,10)` dipakai untuk membentuk wire date; ia mengonversi ke UTC dulu, dan kamu di UTC+7 | `pickupDateTime.ts:29-40`. Verifikasi: set jam device ke 06:00 pagi, pilih tanggal hari ini, dan lihat apa yang terkirim. |
| Status baru dari backend dirender sebagai "Pending"/step 0 di app | Union `DeliveryStatus` di mobile belum ditambah, atau ada `switch` dengan `default` yang menelan status asing | `Drovery_Mobile/services/deliveryStatus.ts:3-10`. Verifikasi: tambahkan status ke union dan jalankan `npx tsc --noEmit` — kalau ada `Record<DeliveryStatus, …>`, compiler akan menunjuk semua tempat yang harus ditangani. |
| Module baru sudah ditulis, semua test hijau, tapi aplikasi tidak boot / endpoint 404 | Module lupa di-import di `AppModule` atau di module induknya — wiring tidak diuji test unit mana pun | `AUDIT-LOG.md:2219-2225`. Verifikasi: jalankan `npm run start:dev` dan `curl` endpoint-nya. Lalu tulis spec level module yang mengompilasi graph-nya, meniru `admin.module.spec.ts`. |
| Mutation testing "sempurna" (semua mutasi tertangkap) tapi kamu ragu | Mutasi tidak benar-benar diterapkan (anchor text tidak ditemukan), atau run mengeksekusi nol test | `AUDIT-LOG.md:2069-2074`. Verifikasi: setelah setiap edit mutasi, `grep` teksnya untuk memastikan berubah, dan baca angka "Tests: N passed" — bukan cuma warna outputnya. |

---

## Bacaan pendamping

Semua di dalam repo. Cari **kenapa**-nya, bukan **apa**-nya.

- `Drovery_Admin/README.md:37-44` — tiga paragraf yang membagi tanggung jawab auth, API, dan state. Cari kalimat *"The authoritative gate is always the backend `RolesGuard`"* dan *"Redux Toolkit holds the auth session; server data is fetched per-page"*.
- `Drovery_Admin/src/hooks/useListParams.ts:4-14` — bug report yang ditulis ulang sebagai docstring. Cari tiga kerugian konkret yang disebut, dan pakai bentuk kalimat itu untuk docstring-mu sendiri.
- `Drovery_Admin/src/layout/RequireRole.tsx:7-18` — docstring paling informatif di repo admin. Cari kalimat *"Rather than showing them an error, send them where they can actually work"* — itu prinsip UX yang bisa kamu bawa ke mana-mana.
- `Drovery_Admin/src/pages/Deliveries/DeliveryDetailPage.tsx:140-143` — post-mortem bug `d67ac40` dalam empat baris. Cari kalimat tentang dispatcher yang mengirim command kedua ke pesawat yang sudah patuh.
- `Drovery_Mobile/app/_layout.tsx:8-42` — dua bug navigasi/auth yang digabung jadi satu mekanisme. Cari kalimat *"when auth state and the current route disagree, the route moves"* dan alasan `""` sengaja tidak dianggap publik.
- `Drovery_Mobile/features/delivery/utils/pickupDateTime.ts:1-17` — komentar bug terbaik di ketiga repo. Cari kalimat *"the value we HOLD and SEND is always the wire format"*.
- `Drovery_Backend/INTEGRATION.md:56-74` — kontrak envelope yang dipegang tiga repo. Cari catatan bahwa **tidak ada** `meta` pagination, karena itu yang paling sering salah ditebak.
- `Drovery_Backend/AUDIT-PLAN.md:62-71` (§1.1) — alasan repo ini menolak "test hijau" sebagai bukti. Cari angka 1.073 dan kalimat tentang `supportApi.createTicket`.
- `Drovery_Backend/AUDIT-PLAN.md:603-644` (§5) — template `AUDIT-LOG` + aturan mainnya. Cari *"Never rewrite a past entry"*.
- `Drovery_Backend/AUDIT-LOG.md:2236-2260` — contoh `### Left undone` yang benar. Cari kalimat *"Failing closed is right; reusing a non-retryable code for a transient cause is the flaw"* sebagai model cara mengakui cacat tanpa membatalkan keputusannya.
- `Drovery_Backend/src/deliveries/delivery-schedule.ts:10-22` — sisi backend dari kontrak pickup. Cari alasan regex-nya diekspor dari file yang sama dengan parser-nya.

Dokumentasi eksternal, hanya kalau benar-benar perlu:

- [Redux Toolkit — `createAsyncThunk`](https://redux-toolkit.js.org/api/createAsyncThunk) — untuk memahami tiga action (`pending`/`fulfilled`/`rejected`) dan `rejectWithValue`.
- [React Router — data router & layout routes](https://reactrouter.com/start/data/routing) — untuk bentuk `createBrowserRouter` dan rute tanpa `path`.
- [Testing Library — `getByRole` priority](https://testing-library.com/docs/queries/about#priority) — untuk memahami kenapa query berbasis role didahulukan atas `data-testid`.

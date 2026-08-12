# Peta Belajar — `admin:vite-react-console` (Drovery_Admin)

**Repo:** `/home/darth-zelantus/Documents/Project_Pribadi/Drovery_Admin`
**Stack (dari `package.json` + `README.md:12`):** Vite 7 · React 19 · TypeScript · MUI 7 · Redux Toolkit 2 · react-router 7 · Vitest 4
**Total kode:** ~6.300 baris, 12 halaman/dialog, 9 file test.

---

## Orientasi 60 detik

Ini adalah **operator console** — bukan aplikasi konsumen. Bedanya penting untuk memahami setiap
keputusan teknis di repo ini:

- Datanya **selalu basi** (delivery lagi terbang, tiket support lagi diketik). Jadi hampir semua
  halaman punya tombol **Refresh** manual, bukan cache pintar.
- Penggunanya **staff**, jumlahnya sedikit, jaringannya bagus, browsernya desktop. Jadi bundle size
  bukan prioritas nomor satu — tapi tetap di-code-split (`vite.config.ts:17`).
- **Backend adalah otoritas**, UI cuma cermin. Kalimat ini muncul harfiah tiga kali di kode:
  `README.md:40` ("The authoritative gate is always the backend `RolesGuard`"),
  `deliveryActions.ts:22-25`, dan `DeliveryDetailPage.tsx:382` ("the server makes the final call").
  Ini kunci untuk paham kenapa `deliveryActions()` ada tapi tidak "mengamankan" apa pun.

Anda datang dari Ionic React + Capacitor. Yang **sudah** Anda kuasai dan tinggal dipakai ulang:
JSX, hooks, TypeScript, `fetch`, controlled form. Yang **baru**: Redux Toolkit, data-router
react-router 7, MUI `sx`, dan cara build SPA jadi image Docker yang dilayani nginx.

Rantai entry point-nya lurus:

```
index.html:11  →  src/main.tsx  →  src/App.tsx  →  src/router/router.tsx  →  pages/*
                  (Provider store)  (ThemeProvider + RouterProvider)  (ProtectedRoute → AppLayout → Outlet)
```

---

## 1. Bentuk proyek Vite + TypeScript (rantai entry point)

- **Prasyarat:** —
- **Anchor:**
  - `index.html:11` — `<script type="module" src="/src/main.tsx">`. Di Vite, **HTML adalah entry
    point**, bukan hasil generate. Bandingkan Ionic React CLI yang menyembunyikan ini.
  - `src/main.tsx:9-15` — `createRoot(...).render(<StrictMode><Provider store={store}><App/></Provider></StrictMode>)`.
    Tiga lapis pembungkus, urutannya bermakna: `Provider` (Redux) harus di luar `App` karena `App`
    memanggil `useAppDispatch`.
  - `src/App.tsx:26-31` — `ThemeProvider` → `CssBaseline` → `RouterProvider`.
  - `src/api/client.ts:10-11` — `import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1'`.
  - `tsconfig.app.json` baris `"erasableSyntaxOnly": true` — dan lihat konsekuensinya di
    `src/models/enums.ts:1-6`.
- **Kenapa dipakai di sini:**
  Vite dipilih karena repo ini adalah **SPA murni tanpa server sendiri** — Dockerfile-nya berakhir di
  `nginx` (`Dockerfile:14-16`), bukan di proses Node. Tidak ada SSR, tidak ada API route, jadi
  seluruh nilai tambah framework fullstack hilang dan yang tersisa cuma dev-server cepat + bundler.
  `import.meta.env` adalah **build-time replacement**, bukan runtime lookup: nilainya di-inline saat
  `vite build`. Konsekuensinya ada di `Dockerfile:10` — `ARG VITE_API_BASE_URL=/api/v1` harus
  ditentukan **sebelum** `npm run build`, tidak bisa diubah lewat env var container saat runtime.
  Komentar `enums.ts:1-2` menjelaskan `erasableSyntaxOnly`: TS `enum` menghasilkan JS runtime
  (object lookup dua arah), yang dilarang flag ini, jadi seluruh enum backend di-mirror sebagai
  **string-literal union + const array**. Ini kenapa Anda melihat `export type Role = 'USER' | 'AGENT' | 'ADMIN'`
  berpasangan dengan `export const ROLES: Role[] = [...]` — union untuk type-checking, array untuk
  iterasi di `<Select>` (`UsersListPage.tsx:89`).
- **Alternatif:**
  - **Create React App / Webpack** — dev server 10-30x lebih lambat pada proyek sebesar ini (Vite
    pakai native ESM + esbuild untuk dep pre-bundling); CRA sudah deprecated sejak 2023.
  - **Next.js** — dapat SSR/RSC, tapi butuh proses Node hidup di produksi; hilang properti
    "satu image statis, jalan di domain mana pun tanpa rebuild" yang jadi alasan `Dockerfile:7-9`.
  - **Parcel / Rspack** — zero-config (Parcel) atau kompatibel Webpack-plugin (Rspack), tapi ekosistem
    plugin Vite (termasuk Vitest yang **berbagi config yang sama**, lihat `vite.config.ts:1`) jauh
    lebih matang.
  - **TS `enum` biasa** — lebih ringkas, tapi menambah kode runtime dan tidak bisa di-tree-shake;
    `const enum` malah tidak kompatibel dengan bundler yang transpile per-file.
- **Latihan:**
  Jalankan `npm run dev`, buka DevTools → Network. Bandingkan jumlah request file saat dev
  (ratusan modul ESM mentah) vs `npm run build && npm run preview` (segelintir chunk).
  Lalu ubah `VITE_API_BASE_URL` di `.env`, jalankan `npm run build`, dan `grep -r "localhost:3000" dist/`
  — buktikan sendiri bahwa nilainya **di-inline ke dalam bundle**, bukan dibaca saat runtime.

---

## 2. Typed fetch client + API envelope (`apiFetch`, `ApiEnvelope`, `ApiError`)

- **Prasyarat:** Konsep 1
- **Anchor:**
  - `src/models/api.ts:1-27` — komentar di atas file menjelaskan kontraknya: sukses dibungkus
    `TransformInterceptor` jadi `{ success, data }`, error **melewati** interceptor jadi
    `{ statusCode, message }` datar (dan `message` bisa `string[]` untuk validation 400).
  - `src/api/client.ts:86-128` — `apiFetch<T>`. Perhatikan baris terakhir: `return (json as ApiEnvelope<T>).data`
    — satu-satunya tempat envelope dibuka, sehingga **semua kode lain bekerja dengan `T` polos**.
  - `src/api/client.ts:39-46` — `extractMessage`, khusus menangani `message` berupa array.
  - `src/api/client.ts:26-37` — `buildUrl`, membuang query param yang `undefined` atau `''`.
  - `src/api/admin.ts:25-75` — objek `adminApi`: satu method per endpoint mutasi.
- **Kenapa dipakai di sini:**
  `README.md:41-42` menyebut alasannya eksplisit: *"a typed `fetch` wrapper that unwraps the
  `{ success, data }` success envelope and throws a readable `ApiError` (with status) on failure."*
  Nilai desainnya: karena `apiFetch` adalah **satu-satunya jalur keluar** ke jaringan, seluruh
  cross-cutting concern bisa dipasang di satu titik — bearer token (`client.ts:93-94`), refresh
  otomatis (`client.ts:102-118`), unwrap envelope, normalisasi error. Bonus yang terlihat di test:
  komentar `DeliveryDetailPage.test.tsx:8-9` menyebutnya *"the single chokepoint"* — cukup
  `vi.mock('../../api/client')` satu kali dan **seluruh** read + mutation halaman itu ter-mock.
  Bandingkan kalau tiap komponen memanggil `fetch` sendiri: mock-nya jadi global `fetch` stub yang rapuh.
  `ApiError` sengaja class (bukan objek biasa) supaya `e instanceof ApiError` bisa dipakai sebagai
  type guard — pola ini dipakai di `useApi.ts:39`, `useMutation.ts:30`, dan `authSlice.ts:31-32`.
- **Alternatif:**
  - **axios** — punya interceptor built-in, `baseURL`, dan auto-JSON; tapi +13 KB gzip dan di sini
    yang dibutuhkan cuma ~50 baris. Interceptor axios juga lebih sulit di-mock per-path di Vitest.
  - **ky / wretch** — wrapper `fetch` yang lebih tipis dari axios dengan retry bawaan; tetap
    tidak tahu bentuk envelope `{ success, data }` yang spesifik backend ini, jadi tetap butuh lapisan sendiri.
  - **openapi-typescript + openapi-fetch (atau `orval`)** — generate client + tipe langsung dari
    Swagger backend NestJS. Trade-off: tipe **selalu sinkron** dengan server (hilang risiko
    `models/admin.ts` basi — file itu sekarang di-maintain manual, lihat komentarnya di `admin.ts:1-3`
    *"mirror of src/admin/dto/admin-response.dto.ts"*), tapi menambah langkah codegen ke CI dan
    file generated yang besar.
  - **tRPC** — type-safety end-to-end tanpa codegen, tapi mengharuskan backend TypeScript dengan
    router tRPC; backend ini NestJS + REST + Swagger, jadi tidak berlaku.
- **Latihan:**
  Tambahkan method `deleteDrone(id: string)` ke `fleetApi` (`src/api/admin.ts:81-92`) yang memanggil
  `DELETE /admin/drones/:id`. **Perhatikan jebakan:** `fleetApi.create` dan `fleetApi.update`
  menulis `body: JSON.stringify(body)`, padahal `apiFetch` **sudah** melakukan `JSON.stringify`
  sendiri di `client.ts:99` → body-nya double-encoded jadi JSON string, bukan object. Test
  `FleetListPage.test.tsx:105` tidak menangkapnya karena `apiFetch` di-mock. Perbaiki, lalu tulis
  test di level `client.ts` (mock `globalThis.fetch`, bukan `apiFetch`) yang membuktikan body yang
  terkirim adalah `{"serial":"..."}` dan bukan `"{\"serial\":...}"`.

---

## 3. MUI theming + sistem `sx`

- **Prasyarat:** Konsep 1
- **Anchor:**
  - `src/theme/theme.ts:4-20` — seluruh tema muat dalam 17 baris. Komentar barisnya:
    *"a calm, dense dashboard palette."*
  - `src/theme/theme.ts:16-19` — `components: { MuiCard: { defaultProps: { variant: 'outlined' } }, MuiButton: { defaultProps: { disableElevation: true } } }`.
    Ini pola paling penting: **default per-komponen** menggantikan puluhan prop berulang.
  - `src/App.tsx:27-28` — `<ThemeProvider theme={theme}><CssBaseline />`.
  - `src/layout/AppLayout.tsx:42` — `zIndex: (t) => t.zIndex.drawer + 1`, contoh `sx` sebagai
    **fungsi dari theme**.
  - `src/pages/Dashboard/DashboardPage.tsx:69-78` — `sx` responsif:
    `gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }`.
  - `src/models/enums.ts:139-153` — `StatusTone` → `ChipColor`, memetakan status domain ke warna MUI.
- **Kenapa dipakai di sini:**
  Console ini butuh ~30 komponen yang **tidak ingin ditulis sendiri**: `Table` + `TablePagination`,
  `Dialog` dengan focus-trap, `Select` yang render ke portal, `Drawer` permanen, `Alert` dengan slot
  action. Semuanya sudah aksesibel (peran ARIA benar) — dan test repo ini **bergantung** pada itu:
  `LoginPage.test.tsx:26-28` query pakai `getByRole('textbox')`, `DeliveryDetailPage.test.tsx:134`
  pakai `getByRole('combobox', { name: /Command/i })`. Aksesibilitas gratis inilah pembayaran
  nyata dari MUI, bukan tampilannya.
  Perhatikan juga bahwa tema ini **tidak** mendefinisikan dark mode (`palette.mode: 'light'` di
  `theme.ts:6`) — keputusan sadar untuk alat internal.
  Yang menarik: warna status **tidak** hard-coded di komponen. `deliveryStatusTone()`
  (`enums.ts:155-172`) memetakan status domain → tone semantik, lalu `TONE_COLOR` (`enums.ts:143-149`)
  memetakan tone → nama warna MUI. Dua lapis, supaya mengganti palet tidak menyentuh logika domain.
- **Alternatif:**
  - **Tailwind CSS (+ shadcn/ui)** — bundle CSS akhir jauh lebih kecil (purge), tidak ada runtime
    CSS-in-JS. Trade-off: shadcn adalah **copy-paste source**, jadi `Table` + pagination + `Select`
    portal harus Anda rakit dan uji aksesibilitasnya sendiri — di console yang isinya 6 tabel + 4
    dialog, itu kerja berminggu-minggu.
  - **Chakra UI / Mantine** — API mirip MUI (`sx`-like props), Mantine punya `DataTable` dan
    date-picker lebih baik. MUI menang di kelengkapan `DataGrid`/enterprise dan ukuran ekosistem.
  - **Ant Design** — paling "admin console"-native (Table dengan sort/filter/resize bawaan),
    tapi bahasa desainnya sangat opinionated dan tema kustomnya lebih kaku.
  - **CSS Modules / vanilla-extract polos** — nol runtime, tapi berarti membangun ulang seluruh
    lapisan komponen.
  - **Ionic React** (yang Anda tahu) — dioptimalkan untuk pola mobile (`IonPage`, `IonList`,
    navigasi stack); tidak punya tabel data padat, drawer permanen desktop, atau dialog
    multi-field. Salah alat untuk console desktop.
- **Latihan:**
  Tambahkan `mode: 'dark'` palette ke `theme.ts` dan sebuah tombol toggle di `AppLayout` toolbar
  (simpan pilihannya di `localStorage`). Anda akan menemukan bahwa `MessageBubble`
  (`SupportTicketDetailPage.tsx:60`) memakai `bgcolor: 'grey.100'` — nilai hard-coded yang rusak di
  dark mode. Ganti ke token semantik (`action.hover` / `background.paper`) dan jelaskan kenapa
  token semantik lebih tahan tema daripada nama skala warna.

---

## 4. Redux Toolkit — store, slice, typed hooks

- **Prasyarat:** Konsep 1, 2
- **Anchor:**
  - `src/app/store.ts:5-12` — `configureStore({ reducer: { auth: authReducer } })` lalu
    `export type RootState = ReturnType<typeof store.getState>` — **tipe di-infer dari store**,
    bukan ditulis manual. Ini yang membuat menambah slice baru otomatis memperluas `RootState`.
  - `src/app/hooks.ts:5-7` — `useDispatch.withTypes<AppDispatch>()` / `useSelector.withTypes<RootState>()`,
    API react-redux v9 (menggantikan pola lama `useSelector: TypedUseSelectorHook<RootState>`).
  - `src/features/auth/authSlice.ts:68-109` — `createSlice` dengan `reducers` (sinkron) dan
    `extraReducers` (async thunk).
  - `src/features/auth/authSlice.ts:73-78` — `sessionExpired(state) { state.user = null; ... }`.
    Ini **terlihat** seperti mutasi — di sinilah Immer bekerja: RTK membungkus reducer dengan
    `produce()` sehingga mutasi pada draft menghasilkan objek baru.
  - Pemakaian: `ProtectedRoute.tsx:15` (`useAppSelector((s) => s.auth)`),
    `AppLayout.tsx:29` (`s.auth.user`), `RequireRole.tsx:20`, `LoginPage.tsx:20`.
- **Kenapa dipakai di sini:**
  `README.md:43-44` menyatakan pembagian tugasnya dengan tegas:
  > *"**State** — Redux Toolkit holds the auth session; server data is fetched per-page via the `useApi` hook."*

  Jadi Redux di repo ini **hanya** memegang satu hal: sesi auth. Dan itu memang kandidat sempurna
  untuk global store karena tiga sifat: (a) dibaca oleh komponen yang tersebar jauh dan tidak
  sekeluarga — `ProtectedRoute`, `RequireRole`, `AppLayout`, `LoginPage`; (b) ditulis dari **luar**
  React — `client.ts:116` memanggil `unauthorizedHandler?.()` dari dalam sebuah `fetch` catch,
  yang di-wire ke `dispatch(sessionExpired())` di `App.tsx:19-21`; (c) perlu di-**preload** untuk
  test (`renderWithProviders.tsx:28-31` memakai `preloadedState`).
  Poin (b) adalah argumen terkuatnya dan sering terlewat: dengan Context, memanggil setter dari
  modul non-React seperti `api/client.ts` butuh trik (ref global / event emitter). Dengan Redux,
  `store.dispatch` adalah fungsi biasa yang bisa dipanggil dari mana saja.
  Perhatikan juga `store.ts` **tidak** mendaftarkan middleware apa pun — tidak ada RTK Query,
  tidak ada saga. Ini bukti bahwa Redux di sini sengaja dijaga tetap kecil.
- **Alternatif — kapan Redux Toolkit menang, kapan kalah:**
  - **React Context + `useReducer`** — nol dependency, cukup untuk state yang jarang berubah seperti
    ini. **Kalah** karena: setiap perubahan context me-rerender **semua** consumer (tidak ada
    selector granular), tidak ada DevTools time-travel, dan sulit dipanggil dari luar React
    (kasus `setUnauthorizedHandler` di atas). Untuk *hanya* auth, Context sebenarnya pilihan
    yang sangat masuk akal — RTK di sini agak "berlebih", dan itu jujur harus dikatakan.
  - **Zustand** — ~1 KB, tanpa boilerplate provider, `useStore(s => s.user)` sudah granular, dan
    `store.getState()`/`store.setState()` bisa dipanggil dari luar React (menyelesaikan poin (b)
    dengan cara yang sama). **Kalah** di: DevTools kurang kaya, dan konvensi tim lebih longgar
    (mudah jadi berantakan di tim besar).
  - **TanStack Query (react-query)** — **menang telak** untuk *server state* (daftar delivery, tiket,
    promo), tapi **tidak menggantikan** Redux untuk sesi auth: token/user bukan hasil query yang
    perlu cache-invalidation, melainkan state klien. Aturan praktis yang tepat di repo ini:
    *server state → react-query; client state (sesi, UI, form) → Redux/Zustand/Context.*
    Repo ini memilih `useApi` buatan sendiri untuk sisi server (lihat Konsep 8) — di situlah
    react-query akan paling banyak menambah nilai.
  - **RTK Query** — bagian dari `@reduxjs/toolkit` yang **sudah** terinstal, jadi nol dependency
    tambahan; menghapus `useApi`, `useMutation`, dan semua `refetch()` manual. **Trade-off:**
    kurva belajar `createApi`/`tagTypes` lebih curam daripada 50 baris `useApi.ts`, dan cache-nya
    justru tidak diinginkan di console yang datanya harus selalu segar.
  - **Jotai / Recoil** — model atom, bagus untuk state UI yang sangat granular; berlebihan untuk
    satu objek sesi.
- **Latihan:**
  Tambahkan slice kedua `uiSlice` dengan satu field `sidebarCollapsed: boolean` + action
  `toggleSidebar`. Daftarkan di `store.ts`, konsumsi di `AppLayout.tsx` untuk menyempitkan
  `DRAWER_WIDTH` (baris 22). Lalu **buktikan typed hooks bekerja**: ketik `useAppSelector((s) => s.ui.sidebarColapsed)`
  (typo sengaja) dan lihat TypeScript menolaknya tanpa Anda menulis satu anotasi tipe pun —
  karena `RootState` di-infer dari `store.getState()`.

---

## 5. `createAsyncThunk` + siklus hidup sesi (login → refresh → logout)

- **Prasyarat:** Konsep 2, 4
- **Anchor:**
  - `src/features/auth/authSlice.ts:37-53` — thunk `login`: POST `/auth/login` → `setTokens(...)`
    → **lalu** `GET /users/me`. Komentar `authSlice.ts:34-36` menjelaskan kenapa dua request:
    response login tidak memuat `role` (lihat `models/auth.ts:4-8` vs `:11-17`), padahal `role`
    adalah yang menentukan seluruh navigasi.
  - `src/features/auth/authSlice.ts:24-29` — `status: getToken() ? 'loading' : 'unauthenticated'`.
    **initial state membaca localStorage secara sinkron** — inilah yang membuat reload halaman tidak
    berkedip ke `/login`.
  - `src/features/auth/authSlice.ts:83-107` — `extraReducers` menangani `pending/fulfilled/rejected`
    dari kedua thunk. Tiga action untuk satu thunk adalah inti `createAsyncThunk`.
  - `src/features/auth/authSlice.ts:113-132` — `logout`: revoke refresh token di server dulu
    (*best-effort*), lalu `dispatch(sessionExpired())`. Komentarnya: *"a failed revoke still clears the client."*
  - `src/api/client.ts:48-74` — **single-flight refresh**. Komentar `client.ts:48-49`:
    *"a burst of concurrent 401s triggers exactly ONE `/auth/refresh`, and every caller awaits the same result."*
  - `src/api/client.ts:102-118` — kebijakan 401: `/auth/*` bersifat terminal (tidak di-refresh),
    selain itu refresh sekali lalu retry; parameter `retry` mencegah loop.
  - `src/App.tsx:15-24` — wiring: `setUnauthorizedHandler(() => dispatch(sessionExpired()))`
    + bootstrap `loadCurrentUser()`.
  - `src/pages/Login/LoginPage.tsx:30-32` — `login.fulfilled.match(result)`, cara **type-safe**
    mengecek hasil thunk tanpa `try/catch`.
- **Kenapa dipakai di sini:**
  `tokenStorage.ts:1-3` menulis alasan perubahannya: *"a 401 transparently refreshes via the stored
  refresh token, and only a FAILED refresh bounces to /login."* Commit `67b62ff fix(auth): transparent
  session refresh + server-side logout revoke` adalah tempat ini masuk. Masalah yang dipecahkan
  sangat konkret: access token berumur pendek, dan tanpa refresh, operator yang sedang menangani
  antrean delivery gagal akan **dilempar ke /login di tengah kerja**.
  Single-flight (`refreshInFlight`) penting karena `DeliveryDetailPage` menembakkan **dua** `useApi`
  bersamaan (`DeliveryDetailPage.tsx:81` dan `:86`) — tanpa single-flight, dua 401 bersamaan akan
  memicu dua `/auth/refresh`, dan karena backend **merotasi** refresh token, request kedua memakai
  token yang sudah dibakar → gagal → sesi mati padahal seharusnya hidup.
  `client.ts:13-14` juga menjelaskan kenapa memakai callback dan bukan import store langsung:
  *"avoids a circular dependency"* — `authSlice` → `client` → `store` → `authSlice`.
- **Alternatif:**
  - **Thunk manual (`redux-thunk` polos)** — Anda menulis sendiri tiga action type + tiga dispatch.
    `createAsyncThunk` menghasilkannya otomatis dan memberi `rejectWithValue` (dipakai di
    `authSlice.ts:41,51`) supaya pesan error backend sampai ke UI (`LoginPage.tsx:47`).
  - **redux-saga** — generator, lebih kuat untuk orkestrasi kompleks (debounce, race, cancel).
    Berlebihan untuk 3 thunk; kurva belajar generator + effect besar.
  - **Token di `httpOnly` cookie** (bukan `localStorage`) — **lebih aman terhadap XSS**, karena JS
    tidak bisa membaca token. Trade-off nyata di repo ini: WebSocket-nya mengirim token lewat
    query string (`supportSocket.ts:215`), yang mustahil kalau token tidak terbaca JS; dan
    cross-origin cookie butuh `SameSite=None; Secure` + CORS `credentials`. Repo memilih
    `localStorage` (`tokenStorage.ts:1`) demi kesederhanaan dan karena ini alat internal.
  - **Token akses di memori + refresh di cookie** — kompromi populer: XSS tidak bisa mencuri
    refresh token, reload tetap mulus. Biayanya: satu request refresh di setiap page load.
- **Latihan:**
  Tulis test `src/api/client.test.ts` yang membuktikan single-flight: mock `globalThis.fetch`
  supaya endpoint biasa mengembalikan 401 sekali lalu 200, dan `/auth/refresh` mengembalikan
  pasangan token baru; tembakkan **tiga** `apiFetch` bersamaan lewat `Promise.all`; assert
  `/auth/refresh` hanya dipanggil **sekali** dan ketiga promise resolve. Ini test yang belum ada
  di repo dan menjaga invariant paling rapuh di seluruh lapisan auth.

---

## 6. React Router 7 — `createBrowserRouter`, layout route, `Outlet`, `lazy` + `Suspense`

- **Prasyarat:** Konsep 1, 3
- **Anchor:**
  - `src/router/router.tsx:38-57` — tabel rute sebagai **data**, bukan JSX bersarang.
  - `src/router/router.tsx:41-55` — **layout route**: objek `{ element: <ProtectedRoute />, children: [...] }`
    **tanpa `path`**. Ini konsep kunci — sebuah rute yang hanya membungkus, tidak mencocokkan URL.
  - `src/layout/AppLayout.tsx:101-106` — `<Outlet />` di dalam `<Suspense fallback={<PageLoader />}>`.
    Inilah lubang tempat child route dirender.
  - `src/router/router.tsx:9-11` — komentarnya menjelaskan strategi Suspense:
    *"The shell (ProtectedRoute + AppLayout) stays eager; AppLayout wraps `<Outlet/>` in its own
    Suspense, so protected pages load with the nav still visible."*
  - `src/router/router.tsx:29-32` — `withSuspense()` untuk rute **di luar** `AppLayout` (`/login`, `*`),
    yang tidak punya boundary bersama.
  - `src/router/router.tsx:12-27` — 10 `lazy(() => import(...))`, satu per halaman.
  - `src/App.tsx:29` — `<RouterProvider router={router} />`.
  - Hook navigasi: `useNavigate` (`DeliveriesListPage.tsx:37`), `useParams` (`DeliveryDetailPage.tsx:73`),
    `useLocation` (`RequireRole.tsx:21`), `useSearchParams` (`useListParams.ts:43`),
    `<Navigate replace>` (`ProtectedRoute.tsx:32`), `<Link>` (`DeliveriesListPage.tsx:115`).
- **Kenapa dipakai di sini:**
  Bentuk data-router dipilih karena **guard-nya adalah rute**, bukan HOC. `ProtectedRoute` sebagai
  layout route berarti guard dievaluasi **sekali** untuk seluruh subtree, dan `AppLayout` (shell +
  sidebar) tetap ter-mount saat berpindah antar halaman — hanya `<Outlet />` yang berganti. Itulah
  yang membuat kalimat di `router.tsx:11` mungkin: *"protected pages load with the nav still visible."*
  Perhatikan detail aksesibilitas di `DeliveriesListPage.tsx:111-121`: sel ID sengaja memakai
  `<Link>` sungguhan, bukan hanya `onClick`, dengan komentar *"keyboard-reachable, and middle/ctrl-click
  opens the record in a new tab"* — plus `e.stopPropagation()` supaya klik link tidak dobel dengan
  klik baris. Ini contoh bagus "kenapa `<Link>` ≠ `navigate()`".
  Semua rute daftar pakai `replace` (`useListParams.ts:57`) dan semua redirect pakai `<Navigate replace>`
  — supaya tombol Back browser tidak terjebak di rantai redirect.
- **Alternatif:**
  - **`<BrowserRouter>` + `<Routes>`/`<Route>` deklaratif (react-router v6 gaya lama)** — masih
    didukung penuh dan sebenarnya dipakai di test repo ini (`renderWithProviders.tsx:32-38` pakai
    `<Routes>` di dalam `MemoryRouter`). **Kalah** karena tidak bisa memakai fitur data-router
    (`loader`, `action`, `errorElement`) dan tabel rute tidak bisa di-introspeksi sebagai data.
  - **`loader` / `action` react-router 7** — repo ini **tidak memakainya** dan tetap fetch di dalam
    komponen lewat `useApi`. Konsekuensinya: request baru mulai **setelah** chunk halaman selesai
    diunduh dan komponen ter-mount (waterfall). `loader` akan memulai fetch **paralel dengan**
    navigasi. Trade-off: `loader` sulit dipakai bersama Redux-based auth dan menyulitkan
    tombol Refresh manual (butuh `useRevalidator`) — dua hal yang jadi tulang punggung console ini.
  - **TanStack Router** — type-safe route params & search params (persis masalah yang di-`as`-cast
    manual di `DeliveriesListPage.tsx:41`: `filter as DeliveryStatus | ''`). Ekosistem lebih kecil.
  - **Next.js App Router** — routing berbasis file + RSC; lihat bagian Next.js di bawah.
- **Latihan:**
  Tambahkan rute `/fleet/:id` (halaman detail drone). Anda harus menyentuh **tiga** tempat dan akan
  menemukan bahwa dua di antaranya sudah otomatis: (1) `lazy(...)` + entry di `router.tsx`,
  (2) — ternyata `rolesForPath('/fleet/dr-1')` **sudah** mengembalikan `['ADMIN']` berkat pencocokan
  prefix terpanjang di `navItems.tsx:59-65`; buktikan dengan menambah case ke `navItems.test.ts`.
  Lalu ukur efek code-splitting: `npm run build` sebelum dan sesudah, bandingkan daftar chunk di `dist/assets/`.

---

## 7. `ProtectedRoute` + `RequireRole` + `NAV_ITEMS` sebagai satu sumber kebenaran

- **Prasyarat:** Konsep 4, 6
- **Anchor:**
  - `src/layout/ProtectedRoute.tsx:8-12` — docstring-nya menyebut **empat** keadaan:
    loading → spinner; unauthenticated → `/login`; role `USER` → layar "staff only"; selain itu → `<AppLayout />`.
  - `src/layout/ProtectedRoute.tsx:35-49` — kasus `USER`: **bukan** redirect, melainkan layar
    penjelasan + tombol Sign out. Redirect ke `/login` akan membingungkan (dia *sudah* login).
  - `src/layout/RequireRole.tsx:7-18` — docstring paling informatif di repo:
    > *"Without it every authenticated user landed on `/` — the ADMIN-only Dashboard — so an AGENT
    > signing in to work support tickets hit a permanent 403 with nothing in their sidebar to explain it.
    > Rather than showing them an error, send them where they can actually work."*
  - `src/layout/RequireRole.tsx:26-29` — redirect ke `homePathForRole(role)`, dengan proteksi loop:
    `home === pathname ? null : <Navigate .../>`.
  - `src/layout/navItems.tsx:18-28` — docstring: *"Deriving both from this list means a new page
    cannot appear in the nav without a guard, or be guarded differently from how it is advertised."*
  - `src/layout/navItems.tsx:59-65` — `rolesForPath`, **urut dari path terpanjang**, dengan komentar
    *"so '/deliveries/:id' resolves to '/deliveries', not '/'."*
  - `src/router/router.tsx:43-45` — komentar yang menutup lingkaran: *"Allowed roles come from
    NAV_ITEMS, so the sidebar and the guards cannot disagree."*
  - `src/layout/AppLayout.tsx:31-33` — sidebar memfilter dari list yang sama.
  - Test: `src/layout/navItems.test.ts:21-32` dan `ProtectedRoute.test.tsx:21-43`.
  - Sejarahnya di git: `d0eb80a feat(nav): one source of truth for the nav and the route guards`
    → `a4195b2 feat(nav): per-route role guard that redirects instead of 403ing`
    → `042841a fix(nav): guard every protected route` → `8a271e1 refactor(nav): consume the shared nav list`.
- **Kenapa dipakai di sini:**
  Ini pelajaran arsitektur terbaik di seluruh repo, dan **bukan** tentang keamanan. `README.md:40`
  tegas: *"The authoritative gate is always the backend `RolesGuard` — the UI role only decides which
  nav to render."* Guard di klien murni **UX**: mencegah operator mendarat di halaman yang pasti 403.
  Nilai desainnya adalah menghapus satu **kelas** bug, bukan satu bug: sebelumnya nav difilter per-role
  tapi rute tidak dijaga, sehingga keduanya bisa (dan memang) menyimpang. Dengan `NAV_ITEMS` sebagai
  satu-satunya deklarasi, "mendaftarkan halaman ke sidebar" **adalah** "menjaga rutenya". Buktinya
  ada di test `navItems.test.ts:27-32`: *"The nav entry and the route guard come from the same list,
  so adding the page to the sidebar is what guarded it."*
  Perhatikan juga pembagian tanggung jawab dua guard: `ProtectedRoute` menjawab "apakah ada sesi staff?"
  (satu kali, di layout route), `RequireRole` menjawab "boleh masuk halaman **ini**?" (per rute).
  `RequireRole.tsx:23` mengembalikan `null` kalau `!user` dengan komentar *"ProtectedRoute owns the
  unauthenticated case"* — batas tanggung jawab ditulis eksplisit.
- **Alternatif:**
  - **Guard di dalam tiap halaman** (`if (user.role !== 'ADMIN') return <Forbidden/>`) — mudah dilupakan
    saat menambah halaman; persis bug yang di-fix commit `042841a`.
  - **HOC `withRole(Component, ['ADMIN'])`** — setara secara fungsi, tapi daftar role tersebar di 8 file
    alih-alih 1, sehingga nav dan guard bisa menyimpang lagi.
  - **`loader` react-router + `redirect()`** — guard berjalan **sebelum** komponen dirender (tidak ada
    kedip render-lalu-redirect). Trade-off: loader tidak bisa membaca React context/Redux dengan mudah;
    harus membaca `store.getState()` langsung, yang memutus decoupling di `client.ts:13-14`.
  - **Middleware server (Next.js)** — guard jalan di edge, HTML halaman terlarang **tidak pernah terkirim**.
    Ini keunggulan struktural yang tidak bisa ditiru SPA; lihat bagian Next.js.
  - **CASL / `@casl/react`** — permission berbasis ability yang granular (`can('refund', delivery)`),
    berguna kalau aturannya per-objek, bukan per-role. Berlebihan untuk 3 role.
- **Latihan:**
  Tambahkan role keempat `'SUPPORT_LEAD'` ke `models/enums.ts:4-6`, beri akses `/support` **dan**
  `/users` di `NAV_ITEMS`, lalu jalankan `npm test`. Test `navItems.test.ts:48-52` (*"never sends a
  role to a page it cannot open"*) akan mem-verifikasi invariant-nya secara otomatis — **tanpa** Anda
  menulis test baru. Jelaskan kenapa test yang di-loop atas semua role lebih berharga daripada test
  per-role yang di-hardcode.

---

## 8. `useApi` — hook baca data (dan kapan react-query lebih baik)

- **Prasyarat:** Konsep 2, 6
- **Anchor:**
  - `src/hooks/useApi.ts:13-49` — seluruh hook, 37 baris. `{ data, loading, error, refetch }`.
  - `src/hooks/useApi.ts:18,20` — `tick` + `refetch = () => setTick(t => t + 1)`. Trik klasik:
    **memaksa effect jalan ulang lewat state dummy**, karena `[path, tick]` adalah dependency-nya.
  - `src/hooks/useApi.ts:23,43-45` — flag `active` + cleanup. Ini mencegah **race condition**:
    kalau `path` berubah sebelum request lama selesai, response lama tidak akan menimpa yang baru.
  - `src/hooks/useApi.ts:24-29` — komentar + `eslint-disable react-hooks/set-state-in-effect`,
    menjelaskan bahwa reset ke loading saat key berubah **memang disengaja**.
  - **Path sebagai cache key** — `DeliveriesListPage.tsx:43-45`:
    `` useApi(`/admin/deliveries?${toQueryString(page, LIMIT, q, 'status', status)}`) ``.
    Ganti halaman/filter → string path berubah → effect jalan ulang. Tidak ada `useEffect` manual
    di halaman mana pun.
  - Dua `useApi` paralel: `DeliveryDetailPage.tsx:76-86` (delivery + command history).
  - Pola render bertingkat: `DashboardPage.tsx:48-66` — error alert (dengan tombol Retry) →
    `loading && !data` spinner → `data &&` konten. Perhatikan `!data`: saat **re**fetch, data lama
    tetap tampil (tidak berkedip kosong).
- **Kenapa dipakai di sini:**
  `README.md:43-44` menempatkannya sebagai pasangan Redux: *"server data is fetched per-page via the
  `useApi` hook (loading / error / refetch)."* Alasan memilih hook 37 baris ketimbang library:
  console ini **hampir tidak butuh cache**. Datanya operasional dan berubah tiap detik; setiap halaman
  punya tombol **Refresh** eksplisit (`DashboardPage.tsx:43`, `DeliveriesListPage.tsx:77`,
  `UsersListPage.tsx:96`, `FleetListPage.tsx:132`) karena operator **ingin** menarik data terbaru
  secara sadar. Fitur unggulan react-query — cache, dedup, `staleTime`, background refetch — di sini
  justru bernilai rendah atau malah berbahaya (menampilkan status delivery basi).
  Yang **hilang** karena tidak pakai library, dan jujur terlihat di kode:
  - Tidak ada dedup: `DeliveryDetailPage` menembakkan 2 request tiap mount, tanpa berbagi.
  - Invalidasi manual dan rawan lupa — inilah bug yang di-fix `d67ac40 fix(admin): Refresh reloads
    the drone command history too`. Komentarnya di `DeliveryDetailPage.tsx:140-143` layak dibaca utuh:
    > *"The header button used to call `refetch` alone, which reloads the delivery but NOT the drone
    > command history — so a dispatcher watching for an ABORT ack saw PENDING forever and issued a
    > second command to an aircraft that had already obeyed the first."*

    **Ini adalah argumen terkuat untuk react-query di seluruh repo ini.** Dengan
    `invalidateQueries(['delivery', id])`, kelas bug ini tidak bisa terjadi.
  - Tidak ada retry otomatis, tidak ada refetch-on-window-focus.
- **Alternatif:**
  - **TanStack Query (react-query)** — `useQuery({ queryKey, queryFn })` menggantikan `useApi` nyaris
    1:1, plus cache, dedup, retry, `invalidateQueries` yang menghapus kelas bug di atas. **Biaya:**
    ~13 KB, satu `QueryClientProvider` lagi di `main.tsx`, dan `renderWithProviders` harus membungkus
    `QueryClientProvider` dengan `retry: false` untuk test. Untuk console sebesar **ini**, ini adalah
    upgrade yang saya rekomendasikan.
  - **SWR** — lebih kecil (~4 KB), API `useSWR(key, fetcher)` sangat mirip `useApi`. Kalah di
    kemampuan mutasi/invalidasi terstruktur.
  - **RTK Query** — nol dependency baru (sudah ada di `@reduxjs/toolkit`), cache + invalidasi berbasis
    `tagTypes`, dan DevTools Redux menampilkan seluruh siklus request. Kalah di boilerplate awal.
  - **`loader` react-router** — fetch paralel dengan navigasi (hilang waterfall), tapi tombol Refresh
    manual jadi lebih ribet (`useRevalidator`) dan integrasi dengan auth-di-Redux canggung.
  - **`useEffect` + `useState` telanjang di tiap halaman** — apa yang digantikan `useApi`; berarti
    9 salinan logika cleanup/race yang sama.
- **Latihan:**
  Tambahkan opsi `useApi<T>(path, { enabled })` supaya request tidak jalan saat `enabled === false`
  (berguna untuk dependent query). Lalu, latihan besarnya: port **satu** halaman —
  `DeliveryDetailPage` — ke TanStack Query dengan dua `useQuery` dan `queryClient.invalidateQueries`
  di keempat mutasi; hapus `refreshAll()` (`DeliveryDetailPage.tsx:144-147`) dan tunjukkan bahwa
  bug `d67ac40` menjadi **mustahil terulang** secara struktural, bukan karena diingat.

---

## 9. `useMutation` + pola `ConfirmDialog` (sisi tulis)

- **Prasyarat:** Konsep 8
- **Anchor:**
  - `src/hooks/useMutation.ts:12-16` — docstring menjelaskan kontrak kuncinya:
    *"`run` resolves to the result, or `undefined` if the call threw (the error is captured, never
    rethrown), so callers can branch on the result without a try/catch."*
  - `src/hooks/useMutation.ts:23-37` — `run` generic atas `TArgs extends unknown[]`, sehingga
    `useMutation(adminApi.failDelivery)` mewarisi signature `(id, reason?)` persis.
  - Pemakaian: `DeliveryDetailPage.tsx:95-98` — **empat** mutation berdampingan
    (`cancelM`, `failM`, `refundM`, `cmdM`), masing-masing punya `loading`/`error` sendiri.
  - `DeliveryDetailPage.tsx:171-187` — pola pemanggilan: `if (await cancelM.run(d.id)) refresh();`.
    Tanpa `try/catch`, tanpa `.catch()`. Ini buah langsung dari keputusan "never rethrow".
  - `DeliveryDetailPage.tsx:154-169` — `openDialog()` me-`reset()` **semua** mutation dulu, supaya
    error dari aksi sebelumnya tidak nyangkut di dialog berikutnya.
  - `DeliveryDetailPage.tsx:161-166` — detail cerdas: default command dipilih dari
    `actions.canReturnToBase`, dengan komentar *"so confirming without touching the dropdown can't
    send a guaranteed-409 request."* Test-nya `DeliveryDetailPage.test.tsx:103-153`.
  - `src/components/ConfirmDialog.tsx:29-76` — dialog generik dengan slot `children` (kontrol form)
    dan slot `error`. Dipakai 5 kali: cancel/fail/refund/command + change-role (`UsersListPage.tsx:171`).
  - `ConfirmDialog.tsx:45` — `onClose={loading ? undefined : onClose}`: tidak bisa ditutup saat
    request berjalan.
  - `PromosListPage.tsx:63-65` — `const active = mode === 'create' ? createM : updateM;` — dua
    mutation, satu dialog.
- **Kenapa dipakai di sini:**
  Aksi di console ini **destruktif dan tidak bisa dibatalkan** — force-cancel, fail delivery, refund,
  perintah ke drone yang sedang terbang. Karena itu polanya seragam dan ketat:
  tombol → dialog konfirmasi → error tampil **di dalam dialog** (bukan toast yang menghilang) →
  hanya sukses yang menutup dialog dan memicu refetch. `ConfirmDialog.tsx:71` mengganti label jadi
  `"Working…"` saat loading, dan tombol Cancel ikut disabled — mencegah double-submit ke endpoint
  yang idempotensinya bergantung pada backend.
  Bahwa `run` **menelan** error dan mengembalikan `undefined` adalah keputusan yang membuat semua
  callsite jadi satu baris (`if (await m.run(...)) refresh()`). Harganya: kalau Anda lupa memeriksa
  nilai kembaliannya, error hilang senyap — tapi `useMutation` menyimpannya di `error` yang selalu
  dirender oleh `ConfirmDialog`, jadi risikonya tertutup oleh konvensi.
- **Alternatif:**
  - **`useMutation` TanStack Query** — nama & bentuk mirip, plus `onSuccess` untuk invalidasi
    otomatis, retry, dan status `isPending/isError` yang lebih kaya. Kalau Anda mengadopsi
    react-query di Konsep 8, hook ini ikut hilang.
  - **`createAsyncThunk` untuk setiap aksi admin** — konsisten dengan `authSlice`, dan hasilnya
    terlihat di Redux DevTools. **Kalah** karena `loading`/`error` per-aksi harus disimpan di store
    global padahal cakupannya cuma satu dialog — mengotori `RootState` dengan state UI sementara.
  - **`useActionState` React 19** — hook baru untuk form action; cocok kalau mutasi dipicu oleh
    `<form action={...}>`. Di sini pemicu utamanya tombol dialog, bukan submit form, jadi kurang pas
    (kecuali di `LoginPage` dan dialog register aircraft).
  - **Toast/snackbar global untuk error** (mis. `notistack`) — lebih ringkas, tapi untuk aksi
    destruktif, error yang menempel di dialog lebih baik: operator tetap melihat konteksnya dan
    bisa langsung memperbaiki input.
- **Latihan:**
  Sekarang `useMutation` tidak punya `onSuccess`. Tambahkan opsi kedua
  `useMutation(fn, { onSuccess })` dan pakai untuk menghapus pengulangan
  `if (await xM.run(...)) refresh()` di `DeliveryDetailPage.tsx:171-187`. Setelah itu jawab:
  apakah versi ini lebih baik? (Petunjuk: `onSuccess` menciptakan dependency `useCallback` yang
  harus stabil — bandingkan `useMutation.ts:36` yang mem-`useCallback` atas `[fn]`, dan
  `adminApi.forceCancel` yang stabil karena objek modul.)

---

## 10. `useListParams` + `SearchField` — URL sebagai state

- **Prasyarat:** Konsep 6, 8
- **Anchor:**
  - `src/hooks/useListParams.ts:4-14` — docstring yang menyebut masalah aslinya dengan gamblang:
    > *"It used to be `useState` — `useSearchParams` appeared nowhere in the console — so an operator
    > working a failed-delivery queue restarted from page 1 unfiltered after every single record they
    > opened, a refresh lost their place, and nobody could share a link to 'the failed queue, page 3'."*
  - `src/hooks/useListParams.ts:45` — `const page = Math.max(0, Number(sp.get('page') ?? '1') - 1);`
    URL 1-based (ramah manusia), state 0-based (yang diminta `TablePagination`).
  - `src/hooks/useListParams.ts:56-57` — `setSp(merged, { replace: true })` dengan komentar
    *"paging and typing should not each add a browser-history entry."*
  - `src/hooks/useListParams.ts:67-68` — `setQ`/`setFilter` **mereset page ke kosong**; docstring
    `:12-13` menjelaskan: *"staying on page 7 of a result set that no longer has seven pages shows
    an empty table and looks like a bug."*
  - `src/hooks/useListParams.ts:26-40` — `toQueryString()` sengaja standalone, dipanggil inline oleh
    halaman untuk membentuk key `useApi`.
  - `src/components/SearchField.tsx:5-9` — debounce: *"a five-character tracking id is one query
    rather than five."*
  - `src/components/SearchField.tsx:21-31` — pola **"adjust state during render"**:
    `if (value !== lastValue) { setLastValue(value); setDraft(value); }`. Komentarnya menjelaskan
    kenapa bukan `useEffect`: *"setState inside an effect triggers a second render pass, and the lint
    rule that flags it is right to."* Ini pola resmi React untuk *derived state* dan layak dipelajari.
  - Dipakai 4 halaman: `DeliveriesListPage.tsx:40`, `UsersListPage.tsx:41`, `SupportListPage.tsx:42`,
    `FleetListPage.tsx:73`. **Tidak** dipakai `PromosListPage.tsx:53` (`useState(0)`) — inkonsistensi
    nyata yang bagus untuk latihan.
  - Git: `2a70ffe feat(admin): hold list page, filter and search in the URL`, `8083fae feat(admin): debounced search input`.
- **Kenapa dipakai di sini:**
  Ini bukan preferensi gaya — ini bug report yang ditulis ulang sebagai kode. Tiga kerugian konkret
  disebut di docstring: (1) kembali dari detail → antrean hilang, (2) refresh → posisi hilang,
  (3) tidak bisa berbagi link ke rekan. Untuk **operator console**, ketiganya adalah kegagalan
  alur kerja, bukan ketidaknyamanan kecil.
  URL sebagai state juga bersinergi dengan `useApi`: karena key `useApi` **adalah** path lengkap
  beserta query string, mengubah URL otomatis memicu fetch. Tidak ada state ketiga yang harus
  disinkronkan. Perhatikan bahwa `page`, `q`, `filter` **tidak pernah** disimpan di `useState`
  halaman mana pun — URL adalah satu-satunya sumber.
  `SearchField` menunjukkan pembagian yang tepat: ketikan tetap di state lokal (responsif, tiap
  keystroke) sementara URL hanya menerima nilai yang sudah "berhenti" setelah 300 ms.
- **Alternatif:**
  - **`useState` di komponen halaman** — apa yang dipakai `PromosListPage` sekarang; paling sederhana,
    dan **kalah** tepat pada tiga hal di docstring.
  - **Simpan di Redux/Zustand** — bertahan saat navigasi dalam-app, tapi tetap hilang saat refresh
    dan tetap tidak bisa di-share. Menambah state global untuk sesuatu yang sudah punya tempat alami.
  - **`sessionStorage`** — bertahan saat refresh, tapi tidak bisa di-share dan tidak sinkron dengan
    tombol Back.
  - **`nuqs`** — library type-safe untuk search params (parser + serializer per-key), menghapus
    cast manual `filter as DeliveryStatus | ''` di `DeliveriesListPage.tsx:41`. Biaya: satu
    dependency lagi untuk hook 70 baris.
  - **Debounce dengan `useDeferredValue` React 18+** — tidak butuh timer, tapi menunda **render**
    bukan **request**; tetap satu request per keystroke. Salah alat di sini.
- **Latihan:**
  Migrasikan `PromosListPage.tsx:53` dari `useState(0)` ke `useListParams()`, lengkap dengan
  `SearchField` (backend `/admin/promos` menerima `q`). Perhatikan blok `submit`
  (`PromosListPage.tsx:81-94`) yang mengandung komentar cerdik *"setPage changes the useApi key →
  refetch; only refetch explicitly when already on page 0"* — pastikan logika itu tetap benar setelah
  page pindah ke URL. Lalu tambahkan test yang me-render dengan
  `initialEntries: ['/promos?page=2']` dan meng-assert `apiFetch` dipanggil dengan `page=3`.

---

## 11. Modul `features/` — invariant domain sebagai fungsi murni

- **Prasyarat:** Konsep 8, 9
- **Anchor:**
  - `src/features/deliveries/deliveryActions.ts:20-26` — docstring inti:
    > *"Which operator actions to ENABLE for a delivery, mirroring the backend CAS gating
    > (src/deliveries/delivery-exceptions.ts + commands/command.constants.ts). The server is still
    > authoritative — these only keep the UI from offering an action it would obviously reject."*
  - `src/features/deliveries/deliveryActions.ts:27-43` — implementasinya: fungsi murni
    `AdminDelivery → DeliveryActions`. Tanpa React, tanpa fetch, tanpa state.
  - `src/models/enums.ts:82-105` — konstanta yang dicerminkan dari backend:
    `TERMINAL_STATUSES`, `FAILABLE_STATUSES`, `RETURNABLE_STATUSES`, masing-masing dengan komentar
    yang menunjuk file backend sumbernya.
  - `src/models/enums.ts:99-101` — nuansa yang mudah salah:
    *"RETURN_TO_BASE is legal on a NARROWER set than ABORT."*
  - `src/features/deliveries/deliveryActions.ts:39-42` — `canRefund` justru **longgar**, dengan alasan:
    *"the backend refund is a goodwill wallet credit allowed regardless of payment state; the only
    hard guard is idempotency."*
  - `src/features/promos/promoForm.ts:8` — *"All numeric/date fields are strings while editing
    (TextField values); parsed on submit."*
  - `src/features/promos/promoForm.ts:69-106` — `validatePromoForm(form, mode)` mengembalikan objek
    error, bukan boolean; `PromoFormDialog.tsx:44-45` menghitungnya **tiap render** dan
    `disabled={loading || hasErrors}` di baris 179.
  - `src/features/promos/promoForm.ts:127-146` — `buildUpdateBody` dan aturan halusnya:
    *"blank means 'keep current value'"* karena API tidak bisa meng-null-kan field.
  - Test: `deliveryActions.test.ts` (5 case, nol React) dan `promoForm.test.ts` (165 baris).
- **Kenapa dipakai di sini:**
  Ini pemisahan yang membuat logika paling rumit di console bisa diuji **tanpa merender apa pun**.
  `deliveryActions.test.ts:65-87` menguji legalitas per-command dalam 20 baris; melakukannya lewat
  render dialog MUI butuh 50 baris dan 20 detik.
  Tapi pelajaran yang lebih dalam adalah **kenapa duplikasi aturan backend di klien itu boleh**:
  karena ia dideklarasikan sebagai *cermin*, bukan *penjaga*. Kalau cermin ini basi, yang terjadi
  paling buruk adalah tombol yang seharusnya aktif jadi mati, atau request yang pasti ditolak
  terkirim dan 409-nya tampil di dialog — **bukan** operasi ilegal yang lolos. Itulah kenapa
  `DeliveryDetailPage.tsx:382` menutup panel aksi dengan kalimat
  *"Actions are gated by the delivery's status; the server makes the final call."*
  Ini adalah aturan yang layak dibawa ke semua proyek Anda: **duplikasi aturan bisnis di klien
  hanya aman kalau ia murni UX dan servernya tetap otoritatif.**
- **Alternatif:**
  - **Logika di dalam komponen** — apa yang biasa terjadi; hasilnya `disabled={...}` sepanjang 4 baris
    di JSX yang hanya bisa diuji lewat render.
  - **Zod / Yup / Valibot untuk validasi form** — schema deklaratif + inferensi tipe, pesan error
    otomatis. Menang di form besar. Kalah di sini karena aturan `promoForm` bersifat **kondisional
    per-mode** (`mode === 'create'` di baris 75) dan **antar-field** (`endsAt > startsAt` di baris 101) —
    di Zod itu berarti `superRefine`, yang tidak lebih ringkas dari 35 baris `if` yang ada.
  - **React Hook Form** — mengelola state form + validasi + `isDirty`/`isValid`, menghapus
    `PromoFormState` dan seluruh `set(key, value)` di `PromoFormDialog.tsx:48-49`. Trade-off nyata:
    RHF pakai uncontrolled input untuk performa, sedangkan form di sini kecil dan **butuh** controlled
    (nilai `discountType` mengubah adornment `%`/`$` di baris 98-103).
  - **Generate aturan dari backend** (bagikan konstanta lewat package npm bersama) — menghapus risiko
    cermin yang basi seluruhnya. Butuh monorepo; ketiga repo Drovery saat ini terpisah.
  - **Tidak menduplikasi sama sekali** (semua tombol selalu aktif, biarkan server menolak) — paling
    jujur, tapi UX-nya buruk: operator baru tahu aksinya ilegal setelah mengonfirmasi dialog.
- **Latihan:**
  `deliveryActions` tidak punya field `canRetryDispatch`. Tambahkan aturannya (misal: legal hanya saat
  `status === 'CONFIRMED'` dan `assignedDroneId === null`), tulis test-nya di `deliveryActions.test.ts`
  **sebelum** menyentuh komponen apa pun, lalu baru tambahkan tombolnya di panel
  `DeliveryDetailPage.tsx:348-384`. Rasakan bedanya: seluruh logika sudah terbukti benar sebelum
  satu piksel dirender.

---

## 12. WebSocket klien + `useSupportSocket` (resource imperatif dibungkus hook)

- **Prasyarat:** Konsep 5, 9
- **Anchor:**
  - `src/api/supportSocket.ts:57-65` — docstring yang menjelaskan seluruh kontrak: satu handle =
    satu rantai percobaan, teardown selalu `close()`, dan **fail-safe** — tanpa WebSocket/token/URL
    valid ia memanggil `onUnavailable` supaya pemanggil tetap memakai thread hasil REST.
  - `src/api/supportSocket.ts:8-14` — enum `UnavailableReason` dengan 6 sebab berbeda, masing-masing
    berkomentar. Ini kualitas error-modelling yang jarang.
  - `src/api/supportSocket.ts:132-143` — exponential backoff + jitter + `maxAttempts`.
  - `src/api/supportSocket.ts:155-162` — komentar post-mortem bug paling berharga di repo:
    > *"it matched `'event' in obj`, fell through all three branches, and returned. Every inbound
    > customer message was silently dropped while the chip read 'Live'. The bare-payload branch that
    > used to follow was unreachable dead code."*

    Dan test-nya (`supportSocket.test.ts:96-113`) menambahkan: *"this test asserted a BARE payload the
    gateway never emits, so it passed against dead code."* — **test hijau yang menguji kode mati.**
  - `src/api/supportSocket.ts:188-198` — close code `1008` diperlakukan terminal (token buruk),
    bukan dicoba ulang.
  - `src/api/wsUrl.ts:1-12` — `deriveWsBaseUrl`, dengan alasan: prefix `/api/v1` hanya untuk HTTP,
    gateway WS menempel di server yang sama; *"never hardcode :3000 — prod TLS may terminate on 443."*
  - `src/api/supportSocket.ts:82-93` — fallback saat API base **relatif** (`/api/v1` di produksi
    di balik Caddy): derive dari `window.location.origin`.
  - `src/features/support/useSupportSocket.ts:8-13` — jembatan ke React:
    *"`onMessage` is held in a ref so the page can pass an inline callback without re-opening the
    socket on every render."*
  - `src/features/support/useSupportSocket.ts:22-24` — ref di-update **di effect tanpa dependency
    array**, jadi jalan tiap commit; socket hanya re-handshake saat `ticketId` berubah (`:40`).
  - `src/pages/Support/SupportTicketDetailPage.tsx:141-148` — penggabungan: REST sebagai basis,
    pesan live di-layer di atas, dedup by `id` lewat `Map`, urut by `createdAt` (ISO string sort
    kronologis).
  - `SupportTicketDetailPage.tsx:158-164` — optimistic-ish: hasil `replyM.run` langsung
    di-`appendMessage`, echo WS ber-id sama akan ter-dedup.
- **Kenapa dipakai di sini:**
  Pemisahan **resource imperatif ≠ hook React** adalah pelajaran utamanya. `openSupportSocket` tidak
  tahu apa-apa tentang React: bisa dites dengan `FakeWS` biasa (`supportSocket.test.ts:22-49`), tanpa
  `renderHook`, tanpa jsdom timers. `useSupportSocket` (43 baris) hanya menerjemahkan callback jadi
  state React dan mengurus lifecycle mount/unmount. Bawa pola ini ke mana pun Anda memakai resource
  berlangganan (BLE, geolocation, Capacitor plugin — Anda akan langsung mengenali polanya dari Ionic).
  Fail-safe-nya juga desain sadar: di jsdom tidak ada `WebSocket`, jadi `supportSocket.ts:74-77`
  memanggil `onUnavailable('no-websocket')` dan halaman tetap berfungsi dari REST. Karena itu test
  halaman bisa mem-mock hook-nya jadi konstanta (`SupportTicketDetailPage.test.tsx:16-18`).
  Ref-untuk-callback (`useSupportSocket.ts:19-24`) adalah trik yang wajib Anda kuasai: tanpa itu,
  `appendMessage` inline akan masuk dependency array dan **membuka ulang socket tiap render**.
  Perhatikan bahwa halaman tetap menyediakannya sebagai `useCallback` stabil
  (`SupportTicketDetailPage.tsx:91-95`) — sabuk pengaman ganda.
- **Alternatif:**
  - **socket.io-client** — reconnect, ack, room, dan fallback HTTP long-polling **bawaan**; kode 246
    baris ini menyusut drastis. **Kalah** karena backend memakai gateway `ws` native (dilihat dari
    protokol frame `{event, data}` di `supportSocket.ts:63-65`), jadi socket.io **tidak kompatibel**
    tanpa mengubah server; plus ~35 KB.
  - **Server-Sent Events (SSE)** — satu arah, reconnect otomatis bawaan browser, jauh lebih sederhana.
    **Cukup** untuk kasus ini kalau balasan agent tetap lewat REST POST (dan memang begitu:
    `adminApi.replyToTicket`). Kalah: header auth pada `EventSource` tidak didukung (masalah token
    yang sama), dan HTTP/1.1 membatasi 6 koneksi per origin.
  - **Polling `useApi` tiap 5 detik** — 10 baris kode, nol infrastruktur. Kalah di latensi dan beban
    server; untuk chat, jeda 5 detik terasa rusak.
  - **`react-use-websocket`** — hook siap pakai dengan reconnect. Kalah: tidak mengerti protokol
    subscribe/ack spesifik gateway ini, jadi `onMessage`-nya tetap Anda tulis sendiri — dan justru
    bagian **itulah** yang jadi sumber bug di repo ini.
- **Latihan:**
  Chip status sekarang cuma 3 keadaan (`connecting` / `live` / `offline`, dirender di
  `SupportTicketDetailPage.tsx:182-193`), sehingga `'drop-exhausted'` dan `'auth-failed'` sama-sama
  tampil "Offline". Perluas `SupportSocketStatus` agar membawa `UnavailableReason`, tampilkan pesan
  yang berbeda (misal "Sesi berakhir — muat ulang" untuk `auth-failed`), dan tambahkan test di
  `supportSocket.test.ts` yang menutup socket dengan `code: 1008` lalu meng-assert
  `onUnavailable('auth-failed')` **dan** tidak ada percobaan reconnect.

---

## 13. Vitest + Testing Library — pola yang dipakai repo ini

- **Prasyarat:** Konsep 4, 6, 8
- **Anchor:**
  - `vite.config.ts:42-51` — konfigurasi test **di file yang sama** dengan konfigurasi build
    (`import { defineConfig } from 'vitest/config'` di baris 1). Ini keunggulan struktural Vitest.
  - `vite.config.ts:46-50` — komentar jujur tentang `testTimeout: 20000`:
    *"MUI dialog/select/portal render tests are heavy; the default 5s test timeout is too tight when
    many files run in parallel on a small box."*
  - `src/setupTests.ts:1` — satu baris: `import '@testing-library/jest-dom'` (memberi
    `toBeInTheDocument`, `toBeDisabled`, `toHaveTextContent`).
  - `src/test/renderWithProviders.tsx:23-49` — **helper terpenting di repo**. Membangun store baru
    per-test (`configureStore` di baris 28, bukan store global — isolasi test), lalu membungkus
    `Provider` → `ThemeProvider` → `MemoryRouter`. Urutannya sama persis dengan produksi.
  - `src/test/renderWithProviders.tsx:32-38` — opsi `routePath`: kalau diisi, UI dipasang di dalam
    `<Routes><Route path={routePath}>` supaya `useParams()` benar-benar resolve. Dipakai di
    `DeliveryDetailPage.test.tsx:32-36` dengan `routePath: '/deliveries/:id'` + `initialEntries: ['/deliveries/d1']`.
  - `src/test/renderWithProviders.tsx:52-62` — `authedAdmin()` sebagai `preloadedState`. Menghindari
    "login dulu" di setiap test.
  - `src/test/fixtures.ts` — 8 factory dengan pola `(over: Partial<T> = {}): T => ({ ...default, ...over })`.
    Dipakai sebagai `fx.delivery({ status: 'DELIVERED' })`.
  - **Mock di satu chokepoint:** `DeliveryDetailPage.test.tsx:10-13` — `vi.mock('../../api/client')`,
    lalu `mockFetch.mockImplementation((path) => ...)` (baris 25-28) untuk menjawab **per-path**.
    Pola ini berulang identik di 7 file test.
  - **Query berbasis role:** `getByRole('button', { name: /Force cancel/i })`,
    `getByRole('combobox', { name: /Command/i })` (`DeliveryDetailPage.test.tsx:134`),
    `getByRole('option', ...)` untuk item MUI Select yang dirender ke **portal** (baris 143-151 —
    perhatikan: query lewat `screen`, bukan `within(dialog)`, karena portal ada di luar dialog DOM).
  - **`within()` untuk mempersempit:** `UsersListPage.test.tsx:49-55` dengan komentar
    *"Scope the role assertions to each user's row so the Role-filter Select cannot satisfy the query."*
  - **`findBy*` untuk async:** `await screen.findByText('DRV-0001')` — menunggu promise `useApi` resolve.
  - **Loading state:** `DashboardPage.test.tsx:24` — `mockFetch.mockReturnValue(new Promise(() => {}))`,
    promise yang tidak pernah selesai.
  - `.github/workflows/ci.yml` — `npm run lint` → `npm run build` (tsc + vite) → `npx vitest run`.
- **Kenapa dipakai di sini:**
  Vitest dipilih karena **berbagi config, resolver, dan transform pipeline dengan Vite**. Praktisnya:
  `import.meta.env`, alias, plugin React, dan TS jalan identik di test dan produksi — tanpa
  `babel-jest`, `ts-jest`, atau `moduleNameMapper` yang harus dirawat terpisah.
  Filosofi test-nya konsisten dan layak ditiru: **uji dari sudut pandang pengguna** (query by role/label,
  bukan `className`/`data-testid`) dan **mock satu titik terjauh** (`api/client`). Akibatnya, seluruh
  rantai `useApi` → `useMutation` → `deliveryActions` → render MUI ikut terlatih di setiap test halaman —
  refactor internal tidak memecahkan test, perubahan perilaku iya.
  Ada juga pelajaran negatif yang penting: `supportSocket.test.ts:96-102` mendokumentasikan test yang
  **lulus terhadap dead code** selama berbulan-bulan. Pelajarannya: test hanya sekuat asumsi tentang
  kontrak eksternal — kalau Anda mem-fixture frame yang server tidak pernah kirim, test hijau tidak
  berarti apa-apa. Ini argumen kuat untuk melengkapi unit test dengan satu-dua test kontrak nyata.
- **Alternatif:**
  - **Jest** — ekosistem terbesar, tapi di proyek Vite butuh konfigurasi transform paralel
    (`ts-jest`/`babel-jest` + `moduleNameMapper` untuk asset). Vitest 2-5x lebih cepat di sini dan
    API-nya kompatibel (`describe`/`it`/`expect`/`vi` vs `jest`).
  - **`@testing-library/user-event`** (bukan `fireEvent`) — mensimulasikan interaksi lebih realistis
    (pointer events, focus, delay ketikan). Repo ini pakai `fireEvent` (`DeliveryDetailPage.test.tsx:125,141`);
    `fireEvent.mouseDown` untuk membuka MUI Select adalah workaround yang tidak diperlukan dengan
    `user-event`. Trade-off: `user-event` async dan lebih lambat.
  - **Playwright / Cypress E2E** — menguji sistem sungguhan termasuk backend; **satu-satunya** cara
    menangkap bug seperti double-`JSON.stringify` di `fleetApi` atau frame WS yang salah. Biaya:
    lambat, butuh backend hidup, flaky.
  - **MSW (Mock Service Worker)** — mock di level jaringan, bukan modul. Test tidak perlu tahu
    `api/client` ada, dan handler yang sama bisa dipakai ulang di dev. **Ini upgrade yang paling
    saya rekomendasikan** untuk repo ini: `vi.mock('../../api/client')` melewati `client.ts` sepenuhnya,
    sehingga unwrap envelope, penanganan 401, dan single-flight refresh **tidak pernah teruji** di
    test halaman mana pun.
  - **Storybook + test-runner** — bagus untuk isolasi komponen visual; berlebihan untuk 5 komponen bersama.
- **Latihan:**
  Ganti `vi.mock('../../api/client')` di `DashboardPage.test.tsx` dengan MSW: pasang handler untuk
  `GET */admin/overview` yang mengembalikan envelope **lengkap** `{ success: true, data: fx.overview() }`.
  Test harus tetap hijau — dan sekarang ia juga membuktikan `apiFetch` benar membuka envelope. Lalu
  tambahkan test kedua: handler mengembalikan `401`, dan assert `setUnauthorizedHandler` ter-trigger.

---

## 14. Vite build — `manualChunks` + code-splitting via `React.lazy`

- **Prasyarat:** Konsep 3, 6
- **Anchor:**
  - `vite.config.ts:13-16` — komentar strategi, tiga kalimat yang mengandung seluruh rasionalnya:
    > *"Split heavy, rarely-changing vendor code into cacheable chunks so the entry chunk stays pure
    > app code; route pages are code-split via React.lazy (one chunk each). Function form so MUI's
    > TRANSITIVE deps (@mui/system, @popperjs, react-transition-group, …) land in the mui chunk too —
    > a bare package-name list misses them."*
  - `vite.config.ts:17-38` — `manualChunks(id)`: `!id.includes('node_modules') → undefined`
    (biarkan Rollup yang atur kode app), lalu tiga bucket: `mui`, `react`, `vendor`.
  - `vite.config.ts:28-33` — perhatikan `'/react/'` dan `'/react-dom/'` **dengan slash pengapit** —
    supaya `react-router` dan `react-redux` tidak salah tangkap oleh substring `react`. Detail kecil
    yang menjelaskan kenapa mereka juga disebut eksplisit di baris berikutnya.
  - `src/router/router.tsx:12-27` — sisi kedua dari strategi: 10 `React.lazy` = 10 chunk rute.
  - `nginx.conf:9-14` — sisi ketiga: `location /assets/ { expires 1y; Cache-Control "public, immutable" }`.
    Ini yang **memonetisasi** pemisahan chunk — nama file ber-hash konten, jadi chunk `mui` yang tidak
    berubah tetap di cache browser meski kode app di-deploy ulang.
- **Kenapa dipakai di sini:**
  Ketiga potongan di atas adalah **satu strategi**, bukan tiga optimasi terpisah, dan itulah inti
  pelajarannya: memisahkan chunk tanpa cache header panjang tidak ada gunanya; cache panjang tanpa
  hash konten berbahaya; hash konten tanpa pemisahan berarti satu perubahan CSS membatalkan cache MUI
  seluruhnya.
  Alasan "function form" di komentar `vite.config.ts:15-16` sangat konkret dan sering jadi jebakan:
  bentuk objek (`manualChunks: { mui: ['@mui/material'] }`) hanya memindahkan paket yang **disebut**,
  sementara `@mui/system`, `@popperjs/core`, dan `react-transition-group` — yang ditarik secara
  transitif — tetap jatuh ke chunk lain. Bentuk fungsi menerima **path modul** sehingga bisa
  dicocokkan dengan substring.
  Untuk konsol internal, ini memang bukan kemenangan besar dalam angka. Yang penting adalah
  **pola**-nya, dan itu berlaku persis sama saat Anda mem-bundle aset web untuk Capacitor.
- **Alternatif:**
  - **Tanpa `manualChunks`** — Rollup tetap memisah chunk per-`import()` dinamis; vendor akan tersebar
    ke chunk rute yang pertama memakainya. Hasil: MUI ikut ter-invalidasi setiap kali halaman berubah.
  - **`splitVendorChunkPlugin`** (deprecated di Vite 5+) — satu chunk `vendor` untuk semua
    `node_modules`. Lebih sederhana, tapi MUI + React + sisanya jadi satu blob besar yang batal
    bersamaan.
  - **Tanpa `React.lazy` sama sekali** — satu bundle, satu request, tanpa `Suspense`/`PageLoader`.
    Masuk akal untuk 10 halaman dengan pengguna internal; yang hilang adalah TTI awal
    (`DeliveryDetailPage` 552 baris tidak perlu diunduh operator support).
  - **`rollup-plugin-visualizer` / `vite-bundle-visualizer`** — bukan alternatif tapi pelengkap wajib:
    tanpa mengukur, aturan `manualChunks` adalah tebakan.
  - **Import per-path MUI** (`import Button from '@mui/material/Button'`) — dulu wajib untuk
    tree-shaking; dengan MUI 7 + Vite, barrel import sudah aman.
- **Latihan:**
  Jalankan `npm run build` dan catat ukuran tiap file di `dist/assets/`. Lalu ubah satu kata di
  `src/pages/Dashboard/DashboardPage.tsx`, build lagi, dan bandingkan **nama file ber-hash**: chunk
  `mui-*.js` dan `react-*.js` harus punya hash **yang sama persis** — buktikan bahwa cache satu tahun
  di `nginx.conf:11` benar-benar bertahan lintas deploy. Kemudian pasang `rollup-plugin-visualizer`
  dan cari tahu apakah bucket `vendor` masih menyimpan sesuatu yang layak dipisah.

---

## 15. Docker multi-stage + nginx statis (dan env yang dibekukan saat build)

- **Prasyarat:** Konsep 14
- **Anchor:**
  - `Dockerfile:2-6` — stage `build`: `node:22-slim`, `COPY package*.json ./` **lalu** `npm ci`
    **lalu** `COPY . .`. Urutan ini penting: layer `npm ci` hanya batal saat manifest berubah,
    bukan tiap ganti kode.
  - `Dockerfile:7-11` — inti keputusannya:
    > *"API base defaults to RELATIVE (/api/v1): the SPA calls its own origin and the edge proxy
    > (Caddy) forwards /api + /ws to the backend — so this image works on ANY domain with no rebuild
    > and needs no CORS."*
  - `Dockerfile:14-17` — stage `runtime`: `nginx:1.27-alpine`, hanya menyalin `nginx.conf` dan
    `/app/dist`. **Tidak ada Node di image final.**
  - `nginx.conf:1-2` — pembagian tugas: *"TLS + /api + /ws proxying happen at the edge (Caddy in the
    production compose), so this just serves static files with SPA-history fallback."*
  - `nginx.conf:16-19` — `try_files $uri $uri/ /index.html` — **wajib** untuk SPA: tanpa ini,
    reload di `/deliveries/abc` menghasilkan 404 nginx karena file itu tidak ada di disk.
  - `.dockerignore` — `node_modules`, `dist`, `.env*` dikecualikan (build context kecil + tidak ada
    kebocoran secret).
  - `.github/workflows/publish.yml` — build & push ke Docker Hub dengan tag `latest` + `sha-<short>` +
    tag versi, `cache-from/to: type=gha`.
  - Konsekuensi dari `import.meta.env` (Konsep 1): `supportSocket.ts:82-93` **harus** punya fallback
    `window.location.origin` justru karena base URL relatif tidak punya host untuk diturunkan jadi
    URL WebSocket.
- **Kenapa dipakai di sini:**
  Hasil `vite build` adalah HTML + JS + CSS statis — **tidak butuh** proses Node untuk dilayani.
  Karena itu image final adalah nginx alpine (~50 MB) alih-alih Node (~200 MB) dengan `serve`,
  dan permukaan serangannya jauh lebih kecil (tidak ada runtime JS di server).
  Keputusan paling instruktif adalah `ARG VITE_API_BASE_URL=/api/v1`. Karena Vite meng-**inline** env
  saat build, image SPA biasanya terikat ke satu URL API — deploy ke staging berarti rebuild. Repo ini
  menghindarinya dengan **default relatif**: SPA memanggil origin-nya sendiri, Caddy di depan
  meneruskan `/api` dan `/ws` ke backend. Tiga keuntungan sekaligus, dan semuanya disebut di
  komentar: satu image untuk semua domain, tidak perlu rebuild, **dan CORS lenyap** (same-origin).
  Pola dua lapis reverse proxy (nginx di dalam container hanya melayani statis; Caddy di edge
  mengurus TLS + routing) adalah pembagian yang bersih: image SPA tidak perlu tahu apa-apa tentang
  alamat backend, sertifikat, atau domain.
- **Alternatif:**
  - **Serve dari Node (`serve` / `express.static`)** — image lebih besar, permukaan serangan lebih
    luas, throughput statis lebih rendah. Menang hanya kalau butuh logika runtime (mis. menyuntik
    config per-request — persis yang dihindari repo ini dengan URL relatif).
  - **Runtime env injection** (`env.js` yang di-generate oleh entrypoint, atau placeholder yang
    di-`sed` saat start) — satu image, banyak URL API absolut. Menang untuk API cross-origin;
    kalah di kompleksitas. URL relatif menyelesaikan masalah yang sama dengan nol kode.
  - **Static host: Netlify / Vercel / Cloudflare Pages / S3+CloudFront** — nol ops, CDN global,
    rollback instan. **Kalah** kalau Anda ingin backend + admin + edge proxy dalam satu
    `docker compose` yang bisa dijalankan siapa pun (yang jelas jadi tujuan Drovery).
  - **Caddy langsung sebagai file server** (buang nginx) — Caddy sudah ada di edge dan bisa
    `file_server` + `try_files` sendiri; menghapus satu container. Kalah: image admin jadi tidak
    self-contained (tidak bisa `docker run` sendirian untuk dites).
  - **Single-stage Dockerfile** — image final ikut membawa `node_modules` (ratusan MB) dan source.
    Multi-stage build ada persis untuk menghindari ini.
- **Latihan:**
  Build image-nya: `docker build -t drovery-admin .` lalu `docker run -p 8080:80 drovery-admin`.
  Buka `http://localhost:8080/deliveries` **langsung** (bukan lewat klik dari `/`) dan verifikasi
  bahwa `try_files` mengembalikan `index.html`, bukan 404. Kemudian **hapus sementara** baris
  `nginx.conf:17-19`, rebuild, dan lihat 404-nya muncul — supaya Anda tidak pernah lupa kenapa
  SPA fallback itu ada. Terakhir: jalankan `docker images` dan bandingkan ukuran final vs
  `node:22-slim`.

---

# Bagian khusus: apa yang berubah kalau di-port ke Next.js App Router

Bagian ini adalah umpan untuk modul Next.js berikutnya. Untuk tiap halaman: apa yang jadi **Server
Component**, bagaimana data diambil, dan apa yang terjadi pada auth.

### Perubahan lintas-halaman (berlaku untuk semuanya)

| Yang ada sekarang | Di App Router |
|---|---|
| `src/router/router.tsx` (tabel rute) | Struktur folder `app/`: `app/login/page.tsx`, `app/(console)/deliveries/[id]/page.tsx`, dst. Tabel rute lenyap sebagai file. |
| `React.lazy` + `<Suspense>` manual (`router.tsx:12-32`) | Otomatis. Boundary jadi file `loading.tsx` per-segment. |
| `AppLayout` sebagai element rute | `app/(console)/layout.tsx` — **Server Component**, membaca sesi dari cookie dan memfilter `NAV_ITEMS` **di server**, sehingga daftar role tidak lagi terkirim ke klien. |
| `ProtectedRoute` + `RequireRole` | `middleware.ts` di root: baca cookie sesi, `NextResponse.redirect` sebelum HTML dikirim. `homePathForRole()` (`navItems.tsx:71-73`) pindah ke sini nyaris apa adanya. Keuntungan struktural: HTML halaman terlarang **tidak pernah** terkirim. |
| `tokenStorage.ts` (localStorage) | Cookie `httpOnly`. **Ini perubahan paling berdampak:** `apiFetch` tidak lagi memasang bearer di klien; server yang meneruskan cookie. **Tapi** `supportSocket.ts:215` mengirim token lewat query string dan **tidak bisa membaca cookie httpOnly** — butuh endpoint "WS ticket" berumur pendek atau upgrade WS yang mewarisi cookie. Jangan lewatkan ini saat merencanakan port. |
| `src/api/client.ts` (401 → refresh → retry) | Sebagian pindah ke server (fetch dengan cookie) dan sebagian ke middleware (refresh + `Set-Cookie` saat access token kedaluwarsa). Single-flight jadi tidak relevan di klien, tapi jadi **masalah baru** di server jika beberapa RSC fetch bersamaan. |
| `store.ts` + Redux | Kemungkinan besar **hilang seluruhnya** — README menyatakan Redux hanya memegang sesi auth, dan sesi pindah ke cookie + server. `Provider` juga memaksa client boundary yang mematikan manfaat RSC. |
| `theme/theme.ts` + MUI | Butuh `AppRouterCacheProvider` dari `@mui/material-nextjs` dan `'use client'` pada modul tema. Emotion adalah runtime CSS-in-JS klien, jadi setiap komponen MUI menarik boundary klien — inilah kenapa banyak tim yang pindah ke App Router juga pindah dari MUI ke Tailwind/Panda (zero-runtime). |
| `useApi` (`hooks/useApi.ts`) | Untuk baca awal: **hilang**, diganti `await fetch()` di dalam `async function Page()`. Untuk refresh/mutasi: `router.refresh()` atau `revalidatePath()`. |
| `useMutation` (`hooks/useMutation.ts`) | Server Actions (`'use server'`) + `useActionState` untuk `pending`/`error`. Objek `adminApi` (`api/admin.ts`) jadi modul server, tidak pernah terkirim ke browser. |
| `useListParams` (`hooks/useListParams.ts`) | Halaman menerima prop `searchParams`; server merender ulang saat URL berubah. `SearchField` tetap client component tapi memanggil `router.replace(..., { scroll: false })` dan idealnya dibungkus `useTransition`. |
| `vite.config.ts` `manualChunks` | Hilang — Next punya strategi chunking sendiri (per-route + shared). |
| `Dockerfile` + `nginx.conf` | `next start` (proses Node) menggantikan nginx statis. **Anda kehilangan** properti "satu image statis untuk domain mana pun" dari `Dockerfile:7-9`. `output: 'export'` mempertahankannya tapi mematikan RSC, Server Actions, dan middleware — yang berarti tidak ada gunanya pindah. |

### Per halaman

**`/login` — `LoginPage.tsx`**
`'use client'` untuk form terkontrol, **tapi** submit jadi Server Action: POST ke backend, `cookies().set()`
untuk access + refresh, lalu `redirect('/')` **dari server**. `dispatch(login(...))` +
`login.fulfilled.match(result)` (`LoginPage.tsx:30-31`) lenyap. Guard `status === 'authenticated' → <Navigate to="/" />`
(baris 24) jadi pengecekan cookie di server sebelum render. Error dari `authSlice` (`LoginPage.tsx:47`)
jadi return value Server Action lewat `useActionState`.

**`/` — `DashboardPage.tsx`** — *kandidat RSC paling murni di seluruh repo.*
Satu read (`/admin/overview`), nol interaktivitas selain Refresh. Jadi `export default async function Page()`
yang `await` datanya. Blok tiga-cabang loading/error/data (`DashboardPage.tsx:48-66`) diganti
`loading.tsx` + `error.tsx`. Tombol Refresh jadi client component mungil yang memanggil
`router.refresh()`, atau Server Action `revalidatePath('/')`. `StatCard` dan chip status tetap server —
nol JS terkirim untuk kartu-kartu itu.

**`/deliveries` — `DeliveriesListPage.tsx`**
Server component menerima `searchParams: { page, q, filter }` dan fetch daftarnya. Tabel + `StatusChip`
render di server (`humanizeEnum`/`deliveryStatusColor` jalan di server, hilang dari bundle klien).
`SearchField` dan `<Select>` filter tetap klien. `TablePagination` MUI butuh handler → klien.
Yang harus diwaspadai: tiap ketikan yang commit memicu **round-trip server**; tanpa
`useTransition` + `loading.tsx`, terasa lebih lambat daripada SPA sekarang.

**`/deliveries/:id` — `DeliveryDetailPage.tsx`** — *perubahan paling menguntungkan.*
Dua `useApi` paralel (`:81` dan `:86`) jadi satu `Promise.all` di server — hilang waterfall
"unduh chunk → mount → fetch". Seluruh blok kartu read-only (Route, Package, Customer, Schedule,
Payment, Tracking, Proof, Rating — baris 226-345) jadi RSC murni. Panel aksi + 4 `ConfirmDialog`
tetap `'use client'`. Keempat mutasi jadi Server Action dengan `revalidatePath('/deliveries/'+id)` —
**yang membuat bug `d67ac40` (Refresh tidak memuat ulang command history) mustahil terulang**, karena
revalidasi menyegarkan seluruh segment, bukan satu `useApi` yang harus diingat. `deliveryActions()`
(fungsi murni, tanpa React) jalan di server maupun klien tanpa perubahan.

**`/promos` — `PromosListPage.tsx`**
Halaman ini satu-satunya yang masih memakai `useState(0)` untuk page (`:53`) — di App Router itu tidak
mungkin di server, jadi port-nya **memaksa** pindah ke `searchParams` (dan sekalian memperbaiki
inkonsistensi Konsep 10). `PromoFormDialog` tetap klien; `buildCreateBody`/`buildUpdateBody`
(`promoForm.ts:113-146`) pindah ke Server Action. Trik "lompat ke page 1 setelah create"
(`PromosListPage.tsx:85-88`) jadi `redirect('/promos?page=1')` setelah `revalidatePath`.
`validatePromoForm` idealnya dipanggil **dua kali** — di klien untuk feedback instan, di Server Action
sebagai gerbang sungguhan.

**`/users` — `UsersListPage.tsx`**
Server list + `searchParams`. Dialog ganti role tetap klien; `adminApi.setRole` jadi Server Action +
`revalidatePath('/users')`, menggantikan `refetch()` di baris 61.

**`/fleet` — `FleetListPage.tsx`**
Kandidat terbaik untuk `<form action={registerDrone}>` dengan progressive enhancement. Gate `canSubmit`
manual (`FleetListPage.tsx:91-97`) bisa disederhanakan: validasi di Server Action dan kembalikan
error per-field lewat `useActionState`. Bonus: bug double-`JSON.stringify` di `fleetApi`
(lihat Latihan Konsep 2) hilang dengan sendirinya karena Server Action tidak memakai `apiFetch`.

**`/support` — `SupportListPage.tsx`**
Sama seperti list lain. Karena `AGENT` boleh masuk sini tapi tidak ke `/deliveries`, aturan role-nya
pindah ke `middleware.ts` — dan filter nav di layout server.

**`/support/:id` — `SupportTicketDetailPage.tsx`** — *paling nuansa.*
Thread REST diambil di server, lalu di-pass sebagai prop ke client component
`<LiveThread initialMessages={ticket.messages} ticketId={id} />`. Logika merge REST+live
(`SupportTicketDetailPage.tsx:141-148`) tetap ada, tapi basisnya sekarang prop server, bukan hasil
`useApi`. `useSupportSocket` **tidak berubah sama sekali** — ia sudah client-only dan tidak menyentuh
Redux. Balasan agent jadi Server Action + `useOptimistic` menggantikan `appendMessage(sent)` (baris 162).
**Ganjalan utama:** WS mengautentikasi lewat `?token=` (`supportSocket.ts:215`) — dengan cookie httpOnly
token tidak terbaca JS, jadi butuh endpoint yang menerbitkan tiket WS berumur pendek.

**`*` — `NotFoundPage.tsx`** → `app/not-found.tsx`, otomatis dipakai oleh `notFound()`.

---

## Yang paling mungkin bikin nyangkut (dan urutan membaca)

**Bagian tersulit:** memahami bahwa **ada empat "state" berbeda** di aplikasi ini, masing-masing punya
rumah sendiri, dan menaruhnya di rumah yang salah adalah kesalahan arsitektur paling mahal:

1. **Session state** → Redux (`authSlice`) — karena dibaca dari mana-mana **dan** ditulis dari luar React.
2. **Server state** → `useApi` per-halaman — karena harus selalu segar dan di-refresh manual.
3. **View state** (page, search, filter) → **URL** (`useListParams`) — karena harus bisa di-share,
   bertahan saat refresh, dan hidup dengan tombol Back.
4. **Ephemeral UI state** (dialog terbuka, draft form) → `useState` lokal — karena mati bersama komponennya.

Datang dari Ionic React, refleks yang wajar adalah menaruh semuanya di `useState` atau semuanya di
satu global store. Repo ini menolak keduanya, dan **setiap pilihan tempat itu ditulis alasannya di
docstring** (`useListParams.ts:4-14`, `README.md:43-44`, `RequireRole.tsx:7-18`). Baca docstring-nya
sebelum kodenya — di repo ini docstring adalah dokumen desain, bukan hiasan.

**Jebakan kedua:** mengira guard klien itu keamanan. Bukan. `README.md:40` dan
`deliveryActions.ts:22-25` menyebutnya cermin UX; `RolesGuard` backend adalah gerbang sungguhan.

**Urutan membaca yang disarankan:** `main.tsx` → `App.tsx` → `router.tsx` → `ProtectedRoute.tsx` →
`AppLayout.tsx` → `navItems.tsx` → `store.ts`/`hooks.ts` → `authSlice.ts` → `api/client.ts` →
`hooks/useApi.ts` → `DashboardPage.tsx` (halaman paling sederhana) → `hooks/useListParams.ts` →
`DeliveriesListPage.tsx` → `hooks/useMutation.ts` + `deliveryActions.ts` →
`DeliveryDetailPage.tsx` (halaman paling kompleks) → `supportSocket.ts` → `test/renderWithProviders.tsx` →
`vite.config.ts` → `Dockerfile` + `nginx.conf`.

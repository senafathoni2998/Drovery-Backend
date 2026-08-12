# Peta Belajar — `mobile:expo-app` (Drovery_Mobile)

**Repo:** `/home/darth-zelantus/Documents/Project_Pribadi/Drovery_Mobile`
**Sasaran pembaca:** developer frontend yang sudah biasa mengirim app Ionic React + Capacitor (Android-heavy).
**Framing:** setiap konsep diajarkan sebagai **selisih** dari dunia Ionic/Capacitor — apa yang *transfer*, apa yang *tidak*.

---

## Ringkasan satu kalimat

Drovery_Mobile adalah aplikasi React Native (Expo SDK 54) yang **tidak punya WebView sama sekali**: UI-nya adalah view native asli yang digambar dari pohon `View`/`Text`, navigasinya file-based (`expo-router`), dan ia berbicara ke backend NestJS lewat REST + WebSocket mentah dengan client HTTP yang ditulis tangan (bukan axios) dan socket yang ditulis tangan (bukan socket.io).

## Yang TRANSFER dari Ionic React + Capacitor

| Sudah kamu kuasai | Tetap berlaku di sini |
| --- | --- |
| React + hooks (`useState`, `useEffect`, `useCallback`, `useRef`) | 100% sama. `contexts/AuthContext.tsx`, semua `features/**/hooks/*.ts` |
| TypeScript, `strict: true` | Sama (`tsconfig.json:4`) |
| Konsumsi REST dari client | Sama polanya — hanya `apiClient`-nya ditulis manual |
| Konsep permission runtime Android | Sama idenya, API-nya beda (Expo modules, bukan Capacitor plugins) |
| `.env` + build-time config | Konsepnya sama, mekanismenya beda (`EXPO_PUBLIC_*` di-*inline*) |
| npm scripts, ESLint, Jest | Sama; preset-nya `jest-expo` |

## Yang TIDAK transfer (dan ini inti kurikulumnya)

| Di Ionic/Capacitor | Di Expo/React Native |
| --- | --- |
| `<div>`, `<ion-content>`, CSS, media query, cascade | Hanya `View`/`Text`/`ScrollView` + `StyleSheet.create`, **flexbox saja**, tanpa cascade, tanpa `%` height yang bebas |
| Aplikasi = WebView + bundle web | Aplikasi = view native asli; JS jalan di engine terpisah (Hermes) |
| `capacitor.config.ts` + folder `android/` yang di-*commit* | `app.json` + config plugins; folder `android/` **tidak ada** (Continuous Native Generation) |
| `@capacitor/preferences`, `@capacitor/camera` | `expo-secure-store`, `expo-camera`, `expo-location`, `expo-notifications` |
| Ionic React Router (`IonRouterOutlet`, komponen route) | `expo-router` — **file = route**, `_layout.tsx` = layout |
| Peta = iframe/Leaflet/Google JS SDK di WebView | `react-native-maps` = view native MapKit/Google Maps, butuh API key di `app.json` |
| `npx cap sync` + Android Studio | `eas build` di cloud, atau dev client; **Expo Go tidak bisa menjalankan semua native module** |

---

# Konsep (urut dari termudah)

---

## 1. Anatomi aplikasi Expo & titik masuk (vs proyek Capacitor)

- **Prasyarat:** —
- **Anchor:**
  - `package.json:3` — `"main": "expo-router/entry"`
  - `app.json:1-74` — seluruh konfigurasi native app
  - `.gitignore` + struktur root: **tidak ada folder `android/` maupun `ios/`**
- **Kenapa dipakai di sini:** Di proyek Capacitor kamu punya `capacitor.config.ts` *dan* folder `android/` berisi Gradle yang di-commit. Di sini semua konfigurasi native diringkas jadi satu `app.json`: `android.package` = `com.drovery.mobile` (`app.json:15`), adaptive icon (`app.json:16-21`), `edgeToEdgeEnabled` (`app.json:22`), dan kunci Google Maps (`app.json:24-28`). Folder native tidak ada karena Expo memakai **Continuous Native Generation** — proyek Android/iOS dibangkitkan saat build dari `app.json` + `plugins`. README menegaskan ini secara operasional: rilis dilakukan dengan `eas build`, bukan membuka Android Studio (`README.md:144-154`).
  Perhatikan `package.json:3`: tidak ada `App.tsx` atau `index.js` buatan sendiri — entry point-nya adalah `expo-router/entry`, yang memindai folder `app/` untuk membuat route. Itulah kenapa `app/_layout.tsx` menjadi "akar" aplikasi secara de-facto.
  Juga `app.json:10` `newArchEnabled: true` (React Native New Architecture — bridge lama diganti JSI/Fabric) dan `app.json:69-72` `experiments: { typedRoutes, reactCompiler }`.
- **Alternatif:**
  - **Capacitor + Ionic** — kamu tetap menulis HTML/CSS dan mendapat 1 codebase untuk web+mobile; harganya adalah UI berjalan di WebView (scroll/gesture/animasi tidak pernah 100% native) dan setiap perilaku native butuh plugin. Drovery butuh peta native + kamera + push token → RN menang di sini.
  - **React Native CLI (bare)** — kontrol penuh, folder `android/`/`ios/` di-commit, boleh library native apa pun; harganya: kamu sendiri yang mengurus upgrade RN, keystore, dan CI. Expo memilih *managed* + EAS karena ini proyek satu orang (lihat `README.md:9`).
  - **Flutter** — performa UI sangat baik, tapi membuang seluruh keahlian React/TS yang sudah dimiliki.
- **Latihan:** Buka `app.json`, ubah `expo.name` dan `android.adaptiveIcon.backgroundColor`, lalu jalankan `npm run android`. Lalu cari di repo di mana `expo.scheme` (`droverymobile`) akan dipakai jika app ini memasang deep link — bandingkan mental modelnya dengan `capacitor.config.ts` → `appId`/`server.androidScheme` yang biasa kamu tulis.

---

## 2. Primitif UI React Native: `View`/`Text`/`StyleSheet`, flexbox-only, safe area

- **Prasyarat:** 1
- **Anchor:**
  - `styles/common.ts:98-241` — `commonStyles = StyleSheet.create({...})`, token `colors` (`:4-61`), `spacing` (`:64-72`), `borderRadius` (`:75-82`), `fontSize` (`:85-95`)
  - `features/delivery/screens/QRScannerScreen/QRScannerScreen.tsx:126-265` — seluruh overlay scanner dibuat murni dari `View` + flex (`dimTop`/`middleRow`/`dimBottom`)
  - `features/auth/screens/LoginScreen/LoginScreen.tsx:129-136` — `KeyboardAvoidingView` + `Platform.OS === "ios" ? "padding" : "height"`
  - `features/delivery/screens/TrackOnMapScreen/TrackOnMapScreen.tsx:27` + `:193` — `useSafeAreaInsets()` lalu `paddingTop: insets.top + spacing.sm`
- **Kenapa dipakai di sini:** Tidak ada DOM, jadi tidak ada `div`, tidak ada cascade, tidak ada `:hover`, tidak ada media query. Setiap gaya adalah objek JS. `StyleSheet.create` dipakai (bukan objek literal) supaya style dinormalisasi sekali dan dirujuk lewat ID.
  Yang paling terasa asing dari dunia CSS: **`flexDirection` default-nya `column`**, bukan `row`. Lihat `styles/common.ts:127-137` — `inputWrapper` harus menulis `flexDirection: "row"` secara eksplisit untuk hal yang di CSS kamu dapat gratis dengan `display:flex`.
  Bayangan (shadow) tidak lintas platform: `commonStyles.card` (`styles/common.ts:106-116`) menulis **dua** set properti — `shadowColor/shadowOffset/shadowOpacity/shadowRadius` (iOS) *dan* `elevation` (Android). Di CSS ini satu `box-shadow`.
  Safe area juga bukan `env(safe-area-inset-top)` seperti di Ionic; ia adalah hook `useSafeAreaInsets()` dari `react-native-safe-area-context` yang mengembalikan angka, lalu kamu tambahkan sendiri ke padding.
  Token warna di `styles/common.ts` adalah pengganti CSS variable / SCSS variable yang biasa kamu pakai — dan dipakai konsisten dari `app/_layout.tsx:66` sampai screen-screen fitur.
- **Alternatif:**
  - **NativeWind / tailwind-rn** — menulis `className="flex-row p-4"` di RN; enak untuk yang datang dari Tailwind, tapi menambah step build (babel plugin) dan tim jadi punya dua bahasa style. Repo ini memilih token TS polos: nol dependensi, tapi lebih verbose.
  - **styled-components/native** — API mirip CSS-in-JS web; harganya overhead runtime per komponen dan style tidak bisa di-*flatten* sebaik `StyleSheet`.
  - **Tamagui / Gluestack (design system siap pakai)** — komponen jadi, tema light/dark otomatis; harganya lock-in dan bundle besar untuk app yang hanya butuh ±20 komponen.
- **Latihan:** `features/delivery/screens/QRScannerScreen/QRScannerScreen.tsx` membuat "lubang" viewfinder dengan tiga `View` gelap (`dimTop`, `dimSide`, `dimBottom`, `:190-212`). Tulis ulang overlay itu supaya viewfinder-nya **persegi panjang 280×180** dan tetap di tengah, tanpa mengubah `CameraView`. Lalu bandingkan: berapa baris CSS yang kamu butuhkan untuk efek yang sama di Ionic dengan `position:absolute` + `box-shadow: 0 0 0 9999px rgba(0,0,0,.6)`?

---

## 3. `expo-router`: file = route, `_layout.tsx`, dan route group `(tabs)`

- **Prasyarat:** 1, 2
- **Anchor:**
  - `app/_layout.tsx:83-98` — `RootLayout` mengembalikan `<Stack screenOptions={{ headerShown: false }} />`
  - `app/(tabs)/_layout.tsx:4-59` — `<Tabs>` + tiga `<Tabs.Screen name="index"|"orders"|"profile">`
  - `app/index.tsx:4-25` — route `/` yang **hanya** spinner
  - `app/(tabs)/index.tsx:1`, `app/login.tsx:1` — file route satu baris
  - `app.json:70` — `experiments.typedRoutes: true`
- **Kenapa dipakai di sini:** Struktur folder **adalah** tabel route. `app/login.tsx` → `/login`. `app/(tabs)/orders.tsx` → `/orders`, tapi kurung `(tabs)` adalah **route group**: nama grup tidak muncul di URL, ia hanya berarti "screen-screen ini berbagi layout tab bar". Ini kenapa `router.replace("/(tabs)")` di `app/_layout.tsx:59` mengarah ke tab pertama.
  `_layout.tsx` adalah bungkus untuk semua route di folder yang sama — persis peran `IonRouterOutlet` + `IonTabs` di Ionic React, hanya saja posisinya ditentukan oleh **lokasi file**, bukan oleh JSX yang kamu susun manual.
  Navigasi imperatif memakai `useRouter()`: `router.push("/signup")` (`features/auth/screens/LoginScreen/LoginScreen.tsx:125`), `router.replace("/(tabs)")` (`:119`), `router.back()` (`features/delivery/screens/QRScannerScreen/QRScannerScreen.tsx:22`). Parameter dibaca dengan `useLocalSearchParams<{ id?: string }>()` (`features/delivery/screens/TrackOnMapScreen/TrackOnMapScreen.tsx:29`) — bukan `useParams` dari react-router, dan tipenya kamu deklarasikan sendiri.
  `typedRoutes: true` membuat string route diperiksa TypeScript, jadi salah ketik `/loign` gagal compile.
- **Alternatif:**
  - **React Navigation langsung (tanpa expo-router)** — kamu mendaftarkan `Stack.Screen` secara eksplisit dalam kode; lebih verbose tapi route tidak "tersembunyi" di struktur folder, dan lebih mudah untuk route yang dibangun dinamis. expo-router sebenarnya *dibangun di atas* React Navigation — buktinya `@react-navigation/bottom-tabs` tetap ada di `package.json:18`.
  - **Ionic React Router** — kamu sudah tahu: route sebagai komponen JSX + `IonRouterOutlet`. Transfer konsepnya (stack, replace vs push, back) 1:1; yang berubah hanya *siapa* yang mendeklarasikan route.
  - **React Navigation + deep-link config manual** — expo-router memberi deep link gratis dari struktur file (`app.json:8` `scheme`); manual berarti kamu menulis `linking.config` sendiri.
- **Latihan:** Tambahkan tab keempat "Notifications". Kamu perlu (a) membuat `app/(tabs)/notifications.tsx` yang mere-export `NotificationScreen` dari `features/notifications/screens`, dan (b) menambahkan `<Tabs.Screen name="notifications" .../>` di `app/(tabs)/_layout.tsx`. Perhatikan bahwa route `/notifications` **sudah ada** di `app/notifications.tsx` — jelaskan apa yang terjadi pada URL dan bagaimana route group mempengaruhi konflik itu.

---

## 4. Route wrapper tipis + arsitektur feature-sliced

- **Prasyarat:** 3
- **Anchor:**
  - `app/login.tsx:1` — `export { LoginScreen as default } from '@/features/auth/screens';`
  - `app/track-on-map.tsx:1-5` — varian wrapper eksplisit
  - `features/delivery/` — `screens/`, `components/`, `hooks/`, `services/`, `utils/`, `workflow/`
  - `README.md:108-132` — penjelasan struktur dari penulisnya
- **Kenapa dipakai di sini:** README menyebutnya persis: *"app/ Expo Router routes — thin wrappers re-exporting feature screens"* (`README.md:111`). Konsekuensinya penting: karena `expo-router` memaksa struktur folder `app/`, tanpa aturan ini seluruh logika bisnis akan tumpah ke folder route dan kamu kehilangan kebebasan menyusun kode. Dengan wrapper tipis, `features/` bebas disusun per domain (13 fitur: auth, delivery, orders, home, notifications, profile, wallet, addresses, favorites, recurring, referrals, promo, support) dan file route tinggal satu baris.
  Setiap fitur punya bentuk yang sama: `services/*Api.ts` (fungsi HTTP murni), `hooks/use*.ts` (state + fetch), `screens/*/` (UI + `.styles.ts` + `components/`). Contoh lengkap: `features/delivery/services/deliveryApi.ts` → `features/delivery/hooks/useDelivery.ts` → `features/delivery/screens/DeliveryDetailScreen/`.
  Alias `@/` (`tsconfig.json:5-9`, dipetakan juga di `jest.config.js:4-6`) membuat import lintas fitur tetap pendek.
- **Alternatif:**
  - **Layered (folder `components/`, `screens/`, `services/` global)** — mudah dimulai, tapi pada 13 fitur kamu akan punya `services/` berisi 25 file tanpa batas domain.
  - **Menaruh logika langsung di file route `app/**`** — paling sedikit file; harganya: memindahkan/mengganti nama route berarti memindahkan logika bisnis, dan test jadi sulit karena logika terikat ke router.
  - **Monorepo package per fitur (Nx/Turborepo)** — batas paling tegas (bisa dipaksakan lewat lint); overkill untuk satu app.
- **Latihan:** Tambahkan route `app/order-detail.tsx` yang mere-export screen yang sudah ada, lalu ubah salah satu `router.push` di `features/orders/screens/OrdersScreen/` untuk memakainya. Catat: berapa file yang harus kamu sentuh? Bandingkan dengan berapa file yang harus disentuh jika `OrdersScreen` ditulis langsung di dalam `app/`.

---

## 5. Konfigurasi environment yang di-*inline* saat bundling (`EXPO_PUBLIC_*`)

- **Prasyarat:** 1
- **Anchor:**
  - `config/env.ts:1-40` — komentar header adalah penjelasan terbaiknya
  - `config/env.ts:19-21` — `LAN_IP` + `DEFAULT_API_URL`
  - `.env.example:1-16`
  - `__tests__/config/env.test.ts:1-5` — komentar "ENV is evaluated at import time"
- **Kenapa dipakai di sini:** Komentar di `config/env.ts:4-7` menyatakan aturannya: *"Expo only inlines env vars that are prefixed with `EXPO_PUBLIC_` into the JS bundle. Plain `.env` vars (e.g. `API_URL`) are NOT visible to React Native at runtime."* Ini berbeda tajam dari web: di Ionic, `process.env` diselesaikan oleh Vite/Webpack dan kamu bisa menaruh runtime config di `index.html` atau memuatnya via fetch. Di RN, nilai ini **dijahit ke dalam bundle**, jadi mengubah `.env` tanpa restart dev server tidak berefek (`README.md:163`).
  Ada nuansa yang penting untuk kamu yang Android-heavy: `config/env.ts:12-15` mendaftarkan tiga host yang berbeda per target — `10.0.2.2` untuk **Android emulator** (alias loopback host), `localhost` untuk iOS simulator, dan IP LAN untuk device fisik lewat Expo Go. Ini sumber bug nomor satu saat pertama kali menyambungkan app ke backend lokal.
  `ENV` diekspor sebagai satu objek `as const` (`config/env.ts:23-38`) sehingga hanya ada satu tempat membaca config — dan itu yang membuatnya bisa di-mock utuh dalam test (`__tests__/services/api/apiClient.test.ts:6-11`).
- **Alternatif:**
  - **`expo-constants` + `extra` di `app.json`** — nilai bisa berbeda per build profile EAS tanpa `.env`; harganya: nilainya tetap statis per build, dan kamu kehilangan kenyamanan `.env` lokal. Repo ini tetap memakai `expo-constants` untuk hal yang memang hanya ada di build: `Constants.expoConfig.extra.eas.projectId` (`services/notifications/push.ts:51-53`).
  - **`react-native-config`** — nilai native (juga terbaca dari Java/Obj-C); butuh dev build, tidak jalan di Expo Go.
  - **Remote config (fetch config saat startup)** — bisa diubah tanpa rilis ulang; harganya: satu request blocking sebelum app siap, dan URL fetch-nya sendiri tetap harus hard-coded.
- **Latihan:** Jalankan `npx jest __tests__/config/env.test.ts`. Lalu tambahkan var baru `EXPO_PUBLIC_MAP_DEFAULT_ZOOM` di `config/env.ts` dengan default, tulis test-nya meniru pola `loadEnv()` di `__tests__/config/env.test.ts:17-19`, dan jelaskan kenapa test itu wajib memanggil `jest.resetModules()` di `beforeEach`.

---

## 6. `apiClient`: HTTP client tulis-tangan di atas `fetch`

- **Prasyarat:** 5
- **Anchor:**
  - `services/api/apiClient.ts:59-135` — fungsi `request<T>()`
  - `services/api/apiClient.ts:80-81` — `AbortController` + `setTimeout` sebagai timeout
  - `services/api/apiClient.ts:117` — `if (res.status === 204) return undefined as T`
  - `services/api/apiClient.ts:125-126` — *"Unwrap TransformInterceptor wrapper: { success, data, timestamp }"*
  - `services/api/apiClient.ts:16-27` — kelas `ApiError`
  - `features/delivery/services/deliveryApi.ts:16-61` — bagaimana fitur memakainya
- **Kenapa dipakai di sini:** Ini adalah titik sambung langsung ke repo backend. Baris `services/api/apiClient.ts:126` membuka amplop respons NestJS: backend membungkus setiap respons sukses dengan `TransformInterceptor` menjadi `{ success, data, timestamp }`, jadi client mengembalikan `json.data` supaya seluruh app melihat DTO bersih. Tanpa ini, setiap call site harus menulis `.data` sendiri.
  `ApiError` menormalkan pesan error: jika body punya `message` (format error NestJS), itu yang dipakai; jika tidak, fallback ke `Request failed with status N` (`:21-25`). Karena itu `LoginScreen` cukup menampilkan `error.message` (`contexts/AuthContext.tsx:78`).
  Timeout tidak ada di `fetch` standar, jadi diimplementasikan manual dengan `AbortController` dan dinormalkan menjadi `ApiError(0, 'Request timed out')` (`:130-132`) — supaya UI hanya perlu menangani satu jenis error.
  `fetch` di RN adalah polyfill di atas native networking (bukan `XMLHttpRequest` browser): tidak ada CORS, tidak ada cookie otomatis, dan cleartext HTTP ke IP LAN perlu izin di build produksi Android.
- **Alternatif:**
  - **axios** — interceptor bawaan, `transformResponse`, progress upload, cancel token. Untuk kebutuhan repo ini (satu interceptor 401, satu unwrap) `fetch` sudah cukup dan menghemat ±13 kB bundle. Kalau nanti butuh upload progress untuk foto proof, axios/`XMLHttpRequest` menang telak.
  - **TanStack Query (React Query)** — caching, dedup, retry, `staleTime` — akan menghapus banyak hook manual di `features/**/hooks/`. Harganya: satu abstraksi besar lagi untuk dipelajari; repo ini memilih hook manual (lihat konsep 11).
  - **openapi-typescript / tRPC** — tipe DTO dibangkitkan dari backend, jadi tidak perlu `services/api/types.ts` ditulis tangan (dan tidak bisa *drift*). Tidak dipakai karena backend NestJS-nya tidak mengekspor skema ke mobile.
- **Latihan:** Tambahkan opsi `RequestOptions.retries?: number` sehingga `GET` yang gagal karena network error (bukan `ApiError` 4xx) dicoba ulang sekali. Tulis test-nya di `__tests__/services/api/apiClient.test.ts` memakai pola `mockResponse()` yang sudah ada (`:19-29`). Pastikan retry **tidak** ikut memicu jalur refresh 401.

---

## 7. Penyimpanan aman di device: `expo-secure-store`

- **Prasyarat:** 6
- **Anchor:**
  - `services/api/tokenStorage.ts:1-34` — `saveTokens`/`getTokens`/`clearTokens`
  - `features/delivery/services/handoffCodeStore.ts:3-16` — komentar rasional + *security trade-off* yang eksplisit
  - `app.json:54` — plugin `"expo-secure-store"`
- **Kenapa dipakai di sini:** Token JWT tidak boleh di `AsyncStorage` (plaintext di sandbox app). `expo-secure-store` menulis ke **Android Keystore / iOS Keychain**, terenkripsi at-rest. Ini padanan langsung dari `@capacitor/preferences` + `capacitor-secure-storage-plugin` yang biasa kamu pakai — bedanya di RN modul ini bagian dari SDK resmi dan tidak butuh WebView bridge.
  Yang menarik untuk diajarkan adalah `handoffCodeStore.ts`. Komentarnya (`:3-16`) menjelaskan sebuah keputusan desain nyata: backend mengembalikan kode handoff 6 digit **tepat sekali** dari `POST /deliveries`, jadi app harus menyimpannya sendiri agar penerima bisa membacanya lagi. Penulisnya lalu menuliskan *trade-off* keamanan secara terbuka: OTP plaintext hidup di keychain selama pengiriman berlangsung, tidak pernah di-log, tidak sync ke cloud, dan tetap tidak berguna tanpa JWT pemilik karena backend membatasi 5 percobaan. Ini contoh bagus "dokumentasikan kompromi, jangan sembunyikan".
  Kode itu dihapus otomatis saat delivery selesai — lihat `features/delivery/hooks/useDeliveryTracking.ts:99` `void clearHandoffCode(deliveryId)`.
- **Alternatif:**
  - **`@react-native-async-storage/async-storage`** — cepat, tanpa batas ukuran praktis, tapi **tidak terenkripsi**; cocok untuk preferensi UI, bukan token.
  - **`react-native-mmkv`** — jauh lebih cepat (sync, tanpa bridge) dan bisa dienkripsi dengan kunci sendiri; harganya: kamu yang mengelola kunci enkripsinya, dan butuh dev build.
  - **Menyimpan token di memori saja** — paling aman, tapi user harus login ulang setiap cold start; `contexts/AuthContext.tsx:50-66` justru dibangun untuk menghindari itu.
- **Latihan:** `SecureStore` punya batas ukuran nilai (~2 KB di Android sebelum fallback). Tambahkan pembungkus `safeSetItem` di `services/api/tokenStorage.ts` yang menolak nilai > 2000 karakter dan lempar error yang jelas, lalu tambahkan test memakai `__mocks__/expo-secure-store.ts` yang sudah ada.

---

## 8. `AuthContext`: React Context sebagai state global + hidrasi sesi

- **Prasyarat:** 7
- **Anchor:**
  - `contexts/AuthContext.tsx:21-111` — `AuthProvider`
  - `contexts/AuthContext.tsx:50-66` — efek hidrasi saat mount
  - `contexts/AuthContext.tsx:28-40` — `logout` best-effort ke server, lalu selalu bersihkan lokal
  - `contexts/AuthContext.tsx:113-119` — `useAuth()` dengan guard
- **Kenapa dipakai di sini:** Learner ini belum tahu Redux Toolkit — dan repo ini memang tidak memakainya. Untuk state yang benar-benar global dan **sedikit** (`user`, `isAuthenticated`, `isLoading`), Context + `useState` sudah cukup dan nol dependensi.
  Yang layak dibedah adalah `isLoading: true` sebagai nilai awal (`:25`). Ini bukan spinner kosmetik: aplikasi harus tahu perbedaan antara "belum tahu apakah user login" dan "sudah tahu bahwa user tidak login". Efek di `:50-66` membaca token dari SecureStore, lalu memanggil `GET /users/me` untuk memverifikasi bahwa token itu masih sah; kalau gagal, token dibuang. Baru setelah itu `isLoading` menjadi `false`.
  `logout` (`:28-40`) sengaja *best-effort* ke server (`/auth/logout` untuk mencabut refresh token) tetapi **selalu** membersihkan lokal — komentarnya: *"logout must succeed locally regardless"*.
  `useAuth` melempar error kalau dipakai di luar provider (`:115-117`) — pola guard yang membuat kesalahan wiring ketahuan langsung, dan yang di-test di `__tests__/contexts/AuthContext.test.tsx:45-55`.
- **Alternatif:**
  - **Redux Toolkit** — devtools, time-travel, middleware, satu store untuk semua fitur. Berlebihan di sini: hanya `auth` yang benar-benar global; data delivery/orders/notifikasi bersifat *server state* per screen. Kalau nanti ada cart/draft lintas screen, RTK mulai masuk akal.
  - **Zustand / Jotai** — API jauh lebih ringan dari Redux, tidak memaksa provider, dan menghindari re-render seluruh subtree yang jadi kelemahan Context. Ini pengganti paling wajar kalau state global bertambah.
  - **TanStack Query untuk sesi** — memperlakukan `GET /users/me` sebagai query dengan cache; menghapus efek hidrasi manual, tapi menambah dependensi besar.
- **Latihan:** Ukur kelemahan Context: tambahkan `console.log` render di `features/orders/screens/OrdersScreen/OrdersScreen.tsx`, lalu panggil `refreshUser()` dari Profile. Amati komponen mana saja yang re-render. Lalu tulis (di cabang percobaan) versi `AuthContext` yang memisahkan value menjadi dua context — `AuthStateContext` dan `AuthActionsContext` — dan jelaskan apa yang berubah.

---

## 9. Refresh token, `setOnLogout`, dan `noAuthRetry`

- **Prasyarat:** 6, 8
- **Anchor:**
  - `services/api/apiClient.ts:29-57` — `isRefreshing` / `refreshPromise` / `refreshAccessToken()`
  - `services/api/apiClient.ts:95-114` — jalur penanganan 401
  - `services/api/apiClient.ts:6-14` — dokumentasi opsi `noAuthRetry`
  - `contexts/AuthContext.tsx:42-47` — `setOnLogout(() => { logout(); })`
  - `features/delivery/services/deliveryApi.ts:22-31` — pemakaian nyata `noAuthRetry`
- **Kenapa dipakai di sini:** Ada dua ide penting di sini, dan keduanya punya jejak komentar.
  **(a) Menghindari refresh berbarengan.** Kalau lima request berjalan paralel dan semuanya kena 401, kamu tidak boleh menembak `/auth/refresh` lima kali (refresh token biasanya *rotating* — request kedua akan gagal dan melogout user). Karena itu ada satu `refreshPromise` yang di-*share* (`:96-101`), dan semua request menunggu promise yang sama.
  **(b) 401 tidak selalu berarti "sesi habis".** Ini yang paling instruktif. Komentar di `services/api/apiClient.ts:10-13` menyatakan: *"For endpoints where a 401 is a legitimate domain outcome, e.g. a wrong handoff code on /confirm-handoff."* Lalu `features/delivery/services/deliveryApi.ts:22-24` menjelaskan konsekuensinya: *"a 401 here means 'wrong code', NOT an expired session, so it must throw (not refresh+logout the user out of the app)."* Tanpa flag ini, salah ketik kode 6 digit akan **melempar user keluar dari aplikasi**.
  **(c) Wiring melingkar tanpa import melingkar.** `apiClient` perlu memanggil `logout()`, tapi `AuthContext` meng-import `apiClient`. Solusinya callback registry: `setOnLogout` (`apiClient.ts:33-35`) dipanggil dari efek di `AuthContext` (`:43-47`). Ini pola dependency-injection paling sederhana yang mungkin — dan bagus untuk memperkenalkan ide DI sebelum learner bertemu DI decorator-based di backend NestJS.
- **Alternatif:**
  - **Interceptor axios** — bentuk kanonik untuk masalah yang sama; solusi single-flight-nya identik (antrean request + retry).
  - **Refresh proaktif berdasarkan `exp` di JWT** — dekode token dan refresh sebelum kadaluwarsa; menghindari 401 sama sekali, tapi butuh parsing JWT di client dan tetap butuh jalur reaktif untuk token yang dicabut server.
  - **Cookie `HttpOnly` + refresh di server** — standar di web; tidak praktis di RN karena tidak ada cookie jar browser dan token dipakai juga untuk handshake WebSocket (`services/api/trackingSocket.ts:221`).
- **Latihan:** Tulis test di `__tests__/services/api/apiClient.test.ts` yang memicu **dua** request paralel yang keduanya menerima 401, lalu buktikan `fetch` ke `/auth/refresh` hanya terjadi **sekali**. Setelah lulus, hapus sementara guard `isRefreshing` dan lihat test-nya gagal — itu penjelasan terbaik kenapa guard-nya ada.

---

## 10. `AuthGate`: route guard yang hidup di layout

- **Prasyarat:** 3, 8
- **Anchor:**
  - `app/_layout.tsx:8-24` — `PUBLIC_SEGMENTS` beserta komentar panjang tentang bug `""`
  - `app/_layout.tsx:29-42` — dokumentasi dua bug yang diperbaiki satu mekanisme
  - `app/_layout.tsx:43-72` — implementasi `AuthGate`
  - `app/index.tsx:4-11` — kenapa `/` hanya spinner
- **Kenapa dipakai di sini:** Ini contoh paling kaya di repo tentang "kenapa kode ini seperti ini". Komentar di `app/_layout.tsx:29-42` menyebut dua bug nyata yang digabung jadi satu mekanisme:
  1. `app/index.tsx` dulu berisi `export { default } from './login'`, jadi route awal **selalu** form login dan sesi valid dibuang setiap cold start.
  2. Saat refresh token kadaluwarsa, `AuthContext` membersihkan state tapi tidak ada yang navigasi — user tertinggal di screen ter-autentikasi *dengan polling tracking 4 detik masih jalan* sampai app dibunuh.
  Kesimpulannya: *"when auth state and the current route disagree, the route moves."*
  Detail yang sangat mudah salah: `""` (route index) **sengaja tidak** dimasukkan ke `PUBLIC_SEGMENTS` (`:13-17`). Kalau dimasukkan, cold start dalam keadaan logout akan mendarat di `""`, gate menganggapnya publik, dan user menatap spinner selamanya.
  Guard `if (isLoading) return;` (`:50`) juga esensial: mengambil keputusan sebelum hidrasi selesai akan melempar user yang sudah login ke `/login` untuk satu frame.
  `useSegments()` (`:45`) memberi segmen route saat ini sebagai array — inilah cara expo-router menjawab "di mana kita sekarang" tanpa mem-parse URL.
- **Alternatif:**
  - **Redirect per screen (`<Redirect href="/login" />` di tiap route)** — eksplisit dan lokal, tapi harus diulang di ±25 file dan mudah lupa saat menambah screen.
  - **Dua stack terpisah (`(auth)` dan `(app)`) yang dipilih di root layout** — pola standar React Navigation; struktur lebih bersih dan tidak perlu daftar segmen, tapi butuh reorganisasi folder dan membuat deep link ke screen ter-proteksi lebih rumit.
  - **Guard di `apiClient` saja** — sudah ada (`setOnLogout`), tapi hanya menangani konsekuensi jaringan; tidak menangani cold start. Repo ini memakai keduanya, dan itu poin pengajarannya.
- **Latihan:** Simulasikan bug kedua: di `contexts/AuthContext.tsx`, panggil `logout()` dari console/debug saat kamu sedang berada di `/track-on-map?id=...`. Verifikasi kamu terlempar ke `/login` dan polling berhenti. Lalu komentari sementara blok `if (!isAuthenticated && !isPublic)` di `app/_layout.tsx:56-57` dan ulangi — jelaskan apa yang kamu lihat dan hubungkan dengan komentar di `:36-39`.

---

## 11. Pola hook data per fitur (tanpa Redux, tanpa React Query)

- **Prasyarat:** 6
- **Anchor:**
  - `features/orders/hooks/useDeliveries.ts:5-31` — bentuk kanonik `{ data, loading, error, refetch }`
  - `features/delivery/hooks/useDelivery.ts:5-30`
  - `features/delivery/hooks/useTrackDelivery.ts:5-28` — varian *imperatif* (dipicu tombol, bukan mount)
  - `features/notifications/hooks/useUnreadCount.ts:12-16` — kegagalan sengaja ditelan agar count lama tetap tampil
- **Kenapa dipakai di sini:** Ada satu bentuk yang diulang di 20+ hook: `useState` untuk data/loading/error, `useCallback` untuk fetch, `useEffect` untuk memicunya, lalu mengembalikan `refetch`. Konsistensi ini membuat repo bisa dibaca cepat, dan membuat setiap hook bisa di-test tanpa merender screen (lihat `__tests__/features/orders/hooks/useDeliveries.test.ts`).
  Perhatikan detail kecil yang penting di `features/orders/hooks/useDeliveries.ts:26`: dependency array-nya adalah **field-field** `params` (`params.status, params.q, params.sort, params.page, params.limit`), bukan objek `params` itu sendiri. Kalau objeknya yang dipakai, setiap render induk membuat objek baru → `useCallback` berubah identitas → `useEffect` jalan lagi → fetch tak berujung. Ini jebakan React yang universal, tapi di RN akibatnya lebih terasa (request 4G berulang, baterai).
  Varian `useTrackDelivery` (`:10-25`) sengaja **tidak** punya `useEffect`: ia mengembalikan fungsi `track(trackingId)` yang dipanggil dari tombol. Ini menunjukkan bahwa "hook" bukan selalu berarti "fetch saat mount".
- **Alternatif:**
  - **TanStack Query** — cache antar-screen, dedup, retry, `refetchOnFocus`. Akan menghapus ±60% baris di `features/**/hooks/`. Harganya: satu dependensi + model mental cache key; dan hook manual di sini sudah cukup karena hampir tidak ada data yang dipakai ulang lintas screen.
  - **RTK Query** — sama seperti di atas tapi terintegrasi Redux; masuk akal hanya kalau kamu sudah memakai Redux untuk hal lain.
  - **SWR** — lebih ringan dari React Query, API-nya paling dekat dengan hook manual ini; migrasi paling murah kalau nanti butuh cache.
- **Latihan:** Rusak dulu, lalu perbaiki: di `features/orders/hooks/useDeliveries.ts`, ganti dependency array baris 26 menjadi `[params]`. Tambahkan `console.log('fetch')` dan buka tab Orders. Hitung berapa kali fetch terjadi. Kembalikan, lalu tulis versi ketiga yang memakai `useMemo` di *pemanggil* untuk menstabilkan `params` — bandingkan mana yang lebih tahan-salah.

---

## 12. Tombol back hardware Android & `useFocusEffect`

- **Prasyarat:** 3
- **Anchor:**
  - `features/home/screens/HomeScreen/HomeScreen.tsx:73-99` — komentar + implementasi "tekan dua kali untuk keluar"
  - `features/auth/screens/LoginScreen/LoginScreen.tsx:71-85` — exit-on-back yang di-scope ke fokus
  - `features/profile/screens/ProfileScreen/ProfileScreen.tsx:56-58` — komentar kenapa **tidak** ada handler di sini
- **Kenapa dipakai di sini:** Ini murni masalah Android dan sangat relevan untukmu. Komentar di `HomeScreen.tsx:75-79` menuliskan bug-nya dengan tepat: *"Tab screens never unmount in Expo Router, so a mount-scoped handler stays registered for the whole session and swallows Back on every other screen too — which is how Back came to quit the app from anywhere, including mid-form."*
  Perbaikannya bukan mengganti logika, melainkan mengganti **scope**: `useEffect` (mount) → `useFocusEffect` (fokus). `useFocusEffect` menjalankan efek saat screen mendapat fokus dan membersihkannya saat kehilangan fokus — persis yang dibutuhkan untuk handler global seperti `BackHandler`.
  `ProfileScreen.tsx:56-58` melengkapi pelajarannya dengan kasus negatif: di sana handler **sengaja dihapus**, karena Back dari tab Profile seharusnya kembali, bukan keluar dari app.
  Di Ionic/Capacitor kamu menangani ini dengan `App.addListener('backButton', ...)` — masalah scope-nya identik, hanya API-nya berbeda; jadi intuisimu langsung transfer.
  Perhatikan juga `ToastAndroid` (`HomeScreen.tsx:7`, `:91`) — API khusus Android, tidak ada di iOS. Padanan `@capacitor/toast` yang lintas platform.
- **Alternatif:**
  - **`useEffect` biasa** — apa yang justru menyebabkan bug ini; hanya aman untuk screen yang benar-benar unmount.
  - **Satu handler global di root layout dengan cek `useSegments()`** — satu tempat, tapi root harus tahu aturan setiap screen (kopling terbalik).
  - **`Stack.Screen options={{ gestureEnabled: false }}` / `predictiveBackGestureEnabled`** — kontrol di level navigator, bukan JS. Repo ini men-set `predictiveBackGestureEnabled: false` di `app.json:23` justru agar perilaku back tetap deterministik.
- **Latihan:** Terapkan pola yang sama untuk `features/delivery/screens/CreateDeliveryScreen/`: tambahkan `useFocusEffect` + `BackHandler` yang menampilkan `Alert` konfirmasi "Buang draft ini?" ketika form sudah terisi. Verifikasi handler-nya **tidak** aktif lagi setelah kamu berpindah ke screen lain — cara membuktikannya: `console.log` di fungsi cleanup.

---

## 13. Native modules & permission: kamera, lokasi, push notification

- **Prasyarat:** 1, 5
- **Anchor:**
  - `features/delivery/screens/QRScannerScreen/QRScannerScreen.tsx:19` + `:43-63` + `:67-72` — `useCameraPermissions()`, UI "belum diizinkan", `<CameraView onBarcodeScanned>`
  - `features/delivery/screens/ProofCaptureScreen/ProofCaptureScreen.tsx:30-53` — `takePictureAsync({ base64: true, quality: 0.4 })` + lokasi *best-effort*
  - `services/notifications/push.ts:32-74` — `registerForPushNotifications()`
  - `services/notifications/push.ts:36-41` — notification channel khusus Android
  - `features/notifications/PushRegistrar.tsx:13-27` — komponen headless
  - `app.json:48-60` — config plugin `expo-location` (teks izin) & `expo-notifications`
- **Kenapa dipakai di sini:** Di Capacitor, permission datang dari plugin dan teks izin ditulis di `AndroidManifest.xml`/`Info.plist` yang kamu edit langsung. Di Expo, teks izin dideklarasikan di `app.json` sebagai **config plugin**: `app.json:51` berisi kalimat `"Allow Drovery to access your location to set pickup and delivery points."` — dan plugin itulah yang menuliskannya ke `Info.plist`/manifest saat prebuild. Kamu tidak pernah menyentuh file native.
  Pola permission-nya sangat React-ish: `const [permission, requestPermission] = useCameraPermissions()` (`QRScannerScreen.tsx:19`) — sebuah hook, bukan promise satu kali. Screen menangani **tiga** keadaan: `!permission` (belum tahu → render kosong, `:43-45`), `!permission.granted` (render layar penjelasan + tombol, `:47-63`), dan granted (render kamera). Ini kontras dengan gaya Capacitor `await Camera.requestPermissions()` yang biasanya imperatif.
  `services/notifications/push.ts` menunjukkan disiplin *degradasi anggun* yang eksplisit: doc-comment `:29-31` menyatakan *"Best-effort: returns null (without throwing) on simulators, in Expo Go, or when permission is denied — the app still works, just without remote push."* Ini penting karena Expo Go **tidak bisa** memberi push token produksi. Juga `:36-41`: Android sejak O mewajibkan notification channel; tanpa ini notifikasi tidak muncul sama sekali.
  `PushRegistrar` (`features/notifications/PushRegistrar.tsx`) adalah komponen yang `return null` — dipasang di `app/_layout.tsx:86` hanya untuk menjalankan efek saat `isAuthenticated` berubah. Pola "headless component" ini akan sering kamu temui di RN.
  Di `ProofCaptureScreen.tsx:38-47`, lokasi diambil dalam `try/catch` terpisah dengan komentar *"location is optional"* — foto tetap terkirim walau GPS gagal.
- **Alternatif:**
  - **Capacitor plugins** — `@capacitor/camera` mengembalikan base64 juga; perbedaan nyata: kamera Capacitor membuka activity kamera **sistem**, sedangkan `CameraView` adalah preview native yang di-*embed* — itulah yang memungkinkan overlay viewfinder kustom di `QRScannerScreen`.
  - **`react-native-vision-camera`** — jauh lebih cepat, frame processor untuk ML/barcode realtime; harganya: butuh dev build, konfigurasi lebih berat. Untuk sekadar scan QR, `expo-camera` cukup.
  - **Firebase Cloud Messaging langsung (`@react-native-firebase/messaging`)** — tanpa perantara Expo push service, kontrol penuh atas payload; harganya: `google-services.json`, dev build, dan dua implementasi (FCM + APNs). Repo memilih Expo push token karena satu token untuk dua platform (`push.ts:55-58`).
  - **Local notification saja (tanpa remote)** — repo ini sebenarnya memakai keduanya: `presentLocalNotification` (`push.ts:80-94`) dipakai saat app sedang di foreground dan mendeteksi perubahan status sendiri.
- **Latihan:** Jalankan `npm run android`, buka layar QR scanner, dan tolak izin kamera. Verifikasi kamu melihat layar dari `QRScannerScreen.tsx:47-63`. Lalu tambahkan tombol kedua "Buka Pengaturan" yang memanggil `Linking.openSettings()` — karena setelah user menolak permanen, `requestPermission()` tidak akan memunculkan dialog lagi. Jelaskan kenapa langkah ini wajib di Android tapi sering dilupakan.

---

## 14. Peta native: `react-native-maps` + `AnimatedRegion`

- **Prasyarat:** 2, 13
- **Anchor:**
  - `features/delivery/screens/TrackOnMapScreen/TrackOnMapScreen.tsx:13-19` — impor `MapView, AnimatedRegion, Marker, MarkerAnimated, Polyline, PROVIDER_DEFAULT`
  - `TrackOnMapScreen.tsx:139-150` — `<MapView style={StyleSheet.absoluteFillObject}>`
  - `TrackOnMapScreen.tsx:54-79` — `AnimatedRegion` + `.timing({...duration: 3500})`
  - `TrackOnMapScreen.tsx:129-134` — `mapRef.current?.fitToCoordinates(...)`
  - `features/delivery/screens/CreateDeliveryScreen/components/LocationPickerModal.tsx:82-95` + `:22` — reverse geocode lewat backend, autocomplete lewat Nominatim
  - `app.json:24-28` + `README.md:156` — placeholder API key
- **Kenapa dipakai di sini:** Ini perbedaan paling dramatis dari dunia WebView. `<MapView>` bukan iframe dan bukan canvas — ia adalah **view native** (Google Maps / MapKit) yang disisipkan ke dalam pohon view, dan `<Marker>` anak-anaknya bisa berisi komponen React biasa (`TrackOnMapScreen.tsx:178-187` menaruh `<View>` + ikon + animasi pulse *di dalam* marker). Di Leaflet/Google JS kamu harus membuat `divIcon` HTML.
  `AnimatedRegion` (`:54-61`) ada untuk masalah yang spesifik: posisi drone datang berkala (WS atau poll 4 detik). Tanpa interpolasi, marker akan "teleport". Komentar `:52-53` menjelaskan: *"Animated drone position — glides smoothly to each polled location so the drone visibly 'flies' between updates instead of teleporting."* Animasi itu dijalankan di sisi native, bukan JS.
  Ada juga catatan jujur tentang tipe yang salah di library (`:67-69`): *"react-native-maps' AnimatedRegion.timing accepts lat/lng directly; the typings incorrectly require `toValue`, so cast the config."* — contoh bagus bahwa `as any` kadang keputusan sadar yang didokumentasikan.
  `LocationPickerModal.tsx:85-86` memuat keputusan arsitektur menarik: reverse-geocode dilewatkan **backend** (`/geo/reverse`, ber-API-key dan ter-rate-limit), sementara autocomplete multi-hasil tetap langsung ke Nominatim karena `/geo` tidak punya list search. Ini contoh kompromi yang ditulis apa adanya.
  Jebakan operasional: `app.json:26` masih `YOUR_GOOGLE_MAPS_API_KEY`, dan README memperingatinya (`:156`, `:160`) — tanpa key, peta **blank** di build device, bukan error.
- **Alternatif:**
  - **`@rnmapbox/maps`** — vector tiles, styling peta penuh, offline map; harganya: token Mapbox berbayar dan setup native lebih berat.
  - **WebView + Leaflet/Google JS** — persis yang biasa kamu lakukan di Ionic; nol native setup dan bisa dipakai di Expo Go, tapi performa pan/zoom buruk pada peta live dan marker kustom React tidak bisa.
  - **`expo-maps`** — modul Expo yang lebih baru; lebih rapi di managed workflow, tapi permukaan API-nya masih lebih sempit dari `react-native-maps` (mis. `AnimatedRegion`).
  - **Geocoding**: Google Places API (hasil jauh lebih baik untuk alamat Indonesia, berbayar) vs Nominatim/OSM (gratis, rate-limit ketat, wajib `User-Agent` — lihat `LocationPickerModal.tsx:23-26`).
- **Latihan:** Ganti `PROVIDER_DEFAULT` (`TrackOnMapScreen.tsx:141`) menjadi `PROVIDER_GOOGLE` dan jalankan di emulator Android tanpa mengisi API key. Catat apa yang kamu lihat (peta abu-abu polos, tanpa exception). Lalu isi key yang valid di `app.json:26` dan bandingkan. Tulis paragraf singkat: kenapa mode gagal "diam" ini jauh lebih berbahaya daripada error, dan bagaimana kamu akan mendeteksinya di CI?

---

## 15. Animasi: Reanimated vs `Animated` bawaan RN

- **Prasyarat:** 2
- **Anchor:**
  - `features/auth/screens/LoginScreen/LoginScreen.tsx:16-19` + `:27-32` — `FadeIn`/`FadeInDown` dari `react-native-reanimated` sebagai *entering animation* deklaratif
  - `features/delivery/screens/TrackOnMapScreen/TrackOnMapScreen.tsx:106-127` — `Animated.loop` + `Animated.sequence` dari core RN, dengan `useNativeDriver: true`
  - `TrackOnMapScreen.tsx:74` — `useNativeDriver: false` untuk `AnimatedRegion`
  - `features/delivery/screens/CreateDeliveryScreen/components/CustomCalendar.tsx:3` — `SlideInDown`/`SlideOutDown`
  - `package.json:46,51` — `react-native-reanimated` + `react-native-worklets`
- **Kenapa dipakai di sini:** Di WebView kamu memakai CSS transition/animation, dan browser menjalankannya di compositor thread — jadi animasi tetap halus walau JS sibuk. Di RN, tanpa perhatian khusus, animasi berjalan di JS thread dan **akan patah** saat kamu sedang merge frame tracking atau parsing JSON.
  Karena itu ada dua alat di repo ini:
  - **Reanimated** untuk animasi entering deklaratif (`FadeInDown.delay(100).duration(500).springify()`, `LoginScreen.tsx:30`). Reanimated menjalankan animasi sebagai *worklet* di UI thread — analog paling dekat dengan CSS animation dari sisi "tidak terganggu JS".
  - **`Animated` core** untuk loop sederhana (`TrackOnMapScreen.tsx:111-124`), dengan `useNativeDriver: true` supaya transform di-*offload* ke native.
  Perhatikan kontras di baris `TrackOnMapScreen.tsx:74`: `useNativeDriver: false` untuk `AnimatedRegion` — karena koordinat peta bukan properti transform/opacity yang bisa dijalankan native driver. Aturan praktisnya: `useNativeDriver: true` hanya untuk `transform` dan `opacity`; layout (width/height/top) tidak bisa.
  Detail lain: loop pulse **berhenti** ketika pengiriman sudah selesai (`:107-110`, komentar `:104-105`) — animasi terus-menerus di layar peta adalah pemboros baterai nyata di Android.
- **Alternatif:**
  - **`Animated` core saja** — nol dependensi tambahan, tapi animasi berbasis JS driver mudah patah saat thread sibuk, dan gesture-driven animation sangat sulit.
  - **`LayoutAnimation`** — satu baris untuk transisi layout otomatis; tidak bisa dikontrol per-properti dan bermasalah di Android.
  - **Moti** (wrapper di atas Reanimated) — API deklaratif mirip Framer Motion; lebih ramah kalau kamu datang dari web, tapi satu lapis abstraksi lagi.
  - **Lottie (`lottie-react-native`)** — untuk ilustrasi animasi buatan desainer; bukan pengganti animasi UI.
- **Latihan:** Di `TrackOnMapScreen.tsx`, ubah `useNativeDriver: true` (baris 116/121) menjadi `false`, lalu tambahkan loop sintetis yang membebani JS thread (misal `setInterval` yang menjalankan `JSON.parse` pada string besar tiap 16 ms). Amati pulse-nya tersendat. Kembalikan ke `true` dan ulangi — kamu baru saja melihat sendiri kenapa native driver ada.

---

## 16. WebSocket client tulis-tangan: `deriveWsBaseUrl` + `openTracking`

- **Prasyarat:** 5, 6, 7
- **Anchor:**
  - `services/api/wsUrl.ts:1-17` — seluruh file (komentarnya lebih panjang dari kodenya, dan itu disengaja)
  - `services/api/trackingSocket.ts:71-80` — doc-comment kontrak `openTracking`
  - `services/api/trackingSocket.ts:86-92` — jalur "tidak ada WebSocket impl" (jest/node)
  - `services/api/trackingSocket.ts:145-156` — backoff eksponensial + jitter
  - `services/api/trackingSocket.ts:191-198` — kirim `subscribe`, pasang timeout ack
  - `services/api/trackingSocket.ts:200-205` — `close code 1008` = auth, bukan drop biasa
  - `features/support/services/supportSocket.ts:6-26` — pola yang sama, di-*reuse* untuk chat support
- **Kenapa dipakai di sini:** `services/api/wsUrl.ts` adalah contoh terbaik di repo ini tentang "komentar yang menjelaskan pengetahuan lintas-repo". Ia menjelaskan tiga hal sekaligus:
  1. **Kenapa prefix dibuang.** *"The backend WS gateway attaches to the SAME http server at ROOT — the `/api/v1` global prefix is HTTP-only and does NOT apply to the socket path (see backend main.ts...)."* Jadi socket ada di `ws(s)://host:port/`, bukan `/api/v1`.
  2. **Kenapa pakai regex, bukan `new URL()`.** *"to avoid React Native URL polyfill edge cases"* — RN tidak punya `URL` bawaan yang lengkap; ini perbedaan runtime konkret dari browser.
  3. **Kenapa port tidak boleh di-hardcode.** *"never hardcode :3000 — prod TLS may terminate on 443"*.
  `openTracking` (`trackingSocket.ts:81-251`) menerapkan disiplin desain yang layak diajarkan: **handle sekali pakai**. Doc-comment `:72-75`: *"The handle is immutable and disposable — one handle = one attempt-chain — so a caller's teardown is always just `close()`."* Untuk re-handshake setelah token refresh, pemanggil menutup handle lama dan membuka yang baru. Ini menghilangkan seluruh kelas bug "socket zombie".
  Kegagalannya juga dikategorikan sebagai tipe, bukan pesan bebas: `UnavailableReason` (`:20-25`) punya 5 nilai (`no-websocket`, `no-token`, `connect-error`, `subscribe-error`, `drop-exhausted`) — sehingga pemanggil bisa memutuskan strategi fallback yang tepat.
  Autentikasi memakai query param `?token=` di handshake (`:221`) karena WebSocket browser/RN **tidak bisa** mengirim header kustom saat connect — batasan yang sering mengejutkan orang yang terbiasa `Authorization: Bearer` di HTTP.
  Backoff-nya bukan sekadar retry: eksponensial (`factor: 2`), dibatasi (`maxDelayMs: 15000`), berjitter (`jitterMs: 250`, `:153`) agar 1000 client tidak reconnect serempak, dan berbatas (`maxAttempts: 5`).
  `features/support/services/supportSocket.ts:7-8` menyatakan reuse-nya secara eksplisit: *"Modeled EXACTLY on the tracking socket"* — bukti pola ini memang dirancang untuk diulang.
- **Alternatif:**
  - **socket.io-client** — reconnect, room, ack, fallback polling — semuanya gratis. Tidak dipakai karena backend memakai `WsAdapter` NestJS (WebSocket mentah), bukan adapter socket.io; memakai socket.io berarti mengubah backend. Kalau kamu memulai dari nol, socket.io menghemat ~250 baris yang ada di file ini.
  - **Server-Sent Events (SSE)** — satu arah, reconnect otomatis oleh spesifikasi, lebih sederhana; cocok karena tracking memang satu arah, tapi chat support (`supportSocket`) butuh dua arah, jadi WS menang untuk konsistensi.
  - **Polling saja** — persis fallback-nya (konsep 17); paling sederhana dan paling tahan-banting, tapi latensi 4 detik dan boros baterai/kuota.
  - **`@microsoft/signalr` / Ably / Pusher** — layanan terkelola dengan presence & history; menambah biaya dan vendor.
- **Latihan:** Baca `__tests__/services/api/trackingSocket.test.ts:7-38` untuk memahami `FakeWebSocket`. Lalu tambahkan test baru: setelah `maxAttempts` drop berturut-turut, `onUnavailable('drop-exhausted')` dipanggil **tepat sekali** dan tidak ada `FakeWebSocket` baru yang dibuat setelahnya. Kamu akan butuh `jest.useFakeTimers()` untuk melompati delay backoff.

---

## 17. Strategi WS-primary / poll-fallback dan merge frame parsial

- **Prasyarat:** 11, 16
- **Anchor:**
  - `features/delivery/hooks/useDeliveryTracking.ts:35-43` — doc-comment strategi
  - `useDeliveryTracking.ts:49-66` — enam `useRef` beserta alasan masing-masing
  - `useDeliveryTracking.ts:70-85` — `notifyOnStatusTransition`, satu-satunya tempat `prevStatusRef` dibaca/diubah
  - `useDeliveryTracking.ts:145-160` — `reconcile()` dan kenapa ia tidak memicu notifikasi ganda
  - `useDeliveryTracking.ts:182-255` — efek utama, termasuk variabel `active` dan alasannya (`:185-188`)
  - `features/delivery/services/deliveryTrackingMerge.ts:16-31` — "Rule 0"
- **Kenapa dipakai di sini:** Ini bagian tersulit di repo dan alasan kenapa ia sulit ada di doc-comment-nya (`:36-42`): *"WS-PRIMARY / POLL-FALLBACK: while a tracking socket is connected+subscribed, position/status frames are merged in place (zero HTTP); if the socket is unavailable or drops past its reconnect budget, the hook falls back to the proven 4s getById poll so tracking never goes dark."*
  Yang membuatnya sulit bukan WebSocket-nya, melainkan **koreografi ref**. Setiap ref menjawab pertanyaan berbeda dan komentarnya menyebutkan itu (`:51-66`):
  - `prevStatusRef` — de-duplikasi notifikasi (agar transisi status tidak memicu dua notifikasi: satu dari push WS, satu dari `reconcile`).
  - `statusRef` — supaya timer/teardown tahu kapan berhenti.
  - `dataRef` — basis merge sinkron, menghindari *stale closure*.
  - `idRef` — *"an async getById captures its request id and compares against this on resolution, so a response that arrives AFTER the id switched is dropped instead of stomping the new delivery's data."*
  - `reconcileSeqRef` — token monoton agar hanya reconcile terbaru yang boleh menulis (out-of-order response).
  - `auth1008DidReconcileRef` — pembatas: refresh token + reopen socket hanya boleh sekali, mencegah loop `1008 → getById → 1008`.
  Ditambah `let active = true` di dalam efek (`:188`, komentar `:185-187`): *"Unlike the shared mountedRef, it lets a stale-closure callback tell 'my effect instance was torn down' from 'a newer instance mounted', so a suspended onAuthFailed can't resurrect a socket for the old delivery."*
  Di sisi merge, `deliveryTrackingMerge.ts` punya dua aturan yang halus dan mahal kalau salah:
  - **Rule 0** (`:22-26`): kalau belum ada delivery dasar, frame **dibuang** — jangan pernah mengarang `ApiDelivery` parsial, karena screen peta membaca `fromLat/toLat/addresses/trackingId` yang tidak ada di frame.
  - `:42` — *"undefined-checks, NOT truthiness: a 0 / negative coordinate is valid."* Koordinat `0` (khatulistiwa) atau negatif (Indonesia selatan!) akan hilang kalau kamu menulis `if (u.droneLat)`.
  Perhatikan juga bahwa merge mengembalikan **referensi yang sama** kalau tidak ada perubahan (`:36`), sehingga React tidak re-render tanpa alasan.
- **Alternatif:**
  - **Polling saja (versi sebelumnya)** — jauh lebih sederhana, tidak ada ref choreography; harganya: 15 request/menit per delivery aktif dan posisi drone terlambat hingga 4 detik.
  - **WS saja tanpa fallback** — kode paling bersih; harganya: tracking mati total di jaringan yang memblokir WS (kantor/kampus/proxy), yang persis skenario dipakainya app pengiriman.
  - **TanStack Query + `setQueryData` dari socket** — mengurus dedup/refetch/stale, jadi kamu hanya menulis handler socket yang menulis ke cache; ini alternatif paling serius dan akan menghapus sebagian besar ref di file ini. Harganya: satu dependensi + belajar cache key.
  - **Redux + middleware socket** — pola klasik; masuk akal kalau posisi drone perlu dibaca banyak screen sekaligus.
- **Latihan:** Tiga langkah bertingkat:
  1. Jalankan `npx jest __tests__/features/delivery/hooks/useDeliveryTracking.ws.test.ts` dan `useDeliveryTracking.notify.test.ts`, lalu petakan tiap test ke ref yang dilindunginya.
  2. Di `deliveryTrackingMerge.ts:43`, ganti `if (u.droneLat !== undefined)` menjadi `if (u.droneLat)` dan jalankan `__tests__/features/delivery/services/deliveryTrackingMerge.test.ts`. Test mana yang gagal, dan koordinat dunia nyata mana yang rusak?
  3. Hapus pemeriksaan `if (token !== reconcileSeqRef.current) return;` (`useDeliveryTracking.ts:154`) dan tulis skenario (dengan timer palsu) di mana respons lama menimpa data baru.

---

## 18. Kontrak wire-format lintas repo (mobile ↔ backend)

- **Prasyarat:** 6
- **Anchor:**
  - `features/delivery/utils/pickupDateTime.ts:1-17` — komentar bug paling instruktif di repo
  - `pickupDateTime.ts:29-40` — `toWireDate` dan kenapa **bukan** `toISOString().slice(0,10)`
  - `features/delivery/screens/CreateDeliveryScreen/validators.ts:8-15` — `MAX_WEIGHT_KG` yang dicermin manual dari backend
  - `services/deliveryStatus.ts:3-10` — `Record<DeliveryStatus, …>` sebagai pengaman drift
  - `utils/currency.ts:1-11` — kenapa hanya boleh ada satu formatter
  - `features/delivery/screens/PriceEstimationScreen/pricing.ts:36-39` — batu nisan `calcBreakdownLocal`
- **Kenapa dipakai di sini:** Ini "jembatan" antara area mobile dan area backend dalam kurikulum, dan repo ini menuliskan pelajarannya dengan sangat lugas.
  **(a) Format tanggal.** `pickupDateTime.ts:1-17` menceritakan bug produksi: backend memvalidasi `pickupDate`/`pickupTime` dengan dua regex ketat; kalau gagal, `computeScheduledFor()` mengembalikan `null` dan pengiriman **langsung diberangkatkan sekarang** — respons tetap `201`, dan `pickupDate` yang tersimpan *terlihat benar*. App dulu mengirim `"Jul 30, 2026"` dan `"09:30 AM"`, jadi **setiap penjadwalan diam-diam terbang seketika**. Aturan yang lahir dari situ: *"the value we HOLD and SEND is always the wire format. Anything a human reads is produced by the format* helpers at the point of display."*
  Turunannya di `:29-34`: `toWireDate` sengaja tidak memakai `toISOString()` karena itu mengonversi ke UTC dulu — user di UTC+7 (Indonesia!) yang memilih tanggal 30 sebelum jam 07:00 akan mengirim tanggal 29.
  **(b) Enum status.** `services/deliveryStatus.ts:3-10` menjelaskan kenapa `STATUS_META` bertipe `Record<DeliveryStatus, …>`: *"adding a backend status is a COMPILE error until it's handled everywhere — which is exactly the drift that previously left the exception statuses ... rendering as 'Pending' / step 0."* Ini teknik TypeScript yang mengubah drift runtime menjadi error compile.
  **(c) Uang.** `utils/currency.ts:1-11`: dulu ada **empat** formatter, dan dua di antaranya di layar yang sama — bar harga checkout menampilkan `"$37"` sementara kartu promo tepat di atasnya menampilkan total yang **sama** sebagai `"Rp37.000"` (angka USD dilewatkan formatter `id-ID` dengan "Rp" hard-coded).
  **(d) Jangan menghitung ulang di client.** `pricing.ts:36-39`: fungsi harga lokal dihapus karena *"an unavailable quote must read as unavailable, not cheap"* — server (`PricingService`) adalah satu-satunya sumber harga.
  **(e) Batas yang dicermin manual.** `validators.ts:8-9` jujur: *"Kept in sync by hand today — if these ever diverge, the server rejects what this form allowed."*
- **Alternatif:**
  - **Skema bersama (OpenAPI → `openapi-typescript`, atau paket npm `@drovery/contracts`)** — satu sumber tipe, drift mustahil; harganya: langkah build tambahan dan koordinasi versi antar-repo.
  - **Validasi runtime dengan `zod`** — respons diparse, bukan sekadar di-*cast*; menangkap perubahan backend saat runtime alih-alih membuat UI `undefined`. Kandidat kuat untuk `services/api/types.ts` yang sekarang hanya `interface`.
  - **Kirim epoch millis / ISO-8601 penuh alih-alih dua field string** — menghapus seluruh kelas bug ini; butuh perubahan backend, yang bukan pilihan saat itu.
  - **`Intl.NumberFormat` dengan `style: 'currency'`** — format benar per locale otomatis; `utils/currency.ts:37-40` memilih `toLocaleString` + tabel simbol sendiri karena dukungan ICU di Hermes/Android dulu tidak lengkap dan hasilnya bisa berbeda antar-device.
- **Latihan:** Tambahkan status baru `'DIVERTED'` ke `DeliveryStatus` di `services/api/types.ts:29-43`, lalu jalankan `npx tsc --noEmit`. Catat **semua** file yang gagal compile — itulah nilai dari `Record<DeliveryStatus, …>`. Perbaiki satu per satu (`services/deliveryStatus.ts:45`, `features/delivery/hooks/useDeliveryTracking.ts:20`), lalu kembalikan perubahannya.

---

## 19. Testing React Native: `jest-expo`, `__mocks__` native, dan test hook

- **Prasyarat:** 6, 8, 11
- **Anchor:**
  - `jest.config.js:1-19` — preset, `moduleNameMapper`, `transformIgnorePatterns`, `collectCoverageFrom`
  - `__mocks__/expo-secure-store.ts`, `__mocks__/react-native-maps.ts`, `__mocks__/expo-camera.ts`, `__mocks__/expo-notifications.ts`, `__mocks__/expo-router.ts`
  - `__tests__/services/api/trackingSocket.test.ts:7-38` — kelas `FakeWebSocket`
  - `__tests__/contexts/AuthContext.test.tsx:8-21` — mock modul + `renderHook`
  - `__tests__/config/env.test.ts:1-19` — `jest.resetModules()` + `require` ulang
- **Kenapa dipakai di sini:** Tiga hal khas RN yang tidak ada di test web:
  1. **`transformIgnorePatterns` (`jest.config.js:7-9`).** Secara default Jest tidak mem-*transform* `node_modules`, padahal paket RN/Expo dikirim sebagai ES modules + JSX. Daftar panjang di sini adalah daftar-putih paket yang **harus** ditransform. Ini penyebab error `SyntaxError: Cannot use import statement outside a module` yang legendaris.
  2. **Native module tidak ada di Node.** Karena itu ada folder `__mocks__/` manual. `__mocks__/react-native-maps.ts` mengganti `MapView`/`Marker` dengan `View` ber-`testID` (`:4-14`) dan `AnimatedRegion` dengan kelas boneka (`:19-24`). `__mocks__/expo-notifications.ts:1` menyatakan alasannya: *"native module unavailable in tests"*.
  3. **Tidak ada `WebSocket` global di jest/node.** Ini bukan sekadar masalah test — ia dijadikan **jalur kode produksi**: `services/api/trackingSocket.ts:86-92` mendeteksi ketiadaan impl dan memanggil `onUnavailable('no-websocket')`, dan komentarnya (`:88-89`) menjelaskan `queueMicrotask` dipakai *"so the callback lands inside React's act() window"*. Testability memengaruhi desain.
  Cakupan test-nya sengaja condong ke logika, bukan piksel: `collectCoverageFrom` (`jest.config.js:11-18`) mengambil `services/`, `contexts/`, `features/`, `config/` — dan mengecualikan `*.types.ts` serta `index.ts`. Dari 41 file test, mayoritas menguji hook + service, bukan render screen. Ini keputusan yang masuk akal untuk app dengan UI yang banyak berubah.
- **Alternatif:**
  - **`@testing-library/react-native` untuk render screen penuh** — sudah terpasang (`package.json:55`) dan dipakai lewat `renderHook`; render screen penuh memberi keyakinan lebih tinggi tapi lambat dan rapuh terhadap perubahan layout.
  - **Detox / Maestro (E2E di device)** — menangkap bug yang mustahil ditangkap unit test (permission, navigasi native, peta). Harganya: emulator di CI, runtime menit-menitan, flakiness. Untuk app ini, Maestro akan bernilai tinggi pada alur handoff QR.
  - **Storybook React Native** — pengembangan komponen terisolasi; membantu di tim dengan desainer, overhead untuk solo.
  - **`jest-preset-expo` bawaan tanpa `__mocks__` manual** — beberapa modul Expo sudah punya mock bawaan; repo ini menulis manual agar bisa mengontrol nilai kembalian (mis. `useCameraPermissions` selalu `granted`).
- **Latihan:** Tulis test pertamamu untuk sebuah hook: buat `__tests__/features/delivery/hooks/useTrackDelivery.extra.test.ts` yang memverifikasi `track()` mengembalikan `null` **dan** mengisi `error` saat `deliveryApi.track` menolak. Tiru struktur mock dari `__tests__/features/delivery/hooks/useDelivery.test.ts`. Lalu coba hapus baris `moduleNameMapper` di `jest.config.js:4-6` dan jalankan lagi — jelaskan pesan errornya.

---

## 20. Build & rilis: config plugins, EAS profiles, dev client vs Expo Go

- **Prasyarat:** 1, 5, 13
- **Anchor:**
  - `app.json:34-68` — array `plugins` (`expo-router`, `expo-splash-screen`, `expo-location`, `expo-secure-store`, `expo-notifications`, `@stripe/stripe-react-native`)
  - `eas.json:6-23` — tiga profil: `development` (`developmentClient: true`), `preview` (APK), `production` (AAB + `autoIncrement`)
  - `eas.json:4` — `appVersionSource: "remote"`
  - `.github/workflows/android-build.yml:1-92` — CI manual + `concurrency` + parsing `--json`
  - `README.md:158-163` — daftar caveat
  - `features/profile/screens/PaymentMethodsScreen/StripeAddCard.tsx:77-89` — degradasi anggun saat native module tidak tersedia
- **Kenapa dipakai di sini:** Inilah tempat model mental Capacitor-mu paling banyak perlu direvisi.
  **Config plugin** (`app.json:34-68`) adalah pengganti "edit `AndroidManifest.xml` / `build.gradle` sendiri". Plugin `@stripe/stripe-react-native` (`:61-67`) menyuntikkan `merchantIdentifier` dan mengaktifkan Google Pay saat prebuild. Kamu tidak pernah membuka file Gradle.
  **Expo Go vs dev build** adalah pembeda besar yang tidak punya analogi di Capacitor (di sana `npx cap sync` selalu memberi app native sungguhan). README menyatakan konsekuensinya (`:161`): *"Stripe PaymentSheet (native card entry) needs a dev build ..., not Expo Go."* Expo Go adalah app pihak ketiga yang berisi sekumpulan native module tetap; kalau proyekmu memakai modul di luar daftar itu, kamu **harus** membuat dev client (`eas.json:8`, `developmentClient: true`).
  Repo ini menangani batas tersebut secara defensif alih-alih crash: `StripeAddCard.tsx:83` mengembalikan `null` kalau tidak ada publishable key, dan `services/notifications/push.ts:70-73` menangkap "native module missing (simulator/Expo Go)" dan mengembalikan `null`. Pelajaran: **fitur yang bergantung native harus punya jalur mati yang mulus.**
  **Profil EAS** (`eas.json`): `preview` menghasilkan `.apk` untuk dibagikan/sideload; `production` menghasilkan `.aab` untuk Play Store — kamu sudah kenal perbedaan ini dari Play Console. `appVersionSource: "remote"` + `autoIncrement: true` berarti `versionCode` dikelola server EAS, bukan di-commit — menghilangkan konflik merge pada nomor versi.
  **CI-nya sengaja manual** (`android-build.yml:4-5`): *"MANUAL by design — each run consumes an EAS build credit, so you gate releases with 'Run workflow' rather than building on every push"*, dan ada `concurrency` group (`:34-37`) agar dua build tidak berjalan bersamaan. Keystore Android **dibuat dan disimpan EAS** (`:12-13`, `README.md:152`) — tidak ada rahasia signing di repo. Bandingkan dengan alur Capacitor-mu yang biasanya menyimpan keystore + `key.properties` di CI secret.
- **Alternatif:**
  - **`expo prebuild` + build lokal Gradle** — gratis (tanpa kredit EAS), bisa debug native langsung; harganya: kamu mengurus JDK/SDK/keystore, dan folder `android/` yang di-generate cenderung ikut ter-commit lalu *drift* dari `app.json`.
  - **Fastlane + GitHub Actions runner sendiri** — kontrol penuh dan gratis untuk Android; setup jauh lebih panjang dan iOS tetap butuh mesin macOS.
  - **`eas submit` otomatis ke Play track** — sengaja ditunda; rencananya ada di `PLAY-AUTO-SUBMIT-TODO.md` (butuh service account Google Cloud + akses Play Developer API).
  - **Expo Updates (OTA)** — kirim perbaikan JS tanpa rilis store, mirip Capacitor Live Updates/Appflow; tidak dipakai di repo ini, dan patut didiskusikan bersama batasannya (hanya JS, bukan perubahan native).
- **Latihan:** Baca `.github/workflows/android-build.yml:65-84` dan jelaskan baris demi baris apa yang dilakukan `jq -r '.[0].artifacts.applicationArchiveUrl // .artifacts.applicationArchiveUrl // empty'` dan kenapa ada dua path fallback. Lalu jalankan `npx expo prebuild --platform android --no-install` di worktree bersih, buka `android/app/src/main/AndroidManifest.xml` yang dihasilkan, dan temukan kalimat izin lokasi dari `app.json:51`. Setelah itu **hapus** folder `android/` — jelaskan kenapa menghapusnya adalah hal yang benar di alur kerja ini, padahal di proyek Capacitor kamu justru meng-commit-nya.

---

# Catatan tambahan untuk penulis kurikulum

**Urutan mengajar yang disarankan (5 sesi):**
1. Sesi 1 — konsep 1–4 (bentuk app, UI tanpa DOM, routing, struktur). Deliverable: menambah satu screen + satu tab.
2. Sesi 2 — konsep 5–10 (env, HTTP, secure store, auth, gate). Deliverable: memahami alur login → hidrasi → refresh → logout end-to-end.
3. Sesi 3 — konsep 11–15 (hook data, back button Android, native modules, peta, animasi). Deliverable: satu layar yang memakai kamera *atau* peta dengan permission handling lengkap.
4. Sesi 4 — konsep 16–18 (WebSocket, poll fallback, kontrak wire). Ini sesi terberat; sediakan waktu dobel.
5. Sesi 5 — konsep 19–20 (test, build, rilis). Deliverable: satu test hook baru + satu build `preview` APK.

**Sumber "why" terkuat di repo ini** (prioritaskan mengutip ini daripada teori umum):
- `app/_layout.tsx:8-42` — dua bug navigasi/auth yang digabung
- `features/delivery/utils/pickupDateTime.ts:1-17` — bug penjadwalan senyap
- `utils/currency.ts:1-11` — empat formatter di satu layar
- `services/api/wsUrl.ts:1-11` — pengetahuan lintas-repo tentang prefix & port
- `features/delivery/services/handoffCodeStore.ts:3-16` — trade-off keamanan yang ditulis terbuka
- `features/home/screens/HomeScreen/HomeScreen.tsx:73-79` — tab screen tidak pernah unmount
- `features/delivery/screens/PriceEstimationScreen/pricing.ts:36-39` — kenapa jangan menghitung harga di client
- `services/deliveryStatus.ts:3-10` — `Record<>` sebagai pengaman drift

**Kesenjangan/utang teknis yang layak jadi bahan diskusi (bukan untuk ditiru):**
- `app.json:26` masih `YOUR_GOOGLE_MAPS_API_KEY` — gagal senyap di device.
- `features/delivery/screens/CreateDeliveryScreen/CreateDeliveryScreen.tsx:49-51` — `USER_DEFAULT_ADDRESS` hard-coded dengan `TODO`.
- `features/delivery/screens/CreateDeliveryScreen/validators.ts:8-9` — `MAX_WEIGHT_KG` dicermin manual dari backend.
- `config/env.ts:19` — IP LAN pribadi jadi default fallback.
- Hanya satu `FlatList` di seluruh repo (`LocationPickerModal.tsx`); daftar lain memakai `ScrollView` — akan bermasalah kalau riwayat pengiriman tumbuh besar. Ini latihan bagus tentang virtualisasi (`FlatList` vs `ion-virtual-scroll` yang kamu kenal).

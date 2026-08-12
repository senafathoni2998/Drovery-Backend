# Fase 4 — Dari WebView ke native: React Native & Expo

> **Durasi** ~2,5 minggu (~35 jam) · **Mode** bedah + bangun · **Repo** `Drovery_Mobile` (dengan satu sentuhan balik ke `Drovery_Backend` untuk memverifikasi kontrak)

---

## Kenapa fase ini ada di sini

Tiga fase terakhir memindahkanmu jauh dari zona nyaman. Fase 1 dan 2 memaksa menulis `@Module`, provider, guard, dan interceptor di sandbox yang kamu bikin sendiri. Fase 3 memaksa memikirkan `CHECK` constraint, urutan backfill, dan `EXPLAIN ANALYZE` — pekerjaan yang paling jauh dari React yang pernah kamu kerjakan. Fase ini adalah tarik napas yang **direncanakan**, bukan bonus. Sesudah ini datang Fase 5, poros seluruh kurikulum, dan kamu tidak boleh tiba di sana dalam keadaan lelah.

Tapi ini bukan sekadar jeda. Ada alasan struktural kenapa React Native muncul di posisi keempat dan bukan di akhir. Kamu punya refleks yang salah, dan refleks itu berbahaya kalau dibiarkan sampai Fase 12 (di mana kamu harus mengirim fitur nyata end-to-end di tiga repo sekaligus). Refleks itu berbunyi: *"React Native itu React juga, kan? Tinggal ganti `div` jadi `View`."* Setengahnya benar, dan setengah yang salah adalah yang mahal: tidak ada DOM, tidak ada CSS cascade, `flexDirection` default-nya `column` bukan `row`, dan yang paling brutal — Expo Go bisa menjalankan aplikasimu **tanpa error apa pun** sambil diam-diam tidak punya Google Maps dan Stripe. Kegagalan senyap itu tidak bisa dibaca dari tutorial; harus dialami.

Ada satu hal lagi yang mustahil dipahami tanpa fase ini. `Drovery_Mobile` adalah klien pertama backend yang kamu sentuh di Fase 3, dan ia memuat *jawaban sisi klien* atas keputusan-keputusan backend yang belum kamu lihat konsekuensinya. `apiClient.ts:126` membuka amplop `{ success, data, timestamp }` yang dihasilkan `TransformInterceptor` di backend. `wsUrl.ts:3-6` menjelaskan kenapa socket **tidak** ikut prefix `/api/v1` — pengetahuan lintas repo yang kalau salah, WebSocket-mu tidak akan pernah connect dan kamu akan menghabiskan dua malam mengira firewall-mu bermasalah. Melihat sisi klien lebih dulu membuat keputusan backend di Fase 5–8 terasa punya konsekuensi, bukan sekadar pola.

Terakhir: `useDeliveryTracking.ts` ada di fase ini. Itu file tersulit di seluruh `Drovery_Mobile`, dan ia memperkenalkan — dalam bahasa yang sudah kamu kuasai (hooks, ref, closure) — ide yang akan jadi bahasa utama Fase 5: **beberapa aktor bersaing menulis ke satu keadaan, dan kamu butuh token untuk memutuskan siapa yang boleh menang.** Di mobile, wasitnya adalah `reconcileSeqRef`. Di Fase 5, wasitnya adalah PostgreSQL. Bentuk pikirannya sama. Membaca versi mobile-nya dulu, di file yang kamu bisa jalankan dan rusakkan dalam hitungan detik, adalah jembatan termurah menuju CAS.

---

## Gerbang masuk

Kamu siap masuk fase ini kalau bisa:

- [ ] Menjalankan `Drovery_Backend` secara lokal (`docker compose` + `npm run start:dev`) dan membuktikan `GET /api/v1/deliveries` mengembalikan `{ success: true, data: ... }` lewat `curl` — bukan lewat Swagger UI, supaya kamu benar-benar melihat amplopnya.
- [ ] Menjelaskan tanpa membuka kode: apa yang dilakukan `TransformInterceptor` terhadap **setiap** respons sukses, dan apa yang dilakukan `AllExceptionsFilter` terhadap error (materi Fase 2).
- [ ] Menunjukkan di schema Prisma mana kolom yang menyimpan status delivery, dan menyebutkan minimal enam nilai statusnya dari ingatan (materi Fase 3).
- [ ] Memasang Android SDK/emulator ATAU punya HP Android fisik dengan USB debugging aktif, dan sudah membuktikan `adb devices` melihatnya.
- [ ] Punya akun Expo, `eas-cli` terpasang (`npm i -g eas-cli`), dan `eas login` berhasil. Ini prasyarat keras untuk capstone kedua — kalau belum, urus sekarang, bukan di minggu ketiga.
- [ ] Menulis satu komponen React dengan `useEffect` yang punya cleanup, dan menjelaskan kapan cleanup itu jalan. Kalau ini masih goyah, konsep 4.15 akan menghancurkanmu.

---

## Peta jalan mingguan

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| 1 (paruh awal) | Konsep 4.1–4.5: bentuk aplikasi Expo, UI tanpa DOM, expo-router, route wrapper tipis | 7 | App jalan di emulator; satu tab keempat "Notifications" muncul dan bisa dinavigasi |
| 1 (paruh akhir) | Konsep 4.6–4.10: `EXPO_PUBLIC_*`, `apiClient`, refresh single-flight, SecureStore, AuthContext + AuthGate | 7 | Login → cold start tetap login → logout melempar ke `/login`, semuanya kamu bisa jelaskan alurnya baris per baris |
| 2 (paruh awal) | Konsep 4.11–4.14: permission & native module, peta native, animasi, back button Android | 7 | Satu layar yang memakai kamera **atau** peta dengan tiga keadaan permission tertangani |
| 2 (paruh akhir) | Konsep 4.15–4.16: `useDeliveryTracking` dan strategi WS-primary/poll-fallback. **Sesi terberat.** | 7 | Peta `__tests__` → ref yang dilindunginya; satu ref dirusak sengaja dan test-nya gagal seperti dugaanmu |
| 3 (setengah) | Konsep 4.17–4.19: testing RN, Expo Go vs dev build vs EAS, perbandingan platform + capstone | 7 | Dev build terpasang di HP; dokumen "Ionic → React Native" selesai; layar barumu masuk |

Total ~35 jam. Kalau minggu 2 paruh akhir meleset (dan itu wajar — konsep 4.15 memang di luar kurva), ambil jam dari minggu 3 dan geser capstone. Yang **tidak boleh** dipotong adalah dev build: itu satu-satunya bagian fase ini yang tidak bisa disimulasikan.

---

## Konsep

### 4.1 Yang TRANSFER utuh dari Ionic React + Capacitor

Mulai dengan kabar baiknya, karena kabar baik ini besar dan sering diremehkan. React Native bukan framework baru — ia **renderer** baru untuk React yang sudah kamu kuasai. `useState`, `useEffect`, `useCallback`, `useRef`, `useContext`, custom hook, aturan dependency array, aturan closure: semuanya berlaku 100% tanpa asterisk. Kalau kamu bisa membaca `useDeliveries` di aplikasi Ionic-mu, kamu bisa membaca `Drovery_Mobile/features/orders/hooks/useDeliveries.ts` hari ini juga.

TypeScript juga transfer utuh, dengan `strict: true` menyala. Arsitektur feature-sliced yang mungkin sudah kamu pakai di Ionic (folder per domain, bukan folder per jenis file) dipakai di sini persis sama: 13 fitur, masing-masing dengan bentuk `services/*Api.ts` → `hooks/use*.ts` → `screens/*/`. Konsumsi REST juga sama polanya; hanya `apiClient`-nya ditulis manual (konsep 4.7). Dan konsep routing — stack, `push` vs `replace`, tombol back, parameter route — identik secara ide; yang berubah cuma *siapa yang mendeklarasikan* route (konsep 4.4).

Yang penting kamu sadari: karena begitu banyak yang transfer, bagian yang **tidak** transfer akan terasa seperti bug alih-alih seperti perbedaan. Itulah kenapa konsep berikutnya sengaja ditaruh nomor dua.

**Anchor:** `Drovery_Mobile/features/orders/hooks/useDeliveries.ts:5-31` — bentuk kanonik `{ data, loading, error, refetch }` yang diulang di 20+ hook. Perhatikan khusus baris `:26`: dependency array-nya adalah **field-field** `params` (`params.status, params.q, params.sort, params.page, params.limit`), bukan objek `params`. Kalau objeknya yang dipakai, setiap render induk membuat objek baru → identitas `useCallback` berubah → `useEffect` di `:28` jalan lagi → fetch tak berujung.

**Kenapa dipakai di sini:** `Drovery_Mobile/tsconfig.json:4` menyalakan `strict: true`, dan `README.md:136` menyatakan test-nya jalan di atas `jest-expo` — dua keputusan yang membuat pengetahuan React/TS-mu langsung produktif tanpa masa transisi. Repo ini memang dibangun oleh orang yang datang dari React web; struktur folder-nya adalah bukti.

**Alternatif:**
- **Menulis ulang state management dengan Redux Toolkit sejak awal** — kamu dapat devtools dan time-travel debugging, dan struktur yang lebih tegas untuk state lintas screen. Harganya konkret: satu model mental baru (slice, thunk, selector) di fase yang tujuannya justru memanfaatkan yang sudah kamu punya, plus ~14 kB bundle. Repo ini menunda RTK sampai `Drovery_Admin` (Fase 12) di mana state lintas-halaman memang nyata.
- **TanStack Query menggantikan 20+ hook manual** — akan menghapus sekitar 60% baris di `features/**/hooks/`, memberi cache antar-screen, dedup request, dan retry gratis. Harganya: kamu harus belajar model cache-key sebelum bisa membaca kode fetch mana pun di repo, dan hampir tidak ada data di app ini yang dipakai ulang lintas screen — jadi cache-nya membayar untuk masalah yang belum ada.

**Latihan:** Rusak dulu, lalu perbaiki. Di `features/orders/hooks/useDeliveries.ts:26`, ganti dependency array menjadi `[params]`. Tambahkan `console.log('fetch')` di dalam `fetch`, jalankan `npm run android`, buka tab Delivery. Hitung berapa kali "fetch" tercetak dalam 10 detik. Kembalikan ke bentuk semula dan hitung lagi. **Verifikasi:** jumlahnya harus turun dari "terus-menerus" menjadi tepat 1.

---

### 4.2 Yang TIDAK transfer: tidak ada DOM, tidak ada CSS

Di sini analogi berhenti, dan aku tidak akan berpura-pura ada padanan yang halus. **Tidak ada DOM.** Tidak ada `document`, tidak ada `querySelector`, tidak ada `className`, tidak ada stylesheet global, tidak ada cascade, tidak ada spesifisitas selector, tidak ada `:hover`, tidak ada media query, tidak ada `calc()`, tidak ada `position: fixed`, tidak ada `z-index` yang bekerja seperti yang kamu harapkan. Yang ada: pohon `View` / `Text` / `ScrollView` / `Image`, dan objek JavaScript sebagai style.

Perbedaan tunggal yang paling sering membuat orang Ionic bingung di jam pertama: **`flexDirection` default-nya `column`, bukan `row`.** Di CSS, `display: flex` memberimu baris. Di RN, setiap `View` sudah flex container dengan arah kolom. Jadi hal yang di CSS kamu dapat gratis harus ditulis eksplisit di sini — lihat `styles/common.ts:128`, `inputWrapper` menulis `flexDirection: "row"` untuk sesuatu yang di Ionic tidak perlu kamu sebut.

Perbedaan kedua yang mahal: **shadow tidak lintas platform.** Di CSS satu `box-shadow` selesai. Di RN kamu menulis dua set properti: `shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` untuk iOS, dan `elevation` untuk Android. Kalau kamu lupa `elevation`, kartumu terlihat sempurna di simulator iOS dan datar total di HP Android — dan karena kamu Android-heavy, kamu akan menemukannya lebih cepat daripada kebanyakan orang.

Perbedaan ketiga: **safe area bukan `env(safe-area-inset-top)`.** Di Ionic kamu menulisnya di CSS dan browser yang mengurus. Di sini ia hook: `useSafeAreaInsets()` mengembalikan angka, dan kamu yang menjumlahkannya ke padding sendiri. Kalau lupa, konten kamu masuk ke bawah notch dan status bar.

Karena tidak ada cascade, tidak ada juga tempat menaruh "variabel global". Penggantinya adalah token TypeScript polos: `colors`, `spacing`, `borderRadius`, `fontSize` yang diimpor per file.

**Anchor:**
- `Drovery_Mobile/styles/common.ts:4-61` (token `colors`), `:64-72` (`spacing`), `:75-82` (`borderRadius`), `:85-95` (`fontSize`), `:98-241` (`commonStyles = StyleSheet.create({...})`) — inilah pengganti SCSS variable-mu.
- `Drovery_Mobile/styles/common.ts:106-116` — `card` menulis **dua** set properti bayangan sekaligus: `shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` (iOS) dan `elevation: 2` (Android).
- `Drovery_Mobile/styles/common.ts:127-137` — `inputWrapper` dengan `flexDirection: "row"` eksplisit.
- `Drovery_Mobile/features/delivery/screens/QRScannerScreen/QRScannerScreen.tsx:86-102` (JSX) dan `:190-212` (style) — "lubang" viewfinder dibuat murni dari susunan `View` bergelap: `dimTop` (flex 1) di atas, `middleRow` (`flexDirection: "row"`, tinggi tetap) berisi `dimSide` | `viewfinder` | `dimSide`, lalu `dimBottom` (flex 1). Tidak ada `position: absolute` + `box-shadow: 0 0 0 9999px rgba(0,0,0,.6)` seperti yang biasa kamu tulis di Ionic.
- `Drovery_Mobile/features/delivery/screens/TrackOnMapScreen/TrackOnMapScreen.tsx:27` (`useSafeAreaInsets()`) dan `:193` (`paddingTop: insets.top + spacing.sm`).
- `Drovery_Mobile/features/auth/screens/LoginScreen/LoginScreen.tsx:129-131` — `KeyboardAvoidingView` dengan `behavior={Platform.OS === "ios" ? "padding" : "height"}`; keyboard pun butuh penanganan berbeda per platform.

**Kenapa dipakai di sini:** `StyleSheet.create` dipakai (bukan objek literal) supaya style dinormalisasi sekali saat modul dimuat dan sesudahnya hanya dirujuk lewat ID — ini penghematan nyata pada layar yang sering re-render seperti `TrackOnMapScreen`. Token di `styles/common.ts` dipakai konsisten dari `app/_layout.tsx:66` (warna spinner splash) sampai ke screen-screen fitur, sehingga mengganti warna primary berarti mengubah satu baris.

**Alternatif:**
- **NativeWind (Tailwind untuk RN)** — kamu menulis `className="flex-row p-4"` dan mendapat kembali kenyamanan utility-class. Harganya: satu babel plugin tambahan di build chain (yang akan kamu debug sendiri saat upgrade Expo SDK), dan repo jadi punya dua bahasa style karena library pihak ketiga tetap butuh objek `style`. Untuk app dengan ±20 komponen seperti ini, biaya build chain-nya lebih besar dari penghematannya.
- **styled-components/native** — API-nya paling dekat dengan CSS-in-JS yang mungkin sudah kamu kenal dari web. Harganya terukur: satu komponen wrapper per elemen bergaya (overhead runtime dan satu lapisan tambahan di React DevTools), dan style-nya tidak bisa di-*flatten* dan di-cache sebaik `StyleSheet.create`.
- **Tamagui atau Gluestack** — kamu dapat design system jadi, tema light/dark otomatis, komponen aksesibel. Harganya: bundle jauh lebih besar dan lock-in pada konvensi tema mereka. Masuk akal untuk tim dengan desainer; berlebihan untuk app yang hanya butuh kartu, input, dan tombol.

**Latihan:** Tulis ulang overlay di `QRScannerScreen.tsx:86-102` + `:190-212` supaya viewfinder-nya **persegi panjang 280×180** dan tetap di tengah, tanpa menyentuh `<CameraView>` di `:67-72`. **Verifikasi:** jalankan di emulator, lubang terangnya harus 280 lebar × 180 tinggi dan tepat di tengah horizontal. Lalu tulis satu paragraf: berapa baris CSS yang kamu butuhkan untuk efek yang sama di Ionic, dan mana yang lebih mudah dibaca enam bulan lagi?

---

### 4.3 Anatomi proyek Expo vs proyek Capacitor

Di proyek Capacitor-mu ada dua sumber kebenaran native: `capacitor.config.ts` untuk hal yang Capacitor urus, dan folder `android/` berisi Gradle, `AndroidManifest.xml`, dan `res/` yang **kamu commit** dan kamu edit langsung saat butuh permission atau intent filter baru. Kamu tahu betul kalau ada yang aneh, jawabannya ada di sana.

Di Expo, folder `android/` **tidak ada**. Bukan di-gitignore karena malas — ia memang tidak dibangkitkan sampai saat build. Semua konfigurasi native diringkas menjadi satu `app.json`, dan proyek Android/iOS dibangkitkan dari situ saat `eas build` atau `npx expo prebuild` berjalan. Namanya **Continuous Native Generation** (CNG). Konsekuensi mentalnya besar: **`app.json` adalah sumber kebenaran, folder native adalah artefak sementara.** Kalau kamu meng-edit `AndroidManifest.xml` hasil generate, editanmu hilang di build berikutnya — dan itu memang perilaku yang diinginkan.

Titik masuk juga berbeda. Di Ionic ada `main.tsx`/`index.tsx` yang kamu tulis sendiri dan memanggil `createRoot`. Di sini `package.json:3` berbunyi `"main": "expo-router/entry"` — tidak ada `App.tsx` buatanmu. Entry point-nya milik `expo-router`, yang memindai folder `app/` untuk membangun tabel route. Itulah kenapa `app/_layout.tsx` menjadi "akar" aplikasi secara de-facto meskipun tidak ada satu pun `import` yang menunjuk ke sana.

**Anchor:**
- `Drovery_Mobile/package.json:3` — `"main": "expo-router/entry"`. Tidak ada file entry buatan sendiri.
- `Drovery_Mobile/.gitignore:41-43` — komentar `# generated native folders` diikuti `/ios` dan `/android`. Ini bukti tertulis CNG dalam satu baris.
- `Drovery_Mobile/app.json:14-28` — seluruh blok `android`: `package: "com.drovery.mobile"` (`:15`), adaptive icon (`:16-21`), `edgeToEdgeEnabled` (`:22`), `predictiveBackGestureEnabled: false` (`:23`), dan kunci Google Maps (`:24-28`).
- `Drovery_Mobile/app.json:10` — `newArchEnabled: true` (React Native New Architecture: bridge lama diganti JSI/Fabric).
- `Drovery_Mobile/app.json:69-72` — `experiments: { typedRoutes: true, reactCompiler: true }`.
- `Drovery_Mobile/README.md:144-154` — bagian Deployment: rilis lewat GitHub Actions → EAS, dan `eas init` menulis `extra.eas.projectId` ke `app.json` yang **harus di-commit**.

**Kenapa dipakai di sini:** README menyatakan konsekuensi operasionalnya tanpa basa-basi (`README.md:152`): *"EAS generates and stores the Android upload keystore — no signing secrets live in the repo."* Bandingkan dengan alur Capacitor-mu, yang biasanya menyimpan `.jks` + `key.properties` sebagai secret CI. Untuk proyek satu orang (`README.md:9` menyebutnya *"personal project by Sena Fathoni"*), memindahkan keystore ke EAS menghapus satu kelas risiko: keystore hilang = aplikasi tidak bisa diupdate di Play Store selamanya.

**Alternatif:**
- **React Native CLI (bare workflow)** — folder `android/` dan `ios/` di-commit, kamu boleh memasang library native apa pun tanpa menunggu config plugin, dan bisa membuka Android Studio untuk debug native. Harganya sangat konkret: setiap upgrade React Native berarti menyelesaikan konflik merge di `build.gradle`, `settings.gradle`, `MainApplication.kt`, dan `Podfile.lock` secara manual — pekerjaan yang di Expo dilakukan dengan mengubah satu angka versi di `package.json`.
- **Tetap di Capacitor + Ionic** — satu codebase untuk web dan mobile, dan kamu tidak perlu belajar apa pun baru. Harganya: UI berjalan di WebView, jadi scroll momentum, gesture, dan animasi tidak pernah persis native; dan peta live dengan marker yang bergerak tiap 4 detik (fitur inti Drovery) akan terasa tersendat di HP kelas menengah. Ini alternatif yang serius — lihat konsep 4.19 untuk kapan ia justru pilihan yang benar.
- **Expo bare (prebuild lalu commit folder native)** — jalan tengah: kamu pakai SDK Expo tapi meng-commit `android/`. Harganya paling licik: folder native yang di-commit akan **drift** dari `app.json`, dan suatu hari kamu akan menghabiskan satu hari mencari kenapa permission yang kamu tulis di `app.json` tidak muncul di manifest.

**Latihan:** Jalankan `npx expo prebuild --platform android --no-install` di worktree bersih. Buka `android/app/src/main/AndroidManifest.xml` yang dihasilkan dan temukan kalimat izin lokasi dari `app.json:51`. **Verifikasi:** kalimat `"Allow Drovery to access your location to set pickup and delivery points."` (atau padanan permission-nya) harus ada di sana tanpa kamu pernah mengetiknya di file native. Lalu **hapus** folder `android/` dan tulis dua kalimat: kenapa menghapusnya benar di sini, padahal di proyek Capacitor kamu justru meng-commit-nya?

---

### 4.4 `expo-router`: file = route, `_layout.tsx`, dan route group

Di Ionic React kamu mendeklarasikan route sebagai JSX: `<IonRouterOutlet>` berisi `<Route path="/login" component={LoginPage} />`, dan `<IonTabs>` membungkus tab bar. Kamu yang menentukan strukturnya, dan tabel route hidup di satu file yang bisa kamu baca dari atas ke bawah.

`expo-router` membalik ini: **struktur folder ADALAH tabel route.** `app/login.tsx` → `/login`. `app/track-on-map.tsx` → `/track-on-map`. Tidak ada file yang mendaftarkan route; file-nya sendiri yang mendaftarkan diri. Kamu kehilangan "satu tempat untuk membaca semua route", dan sebagai gantinya kamu dapat: mustahil lupa mendaftarkan screen baru, dan deep link gratis dari `scheme` di `app.json:8`.

Dua konvensi harus kamu hafal:

**`_layout.tsx`** adalah pembungkus untuk semua route di folder yang sama — persis peran `IonRouterOutlet`/`IonTabs`, hanya posisinya ditentukan oleh **lokasi file**, bukan oleh JSX yang kamu susun. `app/_layout.tsx` membungkus seluruh aplikasi; `app/(tabs)/_layout.tsx` membungkus tiga screen tab.

**Kurung `(tabs)`** adalah **route group**: nama grup **tidak muncul di URL**. `app/(tabs)/orders.tsx` melayani `/orders`, bukan `/(tabs)/orders`. Grup itu hanya berarti "screen-screen ini berbagi layout tab bar". Ini yang membuat `router.replace("/(tabs)")` di `app/_layout.tsx:59` mengarah ke tab pertama.

Navigasi imperatif memakai `useRouter()` dan API-nya akan terasa akrab: `push`, `replace`, `back`. Parameter dibaca dengan `useLocalSearchParams<{ id?: string }>()` — dan perhatikan, **tipenya kamu deklarasikan sendiri**; tidak ada yang memverifikasi bahwa `id` benar-benar dikirim.

**Anchor:**
- `Drovery_Mobile/app/_layout.tsx:88-94` — `<Stack screenOptions={{ headerTransparent, headerBackVisible, headerShown: false }} />`. Satu stack untuk seluruh app, header disembunyikan karena tiap screen menggambar header-nya sendiri.
- `Drovery_Mobile/app/(tabs)/_layout.tsx:4-59` — `<Tabs>` dengan tiga `<Tabs.Screen name="index" | "orders" | "profile">` di `:30-56`. Bandingkan langsung dengan `IonTabs` + `IonTabBar` + `IonTabButton` yang kamu kenal.
- `Drovery_Mobile/app/index.tsx:12-24` — route `/` yang isinya **hanya** spinner. Alasannya ada di doc-comment `:4-11` dan dibahas tuntas di konsep 4.10.
- `Drovery_Mobile/app.json:70` — `experiments.typedRoutes: true`, membuat string route diperiksa TypeScript.
- Contoh navigasi nyata: `Drovery_Mobile/features/auth/screens/LoginScreen/LoginScreen.tsx:119` (`router.replace("/(tabs)")` sesudah login sukses) dan `:125` (`router.push("/signup")`); `Drovery_Mobile/features/delivery/screens/QRScannerScreen/QRScannerScreen.tsx:22` (`router.back()`).
- `Drovery_Mobile/features/delivery/screens/TrackOnMapScreen/TrackOnMapScreen.tsx:29` — `useLocalSearchParams<{ id?: string }>()`.

**Kenapa dipakai di sini:** `typedRoutes: true` bukan kosmetik. Dengan 30 file route dan navigasi tersebar di puluhan screen, salah ketik `/loign` akan gagal compile alih-alih menghasilkan layar kosong saat runtime. Ini kelas keamanan yang sama dengan `Record<DeliveryStatus, …>` di backend: mengubah kesalahan runtime menjadi error compile.

**Alternatif:**
- **React Navigation langsung, tanpa expo-router** — kamu mendaftarkan `Stack.Screen` secara eksplisit dalam kode, sehingga tabel route bisa dibaca dalam satu file dan route yang dibangun dinamis (misalnya dari respons server) jadi mudah. Harganya: lebih verbose, dan kamu menulis `linking.config` sendiri untuk deep link. Catatan penting: expo-router **dibangun di atas** React Navigation — buktinya `package.json:18` masih memuat `@react-navigation/bottom-tabs`. Jadi ini bukan dua dunia, tapi dua tingkat abstraksi.
- **Ionic React Router** — kamu sudah menguasainya. Konsep stack, `push` vs `replace`, dan tombol back transfer 1:1. Harganya di konteks ini: transisi screen dijalankan oleh CSS di WebView, jadi kamu tidak pernah dapat transisi native (dan `react-native-screens` yang membuat screen tidak aktif benar-benar dilepas dari memori tidak punya padanan).

**Latihan:** Tambahkan tab keempat "Notifications": (a) buat `app/(tabs)/notifications.tsx` yang mere-export `NotificationScreen` dari `@/features/notifications/screens`, (b) tambahkan `<Tabs.Screen name="notifications" .../>` di `app/(tabs)/_layout.tsx`. Perhatikan bahwa route `/notifications` **sudah ada** di `app/notifications.tsx:1`. **Verifikasi:** jalankan app, tekan tab baru, lalu tulis jawaban: URL mana yang menang, dan kenapa route group mempengaruhi konflik itu?

---

### 4.5 Route wrapper tipis: `app/*.tsx` hanya re-export

Buka `app/login.tsx`. Isinya satu baris. Buka `app/(tabs)/index.tsx`. Juga satu baris. Ini bukan kebetulan — ini aturan arsitektur yang ditulis eksplisit di README.

Alasannya langsung mengikuti konsep 4.4. Karena `expo-router` **memaksa** struktur folder `app/`, tanpa aturan ini seluruh logika bisnis akan tumpah ke folder route, dan struktur kodemu ditentukan oleh URL. Dengan wrapper tipis, `app/` hanya menjadi tabel route (dan itu memang tugasnya), sementara `features/` bebas disusun per domain.

Ini adalah hal yang di Ionic kamu dapatkan gratis — di sana tidak ada folder yang dipaksakan router, jadi kamu bebas menaruh screen di mana saja. Di sini kebebasan itu harus dibeli dengan satu baris per route. Menurutku harganya murah.

Ada dua bentuk wrapper di repo ini, dan keduanya sah: re-export satu baris (`app/login.tsx:1`) dan wrapper eksplisit (`app/track-on-map.tsx:1-5`). Bentuk kedua berguna kalau nanti route butuh membungkus screen dengan provider atau error boundary.

**Anchor:**
- `Drovery_Mobile/app/login.tsx:1` — `export { LoginScreen as default } from '@/features/auth/screens';`
- `Drovery_Mobile/app/track-on-map.tsx:1-5` — varian wrapper eksplisit dengan komponen `TrackOnMapRoute`.
- `Drovery_Mobile/README.md:111` — *"app/ Expo Router routes — thin wrappers re-exporting feature screens"*. Penulisnya menuliskan aturannya sebagai dokumentasi struktur.
- `Drovery_Mobile/features/delivery/` — bentuk kanonik satu fitur: `screens/`, `components/`, `hooks/`, `services/`, `utils/`, `workflow/`. Contoh rantai lengkap: `features/delivery/services/deliveryApi.ts` → `features/delivery/hooks/useDelivery.ts` → `features/delivery/screens/DeliveryDetailScreen/`.
- `Drovery_Mobile/tsconfig.json:5-9` — alias `@/*` → `./*`, dipetakan ulang untuk Jest di `Drovery_Mobile/jest.config.js:4-6`. Dua tempat, harus sinkron.

**Kenapa dipakai di sini:** Ada 13 fitur di `features/` (auth, delivery, orders, home, notifications, profile, wallet, addresses, favorites, recurring, referrals, promo, support) dan 30 file route di `app/`. Tanpa aturan wrapper tipis, mengganti nama sebuah route berarti memindahkan logika bisnis — dan seluruh test yang menguji hook fitur akan ikut tergantung pada router.

**Alternatif:**
- **Layered: folder `components/`, `screens/`, `services/` global** — paling mudah dimulai dan familiar bagi siapa pun. Harganya terukur pada skala ini: `services/` akan berisi 25+ file tanpa batas domain, dan kamu tidak bisa tahu file mana yang aman dihapus saat sebuah fitur dimatikan.
- **Menulis logika langsung di file route `app/**`** — file paling sedikit, satu tempat untuk melihat "apa yang terjadi di URL ini". Harganya: test screen jadi memerlukan mock router, dan memindahkan route berarti memindahkan logika.
- **Monorepo package per fitur (Nx/Turborepo)** — batas antar-fitur bisa **dipaksakan oleh lint**, bukan sekadar disepakati. Harganya: satu build system tambahan, waktu instalasi lebih lama, dan konfigurasi Metro bundler yang lebih rumit. Untuk satu aplikasi, biayanya melebihi manfaatnya.

**Latihan:** Tambahkan `app/order-detail.tsx` yang mere-export screen yang sudah ada, lalu ubah salah satu `router.push` di `features/orders/screens/OrdersScreen/` agar memakainya. **Verifikasi:** hitung berapa file yang kamu sentuh (harusnya 2). Lalu tulis satu paragraf: berapa file yang harus disentuh kalau `OrdersScreen` ditulis langsung di dalam `app/`?

---

### 4.6 `EXPO_PUBLIC_*` di-inline saat bundling — bukan dibaca runtime

Ini konsep yang kelihatan sepele dan menghabiskan waktu paling banyak saat pertama kali menyambungkan app ke backend lokal.

Di Ionic, `process.env` diselesaikan Vite atau Webpack saat build, tapi kamu selalu punya jalan keluar: taruh config runtime di `index.html`, atau fetch config dari server saat startup. WebView bisa membaca apa saja.

Di React Native, nilai `EXPO_PUBLIC_*` **dijahit ke dalam bundle JavaScript saat bundling**. Bukan dibaca dari file `.env` saat aplikasi jalan — file `.env` bahkan tidak ikut ke dalam APK. Dua konsekuensi langsung:

1. **Mengubah `.env` tanpa me-restart dev server tidak berefek apa pun.** Kamu akan mengedit, save, reload, dan melihat nilai lama. README menuliskannya sebagai caveat terakhir (`README.md:163`).
2. **Tidak ada rahasia yang aman di sini.** Nama prefiksnya jujur: `PUBLIC`. Siapa pun yang mengunduh APK-mu bisa membongkar bundle dan membaca nilainya. Itulah kenapa `STRIPE_PUBLISHABLE_KEY` boleh ada di sini (publishable memang untuk publik) dan kenapa kunci rahasia apa pun **tidak boleh**.

Ada nuansa yang khusus penting untukmu sebagai orang Android: alamat backend lokal berbeda per target. `10.0.2.2` adalah alias loopback host dari dalam Android emulator; `localhost` untuk iOS simulator; IP LAN untuk HP fisik. Salah pilih dan kamu akan melihat "Network error. Please check your connection." tanpa petunjuk lain.

**Anchor:**
- `Drovery_Mobile/config/env.ts:4-7` — komentar header yang menyatakan aturannya: *"Expo only inlines env vars that are prefixed with `EXPO_PUBLIC_` into the JS bundle. Plain `.env` vars (e.g. `API_URL`) are NOT visible to React Native at runtime."*
- `Drovery_Mobile/config/env.ts:12-15` — tiga host per target (device fisik / Android emulator / iOS simulator), ditulis sebagai komentar tepat di atas defaultnya.
- `Drovery_Mobile/config/env.ts:19-21` — `LAN_IP = '192.168.1.7'` dan `DEFAULT_API_URL`. Perhatikan: ini IP LAN pribadi yang jadi fallback default. Ini **utang teknis** yang layak kamu diskusikan, bukan pola yang ditiru.
- `Drovery_Mobile/config/env.ts:23-38` — `ENV` diekspor sebagai satu objek `as const`, satu-satunya tempat config dibaca.
- `Drovery_Mobile/.env.example:1-16` — dokumentasi ketiga host, plus catatan bahwa Stripe key butuh dev build.
- `Drovery_Mobile/__tests__/config/env.test.ts:1-5` — komentar *"ENV is evaluated at import time, so we reset modules and re-require"*, dan `:10-15` yang memanggil `jest.resetModules()` di `beforeEach`.
- `Drovery_Mobile/services/notifications/push.ts:51-53` — contoh nilai yang **tidak** lewat `.env`: `Constants?.expoConfig?.extra?.eas?.projectId`, karena nilai itu hanya ada saat build EAS.

**Kenapa dipakai di sini:** Karena `ENV` adalah satu objek yang dibaca di satu tempat, ia bisa di-mock utuh dalam test — lihat `__tests__/services/api/apiClient.test.ts:6-11` yang mengganti seluruh modul `@/config/env` dengan `{ API_URL: 'http://test-api.com/api/v1', API_TIMEOUT: '5000' }`. Kalau `process.env.EXPO_PUBLIC_API_URL` dibaca langsung di 10 file, test itu mustahil ditulis serapi ini.

**Alternatif:**
- **`expo-constants` + `extra` di `app.json`** — nilai bisa berbeda per build profile EAS tanpa file `.env` sama sekali, jadi CI tidak perlu menulis `.env`. Harganya: nilainya statis per build dan kamu kehilangan kenyamanan mengganti satu baris di `.env` lokal lalu restart. Repo ini memakai keduanya: `.env` untuk yang berubah saat development, `expo-constants` untuk yang hanya ada di build (`push.ts:51-53`).
- **`react-native-config`** — nilainya juga terbaca dari sisi native (Java/Objective-C), yang berguna kalau config perlu dipakai native module. Harganya konkret di sini: **tidak jalan di Expo Go**, karena ia butuh perubahan native — jadi kamu wajib dev build sebelum bisa menjalankan apa pun.
- **Remote config (fetch config saat startup)** — bisa mengganti URL backend tanpa rilis ulang ke Play Store, yang berharga saat migrasi domain. Harganya: satu request blocking sebelum app siap (dan penanganan kalau request itu gagal), plus URL fetch-nya sendiri tetap harus di-hardcode — jadi masalahnya bergeser, tidak hilang.

**Latihan:** Jalankan `npx jest __tests__/config/env.test.ts` dan pastikan hijau. Lalu tambahkan var baru `EXPO_PUBLIC_MAP_DEFAULT_ZOOM` di `config/env.ts` dengan default, dan tulis test-nya meniru pola `loadEnv()` di `__tests__/config/env.test.ts:17-19`. **Verifikasi:** hapus `jest.resetModules()` dari `beforeEach` dan jalankan lagi — test-mu harus gagal. Jelaskan kenapa dalam satu kalimat.

---

### 4.7 `apiClient` tulis tangan di atas `fetch`

Ini file pertama di `Drovery_Mobile` yang menyentuh langsung apa yang kamu bangun di Fase 3. Bacalah dengan mata backend, bukan mata frontend.

Ada empat hal yang dilakukan `request<T>()` yang tidak dilakukan `fetch` polos:

**(a) Membuka amplop.** Backend membungkus setiap respons sukses menjadi `{ success, data, timestamp }` lewat `TransformInterceptor`. Kalau klien tidak membukanya, setiap call site harus menulis `.data` sendiri — 100+ tempat yang bisa lupa. Jadi klien membukanya sekali di satu baris, dan seluruh aplikasi melihat DTO bersih.

**(b) Normalisasi error.** `ApiError` mengambil `message` dari body error NestJS kalau ada, dan jatuh ke `Request failed with status N` kalau tidak. Karena itu `AuthContext` cukup menampilkan `error.message` tanpa peduli bentuk error-nya.

**(c) Timeout.** `fetch` standar **tidak punya** timeout. Kalau server hang, request-mu menggantung selamanya dan spinner-mu berputar selamanya. Jadi timeout diimplementasikan manual dengan `AbortController` + `setTimeout`, lalu `AbortError` diterjemahkan menjadi `ApiError(0, 'Request timed out')` — supaya UI hanya perlu menangani satu jenis error.

**(d) 204 No Content.** Respons tanpa body akan membuat `res.json()` melempar. Jadi ada jalur keluar khusus.

Satu hal yang penting kamu ketahui tentang `fetch` di React Native: ia **bukan** `fetch` browser. Ia polyfill di atas networking native. Artinya: tidak ada CORS (lega), tidak ada cookie jar otomatis (jadi refresh token harus dikelola manual — konsep 4.8), dan cleartext HTTP ke IP LAN butuh izin eksplisit di build produksi Android.

**Anchor:**
- `Drovery_Mobile/services/api/apiClient.ts:59-135` — seluruh fungsi `request<T>()`. Baca sekali penuh sebelum membedah.
- `:80-81` — `const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);`
- `:117` — `if (res.status === 204) return undefined as T;`
- `:125-126` — komentar *"Unwrap TransformInterceptor wrapper: { success, data, timestamp }"* diikuti `return (json.data !== undefined ? json.data : json) as T;`
- `:16-27` — kelas `ApiError`, khususnya `:21-23` yang menentukan pesan.
- `:130-133` — `AbortError` → `ApiError(0, 'Request timed out')`, sisanya → `ApiError(0, 'Network error...')`.
- `Drovery_Mobile/features/delivery/services/deliveryApi.ts:16-31` — bagaimana sebuah fitur memakainya: fungsi-fungsi tipis yang hanya memetakan nama ke path.
- Sisi backend-nya: `Drovery_Backend/src/common/interceptors/transform.interceptor.ts:26` — `success: true` yang dibungkus di sana adalah amplop yang dibuka di `apiClient.ts:126`.

**Kenapa dipakai di sini:** Baris `apiClient.ts:126` adalah titik sambung paling harfiah antara dua repo dalam kurikulum ini. Kalau kamu mengubah `TransformInterceptor` di Fase 5–8 tanpa mengingat baris ini, setiap layar mobile akan menampilkan `undefined`. Ini contoh nyata dari kelas masalah yang akan mengejarmu sampai Fase 12: **kontrak lintas repo tanpa tipe bersama.**

**Alternatif:**
- **axios** — interceptor bawaan, `transformResponse`, cancel token, dan yang paling penting: **progress upload**. `ProofCaptureScreen` mengirim foto base64; kalau nanti kamu ingin progress bar upload, `fetch` tidak bisa memberikannya sama sekali dan kamu harus turun ke `XMLHttpRequest` — di titik itu axios menang telak. Untuk kebutuhan sekarang (satu interceptor 401, satu unwrap), `fetch` menghemat ±13 kB bundle.
- **TanStack Query di atas `fetch`** — caching, dedup request identik, retry dengan backoff, `staleTime`, dan refetch-on-focus (yang sangat relevan untuk app mobile yang sering di-background). Harganya: model mental cache key harus dikuasai dulu, dan invalidasi cache setelah mutasi adalah sumber bug baru yang belum ada di kode ini.
- **openapi-typescript atau tRPC** — tipe DTO **dibangkitkan** dari backend, sehingga `services/api/types.ts` tidak perlu ditulis tangan dan tidak bisa drift. Ini alternatif paling menarik secara teknis. Harganya: backend harus mengekspor skema (satu langkah build tambahan di `Drovery_Backend`), dan versi kontrak antar-repo harus dikoordinasikan — kalau mobile lama masih beredar di HP orang, tipe yang "benar" belum tentu tipe yang dipakai.

**Latihan:** Tambahkan opsi `RequestOptions.retries?: number` sehingga `GET` yang gagal karena network error (bukan `ApiError` 4xx) dicoba ulang sekali. Tulis test-nya di `__tests__/services/api/apiClient.test.ts` memakai helper `mockResponse()` yang sudah ada di `:19-29`. **Verifikasi:** test harus membuktikan (a) `fetch` dipanggil dua kali untuk network error, dan (b) `fetch` dipanggil **satu** kali untuk respons 404 — retry tidak boleh menutupi error domain. Pastikan juga retry tidak memicu jalur refresh 401.

---

### 4.8 Refresh token di klien: single-flight, `setOnLogout`, dan `noAuthRetry`

Ini konsep terpenting di paruh pertama fase, dan ia punya tiga ide yang masing-masing punya jejak komentar di kode. Baca ketiganya pelan-pelan.

**(a) Menghindari refresh berbarengan.** Bayangkan layar Home memicu lima request paralel saat cold start, dan access token sudah kedaluwarsa. Kelima-limanya kena 401. Kalau tiap request menembak `/auth/refresh` sendiri, kamu punya lima refresh berbarengan — dan karena refresh token biasanya *rotating* (satu token sekali pakai, materi Fase 2), request kedua sampai kelima akan **gagal** dan melogout user yang sebenarnya sesinya valid. Solusinya: satu `refreshPromise` di module scope yang di-*share*; request pertama membuatnya, sisanya menunggu promise yang sama. Pola ini namanya **single-flight**, dan kamu akan bertemu lagi versinya di `Drovery_Admin` (Fase 12).

**(b) 401 tidak selalu berarti "sesi habis".** Ini bagian paling instruktif di seluruh file. Endpoint `POST /deliveries/:id/confirm-handoff` mengembalikan 401 ketika kode handoff 6 digit yang dimasukkan **salah**. Itu hasil domain yang sah, bukan sesi kedaluwarsa. Tanpa penanda khusus, salah ketik satu digit akan memicu refresh, refresh gagal (karena tokennya baik-baik saja tapi endpoint tetap 401), lalu `onLogout()` — dan user **terlempar keluar dari aplikasi** karena salah ketik. Flag `noAuthRetry: true` adalah jawabannya.

**(c) Wiring melingkar tanpa import melingkar.** `apiClient` perlu memanggil `logout()`, tapi `AuthContext` meng-import `apiClient`. Kalau `apiClient` meng-import `AuthContext`, kamu punya circular import. Solusinya callback registry: `apiClient` mengekspor `setOnLogout(cb)`, dan `AuthContext` mendaftarkan dirinya lewat efek. Ini adalah **dependency injection paling sederhana yang mungkin** — dan sengaja aku tunjukkan di sini karena kamu sudah bertemu DI versi decorator di NestJS pada Fase 1. Ide dasarnya sama: yang butuh tidak meng-import yang dibutuhkan; ada pihak ketiga yang menyambungkan.

**Anchor:**
- `Drovery_Mobile/services/api/apiClient.ts:29-35` — module state `isRefreshing` / `refreshPromise` / `onLogout` plus `setOnLogout()`.
- `:37-57` — `refreshAccessToken()`: baca refresh token, POST ke `/auth/refresh`, simpan token baru, kembalikan boolean. Perhatikan `:51` yang juga membuka amplop (`json.data ?? json`) karena ia memakai `fetch` langsung, bukan `request()`.
- `:95-114` — seluruh jalur 401. Baris `:96-101` adalah single-flight guard-nya; `:107` retry dengan token baru; `:111-113` jalur menyerah: bersihkan token, panggil `onLogout?.()`, lempar `ApiError`.
- `:6-14` — `interface RequestOptions` dengan komentar `:10-12`: *"For endpoints where a 401 is a legitimate domain outcome, e.g. a wrong handoff code on /confirm-handoff."*
- `Drovery_Mobile/features/delivery/services/deliveryApi.ts:22-31` — pemakaian nyata, dengan komentar `:23-24`: *"a 401 here means 'wrong code', NOT an expired session, so it must throw (not refresh+logout the user out of the app)."*
- `Drovery_Mobile/contexts/AuthContext.tsx:42-47` — sisi pendaftarannya: `useEffect(() => { setOnLogout(() => { logout(); }); }, [logout]);`

**Kenapa dipakai di sini:** Ini bukan pola teoretis — ia jawaban atas dua kegagalan yang bisa dibayangkan langsung. Yang (a) mencegah user ter-logout karena kebetulan membuka layar yang memicu banyak request. Yang (b) mencegah user ter-logout karena salah ketik. Keduanya adalah kegagalan yang tidak akan pernah muncul di log error — user cuma akan merasa "aplikasinya suka keluar sendiri".

**Alternatif:**
- **Interceptor axios** — bentuk kanonik untuk masalah yang sama, dan solusi single-flight-nya identik (antre request yang gagal, retry setelah refresh selesai). Harganya sekadar dependensi; keuntungannya: pola ini sudah didokumentasikan di ribuan tempat, jadi orang berikutnya yang membaca kodemu langsung mengenalinya.
- **Refresh proaktif berdasarkan `exp` di JWT** — dekode payload token dan refresh 60 detik sebelum kedaluwarsa, sehingga 401 nyaris tidak pernah terjadi. Harganya: kamu menambah parsing JWT di klien (dan harus menahan diri untuk **tidak** mempercayai klaim di dalamnya), dan kamu **tetap** butuh jalur reaktif — karena token bisa dicabut server kapan saja, jauh sebelum `exp`.
- **Cookie `HttpOnly` + refresh dikelola server** — standar emas di web: token tidak pernah tersentuh JavaScript. Tidak praktis di sini karena dua alasan konkret: RN tidak punya cookie jar browser, dan token yang sama dipakai untuk handshake WebSocket lewat query param (`trackingSocket.ts:221`) — yang mustahil kalau tokennya HttpOnly.

**Latihan:** Tulis test di `__tests__/services/api/apiClient.test.ts` yang memicu **dua** request paralel yang keduanya menerima 401, lalu buktikan `fetch` ke `/auth/refresh` terjadi **tepat sekali**. **Verifikasi:** setelah test hijau, hapus sementara guard `if (!isRefreshing)` di `apiClient.ts:96` dan jalankan lagi — test-mu harus gagal dengan "expected 1, received 2". Itu penjelasan terbaik kenapa guard-nya ada.

---

### 4.9 `expo-secure-store` vs Capacitor Preferences — perbedaan jaminannya

Padanan API-nya jelas: `SecureStore.setItemAsync` ≈ `Preferences.set`. Tapi kalau kamu berhenti di situ, kamu melewatkan perbedaan yang penting.

`@capacitor/preferences` menulis ke `SharedPreferences` di Android — **plaintext**, di dalam sandbox aplikasi. Aman dari aplikasi lain di device yang tidak di-root, tapi bisa dibaca langsung kalau device di-root atau backup-nya diekstrak. Untuk preferensi UI ("dark mode: on"), ini sempurna. Untuk JWT, tidak.

`expo-secure-store` menulis ke **Android Keystore / iOS Keychain**: terenkripsi at-rest dengan kunci yang dikelola OS dan (di device modern) disimpan di hardware-backed keystore. Perbedaannya bukan API, tapi **jaminan**. Di Ionic kamu mendapat jaminan setara dengan memasang plugin terpisah (`capacitor-secure-storage-plugin`); di Expo ia bagian dari SDK resmi dan hanya perlu didaftarkan sebagai config plugin di `app.json`.

Yang paling layak dibedah di repo ini bukan `tokenStorage.ts` (yang lurus-lurus saja), melainkan `handoffCodeStore.ts`. File itu memuat satu keputusan desain nyata beserta **trade-off keamanannya yang ditulis terbuka**, dan itu langka. Ceritanya: backend mengembalikan kode handoff 6 digit dari `POST /deliveries` **tepat sekali** dan tidak pernah lagi. Tapi pelanggan (yang sering juga penerimanya) butuh membaca ulang kode itu saat drone tiba. Jadi app menyimpannya sendiri.

Penulisnya tidak menyembunyikan bahwa ini kompromi. Ia menuliskannya: OTP plaintext hidup di keychain terenkripsi selama pengiriman berlangsung, tidak pernah di-log, tidak sync ke cloud, dan tetap tidak berguna tanpa JWT pemilik karena backend membatasi 5 percobaan dan mengikat endpoint ke pemilik. Lalu kodenya dihapus otomatis begitu delivery selesai.

**Anchor:**
- `Drovery_Mobile/services/api/tokenStorage.ts:1-34` — `saveTokens` / `getTokens` / `getAccessToken` / `getRefreshToken` / `clearTokens`. Perhatikan `Promise.all` di `:7-10` dan `:30-33`.
- `Drovery_Mobile/features/delivery/services/handoffCodeStore.ts:3-16` — doc-comment lengkap dengan bagian *"Security trade-off (accepted)"*. Ini contoh terbaik di repo tentang "dokumentasikan kompromi, jangan sembunyikan".
- `Drovery_Mobile/app.json:54` — `"expo-secure-store"` terdaftar di array `plugins`. Tanpa ini, modul native-nya tidak ikut ke build.
- `Drovery_Mobile/features/delivery/hooks/useDeliveryTracking.ts:99` — `void clearHandoffCode(deliveryId);` di jalur terminal. Kodenya punya masa hidup yang eksplisit.
- `Drovery_Mobile/__mocks__/expo-secure-store.ts:1-3` — tiga `jest.fn()`, karena modul native tidak ada di Node.

**Kenapa dipakai di sini:** Perhatikan pasangan `handoffCodeStore.ts:27-29` (`clearHandoffCode`) dan `useDeliveryTracking.ts:99`. Menyimpan rahasia itu mudah; **membuangnya pada waktu yang tepat** yang sulit. Repo ini memasangkan penyimpanan dengan penghapusan di jalur yang sama, sehingga tidak ada kode yatim di keychain user setelah paketnya sampai.

**Alternatif:**
- **`@react-native-async-storage/async-storage`** — cepat, tanpa batas ukuran praktis, dan tidak butuh config plugin. Harganya spesifik: **tidak terenkripsi**, jadi refresh token-mu terbaca dari backup ADB di device yang mengizinkannya. Ini pilihan yang benar untuk preferensi UI dan cache daftar, dan pilihan yang salah untuk token.
- **`react-native-mmkv`** — jauh lebih cepat karena sinkron dan tanpa bridge (bisa dibaca langsung saat render tanpa `await`), dan bisa dienkripsi dengan kunci yang kamu tentukan. Harganya: **kamu** yang mengelola kunci enkripsinya (dan menyimpan kunci itu di mana? kembali ke Keystore), dan ia butuh dev build.
- **Menyimpan token di memori saja** — paling aman secara teori: tidak ada yang persisten untuk dicuri. Harganya sangat terasa: user login ulang setiap cold start. Seluruh efek hidrasi di `contexts/AuthContext.tsx:50-66` ada justru untuk menghindari ini.

**Latihan:** `SecureStore` punya batas ukuran nilai (sekitar 2 KB di Android sebelum berperilaku aneh). Tambahkan pembungkus `safeSetItem` di `services/api/tokenStorage.ts` yang menolak nilai lebih dari 2000 karakter dengan error yang jelas. **Verifikasi:** tulis test memakai `__mocks__/expo-secure-store.ts` yang sudah ada — satu kasus nilai normal (mock `setItemAsync` terpanggil), satu kasus nilai 3000 karakter (melempar, dan `setItemAsync` **tidak** terpanggil).

---

### 4.10 `AuthContext` + `AuthGate`: "kalau auth state dan route tidak sepakat, route yang pindah"

Kalau kamu hanya punya waktu membaca satu file di `Drovery_Mobile` untuk memahami cara berpikir repo ini, baca `app/_layout.tsx`. Komentarnya lebih panjang dari kodenya, dan itu disengaja: ia mendokumentasikan **dua bug nyata** yang ternyata adalah pertanyaan yang sama.

Mulai dari state-nya dulu. `AuthContext` adalah React Context biasa — tidak ada Redux, tidak ada Zustand. Untuk state yang benar-benar global dan **sedikit** (`user`, `isAuthenticated`, `isLoading`), Context + `useState` sudah cukup dan nol dependensi.

Yang layak dibedah adalah `isLoading: true` sebagai nilai awal. Ini bukan spinner kosmetik. Aplikasi harus bisa membedakan **tiga** keadaan, bukan dua: "belum tahu apakah user login", "tahu bahwa user login", dan "tahu bahwa user tidak login". Efek hidrasi membaca token dari SecureStore, lalu memanggil `GET /users/me` untuk memverifikasi token itu masih sah di server; kalau gagal, token dibuang. Baru setelah itu `isLoading` menjadi `false`.

Sekarang gate-nya. Dua bug yang digabung:

1. `app/index.tsx` dulu berisi `export { default } from './login'`. Artinya route awal **selalu** form login, dan sesi valid dibuang setiap cold start.
2. Saat refresh token kedaluwarsa, `AuthContext` membersihkan state — tapi tidak ada yang menavigasi. User tertinggal di screen ter-autentikasi, **dengan polling tracking 4 detik masih jalan**, sampai app dibunuh.

Kesimpulan penulisnya, yang layak kamu hafal: *"when auth state and the current route disagree, the route moves."*

Ada dua detail yang sangat mudah salah dan keduanya diberi komentar:

- **`""` (route index) sengaja TIDAK dimasukkan ke `PUBLIC_SEGMENTS`.** Kalau dimasukkan, cold start dalam keadaan logout mendarat di `""`, gate melihat "publik, tidak ada yang perlu dilakukan", dan user menatap spinner **selamanya** dengan `/login` tak terjangkau.
- **`if (isLoading) return;` di awal efek.** Mengambil keputusan sebelum hidrasi selesai akan melempar user yang sudah login ke `/login` untuk satu frame — persis hal yang gate ini ada untuk mencegahnya.

**Anchor:**
- `Drovery_Mobile/contexts/AuthContext.tsx:22-26` — state awal dengan `isLoading: true`.
- `:50-66` — efek hidrasi: baca token, verifikasi lewat `GET /users/me`, buang token kalau gagal.
- `:28-40` — `logout` yang *best-effort* ke server (`/auth/logout` untuk mencabut refresh token) tapi **selalu** membersihkan lokal. Komentar `:36`: *"ignore — logout must succeed locally regardless"*.
- `:113-119` — `useAuth()` melempar error kalau dipakai di luar provider. Diuji di `__tests__/contexts/AuthContext.test.tsx:45-56`.
- `Drovery_Mobile/app/_layout.tsx:12-24` — `PUBLIC_SEGMENTS`, dengan komentar `:13-17` yang menjelaskan bug `""`.
- `:27` — `AUTH_ONLY_SEGMENTS = new Set(["", "login", "signup"])`, sisi sebaliknya: user yang sudah login tidak boleh tertinggal di sana.
- `:29-42` — doc-comment dua bug.
- `:43-72` — implementasi `AuthGate`: `useSegments()` di `:45`, guard `if (isLoading) return;` di `:51`, keputusan di `:53-59`, spinner di `:63-69`.
- `Drovery_Mobile/app/index.tsx:4-11` — doc-comment yang menjelaskan kenapa `/` hanya spinner.

**Kenapa dipakai di sini:** `useSegments()` adalah cara `expo-router` menjawab "di mana kita sekarang" tanpa mem-parse URL — ia mengembalikan array segmen. Di Ionic kamu akan membaca `location.pathname` dan mem-parse string. Perbedaan kecil, tapi ia menutup satu kelas bug: kamu tidak akan pernah salah menangani trailing slash atau query string.

**Alternatif:**
- **Redirect per screen (`<Redirect href="/login" />` di tiap route)** — eksplisit, lokal, dan mudah dipahami tanpa membaca file lain. Harganya: harus diulang di ±25 file, dan screen ke-26 yang kamu tambahkan enam bulan lagi akan lupa. Kegagalannya senyap: layar ter-proteksi terbuka tanpa sesi.
- **Dua stack terpisah — `(auth)` dan `(app)` — yang dipilih di root layout** — ini pola standar React Navigation, dan strukturnya lebih bersih: tidak perlu daftar segmen sama sekali, karena struktur folder yang menjawab. Harganya: reorganisasi seluruh folder `app/`, dan deep link ke screen ter-proteksi jadi lebih rumit (kamu harus menyimpan tujuan, login, lalu melanjutkan). Kalau memulai dari nol, aku akan memilih ini.
- **Guard hanya di `apiClient` (lewat `setOnLogout`)** — sudah ada di repo, dan ia menangani konsekuensi jaringan dengan baik. Harganya: ia sama sekali tidak menangani cold start, karena cold start bukan peristiwa jaringan. Repo ini memakai keduanya, dan itulah poin pengajarannya — satu mekanisme jarang cukup.

**Latihan:** Simulasikan bug kedua. Buka `/track-on-map?id=...` untuk delivery aktif, lalu panggil `logout()` (dari tab Profile). **Verifikasi:** kamu harus terlempar ke `/login` dan polling 4 detik harus berhenti (buktikan dengan `console.log` di `useDeliveryTracking.ts` atau lewat network inspector). Lalu komentari sementara blok `if (!isAuthenticated && !isPublic)` di `app/_layout.tsx:56-57` dan ulangi. Tulis apa yang kamu lihat dan hubungkan dengan komentar di `:36-38`.

---

### 4.11 Native module & permission: kamera, lokasi, notifikasi

Alur permission Android sudah kamu kenal dari Capacitor: cek status, minta kalau belum, tangani penolakan. Yang berubah di sini ada dua: **di mana teks izin ditulis**, dan **bentuk API-nya**.

Di Capacitor kamu mengedit `AndroidManifest.xml` dan `Info.plist` langsung. Di Expo, teks izin dideklarasikan sebagai **config plugin** di `app.json`, dan plugin itulah yang menuliskannya ke file native saat prebuild. Kamu tidak pernah menyentuh file native — dan seperti dijelaskan di konsep 4.3, kalau kamu menyentuhnya, editanmu akan hilang.

Bentuk API-nya juga berbeda dan lebih React-ish. Di Capacitor kamu menulis `await Camera.requestPermissions()` — imperatif, sekali jalan. Di Expo, permission adalah **hook**: `const [permission, requestPermission] = useCameraPermissions()`. Bentuknya persis `useState`, dan konsekuensinya screen harus menangani **tiga** keadaan render, bukan dua:

1. `!permission` — belum tahu (hook belum selesai membaca status). Render kosong.
2. `!permission.granted` — sudah tahu, ditolak atau belum diminta. Render layar penjelasan + tombol.
3. Granted — render kamera.

Melewatkan keadaan pertama adalah bug yang khas: kamu render layar "izin ditolak" untuk sepersekian detik pada setiap pembukaan screen, meskipun izinnya sudah diberikan.

Untuk push notification, ada disiplin yang layak ditiru: **degradasi anggun yang eksplisit.** `registerForPushNotifications()` mengembalikan `null` tanpa melempar pada simulator, di Expo Go, atau saat izin ditolak — karena aplikasi harus tetap jalan, hanya tanpa push. Dan khusus Android: sejak Android 8 (Oreo), notifikasi **wajib** punya channel. Tanpa `setNotificationChannelAsync`, notifikasimu tidak muncul sama sekali — tanpa error.

**Anchor:**
- `Drovery_Mobile/features/delivery/screens/QRScannerScreen/QRScannerScreen.tsx:19` — `const [permission, requestPermission] = useCameraPermissions();`
- `:43-45` — keadaan "belum tahu"; `:47-63` — layar penjelasan + tombol `Allow Camera`; `:67-72` — `<CameraView onBarcodeScanned={...} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} />`.
- `Drovery_Mobile/features/delivery/screens/ProofCaptureScreen/ProofCaptureScreen.tsx:30-33` — `takePictureAsync({ base64: true, quality: 0.4 })`; `:35-47` — lokasi *best-effort* dalam `try/catch` terpisah dengan komentar `:46` *"location is optional"*. Foto tetap terkirim walau GPS gagal.
- `Drovery_Mobile/services/notifications/push.ts:25-31` — doc-comment: *"Best-effort: returns null (without throwing) on simulators, in Expo Go, or when permission is denied — the app still works, just without remote push."*
- `:36-41` — notification channel khusus Android; `:43-49` — alur cek-lalu-minta izin; `:70-73` — `catch` dengan komentar *"Native module missing (simulator/Expo Go) or permission flow failed."*
- `Drovery_Mobile/features/notifications/PushRegistrar.tsx:8-27` — **headless component**: `return null` di `:26`, dipasang di `app/_layout.tsx:86`, hanya untuk menjalankan efek saat `isAuthenticated` berubah.
- `Drovery_Mobile/app.json:48-53` — config plugin `expo-location` dengan teks izin di `:51`; `:55-60` — `expo-notifications` dengan warna ikon.

**Kenapa dipakai di sini:** Pola headless component (`PushRegistrar`) mungkin terasa aneh dari sudut pandang Ionic, di mana kamu akan memanggil fungsi registrasi dari `App.tsx` atau dari service. Di RN pola ini umum karena efeknya perlu ikut siklus hidup React (ia bergantung pada `isAuthenticated` dari Context) tapi tidak menggambar apa pun. Kamu akan sering menemuinya.

**Alternatif:**
- **Capacitor plugins (`@capacitor/camera`)** — mengembalikan base64 juga, API-nya lebih pendek. Perbedaan nyata yang penting untuk Drovery: kamera Capacitor membuka **activity kamera sistem** (UI-nya milik OS, kamu tidak bisa menggambar di atasnya), sedangkan `CameraView` adalah preview native yang di-*embed* ke pohon view-mu. Overlay viewfinder kustom di `QRScannerScreen` hanya mungkin dengan cara kedua.
- **`react-native-vision-camera`** — jauh lebih cepat, punya frame processor untuk barcode/ML realtime, dan kontrol kamera yang jauh lebih dalam (fokus, ISO, format). Harganya: wajib dev build, konfigurasi native lebih berat, dan ia adalah dependensi yang perlu diperhatikan setiap upgrade RN. Untuk sekadar scan QR sekali per delivery, `expo-camera` cukup.
- **Firebase Cloud Messaging langsung (`@react-native-firebase/messaging`)** — kontrol penuh atas payload push, tanpa perantara Expo push service, dan analytics FCM ikut. Harganya konkret: `google-services.json` harus di-commit atau di-inject di CI, wajib dev build, dan kamu mengurus **dua** implementasi (FCM untuk Android, APNs untuk iOS). Repo ini memilih Expo push token karena satu token melayani dua platform (`push.ts:55-58`).

**Latihan:** Jalankan `npm run android`, buka layar QR scanner, dan **tolak** izin kamera. **Verifikasi:** kamu harus melihat layar dari `QRScannerScreen.tsx:47-63`, bukan layar kosong atau crash. Lalu tambahkan tombol kedua "Buka Pengaturan" yang memanggil `Linking.openSettings()`. Jelaskan dalam dua kalimat kenapa tombol ini wajib di Android: setelah user menolak permanen, `requestPermission()` tidak akan memunculkan dialog lagi, dan tanpa jalan ke Settings, layar itu jadi jalan buntu.

---

### 4.12 Peta native: `react-native-maps` + `AnimatedRegion`

Ini perbedaan paling dramatis dari dunia WebView, dan yang paling terasa di tangan.

Di Ionic, peta adalah Leaflet atau Google Maps JS SDK yang berjalan **di dalam** WebView-mu. Marker kustom dibuat dari `L.divIcon` berisi HTML. Pan dan zoom diproses oleh JavaScript di dalam WebView, lalu digambar oleh browser engine, lalu dikomposit ke layar. Pada peta statis ini baik-baik saja; pada peta dengan marker yang bergerak tiap 4 detik dan polyline yang di-update, kamu akan melihat frame drop di HP kelas menengah.

Di sini, `<MapView>` adalah **view native** — Google Maps di Android, MapKit di iOS — yang disisipkan ke pohon view. Pan dan zoom diproses oleh kode native, sepenuhnya di luar JS thread. Dan bagian yang menyenangkan: `<Marker>` bisa berisi komponen React biasa sebagai anak. Di `TrackOnMapScreen`, marker drone berisi `<View>` + ikon + lingkaran pulse yang dianimasikan — semuanya JSX, digambar sebagai view native di atas peta native.

Sekarang bagian yang menarik secara teknis: **`AnimatedRegion`**. Posisi drone datang berkala — lewat WebSocket atau, kalau socket tidak tersedia, lewat poll 4 detik. Kalau kamu langsung menaruh koordinat baru ke `<Marker coordinate={...}>`, marker akan **teleport**: hilang di titik A, muncul di titik B. `AnimatedRegion` menginterpolasi di antaranya, dan yang penting: **interpolasinya berjalan di sisi native**, bukan di JS.

Ada satu catatan jujur di kode yang layak kamu perhatikan sebagai contoh dokumentasi yang baik: typing library-nya salah, dan penulisnya memilih `as any` **dengan komentar yang menjelaskan kenapa** alih-alih diam-diam.

Dan satu jebakan operasional yang akan menggigitmu: kunci Google Maps di `app.json` masih placeholder. Tanpa kunci valid, peta di build device **blank abu-abu** — bukan error, bukan crash, tidak ada apa pun di log.

**Anchor:**
- `Drovery_Mobile/features/delivery/screens/TrackOnMapScreen/TrackOnMapScreen.tsx:13-19` — impor `MapView, AnimatedRegion, Marker, MarkerAnimated, Polyline, PROVIDER_DEFAULT`.
- `:139-150` — `<MapView>` dengan `style={StyleSheet.absoluteFillObject}` (`:141`) dan `provider={PROVIDER_DEFAULT}` (`:142`).
- `:52-61` — pembuatan `AnimatedRegion` dengan komentar `:52-53`: *"Animated drone position — glides smoothly to each polled location so the drone visibly 'flies' between updates instead of teleporting."*
- `:63-79` — efek yang menjalankan `.timing({ ... duration: 3500, useNativeDriver: false })`. Komentar `:67-68` adalah catatan jujur soal typing yang salah: *"react-native-maps' AnimatedRegion.timing accepts lat/lng directly; the typings incorrectly require `toValue`, so cast the config."*
- `:178-187` — `<MarkerAnimated coordinate={droneRegion}>` yang berisi `<View>` + `Animated.View` pulse + ikon. Inilah yang tidak bisa dilakukan `divIcon`.
- `:129-134` — `mapRef.current?.fitToCoordinates([...], { edgePadding, animated: true })`.
- `Drovery_Mobile/features/delivery/screens/CreateDeliveryScreen/components/LocationPickerModal.tsx:82-95` — reverse geocode lewat backend, dengan komentar `:85-86`: *"Backend /geo/reverse (keyed/rate-managed) instead of Nominatim directly. The multi-result autocomplete (searchAddress) stays on Nominatim — /geo has no list search."* Ini kompromi arsitektur yang ditulis apa adanya. Lihat juga `:22-26` untuk `User-Agent` wajib Nominatim.
- `Drovery_Mobile/app.json:24-28` — `"apiKey": "YOUR_GOOGLE_MAPS_API_KEY"`, dan peringatannya di `README.md:156` dan `:160`.

**Kenapa dipakai di sini:** Perhatikan `TrackOnMapScreen.tsx:74`: `useNativeDriver: false` untuk `AnimatedRegion`. Ini bukan kelalaian. Native driver hanya bisa menjalankan properti `transform` dan `opacity`; koordinat peta bukan salah satunya. Aturan praktisnya, yang akan sering kamu pakai: **`useNativeDriver: true` untuk `transform` dan `opacity`; layout (width/height/top/left) dan properti kustom library tidak bisa.**

**Alternatif:**
- **`@rnmapbox/maps`** — vector tiles, styling peta yang bisa kamu kontrol penuh (warna jalan, label, tema gelap), dan peta offline. Untuk app pengiriman yang beroperasi di area dengan sinyal buruk, offline map adalah nilai nyata. Harganya: token Mapbox berbayar per-MAU setelah kuota gratis, dan setup native lebih berat (wajib dev build).
- **WebView + Leaflet** — persis yang biasa kamu lakukan di Ionic; nol setup native, jalan di Expo Go, dan kamu sudah tahu API-nya. Harganya spesifik untuk kasus ini: marker kustom harus HTML (jadi `Animated.View` pulse itu harus ditulis ulang sebagai CSS animation), dan performa pan/zoom pada peta live dengan polyline akan terasa berat — persis skenario layar ini.
- **`expo-maps`** — modul Expo yang lebih baru, lebih rapi di managed workflow, dan tidak punya masalah typing seperti di `:67-68`. Harganya: permukaan API-nya masih lebih sempit; padanan `AnimatedRegion` untuk interpolasi marker belum sematang `react-native-maps`, jadi kamu akan menulis interpolasi sendiri.
- **Untuk geocoding**: Google Places API memberi hasil yang jauh lebih baik untuk alamat Indonesia (format RT/RW, nama gang) tapi berbayar per request; Nominatim/OSM gratis tapi rate-limit ketat, wajib `User-Agent` (`LocationPickerModal.tsx:23-26`), dan sering meleset pada alamat non-jalan-utama.

**Latihan:** Ganti `PROVIDER_DEFAULT` di `TrackOnMapScreen.tsx:142` menjadi `PROVIDER_GOOGLE` dan jalankan di emulator Android **tanpa** mengisi API key di `app.json:26`. **Verifikasi:** kamu harus melihat peta abu-abu polos, **tanpa exception dan tanpa pesan di log**. Lalu isi key valid dan bandingkan. Tulis satu paragraf: kenapa mode gagal "diam" ini lebih berbahaya daripada crash, dan bagaimana kamu akan mendeteksinya di CI?

---

### 4.13 Reanimated (worklet, UI thread) vs `Animated` bawaan

Di WebView kamu memakai CSS transition atau `@keyframes`, dan browser menjalankannya di compositor thread. Artinya animasimu tetap halus meskipun JavaScript sedang sibuk memproses respons besar. Kamu mungkin tidak pernah memikirkan ini, karena kamu tidak perlu.

Di React Native, kamu perlu. Tanpa perhatian khusus, animasi berjalan di **JS thread** — thread yang sama yang menjalankan `mergeTrackingUpdate`, `JSON.parse` respons tracking, dan setiap re-render React. Kalau frame tracking masuk saat animasi berjalan, animasinya patah. Ini bukan teori: layar `TrackOnMapScreen` melakukan keduanya sekaligus.

Ada dua alat di repo ini, dan pemilihannya bukan acak:

**Reanimated** untuk animasi entering deklaratif. `FadeInDown.delay(100).duration(500).springify()` — satu ekspresi, langsung sebagai prop. Reanimated menjalankan animasi sebagai **worklet**: fungsi JavaScript yang di-compile dan dijalankan di UI thread, terpisah dari JS thread. Ini padanan terdekat dengan CSS animation dari sisi "tidak terganggu JavaScript". Kalau kamu butuh satu analogi: worklet ≈ CSS animation yang bisa kamu tulis dengan logika JS.

**`Animated` core** untuk loop sederhana, dengan `useNativeDriver: true` supaya perubahan `transform`/`opacity` di-*offload* ke native. Lebih terbatas, tapi nol dependensi tambahan dan cukup untuk pulse.

Satu detail yang menunjukkan perhatian penulisnya: loop pulse **berhenti** ketika delivery sudah selesai. Animasi terus-menerus di layar peta adalah pemboros baterai nyata di Android, dan pengguna aplikasi pengiriman sering membiarkan layar itu terbuka lama.

**Anchor:**
- `Drovery_Mobile/features/auth/screens/LoginScreen/LoginScreen.tsx:16-19` — impor `Animated, { FadeIn, FadeInDown }` dari `react-native-reanimated`; `:27-32` — konfigurasi animasi sebagai konstanta, termasuk `:30` `FadeInDown.delay(100).duration(500).springify()`.
- `Drovery_Mobile/features/delivery/screens/CreateDeliveryScreen/components/CustomCalendar.tsx:3` — `SlideInDown` / `SlideOutDown` untuk modal kalender.
- `Drovery_Mobile/features/delivery/screens/TrackOnMapScreen/TrackOnMapScreen.tsx:104-127` — `Animated.loop(Animated.sequence([...]))` dari core RN, dengan `useNativeDriver: true` di `:116` dan `:121`. Komentar `:104-105` menjelaskan kenapa loop-nya berhenti saat tidak live; `:107-110` implementasinya.
- `:74` — kontrasnya: `useNativeDriver: false` untuk `AnimatedRegion`, karena koordinat peta bukan `transform`/`opacity`.
- `Drovery_Mobile/package.json:46` dan `:51` — `react-native-reanimated` dan `react-native-worklets` sebagai dependensi terpisah. Worklets adalah mesin yang menjalankan fungsi di UI thread.

**Kenapa dipakai di sini:** Pembagiannya bisa dibaca sebagai aturan: **animasi yang harus mulus meski JS sibuk → Reanimated; loop sederhana pada `transform`/`opacity` → `Animated` + native driver; apa pun yang bukan `transform`/`opacity` → tidak ada pilihan selain JS driver, jadi buat sesederhana mungkin.**

**Alternatif:**
- **`Animated` core saja, tanpa Reanimated** — nol dependensi tambahan dan satu API untuk dipelajari. Harganya konkret: animasi entering deklaratif harus ditulis manual (`useRef(new Animated.Value(0))` + efek + `start()` per komponen, sekitar 8 baris untuk apa yang sekarang 1 baris), dan animasi yang digerakkan gesture praktis mustahil dibuat mulus karena setiap frame gesture harus melintasi bridge.
- **`LayoutAnimation`** — satu panggilan sebelum `setState` dan semua perubahan layout dianimasikan otomatis. Harganya: kamu tidak bisa mengontrol properti mana yang dianimasikan, tidak bisa membatalkan di tengah jalan, dan di Android ia butuh flag khusus dan berperilaku tidak konsisten pada nested view.
- **Moti** (wrapper deklaratif di atas Reanimated) — API-nya mirip Framer Motion, jadi kalau kamu datang dari web ini yang paling nyaman. Harganya: satu lapisan abstraksi lagi di antara kamu dan Reanimated, sehingga saat ada yang aneh kamu harus debug dua library.

**Latihan:** Di `TrackOnMapScreen.tsx`, ubah `useNativeDriver: true` (baris `:116` dan `:121`) menjadi `false`. Lalu tambahkan pembebanan JS thread sintetis, misalnya `setInterval(() => JSON.parse(bigString), 16)` di komponen yang sama. **Verifikasi:** amati pulse-nya tersendat. Kembalikan ke `true` dengan beban yang sama masih jalan — pulse harus mulus lagi. Kamu baru saja melihat sendiri kenapa native driver ada, dan kenapa "animasi 60fps di RN" bukan hal yang gratis seperti CSS transition.

---

### 4.14 Tombol back hardware Android + `useFocusEffect`

Ini murni masalah Android dan sangat relevan untukmu. Refleksnya sudah kamu punya dari Capacitor: `App.addListener('backButton', ...)`, tangani, `return true` untuk mencegah perilaku default. Yang perlu diganti bukan logikanya, tapi **scope**-nya.

Bug yang terjadi di repo ini pantas dibaca dua kali. Handler "tekan back dua kali untuk keluar" dipasang di `HomeScreen` dengan `useEffect`. Masuk akal, kan? Kecuali: **tab screen tidak pernah unmount di Expo Router.** Begitu kamu membuka tab Home sekali, handler itu terdaftar untuk **seluruh sesi**. Akibatnya: tekan Back di layar Create Delivery yang formnya sudah terisi setengah → aplikasi keluar.

Perbaikannya bukan mengganti logika, melainkan mengganti hook: `useEffect` (scope mount) → `useFocusEffect` (scope fokus). `useFocusEffect` menjalankan efek saat screen mendapat fokus dan membersihkannya saat kehilangan fokus — persis yang dibutuhkan untuk handler global seperti `BackHandler`.

Pelajarannya dilengkapi dengan **kasus negatif** yang bagus: di `ProfileScreen`, handler-nya sengaja **dihapus** dan diganti komentar. Back dari tab Profile seharusnya kembali, bukan keluar dari app. Menuliskan "sengaja tidak ada di sini" sama berharganya dengan menuliskan kenapa sesuatu ada.

Perhatikan juga `ToastAndroid` — API khusus Android yang **tidak ada di iOS**. Padanan `@capacitor/toast` yang lintas platform. Di RN, kamu bertanggung jawab sendiri untuk memeriksa platform (atau, seperti di sini, menerima bahwa fitur ini memang hanya untuk Android).

**Anchor:**
- `Drovery_Mobile/features/home/screens/HomeScreen/HomeScreen.tsx:73-99` — komentar `:73-78` menuliskan bug-nya dengan tepat: *"Scoped with useFocusEffect, NOT useEffect. Tab screens never unmount in Expo Router, so a mount-scoped handler stays registered for the whole session and swallows Back on every other screen too — which is how Back came to quit the app from anywhere, including mid-form."* Implementasinya di `:79-99`.
- `:7` (`import { ToastAndroid }`) dan `:90` (`ToastAndroid.show("Press back again to exit", ToastAndroid.SHORT)`).
- `Drovery_Mobile/features/auth/screens/LoginScreen/LoginScreen.tsx:71-85` — pola yang sama untuk exit-on-back, dengan alasannya di `:71-73`: sign-in adalah akar stack signed-out, jadi Back memang keluar — dan scope-nya fokus supaya berhenti berlaku begitu user pindah ke signup.
- `Drovery_Mobile/features/profile/screens/ProfileScreen/ProfileScreen.tsx:56-58` — kasus negatif: *"No hardware-back handler here on purpose."*
- `Drovery_Mobile/app.json:23` — `predictiveBackGestureEnabled: false`, agar perilaku Back tetap deterministik dan tidak berinteraksi dengan gesture prediktif Android 14+.

**Kenapa dipakai di sini:** Ini contoh bagus tentang bug yang penyebabnya adalah **asumsi tentang siklus hidup**, bukan logika. Kodenya benar; scope-nya salah. Kelas bug ini akan muncul lagi di konsep 4.15 dalam bentuk yang jauh lebih halus (`let active` per effect-run), dan lagi di Fase 5 dalam bentuk "siapa yang masih berhak menulis".

**Alternatif:**
- **`useEffect` biasa** — apa yang justru menyebabkan bug ini. Aman **hanya** untuk screen yang benar-benar unmount saat ditinggalkan (screen dalam stack yang di-pop). Kalau kamu tidak yakin sebuah screen akan unmount, jangan pakai.
- **Satu handler global di root layout yang memeriksa `useSegments()`** — satu tempat untuk semua aturan back, mudah diaudit. Harganya: kopling terbalik — root layout harus tahu aturan setiap screen, jadi menambah screen berarti mengedit root. Ini persis kebalikan dari prinsip yang membuat `AuthGate` bagus (di sana root memang **harus** tahu, karena auth memang urusan global).
- **Kontrol di level navigator (`Stack.Screen options={{ gestureEnabled: false }}`)** — perilakunya ditangani native, tidak ada handler JS yang bisa bocor scope-nya. Harganya: kamu hanya bisa mengizinkan atau melarang, tidak bisa menjalankan logika (seperti "tampilkan konfirmasi buang draft").

**Latihan:** Terapkan pola yang sama untuk `features/delivery/screens/CreateDeliveryScreen/`: tambahkan `useFocusEffect` + `BackHandler` yang menampilkan `Alert` konfirmasi "Buang draft ini?" ketika form sudah terisi. **Verifikasi:** tambahkan `console.log('cleanup')` di fungsi cleanup, lalu pindah ke screen lain dan tekan Back di sana. Log cleanup harus muncul **sebelum** kamu menekan Back, dan Alert-nya **tidak** boleh muncul di screen lain.

---

### 4.15 `useDeliveryTracking.ts` — studi kasus terberat

Sekarang bagian tersulit di seluruh repo mobile. Jangan buru-buru. Sediakan waktu dobel; kalau kamu perlu dua hari untuk satu file, itu waktu yang terpakai dengan benar.

Yang membuatnya sulit **bukan** WebSocket-nya. Yang sulit adalah **koreografi ref**. Hook ini punya sembilan `useRef`, dan enam di antaranya menjawab pertanyaan yang berbeda-beda. Kalau kamu membacanya sebagai "kumpulan variabel yang tidak memicu re-render", kamu akan tersesat. Bacalah tiap ref sebagai **jawaban atas satu pertanyaan yang bisa dirumuskan**.

Tiga ref yang mundane dulu, supaya tidak mengganggu: `connRef` (handle socket saat ini), `pollRef` (id interval), `mountedRef` (apakah komponen masih terpasang). Standar.

Enam ref yang punya alasan tertulis:

| Ref | Pertanyaan yang dijawab |
|---|---|
| `prevStatusRef` | "Status sebelumnya apa?" — untuk **de-duplikasi notifikasi**, agar satu transisi tidak memicu dua notifikasi (satu dari push WS, satu dari `reconcile`) |
| `statusRef` | "Sudah terminal belum?" — supaya timer dan teardown tahu kapan berhenti, tanpa membaca state yang mungkin basi |
| `dataRef` | "Apa basis merge-nya?" — sumber sinkron untuk `mergeTrackingUpdate`, menghindari **stale closure** |
| `idRef` | "Delivery mana yang sedang di-subscribe?" — respons `getById` yang tiba **setelah** id berganti harus dibuang, bukan menimpa data delivery baru |
| `reconcileSeqRef` | "Reconcile ini masih yang terbaru?" — token monoton, agar respons yang datang tidak berurutan tidak menimpa yang lebih baru |
| `auth1008DidReconcileRef` | "Sudah pernah refresh+reopen?" — pembatas storm, mencegah loop `1008 → getById → 1008` tak berujung |

Lalu ada satu variabel yang **bukan** ref, dan justru itu yang paling halus: `let active = true` di dalam efek. Kenapa tidak pakai `mountedRef` saja? Karena `mountedRef` di-share antar effect run. Kalau efek di-teardown lalu efek baru mount (misalnya karena `id` berubah), `mountedRef.current` sudah `true` lagi — dan callback lama yang masih menggantung akan mengira dirinya masih valid. `let active` di-capture segar per effect run dan di-flip `false` di cleanup **run itu**, sehingga sebuah callback bisa membedakan "instance efek**ku** sudah dibongkar" dari "ada instance yang lebih baru terpasang".

Ini adalah ide yang sama dengan `reconcileSeqRef`, hanya dalam dimensi yang berbeda: **kamu butuh cara memutuskan apakah penulis yang datang masih berhak menulis.** Ingat kalimat ini. Di Fase 5, kalimat yang sama akan berbunyi: `updateMany({ where: { id, status: 'PENDING' } })` mengembalikan `count === 0`, artinya aktor lain sudah menang.

**Anchor:**
- `Drovery_Mobile/features/delivery/hooks/useDeliveryTracking.ts:35-43` — doc-comment strategi. Baca ini dulu, sebelum kode apa pun.
- `:49-66` — sembilan ref beserta komentar alasannya. Khususnya `:51-52` (prevStatus/status/data), `:57-60` (idRef), `:62-63` (reconcileSeqRef), `:64-66` (auth1008DidReconcileRef).
- `:70-85` — `notifyOnStatusTransition`: **satu-satunya** tempat `prevStatusRef` dibaca dan dimajukan, sehingga push WS, `reconcile`, dan poll semuanya de-dup lewat pintu yang sama.
- `:108-132` — `fetchTracking`. Perhatikan `:111` (`const reqId = id;` dengan komentar *"resolution that crosses an id-switch is stale → drop"*) dan `:117` (`if (!mountedRef.current || idRef.current !== reqId) return;`).
- `:145-160` — `reconcile()`, dengan komentar `:145-147` yang menjelaskan kenapa ia **tidak** memicu notifikasi ganda, dan `:151`/`:154` untuk token monoton.
- `:162-180` — `handlePush`, dengan `:167` (`if (next === before) return;` — no-op referensial) dan `:171` (majukan `prevStatusRef` **sebelum** reconcile, untuk de-dup).
- `:182-255` — efek utama. `:184-188` adalah komentar + deklarasi `let active`. `:189-195` mereset semua ref saat (re-)subscribe. `:227-244` adalah `onAuthFailed` — bagian paling berlapis, dengan tiga pemeriksaan di `:240-241` sebelum berani membuka socket baru.
- `:248-254` — cleanup: `active = false`, tutup socket, hentikan poll.

**Kenapa dipakai di sini:** Aku akan jujur: file ini akan terasa berlebihan pada bacaan pertama. Kesan "kenapa harus serumit ini?" itu wajar dan sehat. Cara mengubahnya jadi pemahaman bukan dengan membaca lebih keras, tapi dengan **merusak satu ref lalu menjalankan test-nya**. Setiap ref punya test yang mati kalau ref itu dihapus. Itulah latihan di bawah, dan itu satu-satunya cara.

**Alternatif:**
- **Polling saja (versi sebelumnya di repo ini)** — jauh lebih sederhana: satu `setInterval`, satu `fetchTracking`, tanpa koreografi ref sama sekali. Harganya terukur: 15 request per menit per delivery aktif (dan itu per user), posisi drone terlambat sampai 4 detik, dan konsumsi baterai yang terasa saat layar peta dibuka lama.
- **WS saja tanpa fallback** — kode paling bersih dari ketiganya: hapus `startPoll`, `stopPoll`, `pollRef`, dan setengah dari `onUnavailable`. Harganya spesifik untuk aplikasi ini: WebSocket diblokir oleh banyak proxy kantor, kampus, dan beberapa operator seluler. Tracking mati total di sana — persis skenario di mana app pengiriman dipakai.
- **TanStack Query + `setQueryData` dari handler socket** — ini alternatif paling serius. Query mengurus fetch, dedup, retry, dan stale; handler socket hanya menulis ke cache. Sebagian besar ref di file ini akan hilang, karena "siapa yang menang" diurus oleh cache key + `queryClient`. Harganya: satu dependensi besar, dan kamu memindahkan kompleksitas — bukan menghapusnya — ke aturan invalidasi cache yang harus kamu kuasai.
- **Redux + middleware socket** — pola klasik yang masuk akal **kalau** posisi drone perlu dibaca beberapa screen sekaligus (misalnya badge di tab bar plus peta). Saat ini hanya satu screen yang membacanya, jadi store global membayar untuk masalah yang belum ada.

**Latihan:** Tiga langkah bertingkat, kerjakan berurutan.

1. Jalankan `npx jest __tests__/features/delivery/hooks/useDeliveryTracking.ws.test.ts` dan `__tests__/features/delivery/hooks/useDeliveryTracking.notify.test.ts`. Untuk setiap `it(...)`, tulis satu baris: ref mana yang dilindungi test ini? **Verifikasi:** kamu harus bisa memetakan minimal empat dari enam ref.
2. Hapus pemeriksaan `if (token !== reconcileSeqRef.current) return;` di `:154`. Tulis skenario (pakai `jest.useFakeTimers()`) di mana respons `getById` yang lama menimpa data yang lebih baru. **Verifikasi:** test barumu harus **gagal** dengan baris itu dihapus dan **lulus** setelah dikembalikan.
3. Ganti `let active = true` (`:188`) menjadi pemakaian `mountedRef` saja di seluruh callback. Jalankan seluruh suite. **Verifikasi:** catat test mana yang gagal. Kalau tidak ada yang gagal, itu temuan penting — tulis test yang membunuhnya (petunjuk: ganti `id` saat `onAuthFailed` sedang menunggu `await fetchTracking`).

---

### 4.16 Strategi WS-primary / poll-fallback dan merge frame parsial

Konsep 4.15 membedah *bagaimana* hook itu menjaga konsistensinya. Sekarang *kenapa* strateginya seperti itu, dan apa yang terjadi di sisi socket.

Strateginya, dalam satu kalimat dari doc-comment-nya: selama socket tracking connected dan subscribed, frame posisi/status di-merge di tempat (nol HTTP); kalau socket tidak tersedia atau putus melewati budget reconnect-nya, hook jatuh ke poll `getById` 4 detik supaya tracking **tidak pernah mati total**.

Ada tiga bagian yang layak dibedah.

**(a) `wsUrl.ts` — pengetahuan lintas repo dalam 17 baris.** File ini komentarnya lebih panjang dari kodenya, dan itu disengaja. Ia menjelaskan tiga hal yang tidak bisa kamu ketahui dari sisi mobile saja: bahwa gateway WS menempel di server HTTP yang **sama** di root (prefix `/api/v1` hanya untuk HTTP), bahwa parsing pakai regex bukan `new URL()` karena polyfill URL di RN tidak lengkap, dan bahwa port tidak boleh di-hardcode karena TLS produksi bisa terminate di 443.

**(b) `openTracking` — handle sekali pakai.** Ini disiplin desain yang layak kamu tiru. Doc-comment-nya: *"The handle is immutable and disposable — one handle = one attempt-chain — so a caller's teardown is always just `close()`."* Untuk re-handshake setelah token refresh, pemanggil **menutup** handle lama dan membuka yang baru — bukan "reconnect" pada handle yang sama. Ini menghilangkan seluruh kelas bug "socket zombie": handle yang sudah kamu kira mati tapi ternyata masih punya timer berjalan.

Kegagalannya juga dikategorikan sebagai **tipe**, bukan pesan bebas. `UnavailableReason` punya lima nilai, dan pemanggil bisa memutuskan strategi berbeda per nilai.

Satu detail yang sering mengejutkan orang yang terbiasa HTTP: WebSocket di browser dan RN **tidak bisa** mengirim header kustom saat connect. Jadi tidak ada `Authorization: Bearer`. Autentikasi dilakukan lewat query param `?token=...` di handshake.

Backoff-nya bukan sekadar retry: eksponensial (`factor: 2`), dibatasi (`maxDelayMs: 15000`), **berjitter** (`jitterMs: 250`) agar seribu klien tidak reconnect serempak setelah server restart, dan berbatas (`maxAttempts: 5`) supaya ada titik menyerah yang jelas.

**(c) Merge frame parsial — dua aturan yang halus dan mahal kalau salah.**

**Rule 0:** kalau belum ada delivery dasar (initial `getById` masih terbang), frame **dibuang**. Jangan pernah mengarang `ApiDelivery` parsial, karena screen peta membaca `fromLat`/`toLat`/`addresses`/`trackingId` yang tidak ada di frame.

**Aturan `undefined`, bukan truthiness.** Ini bug yang khusus menggigit Indonesia: koordinat `0` (khatulistiwa) dan koordinat **negatif** (seluruh Indonesia di selatan khatulistiwa punya latitude negatif) akan hilang kalau kamu menulis `if (u.droneLat)`. `-6.903` memang truthy, tapi `0` tidak — dan pola `if (value)` untuk angka adalah kebiasaan yang harus kamu buang di sini.

**Anchor:**
- `Drovery_Mobile/services/api/wsUrl.ts:1-17` — seluruh file. Baris `:3-6` (kenapa prefix dibuang, dengan rujukan ke `backend main.ts`), `:8-9` (kenapa regex bukan `new URL()`), `:10-11` (kenapa port tidak boleh di-hardcode).
- Sisi backend yang dirujuk: `Drovery_Backend/src/main.ts:36` (`app.useWebSocketAdapter(new WsAdapter(app))`) dan `:40` (`app.setGlobalPrefix(prefix)`). Buka keduanya; ini contoh terbaik dalam kurikulum ini tentang komentar yang menyimpan pengetahuan lintas repo.
- `Drovery_Mobile/services/api/trackingSocket.ts:71-80` — doc-comment kontrak `openTracking`.
- `:20-25` — `UnavailableReason` dengan lima nilai (`no-websocket`, `no-token`, `connect-error`, `subscribe-error`, `drop-exhausted`), masing-masing berkomentar.
- `:86-92` — jalur "tidak ada WebSocket impl" (jest/node), termasuk `queueMicrotask` dan alasannya di `:88-89`.
- `:145-156` — `scheduleReconnect`: batas percobaan di `:147-150`, backoff eksponensial + jitter di `:151-153`.
- `:191-198` — `onOpen`: kirim frame `subscribe`, pasang timeout ack.
- `:200-205` — `onClose`: `code 1008` berarti auth (panggil `onAuthFailed`), selain itu reconnect biasa.
- `:221` — `new Impl(\`${wsBaseUrl}/?token=${encodeURIComponent(token)}\`)` — token di query param.
- `Drovery_Mobile/features/delivery/services/deliveryTrackingMerge.ts:16-26` — doc-comment; **Rule 0** ada di `:23-25`, implementasinya `:31`.
- `:36` — `return prev;` kalau tidak ada perubahan, sehingga React tidak re-render tanpa alasan.
- `:42-45` — komentar *"undefined-checks, NOT truthiness: a 0 / negative coordinate is valid."* diikuti tiga pemeriksaan `!== undefined`.
- `Drovery_Mobile/features/support/services/supportSocket.ts:6-26` — pola yang sama, di-reuse untuk chat support, dengan pernyataan eksplisit `:7-8`: *"Modeled EXACTLY on the tracking socket."*

**Kenapa dipakai di sini:** Perhatikan bahwa `supportSocket.ts` menyatakan dirinya meniru `trackingSocket.ts`. Ini bukti bahwa pola handle-sekali-pakai memang dirancang untuk diulang, bukan solusi ad-hoc. Ketika kamu bertemu ide yang sama dua kali di repo yang sama, itu tanda kamu sedang melihat keputusan arsitektur, bukan kebetulan.

**Alternatif:**
- **socket.io-client** — reconnect otomatis, room, ack, dan fallback polling — semuanya gratis, dan akan menghapus sekitar 250 baris yang ada di `trackingSocket.ts`. Harganya di sini bersifat lintas repo: backend memakai `WsAdapter` NestJS (WebSocket mentah, `Drovery_Backend/src/main.ts:36`), bukan adapter socket.io — jadi memakai socket.io di klien berarti **mengubah backend**. Kalau kamu memulai dari nol hari ini, ini pilihan yang layak dipertimbangkan serius.
- **Server-Sent Events (SSE)** — satu arah, reconnect otomatis oleh spesifikasi, jauh lebih sederhana, dan lewat HTTP biasa jadi lebih tahan proxy. Cocok untuk tracking yang memang satu arah. Harganya: chat support butuh dua arah, jadi kamu akan punya dua teknologi realtime alih-alih satu.
- **Polling saja** — persis fallback yang sudah ada. Paling sederhana dan paling tahan-banting (kalau HTTP jalan, tracking jalan). Harganya sudah disebut di 4.15: latensi 4 detik dan boros baterai/kuota.
- **Layanan terkelola (Ably, Pusher)** — presence, history, dan skala fan-out gratis. Harganya: biaya per pesan, satu vendor lagi di jalur kritis, dan data posisi drone melewati pihak ketiga.

**Latihan:** Dua bagian.

1. Di `deliveryTrackingMerge.ts:43`, ganti `if (u.droneLat !== undefined)` menjadi `if (u.droneLat)`. Jalankan `npx jest __tests__/features/delivery/services/deliveryTrackingMerge.test.ts`. **Verifikasi:** catat test mana yang gagal, lalu tulis satu kalimat: koordinat dunia nyata mana yang rusak? (Petunjuk: buka Google Maps, cari latitude Jakarta.)
2. Baca `__tests__/services/api/trackingSocket.test.ts:7-38` untuk memahami `FakeWebSocket`. Tambahkan test baru: setelah `maxAttempts` drop berturut-turut, `onUnavailable('drop-exhausted')` dipanggil **tepat sekali** dan tidak ada `FakeWebSocket` baru yang dibuat sesudahnya. **Verifikasi:** kamu akan butuh `jest.useFakeTimers()` untuk melompati delay backoff; kalau test-mu menggantung, itu tandanya timer palsunya belum dipasang.

---

### 4.17 Testing React Native: `jest-expo`, `__mocks__`, dan test hook

Ada tiga hal khas RN yang tidak ada padanannya di test web, dan ketiganya akan menghadangmu di jam pertama.

**(a) `transformIgnorePatterns`.** Secara default Jest **tidak** mem-transform apa pun di `node_modules`, dengan asumsi paket npm dikirim sebagai CommonJS. Paket React Native dan Expo tidak: mereka dikirim sebagai ES modules dengan JSX. Jadi kamu butuh daftar-putih paket yang **harus** ditransform. Regex panjang di `jest.config.js:8` itu adalah daftar tersebut, dan ia adalah penyebab error `SyntaxError: Cannot use import statement outside a module` yang legendaris. Kalau kamu menambah dependensi RN baru dan test-mu tiba-tiba gagal parse, tempat pertama yang dilihat adalah baris ini.

**(b) Native module tidak ada di Node.** `expo-secure-store` memanggil Keystore. Keystore tidak ada di laptopmu saat `jest` jalan. Jadi ada folder `__mocks__/` berisi pengganti manual: `MapView` diganti `View` ber-`testID`, `AnimatedRegion` diganti kelas boneka, `SecureStore` diganti tiga `jest.fn()`.

**(c) Tidak ada `WebSocket` global di jest/node** — dan ini yang paling menarik, karena ia **tidak diselesaikan dengan mock**. Ketiadaan `WebSocket` dijadikan **jalur kode produksi**: `openTracking` mendeteksinya dan memanggil `onUnavailable('no-websocket')`, sehingga di test hook otomatis jatuh ke jalur poll — yang memang jalur yang ingin diuji. Dan detail kecil yang menunjukkan pemikirannya: `queueMicrotask` dipakai supaya callback mendarat **di dalam** window `act()` React. Testability mempengaruhi desain produksi. Ini poin yang layak kamu bawa ke backend.

Cakupan test-nya sengaja condong ke logika, bukan piksel. Dari 41 file test, mayoritas menguji hook dan service, bukan render screen. Untuk app yang UI-nya masih sering berubah, ini keputusan yang bisa dibenarkan — meski artinya bug layout tidak akan tertangkap sama sekali oleh suite ini.

**Anchor:**
- `Drovery_Mobile/jest.config.js:2` — `preset: 'jest-expo'`; `:4-6` — `moduleNameMapper` untuk alias `@/` (harus sinkron dengan `tsconfig.json:5-9`); `:7-9` — `transformIgnorePatterns`; `:11-18` — `collectCoverageFrom` yang mengambil `services/`, `contexts/`, `features/`, `config/` dan mengecualikan `*.types.ts` serta `index.ts`.
- `Drovery_Mobile/__mocks__/react-native-maps.ts:4-14` — `MapView`/`Marker`/`Polyline`/`MarkerAnimated` diganti `View` ber-`testID`; `:19-24` — `AnimatedRegion` sebagai kelas boneka yang `timing()`-nya mengembalikan `{ start: jest.fn() }`.
- `Drovery_Mobile/__mocks__/expo-notifications.ts:1` — komentar *"Manual jest mock for expo-notifications (native module unavailable in tests)."*
- `Drovery_Mobile/__mocks__/expo-secure-store.ts:1-3` — tiga `jest.fn()`.
- `Drovery_Mobile/__tests__/services/api/trackingSocket.test.ts:7-38` — kelas `FakeWebSocket` dengan driver manual (`fireOpen`, `fireMessage`, `fireClose`). Ini pola yang layak kamu tiru untuk apa pun yang event-driven.
- `Drovery_Mobile/__tests__/contexts/AuthContext.test.tsx:8-20` — mock modul + `renderHook` dari `@testing-library/react-native`.
- `Drovery_Mobile/services/api/trackingSocket.ts:86-92` — jalur `no-websocket` sebagai kode produksi, dengan komentar `:88-89` tentang `queueMicrotask` dan `act()`.

**Kenapa dipakai di sini:** Perhatikan bahwa `__mocks__/react-native-maps.ts` memberi `testID` pada tiap komponen tiruannya. Itu memungkinkan test render memeriksa "ada berapa marker" tanpa peduli peta aslinya. Dan `useCameraPermissions` di-mock selalu `granted` — sesuatu yang mock bawaan Expo tidak akan memberikan, karena mock bawaan berusaha realistis sementara kamu butuh deterministik.

**Alternatif:**
- **Render screen penuh dengan `@testing-library/react-native`** — sudah terpasang (`package.json:55`) dan sudah dipakai lewat `renderHook`. Render penuh memberi keyakinan lebih tinggi (kamu menguji apa yang user lihat). Harganya: lambat (tiap test me-render pohon besar), dan rapuh terhadap perubahan layout yang sebenarnya tidak mengubah perilaku.
- **Detox atau Maestro (E2E di device)** — satu-satunya cara menangkap bug permission, navigasi native, dan peta abu-abu. Untuk app ini, Maestro akan bernilai sangat tinggi pada alur handoff QR (kamera → scan → konfirmasi). Harganya: emulator di CI, runtime menit-menitan per run, dan flakiness yang perlu dianggarkan.
- **`jest-preset-expo` tanpa `__mocks__` manual** — beberapa modul Expo punya mock bawaan, jadi lebih sedikit file yang dirawat. Harganya: kamu tidak bisa mengontrol nilai kembaliannya — dan seluruh test permission di sini bergantung pada `useCameraPermissions` yang **selalu** `granted`.

**Latihan:** Tulis test hook pertamamu: buat `__tests__/features/delivery/hooks/useTrackDelivery.extra.test.ts` yang memverifikasi `track()` mengembalikan `null` **dan** mengisi `error` saat `deliveryApi.track` menolak. Tiru struktur mock dari `__tests__/features/delivery/hooks/useDelivery.test.ts`. **Verifikasi:** setelah hijau, hapus sementara `moduleNameMapper` di `jest.config.js:4-6` dan jalankan lagi. Baca pesan errornya dan jelaskan: kenapa TypeScript bisa resolve `@/` tapi Jest tidak?

---

### 4.18 Expo Go vs dev build vs EAS — jebakan terbesar fase ini

Kalau kamu hanya boleh mengingat satu hal dari fase ini, ingat yang ini.

Di Capacitor, `npx cap sync` selalu memberimu **aplikasi native sungguhan**. Semua plugin yang kamu pasang ikut, karena mereka dikompilasi ke dalam APK-mu. Tidak ada mode "setengah jadi". Kalau plugin tidak jalan, kamu dapat error.

Di Expo, ada **tiga** cara menjalankan aplikasimu, dan hanya dua yang memberi native module lengkap:

1. **Expo Go** — aplikasi pihak ketiga dari Play Store yang berisi **sekumpulan native module tetap** yang sudah dipilih tim Expo. Bundle JS-mu dimuat ke dalamnya. Cepat, tidak perlu build, tidak perlu kabel. Tapi kalau proyekmu memakai native module **di luar** daftar itu — dan `@stripe/stripe-react-native` serta konfigurasi Google Maps ada di luar daftar itu — modul tersebut **tidak ada**.
2. **Dev build (dev client)** — aplikasi yang kamu build sendiri, berisi native module **milikmu**, plus kemampuan memuat bundle JS dari dev server. Ini padanan terdekat dengan `npx cap sync` + `Run` di Android Studio.
3. **Build preview/production** — APK atau AAB penuh, bundle JS di dalamnya.

Dan inilah yang tidak bisa dibaca dari dokumentasi: **kegagalannya senyap.** Tidak ada `Module not found`. Tidak ada crash. Yang terjadi:

- Google Maps tanpa konfigurasi kunci → peta **abu-abu polos**, tidak ada error.
- Stripe PaymentSheet di Expo Go → tombol "Add card with Stripe" **tidak muncul sama sekali**, karena `StripeAddCard` mengembalikan `null` saat key tidak ada.

Dua-duanya adalah keputusan sadar penulis repo — degradasi anggun alih-alih crash — tapi konsekuensinya sama: kamu bisa menghabiskan sore mengira kodemu salah, padahal environment-nya yang salah. **Fitur yang bergantung native harus punya jalur mati yang mulus, dan kamu harus tahu bagaimana membedakan "jalur mati" dari "bug".**

Sisanya lebih akrab. **Config plugin** menggantikan "edit `AndroidManifest.xml` sendiri" — plugin Stripe menyuntikkan `merchantIdentifier` dan mengaktifkan Google Pay saat prebuild, tanpa kamu membuka Gradle. **Profil EAS**: `preview` menghasilkan `.apk` untuk sideload, `production` menghasilkan `.aab` untuk Play Store — perbedaan yang sudah kamu kenal. Dan `appVersionSource: "remote"` + `autoIncrement` berarti `versionCode` dikelola server EAS, bukan di-commit; itu menghapus satu sumber konflik merge yang menyebalkan.

**Anchor:**
- `Drovery_Mobile/app.json:34-68` — array `plugins`: `expo-router`, `expo-splash-screen`, `expo-location`, `expo-secure-store`, `expo-notifications`, dan `@stripe/stripe-react-native` di `:61-67` dengan `merchantIdentifier` dan `enableGooglePay`.
- `Drovery_Mobile/eas.json:6-23` — tiga profil: `development` dengan `developmentClient: true` (`:8`), `preview` dengan `buildType: "apk"` (`:13-15`), `production` dengan `autoIncrement: true` + `buildType: "app-bundle"` (`:17-22`).
- `Drovery_Mobile/eas.json:4` — `appVersionSource: "remote"`.
- `Drovery_Mobile/README.md:161` — *"Stripe PaymentSheet (native card entry) needs a dev build ..., not Expo Go."* dan `:160` untuk kunci Google Maps.
- `Drovery_Mobile/features/profile/screens/PaymentMethodsScreen/StripeAddCard.tsx:77-89` — degradasi anggun: `if (!ENV.STRIPE_PUBLISHABLE_KEY) return null;` di `:83`. Inilah kenapa tombolnya "hilang" alih-alih error.
- `Drovery_Mobile/services/notifications/push.ts:70-73` — pasangannya untuk push: `catch` yang mengembalikan `null` dengan komentar *"Native module missing (simulator/Expo Go)"*.
- `Drovery_Mobile/.github/workflows/android-build.yml:3-5` — *"MANUAL by design — each run consumes an EAS build credit, so you gate releases with 'Run workflow' rather than building on every push"*; `:34-37` — `concurrency` group agar dua build tidak jalan bersamaan; `:65-84` — langkah build dan pengambilan artefak, termasuk `:74` dengan dua path fallback `jq`.
- `Drovery_Mobile/README.md:152` — *"EAS generates and stores the Android upload keystore — no signing secrets live in the repo."*

**Kenapa dipakai di sini:** `android-build.yml:34-37` (`concurrency`) dan `:3-5` (manual by design) adalah contoh bagus tentang CI yang dirancang untuk kendala nyata: kredit build itu berbayar dan terbatas. Bandingkan dengan refleks "build di setiap push" yang biasa. Kendala ekonomi mengubah desain teknis — dan itu selalu boleh dijadikan alasan yang sah.

**Alternatif:**
- **`expo prebuild` + build lokal dengan Gradle** — gratis (tidak memakai kredit EAS), dan kamu bisa membuka Android Studio untuk debug native langsung. Harganya: kamu mengurus JDK, Android SDK, dan keystore sendiri; dan folder `android/` hasil generate cenderung ikut ter-commit lalu drift dari `app.json` (lihat konsep 4.3).
- **Fastlane + self-hosted GitHub runner** — kontrol penuh dan gratis untuk Android. Harganya: setup jauh lebih panjang (satu hari penuh minimal), runner harus dirawat, dan iOS tetap butuh mesin macOS.
- **Expo Updates (OTA)** — kirim perbaikan JavaScript tanpa rilis ke store, mirip Capacitor Live Updates/Appflow yang mungkin sudah kamu kenal. Harganya penting untuk dipahami: **hanya JS**. Perubahan apa pun pada native (menambah plugin, mengubah permission, upgrade SDK) tetap butuh build baru — jadi OTA memberi kecepatan untuk perbaikan bug logika, bukan untuk fitur.
- **`eas submit` otomatis ke Play track** — sengaja ditunda di repo ini; rencananya ada di `PLAY-AUTO-SUBMIT-TODO.md`. Butuh service account Google Cloud dan akses Play Developer API.

**Latihan:** Ini juga capstone kedua, jadi kerjakan serius. Jalankan `eas build --profile development --platform android`, pasang hasilnya di HP. **Verifikasi:** buka layar Payment Methods di dev build **dan** di Expo Go pada bangunan JS yang sama. Tombol "Add card with Stripe" harus muncul di satu dan tidak di yang lain (dengan `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` terisi). Screenshot keduanya. Lalu baca `android-build.yml:74` dan jelaskan baris demi baris apa yang dilakukan `jq -r '.[0].artifacts.applicationArchiveUrl // .artifacts.applicationArchiveUrl // empty'` dan kenapa ada dua path fallback.

---

### 4.19 Alternatif yang dibandingkan — dan kapan Ionic sebenarnya PILIHAN YANG BENAR

Bagian terakhir ini adalah yang paling penting untuk karirmu dan paling sedikit dibahas di tutorial mana pun. Kamu baru menghabiskan dua setengah minggu belajar React Native. Godaan untuk menyimpulkan "RN lebih baik dari Ionic" akan besar. Jangan.

**React Native CLI (bare) vs Expo.** Bare memberi kontrol penuh: folder native di-commit, library native apa pun boleh, debug native langsung. Expo memberi kecepatan: upgrade satu baris, config plugin menggantikan edit Gradle, EAS mengurus keystore. Titik keputusannya konkret: **kalau kamu butuh library native yang tidak punya config plugin dan tidak bisa kamu tulis sendiri, kamu butuh bare** (atau setidaknya prebuild + patch). Untuk Drovery — yang butuh peta, kamera, lokasi, notifikasi, dan Stripe, semuanya punya dukungan Expo resmi — Expo menang telak untuk proyek satu orang (`README.md:9`).

**Flutter.** Performa UI-nya sangat baik dan konsisten lintas platform karena ia menggambar sendiri semua pixel, jadi tidak ada masalah "berbeda di Android vs iOS". Tooling-nya (hot reload, DevTools) sering lebih matang. Harganya untukmu spesifik dan besar: **membuang seluruh keahlian React dan TypeScript yang kamu punya.** Dart adalah bahasa baru, ekosistem paket berbeda, dan tidak ada kode yang bisa dibagi dengan `Drovery_Admin` (React) atau kalau nanti kamu buat versi web. Kalau kamu memulai karir dari nol hari ini, Flutter layak dipertimbangkan. Dengan latar belakangmu, biaya switching-nya sulit dibenarkan.

**NativeScript.** Memberimu akses langsung ke API native dari JavaScript tanpa bridge (kamu bisa memanggil `android.widget.Toast` dari TS). Menarik secara teknis. Harganya sangat nyata: ekosistem dan komunitasnya jauh lebih kecil, sehingga saat kamu menemui masalah, jawabannya sering belum ada di internet. Untuk proyek produksi, ukuran komunitas adalah fitur.

**Dan sekarang bagian yang jujur: kapan Ionic + Capacitor adalah PILIHAN YANG BENAR.**

Ionic menang, dan menang telak, dalam situasi berikut:

1. **Kamu butuh web dan mobile dari satu codebase yang benar-benar sama.** Bukan "berbagi logika", tapi berbagi UI. `react-native-web` ada, tapi ia selalu satu langkah di belakang dan kamu akan menemui komponen yang tidak bekerja. Di Ionic, web adalah target kelas satu.
2. **Aplikasimu sebagian besar adalah form, daftar, dan tampilan data.** CRM internal, dashboard, aplikasi pendataan lapangan. Di sana WebView tidak terasa, dan CSS + komponen Ionic membuatmu jauh lebih cepat daripada menulis `StyleSheet` per komponen.
3. **Timmu sudah menguasai CSS dan tidak punya waktu belajar model layout baru.** Kecepatan tim adalah faktor teknis yang sah.
4. **Kamu butuh mengirim perbaikan tanpa rilis store.** Live Updates/Appflow di Capacitor lebih matang dan lebih mudah dari OTA di Expo untuk banyak tim.
5. **Kamu butuh kontrol penuh atas proyek native tanpa lapisan generator.** Folder `android/` yang di-commit adalah fitur, bukan bug, kalau kamu memang perlu mengedit Gradle.

Drovery bukan salah satu dari kelima situasi itu. Ia butuh peta live dengan marker bergerak (poin 2 gugur), tidak butuh versi web (poin 1 gugur), dan dikerjakan satu orang yang memang mau belajar (poin 3 gugur). Jadi RN adalah pilihan yang benar **di sini** — dan itu berbeda dari "RN lebih baik".

**Anchor:**
- `Drovery_Mobile/README.md:9` — *"personal project by Sena Fathoni"*; konteks satu orang inilah yang membuat managed workflow + EAS masuk akal (tidak ada tim yang mengurus infrastruktur build).
- `Drovery_Mobile/README.md:21-37` — daftar fitur. Baca ulang dengan pertanyaan: fitur mana yang **memaksa** native? Jawabannya: `react-native-maps` untuk tracking realtime (`:23`), kamera untuk QR handoff (`:24`) dan proof of delivery (`:25`), dan Stripe PaymentSheet native (`:30`).
- `Drovery_Mobile/package.json:16-51` — daftar dependensi. Hitung berapa yang butuh native module; itu ukuran seberapa "native" aplikasi ini sebenarnya.

**Kenapa dipakai di sini:** Kemampuan menjelaskan **kapan tidak memakai** sebuah teknologi adalah tanda kamu benar-benar memahaminya. Di wawancara kerja, "saya pilih RN karena lebih cepat" adalah jawaban lemah; "saya pilih RN karena peta live dengan marker per-4-detik akan drop frame di WebView, dan saya tidak butuh target web" adalah jawaban yang mengubah percakapan.

**Alternatif:** (di sini alternatifnya adalah cara membandingkan itu sendiri)
- **Membandingkan berdasarkan benchmark** — angka FPS dan waktu startup dari artikel benchmark. Harganya: benchmark selalu mengukur aplikasi sintetis, dan hampir tidak pernah mengukur hal yang membuat aplikasimu lambat (biasanya: daftar tanpa virtualisasi, gambar tanpa resize, atau JSON besar di JS thread).
- **Membandingkan berdasarkan daftar fitur framework** — tabel "punya X? punya Y?". Harganya: setiap framework modern punya semua kotak tercentang; yang berbeda adalah **berapa lama** sampai kamu bisa memakainya dan apa yang rusak saat upgrade.
- **Membandingkan berdasarkan constraint proyek** (yang dipakai di atas) — pertanyaannya: fitur mana yang memaksa native, apakah web adalah target, siapa yang merawat build. Harganya: butuh kejujuran tentang proyekmu sendiri, yang lebih sulit dari membaca benchmark.

**Latihan:** Ini capstone ketiga. Tulis dokumen satu halaman "Ionic → React Native" berisi tabel padanan yang kamu susun **sendiri** (bukan disalin dari sini): `Preferences` → `SecureStore`, `IonRouterOutlet` → `expo-router` `_layout.tsx`, plugin → Expo module, `npx cap sync` → prebuild/dev build, dan seterusnya. **Verifikasi:** tabelmu harus punya **kolom keempat** berjudul "Tidak ada padanannya" — dan kolom itu harus terisi minimal tiga baris. Kalau kolom itu kosong, kamu belum selesai membaca fase ini.

---

## Capstone

Tiga bukti. Semuanya bisa gagal di depan mata, dan itu memang tujuannya.

**Bukti 1 — Satu layar baru buatan sendiri.**

- [ ] Ada satu screen baru di `Drovery_Mobile/features/<fitur>/screens/` dengan route wrapper tipis di `app/`, mengikuti pola `app/login.tsx:1` atau `app/track-on-map.tsx:1-5`.
- [ ] Screen itu memanggil endpoint yang **kamu** buat di Fase 3, lewat `deliveryApi`-style service di `features/<fitur>/services/` dan hook `features/<fitur>/hooks/`.
- [ ] Punya tiga keadaan yang terlihat berbeda: **loading**, **error** (dengan tombol coba lagi), dan **empty**. Buktikan ketiganya dengan mematikan backend, mengembalikan array kosong, dan menjalankan normal.
- [ ] `StyleSheet` tanpa satu pun nilai hardcoded yang mengasumsikan ukuran layar. Ini bisa gagal di depan mata: jalankan di emulator dengan resolusi berbeda (misalnya Pixel 4a dan Pixel Tablet). Kalau ada yang terpotong atau melebar, kamu punya nilai hardcoded.
- [ ] Aman di notch: memakai `useSafeAreaInsets()` seperti `TrackOnMapScreen.tsx:27` + `:193`. Uji di emulator ber-notch — konten teratas tidak boleh tertutup status bar.
- [ ] Tombol back hardware Android berperilaku benar, dan handler-nya (kalau ada) memakai `useFocusEffect`, bukan `useEffect`. Buktikan: pindah ke screen lain, tekan Back, dan pastikan handler-mu tidak ikut jalan.

**Bukti 2 — Dev build di HP fisik.**

- [ ] `eas build --profile development --platform android` selesai, artefaknya terpasang di HP.
- [ ] Screenshot **berpasangan**: satu fitur native (Google Maps ATAU Stripe PaymentSheet) berjalan di dev build, dan **gagal senyap** di Expo Go pada bundle JS yang sama. Untuk Stripe: tombol dari `StripeAddCard.tsx:83` muncul di satu, hilang di yang lain. Untuk Maps: peta terisi di satu, abu-abu di yang lain.
- [ ] Satu paragraf: apa yang muncul di log saat gagal? (Jawaban yang benar: tidak ada apa-apa. Itulah intinya.)

**Bukti 3 — Dokumen "Ionic → React Native".**

- [ ] Satu halaman, tabel empat kolom: konsep Ionic/Capacitor · padanan RN/Expo · apa yang berubah secara **jaminan** (bukan hanya API) · **apa yang tidak ada padanannya**.
- [ ] Minimal 8 baris di tiga kolom pertama.
- [ ] Minimal 3 baris di kolom keempat. Kandidat jujur: CSS cascade dan media query, `env(safe-area-inset-*)`, dan "aplikasi native sungguhan di setiap `sync`" (Expo Go tidak punya padanannya di Capacitor).

---

## Gerbang keluar

Kalau kamu belum bisa menjawab ini tanpa membuka kode, **jangan** lanjut ke Fase 5. Fase 5 mengasumsikan kamu sudah nyaman dengan gagasan "beberapa penulis, satu keadaan, siapa yang berhak menang".

**1. Kenapa `""` (route index) sengaja TIDAK dimasukkan ke `PUBLIC_SEGMENTS`, dan apa yang terjadi kalau dimasukkan?**

<details><summary>Jawaban</summary>

`app/index.tsx` hanya merender spinner dan berfungsi sebagai target redirect murni. Kalau `""` ditandai publik, cold start dalam keadaan logout mendarat di `""`, gate melihat "ini publik, tidak ada yang perlu dipindahkan", dan user menatap spinner selamanya dengan `/login` tak terjangkau. Dengan `""` dibiarkan di luar daftar, index selalu jatuh ke salah satu cabang: `router.replace("/login")` kalau tidak ter-autentikasi, atau `router.replace("/(tabs)")` kalau ter-autentikasi (karena `""` ada di `AUTH_ONLY_SEGMENTS`). Lihat `app/_layout.tsx:13-17` dan `:27`.
</details>

**2. Sebuah request `POST /deliveries/:id/confirm-handoff` mengembalikan 401 karena kode 6 digitnya salah. Tanpa `noAuthRetry`, apa yang terjadi pada user — langkah demi langkah?**

<details><summary>Jawaban</summary>

`apiClient` melihat 401 dan menganggapnya sesi kedaluwarsa → memicu `refreshAccessToken()` → refresh mungkin sukses (tokennya memang masih valid) → retry request → 401 lagi (kodenya tetap salah) → refresh lagi... atau, kalau refresh gagal, `clearTokens()` + `onLogout?.()` dipanggil → `AuthContext` membersihkan state → `AuthGate` melihat `isAuthenticated: false` dan melempar user ke `/login`. Hasil akhirnya: **user terlempar keluar dari aplikasi karena salah ketik satu digit.** `noAuthRetry: true` (`deliveryApi.ts:22-31`) membuat 401 langsung dilempar sebagai `ApiError` supaya screen bisa menampilkan "kode salah".
</details>

**3. Apa perbedaan `let active` di dalam efek `useDeliveryTracking` dengan `mountedRef`, dan kenapa `mountedRef` saja tidak cukup?**

<details><summary>Jawaban</summary>

`mountedRef` di-share antar effect run. Kalau efek di-teardown lalu efek baru mount (misalnya `id` berubah), `mountedRef.current` sudah `true` lagi — jadi sebuah callback lama yang masih menggantung akan mengira dirinya masih valid dan bisa "membangkitkan" socket untuk delivery yang lama. `let active` di-capture segar per effect run dan di-flip `false` di cleanup **run itu sendiri**, sehingga callback bisa membedakan "instance efekku sudah dibongkar" dari "ada instance yang lebih baru terpasang". Lihat komentar di `useDeliveryTracking.ts:184-188`.
</details>

**4. Kenapa `mergeTrackingUpdate` memakai `if (u.droneLat !== undefined)` dan bukan `if (u.droneLat)`? Beri contoh koordinat yang rusak.**

<details><summary>Jawaban</summary>

Karena `0` adalah koordinat yang sah (khatulistiwa) dan falsy, jadi `if (u.droneLat)` akan membuangnya. Contoh yang rusak: latitude `0` (Pontianak persis di khatulistiwa) akan hilang. Nilai negatif seperti `-6.903` (Jakarta) sebenarnya truthy jadi tidak rusak, tapi aturan `!== undefined` adalah satu-satunya yang benar untuk semua angka. Lihat komentar di `deliveryTrackingMerge.ts:42`.
</details>

**5. Kenapa WebSocket di klien ini mengirim token lewat query param `?token=` dan bukan header `Authorization: Bearer`?**

<details><summary>Jawaban</summary>

Karena API `WebSocket` di browser dan React Native **tidak mengizinkan** header kustom saat handshake — kamu hanya bisa memberi URL dan subprotocol. Jadi satu-satunya tempat menaruh kredensial adalah query string (atau subprotocol, yang lebih jarang dipakai). Lihat `trackingSocket.ts:221`. Konsekuensinya: URL socket bisa muncul di log proxy, jadi token harus berumur pendek — dan itu alasan tambahan kenapa jalur refresh di `onAuthFailed` ada.
</details>

**6. Kenapa socket tracking connect ke `ws://host:port/` dan bukan `ws://host:port/api/v1`?**

<details><summary>Jawaban</summary>

Karena `setGlobalPrefix` di NestJS hanya berlaku untuk route HTTP; gateway WebSocket menempel langsung ke server HTTP yang sama di root. Lihat `Drovery_Backend/src/main.ts:36` (`useWebSocketAdapter(new WsAdapter(app))`) dan `:40` (`setGlobalPrefix(prefix)`), dan komentar yang menjelaskannya dari sisi klien di `Drovery_Mobile/services/api/wsUrl.ts:3-6`.
</details>

**7. Kamu menjalankan app di Expo Go, membuka layar Payment Methods, dan tombol "Add card with Stripe" tidak ada. Sebutkan dua penyebab yang mungkin dan cara membedakannya.**

<details><summary>Jawaban</summary>

Penyebab (a): `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` kosong, sehingga `StripeAddCard.tsx:83` mengembalikan `null`. Penyebab (b): key terisi tapi kamu di Expo Go, di mana native module `@stripe/stripe-react-native` tidak ada. Cara membedakan: tambahkan `console.log(ENV.STRIPE_PUBLISHABLE_KEY)` — kalau kosong, itu (a) dan solusinya isi `.env` **lalu restart dev server** (nilainya di-inline saat bundling). Kalau terisi dan tombol tetap tidak muncul, itu (b) dan solusinya dev build.
</details>

**8. Tab screen di Expo Router tidak pernah unmount. Sebutkan satu bug nyata yang lahir dari fakta itu dan bagaimana ia diperbaiki.**

<details><summary>Jawaban</summary>

Handler `BackHandler` "tekan back dua kali untuk keluar" dipasang di `HomeScreen` dengan `useEffect`. Karena tab screen tidak unmount, handler itu tetap terdaftar seumur sesi dan menelan Back di **setiap** screen lain — termasuk saat form Create Delivery sedang terisi setengah. Perbaikannya bukan mengubah logika tapi mengubah scope: `useEffect` → `useFocusEffect`, yang membersihkan handler saat screen kehilangan fokus. Lihat `HomeScreen.tsx:73-99` dan kasus negatifnya di `ProfileScreen.tsx:56-58`.
</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| "Network error. Please check your connection." di setiap request, padahal backend jalan | Host salah untuk targetmu. Android emulator butuh `10.0.2.2`, bukan `localhost`; HP fisik butuh IP LAN mesinmu | Buka `config/env.ts:12-15` dan cocokkan dengan targetmu. Lalu dari HP/emulator, buka browser dan akses `http://<host>:3000/api/v1/health` — kalau browser saja tidak bisa, masalahnya jaringan, bukan kode |
| Sudah ganti `.env` tapi app tetap pakai nilai lama | `EXPO_PUBLIC_*` di-inline **saat bundling**, bukan dibaca runtime | Restart dev server (bukan sekadar reload app). `README.md:163` menyebutnya sebagai caveat. Kalau masih sama, `npx expo start --clear` untuk membuang cache Metro |
| Peta tampil abu-abu polos di HP, tanpa error apa pun | `app.json:26` masih `YOUR_GOOGLE_MAPS_API_KEY` | Ini kegagalan **senyap** — jangan cari di log, tidak ada. Buka `app.json:24-28` dan periksa nilainya. `README.md:156` dan `:160` memperingatkannya |
| Tombol "Add card with Stripe" tidak muncul | Salah satu dari dua: key kosong, atau kamu di Expo Go | Lihat gerbang keluar #7. `StripeAddCard.tsx:83` mengembalikan `null` diam-diam, itu **desain**, bukan bug |
| `SyntaxError: Cannot use import statement outside a module` saat `npm test` | Paket RN/Expo baru belum masuk daftar-putih `transformIgnorePatterns` | Buka `jest.config.js:7-9` dan tambahkan nama paketnya ke regex. Ini akan terjadi lagi setiap kali kamu menambah dependensi RN |
| Test hook tracking menggantung atau timeout | Backoff `setTimeout` menunggu waktu nyata | Pasang `jest.useFakeTimers()` dan majukan waktu manual. Lihat pola di `__tests__/services/api/trackingSocket.test.ts:7-38` |
| Fetch berjalan terus-menerus, request 4G habis, HP panas | Dependency array `useCallback` memakai **objek**, bukan field-fieldnya | Bandingkan dengan `useDeliveries.ts:26` yang memakai `params.status, params.q, ...`. Kalau kamu menemukan `[params]`, itu dia |
| Tekan Back di form Create Delivery malah keluar dari app | Handler `BackHandler` dipasang dengan `useEffect` di tab screen, yang tidak pernah unmount | Lihat `HomeScreen.tsx:73-78`. Ganti `useEffect` → `useFocusEffect` dan buktikan dengan `console.log` di cleanup |
| Notifikasi tidak muncul di Android, tanpa error | Notification channel belum dibuat (wajib sejak Android 8) | Periksa `push.ts:36-41`. Tanpa `setNotificationChannelAsync`, notifikasi hilang total tanpa jejak |
| Konten teratas tertutup status bar / notch | Lupa `useSafeAreaInsets()`; di RN tidak ada `env(safe-area-inset-top)` seperti Ionic | Bandingkan dengan `TrackOnMapScreen.tsx:27` + `:193` dan `QRScannerScreen.tsx:77` |
| Kartu terlihat punya bayangan di iOS tapi datar di Android | Hanya menulis properti `shadow*`, lupa `elevation` | Bandingkan dengan `styles/common.ts:106-116` yang menulis kedua set sekaligus |
| Animasi pulse tersendat saat data tracking masuk | Animasi berjalan di JS thread yang sedang sibuk | Periksa `useNativeDriver`. Aturannya: `true` hanya untuk `transform` dan `opacity` (`TrackOnMapScreen.tsx:116`, `:121`); apa pun selain itu terpaksa JS driver (`:74`) |
| Data delivery lama tiba-tiba menimpa data delivery yang baru dibuka | Respons async yang menyeberangi pergantian `id` | Ini persis yang dijaga `idRef` (`useDeliveryTracking.ts:57-60`) dan `reconcileSeqRef` (`:151`, `:154`). Kalau kamu menulis hook serupa, tiru polanya |

Satu catatan tentang bagian tersulit fase ini. `useDeliveryTracking.ts` **akan** membuatmu merasa bodoh pada bacaan pertama, dan itu bukan tanda ada yang salah denganmu. File itu adalah hasil beberapa putaran perbaikan bug, dan setiap ref di sana adalah batu nisan sebuah bug. Kamu sedang membaca kesimpulan tanpa pernah melihat prosesnya. Cara satu-satunya mengubahnya jadi pemahaman adalah merusak satu hal dan melihat test mana yang mati — itulah kenapa latihannya berbentuk begitu, dan kenapa itu juga bentuk latihan yang akan kamu pakai di Fase 5.

---

## Bacaan pendamping

Semuanya file di repo, dan semuanya berisi **kenapa**, bukan **bagaimana**.

- `Drovery_Mobile/app/_layout.tsx:8-42` — dua bug navigasi/auth yang digabung jadi satu mekanisme. Cari kalimat *"when auth state and the current route disagree, the route moves"* dan pahami kenapa itu satu aturan, bukan dua.
- `Drovery_Mobile/services/api/wsUrl.ts:1-11` — cara menulis komentar yang menyimpan pengetahuan lintas repo. Cari: apa yang tidak bisa kamu ketahui dari sisi mobile saja?
- `Drovery_Mobile/features/delivery/services/handoffCodeStore.ts:3-16` — trade-off keamanan yang ditulis terbuka. Cari bagian *"Security trade-off (accepted)"* dan perhatikan bahwa penulisnya menyebutkan mitigasi di sisi backend, bukan hanya di sisi klien.
- `Drovery_Mobile/features/home/screens/HomeScreen/HomeScreen.tsx:73-78` — satu paragraf yang menjelaskan bug yang penyebabnya adalah asumsi tentang siklus hidup, bukan logika.
- `Drovery_Mobile/features/delivery/hooks/useDeliveryTracking.ts:35-66` — doc-comment strategi plus alasan setiap ref. Baca dua kali: sekali sebelum membaca kodenya, sekali sesudah.
- `Drovery_Mobile/features/delivery/services/deliveryTrackingMerge.ts:16-26` — Rule 0. Cari: kenapa "mengarang objek parsial" adalah dosa yang lebih besar dari "membuang satu frame"?
- `Drovery_Mobile/config/env.ts:1-16` — komentar header yang menjelaskan mekanisme inline dan tiga host per target. Ini akan menghemat satu sore hidupmu.
- `Drovery_Mobile/README.md:158-163` — bagian Caveats. Empat baris, dan tiga di antaranya adalah kegagalan senyap.
- `Drovery_Mobile/.github/workflows/android-build.yml:3-21` — komentar header yang menjelaskan kenapa CI-nya manual dan apa saja setup sekali-jalannya. Contoh bagus tentang kendala ekonomi yang membentuk desain teknis.

Untuk hal yang memang perlu dokumentasi resmi (dan hanya ini):

- [Expo — Environment variables](https://docs.expo.dev/guides/environment-variables/) — dirujuk langsung oleh `config/env.ts:7`. Baca bagian tentang kapan nilai di-inline.
- [Expo — Development builds](https://docs.expo.dev/develop/development-builds/introduction/) — untuk memahami batas Expo Go sebelum kamu menghabiskan sore mencari bug yang tidak ada.
- [React Native — Animations & `useNativeDriver`](https://reactnative.dev/docs/animations) — khusus bagian tentang properti mana yang bisa dijalankan native driver.

**Catatan maju:** konsep "kontrak wire-format lintas repo" (format tanggal `YYYY-MM-DD`, `Record<DeliveryStatus, …>` sebagai pengaman drift, satu formatter mata uang) sengaja **tidak** dibahas tuntas di fase ini — ia milik Fase 12, di mana kamu mengirim fitur nyata di tiga repo sekaligus. Tapi kalau kamu penasaran sekarang, dua file ini adalah bacaan paling instruktif di seluruh repo mobile: `Drovery_Mobile/features/delivery/utils/pickupDateTime.ts:1-17` (bug penjadwalan yang membuat setiap delivery terjadwal diam-diam terbang seketika) dan `Drovery_Mobile/utils/currency.ts:1-11` (empat formatter mata uang, dua di antaranya di layar yang sama).
</content>
</invoke>

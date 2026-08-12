# Fase 2 — Pipeline dan identitas: apa yang terjadi sebelum controller dipanggil

> **Durasi** ~2 minggu (~24 jam) · **Mode** dari nol (sandbox `learn-nest/`) · **Repo** `learn-nest/` (kamu tulis sendiri) + `Drovery_Backend/` (hanya dibaca)

> **Catatan anchor.** Semua rujukan `file.ts:123` di dokumen ini menunjuk ke keadaan repo pada tag git
> `curriculum-baseline`. Kalau kamu sudah terlanjur mengubah repo, `git show curriculum-baseline:src/main.ts`
> memberi kamu versi yang dirujuk di sini tanpa harus mengembalikan working tree.

---

## Kenapa fase ini ada di sini

Di Fase 1 kamu sudah punya irisan yang jalan: `POST /notes` masuk ke tabel, `GET /notes` keluar lagi, dan
halaman React kecil menampilkannya. Tapi irisan itu **telanjang**. Setiap route terbuka untuk siapa pun. Kalau
service melempar error, klien menerima stack trace. Bentuk respons sukses ditentukan oleh apa pun yang kebetulan
kamu `return` di controller. Tidak ada satu tempat pun yang tahu knob konfigurasi apa saja yang ada di aplikasi
ini. Semua itu bukan kekurangan Fase 1 — itu memang batas yang sengaja dipasang supaya kamu bisa melihat hasil
dalam 1,5 minggu. Fase 2 adalah tagihannya.

Alasan fase ini berada **tepat** di sini, bukan sesudah Fase 3, adalah soal urutan membaca. Fase 3 memindahkan
kamu ke `Drovery_Backend` yang asli. Hal pertama yang harus kamu baca di sana adalah `src/app.module.ts`: 22
feature module, empat provider infrastruktur, tiga guard global yang urutannya menentukan apakah aplikasi aman
atau tidak, dan satu exception filter yang didaftarkan lewat token aneh bernama `APP_FILTER`. Kalau kamu belum
pernah menulis guard sendiri, file itu terbaca sebagai mantra: sekumpulan objek `{ provide, useClass }` yang
"harus ada". Kalau kamu sudah pernah menulisnya, file yang sama terbaca sebagai **daftar keputusan** — dan setiap
barisnya punya alternatif yang bisa kamu perdebatkan. Itu bedanya membaca peta kota setelah pernah berjalan kaki
dan membacanya sebelum pernah.

Yang mustahil dipahami tanpa fase ini bukan cuma `app.module.ts`. Di Fase 5 kamu akan membaca
`throw new AppConflictException('error.delivery.cancel.bad_status', { status, allowed })` di tengah logika uang —
tanpa Fase 2, kalimat itu tidak masuk akal: kenapa service melempar *string aneh* dan bukan pesan untuk manusia?
Di Fase 7 kamu bertemu gerbang yang sengaja *fail-closed*, dan pola "gagal boot daripada gagal terbuka" yang jadi
dasarnya pertama kali muncul di `src/config/validation.ts` yang kamu tulis ulang minggu ini.

Ada bonus khusus untuk kamu sebagai developer mobile: sisi klien dari kontrak yang dibangun fase ini **sudah
pernah kamu pakai**. `Drovery_Mobile/services/api/apiClient.ts:126` (`json.data !== undefined ? json.data : json`)
adalah pasangan dari `TransformInterceptor` yang kamu tulis minggu pertama, dan `apiClient.ts:93-113`
(single-flight refresh saat 401) adalah pasangan dari rotasi refresh token yang kamu tulis minggu kedua. Selama
ini kamu menulis separuh kontrak; fase ini kamu menulis separuh yang lain.

Ini fase **terakhir** di sandbox. Setelah ini semuanya di repo asli.

---

## Gerbang masuk

Kamu siap masuk Fase 2 kalau kamu bisa melakukan hal-hal ini **sekarang, tanpa membuka catatan**:

- [ ] Membuat module + controller baru di `learn-nest/`, menjalankannya, dan menjelaskan kenapa route-nya 404
      sebelum module itu masuk ke array `imports` — bukan menghafal, tapi bisa memperagakan 404 → 200.
- [ ] Menyuntikkan sebuah service ke service lain lewat constructor **tanpa satu pun `new`**, dan menjelaskan
      dari mana Nest tahu tipe parameter constructor itu saat runtime.
- [ ] Menulis satu spec Jest yang mengganti Prisma dengan objek palsu (`{ note: { findMany: jest.fn() } }`) dan
      lulus **tanpa database hidup**.
- [ ] Membuat satu DTO dengan `class-validator`, dan membuktikan lewat `curl -i` bahwa body yang salah
      menghasilkan 400 — termasuk membaca body error-nya.
- [ ] Menjalankan `learn-nest/` dengan Postgres yang hidup (Docker atau Neon/Supabase dari jalur cadangan Fase 0)
      dan menjalankan satu `prisma migrate dev` dari nol.
- [ ] Membaca output `curl -i` dan menunjuk mana status line, mana header, mana body — karena hampir semua
      verifikasi di fase ini bentuknya begitu.

Kalau salah satu butir di atas masih ragu, ulangi latihan Fase 1 yang bersangkutan dulu. Fase 2 menumpuk enam
lapis di atas fondasi itu; fondasi yang goyang akan terasa seperti "NestJS itu sihir" sepanjang dua minggu.

---

## Peta jalan mingguan

Total ~24 jam. Pembagiannya sengaja tidak rata: minggu pertama membangun **pipa**, minggu kedua membangun
**identitas**, dan identitas selalu makan waktu lebih banyak daripada dugaan.

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| 1 (paruh awal) | Custom provider + `@Global()`, `ConfigModule` + `validate()` fail-fast | 6 | `NODE_ENV=production JWT_SECRET=change-me npm start` **mati sebelum listen**; satu provider `CLOCK` yang bisa dibekukan di test |
| 1 (paruh akhir) | `ValidationPipe` sebagai trust boundary, `TransformInterceptor`, `APP_FILTER` + exception ber-key, i18n | 6 | Semua sukses berbentuk `{success,data,timestamp}`; semua error berbentuk datar; `Accept-Language: id` mengubah kalimat error, `en` tidak |
| 2 (paruh awal) | Guard global + urutan `APP_GUARD`, `Reflector`, `@Public()`/`@Roles()` | 7 | `curl` ke route mana pun tanpa token → 401; hanya route ber-`@Public()` yang lolos; urutan tiga guard terlihat di terminal |
| 2 (paruh akhir) | Passport JWT, bcrypt, signup/login/refresh, Swagger + `@PublicApi()`, `demo.sh` | 5 | signup → login → refresh jalan, token lama ditolak; `/docs` menampilkan gembok hanya pada route terproteksi; satu skrip yang membuktikan semuanya sekaligus |

Sarannya: kerjakan `demo.sh` **secara inkremental sejak hari pertama**, satu blok per konsep. Kalau ditinggal ke
akhir, ia berubah jadi tugas administratif yang membosankan; kalau tumbuh bersama kode, ia jadi alat kerja yang
kamu pakai setiap kali mengubah sesuatu.

---

## Konsep

### 2.1 Custom provider: `useFactory` / `useValue` / `useClass` / injection token, dan `@Global()`

Di Fase 1 kamu memakai bentuk DI yang paling sederhana: `providers: [NotesService]`. Nest melihat class-nya,
membaca tipe parameter constructor-nya, membuat instance, selesai. Pertanyaan yang belum terjawab: bagaimana
kalau yang mau kamu suntikkan **bukan class buatanmu**? Koneksi `ioredis`, misalnya. Kamu tidak bisa menulis
`providers: [Redis]` — Nest tidak tahu argumen apa yang harus dilempar ke constructor-nya.

Padanan yang jujur dari duniamu adalah **React Context**. `@Global()` module kira-kira seperti memasang
`<ThemeProvider>` di root sehingga tidak ada komponen anak yang perlu meng-import apa pun. Yang berbeda — dan
bedanya penting — adalah **kapan** resolusi terjadi dan apa akibat kalau gagal. Context React diselesaikan saat
render berdasarkan posisi di pohon, dan provider yang lupa dipasang memberi `undefined` yang diam-diam merusak
layar. DI Nest diselesaikan **sekali saat boot** berdasarkan graph module, dan provider yang tidak ketemu membuat
**aplikasi menolak menyala** dengan pesan yang menyebut nama class dan posisi parameternya. Keras dan cepat,
bukan `undefined` jam tiga pagi.

Ada empat bentuk provider. **`useFactory`** dipakai saat konfigurasinya baru diketahui runtime — contoh
terbaiknya `src/cache/cache.module.ts:14-31`, objek `{ provide, inject, useFactory }` yang meminta
`ConfigService` lalu membangun `new Redis({...})`. **`useClass`** dipakai untuk semua guard dan filter global
(`src/app.module.ts:180-199`); bedanya, Nest yang meng-instantiate **dan** menyuntikkan dependency-nya
(`RolesGuard` butuh `Reflector` + `PrismaService`, keduanya datang otomatis). **`useValue`** untuk konstanta
atau objek yang sudah jadi — bentuk yang akan kamu pakai di latihan. **`useExisting`** adalah alias ke provider
lain (dua nama, satu instance); tidak dipakai di repo ini.

Yang paling sering bikin bingung adalah **injection token**. Di `cache.module.ts:15` providernya bukan
`provide: Redis` melainkan `provide: REDIS_CLIENT` — sebuah simbol/string. Kenapa? Karena satu proses Drovery
punya **beberapa** koneksi Redis dengan peran berbeda: throttler (`app.module.ts:64`), BullMQ
(`app.module.ts:130`), cache (`cache.module.ts:19`), dan nanti pub/sub. `configuration.ts:69-72` bahkan
menyediakan override endpoint per peran. Tipe `Redis` saja tidak cukup untuk membedakan keempatnya, jadi
identitasnya harus berupa token yang kamu pilih sendiri.

**Anchor:**
- `src/cache/cache.module.ts:14-31` — provider `useFactory` lengkap dengan token custom. Baca komentar baris 25:
  *"Without a listener, ioredis 'error' events would crash the process."* Alasan yang tidak akan kamu temukan di
  dokumentasi NestJS mana pun.
- `src/prisma/prisma.module.ts:1-9` — `@Global()` dalam 9 baris; bentuk terkecil yang bisa ada.
- `src/i18n/i18n.module.ts:5-10` — docblock yang menjelaskan kriteria `@Global()`.
- `src/users/users.module.ts:5-9` — array `imports` **kosong**, tapi `UsersService` (`users.service.ts:22-25`)
  meng-inject `PrismaService` **dan** `CacheService`. Ini bukti `@Global()` benar-benar bekerja.
- `src/cache/cache.module.ts:38-43` — module yang punya lifecycle sendiri (`onModuleDestroy` → `redis.quit()`),
  berpasangan dengan `app.enableShutdownHooks()` di `src/main.ts:76`.

**Kenapa dipakai di sini:** rasional `@Global()` ditulis eksplisit di `i18n.module.ts:5-10`:

> *"@Global so the single I18nService instance is available to every module — the request-side modules AND the
> worker's module graph — without each adding it to its imports."*

Perhatikan kriteria yang tersirat di situ dan konsisten di seluruh repo: `@Global()` dipakai untuk **leaf
infrastruktur stateless yang dibutuhkan hampir semua module** — database, cache, i18n, transport MQTT. Ia
**tidak** dipakai untuk feature module. `AuthModule` tetap mengekspor `AuthService` secara normal
(`auth.module.ts:15`), dan siapa pun yang mau memakainya harus meng-import `AuthModule`. Kalau semua ditandai
`@Global()`, graph module kehilangan seluruh nilainya dan kamu kembali ke import global biasa dengan langkah
tambahan.

**Alternatif:**

1. **Import singleton langsung** — `export const redis = new Redis(...)` lalu `import { redis }` di mana-mana.
   Nol boilerplate dan tidak ada konsep baru yang harus dipelajari. Trade-off konkret: kamu kehilangan dua hal
   yang bisa kamu ukur hari ini. Pertama, `roles.guard.spec.ts:17-21` menyuntikkan Prisma palsu lewat
   constructor — dengan import singleton, satu-satunya jalan adalah `jest.mock()` yang rapuh terhadap perubahan
   path. Kedua, `cache.module.ts:41-43` menutup koneksi saat shutdown; modul yang tidak dimiliki Nest tidak
   pernah dipanggil lifecycle hook-nya, jadi rolling deploy akan meninggalkan koneksi menggantung.
2. **Import module infrastruktur secara eksplisit di setiap feature module (tanpa `@Global()`)** — dependency
   setiap module terlihat jelas di file module itu sendiri, dan kamu bisa tahu "siapa pakai apa" tanpa mencari.
   Trade-off konkret: di Drovery itu berarti 22 feature module × 4 module infrastruktur = 88 baris `imports`
   yang tidak menambah informasi apa pun, dan seluruhnya harus diulang lagi di graph worker.
3. **`useValue` alih-alih `useFactory`** — lebih sederhana dan tidak ada fungsi yang jalan saat boot.
   Trade-off konkret: `useValue` dievaluasi saat file di-import, jadi ia **tidak bisa membaca `ConfigService`**.
   Untuk koneksi Redis yang host-nya datang dari env, itu diskualifikasi langsung.

**Latihan:** di `learn-nest/`, buat `src/common/clock.provider.ts`:

```ts
export const CLOCK = Symbol('CLOCK');
export interface Clock { now(): Date }
export const clockProvider = { provide: CLOCK, useValue: { now: () => new Date() } };
```

Daftarkan lewat sebuah `ClockModule` yang ditandai `@Global()`, lalu inject ke `NotesService` dengan
`@Inject(CLOCK) private readonly clock: Clock` dan pakai `this.clock.now()` menggantikan `new Date()`.

**Cara memverifikasi (tiga langkah, semuanya harus kamu lihat sendiri):**
1. Jalankan tanpa menambahkan apa pun ke `imports` milik `NotesModule` → tetap jalan. Itu efek `@Global()`.
2. Hapus `@Global()` dari `ClockModule` → boot gagal dengan `Nest can't resolve dependencies of the NotesService
   (?, ...)`. Tanda `?` menunjukkan posisi parameter yang gagal; hafalkan, kamu akan sering melihatnya.
3. Kembalikan `@Global()`, lalu tulis spec yang membuat
   `new NotesService(prismaPalsu, { now: () => new Date('2020-01-01') })` dan meng-assert tanggal tersimpan.
   Kamu bisa membekukan waktu **tanpa** `jest.useFakeTimers()`. Ini persis alasan token DI ada.

---

### 2.2 `ConfigModule` + `configuration()` + `validate()` yang menolak boot

Kamu sudah kenal env var dari sisi klien: `EXPO_PUBLIC_*`, `import.meta.env.VITE_*`. Polanya mirip, tapi taruhannya
berbeda secara kategoris, dan di sini **tidak ada padanan yang jujur** dari dunia frontend. Kalau env var di
aplikasi Ionic salah, satu pengguna melihat layar kosong dan mengeluh. Kalau `JWT_SECRET` di server masih bernilai
default, **setiap orang di internet bisa memalsukan token siapa pun** dan tidak ada yang mengeluh sama sekali —
karena dari luar semuanya tampak berjalan normal. Aplikasi klien tidak pernah punya alasan untuk menolak menyala.
Server punya.

Drovery memasang dua lapis, dan pembagian tugasnya rapi:

**Lapis 1 — `src/config/configuration.ts:23-146`** mengubah `process.env` (semuanya string, semuanya mungkin
`undefined`) menjadi satu objek bersarang yang typed dan sudah punya default: `jwt.expiresIn` default `'15m'`
(baris 42), `redis.tls` sudah boolean (baris 53). Efeknya di seluruh kode: yang tersebar adalah
`this.config.get<string>('jwt.secret')` (`auth.service.ts:413`), bukan `process.env.JWT_SECRET`. Satu file untuk
mengetahui **knob apa saja yang ada** — dan sekaligus tempat mendokumentasikan konsekuensinya (baca komentar
baris 33-37 tentang `poolMax` dan PgBouncer; itu jebakan autoscaling yang baru kamu temui di Fase 11, tapi
peringatannya sudah ditulis di sini).

**Lapis 2 — `src/config/validation.ts:21-78`** adalah bagian yang paling layak ditiru. Ini bukan sekadar "cek env
ada". Baris 33-42:

```ts
if (config.NODE_ENV === 'production') {
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const raw = config[key];
    const value = typeof raw === 'string' ? raw : '';
    if (value.length < 24 || /change|example|xxxx|placeholder/i.test(value)) {
      throw new Error(`${key} is weak or a placeholder — set a strong (>=24 char) secret in production`);
    }
  }
```

Ingat `configuration.ts:41` memberi default `'change-me'` untuk `JWT_SECRET`, dan `.env.example:21` berisi
`JWT_SECRET=change-me-to-a-random-secret`. Default itu **nyaman untuk dev dan bencana untuk produksi**. Validator
memastikan deploy produksi dengan secret default **gagal boot** — bukan jalan diam-diam dengan token yang bisa
dipalsukan siapa pun.

Pola yang sama dipakai dua kali lagi di file yang sama, dan dua-duanya menulis alasannya:

- `validation.ts:44-49` — `LOADTEST_BYPASS_THROTTLE` dilarang di produksi. Ini **sabuk pengaman kedua**; yang
  pertama ada di guard-nya sendiri, `src/common/guards/loadtest-throttle.guard.ts:19-25`
  (`process.env.NODE_ENV !== 'production'`). Docblock guard baris 13-15 menyebutnya: *"Hard-disabled in production
  two ways … The flag can never weaken a real deploy."* Dua mekanisme independen untuk satu properti keamanan.
- `validation.ts:51-74` — key Stripe wajib ada di produksi, dengan alasan yang dieja panjang di komentar 51-60:
  `StripeService` punya jalur mock tanpa verifikasi signature kalau key tidak ada, jadi produksi tanpa key akan
  **fail open** dan menerima webhook palsu. Kalimat kuncinya: *"so we fail to BOOT instead of failing open"*.
  Perhatikan juga ada escape hatch yang eksplisit (`ALLOW_MOCK_PAYMENTS=true`) yang **mengubah** perilaku
  webhook jadi fail-closed — jadi escape hatch-nya tidak membuka lubang, ia menutupnya dengan cara lain.

**"Fail fast, jangan fail open"** adalah tema yang akan kamu temui berulang sampai Fase 11. Ini tempat pertama
kamu melihatnya, dan tempat paling murah untuk mempraktikkannya.

**Anchor:**
- `src/app.module.ts:51-55` — `ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate })`:
  tiga baris, tiga keputusan. `src/config/validation.ts:21-78` — fungsi yang bisa membunuh proses.
- `src/config/configuration.ts:40-45` — blok `jwt` dengan default `'change-me'`, target validator; `:27-29` —
  `corsOrigins` unset artinya wildcard (bahan latihan tambahan).
- `DEPLOY.md:37-42` — sisi operasionalnya: `openssl rand -hex 32` untuk menghasilkan secret yang lolos gerbang.

**Kenapa dipakai di sini:** `validate` dijalankan oleh `@nestjs/config` **saat modul di-load**, artinya sebelum
`app.listen()`. Melempar di dalamnya = proses mati sebelum satu request pun diterima. Bandingkan dengan
memeriksa secret di dalam `AuthService`: pemeriksaan itu baru jalan saat ada orang login, di container yang sudah
lolos health check dan sudah menerima trafik dari load balancer. Waktu deteksi adalah properti desain, bukan
detail.

**Alternatif:**

1. **`dotenv` + `process.env` langsung di tempat pakai** — nol setup, tidak ada file tambahan. Trade-off konkret:
   salah ketik nama variabel (`JWT_SECERT`) menghasilkan `undefined`, dan `undefined` biasanya berarti "pakai
   default" atau "fitur mati". Kamu menemukannya bukan saat deploy, tapi saat ada yang melapor. Di
   `configuration.ts` kesalahan ketik yang sama muncul sebagai satu field yang jelas-jelas kosong di satu file.
2. **Joi schema** (didukung `@nestjs/config` lewat opsi `validationSchema`) — DSL-nya lebih ringkas untuk
   validasi bentuk: `Joi.string().min(24).required()`. Trade-off konkret di repo ini ada dua. Pertama,
   `class-validator` **sudah** dipakai untuk semua DTO request (konsep 2.10), jadi memilih Joi berarti dua
   library validasi dengan dua model mental untuk satu masalah. Kedua, aturan bersyarat seperti "hanya di
   produksi, dan hanya kalau `ALLOW_MOCK_PAYMENTS` tidak di-set, tolak nilai yang cocok regex" bisa ditulis
   dengan `Joi.when()` tapi jadi rantai yang sulit dibaca; di `validation.ts:61-74` itu cuma `if` biasa yang
   siapa pun bisa baca.
3. **Secret manager (Vault / AWS Secrets Manager / Doppler)** — secret tidak pernah menyentuh env sama sekali,
   dan rotasi bisa dilakukan tanpa redeploy. Trade-off konkret: menambah dependency runtime pada jalur boot
   (kalau Vault down, aplikasimu tidak menyala) dan menambah latency startup — yang terasa saat autoscaler
   menambah pod. `DEPLOY.md:37-42` memilih env dari platform + validator ini sebagai jaring pengaman.

**Latihan:** di `learn-nest/`, buat `src/config/configuration.ts` dan `src/config/validation.ts` versi kecil:
`port`, `databaseUrl`, `jwt.secret` (default `'change-me'`), `jwt.expiresIn` (default `'15m'`). Validator wajib
menolak boot kalau `NODE_ENV === 'production'` dan `jwt.secret` lebih pendek dari 24 karakter atau mengandung
`change`.

**Cara memverifikasi:**
1. `NODE_ENV=production JWT_SECRET=change-me npm run start` → **proses mati**, pesan errornya menyebut nama
   variabelnya, dan `curl localhost:3000` gagal connect. Kalau kamu masih bisa `curl`, validatormu tidak
   terpasang di `ConfigModule.forRoot`. Lalu `JWT_SECRET=$(openssl rand -hex 32)` → jalan lagi.
2. Tulis `src/config/validation.spec.ts` yang memanggil `validate({...})` langsung dan meng-assert
   `expect(() => validate(env)).toThrow(/weak or a placeholder/)`. Test yang jalan tanpa boot apa pun.
3. Tugas tambahan: tolak boot produksi kalau `CORS_ORIGINS` tidak di-set. Petunjuk kenapa itu masuk akal ada di
   `configuration.ts:27-29` dan `main.ts:42-53` — unset artinya wildcard `*`.

---

### 2.3 `TransformInterceptor` + RxJS: middleware yang bekerja dua arah

Ini padanan yang paling mulus dari duniamu, jadi mari dipakai sepenuhnya. Kamu hampir pasti pernah menulis
`axios.interceptors.request.use(...)` dan `axios.interceptors.response.use(...)` — dua kait, satu di berangkat,
satu di pulang. Interceptor Nest adalah **kedua kait itu dalam satu objek**, dan yang memisahkan keduanya adalah
posisi kode relatif terhadap `.pipe()`:

```ts
intercept(_context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
  // ← apa pun yang kamu tulis DI SINI berjalan SEBELUM handler
  return next.handle().pipe(
    map((data) => ({ success: true, data, timestamp: new Date().toISOString() })),
    // ← operator di dalam pipe berjalan SETELAH handler selesai
  );
}
```

Satu hal yang bikin orang React tersandung: `next.handle()` **belum menjalankan handler-nya**. Ia mengembalikan
`Observable` — anggap seperti `Promise` yang bisa mengeluarkan lebih dari satu nilai dan bisa dibatalkan; handler
baru jalan ketika ada yang subscribe, dan yang subscribe adalah Nest sendiri. Untuk fase ini kamu hanya butuh
satu operator: `map`. Kalau kamu terjebak mencoba memahami RxJS secara utuh sekarang, berhenti — itu bukan
prasyarat, dan Drovery sendiri cuma memakai `map` di interceptor ini.

Efek praktisnya besar: di baseline ada **105 route handler di 23 controller**, semuanya mengembalikan objek biasa,
dan **semuanya** sampai ke klien sebagai `{ success, data, timestamp }`. Tidak ada satu pun controller yang
menyentuh `res.json()`. Itulah kenapa `apiClient` di aplikasi mobile bisa punya satu baris unwrap dan selesai.

Ada konsekuensi yang jujur harus disebut: envelope ini adalah modifikasi **runtime**, jadi dokumentasi OpenAPI
otomatis akan **berbohong** kalau tidak ikut diperbaiki (dibayar di `src/common/swagger.ts:85-131`, konsep 2.11).
Pola ini akan kamu lihat berkali-kali: *keputusan di satu lapis menciptakan hutang di lapis lain, dan hutang itu
harus dibayar eksplisit atau ia akan menagih diam-diam.*

**Anchor:**
- `src/common/interceptors/transform.interceptor.ts:20-31` — seluruh mekanismenya; file lengkapnya 32 baris.
- `src/main.ts:69` — `new TransformInterceptor()`. `new` boleh di sini karena interceptor-nya **tidak punya
  dependency**; bandingkan dengan filter di konsep 2.4 yang tidak boleh.
- `src/common/interceptors/transform.interceptor.spec.ts:27-36` — test khusus `data: null`; envelope tetap
  terbentuk.
- `Drovery_Mobile/services/api/apiClient.ts:119-126` — sisi klien dari kontrak yang sama.
- `INTEGRATION.md:56-74` — kontrak envelope sebagai dokumen lintas-repo, termasuk catatan bahwa error **tidak**
  dibungkus dan tidak ada `meta` pagination.

**Kenapa dipakai di sini:** karena konsumen API ini lebih dari satu jenis, dan sebagian bukan milikmu. Aplikasi
mobile Expo, admin console Vite, gateway drone, dan webhook Stripe. Envelope yang seragam berarti setiap klien
menulis satu fungsi unwrap, bukan satu per endpoint. Dan `TransformInterceptor` tanpa dependency berarti ia
bisa didaftarkan dengan `new` di `main.ts` — aturan praktis yang akan langsung kamu pakai di konsep berikutnya.

**Alternatif:**

1. **Tanpa envelope, kembalikan resource mentah** (gaya REST puritan; status code yang membawa makna). Payload
   lebih kecil dan lebih idiomatis HTTP. Trade-off konkret: klien harus membedakan sukses/gagal per-endpoint, dan
   `apiClient.ts:121-126` yang sekarang enam baris akan tumbuh jadi logika per-endpoint. Ditambah: karena error
   di Drovery tetap punya bentuk sendiri (`{statusCode, path, message}`), tanpa envelope sukses kamu jadi punya
   dua bentuk yang tidak simetris tanpa satu pun yang bisa dipakai untuk mendeteksi mana yang mana.
2. **Bungkus manual di setiap controller** — eksplisit, tidak ada "aksi jarak jauh", dan siapa pun yang membaca
   satu controller tahu persis apa yang keluar. Trade-off konkret: 105 tempat yang bisa lupa, dan yang lupa tidak
   akan ketahuan sampai ada klien yang error. Tidak ada test yang bisa memaksa konsistensi ini kecuali kamu
   menulis test per-endpoint.
3. **Middleware Express yang membungkus `res.json`** — jalan, dan tidak butuh RxJS sama sekali. Trade-off
   konkret: middleware tidak punya `ExecutionContext`, jadi ia **tidak bisa membaca metadata route** (mustahil
   bikin `@RawResponse()` untuk endpoint yang perlu dikecualikan), tidak typed, dan tidak berlaku untuk transport
   non-HTTP — yang penting karena Drovery punya WebSocket gateway sejak Fase 8.
4. **`ClassSerializerInterceptor` bawaan Nest** — menyelesaikan masalah **berbeda** (menyembunyikan field lewat
   `@Exclude()`). Repo ini sengaja memilih allowlist manual `UserResponseDto.from()`
   (`src/users/dto/user-response.dto.ts:23-51`). Trade-off konkret: `@Exclude()` adalah denylist — kolom baru di
   schema Prisma otomatis ikut keluar sampai ada yang ingat menandainya; `.from()` menyalin field satu per satu,
   jadi kolom baru **tidak** bocor. Harganya satu baris manual per field.

**Latihan:** tulis `TransformInterceptor` di `learn-nest/` dan daftarkan di `main.ts`.

**Cara memverifikasi:**
1. `curl -s localhost:3000/notes | jq` → harus `{"success":true,"data":[...],"timestamp":"..."}`.
2. Buat satu route yang `return null` → envelope tetap terbentuk dengan `"data": null`. Tulis spec-nya, contek
   `transform.interceptor.spec.ts:27-36`.
3. Sekarang tambahkan `requestId` ke envelope. Kamu perlu mengganti `_context` jadi `context` dan membaca
   `context.switchToHttp().getRequest()`. Ini pertama kalinya kamu memakai `ExecutionContext`, dan konsep 2.7
   akan memperlihatkan apa lagi yang bisa dibaca dari sana.

---

### 2.4 `APP_FILTER` + `AllExceptionsFilter` + exception yang membawa KEY, bukan kalimat

Padanan terdekat dari duniamu adalah **error boundary** React: satu komponen yang menangkap apa pun yang dilempar
di bawahnya dan merender fallback. Kemiripannya nyata, tapi ada perbedaan yang tidak boleh kamu bawa: error
boundary posisinya di pohon dan kamu bisa punya banyak. Exception filter di Drovery **satu, global, dan paling
luar** — `@Catch()` tanpa argumen berarti "tangkap semua". Tugasnya juga bukan "render fallback", melainkan
memutuskan **dua hal sekaligus**: apa yang klien lihat, dan apa yang operator lihat. Lihat
`http-exception.filter.ts:53-59` — kalau `status >= 500` ia mencatat exception utuh ke log dan mengirimnya ke
Sentry, sementara klien hanya menerima `{ statusCode: 500, timestamp, path, message: "Internal server error" }`.
Tidak ada stack trace, tidak ada nama tabel. Satu tempat, dua audiens. Kalau logikanya tersebar di 105
`try/catch`, yang terlupa satu akan membocorkan detail internal ke internet.

Ada tiga hal di file ini yang tidak akan kamu temukan di tutorial mana pun, dan ketiganya layak waktu:

**(a) Kenapa didaftarkan sebagai `APP_FILTER`, bukan `app.useGlobalFilters()`.** Komentar `main.ts:67-68`
menjawabnya langsung:

> *"AllExceptionsFilter is registered as an APP_FILTER in AppModule (DI — it injects I18nService). Do NOT also
> register it here, or it would run twice."*

`app.useGlobalFilters(new X())` mengharuskan kamu `new` sendiri, dan objek yang kamu `new` sendiri tidak bisa
menerima suntikan apa pun. Filter ini **butuh** `I18nService` (`http-exception.filter.ts:30`), jadi ia harus lewat
DI container, dan satu-satunya jalan ke sana adalah provider dengan token `APP_FILTER` (`app.module.ts:196-199`).
**Aturan praktisnya, hafalkan: butuh dependency → daftarkan lewat token `APP_*`. Tidak butuh → boleh `new` di
`main.ts`.** `TransformInterceptor` tidak butuh apa-apa, jadi ia `new` (`main.ts:69`); ketiga guard butuh
`Reflector`/`PrismaService`, jadi ketiganya lewat `APP_GUARD`.

**(b) Kenapa service melempar *key*, bukan kalimat.** `src/common/exceptions/app-exception.ts:12-17` mengejanya:

> *"Instead of throwing an English literal deep in a service (where no request locale is in scope), throw a
> stable message KEY (+ params). `AllExceptionsFilter` resolves the request locale at the boundary and translates
> the key ONCE, so the I18nService stays non-request-scoped … and we don't thread locale through ~30 service
> methods."*

Jadi `auth.service.ts:135` menulis `throw new AppUnauthorizedException('error.auth.invalid_credentials')` tanpa
tahu bahasa apa pun. Ini disebut **boundary localization**: keputusan bahasa diambil di satu tempat yang memang
memegang request, bukan di tiga puluh tempat yang tidak.

**(c) Kenapa `AppNotFoundException extends NotFoundException`.** Baris 19-24: *"Each subclass extends the
matching Nest built-in, so `instanceof NotFoundException` (and `rejects.toThrow(NotFoundException)` in specs)
still holds."* Dan cabang terakhir `renderMessage` (baris 110-111) melewatkan `HttpException` biasa apa adanya.
Gabungan keduanya menghasilkan **migrasi bertahap yang tidak merusak apa pun**: throw lama tetap jalan (bahasa
Inggris), throw baru terlokalisasi, test lama tetap hijau. Pelajaran yang berlaku jauh di luar NestJS — kalau
kamu harus mengganti pola di 200 tempat, rancang penggantinya supaya yang lama tetap sah.

Satu detail lagi: `app-exception.ts:28-30` mendefinisikan `Passthrough` — field mesin seperti `code`, `reasons`,
`retryAfter` **selamat apa adanya** di samping `message` yang diterjemahkan (`http-exception.filter.ts:90-98`
melakukan `return { message, ...obj }`). Aplikasi mobile mengambil keputusan berdasarkan field itu. Terjemahkan
`code` dan kamu merusak kontrak wire.

**Anchor:**
- `src/common/filters/http-exception.filter.ts:16-30` — docblock desain + constructor yang meng-inject `I18nService`.
- `…:74-112` — `renderMessage` dengan **tiga cabang**: AppException (90-99), validation error terlokalisasi
  (102-108), HttpException polos (110-111). Baris 78-80 (non-`HttpException` → `"Internal server error"`) adalah
  yang mencegah bocornya stack trace.
- `…:43` + `src/common/redact.ts:1-8` — `redactTokenInUrl()`: handshake WebSocket membawa JWT di query string,
  jadi mencatat URL mentah = membocorkan token yang masih hidup.
- `src/app.module.ts:194-199` — registrasi `APP_FILTER` beserta komentar *"must not be double-registered"*.

**Kenapa dipakai di sini:** karena tiga cabang `renderMessage` berbagi pembangunan envelope yang sama
(`catch()` baris 46-51 membentuk `{statusCode, timestamp, path}` sekali, lalu men-spread hasil `renderMessage`).
Memecahnya jadi beberapa filter akan menduplikasi bagian itu.

**Alternatif:**

1. **`try/catch` per controller** — konteks lokal maksimal. Trade-off konkret: 105 tempat, dan yang lupa akan
   mengembalikan 500 dengan stack trace ke klien. Setiap `catch` juga harus mengulang keputusan "apa yang boleh
   dilihat klien" — keputusan keamanan diambil 105 kali oleh orang yang sedang memikirkan hal lain.
2. **Error-handling middleware Express `(err, req, res, next)`** — familiar, tanpa konsep baru. Trade-off
   konkret: tidak punya `ArgumentsHost` (jadi tidak menyentuh konteks non-HTTP seperti WebSocket gateway di
   Fase 8) dan tidak bisa di-inject — yang langsung mematikan seluruh mekanisme terjemahan di konsep 2.5.
3. **Dua filter: `@Catch(HttpException)` + `@Catch()` fallback** — pemisahan tanggung jawab lebih bersih.
   Trade-off konkret: keduanya harus membangun envelope `{statusCode, timestamp, path}` yang sama, jadi kamu
   memindahkan duplikasi dari `if` ke file. Repo ini memilih satu filter karena bagian yang dibagi lebih besar
   daripada bagian yang berbeda.
4. **Kembalikan `Result<T, E>` alih-alih melempar (gaya Rust / fp-ts)** — kegagalan jadi bagian dari tipe dan
   compiler memaksamu menanganinya. Trade-off konkret: kamu melawan arus seluruh ekosistem. `ValidationPipe`
   melempar, guard melempar, Prisma melempar `PrismaClientKnownRequestError` (`auth.service.ts:63-74`) — jadi
   kamu tetap butuh filter untuk error yang bukan milikmu, dan sekarang punya dua mekanisme kegagalan sekaligus.

**Latihan:** di `learn-nest/`, buat `src/common/exceptions/app-exception.ts` versi kecil (cukup
`AppNotFoundException` dan `AppBadRequestException`, masing-masing `extends` built-in Nest dan mengirim
`{ statusCode, messageKey, messageParams }`), lalu `AllExceptionsFilter` yang didaftarkan lewat `APP_FILTER`.

**Cara memverifikasi:**
1. `throw new Error('boom')` di service → `curl -i` memberi 500 dengan `"message":"Internal server error"`, dan
   di terminal server kamu melihat `boom` beserta stack trace lengkap. Dua audiens, dua isi.
2. `throw new AppNotFoundException('error.note.not_found', { id })` → 404 dengan body datar
   `{statusCode, timestamp, path, message}`. Untuk saat ini `message` boleh masih berisi key mentahnya; konsep
   2.5 yang menerjemahkannya.
3. Sekarang daftarkan filter yang **sama** juga lewat `app.useGlobalFilters(new AllExceptionsFilter(...))` di
   `main.ts` dan panggil ulang. Amati apa yang terjadi (di Express kamu akan melihat error
   `Cannot set headers after they are sent`). Hapus lagi. Kamu baru saja memperagakan persis apa yang dicegah
   komentar `main.ts:67-68`.

---

### 2.5 i18n sebagai fungsi murni `(key, locale, params)`

Ini bagian yang paling relevan buat kamu secara pribadi: locale-nya memang `en` dan `id`, dan kalimat error yang
dilihat pengguna Indonesia lahir dari mekanisme yang akan kamu tulis minggu ini. Tidak ada padanan React yang
jujur untuk desainnya — `react-i18next` di klien selalu punya konteks komponen; di sini konsumennya bahkan tidak
selalu punya HTTP request.

Desain intinya satu kalimat: **`translate(key, locale, params)` adalah fungsi murni**, dan `I18nService` adalah
singleton default-scope biasa. Bukan request-scoped. Docblock `src/i18n/i18n.service.ts:5-17` menjelaskan
kenapa, dan sebagian alasannya menunjuk ke depan:

> *"Deliberately a plain default-scope singleton (NOT request-scoped, NOT nestjs-i18n): the primary surface —
> delivery notifications — is produced by the BullMQ worker (SimulationProcessor), which has NO HTTP request."*

Terus terang: kalimat itu belum sepenuhnya bisa kamu nilai sekarang, karena kamu belum tahu apa itu BullMQ
worker. Itu **pointer ke depan, bukan hutang**. Yang perlu kamu bawa dari Fase 2 adalah bentuk API-nya (fungsi
murni tiga argumen) dan konsekuensi bentuk itu (bisa dipanggil dari mana saja). Di Fase 6, saat kamu punya proses
worker yang jalan tanpa HTTP server, kamu akan membuka docblock ini lagi dan kalimatnya akan terasa seperti
kesimpulan, bukan klaim.

Properti kedua yang penting: **`translate()` tidak pernah melempar**. `i18n.service.ts:31-37` memakai rantai
fallback `locale diminta → English → key itu sendiri`, dan `interpolate()` (39-52) dibungkus `try/catch` —
*"so it can never break a delivery-status notification or fail a worker job."* Key yang hilang menghasilkan
string aneh tapi bisa didiagnosa, bukan job yang gagal. Ini **fail-open yang disengaja**, menarik untuk
dibandingkan dengan konsep 2.2 yang fail-closed: secret lemah adalah properti keamanan, terjemahan yang hilang
masalah kosmetik. Repo ini memilih arah kegagalan per-kasus, bukan per-selera.

**Bagaimana error validasi ikut diterjemahkan.** Ini jembatan antara konsep 2.10 dan 2.4. Docblock
`src/common/validation/validation-exception.factory.ts:4-17`: *"A locale-AGNOSTIC ValidationPipe exceptionFactory:
it maps each class-validator constraint to a stable catalog key (`validation.<constraint>`) + params … One factory
covers all ~351 decorators across the 32 input DTOs — no per-decorator `message:` and nothing to re-edit for a new
DTO."* Jadi `@MinLength(6)` di `SignupDto` (`src/auth/dto/signup.dto.ts:19`) tidak butuh `message:` sendiri.
Factory-nya menerbitkan `{ key: 'validation.minLength', params: { property: 'password', min: 6 } }`
(`validation-exception.factory.ts:135-157`), filter menerjemahkannya (`http-exception.filter.ts:102-108`), dan
katalog `id` baris 118 (`'{property} minimal {min} karakter'`) menghasilkan `"password minimal 6 karakter"`.
Tambah DTO baru → otomatis terlokalisasi.

Dua detail yang menunjukkan ini dipikirkan matang. Pertama, angka `6` **tidak ada** di objek `ValidationError`
milik class-validator, jadi `constraintArgs()` (`validation-exception.factory.ts:52-73`) membacanya dari
`getMetadataStorage()` — panggilan langsung ke metadata store yang sama yang bikin DI bekerja (konsep 2.7) —
dibungkus `try/catch` yang mengembalikan `[]`: *"a missing arg degrades to a literal {placeholder} … never a
crash."* Kedua, nama property **sengaja tidak diterjemahkan** (baris 11-13): *"it is the wire-contract field id
the mobile app maps to a form field; localizing it would break that association."* Jadi pesannya berbunyi
`"password minimal 6 karakter"` — kalimat Indonesia, field id Inggris. Kalau `password` ikut jadi `kata sandi`,
form mobile-mu tidak bisa lagi menyorot field yang benar. Kelihatannya tidak konsisten; sebenarnya ini pemisahan
yang tepat antara teks untuk manusia dan identifier untuk mesin.

**Dari mana locale-nya?** Presedensinya di `http-exception.filter.ts:62-72`: `User.locale` yang tersimpan (kalau
JWT membawanya) → header `Accept-Language` → default. `parseLocale()` (`src/i18n/accept-language.ts:11-21`)
sengaja sederhana, dan komentar baris 7-9 mengakui batasnya dengan jujur: *"RELATIVE q-ranking across tags is
intentionally ignored (overkill for two locales)"*. Ini contoh scope yang **dibatasi dan didokumentasikan**,
bukan dilupakan — bedakan keduanya saat kamu membaca repo orang lain.

**Bagaimana katalog dijaga tetap lengkap.** `src/i18n/catalog.completeness.spec.ts` mem-*generate* daftar key
wajib dari sumber kode (`STAGES`, enum `DeliveryFailureReason`, `FAQS`, plus `VALIDATION_KEYS` / `ERROR_KEYS` /
`EMAIL_KEYS` di `src/i18n/catalog/keys.ts`) dan memaksa setiap locale memilikinya (baris 44-49). Assertion
berikutnya (55-61) lebih ketat: `id` harus punya **persis** set key yang sama dengan `en` — sehingga key yang
hilang **atau basi** ketahuan. Tanpa ini, fallback per-key diam-diam menampilkan bahasa Inggris di aplikasi
berbahasa Indonesia dan tidak ada yang tahu. Komentar baris 9-11: *"this fails CI instead of printing a raw key
in production."*

**Anchor:**
- `src/i18n/i18n.service.ts:5-17` — docblock desain; `:26-37` `translate()`; `:39-52` `interpolate()`.
- `src/i18n/catalog/index.ts:5-14` — `Locale`, `SUPPORTED_LOCALES`, `CATALOGS`: seluruh permukaan yang harus
  diubah untuk menambah bahasa. Bandingkan `catalog/en.ts:119` dengan `catalog/id.ts:118`.
- `src/common/validation/validation-exception.factory.ts:123-133` — `keyFor()`, termasuk empat key khusus untuk
  `@Matches` yang regex-nya tidak punya makna untuk manusia.
- `src/i18n/catalog.completeness.spec.ts:44-61` — dua level penjagaan katalog.
- `src/i18n/i18n.service.spec.ts:30-37` — bukti bahwa key tak dikenal mengembalikan key itu sendiri.

**Kenapa dipakai di sini:** karena produknya untuk pengguna Indonesia, dan sebagian besar teks yang mereka baca
(notifikasi status pengiriman, email verifikasi, pesan error form) **dirender di server**. Klien tidak selalu ada
di sana untuk menerjemahkan — email dikirim saat aplikasi tertutup.

**Alternatif:**

1. **`nestjs-i18n`** — lengkap: loader JSON/YAML, resolver dari header/query/cookie, pluralization, `@I18n()`.
   Trade-off konkret: model utamanya berbasis request context (`I18nContext`), sedangkan konsumen terbesar
   terjemahan di Drovery adalah worker tanpa request. Kamu akan berakhir memakai jalur non-context-nya saja —
   persis `translate(key, locale, params)` yang ditulis sendiri di sini, plus dependency yang tidak terpakai.
2. **`i18next` / ICU MessageFormat** — plural dan gender yang benar (`"1 item"` / `"2 items"`). Trade-off
   konkret: Bahasa Indonesia tidak punya infleksi plural dan Inggris trivial, jadi dua locale ini tidak
   membenarkan format ICU. **Tapi catat ini sebagai asumsi yang bisa runtuh**: kalau ditambah bahasa Arab (enam
   bentuk plural) atau Rusia, keputusan ini harus ditinjau ulang, bukan dipertahankan karena terlanjur.
3. **Terjemahkan di klien** (server mengirim `code`, katalognya di aplikasi) — server bebas locale sepenuhnya,
   dan menambah bahasa tidak butuh deploy backend. Trade-off konkret dan fatal di sini: email dan push
   notification dirender di server, jadi tidak ada klien yang bisa menerjemahkannya. Kamu akan punya dua sistem.
4. **Kalimat bahasa Inggris hardcoded** — nol infrastruktur. Trade-off konkret: produk untuk pengguna Indonesia
   yang setiap pesan error-nya berbahasa Inggris, termasuk pesan validasi form yang paling sering dilihat.

**Latihan:** di `learn-nest/`, buat `src/i18n/catalog/{en,id,index}.ts` dan `I18nService` dengan satu method
`translate(key, locale?, params?)`. Isi minimal empat key: `validation.minLength`, `validation.isEmail`,
`error.note.not_found`, `validation.whitelistValidation`. Lalu tulis `i18nValidationExceptionFactory` versi kecil
yang memetakan constraint class-validator ke `validation.<constraint>`, pasang sebagai `exceptionFactory` di
`ValidationPipe`, dan sambungkan filter dari 2.4 supaya ia menerjemahkan `messageKey` + `i18nValidationErrors`.

**Cara memverifikasi:**
1. Request yang sama, dua header: `Accept-Language: id` → `"password minimal 6 karakter"`; `en` → `"password must
   be at least 6 characters"`. Kalau keduanya sama, filter-mu tidak membaca header (cek `resolveLocale`).
2. `Accept-Language: fr` → jatuh ke Inggris, **tidak** error.
3. Hapus satu key dari katalog `id` → kamu melihat kalimat Inggris (fallback per-key), **bukan** crash. Sekarang
   tulis spec yang meng-assert `Object.keys(id).sort()` sama dengan `Object.keys(en).sort()` → **merah**.
   Kembalikan key-nya → hijau. Kamu baru saja membangun jaring untuk kelas bug yang mustahil ditangkap mata.

---

### 2.6 Guard global via `APP_GUARD`: urutan eksekusi dan konsekuensi tiap posisi

Ini konsep tersulit di fase ini dan yang paling penting, jadi kita bongkar pelan-pelan.

Padanan dari duniamu cukup akurat: `<PrivateRoute>` di react-router. Guard Nest melakukan hal yang sama — tapi
**arahnya terbalik**, dan pembalikan itulah inti pelajarannya. `<PrivateRoute>` adalah *opt-in*: route baru
otomatis terbuka sampai seseorang ingat membungkusnya. `APP_GUARD` adalah *opt-out*: route baru otomatis tertutup
sampai seseorang menandainya `@Public()`. Bandingkan arah kegagalannya — lupa membungkus → endpoint terbuka ke
publik, ketahuan saat ada yang membobol; lupa menandai publik → endpoint terlalu ketat, ketahuan lima menit
kemudian saat kamu sendiri mencoba login. **Default yang aman bukan soal disiplin, tapi soal ke mana kesalahan
jatuh.**

Sekarang bagian yang benar-benar baru: **guard global dieksekusi sesuai urutan deklarasinya di array
`providers`**. `src/app.module.ts:176-193`:

```ts
providers: [
  // Rate-limit first (before auth) — global per-IP throttle. …
  { provide: APP_GUARD, useClass: LoadTestThrottlerGuard },   // 180-183
  // Apply JWT auth guard globally — use @Public() to opt out
  { provide: APP_GUARD, useClass: JwtAuthGuard },             // 185-188
  // Role authorization — runs after JwtAuthGuard; inert without @Roles().
  { provide: APP_GUARD, useClass: RolesGuard },               // 190-193
]
```

Ini bukan detail sepele — komentar di baris 177-179 dan 189 menyebutnya eksplisit, dan **setiap posisi punya
alasan yang bisa dilanggar dengan akibat nyata**:

1. **Throttler duluan.** Kalau auth jalan lebih dulu, penyerang yang mem-brute-force password memaksa server
   melakukan `bcrypt.compare` untuk **setiap** tebakan sebelum ditolak rate limit — dan bcrypt di sini pakai 12
   salt round (`auth.service.ts:21`), mahal secara sengaja. Dengan throttle di depan, request ke-101 mati dengan
   biaya CPU hampir nol. Ini pertahanan DoS, bukan kebersihan kode. Perhatikan juga `auth.controller.ts:31`:
   `@Throttle({ default: { limit: 10, ttl: 60_000 } })` di **level class**, jadi seluruh route auth kena batas
   10/menit — jauh lebih ketat dari default global 100/menit di `app.module.ts:73`.
2. **Auth di tengah.** `RolesGuard` membaca `req.user?.sub` (`roles.guard.ts:31`). Field itu **hanya ada** kalau
   `JwtAuthGuard` sudah sukses. Balik urutannya dan `RolesGuard` menolak semua orang dengan 403 — termasuk admin.
3. **Roles terakhir, dan inert.** `roles.guard.ts:28`: `if (!required || required.length === 0) return true;`
   Tanpa `@Roles()` di route, guard ini keluar sebelum menyentuh database — dan itu bukan sekadar niat,
   `roles.guard.spec.ts:23-27` menguncinya dengan `expect(prisma.user.findUnique).not.toHaveBeenCalled()`. Kalau
   sifat inert ini hilang, **setiap** request terautentikasi di seluruh aplikasi menambah satu query DB.

**Keputusan paling menarik di area ini: role dibaca dari DB, bukan dari JWT.** Docblock `roles.guard.ts:9-15`:
*"On a @Roles route it resolves the user's role FRESH from the DB (the JWT carries no role, so a demote takes
effect immediately) and denies by default."* Dan `jwt.strategy.ts:18-20` memang hanya mengembalikan
`{ sub, email }`. Konsekuensinya: mencabut hak admin berlaku **pada request berikutnya**, bukan setelah access
token kedaluwarsa. Biayanya satu query per request admin — dibatasi persis oleh sifat "inert" di atas.

Yang membuat ini layak ditiru adalah **simetrinya yang tercatat**. `AUDIT-LOG.md:296-299`:
*"`passwordChangedAt` / access-token revocation deliberately NOT done … `JwtStrategy.validate` does no I/O, so
the check would add a round trip to every authenticated request. Residual exposure is one 15-minute access-token
lifetime."* Jadi repo ini **membayar query DB untuk otorisasi** (jarang — hanya route admin) dan **menolak
membayarnya untuk autentikasi** (setiap request), lalu menuliskan risiko sisa yang diterima. Tiru penalarannya,
bukan jawaban spesifiknya.

**Terakhir: guard route-level jalan SETELAH guard global.** Itulah kenapa `POST /auth/refresh` bisa
`@PublicApi()` **dan** `@UseGuards(JwtRefreshGuard)` sekaligus (`auth.controller.ts:55-58`) — guard global
di-skip, guard route tetap jalan. Route ini "public" dalam arti tidak butuh **access** token, tapi tetap
terproteksi oleh **refresh** token yang divalidasi guard lain. Pola yang sama dipakai route ingest drone:
`@Public()` + `@UseGuards(DroneAuthGuard)` (`src/deliveries/telemetry/telemetry.controller.ts:29-30`), karena
drone bukan user tapi tetap harus terautentikasi. **Kalau kamu hanya melihat `@Public()` dan menyimpulkan route
itu terbuka, kamu salah baca.**

**Anchor:**
- `src/app.module.ts:176-193` — urutan ketiga `APP_GUARD` beserta komentar per posisi;
  `src/common/guards/jwt-auth.guard.ts:12-21` — guard terkecil yang menggabungkan metadata + Passport.
- `src/common/guards/roles.guard.ts:23-44` — inert check, baca `req.user.sub`, query DB, dan baris 42
  (`req.user.role = user.role`) yang menaruh hasilnya kembali ke request. Test-nya: `roles.guard.spec.ts:23-27`.
- `src/deliveries/telemetry/telemetry.controller.ts:19-30` — `@Public()` yang **bukan** berarti terbuka.

**Kenapa dipakai di sini:** karena permukaan API-nya besar (105 route) dan tumbuh terus. Model opt-out berarti
setiap route baru aman secara default tanpa siapa pun harus ingat apa-apa. Kalimat di `INTEGRATION.md:40` bahkan
menuliskannya sebagai kontrak lintas-repo: *"A global `JwtAuthGuard` (`APP_GUARD`) protects every route unless
decorated `@Public()`."*

**Alternatif:**

1. **`@UseGuards(JwtAuthGuard)` per controller** — eksplisit, terlihat di file yang bersangkutan, tidak ada
   "aksi jarak jauh". Trade-off konkret: fail-open. Controller ke-24 yang dibuat orang yang sedang buru-buru =
   endpoint terbuka, dan tidak ada test yang gagal karena tidak ada yang tahu route itu seharusnya tertutup.
2. **Middleware autentikasi (`app.use`)** — jalan lebih awal lagi dan sangat familiar dari Express. Trade-off
   konkret: middleware tidak punya `ExecutionContext`, jadi **tidak bisa membaca metadata route**. Seluruh
   mekanisme `@Public()` mustahil; kamu kembali ke daftar path yang dirawat manual (`if (['/auth/login',
   '/auth/signup', ...].includes(req.path))`) yang akan melenceng dari kode dalam hitungan minggu.
3. **Role di dalam JWT claim** — nol query DB, stateless murni, skala lebih baik, dan satu round trip lebih
   sedikit di setiap request admin. Trade-off konkret yang sudah diputuskan repo ini: pencabutan hak baru berlaku
   setelah token kedaluwarsa. Untuk konsol operator yang bisa membatalkan pengiriman dan mengeluarkan refund
   (`src/admin/admin.controller.ts:52-55`), jendela itu tidak diterima.
4. **CASL / RBAC berbasis policy** — aturan seperti "pemilik boleh membaca pengirimannya sendiri" jadi deklaratif
   dan bisa diuji terpisah. Trade-off konkret: Drovery melakukan pengecekan kepemilikan **di dalam service**,
   bukan di guard, jadi guard tetap sangat sederhana (44 baris) tapi logika otorisasi tersebar di dua tempat.
   Pindah ke CASL berarti memusatkannya, dengan harga satu lapis abstraksi baru yang harus dipelajari setiap
   orang yang menyentuh repo.

**Latihan:** di `learn-nest/`, pasang tiga guard global lewat `APP_GUARD`: `ThrottlerGuard` (dari
`@nestjs/throttler`), `JwtAuthGuard` buatanmu, dan `RolesGuard` buatanmu. Taruh `console.log('guard: X')` di baris
pertama tiap `canActivate`.

**Cara memverifikasi:**
1. Hit satu endpoint, lihat terminal → urutannya persis mengikuti urutan deklarasi. Tukar dua entri, hit lagi,
   lihat urutan berubah. Sekarang kamu **melihat** hal yang tadinya cuma diklaim dokumentasi.
2. `curl -i localhost:3000/notes` tanpa `Authorization` → 401. Tambahkan `@Public()` di satu route → 200; route
   lain tetap 401.
3. Balik urutan `JwtAuthGuard` dan `RolesGuard`, panggil route ber-`@Roles('ADMIN')` dengan token admin sah →
   403. Kembalikan → 200. Lalu matikan cek `@Public()` di `JwtAuthGuard` (jadikan `if (false)`) dan panggil
   login → 401 saat mencoba login. Paradoks yang sempurna untuk mengingat kenapa opt-out itu ada.

---

### 2.7 `Reflector` dan pasangan tulis/baca metadata

Di Fase 1 kamu sudah tahu bahwa decorator adalah fungsi yang jalan **sekali saat class di-load** dan biasanya
hanya **menempelkan data ke class/method itu**. Sekarang separuh yang lain: siapa yang membaca data itu, dan
kenapa pemisahan penulis/pembaca itu justru kekuatannya.

Tidak ada padanan yang jujur di React. Yang paling dekat adalah properti statis pada komponen yang dibaca kode
lain — `MyPage.getLayout = ...` yang dibaca `_app.tsx` di Next.js pages router. Kalau kamu pernah melihat pola
itu, mekanismenya sama: ditulis di satu tempat, dibaca di tempat yang sama sekali berbeda. Kalau belum, terima
saja bahwa ini memang asing — dan cara mengatasinya bukan memahami decorator secara abstrak, melainkan **selalu
mencari pasangannya**.

`@Public()` (`src/common/decorators/public.decorator.ts:3-4`) adalah dua baris:

```ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

Ia **tidak melakukan apa-apa sendiri**. Ia menulis `{'isPublic': true}` ke method/class tersebut. Yang membacanya
adalah `src/common/guards/jwt-auth.guard.ts:13-18`:

```ts
const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
  context.getHandler(),   // level method
  context.getClass(),     // level controller
]);
if (isPublic) return true;
```

`getAllAndOverride` artinya: cek method dulu, kalau tidak ada baru cek class. Semantik itu langsung terlihat
akibatnya. `@Roles(Role.ADMIN)` dipasang di **level class** di `src/admin/admin.controller.ts:53`, jadi berlaku
untuk semua method di dalamnya — puluhan route admin dilindungi oleh satu baris. Sebaliknya `@PublicApi()` di
**level method** (`auth.controller.ts:36`) bisa meng-override apa pun yang ada di class.

**Ini tabel yang harus kamu lihat sebagai satu unit.** Setiap decorator di repo ini punya pembacanya, dan
beberapa punya lebih dari satu:

| Penulis metadata | Pembacanya |
|---|---|
| `@Public()` — `public.decorator.ts:4` | `JwtAuthGuard` — `jwt-auth.guard.ts:13-16` |
| `@Roles(...)` — `roles.decorator.ts:8` | `RolesGuard` — `roles.guard.ts:24-27` |
| `@Roles(...)` (pembaca **kedua**) | `assembleAuditActor()` — `src/admin/audit/audit-actor.decorator.ts:29-43` |
| `@ApiProperty()` / tipe TS di `*.dto.ts` | generator OpenAPI — `swagger.ts:165` (`SwaggerModule.createDocument`) |
| tipe TS parameter constructor (via `emitDecoratorMetadata`) | DI container Nest |

Baris terakhir menjelaskan `tsconfig.json:10-11` (`emitDecoratorMetadata`, `experimentalDecorators`). Saat
compile, TypeScript menuliskan tipe parameter constructor sebagai metadata `design:paramtypes` — **satu-satunya**
cara Nest tahu bahwa `private readonly prisma: PrismaService` berarti "suntikkan provider `PrismaService`",
karena tipe TypeScript normalnya hilang total saat runtime. Matikan flag itu dan seluruh DI berhenti bekerja.

Baris ketiga layak perhatian ekstra, karena ia memperlihatkan apa yang terjadi kalau pasangan tulis/baca-nya
tidak lengkap. `audit-actor.decorator.ts:31-42` bukan cuma membaca `req.user.role`; ia **melempar `Error` biasa**
kalau role-nya tidak ada: *"Reaching here without a role means the route is missing @Roles … A 403 here would
make that bug indistinguishable — in logs and to the client — from a legitimately forbidden call."* Jadi bug
perakitan sengaja muncul sebagai 500 di monitoring, bukan menyamar jadi 403 rutin. Ingat ini saat mendesain
fail-safe sendiri: gagal dengan **jenis** kegagalan yang benar, bukan sekadar gagal.

Ada juga decorator yang **membaca**, bukan menulis: `createParamDecorator`. Lihat
`src/common/decorators/current-user.decorator.ts:16-21` — `@CurrentUser('sub')` mengambil `request.user` yang
ditaruh Passport dan menyerahkan satu field ke parameter handler. Efeknya di `users.controller.ts:14`: handler
menerima `userId: string`, bukan seluruh objek `Request`. Dan komentar `current-user.decorator.ts:7-13`
menjelaskan kenapa `role?` optional di `JwtPayload` — karena ia diisi oleh `RolesGuard`, bukan oleh token.

**Anchor:**
- `src/common/decorators/public.decorator.ts:1-4` (penulis) + `src/common/guards/jwt-auth.guard.ts:13-18`
  (pembaca) — pasangan terkecil di repo.
- `src/common/decorators/roles.decorator.ts:6-8` — docblock-nya menyebut pembacanya; tiru kebiasaan ini.
- `src/admin/audit/audit-actor.decorator.ts:25-43` — pembaca kedua `@Roles` + fail-closed sebagai programmer error.
- `src/common/decorators/current-user.decorator.ts:4-21` — `createParamDecorator` + `JwtPayload`.
- `tsconfig.json:10-11` — dua flag yang membuat semuanya mungkin.

**Kenapa dipakai di sini:** karena metadata memungkinkan **satu deklarasi dibaca banyak lapis**. `@Roles(ADMIN)`
di satu baris menghasilkan tiga hal sekaligus: guard menolak non-admin, `@AuditActor()` tahu siapa aktornya, dan
(lewat `@PublicApi()` di konsep 2.11) dokumentasi OpenAPI ikut benar. Tanpa metadata, ketiganya jadi tiga
konfigurasi terpisah yang bisa melenceng satu sama lain.

**Alternatif:**

1. **Konfigurasi eksplisit / plain function** (`router.get('/x', requireAuth, requireAdmin, handler)`) — aturan
   terlihat persis di tempat pakainya, tanpa aksi jarak jauh. Trade-off konkret: default-nya tidak aman (2.6),
   dan setiap konsumen aturan itu (guard, audit, dokumentasi) butuh daftarnya sendiri.
2. **File manifest terpusat** — satu `routes.config.ts` yang memetakan path ke aturan auth; bisa di-review dalam
   satu layar saat audit keamanan. Trade-off konkret: dua sumber kebenaran. Mengganti nama route tidak memaksa
   manifest ikut berubah dan compiler tidak menolong — bandingkan `@Public()` yang menempel fisik pada method.
3. **TC39 Stage-3 decorators** (`experimentalDecorators: false`) — masa depan bahasa, tanpa flag eksperimental.
   Trade-off konkret: **tidak mendukung `emitDecoratorMetadata`**, yang dibutuhkan NestJS 11 untuk DI berbasis
   tipe. Ini bukan pilihan gaya, ini constraint keras hari ini.

**Latihan:** buat `learn-nest/src/common/decorators/feature-flag.decorator.ts`:

```ts
export const FEATURE_KEY = 'feature';
export const Feature = (name: string) => SetMetadata(FEATURE_KEY, name);
```

Pasang `@Feature('stats')` di satu route, lalu baca dari `TransformInterceptor` (ganti `_context` jadi `context`,
inject `Reflector` lewat constructor — dan sadari bahwa itu berarti interceptor-mu **tidak boleh lagi** di-`new`
di `main.ts`; pindahkan ke `APP_INTERCEPTOR`. Kamu baru saja menemukan sendiri aturan dari konsep 2.4).

**Cara memverifikasi:** hit route yang ditandai dan yang tidak; `console.log` menampilkan `'stats'` pada yang
pertama, `undefined` pada yang kedua. Lalu pindahkan `@Feature('all')` ke level class dan hit route yang **tidak**
ditandai → muncul `'all'`. Itu `getAllAndOverride` bekerja — mekanisme yang sama yang membuat satu baris di
`admin.controller.ts:53` melindungi seluruh controller.

---

### 2.8 Passport JWT strategy: mixin factory, `validate()` → `req.user`, nol I/O per request

Tidak ada padanan React untuk ini. Yang paling membingungkan pertama kali bukan JWT-nya (kamu sudah menyimpan dan
mengirim Bearer token dari klien), melainkan **cara dua file tersambung**. Jadi mari kita eja.

`src/auth/strategies/jwt.strategy.ts` seluruhnya 21 baris:

```ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret')!,
    });
  }
  validate(payload: JwtPayload): JwtPayload {
    return { sub: payload.sub, email: payload.email };
  }
}
```

Empat hal yang harus kamu pegang utuh:

1. **`PassportStrategy(Strategy, 'jwt')` adalah mixin factory** — fungsi yang mengembalikan class untuk kamu
   `extends`, sekaligus mendaftarkan strategy dengan nama `'jwt'`. Nama itulah yang dirujuk `AuthGuard('jwt')` di
   `jwt-auth.guard.ts:7`. **Dua file itu terhubung hanya lewat sebuah string.** Salah ketik = `Unknown
   authentication strategy` saat runtime, bukan saat compile.
2. **`super({...})` mengkonfigurasi tiga hal:** dari mana token diambil, apakah expiry diabaikan (`false` —
   jangan pernah `true` di produksi), dan secret untuk verifikasi. Secret itu datang dari `ConfigService`, jadi
   rantai konsep 2.2 tersambung ke sini: kalau secret produksi lemah, aplikasi bahkan tidak boot.
3. **`validate()` hanya dipanggil kalau signature dan expiry sudah valid.** Passport mengerjakan kripto; kamu
   mengerjakan "apa yang mau saya taruh di `req.user`". Sering salah dipahami — orang mengira `validate()` yang
   memvalidasi token. Bukan.
4. **Nilai kembalian `validate()` menjadi `req.user`.** Persis objek yang dibaca `@CurrentUser()`
   (`current-user.decorator.ts:18-20`) dan `RolesGuard` (`roles.guard.ts:31`). Sekarang rantai konsep 2.6, 2.7,
   dan 2.8 tersambung jadi satu.

Yang paling layak dicatat: **`validate()` tidak menyentuh database sama sekali.** Ia hanya menyalin dua field
dari payload. Ini disengaja (konsep 2.6) dan dicatat beserta risiko sisanya di `AUDIT-LOG.md:296-299`. Nol I/O
per request terautentikasi adalah properti yang mahal untuk didapat kembali kalau sekali kamu lepaskan.

Satu pola yang membingungkan pertama kali: `JwtStrategy` ada di `providers` `AuthModule` tapi **tidak** di
`exports` (`auth.module.ts:14-15`). Ia tidak perlu di-inject siapa pun — cukup **ada** di graph agar
di-instantiate, dan proses instantiate itulah yang mendaftarkannya ke Passport. Instansiasi sebagai mekanisme
registrasi. Ingat baik-baik; kamu akan bertemu pola ini lagi.

Strategy **kedua** memperlihatkan kenapa desainnya bisa di-compose:
`src/auth/strategies/jwt-refresh.strategy.ts:9-23` mendaftarkan nama `'jwt-refresh'`, memakai secret yang
**berbeda** (`jwt.refreshSecret`, baris 17) dan ekstraksi yang **berbeda**
(`ExtractJwt.fromBodyField('refreshToken')`, baris 15 — dari body, bukan header). Secret yang berbeda berarti
access token **tidak bisa** dipakai sebagai refresh token dan sebaliknya, bahkan kalau seseorang menukarnya.
Guard-nya cuma satu baris: `src/auth/guards/jwt-refresh.guard.ts:5`
(`export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {}`), dipakai route-level di
`auth.controller.ts:57`.

**Anchor:**
- `src/auth/strategies/jwt.strategy.ts:9-20` — seluruh mekanisme autentikasi dalam 12 baris;
  `src/common/guards/jwt-auth.guard.ts:7` — `extends AuthGuard('jwt')`, string yang menyambungkannya.
- `src/auth/auth.module.ts:11-16` — `PassportModule` + `JwtModule.register({})`, dan `JwtStrategy` di providers
  tapi tidak di exports.
- `src/auth/strategies/jwt-refresh.strategy.ts:13-19` — secret berbeda + ekstraksi berbeda; guard-nya di
  `src/auth/guards/jwt-refresh.guard.ts:1-5` (catat lokasinya — bukan `src/common/guards/`).

**Kenapa dipakai di sini:** karena Passport menangani bagian yang paling tidak ingin kamu tulis sendiri
(ekstraksi token, verifikasi signature, penanganan expiry, pemetaan error ke 401) sementara membiarkan satu
keputusan yang memang milikmu (`validate()`) sepenuhnya di tanganmu. Perhatikan juga apa yang **tidak** dipakai:
repo ini tidak memakai `passport-local` untuk login; `AuthService.login()` (`auth.service.ts:129-157`)
mengerjakannya langsung dengan `bcrypt.compare`. Guard dipakai di tempat yang benar-benar butuh, bukan di
mana-mana.

**Alternatif:**

1. **Verifikasi `jsonwebtoken` manual di dalam guard** — satu dependency lebih sedikit dan alurnya kelihatan
   seluruhnya di satu file. Trade-off konkret: kamu menulis sendiri ekstraksi token dari header, penanganan
   `TokenExpiredError` vs `JsonWebTokenError`, dan pemetaan keduanya ke 401 yang benar. Repo ini tetap butuh
   `@nestjs/jwt` untuk **menandatangani** (`auth.service.ts:411-420`), jadi yang dihemat cuma sisi verifikasi.
2. **Session + cookie (`express-session` + Redis store)** — bisa dicabut seketika (hapus session di Redis), tidak
   ada "token yang masih hidup 15 menit", dan revocation jadi gratis. Trade-off konkret: stateful (setiap request
   menyentuh Redis — kebalikan dari nol-I/O di atas), dan klien di sini adalah aplikasi **native** Expo/Capacitor
   di mana cookie jauh lebih merepotkan daripada header `Authorization` yang sudah ada di
   `apiClient.ts`.
3. **Managed IdP (Auth0 / Clerk / Cognito / Supabase Auth)** — MFA, social login, dan rotasi token gratis, plus
   kamu tidak memiliki penyimpanan password sama sekali. `ARCHITECTURE.md:117` menyebutnya secara langsung
   (*"Consider moving auth to a managed IdP (Cognito/Auth0/Clerk) if you don't want to own this"*) dan
   `ARCHITECTURE.md:181` mencantumkannya sebagai item yang **belum** dikerjakan di tahap skala 100k+. Jadi ini
   bukan "tidak dipertimbangkan", melainkan "ditunda". Trade-off konkret: vendor lock-in pada tabel user + biaya
   per-MAU yang tumbuh persis saat produkmu berhasil.

**Latihan:** di `learn-nest/`, buat `JwtStrategy` + `JwtAuthGuard` dan sambungkan ke guard global dari 2.6.

**Cara memverifikasi:**
1. Tambahkan `iat: payload.iat` ke nilai kembalian `validate()` dan tampilkan lewat `@CurrentUser()` di sebuah
   route → kamu melihat timestamp penerbitan token. Bukti bahwa nilai kembalian `validate()` benar-benar jadi
   `req.user`.
2. Set `JWT_EXPIRES_IN=10s`, login, tunggu 15 detik, panggil route terproteksi → 401. Lalu ubah
   `ignoreExpiration` jadi `true`, ulangi → token mati **diterima**. Kembalikan ke `false`. Sekarang kamu tahu
   persis apa yang dijaga satu baris itu.
3. Ganti string `'jwt'` di `AuthGuard('jwt')` jadi `'jwtt'` → amati errornya muncul saat request, bukan saat
   compile. Itu harga dari sambungan berbasis string.

---

### 2.9 bcrypt, signup/login, dan refresh token: hash saat disimpan + rotasi sekali pakai

Sekarang kita rakit alur identitasnya. Empat keputusan, semuanya bisa kamu verifikasi di kode.

**Satu — password di-hash dengan bcrypt 12 round** (`auth.service.ts:21`, dipakai di baris 46 dan 138-141).
Angka 12 itu **sengaja mahal**: bcrypt dirancang lambat supaya penyerang yang mencuri tabel `users` tidak bisa
menebak jutaan password per detik. Dan biaya itu persis alasan throttler harus jalan sebelum auth (konsep 2.6) —
kalau tidak, kemahalanmu jadi senjata untuk menyerangmu.

**Dua — login tidak membocorkan akun mana yang ada.** `auth.service.ts:134-136` (user tidak ditemukan) dan
`143-145` (password salah) melempar **exception yang sama persis**. Pola yang sama, lebih tegas, ada di
`forgotPassword` (`auth.service.ts:226-255`): selalu mengembalikan `{ success: true }`, dan komentar baris
230-232 menjelaskan detail yang halus — locale diambil **hanya** dari `Accept-Language`, tidak pernah dari user
yang ditemukan, *"so the response/behavior is identical whether or not the account exists."* Kalau locale diambil
dari user, bahasa email dan waktu respons bisa jadi oracle keberadaan akun.

**Tiga — refresh token disimpan sebagai hash SHA-256** (`auth.service.ts:304-306`). Sama seperti password:
database yang bocor tidak langsung memberi penyerang sesi hidup. Tapi kenapa SHA-256 di sini, sementara password
pakai bcrypt? Jawabannya ada di baris 165-167:

```ts
const record = await this.prisma.refreshToken.findUnique({
  where: { tokenHash: this.hashToken(refreshToken) },
});
```

Pencarian itu hanya mungkin kalau hash-nya **deterministik**. bcrypt sengaja menghasilkan hash berbeda setiap
kali karena salt-nya acak — bagus untuk password (kamu memang membandingkan satu per satu dengan `compare`),
mustahil untuk lookup. Dan bcrypt tidak diperlukan di sini: refresh token adalah string acak berentropi tinggi
yang ditandatangani server, bukan password buatan manusia yang bisa ditebak dari kamus. Ini contoh bagus dari
"pilih hash sesuai ancamannya", bukan "pakai yang paling kuat".

**Empat — setiap token unik lewat `jti`.** `auth.service.ts:407-409`, dengan alasan yang sangat praktis:
*"jti makes every token unique, so two tokens issued in the same second (e.g. login then an immediate refresh)
don't collide on the stored hash."* Tanpa `jti`, dua token dengan `{sub, email, iat}` yang sama menghasilkan
string JWT yang sama, hash yang sama, dan tabrakan unique constraint.

**Rotasinya sendiri** ada di tiga method yang sengaja dipisah: `signTokens()` (`auth.service.ts:403-423`,
tanda tangan saja), `generateTokens()` (`:426-442`, tanda tangan + insert — untuk login/signup baru), dan
`rotateTokens()` (`:378-400`, tanda tangan + revoke lama + insert baru). Dan `refreshTokens()` (`:164-203`)
memvalidasi lebih dulu: token harus ada, milik user ini, belum di-revoke, belum kedaluwarsa (187-194).

**Sekarang bagian yang harus jujur.** Di `rotateTokens()` baris 385-397, revoke lama dan insert baru dibungkus
`$transaction([...])`. Dan di `refreshTokens()` baris 176-185 ada blok **reuse detection** yang mencabut seluruh
keluarga token kalau ada replay. Kedua hal itu **sengaja tidak kamu bangun sekarang.** Alasannya bukan
kemalasan kurikulum: keduanya hanya masuk akal setelah kamu punya kosakata transaksi (Fase 3) dan model mental
"dua penulis berebut satu baris" (Fase 5). Docblock `rotateTokens()` baris 370-376 menjelaskan kenapa
atomisitasnya wajib:

> *"The revoke and the replacement insert have to co-commit. Done as two separate writes, a failure between them
> leaves the caller holding a token that is revoked with no successor — and with reuse detection in place, their
> next retry would then look like a replay and log out every one of their devices."*

Bacalah kalimat itu sekarang, jangan berusaha memahaminya sepenuhnya, dan tandai halamannya. Di Fase 5 kamu akan
membukanya lagi bersama `AUDIT-LOG.md:301-313` yang mencatat bahwa **kedua** bug itu ditemukan lewat review
adversarial terhadap diff sendiri — dan bahwa rotasi non-atomik itu **sudah lama ada dan tidak berbahaya** sampai
reuse detection membuatnya berbahaya. Pelajaran yang berlaku universal: menambah fitur keamanan bisa mengubah
konsekuensi dari bug yang sudah lama tidur.

Yang **harus** kamu bangun sekarang: satu token refresh berlaku **tepat satu kali**. Itu saja cukup untuk
capstone, dan cukup untuk membuatmu paham kenapa `apiClient.ts:96-103` harus single-flight — kalau dua request
bersamaan sama-sama kena 401 dan sama-sama memanggil refresh dengan token yang sama, salah satunya pasti gagal.

Terakhir, satu latihan membaca skeptis yang gratis. `INTEGRATION.md:52` mengklaim *"Logout is local-only. There
is no backend revocation endpoint and refresh tokens are stateless"*. Itu **tidak benar lagi** pada baseline:
`auth.controller.ts:64-70` punya `POST /auth/logout`, `auth.service.ts:215-220` menghapus baris token-nya, dan
`INTEGRATION.md:193` di dokumen yang **sama** mencatatnya sebagai sudah selesai. Satu dokumen membantah dirinya
sendiri, dan yang benar adalah yang bisa kamu buka di kode. Ini kondisi normal dokumentasi mana pun; membacanya
secara skeptis adalah materi eksplisit Fase 3.

**Anchor:**
- `src/auth/auth.service.ts:21` — `BCRYPT_SALT_ROUNDS = 12`; `:46` hash saat signup; `:138-141` compare saat
  login; `:134-145` dua penyebab satu pesan.
- `src/auth/auth.service.ts:304-306` — `hashToken()` SHA-256; `:165-167` lookup yang mengharuskannya
  deterministik; `:407-409` `jti` dan alasannya.
- `src/auth/auth.service.ts:205-220` — `logout()` yang **menghapus** baris; docblock-nya menjelaskan kenapa, dan
  kenapa itu jadi penting di Fase 5.
- `src/auth/auth.controller.ts:36-70` — signup / login / refresh / logout, empat route, empat bentuk decorator.
- `AUDIT-LOG.md:327-330` — batasan yang jujur diakui: tidak ada rotation grace window. Langsung relevan untuk
  jaringan seluler Indonesia yang putus-nyambung: klien yang kehilangan **respons** dari refresh yang sudah
  sukses masih memegang token lama.

**Kenapa dipakai di sini:** karena access token pendek (15 menit, `configuration.ts:42`) memberi keamanan tapi
buruk untuk UX mobile, dan refresh token panjang (7 hari, baris 44) memberi UX tapi buruk untuk keamanan.
Rotasi adalah kompromi: umur panjang untuk *keluarga* token, umur satu-kali-pakai untuk *tiap* token.

**Alternatif:**

1. **Refresh token tanpa rotasi** (satu token panjang umur, dipakai berkali-kali) — lebih sederhana, tidak ada
   masalah race saat jaringan buruk, dan `apiClient` tidak butuh single-flight. Trade-off konkret: token yang
   dicuri berlaku 7 hari penuh dan **tidak ada cara mendeteksinya** — tidak ada sinyal apa pun yang membedakan
   pemakaian sah dari pencurian.
2. **Rotasi dengan grace window** (`replacedById` + jeda beberapa detik di mana token lama masih diterima) — cara
   standar industri untuk mengatasi masalah jaringan di atas. `AUDIT-LOG.md:327-330` menyebutnya sebagai mitigasi
   yang **diketahui** dan ditunda karena butuh migrasi schema. Trade-off konkret: jendela beberapa detik itu juga
   jendela di mana token curian masih sah, dan kamu harus memilih angkanya.
3. **Simpan refresh token di Redis dengan TTL, bukan Postgres** — pembersihan otomatis (tidak perlu prune
   terjadwal) dan lookup lebih cepat. Trade-off konkret: kamu kehilangan transaksi. Lihat
   `auth.service.ts:277-299`: `resetPassword` mengganti password **dan** menghapus semua refresh token dalam satu
   `$transaction`. Dengan Redis, dua penyimpanan berbeda tidak bisa co-commit, jadi ada jendela di mana password
   sudah ganti tapi sesi lama masih hidup — persis situasi yang reset password ada untuk mengakhirinya.
4. **Refresh token di cookie `httpOnly` + `SameSite`** — kebal XSS di web. Trade-off konkret: tidak relevan untuk
   klien Expo/Capacitor native, yang menyimpan token di `expo-secure-store` (`INTEGRATION.md:47`) dan mengirimnya
   di body. Menambah cookie berarti dua mekanisme untuk dua jenis klien.

**Latihan:** di `learn-nest/`, bangun `AuthService` dengan `signup`, `login`, `refresh`, `logout`, plus tabel
`refresh_tokens` (`id`, `userId`, `tokenHash` unique, `expiresAt`, `revokedAt` nullable).

**Cara memverifikasi** — rangkai dengan `curl`, simpan tokennya di variabel shell:
1. `POST /auth/signup` → simpan `refreshToken` sebagai `$A`. Cek tabel: kolomnya berisi **hash**, bukan token
   aslinya. Kalau kamu bisa membaca token di database, kamu melewatkan `hashToken`.
2. `refresh` dengan `$A` → dapat `$B`, sukses. `refresh` dengan `$A` **lagi** → 401. Itu inti capstone.
3. `refresh` dengan `$B` → sukses (di sandbox tanpa reuse detection, ini masih boleh berhasil). Catat di
   `DECISIONS.md` bahwa di Drovery langkah ini justru **gagal**, dan bahwa kamu menundanya ke Fase 5.
4. Login dua kali dalam satu detik → dua baris berbeda di tabel. Kalau kamu dapat error unique constraint, kamu
   melewatkan `jti`.

---

### 2.10 `ValidationPipe` sebagai trust boundary

Kamu sudah memakai `ValidationPipe` di Fase 1 sebagai kenyamanan: DTO dengan decorator, body salah → 400 otomatis.
Sekarang baca ulang konfigurasi yang sama dari sudut pandang **keamanan**, karena di situlah nilai sebenarnya.

`src/main.ts:57-65`:

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,               // buang property yang tidak ada di DTO
    forbidNonWhitelisted: true,    // lebih keras: TOLAK request-nya (400)
    transform: true,               // plain object → instance DTO
    transformOptions: { enableImplicitConversion: true },  // "12" → 12
    exceptionFactory: i18nValidationExceptionFactory,      // → konsep 2.5
  }),
);
```

Sekarang buka `src/users/users.service.ts:50-57`:

```ts
async updateProfile(userId: string, dto: UpdateProfileDto) {
  await this.getProfile(userId);
  const updated = await this.prisma.user.update({
    where: { id: userId },
    data: dto,
  });
```

`data: dto` — objek dari request masuk langsung ke `UPDATE`. Kalau kamu terbiasa waspada, ini seharusnya membuatmu
tidak nyaman. Sekarang lihat kenapa ini aman: `UpdateProfileDto`
(`src/users/dto/update-profile.dto.ts:5-25`) hanya mendeklarasikan `name`, `phone`, `address`, `bio`, `locale`.
Tabel `User` punya kolom `role` — buktinya `UserResponseDto` mengekspornya (`user-response.dto.ts:41`). Jadi:

- Dengan `whitelist: false` (default Nest!), `PATCH /users/me` dengan body `{"name":"x","role":"ADMIN"}` akan
  mengalir apa adanya ke `prisma.user.update({ data: dto })` → **privilege escalation langsung**.
- Dengan `whitelist: true`, `role` dibuang diam-diam sebelum sampai ke service.
- Dengan `forbidNonWhitelisted: true`, request-nya bahkan **ditolak 400** supaya klien tahu ia mengirim sesuatu
  yang tidak seharusnya, bukan berhasil mengirim sesuatu yang diam-diam diabaikan.

Pola "service percaya DTO-nya" yang membuat `users.service.ts:56` boleh menulis `data: dto` hanya sah kalau
pipe-nya **global dan agresif**. Ini contoh sempurna dari trust boundary: satu garis di `main.ts` menentukan
apakah 105 handler di belakangnya boleh percaya inputnya atau tidak.

`transform: true` + `enableImplicitConversion` menyelesaikan masalah kedua. Query string selalu string, tapi
`src/common/dto/pagination.dto.ts:11-20` mendeklarasikan
`@IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20` plus getter
`get skip()`. Dua hal di sini. `@Max(100)` adalah **proteksi DoS** — tanpanya `?limit=1000000` adalah full table
scan yang dikirim pengguna anonim. Dan getter `skip` (baris 18-20) hanya bisa ada karena `transform: true`
menghasilkan **instance class sungguhan**, bukan plain object; dengan `transform: false`, `dto.skip` akan
`undefined` dan pagination-mu diam-diam selalu mulai dari nol.

Satu detail yang menyatukan konsep ini dengan 2.5: error `forbidNonWhitelisted` punya constraint bernama
`whitelistValidation`, dan itu ada di daftar key yang dipetakan factory (`validation-exception.factory.ts:46`,
`catalog/keys.ts:29`). Jadi bahkan penolakan "property ini tidak diizinkan" pun sampai ke pengguna Indonesia
dalam bahasa Indonesia (`id.ts:126`).

**Anchor:**
- `src/main.ts:55-65` — registrasi global beserta komentar yang menjelaskan `exceptionFactory`.
- `src/users/dto/update-profile.dto.ts:5-25` — DTO yang **tidak** mendeklarasikan `role`; itulah pertahanannya.
  Pasangannya `src/users/users.service.ts:50-62` — `data: dto` yang aman karena pipe di atasnya.
- `src/common/dto/pagination.dto.ts:4-20` — `@Max(100)` dan getter yang butuh `transform: true`;
  `src/auth/dto/signup.dto.ts:10-27` — DTO input yang paling mudah dibaca.

**Kenapa dipakai di sini:** karena repo ini memilih posisi paling ketat dari spektrum yang tersedia, dan
konsekuensinya adalah service boleh sederhana. Setiap pelonggaran di `main.ts` memindahkan beban ke 105 handler.

**Alternatif:**

1. **Zod / `nestjs-zod`** — skema adalah nilai: bisa di-compose, di-`.partial()`, dan tipe TS-nya di-*infer*
   (satu sumber kebenaran). Alternatif paling serius. Trade-off konkret: plugin CLI `@nestjs/swagger`
   (`nest-cli.json:7-16`) membaca **tipe TypeScript + decorator dari `*.dto.ts`** saat build untuk menghasilkan
   schema OpenAPI otomatis. Pindah ke Zod = kehilangan itu untuk 54 file DTO, atau menambah `zod-to-openapi`.
2. **Validasi manual di service** — nol dependency, nol magic. Trade-off konkret: ~351 decorator di 32 DTO input
   berarti ratusan `if` yang tersebar, pesan error tidak seragam, dan tidak ada yang menghasilkan dokumentasi.
3. **`ajv` + JSON Schema** — paling cepat, dan schema-nya portabel (bisa dipakai gateway drone yang bukan
   TypeScript). Trade-off konkret: schema tidak terhubung ke tipe TS-mu, jadi keduanya bisa melenceng tanpa
   compiler menyadarinya.
4. **`whitelist: false` (default Nest)** — permisif; klien lama tidak pecah saat kamu menghapus field.
   Trade-off konkret persis contoh privilege escalation di atas.

**Latihan:** di `learn-nest/`, tambahkan kolom `published: boolean @default(false)` ke model `Note`, tapi
**jangan** masukkan ke `UpdateNoteDto`. Lalu kirim:

```bash
curl -i -X PATCH localhost:3000/notes/<id> \
  -H 'Content-Type: application/json' \
  -d '{"title":"halo","published":true}'
```

**Cara memverifikasi — tiga percobaan, jalankan ketiganya:**
1. Konfigurasi sekarang (`whitelist: true, forbidNonWhitelisted: true`) → **400**, pesan errornya menyebut
   `published`.
2. Ubah `forbidNonWhitelisted` jadi `false` → **200**, tapi cek baris di database: `published` **tetap** `false`.
   Field-nya dibuang diam-diam. Klien mengira berhasil.
3. Set `whitelist: false` juga → **200**, dan `published` sekarang `true` di database. Kamu baru saja
   memperagakan privilege escalation di lingkungan yang aman.

Kembalikan keduanya ke `true`. Tulis apa yang kamu lihat di `DECISIONS.md`; tiga percobaan itu mengajarkan seluruh
spektrum trust boundary lebih baik daripada paragraf mana pun.

---

### 2.11 OpenAPI/Swagger sebagai produk sampingan metadata yang sama

Konsep ini ditaruh terakhir karena ia **menggunakan kembali semua yang sudah kamu bangun** dan memperlihatkan
imbalan dari pendekatan berbasis metadata.

Plugin `@nestjs/swagger` di `nest-cli.json:7-16` membaca **tipe TypeScript** dari file `*.dto.ts` saat build dan
menghasilkan schema OpenAPI tanpa kamu menulis satu pun `@ApiProperty` untuk field biasa. Metadata yang sama yang
membuat DI bekerja (`design:paramtypes`, konsep 2.7) juga menjadi dokumentasi API. Satu deklarasi, tiga konsumen.

Tapi dokumentasi otomatis akan **berbohong** kalau runtime memodifikasi response — dan runtime memang
memodifikasinya (envelope dari konsep 2.3). `swagger.ts:78-83` menyebut masalah itu dan
`applyEnvelopeAndErrors()` (`swagger.ts:85-131`) membayarnya: setiap schema 2xx ditulis ulang jadi
`allOf [ApiEnvelopeDto, { data: <schema asli> }]` (baris 100-111), dan response error standar 400/401/500
disuntikkan (124-126). Komentar baris 80-83: *"so the spec matches runtime"* dan agar client codegen membaca
`response.data.<field>`.

**Yang paling elegan: status publik sebuah route hanya ditulis sekali.**
`src/common/decorators/public-api.decorator.ts:16` adalah satu baris:

```ts
export const PublicApi = () => applyDecorators(Public(), ApiSecurity({}));
```

Docblock-nya (baris 6-15) menjelaskan tujuannya: *"Marks a route public for BOTH layers in lockstep (so they
can't drift)"*. Lalu `swagger.ts:114-125` membaca balik hasilnya:

```ts
// `[{}]` (empty requirement) = a @PublicApi() route → no 401.
const isPublic = Array.isArray(op.security) && op.security.some((r) => Object.keys(r).length === 0);
...
if (!isPublic) addErr('401', 'Missing or invalid authentication');
```

Guard dan dokumentasi tidak bisa melenceng karena keduanya lahir dari satu decorator. Ini penerapan ulang
pelajaran konsep 2.7 dengan taruhan yang berbeda: dokumentasi yang salah tentang auth bukan cuma menyesatkan,
ia membuat klien membangun alur login yang salah.

Perhatikan juga apa yang **tidak** dipakai `@PublicApi()`. Route ingest drone tetap memakai `@Public()` polos
plus `@ApiSecurity('ingest-key')` di level class (`telemetry.controller.ts:23-24`) — karena route itu
**key-authed, bukan terbuka**, dan dokumentasinya harus menunjukkan skema `x-ingest-key`, bukan "tanpa auth".
Dua decorator berbeda untuk dua situasi yang di permukaan terlihat sama.

Dua catatan operasional yang praktis: docs sengaja **aktif secara default** (`swagger.ts:171-177` — repo ini
showcase portofolio) dengan kill-switch `SWAGGER_ENABLED=false` (baris 182). Dan `ARCHITECTURE.md:142`
memperingatkan jebakan nyata: *"the swagger CLI plugin runs only during `nest build`; production serves from
`dist/` so schemas are populated, but a ts-node run would show empty schemas."* Kalau schema-mu kosong padahal
DTO-nya lengkap, itu penyebab pertama yang harus kamu curigai.

**Anchor:**
- `nest-cli.json:7-16` — plugin CLI beserta `dtoFileNameSuffix` dan `introspectComments`.
- `src/common/swagger.ts:16-30` — `ApiEnvelopeDto`, bentuk yang harus cocok dengan `TransformInterceptor`;
  `:85-131` — `applyEnvelopeAndErrors()`, hutang envelope yang dibayar; `:114-125` — pembacaan balik `@PublicApi()`.
- `src/common/swagger.ts:138-163` — `DocumentBuilder` dengan dua security scheme (`access-token`, `ingest-key`).
- `src/common/swagger.ts:135-137` — catatan kenapa **tidak** ada `addServer()`: prefix global sudah masuk ke tiap
  path key, jadi menambah server akan menggandakannya jadi `/api/v1/api/v1/...`.

**Kenapa dipakai di sini:** karena konsumen API-nya bukan cuma kamu. `swagger.ts:50-66` (`DESCRIPTION`)
menjelaskan envelope, auth, dan realtime langsung ke konsumen — dan salah satu konsumennya, gateway drone, bukan
TypeScript sama sekali.

**Alternatif:**

1. **Spec OpenAPI manual (design-first)** — spec jadi kontrak yang disepakati sebelum kode ada, bisa di-review
   tim lain, dan bisa jadi dasar mock server sejak hari pertama. Trade-off konkret: dua sumber kebenaran yang
   dijaga sinkron manual, tanpa compiler. Repo ini memilih code-first justru karena satu-orang-satu-repo, di mana
   drift lebih berbahaya daripada koordinasi.
2. **tRPC** — tanpa spec sama sekali; tipe mengalir langsung dan refactor terasa di kedua sisi seketika.
   Trade-off konkret: **hanya untuk konsumen TypeScript**. Gateway drone dan webhook Stripe bukan konsumen
   TypeScript, jadi kamu tetap butuh REST untuk mereka — sekarang dengan dua permukaan API.
3. **Tanpa dokumentasi, andalkan koleksi Postman** — nol build step. Trade-off konkret: tidak ada codegen client,
   dan tidak ada yang memaksa koleksi ikut berubah saat kode berubah. Enam bulan kemudian ia jadi fosil.

**Latihan:** pasang `@nestjs/swagger` di `learn-nest/`, tambahkan plugin di `nest-cli.json`, buat `@PublicApi()`
versimu sendiri dengan `applyDecorators(Public(), ApiSecurity({}))`, dan pasang di route login.

**Cara memverifikasi:**
1. `npm run build && npm run start:prod`, buka `/docs`. Route login: **tidak ada gembok**. Route lain: ada gembok.
2. `curl -s localhost:3000/docs-json | jq '.paths["/auth/login"].post.security'` → `[{}]`. Bandingkan dengan
   route terproteksi yang tidak punya field itu (mewarisi requirement global).
3. Ganti `@PublicApi()` di route login jadi `@Public()` biasa, build ulang → route login sekarang **salah**
   menampilkan gembok padahal guard-nya tetap melewatinya. Kembalikan. Kamu baru saja melihat persis drift yang
   dicegah `@PublicApi()`.
4. Jalankan lewat `ts-node`/`start:dev` alih-alih `build` dan lihat schema DTO kosong — jebakan dari
   `ARCHITECTURE.md:142`, diperagakan di mesinmu sendiri.

---

### 2.12 Alternatif yang dibandingkan: satu tabel keputusan

Kamu minta tahu **kenapa** dan **apa alternatifnya**. Sebelas konsep di atas sudah memberi alternatif per konsep;
subbagian ini merangkumnya jadi satu tabel yang bisa kamu bawa ke wawancara atau ke rapat desain. Kolom terakhir
adalah baris kode yang **menyelesaikan** perdebatannya di repo ini — bukan pendapat, tapi keputusan yang sudah
terjadi.

| Keputusan | Yang dipilih | Alternatif utama | Trade-off yang menentukan | Bukti di repo |
|---|---|---|---|---|
| Lapisan lintas-request | Guard / Interceptor / Filter Nest | Middleware Express | Middleware tidak punya `ExecutionContext` → tidak bisa membaca metadata route → `@Public()` mustahil | `jwt-auth.guard.ts:13-16` |
| Penanganan error | Satu filter global ber-`@Catch()` | `try/catch` per controller | 105 handler; yang terlupa membocorkan stack trace 500 | `http-exception.filter.ts:78-80` |
| Model kegagalan | `throw` + filter | `Result<T,E>` (fp-ts/Rust) | Pipe, guard, dan Prisma semuanya `throw`; kamu tetap butuh filter untuk yang bukan milikmu | `auth.service.ts:63-74` |
| i18n | Buatan sendiri, fungsi murni | `nestjs-i18n` | Konsumen terbesar terjemahan adalah worker tanpa request | `i18n.service.ts:5-12` |
| Identitas | JWT stateless + rotasi refresh | Session + cookie di Redis | Klien native Capacitor/Expo; cookie merepotkan, header sudah ada | `INTEGRATION.md:46-49` |
| Kepemilikan auth | Ditulis sendiri | Managed IdP (Auth0/Clerk/Cognito) | Vendor lock-in + biaya per-MAU; dicatat sebagai "ditunda", bukan "ditolak" | `ARCHITECTURE.md:117, 181` |
| Validasi env | `class-validator` + `if` eksplisit | Joi `validationSchema` | Satu library validasi untuk env dan DTO; aturan bersyarat lebih mudah dibaca sebagai `if` | `validation.ts:1-2, 33-42` |
| Validasi request | `class-validator` decorator | Zod / `nestjs-zod` | Plugin CLI Swagger membaca tipe dari `*.dto.ts`; pindah ke Zod = kehilangan schema otomatis di 54 file | `nest-cli.json:7-16` |
| Kontrak API | Code-first OpenAPI | Design-first spec manual · tRPC | Satu orang satu repo → drift lebih berbahaya daripada koordinasi; konsumen non-TS (drone, Stripe) | `swagger.ts:85-131` |
| Otorisasi | Role dari DB per request | Role di dalam JWT claim | Pencabutan hak harus berlaku seketika untuk konsol yang bisa refund | `roles.guard.ts:12-14` |
| Autentikasi | Nol I/O di `validate()` | Cek `passwordChangedAt` per request | Menolak menambah round trip ke setiap request; risiko sisa 15 menit dicatat | `AUDIT-LOG.md:296-299` |

Perhatikan dua baris terakhir bersama-sama. Keduanya soal "haruskah kita menanyakan database?", dan jawabannya
**berbeda** karena frekuensinya berbeda. Kalau kamu hanya membawa satu hal dari fase ini, bawa itu: pertanyaan
desain yang benar hampir tidak pernah "mana yang lebih aman", melainkan "berapa harganya, seberapa sering
dibayar, dan risiko sisa apa yang saya terima secara tertulis".

**Alternatif untuk cara membandingkan itu sendiri:**
- **ADR (Architecture Decision Record)** — satu file per keputusan, bernomor, statusnya `accepted`/`superseded`.
  Trade-off: lebih rapi untuk arsip, tapi butuh disiplin membuat file baru dan cenderung berhenti diisi.
- **Komentar di kode (yang dipilih Drovery)** — keputusan hidup persis di sebelah kode yang terpengaruh, jadi
  orang yang mengubah kode pasti membacanya. Trade-off: tersebar, sulit dicari kalau kamu bertanya "kenapa X"
  tanpa tahu file mana. `AUDIT-LOG.md` di repo ini adalah kompromi keduanya.

**Latihan:** tulis `learn-nest/DECISIONS.md` dengan format yang meniru `AUDIT-LOG.md`: bagian **What changed**,
**Decisions made** (minimal empat, masing-masing dengan alternatif yang kamu tolak **dan alasannya**), dan
**Left undone**. Bagian terakhir wajib memuat minimal dua hal yang kamu sadari belum kamu bangun — misalnya reuse
detection dan atomisitas rotasi.

**Cara memverifikasi:** berikan dokumenmu ke orang lain (atau ke dirimu sendiri dua minggu lagi) dan minta dia
menemukan **satu** keputusan yang kamu tulis sebagai "lebih baik" tanpa menyebut harganya. Kalau ada, perbaiki.
Keputusan tanpa harga adalah selera yang menyamar jadi rekayasa.

---

## Capstone

Sandbox `learn-nest/` naik kelas, dan seluruhnya dibuktikan lewat **satu skrip `demo.sh` yang bisa dijalankan
ulang** dari terminal bersih. Kriteria di bawah ini semuanya berbentuk perilaku yang bisa **gagal di depan
matamu** — bukan "paham", bukan "sudah baca".

**A. Tertutup secara default**
- [ ] `curl -i localhost:3000/notes` tanpa `Authorization` → **401** dengan body error datar; route ber-`@Public()`
      (login, signup, health) → **200** tanpa token.
- [ ] Controller baru dengan satu route **tanpa** decorator apa pun, restart, panggil → **401**. Ini yang
      membuktikan default-nya aman, bukan kebetulan.
- [ ] `demo.sh` mencetak urutan tiga guard (throttle → auth → roles) dari `console.log` di `canActivate`.

**B. Identitas berjalan**
- [ ] `signup` → `login` → `refresh` berjalan; refresh dengan token yang **sama dua kali** → yang kedua **401**.
- [ ] Kolom `tokenHash` di database tidak pernah berisi token yang bisa dipakai; skrip mencetak isinya.
- [ ] Login dengan email tidak terdaftar dan login dengan password salah menghasilkan **body respons identik**
      (bandingkan dengan `diff`, bukan dengan mata).

**C. Bentuk respons seragam**
- [ ] Setiap sukses berbentuk `{success, data, timestamp}` — termasuk yang `data`-nya `null`. Setiap error datar
      `{statusCode, timestamp, path, message}`, **tidak** dibungkus envelope sukses.
- [ ] Request yang sama dengan `Accept-Language: id` dan `en` menghasilkan `message` berbeda, `statusCode` sama;
      skrip mencetak keduanya bersebelahan. Nama property tetap Inggris, kalimatnya Indonesia.

**D. Menolak boot, bukan gagal terbuka**
- [ ] `NODE_ENV=production JWT_SECRET=change-me npm start` → proses **mati** dengan pesan yang menyebut nama
      variabelnya; skrip meng-assert exit code bukan nol. Dengan `$(openssl rand -hex 32)` → menyala normal.

**E. Dokumentasi yang tidak berbohong**
- [ ] `/docs` menampilkan gembok **hanya** pada route terproteksi; `docs-json` menunjukkan `security: [{}]` pada
      route publik.
- [ ] Schema 2xx di `docs-json` sudah berbentuk envelope (`allOf`), bukan bentuk mentah controller.

**F. Artefak tertulis**
- [ ] `learn-nest/DECISIONS.md` sesuai latihan 2.12, dengan bagian `Left undone` yang jujur.
- [ ] `demo.sh` bisa dijalankan dua kali berturut-turut tanpa mengedit apa pun (email acak, atau reset database
      di awal skrip). Kalau harus diedit di antara dua run, ia belum selesai.

**Tanda bahwa capstone-mu belum benar-benar lulus:** kalau ada satu langkah pun di `demo.sh` yang kamu jalankan
manual "karena itu susah diotomasi", langkah itu biasanya justru yang paling kamu belum kuasai. Kerjakan dulu.

---

## Gerbang keluar

Jawab tanpa membuka kode. Kalau ada satu saja yang belum bisa, jangan lanjut ke Fase 3 — di sana kamu akan masuk
repo asli, dan setiap kelemahan di sini akan tersamar oleh ukuran repo.

**1. Kenapa `AllExceptionsFilter` didaftarkan lewat `APP_FILTER` di `app.module.ts`, sementara
`TransformInterceptor` boleh di-`new` di `main.ts`?**

<details><summary>Jawaban</summary>

Karena filter itu **butuh dependency**: ia meng-inject `I18nService` (`http-exception.filter.ts:30`). Objek yang
kamu `new` sendiri tidak bisa menerima suntikan apa pun, jadi ia harus dibuat DI container — lewat token
`APP_FILTER`. `TransformInterceptor` tidak punya dependency, jadi `new` cukup. Aturan praktis: butuh dependency →
token `APP_*`; tidak butuh → boleh `new`. Kalau didaftarkan di **kedua** tempat, ia jalan dua kali — persis yang
diperingatkan `main.ts:67-68`.
</details>

**2. Kenapa `RolesGuard` membaca role dari database dan bukan dari klaim di dalam JWT? Apa harganya, dan apa yang
mencegah harga itu membengkak?**

<details><summary>Jawaban</summary>

Supaya pencabutan hak admin berlaku **pada request berikutnya**, bukan setelah access token kedaluwarsa — untuk
konsol operator yang bisa membatalkan pengiriman dan mengeluarkan refund, jendela 15 menit tidak diterima.
Harganya satu query DB per request. Yang mencegahnya membengkak adalah sifat **inert**: tanpa `@Roles()`, guard
keluar di baris pertama tanpa menyentuh database (`roles.guard.ts:28`), dan ada test yang menguncinya dengan
`expect(prisma.user.findUnique).not.toHaveBeenCalled()`. Biayanya hanya dibayar di route admin.
</details>

**3. `POST /auth/refresh` ditandai `@PublicApi()`. Apakah itu berarti siapa pun bisa memanggilnya dan mendapat
token?**

<details><summary>Jawaban</summary>

Tidak. `@PublicApi()` hanya membuat **guard global** melewatinya — route ini tidak butuh **access** token. Tapi
di baris berikutnya ada `@UseGuards(JwtRefreshGuard)`, guard route-level yang jalan **setelah** guard global dan
memvalidasi **refresh** token dengan secret berbeda, diekstrak dari body bukan header. Route ini tetap
terproteksi, hanya oleh kredensial berbeda. Pola yang sama dipakai route ingest drone: `@Public()` +
`@UseGuards(DroneAuthGuard)`. Jangan pernah menyimpulkan sebuah route terbuka hanya dari `@Public()`.
</details>

**4. Kenapa service melempar `'error.auth.invalid_credentials'` dan bukan kalimat "Email atau password salah"?**

<details><summary>Jawaban</summary>

Karena di dalam service tidak ada locale request yang bisa diakses, dan menyalurkan locale ke ~30 method adalah
harga yang tidak sepadan. Service melempar **key stabil (+ params)**; `AllExceptionsFilter` menyelesaikan locale
di boundary (`User.locale` → `Accept-Language` → default) dan menerjemahkan **sekali**. Efek sampingnya penting:
`I18nService` tetap non-request-scoped — fungsi murni `(key, locale, params)` yang nanti bisa dipakai identik
oleh worker tanpa HTTP request.
</details>

**5. Apa yang rusak kalau `whitelist: true` dimatikan di `main.ts`? Sebutkan satu jalur konkret.**

<details><summary>Jawaban</summary>

`PATCH /users/me` dengan body `{"name":"x","role":"ADMIN"}` akan mengalir apa adanya ke
`prisma.user.update({ data: dto })` di `users.service.ts:54-57`, karena service memang menulis `data: dto`
langsung. Tabel `User` punya kolom `role`. Hasilnya privilege escalation. `whitelist: true` membuangnya karena
`UpdateProfileDto` tidak mendeklarasikan `role`; `forbidNonWhitelisted: true` bahkan menolak request-nya dengan
400 supaya klien tahu, bukan berhasil diam-diam.
</details>

**6. Urutan tiga guard global adalah throttle → auth → roles. Apa yang terjadi kalau throttle dipindah ke
paling akhir?**

<details><summary>Jawaban</summary>

Setiap tebakan password dalam serangan brute-force akan memaksa server menjalankan `bcrypt.compare` dengan 12
salt round — operasi yang sengaja mahal — **sebelum** rate limit sempat menolaknya. Penyerang mendapat pengali
biaya CPU gratis; ini berubah dari serangan tebak-password jadi serangan DoS. Dengan throttle di depan, request
ke-101 mati dengan biaya hampir nol.

(Dan kalau yang dipindah adalah `RolesGuard` ke depan `JwtAuthGuard`: `req.user` belum ada, jadi
`roles.guard.ts:31-32` menolak semua orang dengan 403 — termasuk admin yang sah.)
</details>

**7. Kenapa refresh token disimpan sebagai hash SHA-256, bukan bcrypt seperti password?**

<details><summary>Jawaban</summary>

Karena token itu **dicari** lewat `findUnique({ where: { tokenHash } })`, dan lookup hanya mungkin kalau hash-nya
deterministik. bcrypt sengaja menghasilkan hash berbeda tiap kali karena salt-nya acak. Selain itu bcrypt tidak
dibutuhkan di sini: refresh token adalah string acak berentropi tinggi yang diterbitkan server, bukan password
buatan manusia yang rentan serangan kamus. Hash-nya tetap penting supaya database yang bocor tidak langsung
memberi penyerang sesi hidup.
</details>

**8. `@Public()` cuma menulis metadata dan tidak melakukan apa-apa. Lalu siapa yang membuatnya berpengaruh, dan
bagaimana kamu mencari pembaca sebuah decorator di repo yang belum kamu kenal?**

<details><summary>Jawaban</summary>

Yang membuatnya berpengaruh adalah `JwtAuthGuard.canActivate` yang memanggil
`reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, class])`. Cara mencarinya: jangan cari nama decorator-nya,
cari **konstanta key**-nya (`IS_PUBLIC_KEY`, `ROLES_KEY`) dengan grep. Penulis dan pembaca selalu berbagi
konstanta itu — itulah satu-satunya tali yang menyambungkan keduanya. Untuk `@Roles` kamu akan menemukan **dua**
pembaca: `RolesGuard` dan `assembleAuditActor()`.
</details>

---

## Kalau nyangkut

Ini kelas-kelas kemacetan yang paling mungkin kamu temui di dua minggu ini. Kolom terakhir adalah cara
**memastikan**, bukan menebak.

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| Boot gagal: `Nest can't resolve dependencies of the XService (?, ...)` | Provider yang diminta tidak visible dari module tempat `XService` hidup: module penyedianya tidak di-`imports`, providernya tidak di-`exports`, atau `@Global()`-nya hilang | Hitung posisi `?` di pesan error — itu **indeks parameter constructor** yang gagal. Lalu cek tiga hal berurutan: apakah provider itu ada di `providers` module-nya, ada di `exports`, dan module-nya di-`imports` (atau `@Global()`). Ulangi latihan 2.1 langkah 2 untuk melihat pesan ini sengaja. |
| `POST /auth/login` mengembalikan 401 — kamu tidak bisa login untuk mendapat token yang dibutuhkan untuk login | Route login tidak ditandai `@Public()`/`@PublicApi()`, atau pembacaan metadata di `JwtAuthGuard` rusak | `console.log` di baris pertama `JwtAuthGuard.canActivate`, cetak hasil `getAllAndOverride`. Kalau `undefined` padahal decorator terpasang, periksa apakah kamu mengimpor `Public` dari file yang benar dan apakah key konstantanya sama persis di kedua sisi. |
| Response terkirim dua kali / `Cannot set headers after they are sent` | Filter atau interceptor didaftarkan **dua kali**: sekali di `main.ts` dengan `new`, sekali lagi lewat `APP_FILTER`/`APP_INTERCEPTOR` | Cari nama class-nya di seluruh repo (`grep -rn AllExceptionsFilter src/`). Harus muncul di **satu** tempat registrasi saja. Ini persis yang diperingatkan `main.ts:67-68`. |
| Klien menerima `error.note.not_found` mentah alih-alih kalimat | Key tidak ada di katalog. `translate()` **sengaja** mengembalikan key itu sendiri sebagai fallback terakhir daripada crash | Buka `i18n.service.ts:31-37`; rantainya `locale → en → key`. Tambahkan key ke `en` dulu, lalu `id`. Lalu tulis test kelengkapan katalog supaya kelas bug ini tidak bisa terjadi lagi diam-diam. |
| Semua request 403 setelah kamu menambahkan `RolesGuard` | Urutan `APP_GUARD` terbalik — `RolesGuard` jalan sebelum `JwtAuthGuard`, jadi `req.user` belum ada | Taruh `console.log` di awal ketiga `canActivate` dan hit satu endpoint. Urutan yang tercetak adalah urutan array `providers`, apa adanya. |
| `dto.skip` (atau getter lain di DTO) `undefined` | `transform: false` — pipe menghasilkan plain object, bukan instance class, jadi getter-nya tidak ikut | `console.log(dto.constructor.name)` di controller. Kalau `Object`, transform mati. Kalau nama DTO-mu, transform hidup. |
| Query string `?limit=5` sampai ke service sebagai string `"5"` | `enableImplicitConversion` tidak aktif, atau DTO-nya tidak punya `@Type(() => Number)` | `console.log(typeof dto.limit)`. Perbaiki di `transformOptions`, bukan dengan `parseInt` di service — kalau kamu `parseInt` di service, kamu memindahkan trust boundary ke tempat yang salah. |
| Schema DTO di `/docs` kosong padahal DTO-nya lengkap | Plugin CLI `@nestjs/swagger` hanya jalan saat `nest build`; kamu menjalankan lewat ts-node/`start:dev` | `npm run build && npm run start:prod`, buka lagi. Ini persis jebakan yang ditulis `ARCHITECTURE.md:142`. |
| Refresh gagal di aplikasi mobile dengan jaringan buruk, padahal jalan sempurna di Postman | Dua request bersamaan sama-sama kena 401 dan sama-sama memanggil refresh dengan token yang sama; yang kedua menemukan token sudah di-rotate | Reproduksi dengan dua `curl` paralel memakai refresh token yang sama. Ini bukan bug di kodemu — ini alasan `apiClient.ts:96-103` melakukan single-flight, dan alasan `AUDIT-LOG.md:327-330` mencatat "no rotation grace window" sebagai batasan yang diketahui. |

Satu catatan jujur: **bagian tersulit fase ini bukan salah satu konsep, melainkan pengalaman "aksi jarak
jauh"** — kamu menulis `@Public()` di file A, yang membuatnya berpengaruh ada di file B, yang didaftarkan di file
C. Rasa kehilangan kendali itu wajar dan tidak hilang dengan membaca lebih banyak teori. Yang menghilangkannya
adalah kebiasaan: setiap kali bertemu decorator asing, **jangan berhenti sebelum menemukan pembacanya** — grep
konstanta key-nya. Setelah lima kali, refleks itu terbentuk dan sisa repo jadi jauh lebih mudah dibaca.

---

## Bacaan pendamping

File di repo yang berisi **"kenapa"**, dengan apa yang harus kamu cari di sana. Urutkan dari atas ke bawah kalau
kamu bingung mulai dari mana.

| File | Yang dicari di sana |
|---|---|
| `Drovery_Backend/src/main.ts` | 100 baris; seluruh pipeline terlihat dalam satu layar. Baca komentar 22-24 (`rawBody`), 42-43 (CORS wildcard vs allowlist), dan 67-68 (double-registration). |
| `Drovery_Backend/src/app.module.ts:176-199` | Urutan guard dan registrasi filter sebagai **daftar keputusan**; setiap entri punya komentar yang menyebut alasannya. |
| `Drovery_Backend/src/common/exceptions/app-exception.ts:12-30` | Kenapa service melempar key, kenapa tiap subclass meng-`extends` built-in Nest, dan apa itu `passthrough`. |
| `Drovery_Backend/src/i18n/i18n.service.ts:5-17` | Desain i18n dalam satu docblock. Sebagian alasannya menunjuk ke Fase 6 — tandai dan buka lagi nanti. |
| `Drovery_Backend/src/common/validation/validation-exception.factory.ts:4-17` | Kenapa satu factory cukup untuk ~351 decorator, dan kenapa nama property sengaja tidak diterjemahkan. |
| `Drovery_Backend/src/common/decorators/public-api.decorator.ts:6-15` | Contoh terpendek dari "satu deklarasi, dua lapis, tidak bisa melenceng". |
| `Drovery_Backend/src/config/validation.ts:32-74` | Tiga aturan fail-fast berturut-turut, masing-masing dengan alasannya. Komentar 51-60 adalah yang paling instruktif. |
| `Drovery_Backend/AUDIT-LOG.md:220-333` | Entri "Phase 2 — Credentials hygiene" utuh: apa yang berubah (225-264), tabel **mutation test** (271-279), keputusan + harganya (286-299), penyimpangan yang ditemukan review adversarial (301-319), dan `Left undone` (321-332). Ini contoh terbaik di repo tentang cara mencatat kerja sendiri secara jujur. |
| `Drovery_Backend/INTEGRATION.md:38-74` | Kontrak lintas-repo: token lifecycle + envelope. **Dan** latihan skeptis: baris 52 mengklaim logout bersifat lokal saja, sementara baris 193 dan `auth.controller.ts:64-70` membantahnya. Temukan sendiri sebelum lanjut ke Fase 3. |
| `Drovery_Mobile/services/api/apiClient.ts:93-126` | Sisi klien dari semua yang kamu bangun minggu ini: single-flight refresh dan unwrap envelope. Kamu sudah pernah memakai ini; sekarang kamu tahu apa yang ada di ujung satunya. |
| `Drovery_Backend/ARCHITECTURE.md:117, 142` | Dua kalimat: managed IdP sebagai opsi yang ditunda, dan jebakan plugin CLI Swagger. |
| `Drovery_Backend/DEPLOY.md:37-42` | Sisi operasional dari konsep 2.2 — bagaimana secret yang lolos gerbang produksi sebenarnya dibuat. |

Dokumentasi resmi — pakai hanya tiga ini, dan hanya kalau mekanismenya masih terasa kabur setelah membaca kode:

- <https://docs.nestjs.com/fundamentals/execution-context> — `ExecutionContext` dan `Reflector`, yaitu mesin di
  balik konsep 2.6 dan 2.7.
- <https://docs.nestjs.com/guards> — siklus hidup guard dan posisinya relatif terhadap interceptor dan pipe.
- <https://rxjs.dev/api/operators/map> — satu-satunya operator RxJS yang kamu butuhkan di fase ini.

---

**Setelah fase ini:** Fase 3 memindahkanmu ke `Drovery_Backend` yang asli. Hal pertama yang harus kamu lakukan di
sana adalah membuka `src/app.module.ts` dan `src/main.ts` — dan memeriksa apakah keduanya sekarang terbaca sebagai
daftar keputusan yang bisa kamu perdebatkan. Kalau ya, fase ini berhasil. Kalau masih terasa seperti mantra,
kembali ke latihan 2.6 dan 2.7; keduanya yang paling menentukan.

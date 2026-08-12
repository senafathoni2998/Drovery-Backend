# Peta Belajar — `backend:core-and-auth` (Drovery Backend)

> **Untuk siapa:** developer frontend Ionic React + Capacitor yang sudah paham React, TypeScript dasar, dan
> konsumsi REST dari sisi client — tapi belum pernah menyentuh NestJS, dependency injection, decorator/metadata,
> atau ORM.
>
> **Cara membaca peta ini:** konsep diurutkan dari yang paling mudah ke yang paling sulit. Setiap konsep hanya
> bergantung pada konsep yang sudah muncul di atasnya. Prosa Bahasa Indonesia, identifier/kode tetap Inggris.

---

## Kalimat pembuka: apa sebenarnya area ini?

Area `core-and-auth` adalah **pipa (pipeline) yang dilewati setiap request HTTP sebelum dan sesudah menyentuh
business logic**, plus **mesin identitas** yang memutuskan siapa pemanggilnya.

Analogi dari dunia Anda: di Ionic React, Anda punya `<Route>` → komponen → `fetch()` → render. Di sini, satu
request `GET /api/v1/users/me` melewati rantai yang jauh lebih panjang dan **rantai itu dideklarasikan di tempat
lain, bukan di file controller-nya**:

```
Request masuk
  │
  ├─ 1. Middleware  : pino-http (nesjs-pino) → stamp X-Request-Id, redact secrets   [app.module.ts:80]
  ├─ 2. Guard #1    : LoadTestThrottlerGuard → rate limit 100/60s per IP            [app.module.ts:180]
  ├─ 3. Guard #2    : JwtAuthGuard          → verifikasi Bearer JWT, isi req.user   [app.module.ts:186]
  ├─ 4. Guard #3    : RolesGuard            → cek role dari DB (inert tanpa @Roles) [app.module.ts:191]
  ├─ 5. Interceptor : TransformInterceptor  (fase "sebelum")                        [main.ts:69]
  ├─ 6. Pipe        : ValidationPipe        → validasi + transform DTO              [main.ts:57]
  │
  ├─ 7. CONTROLLER HANDLER → SERVICE → PrismaService → PostgreSQL
  │
  ├─ 8. Interceptor : TransformInterceptor  (fase "sesudah") → { success, data, timestamp }
  └─ (kalau throw)  : AllExceptionsFilter   → { statusCode, timestamp, path, message } + terjemahan i18n
```

**Yang bikin repo ini layak dijadikan bahan belajar:** hampir semua keputusan di atas punya komentar yang
menyebut *alasannya*, sering kali beserta bug yang pernah terjadi kalau dilakukan dengan cara lain. Jadi Anda
tidak belajar "begini cara NestJS", tapi "begini cara NestJS dan ini konsekuensinya kalau salah".

---

## 1. Module & module graph (`@Module`)

- **Prasyarat:** —

- **Anchor:** `src/app.module.ts:47-175` — lihat array `imports:` yang panjang itu. Bandingkan dengan
  `src/users/users.module.ts:5-10` (module fitur terkecil yang bisa ada) dan `src/auth/auth.module.ts:11-17`.

- **Kenapa dipakai di sini:**
  NestJS tidak punya konsep "file = route" seperti Next.js. Aplikasi adalah **graph of modules** yang di-compose
  sekali saat boot. `AppModule` adalah root-nya, dan isinya persis peta arsitektur sistem: 22 feature module
  (`AuthModule`, `UsersModule`, `DeliveriesModule`, …) plus infrastruktur (`ConfigModule`, `ThrottlerModule`,
  `LoggerModule`, `BullModule`, `CacheModule`, `PrismaModule`, `I18nModule`).

  Bukti bahwa graph ini benar-benar dipakai sebagai unit yang bisa dipindahkan: `src/worker.ts:30-32` boot
  **AppModule yang sama persis** dengan `NestFactory.createApplicationContext()` — tanpa HTTP server sama sekali.
  Satu image Docker, empat peran proses (`api` / `worker` / `realtime` / unset), dipilih lewat `PROCESS_ROLE`
  (lihat `src/common/process-role.ts:1-15`). Kalau modul-modul ini hanya "folder", trik ini mustahil: yang membuat
  worker bisa reuse seluruh service tanpa reuse HTTP adalah karena graph-nya deklaratif, bukan imperatif.

  Perhatikan juga `AuthModule` mengekspor `AuthService` (`auth.module.ts:15`) tapi **tidak** mengekspor
  `JwtStrategy` — strategy hanya perlu *ada* di graph agar Passport mendaftarkannya, tidak untuk di-inject orang lain.
  Ini contoh konkret bahwa `providers` (siapa yang hidup di module ini) dan `exports` (siapa yang boleh dipinjam
  module lain) adalah dua hal berbeda.

- **Alternatif:**
  - **Express + folder routes (gaya yang mungkin Anda kenal dari tutorial Node)** — jauh lebih cepat dimulai, tapi
    tidak ada boundary yang dipaksakan. Di repo sebesar ini (346 file TS, 28 module) tidak ada yang mencegah
    `deliveries` meng-import internal `payments`. Trade-off: kebebasan hari pertama vs. graph yang bisa di-boot
    ulang sebagai worker di hari ke-300.
  - **Fastify + plugin encapsulation** — punya konsep encapsulation juga dan lebih cepat, tapi DI-nya manual.
    Menarik: repo ini *sudah* meng-install `@nestjs/platform-fastify` (`package.json`) namun `main.ts:25` tetap
    memakai default Express — karena `rawBody: true` untuk verifikasi signature webhook Stripe dan ekosistem
    middleware Express masih lebih mulus.
  - **NestJS monorepo mode (`apps/` + `libs/`)** — memisahkan api dan worker jadi dua entrypoint terkompilasi
    terpisah. Trade-off: pemisahan lebih tegas, tapi harus mengelola dua build; repo ini memilih satu build +
    flag `PROCESS_ROLE` karena "one image, four roles" jauh lebih murah di Kubernetes.

- **Latihan:**
  Buat `src/greeting/greeting.module.ts` + `greeting.controller.ts` dengan satu route `GET /greeting`. **Jangan**
  daftarkan dulu ke `AppModule`. Jalankan `npm run start:dev`, curl `localhost:3000/api/v1/greeting` → 404.
  Sekarang tambahkan `GreetingModule` ke array `imports` di `app.module.ts`, curl lagi → jalan. Anda baru saja
  membuktikan bahwa **file tidak membuat route; module graph yang membuat route**.

---

## 2. Provider & Dependency Injection

- **Prasyarat:** Module & module graph

- **Anchor:** `src/auth/auth.service.ts:26-35` — empat dependency di-inject lewat constructor, tanpa satu pun
  `new` atau `import` instance. Bandingkan dengan `src/users/users.service.ts:20-25` (dua dependency).

- **Kenapa dipakai di sini:**
  ```ts
  @Injectable()
  export class AuthService {
    constructor(
      private readonly prisma: PrismaService,
      private readonly jwt: JwtService,
      private readonly config: ConfigService,
      private readonly mail: MailService,
    ) {}
  ```
  Tidak ada `new PrismaService()` di mana pun di file ini. Nest yang membuat instance-nya (default: **singleton
  per aplikasi**) dan menyuntikkannya.

  Alasan paling konkret dan bisa Anda verifikasi hari ini ada di test suite. Lihat
  `src/common/guards/roles.guard.spec.ts:17-21`:
  ```ts
  reflector = { getAllAndOverride: jest.fn() };
  prisma = { user: { findUnique: jest.fn() } };
  guard = new RolesGuard(reflector as any, prisma as any);
  ```
  Guard yang biasanya menyentuh PostgreSQL bisa diuji **tanpa database sama sekali**, karena dependency-nya masuk
  lewat constructor. Repo ini punya 610+ test yang jalan tanpa DB dengan pola yang sama (`src/test/prisma-mock.ts`
  adalah mock bersama-nya). Kalau `AuthService` melakukan `import { prisma } from '../db'`, seluruh strategi test
  itu tidak mungkin.

  Alasan kedua terlihat di `src/prisma/prisma.service.ts:18-22`: `PrismaService implements OnModuleInit,
  OnApplicationShutdown`. Karena Nest yang memiliki instance-nya, Nest juga bisa memanggil lifecycle hook-nya —
  yang dipakai `main.ts:76` (`app.enableShutdownHooks()`) supaya rolling deploy menyelesaikan job BullMQ aktif
  dan menutup pg pool, bukan meninggalkannya menggantung.

- **Alternatif:**
  - **Import singleton langsung** (`export const prisma = new PrismaClient()`) — nol boilerplate, tapi tidak bisa
    di-swap saat test kecuali dengan module mocking (`jest.mock`) yang rapuh, dan tidak ada lifecycle hook.
  - **Manual factory / composition root** — Anda merakit sendiri object graph di satu file. Eksplisit dan tanpa
    magic, tapi di 28 module ini file itu akan jadi beberapa ratus baris yang harus diedit setiap kali ada
    dependency baru.
  - **DI container ringan (`tsyringe`, `InversifyJS`)** — dapat DI tanpa framework penuh. Trade-off: Anda tidak
    dapat guard/interceptor/filter/lifecycle yang terintegrasi, jadi ujung-ujungnya menulis ulang separuh Nest.

- **Latihan:**
  Buka `src/users/users.service.ts` dan tambahkan `private readonly i18n: I18nService` ke constructor (import dari
  `../i18n/i18n.service`). Jalankan aplikasi — **jalan**, tanpa mengubah `users.module.ts` sama sekali. Sekarang
  buka `src/i18n/i18n.module.ts` dan hapus `@Global()` di baris 11. Jalankan lagi → Nest gagal boot dengan
  "Nest can't resolve dependencies of the UsersService". Kembalikan `@Global()`. Anda baru saja merasakan
  perbedaan antara provider yang visible dan yang tidak.

---

## 3. Decorator + `reflect-metadata` (kenapa ada `@` di mana-mana)

- **Prasyarat:** Provider & DI

- **Anchor:** `src/common/decorators/public.decorator.ts:3-4` — decorator terpendek di repo ini, hanya 2 baris:
  ```ts
  export const IS_PUBLIC_KEY = 'isPublic';
  export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
  ```
  Lalu `tsconfig.json:11-12` (`emitDecoratorMetadata: true`, `experimentalDecorators: true`) dan `main.ts` —
  perhatikan `import 'reflect-metadata'` tidak ada di sini, karena `@nestjs/core` yang meng-import-nya.

- **Kenapa dipakai di sini:**
  Ini konsep yang paling asing buat orang React, jadi pelan-pelan.

  Decorator **bukan** HOC dan **bukan** hook. Decorator adalah fungsi yang jalan **sekali saat class di-load**, dan
  tugasnya biasanya hanya **menempelkan data (metadata) ke class/method itu**. Data itu disimpan di WeakMap global
  milik `reflect-metadata`. Tidak ada yang "terjadi" saat itu.

  Jadi `@Public()` di atas sebuah method **tidak melakukan apa-apa sendiri**. Ia cuma menulis
  `{'isPublic': true}` ke method tersebut. Yang membacanya adalah pihak ketiga — lihat
  `src/common/guards/jwt-auth.guard.ts:13-18`:
  ```ts
  const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
    context.getHandler(),   // method-level
    context.getClass(),     // controller-level
  ]);
  if (isPublic) return true;
  ```
  `Reflector` adalah pembaca metadata bawaan Nest. `getAllAndOverride` artinya: "cek method dulu, kalau tidak ada
  baru cek class" — sehingga `@Roles(Role.ADMIN)` yang dipasang di level class (`src/admin/admin.controller.ts:53`)
  berlaku untuk **semua** method di dalamnya, sementara `@PublicApi()` di level method (`auth.controller.ts:36`)
  bisa meng-override.

  **Ini pasangan tulis/baca yang wajib Anda lihat sebagai satu unit.** Setiap decorator kustom di repo ini punya
  pembaca-nya:

  | Penulis metadata | Pembacanya |
  |---|---|
  | `@Public()` — `public.decorator.ts:4` | `JwtAuthGuard` — `jwt-auth.guard.ts:13` |
  | `@Roles(...)` — `roles.decorator.ts:8` | `RolesGuard` — `roles.guard.ts:24` |
  | `@Roles(...)` (lagi) | `@AuditActor()` — `src/admin/audit/audit-actor.decorator.ts:32-40` |
  | `@ApiProperty()` | generator OpenAPI — `src/common/swagger.ts:165` |
  | tipe TS constructor (via `emitDecoratorMetadata`) | DI container Nest |

  Baris terakhir itu yang menjelaskan `emitDecoratorMetadata: true`. Saat compile, TypeScript menuliskan tipe
  parameter constructor sebagai metadata `design:paramtypes`. Itulah **satu-satunya** cara Nest tahu bahwa
  `private readonly prisma: PrismaService` artinya "suntikkan provider `PrismaService`" — karena tipe TypeScript
  normalnya hilang total saat runtime. Matikan flag itu, dan seluruh DI di konsep #2 berhenti bekerja.

  Ada juga decorator yang **membaca**, bukan menulis: `createParamDecorator`. Lihat
  `src/common/decorators/current-user.decorator.ts:16-22` — `@CurrentUser('sub')` mengambil `request.user` yang
  ditaruh Passport dan menyerahkan satu field ke parameter handler. Efeknya bisa Anda lihat langsung di
  `src/users/users.controller.ts:14` — handler menerima `userId: string`, bukan seluruh `Request` object.

- **Alternatif:**
  - **Konfigurasi eksplisit / plain function** (gaya Express: `router.get('/x', requireAuth, handler)`) — aturan
    terlihat di tempat pakainya, tidak ada "aksi jarak jauh". Trade-off: rawan lupa. Di repo ini default-nya
    **aman** (semua route ter-guard, `@Public()` untuk opt-out); di gaya Express default-nya **tidak aman** (route
    terbuka sampai Anda ingat menempelkan middleware).
  - **TC39 Stage-3 decorators (TypeScript 5 `experimentalDecorators: false`)** — standar masa depan, tapi
    **tidak mendukung `emitDecoratorMetadata`**. Nest 11 masih membutuhkan decorator legacy; ini bukan pilihan
    gaya, melainkan constraint keras hari ini.
  - **Skema deklaratif (Zod/JSON Schema) untuk validasi, bukan decorator** — lihat konsep #7.

- **Latihan:**
  Buat `src/common/decorators/feature-flag.decorator.ts`:
  ```ts
  export const FEATURE_KEY = 'feature';
  export const Feature = (name: string) => SetMetadata(FEATURE_KEY, name);
  ```
  Pasang `@Feature('stats')` di `UsersController.getStats` (`users.controller.ts:29`). Lalu di
  `TransformInterceptor.intercept`, ganti parameter `_context` jadi `context` dan `console.log` hasil
  `new Reflector().getAllAndOverride(FEATURE_KEY, [context.getHandler(), context.getClass()])`. Hit
  `GET /users/me/stats` vs `GET /users/me` dan lihat bedanya. Ini membuktikan metadata itu nyata dan bisa dibaca
  dari layer mana pun.

---

## 4. Controller, routing, dan param decorator

- **Prasyarat:** Decorator + metadata

- **Anchor:** `src/users/users.controller.ts:8-34` (controller terpendek dan paling jelas di repo) lalu
  `src/auth/auth.controller.ts:30-62` (yang menumpuk enam decorator sekaligus di satu route).

- **Kenapa dipakai di sini:**
  Controller di Nest **tipis atas kesengajaan**. Lihat `users.controller.ts:12-17`:
  ```ts
  @Get('me')
  @ApiOkResponse({ type: UserResponseDto })
  async getProfile(@CurrentUser('sub') userId: string) {
    const user = await this.usersService.getProfile(userId);
    return UserResponseDto.from(user);
  }
  ```
  Lima baris. Tidak ada `res.json()`, tidak ada `try/catch`, tidak ada status code. Yang di-`return` adalah objek
  biasa; TransformInterceptor (#8) yang membungkusnya, AllExceptionsFilter (#9) yang menangani error, dan
  `@CurrentUser('sub')` yang mengambil user id. **Controller hanya menerjemahkan HTTP ke pemanggilan service.**

  `UserResponseDto.from(user)` (`src/users/dto/user-response.dto.ts:23-51`) juga penting: ini bukan validasi, ini
  **allowlist keluar**. Object dari Prisma bisa berisi kolom yang tidak boleh keluar; `.from()` menyalin field
  satu per satu sehingga tidak ada kolom baru yang bocor otomatis saat schema berubah.

  Route `POST /auth/refresh` (`auth.controller.ts:55-62`) adalah studi kasus terbaik untuk memahami tumpukan
  decorator, jadi baca perlahan:
  ```ts
  @PublicApi()                       // → global JwtAuthGuard di-skip + OpenAPI ditandai tanpa auth
  @ApiOkResponse({ type: AuthTokensDto })
  @UseGuards(JwtRefreshGuard)        // → guard route-level, jalan SETELAH guard global
  @Post('refresh')
  @HttpCode(HttpStatus.OK)           // → override default 201 milik @Post
  refresh(@Body() dto: RefreshTokenDto, @CurrentUser() user: JwtPayload) { … }
  ```
  Route ini "public" (tidak butuh **access** token) tapi tetap ter-proteksi — oleh **refresh** token yang
  divalidasi guard lain. Kalau Anda hanya melihat `@PublicApi()` Anda akan salah menyimpulkan route ini terbuka.

  Satu lagi yang sering luput: `@Throttle({ default: { limit: 10, ttl: 60_000 } })` di
  `auth.controller.ts:31` dipasang di **level class**, jadi seluruh route auth kena batas 10/menit (lebih ketat
  dari default global 100/menit) — proteksi brute-force. Sekali lagi: metadata di class, dibaca guard global.

- **Alternatif:**
  - **Express handler `(req, res)`** — Anda pegang kendali penuh atas response. Trade-off: setiap handler harus
    ingat bentuk envelope-nya sendiri. Di repo ini `{success, data, timestamp}` dijamin seragam di 96 endpoint
    justru **karena** handler tidak boleh menyentuh `res`.
  - **tRPC / GraphQL** — kontrak end-to-end typed tanpa menulis DTO response. Tapi klien di sini adalah aplikasi
    mobile Ionic/Capacitor + drone gateway + Stripe webhook; REST + OpenAPI (#14) lebih universal untuk konsumen
    non-TypeScript seperti drone client.
  - **Fat controller (logic langsung di controller)** — lebih sedikit file. Trade-off fatal di repo ini: worker
    BullMQ memanggil service **tanpa** HTTP request. Kalau logic ada di controller, worker tidak bisa memakainya.

- **Latihan:**
  Tambahkan route `GET /users/me/locale` di `UsersController` yang mengembalikan `{ locale }` saja, memakai
  `@CurrentUser('sub')`. Lalu coba versi kedua yang memakai `@CurrentUser() user: JwtPayload` dan baca
  `user.role` — Anda akan dapat `undefined`. Cari tahu kenapa di `current-user.decorator.ts:7-13`
  (jawabannya menghubungkan langsung ke konsep #11).

---

## 5. Custom provider, injection token, dan `@Global()` module

- **Prasyarat:** Provider & DI, Decorator + metadata

- **Anchor:** `src/cache/cache.module.ts:14-31` (provider `useFactory` dengan token custom) dan
  `src/prisma/prisma.module.ts:4-9` (`@Global()` dalam 9 baris).

- **Kenapa dipakai di sini:**
  Konsep #2 menunjukkan pola paling umum: `providers: [UsersService]` — Nest melihat class, membaca tipe
  constructor-nya, membuat instance. Tapi bagaimana kalau yang mau Anda inject **bukan class Anda**, misalnya
  koneksi `ioredis`?

  Jawabannya `cache.module.ts:14-31`:
  ```ts
  const redisProvider = {
    provide: REDIS_CLIENT,              // token: karena `Redis` adalah class pihak ketiga
    inject: [ConfigService],            // dependency untuk factory-nya
    useFactory: (config: ConfigService): Redis => {
      const client = new Redis({ ...buildRedisOptions(config, 'cache'), maxRetriesPerRequest: 2,
                                 enableOfflineQueue: false });
      client.on('error', (err) => logger.warn(`cache redis error: ${err.message}`));
      return client;
    },
  };
  ```
  Tiga pelajaran sekaligus di sini:
  1. **`useFactory`** dipakai karena konfigurasinya baru diketahui saat runtime (dari `ConfigService`).
  2. **Token `REDIS_CLIENT`** dipakai karena satu proses bisa punya beberapa koneksi Redis dengan peran berbeda
     — dan memang begitu: throttler (`app.module.ts:64`), BullMQ (`app.module.ts:130`), cache, dan pub/sub semuanya
     punya client sendiri (`configuration.ts:69-72` menyediakan override per-peran). Tipe `Redis` saja tidak cukup
     untuk membedakannya.
  3. Komentar di baris 25-26 menjelaskan kenapa ada listener `'error'`: *"Without a listener, ioredis 'error'
     events would crash the process."* Ini alasan yang tidak akan Anda temukan di dokumentasi NestJS mana pun.

  Sekarang `@Global()`. Lihat `src/users/users.module.ts:5-10` — array `imports` **kosong**, tapi `UsersService`
  meng-inject `PrismaService` **dan** `CacheService`. Itu jalan karena `PrismaModule` (`prisma.module.ts:4`),
  `CacheModule` (`cache.module.ts:33`), `I18nModule` (`i18n.module.ts:11`), dan `MqttModule` semuanya `@Global()`.

  Rasionalnya dituliskan eksplisit di `i18n.module.ts:5-10`:
  > *"@Global so the single I18nService instance is available to every module — the request-side modules AND the
  > worker's module graph — without each adding it to its imports."*

  Perhatikan kriterianya: `@Global()` dipakai untuk **leaf infrastruktur stateless yang dibutuhkan hampir semua
  module** (DB, cache, i18n, transport MQTT). Ia **tidak** dipakai untuk feature module — `AuthModule` tetap
  mengekspor `AuthService` secara normal (`auth.module.ts:15`). Kalau semua di-`@Global()`, graph kehilangan
  seluruh nilainya dan Anda kembali ke import global biasa.

  `CacheModule` juga contoh module yang punya lifecycle sendiri (`cache.module.ts:38-43`,
  `onModuleDestroy` → `redis.quit()`), berpasangan dengan `app.enableShutdownHooks()` di `main.ts:76`.

- **Alternatif:**
  - **`useValue`** — untuk konstanta/objek yang sudah jadi. Lebih sederhana, tapi tidak bisa membaca `ConfigService`.
  - **`useClass`** — dipakai di `app.module.ts:182/187/192/198` untuk guard & filter. Bedanya dengan `useFactory`:
    Nest yang meng-instantiate + meng-inject dependency-nya (`RolesGuard` butuh `Reflector` + `PrismaService`).
  - **`useExisting`** — alias ke provider lain, untuk memberi dua nama pada satu instance.
  - **Import module secara eksplisit di setiap feature module (tanpa `@Global`)** — dependency terlihat jelas di
    tiap module. Trade-off nyata di sini: 28 module × 4 infra module = 112 baris import yang tidak menambah
    informasi apa pun, dan tetap harus diulang di graph worker.

- **Latihan:**
  Buat `src/common/clock.provider.ts` dengan token `CLOCK` dan `useValue: { now: () => new Date() }`, daftarkan di
  sebuah module `@Global()`, lalu inject ke `AuthService` dengan `@Inject(CLOCK)` dan pakai untuk mengganti tiga
  panggilan `Date.now()` di `refreshTokens()` (`auth.service.ts:191`). Jalankan `npx jest src/auth` — sekarang Anda
  bisa membekukan waktu di test tanpa `jest.useFakeTimers()`. Ini persis alasan token DI ada.

---

## 6. Konfigurasi: `ConfigModule` + `configuration()` + `validate()` fail-fast

- **Prasyarat:** Custom provider & `@Global`

- **Anchor:** `src/config/validation.ts:21-77` (fungsi yang bisa **menolak boot**) dan
  `src/config/configuration.ts:23-45` (pemetaan env → objek typed), dipasang di `src/app.module.ts:51-55`.

- **Kenapa dipakai di sini:**
  ```ts
  ConfigModule.forRoot({
    isGlobal: true,          // ConfigService tersedia di mana-mana tanpa import
    load: [configuration],   // env mentah → objek bersarang & typed
    validate,                // dijalankan saat boot; throw = proses mati
  }),
  ```
  Ada dua lapis dan keduanya penting.

  **Lapis 1 — `configuration.ts`** mengubah `process.env` (semuanya string, semuanya mungkin `undefined`) jadi
  objek bersarang dengan default: `jwt.expiresIn` default `'15m'`, `redis.port` sudah `parseInt`, dst. Efeknya
  di seluruh kode: `this.config.get<string>('jwt.secret')` (`auth.service.ts:413`), bukan
  `process.env.JWT_SECRET` yang tersebar. Satu tempat untuk mengetahui knob apa saja yang ada.

  **Lapis 2 — `validation.ts`** adalah bagian yang paling layak dicontoh. Ini bukan sekadar "cek env ada":
  ```ts
  if (config.NODE_ENV === 'production') {
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (value.length < 24 || /change|example|xxxx|placeholder/i.test(value)) {
        throw new Error(`${key} is weak or a placeholder — set a strong (>=24 char) secret in production`);
      }
    }
  ```
  Ingat `configuration.ts:41` memberi default `'change-me'` untuk `JWT_SECRET`. Default itu **nyaman untuk dev dan
  bencana untuk produksi** — jadi validator memastikan deploy produksi dengan secret default **gagal boot**, bukan
  jalan diam-diam dengan token yang bisa dipalsukan siapa pun.

  Pola yang sama diterapkan tiga kali lagi dengan alasan yang ditulis lengkap:
  - `validation.ts:45-49` — `LOADTEST_BYPASS_THROTTLE` dilarang di produksi. Ini **sabuk pengaman kedua**;
    yang pertama ada di `src/common/guards/loadtest-throttle.guard.ts:20-22` (`NODE_ENV !== 'production'`).
    Komentar di guard baris 14-15: *"The flag can never weaken a real deploy."*
  - `validation.ts:51-74` — key Stripe wajib ada di produksi, dengan alasan yang dieja: `StripeService` punya
    jalur mock tanpa signature kalau key tidak ada, jadi produksi tanpa key akan **fail open** dan menerima webhook
    palsu. *"so we fail to BOOT instead of failing open"*.

  **"Fail fast, jangan fail open"** adalah tema yang akan Anda lihat berulang di seluruh area ini.

- **Alternatif:**
  - **`dotenv` + `process.env` langsung** — nol setup. Trade-off: kesalahan ketik nama variabel jadi `undefined` yang
    diam-diam mengubah perilaku pada jam 3 pagi, bukan error saat deploy.
  - **Joi schema** (didukung `@nestjs/config` lewat `validationSchema`) — DSL lebih ringkas untuk validasi bentuk.
    Repo ini memilih `class-validator` + `plainToInstance` (`validation.ts:1-2, 22-26`) karena **sudah dipakai
    untuk DTO** (#7): satu library validasi untuk env dan untuk request body. Yang tidak bisa dilakukan Joi dengan
    rapi adalah aturan bersyarat seperti "hanya di produksi, tolak nilai yang cocok regex `/change|placeholder/`" —
    di sini itu cuma `if` biasa.
  - **Secret manager (Vault / AWS Secrets Manager / Doppler)** — secret tidak pernah menyentuh env sama sekali.
    Lebih aman, tapi menambah dependency runtime dan latency boot. `DEPLOY.md` di repo ini mengarahkan ke
    env dari platform + validator ini sebagai jaring pengaman.

- **Latihan:**
  Jalankan `NODE_ENV=production JWT_SECRET=change-me npm run start`. Amati proses mati dengan pesan yang jelas
  sebelum satu request pun diterima. Lalu tambahkan aturan Anda sendiri di `validate()`: tolak boot produksi kalau
  `CORS_ORIGINS` tidak di-set (petunjuknya ada di `configuration.ts:27-29` — unset artinya wildcard `*`). Tulis
  test-nya di `src/config/validation.spec.ts` mengikuti pola yang sudah ada di sana.

---

## 7. DTO + `ValidationPipe` + `class-validator`

- **Prasyarat:** Controller & param decorator, Decorator + metadata

- **Anchor:** `src/main.ts:57-65` (registrasi global) dan `src/auth/dto/signup.dto.ts:10-28` (DTO yang paling
  mudah dibaca). Tambahan penting: `src/common/dto/pagination.dto.ts:4-21`.

- **Kenapa dipakai di sini:**
  ```ts
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,               // buang property yang tidak ada di DTO
      forbidNonWhitelisted: true,    // atau lebih keras: TOLAK request-nya (400)
      transform: true,               // plain object → instance DTO
      transformOptions: { enableImplicitConversion: true },  // "12" → 12
      exceptionFactory: i18nValidationExceptionFactory,      // → konsep #10
    }),
  );
  ```
  Baca dari sudut pandang keamanan, bukan kenyamanan. Tanpa `whitelist`, sebuah `PATCH /users/me` dengan body
  `{"name":"x","role":"ADMIN"}` akan mengalir apa adanya ke `prisma.user.update({ data: dto })`
  (`users.service.ts:54-57`) — **privilege escalation langsung**. Dengan `whitelist: true`, `role` dibuang karena
  `UpdateProfileDto` (`src/users/dto/update-profile.dto.ts:5-26`) tidak mendeklarasikannya. Dengan
  `forbidNonWhitelisted: true`, request-nya bahkan ditolak 400 supaya klien tahu ia mengirim sesuatu yang salah.

  Pola "service percaya DTO-nya" ini yang membuat `users.service.ts:54` boleh menulis `data: dto` secara langsung.
  Itu hanya aman kalau pipe-nya global dan agresif.

  `transform: true` + `enableImplicitConversion` menjelaskan `PaginationDto`: query string selalu string, tapi
  `page?: number` dengan `@Type(() => Number)` + `@IsInt()` + `@Min(1)` + `@Max(100)` menghasilkan number yang
  sudah dibatasi. Batas `@Max(100)` itu proteksi DoS — tanpa itu `?limit=1000000` adalah full table scan.

  Perhatikan juga `PaginationDto` punya **getter** `skip` (baris 18-20). Ini bisa ada justru karena `transform:
  true` menghasilkan **instance class sungguhan**, bukan plain object. Kalau `transform: false`, `dto.skip` akan
  `undefined`.

- **Alternatif:**
  - **Zod / `nestjs-zod`** — skema adalah nilai, jadi bisa di-compose, di-`.partial()`, dan tipe TS-nya
    di-*infer* (satu sumber kebenaran). Trade-off konkret di repo ini: generator OpenAPI (`@nestjs/swagger` CLI
    plugin, `nest-cli.json:8-14`) membaca **tipe TypeScript + decorator dari file `.dto.ts`** untuk membangun
    schema otomatis. Pindah ke Zod berarti kehilangan itu atau menambah `zod-to-openapi`.
  - **Validasi manual di service** — nol dependency, tapi 351 decorator di 32 DTO input berarti ratusan `if` yang
    tersebar, dan error message-nya tidak akan seragam.
  - **`ajv` + JSON Schema** — tervalidasi paling cepat dan schema-nya portabel. Trade-off: tidak terhubung ke tipe
    TS Anda, jadi DTO dan schema bisa melenceng tanpa ketahuan compiler.
  - **`whitelist: false`** (default Nest) — request lebih permisif. Trade-off persis contoh privilege escalation di
    atas; repo ini sengaja memilih yang paling ketat.

- **Latihan:**
  Kirim `curl -X POST localhost:3000/api/v1/auth/signup -H 'Content-Type: application/json' -d
  '{"name":"A","email":"a@b.com","password":"secret1","isAdmin":true}'`. Amati 400 dengan pesan tentang
  `isAdmin`. Lalu ubah sementara `forbidNonWhitelisted` jadi `false` di `main.ts:60` dan ulangi — request lolos
  tapi `isAdmin` hilang diam-diam. Terakhir set `whitelist: false` juga, dan lihat `isAdmin` sampai ke service.
  Kembalikan keduanya. Tiga percobaan itu mengajarkan seluruh spektrum trust boundary.

---

## 8. Response envelope: `TransformInterceptor` + RxJS

- **Prasyarat:** Controller & param decorator

- **Anchor:** `src/common/interceptors/transform.interceptor.ts:15-32` — seluruh file cuma 32 baris; didaftarkan
  di `src/main.ts:69`. Test-nya di `transform.interceptor.spec.ts:13-25` memperjelas kontraknya.

- **Kenapa dipakai di sini:**
  ```ts
  intercept(_context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => ({ success: true, data, timestamp: new Date().toISOString() })),
    );
  }
  ```
  Ini titik di mana orang React biasanya tersandung, jadi mari dipetakan ke sesuatu yang Anda kenal.

  `next.handle()` **belum** menjalankan handler-nya. Ia mengembalikan `Observable` — kira-kira seperti `Promise`
  tapi bisa mengeluarkan banyak nilai dan bisa dibatalkan. Kode **sebelum** `return` = fase "sebelum handler";
  operator di dalam `.pipe()` = fase "setelah handler". Interceptor karena itu adalah **middleware dua arah** —
  sesuatu yang guard dan filter tidak bisa lakukan.

  Efek praktisnya: 96 endpoint mengembalikan objek biasa, dan **semuanya** sampai ke klien sebagai
  `{ success, data, timestamp }`. Aplikasi mobile Anda bisa menulis satu `unwrap(res)` dan selesai.

  Dua detail yang layak dicatat:
  - `transform.interceptor.spec.ts:27-36` menguji `data: null` secara eksplisit. Envelope tetap terbentuk;
    `success` tidak bergantung pada isi.
  - Karena envelope-nya *runtime*, dokumentasi OpenAPI **akan berbohong** kalau tidak ikut disesuaikan. Repo ini
    menyelesaikannya di `src/common/swagger.ts:85-131` (`applyEnvelopeAndErrors`), yang membungkus ulang setiap
    schema 2xx jadi `allOf [ApiEnvelopeDto, { data: <schema asli> }]`. Komentar baris 78-83 menyebut alasannya:
    *"so the spec matches runtime"* dan agar client codegen membaca `response.data.<field>`. Ini contoh bagus
    dari "keputusan runtime menciptakan hutang di tempat lain, dan hutang itu dibayar".

  Interceptor lain di repo ini yang bisa Anda bandingkan: `src/metrics/metrics.interceptor.ts` (mengukur durasi
  request untuk Prometheus) — pola yang sama, guna yang beda.

- **Alternatif:**
  - **Tidak pakai envelope, kembalikan resource mentah** (gaya REST puritan; status code yang membawa makna).
    Payload lebih kecil, lebih idiomatis HTTP. Trade-off: klien butuh cara membedakan sukses/gagal per-endpoint,
    dan bentuk error jadi tidak seragam.
  - **Bungkus manual di setiap controller** — eksplisit, tidak ada magic. Trade-off: 96 tempat yang bisa lupa.
  - **Middleware Express yang membungkus `res.json`** — jalan, tapi tidak *typed*, tidak punya akses ke
    `ExecutionContext` (jadi tidak bisa membaca metadata route), dan tidak jalan untuk transport non-HTTP
    (WebSocket gateway, microservice).
  - **`class-transformer` `ClassSerializerInterceptor`** — menyelesaikan masalah berbeda (menyembunyikan field
    lewat `@Exclude()`). Repo ini justru **tidak** memakainya; ia memilih `UserResponseDto.from()` eksplisit
    (`user-response.dto.ts:23`) — allowlist manual yang tidak bisa bocor kalau ada kolom baru di schema Prisma.

- **Latihan:**
  Tambahkan `requestId` ke envelope. Petunjuk: `pino-http` sudah menaruhnya di response header `X-Request-Id`
  (`app.module.ts:89-95`), jadi ubah `_context` jadi `context` dan baca `context.switchToHttp().getRequest().id`.
  Lalu update `ApiEnvelopeDto` di `src/common/swagger.ts:16-30` supaya dokumentasi ikut benar — dan sadari bahwa
  kalau Anda lupa langkah kedua, spec dan runtime jadi berbeda diam-diam.

---

## 9. `APP_FILTER` + `AllExceptionsFilter` + exception ber-key

- **Prasyarat:** Custom provider (`useClass`), DTO & ValidationPipe, Interceptor

- **Anchor:** `src/common/filters/http-exception.filter.ts:16-30` (docblock + `@Catch()`) lalu `:74-112`
  (`renderMessage`, tiga cabang). Registrasi di `src/app.module.ts:196-199`. Definisi exception di
  `src/common/exceptions/app-exception.ts:12-44`.

- **Kenapa dipakai di sini:**
  Filter adalah **jaring pengaman terluar**: apa pun yang di-throw dari mana pun akan mendarat di sini
  (`@Catch()` tanpa argumen = tangkap semua). Ia menghasilkan envelope error yang seragam:
  `{ statusCode, timestamp, path, message }`.

  Tiga hal di file ini yang tidak Anda temukan di tutorial:

  **(a) Kenapa didaftarkan sebagai `APP_FILTER`, bukan `app.useGlobalFilters()`.**
  Komentar `main.ts:67-68` menjelaskannya:
  > *"AllExceptionsFilter is registered as an APP_FILTER in AppModule (DI — it injects I18nService). Do NOT also
  > register it here, or it would run twice."*

  `app.useGlobalFilters(new X())` mengharuskan Anda `new` sendiri → tidak bisa meng-inject apa pun. Filter ini
  **butuh** `I18nService` (`http-exception.filter.ts:30`), jadi ia harus lewat DI container, dan itu berarti lewat
  provider `APP_FILTER`. Bandingkan dengan `TransformInterceptor` yang tanpa dependency, sehingga boleh
  `new TransformInterceptor()` di `main.ts:69`. **Aturan praktisnya: butuh dependency → daftarkan lewat token
  `APP_*`.**

  **(b) Kenapa service melempar *key*, bukan kalimat.**
  `app-exception.ts:12-25` mengejanya:
  > *"Instead of throwing an English literal deep in a service (where no request locale is in scope), throw a
  > stable message KEY (+ params). AllExceptionsFilter resolves the request locale at the boundary and translates
  > the key ONCE, so the I18nService stays non-request-scoped … and we don't thread locale through ~30 service
  > methods."*

  Jadi `auth.service.ts:135` menulis `throw new AppUnauthorizedException('error.auth.invalid_credentials')` — tanpa
  tahu bahasa apa pun. Ini disebut **boundary localization** dan lanjut di konsep #10.

  **(c) Kenapa `AppNotFoundException extends NotFoundException`.**
  Baris 20-22: *"Each subclass extends the matching Nest built-in, so `instanceof NotFoundException` (and
  `rejects.toThrow(NotFoundException)` in specs) still holds."* Dan cabang terakhir `renderMessage` (baris 110-111)
  melewatkan `HttpException` biasa apa adanya. Hasilnya: **migrasi bertahap yang tidak merusak apa pun** — throw
  lama tetap jalan (bahasa Inggris), throw baru terlokalisasi. Ini pelajaran rekayasa yang berlaku jauh di luar
  NestJS.

  Detail bagus lainnya: `passthrough` (`app-exception.ts:28-30`) — field mesin seperti `code`, `reasons`,
  `retryAfter` **selamat apa adanya** di samping `message` yang diterjemahkan, karena aplikasi mobile mengambil
  keputusan berdasarkan field itu. Terjemahkan `code` dan Anda merusak kontrak wire. Dan
  `http-exception.filter.ts:43` memanggil `redactTokenInUrl()` — handshake WebSocket membawa JWT di query string
  (`src/common/redact.ts:2-6`), jadi mencatat URL mentah = membocorkan token yang masih hidup.

- **Alternatif:**
  - **`try/catch` per controller** — konteks lokal maksimal. Trade-off: 96 tempat, dan yang terlupa akan
    membocorkan stack trace 500 ke klien.
  - **Error-handling middleware Express `(err, req, res, next)`** — familiar, tapi tidak punya `ArgumentsHost`
    (jadi tidak bisa menangani konteks WS/RPC) dan tidak bisa di-inject.
  - **`@Catch(HttpException)` (spesifik) + `@Catch()` (fallback)** — dua filter, penanganan lebih halus.
    Repo ini memilih satu filter dengan `if` bercabang karena ketiga cabangnya berbagi *pembangunan envelope* yang
    sama; memecahnya akan menduplikasi bagian itu.
  - **Kembalikan `Result<T, E>` alih-alih throw (gaya Rust/fp-ts)** — kegagalan jadi bagian dari tipe, tidak ada
    control flow tersembunyi. Trade-off: melawan arus seluruh ekosistem Nest (guard, pipe, dan Prisma semuanya
    throw), jadi Anda tetap butuh filter untuk yang bukan milik Anda.

- **Latihan:**
  Lempar `throw new Error('boom')` (Error JS biasa, bukan `HttpException`) di `UsersService.getStats`. Hit
  endpoint-nya: Anda dapat 500 dengan `message: "Internal server error"` — **bukan** stack trace. Baca
  `http-exception.filter.ts:78-80` untuk melihat kenapa, lalu `:53-57` untuk melihat bahwa error itu tetap dicatat
  lengkap ke log server dan dikirim ke Sentry. Ini pemisahan "apa yang klien lihat" vs "apa yang operator lihat".

---

## 10. i18n: katalog, `I18nService`, dan `i18nValidationExceptionFactory`

- **Prasyarat:** `APP_FILTER` & exception ber-key, `@Global` module, DTO & ValidationPipe

- **Anchor:** `src/i18n/i18n.service.ts:5-17` (docblock yang menjelaskan seluruh desain), lalu
  `src/common/validation/validation-exception.factory.ts:4-17` dan `:135-157`, lalu
  `src/i18n/catalog.completeness.spec.ts:8-12` dan `:51-61`.

- **Kenapa dipakai di sini:**
  Ini bagian yang paling "hanya ada di repo ini" — dan bagi Anda sebagai developer Indonesia, yang paling relevan,
  karena locale-nya memang `en` dan `id`.

  **Kenapa i18n buatan sendiri, bukan `nestjs-i18n`?** Dijawab langsung di `i18n.service.ts:5-12`:
  > *"Deliberately a plain default-scope singleton (NOT request-scoped, NOT nestjs-i18n): the primary surface —
  > delivery notifications — is produced by the BullMQ worker (SimulationProcessor), which has NO HTTP request.
  > Locale is a persisted `User.locale` resolved by userId, so translation must be a pure function of
  > (key, locale, params) usable identically in the worker loop and request handlers."*

  Ini pelajaran arsitektural yang penting: **provider request-scoped akan mematikan worker.** Notifikasi "Paket
  Anda telah tiba" diproduksi oleh job BullMQ, di proses terpisah (`src/worker.ts`), tanpa `Request` object. Kalau
  `I18nService` request-scoped, worker tidak bisa memakainya. Karena itu `translate(key, locale, params)` adalah
  **fungsi murni** dan `I18nModule` `@Global()` (konsep #5).

  **Kenapa `translate()` tidak pernah throw** (`i18n.service.ts:14-16, 31-37`): rantai fallback
  `locale diminta → English → key itu sendiri`, dan interpolasi dibungkus `try/catch`. Alasannya:
  *"so it can never break a delivery-status notification or fail a worker job."* Key yang hilang menghasilkan
  string aneh yang bisa didiagnosa, bukan job yang gagal.

  **Bagaimana error validasi ikut diterjemahkan.** Ini jembatan antara #7 dan #9, dan solusinya elegan.
  `validation-exception.factory.ts:4-9`:
  > *"A locale-AGNOSTIC ValidationPipe exceptionFactory: it maps each class-validator constraint to a stable
  > catalog key (`validation.<constraint>`) + params … One factory covers all ~351 decorators across the 32 input
  > DTOs — no per-decorator `message:` and nothing to re-edit for a new DTO."*

  Jadi `@MinLength(6)` di `LoginDto` tidak butuh `{ message: 'Password minimal 6 karakter' }`. Factory-nya
  menerbitkan `{ key: 'validation.minLength', params: { property: 'password', min: 6 } }`, dan filter
  menerjemahkannya (`http-exception.filter.ts:102-108`). Tambah DTO baru → otomatis terlokalisasi.

  Dua detail yang menunjukkan ini dipikirkan matang:
  - Angka `6` **tidak ada** di objek `ValidationError` class-validator, jadi `constraintArgs()`
    (`validation-exception.factory.ts:53-73`) membacanya dari `getMetadataStorage()` — panggilan langsung ke
    metadata store yang sama dari konsep #3. Dan dibungkus `try/catch` yang mengembalikan `[]`: *"a missing arg
    degrades to a literal {placeholder} … never a crash."*
  - Nama property **sengaja tidak diterjemahkan** (baris 11-13): *"it is the wire-contract field id the mobile app
    maps to a form field; localizing it would break that association."* Jadi pesannya berbunyi
    `"password harus minimal 6 karakter"` — kalimat Indonesia, field id Inggris. Kalau `password` ikut
    diterjemahkan jadi `kata sandi`, form mobile Anda tidak bisa lagi menyorot field yang benar.

  **Bagaimana katalog dijaga tetap lengkap.** `catalog.completeness.spec.ts` mem-*generate* daftar key yang wajib
  ada dari sumber kode (`STAGES`, enum `DeliveryFailureReason`, `FAQS`, plus `VALIDATION_KEYS`/`ERROR_KEYS`/
  `EMAIL_KEYS` di `src/i18n/catalog/keys.ts`) dan memaksa setiap locale memilikinya. Assertion baris 51-60 bahkan
  lebih ketat: `id` harus punya **persis** set key yang sama dengan `en` — sehingga key yang hilang **atau basi**
  ketahuan. Tanpa ini, per-key fallback akan diam-diam menampilkan bahasa Inggris di aplikasi berbahasa Indonesia
  dan tidak ada yang tahu. Komentar baris 8-11: *"this fails CI instead of printing a raw key in production."*

  **Dari mana locale-nya?** Presedensinya di `http-exception.filter.ts:62-72`:
  `User.locale` tersimpan → header `Accept-Language` → default. `parseLocale()`
  (`src/i18n/accept-language.ts:11-21`) sengaja sederhana — mengambil tag pertama, membuang `;q=`, membuang subtag
  region (`id-ID` → `id`). Komentar baris 15-17 mengakui batasannya secara jujur: *"RELATIVE q-ranking across tags
  is intentionally ignored (overkill for two locales)"*. Ini contoh bagus dari scope yang dibatasi **dan
  didokumentasikan**, bukan dilupakan.

- **Alternatif:**
  - **`nestjs-i18n`** — lengkap: loader file JSON/YAML, resolver dari header/query/cookie, pluralization. Trade-off
    yang menghalangi di sini: model utamanya berbasis request context, sementara konsumen terbesar terjemahan di
    repo ini adalah worker tanpa request.
  - **`i18next` / ICU MessageFormat** — dukungan plural dan gender yang benar (`"1 item" / "2 items"`, dan aturan
    plural yang rumit di banyak bahasa). Trade-off: Bahasa Indonesia tidak punya infleksi plural, dan `en`+`id`
    saja tidak cukup untuk membenarkan dependency + format ICU. Kalau nanti ditambah bahasa Arab atau Rusia,
    keputusan ini **harus** ditinjau ulang.
  - **Terjemahkan di klien** (server kirim `code`, mobile app punya katalognya) — server jadi bebas locale.
    Trade-off fatal di sini: email dan push notification dirender **di server**, jadi klien tidak selalu ada untuk
    menerjemahkan.
  - **Kalimat bahasa Inggris hardcoded** — nol infrastruktur. Trade-off: produk untuk pengguna Indonesia yang
    error-nya berbahasa Inggris.

- **Latihan:**
  Tambahkan key `'error.user.not_found'` versi ketiga: buat locale `jv` (Jawa). Anda akan menemukan bahwa
  `SUPPORTED_LOCALES` (`src/i18n/catalog/index.ts:8`) dan tipe `Locale` (baris 5) adalah satu-satunya tempat yang
  perlu diubah — lalu jalankan `npx jest src/i18n` dan lihat `catalog.completeness.spec.ts` **memberi tahu Anda
  persis key mana saja yang belum diterjemahkan**. Selesaikan sebagian saja, dan konfirmasi lewat
  `i18n.service.spec.ts` bahwa key yang belum ada jatuh ke bahasa Inggris, bukan crash.

---

## 11. Guard global: `APP_GUARD`, urutan eksekusi, `Reflector`

- **Prasyarat:** Decorator + metadata, Custom provider (`useClass`), Controller

- **Anchor:** `src/app.module.ts:176-193` — **urutan** ketiga entri `APP_GUARD` adalah keseluruhan pelajarannya.
  Lalu `src/common/guards/jwt-auth.guard.ts:12-21` dan `src/common/guards/roles.guard.ts:9-44`.

- **Kenapa dipakai di sini:**
  Ini adalah konsep tersulit di area ini dan sekaligus yang paling penting, jadi kita bongkar pelan-pelan.

  ```ts
  providers: [
    // Rate-limit first (before auth) — global per-IP throttle.
    { provide: APP_GUARD, useClass: LoadTestThrottlerGuard },   // baris 180-183
    // Apply JWT auth guard globally — use @Public() to opt out
    { provide: APP_GUARD, useClass: JwtAuthGuard },             // baris 184-188
    // Role authorization — runs after JwtAuthGuard; inert without @Roles().
    { provide: APP_GUARD, useClass: RolesGuard },               // baris 189-193
  ]
  ```

  **Guard global dieksekusi sesuai urutan deklarasinya di array `providers`.** Ini bukan detail sepele — komentar
  di baris 178-179 dan 189 menyebutnya eksplisit, dan setiap posisi punya alasan:

  1. **Throttler duluan.** Kalau auth jalan lebih dulu, penyerang yang mem-brute-force password akan memaksa
     server melakukan `bcrypt.compare` (12 salt rounds — sengaja mahal, `auth.service.ts:21`) untuk **setiap**
     tebakan sebelum ditolak rate limit. Menaruh throttle di depan berarti request ke-101 mati dengan biaya CPU
     hampir nol. Ini pertahanan DoS, bukan sekadar kebersihan kode.

  2. **Auth di tengah.** `RolesGuard` membaca `req.user?.sub` (`roles.guard.ts:31`). Field itu **hanya ada** kalau
     `JwtAuthGuard` sudah sukses. Balik urutannya dan RolesGuard akan menolak semua orang.

  3. **Roles terakhir**, dan **inert** di route tanpa `@Roles` (`roles.guard.ts:28`: `if (!required ||
     required.length === 0) return true`). Test-nya membuktikan ini bukan sekadar niat —
     `roles.guard.spec.ts:23-27`: *"is inert (true, no DB read) on a route without @Roles"* dengan assertion
     `expect(prisma.user.findUnique).not.toHaveBeenCalled()`. Kalau tidak, **setiap** request ber-auth di seluruh
     aplikasi akan menambah satu query DB.

  **Default aman.** `JwtAuthGuard` global artinya semua route terproteksi kecuali yang menandai dirinya publik.
  Ini kebalikan dari Express, dan bedanya adalah arah kegagalannya: lupa menandai → endpoint terlalu ketat
  (ketahuan langsung saat testing) vs. lupa menambah middleware → endpoint terbuka ke publik (ketahuan saat
  breach).

  **Kenapa role dibaca dari DB, bukan dari JWT.** Ini keputusan paling menarik di file ini.
  `roles.guard.ts:12-14`:
  > *"On a @Roles route it resolves the user's role FRESH from the DB (the JWT carries no role, so a demote takes
  > effect immediately) and denies by default."*

  Dan `JwtStrategy.validate` memang hanya mengembalikan `{ sub, email }` (`jwt.strategy.ts:18-20`) — role sengaja
  tidak ada. Konsekuensinya: mencabut hak admin seseorang berlaku **pada request berikutnya**, bukan setelah
  access token-nya kedaluwarsa (15 menit). Biayanya satu query per request admin — dan biaya itu dibatasi persis
  oleh sifat "inert" di atas. `current-user.decorator.ts:6-13` mendokumentasikan sisi lainnya: `role?` optional
  di `JwtPayload` justru **karena** ia diisi oleh RolesGuard, bukan oleh token.

  Trade-off simetrisnya juga tercatat, di `AUDIT-LOG.md`: *"`passwordChangedAt` / access-token revocation
  deliberately NOT done … `JwtStrategy.validate` does no I/O, so the check would add a round trip to every
  authenticated request. Residual exposure is one 15-minute access-token lifetime."* Jadi repo ini membayar query
  DB untuk **otorisasi** (jarang, hanya route admin) tapi menolak membayarnya untuk **autentikasi** (setiap
  request). Itu jenis penalaran yang harus Anda tiru.

  **Urutan guard route-level.** Guard global jalan **sebelum** `@UseGuards()` di route. Itulah kenapa
  `POST /auth/refresh` bisa `@PublicApi()` **dan** `@UseGuards(JwtRefreshGuard)` (`auth.controller.ts:55-57`) —
  guard global di-skip, guard route tetap jalan. Pola yang sama dipakai route drone: `@Public()` +
  `@UseGuards(DroneAuthGuard)` (`src/deliveries/telemetry/telemetry.controller.ts:29-30`), karena drone bukan
  user tapi tetap harus terautentikasi.

  **`@PublicApi()` vs `@Public()`.** `src/common/decorators/public-api.decorator.ts:6-16` menggabungkan dua
  decorator dengan `applyDecorators()` supaya guard dan dokumentasi *tidak bisa melenceng*:
  > *"Marks a route public for BOTH layers in lockstep (so they can't drift)"*
  `@Public()` polos disisakan untuk route ingest drone yang **key-authed, bukan terbuka** — supaya dokumentasinya
  tetap menunjukkan skema `x-ingest-key`.

- **Alternatif:**
  - **`@UseGuards(JwtAuthGuard)` per controller** — eksplisit, terlihat di file yang bersangkutan. Trade-off:
    fail-open. Controller baru = endpoint terbuka sampai seseorang ingat.
  - **Middleware autentikasi (`app.use`)** — jalan lebih awal lagi, tapi middleware tidak punya
    `ExecutionContext`, jadi **tidak bisa membaca metadata route**. Seluruh mekanisme `@Public()` mustahil; Anda
    kembali ke daftar path yang harus dirawat manual.
  - **Role di dalam JWT claim** — nol query DB, stateless murni, skalanya lebih baik. Trade-off yang sudah
    diputuskan repo ini: pencabutan hak baru berlaku setelah token kedaluwarsa. Untuk konsol operator yang bisa
    membatalkan pengiriman dan mengeluarkan refund (`admin.controller.ts:53`), jendela itu tidak diterima.
  - **CASL / RBAC berbasis policy** — aturan seperti "pemilik boleh membaca pengirimannya sendiri" jadi deklaratif.
    Repo ini melakukan pengecekan kepemilikan di dalam service, bukan di guard. Trade-off: guard tetap sederhana,
    tapi logika otorisasi jadi tersebar di dua tempat.

- **Latihan:**
  Tukar urutan `JwtAuthGuard` dan `RolesGuard` di `app.module.ts:184-193`. Jalankan `npx jest src/admin` — amati
  route admin mulai gagal. Kembalikan. Lalu hapus `@Public()` dari `IS_PUBLIC_KEY` check di
  `jwt-auth.guard.ts:18` (jadikan `if (false)`) dan panggil `POST /auth/login` — Anda dapat 401 saat mencoba login,
  paradoks yang sempurna untuk mengingat kenapa opt-out itu ada. Terakhir, tambahkan `console.log` di awal
  `canActivate` ketiga guard dan hit satu endpoint untuk **melihat** urutannya di terminal.

---

## 12. Passport JWT strategy

- **Prasyarat:** Guard global, Konfigurasi

- **Anchor:** `src/auth/strategies/jwt.strategy.ts:9-20` (21 baris, seluruh mekanisme autentikasi) dan
  `src/common/guards/jwt-auth.guard.ts:7` (`extends AuthGuard('jwt')`), disatukan di `src/auth/auth.module.ts:12`.

- **Kenapa dipakai di sini:**
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

  Alurnya, yang perlu Anda pegang utuh:
  1. `PassportStrategy(Strategy, 'jwt')` adalah **mixin factory** — ia menghasilkan base class dan mendaftarkan
     strategy dengan nama `'jwt'`. Nama itulah yang dirujuk `AuthGuard('jwt')` di `jwt-auth.guard.ts:7`. Dua file
     terhubung hanya lewat sebuah string.
  2. `super({...})` mengkonfigurasi: ambil token dari header `Authorization: Bearer`, tolak kalau kedaluwarsa,
     verifikasi dengan secret dari `ConfigService` (konsep #6 — jadi kalau secret produksi lemah, aplikasi bahkan
     tidak boot).
  3. **`validate()` hanya dipanggil kalau signature dan expiry sudah valid.** Passport yang mengerjakan kripto;
     Anda mengerjakan "apa yang mau saya taruh di `req.user`".
  4. Nilai kembalian `validate()` **menjadi `req.user`** — persis yang dibaca `@CurrentUser()`
     (`current-user.decorator.ts:19`) dan `RolesGuard` (`roles.guard.ts:31`). Sekarang rantai konsep #4, #11, dan
     #12 tersambung.

  Yang layak diperhatikan: `validate()` **tidak menyentuh database sama sekali**. Ia hanya menyalin dua field dari
  payload. Ini disengaja dan sudah dibahas di konsep #11 — nol I/O per request terautentikasi. `AUDIT-LOG.md`
  mencatatnya sebagai keputusan sadar beserta risiko sisanya (paparan 15 menit).

  Perhatikan juga bahwa `JwtStrategy` ada di `providers` `AuthModule` tapi **tidak** di `exports`
  (`auth.module.ts:14-15`). Ia tidak perlu di-inject siapa pun — cukup di-instantiate agar terdaftar ke Passport.
  Efek samping sebagai mekanisme registrasi: ini pola yang membingungkan pertama kali, jadi ingat baik-baik.

- **Alternatif:**
  - **Verifikasi `jsonwebtoken` manual di guard** — satu dependency lebih sedikit dan alurnya kelihatan.
    Trade-off: Anda menulis sendiri ekstraksi token, penanganan expiry, dan pemetaan error. Repo ini tetap butuh
    `@nestjs/jwt` untuk **menandatangani** (`auth.service.ts:412`), jadi Passport hanya menangani sisi verifikasi.
  - **Session + cookie (`express-session` + Redis store)** — bisa dicabut seketika (hapus session di Redis),
    tidak ada "token yang masih hidup 15 menit". Trade-off: stateful, dan klien di sini adalah **aplikasi native
    Capacitor**, di mana cookie jauh lebih merepotkan daripada header Bearer.
  - **Managed IdP (Auth0 / Clerk / Cognito / Supabase Auth)** — MFA, social login, dan rotasi token gratis.
    `ARCHITECTURE.md` mencantumkan *"managed IdP"* sebagai item Phase 3 yang belum dikerjakan — jadi ini bukan
    "tidak dipertimbangkan", melainkan "belum". Trade-off: vendor lock-in + biaya per MAU.
  - **Strategy Passport lain** (`passport-local` untuk login, `passport-google-oauth20`) — repo ini justru
    **tidak** memakai `passport-local`; login diproses langsung di `AuthService.login()` (`auth.service.ts:129`)
    dengan `bcrypt.compare`. Guard hanya dipakai di tempat yang benar-benar butuh, bukan di mana-mana.

- **Latihan:**
  Tambahkan `iat: payload.iat` ke nilai kembalian `validate()` dan `console.log` di controller lewat
  `@CurrentUser()`. Lalu ubah `ignoreExpiration` jadi `true`, tunggu access token 15 menit kedaluwarsa
  (atau set `JWT_EXPIRES_IN=10s` di `.env`), dan konfirmasi token mati masih diterima. Kembalikan ke `false`.
  Setelah itu baca ulang komentar `current-user.decorator.ts:7-13` dan jelaskan pada diri sendiri kenapa `role`
  tidak boleh ditambahkan di sini.

---

## 13. Refresh-token rotation, reuse detection, dan atomisitas

- **Prasyarat:** Passport JWT strategy, `APP_FILTER` & exception, Guard

- **Anchor:** `src/auth/auth.service.ts:159-203` (`refreshTokens` — rotasi + deteksi replay), `:205-220`
  (`logout` dan kenapa ia DELETE), `:370-400` (`rotateTokens` — transaksi atomik), `:277-299` (`resetPassword`
  mengakhiri semua sesi). Latar belakang wajib baca: `AUDIT-LOG.md:244-330`.

- **Kenapa dipakai di sini:**
  Ini bagian paling padat pelajaran di seluruh area, dan setiap barisnya lahir dari bug nyata yang tercatat.

  **Model dasarnya:** access token berumur pendek (15 menit, `configuration.ts:42`) + refresh token berumur panjang
  (7 hari) yang **diputar setiap dipakai**. Refresh token disimpan **hash SHA-256-nya** di tabel `refresh_tokens`
  (`auth.service.ts:304-306`) — sama seperti password, database yang bocor tidak langsung memberi sesi hidup.

  Setiap token juga punya `jti: crypto.randomUUID()` (`auth.service.ts:409`) dengan alasan yang praktis sekali:
  *"jti makes every token unique, so two tokens issued in the same second (e.g. login then an immediate refresh)
  don't collide on the stored hash."*

  **Reuse detection** (`auth.service.ts:169-185`) adalah inti keamanannya:
  ```ts
  if (record && record.revokedAt && record.userId === userId) {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null }, data: { revokedAt: new Date() },
    });
    this.logger.warn(`refresh token reuse detected for user ${userId}; revoked ${count} active token(s)`);
    throw new AppUnauthorizedException('error.auth.refresh_invalid');
  }
  ```
  Logikanya: rotasi berarti setiap token valid **tepat satu kali**. Token yang ada, milik user ini, dan sudah
  di-revoke = sedang **di-replay**. Komentarnya jujur soal batas pengetahuannya:
  > *"Either the legitimate holder is replaying a rotated token, or an attacker is using a stolen one; from here
  > the two are indistinguishable, so the safe move is to end the whole family and force a fresh login."*

  Perhatikan syarat `record.userId === userId`, dengan alasannya tertulis: *"so a stranger presenting a guessed
  hash cannot use this to log someone else out."* Tanpa itu, fitur keamanan ini justru jadi **senjata DoS**.

  **Dan sekarang bagian terbaiknya.** Fitur ini memaksa perubahan desain di tempat lain.
  `auth.service.ts:205-214` menjelaskan kenapa `logout()` **menghapus** baris, bukan menstempel `revokedAt`:
  > *"That keeps `revokedAt` meaning exactly one thing — 'superseded by rotation' — which is what makes the reuse
  > detection safe: a surviving revoked row can now ONLY be a replayed rotation, never the harmless residue of a
  > logout."*

  `AUDIT-LOG.md:301-310` mencatat skenario konkret yang ditemukan lewat review adversarial terhadap diff sendiri:
  > *"user resets on their phone → all tokens revoked → they log back in → the tablet wakes, replays its
  > pre-reset token → family-kill destroys the session they just created, and a breach warning is logged for
  > something that never happened."*

  **Atomisitas** (`auth.service.ts:370-397`) adalah bug kedua yang ditemukan review yang sama:
  > *"The revoke and the replacement insert have to co-commit. Done as two separate writes, a failure between them
  > leaves the caller holding a token that is revoked with no successor — and with reuse detection in place, their
  > next retry would then look like a replay and log out every one of their devices."*

  Perbaikannya: `$transaction([revoke lama, buat baru])`. Ini pelajaran yang berlaku universal — **menambah fitur
  keamanan mengubah konsekuensi dari bug yang sudah ada.** Rotasi tidak-atomik itu sudah lama ada dan tidak
  berbahaya; reuse detection membuatnya berbahaya.

  **Reset password mengakhiri semua sesi** (`auth.service.ts:287-298`), di transaksi yang sama dengan update
  password:
  > *"Without this a refresh token stolen before the reset stays valid for its full 7-day life and can mint access
  > tokens indefinitely by rotation — so the reset, the one action a user takes precisely BECAUSE they think they
  > are compromised, would not actually evict the attacker."*

  **`forgotPassword` tidak membocorkan keberadaan akun** (`auth.service.ts:222-255`): selalu mengembalikan
  `{ success: true }`. Dan detail yang halus di baris 230-232 — locale diambil **hanya** dari `Accept-Language`,
  tidak pernah dari user yang ditemukan, *"so the response/behavior is identical whether or not the account
  exists."* Kalau locale diambil dari user, waktu respons dan bahasa email bisa jadi oracle.

  **Mekanismenya di layer HTTP:** ada strategy Passport **kedua** — `JwtRefreshStrategy`
  (`jwt-refresh.strategy.ts:9-24`) dengan secret berbeda (`jwt.refreshSecret`) dan ekstraksi berbeda
  (`ExtractJwt.fromBodyField('refreshToken')`, bukan header). Secret yang berbeda berarti access token **tidak
  bisa** dipakai sebagai refresh token dan sebaliknya. Guard-nya cuma 5 baris (`jwt-refresh.guard.ts:4-5`) dan
  dipakai route-level di `auth.controller.ts:57`.

  Terakhir, hal yang **jujur diakui belum selesai** — `AUDIT-LOG.md:327-330`:
  > *"No rotation grace window. A client that loses the response to a successful refresh (network drop after
  > commit) still holds the old token; retrying now trips reuse detection and logs them out everywhere."*

  Untuk Anda sebagai developer mobile, ini sangat relevan: jaringan seluler Indonesia yang putus-nyambung persis
  memicu skenario ini.

- **Alternatif:**
  - **Refresh token tanpa rotasi** (satu token panjang umur) — lebih sederhana, tidak ada masalah race saat
    jaringan buruk. Trade-off: token yang dicuri berlaku 7 hari penuh dan tidak ada cara mendeteksinya.
  - **Rotasi dengan grace window (`replacedById` + jeda beberapa detik)** — cara standar industri untuk mengatasi
    masalah jaringan di atas. `AUDIT-LOG.md:328-330` menyebutnya sebagai mitigasi yang diketahui, ditunda karena
    butuh migrasi schema yang sama dengan `revokedReason`.
  - **Simpan refresh token di Redis dengan TTL, bukan Postgres** — pembersihan otomatis (tidak perlu prune
    terjadwal, yang `ARCHITECTURE.md:116` cantumkan sebagai TODO) dan lookup lebih cepat. Trade-off: hilang
    kemampuan transaksi — `resetPassword` tidak bisa lagi co-commit "ganti password" + "akhiri semua sesi" secara
    atomik.
  - **Soft-revoke dengan kolom `revokedReason`** — mempertahankan jejak audit logout. Ditolak secara eksplisit di
    `AUDIT-LOG.md:290-294`: butuh migrasi, dan *"Deleting is no weaker (an absent row fails the lookup outright)
    … The cost is losing a logout audit trail, which nothing consumed."* Catat kata terakhir itu — keputusannya
    valid **hanya karena** tidak ada yang mengkonsumsi jejak itu, dan repo ini menandai asumsi tersebut sebagai
    sesuatu yang bisa runtuh.
  - **Cookie `httpOnly` + `SameSite` untuk refresh token** — kebal XSS di web. Tidak relevan untuk klien Capacitor
    native; repo ini menaruh refresh token di body request.

- **Latihan:**
  Lakukan alur ini dengan `curl` dan amati setiap responsnya:
  1. `POST /auth/signup` → simpan `refreshToken` sebagai `$A`.
  2. `POST /auth/refresh` dengan `$A` → dapat `$B`. Berhasil.
  3. `POST /auth/refresh` dengan `$A` **lagi** → 401, dan di log server muncul
     `refresh token reuse detected`.
  4. `POST /auth/refresh` dengan `$B` → **juga** 401, karena seluruh family sudah dicabut.

  Lalu jalankan mutation test seperti yang dilakukan penulis repo: ubah `logout()` (baris 216) kembali jadi
  soft-revoke (`updateMany({ data: { revokedAt: new Date() } })`), jalankan `npx jest src/auth`, dan lihat test
  *"deletes the presented refresh token"* gagal. Tabel di `AUDIT-LOG.md:275-280` mencatat persis empat mutasi ini
  — Anda sedang mereproduksi verifikasi aslinya.

---

## 14. OpenAPI/Swagger sebagai produk sampingan dari metadata yang sama

- **Prasyarat:** Decorator + metadata, Interceptor, Guard, DTO

- **Anchor:** `src/common/swagger.ts:85-131` (`applyEnvelopeAndErrors`), `:134-169` (`buildSwaggerDocument`),
  `nest-cli.json:8-14` (CLI plugin), dan `src/common/decorators/public-api.decorator.ts:6-16`.

- **Kenapa dipakai di sini:**
  Konsep ini ditaruh terakhir karena ia **menggunakan kembali semua yang sudah Anda pelajari** dan memperlihatkan
  imbalan dari pendekatan berbasis metadata.

  Plugin `@nestjs/swagger` di `nest-cli.json` membaca **tipe TypeScript** dari file `*.dto.ts` saat build dan
  menghasilkan schema OpenAPI tanpa Anda menulis satu pun `@ApiProperty` untuk field biasa. Metadata yang sama
  yang dipakai DI (`design:paramtypes`, konsep #3) juga menjadi dokumentasi API.

  Tapi dokumentasi otomatis akan **berbohong** kalau runtime memodifikasi response — dan runtime memang
  memodifikasinya (envelope dari konsep #8). Karena itu ada `applyEnvelopeAndErrors` (`swagger.ts:85-131`) yang
  menulis ulang setiap schema 2xx jadi `allOf [ApiEnvelopeDto, { data: <schema asli> }]` dan menyuntikkan
  response error standar 400/401/500. Komentar baris 78-83: *"so the spec matches runtime … so codegen clients
  get the real shape."*

  Yang paling elegan: **status publik sebuah route hanya ditulis sekali.** `@PublicApi()`
  (`public-api.decorator.ts:16`) = `applyDecorators(Public(), ApiSecurity({}))`. Lalu `swagger.ts:114-125` membaca
  balik hasilnya:
  ```ts
  // `[{}]` (empty requirement) = a @PublicApi() route → no 401.
  const isPublic = Array.isArray(op.security) && op.security.some((r) => Object.keys(r).length === 0);
  ...
  if (!isPublic) addErr('401', 'Missing or invalid authentication');
  ```
  Guard dan dokumentasi tidak bisa melenceng karena keduanya lahir dari satu decorator. Ini adalah **penerapan
  ulang** pelajaran konsep #3 (tulis metadata sekali, baca dari banyak layer).

  Dua catatan operasional yang praktis: docs sengaja **aktif secara default** (`swagger.ts:171-177`) karena repo
  ini adalah showcase portofolio, dengan kill-switch `SWAGGER_ENABLED=false`. Dan `ARCHITECTURE.md:142`
  memperingatkan jebakan nyata: *"the swagger CLI plugin runs only during `nest build`; production serves from
  `dist/` so schemas are populated, but a ts-node run would show empty schemas."*

- **Alternatif:**
  - **Tulis spec OpenAPI manual (design-first)** — spec jadi kontrak yang disepakati sebelum kode ada, dan bisa
    di-review tim lain. Trade-off: dua sumber kebenaran yang harus dijaga sinkron secara manual. Repo ini memilih
    code-first justru karena satu-orang-satu-repo, di mana drift adalah risiko yang lebih besar.
  - **tRPC** — tanpa spec sama sekali, tipe mengalir langsung. Hanya untuk konsumen TypeScript; drone gateway dan
    Stripe bukan konsumen TypeScript.
  - **Tanpa dokumentasi, andalkan koleksi Postman** — nol build step, tapi tidak ada codegen client dan tidak ada
    yang memaksa dokumentasi ikut berubah saat kode berubah.

- **Latihan:**
  Jalankan `npm run build && npm run start:prod`, buka `http://localhost:3000/api/v1/docs`. Cari
  `POST /auth/login` — **tidak ada gembok** dan tidak ada response 401. Sekarang cari `GET /users/me` —
  ada gembok dan ada 401. Lalu ganti `@PublicApi()` di `auth.controller.ts:47` jadi `@Public()` biasa, build
  ulang, dan lihat `POST /auth/login` sekarang **salah** menampilkan gembok padahal guard-nya tetap melewatinya.
  Kembalikan. Anda baru saja melihat persis drift yang dicegah `@PublicApi()`.

---

## Rangkuman: tiga hal yang paling sering bikin tersesat

1. **"Saya tidak menemukan siapa yang memanggil `@Public()`."** Decorator hanya **menulis** metadata; guard di
   `app.module.ts` yang **membacanya**. Selalu cari pasangan tulis/baca (tabel di konsep #3).

2. **"`UsersModule` tidak meng-import apa pun, tapi bisa memakai `PrismaService`."** Karena `PrismaModule`,
   `CacheModule`, `I18nModule`, dan `MqttModule` ditandai `@Global()`. Dependency-nya nyata, hanya
   registrasi-nya yang tidak terlihat di file itu.

3. **"Kenapa urutan di array `providers` penting?"** Guard `APP_GUARD` berjalan **sesuai urutan deklarasi**.
   Throttle → JWT → Roles, dan setiap posisi punya alasan yang bisa dilanggar dengan konsekuensi nyata
   (biaya bcrypt, `req.user` yang belum ada, query DB di setiap request).

## Urutan membaca yang disarankan untuk sesi pertama

| # | File | Kenapa mulai dari sini |
|---|---|---|
| 1 | `src/main.ts` | 100 baris; seluruh pipeline terlihat dalam satu layar |
| 2 | `src/app.module.ts` | Peta sistem + urutan guard + registrasi filter |
| 3 | `src/users/users.controller.ts` + `users.service.ts` | Jalur request terpendek dari HTTP ke DB |
| 4 | `src/common/guards/jwt-auth.guard.ts` | Pasangan tulis/baca metadata terkecil (22 baris) |
| 5 | `src/common/filters/http-exception.filter.ts` | Titik pertemuan exception, envelope, dan i18n |
| 6 | `src/auth/auth.service.ts` | Logika terpadat; baca setelah lima file di atas |

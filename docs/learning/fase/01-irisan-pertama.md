# Fase 1 — Irisan pertama: endpoint saya, tabel saya, layar saya

> **Durasi** ~1,5 minggu (~18 jam) · **Mode** dari nol (sandbox `learn-nest/`, bukan Drovery) · **Repo** `learn-nest/` + `learn-web/` yang kamu buat sendiri; Drovery_Backend hanya **dibaca** (`src/users/`, `prisma/schema.prisma`, `src/prisma/`, `src/main.ts`)

---

## Kenapa fase ini ada di sini

Di Fase 0 kamu menyalakan Drovery. Kamu sudah melihat satu delivery lahir di aplikasi mobile, muncul di admin console, lalu statusnya berubah sendiri karena ada worker yang bekerja di latar. Itu bagus — sekarang kamu punya sistem yang bisa ditabrak. Tapi ada satu hal yang tidak kamu dapat dari Fase 0: rasa memiliki. Kamu tahu sistemnya jalan, kamu belum tahu kenapa jalan.

Godaan paling besar sekarang adalah langsung membuka `src/app.module.ts` Drovery dan membacanya dari atas. Jangan. File itu mengimpor 25 feature module dan memasang tiga guard global yang urutannya penting (`src/app.module.ts:48-175` dan `:176-193`). Membacanya sebelum kamu pernah menulis satu `@Module` sendiri sama dengan membaca peta kota tanpa pernah berjalan kaki di kotanya: setiap nama benar, tidak satu pun berarti. Kamu akan pulang dengan perasaan "NestJS itu sihir", dan perasaan itu bertahan berbulan-bulan.

Jadi fase ini membalik urutannya. Kamu membangun versi paling kecil dari Drovery — satu module, satu controller, satu service, satu tabel, satu layar — di sandbox `learn-nest/` yang kamu buat dari nol. Semua barisnya kamu ketik sendiri. Baru setelah versi kecilmu jalan, kamu buka file Drovery yang setara dan bilang "oh, ini yang sama, cuma lebih banyak". `src/users/users.module.ts` Drovery panjangnya 10 baris. Kalau kamu sudah menulis module 10 baris sendiri, file itu bukan lagi sihir, dia cuma file.

Alasan kedua kenapa fase ini duluan: **kamu harus melihat hasil sebelum minggu kedua**. Yang membuat orang berhenti belajar backend bukan sulitnya konsep, tapi tiga minggu mengetik tanpa satu pun layar yang berubah. Kamu sudah punya React — itu jalan pintas yang tidak dimiliki orang lain di posisimu. Kamu bisa punya "endpoint saya → tabel saya → layar saya, saling bicara" dalam 18 jam, dan kekuatan React kamu bikin bagian layarnya nyaris nol biaya. Setelah irisan itu berdiri, semua fase berikutnya adalah menebalkan irisan yang sudah ada, bukan membangun dari kabut.

Yang **mustahil** dipahami tanpa fase ini: seluruh Fase 2. Guard, interceptor, dan filter di Fase 2 semuanya adalah "sesuatu yang dipasang ke module graph dan membaca metadata yang ditulis decorator". Kalau `@Module`, provider, dan decorator masih terasa kabur, Fase 2 berubah jadi menyalin potongan kode dari dokumentasi — dan itu ketahuannya baru di Fase 4, saat sudah terlambat.

---

## Gerbang masuk

Kamu siap masuk Fase 1 kalau kamu bisa:

- [ ] Menjalankan `docker compose up` di `Drovery_Backend/` (atau jalur cadangan Postgres terkelola) dan mendapat `200` dari `curl localhost:3000/api/v1/health` — **atau** sudah punya satu `DATABASE_URL` Neon/Supabase yang terbukti bisa dipakai `npm run start:dev`. Salah satu, tidak perlu dua-duanya.
- [ ] Menyebutkan dari ingatan tiga service yang muncul di `docker compose ps` dan tebakanmu tentang fungsi masing-masing (kamu sudah menuliskannya di capstone Fase 0).
- [ ] Membuat proyek React + Vite baru dari nol (`npm create vite@latest`), menjalankannya di `:5173`, dan menaruh satu `fetch()` di dalam `useEffect` yang menampilkan hasilnya. Ini keterampilan lama kamu — kalau ini terasa berat, selesaikan dulu sebelum masuk.
- [ ] Menjelaskan beda `npm run dev` dan `npm run build` pada proyek Vite kamu sendiri, termasuk di mana hasil build-nya mendarat.
- [ ] Membaca satu blok TypeScript yang memakai `interface`, generic sederhana (`Promise<User[]>`), dan `?` untuk optional — tanpa harus mencari di Google.
- [ ] Menjalankan `psql` (atau Prisma Studio, atau GUI apa pun) dan melihat isi satu tabel. Kamu tidak perlu bisa menulis SQL; kamu perlu tahu bahwa tabel itu benda nyata yang bisa dilihat.

Kalau ada butir yang belum bisa, itu bukan alasan menunda — kecuali butir pertama. Tanpa database yang bisa dihubungi, separuh fase ini mati.

---

## Peta jalan mingguan

Total ~18 jam. Angka jam di bawah adalah jam **kerja fokus**, bukan jam duduk.

| Minggu | Fokus | Jam | Keluaran yang kelihatan |
|---|---|---|---|
| 1 (hari 1–3) | Sandbox berdiri: `nest new learn-nest`, module + controller + service pertama, latihan "404 jadi 200" | 6 | `curl localhost:3000/notes` mengembalikan array hardcoded. Catatan tertulis: file dibuat kapan → route muncul kapan |
| 1 (hari 4–7) | Prisma masuk: `schema.prisma`, model `Note`, `migrate dev`, `PrismaService` sebagai provider, DTO + `ValidationPipe` | 6 | `POST /notes` menulis baris nyata ke tabel `notes`; baris itu terlihat di `npx prisma studio`. `POST` dengan field asing ditolak `400` |
| 2 (hari 1–4) | Layar + jaring pengaman: CORS, halaman React ~60 baris, spec Jest pertama dengan Prisma palsu | 6 | Halaman di `:5173` menampilkan daftar note dari `:3000`, dan `npx jest` hijau **tanpa database menyala** |

Kalau minggu 1 hari 1–3 memakan 9 jam, itu normal — `nest new` + Postgres + `.env` adalah bagian yang paling sering rewel dan paling sedikit mengajarkan. Ambil jamnya dari hari 4–7, jangan dari minggu 2. Spec Jest yang hijau tanpa database adalah bagian yang paling banyak dipakai ulang di seluruh kurikulum.

Sebelum mulai, satu hal yang menghemat berjam-jam nanti: pastikan kamu punya tag baseline di Drovery.

```bash
cd ~/Documents/Project_Pribadi/Drovery_Backend
git tag -l | grep curriculum-baseline   # harus ada
git checkout curriculum-baseline        # opsional; semua anchor di dokumen ini merujuk ke sini
```

Semua nomor baris `file.ts:123` di dokumen ini menunjuk ke keadaan repo pada tag `curriculum-baseline`. Mulai Fase 3 kamu akan mengubah repo dan nomor-nomor itu bergeser.

---

## Konsep

Semua yang kamu **tulis** di fase ini ada di `learn-nest/` dan `learn-web/`. Semua yang kamu **baca** ada di Drovery. Urutannya sengaja: tulis versi kecilmu dulu, baru buka anchor Drovery-nya. Kalau kamu buka anchor duluan, kamu akan menyalin, dan menyalin tidak mengajarkan apa pun di fase ini.

### 1.1 Module & module graph: file tidak membuat route, `@Module` yang membuat route

Ini refleks pertama yang harus kamu buang. Di Next.js App Router, `app/notes/page.tsx` ada di disk → route `/notes` ada. Di Ionic React kamu memang menulis `<Route path="/notes" component={Notes} />` secara eksplisit, jadi kamu setengah jalan menuju model mental yang benar — tapi di sana `<Route>` dan komponennya biasanya duduk di file yang sama atau bertetangga.

Di NestJS tidak ada satu pun hubungan antara lokasi file dan URL. Kamu bisa menaruh `NotesController` di `src/aduh/wow/notes.controller.ts` dan route-nya tetap `/notes`, karena yang menentukan adalah `@Controller('notes')` di dalam file, bukan path file. Dan bahkan itu belum cukup: controller yang tidak terdaftar di `controllers:` sebuah `@Module`, dan module yang tidak masuk ke `imports:` module lain yang tersambung ke root, **tidak ada** sejauh yang aplikasi tahu. Route-nya 404.

Cara memikirkannya yang paling jujur: aplikasi Nest adalah sebuah **graph** yang disusun sekali saat boot. `AppModule` adalah akarnya. Setiap `@Module` adalah simpul yang mengumumkan tiga hal — controller apa yang saya punya, provider apa yang hidup di dalam saya, provider mana yang boleh dipinjam simpul lain (`exports`). Tidak ada satu pun dari ketiganya yang bisa disimpulkan dari struktur folder.

Kenapa repot? Karena graph yang deklaratif bisa di-boot ulang dalam konfigurasi berbeda. Drovery memanfaatkan ini dengan cara yang akan kamu lihat penuh di Fase 6, tapi buktinya sudah bisa kamu lihat sekarang.

**Anchor:**
- `src/users/users.module.ts:5-10` — module terkecil yang bisa ada di Drovery. Sepuluh baris, tiga kunci: `controllers`, `providers`, `exports`. Ini persis bentuk yang akan kamu tulis untuk `NotesModule`.
- `src/auth/auth.module.ts:11-17` — bandingkan. `providers` berisi `[AuthService, JwtStrategy, JwtRefreshStrategy]` tapi `exports` cuma `[AuthService]`. Dua strategy itu perlu **ada** di graph, tidak perlu dipinjam siapa pun. Ini bukti konkret bahwa `providers` dan `exports` adalah dua pertanyaan berbeda.
- `src/app.module.ts:48-175` — array `imports` sepanjang 127 baris. Itu peta arsitektur Drovery, dan tidak ada di tempat lain.
- `src/worker.ts:30-32` — `NestFactory.createApplicationContext(AppModule, ...)`. Perhatikan argumennya: **`AppModule` yang sama persis** dengan yang dipakai `src/main.ts:25`, tapi tanpa HTTP server sama sekali.

**Kenapa dipakai di sini:** komentar di `src/common/process-role.ts:1-13` mengeja hasilnya: *"One Docker image, four roles"* — `api`, `worker`, `realtime`, dan unset (dev: semua di satu proses). Satu image, empat peran proses, dipilih lewat env `PROCESS_ROLE`. Trik ini **mustahil** kalau module cuma "folder": yang membuat worker bisa memakai ulang seluruh service tanpa memakai ulang HTTP adalah karena graph-nya deklaratif. Kamu memberi tahu Nest apa yang ada, bukan memerintahkan Nest melakukan apa. Karena itu Nest bisa merakit ulang benda yang sama dengan bentuk berbeda.

**Alternatif:**
- **Express + folder `routes/`** — inilah yang biasanya kamu temui di tutorial Node. Kamu `app.use('/notes', require('./routes/notes'))` dan selesai; nol konsep baru, jalan dalam 10 menit. Trade-off yang bisa kamu ukur: tidak ada boundary yang dipaksakan. Di repo sebesar Drovery (346 file TS, 32 file `*.module.ts`) tidak ada apa pun yang mencegah kode `deliveries` mengimpor helper internal `payments` lalu diam-diam bergantung padanya. Dan yang paling konkret: tidak ada objek "aplikasi" yang bisa kamu boot ulang tanpa HTTP, jadi `worker.ts` harus jadi entrypoint terpisah dengan wiring-nya sendiri.
- **Fastify + plugin encapsulation** — Fastify punya konsep encapsulation juga (plugin dan scope-nya), dan throughput-nya lebih tinggi. Trade-off: DI-nya manual, kamu merakit sendiri. Menariknya Drovery **sudah** meng-install `@nestjs/platform-fastify` (lihat `package.json`) tapi `src/main.ts:25` tetap memakai adapter Express default — karena `rawBody: true` (untuk verifikasi signature webhook Stripe, `src/main.ts:22-28`) dan ekosistem middleware Express masih lebih mulus. Jadi ini bukan "Fastify lebih lambat dipilih", ini "biaya pindah lebih besar dari untungnya, hari ini".
- **NestJS monorepo mode (`apps/` + `libs/`)** — api dan worker jadi dua entrypoint yang dikompilasi terpisah. Trade-off: pemisahan lebih tegas dan bundle lebih kecil per peran, tapi kamu mengelola dua build dan dua Dockerfile. Drovery memilih satu build + flag `PROCESS_ROLE` karena "satu image, empat peran" jauh lebih murah dirawat di Kubernetes (Fase 11).

**Latihan:** ini latihan terpenting di seluruh fase; kerjakan sebelum menyentuh Prisma.

```bash
npm i -g @nestjs/cli    # atau pakai npx
nest new learn-nest     # pilih npm
cd learn-nest
```

Buat `src/notes/notes.controller.ts` dengan satu route `@Get()` yang mengembalikan `[{ id: 1, body: 'halo' }]`, dan `src/notes/notes.module.ts` yang mendaftarkannya di `controllers:`. **Jangan** tambahkan `NotesModule` ke `imports` di `src/app.module.ts`. Jalankan `npm run start:dev`, lalu:

```bash
curl -i localhost:3000/notes    # → 404
```

Sekarang tambahkan `NotesModule` ke array `imports` di `AppModule`. Simpan; watch mode me-restart:

```bash
curl -i localhost:3000/notes    # → 200 + JSON-mu
```

**Cara memverifikasi:** simpan output kedua `curl` itu (dengan `-i`, supaya status line ikut) ke `catatan/01-404-jadi-200.txt`. Itu bukti tertulis yang diminta capstone. Kamu baru saja membuktikan sendiri bahwa file tidak membuat route; module graph yang membuat route — dan kamu tidak perlu percaya siapa pun soal itu lagi.

---

### 1.2 Provider & Dependency Injection lewat constructor (tanpa satu pun `new`)

Sekarang bagian yang paling sering terasa seperti sihir, jadi pelan-pelan.

Yang kamu biasa lakukan di React: `import { api } from '../lib/api'` lalu `api.getNotes()`. Modul JS mengembalikan objek yang sama setiap kali diimpor, jadi kamu dapat singleton gratis. Sederhana, jalan, dan kamu sudah melakukannya ratusan kali.

Di Nest, `NotesService` tidak diimpor sebagai instance. Kamu menulis tipe-nya di parameter constructor, dan Nest yang membuat instance-nya lalu menyerahkannya ke kamu:

```ts
@Injectable()
export class NotesController {
  constructor(private readonly notesService: NotesService) {}
}
```

Tidak ada `new NotesService()` di mana pun. `private readonly` di parameter constructor adalah singkatan TypeScript: parameter itu otomatis jadi properti `this.notesService`. Yang membuat ini bekerja adalah dua hal: (a) `NotesService` terdaftar di `providers:` sebuah module yang terlihat dari sini, dan (b) Nest bisa membaca tipe parameter constructor saat runtime — mekanismenya konsep 1.3.

**Padanan yang jujur di dunia kamu:** tidak ada yang persis. Yang paling dekat adalah React Context: komponen anak menerima nilai tanpa tahu siapa yang menyediakannya, dan kamu bisa mengganti provider-nya saat test. Tapi Context butuh kamu membungkus pohon komponen secara eksplisit dan membaca lewat `useContext`; DI Nest membaca **tipe** parameter dan mencocokkannya sendiri. Analoginya membantu untuk "kenapa gunanya", tidak untuk "bagaimana kerjanya".

**Anchor:**
- `src/users/users.service.ts:22-25` — dua dependency di-inject lewat constructor: `PrismaService` dan `CacheService`. Baris 20 adalah `@Injectable()`-nya.
- `src/auth/auth.service.ts:30-35` — versi yang lebih ramai: empat dependency (`PrismaService`, `JwtService`, `ConfigService`, `MailService`). Cari `new` di file itu — tidak ada satu pun untuk keempatnya.
- `src/common/guards/roles.guard.spec.ts:17-21` — inilah pembayarannya, dan ini yang harus kamu lihat:

```ts
reflector = { getAllAndOverride: jest.fn() };
prisma = { user: { findUnique: jest.fn() } };
guard = new RolesGuard(reflector as any, prisma as any);
```

**Kenapa dipakai di sini:** alasan yang bisa kamu verifikasi hari ini bukan "arsitektur bersih", tapi test suite. `RolesGuard` di Drovery normalnya membaca role user dari PostgreSQL. Di spec itu ia diuji **tanpa database sama sekali** — dua objek palsu masuk lewat constructor dan selesai. Test di baris 23-27 bahkan memeriksa hal yang lebih halus: pada route tanpa `@Roles`, guard harus `return true` **tanpa membaca DB**, dan assertion-nya `expect(prisma.user.findUnique).not.toHaveBeenCalled()`.

Kalau `RolesGuard` melakukan `import { prisma } from '../db'`, seluruh strategi test itu mustahil — kamu terpaksa memakai `jest.mock()` pada level modul, yang rapuh dan gampang bocor antar-file. Drovery punya 92 file spec di `src/` berisi lebih dari seribu `it()` yang jalan dengan pola ini, tanpa database; `src/test/prisma-mock.ts:62` (`createMockPrismaService`) adalah mock bersamanya.

Alasan kedua terlihat di `src/prisma/prisma.service.ts:19-22`: `PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown`. Karena **Nest** yang memiliki instance-nya, Nest juga bisa memanggil lifecycle hook-nya — dan itu yang dipakai `src/main.ts:76` (`app.enableShutdownHooks()`) supaya rolling deploy menutup koneksi database dengan rapi, bukan meninggalkannya menggantung. Objek yang kamu `new` sendiri tidak punya siklus hidup yang dikenal siapa pun.

**Alternatif:**
- **Import singleton langsung** (`export const prisma = new PrismaClient()`, lalu `import { prisma }` di mana-mana) — nol boilerplate, nol konsep baru, dan ini yang kamu lakukan di React. Trade-off konkret: untuk menukarnya saat test kamu harus `jest.mock('../db')`, yang berarti mock berlaku per-file, harus di-reset manual, dan pesan errornya buruk saat salah. Ditambah: tidak ada tempat yang wajar untuk `disconnect()` saat shutdown.
- **Manual factory / composition root** — satu file di mana kamu merakit sendiri seluruh object graph (`const prisma = new PrismaService(); const notes = new NotesService(prisma); ...`). Eksplisit, nol magic, dan untuk sandbox 3 kelas ini justru **lebih jelas** daripada DI. Trade-off: di 32 module Drovery file itu akan jadi beberapa ratus baris yang harus diedit setiap kali ada dependency baru di mana pun. Titik impasnya ada di sekitar 10–15 kelas.
- **DI container ringan (`tsyringe`, `InversifyJS`)** — kamu dapat DI tanpa framework penuh, dan tetap boleh memakai Express. Trade-off: kamu tidak dapat guard/interceptor/filter/lifecycle yang terintegrasi dengannya, jadi saat butuh "jalankan X sebelum semua handler" kamu menulis ulang separuh Nest sendiri.

**Latihan:** di `learn-nest`, buat `src/notes/notes.service.ts` dengan `@Injectable()` dan sebuah array di memori, daftarkan di `providers:` `NotesModule`, lalu inject ke `NotesController` lewat constructor. Setelah jalan, lakukan tiga percobaan dan catat pesan errornya:

1. Hapus `@Injectable()` dari `NotesService`. Restart. (Petunjuk: mungkin masih jalan — cari tahu kenapa di konsep 1.3, dan kenapa itu tetap kebiasaan buruk.)
2. Kembalikan `@Injectable()`, lalu hapus `NotesService` dari `providers:`. Restart.
3. Kembalikan, lalu pindahkan `NotesService` ke module lain tanpa `exports`.

**Cara memverifikasi:** percobaan 2 dan 3 harus menghasilkan pesan boot yang bunyinya kira-kira `Nest can't resolve dependencies of the NotesController (?). Please make sure that the argument NotesService at index [0] is available in the NotesModule context.` Salin pesan itu ke catatanmu. Pesan ini akan kamu temui puluhan kali sepanjang kurikulum, dan tiga percobaan barusan adalah tiga penyebabnya yang paling umum.

---

### 1.3 Decorator sebagai penulis metadata: `reflect-metadata` dan `emitDecoratorMetadata`

Ini konsep paling asing untuk orang React, dan sekaligus kunci yang membuka semua sisanya. Kalau kamu hanya boleh mengingat satu hal dari Fase 1, ingat ini.

**Decorator bukan HOC dan bukan hook.** Bukan `withRouter(Component)` yang mengembalikan komponen baru. Bukan `useEffect` yang jalan pada waktu tertentu. Decorator adalah fungsi yang jalan **sekali, saat class-nya di-load**, dan tugasnya biasanya cuma satu: **menempelkan data (metadata) ke class atau method itu**. Data itu disimpan di penyimpanan global milik library `reflect-metadata`. Tidak ada "aksi" yang terjadi saat itu.

Jadi `@Public()` di atas sebuah method **tidak melakukan apa-apa sendiri**. Ia cuma menulis `{'isPublic': true}` ke method tersebut, lalu selesai. Ada pihak lain yang membacanya nanti. Kalau kamu terus mencari "siapa yang mengeksekusi `@Public()`", kamu akan mencari selamanya — tidak ada yang mengeksekusinya, ada yang **membacanya**.

Inilah kenapa aturan praktis terpenting saat membaca kode Nest adalah: **setiap decorator adalah setengah dari pasangan. Cari pasangannya.**

**Anchor:**
- `src/common/decorators/public.decorator.ts:3-4` — decorator terpendek di Drovery, dua baris:

```ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- `src/common/guards/jwt-auth.guard.ts:12-18` — **pembacanya**, di file yang sama sekali berbeda:

```ts
const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
  context.getHandler(),   // level method
  context.getClass(),     // level class
]);
if (isPublic) return true;
```

- `tsconfig.json:10-11` — `"emitDecoratorMetadata": true` dan `"experimentalDecorators": true`. Dua baris ini yang membuat konsep 1.2 mungkin.
- `src/common/decorators/current-user.decorator.ts:16-22` — jenis decorator yang berbeda: `createParamDecorator`, yang **membaca** request dan menyerahkan satu nilai ke parameter handler.

**Kenapa dipakai di sini:** `Reflector` (`src/common/guards/jwt-auth.guard.ts:8`) adalah pembaca metadata bawaan Nest. `getAllAndOverride` artinya "cek level method dulu; kalau tidak ada, cek level class" — sehingga sebuah `@Roles(Role.ADMIN)` yang dipasang di class berlaku untuk semua method di dalamnya, sementara decorator di level method bisa meng-override-nya. Tabel pasangan tulis/baca di Drovery:

| Penulis metadata | Pembacanya |
|---|---|
| `@Public()` — `src/common/decorators/public.decorator.ts:4` | `JwtAuthGuard` — `src/common/guards/jwt-auth.guard.ts:13` |
| `@Roles(...)` — `src/common/decorators/roles.decorator.ts` | `RolesGuard` — `src/common/guards/roles.guard.ts` |
| `@ApiProperty()` — mis. `src/users/dto/user-response.dto.ts:10` | generator OpenAPI — `src/common/swagger.ts` |
| **tipe TS parameter constructor** (lewat `emitDecoratorMetadata`) | **DI container Nest** |

Baris terakhir itu yang menjelaskan `emitDecoratorMetadata: true`, dan ini bagian yang harus benar-benar mendarat. Tipe TypeScript normalnya **hilang total** saat runtime — `private readonly prisma: PrismaService` di-compile jadi `constructor(prisma) { this.prisma = prisma }`, tipe-nya lenyap. Kalau tipe-nya lenyap, dari mana Nest tahu harus menyuntikkan yang mana?

Jawabannya: saat `emitDecoratorMetadata` menyala **dan** class-nya punya minimal satu decorator, TypeScript menuliskan daftar tipe parameter constructor sebagai metadata `design:paramtypes` di hasil compile-nya. Nest membaca daftar itu. Matikan flag tersebut, dan seluruh DI di konsep 1.2 berhenti bekerja dengan error yang membingungkan.

Itu juga jawaban untuk percobaan 1 di latihan sebelumnya: `@Injectable()` bisa terlihat opsional pada class yang **tidak** meng-inject apa-apa, karena tanpa decorator apa pun TypeScript tidak memancarkan `design:paramtypes` sama sekali — dan class tanpa dependency memang tidak butuhnya. Begitu class itu punya satu parameter constructor, `@Injectable()` jadi wajib. Karena itu selalu pasang, jangan menunggu error.

**Alternatif:**
- **Konfigurasi eksplisit / plain function** (gaya Express: `router.get('/x', requireAuth, handler)`) — aturannya terlihat di tempat pakainya, tidak ada "aksi jarak jauh" yang harus kamu lacak ke file lain. Trade-off yang bisa diukur: arah kegagalannya terbalik. Di Drovery default-nya **aman** — semua route ter-guard, `@Public()` untuk opt-out, jadi lupa menandai artinya endpoint terlalu ketat dan ketahuan saat testing. Di gaya Express default-nya **tidak aman** — route terbuka sampai kamu ingat menempelkan middleware, dan lupa menandai artinya endpoint terbuka ke publik sampai ada yang menemukannya.
- **TC39 Stage-3 decorators** (TypeScript 5 dengan `experimentalDecorators: false`) — ini standar masa depan yang sesungguhnya, sudah didukung TypeScript. Trade-off yang keras: standar itu **tidak mendukung `emitDecoratorMetadata`**, dan NestJS 11 (yang dipakai Drovery, lihat `package.json`) membutuhkan decorator legacy. Jadi ini bukan pilihan gaya yang bisa kamu ambil hari ini, ini constraint. Kalau kamu melihat tutorial 2026 yang bilang "jangan pakai `experimentalDecorators`", tutorial itu bukan tentang Nest.
- **Kode yang generate kode** (`ts-morph`, codegen dari OpenAPI spec) — tidak ada metadata runtime sama sekali, semuanya terlihat di file yang di-generate. Trade-off: satu langkah build tambahan yang wajib jalan sebelum kode jalan, dan diff yang berisik. Drovery memakai versi ringan dari ini untuk Swagger (`nest-cli.json` mengaktifkan plugin CLI-nya), tapi tidak untuk DI.

**Latihan:** di `learn-nest`, buat pasangan tulis/baca-mu sendiri. Ini latihan yang paling ampuh membongkar rasa "sihir".

Tulis `src/common/tag.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
export const TAG_KEY = 'tag';
export const Tag = (name: string) => SetMetadata(TAG_KEY, name);
```

Pasang `@Tag('list')` di atas method `findAll` di `NotesController`. Sekarang buat pembacanya — cara paling ringkas di sandbox: inject `Reflector` ke `NotesController` sendiri dan `console.log` hasil `this.reflector.get(TAG_KEY, this.findAll)` di dalam constructor.

**Cara memverifikasi:** `'list'` muncul di terminal saat boot, **sebelum** ada satu request pun masuk. Itu buktinya: metadata ditulis saat class di-load, bukan saat request datang. Lalu hapus `@Tag('list')` dan lihat `undefined`. Terakhir, buka `dist/notes/notes.controller.js` setelah `npm run build` dan cari string `design:paramtypes` — kamu akan melihat tipe constructor-mu tertulis di sana sebagai kode JavaScript biasa. Itu bukan sihir, itu output compiler.

---

### 1.4 Controller, routing, param decorator, dan kenapa controller sengaja dibikin tipis

Controller adalah tempat yang paling mirip dengan yang sudah kamu kenal: ia menerima HTTP dan mengembalikan data. Yang berbeda adalah **seberapa sedikit** yang boleh ada di dalamnya.

Di Express, handler biasanya penuh: parsing body, validasi, try/catch, query, memilih status code, `res.json(...)`. Di Nest, semua itu dipindahkan ke lapisan lain, dan controller cuma menerjemahkan HTTP jadi pemanggilan service. Lihat sendiri seberapa tipis.

**Anchor:**
- `src/users/users.controller.ts:8-34` — seluruh controller, 34 baris untuk tiga endpoint. Ini controller terpendek dan paling jelas di Drovery, dan bentuknya persis yang akan kamu tulis.
- `src/users/users.controller.ts:12-17` — endpoint `GET /users/me`:

```ts
@Get('me')
@ApiOkResponse({ type: UserResponseDto })
async getProfile(@CurrentUser('sub') userId: string) {
  const user = await this.usersService.getProfile(userId);
  return UserResponseDto.from(user);
}
```

- `src/users/dto/user-response.dto.ts:23-51` — `static from(user)` yang menyalin field satu per satu.
- `src/common/decorators/current-user.decorator.ts:16-22` — implementasi `@CurrentUser`.

**Kenapa dipakai di sini:** lima baris, dan perhatikan apa yang **tidak ada** di sana. Tidak ada `res.json()`. Tidak ada `try/catch`. Tidak ada status code. Tidak ada pembacaan `req.headers`. Yang di-`return` adalah objek JavaScript biasa. Yang membungkusnya jadi `{ success, data, timestamp }` adalah `TransformInterceptor` (Fase 2). Yang menangani error adalah `AllExceptionsFilter` (Fase 2). Yang mengambil user id dari token adalah `@CurrentUser('sub')`. Controller-nya sendiri cuma jembatan.

Kenapa itu penting dan bukan sekadar selera? Karena di Drovery, service dipanggil dari tempat yang **bukan HTTP**: worker BullMQ memanggil service yang sama tanpa ada request sama sekali (`src/worker.ts:30-32`, yang sudah kamu lihat di konsep 1.1). Kalau logic ada di controller, worker tidak bisa memakainya, titik. "Controller tipis" di sini bukan estetika, itu prasyarat teknis untuk arsitektur dua-proses yang kamu lihat di Fase 0.

Satu hal lagi yang layak dicatat sekarang: `UserResponseDto.from(user)` di baris 16 **bukan validasi**. Itu **allowlist keluar**. Objek dari Prisma bisa berisi kolom yang tidak boleh keluar (`passwordHash`, `stripeCustomerId`); `.from()` menyalin field satu per satu (`src/users/dto/user-response.dto.ts:38-49`) sehingga menambah kolom baru di `schema.prisma` **tidak** otomatis membocorkannya ke klien. Bandingkan dengan `return user` langsung, yang membocorkan apa pun yang kebetulan ada di objeknya. Kamu akan mengulang pelajaran ini di Fase 3.

**Alternatif:**
- **Express handler `(req, res)`** — kamu pegang kendali penuh atas response: status code, header, streaming, semuanya. Trade-off yang bisa diukur: setiap handler harus mengingat bentuk envelope-nya sendiri. Di Drovery bentuk `{success, data, timestamp}` dijamin seragam di 105 handler route justru **karena** handler tidak boleh menyentuh `res`. Konsistensi itu dibayar dengan kehilangan kendali di kasus khusus (dan untuk kasus khusus itu Nest menyediakan `@Res()`, yang begitu dipakai mematikan semua otomatisasi tadi — jadi biayanya nyata, bukan gratis).
- **tRPC** — kontrak end-to-end typed tanpa menulis DTO response, tipe mengalir dari server ke klien tanpa codegen. Trade-off yang menutup pintu di Drovery: konsumen API-nya bukan cuma aplikasi mobile TypeScript. Ada drone gateway dan ada Stripe webhook. tRPC hanya berguna untuk konsumen TypeScript.
- **Fat controller (logic langsung di controller)** — lebih sedikit file, lebih sedikit lompatan saat membaca, dan untuk `learn-nest` yang 3 endpoint itu sebenarnya wajar. Trade-off yang fatal justru di skala Drovery: worker tidak bisa memakai kembali logic yang hidup di controller, jadi kamu menduplikasinya — dan dua salinan aturan bisnis yang harus tetap sama adalah bug yang menunggu tanggal.

**Latihan:** di `learn-nest`, buat `NotesController` dengan `@Get()` dan `@Post()`, lalu tiga variasi ini dan amati bedanya:

1. `@Get(':id')` dengan `@Param('id') id: string` — panggil `curl localhost:3000/notes/abc`.
2. `@Get()` dengan `@Query('q') q?: string` — panggil `curl 'localhost:3000/notes?q=halo'`.
3. Buat param decorator sendiri, `@ClientIp()`, memakai `createParamDecorator` seperti di `src/common/decorators/current-user.decorator.ts:16-22`, yang mengembalikan `request.ip`.

**Cara memverifikasi:** untuk nomor 3, `console.log` nilai yang masuk ke handler dan panggil dari terminal — kamu akan melihat `::1` atau `::ffff:127.0.0.1`. Lalu tanyakan pada dirimu: siapa yang memanggil fungsi di dalam `createParamDecorator`? (Jawaban: Nest, saat menyiapkan argumen handler — decorator-nya sendiri cuma mendaftar, persis pola konsep 1.3.) Terakhir, hapus `async` dari salah satu handler dan kembalikan nilai biasa (bukan Promise) — perhatikan response-nya tetap sama. Nest tidak peduli kamu mengembalikan `T` atau `Promise<T>`.

---

### 1.5 DTO + `ValidationPipe` dasar: `transform` dan `whitelist`

DTO (Data Transfer Object) adalah class yang mendeskripsikan bentuk body request. Bagian yang membuatnya bekerja adalah `ValidationPipe` global — sekali dipasang di `main.ts`, dan setiap `@Body() dto: SomeDto` di seluruh aplikasi otomatis divalidasi sebelum handler dipanggil.

Padanan di dunia kamu: ini kira-kira seperti Zod schema di form React, tapi dengan dua perbedaan penting. Pertama, ia jalan di **boundary**, sekali, sebelum kodemu jalan — bukan dipanggil manual di setiap handler. Kedua, aturannya ditulis sebagai decorator di atas properti class, bukan sebagai objek schema terpisah. Alasan kedua itu bukan selera; nanti di konsep 1.11 kamu akan lihat konsekuensinya untuk dokumentasi API.

**Anchor:**
- `src/main.ts:57-65` — registrasi globalnya, dan empat opsi yang perlu kamu pahami:

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: i18nValidationExceptionFactory,   // ← Fase 2
  }),
);
```

- `src/auth/dto/signup.dto.ts:10-28` — DTO paling mudah dibaca: `@IsString()`, `@IsEmail()`, `@MinLength(6)`, `@IsOptional()`.
- `src/users/dto/update-profile.dto.ts:5-26` — DTO yang seluruhnya optional; ini yang jadi contoh bahaya di paragraf berikut.
- `src/users/users.service.ts:54-57` — `prisma.user.update({ where: { id: userId }, data: dto })`.
- `src/common/dto/pagination.dto.ts:4-21` — `@Type(() => Number)` + `@Min(1)` + `@Max(100)`, plus sebuah getter.

**Kenapa dipakai di sini:** baca `whitelist` dari sudut pandang keamanan, bukan kenyamanan. `UsersService.updateProfile` menulis `data: dto` **langsung** ke Prisma (`src/users/users.service.ts:54-57`). Tanpa `whitelist: true`, sebuah `PATCH /users/me` dengan body `{"name":"x","role":"ADMIN"}` akan mengalirkan `role` apa adanya ke `prisma.user.update` — privilege escalation dalam satu request, tanpa bug apa pun di kodemu. Dengan `whitelist: true`, `role` dibuang karena `UpdateProfileDto` (`src/users/dto/update-profile.dto.ts:5-26`) tidak mendeklarasikannya. Dengan `forbidNonWhitelisted: true`, request-nya bahkan ditolak `400` supaya klien tahu ia mengirim sesuatu yang salah, bukan diam-diam diabaikan.

Pola "service percaya DTO-nya" itulah yang membuat baris `data: dto` boleh ditulis sesantai itu. Itu hanya aman kalau pipe-nya global **dan** agresif. Kalau kamu mewarisi codebase Nest dan menemukan `data: dto`, hal pertama yang harus kamu cek adalah `main.ts`.

`transform: true` mengubah plain object hasil `JSON.parse` menjadi **instance class sungguhan**. Konsekuensinya terlihat di `PaginationDto`: ia punya getter `skip` (`src/common/dto/pagination.dto.ts:18-20`) yang menghitung `(page - 1) * limit`. Getter itu hanya ada kalau objeknya benar-benar instance `PaginationDto`. Dengan `transform: false`, `dto.skip` adalah `undefined` dan kamu akan menghabiskan setengah jam mencari tahu kenapa.

`enableImplicitConversion` menjelaskan sisanya: query string **selalu** string (`?page=2` masuk sebagai `"2"`), tapi `@Type(() => Number)` + `@IsInt()` menghasilkan `number` yang sudah divalidasi. Dan `@Max(100)` di baris 15 bukan kerapian — itu proteksi DoS. Tanpanya `?limit=1000000` adalah full table scan yang bisa dipicu siapa pun dengan satu URL.

**Alternatif:**
- **Zod / `nestjs-zod`** — schema adalah nilai biasa, jadi bisa di-compose, di-`.partial()`, di-`.pick()`, dan tipe TypeScript-nya di-*infer* dari schema (satu sumber kebenaran, bukan dua). Untuk orang React ini terasa jauh lebih alami. Trade-off konkret di Drovery: plugin CLI `@nestjs/swagger` (diaktifkan di `nest-cli.json`) membaca **tipe TypeScript + decorator dari file `*.dto.ts`** untuk membangun schema OpenAPI otomatis. Pindah ke Zod berarti kehilangan itu, atau menambah `zod-to-openapi` dan merawat jembatannya.
- **Validasi manual di service** (`if (!body.email) throw ...`) — nol dependency, nol magic, dan untuk 3 field itu memang lebih cepat ditulis. Trade-off yang bisa dihitung: Drovery punya ~510 decorator validasi tersebar di 33 file DTO input. Sebagai `if` manual itu ratusan cabang yang tersebar, dan pesan error-nya tidak akan seragam antar-endpoint — yang berarti aplikasi mobile-mu tidak bisa menanganinya dengan satu jalur kode.
- **`whitelist: false`** (default bawaan Nest, jadi ini yang kamu dapat kalau tidak menyetel apa pun) — request lebih permisif, klien lama yang mengirim field ekstra tidak pecah. Trade-off: persis contoh privilege escalation di atas. Drovery sengaja memilih setelan paling ketat dan menerima biayanya (klien harus rapi).

**Latihan:** di `learn-nest`, buat `src/notes/dto/create-note.dto.ts` dengan `@IsString()` + `@MinLength(1)` + `@MaxLength(280)` pada field `body`, dan pasang `ValidationPipe` global di `main.ts` persis seperti Drovery (tanpa `exceptionFactory` — itu Fase 2). Lalu jalankan tiga percobaan ini berurutan dan catat hasilnya:

```bash
# 1. body kosong → harus 400
curl -i -X POST localhost:3000/notes -H 'Content-Type: application/json' -d '{"body":""}'

# 2. field asing → harus 400 karena forbidNonWhitelisted
curl -i -X POST localhost:3000/notes -H 'Content-Type: application/json' -d '{"body":"halo","isAdmin":true}'

# 3. sekarang set forbidNonWhitelisted: false, ulangi nomor 2
# 4. lalu set whitelist: false juga, ulangi lagi — dan console.log dto di service
```

**Cara memverifikasi:** percobaan 3 harus lolos `201` tapi `isAdmin` **hilang** dari `dto` di service. Percobaan 4 harus lolos dan `isAdmin: true` **sampai** ke service. Tiga hasil berbeda dari tiga setelan itu adalah seluruh spektrum trust boundary dalam lima menit. Kembalikan setelan ke yang paling ketat setelah selesai.

---

### 1.6 Prisma: dari `schema.prisma` ke tabel ke client yang di-generate

Sekarang bagian yang benar-benar baru: kamu belum pernah memakai ORM, dan belum pernah mendesain schema SQL. Kabar baiknya, Prisma memisahkan tiga hal yang sering tercampur di tools lain, dan pemisahan itu justru bikin mudah dipahami.

Tiga hal itu: (1) **schema** — satu file DSL yang mendeskripsikan model; (2) **migration** — file SQL berversi yang mengubah database dari bentuk lama ke bentuk baru; (3) **generated client** — kode TypeScript yang dihasilkan dari schema, yang kamu impor sebagai `@prisma/client`. Satu perintah, `prisma migrate dev`, melakukan (2) dan (3) sekaligus, dan itu yang bikin bingung di awal.

Padanan yang paling dekat di duniamu: `schema.prisma` itu seperti file tipe TypeScript yang **juga** dieksekusi. Kamu menulis bentuk data sekali; dari situ lahir tabel nyata **dan** tipe TypeScript yang mengikat query-mu. Kalau kamu menulis `prisma.note.findUnique({ where: { titel: 'x' } })` dengan typo, TypeScript menolak compile — bukan karena ada yang menebak, tapi karena tipe itu di-generate dari schema yang sama yang membuat kolomnya.

**Anchor:**
- `prisma/schema.prisma:1-7` — dua blok yang harus ada di setiap proyek Prisma:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}
```

- `prisma/schema.prisma:17-70` — `model User`, dari `id` sampai `@@map("users")` di baris 69.
- `prisma.config.ts:4-13` — di sinilah URL database tinggal:

```ts
export default defineConfig({
  schema: path.join(__dirname, 'prisma/schema.prisma'),
  datasource: { url: process.env.DATABASE_URL },
  migrations: { seed: 'ts-node prisma/seed.ts' },
});
```

- `prisma/migrations/20260326134037_init/migration.sql:8-21` — hasil SQL-nya untuk `model User`.
- `README.md:205-233` — perintah-perintahnya, ditulis untuk manusia.

**Kenapa dipakai di sini:** perhatikan `@@map("users")` di `prisma/schema.prisma:69`. Nama model di TypeScript adalah PascalCase singular (`User`); nama tabel di database adalah snake_case plural (`users`). Dua konvensi penamaan yang berbeda dijembatani **sekali** di baris itu, bukan di setiap query. Konsisten di seluruh Drovery: `@@map("delivery_ratings")`, `@@map("promo_codes")`, dan seterusnya.

Perhatikan juga apa yang **tidak** ada di blok `datasource`: tidak ada `url`. Drovery memakai Prisma 7 (lihat `package.json`: `prisma ^7.5.0`, `@prisma/client ^7.5.0`), dan di Prisma 7 URL database dibaca dari `prisma.config.ts:7` (`process.env.DATABASE_URL`). Konsekuensi praktisnya: `schema.prisma` aman di-commit tanpa kredensial apa pun. Kalau kamu mengikuti tutorial Prisma 5 atau 6 dan menaruh `url = env("DATABASE_URL")` di dalam `datasource`, kamu akan bingung kenapa perilakunya beda. Catat ini sekarang, karena tutorial yang beredar mayoritas masih versi lama.

Yang harus kamu pegang tentang `prisma migrate dev`: ia bukan "sinkronkan database dengan schema". Ia **membandingkan** schema-mu dengan riwayat migration yang sudah ada, membuat file SQL baru berisi selisihnya di `prisma/migrations/<timestamp>_<nama>/migration.sql`, menjalankannya, lalu menjalankan `prisma generate`. File SQL itu masuk git dan itulah kebenarannya — bukan schema-mu. Buka `prisma/migrations/20260326134037_init/migration.sql:8-21` dan bandingkan baris demi baris dengan `prisma/schema.prisma:18-25`; kamu harus bisa membaca pemetaan itu dua arah sebelum lanjut ke Fase 3.

**Alternatif:**
- **TypeORM / MikroORM** — schema ditulis sebagai decorator di class entity, jadi terasa lebih "Nest-y" dan entitas sekaligus jadi model domain. Trade-off konkret: schema-nya tersebar di puluhan file entity, jadi tidak ada satu file yang bisa dibaca sebagai peta sistem — dan itu justru salah satu hal paling berharga dari `schema.prisma` Drovery. Ditambah, migration generator TypeORM secara historis jauh lebih rapuh untuk perubahan non-trivial (ubah nama kolom sering terdeteksi sebagai drop + add, yang artinya kehilangan data).
- **Drizzle ORM** — schema ditulis sebagai TypeScript murni: tidak ada DSL baru untuk dipelajari, tidak ada langkah `generate`, dan SQL yang dihasilkan jauh lebih transparan (kamu bisa membacanya di kode). Untuk orang yang sudah nyaman TypeScript, ini pilihan yang sangat masuk akal. Trade-off: tooling migration + introspeksi masih lebih mentah, dan tidak ada padanan `prisma studio` untuk mengintip data dengan cepat — yang di fase belajar seperti ini cukup berarti.
- **SQL mentah + `pg`** — kontrol penuh, nol abstraksi, nol lapisan yang harus kamu debug saat query aneh. Trade-off: tidak ada type-safety antara query dan hasilnya (kamu dapat `any`), setiap query ditulis manual, dan tidak ada migration tooling — kamu merawat sendiri urutan file SQL dan tabel penanda versinya.

**Latihan:** di `learn-nest`:

```bash
npm i @prisma/client @prisma/adapter-pg pg
npm i -D prisma
npx prisma init --datasource-provider postgresql
```

Perhatikan apa yang dibuat: `prisma/schema.prisma` dan `.env`. Sesuaikan `DATABASE_URL` ke Postgres-mu (dari `docker compose` Drovery, dari container `postgres` sendiri seperti `README.md:163-178`, atau dari Neon/Supabase — semua sama saja untuk fase ini; buat database terpisah bernama `learn_nest`, jangan pakai database Drovery).

Sekarang tulis satu model:

```prisma
model Note {
  id        String   @id @default(uuid())
  body      String
  author    String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("notes")
}
```

Jalankan `npx prisma migrate dev --name init_notes`.

**Cara memverifikasi:** tiga hal harus terjadi dan kamu harus melihat ketiganya. (a) Ada file baru di `prisma/migrations/<timestamp>_init_notes/migration.sql` — **buka dan baca**; kamu harus menemukan `CREATE TABLE "notes"` dan bisa mencocokkan setiap kolomnya ke schema-mu. (b) `npx prisma studio` membuka browser dan tabel `notes` ada di sana, kosong. (c) Di editor, ketik `prisma.` dan autocomplete menawarkan `note` — kalau tidak, jalankan `npx prisma generate` dan restart TS server editor. Lalu ubah `author String?` jadi `author String` dan jalankan `migrate dev` lagi: Prisma akan **menolak atau memperingatkan** karena kolom yang sudah ada tidak bisa jadi `NOT NULL` tanpa nilai default. Kembalikan. Itu pengalaman pertamamu dengan migration yang tidak aman, dan kamu akan mengulanginya dengan taruhan lebih besar di Fase 3.

---

### 1.7 Satu tabel: kolom, nullable, `@id @default(uuid())`, `@updatedAt`

Sekarang zoom ke dalam satu model. Empat keputusan per kolom, dan semuanya punya konsekuensi yang bisa kamu lihat.

**Anchor:**
- `prisma/schema.prisma:18-19` — `id String @id @default(uuid())` dan `email String @unique`.
- `prisma/schema.prisma:20-21` — `name String` (wajib) tepat di atas `phone String?` (opsional). Pasangan ini yang harus kamu lihat berdampingan.
- `prisma/schema.prisma:46-47` — `createdAt DateTime @default(now())` dan `updatedAt DateTime @updatedAt`.
- `prisma/migrations/20260326134037_init/migration.sql:8-21` — hasilnya di SQL: baris 11 `"name" TEXT NOT NULL` vs baris 12 `"phone" TEXT`, dan baris 20 `CONSTRAINT "users_pkey" PRIMARY KEY ("id")`.

**Kenapa dipakai di sini:** empat hal, dari yang paling sederhana.

**Tanda `?` adalah nullability, dan pemetaannya ke SQL 1:1.** Tanpa `?` → `NOT NULL`. Dengan `?` → kolom boleh `NULL`, dan di TypeScript tipenya jadi `string | null`. Buka `prisma/migrations/20260326134037_init/migration.sql:11` dan `:12` dan lihat sendiri. Ini terlihat sepele sampai kamu sadar konsekuensinya di kode: setiap kolom nullable adalah satu `if (x !== null)` yang harus ada di suatu tempat, atau satu `undefined` yang muncul di produksi.

**`@id @default(uuid())` versus auto-increment.** Drovery memakai UUID untuk semua primary key. Harganya nyata: 36 karakter (disimpan sebagai `TEXT`, lihat `prisma/migrations/20260326134037_init/migration.sql:9`) versus 4 byte untuk `SERIAL`, dan index yang lebih besar. Yang dibeli: id bisa dibuat **di sisi klien atau di sisi aplikasi sebelum menyentuh database**, tidak bocor berapa banyak baris yang kamu punya (`/deliveries/1247` memberi tahu kompetitormu volume bisnismu), dan tidak bertabrakan saat data dari beberapa sumber digabung — yang jadi penting sekali di Fase 5 saat ada tabel yang dipartisi.

**`@updatedAt` adalah fitur Prisma client, bukan fitur PostgreSQL.** Ini penting dan sering menyesatkan. Lihat `prisma/migrations/20260326134037_init/migration.sql:18`: kolomnya cuma `"updatedAt" TIMESTAMP(3) NOT NULL` — **tidak ada** trigger, tidak ada `ON UPDATE`. Yang mengisinya adalah Prisma client saat kamu memanggil `update()`. Konsekuensi yang harus kamu ingat: `UPDATE` yang dijalankan lewat `psql` atau lewat `$executeRaw` **tidak** akan memperbarui kolom itu. Bandingkan dengan `@default(now())` di baris 46 yang benar-benar jadi `DEFAULT CURRENT_TIMESTAMP` di database (`prisma/migrations/20260326134037_init/migration.sql:17`) — itu berlaku untuk semua penulis, termasuk `psql`. Satu ditegakkan database, satu ditegakkan aplikasi; kamu harus tahu yang mana.

**`@unique` adalah constraint database, dan itu berarti sesuatu.** `email String @unique` (`prisma/schema.prisma:19`) bukan validasi aplikasi. Database yang menolaknya, jadi dua request bersamaan yang mencoba mendaftar dengan email sama tidak bisa dua-duanya lolos — bahkan kalau kode aplikasimu punya race condition. Ini adalah bibit dari salah satu ide terbesar di seluruh kurikulum ini (Fase 5: "database yang memutuskan siapa yang menang"). Simpan dulu.

**Alternatif:**
- **`Int @id @default(autoincrement())`** — index lebih kecil, join lebih cepat, URL lebih pendek, dan `ORDER BY id` kebetulan berarti "urutan pembuatan". Trade-off: id-nya bisa ditebak (enumerasi `/api/v1/users/1`, `/2`, `/3` adalah serangan nyata), membocorkan volume, dan tidak bisa dibuat sebelum menyentuh database — jadi kamu tidak bisa menulis "buat objek anak lalu induknya" di memori dulu.
- **Kolom `Json` untuk field yang belum pasti bentuknya** — nol migration saat bentuknya berubah, cocok untuk payload buram. Drovery memakainya persis untuk itu (`OutboxEvent.payload`, `AdminAuditLog.before/after`). Trade-off: tidak bisa di-index dengan mudah, tidak bisa dikenai constraint, dan tidak type-safe — jadi jangan pakai untuk apa pun yang akan kamu filter di `WHERE`.
- **Timestamp diisi manual di service** (`data: { ...dto, updatedAt: new Date() }`) — eksplisit, terlihat di kode, dan berlaku di semua jalur tulis termasuk raw SQL. Trade-off: 96 tempat yang bisa lupa, dan lupa di satu tempat menghasilkan data yang bohong tanpa error apa pun.

**Latihan:** di `learn-nest`, tambahkan `author String?` ke `Note` kalau belum, lalu:

1. `npx prisma migrate dev --name add_author` dan **buka file SQL-nya**. Cocokkan setiap barisnya ke perubahan di `schema.prisma`.
2. Insert satu note lewat `npx prisma studio`, catat `updatedAt`-nya.
3. Buka `psql` (`psql $DATABASE_URL`) dan jalankan `UPDATE notes SET body = 'diubah dari psql' WHERE id = '<id-mu>';`
4. Refresh Prisma Studio.

**Cara memverifikasi:** `body` berubah, `updatedAt` **tidak**. Kalau kamu bisa menjelaskan kenapa tanpa membuka dokumen ini lagi, konsep 1.7 sudah mendarat. Lalu untuk kontras, jalankan `INSERT INTO notes (id, body) VALUES ('x1','dari psql');` — perhatikan `createdAt` **terisi otomatis**, karena itu default database. Dua eksperimen ini adalah cara tercepat memahami batas antara "ditegakkan database" dan "ditegakkan aplikasi".

---

### 1.8 `PrismaService` sebagai provider yang di-inject (dan kenapa belum `@Global`)

Kamu sudah punya DI (1.2) dan sudah punya Prisma client (1.6). Sekarang menyambungkannya, dan sambungannya adalah satu class kecil.

Idenya: `PrismaService extends PrismaClient`. Karena mewarisi, objek yang kamu inject **adalah** client-nya — `this.prisma.note.findMany()` bekerja langsung, tanpa `this.prisma.client.note`. Yang ditambahkan cuma dua hal: `@Injectable()` supaya Nest bisa mengelolanya, dan lifecycle hook supaya koneksi dibuka/ditutup pada waktu yang tepat.

**Anchor:**
- `src/prisma/prisma.service.ts:19-22` — deklarasi class-nya: `extends PrismaClient implements OnModuleInit, OnApplicationShutdown`.
- `src/prisma/prisma.service.ts:30-35` — constructor: membuat `Pool` dari `pg` dengan batas `max`, lalu `super({ adapter: new PrismaPg(pool), omit: READER_OMIT })`.
- `src/prisma/prisma.service.ts:110-130` — `onModuleInit()` → `await this.$connect()`.
- `src/prisma/prisma.service.ts:132-149` — docblock `onApplicationShutdown`, dan ini yang paling berharga di file itu.
- `src/prisma/prisma.module.ts:4-9` — sembilan baris, dan `@Global()` di baris 4. **Kamu belum akan memakai ini.**

**Kenapa dipakai di sini:** dua hal yang layak kamu hafal sekarang, walau efek penuhnya baru terasa di Fase 3 dan 11.

**Connection pool.** Komentar di `src/prisma/prisma.service.ts:31-32` menyebutkan batasannya: *"Bound the per-instance primary pool. With N replicas, N × max must stay under Postgres `max_connections` — or point DATABASE_URL at PgBouncer."* Ini konsep baru buatmu: server **tidak** membuka koneksi database baru per request. Ia meminjam dari kolam terbatas (default 10, dari `DATABASE_POOL_MAX`). Jumlah pod × `max` adalah anggaran koneksi nyata yang punya plafon keras di sisi PostgreSQL. Ini adalah mode kegagalan autoscaling yang paling klasik, dan `src/config/configuration.ts:33-37` menyebutnya dengan kalimat itu persis.

**Kapan menutup koneksi.** Docblock di `src/prisma/prisma.service.ts:132-145` adalah cerita bug sungguhan, dan kalimat kuncinya:

> *"Disconnecting in onModuleDestroy therefore pulled the database out from under every job still draining — so each deploy killed the in-flight work that `enableShutdownHooks` exists to protect."*

Nest menjalankan `onModuleDestroy` → `beforeApplicationShutdown` → `onApplicationShutdown`, dan `@nestjs/bullmq` menutup worker-nya di fase terakhir. Menutup Prisma di fase pertama berarti menarik database dari bawah kaki setiap job yang masih menyelesaikan diri. **Urutan shutdown itu nyata dan bisa merusak data.** Kamu tidak butuh ini di sandbox, tapi ingat bahwa kalimat itu ada — kamu akan kembali ke sini di Fase 6 dan Fase 10.

**Dan sekarang bagian yang harus kamu tahan diri untuk tidak menyalin.** `src/prisma/prisma.module.ts:4` punya `@Global()`. Artinya `PrismaService` tersedia di seluruh aplikasi tanpa module mana pun perlu meng-import `PrismaModule` — itulah kenapa `src/users/users.module.ts:5-10` punya array `imports` yang **kosong** padahal `UsersService` memakai `PrismaService`.

Di sandbox-mu, **jangan** pakai `@Global()`. Import `PrismaModule` secara eksplisit di `NotesModule`. Alasannya pedagogis dan spesifik: kalau kamu memulai dengan `@Global()`, kamu tidak akan pernah merasakan error "Nest can't resolve dependencies", dan kamu tidak akan pernah benar-benar mengerti apa yang `@Global()` selesaikan. Fase 2 akan mengajarkan `@Global()` sebagai **jawaban atas rasa sakit yang sudah kamu alami**, bukan sebagai mantra yang kamu salin duluan.

**Alternatif:**
- **`new PrismaClient()` di setiap service** — nol wiring, langsung jalan. Trade-off yang terukur: setiap instance membuka pool-nya sendiri. Lima service = lima pool = 50 koneksi dari satu proses dengan default `max: 10`. PostgreSQL default `max_connections` adalah 100. Ini kesalahan pemula paling umum dan gejalanya muncul sebagai `too many clients already` di bawah beban, bukan saat development.
- **Pool di sisi database (PgBouncer)** alih-alih pool di aplikasi — memusatkan anggaran koneksi, wajib begitu jumlah pod banyak (Drovery memakainya di `docker-compose.yml`). Trade-off: mode `transaction` PgBouncer melarang prepared statement tertentu dan session state, jadi ada fitur yang harus kamu hindari. Ini akan jadi bahasan penuh di Fase 10.
- **Driver adapter (`@prisma/adapter-pg`, yang dipakai Drovery di `src/prisma/prisma.service.ts:35`) vs engine bawaan Prisma** — adapter memakai driver `pg` Node, jadi pool-nya bisa kamu konfigurasi langsung dan cocok untuk lingkungan serverless. Trade-off: engine bawaan (Rust) punya pooling sendiri yang lebih cepat untuk beberapa beban tapi jauh lebih sedikit knob-nya. Untuk sandbox, pakai adapter — sama dengan Drovery, jadi tidak ada yang perlu kamu terjemahkan nanti.

**Latihan:** di `learn-nest`, buat `src/prisma/prisma.service.ts` dan `src/prisma/prisma.module.ts` versi minimal:

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

```ts
@Module({
  providers: [PrismaService],
  exports: [PrismaService],       // TANPA @Global()
})
export class PrismaModule {}
```

Import `PrismaModule` di `NotesModule`, inject `PrismaService` ke `NotesService`, ganti array in-memory dengan `this.prisma.note.findMany()` dan `this.prisma.note.create({ data: dto })`.

**Cara memverifikasi:** `POST /notes` lalu refresh `npx prisma studio` — barisnya ada. Sekarang **hapus** `PrismaModule` dari `imports:` `NotesModule` dan restart: aplikasi gagal boot dengan `Nest can't resolve dependencies of the NotesService`. Kembalikan. Terakhir, tambahkan `console.log('prisma constructed')` di constructor `PrismaService` dan hit dua endpoint berbeda — log itu muncul **sekali saja**, karena provider default-nya singleton per aplikasi. Tiga eksperimen itu menutup konsep 1.2 dan 1.8 sekaligus.

---

### 1.9 CORS + `fetch` dari halaman React Vite biasa

Ini bagian yang paling nyaman buatmu, dan sengaja ditaruh di sini supaya kamu punya sesuatu untuk dilihat, bukan cuma sesuatu untuk di-`curl`.

Satu hal yang baru: CORS. Kamu mungkin pernah menabraknya di Ionic, tapi biasanya di Ionic kamu **tidak** menabraknya — aplikasi Capacitor di Android berjalan dari `https://localhost` atau origin custom dan sering tidak dikenai preflight untuk request sederhana, dan waktu `ionic serve` kamu biasanya sudah punya dev proxy. Sekarang kamu berdiri di sisi server, jadi kamu harus mengerti apa yang sebenarnya terjadi.

Aturannya begini: browser (bukan server) menolak respons dari origin berbeda kecuali server itu **mengizinkannya secara eksplisit lewat response header**. `http://localhost:5173` (Vite) dan `http://localhost:3000` (Nest) adalah dua origin berbeda — port beda sudah cukup. Jadi tanpa CORS di sisi Nest, `fetch` dari halaman React-mu gagal, sementara `curl` ke endpoint yang sama berhasil sempurna. Perbedaan itulah yang bikin orang menghabiskan sore mengejar hantu.

**Anchor:**
- `src/main.ts:42-53` — konfigurasi CORS Drovery, dan komentarnya menjelaskan satu jebakan langsung:

```ts
// CORS — use an allowlist (with credentials) when configured; otherwise a
// wildcard WITHOUT credentials (browsers reject `*` + credentials).
const corsOrigins = config.get<string>('corsOrigins');
app.enableCors(
  corsOrigins
    ? { origin: corsOrigins.split(',').map((o) => o.trim()),
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', credentials: true }
    : { origin: '*', methods: 'GET,HEAD,PUT,PATCH,POST,DELETE' },
);
```

- `src/config/configuration.ts:27-29` — dari mana `corsOrigins` datang, beserta pengakuannya: *"Unset → wildcard (fine for the native app; lock down before a web client)."*

**Kenapa dipakai di sini:** dua pelajaran dalam satu blok pendek.

Pertama, **`origin: '*'` dan `credentials: true` tidak bisa berdampingan** — browser menolaknya, spesifikasinya begitu. Jadi Drovery bercabang: kalau `CORS_ORIGINS` di-set, pakai allowlist **dengan** credentials; kalau tidak, pakai wildcard **tanpa** credentials. Ini bukan kerapian, ini menghindari konfigurasi yang secara diam-diam tidak berfungsi di browser.

Kedua, dan ini yang menarik untuk kamu sebagai developer mobile: komentar di `src/config/configuration.ts:28` mengakui bahwa wildcard "fine for the native app". Kenapa? Karena aplikasi native Capacitor/Expo **bukan browser** — CORS sepenuhnya adalah mekanisme browser, dan HTTP client native mengabaikannya. Jadi API yang bekerja sempurna dari aplikasi Android-mu bisa saja belum pernah menghadapi CORS sama sekali. Begitu ada admin console berbasis web (Drovery punya, di Fase 12), barulah `CORS_ORIGINS` harus di-set. Fakta ini menjelaskan kenapa banyak backend mobile-first punya konfigurasi CORS yang malas.

**Alternatif:**
- **Dev proxy di Vite** (`server.proxy` di `vite.config.ts` yang meneruskan `/api` ke `:3000`) — browser hanya melihat satu origin, jadi CORS tidak pernah terjadi. Ini yang sering dipakai tim frontend dan sangat nyaman. Trade-off konkret: proxy itu **hanya ada saat `npm run dev`**. Di produksi, hasil `npm run build` di-serve dari server lain dan masalah CORS muncul di sana — pertama kali, saat deploy. Kamu memindahkan masalahnya, bukan menyelesaikannya.
- **Satu origin di produksi lewat reverse proxy** (nginx/Caddy yang menyajikan static frontend di `/` dan mem-proxy `/api` ke backend) — ini yang dipakai Drovery di produksi, dan CORS jadi benar-benar tidak relevan karena semuanya satu origin. Trade-off: butuh satu komponen infrastruktur lagi untuk dikonfigurasi dan di-debug. Kamu akan membangunnya sendiri di Fase 10.
- **`origin: '*'` selamanya** — nol konfigurasi, jalan di mana-mana. Trade-off: setiap situs web di internet bisa memanggil API-mu dari browser pengunjungnya. Untuk API yang semua endpoint-nya butuh `Authorization: Bearer` itu risikonya terbatas (penyerang tetap butuh token), tapi begitu ada satu endpoint yang mengandalkan cookie, wildcard jadi lubang nyata — dan itulah kenapa browser melarang wildcard + credentials sejak awal.

**Latihan:** buat `learn-web` di sebelah `learn-nest`:

```bash
npm create vite@latest learn-web -- --template react-ts
cd learn-web && npm i && npm run dev     # :5173
```

Tulis `src/App.tsx` sekitar 60 baris: satu `useState` untuk daftar note, satu `useEffect` yang `fetch('http://localhost:3000/notes')`, satu `<form>` yang `POST` ke endpoint yang sama, dan re-fetch setelah sukses. Ini kode yang sudah kamu kuasai — tulis cepat, jangan dipercantik.

Jalankan **tanpa** memanggil `app.enableCors()` di `learn-nest/src/main.ts` dulu.

**Cara memverifikasi:** buka DevTools tab Console — kamu harus melihat pesan yang kira-kira berbunyi `Access to fetch at 'http://localhost:3000/notes' from origin 'http://localhost:5173' has been blocked by CORS policy`. Sekarang buka tab Network dan klik request-nya: **statusnya `200`**. Server menjawab dengan benar; browser yang membuang jawabannya. Pahami betul perbedaan itu — ini penyebab nomor satu dari "tapi di Postman jalan!". Sekarang tambahkan `app.enableCors({ origin: 'http://localhost:5173' })`, restart, refresh. Jalan. Lalu ubah origin-nya jadi `http://localhost:5174` dan lihat gagal lagi: bukti bahwa yang dicocokkan adalah string origin yang persis.

---

### 1.10 Unit test pertama: mock Prisma lewat constructor, tanpa database

Sekarang kamu memanen investasi dari konsep 1.2. Ini bagian yang paling banyak dipakai ulang di seluruh kurikulum, jadi kerjakan sungguh-sungguh walau terasa seperti pekerjaan tambahan.

Pertanyaannya sederhana: bagaimana menguji `NotesService.create()` tanpa database menyala? Kalau service-mu melakukan `import { prisma } from './db'`, jawabannya "dengan susah payah, lewat `jest.mock`". Karena service-mu menerima Prisma lewat constructor, jawabannya "berikan saja objek palsu".

**Anchor:**
- `src/common/guards/roles.guard.spec.ts:17-21` — versi paling telanjang, tanpa Nest sama sekali:

```ts
reflector = { getAllAndOverride: jest.fn() };
prisma = { user: { findUnique: jest.fn() } };
guard = new RolesGuard(reflector as any, prisma as any);
```

- `src/common/guards/roles.guard.spec.ts:23-27` — test yang membuktikan sesuatu yang tidak terlihat dari kode: guard **tidak membaca DB** pada route tanpa `@Roles`, dan assertion-nya `expect(prisma.user.findUnique).not.toHaveBeenCalled()`.
- `src/users/users.service.spec.ts:26-39` — versi yang memakai testing module Nest:

```ts
const module: TestingModule = await Test.createTestingModule({
  providers: [
    UsersService,
    { provide: PrismaService, useValue: prisma },
    { provide: CacheService, useValue: cache },
  ],
}).compile();
```

- `src/users/users.service.spec.ts:45-60` — bentuk assertion-nya: bukan cuma "hasilnya benar", tapi juga "Prisma dipanggil dengan argumen yang persis".
- `src/test/prisma-mock.ts:62` — `createMockPrismaService()`, mock bersama yang dipakai puluhan spec di Drovery.

**Kenapa dipakai di sini:** perhatikan bahwa ada **dua** gaya dan keduanya sah.

Gaya pertama (`roles.guard.spec.ts`) adalah `new` biasa. Tidak ada Nest, tidak ada DI container, tidak ada `await compile()`. Cepat, jelas, dan cocok kalau yang diuji cuma satu class. Ini pengingat penting: DI tidak membuat class-mu ajaib — ia tetap class TypeScript biasa yang bisa kamu `new` sendiri kapan pun.

Gaya kedua (`users.service.spec.ts`) memakai `Test.createTestingModule` dengan `{ provide: X, useValue: mock }`. Ini merakit graph mini lewat DI container sungguhan, jadi kalau nanti `UsersService` menambah dependency baru, test ini akan gagal dengan pesan yang sama seperti aplikasi sungguhan — bukan `undefined is not a function` yang misterius.

Yang harus mendarat: `{ provide: PrismaService, useValue: prisma }` artinya "kalau ada yang minta `PrismaService`, kasih objek ini". Persis mekanisme yang sama yang dipakai `src/app.module.ts:180-193` untuk memasang guard global (`{ provide: APP_GUARD, useClass: ... }`). Kamu sedang belajar dua hal sekaligus, dan Fase 2 akan menagih yang kedua.

Perhatikan juga bentuk assertion di `src/users/users.service.spec.ts:52-55`: bukan cuma hasilnya benar, tapi `expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, omit: { passwordHash: true } })`. Test itu mengunci **bagaimana** service bertanya ke database, bukan cuma jawabannya. Kalau seseorang menghapus `omit: { passwordHash: true }`, test itu merah — dan itulah satu-satunya alasan test tersebut ada.

**Alternatif:**
- **Integration test dengan database sungguhan** (Testcontainers, atau satu Postgres khusus test) — menguji apa yang benar-benar terjadi, termasuk constraint, transaksi, dan SQL yang salah ketik. Trade-off yang terukur: 92 file spec Drovery (1.000+ test) jalan dalam hitungan detik tanpa DB; versi database-nyata akan butuh menit dan sebuah Docker daemon di setiap mesin developer + CI. Jawaban yang benar bukan salah satu — Drovery punya keduanya (`npm test` dan `npm run test:e2e` dengan config terpisah di `test/jest-e2e.json`), tapi piramidanya jelas: banyak unit, sedikit e2e.
- **`jest.mock('@prisma/client')` di level modul** — jalan bahkan untuk kode yang mengimpor singleton langsung, jadi ini penyelamat untuk codebase warisan. Trade-off: mock berlaku untuk seluruh file, harus di-reset manual antar-test, dan hoisting-nya (jest memindahkan `jest.mock` ke atas file) menghasilkan error yang sangat membingungkan saat salah urutan. Kamu memilih DI justru supaya tidak butuh ini.
- **`prisma-mock` / in-memory adapter dari pihak ketiga** — perilakunya lebih dekat ke Prisma sungguhan (`where`, `include` benar-benar bekerja), jadi test-nya lebih sedikit setup. Trade-off: kamu sekarang bergantung pada seberapa setia library itu meniru Prisma, dan ketidaksetiaannya muncul sebagai test yang hijau padahal produksi merah. Drovery memilih mock buatan sendiri yang **bodoh dan eksplisit** (`src/test/prisma-mock.ts`) justru karena kebodohannya membuat setiap ekspektasi harus ditulis.

**Latihan:** di `learn-nest`, buat `src/notes/notes.service.spec.ts`. Jest sudah terpasang oleh `nest new`, jadi langsung tulis:

```ts
describe('NotesService', () => {
  let service: NotesService;
  let prisma: { note: { findMany: jest.Mock; create: jest.Mock } };

  beforeEach(() => {
    prisma = { note: { findMany: jest.fn(), create: jest.fn() } };
    service = new NotesService(prisma as any);
  });

  it('mengembalikan note terbaru lebih dulu', async () => {
    prisma.note.findMany.mockResolvedValue([{ id: '1', body: 'a' }]);
    const result = await service.findAll();
    expect(result).toHaveLength(1);
    expect(prisma.note.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
    });
  });
});
```

Lalu tulis versi kedua dari spec yang sama memakai `Test.createTestingModule` + `{ provide: PrismaService, useValue: prisma }`, meniru `src/users/users.service.spec.ts:26-39`.

**Cara memverifikasi:** tiga langkah, dan langkah ketiga yang paling penting. (a) `npx jest` hijau. (b) **Matikan Postgres** (`docker stop <container>`) dan jalankan `npx jest` lagi — tetap hijau. Kalau merah, service-mu masih menyentuh database dari suatu tempat, dan itu temuan yang berharga. (c) Sekarang **rusak kodenya**: hapus `orderBy: { createdAt: 'desc' }` dari service. Test harus **merah**. Kalau tetap hijau, test-mu tidak menguji apa pun dan harus diperbaiki sekarang. Teknik "rusak dulu, lihat test-nya mati" ini disebut mutation testing, dipakai berulang mulai Fase 3, dan ia satu-satunya cara membuktikan sebuah test punya nilai.

---

### 1.11 Alternatif yang dibandingkan: Express, Fastify, tsyringe, Drizzle/TypeORM/SQL mentah

Kamu minta tahu **kenapa** sebuah teknologi dipilih dan apa alternatifnya. Konsep ini adalah tempat untuk menjawabnya dengan jujur — dan yang paling jujur adalah: sebagian besar keputusan di Drovery bisa berbeda, dan hasilnya tetap sistem yang baik. Yang tidak boleh berbeda adalah **kesadaran** tentang apa yang ditukar.

Cara memakai bagian ini: setelah irisanmu jalan, kamu sudah punya pengalaman langsung dengan satu jalur. Sekarang bandingkan dengan jalur lain menggunakan pengalaman itu sebagai patokan, bukan menggunakan opini orang di internet.

**Anchor:**
- `package.json` — perhatikan dua baris yang berdampingan di `dependencies`: `@nestjs/platform-express` **dan** `@nestjs/platform-fastify`. Keduanya terpasang.
- `src/main.ts:25-28` — dan yang dipakai tetap default (Express), dengan alasan tertulis di komentar baris 22-24: `rawBody: true` untuk verifikasi signature webhook Stripe.
- `prisma/schema.prisma:1-7` + `prisma.config.ts:4-13` — pilihan Prisma dan bentuk konfigurasinya.
- `src/users/users.module.ts:5-10` — 10 baris ini adalah "harga" dari NestJS: boilerplate yang tidak ada di Express.

**Kenapa dipakai di sini:** empat perbandingan yang benar-benar relevan untuk keputusan yang dibuat Drovery.

**NestJS vs Express + folder `routes/`.** Yang dibeli NestJS: module graph yang bisa di-boot ulang tanpa HTTP (bukti: `src/worker.ts:30-32`), DI yang membuat seribu lebih test jalan tanpa database, dan default aman lewat guard global (Fase 2). Yang dibayar: boilerplate seperti `src/users/users.module.ts:5-10` di setiap fitur, dan sekitar dua minggu belajar. **Titik impasnya**: kalau proyekmu punya satu proses, kurang dari ~10 endpoint, dan tidak ada background job, Express menang telak. Drovery punya empat peran proses dan 105 handler route. Ini bukan pilihan selera, ini pilihan skala.

**Express vs Fastify sebagai adapter.** Fastify lebih cepat (secara benchmark, sekitar 2x untuk JSON kecil) dan punya validasi berbasis JSON Schema bawaan. Drovery **sudah** meng-install-nya tapi tidak memakainya, dan alasannya bisa kamu baca di `src/main.ts:22-24`: `rawBody: true` untuk Stripe. Pelajarannya bukan "Fastify kalah" — pelajarannya adalah **satu kebutuhan integrasi bisa mengunci pilihan platform**, dan biaya pindah lebih besar dari untungnya selama bottleneck-nya bukan di HTTP parsing. Kamu akan mengukur di mana bottleneck sebenarnya di Fase 11.

**DI penuh (Nest) vs DI container ringan (`tsyringe`) vs tanpa DI.** `tsyringe` memberi kamu `@injectable()` + `container.resolve()` dalam 30 baris setup, jalan di atas Express, dan tidak memaksa struktur apa pun. Itu titik tengah yang nyata. Yang hilang: guard/interceptor/filter/lifecycle yang terintegrasi. Uji sendiri dengan pertanyaan konkret: kalau kamu ingin "semua route ter-proteksi kecuali yang ditandai publik" (yang Drovery dapat dari `src/app.module.ts:184-188`), berapa banyak kode yang harus kamu tulis di tsyringe + Express? Jawabannya cukup banyak, dan begitu ditulis, kamu punya setengah Nest yang harus kamu rawat sendiri.

**Prisma vs Drizzle vs TypeORM vs SQL mentah.** Sudah dibahas di konsep 1.6, tapi satu tambahan yang baru terasa nanti: mulai Fase 5, Drovery memakai **table partitioning** — dan itu adalah tempat di mana Prisma paling terasa membatasi (ada hal yang harus ditulis sebagai raw SQL di dalam file migration, dan `prisma db pull` jadi terlarang). Kalau kamu memilih Drizzle, sebagian batasan itu hilang karena SQL-nya memang kamu tulis sendiri. Jadi perbandingan yang jujur bukan "Prisma lebih baik", tapi "Prisma menukar kontrol dengan type-safety dan tooling, dan tukarannya paling terasa mahal di ujung-ujung yang tidak standar".

**Alternatif:** (untuk konsep ini, alternatifnya adalah **cara memutuskan**, bukan teknologi lain)
- **Memutuskan dari benchmark** — objektif dan bisa diulang. Trade-off: benchmark HTTP hampir tidak pernah jadi bottleneck aplikasi nyata. Drovery menghabiskan waktu jauh lebih banyak di query database dan panggilan jaringan daripada di parsing HTTP, jadi memilih framework berdasarkan requests-per-second adalah mengoptimalkan bagian yang salah. (Kamu akan mengukurnya sendiri, dengan angka dari mesinmu, di Fase 11.)
- **Memutuskan dari "apa yang sudah dipakai tim"** — mengurangi risiko nyata (dukungan, code review, onboarding). Trade-off: mengunci kamu ke keputusan lama yang mungkin sudah tidak cocok, dan tidak memberi alasan yang bisa dipertahankan saat ditanya. Drovery adalah repo satu orang, jadi tuas ini tidak ada — yang justru membuat setiap keputusannya harus dibenarkan sendiri, dan itulah kenapa komentarnya sepadat itu.
- **Memutuskan dari mode kegagalan** — tanya "kalau ini salah, bagaimana cara saya tahu?" Ini yang dipakai berulang di Drovery: guard global dipilih karena lupa menandai menghasilkan endpoint yang terlalu ketat (ketahuan saat test), bukan endpoint terbuka (ketahuan saat breach). Trade-off: cara ini menghasilkan sistem yang lebih aman tapi lebih ketat, dan sesekali menghalangi hal yang sebenarnya sah.

**Latihan:** tulis satu halaman perbandingan, `catatan/01-alternatif.md`, dengan struktur ini — **pakai angka dan pengalaman dari sandbox-mu sendiri, bukan dari internet**:

| Keputusan | Yang dipilih Drovery | Alternatif terkuat | Yang dibeli | Yang dibayar | Kapan saya akan memilih beda |
|---|---|---|---|---|---|
| Framework HTTP | NestJS + Express | Express polos | | | |
| Cara merakit objek | DI container Nest | import singleton | | | |
| Akses database | Prisma | Drizzle | | | |
| Validasi input | class-validator DTO | Zod | | | |

Untuk kolom "yang dibayar", hitung sungguhan: berapa file yang harus kamu buat di `learn-nest` untuk satu endpoint `GET /notes`? (Jawaban: 4 — module, controller, service, dan pendaftaran di `AppModule`.) Berapa di Express? (Jawaban: 1.) Sekarang tanya: pada endpoint ke berapa selisih itu terbayar?

**Cara memverifikasi:** kolom terakhir harus berisi kondisi yang **bisa diuji**, bukan "tergantung kebutuhan". Contoh yang benar: *"Saya akan memilih Express polos kalau proyeknya satu proses, kurang dari 10 endpoint, dan tidak ada background job — karena tiga hal yang dibeli NestJS (worker reuse, DI untuk test, guard global) semuanya tidak berlaku di sana."* Contoh yang salah: *"Tergantung skala proyek."* Simpan file ini — kamu akan menambahinya di setiap fase, dan pada Fase 13 ia jadi ringkasan seluruh kurikulum ini.

---

## Capstone

Kriteria di bawah semuanya berbentuk sesuatu yang bisa **gagal di depan mata**. Tidak ada butir "memahami". Kerjakan berurutan; kalau satu butir gagal, jangan lanjut sebelum tahu kenapa.

- [ ] `cd learn-nest && npm run start:dev` boot tanpa error, dan `curl -i localhost:3000/notes` mengembalikan `200` dengan array JSON.
- [ ] `curl -X POST localhost:3000/notes -H 'Content-Type: application/json' -d '{"body":"halo dari curl"}'` mengembalikan `201`, dan barisnya **terlihat di `npx prisma studio`** dengan `id` berupa UUID, `createdAt` terisi, dan `updatedAt` terisi.
- [ ] Ada file `learn-nest/prisma/migrations/<timestamp>_init_notes/migration.sql` yang berisi `CREATE TABLE "notes"` — dan kamu bisa menunjuk baris mana di file itu yang berasal dari baris mana di `schema.prisma`.
- [ ] `curl -X POST localhost:3000/notes -d '{"body":""}'` mengembalikan **`400`**, bukan `201` dan bukan `500`.
- [ ] `curl -X POST localhost:3000/notes -d '{"body":"x","isAdmin":true}'` mengembalikan **`400`** dengan pesan yang menyebut `isAdmin`.
- [ ] `learn-web` di `http://localhost:5173` menampilkan daftar note dari backend, dan form-nya bisa menambah note baru yang langsung muncul di daftar tanpa reload manual.
- [ ] Ada bukti tertulis di `catatan/01-404-jadi-200.txt`: output `curl -i` **sebelum** `NotesModule` didaftarkan (404) dan **sesudah** (200), lengkap dengan status line.
- [ ] `npx jest` hijau **dengan container Postgres dalam keadaan mati**. Jalankan `docker stop` dulu, baru `npx jest`. Kalau merah, ada yang masih menyentuh database.
- [ ] Mutation check: hapus `orderBy` (atau klausa `where` apa pun) dari `NotesService`, jalankan `npx jest` → **merah**. Kembalikan → hijau. Catat di `catatan/01-mutasi.md` test mana yang mati.
- [ ] `catatan/01-alternatif.md` terisi, dan kolom "kapan saya akan memilih beda" berisi kondisi yang bisa diuji — bukan "tergantung kebutuhan".
- [ ] Kamu bisa membuka `Drovery_Backend/src/users/users.module.ts` dan menunjuk baris demi baris padanannya di `learn-nest/src/notes/notes.module.ts`. Kalau ada satu baris di file Drovery yang tidak kamu mengerti, tulis di daftar pertanyaan Fase 0-mu.

Total artefak: dua folder proyek yang jalan, satu file migration, satu spec Jest hijau, dan tiga file catatan.

---

## Gerbang keluar

Jawab semuanya **tanpa membuka kode**. Kalau ada satu saja yang harus kamu cari dulu, ulangi latihan yang bersangkutan sebelum masuk Fase 2 — Fase 2 menumpuk tepat di atas semua ini.

**1. Saya menaruh file `notes.controller.ts` di `src/notes/` dan sudah menulis `@Controller('notes')`. Kenapa `GET /notes` masih 404?**

<details><summary>Jawaban</summary>

Karena controller belum terdaftar di `controllers:` sebuah `@Module`, atau module-nya belum masuk ke `imports:` `AppModule`. File tidak membuat route; module graph yang membuat route. Buktinya kamu tulis sendiri di `catatan/01-404-jadi-200.txt`. Di Drovery, graph itulah yang bisa di-boot ulang tanpa HTTP oleh `src/worker.ts:30-32`.
</details>

**2. Tidak ada `new PrismaService()` di mana pun di `NotesService`. Dari mana Nest tahu harus menyuntikkan `PrismaService` dan bukan yang lain?**

<details><summary>Jawaban</summary>

Dari metadata `design:paramtypes` yang ditulis TypeScript saat compile, karena `emitDecoratorMetadata: true` (`tsconfig.json:10`) dan class-nya punya minimal satu decorator (`@Injectable()`). Tipe TypeScript normalnya hilang saat runtime; flag itu membuat daftar tipe parameter constructor tetap ada sebagai data yang bisa dibaca. Matikan flag itu dan seluruh DI berhenti bekerja. Kamu bisa melihat string `design:paramtypes` sendiri di `dist/` setelah `npm run build`.
</details>

**3. Apa yang sebenarnya dilakukan `@Public()` saat dipanggil?**

<details><summary>Jawaban</summary>

Menulis `{'isPublic': true}` sebagai metadata ke method atau class itu — dan **tidak ada yang lain**. Tidak ada logic auth yang jalan. Yang membacanya adalah `JwtAuthGuard` (`src/common/guards/jwt-auth.guard.ts:12-18`) lewat `Reflector.getAllAndOverride`. Setiap decorator adalah setengah dari pasangan tulis/baca; kalau kamu tidak menemukan pembacanya, kamu belum selesai membaca.
</details>

**4. `curl` ke endpoint saya berhasil `200`, tapi `fetch` dari halaman React di `:5173` gagal. Apa yang terjadi, dan siapa yang menolak?**

<details><summary>Jawaban</summary>

**Browser** yang menolak, bukan server. Server tetap menjawab `200` (terlihat di tab Network). Origin `http://localhost:5173` berbeda dari `http://localhost:3000`, dan browser membuang respons lintas-origin kecuali server mengirim header CORS yang mengizinkannya. `curl` bukan browser, jadi tidak peduli. Perbaikannya `app.enableCors(...)` seperti `src/main.ts:42-53`. Catatan yang relevan untuk kamu: aplikasi Capacitor/Expo native juga bukan browser, itulah kenapa `src/config/configuration.ts:28` bilang wildcard "fine for the native app".
</details>

**5. Kenapa `updatedAt` tidak berubah saat saya melakukan `UPDATE` lewat `psql`, padahal `createdAt` terisi otomatis saat `INSERT` lewat `psql`?**

<details><summary>Jawaban</summary>

`@updatedAt` adalah fitur **Prisma client** — yang mengisinya adalah kode Prisma saat kamu memanggil `update()`, jadi penulis lain (psql, `$executeRaw`, migration) melewatinya. `@default(now())` sebaliknya di-compile jadi `DEFAULT CURRENT_TIMESTAMP` di DDL (`prisma/migrations/20260326134037_init/migration.sql:17`), jadi **database** yang menegakkannya dan berlaku untuk semua penulis. Membedakan "ditegakkan aplikasi" dan "ditegakkan database" adalah inti seluruh Fase 3.
</details>

**6. Kenapa `whitelist: true` bukan sekadar kerapian?**

<details><summary>Jawaban</summary>

Karena service Drovery menulis `data: dto` langsung ke Prisma (`src/users/users.service.ts:54-57`). Tanpa `whitelist`, `PATCH /users/me` dengan body `{"name":"x","role":"ADMIN"}` mengalirkan `role` sampai ke `prisma.user.update` — privilege escalation tanpa bug apa pun di kode. `whitelist: true` membuangnya karena `UpdateProfileDto` tidak mendeklarasikannya; `forbidNonWhitelisted: true` menolak request-nya `400`. Pola "service percaya DTO-nya" hanya aman kalau pipe-nya global dan agresif.
</details>

**7. Bagaimana caranya menguji sebuah service yang membaca database, tanpa database?**

<details><summary>Jawaban</summary>

Berikan objek palsu lewat constructor — itulah gunanya DI. Dua gaya, keduanya dipakai Drovery: `new RolesGuard(fakeReflector, fakePrisma)` langsung (`src/common/guards/roles.guard.spec.ts:17-21`), atau `Test.createTestingModule({ providers: [X, { provide: PrismaService, useValue: mock }] })` (`src/users/users.service.spec.ts:26-39`). Kalau service mengimpor singleton (`import { prisma } from './db'`), keduanya mustahil dan kamu terpaksa memakai `jest.mock` yang rapuh.
</details>

**8. `learn-nest/src/prisma/prisma.module.ts` saya tidak pakai `@Global()`, tapi `PrismaModule` Drovery pakai. Apa akibat konkretnya?**

<details><summary>Jawaban</summary>

Tanpa `@Global()`, setiap module yang butuh `PrismaService` harus meng-import `PrismaModule` di `imports:`-nya sendiri; lupa → gagal boot dengan "Nest can't resolve dependencies". Dengan `@Global()` (`src/prisma/prisma.module.ts:4`), provider yang di-`exports` tersedia di seluruh graph tanpa import — itulah kenapa `src/users/users.module.ts:5-10` punya `imports` kosong padahal memakai `PrismaService`. Sandbox sengaja tidak memakainya supaya kamu merasakan error-nya dulu; `@Global()` diajarkan di Fase 2 sebagai jawaban atas rasa sakit itu, bukan sebagai mantra.
</details>

---

## Kalau nyangkut

| Gejala | Penyebab paling mungkin | Cara memastikan |
|---|---|---|
| `Nest can't resolve dependencies of the NotesService (?)` saat boot | Provider yang diminta tidak terlihat dari module ini: belum ada di `providers:`, atau ada di module lain yang tidak meng-`exports`-nya, atau module-nya belum di-`imports` | Baca pesannya sampai habis — Nest menyebut **index parameter mana** yang gagal (`at index [0]`) dan **konteks module** mana yang dicari. Cocokkan index itu ke parameter constructor ke-berapa. Tiga percobaan di latihan 1.2 adalah tiga penyebabnya |
| Route 404 padahal filenya jelas ada dan `@Controller` sudah ditulis | Controller tidak terdaftar di `controllers:`, atau module-nya tidak masuk `imports` `AppModule` | Cari log boot Nest: setiap route yang berhasil terdaftar dicetak sebagai `Mapped {/notes, GET} route`. Kalau route-mu tidak ada di daftar itu, masalahnya di graph, bukan di controller |
| `@Injectable()` sengaja dihapus tapi aplikasi tetap jalan, lalu **pecah** setelah ditambah satu dependency | Tanpa decorator apa pun, TypeScript tidak memancarkan `design:paramtypes`. Class tanpa dependency memang tidak butuhnya; begitu ada parameter constructor, DI kehilangan informasi tipe | Tambahkan satu parameter constructor ke class tanpa `@Injectable()` dan lihat error-nya. Lalu `npm run build` dan cari `design:paramtypes` di `dist/` — dengan dan tanpa decorator |
| `fetch` gagal dari `:5173` tapi `curl` ke URL yang sama berhasil `200` | CORS. Browser membuang respons lintas-origin; `curl` bukan browser dan tidak peduli | Buka DevTools tab **Network**, klik request-nya. Kalau statusnya `200` tapi Console berteriak "blocked by CORS policy", server baik-baik saja — konfigurasi CORS yang kurang (`src/main.ts:42-53` sebagai contoh) |
| `PATCH` dengan field ekstra "berhasil" tapi field-nya hilang tanpa jejak | `whitelist: true` tanpa `forbidNonWhitelisted: true`. Field yang tidak ada di DTO dibuang **diam-diam** | Jalankan tiga percobaan di latihan 1.5 berurutan. Kalau kamu ingin klien tahu ia salah kirim, `forbidNonWhitelisted: true` yang bikin `400`; kalau kamu ingin toleran, terima bahwa field-nya hilang dan tulis itu di dokumentasi API-mu |
| `prisma.note` tidak muncul di autocomplete, atau `Property 'note' does not exist` | Generated client belum diperbarui setelah `schema.prisma` berubah | `npx prisma generate`, lalu **restart TS server editor** (di VS Code: `Cmd/Ctrl+Shift+P` → "TypeScript: Restart TS Server"). Ini penyebab nomor satu dari "kok sudah generate masih merah" |
| Tutorial Prisma yang kamu ikuti menaruh `url = env("DATABASE_URL")` di dalam `datasource`, punyamu tidak jalan | Versi. Drovery memakai Prisma 7, yang membaca URL dari `prisma.config.ts:7`, bukan dari blok `datasource` | Cek `npx prisma --version`. Kalau 7.x, ikuti bentuk `prisma/schema.prisma:1-7` + `prisma.config.ts:4-13` di Drovery, dan abaikan tutorial versi lama — mayoritas yang beredar masih 5/6 |
| `migrate dev` menolak mengubah kolom nullable jadi `NOT NULL` | Baris yang sudah ada punya `NULL` di kolom itu; DDL-nya akan gagal di database | Ini bukan bug, ini yang dilindungi. Jalan keluarnya: beri `@default(...)`, atau backfill dulu lewat SQL sebelum mengubah tipe. Kamu akan melakukan versi seriusnya (urutan backfill, gerbang drift) di Fase 3 |
| `too many clients already` dari Postgres saat sandbox dijalankan bersama Drovery | Beberapa `PrismaClient` sekaligus, masing-masing membuka pool sendiri, ditambah pool Drovery yang masih jalan | Pastikan hanya ada **satu** `PrismaService` yang di-`new` oleh Nest (latihan 1.8: `console.log` di constructor harus muncul sekali). Matikan stack Drovery saat mengerjakan sandbox — pakai database `learn_nest` yang terpisah |
| `npx jest` merah begitu Postgres dimatikan | Ada jalur di service atau spec yang masih menyentuh database sungguhan | Ini temuan berharga, bukan gangguan. Lacak dari stack trace: biasanya satu spec lupa mengganti `PrismaService` dengan mock, atau service memanggil `PrismaClient` yang di-`new` sendiri alih-alih yang di-inject |
| Docker/WSL2 rewel dan Postgres tidak mau naik sama sekali | Ini risiko yang sudah diketahui sejak kurikulum disusun: Fase 1 memakai Docker sebagai **resep** padahal Docker baru diajarkan di Fase 10 | Jangan habiskan lebih dari satu jam. Beralih ke jalur cadangan yang sudah kamu siapkan di Fase 0: satu `DATABASE_URL` Postgres terkelola (Neon/Supabase). Fase 1–2 tidak butuh apa pun dari Docker selain "ada Postgres yang bisa dihubungi" |

Satu catatan jujur tentang bagian tersulit di fase ini. **DI + decorator bisa terasa sihir selama berminggu-minggu**, dan itu normal — bukan tanda kamu lambat. Rasa sihir itu punya sebab yang spesifik: kamu terbiasa dengan kode di mana "yang memanggil" selalu terlihat, dan di sini yang memanggil adalah framework yang membaca data yang ditulis decorator. Latihan 1.3 (buat pasangan tulis/baca sendiri) dan latihan 1.8 (matikan `imports`, lihat error) dirancang khusus untuk membongkarnya. Kalau di akhir Fase 2 kamu masih bertanya "siapa yang memanggil `@Public()`", **jangan lanjut ke Fase 3** — ulangi dua latihan itu dulu, karena setiap fase setelahnya menumpuk di atasnya.

---

## Bacaan pendamping

Semuanya di `Drovery_Backend/` kecuali disebut lain. Baca **setelah** irisanmu jalan, bukan sebelum.

| File | Apa yang dicari di sana |
|---|---|
| `src/main.ts` (100 baris, baca utuh) | Seluruh pipeline request terlihat dalam satu layar. Fase 1 baru menjelaskan baris 42-53 (CORS) dan 57-65 (ValidationPipe); catat baris lain yang belum kamu mengerti — itu daftar isi Fase 2 |
| `src/users/users.module.ts` (10 baris) | Bentuk minimal `@Module`. Bandingkan baris demi baris dengan `NotesModule` punyamu, dan perhatikan `imports` yang kosong — pertanyaan "kok bisa?" dijawab di Fase 2 |
| `src/users/users.controller.ts` + `src/users/users.service.ts` | Jalur terpendek dari HTTP ke database di seluruh Drovery. Perhatikan seberapa sedikit yang ada di controller, dan bahwa `src/users/users.service.ts:9-14` menjelaskan sebuah keputusan caching yang belum perlu kamu pahami — tapi perhatikan bahwa keputusannya **ditulis** |
| `src/auth/auth.module.ts:11-17` | Satu-satunya tempat di Fase 1 yang memperlihatkan `providers` ≠ `exports`, dan kenapa `JwtStrategy` hanya perlu ada tanpa perlu dipinjam |
| `prisma/schema.prisma:17-70` (`model User` saja) | Satu model lengkap dengan komentar yang menjelaskan pilihan kolom — terutama baris 30-31 (`role` di-set out-of-band, tidak lewat signup) dan 34-37 (`locale` sengaja `String`, bukan enum, supaya bisa diperluas tanpa migration) |
| `prisma/migrations/20260326134037_init/migration.sql:8-21` | Wujud SQL dari model di atas. Latih membacanya dua arah sampai lancar — Fase 3 mengandaikan keterampilan ini |
| `prisma.config.ts` (13 baris) | Bentuk konfigurasi Prisma 7: di mana `DATABASE_URL` tinggal, dan kenapa `schema.prisma` bisa di-commit tanpa kredensial |
| `src/prisma/prisma.service.ts:132-149` | Docblock terbaik untuk dibaca sekarang: sebuah cerita bug tentang urutan shutdown. Kamu belum butuh isinya, tapi lihat **bentuk** komentarnya — itu standar yang akan kamu tiru mulai Fase 5 |
| `src/users/users.service.spec.ts` (baca utuh) | Pola test yang akan kamu pakai puluhan kali sampai Fase 13. Perhatikan bahwa assertion-nya mengunci **argumen** ke Prisma, bukan cuma hasilnya |
| `README.md:161-233` | Perintah setup Postgres + Prisma yang ditulis untuk manusia. Pakai sebagai contekan saat menyiapkan `learn-nest` |
| `ARCHITECTURE.md:1-37` | Sekali baca saja, untuk melihat ke mana kurikulum ini menuju. Jangan berusaha memahaminya sekarang — tujuannya supaya kamu mengenali istilahnya saat muncul lagi nanti |

Tiga dokumentasi eksternal yang benar-benar berguna di fase ini (dan hanya tiga):

- [NestJS — First steps](https://docs.nestjs.com/first-steps) sampai bab **Providers**. Berhenti di situ; bab setelahnya adalah Fase 2 dan membacanya sekarang cuma bikin kabur.
- [Prisma — Getting started with PostgreSQL](https://www.prisma.io/docs/getting-started). **Periksa versinya**: pastikan yang kamu baca Prisma 7, karena letak `DATABASE_URL` berubah dan itu jebakan paling umum.
- [MDN — CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS), khusus bagian "Simple requests" vs "Preflighted requests". Ini menjelaskan kenapa `GET`-mu kadang lolos sementara `POST` dengan `Content-Type: application/json` tidak.

---

**Sudah selesai?** Kamu sekarang punya endpoint, tabel, dan layar yang saling bicara — semuanya kamu ketik sendiri. Fase 2 mengambil pipeline yang sengaja dilewati di sini (guard, interceptor, filter, config) dan membangunnya di sandbox yang sama, sampai `src/main.ts` dan `src/app.module.ts` Drovery terbaca sebagai daftar keputusan, bukan sebagai mantra.

/**
 * Indonesian (Bahasa Indonesia) catalog. Keys mirror `en`; any key missing here
 * falls back to the English string per key (I18nService), so partial coverage is
 * safe. Keep this file reviewable in one place for translation quality.
 */
export const id: Record<string, string> = {
  // ── Notifikasi tahap pengiriman + label peta langsung ──
  'notification.stage.CONFIRMED.title': 'Pengiriman Dikonfirmasi',
  'notification.stage.CONFIRMED.body':
    'Pengiriman Anda telah dikonfirmasi dan sedang diproses.',
  'notification.stage.CONFIRMED.droneStatus': 'Pengiriman dikonfirmasi',
  'notification.stage.DRONE_ASSIGNED.title': 'Drone Ditugaskan',
  'notification.stage.DRONE_ASSIGNED.body':
    'Sebuah drone telah ditugaskan untuk pengiriman Anda.',
  'notification.stage.DRONE_ASSIGNED.droneStatus': 'Drone ditugaskan',
  'notification.stage.PICKUP_IN_PROGRESS.title': 'Penjemputan Berlangsung',
  'notification.stage.PICKUP_IN_PROGRESS.body':
    'Drone sedang menuju lokasi penjemputan.',
  'notification.stage.PICKUP_IN_PROGRESS.droneStatus':
    'Menuju Lokasi Penjemputan',
  'notification.stage.IN_TRANSIT.title': 'Paket Dalam Perjalanan',
  'notification.stage.IN_TRANSIT.body':
    'Paket Anda telah diambil dan sedang dalam perjalanan!',
  'notification.stage.IN_TRANSIT.droneStatus': 'Dalam perjalanan ke tujuan',
  'notification.stage.AWAITING_HANDOFF.title': 'Menunggu Serah Terima',
  'notification.stage.AWAITING_HANDOFF.body':
    'Paket Anda telah tiba. Bagikan kode serah terima Anda kepada penerima untuk menyelesaikan pengiriman.',
  'notification.stage.AWAITING_HANDOFF.droneStatus':
    'Menunggu serah terima penerima',

  // ── Notifikasi pengecualian pengiriman + label peta langsung ──
  'notification.exception.WEATHER_ABORT.title': 'Pengiriman Dibatalkan — Cuaca',
  'notification.exception.WEATHER_ABORT.body':
    'Cuaca buruk memaksa drone Anda membatalkan pengiriman. Pembayaran Anda telah dikembalikan ke dompet Anda.',
  'notification.exception.WEATHER_ABORT.droneStatus': 'Dibatalkan — cuaca',
  'notification.exception.MECHANICAL.title': 'Pengiriman Gagal',
  'notification.exception.MECHANICAL.body':
    'Masalah teknis membuat drone harus mendarat. Pembayaran Anda telah dikembalikan ke dompet Anda.',
  'notification.exception.MECHANICAL.droneStatus': 'Mendarat — masalah teknis',
  'notification.exception.UNSAFE_DROP_ZONE.title':
    'Pengiriman Tidak Dapat Diselesaikan',
  'notification.exception.UNSAFE_DROP_ZONE.body':
    'Drone tidak menemukan tempat yang aman untuk menurunkan paket Anda. Pembayaran Anda telah dikembalikan.',
  'notification.exception.UNSAFE_DROP_ZONE.droneStatus':
    'Dibatalkan — area pengantaran tidak aman',
  'notification.exception.RECIPIENT_UNAVAILABLE.title': 'Serah Terima Gagal',
  'notification.exception.RECIPIENT_UNAVAILABLE.body':
    'Kami tidak dapat memverifikasi penerima setelah beberapa kali percobaan, sehingga pengiriman dihentikan. Hubungi dukungan jika Anda memerlukan pengembalian dana.',
  'notification.exception.RECIPIENT_UNAVAILABLE.droneStatus':
    'Dihentikan — penerima tidak tersedia',
  'notification.exception.ADMIN_ABORT.title': 'Pengiriman Dihentikan',
  'notification.exception.ADMIN_ABORT.body':
    'Pengiriman Anda dihentikan oleh tim dukungan. Pembayaran Anda telah dikembalikan ke dompet Anda.',
  'notification.exception.ADMIN_ABORT.droneStatus': 'Dihentikan oleh dukungan',
  'notification.exception.OTHER.title': 'Pengiriman Gagal',
  'notification.exception.OTHER.body':
    'Pengiriman Anda tidak dapat diselesaikan. Pembayaran Anda telah dikembalikan ke dompet Anda.',
  'notification.exception.OTHER.droneStatus': 'Pengiriman gagal',
  'notification.exception.RETURNING.title': 'Drone Kembali ke Pangkalan',
  'notification.exception.RETURNING.body':
    'Drone Anda sedang dalam perjalanan kembali. Anda dapat memantau perjalanannya secara langsung di peta.',
  'notification.exception.RETURNING.droneStatus': 'Kembali ke pangkalan',
  'notification.exception.RETURNED.title': 'Drone Kembali dengan Selamat',
  'notification.exception.RETURNED.body':
    'Paket Anda telah kembali ke pangkalan. Pembayaran Anda telah dikembalikan ke dompet Anda.',
  'notification.exception.RETURNED.droneStatus': 'Telah kembali ke pangkalan',

  // ── Email transaksional ──
  'email.passwordReset.subject': 'Atur ulang kata sandi Drovery Anda',
  'email.passwordReset.body':
    'Ketuk untuk mengatur ulang kata sandi Anda: {deepLink}\n\nAtau masukkan kode ini di aplikasi: {token}\n\nTautan ini kedaluwarsa dalam 1 jam. Jika Anda tidak memintanya, abaikan email ini.',
  'email.verification.subject': 'Verifikasi email Drovery Anda',
  'email.verification.body':
    'Selamat datang di Drovery! Ketuk untuk memverifikasi email Anda: {deepLink}\n\nAtau masukkan kode ini di aplikasi: {token}\n\nTautan ini kedaluwarsa dalam 24 jam.',

  // ── Dukungan ──
  'support.autoAck':
    'Terima kasih telah menghubungi dukungan Drovery! Kami telah menerima pesan Anda dan anggota tim kami akan segera menghubungi Anda kembali. Jangan ragu menambahkan detail lain di sini sementara itu.',
  'faq.1.question': 'Bagaimana cara melacak pengiriman saya?',
  'faq.1.answer':
    'Buka tab Pengiriman dan ketuk pesanan aktif Anda. Anda akan melihat pelacakan waktu nyata di peta.',
  'faq.2.question': 'Bagaimana harga pengiriman dihitung?',
  'faq.2.answer':
    'Harga didasarkan pada ukuran paket, berat, jenis, dan biaya layanan dasar. Gunakan alat Estimasi Harga sebelum memesan.',
  'faq.3.question': 'Bisakah saya membatalkan pesanan?',
  'faq.3.answer':
    'Anda dapat membatalkan pesanan sebelum drone ditugaskan. Setelah ditugaskan, pembatalan mungkin dikenakan biaya.',
  'faq.4.question': 'Ukuran paket apa saja yang tersedia?',
  'faq.4.answer':
    'Kecil (hingga 0,5 kg), Sedang (hingga 1,5 kg), Besar (hingga 3 kg), dan XL (hingga 5 kg).',
  'faq.5.question': 'Bagaimana cara mengubah alamat default saya?',
  'faq.5.answer':
    'Buka Profil → Edit Profil dan perbarui kolom Alamat Default.',
  'faq.6.question': 'Apakah informasi pembayaran saya aman?',
  'faq.6.answer':
    'Ya. Semua data kartu dienkripsi melalui Stripe. Kami tidak pernah menyimpan nomor kartu lengkap Anda.',

  // ── Validasi (class-validator → dilokalkan di batas; {property} tetap nama kolom mentah) ──
  'validation.isString': '{property} harus berupa teks',
  'validation.isNotEmpty': '{property} wajib diisi',
  'validation.isNumber': '{property} harus berupa angka',
  'validation.isInt': '{property} harus berupa bilangan bulat',
  'validation.isBoolean': '{property} harus bernilai benar atau salah',
  'validation.isArray': '{property} harus berupa daftar',
  'validation.isEmail': '{property} harus berupa email yang valid',
  'validation.isPositive': '{property} harus berupa angka positif',
  'validation.isEnum': '{property} harus salah satu dari: {values}',
  'validation.isIn': '{property} harus salah satu dari: {values}',
  'validation.min': '{property} minimal {min}',
  'validation.max': '{property} maksimal {max}',
  'validation.minLength': '{property} minimal {min} karakter',
  'validation.maxLength': '{property} maksimal {max} karakter',
  'validation.isLength': '{property} harus antara {min} dan {max} karakter',
  'validation.arrayMinSize': '{property} harus berisi setidaknya {min} item',
  'validation.arrayMaxSize': '{property} maksimal berisi {max} item',
  'validation.matches': 'format {property} tidak valid',
  'validation.isDateString': '{property} harus berupa tanggal yang valid',
  'validation.isISO8601': '{property} harus berupa tanggal ISO 8601 yang valid',
  'validation.whitelistValidation': '{property} bukan properti yang diizinkan',
  'validation.invalid': '{property} tidak valid',
  'validation.code.sixDigit': 'code harus berupa angka 6 digit',
  'validation.timeOfDay.format': 'timeOfDay harus dalam format HH:MM (24 jam)',
};

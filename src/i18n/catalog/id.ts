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

  // ── Email transaksional (MailRenderer menyusun blok: judul + isi + tombol CTA) ──
  'email.passwordReset.subject': 'Atur ulang kata sandi Drovery Anda',
  'email.passwordReset.heading': 'Atur ulang kata sandi Anda',
  'email.passwordReset.body':
    'Ketuk tombol di bawah untuk mengatur ulang kata sandi Drovery Anda. Tautan ini kedaluwarsa dalam 1 jam. Jika Anda tidak memintanya, Anda dapat mengabaikan email ini dengan aman.',
  'email.passwordReset.cta': 'Atur ulang kata sandi',
  'email.verification.subject': 'Verifikasi email Drovery Anda',
  'email.verification.heading': 'Verifikasi email Anda',
  'email.verification.body':
    'Selamat datang di Drovery! Ketuk tombol di bawah untuk memverifikasi alamat email Anda. Tautan ini kedaluwarsa dalam 24 jam.',
  'email.verification.cta': 'Verifikasi email',
  'email.common.codeHint': 'Atau masukkan kode ini di aplikasi: {token}',
  'email.common.signoff': '— Tim Drovery',
  'email.common.footer': 'Drovery · Pengiriman drone otonom',

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

  // ── Error HTTP yang dilempar (satu kunci per literal; diterjemahkan di batas) ──
  // Otorisasi / pengguna lintas-fitur.
  'error.authz.forbidden': 'Izin tidak memadai',
  'error.authz.access_denied': 'Akses ditolak',
  'error.user.not_found': 'Pengguna tidak ditemukan',

  // Pengiriman.
  'error.delivery.not_found': 'Pengiriman dengan id "{id}" tidak ditemukan',
  'error.delivery.not_found_by_tracking_id':
    'Pengiriman dengan id pelacakan "{trackingId}" tidak ditemukan',
  'error.delivery.schedule.too_far':
    'Penjemputan dapat dijadwalkan paling lama {maxDays} hari ke depan.',
  'error.delivery.schedule.live_not_allowed':
    'Pengiriman dengan pelacakan LIVE tidak dapat dijadwalkan untuk jendela penjemputan di masa depan.',
  'error.delivery.tracking_id_alloc_failed':
    'Tidak dapat mengalokasikan id pelacakan yang unik, silakan coba lagi.',
  'error.delivery.serviceability.unresolved_location':
    'Kami tidak dapat menemukan lokasi penjemputan atau pengantaran. Pilih titiknya di peta dan coba lagi.',
  'error.delivery.serviceability.not_flyable':
    'Pengiriman ini tidak dapat diterbangkan saat ini.',
  'error.delivery.cancel.bad_status':
    'Pengiriman tidak dapat dibatalkan dalam status "{status}". Hanya pengiriman {allowed} yang dapat dibatalkan.',
  'error.delivery.cancel.race_bad_status':
    'Pengiriman tidak dapat dibatalkan dalam status "{status}".',
  'error.delivery.fail.bad_status':
    'Pengiriman tidak dapat digagalkan dalam status "{status}".',
  'error.delivery.handoff.already_completed': 'Pengiriman ini sudah selesai.',
  'error.delivery.handoff.not_awaiting':
    'Pengiriman ini belum menunggu serah terima.',
  'error.delivery.handoff.invalid_code': 'Kode serah terima tidak valid.',
  'error.delivery.handoff.locked':
    'Terlalu banyak percobaan yang salah — serah terima dikunci.',
  'error.delivery.proof.not_found':
    'Tidak ada bukti pengiriman untuk pengiriman "{id}"',
  'error.delivery.rating.not_delivered':
    'Anda hanya dapat menilai pengiriman setelah pengiriman selesai.',
  'error.delivery.rating.not_rated': 'Pengiriman "{id}" belum dinilai',
  'error.delivery.tracking.not_found':
    'Data pelacakan untuk pengiriman "{id}" tidak ditemukan',

  // Perintah drone.
  'error.command.not_found': 'Perintah tidak ditemukan',
  'error.command.live_only': 'Hanya pengiriman LIVE yang dapat diberi perintah',
  'error.command.no_drone': 'Pengiriman tidak memiliki drone yang ditugaskan',
  'error.command.illegal_for_status':
    'Tidak dapat {type} pengiriman dalam status {status}',
  'error.command.limit_reached':
    'Batas perintah untuk pengiriman ini telah tercapai',
  'error.command.already_pending':
    'Sudah ada perintah yang tertunda untuk pengiriman ini',
  'error.command.drone_not_assigned':
    'Drone tidak ditugaskan untuk pengiriman ini',
  'error.command.expired': 'Perintah telah kedaluwarsa',
  'error.command.not_awaiting_ack': 'Perintah tidak sedang menunggu konfirmasi',

  // Telemetri (sisi permintaan; pesan penjaga ingest untuk mesin tetap Inggris).
  'error.telemetry.latlng_pair_required':
    'lat dan lng harus diberikan bersamaan',
  'error.telemetry.not_live': 'Pengiriman tidak dilacak secara langsung',
  'error.telemetry.drone_not_assigned':
    'Drone tidak ditugaskan untuk pengiriman ini',

  // Auth. Dua pesan kredensial-tidak-valid + pesan token sengaja dibuat samar
  // (anti-enumerasi) — JANGAN menambahkan detail.
  'error.auth.email_taken': 'Pengguna dengan email ini sudah ada',
  'error.auth.signup_failed':
    'Tidak dapat menyelesaikan pendaftaran, silakan coba lagi',
  'error.auth.invalid_credentials': 'Email atau kata sandi tidak valid',
  'error.auth.refresh_invalid':
    'Token penyegaran tidak valid atau telah dicabut',
  'error.auth.user_gone': 'Pengguna tidak ada lagi',
  'error.auth.reset_token_invalid':
    'Token atur ulang tidak valid atau kedaluwarsa',
  'error.auth.verify_token_invalid':
    'Token verifikasi tidak valid atau kedaluwarsa',

  // Admin.
  'error.admin.ticket.not_found': 'Tiket "{id}" tidak ditemukan',
  'error.admin.ticket.closed':
    'Tiket ini ditutup; buka kembali terlebih dahulu.',
  'error.admin.refund.invalid_amount':
    'Pengembalian dana harus lebih dari 0 dan paling banyak sebesar total yang ditagih.',
  'error.admin.refund.already_refunded':
    'Pengiriman ini sudah dikembalikan dananya.',
  'error.admin.promo.code_exists': 'Kode promo dengan kode itu sudah ada.',
  'error.admin.promo.not_found': 'Promo "{id}" tidak ditemukan',
  'error.admin.promo.percent_range':
    'discountValue PERCENT harus antara 0 dan 100.',
  'error.admin.user.not_found': 'Pengguna "{id}" tidak ditemukan',
  'error.admin.user.last_admin':
    'Tidak dapat menurunkan admin terakhir yang tersisa.',

  // Pembayaran.
  'error.payment.method.not_found':
    'Metode pembayaran dengan id "{id}" tidak ditemukan',

  // Pengiriman berulang.
  'error.recurring.end_before_start':
    'endDate harus pada atau setelah startDate.',
  'error.recurring.weekly_needs_days':
    'Jadwal WEEKLY memerlukan setidaknya satu hari di daysOfWeek.',
  'error.recurring.no_future_occurrence':
    'Jadwal ini tidak menghasilkan kemunculan di masa depan (periksa waktu, hari, dan tanggal berakhir).',
  'error.recurring.not_found': 'Pengiriman berulang "{id}" tidak ditemukan',
  'error.recurring.already_ended': 'Pengulangan ini sudah berakhir.',

  // Alamat tersimpan / favorit / alur kerja / geo / dukungan / dompet.
  'error.saved_address.not_found':
    'Alamat tersimpan dengan id "{id}" tidak ditemukan',
  'error.saved_address.limit':
    'Anda dapat menyimpan paling banyak {max} alamat.',
  'error.favorite.not_found': 'Favorit "{id}" tidak ditemukan',
  'error.workflow.not_found': 'Alur kerja "{workflowId}" tidak ditemukan',
  'error.workflow.step_not_found':
    'Langkah "{stepId}" tidak ada dalam alur kerja "{workflowId}"',
  'error.geo.q_required': 'Parameter kueri "q" wajib diisi',
  'error.geo.latlng_required':
    'Parameter kueri "lat" dan "lng" wajib diisi dan harus berupa angka',
  'error.support.message_required': 'Pesan wajib diisi',
  'error.support.ticket.not_found': 'Tiket dukungan tidak ditemukan',
  'error.support.ticket.closed': 'Tiket dukungan ini ditutup',
  'error.wallet.insufficient_credits': 'Kredit dompet tidak mencukupi.',
  'error.notification.not_found': 'Notifikasi dengan id "{id}" tidak ditemukan',
  'error.notification.quiet_hours_pair':
    'quietHoursStart dan quietHoursEnd harus diatur bersama (atau keduanya dikosongkan)',
};

# Barcode PO dan notifikasi Android

Barcode Code 128 berisi nomor PO, tersedia pada detail PO dan Cetak PO. Barcode tidak memberikan akses tanpa login. Library barcode dibundel lokal agar tidak memerlukan CDN.

## Firebase yang sudah ada

Gunakan proyek Firebase yang ada, kemudian Project settings > Your apps > Add app > Android. Package wajib id.kedaiupu.purchasing. Jika package ini sudah terdaftar, gunakan aplikasi yang sama. Unduh google-services.json ke android/app/google-services.json. File ini dikecualikan dari Git. Tidak perlu menambahkan SDK Firebase secara manual karena plugin Capacitor menanganinya.

Di Project settings > Service accounts, buat private key untuk pengirim server. Simpan secara lokal di .openai/firebase-service-account.json. Jangan kirim private key ke chat, jangan masukkan ke dist atau Git. JSON ini dipasang sebagai secret FIREBASE_SERVICE_ACCOUNT di Supabase Edge Functions. Pastikan Firebase Cloud Messaging API HTTP v1 aktif dan service account memiliki izin mengirim pesan pada proyek yang sama dengan google-services.json.

## Supabase

1. Jalankan supabase/migrations/202610260008_android_push.sql atau salinan lokal .openai/enable-android-push.sql di SQL Editor. Token perangkat dan antrean tidak bisa dibaca langsung oleh akun aplikasi; registrasi hanya untuk anggota aktif.
2. Deploy supabase/functions/dispatch-po-push/index.ts sebagai Edge Function dispatch-po-push. JWT verification dimatikan khusus fungsi ini karena pemanggil menggunakan secret x-push-secret yang diperiksa fungsi. Tanpa secret yang cocok fungsi menolak permintaan. Dengan CLI: npx supabase functions deploy dispatch-po-push --project-ref wqibajjwapkieefkhilx --no-verify-jwt (perlu login Supabase CLI).
3. Tambahkan secret FIREBASE_SERVICE_ACCOUNT berisi seluruh JSON service account melalui Edge Functions > Secrets. SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY disediakan lingkungan Supabase, tidak pernah dibagikan ke browser.
4. Jalankan skrip lokal .openai/setup-push-schedule.sql. Salin hasil push_dispatch_secret hanya ke secret Edge Function PUSH_DISPATCH_SECRET. Jangan kirim ke chat. Cron yang sudah dibuat mulai bekerja setelah kedua secret terpasang. Nilai secret disimpan di Vault dan tidak ditanam dalam kode atau perintah cron.
5. Antrean baru memicu Edge Function langsung; Cron setiap menit menjadi cadangan dan jalur percobaan ulang. Satu pemanggilan memproses maksimal 30 pengiriman. Kegagalan dicoba ulang hingga 10 percobaan dengan jeda meningkat, klaim kedaluwarsa setelah 5 menit. Token FCM kedaluwarsa dihapus. Cek Cron history dan antrean po_push_queue untuk diagnosis. Saat perangkat terdaftar, maksimal 20 notifikasi belum dibaca dari 24 jam terakhir dipulihkan tanpa menggandakan antrean yang sudah ada.

## Perangkat Android

Perubahan Android perlu APK baru dipasang sebelum notifikasi dapat menggunakan channel suara yang baru; kode web saja tidak memperbarui plugin di APK lama. Channel `upu-po-v2` memakai suara notifikasi bawaan Android. Android menyimpan pengaturan channel di perangkat, jadi channel lama yang senyap tidak berubah saat aplikasi diperbarui. APK belum dibangun sesuai permintaan pengguna.

Setelah APK baru dipasang, login dan izinkan notifikasi pada permintaan Android. Registrasi perangkat berjalan otomatis setelah login; tombol Akun > Aktifkan notifikasi Android tersedia untuk mencoba lagi. Saat aplikasi ditutup, FCM menampilkan notifikasi sistem; saat terbuka, aplikasi memuat data terbaru. Ketuk notifikasi untuk membuka PO setelah login; akses tetap diperiksa server. Keluar akun menghapus token server terlebih dahulu; jika koneksi gagal, keluar ditunda agar token akun lama tidak tertinggal.

Sales menerima PO baru serta pembaruan estimasi, dikirim, diterima dan selesai. Purchasing/Admin menerima konfirmasi dan progres dari aktor lain sesuai aturan notifikasi yang sudah ada. Pesan sistem bersifat umum; detail PO hanya terlihat setelah membuka aplikasi. Pengiriman memerlukan internet, izin Android, konfigurasi Firebase, Cron aktif, dan APK baru. Android force-stop dan pembatasan baterai dapat menunda pesan. Pengiriman FCM bersifat at-least-once; tag notifikasi stabil mengurangi tampilan duplikat. Penerima diperiksa ulang saat antrean diklaim; notifikasi yang sudah diterima perangkat tidak dapat ditarik kembali saat mapping berubah.

## Uji perangkat yang wajib sesudah aktivasi

Dua akun dan dua perangkat: terbitkan PO sebagai Purchasing, tutup aplikasi Sales, pastikan notifikasi diterima dan membuka PO yang benar. Konfirmasi sebagai Sales dan periksa Purchasing. Uji pembaruan dikirim/diterima, logout/login akun berbeda, izin ditolak, perangkat offline lalu online. Uji nyata FCM belum dilakukan tanpa proyek Firebase dan APK baru.

Referensi: https://capacitorjs.com/docs/apis/push-notifications ; https://firebase.google.com/docs/cloud-messaging/send/v1-api ; https://supabase.com/docs/guides/functions/schedule-functions

Perbaikan v3.3.1: aktifkan migrasi 009 dan 010 setelah 008. WebSocket Supabase Realtime memperbarui INSERT/UPDATE PO dan notifikasi sesuai RLS; polling 15 detik tetap menjadi cadangan. Formulir yang sedang diisi tidak ditimpa. Push tetap melalui Firebase saat aplikasi ditutup.

Versi 3.3.3 menampilkan kode produk pada form, detail/cetakan PO dan CSV. Barang manual tetap tanpa kode. Migrasi 011 menambah notifikasi pendaftaran bagi Admin aktif saja; ketukannya membuka menu User. Status Dikonfirmasi, Dikirim, dan Diterima memberi judul notifikasi khusus kepada penerima terkait, tanpa mengirim ke aktor sendiri. Pendaftaran yang disetujui tidak lagi muncul sebagai permintaan tinjau dan antrean yang belum terkirim dibatalkan.

# Pendaftaran akun dari aplikasi (3.1)

Pengguna tidak perlu membuka Authentication > Users untuk membuat akun.

## Daftar sendiri

1. Pada halaman login, pilih **Belum punya akun? Daftar di sini**.
2. Isi nama, email, kata sandi dan ajukan peran Purchasing atau Sales Supplier.
3. Buka email konfirmasi bila diwajibkan Supabase, lalu kembali ke aplikasi.
4. Admin menyetujui peran. Permintaan peran di metadata pendaftaran tidak memberikan akses otomatis.
5. Untuk Sales, Admin tetap memetakan supplier melalui Supplier & Sales.

## Admin membuat akun

Pilih **User → Buat Akun Baru**. Isi nama, email, peran dan kata sandi awal. Aplikasi membuat akun Auth menggunakan client pendaftaran terpisah, lalu memberikan peran melalui API Admin yang sudah ada. Sesi login Admin tidak diganti oleh sesi akun baru. Password tidak dikirim ke tabel bisnis atau RPC role, tidak disimpan di localStorage aplikasi, dan tidak dicatat ke timeline.

Pemilik email hanya perlu mengonfirmasi email bila fitur Confirm email diaktifkan pada proyek. Bila email sudah terdaftar, pendaftaran tidak mengganti password. Gunakan **Tambahkan Akun Terdaftar** untuk mengatur peran akun yang sudah ada. Jika akun berhasil dibuat tetapi pemberian peran gagal, gunakan tombol tersebut untuk menyelesaikan pemberian akses tanpa membuat ulang akun.

## Daftar persetujuan (penyiapan satu kali)

Tombol daftar dan Buat Akun Baru bekerja dengan pengaturan signup proyek yang sudah diaktifkan; tidak perlu menjalankan ulang aktivasi blueprint.

Untuk menampilkan daftar pendaftar di menu User, jalankan isi `supabase/migrations/202610260003_registration.sql` atau salinan lokal `.openai/enable-registration.sql` melalui Supabase SQL Editor. Skrip kecil ini aman dijalankan ulang dan tidak mengubah user/data yang sudah ada. Hanya Admin aktif workspace yang boleh membaca daftar pendaftar. Client tanpa migrasi ini tetap dapat membuat akun dan menambahkan akun terdaftar lewat email.

Setelah aktif, Admin memilih **Tinjau** pada pendaftaran, menentukan peran dan menyimpan. Daftar dibatasi 200 pendaftaran terbaru yang belum memiliki role pada workspace tersebut. Status email ditampilkan terpisah dari persetujuan akses.

## Pengaturan email proyek

Pada 26 Oktober 2026, pengelola menonaktifkan Confirm email untuk pengujian internal. Signup email tetap aktif dan persetujuan peran tetap diperlukan. Aplikasi menyesuaikan pesan berdasarkan apakah signup menghasilkan sesi langsung; bila konfirmasi diaktifkan kembali, aplikasi meminta pengguna memeriksa email. Pengiriman email memakai Supabase Auth dan dapat terkena batas pengiriman/konfigurasi SMTP proyek.

Atur Site URL dan Redirect URLs di konfigurasi Auth ke `https://mcsatriasparta11-max.github.io/tokodigital/` agar tautan konfirmasi kembali ke web yang benar. Aplikasi juga mengirim `emailRedirectTo` tersebut saat signup. Bila konfigurasi proyek mengarahkan ke alamat lain, pengguna dapat kembali secara manual ke aplikasi setelah konfirmasi, lalu login. Android tetap dapat dipakai untuk masuk setelah email terkonfirmasi; tidak diperlukan secret key di APK atau browser.

Pengujian pendaftaran memakai mock Auth di browser dan PostgreSQL lokal; tidak mengirim email atau membuat akun produksi selama pengujian.
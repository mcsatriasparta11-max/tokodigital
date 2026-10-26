# Kedai UPU PO

Aplikasi purchasing responsif untuk desktop dan HP. Situs: https://mcsatriasparta11-max.github.io/tokodigital/

## Penyimpanan

- Tanpa konfigurasi Supabase, aplikasi tetap menggunakan data browser lama (`upu-po-v1`).
- Setelah Supabase dikonfigurasi, aplikasi meminta login email/kata sandi. Data bersama disimpan di PostgreSQL, bukan di localStorage. Sesi login tetap disimpan oleh SDK di browser.
- Hanya pengguna yang didaftarkan sebagai anggota workspace dapat membaca/menyimpan data. Pendaftaran akun baru tidak otomatis memberikan akses.
- Perubahan mencakup supplier, produk, PO, aktivitas, impor Excel, dan pemulihan cadangan. Server memvalidasi data dan menyimpan satu transaksi per tindakan. Versi data mencegah penimpaan perubahan perangkat lain.
- Data diperiksa setiap 15 detik ketika aplikasi terbuka. Ini polling, bukan pembaruan langsung per detik. Koneksi internet diperlukan untuk menyimpan ke database.

## Aktivasi Supabase

Ikuti [panduan penyiapan](supabase/SETUP.md). Belum ada proyek atau kredensial Supabase yang disertakan di repositori.

File penting:

- `supabase/migrations/202610260001_purchasing.sql`: tabel, validasi, akses anggota, RLS, dan RPC penyimpanan.
- `supabase/add-member.sql`: mendaftarkan pengguna yang diizinkan ke workspace.
- `dist/config.js`: URL proyek dan publishable/anon key (konfigurasi publik, bukan secret).
- `dist/cloud.js`: login, sinkronisasi, transaksi, migrasi lokal, dan penanganan konflik.
- `dist/data.js`: validasi data sebelum ditampilkan atau diunggah.

## Menjalankan dan menguji

Tidak memerlukan build. Sajikan folder `dist` melalui server HTTP. Library Excel dan font masih memerlukan internet; SDK Supabase 2.118.0 disertakan lokal beserta lisensi MIT di `dist/vendor/`.

Gunakan Node.js 22 atau lebih baru:

```sh
npm ci
npm test
```

Di PowerShell dengan pembatasan skrip, gunakan `npm.cmd ci` dan `npm.cmd test`.

Pengujian mencakup halaman aplikasi, login, perubahan PO, cadangan, impor, jaringan terputus, konflik, serta migrasi dan aturan akses PostgreSQL melalui PGlite. GitHub Actions menjalankan pengujian sebelum memublikasikan `dist` ke Pages.

Format impor: `supplier,kode_produk,nama_produk,qty`. Kode produk harus unik, berisi huruf/angka/minus/garis bawah; qty harus bilangan bulat 1–10.000.000. File maksimal 5 MB / 10.000 baris.
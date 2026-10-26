# Kedai UPU PO

Aplikasi Purchasing ↔ Sales Supplier untuk web dan Android, dengan login Supabase dan database PostgreSQL.

Situs: https://mcsatriasparta11-max.github.io/tokodigital/

## Alur sesuai blueprint

Draft → Menunggu Konfirmasi → Dikonfirmasi → Menunggu Pengiriman → Dikirim → Diterima → Selesai.

Purchasing membuat dan menerbitkan PO. PO masuk ke Sales sesuai mapping supplier. Sales mengonfirmasi dan wajib mengisi estimasi pengantaran. Purchasing/Admin mencatat progres pengiriman, penerimaan dan penyelesaian. Admin mengelola user, supplier, produk, dan mapping. Sales tidak dapat melihat Draft atau PO supplier lain; pembatasan berlaku di server melalui RLS.

Tersedia timeline per PO, dashboard sesuai role, notifikasi di dalam aplikasi, impor Draft per supplier, serta ekspor CSV/data. Notifikasi belum berupa push, email, atau WhatsApp.

Lihat [alur, teknologi dan struktur proyek](docs/WORKFLOW.md), [blueprint pengguna](docs/BLUEPRINT.txt), serta [panduan Android](docs/ANDROID.md).

## Aktivasi database

Versi baru membutuhkan migrasi `supabase/migrations/202610260002_workflow.sql` setelah migrasi pertama, lalu bootstrap Admin pertama. Skrip lokal gabungan `.openai/activate-blueprint.sql` disiapkan untuk email pengelola proyek ini: jalankan satu kali di Supabase SQL Editor, sebagai pengganti migrasi kedua dan bootstrap terpisah.

Sebelum migrasi kedua tersedia, situs dan APK tetap memuat aplikasi lama. Setelah migrasi, buka ulang aplikasi agar UI multi-role aktif. Data lama disalin ke tabel baru dan API dokumen bersama ditutup. Detail pemetaan status dan batas migrasi ada di `docs/WORKFLOW.md`.

Publishable key pada `dist/config.js` adalah konfigurasi browser publik. Password, secret/service_role key, token admin dan keystore tidak boleh dimasukkan ke repositori. Pengguna dapat mendaftar dari halaman login, dan Admin dapat membuat akun langsung melalui User → Buat Akun Baru. Supabase Auth menangani password dan konfirmasi email; peran tetap diberikan Admin. Lihat [panduan pendaftaran](docs/REGISTRATION.md).

## Pengembangan dan pengujian

Node.js 22+, JDK 21 untuk Android, Android SDK Platform 36.

```sh
npm ci
npm test
npm run test:browser
npm run android:apk
```

Pada PowerShell dengan pembatasan skrip gunakan `npm.cmd`. Pengujian browser memakai Microsoft Edge lokal; untuk lingkungan lain tentukan `BROWSER_EXECUTABLE` ke Chromium yang tersedia. Pengujian database memakai PGlite, sedangkan skenario browser memakai API mock dan tidak mengubah data produksi.

Tidak memerlukan build web. `npm run build:native` menghasilkan adapter Capacitor `dist/native.js`. `npm run android:sync` menyalin `dist` ke proyek Android. SDK Supabase disertakan lokal; library Excel dan font masih membutuhkan internet. Penyimpanan bersama dan login memerlukan koneksi internet.
Panduan [impor master produk dan konversi kemasan](docs/PRODUCT-IMPORT.md).

Perubahan hak akses pengiriman: Sales hanya mengonfirmasi PO dengan estimasi awal. Purchasing/Admin menangani perubahan estimasi, menunggu pengiriman, dikirim, diterima, dan selesai. Aktifkan migrasi 202610260006_delivery_permissions.sql (salinan lokal .openai/enable-delivery-permissions.sql).

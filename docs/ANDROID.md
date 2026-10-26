# Android Kedai UPU PO

Package: `id.kedaiupu.purchasing`. Nama: Kedai UPU PO. Versi: 3.1.0. Runtime Capacitor 8; minimum Android 7/API 24; target API 36.

Aplikasi memuat aset `dist` dari paket APK, bukan membuka situs GitHub dalam browser. Login dan data memakai proyek Supabase yang sama dengan web. Bootstrap mendeteksi apakah migrasi workflow V2 sudah terpasang. Bila belum, UI lama digunakan; setelah migrasi aktif, buka ulang aplikasi untuk memuat alur Purchasing/Sales/Admin.

## Fitur native

- Tombol kembali menutup dialog, kembali ke dashboard, atau meminta konfirmasi keluar.
- Ekspor CSV/JSON membuat berkas sementara dan membuka menu berbagi/simpan Android.
- Saat aplikasi kembali aktif, data dimuat ulang bila tidak ada formulir yang sedang dibuka.
- Komunikasi backend memakai HTTPS. Tidak ada izin akses seluruh penyimpanan, lokasi, kontak, atau kamera.

Notifikasi V1 hanya di dalam aplikasi. Tidak ada push/background notification atau mode menulis offline.

## Build lokal

Pasang Node.js 22+, JDK 21, Android SDK Platform 36 dan Build Tools 36.0.0 melalui Android Studio. Pastikan lisensi SDK diterima. Android Studio yang memakai JDK 25 perlu diatur ke JDK 21 untuk Gradle proyek ini.

```sh
npm ci
npm run android:apk
```

Jika perlu tentukan `JAVA_HOME` ke JDK 21 dan `ANDROID_HOME` ke direktori SDK. Script mencoba mendeteksi Java dari perintah `java`. Di Windows SDK default dicari di `%LOCALAPPDATA%/Android/Sdk`. Lokasi SDK hanya ditulis ke `android/local.properties`, yang tidak disertakan di Git.

Hasil: `outputs/Kedai-UPU-PO-v3.1-debug.apk`. Berkas APK ini adalah build debug untuk pemasangan/pengujian langsung; belum berupa rilis Play Store. Publikasi Play Store memerlukan application signing dan AAB rilis dengan keystore milik pengelola. Jangan mengunggah keystore/password penandatanganan ke repositori.

Proyek dapat dibuka dengan `npm run android:open`. Setelah mengubah file web, jalankan `npm run android:sync` sebelum build.

## GitHub Actions

Workflow `Build Android APK` dapat dijalankan manual melalui Actions. APK debug tersedia sebagai artifact setelah build selesai. Build dari komputer/runner berbeda dapat memakai sertifikat debug berbeda; distribusi berkelanjutan sebaiknya memakai penandatanganan rilis yang tetap.

## Pengujian

Pengujian web pada viewport HP dan database dijalankan terpisah dari build native. Keberhasilan build APK tidak berarti semua perangkat fisik sudah diuji. Setelah migrasi database aktif, periksa login Purchasing dan Sales pada dua perangkat, penerbitan/konfirmasi PO, tombol kembali, impor file, dan berbagi CSV.
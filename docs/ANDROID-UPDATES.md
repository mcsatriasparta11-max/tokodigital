# Pembaruan APK langsung

Aplikasi mulai versi 3.3.8 memeriksa `https://mcsatriasparta11-max.github.io/tokodigital/update.json` setelah layar awal selesai dan saat kembali aktif (maksimal setiap 30 menit). Menu Akun menyediakan pemeriksaan manual. Versi lama harus dipasangi 3.3.8 satu kali untuk mendapatkan updater.

Updater memberi pemberitahuan versi baru. Setelah pengguna menekan Unduh & perbarui, APK diunduh dari GitHub Releases melalui koneksi HTTPS. Hash SHA-256, package aplikasi, nomor versi, dan sertifikat penandatanganan harus cocok sebelum pemasang Android dibuka. Android tetap meminta persetujuan pemasangan; pada pemasangan pertama pengguna mungkin harus mengizinkan sumber ini di pengaturan Android. Fitur ini untuk distribusi APK langsung, bukan jalur rilis Google Play.

## Menerbitkan pembaruan berikutnya

1. Naikkan `package.json`, versi root `package-lock.json`, `versionName` dan `versionCode` pada Gradle, nama output pada `scripts/build-android.cjs`, dan nama artefak workflow Android. `versionCode` harus selalu naik.
2. Jalankan `npm.cmd run android:apk` dan periksa APK. Commit sumber rilis sebelum membuat release.
3. Jalankan `npm.cmd run android:publish`. Skrip memeriksa sertifikat, mengunggah APK ke GitHub Release untuk versi tersebut, memverifikasi unduhan publik, lalu menulis `dist/update.json` berisi versi, URL, dan hash APK. Login GitHub melalui Git Credential Manager diperlukan.
4. Commit dan push `dist/update.json`. Setelah GitHub Pages selesai, perangkat yang telah memakai updater akan menemukan versi baru pada pemeriksaan berikutnya. Tidak perlu membagikan ulang tautan APK ke setiap pengguna.

File penandatanganan `.openai/android-update.keystore` berasal dari kunci yang menandatangani APK sebelumnya dan dikecualikan dari Git. Simpan cadangan privat kunci itu; tanpa kunci yang sama APK tidak bisa menimpa instalasi lama. Sertifikat publik yang diizinkan tercatat di `android/update-signing.sha256`. Build lokal memakai cadangan kunci tersebut bila tersedia. Build GitHub Actions tanpa kunci yang sama menghasilkan APK dengan sertifikat berbeda, sehingga skrip penerbitan akan menolaknya. Jangan mengunggah keystore, access token, atau password ke repository.

APK yang sudah diterbitkan tidak ditimpa. Untuk mengubah isinya, naikkan nomor versi dan terbitkan release baru. Untuk menghentikan penawaran pembaruan, ubah `enabled` menjadi `false` di `dist/update.json` lalu deploy Pages; ini tidak menghapus aplikasi dari perangkat.

## Validasi

`node --test tests/updater.test.cjs` memeriksa aturan sumber/versi pembaruan. `npm.cmd run test:browser` menguji penawaran pembaruan, unduhan, alur izin Android, dan tombol pemasangan dengan adapter mock. Kompilasi Android dan pemeriksaan tanda tangan APK dilakukan terpisah; pengujian tersebut tidak menggantikan pemasangan nyata pada ponsel.

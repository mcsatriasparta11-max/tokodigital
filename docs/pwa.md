# Kedai UPU PWA

Website: https://mcsatriasparta11-max.github.io/tokodigital/

Android: buka lewat Chrome/Edge lalu pilih Pasang aplikasi ketika tersedia, atau gunakan menu browser untuk memasang/menambahkan ke layar utama.

iPhone/iPad: buka lewat Safari, Bagikan, Tambahkan ke Layar Utama, Tambah. Buka aplikasi dari ikon di layar utama. Web Push memerlukan iOS/iPadOS 16.4 atau lebih baru dan izin pengguna melalui tombol Aktifkan notifikasi browser setelah login.

Manifest memakai scope/start_url relatif agar sesuai subfolder GitHub Pages. Service worker push-sw.js yang sudah dipakai Web Push didaftarkan juga tanpa izin notifikasi. Subscription push tetap memakai worker/scope yang sama; tidak meminta izin notifikasi otomatis.

Aplikasi membutuhkan internet untuk PO/chat dan login. Hanya halaman offline publik disimpan dalam Cache Storage; respons API, dashboard, chat, PO dan token login tidak dicache oleh service worker. Saat online selalu mengambil halaman terbaru dari jaringan. Perubahan web tersedia ketika aplikasi dibuka ulang dengan koneksi internet. PWA tidak menggunakan APK atau signing key Android.

Pengujian lokal: node tests/pwa-browser.cjs serta node --test tests/web-push-sw.test.cjs tests/web-push-client.test.cjs. Pengujian browser mencakup manifest pada subfolder, ukuran ikon, install prompt, fallback offline dan kembali online, serta petunjuk iPhone. Pemasangan/notifikasi pada perangkat iPhone fisik belum diuji.

Referensi: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ dan https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest

Saat tombol Masuk ditekan dengan formulir valid, browser diminta menampilkan izin notifikasi jika status masih default. Permintaan dimulai langsung dari interaksi pengguna sebelum menunggu autentikasi; pendaftaran perangkat ke akun baru dilakukan setelah login berhasil. Penolakan, penutupan, atau kegagalan prompt tidak menghalangi login. Izin yang sebelumnya ditolak harus diubah lewat pengaturan browser. iPhone tetap memerlukan PWA terpasang dan dibuka dari layar utama.

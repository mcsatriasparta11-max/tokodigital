# Menyiapkan Supabase untuk Kedai UPU

Panduan ini mencakup setup awal. Versi 3.1 sudah mendukung pendaftaran akun langsung di aplikasi; lihat `docs/REGISTRATION.md` dan gunakan migrasi tambahan 202610260003 untuk daftar persetujuan.

Status paket ini: integrasi dan migrasi tersedia; proyek database online harus dibuat dan dikonfigurasi terlebih dahulu. Tidak ada password atau service_role key di aplikasi.

## 1. Buat proyek milik Anda

1. Masuk ke https://supabase.com/dashboard dan buat/pilih organisasi milik Anda.
2. Buat proyek bernama `kedai-upu-po`. Pilih wilayah yang dekat dengan pengguna. Simpan password database di tempat pribadi; aplikasi browser tidak memerlukannya.
3. Pilih paket yang Anda inginkan setelah melihat ketentuan dan biaya yang ditampilkan Supabase. Tunggu database siap.

Jika Supabase terhubung ke chat, agen dapat membantu membuat dan mengonfigurasi proyek sesuai akses yang diberikan. Koneksi belum dianggap tersedia sampai terverifikasi.

## 2. Buat tabel dan API penyimpanan

Buka SQL Editor proyek. Salin seluruh `supabase/migrations/202610260001_purchasing.sql`, lalu jalankan **satu kali** pada proyek baru. Skrip berjalan di dalam transaksi, sehingga kesalahan membatalkan perubahan skrip tersebut. Jangan jalankan ulang pada database yang tabelnya sudah ada.

Hasilnya:

- `purchasing_workspaces`: nama workspace, dokumen pembelian JSONB, versi, waktu, dan pengguna terakhir yang menyimpan.
- `purchasing_members`: daftar pengguna yang diizinkan per workspace.
- `purchasing_save`: RPC yang mengecek anggota, mengunci baris, membandingkan versi, memvalidasi seluruh data, dan menyimpan secara atomik.
- Row Level Security (RLS): browser tidak dapat menambah anggota atau menulis langsung ke tabel.

Workspace bawaan: `11111111-1111-4111-8111-111111111111`. Database dimulai kosong, tanpa contoh supplier atau PO.

Desain ini mempertahankan format cadangan aplikasi sebagai satu dokumen transaksi untuk tim kecil. Batas dokumen 10 MB. Perubahan bersamaan akan meminta salah satu pengguna memuat ulang; tidak ada penggabungan otomatis. Untuk volume/tingkat konkurensi yang besar, gunakan model tabel per entitas dan API per operasi.

## 3. Buat akun anggota

1. Buka Authentication > Users. Buat pengguna email/kata sandi melalui fasilitas penambahan pengguna, dengan email terkonfirmasi sesuai pengaturan proyek. Gunakan kata sandi kuat dan sampaikan secara pribadi, bukan melalui repositori/chat publik.
2. Buka `supabase/add-member.sql`. Ganti `GANTI_EMAIL_ANDA` dengan email pengguna tersebut, lalu jalankan di SQL Editor.
3. Ulangi untuk setiap anggota tim yang boleh menggunakan data yang sama. Semua anggota memiliki akses baca/tulis penuh untuk workspace ini. Keanggotaan dikelola melalui dashboard, bukan aplikasi publik.
4. Jika pendaftaran mandiri tidak diperlukan, nonaktifkan signup publik pada pengaturan Auth proyek.

Untuk mencabut akses anggota, jalankan di SQL Editor:

```sql
delete from public.purchasing_members
where workspace_id='11111111-1111-4111-8111-111111111111'
  and user_id=(select id from auth.users where email='EMAIL_ANGGOTA');
```

Pengguna yang dicabut aksesnya tidak dapat membaca atau menyimpan melalui API lagi. Data yang sudah pernah dilihat atau diunduh tidak dapat ditarik dari perangkat pengguna.

## 4. Hubungkan situs

Cari **Project URL** dan **publishable key** (atau legacy **anon key**) pada pengaturan proyek/API Keys/Connect di dashboard. Jangan gunakan secret key, service_role key, password database, atau personal access token.

Cara yang berlaku untuk seluruh perangkat: isi `dist/config.js`, commit, lalu unggah ke GitHub:

```js
window.UPU_CONFIG = {
  supabaseUrl: 'https://PROJECT_REF.supabase.co',
  supabaseKey: 'sb_publishable_GANTI_DENGAN_KEY_PROYEK',
  workspaceId: '11111111-1111-4111-8111-111111111111'
};
```

URL dan publishable/anon key memang dipakai di browser. Perlindungan data bergantung pada RLS dan daftar anggota di server. Secret/service_role key akan ditolak oleh aplikasi.

Untuk mencoba tanpa mengubah repositori: buka Profil & Pengaturan > Hubungkan Supabase, lalu isi konfigurasi yang sama. Cara ini hanya berlaku pada browser tersebut. Bila `dist/config.js` sudah diisi, konfigurasi situs diprioritaskan.

Untuk login email/kata sandi ini, tidak ada callback OAuth yang diperlukan. Bila kemudian memakai undangan/reset password berbasis email, atur Site URL dan Redirect URLs Auth ke `https://mcsatriasparta11-max.github.io/tokodigital/` dan siapkan alur pemulihannya dahulu. Versi ini mengarahkan pengguna yang lupa sandi kepada pengelola toko.

## 5. Pindahkan data lama dan periksa dua perangkat

1. Sebelum menghubungkan Supabase, unduh cadangan data browser lama melalui Profil & Pengaturan. Lakukan pada browser yang berisi data sebenarnya.
2. Setelah situs terhubung, masuk dengan akun yang sudah menjadi anggota. Database baru akan kosong.
3. Di Akun & Workspace pilih **Pindahkan data browser lama** atau **Pulihkan cadangan ke database bersama**. Periksa konfirmasi: tindakan ini mengganti seluruh data workspace, bukan menggabungkannya. Unduh cadangan database terlebih dahulu bila sudah terisi.
4. Buat satu supplier, produk, dan PO. Buka situs dari HP, masuk dengan akun anggota, lalu pilih **Muat data terbaru**. Pastikan data yang sama muncul.
5. Uji bahwa akun yang belum menjadi anggota tidak bisa membuka workspace.

Jika perubahan bersamaan ditolak atau jaringan gagal saat menyimpan, aplikasi menahan salinan perubahan yang belum tersimpan di memori halaman. Unduh salinan tersebut sebelum memuat ulang atau menutup halaman. Pilih **Muat data server**, kemudian ulangi perubahan pada versi terbaru. Salinan penuh jangan langsung dipulihkan tanpa meninjau perubahan anggota lain.

Aplikasi tidak otomatis mengunggah data browser lama. Jangan mengandalkan penyimpanan browser sebagai backup database. Atur backup sesuai kebutuhan dan fasilitas paket Supabase yang dipilih.

## Referensi resmi

- Auth: https://supabase.com/docs/guides/auth
- Login email/kata sandi: https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Fungsi database: https://supabase.com/docs/guides/database/functions
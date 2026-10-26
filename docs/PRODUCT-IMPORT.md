# Impor master produk

Admin membuka Import Produk atau Master Produk > Import Excel.

Kolom wajib, berurutan dalam template:

kode,nama barang,kelp-satuan,kelp-volume,suplier

Contoh: 000123,Biskuit,CRT-PCS,24-1,SUP1

Format kolom kode dan kelp-volume sebagai Teks di Excel agar nol awal dan tanda hubung tidak diubah Excel. Suplier berisi kode atau nama supplier aktif yang sudah terdaftar. Kode produk harus unik; kode yang sudah ada akan memperbarui nama dan konversinya, tanpa memindahkan supplier.

CRT-PCS dengan 24-1 berarti 1 CRT berisi 24 PCS. Faktor menunjukkan jumlah satuan terkecil untuk masing-masing satuan, berurutan dari terbesar ke terkecil dan berakhir 1. Contoh tiga satuan: CRT-PACK-PCS dengan 24-6-1. Produk satu satuan: PCS dengan 1.

Impor hanya menyimpan master produk. Saat membuat PO, pilih produk, satuan CRT atau PCS, dan isi qty pesanan. Contoh 2 CRT setara 48 PCS; 7 PCS tetap 7 PCS. Server menghitung dan menyimpan konversi pada baris PO. Perubahan master berikutnya tidak mengubah konversi PO yang sudah tersimpan.

File XLSX, XLS, atau CSV maksimal 5 MB dan 10.000 baris. Preview menampilkan maksimal 30 baris. Seluruh penyimpanan bersifat transaksional: satu baris tidak valid membatalkan seluruh batch. Import PO tetap tersedia terpisah dengan kolom supplier,nama_produk,qty,satuan.

## Aktivasi

Jalankan supabase/migrations/202610260004_product_units.sql di SQL Editor setelah migrasi workflow kedua. Salinan lokal tersedia di .openai/enable-product-import.sql. Jangan jalankan ulang activate-blueprint.sql. Migrasi tambahan ini aman dijalankan ulang, mempertahankan produk dan jumlah PO lama. Tanpa migrasi ini penyimpanan master baru akan meminta aktivasi.

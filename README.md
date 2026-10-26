# Kedai UPU PO

Aplikasi web responsif untuk Android dan desktop, berdasarkan referensi UI pengguna.

Buka `dist/index.html` atau sajikan folder `dist` melalui server HTTP. Tidak membutuhkan proses build.

Fitur: dashboard, pencarian/filter PO, pembuatan PO manual, perubahan status, supplier/produk (tambah dan edit), impor XLSX/XLS/CSV dengan review, ekspor CSV, aktivitas, dan backup/pemulihan JSON.

Data tersimpan dalam localStorage browser masing-masing perangkat. Data pertama adalah contoh. Belum tersedia akun, database server, atau sinkronisasi antarperangkat. Library Excel dan font memerlukan koneksi internet.

Format impor: supplier,kode_produk,nama_produk,qty. Template dapat diunduh dari menu Import Excel.

# Impor supplier

Admin membuka Supplier & Sales > Import Excel. Kolom Excel/CSV: kode,nama suplier. Contoh SUP1,PT Sumber Makmur. Format kode sebagai Teks agar nol awal tetap utuh. File maksimal 5 MB dan 10.000 baris; preview maksimal 30 baris. Kode duplikat atau baris tidak valid membatalkan seluruh impor.

Kode baru menambah supplier aktif tanpa mapping Sales. Kode yang sudah ada hanya memperbarui nama; mapping Sales dan status tetap dipertahankan. Setelah impor, gunakan Edit Mapping untuk menunjuk Sales sebelum menerbitkan PO. Impor ini tidak membuat PO atau akun.

Aktivasi: jalankan supabase/migrations/202610260005_supplier_import.sql satu kali di SQL Editor Supabase setelah migrasi workflow. Salinan lokal .openai/enable-supplier-import.sql. Skrip aman dijalankan ulang. Jangan jalankan ulang activate-blueprint.sql.

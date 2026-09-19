# Rilis Play Store — Lakoku Android

Paket: `biz.lakoku.app` (permanen) · Bahasa: Indonesia · Kategori: Buku & Referensi
AAB: `android/app/build/outputs/bundle/release/app-release.aab` (bertanda tangan, upload key lokal)
Kontak listing: [SESUAIKAN] support@lakoku.biz.id · Privasi: https://lakoku.biz.id/privacy

## Deskripsi singkat (maks 80 karakter):

Novel interaktif berbahasa Indonesia — kamulah tokoh utamanya.

## Deskripsi lengkap

Lakoku adalah novel interaktif berbahasa Indonesia di mana KAMU menjadi tokoh utama.

Setiap pilihan yang kamu buat mengubah arah cerita — menjelajahi misteri, romansa, dan petualangan dalam 50 bab penuh kejutan. Jejak pilihanmu tersimpan di akunmu dan bisa dilanjutkan di web maupun aplikasi Android.

Fitur:
- Cerita bercabang: pilihanmu menentukan bab berikutnya
- 50 bab per cerita dengan akhir yang beragam
- Lanjutkan membaca di web atau Android dengan akun yang sama
- Koleksi pribadi dan progres tersimpan otomatis

Unduh gratis. Bab premium dapat dibuka dengan kredit yang bisa dibeli di dalam aplikasi.

## Produk dalam aplikasi

Buat 6 produk terkelola (managed product, sekali beli, CONSUABLE habis pakai) dengan ID persis:

| ID Produk Play | Nama di Play | Harga (IDR) | Kredit diberi (server) |
|---|---|---|---|
| lakoku_credits_starter | Paket Pemula | 15000 | 30 + bonus |
| lakoku_credits_basic | Paket Dasar | 30000 | 70 + bonus |
| lakoku_credits_plus | Paket Plus | 50000 | 130 + bonus |
| lakoku_credits_pro | Paket Pro | 100000 | 300 + bonus |
| lakoku_credits_max | Paket Maksi | 200000 | 700 + bonus |
| lakoku_credits_ultra | Paket Ultra | 500000 | 2000 + bonus |

Jumlah kredit final dihitung server (termasuk bonus topup pertama / normal) — harga di Play hanya pintu pembayaran. Setelah produk dibuat di Play, aktifkan baris katalog `android` di dashboard admin (kolom `active=true`).

## Keamanan Data

Isi formulir Data Safety dengan jawaban berikut (sesuai implementasi server):

- Data yang dikumpulkan: alamat email (akun), ID pengguna, riwayat pembelian, interaksi aplikasi (pilihan cerita, progres baca).
- Data dienkripsi saat transit: YA (HTTPS).
- Pengguna dapat meminta penghapusan data: [KONFIRMASI] via email kontak — pastikan alur hapus akun tersedia sebelum rilis produksi.
- ID iklan: TIDAK digunakan (jawab "Tidak" pada deklarasi Advertising ID).
- Kebijakan privasi: https://lakoku.biz.id/privacy

## Langkah upload

1. Play Console → aplikasi lakoku → Pengujian internal → Buat rilis baru → upload `app-release.aab`.
2. Tambahkan penguji internal (alamat email) → bagikan link pengujian.
3. Monetisasi → Produk dalam aplikasi → buat 6 produk dari tabel di atas (status Aktif).
4. Isi listing toko (teks dari dokumen ini) + upload `store-assets/icon-512.png`, `store-assets/feature-graphic-1024x500.png`, minimal 2 screenshot HP.
5. Isi kuesioner: rating konten, target audiens, Keamanan Data, deklarasi Advertising ID = Tidak.
6. Pengguna dan izin → undang service account Google (lihat P6) dengan peran "Melihat data keuangan".
7. Setelah internal test lolos → track Tertutup (20 penguji, 14 hari, wajib akun baru) → Produksi.

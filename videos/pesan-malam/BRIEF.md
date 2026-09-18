---
workflow: general-video
flow: automation
storyboard: no
message: "Satu notifikasi, satu pilihan — dan kamulah tokoh utamanya"
destination: tiktok-reels-shorts
aspect: 1080x1920
language: id
length: 21.5s
angle: dramatisasi
---

## Intent

Iklan akuisisi lalu-lintas dingin untuk Lakoku, novel interaktif berbahasa
Indonesia. Penonton harus mengalami satu keputusan sebelum tahu ini aplikasi
apa. Naskahnya adalah mini-choice asli dari landing page, jadi iklan dan
halaman tujuan menjanjikan hal yang sama persis.

Rasa: malam hujan, sunyi, tegang tapi hangat. Sinematik lambat, bukan gerak
cepat. Harus terbaca penuh tanpa suara.

Ini video pilot dari lima konsep. Spec lengkap:
`docs/superpowers/specs/2026-09-19-hyperframes-video-concepts-design.md`.

## Assets

- assets/plate-malam.jpg — potongan 9:16 dari `public/landing/hero-rainy-reflection.webp`, dipusatkan ke tangan + HP. Plate babak 1–3.
- assets/cover-pesan-terakhir.jpg — sampul "Pesan Terakhir di Ponselnya". Babak 4, sampul pertama.
- assets/cover-di-balik-kaca.jpg — sampul "Di Balik Kaca". Babak 4, sampul kedua.
- assets/cover-koper-di-depan-pintu.jpg — sampul "Koper di Depan Pintu". Babak 4, sampul ketiga.
- assets/logo-lakoku.png — app icon monogram "L" (dari `public/logo.png`), endcard.

## Customizations

- Notifikasi dan tombol pilihan dibangun ulang sebagai HTML di atas layar HP di foto, bukan screenshot. Layar HP di plate nyaris kosong, jadi UI kita menempel di sana.
- Dorongan kamera lambat pada plate sepanjang babak 1–3, satu gerakan menerus tanpa reset.

## Notes

- Brand guard `AGENT_RULES.md`: kata "AI", "Narraza", "RAG", "token" dilarang muncul di layar.
- Semua copy dikutip persis dari kode produksi, bukan dikarang.
- Tanpa audio. Video ini dirancang untuk pemutaran bisu; jangan tambahkan musik tanpa persetujuan.
- Teks kunci minimal 2,0 detik di layar. (Durasi naik dari 18s ke 21,5s saat produksi
  supaya syarat ini benar-benar terpenuhi di babak sampul dan konfirmasi.)

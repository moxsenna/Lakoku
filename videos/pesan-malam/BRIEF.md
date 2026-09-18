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

## Audio (disetujui user, 2026-09-19)

Video tidak lagi bisu. Mix: musik + 8 SFX dari pustaka `videos/sfx/` (semua Mixkit Free
License, komersial tanpa atribusi).

- **Musik**: "Silent Descent" (Mixkit 614) — piano/strings melancholic. Bagian penuh trek
  dipakai via `data-media-start="60"` (intro 21,5s pertama trek nyaris senyap). Level 0,55,
  fade in 0,8s / fade out 1,4s.
- **Bed hujan** (`amb-rain-night-loop`) hanya babak 1–3 (0–9,4s), fade out cepat menyatu
  dengan potongan keras ke sampul.
- **Beat SFX**: notif pop 0,3s · ui-select 4,2s (tombol muncul) · ui-click 5,6s (tekan) ·
  ui-check-pop 6,53s (konfirmasi) · impact-whoosh-deep 9,4s (hard cut) · whoosh-light-pop
  11,4s & 13,4s (tukar sampul) · whoosh-sparkle 19,05s (endcard).
- Mix mean ±−20 dB RMS, puncak −1,5 dB. Platform medsos menormalisasi loudness sendiri.

## Notes

- Brand guard `AGENT_RULES.md`: kata "AI", "Narraza", "RAG", "token" dilarang muncul di layar.
- Semua copy dikutip persis dari kode produksi, bukan dikarang.
- Teks kunci minimal 2,0 detik di layar. (Durasi naik dari 18s ke 21,5s saat produksi
  supaya syarat ini benar-benar terpenuhi di babak sampul dan konfirmasi.)

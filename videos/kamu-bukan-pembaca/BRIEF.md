---
workflow: general-video
flow: automation
storyboard: no
message: "Klaim langsung lewat tipografi — kamu tokoh utamanya, bukan pembacanya"
destination: tiktok-reels-shorts
aspect: 1080x1920
language: id
length: 15.3s
angle: klaim
---

## Intent

Iklan akuisisi varian klaim — pasangan A/B dengan Konsep 1 "Pesan Malam". Tuas
yang diuji adalah **cara hook disampaikan**: Konsep 1 mendramatisasi lewat
notifikasi, Konsep 2 mengklaim langsung lewat tipografi besar di atas ink polos.
Endcard, CTA, dan halaman tujuan **identik dengan Konsep 1** (termasuk slogan
endcard terbaru) supaya hasil A/B bisa dibaca tanpa variabel lain.

Rasa: tegas, minimal, tipografis. Tanpa foto — ink polos + glow plum. Harus
terbaca penuh tanpa suara.

## Assets

- assets/logo-lakoku.png — app icon monogram "L" (dari `public/logo.png`), endcard.
- assets/fonts/ — DM Serif Display 400 + Plus Jakarta Sans variable (self-embed).
- assets/audio/ — musik + SFX dari pustaka `videos/sfx/` (Mixkit Free License).

## Customizations

- Hook 0–4s: dua kalimat serif besar bergantian — "Kamu bukan pembaca." lalu
  "Kamu tokoh utamanya." (aksen rose pada "tokoh utamanya.").
- Kartu premis 4–9,7s: tiga premis dari `app/page.tsx` (nomor gold + judul serif),
  scale-swap 1,9 detik per kartu.
- Statement 9,7–12,2s: dua tombol pilihan hero yang sengaja DIBLUR di belakang
  teks tajam "Setiap pilihanmu mengubah arah cerita."
- Endcard 12,2–15,3s: identik Konsep 1 (logo app-icon + Lakoku + CTA rose +
  slogan "Kalau ini ceritamu, apa yang akan kamu lakukan?").

## Notes

- Brand guard `AGENT_RULES.md`: kata "AI", "Narraza", "RAG", "token" dilarang muncul di layar.
- Semua copy dikutip persis dari kode produksi (`app/page.tsx`, `components/landing/hero-choice.tsx`).
- Audio disetujui pola pilot: musik sama "Silent Descent" (variabel A/B terjaga),
  SFX beat di level rendah sesuai preferensi user (gain 0,275–0,4).

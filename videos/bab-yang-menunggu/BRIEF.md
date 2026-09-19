---
workflow: general-video
flow: automation
storyboard: no
message: "Ceritamu berhenti di tengah — satu keputusan masih menunggu giliranmu"
destination: retargeting-winback
aspect: 1080x1920
language: id
length: 13s
angle: retensi
---

## Intent

Video retensi/reaktivasi terpendek dari set Lakoku (spec
`docs/superpowers/specs/2026-09-19-hyperframes-video-concepts-design.md` § Konsep 5).
Untuk retargeting, notifikasi, dan email winback: pembaca yang berhenti di
tengah cerita dikembalikan dengan bilah progres dan satu keputusan yang belum
diambil.

Rasa: sunyi, jam berdetak, satu halaman yang tertinggal. Harus terbaca penuh
tanpa suara.

## Assets

- assets/cover-selasa.jpg — sampul "Selasa Terakhir" (`public/covers/selasa-terakhir.webp`, 1080x1080).
- assets/logo-lakoku.png — app icon monogram "L" (`public/logo.png`).
- assets/fonts/ — DM Serif Display + Plus Jakarta Sans (self-embed).
- assets/audio/ — musik + SFX dari pustaka `videos/sfx/` (Mixkit Free License).

## Customizations

- 0–3s: sampul meredup, bilah progres mengisi lalu BERHENTI di 24%.
- 3–7s: bilah berdenyut, label "Bab 12 dari 50".
- 7–9,8s: dua tombol pilihan muncul redup, satu bingkai rose (keputusan yang menunggu).
- 9,8–13s: endcard logo + CTA "Lanjutkan Ceritaku" + slogan brand.
- Durasi dirender 13s (spec 12s) supaya dwell CTA endcard ±2 detik — pelajaran
  pilot Konsep 1.

## Notes

- Brand guard `AGENT_RULES.md`: kata "AI", "Narraza", "RAG", "token" dilarang muncul di layar.
- Angka "Bab 12 dari 50" adalah contoh generik untuk render tunggal, BUKAN data
  pembaca sungguhan. Jangan personalisasi angka tanpa pipeline data terpisah (spec §5).
- Copy tombol dikutip persis dari `app/page.tsx` (pasangan pilihan landing).
- Audio disetujui (pola pilot): level rendah, gain 0,16–0,4.

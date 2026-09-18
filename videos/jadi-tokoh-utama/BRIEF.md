---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Novel interaktif berbahasa Indonesia — kamu tokoh utamanya, dari malam hujan sampai 50 bab"
destination: youtube-landing-pitch
aspect: 1920x1080
language: id
length: 35s
angle: brand
---

## Intent

Satu-satunya format panjang dan horizontal dari set video Lakoku (spec
`docs/superpowers/specs/2026-09-19-hyperframes-video-concepts-design.md` § Konsep 4).
Menjelaskan produk secara utuh: apa itu, rasanya bagaimana, dan kenapa berbeda
dari novel biasa. Dipakai untuk video landing, YouTube, dan pitch.

Rasa: sinematik hujan malam yang hangat, tempo lambat, klaim-klaim brand dari
landing page. Tanpa narasi — semua pesan di layar.

Route `/product-launch-video` dieksekusi inline (pola yang sama dengan dua video
sebelumnya) karena brief-nya sudah terkunci di spec, sumber visual adalah aset
asli repo (bukan situs yang harus di-capture), dan tidak ada narasi/TTS.

## Assets

- assets/act1-malam.jpg — `public/landing/hero-rainy-reflection.webp` (1672x941, 16:9 asli).
- assets/act2-pilihan.jpg — `public/landing/choice-rainy-drive.webp` di-crop 1180x664+0+140
  supaya teks Inggris "You told me the truth, right?" di layar HP keluar frame, lalu
  di-resize 1920x1080.
- assets/act3-konsekuensi.jpg — `public/landing/memory-rainlit-letters.webp`.
- assets/covers/*.jpg — enam sampul cerita dari `public/covers/` (480x480).
- assets/logo-lakoku.png — app icon monogram "L" (`public/logo.png`).
- assets/audio/ — pustaka `videos/sfx/` + musik "Silent Descent".

## Customizations

- Enam babak per spec: Malam (Ken Burns + pertanyaan brand) → Pilihan (dua tombol
  HTML naik, label persis landing §4) → Konsekuensi (kilatan bab bercabang, copy
  timeline landing §5) → Dunia (kisi enam sampul bergeser pelan + genre) → Janji
  (ink polos, klaim 50 bab) → Endcard ("Temukan Ceritaku" + lakoku.biz.id).
- Hard cut antar babak dengan penanda audio (pola pilot); glow plum bernapas di
  babak ink.

## Notes

- Brand guard `AGENT_RULES.md`: kata "AI", "Narraza", "RAG", "token" dilarang muncul di layar.
- Semua copy dikutip persis dari kode produksi (`app/page.tsx`,
  `components/landing/hero-choice.tsx`) kecuali teks babak Janji dan genre yang
  sudah disetujui di spec.
- Audio disetujui (pola pilot): level rendah, gain 0,2–0,4.

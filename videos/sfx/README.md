# Pustaka SFX Video Lakoku

Efek suara untuk produksi video promosi (spec: `docs/superpowers/specs/2026-09-19-hyperframes-video-concepts-design.md`).
Semua file MP3 320 kbps, 44,1 kHz stereo.

## Lisensi — WAJIB DIBACA

Semua suara berasal dari [Mixkit](https://mixkit.co/free-sound-effects/) di bawah
**Mixkit Sound Effects Free License**:

- ✅ Bebas dipakai untuk video komersial (iklan TikTok/Reels/Shorts, landing page) **tanpa atribusi**
- ✅ Boleh dipotong, di-loop, digain, dimix
- ❌ **Tidak boleh didistribusikan ulang sebagai pustaka audio mandiri** — file ini hanya
  boleh ter-bundel di dalam video final. Jangan pernah menyalin folder ini ke publik,
  repository terbuka lain, atau dikirim sebagai "paket sound effect".

Sumber tiap file tercatat di tabel bawah (ID Mixkit = `https://mixkit.co/free-sound-effects/download/<ID>/`).

## Peta pemakaian per video

| Video | SFX |
|-------|-----|
| 1 · Pesan Malam (pilot, 21,5s) | `amb-rain-night-loop` sebagai bed; `notif-message-pop` saat pesan masuk (~0,3s); `ui-select` tombol muncul; `ui-click-modern` atau `type-soft` saat tombol ditekan (5,6s); `ui-check-pop` pil konfirmasi (6,5s); `impact-whoosh-deep` potongan keras ke sampul (9,4s); `whoosh-light-pop` tiap tukar sampul (11,4s, 13,4s); `whoosh-sparkle` endcard (19s) |
| 2 · Kamu Bukan Pembaca (15,3s) | Musik sama "Silent Descent" (variabel A/B terjaga, `data-media-start="60"`); `whoosh-light-pop` tiap kalimat hook & kedatangan kartu; `whoosh-fast` tiap tukar premis; `ui-select` statement (motif pilihan); `whoosh-sparkle` endcard |
| 3 · Kredit Gratis Tiap Hari (20s) | `tick-counter` angka kredit naik; `ui-check-pop` misi tercentang; `coin-win` kredit masuk; `achievement` misi selesai; `chime-positive` undangan referral; `ui-select` tombol |
| 4 · Jadi Tokoh Utama (35s, 16:9) | `amb-rain-light-loop` bed; `heartbeat-medium` beat dramatis; `whoosh-cinematic` transisi babak; `impact-whoosh-deep` masuk Bab 45 lock; `whoosh-sparkle` + `chime-positive` logo & CTA |
| 5 · Bab yang Menunggu (12s) | `clock-tick` bed; `page-turn` bab bergulir; `heartbeat-slow` tension; `notif-bell` notifikasi masuk; `whoosh-fast` snap ke CTA |

## Referensi file

| File | Durasi | Mixkit ID | Judul asli |
|------|--------|-----------|------------|
| `amb-rain-light-loop.mp3` | 15,0s | 2393 | Light rain loop |
| `amb-rain-night-loop.mp3` | 12,2s | 1252 | Intense rain in a calm night |
| `notif-message-pop.mp3` | 1,1s | 2354 | Message pop alert |
| `notif-bell.mp3` | 3,4s | 933 | Bell notification |
| `ui-select.mp3` | 1,6s | 2573 | Interface option select |
| `ui-click-modern.mp3` | 0,2s | 2568 | Cool interface click tone |
| `ui-check-pop.mp3` | 0,2s | 1120 | Modern click box check |
| `whoosh-fast.mp3` | 1,8s | 1490 | Fast whoosh transition |
| `whoosh-cinematic.mp3` | 1,3s | 1492 | Cinematic whoosh fast transition |
| `whoosh-light-pop.mp3` | 0,2s | 3005 | Explainer video pops whoosh light pop |
| `whoosh-sparkle.mp3` | 3,5s | 2350 | Magic sparkle whoosh |
| `impact-whoosh-deep.mp3` | 4,1s | 1143 | Cinematic whoosh deep impact |
| `impact-big.mp3` | 7,9s | 788 | Big cinematic impact |
| `riser-reverse-impact.mp3` | 10,1s | 784 | Reverse cinematic impact trailer |
| `coin-win.mp3` | 2,6s | 1936 | Magical coin win |
| `achievement.mp3` | 3,6s | 2068 | Achievement completed |
| `chime-positive.mp3` | 2,8s | 951 | Positive notification |
| `tick-counter.mp3` | 6,5s | 1053 | Ticking counter |
| `type-key.mp3` | 0,7s | 1382 | Mechanical typewriter single hit |
| `type-soft.mp3` | 0,2s | 1125 | Typewriter soft click |
| `clock-tick.mp3` | 23,0s | 1060 | Wall clock tick tock |
| `heartbeat-medium.mp3` | 29,7s | 495 | Heartbeat medium speed |
| `heartbeat-slow.mp3` | 45,3s | 494 | Slow heartbeat |
| `page-turn.mp3` | 2,6s | 1101 | Single book paging |
| `music-silent-descent.mp3` | 2:40 | 614 | Silent Descent (piano/strings, melancholic) |

Musik memakai **Mixkit Stock Music Free License** (syarat sama: komersial tanpa atribusi,
dilarang didistribusikan ulang mandiri). Terpakai di pilot "Pesan Malam" via
`data-media-start="60"` — intro 21,5s pertama trek ini nyaris senyap (mean −29,6 dB vs
−14,8 dB di menit kedua), jadi selalu cek profil loudness trek sebelum memakai bagian awal.

## Catatan produksi

- **Ambience loop**: `amb-rain-*` dan `clock-tick`/`heartbeat-*` perlu di-loop — pakai
  `-stream_loop -1` di ffmpeg atau potong titik loop yang mulus. Fade in/out 0,5s agar
  tidak "pop" di awal-akhir.
- **Gain mixing**: SFX foley (tap, pop) dudukan sekitar −12 dB di bawah ambience;
  impact/riser boleh mendominasi −6 dB. Selalu cek loudness final ± −14 LUFS untuk medsos.
- **Kebenaran copy**: SFX tidak mengubah aturan BRIEF. Audio pada video final hanya
  dipasang setelah disetujui user — pilot "Pesan Malam" sudah disetujui (2026-09-19).
- Menambah file baru: unduh dari halaman download Mixkit (URL asli bisa `.mp3` **atau**
  `.wav` — resolve dulu), konversi wav → `ffmpeg -i in.wav -codec:a libmp3lame -b:a 320k out.mp3`,
  lalu tambahkan baris di tabel ini dengan ID sumbernya.

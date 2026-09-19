# Desain: 5 Konsep Video Promosi Lakoku (HyperFrames)

**Tanggal:** 2026-09-19
**Status:** Menunggu persetujuan PM
**Skill:** `hyperframes` (HTML → video), proses `brainstorming`
**Branch saat ditulis:** `feat/dompet-imbalan-referral`

---

## 1. Ringkasan

Lima video promosi, satu tujuan per video, dibangun dengan HyperFrames. Semua
dirender dari HTML — UI Lakoku di dalam video **dibangun ulang sebagai HTML**,
bukan screenshot, supaya tajam di semua resolusi dan gampang diubah copy-nya.

| # | Judul | Rasio | Durasi | Tujuan | Route HyperFrames |
|---|-------|-------|--------|--------|-------------------|
| 1 | Pesan Malam | 9:16 | 18s | Akuisisi (varian dramatisasi) | `/general-video` |
| 2 | Kamu Bukan Pembaca | 9:16 | 15s | Akuisisi (varian klaim) — pasangan A/B dengan #1 | `/general-video` |
| 3 | Kredit Gratis Tiap Hari | 9:16 | 20s | Aktivasi misi + referral | `/general-video` |
| 4 | Jadi Tokoh Utama | 16:9 | 35s | Brand awareness / video landing | `/product-launch-video` |
| 5 | Bab yang Menunggu | 9:16 | 12s | Retensi / reaktivasi pembaca berhenti | `/general-video` |

**Ditunda:** video rilis Play Store (lihat §7).

---

## 2. Perubahan dari set konsep sesi sebelumnya

Tiga koreksi berbasis status fitur nyata di kode, bukan asumsi.

### 2.1 Video Play Store dibatalkan dari batch ini

`GATES.android.md` G9/G10 belum lolos: upload AAB manual, 20 tester selama 14
hari, dan review Google Play semuanya masih tertahan. Build dan signing sudah
100% selesai (`GATES.android-release.md` R0–R5 lolos), tapi aplikasi **belum
live di Play Store**. Video berisi klaim "sudah di Play" akan jadi klaim palsu
dan berisiko ditolak platform iklan. Video ini dibekukan sampai listing benar-
benar terbit — spec-nya tetap dicatat di §7 supaya tinggal dieksekusi.

### 2.2 Misi "Tonton Sekilas" dibuang dari naskah aktivasi

`lib/missions/policy.ts:37` menyetel `adRewardEnabled: false` (alasan: biaya
inferensi bab tinggi), jadi kartu iklan rewarded disembunyikan di UI. Naskah
Konsep 3 hanya memakai dua misi yang benar-benar hidup: **Hadir Hari Ini** dan
**Tentukan Langkahmu**.

### 2.3 Blok referral di Konsep 3 punya gerbang pra-render

`lib/rewards/policy.ts:24` menyetel `commissionEnabled: false` sebagai default
kode; akrual komisi baru jalan kalau admin menyalakannya lewat setting produksi.
Sebelum render Konsep 3, cek nilai produksi. Kalau menyala → render versi 20s
penuh. Kalau mati → render versi potong 14s tanpa blok referral. Keputusan ini
tidak boleh ditebak.

---

## 3. Fondasi brand (dipakai semua video)

**Palet** — diambil verbatim dari `app/globals.css` tema gelap (tema default
aplikasi, `app/layout.tsx:60`):

| Token | Hex | Pakai untuk |
|-------|-----|-------------|
| `--ink` | `#191319` | latar utama |
| `--plum` | `#3d1f3d` | latar sekunder, gradien |
| `--rose` | `#c94967` | aksen, tombol, penekanan |
| `--cream` | `#fff7ee` | teks utama |
| `--gold` | `#d5a45c` | aksen hangat (nilai tema gelap) |
| `--mauve` | `#e8dce8` | teks sekunder (nilai tema gelap) |

**Tipografi** — `DM Serif Display` untuk headline dan kalimat cerita,
`Plus Jakarta Sans` untuk UI, label, dan CTA. Sama persis dengan aplikasi.

**Aturan gerak** — dorongan kamera lambat (sinematik, bukan gerak cepat),
transisi potong keras hanya pada pergantian babak, tidak ada gerak yang
mengandalkan efek suara.

**Aturan teks** — semua video harus terbaca penuh tanpa suara. Teks kunci
minimal 2,0 detik di layar, ukuran besar, kontras tinggi.

**Brand guard** (wajib, `AGENT_RULES.md`) — kata "AI", "Narraza", "RAG", dan
"token" tidak boleh muncul di layar maupun di caption.

**Copy akurat** — semua kalimat produk dikutip dari kode, bukan dikarang. Klaim
harga dan fitur mengikuti `app/(shell)/kredit/page.tsx` dan
`lib/missions/policy.ts`.

---

## 4. Aset

### 4.1 Aset yang sudah ada di repo

| Berkas | Isi | Catatan |
|--------|-----|---------|
| `public/landing/hero-rainy-reflection.webp` | Perempuan di jendela hujan malam, memegang HP, layar HP nyaris kosong | 16:9. Layar HP kosong = tempat sempurna menempelkan notifikasi HTML kita |
| `public/landing/choice-rainy-drive.webp` | Dalam mobil, jalan hujan malam, HP di tangan penumpang | 16:9. **Ada teks Inggris terbaca** "You told me the truth, right?" di layar HP — wajib dipotong keluar frame atau ditutup |
| `public/landing/memory-rainlit-letters.webp` | Surat-surat lama tersorot cahaya hujan | 16:9 |
| `public/covers/pesan-terakhir.png` | Sampul cerita | Tagline: "Satu notifikasi mengubah segalanya." |
| `public/covers/di-balik-kaca.png` | Sampul cerita | Tagline: "Atasan barumu adalah masa lalumu." |
| `public/covers/koper-di-depan-pintu.png` | Sampul cerita | Tagline: "Malam ini kamu harus memilih: pergi, atau bertahan." |
| `public/covers/warisan-yang-tersembunyi.png` | Sampul cerita | Tagline: "Surat itu tidak seharusnya sampai padamu." |
| `public/covers/selasa-terakhir.webp` | Sampul cerita terbit | "Selasa Terakhir di Rumah Kaca" |
| `public/covers/bilik-ketujuh.webp` | Sampul cerita terbit | "Bilik Ketujuh" |
| `public/logo.webp`, `public/logo-with-text.png` | Logo | Untuk endcard |

**Repo tidak punya berkas video sama sekali.** Semua gerak berasal dari
animasi foto diam (dorongan kamera, Ken Burns) plus UI HTML.

### 4.2 Yang perlu dibuat

- Potongan 9:16 dari tiga foto landing. Semua sumber 16:9, jadi potongan
  vertikal harus dipusatkan ke subjek (tangan + HP), bukan ke tengah gambar.
- Komponen UI HTML: kartu notifikasi, tombol pilihan, kartu misi, kartu dompet,
  bilah progres bab, endcard. Dibangun ulang dari komponen aplikasi.
- Tidak ada rencana generate gambar baru untuk batch ini. Kalau muncul celah
  visual saat produksi, angkat dulu ke PM sebelum generate.

---

## 5. Konsep

### Konsep 1 — "Pesan Malam" (akuisisi, varian dramatisasi)

**9:16 · 18 detik · `/general-video` · lalu lintas dingin → `/mulai`**

Menjual lewat dramatisasi: penonton mengalami satu keputusan sebelum tahu ini
aplikasi apa. Naskahnya adalah mini-choice asli dari landing
(`components/landing/hero-choice.tsx`), jadi iklan dan halaman tujuan
menjanjikan hal yang sama persis.

| Waktu | Visual | Teks di layar |
|-------|--------|---------------|
| 0,0–2,5s | `hero-rainy-reflection.webp` dipotong 9:16 ke tangan + HP, dorongan kamera lambat | Notifikasi HTML menyala di layar HP: **"Aku tahu apa yang sebenarnya terjadi malam itu."** |
| 2,5–6,0s | Kamera terus mendekat, dua tombol naik dari bawah | **"Buka pesannya"** / **"Abaikan untuk malam ini"** |
| 6,0–8,5s | Tombol pertama menyala dan tertekan | **"Pilihanmu dicatat. Tapi itu baru keputusan pertama."** |
| 8,5–13,0s | Potong keras. Tiga sampul melintas satu per satu | "Satu notifikasi mengubah segalanya." → "Atasan barumu adalah masa lalumu." → "Malam ini kamu harus memilih: pergi, atau bertahan." |
| 13,0–16,0s | Latar ink polos | **"50 bab. Akhir yang berbeda-beda. Tergantung kamu."** |
| 16,0–18,0s | Endcard | Logo + **"Mulai Ceritaku"** + "3 bab pertama gratis · tanpa kartu" |

### Konsep 2 — "Kamu Bukan Pembaca" (akuisisi, varian klaim)

**9:16 · 15 detik · `/general-video` · pasangan A/B dengan Konsep 1**

Tuas yang diuji adalah **cara hook disampaikan**, bukan penawarannya. Konsep 1
mendramatisasi; Konsep 2 mengklaim langsung lewat tipografi. Endcard, CTA, dan
halaman tujuan **identik dengan Konsep 1** supaya hasil A/B bisa dibaca.

| Waktu | Visual | Teks di layar |
|-------|--------|---------------|
| 0,0–2,0s | Ink polos, teks serif besar masuk | **"Kamu bukan pembaca."** |
| 2,0–4,0s | Kata kedua mengganti, aksen rose | **"Kamu tokoh utamanya."** |
| 4,0–9,0s | Tiga kartu premis bergantian (dari `app/page.tsx:31,36,41`) | "Pernikahan yang Seharusnya Sempurna" → "Orang yang Pulang Setelah Tujuh Tahun" → "Rumah yang Menyimpan Nama Keluargamu" |
| 9,0–12,0s | Kartu mengecil, muncul dua tombol pilihan buram di belakang teks | **"Setiap pilihanmu mengubah arah cerita."** |
| 12,0–15,0s | Endcard identik Konsep 1 | Logo + **"Mulai Ceritaku"** + "3 bab pertama gratis · tanpa kartu" |

### Konsep 3 — "Kredit Gratis Tiap Hari" (aktivasi)

**9:16 · 20 detik (atau 14 detik versi potong) · `/general-video` · pengguna terdaftar → `/misi`**

Menutup keberatan terbesar pembaca aktif: bab lanjutan berbayar. Video ini
menunjukkan dua jalur kredit gratis yang benar-benar hidup di produksi.

| Waktu | Visual | Teks di layar |
|-------|--------|---------------|
| 0,0–3,0s | Ink, ikon kunci bab | "Bab berikutnya 1 kredit per bab." → **"Kreditnya nggak harus dibeli."** |
| 3,0–8,0s | Dua kartu misi HTML tergeser masuk, tanda centang menyala | **"Hadir Hari Ini +1 kredit"** · **"Tentukan Langkahmu +1 kredit"** · "Reset tiap 00:00 WIB" |
| 8,0–14,0s | Kartu Dompet Imbalan, angka rupiah naik | **"Ajak teman membaca · Dapatkan komisi 10%"** · "Rp250 = 1 kredit baca" |
| 14,0–17,0s | Tumpukan kredit | **"Kreditmu tak kedaluwarsa."** |
| 17,0–20,0s | Endcard | **"Buka Misi Harian"** + `lakoku.biz.id/misi` |

**Gerbang pra-render:** kalau `commissionEnabled` mati di produksi, buang blok
8,0–14,0s dan render versi 14 detik. Jangan menayangkan komisi yang tidak jalan.

### Konsep 4 — "Jadi Tokoh Utama" (brand)

**16:9 · 35 detik · `/product-launch-video` · video landing, YouTube, pitch**

Satu-satunya format panjang dan horizontal. Menjelaskan produk secara utuh:
apa itu, rasanya bagaimana, dan kenapa berbeda dari novel biasa.

| Babak | Waktu | Visual | Teks di layar |
|-------|-------|--------|---------------|
| Malam | 0–6s | `hero-rainy-reflection.webp`, Ken Burns lambat | **"Kalau ini ceritamu, apa yang akan kamu lakukan?"** |
| Pilihan | 6–13s | `choice-rainy-drive.webp` **dipotong supaya teks Inggris di layar HP keluar frame**, dua tombol HTML naik | **"Kamu bukan sekadar membaca kisah seseorang."** |
| Konsekuensi | 13–20s | `memory-rainlit-letters.webp`, kilatan bab bercabang | **"Di sini, kamulah tokoh utamanya."** |
| Dunia | 20–27s | Kisi enam sampul bergerak pelan | "Drama keluarga · Romansa · Misteri · Thriller" |
| Janji | 27–32s | Ink polos | **"50 bab. Beberapa akhir yang berbeda. Tergantung pilihanmu."** |
| Endcard | 32–35s | Logo penuh | **"Temukan Ceritaku"** + `lakoku.biz.id` |

### Konsep 5 — "Bab yang Menunggu" (retensi / reaktivasi)

**9:16 · 12 detik · `/general-video` · pembaca berhenti di tengah → lanjut baca**

Video terpendek dan paling murah dirender. Untuk retargeting, notifikasi, atau
email winback. Menggantikan slot video Play Store di batch ini.

| Waktu | Visual | Teks di layar |
|-------|--------|---------------|
| 0,0–3,0s | Sampul "Selasa Terakhir di Rumah Kaca" meredup, bilah progres berhenti di tengah | **"Ceritamu berhenti di tengah."** |
| 3,0–7,0s | Bilah progres berdenyut di Bab 12 dari 50 | **"Masih ada 38 bab yang belum kamu jalani."** |
| 7,0–10,0s | Dua tombol pilihan muncul redup, satu belum dipilih | **"Satu keputusan menunggu giliranmu."** |
| 10,0–12,0s | Endcard | **"Lanjutkan Ceritaku"** |

Angka "Bab 12 dari 50" adalah contoh generik untuk render tunggal, bukan data
pembaca sungguhan. Jangan personalisasi angka tanpa pipeline data terpisah.

---

## 6. Rencana eksekusi

### 6.1 Pilot dulu

**Konsep 1 dirender lebih dulu sebagai pilot**, sebelum empat sisanya dibangun.
Konsep 1 dipilih karena memakai hampir semua primitif yang dibutuhkan konsep
lain: foto dengan dorongan kamera, potongan 9:16 dari sumber 16:9, UI HTML
bertumpuk di atas foto, teks kinetik, urutan sampul, dan endcard. Kalau pipeline
HyperFrames lolos di Konsep 1, sisanya tinggal variasi.

Pilot dinyatakan lolos kalau: render selesai tanpa galat, `hyperframes check`
bersih, teks utuh terbaca pada pemutaran bisu di layar ponsel, dan potongan
9:16 tidak memotong subjek.

### 6.2 Urutan setelah pilot

1. Konsep 2 (berbagi endcard dan sebagian besar komponen dengan Konsep 1)
2. Konsep 5 (paling pendek, menguji komponen bilah progres)
3. Konsep 3 (butuh gerbang `commissionEnabled` diperiksa dulu)
4. Konsep 4 (format berbeda, route berbeda, paling mahal)

### 6.3 Perkakas

- CLI: `hyperframes` 0.8.48 tersedia lewat `npx`.
- Satu proyek HyperFrames per konsep, di luar pohon build Next.js.
- Aset repo direferensikan dengan menyalin ke folder proyek video, bukan
  ditautkan lintas direktori, supaya render tetap reprodusibel.

---

## 7. Ditunda: video rilis Play Store

Disimpan lengkap supaya tinggal dieksekusi begitu listing terbit.

**9:16 · ~20 detik · `/general-video`**

**Prasyarat wajib:** `GATES.android.md` G9 dan G10 lolos — AAB terunggah, 20
tester tertutup selama 14 hari selesai, dan review Google Play lulus sehingga
`biz.lakoku.app` benar-benar bisa dicari di Play Store. Sebelum itu, video ini
**tidak boleh dirender maupun ditayangkan**.

Naskah kasar: mockup telepon memutar alur baca → badge "Tersedia di Google Play"
→ deskripsi singkat resmi "Novel interaktif berbahasa Indonesia — kamulah tokoh
utamanya." → endcard unduh.

---

## 8. Risiko

| Risiko | Dampak | Penanganan |
|--------|--------|------------|
| Teks Inggris terbaca di `choice-rainy-drive.webp` | Iklan Indonesia terlihat tidak digarap | Potong keluar frame di Konsep 4; jangan pakai foto ini di konsep 9:16 |
| Semua foto sumber 16:9 | Potongan 9:16 bisa memotong subjek | Pusatkan potongan ke tangan + HP, verifikasi visual per konsep sebelum render final |
| `commissionEnabled` mati di produksi | Konsep 3 mengiklankan fitur mati | Gerbang pra-render §5 Konsep 3; versi potong 14 detik sudah disiapkan |
| Play Store belum live | Klaim palsu, iklan ditolak | Video dibekukan, §7 |
| Beranda v2 masih konsep | Screenshot beranda cepat basi | Semua UI dibangun ulang sebagai HTML; jangan pakai screenshot beranda |
| Repo tidak punya berkas video | Gerak harus datang dari foto diam | Sudah diperhitungkan: dorongan kamera + Ken Burns + gerak UI HTML |

---

## 9. Yang ditunggu dari PM

1. Persetujuan set lima konsep ini.
2. Konfirmasi Konsep 1 sebagai pilot.
3. Nilai produksi `commissionEnabled` untuk menentukan durasi Konsep 3.

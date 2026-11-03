# Brief Konsep: Perbaikan UX Referral, Koleksiku, Detail Cerita, dan Akhir Cerita

Penulis: ZCode + tinjauan Goldfish 6 lensa (design, codebase, zoom-out, comprehension, implementation-readiness, structural)
Tanggal: 2026-11-03
Status: menunggu keputusan pemilik produk

## Ikhtisar (Overview)

Empat keluhan pembaca yang semuanya berujung pada satu hal: **konten penjelas ditempatkan sebelum aksi**, sehingga tombol yang dibutuhkan tenggelam di bawah scroll panjang.

1. Halaman Imbalan hanya terasa punya "salin tautan", padahal tombol `Bagikan` sudah ada — kecil, di kanan atas, dan diam-diam berubah jadi salin di browser tanpa Web Share API. Pemilik ingin tombol bagikan yang jelas, kalimat ajakan baru, dan gambar yang ikut terkirim ke WhatsApp.
2. Koleksiku menampilkan kartu berisi sampul, badge status, dua trope, tagline dua baris, bar progres, dan teks "X% - Bab N/M". Dengan lebih dari 10 cerita, daftar jadi sangat panjang dan tidak punya cari, urut, atau saring.
3. Di halaman detail cerita yang sudah tamat, tombol `Lihat Akhir Cerita` dan `Baca Ulang dari Bab 1` berada **setelah** seluruh `Jejak Pilihan` — 49 blok teks untuk cerita 50 bab.
4. Halaman Akhir Cerita mengulang masalah yang sama: aksi utama berada paling bawah, setelah jejak penuh dan dua blok penjelasan.

Kesimpulan tinjauan: akar masalah 3 dan 4 identik dan harus dikerjakan sebagai satu paket, bukan dua perbaikan terpisah. Item 2 tidak butuh data baru selain satu hal yang saat ini dibuang di lapisan data: waktu baca terakhir. Item 1 adalah satu-satunya item yang janjinya bergantung pada platform — gambar tidak bisa dijamin terkirim di semua browser, jadi janji produk harus diubah menjadi "gambar bila didukung, tautan selalu".

Kamus singkat: **DTO** = bentuk data ringkas yang dikirim ke komponen tampilan; **sheet** = panel yang muncul dari bawah layar; **capability check** = pemeriksaan apakah browser mendukung fitur sebelum memakainya; **attribution** = proses penerima tautan referral benar-benar tercatat sebagai bawaan pengundang.

## Analisis (Analysis)

### Kondisi Saat Ini yang Terverifikasi

- Tombol bagikan referral SUDAH ada di `components/rewards/copy-referral-link.tsx:47-53`, memanggil `navigator.share` dengan teks generik, dan jatuh ke salin tautan bila API tidak ada (`:38-40`). Semua kegagalan ditelan `catch { /* no-op */ }` (`:22-24`, `:35-37`).
- Pola kartu gambar sudah terbukti di repo: `app/api/ending-card/[slug]/route.tsx` memakai `next/og` pada 1080x1920, dan `components/ending-card-actions.tsx` sudah men-download PNG-nya. Jadi kartu referral bukan teknologi baru.
- Logika bagikan sudah terduplikasi di empat tempat: `copy-referral-link.tsx`, `components/share-button.tsx`, `components/ending-card-actions.tsx`, `components/share-story-button.tsx`. Menambah kartu gambar akan menjadikannya lima.
- `StorySummary` (`packages/contracts/src/reader.ts:95-107`) tidak punya stempel waktu. `ReaderState` (`lib/api/user-state.ts:29-37`) juga tidak, padahal `updated_at` sudah dipilih di query (`:21`) lalu dibuang saat konversi. Urutan Koleksiku saat ini berasal dari urutan `Map` hasil pemindaian `reader_states` yang tidak dijamin (`lib/api/server.ts:76-92`), sementara `queryStoriesByIdsForUser` mengurutkan `id asc` (`lib/api/queries.ts:150`). Artinya urutan bawaan hari ini tidak deterministik, dan permintaan "terakhir dibaca di atas" tidak bisa dipenuhi tanpa memperbaiki lapisan data.
- `overlay()` menempelkan seluruh `jejak` ke setiap ringkasan cerita (`lib/api/server.ts:41-50`). Untuk perpustakaan berisi 10 cerita tamat, itu berarti ~490 entri terkirim ke halaman yang tidak membutuhkannya.
- `Jejak Pilihan` dirender penuh di dua tempat: `app/(shell)/cerita/[id]/page.tsx:116-132` dan `app/akhir/[id]/page.tsx:121-135`. Di kedua file, tombol aksi berada setelahnya (`cerita`:134-148, `akhir`:169-209).
- Tidak ada primitif dialog/accordion di `components/ui/`. Pola sheet yang sudah dipakai adalah `components/chapter-list-dialog.tsx:102-131` (`fixed inset-0 z-50`, `items-end sm:items-center`, tinggi terbatas, handler Escape).
- Halaman Akhir Cerita memakai daftar lima nama akhir yang ditulis tetap (`app/akhir/[id]/page.tsx:14-20`) dan kalimat "3 akhir cerita lain" yang juga tetap (`:140-142`). Ini bukan bug baru, tapi ikut terlihat saat blok itu dipindah.
- `StoryCard` dipakai juga di Jelajah dan Beranda, di mana tagline dan trope berguna untuk penemuan cerita. Mengubah komponen itu akan merusak dua halaman lain.

### Keberatan yang Menghalangi (harus diputuskan sebelum menulis kode)

**B1. Gambar yang terkirim tanpa tautan mematikan atribusi referral.** Saat `navigator.share` membawa berkas, sebagian aplikasi penerima membuang field `url` dan sebagian membuang caption. Gambar di WhatsApp tidak bisa diklik. Kalau tautan hanya ada di `url`, "berhasil bagikan" bisa menghasilkan nol kunjungan `/r/{code}`. Perbaikan: URL absolut dicetak **di dalam gambar**, diduplikasi di teks pesan, dan field `url` diperlakukan sebagai bonus.

**B2. Mengambil gambar setelah tombol ditekan membunuh izin share.** Chrome memberi jendela aktivasi pengguna sekitar lima detik; Safari lebih ketat. Rute `next/og` yang dingin di VPS bisa melewati itu, dan kegagalannya ditelan `catch` yang sudah ada sehingga tampak seperti pengguna membatalkan. Perbaikan: gambar diambil dan dijadikan `File` saat komponen dimuat, disimpan di `useRef`, lalu dibagikan langsung di dalam handler klik. Kalau belum siap, jangan fetch setelah tap.

**B3. Matriks platform tidak seragam.** Desktop Chrome di Windows tidak mendukung berbagi berkas. Aplikasi Android (Capacitor memuat `https://lakoku.biz.id`, `capacitor.config.ts:25-26`) tidak punya `@capacitor/share` (`package.json:90-106`), dan WebView Android tidak selalu menyediakan `navigator.share`. iOS bisa mengirim gambar tanpa caption. Perbaikan: tiga tingkat fallback eksplisit — berkas didukung, share teks saja, lalu salin tautan + `wa.me`. Bedakan `AbortError` (pengguna membatalkan) dari kegagalan nyata.

**B4. Data untuk "terakhir dibaca" belum ada di kontrak.** Lihat temuan di atas. Perbaikan: bawa `updated_at` menjadi `updatedAt` di `ReaderState`, urutkan di server menurun, tambahkan `lastReadAt` opsional di `StorySummary`, dan sediakan pembanding dengan tie-breaker yang tetap (status, lalu judul). "Terbaru" harus didefinisikan atau dibuang — tidak ada stempel "kapan ditambahkan ke perpustakaan".

**B5. Daftar Koleksiku tidak boleh menjadi komponen klien yang mengambil data sendiri.** Halaman ini sudah `force-dynamic`, ter-gate autentikasi, dan mengambil peta visibilitas di server (`app/(shell)/koleksiku/page.tsx:16-22`). Perbaikan: halaman tetap Server Component; kirim DTO sempit (`id, title, cover, status, currentChapter, totalChapters, lastReadAt, isOwned, visibility`) ke toolbar dan daftar klien; `jejak` tidak pernah ikut. `StoryVisibilityToggle` tetap anak klien di bawah kartu yang dimiliki.

**B6. "Lihat semua" sebaris akan mengulang masalah yang mau dihapus.** Dengan 49 entri, expand sebaris menghasilkan blok 49 baris lagi. Perbaikan: satu `JejakPreview` (3 entri terakhir + jumlah total) dan satu `JejakSheet` (panel bawah, tinggi 85svh, Escape), dipakai ulang di dua halaman.

**B7. Isi halaman Akhir Cerita sebagian ditulis tetap.** Lima nama akhir dan angka "3 akhir cerita lain" tidak diturunkan dari data cerita. Memindahkan blok tidak memperbaikinya. Perbaikan: konfirmasi ke produk apakah kelima arketipe itu memang berlaku untuk semua cerita; kalau ya, jadikan konstanta yang diberi komentar eksplisit; kalau tidak, turunkan dari data.

**B8. Berbagi native tidak bisa diverifikasi otomatis.** Reticle dan unit test tidak bisa menekan tombol WhatsApp. `next.config.mjs:6-8` juga mematikan pemeriksaan tipe saat build, jadi regresi tipe tidak akan menggagalkan `pnpm build`. Perbaikan: matriks uji perangkat manual dicatat di checklist rilis, ditambah smoke untuk rute gambar (status, `content-type: image/png`, ukuran byte, kode tidak valid), unit test untuk pembentuk payload, lalu `pnpm typecheck`, `pnpm smoke:contracts`, `pnpm test:unit`.

### Catatan Lensa

- **Design:** tombol bagikan di dompet imbalan tidak boleh mengalahkan aksi pencairan/pengisian. Tiga kontrol bertumpuk (cari, urut, chip) terlalu berat di lebar 448px — tampilkan toolbar hanya saat isi perpustakaan melebihi ambang. Di halaman Akhir Cerita harus ada **satu** aksi utama; memindahkan lima tombol ke atas hanya memindahkan dinding tombol.
- **Codebase:** logika bagikan perlu diekstrak menjadi satu pembentuk payload murni yang bisa diuji tanpa browser. Telemetri saat ini mencatat niat, bukan hasil (`ending-card-actions.tsx:55` mencatat `share_channel` sebelum hasil diketahui).
- **Zoom-out:** urutan pengerjaan sebaiknya item 2 dulu (retensi, risiko rendah), lalu 3+4 (satu paket), lalu 1 (akuisisi, butuh uji perangkat). Empat perubahan sekaligus di funnel yang sama membuat atribusi regresi mustahil. Ada kebocoran atribusi lama yang perlu diukur: `/r/[code]` menulis cookie di browser yang membuka tautan (`app/r/[code]/route.ts:34-50`), sehingga perpindahan dari browser dalam WhatsApp ke browser luar kehilangan cookie. Itu bukan akibat fitur ini, tapi membatasi KPI.
- **Comprehension:** taksonomi status harus dibereskan sebelum chip dibuat. Saat ini judul seksi bilang "CERITA BERJALAN" tapi kodenya `status !== 'SELESAI'` sehingga `BARU` ikut masuk. Label chip harus sama dengan label yang dilihat pembaca. Pesan gagal harus membedakan batal, gambar belum siap, dan gagal nyata. Kartu undangan tidak boleh memuat nama akhir atau progres si pengundang.
- **Implementation-readiness:** jangan pindahkan banner iklan sebagai efek samping pemindahan aksi. Rute gambar harus divalidasi kodenya (`isValidReferralCode`) dan diberi `Cache-Control` karena render `next/og` memakai CPU VPS.
- **Structural:** jangan ubah `components/story-card.tsx`; buat varian compact terpisah. Komponen baru: `JejakPreview`, `JejakSheet`, `LibraryToolbar`, `LibraryStoryCard`, `InviteShareButton`. Pengelompokan status dan pembanding urutan dijadikan modul murni yang diuji.

## Tujuan vs Bukan Tujuan

**Termasuk:**
- Tombol bagikan referral yang terlihat, dengan kalimat ajakan baru dan kartu gambar 1080x1350 yang mencetak URL dan QR.
- Kartu Koleksiku compact: sampul, judul, bar progres, "Bab N/M" (atau "Selesai" untuk cerita tamat).
- Urutan bawaan Koleksiku: terakhir dibaca di atas, deterministik.
- Cari judul, urut, dan chip status di Koleksiku; toolbar hanya muncul saat isi perpustakaan cukup banyak.
- Aksi utama di halaman detail cerita dan halaman Akhir Cerita terlihat tanpa scroll pada cerita 49 bab.
- `Jejak Pilihan` menjadi ringkasan 3 entri terakhir + jumlah total, dengan panel untuk melihat semuanya.
- Satu pembentuk payload bagikan yang dipakai bersama, dengan telemetri hasil (berhasil / gagal / fallback).

**Tidak termasuk:**
- Perubahan skema basis data.
- Paginasi perpustakaan.
- Perbaikan kebocoran cookie atribusi `/r/[code]` (dicatat sebagai utang terpisah).
- Menambah `@capacitor/share` untuk paritas aplikasi Android.
- Menurunkan ulang daftar akhir cerita dari data tanpa keputusan produk.
- Mengubah `StoryCard` global yang dipakai Jelajah dan Beranda.

## Alternatif yang Ditimbang

| Alternatif | Alasan ditolak |
|---|---|
| Gambar statis di `public/` untuk share referral | Tidak bisa memuat URL dan kode per pengguna; gambar tanpa tautan tidak bisa diklik. |
| Render gambar di klien (canvas) | Menambah bobot klien dan risiko font tidak siap; `next/og` sudah terbukti di repo. |
| Mengambil gambar setelah tombol ditekan | Kehilangan aktivasi pengguna, gagal senyap (B2). |
| Menjanjikan gambar di semua platform | Tidak benar di desktop Chrome dan WebView Android (B3). |
| Cari/saring lewat parameter URL dan render server | Satu perjalanan RSC per ketikan di halaman `force-dynamic` yang ter-gate; Jelajah pun memakai tombol submit, bukan pencarian langsung. |
| Membuat Koleksiku jadi komponen klien yang mengambil data | Melanggar seam `lib/api/` dan memaksa `jejak` ikut terkirim. |
| Expand sebaris untuk jejak penuh | Mengulang scroll 49 baris yang mau dihapus (B6). |
| Memakai ulang `StoryCard` dengan varian prop | Komponen yang sama dipakai Jelajah dan Beranda; risiko regresi di dua halaman. |
| Menambah sort "Terbaru" | Tidak ada stempel waktu "kapan masuk perpustakaan" (B4). |
| Mengerjakan keempat item sekaligus | Atribusi regresi tidak mungkin dipisahkan (Z5). |

## Keputusan Kunci & Tahapan

**Keputusan dari pemilik produk:**
- Kartu Koleksiku cukup sampul, judul, progres, dan "Bab N/M" — tanpa badge, tagline, atau trope.
- Urutan bawaan yang dicari pembaca: "lanjut baca yang terakhir".
- Gambar referral harus ikut terkirim bersama pesan WhatsApp.

**Keputusan teknis yang diusulkan:**
- Janji fitur diubah menjadi "gambar bila platform mendukung, tautan selalu terkirim".
- URL absolut dan QR dicetak di dalam kartu; teks pesan juga memuat URL.
- Kartu diambil saat komponen dimuat dan disimpan sebagai `File` di `useRef`.
- Koleksiku tetap Server Component dengan DTO sempit; interaksi di klien.
- Satu modul pembentuk payload bagikan + telemetri hasil.
- `JejakPreview` dan `JejakSheet` dipakai bersama oleh halaman detail dan halaman akhir.

**Gelombang pengerjaan:**

1. **Gelombang 1 — Koleksiku.** Perbaiki `updatedAt` di lapisan data, urutkan di server, buat kartu compact, toolbar cari/urut/chip, kosongkan-state per kondisi. Selesai bila urutan deterministik, toolbar benar untuk 0/1/banyak cerita, toggle visibilitas masih berfungsi, dan kontrak serta test hijau.
2. **Gelombang 2 — Detail cerita + Akhir Cerita.** Pindahkan aksi utama ke atas untuk semua status (bukan hanya `SELESAI`), buat `JejakPreview` + `JejakSheet`, tentukan satu aksi utama per halaman, iklan tetap setelah konten penjelas. Selesai bila aksi utama terlihat tanpa scroll pada cerita 49 bab dan sheet bisa dibuka/tutup termasuk lewat keyboard.
3. **Gelombang 3 — Bagikan referral.** Ekstrak pembentuk payload, tambah rute kartu dengan validasi kode dan cache, pasang tombol utama, tiga tingkat fallback, telemetri hasil. Selesai bila matriks perangkat tercatat, gambar memuat URL/QR, fallback selalu mengirim tautan, dan hasil share tercatat sebagai hasil.

Sebelum tiap gelombang: `pnpm typecheck`, `pnpm smoke:contracts`, `pnpm test:unit`, plus smoke yang terdampak.

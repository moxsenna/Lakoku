# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pembaca fiksi interaktif berbahasa Indonesia, mengakses dari ponsel (mobile-only), sesi pendek yang sering terjadi malam hari. Dua keadaan: tamu yang mencoba demo resmi, dan pembaca terdaftar yang menjalankan instans ceritanya sendiri (melanjutkan bab, membagikan akhir cerita).

## Product Purpose

Lakoku adalah novel interaktif di mana pembaca adalah tokoh utama: cerita 50 bab bercabang yang dibentuk pilihan pembaca dan digenerasi khusus untuk instansnya. Sukses berarti pembaca kembali untuk melanjutkan ceritanya, memulai cerita baru, dan membagikan instansnya (loop viral).

## Positioning

"Jalani bukan baca" — setiap pembaca memulai instans ceritanya sendiri, bukan membaca teks yang sama dengan orang lain. Share = clone instans (T-SHARE-4). Kompetitor (Wattpad, Fizzo, Novelah, NovelMe, KaryaKarsa; AI-native: Roletopia, StoryZone) semua menjual "baca"; belum ada aplikasi novel AI-interaktif berbahasa Indonesia yang matang.

## Operating Context

Shell mobile lebar maksimum md dengan bottom nav tetap (Beranda, Jelajah, Mulai Cerita, Koleksiku, Profil). Semua copy reader-safe dalam Bahasa Indonesia tanpa jargon teknis. Produksi di VPS; dev server lokal terhubung ke Supabase produksi — verifikasi tidak boleh menulis data nyata.

## Capabilities and Constraints

- Struktur 50 bab bersifat tetap — tidak boleh diubah tanpa approval produk.
- Brand guard: string "AI", "Narraza", "RAG", "token" tidak boleh sampai ke pembaca.
- Akses data hanya melalui seam `lib/api/` (client → fetch → API; RSC via `lib/api/server`).
- Pilihan pembaca harus idempoten (tidak ada double-advance saat retry).
- Data yang tersedia hari ini: reader-state/library (status BARU/BERJALAN/SELESAI + progres bab), katalog resmi (listExploreStories), share publik dengan ending card (listPublicShareTeasers), karya publik penulis lain (listPublicUserStories), nama user (Better Auth), dompet Lakoin/Tinta/Imbalan, misi.
- Yang BELUM tersedia (jangan direkayasa seolah ada): agregasi ranking mingguan, counter "N orang memulai", rating, kolom genre resmi/UGC pada tabel stories, halaman detail katalog pra-mulai.

## Brand Commitments

- Nama "lakoku" ditampilkan lowercase di header beranda.
- Palet Paper Cream (terang) / Midnight Drama (gelap): cream #fff7ee, ink #191319, rose #c94967 (primary), gold #a87933, plum #3d1f3d, mauve #7a5a7a.
- Tipografi: DM Serif (display, `font-serif`) + Plus Jakarta Sans (body, `font-sans`).
- Sudut membulat besar (radius basis 1rem; kartu rounded-2xl/3xl).
- Aturan CTA: semua ajakan memakai "Mulai"/"Jalani" — TIDAK ada CTA "Baca" di beranda.
- Sapaan kultural Indonesia (aturan sapaan honorifik kultural sudah terkanon di ingestion bab).

## Evidence on Hand

- Implementasi beranda saat ini: `app/(shell)/beranda/page.tsx` (header, kartu Lanjutkan, ad, "Jelajahi Cerita", "Dari Pembaca Lain", CTA penutup).
- Halaman Jelajah dengan pencarian + filter trope: `app/(shell)/jelajah/page.tsx`.
- Komponen StoryCard (sampul 2:3 + badge status + progres bab), BottomNav, AppShell.
- Tidak ada testimoni, metrik publik, atau penghargaan — jangan direkayasa.

## Product Principles

1. Jalani, bukan baca — setiap ajakan menggerakkan pembaca mengambil peran.
2. Mobile-first, sesi pendek — beranda harus mengantar ke tindakan dalam satu layar pertama.
3. Beranda milik pembaca — personal untuk instans dan progresnya, bukan katalog umum.
4. Reader-safe selalu — copy hangat berbahasa Indonesia, tanpa jargon.
5. Kurasi di atas kepadatan — hierarki yang jelas mengalahkan jumlah konten.

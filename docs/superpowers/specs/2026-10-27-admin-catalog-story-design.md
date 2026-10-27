# Cerita Katalog Admin — Desain

**Tanggal:** 2026-10-27
**Status:** Disetujui PM 2026-10-27
**Prasyarat:** fix paywall cerita bersama di `main` `ce307a9` (ref unlock per-pembaca, gerbang API bab & pilihan). Harus ter-deploy sebelum katalog tayang.

## 1. Ringkasan

Admin membuat satu novel 50 bab sekali jalan. Mesin menulis semuanya otomatis, admin memeriksa (QC) lalu menerbitkan secara manual. Novel tampil di Beranda semua pengguna. Pembaca membuka bab seharga **5 Lakoin** (lebih murah dari 8 Lakoin cerita biasa) atau membeli **paket satu novel** sekali bayar.

Fitur generate-dari-nol milik pengguna tidak berubah. Katalog adalah jenis cerita tambahan.

## 2. Keputusan PM

| Topik | Keputusan |
|---|---|
| Model pilihan pembaca | **A** — spine Bab 1–44 sama untuk semua pembaca; pilihan menggeser `route_state` per pembaca; ending dikunci per pembaca di Bab 45; Bab 45–50 ditulis dalam 2–3 varian ending |
| Harga per bab | 5 Lakoin |
| Paket novel | Ada, sekali bayar membuka semua bab berbayar |
| Alur admin | Generate otomatis → QC → publish manual |
| Harga paket default | 150 Lakoin |
| Varian ending | 3 (2 utama + 1 rahasia) |
| Rasa pengaruh pilihan | Reaksi pilihan 1–2 paragraf + penanda arah halus (lihat §4.1) |

## 3. Model data

### 3.1 Mode cerita baru
- `stories.story_mode` mendapat nilai baru `catalog` (migrasi mengubah check constraint).
- ID cerita: `catalog:{slug}`.
- `owner_user_id = null` (menutup celah farming Tinta penulis; RPC reward penulis butuh owner NOT NULL).
- `isCommercialStoryMode('catalog') === false`, jadi katalog memakai jalur unlock standar dan ref per-pembaca `unlock:{storyId}:{bab}:{userId}` dari fix `ce307a9`.

### 3.2 Tabel `catalog_stories`
Satu baris per novel katalog.

| Kolom | Arti |
|---|---|
| `story_id` (PK, FK stories) | |
| `status` | `draft` → `generating` → `review` → `published` → `archived` |
| `chapter_price` | default 5 |
| `bundle_price` | harga paket, diset admin |
| `contract_json` | snapshot kontrak cerita (premis, tokoh, kandidat ending) |
| `generation_progress` | bab terakhir yang selesai, untuk resume |
| `published_at`, `published_by` | jejak audit |

Harga disimpan per novel agar admin bisa promo per judul tanpa mengubah harga global.

### 3.3 Bab
- Bab 1–44: tabel `chapters` dan `choice_outcomes` yang sudah ada (tidak ada dimensi pembaca, cocok untuk spine bersama).
- Bab 45–50: tabel baru `catalog_ending_chapters`, PK `(story_id, ending_key, number)`, kolom sama dengan `chapters` ditambah `outcomes_json` (reaksi pilihan Bab 45–49; pilihan di sini kosmetik karena ending sudah terkunci, `next = n + 1`).

### 3.4 Status per pembaca
Tidak ada tabel baru. `reader_states` sudah punya `route_state`, `choice_history`, dan `locked_ending_key`.

## 4. Alur pembaca

1. Katalog muncul di rail "Jelajahi Cerita" Beranda: `queryExploreStories` ditambah `id LIKE 'catalog:%'`; `queryPublicUserStories` mengecualikannya.
2. Bab 1–3 gratis (`reading_policy.free_chapters`).
3. Bab 4+ dibuka 5 Lakoin per bab, atau paket.
4. Memilih di Bab 1–44: jalur pilihan standar mencatat reaksi dan menggabungkan `effect_json` ke `route_state` pembaca. Tidak ada generasi bab saat membaca.
5. Pilihan di Bab 44: server menjalankan `resolveEnding(route_state, kontrak, 45)` dan menyimpan `locked_ending_key` pembaca. Dijalankan sekali; dikunci, tidak berubah lagi.
6. Bab 45–50: pembacaan bab katalog dengan `n >= 45` mengambil varian dari `catalog_ending_chapters` sesuai `locked_ending_key` pembaca. Titik kait: `getChapter` (`lib/api/server.ts`), `queryChapter` (`lib/api/queries.ts`), route status bab, dan `queryChoiceOutcome` di route pilihan.
7. Statistik pilihan (≥3 pembaca) dan kartu ending yang sudah ada langsung bermakna karena banyak pembaca berbagi `story_id` yang sama.

### 4.1 Rasa pengaruh pilihan
Badan Bab 1–44 sama untuk semua pembaca, jadi pengaruh pilihan harus terasa lewat dua hal murah yang tidak menambah versi bab:

1. **Reaksi kuat.** `choice_outcomes.consequence` untuk katalog berisi 1–2 paragraf adegan reaksi yang spesifik untuk pilihan itu (bukan satu kalimat). Generator memberi target 60–150 kata per reaksi; validator menolak reaksi < 40 kata. Reader sudah menampilkan `consequence`; komponen perlu menampilkan semua paragraf (sekarang hanya `consequence[0]` di `components/reader-view.tsx:358`).
2. **Penanda arah.** Field baru opsional `directionHint` di `ChoiceOutcome` (`packages/contracts/src/reader.ts`), satu kalimat halus berbasis cerita, misalnya *"Raka mulai mempercayaimu."* Generator mengisinya hanya untuk pilihan yang menggeser `endingBias` cukup besar (bukan setiap pilihan), disimpan di kolom baru `choice_outcomes.direction_hint` (nullable). Reader menampilkannya di bawah reaksi dengan gaya miring kecil. Tidak boleh menyebut skor, ending, atau istilah teknis (brand guard).

## 5. Harga dan paket

### 5.1 Per bab
`resolveChapterAccess` jalur non-komersial: untuk `story_mode = 'catalog'`, biaya diambil dari `catalog_stories.chapter_price`, bukan `feature_credit_costs.chapter_unlock`. Bab gratis tetap mengikuti `reading_policy`.

### 5.2 Paket novel
- Endpoint baru `POST /api/stories/[id]/bundle` memanggil `spend_credits_v1` dengan ref `bundle:{storyId}:{userId}`.
- Resolver: bila ledger pembaca punya ref paket itu, semua bab berbayar novel tersebut terbuka (`reason: 'BUNDLE_UNLOCKED'`).
- **Harga adil untuk pembaca yang sudah beli eceran:** biaya paket = `max(0, bundle_price − total Lakoin yang sudah dibelanjakan pembaca untuk bab novel ini)`. Dihitung di server dari ledger ber-ref `unlock:{storyId}:%:{userId}`. Bila hasilnya 0, tidak ada debit; paket dicatat dengan entri ledger bernilai 0 (jika `spend_credits_v1` menolak nilai 0, pakai RPC kecil `grant_bundle_unlock_v1`).
- UI: layar bab terkunci menampilkan dua tombol — "Buka bab ini (5 Lakoin)" dan "Buka semua bab (X Lakoin, hemat Y)".

### 5.3 Hitungan
47 bab berbayar × 5 = 235 Lakoin eceran. Dengan kurs paket termurah (Rp15.000 = 30 Lakoin, Rp500/Lakoin): eceran ≈ Rp117.500. **Default paket: 150 Lakoin (≈Rp75.000, hemat 36%)**, disetujui PM.

## 6. Alur admin

### 6.1 Buat draf
Halaman baru `/admin/katalog` (dilindungi `requireAdminUser()`): admin mengisi judul, sinopsis, trope, nama tokoh utama, dan premis. Sistem membuat kontrak cerita dengan mesin authoring yang sudah ada (`story_authoring`), admin menyetujui kontrak, status `draft`.

Tokoh utama punya **nama tetap** (seperti novel biasa). Prosa sudah sudut pandang orang pertama ("aku"), jadi nama jarang muncul di narasi; personalisasi nama per pembaca tidak dipakai di katalog.

### 6.2 Generate otomatis
- Generasi satu novel memakan ~120 panggilan model dan 25–40 menit. Proses web Next.js dibatasi 300 detik dan `after()` mati saat deploy, jadi **tidak bisa dijalankan di proses web**.
- Solusi fase 1: script operator `pnpm catalog:generate --story=catalog:{slug}` yang dijalankan di VPS (atau lokal) dengan pola runner M10-G (`scripts/m10-g-9router-full-proof.ts`): menulis Bab 1–44, lalu fork di Bab 44 untuk tiap kandidat ending dan menulis Bab 45–50 per varian (pola `scripts/m10-g-9router-fork-proof.ts`). Bedanya: hasil ditulis ke DB sebagai draf (bukan in-memory), resume dari `generation_progress`, dan status jadi `review` saat selesai.
- Halaman admin menampilkan progres (bab ke-berapa) dan tombol salin perintah.
- Fase 2 (opsional, di luar spec ini): worker terpisah agar admin cukup klik tombol.

### 6.3 Penulisan bab dengan pilihan tertunda
Pipeline sekarang menulis Bab N+1 mengikuti pilihan Bab N (judge Lapis C wajib bila ada `previousChoice`). Untuk spine bersama, Bab N+1 tidak boleh mengasumsikan pilihan tertentu. Generator katalog berjalan dengan mode `choiceMode: 'deferred'`:
- Brief Bab N+1 tidak memuat `previousChoice`.
- Outcome tiap pilihan ditulis sebagai reaksi kuat (§4.1) plus `effect_json` (`endingBias`, flag rute) dan `directionHint` opsional — dampaknya muncul di reaksi dan ending, bukan di badan bab berikutnya.
- Kontrak katalog wajib punya tepat 3 `endingCandidates` (2 `main` + 1 `secret`); generator fork di Bab 44 untuk ketiganya.
- Validator Lapis A/B tetap berjalan; Lapis C memeriksa konsistensi tanpa pilihan.

Ini perubahan paling berisiko di spec ini; QC admin adalah jaring pengaman terakhir.

### 6.4 QC
`/admin/katalog/[slug]`: admin membaca semua bab (1–44 dan tiap varian 45–50), dengan tanda dari validator. Aksi per bab:
- **Setujui**.
- **Edit teks** kecil langsung (judul, paragraf, label pilihan).
- **Tandai tulis ulang** → `pnpm catalog:generate --story=... --regenerate=12` menulis ulang bab itu.

Tombol **Terbitkan** aktif hanya bila semua bab disetujui. Terbitkan = `status published`, `visibility public`. **Tarik** = `archived`, hilang dari Beranda; pembaca yang sudah membeli tetap bisa membaca.

## 7. Batas

- Tidak mengubah alur generate-dari-nol, cerita personal, premium, atau demo.
- Tidak mengubah struktur 50 bab.
- Tidak ada bagi hasil kreator (katalog milik platform, owner null).
- Imbalan referral tetap hanya dari top-up PayCore, tidak terpengaruh.
- Biaya generate tunduk pada batas E0 (`$200` per novel).

## 8. Pengujian

- Unit: resolver katalog (harga per novel, paket, bab gratis, varian), hitung harga paket setelah beli eceran, kunci ending sekali di Bab 44, pembacaan varian sesuai `locked_ending_key`, gerbang admin.
- Route: `/bundle` (saldo kurang, duplikat, harga 0), pilihan Bab 44 mengunci ending, bab 45+ tanpa kunci ending → tidak bocor varian.
- Reader: semua paragraf reaksi tampil; `directionHint` tampil bila ada dan lolos brand guard.
- Generator: mode `deferred` tanpa `previousChoice`; reaksi ≥ 40 kata; resume; fork 3 varian. Dijalankan dengan provider deterministik (tanpa biaya) di test.
- Uji nyata satu novel di VPS sebelum terbit pertama, dibaca admin end-to-end.

## 9. Pertanyaan terbuka

Tidak ada. Semua keputusan di §2.

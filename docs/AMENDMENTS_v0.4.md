# Lakoku — Amandemen Dokumen v0.4

Status: APPLIED — §A diterapkan ke `docs/PRD_Lakoku_Interactive_v0.3.md`, §B diterapkan ke `docs/ARCHITECTURE_v1.1.md`, §C diterapkan ke `docs/IMPLEMENTATION_PLAN.md` (5 Juli 2026).
Dokumen sumber: PRD v0.3, ARCHITECTURE v1.1, IMPLEMENTATION_PLAN v1.0, AMENDMENTS v0.3 (tetap berlaku).
Dokumen baru terkait: `docs/CLIENT_SEQUENCING.md` v1.0 (orientasi sequencing client — normatif, tidak menambah requirement). Tidak ada spesifikasi naratif baru; NCS v1.0 & NTM v1.0 tidak berubah.

Amandemen ini mencatat **keputusan sequencing client** dan **seam kontrak data client** yang disepakati produk. Ia **tidak** mengubah satu pun aturan naratif (NCS/NTM), model data canon, atau prinsip runtime backend. Brand Guidelines tidak berubah dan tetap berlaku penuh untuk client web maupun Kotlin.

---

## 0. Keputusan yang Dikunci (Locked Decision)

**LD-CLIENT-SEQ — Web-first ke produksi, Kotlin menyusul.**
Client pertama yang dibangun sampai produksi adalah **web reader mobile-first** (Next.js App Router). Client **Kotlin/Jetpack Compose (Android native)** tetap menjadi tujuan, tetapi **ditunda** sampai metrik retensi 50-bab dan konversi monetisasi per-cerita terbukti di web.

Alasan:
1. **Validasi taruhan produk lebih murah & cepat di web** (deploy instan, funnel/analitik mudah, tanpa siklus review store) — inti taruhan Lakoku adalah perilaku baca & bayar, bukan teknologi client.
2. **Distribusi awal lebih lancar** untuk drama Indonesia yang menyebar via tautan (WA/TikTok), tanpa terkunci billing store saat bereksperimen monetisasi.
3. **Arsitektur sudah API-first** (ARCH §7): web dan Kotlin adalah **dua client di atas kontrak API yang sama**, bukan dua produk terpisah.

**LD-CLIENT-SEQ tidak mengubah:** semua logika naratif (memori T0–T3, validator 2 lapis, alias registry, voice sheet, thread lifecycle, reveal gates, reconciliation) **tetap di backend**. Client hanya menampilkan hasil.

**LD-CONTRACT-SEAM — Seam kontrak data client.**
Setiap client wajib mengakses data hanya melalui satu lapisan client-data bertipe async yang stabil (di web: `lib/api/`). Komponen UI **tidak boleh** bergantung langsung pada sumber data (fixture lokal hari ini, `fetch()` ke backend nanti). Tipe pada seam ini adalah calon sumber untuk OpenAPI/JSON-Schema yang di-reuse client Kotlin.

**Guardrail yang tetap berlaku untuk client web (identik dengan Android):**
- Tidak memanggil provider AI dari client (ARCH §23).
- Tidak mengakses tabel naratif/canon langsung; hanya lewat Reader API.
- Tidak menerima kunci provider atau prompt internal.
- Brand guard: "Narraza" & framing "AI story generator" tidak boleh muncul di UI/copy/error pembaca (ARCH §16.3, Brand Guidelines).

---

## A. Amandemen PRD (v0.3)

### A1. § platform/roadmap — urutan client eksplisit
Tambah catatan: rilis pertama adalah **web reader mobile-first sampai produksi**; aplikasi Android native (Kotlin) menyusul sebagai client kedua di atas kontrak API yang sama. Non-goal "web reader hanya nanti" diperbarui: web reader kini **client produksi pertama**, bukan sekadar kemungkinan masa depan. Struktur cerita (tepat 50 bab, 500–800 kata/bab, reveal gates) tidak berubah.

## B. Amandemen ARCHITECTURE (v1.1)

### B1. Header — client & rilis
- `Primary release:` diperbarui menjadi: *Private Beta — Web reader mobile-first first, Android (Kotlin) second.*
- Tambah baris `Client sequencing:` yang menunjuk amandemen ini (LD-CLIENT-SEQ).

### B2. §1.1 Prinsip #2 "Android-native first"
Diperhalus menjadi **"Mobile-first, web client first"**: pengalaman baca dioptimalkan untuk layar sentuh vertikal; web reader adalah surface produksi pertama, Android native menyusul. Prinsip #1 (Reader-first, not AI-first) dan #10 (Brand separation) **tidak berubah** dan berlaku ke semua client.

### B3. §3 System Context + §3.1 Boundary
Tambah client web sebagai konsumen Reader API yang setara Android. Tambah baris boundary **"Web reader app"** dengan tanggung jawab & larangan identik dengan baris "Android app" (render UI, cache data terpublikasi, kumpulkan pilihan, panggil Reader API; dilarang memanggil AI, memutasi canon, menentukan entitlement, atau mengekspos rahasia).

### B4. §7 Reader API / BFF
Tambah catatan: kontrak API bersifat **client-agnostic**. Web reader mengonsumsi kontrak yang sama seperti Android; seam client-data (LD-CONTRACT-SEAM) adalah representasi kontrak ini di sisi client.

### B5. §2.1 "Explicitly not selected for v1"
Perjelas: penundaan React Native/Flutter tidak menghalangi **web reader (Next.js)** sebagai client produksi pertama; yang dihindari adalah cross-platform native wrapper, bukan web.

## C. Amandemen IMPLEMENTATION_PLAN (v1.0)

### C1. §1 Peta Milestone
Sisipkan milestone web sebelum M6 (Android):
- **M6-WEB — Web reader mobile-first (shell → reader → choice → koleksi/profil) sampai produksi.** Gate keluar: reader E2E di browser mobile, seam `lib/api` terpasang, brand guard lolos.
M6 (Android reader beta) **direposisi menjadi client kedua** setelah metrik web terbukti (LD-CLIENT-SEQ).

### C2. §0 Aturan agen
Tambah: guardrail ARCH §23 berlaku untuk client web sama seperti Android (tanpa panggilan AI dari client, tanpa akses tabel canon langsung, brand guard aktif).

---

## D. Status Implementasi Web (per 5 Juli 2026)

Langkah pertama LD-CONTRACT-SEAM sudah dikerjakan di prototype web:

| Item | Lokasi | Status |
|---|---|---|
| Kontrak tipe domain client | `lib/api/types.ts` | DONE |
| Client data async (seam) | `lib/api/client.ts` (`listStories`, `getStory`, `getChapter`, `submitChoice`) | DONE |
| Fixture lokal (internal, non-UI) | `lib/api/fixtures.ts` | DONE |
| UI beralih ke seam (beranda, cerita, baca, akhir, koleksiku, profil) | `app/**`, `components/**` | DONE |
| Reader menampilkan bab per-cerita (bukan sample statis) | `components/reader-view.tsx` | DONE |

**Belum dikerjakan (langkah berikut):** mengganti isi `lib/api/client.ts` dari fixture ke `fetch()` Reader API nyata; menurunkan OpenAPI/JSON-Schema dari `lib/api/types.ts`; paywall per-cerita sesuai model monetisasi PRD.

---

## E. Ringkasan Risiko yang Ditutup

- **Rewrite saat Kotlin datang:** dicegah dengan menjaga logika naratif di backend & mengunci kontrak API client-agnostic; Kotlin cukup membuat UI baru.
- **UI terkopel ke bentuk data lokal:** dicegah dengan seam `lib/api` — sumber data bisa diganti tanpa menyentuh komponen.
- **Kebocoran brand di web:** brand guard ARCH §16.3 diberlakukan eksplisit ke client web.
- **Web-first tergelincir jadi desktop-first:** dinetralkan dengan mandat mobile-first pada prinsip §1.1.

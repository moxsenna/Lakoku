# AGENT_RULES

Pintu masuk untuk setiap agen/kontributor yang membuka repo ini. Baca halaman ini
lebih dulu, lalu ikuti tautan ke dokumen normatif di `docs/`.

Dokumen ini adalah **ringkasan operasional** dari ARCHITECTURE §23 (Non-Negotiable
Engineering Rules) dan keputusan sequencing client. Bila terjadi konflik, sumber
kebenaran adalah dokumen di `docs/` (ARCH, PRD, NCS, NTM, AMENDMENTS terbaru).

---

## 1. Apa itu Lakoku (30 detik)

Novel interaktif mobile-first berbahasa Indonesia, tepat **50 bab**, di mana pembaca
adalah **tokoh utama**. AI adalah infrastruktur di balik layar, **bukan** positioning
produk. Nama produk konsumen: **Lakoku**.

## 2. Status repo saat ini

- Repo ini adalah **web reader (Next.js App Router)** — **client produksi pertama**.
- Berjalan di **jalur UX (fixtures)**: UI/UX dibangun di atas data fixture
  deterministik lewat seam `lib/api/`. Ini **bukan** pelanggaran gate — lihat
  IMPLEMENTATION_PLAN M6-WEB (dua-jalur) dan `docs/CLIENT_SEQUENCING.md`.
- Aplikasi **Android native (Kotlin)** menyusul sebagai **client kedua** di atas
  kontrak API yang sama, setelah metrik retensi/monetisasi web terbukti.

## 3. Aturan wajib untuk client (web sekarang, Android nanti)

Semua ini berlaku identik untuk client mana pun:

1. **Jangan panggil provider AI dari client.** Client tidak pernah menyentuh model,
   prompt, atau token. (ARCH §23 #1, #10)
2. **Jangan taruh logika naratif di client.** Memori T0–T3, validator, alias registry,
   thread lifecycle, reveal gates, branching — semuanya milik backend. Client hanya
   me-render hasil.
3. **Akses data hanya lewat seam `lib/api/`.** Komponen UI tidak boleh mengimpor
   sumber data langsung. Mengganti implementasi `client.ts` ke Reader API nyata tidak
   boleh menyentuh komponen. (LD-CONTRACT-SEAM, ARCH §7.1)
4. **Brand guard.** Jangan pernah menampilkan string yang membocorkan Narraza, prompt,
   model, RAG, token, atau detail generasi ke pembaca. Loading pakai bahasa naratif,
   bukan "AI sedang generate". (ARCH §23 #10)
5. **Idempotent choice.** Repeat tap / retry tidak boleh double-advance cerita.
   (ARCH §23 #5)
6. **Mobile-first.** Desain untuk layar sentuh vertikal; sesi baca pendek.
7. **Jangan ubah** struktur 50 bab, story spine, atau terminologi publik tanpa
   persetujuan produk. (ARCH §23 #9)

## 4. Gate yang harus dipahami

- Membangun UI/UX reader **di atas fixtures** → **tidak** dikunci gate M5. Boleh
  dikerjakan sekarang.
- **Menyajikan bab AI nyata ke pembaca** (web maupun Android) → **terkunci** di belakang
  **M5 hijau** (soak 50 bab, NCS §8; NTM §3). "Produksi ke pengguna" hanya boleh
  diumumkan setelah `client.ts` menunjuk Reader API nyata **dan** M5 lolos.

## 5. Peta dokumen

| Dokumen | Untuk apa |
|---|---|
| `docs/CLIENT_SEQUENCING.md` | Kenapa web-first, invariant reuse Kotlin, dua-jalur |
| `docs/IMPLEMENTATION_PLAN.md` | Runbook milestone M0–M9 (M6-WEB = web reader) |
| `docs/PROGRESS_CHECKLIST.md` | **Status task M0–M9 (centang di sini).** Cek dulu sebelum mulai kerja — biar task terlewat ketahuan |
| `docs/ARCHITECTURE_v1.1.md` | Baseline teknis; §23 = 17 aturan non-negosiabel |
| `docs/PRD_Lakoku_Interactive_v0.3.md` | Spesifikasi produk, brand contract |
| `docs/NARRATIVE_CONSISTENCY_SPEC.md` | Kontrak konsistensi naratif 50 bab (NCS) |
| `docs/NARRATIVE_TRACEABILITY_MATRIX.md` | Gap → skema → validator → gate (NTM) |
| `docs/AMENDMENTS_v0.4.md` | Amandemen terbaru (client sequencing) — baca lebih dulu |
| `docs/AMENDMENTS_v0.3.md` | Amandemen presisi sebelumnya |

## 6. Definisi selesai (untuk perubahan client)

- `pnpm typecheck` & lint hijau.
- Tidak ada kebocoran sumber data ke komponen UI (akses via `lib/api/`).
- Brand guard lolos (tidak ada string implementasi/AI/Narraza untuk pembaca).
- Alur yang tersentuh diverifikasi di browser viewport mobile.

# Lakoku — Amandemen Dokumen v0.7

Status: APPLIED — §A diterapkan ke `docs/PRD_Lakoku_Interactive_v0.3.md`, §B ke `docs/ARCHITECTURE_v1.1.md`, §D ke `docs/PROGRESS_CHECKLIST.md` (12 Juli 2026).
Dokumen sumber: PRD v0.3, ARCHITECTURE v1.1, PROGRESS_CHECKLIST v1.0, AMENDMENTS v0.3–v0.6 (tetap berlaku).
NCS/NTM **tidak berubah normatif**, tetapi implementasi baru ini memengaruhi sign-off dan coverage permukaan operasional. Brand Guidelines tidak berubah.

Amandemen ini mengunci **permukaan operasional admin**, **RBAC berbasis DB**, **editable settings dengan audit log**, **onboarding cepat berbasis premis AI**, **reader UX re-read/chapter-list**, dan **katalog demo resmi kedua `bilik-ketujuh-kbm-v2`**.

---

## 0. Keputusan yang Dikunci

### LD-ADMIN-RBAC — Permukaan `/admin/*` wajib berbasis role DB, bukan hardcode email

1. Seluruh `/admin/*` adalah permukaan INTERNAL/operasional.
2. Akses `/admin/*` hanya untuk user login yang tercatat di tabel `admin_users` dengan role `owner` atau `admin`.
3. DB adalah sumber kebenaran role. Email hardcode di kode dilarang.
4. `owner` boleh membaca dan menulis semua pengaturan operasional yang didukung.
5. `admin` boleh membaca seluruh permukaan admin dan melakukan aksi operasional yang diizinkan (mis. grant kredit), tetapi **tidak** boleh mengedit pengaturan global.
6. Route admin wajib fail-closed: user non-admin = `Forbidden`; user tanpa sesi = `Unauthenticated`.

### LD-OPS-CONFIG — Konfigurasi harga, kredit, dan route model pindah ke DB

1. `credit_products`, `feature_credit_costs`, `generation_policy`, dan `ai_model_routes` adalah sumber kebenaran operasional.
2. Kode aplikasi hanya boleh:
   - memvalidasi input,
   - membaca konfigurasi,
   - menyediakan fallback aman bila data belum lengkap,
   - menolak write yang tidak berwenang.
3. `generation_policy.target_words_min/max` default resmi = **800/1000** dan harus selaras dengan AMENDMENTS v0.6.
4. `ai_model_routes` mendukung `fallback_models text[]`; hanya satu route aktif per `use_case`.
5. `feature_credit_costs.chapter_unlock` adalah sumber biaya unlock bab; runtime tidak boleh lagi membaca biaya dari policy lama yang ambigu.

### LD-SETTINGS-AUDIT — Edit pengaturan global wajib tercatat

1. Setiap edit pengaturan global oleh owner wajib membuat entri audit log.
2. Audit minimal mencatat:
   - siapa admin-nya (`admin_user_id`, `admin_email`),
   - area + key pengaturan,
   - `old_value`, `new_value`,
   - alasan perubahan (`reason`),
   - waktu perubahan.
3. Alasan perubahan wajib diisi pengguna (`reason` required).
4. Admin non-owner melihat status read-only secara eksplisit di UI.

### LD-ADMIN-GRANT — Grant kredit manual admin wajib atomik dan terjejak

1. Grant kredit manual hanya boleh lewat jalur server/admin.
2. Grant wajib menulis audit trail terpisah (`admin_credit_grants`) dan ledger kredit dalam **satu transaksi atomik**.
3. User target dipilih via pencarian email yang aman (`admin_search_users_v1`), bukan input UUID mentah sebagai alur utama.
4. Jalur grant wajib idempoten via `ledger_ref` unik.

### LD-ADMIN-PANEL — Admin panel menjadi permukaan ops resmi pra-beta

1. Permukaan admin resmi sekarang mencakup:
   - `/admin` overview,
   - `/admin/users`, `/admin/users/[id]`,
   - `/admin/credits`,
   - `/admin/payments`,
   - `/admin/generation`,
   - `/admin/settings`,
   - `/admin/consistency`.
2. `/admin/consistency` tetap milik M8 observability; route lain adalah permukaan ops baru.
3. Halaman pembayaran admin pada fase ini bersifat read-only monitoring; tidak ada reconcile/refund UI.
4. Tidak boleh ada service-role client-side atau kredensial internal yang bocor ke komponen client.

### LD-ONBOARDING-PREMISE — `/mulai` menjadi jalur cepat pembentukan cerita

1. `/mulai` adalah jalur cepat pembaca untuk membentuk cerita personal tanpa membuka wizard authoring penuh.
2. Flow resmi:
   - `entry`
   - `quick` (4 pertanyaan) **atau** `customIdea`
   - 3 premis AI
   - pilih 1 premis
   - pipeline otomatis: cast → misteri → dunia → lock → Bab 1.
3. Jalur ini **reuse** engine authoring yang sama dengan `/brainstorm`; tidak boleh membuat engine paralel.
4. Draft guest boleh disimpan lokal sementara (`localStorage`, TTL terbatas, tanpa token/PII) untuk resume setelah login.
5. Taste profile berfungsi sebagai **soft bias**, bukan hard rule.

### LD-READER-REREAD — Reader mendukung daftar bab dan re-read yang jujur

1. Reader boleh menampilkan daftar bab ringan tanpa membocorkan spoiler bab yang belum dibaca.
2. Re-read mode harus:
   - menandai bahwa pembaca sedang membaca ulang,
   - menampilkan pilihan yang dulu dipilih sebagai locked choice,
   - menyediakan CTA untuk kembali ke bab terbaru.
3. Setelah memilih di bab N, pembaca langsung diarahkan ke bab N+1; phase "consequence" di halaman yang sama dihapus.
4. Ringkasan pilihan terakhir boleh ditampilkan di bab baru; guest boleh memakai fallback lokal.

### LD-DEMO-CATALOG — Demo resmi Lakoku kini punya dua seed publik resmi

1. Katalog demo resmi tidak lagi tunggal.
2. Dua story resmi yang boleh tampil publik di explore saat ini:
   - `demo:selasa-akhir`
   - `premium:bilik-ketujuh-kbm-v2`
3. `premium:bilik-ketujuh-kbm-v2` adalah seed premium editorial 50 bab dengan cover resmi `/covers/bilik-ketujuh.webp`.
4. Penambahan demo resmi ini **tidak** mengubah aturan ownership AMENDMENTS v0.5: playthrough user tetap privat.

---

## A. Dampak ke PRD

PRD harus mencerminkan:
1. `/mulai` sebagai quick-start onboarding resmi dengan AI premise generation.
2. Reader UX baru: daftar bab, re-read mode, locked previous choice, dan redirect langsung ke bab berikutnya.
3. Katalog demo resmi kini memuat `premium:bilik-ketujuh-kbm-v2` selain `demo:selasa-akhir`.
4. Admin ops surface cukup disebut sebagai permukaan internal non-reader; detail teknis tetap milik ARCH.

## B. Dampak ke ARCHITECTURE

ARCHITECTURE harus mencerminkan:
1. AMENDMENTS v0.6 dan v0.7 di header + reference list.
2. Batas permukaan `/admin/*`, RBAC DB-based, audit log settings, dan grant kredit atomik.
3. Peran `generation_policy`, `ai_model_routes`, `feature_credit_costs`, `credit_orders`, `admin_credit_grants`, `admin_settings_audit_logs`.
4. `/mulai` quick onboarding sebagai permukaan aplikasi resmi yang reuse engine authoring.
5. Reader chapter-list/re-read sebagai ekstensi Reader API tanpa spoiler leak.
6. Demo catalog resmi berisi dua story ID publik.

## C. Dampak ke IMPLEMENTATION / CHECKLIST

Checklist harus mencatat:
1. Reader UX extension (`T6W.12`–`T6W.15`).
2. Admin Ops Surface (`T-ADMIN-*`).
3. Smoke admin-panel sebagai bagian gate lokal.
4. Dependensi baru terhadap migrasi 11 Juli 2026 (`ops_credit_config`, `admin_users_role`, `admin_editable_settings`, `reader_taste_profiles`, `analytics_events`).

## D. Acceptance Criteria Dokumen

Amandemen ini dianggap terserap bila:
1. PRD menyebut quick onboarding `/mulai`, re-read chapter list, dan katalog demo resmi kedua.
2. ARCH menambahkan v0.7 ke header/reference dan batas permukaan admin/onboarding.
3. PROGRESS_CHECKLIST memuat blok `M6-WEB++` dan `Admin Ops Surface`.
4. Tidak ada lagi dokumen aktif yang mengasumsikan:
   - admin = hardcoded email,
   - `/admin/settings` read-only permanen,
   - demo resmi cuma satu seed,
   - consequence phase masih ada di reader.

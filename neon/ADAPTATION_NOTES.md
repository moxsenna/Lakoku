# Catatan Adaptasi Migrasi: Supabase -> Neon

**Tanggal:** 2026-10-04  
**Total Migrasi Sumber:** 91 file (`supabase/migrations/*.sql`)  
**Total Migrasi Target:** 91 file (`neon/migrations/*.sql`)  
**Runner:** `scripts/neon-migrate.mjs`  
**Transformer:** `scripts/adapt-supabase-migrations.mjs`  

---

## 1. Arsitektur Transformer

Transformer `scripts/adapt-supabase-migrations.mjs` mentransformasi migrasi Supabase ke Neon secara deterministik, satu arah, dan dapat direproduksi:

1. **Parser Token & Statement Splitting Robust:**
   - Memecah statement pada karakter `;` hanya di luar string literal (`'...'`), quoted identifier (`"..."`), komentar satu baris (`--`), komentar blok bertingkat (`/* ... */` dengan dukungan PostgreSQL nested block comment), dan dollar-quoted blocks (`$tag$...$tag$`).
   - Deteksi dollar-quoting tangguh dengan regex `^\$([a-zA-Z0-9_]*)\$` untuk mendukung semua tag custom PostgreSQL (`$baseline_guard$`, `$baseline_ddl$`, `$living_canon_duplicate_guard$`, `$expand_guard$`, `$function$`, `$$`).
   - Normalisasi whitespace dan pengupasan leading comments (`getCodeWithoutLeadingComments`) agar DDL yang didahului komentar `--` atau `/* ... */` tetap terdeteksi oleh regex `DROP_PATTERNS`.

2. **Pola Pembuangan (DROP_PATTERNS):**
   - `CREATE POLICY`: Dihapus seluruhnya (RLS dihilangkan dari data plane Neon).
   - `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY`: Dihapus seluruhnya.
   - `GRANT` / `REVOKE`: Dihapus untuk role Supabase (`anon`, `authenticated`, `service_role`, `postgres`).
   - `ALTER TABLE/FUNCTION ... OWNER TO`: Dihapus seluruh klausa kepemilikan.
   - `CREATE EXTENSION IF NOT EXISTS pg_cron` & `SELECT cron.schedule`: Dihapus seluruhnya.
   - `INSERT INTO storage.buckets`: Dihapus seluruhnya.
   - `ALTER TABLE ... ADD CONSTRAINT ... REFERENCES auth.users`: Dihapus seluruh constraint FK ke `auth.users`.

3. **Pola Penyesuaian (REWRITES):**
   - Ekstensi `btree_gist`: Memastikan skema `extensions` dibuat terlebih dahulu (`CREATE SCHEMA IF NOT EXISTS extensions;`).
   - FK Inline pada kolom `CREATE TABLE` / `ALTER TABLE`: `REFERENCES auth.users(id) [ON DELETE ...]` diganti bersih menjadi `/* auth.users fk removed */` tanpa menyisakan klausa gantung `ON DELETE`. Kolom data tetap dipertahankan.

---

## 2. Keputusan Khusus & Non-Mekanis

### A. `20260707000000_core_runtime_baseline.sql`
- **Asal:** Berisi blok PL/pgSQL raksasa `do $baseline_guard$ ... execute $baseline_ddl$ ... $baseline_guard$;` yang menguji integritas skema pre-history Supabase lama.
- **Masalah di Neon:** Pada Neon kosong (`neondb`), guard memeriksa hak akses fungsi pada role `anon`/`authenticated`/`service_role` via `has_function_privilege()`. Karena role tersebut tidak ada di Neon, eksekusi menghasilkan error fatal `role "anon" does not exist`. Selain itu, string DDL di dalam `$baseline_ddl$` mengandung puluhan statement `GRANT/REVOKE` dan `OWNER TO "postgres"`.
- **Keputusan:** Transformer mengekstrak isi DDL murni dari dalam `$baseline_ddl$`, menyalurkannya melalui filter `stripStatements`, membuang kebijakan RLS/grants/owner, serta menambahkan preamble inisialisasi skema kompatibilitas (`extensions`, ekstensi `btree_gist` dan `pgcrypto`, skema `auth`, stub `auth.uid()`, dan tabel kompatibilitas `auth.users`).

### B. `20260718060000_harden_legacy_lifecycle_function_acl.sql`
- **Isi Sumber:** Hanya memuat statement `REVOKE ALL ON FUNCTION ... FROM public, anon, authenticated;` dan `GRANT EXECUTE ... TO service_role;`.
- **Keputusan:** Seluruh statement dihapus karena ditujukan ke role Supabase yang tidak ada di Neon. File menghasilkan 0 bytes, yang merupakan no-op valid di PostgreSQL dan dicatat di runner tanpa error.

### C. `20260824101000_e5_stateless_validator_attestation.sql`
- **Dependensi Kriptografi:** Menggunakan fungsi `extensions.gen_random_bytes(32)`, `extensions.hmac(...)`, dan `extensions.digest(...)`.
- **Keputusan:** Ekstensi `pgcrypto` dengan skema `extensions` diinisialisasi pada migrasi baseline awal agar seluruh fungsi hashing dan HMAC tersedia.

---

## 3. Inventaris Dependensi `auth.users` di Body Fungsi (Untuk Task 3 Audit)

Berikut adalah daftar lengkap fungsi SQL dan View yang menyentuh tabel `auth.users` di dalam implementasinya (bukan sekadar kolom FK):

| File Migrasi | Objek | Baris | Jenis Akses | Konteks |
|---|---|---|---|---|
| `20260711020000_admin_users_role.sql` | `is_admin_user(uuid)` | 16 | `FROM auth.users` | Pengecekan admin |
| `20260713050000_clone_premium_story_instance.sql` | `clone_premium_story_instance(...)` | 104 | `FROM auth.users as users` | Salin instance cerita |
| `20260713070000_harden_premium_story_clone.sql` | `clone_premium_story_instance(...)` | 367 | `FROM auth.users as users` | Hardening kloning |
| `20260718110000_admin_generation_observability_rpcs.sql` | `admin_generation_provider_calls_v1(...)` | 740 | `LEFT JOIN auth.users as u` | Observabilitas generasi |
| `20260718110000_admin_generation_observability_rpcs.sql` | `admin_generation_jobs_v1(...)` | 844 | `LEFT JOIN auth.users as u` | Observabilitas generasi |
| `20260718110000_admin_generation_observability_rpcs.sql` | `admin_generation_user_summary_v1(...)` | 1162 | `LEFT JOIN auth.users as u` | Observabilitas pengguna |
| `20260728010000_plot_debt_closure_ledger.sql` | `clone_premium_story_instance(...)` | 524 | `FROM auth.users as users` | Resolusi plot debt |
| `20260802010000_durable_validation_diagnostics.sql` | `admin_generation_provider_calls_v2(...)` | 122 | `LEFT JOIN auth.users u` | Diagnostik validasi |
| `20260804010000_account_commercial_entitlements.sql` | `ensure_account_commercial_entitlements(...)` | 215 | `SELECT created_at FROM auth.users` | Inisialisasi tier komersial |
| `20260806010000_commercial_cutover_primitives.sql` | `create_test_auth_user_v1(...)` | 523 | `INSERT INTO auth.users` | Helper pengujian lokal |
| `20260823100300_e5_blueprint_rls.sql` | `vw_blueprint_recent_resolutions` (VIEW) | 52 | `LEFT JOIN auth.users AS u` | View resolusi blueprint E5 |

---

## 4. Hasil Verifikasi Gate

1. **Grep Gate:**
   ```bash
   grep -rliE "create policy|row level security|cron\.|storage\.buckets|references auth\.users" neon/migrations/ | wc -l
   # Output: 0
   ```
2. **Fresh Replay:**
   ```bash
   node scripts/neon-migrate.mjs
   # Output: 91/91 migrations applied cleanly (OK)
   ```
3. **Idempotency Gate:**
   ```bash
   node scripts/neon-migrate.mjs
   # Output: 91/91 migrations skipped, total tercatat: 91
   ```
4. **Structural Diff:**
   - Dibuat di `neon/STRUCTURAL_DIFF.txt`.
   - 75/75 tabel domain Supabase identik, 166/166 fungsi domain identik, 17/17 trigger identik.
   - Delta terbukti dan terdokumentasi: +1 tabel kompatibilitas `auth.users`, +1 stub fungsi `auth.uid()`.

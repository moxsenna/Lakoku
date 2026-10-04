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

## 3. Inventaris Dependensi `auth.users` di Body Fungsi & Decision Table (Task 3 Audit)

Audit mendalam terhadap seluruh 11 kemunculan `auth.users` di dalam body fungsi SQL dan view di `neon/migrations/`:

### Decision Table

| No | File Migrasi | Objek SQL | Status | Pemanggil di Aplikasi (File:Baris) | Keputusan & Solusi |
|---|---|---|---|---|---|
| 1 | `20260711020000_admin_users_role.sql` | `public.admin_search_users_v1(p_email text)` | **LIVE** | `app/api/admin/users/search/route.ts:37`<br>`lib/admin/users.ts:19` | **Pertahankan Body + Compat Shim**.<br>Mencari pengguna admin via `auth.users`. Tabel compat `auth.users` menyediakan kolom `id` dan `email`. Tidak ada tabel `public.profiles` di skema Lakoku (hanya ada `reader_taste_profiles` untuk preferensi novel). |
| 2 | `20260713050000_clone_premium_story_instance.sql` | `public.clone_premium_story_instance(...)` | **DEAD** | Tidak ada (ditimpa oleh revisi berikutnya) | **Pertahankan Body**.<br>Versi awal kloning cerita premium. Telah ditimpa oleh migrasi `20260728010000`. |
| 3 | `20260713070000_harden_premium_story_clone.sql` | `public.clone_premium_story_instance(...)` | **DEAD** | Tidak ada (ditimpa oleh revisi berikutnya) | **Pertahankan Body**.<br>Versi revisi hardening kloning cerita premium. Telah ditimpa oleh migrasi `20260728010000`. |
| 4 | `20260728010000_plot_debt_closure_ledger.sql` | `public.clone_premium_story_instance(...)` | **LIVE** | `lib/api/premium-clone.server.ts:241` | **Pertahankan Body + Compat Shim**.<br>Memeriksa eksistensi pengguna: `not exists (select 1 from auth.users as users where users.id = p_user_id)`. Terpenuhi oleh compat table `auth.users(id)`. |
| 5 | `20260718110000_admin_generation_observability_rpcs.sql` | `public.admin_generation_provider_calls_v1(...)` | **DEAD** | Tidak ada (digantikan oleh v2 di `20260802010000`) | **Pertahankan Body**.<br>`LEFT JOIN auth.users as u` untuk observability v1. Valid dengan compat table. |
| 6 | `20260718110000_admin_generation_observability_rpcs.sql` | `public.admin_generation_job_detail_v1(p_job_id uuid)` | **LIVE** | `lib/admin/generation.ts:150` | **Pertahankan Body + Compat Shim**.<br>`LEFT JOIN auth.users as u` untuk `masked_user_email`. Karena berupa `LEFT JOIN`, jika pengguna belum tercatat di auth, kolom tetap `NULL` aman tanpa kegagalan query. |
| 7 | `20260718110000_admin_generation_observability_rpcs.sql` | `public.admin_generation_cost_breakdown_v1(...)` | **LIVE** | `lib/admin/generation.ts:186` | **Pertahankan Body + Compat Shim**.<br>`LEFT JOIN auth.users as u` untuk `masked_user_email` breakdown biaya per pengguna. Aman via `LEFT JOIN` dan compat table. |
| 8 | `20260802010000_durable_validation_diagnostics.sql` | `public.admin_generation_provider_calls_v2(...)` | **LIVE** | `lib/admin/generation.ts:133` | **Pertahankan Body + Compat Shim**.<br>`LEFT JOIN auth.users u` untuk `masked_user_email` pemanggilan provider AI. Aman via `LEFT JOIN` dan compat table. |
| 9 | `20260804010000_account_commercial_entitlements.sql` | `public.grant_welcome_credit_v1(p_user_id uuid)` | **LIVE** | `lib/api/premium-clone.server.ts:427`<br>`lib/api/personalized-stories.server.ts:310` | **Pertahankan Body + Compat Shim**.<br>Mengecek `v_user_created_at` dari `auth.users`. Compat table menyediakan kolom `created_at` bertipe timestamptz. |
| 10 | `20260806010000_commercial_cutover_primitives.sql` | `public.create_test_auth_user_v1(p_user_id uuid, p_email text)` | **TEST** | `tests/integration/commercial-cutover.test.ts:40`<br>`tests/integration/monetization-lifecycle.test.ts:42` | **Pertahankan Body + Compat Shim**.<br>Hanya dipanggil dari skrip pengujian integrasi (`tests/integration/`). Tidak ada pemanggil dari kode produksi (`app/`, `lib/`). Menyisipkan record ke `auth.users` tiruan untuk pengujian fixture. |
| 11 | `20260823100300_e5_blueprint_rls.sql` | `public.vw_blueprint_recent_resolutions` (VIEW) | **DEAD** | Tidak ada pemanggil di `lib/`, `app/`, `scripts/` | **Pertahankan View**.<br>`LEFT JOIN auth.users AS u` untuk `reviewer_email`. Valid dengan compat table. |

### Kebijakan Compat Shim (`neon/bootstrap/001-auth-compat.sql`)
1. Ditempatkan di direktori bootstrap: `neon/bootstrap/001-auth-compat.sql`.
2. Dijalankan otomatis oleh `scripts/neon-migrate.mjs` sebelum seluruh file `neon/migrations/*.sql`.
3. Memastikan skema `auth`, fungsi stub `auth.uid()`, dan tabel `auth.users` dengan 11 kolom (`id`, `instance_id`, `email`, `encrypted_password`, `email_confirmed_at`, `raw_app_meta_data`, `raw_user_meta_data`, `role`, `aud`, `created_at`, `updated_at`) tersedia secara idempoten (`IF NOT EXISTS` / `OR REPLACE`).
4. Semua fungsi LIVE tidak memerlukan perubahan logika body karena seluruh join bersifat non-intrusif (`LEFT JOIN` atau pengecekan ID) dan kompatibel penuh dengan identitas UUID pengguna. Tidak ditemukan `public.profiles` di repositori Lakoku. Tidak ditemukan fungsi LIVE yang melakukan `INSERT INTO auth.users`.

### Handoff ke Task 4 (clone data)

- `scripts/neon-clone-data.mjs` WAJIB mengisi `auth.users` (compat) — dump harus menyertakan `--table=auth.users` dari schema auth Supabase, selain `public` + `private`.
- Alasan eksplisit: dua fungsi LIVE melakukan hard existence check terhadap `auth.users`:
  - `clone_premium_story_instance` (`neon/migrations/20260728010000_plot_debt_closure_ledger.sql:524`) — raise `INVALID_OWNER` bila user tidak ada.
  - `grant_welcome_credit_v1` (`neon/migrations/20260804010000_account_commercial_entitlements.sql:215`) — raise `user % not found` bila tidak ada.
- Tanpa populasi ini, clone cerita premium dan welcome credit gagal di produksi.
- Catatan juga: kolom compat `auth.users` yang wajib terisi minimal: `id`, `email`, `encrypted_password`, `raw_user_meta_data`, `email_confirmed_at`, `created_at` (sekaligus persiapan import user Better Auth di Fase B).

### Implementasi aktual (deviasi dari pg_dump)

1. **Latar Belakang Deviasi:**
   - Mesin eksekusi tidak memiliki binary `pg_dump` maupun `psql` di `PATH`, dan daemon Docker lokal dalam kondisi down (`docker info` gagal).
   - Pendekatan pipe shell `pg_dump | psql` dari brief awal digantikan oleh cloner pure-JS berbasis driver `pg` (`scripts/neon-clone-data.mjs`).

2. **Mekanisme Cloner (`scripts/neon-clone-data.mjs`):**
   - **Koneksi & Tipe Data:** Membaca data langsung dari Supabase via pooling TLS (`rejectUnauthorized: false`), menulis ke Neon via `DATABASE_URL`. Parser JSON/JSONB dinonaktifkan (`setTypeParser` OID 114 & 3802 mengembalikan raw string) untuk menjamin transfer JSON lossless tanpa mutasi format. Kolom `bytea` ditransfer sebagai `Buffer`, array PostgreSQL tetap dipetakan sebagai JS array, dan timestamp/UUID dipertahankan 100%.
   - **Scope Tabel:** Menangani 76 tabel (semua tabel base `public.*` dan `private.*` plus `auth.users`). Seluruh skema drift live Supabase (tabel `public.content_reports` dan fungsi `public.record_content_report_v1`) kini dimiliki dan dikelola secara formal oleh file migrasi `neon/migrations/20261004000000_live_drift_capture.sql`, sehingga fresh replays migrations bersifat 100% lengkap dan mandiri tanpa bergantung pada script cloner.
   - **Handling Identity & Triggers:**
     - 13 tabel memiliki user-triggers (misal immutable history guard E5). Triggers dinonaktifkan sementara (`ALTER TABLE ... DISABLE TRIGGER USER`) sebelum truncate dan clone, kemudian diaktifkan kembali (`ENABLE TRIGGER USER`) pada fase cleanup.
     - 8 tabel memiliki kolom `GENERATED ALWAYS AS IDENTITY` (`act_rollups`, `chapter_blueprints`, dsb). Cloner menggunakan klausa `OVERRIDING SYSTEM VALUE` dan mereset sequence menggunakan `setval(pg_get_serial_sequence(...), ...)` setelah insert.
   - **Topological Order & Cycle Resolution:**
     - Mengurutkan tabel target secara topologis menggunakan algoritma Kahn dari graf FK Neon (`information_schema.table_constraints`).
     - Siklus saling referensi antara `public.blueprint_resolutions` dan `public.blueprint_validator_proofs` (keduanya memiliki FK berstatus `DEFERRABLE INITIALLY DEFERRED`) dipecah dengan mengabaikan edge deferrable nullable `blueprint_resolutions -> blueprint_validator_proofs` pada tahap pemesanan tabel.
   - **Idempotensi:** Semua target tabel di-`TRUNCATE ... CASCADE` dalam satu statement sebelum pemindahan data.
   - **Parity Gate:** Menghitung total row pada kedua database pasca-klon. Seluruh 76 tabel cocok 100% (16.180 baris total, 18 baris `auth.users`, 125 baris `stories`), dan laporan lengkap disimpan di `neon/CLONE_PARITY.txt`.

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

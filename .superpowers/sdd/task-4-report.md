# Task 4 Report: Clone Data Produksi Supabase ke Neon

**Tanggal:** 2026-10-04  
**Worktree:** `feat-neon-phase-a`  
**Pelaksana:** Task 4 Subagent  
**Status:** SUCCESS (Parity Gate 100% PASS)

---

## 1. Arsitektur & Desain Cloner (`scripts/neon-clone-data.mjs`)

### A. Latar Belakang & Deviasi dari Brief Awal
- **Brief Awal:** Menggunakan shell pipeline `pg_dump` dan `psql`.
- **Kondisi Lingkungan:** Host Windows tidak memiliki binary `pg_dump` maupun `psql` pada `PATH`, dan daemon Docker lokal down (`docker info` gagal).
- **Solusi Adaptif:** Membangun pure-JS cloner menggunakan library `pg` yang sudah terpasang di dependencies workspace (`scripts/neon-clone-data.mjs`). Cloner membaca langsung dari Supabase via pooling TLS (`rejectUnauthorized: false`) dan menulis ke Neon via `DATABASE_URL`.

### B. Preservasi Tipe Data & Fidelity
1. **JSON / JSONB:** Dinonaktifkan parser otomatis `pg` (`setTypeParser` OID 114 & 3802 mengembalikan raw string) sehingga JSON string dari Supabase ditransfer tanpa parsing/re-serializing (menghindari mutasi key order, spasi, atau array-type ambiguity).
2. **Bytea:** Diterima sebagai Node.js `Buffer` dan dikirim langsung ke query berparameter sebagai `bytea`.
3. **Array (e.g. `_text`, `_int4`):** Diterjemahkan secara native oleh driver `pg` sebagai PostgreSQL array literals.
4. **Timestamps & UUIDs:** Preservasi penuh nilai UUID dan timestamp ISO-8601 hingga presisi milidetik.
5. **Introspeksi Tipe:** Seluruh tipe data diperiksa terhadap whitelist tipe yang didukung sebelum clone dimulai; tipe eksotik akan memicu error fatal.

### C. Penanganan Relasi & Integritas Data
1. **Pengurutan Topologis (Kahn's Algorithm):**
   - Graf ketergantungan dibangun dari FK di `information_schema.table_constraints`.
   - Mengurutkan 76 tabel target agar tabel induk selalu diisi sebelum tabel anak.
2. **Resolusi Siklus FK Deferrable:**
   - Ditemukan ketergantungan melingkar antara `public.blueprint_resolutions` (`result_proof_id`) dan `public.blueprint_validator_proofs` (`resolution_id`).
   - Keduanya dideklarasikan di skema sebagai `DEFERRABLE INITIALLY DEFERRED`.
   - Cloner memecah siklus ini secara deterministik dengan mengabaikan edge nullable `blueprint_resolutions -> blueprint_validator_proofs` pada tahap pengurutan topologis.
3. **Identity Columns (`GENERATED ALWAYS AS IDENTITY`):**
   - 8 tabel menggunakan identitas auto-increment (`act_rollups`, `chapter_blueprints`, `character_aliases`, `knowledge_scopes`, `outbox`, `retrieval_logs`, `story_events`, `timeline_events`).
   - Cloner mendeteksi kolom identitas secara otomatis dan menyisipkan klausa `OVERRIDING SYSTEM VALUE`.
   - Setelah insert, sequence dimutakhirkan menggunakan `SELECT setval(pg_get_serial_sequence(...), coalesce(max(...), 1))` untuk mencegah tabrakan ID pada masa mendatang.
4. **Trigger Bypassing:**
   - 13 tabel memiliki user-triggers (mis. immutable history guard `private.e5_reject_authoritative_history_mutation()`).
   - Cloner menonaktifkan user-triggers sementara (`ALTER TABLE ... DISABLE TRIGGER USER`) sebelum TRUNCATE dan INSERT, kemudian mengaktifkannya kembali (`ENABLE TRIGGER USER`) pada fase `finally` dengan rollback pengaman.
5. **Idempotensi Penuh:**
   - Seluruh tabel target di-`TRUNCATE ... CASCADE` dalam satu statement sebelum penulisan.
   - Batch insert menggunakan ukuran dinamis (`Math.min(500, Math.floor(30000 / cols))`).
   - Transaksi dibungkus dalam `BEGIN ... COMMIT` atomik.

---

## 2. Pemetaan & Populasi `auth.users`

- **Tabel Sasaran:** `auth.users` compat table (11 kolom sesuai `neon/bootstrap/001-auth-compat.sql`).
- **Kolom Terpetakan:** `id`, `instance_id`, `email`, `encrypted_password`, `email_confirmed_at`, `raw_app_meta_data`, `raw_user_meta_data`, `role`, `aud`, `created_at`, `updated_at`.
- **Hasil:** 18 baris pengguna produksi berhasil dikloning ke Neon, menjamin fungsi live seperti `grant_welcome_credit_v1` dan `clone_premium_story_instance` tidak mengalami kegagalan foreign-key / existence check.

---

## 3. Temuan Kasus Khusus: `public.content_reports`

- **Temuan:** Di Supabase live, terdapat tabel `public.content_reports` (0 baris) dan fungsi `public.record_content_report_v1`. Objek ini dibuat pada implementasi M7c (`lib/api/reports.ts`), namun file migrasinya tidak pernah di-commit ke folder `supabase/migrations/` di repositori.
- **Tindakan Cloner:** `scripts/neon-clone-data.mjs` menyertakan preflight DDL idempoten untuk membuat `public.content_reports` dan indeksnya di target Neon jika belum tersedia, sehingga skema Neon sinkron 100% dengan kebutuhan live codebase.

---

## 4. Ringkasan Paritas Row-Count (Supabase vs Neon)

- **Total Tabel Diproses:** 76 tabel (`auth.users`, 3 tabel `private.*`, 72 tabel `public.*`).
- **Total Baris Sumber (Supabase):** 16.180 baris
- **Total Baris Target (Neon):** 16.180 baris
- **Paritas Gate:** 76/76 MATCH (100% Lolos, 0 Mismatch)
- **Laporan Lengkap:** Disimpan di `neon/CLONE_PARITY.txt`.

### Sorotan Tabel Utama
| Tabel | Baris Supabase | Baris Neon | Status |
|---|---|---|---|
| `auth.users` | 18 | 18 | MATCH |
| `public.stories` | 125 | 125 | MATCH |
| `public.chapters` | 177 | 177 | MATCH |
| `public.chapter_blueprints` | 6.150 | 6.150 | MATCH |
| `public.story_events` | 543 | 543 | MATCH |
| `public.story_threads` | 446 | 446 | MATCH |
| `public.characters` | 571 | 571 | MATCH |
| `public.character_aliases` | 693 | 693 | MATCH |
| `public.facts_ledger` | 684 | 684 | MATCH |
| `public.knowledge_scopes` | 684 | 684 | MATCH |
| `public.generation_provider_calls` | 1.492 | 1.492 | MATCH |
| `public.act_rollups` | 400 | 400 | MATCH |
| `public.generation_leases` | 406 | 406 | MATCH |
| `public.retrieval_logs` | 420 | 420 | MATCH |
| `public.idempotency_keys` | 337 | 337 | MATCH |

---

## 5. Verifikasi Yang Dijalankan

1. **Eksekusi Pertama:**
   - Menjalankan `node scripts/neon-clone-data.mjs`.
   - Mengunduh 16.180 baris dari Supabase, menyisipkan ke Neon secara topologis, melewati parity gate dengan status `PASS` (exit 0).
2. **Pengujian Idempotensi (Eksekusi Kedua):**
   - Menjalankan ulang `node scripts/neon-clone-data.mjs`.
   - Truncate cascade berhasil membersihkan seluruh tabel target.
   - Seluruh baris dimuat kembali tanpa error constraint ataupun duplicate key.
   - Parity gate tetap `PASS` dengan jumlah baris yang persis identik.
3. **Pengujian CLI Filtering (`--tables`):**
   - Menjalankan `node scripts/neon-clone-data.mjs --tables admin_users,push_devices`.
   - Hanya 2 tabel yang diproses dan dipastikan cocok.
   - Cloner penuh dijalankan ulang setelahnya untuk mengembalikan parity report 76 tabel lengkap.
4. **Spot-Check Database Langsung:**
   - `SELECT count(*) FROM public.stories` di Neon = 125 (> 0).
   - `SELECT count(*) FROM auth.users` di Neon = 18 (= Supabase).
   - Sampel row stories dan users terverifikasi valid dan tidak mengalami korupsi data.

---

## 6. Self-Review & Concerns

- **Kekhawatiran Keamanan Data:** Kredensial URL database tidak pernah dicetak ke terminal atau file git (selalu dimaskir menjadi `postgresql://***@host...`). File `.env.local` tidak diubah dan tidak di-stage.
- **Kinerja:** Transfer 16.180 baris memakan waktu ±15 detik melalui koneksi pooling SSL antar-cloud.
- **Handoff ke Task 5:** Neon database kini memiliki skema lengkap dan seluruh data produksi Supabase. Siap untuk pengujian integrasi dan wiring client Kysely/Pg.

---

## Fix round (Task 4 review)

### 1. Drift Objects Captured
Hasil audit introspeksi mendalam (live-vs-live diff katalog PostgreSQL PG 17.6) antara live Supabase dan file migrasi `neon/migrations/`:
- **Tabel Domain Supabase:** 75 tabel. 74 tabel telah dideklarasikan di `neon/migrations/`, 1 tabel terdeteksi drift: `public.content_reports`.
- **Fungsi Domain Supabase:** 129 fungsi. 128 fungsi telah dideklarasikan di `neon/migrations/`, 1 fungsi terdeteksi drift: `public.record_content_report_v1(text,integer,uuid,text,text,jsonb)`.
- **Views:** 4 views (100% cocok, 0 drift).
- **Triggers:** 17 triggers (100% cocok, 0 drift).
- **Indexes:** 202 domain indexes. Seluruh index cocok termasuk index pendukung `public.content_reports_story_chapter_idx`.
- **Objek yang Dikodifikasikan ke `neon/migrations/20261004000000_live_drift_capture.sql`:**
  1. `public.content_reports` (table DDL dengan 9 kolom, PK, FK `stories(id) ON DELETE CASCADE`, CHECK `chapter_number >= 1`, status default `'OPEN'`).
  2. `public.content_reports_story_chapter_idx` (btree index on `story_id, chapter_number`).
  3. `public.record_content_report_v1` (SECURITY DEFINER plpgsql function body verbatim dari Supabase).

### 2. Koreksi ADAPTATION_NOTES.md
- Menghapus klaim bahwa script cloner meng-handle pembuatan `record_content_report_v1`.
- Memperbarui dokumentasi bahwa tabel `public.content_reports` dan fungsi `public.record_content_report_v1` kini sepenuhnya dimiliki oleh migrasi formal `neon/migrations/20261004000000_live_drift_capture.sql` sehingga migrasi fresh replay mandiri tanpa ketergantungan script cloner.

### 3. Perbaikan Skrip Cloner (`scripts/neon-clone-data.mjs`)
- **Fix Trigger Window:** Memindahkan loop `DISABLE TRIGGER USER` ke dalam blok `try` (sebelum TRUNCATE) agar blok `finally` (`ENABLE TRIGGER USER`) selalu menjamin pemulihan trigger meskipun terjadi kegagalan dini.
- **Fix Identity Sequence Reset:** Memperbarui penanganan sequence identitas dengan `CASE WHEN max(col) IS NOT NULL THEN setval(seq, max, true) ELSE setval(seq, 1, false) END`. Pada tabel kosong, `setval(seq, 1, false)` memastikan insert baris pertama berikutnya menghasilkan ID bernilai 1.

### 4. Hasil Verifikasi
1. **Penerapan Migrasi Baru:**
   - Menjalankan `node scripts/neon-migrate.mjs` -> Migrasi `20261004000000_live_drift_capture.sql` berhasil diterapkan (`OK`), total migrasi tercatat: 93.
   - Idempotency re-run -> seluruh 93 file migrasi di-skip (`selesai. total tercatat: 93`).
2. **Inspeksi Objek Neon Pasca-Migrasi:**
   - `information_schema.columns` pada `public.content_reports`: 9 kolom cocok 100%.
   - `pg_indexes` pada `public.content_reports`: `content_reports_pkey` dan `content_reports_story_chapter_idx` aktif.
   - `pg_get_functiondef('public.record_content_report_v1(text,integer,uuid,text,text,jsonb)'::regprocedure)`: body fungsi identik verbatim dengan Supabase.
3. **Pemeriksaan Ulang Drift Live-vs-Live:**
   - Missing tables: 0
   - Missing columns: 0
   - Missing views: 0
   - Missing functions: 0
   - Missing triggers: 0
   - Missing indexes: 0
   - Laporan struktural dimutakhirkan di `neon/STRUCTURAL_DIFF.txt`.
4. **Syntax & Paritas Cloner:**
   - `node --check scripts/neon-clone-data.mjs` lolos bersih tanpa error.
   - `node scripts/neon-clone-data.mjs` sukses: 16.180 baris dari 76 tabel tersinkronisasi dengan status `ALL MATCH` (Parity Verdict: PASS).


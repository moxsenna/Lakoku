# Task 8 Report: Rewrite Modul Data Inti API ke Kysely (Neon Phase A)

## Executive Summary
Task 8 berhasil diselesaikan secara penuh mencakup 14 modul data inti API pada codebase Lakoku yang dimigrasikan dari PostgREST (`supabase-js`) ke query builder type-safe Kysely (`@lakoku/db`).
Migrasi dilaksanakan dalam 3 batch modular dengan verifikasi berjenjang (typecheck, grep check, unit test, dan audit RLS guard).

Semua query PostgREST `.from()` dan `.rpc()` telah dieliminasi 100% dari 14 modul tersebut. Auth GoTrue (`supabase.auth.getUser(...)`) dipertahankan pada `supabase-js` sesuai arsitektur transisi Neon Phase A.

---

## Modul yang Dimigrasikan

### Batch A (Commit `adf63dc`)
1. `lib/api/queries.ts` — Query pembaca publik, eksplorasi cerita, detail cerita, dan bab.
2. `lib/api/story-ownership.server.ts` — Verifikasi kepemilikan cerita pembaca/penulis.
3. `lib/api/share.ts` — Resolusi token share, pembuatan link share, dan kloning cerita via share link.

### Batch B (Commit `1bb478b`)
4. `lib/api/user-state.ts` — Progress pembaca (`reader_states`), riwayat pilihan, snapshot state, dan bookmark.
5. `lib/api/taste-profile.ts` — Profil preferensi pembaca dan versi profil.
6. `lib/api/leases.ts` — Akuisisi dan perpanjangan lease runtime cerita.
7. `lib/api/chapter-status.server.ts` — Polling status bab, pengecekan ketersediaan chapter, dan status job generasi.
8. `lib/api/start-chapter.server.ts` — Inisialisasi awal bab cerita dan pendaftaran attempt generasi.

### Batch C (Commit `f41cc08`)
9. `lib/api/personalized-choice.server.ts` — Eksekusi pilihan interaktif personalisasi dan evaluasi percabangan.
10. `lib/api/personalized-stories.server.ts` — Pembuatan dan bootstrapping cerita personalisasi AI.
11. `lib/api/generation-continuation.server.ts` — Kontinuitas antrean generasi bab berikutnya pasca-pilihan.
12. `lib/api/generation-job-enqueue.server.ts` — Enqueue job generasi background via RPC `enqueue_generation_job_v1`.
13. `lib/api/commercial-resume.server.ts` — Resume operasi komersial cerita berbayar/starter.
14. `lib/api/premium-clone.server.ts` — Reservasi dan kloning template cerita premium.

---

## Transformasi & Penegakan RLS Guard

1. **Eliminasi PostgREST Query Builder:**
   - Seluruh pemanggilan `.from('table').select(...)`, `.insert(...)`, `.update(...)`, `.delete(...)`, dan `.rpc(...)` digantikan dengan `db.selectFrom(...)`, `db.insertInto(...)`, `db.updateTable(...)`, `db.deleteFrom(...)`, serta helper kompatibilitas `result()`, `single()`, `singleOrThrow()`, `countOf()`, `rpcOne()`, dan `rpcRows()`.

2. **Penegakan RLS_AUDIT NEW_WHERE Guards:**
   - Sesuai audit matrix `docs/qa/neon/RLS_AUDIT.md`, query yang sebelumnya bergantung pada implicit Supabase RLS kini dilengkapi klausul `.where()` eksplisit dan ditandai dengan komentar `// RLS_AUDIT: <policy>`:
     - `stories_public_read` / `stories_owner_read` di `queries.ts` dan `personalized-choice.server.ts`.
     - `reader_states_owner` di `user-state.ts`.
     - `chapters_owner_read` / `chapters_public_read` di `queries.ts` dan `chapter-status.server.ts`.

3. **Pelestarian Error Code Semantics:**
   - Helper `lib/supabase/compat.ts` diperbarui untuk mengekstrak dan mempertahankan atribut `code` dari Postgres SQLSTATE (misalnya `'23505'` unique violation) agar penanganan idempotensi dan replayed requests pada level pemanggil (seperti `premium-clone.server.ts` dan `personalized-stories.server.ts`) berfungsi identik.

4. **Isolasi Auth GoTrue:**
   - Seluruh pemanggilan sesi pengguna (`getSessionUser`, `createClient().auth.getUser()`) tetap menggunakan GoTrue client dari `lib/supabase/server.ts` tanpa perubahan kontrak.

---

## Verifikasi & Kualitas Kode

1. **TypeScript Typecheck:**
   - Perintah: `pnpm typecheck`
   - Hasil: 0 error (bersih).

2. **Pengecekan Zero PostgREST Call:**
   - Perintah: `git grep -nE "\.(from|rpc)\(" -- <14 migrated files>`
   - Hasil: 0 hits (satu-satunya kemunculan `.from(` adalah `Array.from` bawaan JavaScript di `lib/api/share.ts:599`).

3. **Larangan Prohibited Type Assertions:**
   - Perintah: `git grep -nE "(as any|@ts-ignore|@ts-expect-error)"` pada 14 file dan helper `compat.ts`.
   - Hasil: 0 pelanggaran.

4. **Verifikasi Test Suite:**
   - 14 test suites yang menguji modul-modul migrasi lolos 100%:
     - `tests/api/apply-choice-to-user-state.test.ts` (2/2 passed)
     - `tests/api/authoring-lock-start.test.ts` (11/11 passed)
     - `tests/api/chapter-status.test.ts` (43/43 passed)
     - `tests/api/generation-continuation.test.ts` (15/15 passed)
     - `tests/api/generation-job-enqueue.test.ts` (8/8 passed)
     - `tests/api/owned-queries.test.ts` (16/16 passed)
     - `tests/api/personalized-choice.test.ts` (21/21 passed)
     - `tests/api/personalized-stories.test.ts` (22/22 passed)
     - `tests/api/premium-clone.test.ts` (46/46 passed)
     - `tests/api/share-clone.test.ts` (4/4 passed)
     - `tests/tinta/explore.test.ts` (10/10 passed)
     - `tests/api/private-chapter-read.test.ts` (2/2 passed)
     - `lib/supabase/compat.test.ts` (28/28 passed)
     - `lib/supabase/db.test.ts` (2/2 passed)
     - **Total: 230/230 tests passed.**

---

## Riwayat Commit Task 8
- `adf63dc`: `refactor(neon): rewrite queries, story-ownership, and share data access to Kysely` (Batch A)
- `1bb478b`: `refactor(neon): rewrite user-state, taste-profile, leases, chapter-status, and start-chapter data access to Kysely` (Batch B)
- `f41cc08`: `refactor(neon): rewrite personalized choices, stories, continuation, enqueue, resume, and clone data access to Kysely` (Batch C)
- `fc287a5`: `test(neon): adapt private-chapter-read and explore tests to Kysely query builders`

# Task 5 Report: Kysely instance + tipe codegen (`lib/supabase/db.ts`)

## Implementation Overview
- Dibuat script codegen `scripts/neon-codegen.mjs` untuk membaca `DATABASE_URL` dari `.env.local`, menjalankan `kysely-codegen`, dan mengekspor alias `Database = DB`.
- Dihasilkan `lib/supabase/db-types.ts` dari database target Neon (81 tabel/view terintrospeksi, 82 interfaces + tipe pembantu `Generated`, `Int8`, `Timestamp`, `Json`, `Numeric`).
- Diterapkan TDD untuk `lib/supabase/db.ts`:
  - RED: Menulis test `lib/supabase/db.test.ts` sebelum `lib/supabase/db.ts` ada (`Error: Cannot find module '/lib/supabase/db'`).
  - GREEN: Mengimplementasikan singleton `getDb(): Kysely<Database>` dengan `PostgresDialect` + `pg.Pool` (max 10) dan validasi `DATABASE_URL`.
- Memperbarui barrel `lib/supabase/index.ts` untuk mengekspor `getDb` dan tipe `Database` (mempertahankan `createAdminClient` fase A).

## Codegen Summary
- **File:** `lib/supabase/db-types.ts`
- **Tabel / View terintrospeksi:** 81 tabel & view (public, private, dan auth.users compat).
- **Interface yang diekspor:** 82 interface (81 interface entitas + 1 root interface `DB`).
- **Tipe utama yang diekspor:**
  - `Database = DB` (kompatibel dengan kontrak barrel `@lakoku/db`)
  - `Stories`, `Chapters`, `ReaderStates`, `AdminUsers`, `AuthUsers` (`"auth.users"`), `ReadingPolicy`, `CreditLedger`, dll.
  - Tipe pembantu Kysely: `Generated<T>`, `Timestamp`, `Int8`, `Json`, `JsonObject`, `JsonArray`, `JsonPrimitive`, `Numeric`.

## TDD Evidence

### RED Phase
Perintah:
```bash
pnpm exec vitest run lib/supabase/db.test.ts
```
Output:
```
FAIL unit lib/supabase/db.test.ts [ lib/supabase/db.test.ts ]
Error: Cannot find module '/lib/supabase/db' imported from D:/Coding/lakoku v2/.worktrees/feat-neon-phase-a/lib/supabase/db.test.ts
```

### GREEN Phase
Perintah:
```bash
pnpm exec vitest run lib/supabase/db.test.ts
```
Output:
```
✓ unit lib/supabase/db.test.ts (2 tests) 331ms
  ✓ melempar error jika DATABASE_URL belum diset 3ms
  ✓ menjalankan select sederhana dan singleton per proses 326ms

Test Files  1 passed (1)
Tests       2 passed (2)
```

## Verification Gates Output

### Gate 1: Vitest (`lib/supabase/db.test.ts`)
```bash
pnpm exec vitest run lib/supabase/db.test.ts
```
Status: PASS (2 tests passed in 331ms).

### Gate 2: TypeScript strict check
```bash
pnpm typecheck
```
Output:
```
$ tsc --noEmit --incremental false
```
Status: PASS (0 error).

### Gate 3: ESLint
```bash
pnpm exec eslint lib/supabase/db.ts lib/supabase/db-types.ts lib/supabase/index.ts lib/supabase/db.test.ts scripts/neon-codegen.mjs
```
Status: PASS (0 error, 0 warning).

## Self-Review
- **Completeness:** Singleton `getDb()` mengembalikan instance Kysely yang sama pada pemanggilan berulang; query `select 1` dan `selectFrom('reading_policy')` round-trip sukses ke Neon; error throw saat missing `DATABASE_URL` terverifikasi.
- **Constraints adherence:**
  - `import 'server-only'` di awal `lib/supabase/db.ts`.
  - Kredensial tidak pernah di-hardcode ke kode/repo.
  - Barrel `@lakoku/db` mempertahankan `createAdminClient` untuk fase A auth.
  - Tidak ada `as any`, `@ts-ignore`, atau `@ts-expect-error`.

## Concerns
- Tidak ada. Instance Kysely dan tipe codegen siap digunakan untuk task rewrite berikutnya (Task 6 compat helpers, Task 8-11 repositories).

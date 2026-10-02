# Task 3 Report: `putCover` menulis ke Cloudflare R2

## Implementation
- Added `@aws-sdk/client-s3` dependency to workspace root.
- Replaced Supabase Storage implementation in `lib/cover/storage.ts` with Cloudflare R2 S3-compatible client (`PutObjectCommand`, `S3Client`).
- Changed `putCover` success contract from `{ ok: true, url: string }` to `{ ok: true, key: string }`.
- Removed unused `COVER_BUCKET` export.
- Created `lib/cover/storage.test.ts` covering 3 scenarios: upload and key return, SDK error without throwing, and unconfigured environment.

## TDD Evidence

### RED
Command:
```bash
pnpm exec vitest run lib/cover/storage.test.ts
```
Output:
```
 FAIL  unit  lib/cover/storage.test.ts > putCover > mengunggah ke R2 dan mengembalikan key
Error: createAdminClient: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset.
 FAIL  unit  lib/cover/storage.test.ts > putCover > kegagalan SDK → ok:false dengan detail, tanpa throw
Error: createAdminClient: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset.
 FAIL  unit  lib/cover/storage.test.ts > putCover > env belum diset → ok:false, tidak ada panggilan keluar
Error: createAdminClient: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset.

Test Files  1 failed (1)
     Tests  3 failed (3)
```
Why expected:
The old implementation in `lib/cover/storage.ts` called `createAdminClient()` from Supabase and returned `url`, which fails immediately when Supabase env vars are absent and does not adhere to the R2 contract.

### GREEN
Command:
```bash
pnpm exec vitest run lib/cover/storage.test.ts
```
Output:
```
 ✓  unit  lib/cover/storage.test.ts (3 tests) 4ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  280ms
```

## Files Changed
- `D:\Coding\lakoku v2\.worktrees\feat-r2-cover-storage\package.json`
- `D:\Coding\lakoku v2\.worktrees\feat-r2-cover-storage\pnpm-lock.yaml`
- `D:\Coding\lakoku v2\.worktrees\feat-r2-cover-storage\lib\cover\storage.ts`
- `D:\Coding\lakoku v2\.worktrees\feat-r2-cover-storage\lib\cover\storage.test.ts`

## Commit
- `af8d2f1` `feat(cover): write covers to Cloudflare R2 via S3 API, return object key`

## Self-Review Findings
- Completeness: All 3 tests from the brief present and passing. Env validation paths handled correctly.
- Quality: `cachedClient` singleton pattern used for `S3Client`. Errors caught and returned as `{ ok: false, detail }` without throwing.
- Discipline: Route files (`app/api/stories/[id]/cover/generate/route.ts` and `app/api/stories/[id]/cover/upload/route.ts`) left untouched per instructions for Task 4.
- Testing: Mocks verify `PutObjectCommand` input payload (`Bucket`, `Key`, `ContentType`, `CacheControl`, `Body`).

## Concerns
- As expected and documented in the brief, route files calling `stored.url` are temporarily broken until Task 4 updates their callers.

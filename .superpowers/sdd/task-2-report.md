# Task 2 Report: Modul Email Mailketing & Konfigurasi Server Better Auth

## Execution Summary
Implemented Task 2 of Phase B:
- Authored unit tests for Mailketing API v2 client and bcrypt password hashing/verification.
- Followed TDD: Verified test failure prior to implementation.
- Implemented `lib/email/mailketing.ts` with error handling, environment variable fallback, and `server-only` safeguard.
- Implemented `lib/auth/password.ts` supporting bcrypt password hashing and verification compatible with legacy Supabase bcrypt hashes (`$2a$`, `$2b$`).
- Configured Better Auth server instance in `lib/auth.ts` backed by `pg.Pool` (`process.env.DATABASE_URL`), `bearer()` plugin, referral attribution hook on user creation, password reset & email verification handlers via Mailketing, and conditional Google OAuth provider.
- Configured client instance in `lib/auth-client.ts` using `createAuthClient` from `better-auth/react`.
- Exposed Next.js App Router route handler at `app/api/auth/[...all]/route.ts`.
- Verified 0 type errors across codebase with `pnpm typecheck`.

---

## TDD Evidence

### Step 1 & 2: RED Phase
Authored tests:
- `lib/email/mailketing.test.ts`
- `lib/auth/password.test.ts`

Ran test suite before modules existed:
```bash
pnpm exec vitest run lib/email/mailketing.test.ts lib/auth/password.test.ts
```
Output:
```
FAIL unit lib/auth/password.test.ts
Error: Cannot find module './password' imported from lib/auth/password.test.ts

FAIL unit lib/email/mailketing.test.ts
Error: Cannot find module '/lib/email/mailketing' imported from lib/email/mailketing.test.ts

Test Files: 2 failed (2)
Tests: no tests
```

### Step 3 & 4: GREEN Phase
Implemented `lib/email/mailketing.ts` and `lib/auth/password.ts`.
Ran test suite:
```bash
pnpm exec vitest run lib/email/mailketing.test.ts lib/auth/password.test.ts
```
Output:
```
✓ unit lib/email/mailketing.test.ts (1 test) 5ms
✓ unit lib/auth/password.test.ts (2 tests) 356ms

Test Files: 2 passed (2)
Tests: 3 passed (3)
```

### Step 5 & 6: Integration & Typecheck
Created:
- `lib/auth.ts`: Better Auth instance with database hooks, Mailketing integration, and bearer token support.
- `lib/auth-client.ts`: Client instance with `createAuthClient`.
- `app/api/auth/[...all]/route.ts`: App router handler with `toNextJsHandler(auth)`.

Ran typecheck:
```bash
pnpm typecheck
```
Output:
```
$ tsc --noEmit --incremental false
(Clean, 0 errors)
```

---

## Commit
- SHA: `3bb3e56`
- Message: `feat(auth): Better Auth server configuration with Mailketing email handler and bcrypt verify`
- Files:
  - `app/api/auth/[...all]/route.ts`
  - `lib/auth-client.ts`
  - `lib/auth.ts`
  - `lib/auth/password.test.ts`
  - `lib/auth/password.ts`
  - `lib/email/mailketing.test.ts`
  - `lib/email/mailketing.ts`

---

## Self-Review Findings & Concerns
- None. `lib/auth.ts` handles missing Google OAuth credentials gracefully (`enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)`).
- Referral attribution hook runs fail-safe inside `try/catch` and links users upon creation if `lakoku_ref` cookie is present.

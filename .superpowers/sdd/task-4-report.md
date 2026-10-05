# Task 4 Report: Migrasi Seam Sesi Server & Middleware

**Status:** DONE
**Commit:** 5195e90 feat(auth): migrate getSessionUser, middleware, and logout to Better Auth

## Changes
1. `tests/auth/session-seam.test.ts`:
   - Unit tests for `getSessionUser()` covering valid session, null/expired session, and dead-cookie exception defense.
2. `lib/api/user-state.ts`:
   - Replaced Supabase GoTrue session logic with Better Auth `auth.api.getSession({ headers: await headers() })`.
   - Maintained compatible `User` interface (`id`, `email`, `user_metadata`).
   - Retained Kysely data access functions (`getReaderStates`, `getReaderState`, `getPreviousChoiceId`, `ensureReaderStateStarted`, `applyChoiceToUserState`).
   - Dead cookie defense: exceptions caught and returns `null` safely without crashing RSC.
3. `middleware.ts`:
   - Checks `better-auth.session_token` and `__Secure-better-auth.session_token`.
   - Protects `/beranda`, `/profil`, `/kredit`, `/payment`, `/s/`, redirecting to `/auth/login?next=...`.
   - Auto-redirects logged-in users on `/`, `/auth/login`, `/auth/sign-up` to `/beranda`.
4. `lib/supabase/proxy.ts`:
   - Deleted obsolete Supabase proxy file via `git rm`.
5. `components/logout-button.tsx`:
   - Updated to call `authClient.signOut()` from `@/lib/auth-client`.

## Verification
- `pnpm exec vitest run tests/auth/session-seam.test.ts`: PASS (3/3)
- `pnpm exec vitest run tests/auth/`: PASS (8 files, 42 tests)
- `pnpm typecheck`: PASS (0 errors)

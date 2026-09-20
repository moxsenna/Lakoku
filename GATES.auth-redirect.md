# GATES.auth-redirect.md — Auth Session Persistence & Auto-Redirect Gates

Gates untuk memastikan pengguna yang sudah login otomatis diarahkan ke `/beranda` saat mengakses ulang webapp atau aplikasi Android, tanpa dipaksa melihat landing page atau mengisi ulang form login.

## G1 — Auth Redirect Decision Logic Test

Unit test untuk logika penentuan redirect berbasis sesi:
- Root `/`: User terotentikasi -> redirect `/beranda`; Tamu -> render landing page; `?preview=1` -> render landing page.
- Auth routes (`/auth/login`, `/auth/sign-up`): User terotentikasi -> redirect `next` aman (default `/beranda`); Tamu -> render form.

CHECK: `npx vitest run tests/auth/auth-redirect.test.ts`
EXPECT: Tests: 1 passed

## G2 — Middleware Matcher & Proxy Session Refresh

Middleware matcher mencakup rute `/`, `/auth/login`, `/auth/sign-up`, dan `/cerita/:path*` sehingga refresh token berjalan dan cookie sesi diperbarui saat membuka app.

CHECK: `npx vitest run tests/auth/middleware-matcher.test.ts`
EXPECT: Tests: 1 passed

## G3 — Root Page (`app/page.tsx`) Defense-in-Depth Session Check

RSC `app/page.tsx` memeriksa sesi pengguna: redirect ke `/beranda` jika sudah login (kecuali parameter `preview=1`).

CHECK: `node -e "const s = require('fs').readFileSync('app/page.tsx', 'utf8'); if (s.includes('getSessionUser') && s.includes('/beranda') && s.includes('redirect')) process.exit(0); else process.exit(1);"`
EXPECT: exit 0

## G4 — Login & Sign-up Page Session Check

RSC `app/auth/login/page.tsx` dan `app/auth/sign-up/page.tsx` memeriksa sesi pengguna: redirect ke `next` aman jika sudah login.

CHECK: `node -e "const l = require('fs').readFileSync('app/auth/login/page.tsx', 'utf8'); const su = require('fs').readFileSync('app/auth/sign-up/page.tsx', 'utf8'); if (l.includes('getSessionUser') && su.includes('getSessionUser')) process.exit(0); else process.exit(1);"`
EXPECT: exit 0

## G5 — Typecheck and Regression Suite

Semua tipe TypeScript valid dan test unit lulus tanpa regresi.

CHECK: `pnpm typecheck`
EXPECT: exit 0

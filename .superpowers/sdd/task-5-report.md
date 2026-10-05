# Task 5 Report: Migrasi Antarmuka Pengguna & Formulir Autentikasi (`app/auth/*`)

## Status: DONE

## Implementation Summary
1. **Login (`app/auth/login/login-form.tsx`, `app/auth/login/page.tsx`)**:
   - Supabase `signInWithPassword` digantikan `authClient.signIn.email({ email, password })`.
   - Google OAuth digantikan `authClient.signIn.social({ provider: 'google', callbackURL: next })`.
   - Prop `supabaseConfig` dihapus dari `LoginForm` dan `LoginPage`.
   - Redirect query parameter `next` dipertahankan dan divalidasi via `readSafeNextFromWindow()`.
   - Pesan error reader-safe berbahasa Indonesia dipertahankan (termasuk deteksi unverified email).

2. **Sign-Up (`app/auth/sign-up/sign-up-form.tsx`, `app/auth/sign-up/page.tsx`)**:
   - Supabase `signUp` digantikan `authClient.signUp.email({ email, password, name })`.
   - Google OAuth digantikan `authClient.signIn.social({ provider: 'google', callbackURL: next })`.
   - Prop `supabaseConfig` dihapus dari `SignUpForm` dan `SignUpPage`.
   - Redirect ke `/auth/sign-up-success` untuk notifikasi verifikasi email.

3. **Forgot-Password (`app/auth/forgot-password/forgot-password-form.tsx`, `app/auth/forgot-password/page.tsx`)**:
   - `supabase.auth.resetPasswordForEmail` digantikan `authClient.forgetPassword({ email, redirectTo })`.
   - Di `lib/auth-client.ts`, ditambahkan alias `forgetPassword` yang memanggil `rawAuthClient.requestPasswordReset`.
   - Prop `supabaseConfig` dihapus dari form dan page.

4. **Reset-Password (`app/auth/reset-password/reset-password-form.tsx`, `app/auth/reset-password/page.tsx`)**:
   - Pengambilan token dan error melalui searchParams (`token`, `error`) tanpa session Supabase.
   - Panggilan `authClient.resetPassword({ newPassword, token })` saat submit.
   - Redirect ke `/auth/login?reset=success` saat berhasil.
   - State 'checking', 'ready', dan 'expired' dipertahankan untuk UX yang konsisten.

5. **Pembersihan Dependensi `public-config`**:
   - `app/auth/callback/recovery/route.ts` dihapus via `git rm`.
   - `lib/supabase/public-config.ts` dihapus via `git rm`.
   - `app/mulai/page.tsx` dan `components/mulai/onboarding-flow.tsx` dimigrasikan untuk menghilangkan dependensi ke `getSupabasePublicConfig()` dan `createClient(supabaseConfig)`. `hasSession()` kini membaca sesi lewat `authClient.getSession()`.
   - `scripts/password-recovery-smoke.ts` diperbarui untuk memvalidasi alur pemulihan Better Auth.

## Verification
- `pnpm typecheck`: PASS (0 errors).
- `pnpm smoke:web-release`: PASS (9/9 checks).
- `pnpm smoke:password-recovery`: PASS (11/11 checks).
- `pnpm smoke:contracts`: PASS (16/16 checks).
- `npx vitest run tests/auth`: PASS (17 test files, 116 tests passed).

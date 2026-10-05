### Task 5: Migrasi Antarmuka Pengguna & Formulir Autentikasi (`app/auth/*`)

**Files:**
- Modify: `app/auth/login/login-form.tsx`
- Modify: `app/auth/login/page.tsx`
- Modify: `app/auth/sign-up/sign-up-form.tsx`
- Modify: `app/auth/sign-up/page.tsx`
- Modify: `app/auth/forgot-password/forgot-password-form.tsx`
- Modify: `app/auth/forgot-password/page.tsx`
- Modify: `app/auth/reset-password/reset-password-form.tsx`
- Modify: `app/auth/reset-password/page.tsx`
- Delete: `app/auth/callback/recovery/route.ts`
- Delete: `lib/supabase/public-config.ts`

**Interfaces:**
- Consumes: `authClient` dari `lib/auth-client.ts`.
- Produces: Halaman login, daftar, lupa kata sandi, dan reset kata sandi menggunakan Better Auth client.

- [x] **Step 1: Perbarui formulir Login**

Di `app/auth/login/login-form.tsx`:
- Ganti panggilan `supabase.auth.signInWithPassword` dengan:
  ```ts
  const res = await authClient.signIn.email({
    email,
    password,
  })
  if (res.error) {
    setError('Email atau kata sandi salah. Silakan periksa kembali.')
    setEmailLoading(false)
    return
  }
  ```
- Ganti tombol Google `supabase.auth.signInWithOAuth` dengan:
  ```ts
  await authClient.signIn.social({
    provider: 'google',
    callbackURL: next,
  })
  ```
- Hapus prop `supabaseConfig` dari `LoginForm` dan dari `app/auth/login/page.tsx`.

- [x] **Step 2: Perbarui formulir Sign-Up**

Di `app/auth/sign-up/sign-up-form.tsx`:
- Ganti panggilan `supabase.auth.signUp` dengan:
  ```ts
  const res = await authClient.signUp.email({
    email,
    password,
    name: email.split('@')[0],
  })
  if (res.error) {
    setError(res.error.message || 'Pendaftaran gagal. Coba lagi.')
    return
  }
  ```
- Hapus prop `supabaseConfig` dari `SignUpForm` dan dari `app/auth/sign-up/page.tsx`.

- [x] **Step 3: Perbarui formulir Lupa & Reset Kata Sandi**

- `app/auth/forgot-password/forgot-password-form.tsx`:
  Ganti `supabase.auth.resetPasswordForEmail` dengan:
  ```ts
  await authClient.forgetPassword({
    email,
    redirectTo: `${window.location.origin}/auth/reset-password`,
  })
  ```
- `app/auth/reset-password/reset-password-form.tsx`:
  Ambil `token` dari query string searchParams (`token`), lalu panggil:
  ```ts
  await authClient.resetPassword({
    newPassword: password,
    token,
  })
  ```
- Hapus rute pemulihan usang `app/auth/callback/recovery/route.ts` dan modul `lib/supabase/public-config.ts`.

- [x] **Step 4: Typecheck dan smoke release**

Run: `pnpm typecheck && pnpm smoke:web-release`
Expected: PASS (0 error).

- [x] **Step 5: Commit**

```bash
git add app/auth/
git rm app/auth/callback/recovery/route.ts lib/supabase/public-config.ts
git commit -m "feat(auth): migrate auth UI forms to Better Auth client"
```

---


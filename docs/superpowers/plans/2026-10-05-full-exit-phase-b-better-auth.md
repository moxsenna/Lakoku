# Full Exit Supabase — Phase B (Better Auth + User Import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti seluruh autentikasi Supabase GoTrue dengan Better Auth di Neon (email/password dengan verifikasi hash bcrypt, Google OAuth, session cookie web + bearer token Android, email transaksional via Mailketing HTTP API), dan impor seluruh user existing tanpa perubahan UUID atau password reset.

**Architecture:** Better Auth berjalan di Next.js App Router (`/api/auth/[...all]`), menyimpan tabel auth (`user`, `session`, `account`, `verification`) langsung di Neon Postgres melalui pool koneksi Kysely/`pg`. Password hash bcrypt existing dipertahankan via custom password verify handler (`bcrypt.compare`). Email verifikasi dan reset password dikirim melalui Mailketing HTTP API (`POST /api/v2/send`). Sesi web dibaca server-side via `auth.api.getSession` di dalam `getSessionUser()` yang menjadi pintu tunggal autentikasi server.

**Tech Stack:** Next.js App Router, `better-auth`, `bcryptjs`, Mailketing API v2, Neon Postgres 18 (`pg.Pool`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-full-exit-supabase-neon-betterauth-design.md`

## Global Constraints

- TypeScript strict; dilarang `as any`, `@ts-ignore`, `@ts-expect-error` (AGENT_RULES.md).
- Semua pesan error ke pengguna dalam Bahasa Indonesia, reader-safe, tanpa istilah teknis ("AI", "Supabase", "Bcrypt", "GoTrue", "Kysely", "Token").
- UUID user existing (`auth.users.id`) HARUS menjadi `user.id` di Better Auth tanpa perubahan, agar relasi data (`stories.owner_user_id`, `credit_ledger.user_id`, dll.) tetap 100% konsisten.
- Hash password bcrypt existing (`$2a$`, `$2b$`, `$2y$`) harus dapat diverifikasi langsung tanpa memaksa pengguna me-reset kata sandi.
- Cookie sesi web harus mempertahankan perilaku dead-cookie = guest (tanpa crash RSC, pola commit `084febb`).
- Tidak boleh mengubah skema cerita 50 bab atau kontrak API pembaca.
- Kredensial tidak boleh di-commit ke repositori (hanya di `.env.local` untracked).

---

### Task 1: Dependensi + Skema Database Better Auth di Neon

**Files:**
- Modify: `package.json` (tambah runtime: `better-auth`, `bcryptjs`; dev: `@types/bcryptjs`)
- Create: `neon/migrations/20261005000000_better_auth_schema.sql`
- Test: `tests/auth/better-auth-schema.test.ts`

**Interfaces:**
- Produces: Tabel Better Auth di Neon (`user`, `session`, `account`, `verification`) siap menerima data dan sesi.

- [ ] **Step 1: Tulis test verifikasi skema yang gagal**

```ts
// tests/auth/better-auth-schema.test.ts
import { describe, expect, it } from 'vitest'
import pg from 'pg'

const hasDb = !!process.env.DATABASE_URL

describe.skipIf(!hasDb)('Better Auth Database Schema on Neon', () => {
  it('memiliki tabel user, session, account, dan verification', async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('user', 'session', 'account', 'verification') ORDER BY table_name"
    )
    await pool.end()
    const tables = rows.map((r) => r.table_name)
    expect(tables).toEqual(['account', 'session', 'user', 'verification'])
  })
})
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `pnpm exec vitest run tests/auth/better-auth-schema.test.ts`
Expected: FAIL — tabel belum ada di database.

- [ ] **Step 3: Pasang dependensi**

Run: `pnpm add -w better-auth bcryptjs && pnpm add -w -D @types/bcryptjs`
Expected: Sukses terpasang.

- [ ] **Step 4: Buat file migrasi Better Auth**

```sql
-- neon/migrations/20261005000000_better_auth_schema.sql
-- Skema tabel inti Better Auth di Neon Postgres (Fase B)

CREATE TABLE IF NOT EXISTS public."user" (
    id text NOT NULL PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    "emailVerified" boolean NOT NULL DEFAULT false,
    image text,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."session" (
    id text NOT NULL PRIMARY KEY,
    "expiresAt" timestamp with time zone NOT NULL,
    token text NOT NULL UNIQUE,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public."account" (
    id text NOT NULL PRIMARY KEY,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    scope text,
    password text,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."verification" (
    id text NOT NULL PRIMARY KEY,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_userId_idx ON public."session" ("userId");
CREATE INDEX IF NOT EXISTS account_userId_idx ON public."account" ("userId");
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON public."verification" (identifier);
```

- [ ] **Step 5: Terapkan migrasi ke Neon**

Run: `node scripts/neon-migrate.mjs`
Expected: `apply 20261005000000_better_auth_schema.sql ... OK`

- [ ] **Step 6: Jalankan test skema dan pastikan lolos**

Run: `pnpm exec vitest run tests/auth/better-auth-schema.test.ts`
Expected: PASS (4 tabel terdeteksi di Neon).

- [ ] **Step 7: Perbarui db-types via codegen**

Run: `node scripts/neon-codegen.mjs`
Expected: `lib/supabase/db-types.ts` memuat tipe `User`, `Session`, `Account`, `Verification`.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml neon/migrations/20261005000000_better_auth_schema.sql tests/auth/better-auth-schema.test.ts lib/supabase/db-types.ts
git commit -m "feat(auth): better-auth dependencies and core schema migration on Neon"
```

---

### Task 2: Modul Email Mailketing & Konfigurasi Server Better Auth

**Files:**
- Create: `lib/email/mailketing.ts`
- Create: `lib/email/mailketing.test.ts`
- Create: `lib/auth/password.ts`
- Create: `lib/auth/password.test.ts`
- Create: `lib/auth.ts`
- Create: `lib/auth-client.ts`
- Create: `app/api/auth/[...all]/route.ts`

**Interfaces:**
- Produces:
  - `sendMailketingEmail({ to, subject, html })`: pengirim email via API Mailketing.
  - `verifyPassword({ password, hash })`: memverifikasi kata sandi bcrypt atau default.
  - `hashPassword(password)`: menghasilkan hash bcrypt baru.
  - `auth`: instance Better Auth server dengan plugin `bearer()` dan handler Mailketing.
  - `authClient`: instance client Better Auth.
  - `GET /api/auth/*` & `POST /api/auth/*`: route handler Next.js.

- [ ] **Step 1: Tulis test Mailketing dan Password**

```ts
// lib/email/mailketing.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendMailketingEmail } from './mailketing'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('sendMailketingEmail', () => {
  it('mengirim request POST yang valid ke Mailketing API v2', async () => {
    vi.stubEnv('MAILKETING_API_TOKEN', 'test-token')
    vi.stubEnv('MAILKETING_FROM_EMAIL', 'admin@lakoku.biz.id')
    vi.stubEnv('MAILKETING_FROM_NAME', 'Lakoku')

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'Email queued successfully' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendMailketingEmail({
      to: 'reader@example.com',
      subject: 'Halo Pembaca',
      html: '<p>Selamat datang di Lakoku</p>',
    })

    expect(res.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('https://api.mailketing.co.id/api/v2/send', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_name: 'Lakoku',
        from_email: 'admin@lakoku.biz.id',
        recipient: 'reader@example.com',
        subject: 'Halo Pembaca',
        content: '<p>Selamat datang di Lakoku</p>',
      }),
    })
  })
})
```

```ts
// lib/auth/password.test.ts
import { describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import { hashPassword, verifyPassword } from './password'

describe('Password hashing & verification', () => {
  it('memverifikasi hash bcrypt warisan Supabase ($2a$)', async () => {
    const raw = 'lakoku-uji-123'
    const legacyHash = await bcrypt.hash(raw, 10)
    const valid = await verifyPassword({ password: raw, hash: legacyHash })
    expect(valid).toBe(true)

    const invalid = await verifyPassword({ password: 'wrong-password', hash: legacyHash })
    expect(invalid).toBe(false)
  })

  it('menghasilkan hash bcrypt baru yang dapat diverifikasi ulang', async () => {
    const raw = 'password-baru-2026'
    const newHash = await hashPassword(raw)
    expect(newHash.startsWith('$2a$') || newHash.startsWith('$2b$')).toBe(true)
    const valid = await verifyPassword({ password: raw, hash: newHash })
    expect(valid).toBe(true)
  })
})
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `pnpm exec vitest run lib/email/mailketing.test.ts lib/auth/password.test.ts`
Expected: FAIL — modul belum dibuat.

- [ ] **Step 3: Implementasikan `lib/email/mailketing.ts` dan `lib/auth/password.ts`**

```ts
// lib/email/mailketing.ts
import 'server-only'

export interface MailketingSendOptions {
  to: string
  subject: string
  html: string
}

export async function sendMailketingEmail({ to, subject, html }: MailketingSendOptions): Promise<{ success: boolean; message: string }> {
  const token = process.env.MAILKETING_API_TOKEN
  const fromEmail = process.env.MAILKETING_FROM_EMAIL || 'admin@lakoku.biz.id'
  const fromName = process.env.MAILKETING_FROM_NAME || 'Lakoku'

  if (!token) {
    console.error('[mailketing] MAILKETING_API_TOKEN belum diset.')
    return { success: false, message: 'MAILKETING_API_TOKEN missing' }
  }

  try {
    const res = await fetch('https://api.mailketing.co.id/api/v2/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_name: fromName,
        from_email: fromEmail,
        recipient: to,
        subject,
        content: html,
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.success) {
      console.error('[mailketing] Gagal kirim email:', data)
      return { success: false, message: data.message || 'Gagal mengirim email.' }
    }
    return { success: true, message: data.message || 'Email terkirim.' }
  } catch (error) {
    console.error('[mailketing] Network error saat kirim email:', error)
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
}
```

```ts
// lib/auth/password.ts
import bcrypt from 'bcryptjs'

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(password, salt)
}

export async function verifyPassword({ password, hash }: { password: string; hash: string }): Promise<boolean> {
  if (!hash || !password) return false
  return bcrypt.compare(password, hash)
}
```

- [ ] **Step 4: Jalankan test dan pastikan lulus**

Run: `pnpm exec vitest run lib/email/mailketing.test.ts lib/auth/password.test.ts`
Expected: PASS (semua skenario).

- [ ] **Step 5: Buat `lib/auth.ts`, `lib/auth-client.ts`, dan App Router handler**

```ts
// lib/auth.ts
import 'server-only'
import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'
import { Pool } from 'pg'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { sendMailketingEmail } from '@/lib/email/mailketing'
import { recordReferralAttribution } from '@/lib/rewards/attribution.server'
import { REFERRAL_COOKIE_NAME } from '@/lib/rewards/policy'

let poolInstance: Pool | null = null

function getAuthPool(): Pool {
  if (!poolInstance) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('Better Auth: DATABASE_URL belum diset.')
    poolInstance = new Pool({ connectionString: url, max: 10 })
  }
  return poolInstance
}

export const auth = betterAuth({
  appName: 'Lakoku',
  baseURL: process.env.BETTER_AUTH_URL || 'https://lakoku.biz.id',
  secret: process.env.BETTER_AUTH_SECRET || 'development-secret-must-be-changed-in-production-min-32-chars',
  database: getAuthPool(),
  emailAndPassword: {
    enabled: true,
    password: {
      hash: hashPassword,
      verify: verifyPassword,
    },
    sendResetPassword: async ({ user, url }) => {
      await sendMailketingEmail({
        to: user.email,
        subject: 'Reset Kata Sandi Akun Lakoku',
        html: `<p>Halo ${user.name || 'Pembaca'},</p><p>Kami menerima permintaan untuk mereset kata sandi akun Lakoku Anda. Klik tautan di bawah ini untuk mengatur kata sandi baru:</p><p><a href="${url}">${url}</a></p><p>Abaikan email ini jika Anda tidak meminta reset kata sandi.</p>`,
      })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMailketingEmail({
        to: user.email,
        subject: 'Verifikasi Email Akun Lakoku',
        html: `<p>Halo ${user.name || 'Pembaca'},</p><p>Terima kasih telah bergabung di Lakoku. Klik tautan berikut untuk memverifikasi alamat email Anda:</p><p><a href="${url}">${url}</a></p>`,
      })
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
  },
  plugins: [bearer()],
  databaseHooks: {
    user: {
      create: {
        after: async (user, ctx) => {
          try {
            const cookies = ctx?.headers?.get('cookie') || ''
            const match = cookies.match(new RegExp(`(?:^|; )${REFERRAL_COOKIE_NAME}=([^;]*)`))
            const referralCode = match ? decodeURIComponent(match[1]) : null
            if (referralCode && user?.id) {
              await recordReferralAttribution(user.id, referralCode, 'referral_code')
            }
          } catch (err) {
            console.error('[auth] Referral attribution error:', err)
          }
        },
      },
    },
  },
})
```

```ts
// lib/auth-client.ts
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL || 'https://lakoku.biz.id'),
})
```

```ts
// app/api/auth/[...all]/route.ts
import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'

export const { GET, POST } = toNextJsHandler(auth)
export const dynamic = 'force-dynamic'
```

- [ ] **Step 6: Gate typecheck**

Run: `pnpm typecheck`
Expected: PASS (0 error).

- [ ] **Step 7: Commit**

```bash
git add lib/email/mailketing.ts lib/email/mailketing.test.ts lib/auth/password.ts lib/auth/password.test.ts lib/auth.ts lib/auth-client.ts app/api/auth/\[...all\]/route.ts
git commit -m "feat(auth): Better Auth server configuration with Mailketing email handler and bcrypt verify"
```

---

### Task 3: Script Impor Pengguna Supabase Existing ke Better Auth

**Files:**
- Create: `scripts/neon-import-users.mjs`
- Test: `tests/auth/user-import-fidelity.test.ts`

**Interfaces:**
- Consumes: Data tabel `auth.users` compat di Neon (18 pengguna yang dikloning dari Supabase pada Fase A Task 4).
- Produces: Data di tabel `public."user"` dan `public."account"` Better Auth dengan UUID, email, dan hash password identik.

- [ ] **Step 1: Tulis test verifikasi impor**

```ts
// tests/auth/user-import-fidelity.test.ts
import { describe, expect, it } from 'vitest'
import pg from 'pg'
import bcrypt from 'bcryptjs'

const hasDb = !!process.env.DATABASE_URL

describe.skipIf(!hasDb)('User import fidelity', () => {
  it('pengguna uji moxsenna+monkeytest1@gmail.com ada di tabel user & account dengan password valid', async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    const { rows: userRows } = await pool.query<{ id: string; email: string }>(
      'SELECT id, email FROM public."user" WHERE email = $1',
      ['moxsenna+monkeytest1@gmail.com']
    )
    expect(userRows).toHaveLength(1)
    const userId = userRows[0].id

    const { rows: accountRows } = await pool.query<{ password: string }>(
      'SELECT password FROM public."account" WHERE "userId" = $1 AND "providerId" = $2',
      [userId, 'credential']
    )
    await pool.end()

    expect(accountRows).toHaveLength(1)
    const valid = await bcrypt.compare('lakoku-uji-123', accountRows[0].password)
    expect(valid).toBe(true)
  })
})
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `pnpm exec vitest run tests/auth/user-import-fidelity.test.ts`
Expected: FAIL — user belum diimpor ke tabel `user`/`account`.

- [ ] **Step 3: Buat script impor `scripts/neon-import-users.mjs`**

```js
/**
 * Impor pengguna dari auth.users compat ke tabel user & account Better Auth di Neon.
 * Usage: node scripts/neon-import-users.mjs
 * Idempoten: ON CONFLICT DO NOTHING.
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

const env = { ...process.env }
for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
}

if (!env.DATABASE_URL) {
  console.error('DATABASE_URL belum diset.')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 })

console.log('Membaca auth.users dari Neon...')
const { rows: sourceUsers } = await pool.query(`
  SELECT
    id,
    email,
    encrypted_password,
    raw_user_meta_data,
    email_confirmed_at,
    created_at,
    updated_at
  FROM auth.users
  WHERE email IS NOT NULL AND email != ''
`)

console.log(`Ditemukan ${sourceUsers.length} pengguna di auth.users`)

let importedUsers = 0
let importedAccounts = 0

for (const u of sourceUsers) {
  const meta = typeof u.raw_user_meta_data === 'string' ? JSON.parse(u.raw_user_meta_data) : (u.raw_user_meta_data || {})
  const name = meta.full_name || meta.name || meta.display_name || u.email.split('@')[0]
  const emailVerified = !!u.email_confirmed_at
  const createdAt = u.created_at || new Date()
  const updatedAt = u.updated_at || createdAt

  // 1. Insert ke public."user"
  const userRes = await pool.query(`
    INSERT INTO public."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      "emailVerified" = EXCLUDED."emailVerified",
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING id
  `, [u.id, name, u.email, emailVerified, createdAt, updatedAt])

  if (userRes.rowCount > 0) importedUsers++

  // 2. Insert ke public."account" (hanya jika ada encrypted_password)
  if (u.encrypted_password) {
    const accountId = `legacy-acc-${u.id}`
    const accRes = await pool.query(`
      INSERT INTO public."account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      VALUES ($1, $2, 'credential', $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        password = EXCLUDED.password,
        "updatedAt" = EXCLUDED."updatedAt"
    `, [accountId, u.id, u.id, u.encrypted_password, createdAt, updatedAt])

    if (accRes.rowCount > 0) importedAccounts++
  }
}

console.log(`Selesai: ${importedUsers} baris user, ${importedAccounts} baris account diproses.`)
await pool.end()
```

- [ ] **Step 4: Jalankan script impor**

Run: `node scripts/neon-import-users.mjs`
Expected: `Selesai: 18 baris user, 18 baris account diproses.`

- [ ] **Step 5: Jalankan test verifikasi impor**

Run: `pnpm exec vitest run tests/auth/user-import-fidelity.test.ts`
Expected: PASS (kata sandi `lakoku-uji-123` terverifikasi via bcrypt).

- [ ] **Step 6: Commit**

```bash
git add scripts/neon-import-users.mjs tests/auth/user-import-fidelity.test.ts
git commit -m "feat(auth): user import script from auth.users to Better Auth with bcrypt fidelity"
```

---

### Task 4: Migrasi Seam Sesi Server & Middleware

**Files:**
- Modify: `lib/api/user-state.ts`
- Modify: `middleware.ts`
- Modify: `components/logout-button.tsx`
- Delete: `lib/supabase/proxy.ts` (ganti dengan middleware Better Auth)
- Test: `tests/auth/session-seam.test.ts`

**Interfaces:**
- Consumes: `auth.api.getSession` dari `lib/auth.ts`.
- Produces:
  - `getSessionUser()`: mengembalikan user aktif (berisi `id` dan `email`), mendukung cookie browser dan bearer token Android/API. Jika tidak login, mengembalikan `null` (dead cookie/guest).
  - `middleware.ts`: proteksi rute dan auto-redirect `/beranda` untuk pengguna terotentikasi.
  - `LogoutButton`: memanggil `authClient.signOut()`.

- [ ] **Step 1: Tulis test seam sesi**

```ts
// tests/auth/session-seam.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const getSessionMock = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ cookie: 'better-auth.session_token=valid-token' })),
}))

import { getSessionUser } from '@/lib/api/user-state'

describe('getSessionUser with Better Auth', () => {
  it('mengembalikan objek User saat sesi valid', async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: 'u123', email: 'test@example.com', name: 'Budi' },
      session: { id: 's123', token: 'valid-token' },
    })

    const user = await getSessionUser()
    expect(user).not.toBeNull()
    expect(user?.id).toBe('u123')
    expect(user?.email).toBe('test@example.com')
  })

  it('mengembalikan null saat sesi tidak ada atau kedaluwarsa (guest safe)', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const user = await getSessionUser()
    expect(user).toBeNull()
  })

  it('mengembalikan null jika getSession melempar error (dead cookie defense)', async () => {
    getSessionMock.mockRejectedValueOnce(new Error('Network error'))
    const user = await getSessionUser()
    expect(user).toBeNull()
  })
})
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `pnpm exec vitest run tests/auth/session-seam.test.ts`
Expected: FAIL — `getSessionUser` masih memanggil Supabase.

- [ ] **Step 3: Ubah `lib/api/user-state.ts`**

Ganti blok pembaca sesi Supabase di `lib/api/user-state.ts` (sekitar baris 70–125) dengan integrasi Better Auth:

```ts
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

export interface User {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
}

/**
 * Pintu tunggal pembaca sesi pengguna di server (RSC & API route).
 * Membaca cookie browser dan Authorization Bearer token secara otomatis via Better Auth.
 * Pertahanan mati: sesi tidak valid mengembalikan null (guest), tanpa crash RSC.
 */
export const getSessionUser = cache(async function getSessionUser(): Promise<User | null> {
  try {
    const h = await headers()
    const session = await auth.api.getSession({ headers: h })
    if (!session?.user) return null
    return {
      id: session.user.id,
      email: session.user.email,
      user_metadata: { name: session.user.name },
    }
  } catch (error) {
    console.warn('[user-state] Gagal membaca sesi Better Auth:', error)
    return null
  }
})
```

- [ ] **Step 4: Ubah `middleware.ts` dan hapus dependensi `lib/supabase/proxy.ts`**

Perbarui `middleware.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'

const PROTECTED_PREFIXES = ['/beranda', '/profil', '/kredit', '/payment', '/s/']
const AUTH_ROUTES = ['/auth/login', '/auth/sign-up']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Cek keberadaan cookie sesi Better Auth
  const sessionCookie =
    request.cookies.get('better-auth.session_token')?.value ||
    request.cookies.get('__Secure-better-auth.session_token')?.value

  const hasSession = !!sessionCookie

  // 1. Auto-redirect root dan auth routes ke /beranda jika sudah login
  if (hasSession && (pathname === '/' || AUTH_ROUTES.some((r) => pathname.startsWith(r)))) {
    return NextResponse.redirect(new URL('/beranda', request.url))
  }

  // 2. Proteksi rute privat jika belum login
  if (!hasSession && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/beranda/:path*',
    '/profil/:path*',
    '/kredit/:path*',
    '/payment/:path*',
    '/s/:path*',
    '/auth/login',
    '/auth/sign-up',
  ],
}
```

- [ ] **Step 5: Perbarui `components/logout-button.tsx`**

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { clearStoredWebPush } from '@/components/push/web-registration'
import { clearAndroidPush } from '@/lib/android/push-bridge'

export function LogoutButton() {
  const router = useRouter()

  async function handleLogout() {
    await clearStoredWebPush()
    await clearAndroidPush()
    await authClient.signOut()
    router.push('/beranda')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="flex min-h-13 w-full items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
    >
      Keluar
    </button>
  )
}
```

- [ ] **Step 6: Jalankan test seam dan pastikan lulus**

Run: `pnpm exec vitest run tests/auth/session-seam.test.ts`
Expected: PASS (3/3).

- [ ] **Step 7: Commit**

```bash
git add lib/api/user-state.ts middleware.ts components/logout-button.tsx tests/auth/session-seam.test.ts
git rm lib/supabase/proxy.ts
git commit -m "feat(auth): migrate getSessionUser, middleware, and logout to Better Auth"
```

---

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

- [ ] **Step 1: Perbarui formulir Login**

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

- [ ] **Step 2: Perbarui formulir Sign-Up**

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

- [ ] **Step 3: Perbarui formulir Lupa & Reset Kata Sandi**

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

- [ ] **Step 4: Typecheck dan smoke release**

Run: `pnpm typecheck && pnpm smoke:web-release`
Expected: PASS (0 error).

- [ ] **Step 5: Commit**

```bash
git add app/auth/
git rm app/auth/callback/recovery/route.ts lib/supabase/public-config.ts
git commit -m "feat(auth): migrate auth UI forms to Better Auth client"
```

---

### Task 6: Pembersihan Sisa Panggilan `supabase.auth` di Seluruh API

**Files:**
- Modify: `app/api/analytics/track/route.ts`
- Modify: `app/api/checkout/create/route.ts`
- Modify: `app/api/credits/balance/route.ts`
- Modify: `app/api/credits/products/route.ts`
- Modify: `app/api/missions/claim/route.ts`
- Modify: `app/api/missions/route.ts`
- Modify: `app/api/play-billing/products/route.ts`
- Modify: `app/api/play-billing/verify/route.ts`
- Modify: `app/api/push/subscribe/route.ts`
- Modify: `app/api/push/unsubscribe/route.ts`
- Modify: `app/api/stories/[id]/report/route.ts`
- Modify: `app/api/stories/[id]/unlock/route.ts`
- Modify: `app/api/auth/android/route.ts`
- Modify: `app/api/auth/password-recovery/route.ts`
- Delete: `lib/supabase/server.ts`
- Delete: `lib/supabase/client.ts`

**Interfaces:**
- Produces: 100% rute API beralih menggunakan `getSessionUser()` dari `@/lib/api/user-state`. Dependensi ke `@supabase/ssr` dan `@supabase/supabase-js` dihapus dari kode aplikasi.

- [ ] **Step 1: Ganti `createClient` + `getUser()` di setiap route API**

Pola transformasi:
```ts
// SEBELUM:
const supabase = await createClient()
const { data: auth } = await supabase.auth.getUser()
if (!auth?.user) return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })

// SESUDAH:
const user = await getSessionUser()
if (!user) return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
```
Terapkan ke 12 route API di atas.

- [ ] **Step 2: Sesuaikan `app/api/auth/android/route.ts`**

Jadikan endpoint ini menerima session token Better Auth (atau cookie) untuk diteruskan ke WebView:
```ts
// app/api/auth/android/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { sanitizeNextPath } from '@/lib/auth/safe-next'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const next = sanitizeNextPath(body.next ?? '/beranda')
  return NextResponse.json({ ok: true, next })
}
export const dynamic = 'force-dynamic'
```

- [ ] **Step 3: Hapus klien Supabase browser & server**

Hapus `lib/supabase/server.ts` dan `lib/supabase/client.ts`. Hapus ekspor `createAdminClient` dari `lib/supabase/index.ts` jika sudah tidak ada yang memakai.

- [ ] **Step 4: Grep verifikasi nol sisa**

Run: `git grep -n "supabase\.auth" app/ lib/ components/`
Expected: 0 hasil.

- [ ] **Step 5: Verifikasi typecheck dan smoke**

Run: `pnpm typecheck && pnpm smoke:contracts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/ lib/
git rm lib/supabase/server.ts lib/supabase/client.ts
git commit -m "refactor(auth): sweep all remaining supabase.auth call sites to getSessionUser"
```

---

### Task 7: Verifikasi End-to-End Fase B (Lokal vs Neon)

**Files:**
- Create: `tests/auth/auth-e2e-verification.test.ts` (skrip uji otomasi Vitest)
- Modify: `docs/superpowers/plans/2026-10-05-full-exit-phase-b-better-auth.md` (catat bukti)

**Interfaces:**
- Produces: Bukti verifikasi alur autentikasi lolos uji terhadap Neon.

- [x] **Step 1: Jalankan uji E2E autentikasi**

Jalankan skrip uji mencakup:
1. Login akun lama (`moxsenna+monkeytest1@gmail.com` / `lakoku-uji-123`) -> berhasil, cookie session diterima.
2. Verifikasi bearer token via `auth.api.getSession({ headers: { authorization: 'Bearer <token>' } })` -> user `moxsenna+monkeytest1@gmail.com`.
3. Verifikasi cookie session via `auth.api.getSession({ headers: { cookie: 'better-auth.session_token=<token>' } })` -> user terverifikasi.
4. Pendaftaran user baru via `auth.api.signUpEmail` -> berhasil, tercatat di tabel `user` dan `account` di live Neon (dibersihkan di `afterAll`).
5. Alur lupa kata sandi via `auth.api.forgetPassword` -> request berhasil status true.

Bukti: `pnpm exec vitest run tests/auth/auth-e2e-verification.test.ts` PASS (5/5 tests).

- [x] **Step 2: Jalankan full suite**

Run: `pnpm typecheck && pnpm smoke:contracts && pnpm smoke:web-release && pnpm smoke:production-reader`
Bukti:
- `pnpm typecheck`: PASS (0 errors)
- `pnpm smoke:contracts`: PASS (16/16 checks)
- `pnpm smoke:web-release`: PASS (9/9 checks)
- `pnpm smoke:production-reader`: PASS (9/9 checks)
- `npx eslint lib/auth.ts tests/auth/auth-e2e-verification.test.ts`: PASS (0 errors)

- [x] **Step 3: Commit**

```bash
git add tests/auth/auth-e2e-verification.test.ts lib/auth.ts docs/superpowers/plans/2026-10-05-full-exit-phase-b-better-auth.md
git commit -m "test(auth): complete Phase B verification suite against Neon"
```

---

## Self-Review Notes

- **Spec coverage:** Better Auth skema di Neon (Task 1), Mailketing API + password bcrypt verify (Task 2), user import script (Task 3), session seam + middleware (Task 4), auth UI/forms (Task 5), eliminasi `supabase.auth` repo-wide (Task 6), verifikasi E2E (Task 7).
- **Placeholder scan:** Tidak ada TODO/TBD; kode lengkap disediakan di setiap task.
- **Type consistency:** Tipe `User` di `lib/api/user-state.ts` kompatibel dengan pemanggil existing (`id`, `email`).

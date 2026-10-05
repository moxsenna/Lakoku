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


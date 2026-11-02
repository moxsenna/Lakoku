import 'server-only'
import { randomUUID } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'
import { Pool } from 'pg'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { sendMailketingEmail } from '@/lib/email/mailketing'
import {
  renderPasswordResetEmailHtml,
  renderVerificationEmailHtml,
} from '@/lib/email/templates'
import { recordReferralAttribution } from '@/lib/rewards/attribution.server'
import { REFERRAL_COOKIE_NAME } from '@/lib/rewards/policy'
import {
  ACQUISITION_COOKIE_NAME,
  parseAcquisitionCookie,
} from '@/lib/acquisition/policy'
import { recordAcquisition } from '@/lib/acquisition/record.server'

let poolInstance: Pool | null = null

function getAuthPool(): Pool {
  if (!poolInstance) {
    const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dummy'
    poolInstance = new Pool({ connectionString: url, max: 10 })
  }
  return poolInstance
}

const baseAuth = betterAuth({
  appName: 'Lakoku',
  baseURL: process.env.BETTER_AUTH_URL || 'https://lakoku.biz.id',
  secret: process.env.BETTER_AUTH_SECRET || (() => {
    if (process.env.NODE_ENV === 'production' && !process.env.BETTER_AUTH_SECRET) {
      throw new Error('Fatal: BETTER_AUTH_SECRET wajib diset di produksi.')
    }
    return 'development-secret-must-be-changed-in-production-min-32-chars'
  })(),
  database: getAuthPool(),
  trustedOrigins:
    process.env.NODE_ENV !== 'production'
      ? ['http://localhost:3000', 'http://localhost:3100', 'http://localhost:5200']
      : ['https://lakoku.biz.id', 'https://app.lakoku.biz.id'],
  emailAndPassword: {
    enabled: true,
    password: {
      hash: hashPassword,
      verify: verifyPassword,
    },
    sendResetPassword: async ({ user, url }) => {
      await sendMailketingEmail({
        to: user.email,
        subject: 'Atur Ulang Kata Sandi Akun Lakoku',
        html: renderPasswordResetEmailHtml(user.name ?? undefined, url),
      })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMailketingEmail({
        to: user.email,
        subject: 'Verifikasi Email Akun Lakoku',
        html: renderVerificationEmailHtml(user.name ?? undefined, url),
      })
    },
  },
  user: {
    // Ubah email: email baru baru aktif setelah tautan verifikasi diklik.
    // Email verifikasi terkirim lewat callback di atas (template branding).
    changeEmail: {
      enabled: true,
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
  },
  advanced: {
    database: {
      // Seluruh skema domain (reader_states, ledger, referral, dsb.) memakai
      // user_id uuid — ID default Better Auth (32 char) ditolak Postgres.
      // Fungsi kustom: UUID dibuat di sisi JS. ("uuid" literal tidak dipakai
      // karena adapter Postgres lalu menyerahkan generate ke default kolom,
      // yang tidak ada di tabel auth bertipe text.)
      generateId: () => randomUUID(),
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
            // Capture akuisisi (OQ1=A): TEPAT SATU baris per signup — cookie
            // hilang/rusak tetap menulis 'direct', bukan melewatkan baris (G1).
            if (user?.id) {
              const acqMatch = cookies.match(
                new RegExp(`(?:^|; )${ACQUISITION_COOKIE_NAME}=([^;]*)`),
              )
              const parsed = acqMatch
                ? parseAcquisitionCookie(decodeURIComponent(acqMatch[1]))
                : null
              await recordAcquisition(user.id, parsed)
            }
          } catch (err) {
            console.error('[auth] Referral attribution error:', err)
          }
        },
      },
    },
  },
})

type GetSessionOptions = Parameters<typeof baseAuth.api.getSession>[0]

const originalGetSession = baseAuth.api.getSession

const getSessionWithFallback = async (options?: GetSessionOptions) => {
  const result = await originalGetSession(options)
  if (result?.user) return result

  try {
    const rawHeaders = options && 'headers' in options ? options.headers : undefined
    const h = rawHeaders instanceof Headers
      ? rawHeaders
      : rawHeaders
        ? new Headers(rawHeaders)
        : null

    if (h) {
      const cookieHeader = h.get('cookie')
      if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/)
        if (match) {
          const rawToken = decodeURIComponent(match[1]).split('.')[0]
          const fallbackHeaders = new Headers(h)
          fallbackHeaders.set('authorization', `Bearer ${rawToken}`)
          const fallbackResult = await originalGetSession({
            ...options,
            headers: fallbackHeaders,
          })
          if (fallbackResult?.user) return fallbackResult
        }
      }
    }
  } catch {
    // Non-critical fallback
  }

  return result
}

export const auth = Object.assign(baseAuth, {
  api: Object.assign(baseAuth.api, {
    getSession: getSessionWithFallback,
    forgetPassword: baseAuth.api.requestPasswordReset,
  }),
})

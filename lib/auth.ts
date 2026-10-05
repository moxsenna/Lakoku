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
    const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dummy'
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

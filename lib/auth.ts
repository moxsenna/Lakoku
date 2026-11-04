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
    // Fail-closed di produksi (audit M15); fallback dummy hanya untuk runner test unit
    // agar import lib/auth tidak crash saat env database tidak disuntik.
    const url = process.env.DATABASE_URL
    if (process.env.NODE_ENV === 'production' && !url) {
      throw new Error('Fatal: DATABASE_URL wajib diset di produksi untuk getAuthPool.')
    }
    poolInstance = new Pool({
      connectionString: url || 'postgresql://postgres:postgres@localhost:5432/dummy',
      max: 10,
    })
    // Neon pooler rutin memutus koneksi idle. Tanpa handler ini event 'error'
    // pada idle client menjadi uncaughtException dan mematikan proses web —
    // mitigasi yang sama sudah dipasang di lib/db/db.ts.
    poolInstance.on('error', (err) => {
      console.warn('[auth-pool] Idle client error caught:', err.message)
    })
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
    // Wajib verifikasi email sebelum bisa masuk (audit M2): signup mengirim
    // tautan verifikasi; sign-in akun belum verifikasi ditolak dengan kode
    // EMAIL_NOT_VERIFIED (ditangani LoginForm). Efek samping baik: respons
    // email-duplikat saat signup menjadi generik (anti user-enumeration).
    requireEmailVerification: true,
    password: {
      hash: hashPassword,
      verify: verifyPassword,
    },
    sendResetPassword: async ({ user, url }) => {
      // Gagal kirim harus terasa (audit M11): respons sukses-butuh-email-hilang
      // membuat pemulihan akun menyesatkan. Lempar agar Better Auth balas error.
      const res = await sendMailketingEmail({
        to: user.email,
        subject: 'Atur Ulang Kata Sandi Akun Lakoku',
        html: renderPasswordResetEmailHtml(user.name ?? undefined, url),
      })
      if (!res.success) throw new Error(`sendResetPassword: ${res.message}`)
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    // Coba masuk dengan email belum verifikasi = kirim ulang tautan verifikasi,
    // jadi pengguna yang kehilangan email tidak menunggu selamanya.
    sendOnSignIn: true,
    sendVerificationEmail: async ({ user, url }) => {
      const res = await sendMailketingEmail({
        to: user.email,
        subject: 'Verifikasi Email Akun Lakoku',
        html: renderVerificationEmailHtml(user.name ?? undefined, url),
      })
      if (!res.success) throw new Error(`sendVerificationEmail: ${res.message}`)
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

// Tidak ada fallback sesi (dihapus, audit M1): fallback lama memotong
// signature HMAC cookie dan memakai token mentah sebagai Bearer, membuat
// integritas signature jadi tidak berarti. Klien non-browser yang butuh
// bearer harus mengirim header Authorization eksplisit.
export const auth = Object.assign(baseAuth, {
  api: Object.assign(baseAuth.api, {
    forgetPassword: baseAuth.api.requestPasswordReset,
  }),
})

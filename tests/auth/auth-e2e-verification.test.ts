import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import pg from 'pg'

vi.mock('server-only', () => ({}))

// Ensure .env.local is loaded before lib/auth initializes
const envPath = resolve(process.cwd(), '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

const hasDb = !!process.env.DATABASE_URL
const existingUserEmail = 'moxsenna+monkeytest1@gmail.com'
const existingUserPassword = 'lakoku-uji-123'

describe.skipIf(!hasDb)('Phase B E2E Verification against Neon', () => {
  let createdUserId: string | null = null
  let sessionToken: string = ''
  let sessionCookie: string = ''

  afterAll(async () => {
    if (createdUserId && process.env.DATABASE_URL) {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
      try {
        await pool.query('DELETE FROM public."user" WHERE id = $1', [createdUserId])
      } finally {
        await pool.end()
      }
    }
  })

  it('1. Login user existing moxsenna+monkeytest1@gmail.com: auth succeeds, session token and cookie produced', async () => {
    const { auth } = await import('@/lib/auth')
    const res = await auth.api.signInEmail({
      body: {
        email: existingUserEmail,
        password: existingUserPassword,
      },
      returnHeaders: true,
    })

    expect(res).toBeDefined()
    expect(res.response).toBeDefined()
    expect(res.response.user).toBeDefined()
    expect(res.response.user.email).toBe(existingUserEmail)
    expect(res.response.token).toBeDefined()
    expect(typeof res.response.token).toBe('string')
    expect(res.response.token.length).toBeGreaterThan(0)

    const cookieHeader = res.headers.get('set-cookie')
    expect(cookieHeader).toBeDefined()
    expect(cookieHeader).toContain('better-auth.session_token=')

    sessionToken = res.response.token
    sessionCookie = cookieHeader || ''
  })

  it('2. Verify bearer token: returns user moxsenna+monkeytest1@gmail.com', async () => {
    const { auth } = await import('@/lib/auth')
    expect(sessionToken).toBeTruthy()

    const session = await auth.api.getSession({
      headers: new Headers({
        authorization: `Bearer ${sessionToken}`,
      }),
    })

    expect(session).not.toBeNull()
    expect(session?.user).toBeDefined()
    expect(session?.user.email).toBe(existingUserEmail)
    expect(session?.session.token).toBe(sessionToken)
  })

  it('3. Verify cookie session: returns user', async () => {
    const { auth } = await import('@/lib/auth')
    expect(sessionToken).toBeTruthy()

    // Test with raw cookie name format as specified: better-auth.session_token=${token}
    const sessionPlain = await auth.api.getSession({
      headers: new Headers({
        cookie: `better-auth.session_token=${sessionToken}`,
      }),
    })

    expect(sessionPlain).not.toBeNull()
    expect(sessionPlain?.user).toBeDefined()
    expect(sessionPlain?.user.email).toBe(existingUserEmail)

    // Also verify with full cookie header from signInEmail response
    if (sessionCookie) {
      const sessionFromHeader = await auth.api.getSession({
        headers: new Headers({
          cookie: sessionCookie,
        }),
      })
      expect(sessionFromHeader).not.toBeNull()
      expect(sessionFromHeader?.user.email).toBe(existingUserEmail)
    }
  })

  it('4. User registration: created in Neon user & account', async () => {
    const { auth } = await import('@/lib/auth')
    const testEmail = `test-signup-${Date.now()}@lakoku.biz.id`
    const testPassword = 'TestPassword123!'
    const testName = 'Test User'

    const signUpRes = await auth.api.signUpEmail({
      body: {
        email: testEmail,
        password: testPassword,
        name: testName,
      },
    })

    expect(signUpRes).toBeDefined()
    expect(signUpRes.user).toBeDefined()
    expect(signUpRes.user.email).toBe(testEmail)
    expect(signUpRes.user.name).toBe(testName)

    createdUserId = signUpRes.user.id

    // Verify presence directly in Neon database
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    try {
      const { rows: userRows } = await pool.query<{ id: string; email: string; name: string }>(
        'SELECT id, email, name FROM public."user" WHERE id = $1',
        [createdUserId]
      )
      expect(userRows).toHaveLength(1)
      expect(userRows[0].email).toBe(testEmail)
      expect(userRows[0].name).toBe(testName)

      const { rows: accountRows } = await pool.query<{ id: string; userId: string; providerId: string; password: string }>(
        'SELECT id, "userId", "providerId", password FROM public."account" WHERE "userId" = $1 AND "providerId" = $2',
        [createdUserId, 'credential']
      )
      expect(accountRows).toHaveLength(1)
      expect(accountRows[0].userId).toBe(createdUserId)
      expect(accountRows[0].password).toBeDefined()
      expect(accountRows[0].password.startsWith('$2')).toBe(true)
    } finally {
      await pool.end()
    }
  })

  it('5. Password reset flow: succeeds without error', async () => {
    const { auth } = await import('@/lib/auth')
    const forgetRes = await auth.api.forgetPassword({
      body: {
        email: existingUserEmail,
        redirectTo: 'https://lakoku.biz.id/auth/reset-password',
      },
    })

    expect(forgetRes).toBeDefined()
    expect(forgetRes.status).toBe(true)
  })
})

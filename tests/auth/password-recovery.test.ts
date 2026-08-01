import { describe, expect, it, vi } from 'vitest'
import {
  buildRecoveryCapability,
  consumeRecoveryCapability,
  mapPasswordRecoveryError,
  recoveryCookieOptions,
  validateNewPassword,
  validateRecoveryProvenance,
} from '@/lib/auth/password-recovery'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { publicErrorMessage } from '@/lib/auth/public-error'
import { NextRequest } from 'next/server'

describe('validateNewPassword', () => {
  it('rejects passwords shorter than six characters', () => {
    expect(validateNewPassword('12345', '12345')).toEqual({
      ok: false,
      message: 'Kata sandi minimal 6 karakter.',
    })
  })

  it('accepts exactly six matching characters', () => {
    expect(validateNewPassword('123456', '123456')).toEqual({ ok: true })
  })

  it('rejects mismatched confirmation', () => {
    expect(validateNewPassword('123456', '654321')).toEqual({
      ok: false,
      message: 'Konfirmasi kata sandi tidak cocok.',
    })
  })
})

describe('recovery provenance and capability', () => {
  it('rejects an ordinary authenticated session without recovery provenance', () => {
    expect(validateRecoveryProvenance({ redirectType: null })).toEqual({ ok: false })
    expect(validateRecoveryProvenance({ redirectType: 'signup' })).toEqual({ ok: false })
    expect(validateRecoveryProvenance({ redirectType: 'recovery' })).toEqual({ ok: true })
  })

  it('builds an opaque 256-bit capability and stores only its hash', async () => {
    const capability = await buildRecoveryCapability('user-a', 'session-a')
    expect(capability.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(capability.tokenHash).not.toContain(capability.token)
    expect(capability.userId).toBe('user-a')
    expect(capability.sessionId).toBe('session-a')
  })

  it('uses a short-lived HttpOnly Secure SameSite=Lax marker', () => {
    expect(recoveryCookieOptions).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    })
    expect(recoveryCookieOptions.maxAge).toBeGreaterThan(0)
    expect(recoveryCookieOptions.maxAge).toBeLessThanOrEqual(900)
  })

  it.each(['absent', 'expired', 'mismatched', 'used'] as const)(
    'rejects %s capability',
    async (state) => {
      const consume = vi.fn().mockResolvedValue({ data: false, error: null })
      await expect(consumeRecoveryCapability({ token: state === 'absent' ? null : 'token', userId: 'user-a', sessionId: 'session-a', consume })).resolves.toEqual({ ok: false })
    },
  )

  it('does not let account A capability authorize account B', async () => {
    const consume = vi.fn().mockResolvedValue({ data: false, error: null })
    await expect(consumeRecoveryCapability({ token: 'token-a', userId: 'user-b', sessionId: 'session-b', consume })).resolves.toEqual({ ok: false })
    expect(consume).toHaveBeenCalledWith(expect.objectContaining({ p_user_id: 'user-b', p_session_id: 'session-b' }))
  })
})

describe('public auth error allowlist', () => {
  it('maps exact fixed codes only and never reflects raw text', () => {
    expect(publicErrorMessage('access_denied')).toContain('dibatalkan')
    expect(publicErrorMessage('access_denied raw provider secret')).not.toContain('dibatalkan')
    expect(publicErrorMessage('access_denied raw provider secret')).not.toContain('secret')
    expect(publicErrorMessage('provider_message=secret')).not.toContain('secret')
  })
})

describe('canonical public origin', () => {
  it('ignores hostile production host headers', () => {
    const prior = process.env.NODE_ENV
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://lakoku.biz.id')
    const request = new NextRequest('https://internal:5200/auth/callback', { headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' } })
    expect(getPublicOrigin(request)).toBe('https://lakoku.biz.id')
    vi.stubEnv('NODE_ENV', prior)
  })

  it('accepts loopback only during development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const loopback = new NextRequest('http://localhost:3000/auth/callback', { headers: { host: 'localhost:3000' } })
    const hostile = new NextRequest('http://evil.example/auth/callback', { headers: { host: 'evil.example' } })
    expect(getPublicOrigin(loopback)).toBe('http://localhost:3000')
    expect(getPublicOrigin(hostile)).not.toContain('evil.example')
    vi.unstubAllEnvs()
  })
})

describe('mapPasswordRecoveryError', () => {
  it.each([
    ['Auth session missing!', 'Tautan pemulihan tidak valid atau sudah kedaluwarsa.'],
    ['otp_expired', 'Tautan pemulihan tidak valid atau sudah kedaluwarsa.'],
    ['fetch failed', 'Koneksi bermasalah. Periksa jaringan lalu coba lagi.'],
    ['provider leaked access_token=secret', 'Permintaan belum dapat diproses. Coba lagi.'],
  ])('maps %s to allowlisted reader-safe copy', (rawMessage, expected) => {
    const mapped = mapPasswordRecoveryError(rawMessage)
    expect(mapped).toBe(expected)
    expect(mapped).not.toContain(rawMessage)
    expect(mapped).not.toMatch(/access_token|refresh_token|secret/i)
  })
})

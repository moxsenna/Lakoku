import { describe, expect, it } from 'vitest'
import {
  mapOAuthErrorMessage,
  OAUTH_GENERIC_ERROR_MESSAGE,
} from '@/lib/auth/oauth-error'

describe('mapOAuthErrorMessage', () => {
  it('maps account_not_linked to verification guidance', () => {
    const msg = mapOAuthErrorMessage('account_not_linked')
    expect(msg).toContain('belum diverifikasi')
    expect(msg).toContain('kata sandi')
  })

  it('maps email_not_verified to verification guidance', () => {
    expect(mapOAuthErrorMessage('email_not_verified')).toContain('belum diverifikasi')
  })

  it('falls back to generic message for unknown codes', () => {
    expect(mapOAuthErrorMessage('state_not_found')).toBe(OAUTH_GENERIC_ERROR_MESSAGE)
  })

  it('returns null when no error code is present', () => {
    expect(mapOAuthErrorMessage(null)).toBeNull()
    expect(mapOAuthErrorMessage(undefined)).toBeNull()
    expect(mapOAuthErrorMessage('')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { getSessionRedirectPath } from '@/lib/auth/session-redirect'

describe('getSessionRedirectPath', () => {
  describe('unauthenticated (guest)', () => {
    it('never redirects guests from root', () => {
      expect(getSessionRedirectPath({ pathname: '/', isAuthenticated: false })).toBeNull()
    })

    it('never redirects guests from /auth/login', () => {
      expect(getSessionRedirectPath({ pathname: '/auth/login', isAuthenticated: false })).toBeNull()
    })

    it('never redirects guests from /auth/sign-up', () => {
      expect(getSessionRedirectPath({ pathname: '/auth/sign-up', isAuthenticated: false })).toBeNull()
    })

    it('never redirects guests from random routes', () => {
      expect(getSessionRedirectPath({ pathname: '/beranda', isAuthenticated: false })).toBeNull()
    })
  })

  describe('authenticated user', () => {
    it('redirects from root to /beranda by default', () => {
      expect(getSessionRedirectPath({ pathname: '/', isAuthenticated: true })).toBe('/beranda')
    })

    it('allows viewing root if preview mode is active', () => {
      expect(getSessionRedirectPath({ pathname: '/', isAuthenticated: true, preview: true })).toBeNull()
    })

    it('redirects from /auth/login to /beranda when no next path provided', () => {
      expect(getSessionRedirectPath({ pathname: '/auth/login', isAuthenticated: true })).toBe('/beranda')
    })

    it('redirects from /auth/login to sanitized next path when provided', () => {
      expect(
        getSessionRedirectPath({
          pathname: '/auth/login',
          isAuthenticated: true,
          next: '/mulai?resume=1',
        }),
      ).toBe('/mulai?resume=1')
    })

    it('redirects from /auth/login to /beranda if next is an open-redirect attempt', () => {
      expect(
        getSessionRedirectPath({
          pathname: '/auth/login',
          isAuthenticated: true,
          next: 'https://evil.com',
        }),
      ).toBe('/beranda')
    })

    it('redirects from /auth/sign-up to /beranda', () => {
      expect(getSessionRedirectPath({ pathname: '/auth/sign-up', isAuthenticated: true })).toBe('/beranda')
    })

    it('does not redirect on normal in-app pages like /beranda or /profil', () => {
      expect(getSessionRedirectPath({ pathname: '/beranda', isAuthenticated: true })).toBeNull()
      expect(getSessionRedirectPath({ pathname: '/profil', isAuthenticated: true })).toBeNull()
    })
  })
})

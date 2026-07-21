import { describe, expect, it } from 'vitest'
import { sanitizeNextPath } from '@/lib/auth/safe-next'

describe('sanitizeNextPath', () => {
  it('defaults empty/nullish to /beranda', () => {
    expect(sanitizeNextPath(null)).toBe('/beranda')
    expect(sanitizeNextPath(undefined)).toBe('/beranda')
    expect(sanitizeNextPath('')).toBe('/beranda')
    expect(sanitizeNextPath('   ')).toBe('/beranda')
  })

  it('accepts internal paths with query and hash', () => {
    expect(sanitizeNextPath('/beranda')).toBe('/beranda')
    expect(sanitizeNextPath('/mulai?resume=1')).toBe('/mulai?resume=1')
    expect(sanitizeNextPath('/baca/abc-123?bab=2')).toBe('/baca/abc-123?bab=2')
    expect(sanitizeNextPath('/profil#settings')).toBe('/profil#settings')
  })

  it('rejects open-redirect patterns', () => {
    expect(sanitizeNextPath('//evil.com')).toBe('/beranda')
    expect(sanitizeNextPath('/\\evil.com')).toBe('/beranda')
    expect(sanitizeNextPath('https://evil.com')).toBe('/beranda')
    expect(sanitizeNextPath('http://evil.com')).toBe('/beranda')
    expect(sanitizeNextPath('//evil.com/path')).toBe('/beranda')
    expect(sanitizeNextPath('beranda')).toBe('/beranda')
    expect(sanitizeNextPath('javascript:alert(1)')).toBe('/beranda')
  })
})

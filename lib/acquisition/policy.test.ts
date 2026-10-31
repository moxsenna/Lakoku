import { describe, expect, it } from 'vitest'
import {
  ACQUISITION_COOKIE_DAYS,
  ACQUISITION_COOKIE_NAME,
  classifyAcquisition,
  normalizeUtmSlug,
  parseAcquisitionCookie,
  referrerHostFromHeader,
  serializeAcquisitionCookie,
} from './policy'

describe('classifyAcquisition', () => {
  it('memetakan utm_source yang dikenal ke kanal', () => {
    expect(classifyAcquisition({ pathname: '/', utm_source: 'instagram', utm_campaign: 'juli', referrer_host: null })).toMatchObject({
      channel: 'instagram',
      utm_source: 'instagram',
      utm_campaign: 'juli',
    })
    expect(classifyAcquisition({ pathname: '/', utm_source: 'wa', utm_campaign: null, referrer_host: null })).toMatchObject({ channel: 'whatsapp' })
    expect(classifyAcquisition({ pathname: '/', utm_source: 'tt', utm_campaign: null, referrer_host: null })).toMatchObject({ channel: 'tiktok' })
    expect(classifyAcquisition({ pathname: '/', utm_source: 'twitter', utm_campaign: null, referrer_host: null })).toMatchObject({ channel: 'x_twitter' })
    expect(classifyAcquisition({ pathname: '/', utm_source: 'email', utm_campaign: null, referrer_host: null })).toMatchObject({ channel: 'email' })
  })

  it('utm_source di luar daftar → other, bukan direct', () => {
    expect(classifyAcquisition({ pathname: '/', utm_source: 'newsletter-q3', utm_campaign: null, referrer_host: null })).toMatchObject({ channel: 'other' })
  })

  it('path /s/* → share_link dan /r/* → referral_code', () => {
    expect(classifyAcquisition({ pathname: '/s/kamar-304', utm_source: null, utm_campaign: null, referrer_host: null })).toMatchObject({ channel: 'share_link' })
    expect(classifyAcquisition({ pathname: '/r/ABC234', utm_source: null, utm_campaign: null, referrer_host: null })).toMatchObject({ channel: 'referral_code' })
  })

  it('referrer google → google, mail provider → email', () => {
    expect(classifyAcquisition({ pathname: '/beranda', utm_source: null, utm_campaign: null, referrer_host: 'www.google.com' })).toMatchObject({ channel: 'google' })
    expect(classifyAcquisition({ pathname: '/beranda', utm_source: null, utm_campaign: null, referrer_host: 'mail.google.com' })).toMatchObject({ channel: 'email' })
  })

  it('tanpa penanda apa pun → direct', () => {
    expect(classifyAcquisition({ pathname: '/baca/story-x', utm_source: null, utm_campaign: null, referrer_host: 'whatsapp.com' })).toMatchObject({ channel: 'direct' })
    expect(classifyAcquisition({ pathname: '/', utm_source: null, utm_campaign: null, referrer_host: null })).toMatchObject({ channel: 'direct' })
  })

  it('utm_source lebih diutamakan daripada path', () => {
    expect(classifyAcquisition({ pathname: '/s/kamar-304', utm_source: 'tiktok', utm_campaign: null, referrer_host: null })).toMatchObject({ channel: 'tiktok' })
  })
})

describe('normalizeUtmSlug', () => {
  it('melowerkan dan membersihkan teks jadi slug reader-safe', () => {
    expect(normalizeUtmSlug('  Instagram-Story! ')).toBe('instagram-story')
    expect(normalizeUtmSlug('TIKTOK ADS')).toBe('tiktok-ads')
  })

  it('memotong ke 32 karakter dan mengembalikan null bila kosong', () => {
    expect(normalizeUtmSlug('a'.repeat(40))).toHaveLength(32)
    expect(normalizeUtmSlug('!!!')).toBeNull()
    expect(normalizeUtmSlug(null)).toBeNull()
    expect(normalizeUtmSlug('')).toBeNull()
  })
})

describe('referrerHostFromHeader', () => {
  it('mengekstrak hostname dan menolak header invalid', () => {
    expect(referrerHostFromHeader('https://l.instagram.com/?u=xyz')).toBe('l.instagram.com')
    expect(referrerHostFromHeader('bukan-url')).toBeNull()
    expect(referrerHostFromHeader(null)).toBeNull()
  })
})

describe('cookie serialize/parse', () => {
  it('roundtrip nilai cookie', () => {
    const parsed = classifyAcquisition({ pathname: '/', utm_source: 'ig', utm_campaign: 'juli', referrer_host: null })
    const raw = serializeAcquisitionCookie(parsed)
    expect(parseAcquisitionCookie(raw)).toEqual(parsed)
  })

  it('fail-open: cookie rusak/kanal asing/kosong → null', () => {
    expect(parseAcquisitionCookie('bukan-json')).toBeNull()
    expect(parseAcquisitionCookie('{"c":"kanal_asing"}')).toBeNull()
    expect(parseAcquisitionCookie(null)).toBeNull()
    expect(parseAcquisitionCookie('')).toBeNull()
  })

  it('konstanta cookie sesuai desain', () => {
    expect(ACQUISITION_COOKIE_NAME).toBe('lakoku_utm')
    expect(ACQUISITION_COOKIE_DAYS).toBe(30)
  })
})

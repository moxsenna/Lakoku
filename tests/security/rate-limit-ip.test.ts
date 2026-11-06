import { describe, expect, it } from 'vitest'
import { clientIpFrom, rateLimit } from '../../lib/security/rate-limit'

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://lakoku.biz.id/api/test', { headers })
}

describe('clientIpFrom (audit M-A8)', () => {
  it('memilih cf-connecting-ip sebagai prioritas tertinggi', () => {
    const ip = clientIpFrom(reqWith({
      'cf-connecting-ip': '203.0.113.7',
      'x-real-ip': '10.0.0.1',
      'x-forwarded-for': '1.2.3.4, 10.0.0.1',
    }))
    expect(ip).toBe('203.0.113.7')
  })

  it('fallback ke x-real-ip bila CF tidak ada', () => {
    const ip = clientIpFrom(reqWith({
      'x-real-ip': '10.0.0.1',
      'x-forwarded-for': '1.2.3.4, 10.0.0.1',
    }))
    expect(ip).toBe('10.0.0.1')
  })

  it('XFF multi-hop memakai hop TERAKHIR (bukan yang dikontrol klien)', () => {
    const ip = clientIpFrom(reqWith({
      'x-forwarded-for': '6.6.6.6, 7.7.7.7, 10.0.0.9',
    }))
    expect(ip).toBe('10.0.0.9')
  })

  it('spoof entri pertama XFF tidak lagi dipakai sebagai identitas', () => {
    // Penyerang kirim XFF palsu; tanpa CF/x-real-ip, hop terakhir (proxy) yang dipakai.
    const ip = clientIpFrom(reqWith({
      'x-forwarded-for': '1.1.1.1, 127.0.0.1',
    }))
    expect(ip).toBe('127.0.0.1')
  })

  it('XFF satu entri tetap dipakai', () => {
    expect(clientIpFrom(reqWith({ 'x-forwarded-for': '198.51.100.5' }))).toBe('198.51.100.5')
  })

  it('tanpa header relevan → unknown', () => {
    expect(clientIpFrom(reqWith({}))).toBe('unknown')
  })

  it('XFF kosong/spasi → unknown (tidak crash)', () => {
    expect(clientIpFrom(reqWith({ 'x-forwarded-for': ' , , ' }))).toBe('unknown')
  })
})

describe('rateLimit bucket tetap berjalan', () => {
  it('membatasi setelah limit dan memberi retryAfterSec', () => {
    const key = `test-${Math.random()}`
    expect(rateLimit(key, 2, 60_000).ok).toBe(true)
    expect(rateLimit(key, 2, 60_000).ok).toBe(true)
    const third = rateLimit(key, 2, 60_000)
    expect(third.ok).toBe(false)
    expect(third.retryAfterSec).toBeGreaterThan(0)
  })
})

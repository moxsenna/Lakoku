import { describe, expect, it } from 'vitest'
import { buildReferralInvite } from './invite'

describe('buildReferralInvite', () => {
  it('membentuk URL referral absolut', () => {
    const invite = buildReferralInvite('ABCD1234', 'https://lakoku.biz.id')
    expect(invite.url).toBe('https://lakoku.biz.id/r/ABCD1234')
  })

  it('tidak menggandakan garis miring di akhir origin', () => {
    const invite = buildReferralInvite('ABCD1234', 'https://lakoku.biz.id/')
    expect(invite.url).toBe('https://lakoku.biz.id/r/ABCD1234')
  })

  it('menyertakan tautan di dalam teks pesan', () => {
    const invite = buildReferralInvite('ABCD1234', 'https://lakoku.biz.id')
    expect(invite.text).toContain(invite.url)
  })

  it('teks ditujukan ke penerima, tanpa menyebut imbalan pengundang', () => {
    const invite = buildReferralInvite('ABCD1234', 'https://lakoku.biz.id')
    expect(invite.text.toLowerCase()).not.toContain('imbalan')
    expect(invite.text.toLowerCase()).not.toContain('komisi')
  })

  it('bebas istilah internal yang dilarang tampil ke pembaca', () => {
    const invite = buildReferralInvite('ABCD1234', 'https://lakoku.biz.id')
    const haystack = `${invite.title} ${invite.text}`
    for (const banned of ['AI', 'Narraza', 'RAG', 'token']) {
      expect(haystack).not.toContain(banned)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { isSafeStoryCoverInput, resolveStoryCover, DEFAULT_STORY_COVER } from '../../lib/cover/url'

describe('isSafeStoryCoverInput (audit M-A3/M8)', () => {
  it('menolak traversal dalam bentuk apa pun, termasuk prefix path lokal', () => {
    expect(isSafeStoryCoverInput('/../secret')).toBe(false)
    expect(isSafeStoryCoverInput('/covers/../../etc')).toBe(false)
    expect(isSafeStoryCoverInput('a/../b')).toBe(false)
    expect(isSafeStoryCoverInput('..')).toBe(false)
  })

  it('key relatif polos diterima, karakter aneh ditolak', () => {
    expect(isSafeStoryCoverInput('cat-01/20261107T0930.webp')).toBe(true)
    expect(isSafeStoryCoverInput('story%20one/x.webp')).toBe(false)
    expect(isSafeStoryCoverInput('a b/c.webp')).toBe(false)
  })

  it('protocol-relative dan scheme asing ditolak', () => {
    expect(isSafeStoryCoverInput('//evil.example/x.png')).toBe(false)
    expect(isSafeStoryCoverInput('javascript:alert(1)')).toBe(false)
    expect(isSafeStoryCoverInput('https://evil.example/x.png')).toBe(false)
  })

  it('path lokal aset publik tetap diterima (legacy)', () => {
    expect(isSafeStoryCoverInput('/covers/legacy-cover.png')).toBe(true)
    expect(isSafeStoryCoverInput('/placeholder.svg')).toBe(true)
  })

  it('input kosong ditolak', () => {
    expect(isSafeStoryCoverInput('')).toBe(false)
  })
})

describe('resolveStoryCover', () => {
  it('kosong/placeholder → cover default', () => {
    expect(resolveStoryCover(null)).toBe(DEFAULT_STORY_COVER)
    expect(resolveStoryCover('/placeholder.svg')).toBe(DEFAULT_STORY_COVER)
  })

  it('path lokal & URL absolut diteruskan apa adanya', () => {
    expect(resolveStoryCover('/covers/x.webp')).toBe('/covers/x.webp')
    expect(resolveStoryCover('https://cdn.example/x.webp')).toBe('https://cdn.example/x.webp')
  })

  it('key relatif dirakit dengan base publik bila ada', () => {
    const prev = process.env.NEXT_PUBLIC_COVER_BASE
    process.env.NEXT_PUBLIC_COVER_BASE = 'https://covers.lakoku.biz.id'
    try {
      expect(resolveStoryCover('cat-01/x.webp')).toBe('https://covers.lakoku.biz.id/cat-01/x.webp')
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_COVER_BASE
      else process.env.NEXT_PUBLIC_COVER_BASE = prev
    }
  })
})

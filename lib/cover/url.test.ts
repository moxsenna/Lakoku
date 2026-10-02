// lib/cover/url.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coverKeyFromPublicUrl, coverPublicUrl, resolveStoryCover } from './url'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveStoryCover', () => {
  it('kosong / placeholder → sampul default', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', 'https://covers.example.com')
    expect(resolveStoryCover(null)).toBe('/covers/default-cover.webp')
    expect(resolveStoryCover(undefined)).toBe('/covers/default-cover.webp')
    expect(resolveStoryCover('')).toBe('/covers/default-cover.webp')
    expect(resolveStoryCover('/placeholder.svg?height=400&width=300')).toBe(
      '/covers/default-cover.webp',
    )
  })

  it('URL absolut legacy dikembalikan apa adanya (jaring pengaman migrasi)', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', 'https://covers.example.com')
    expect(resolveStoryCover('https://abc.supabase.co/storage/v1/object/public/story-covers/x/y.webp')).toBe(
      'https://abc.supabase.co/storage/v1/object/public/story-covers/x/y.webp',
    )
  })

  it('key relatif dirakit dengan base dari env', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', 'https://covers.example.com')
    expect(resolveStoryCover('story-1/abc123.webp')).toBe(
      'https://covers.example.com/story-1/abc123.webp',
    )
  })

  it('base kosong → key dikembalikan apa adanya (deterministik, tanpa crash)', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', '')
    expect(resolveStoryCover('story-1/abc123.webp')).toBe('story-1/abc123.webp')
  })
})

describe('coverPublicUrl', () => {
  it('merakit base + key dan membuang trailing slash base', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', 'https://covers.example.com/')
    expect(coverPublicUrl('/story-1/a.webp')).toBe('https://covers.example.com/story-1/a.webp')
  })
})

describe('coverKeyFromPublicUrl', () => {
  it('mengekstrak key dari URL dengan prefix base', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', 'https://covers.example.com')
    expect(coverKeyFromPublicUrl('https://covers.example.com/story-1/a.webp')).toBe('story-1/a.webp')
  })

  it('mengembalikan null untuk host lain', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', 'https://covers.example.com')
    expect(coverKeyFromPublicUrl('https://abc.supabase.co/storage/v1/object/public/story-covers/s/a.webp')).toBeNull()
  })
})

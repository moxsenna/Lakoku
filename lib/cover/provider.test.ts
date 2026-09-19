import { describe, expect, it, vi } from 'vitest'
import { buildCoverPrompt, isCoverProviderConfigured } from './provider'

vi.mock('server-only', () => ({}))

describe('buildCoverPrompt', () => {
  it('meminta orientasi potret 2:3 karena parameter size diabaikan penyedia', () => {
    const prompt = buildCoverPrompt({ title: 'T', tagline: '', role: '', tropes: [] })
    expect(prompt).toMatch(/2:3/)
    expect(prompt).toMatch(/potret/i)
  })

  it('memasukkan judul, tagline, peran, dan tropes', () => {
    const prompt = buildCoverPrompt({
      title: 'Pesan Malam',
      tagline: 'Rahasia di kota tua',
      role: 'Jurnalis muda',
      tropes: ['misteri', 'romansa'],
    })
    expect(prompt).toContain('Pesan Malam')
    expect(prompt).toContain('Rahasia di kota tua')
    expect(prompt).toContain('Jurnalis muda')
    expect(prompt).toContain('misteri, romansa')
  })

  it('melarang teks tertulis di dalam gambar', () => {
    const prompt = buildCoverPrompt({ title: 'T', tagline: '', role: '', tropes: [] })
    expect(prompt).toMatch(/JANGAN/i)
  })

  it('memotong input panjang supaya kolom metadata tidak jadi jalur injeksi', () => {
    const long = 'A'.repeat(500)
    const prompt = buildCoverPrompt({ title: long, tagline: long, role: '', tropes: [] })
    // Judul dipangkas ke 120, tagline ke 200: run 500 karakter tidak mungkin ada.
    expect(prompt).toContain('A'.repeat(120))
    expect(prompt).not.toContain('A'.repeat(500))
  })
})

describe('isCoverProviderConfigured', () => {
  it('false ketika env belum diset', () => {
    const saved = { ...process.env }
    delete process.env.COVER_IMAGE_BASE_URL
    delete process.env.COVER_IMAGE_API_KEY
    delete process.env.COVER_IMAGE_MODEL_ID
    try {
      expect(isCoverProviderConfigured()).toBe(false)
    } finally {
      process.env = saved
    }
  })
})

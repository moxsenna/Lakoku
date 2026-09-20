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

  it('menggunakan preset default sinematik jika preset tidak diberikan', () => {
    const prompt = buildCoverPrompt({ title: 'Cinta di KRL', tagline: '', role: '', tropes: [] })
    expect(prompt).toContain('sinematik')
  })

  it('menerapkan modifier dari 5 preset visual yang tersedia', () => {
    const presets = [
      { key: 'sinematik', expected: 'sinematik' },
      { key: 'webtoon', expected: 'webtoon manhwa' },
      { key: 'cat_air', expected: 'cat air' },
      { key: 'gelap', expected: 'gelap dan menegangkan' },
      { key: 'fantasi', expected: 'fantasi megah' },
    ] as const

    for (const { key, expected } of presets) {
      const prompt = buildCoverPrompt({
        title: 'Judul',
        tagline: '',
        role: '',
        tropes: [],
        preset: key,
      })
      expect(prompt.toLowerCase()).toContain(expected)
    }
  })

  it('memasukkan catatan visual tambahan dan memotongnya ke 80 karakter', () => {
    const longNotes = 'X'.repeat(200)
    const prompt = buildCoverPrompt({
      title: 'Judul',
      tagline: '',
      role: '',
      tropes: [],
      customNotes: longNotes,
    })
    expect(prompt).toContain(`Catatan visual tambahan: "${'X'.repeat(80)}".`)
    expect(prompt).not.toContain('X'.repeat(81))
  })

  it('mengubah instruksi teks jika includeTitle bernilai true', () => {
    const promptWithTitle = buildCoverPrompt({
      title: 'Bunga Terakhir',
      tagline: '',
      role: '',
      tropes: [],
      includeTitle: true,
    })
    expect(promptWithTitle).toContain('Tampilkan teks judul cerita "Bunga Terakhir"')
    expect(promptWithTitle).not.toContain('JANGAN menuliskan teks')

    const promptWithoutTitle = buildCoverPrompt({
      title: 'Bunga Terakhir',
      tagline: '',
      role: '',
      tropes: [],
      includeTitle: false,
    })
    expect(promptWithoutTitle).toContain('JANGAN menuliskan teks')
    expect(promptWithoutTitle).not.toContain('Tampilkan teks judul cerita')
  })

  it('menggunakan basePromptOverride jika dikonfigurasi admin', () => {
    const prompt = buildCoverPrompt({
      title: 'Judul',
      tagline: '',
      role: '',
      tropes: [],
      basePromptOverride: 'Sampul komik retro 90-an.',
    })
    expect(prompt).toContain('Sampul komik retro 90-an.')
    expect(prompt).not.toContain('Sampul novel romansa Indonesia')
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

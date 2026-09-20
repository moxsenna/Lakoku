import { describe, it, expect } from 'vitest'
import {
  GENRE_PROSE_FLAVORS,
  normalizeGenreId,
  buildGenreProseDirective,
} from '@/lib/prose/genre-flavor'
import { buildWriterPrompt } from '@/lib/prose/prompt-engine'
import type { PreProseChapterBrief } from '@/lib/story-engine/pre-prose-brief'
import { GENRE_IDS } from '@/lib/taste-profile/catalog'

function mockBrief(): PreProseChapterBrief {
  return {
    storyId: 'story-test-123',
    chapterNumber: 2,
    phase: 'Rising',
    lockedEndingKey: null,
    lockedEndingClosure: [],
    chapterGoal: 'Nadia menghadapi ancaman di dermaga.',
    mustInclude: ['Nadia melihat senter penjaga di ujung dermaga.'],
    mustNotInclude: [],
    mustNotReveal: [],
    forbiddenRevealIds: [],
    resolvedPlotDebtIds: [],
    scheduledReveals: [],
    plotDebtsToProgress: [],
    plotDebtsToClose: [],
    routeStateSummary: 'Kondisi rute stabil.',
    previousChoiceSummary: '',
    previousChoiceApplied: false,
  }
}

describe('GENRE_PROSE_FLAVORS and normalizeGenreId', () => {
  it('covers all 6 catalog genres with complete flavor directives', () => {
    expect(Object.keys(GENRE_PROSE_FLAVORS)).toHaveLength(6)
    for (const genreId of GENRE_IDS) {
      const flavor = GENRE_PROSE_FLAVORS[genreId]
      expect(flavor).toBeDefined()
      expect(flavor.id).toBe(genreId)
      expect(flavor.atmosphere.length).toBeGreaterThan(20)
      expect(flavor.sensoryFocus.length).toBeGreaterThan(20)
      expect(flavor.dialogueDynamics.length).toBeGreaterThan(20)
      expect(flavor.lexiconFocus.length).toBeGreaterThan(20)
      expect(flavor.antiPatterns.length).toBeGreaterThan(20)
    }
  })

  it('normalizes various input formats correctly', () => {
    // Exact canonical IDs
    expect(normalizeGenreId('family_drama')).toBe('family_drama')
    expect(normalizeGenreId('romance')).toBe('romance')
    expect(normalizeGenreId('mystery')).toBe('mystery')
    expect(normalizeGenreId('fantasy_kingdom')).toBe('fantasy_kingdom')
    expect(normalizeGenreId('slice_of_life')).toBe('slice_of_life')
    expect(normalizeGenreId('survival_thriller')).toBe('survival_thriller')

    // Indonesian labels / V1 mapping
    expect(normalizeGenreId('Drama keluarga')).toBe('family_drama')
    expect(normalizeGenreId('romansa')).toBe('romance')
    expect(normalizeGenreId('misteri & rahasia')).toBe('mystery')
    expect(normalizeGenreId('misteri')).toBe('mystery')
    expect(normalizeGenreId('fantasi & kerajaan')).toBe('fantasy_kingdom')
    expect(normalizeGenreId('slice of life')).toBe('slice_of_life')
    expect(normalizeGenreId('thriller & bertahan hidup')).toBe('survival_thriller')

    // Fuzzy / case-insensitive
    expect(normalizeGenreId('  ROMANCE  ')).toBe('romance')
    expect(normalizeGenreId('Konflik Keluarga')).toBe('family_drama')
    expect(normalizeGenreId('survival')).toBe('survival_thriller')

    // Null / empty / invalid
    expect(normalizeGenreId(null)).toBeNull()
    expect(normalizeGenreId(undefined)).toBeNull()
    expect(normalizeGenreId('')).toBeNull()
    expect(normalizeGenreId('genre_aneh_tak_dikenal')).toBeNull()
  })

  it('builds well-formed directive text for valid genre and null for invalid', () => {
    const directive = buildGenreProseDirective('mystery')
    expect(directive).not.toBeNull()
    expect(directive).toContain('- KARAKTER & ATMOSFER GENRE (MISTERI & RAHASIA):')
    expect(directive).toContain('* Atmosfer Emosional:')
    expect(directive).toContain('* Fokus Sensorik Fisik:')
    expect(directive).toContain('* Dinamika Dialog & Subteks:')
    expect(directive).toContain('* Aksen Kosakata:')
    expect(directive).toContain('* Pagar Gaya:')

    expect(buildGenreProseDirective(null)).toBeNull()
    expect(buildGenreProseDirective('nonexistent')).toBeNull()
  })
})

describe('Prompt engine genre integration in P4', () => {
  it('omits genre directive when genre is not passed, preserving exact baseline', () => {
    const brief = mockBrief()
    const promptWithoutGenre = buildWriterPrompt({
      chapterNumber: 2,
      brief,
    })

    expect(promptWithoutGenre.user).toContain('=== [P4] SUARA TOKOH & KETERBACAAN MOBILE ===')
    expect(promptWithoutGenre.user).not.toContain('- KARAKTER & ATMOSFER GENRE')
  })

  it('injects genre directive in P4 when genre is provided', () => {
    const brief = mockBrief()
    const promptWithRomance = buildWriterPrompt({
      chapterNumber: 2,
      brief,
      genre: 'romance',
    })

    expect(promptWithRomance.user).toContain('=== [P4] SUARA TOKOH & KETERBACAAN MOBILE ===')
    expect(promptWithRomance.user).toContain('- KARAKTER & ATMOSFER GENRE (ROMANSA):')
    expect(promptWithRomance.user).toContain('Ketegangan tarik-ulur')
    expect(promptWithRomance.user).toContain('keheningan yang lebih keras daripada kata-kata')
  })

  it('supports all 6 genres distinctly in prompt output', () => {
    const brief = mockBrief()
    for (const genreId of GENRE_IDS) {
      const prompt = buildWriterPrompt({
        chapterNumber: 2,
        brief,
        genre: genreId,
      })

      const flavor = GENRE_PROSE_FLAVORS[genreId]
      expect(prompt.user).toContain(`- KARAKTER & ATMOSFER GENRE`)
      expect(prompt.user).toContain(flavor.atmosphere)
      expect(prompt.user).toContain(flavor.antiPatterns)
    }
  })

  it('keeps P0, P1, P2, P3, P5 and output contract intact when genre is injected', () => {
    const brief = mockBrief()
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      brief,
      genre: 'survival_thriller',
    })

    expect(prompt.user).toContain('=== [P0] INVARIAN CANON & KEAMANAN')
    expect(prompt.user).toContain('=== [P1] KEWAJIBAN NARATIF MANDATORI BAB INI ===')
    expect(prompt.user).toContain('=== [P2] PENYELESAIAN DRAMATIS ADEGAN & RENCANA BAB ===')
    expect(prompt.user).toContain('=== [P3] OTORITAS PANJANG KATA & STRUKTUR PARAGRAF ===')
    expect(prompt.user).toContain('=== [P4] SUARA TOKOH & KETERBACAAN MOBILE ===')
    expect(prompt.user).toContain('=== [P5] RITME PARAGRAF KUALITATIF ===')
    expect(prompt.user).toContain('=== KONTRAK KELUARAN ===')
    expect(prompt.user).toContain('JUDUL: <Judul Bab yang Menggugah>')
    expect(prompt.user).toContain('Target utama penulisan: 890–950 kata')
  })
})

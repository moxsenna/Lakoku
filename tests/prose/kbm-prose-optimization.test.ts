import { describe, it, expect } from 'vitest'
import { buildGenreProseDirective, GENRE_PROSE_FLAVORS } from '@/lib/prose/genre-flavor'
import { buildWriterPrompt } from '@/lib/prose/prompt-engine'
import { mobileDramaSystemPrompt } from '@/lib/prose/mobile-drama-style'
import { StoryContractSchema } from '@/lib/story-engine/story-contract'
import { applyPremiseOverlay, normalizeCatalogEndings } from '@/lib/catalog/catalog-contract'
import { fantasiPetualanganContract } from '@/fixtures/contracts/fantasi-petualangan'
import type { PreProseChapterBrief } from '@/lib/story-engine/pre-prose-brief'
import { GENRE_IDS } from '@/lib/taste-profile/catalog'

function mockBrief(): PreProseChapterBrief {
  return {
    storyId: 'story-kbm-test',
    chapterNumber: 1,
    phase: 'Opening',
    lockedEndingKey: null,
    lockedEndingClosure: [],
    chapterGoal: 'Wulan memulai shift malam di meja resepsionis.',
    mustInclude: ['Wulan memeriksa buku tamu yang janggal.'],
    mustNotInclude: [],
    mustNotReveal: [],
    forbiddenRevealIds: [],
    resolvedPlotDebtIds: [],
    scheduledReveals: [],
    plotDebtsToProgress: [],
    plotDebtsToClose: [],
    routeStateSummary: 'Kondisi stabil.',
    previousChoiceSummary: '',
    previousChoiceApplied: false,
  }
}

describe('KBM Viral & Modern Mobile Prose Optimization', () => {
  describe('In Medias Res & Anti-Slowness Prompt Rules', () => {
    it('enforces In Medias Res and bans weather/furniture opening for both profiles', () => {
      const kbmPrompt = buildWriterPrompt({
        chapterNumber: 1,
        brief: mockBrief(),
        genre: 'mystery',
        styleProfile: 'kbm_viral_v1',
      })

      const standardPrompt = buildWriterPrompt({
        chapterNumber: 1,
        brief: mockBrief(),
        genre: 'mystery',
        styleProfile: 'lakoku_mobile_drama_v2',
      })

      for (const prompt of [kbmPrompt, standardPrompt]) {
        // Must contain In Medias Res directive
        expect(prompt.user).toContain('AWALI BAB DENGAN TINDAKAN ATAU DIALOG LANGSUNG (In Medias Res)')
        expect(prompt.user).toContain('DILARANG membuka bab dengan deskripsi cuaca')
        expect(prompt.user).toContain('Tiga kalimat pertama bab WAJIB memuat benturan masalah')

        // Must NOT contain old slow-burn directives
        expect(prompt.user).not.toContain('perlambat tempo agar cerita tidak selesai')
        expect(prompt.user).not.toContain('pembukaan situasi, detail sensorik lingkungan')
      }
    })

    it('customizes system prompt and P3/P4/P5 for kbm_viral_v1', () => {
      const kbmPrompt = buildWriterPrompt({
        chapterNumber: 1,
        brief: mockBrief(),
        genre: 'family_drama',
        styleProfile: 'kbm_viral_v1',
      })

      expect(kbmPrompt.styleProfileId).toBe('kbm_viral_v1')
      expect(kbmPrompt.system).toContain('Kamu penulis web novel viral Indonesia (gaya KBM / Fizzo')
      expect(kbmPrompt.system).toContain('Paragraf mikro (1–2 kalimat pendek)')
      expect(kbmPrompt.system).toContain('Rasio dialog tinggi (45%–55%)')
      expect(kbmPrompt.user).toContain('=== KHUSUS GAYA KBM VIRAL ===')
      expect(kbmPrompt.user).toContain('minimal 16–20 pertukaran dialog')
      expect(kbmPrompt.user).toContain('Micro-injustice')
    })

    it('keeps modern mobile system prompt for lakoku_mobile_drama_v2', () => {
      const standardPrompt = buildWriterPrompt({
        chapterNumber: 1,
        brief: mockBrief(),
        genre: 'fantasy_kingdom',
        styleProfile: 'lakoku_mobile_drama_v2',
      })

      expect(standardPrompt.styleProfileId).toBe('lakoku_mobile_drama_v2')
      expect(standardPrompt.system).toContain('Kamu penulis serial drama mobile / web novel modern Indonesia.')
      expect(standardPrompt.user).not.toContain('=== KHUSUS GAYA KBM VIRAL ===')
      expect(standardPrompt.user).toContain('minimal 12–16 pertukaran dialog')
    })

    it('mobileDramaSystemPrompt generates matching text for both style profiles', () => {
      const kbmSystem = mobileDramaSystemPrompt('kbm_viral_v1')
      expect(kbmSystem).toContain('Kamu penulis web novel viral Indonesia')

      const standardSystem = mobileDramaSystemPrompt('lakoku_mobile_drama_v2')
      expect(standardSystem).toContain('Kamu penulis serial drama mobile / web novel modern Indonesia.')
    })
  })

  describe('Genre Directives across all 6 genres', () => {
    it.each(GENRE_IDS)('includes Hook Pembuka Detik-0 for %s', (genreId) => {
      const directive = buildGenreProseDirective(genreId)
      expect(directive).not.toBeNull()
      expect(directive).toContain('Hook Pembuka Detik-0 (In Medias Res):')

      const flavor = GENRE_PROSE_FLAVORS[genreId]
      expect(flavor.hookGuidance).toBeDefined()
      expect(flavor.hookGuidance.length).toBeGreaterThan(30)
      expect(directive).toContain(flavor.hookGuidance)
    })

    it('injects genre directive properly into buildWriterPrompt', () => {
      const prompt = buildWriterPrompt({
        chapterNumber: 1,
        brief: mockBrief(),
        genre: 'romance',
        styleProfile: 'lakoku_mobile_drama_v2',
      })

      expect(prompt.user).toContain('KARAKTER & ATMOSFER GENRE (ROMANSA):')
      expect(prompt.user).toContain('Hook Pembuka Detik-0 (In Medias Res):')
      expect(prompt.user).toContain('Banter tajam, adu gengsi')
    })
  })

  describe('Contract and Catalog Generator Integration', () => {
    it('validates StoryContractSchema with kbm_viral_v1 styleProfile', () => {
      const base = normalizeCatalogEndings({
        ...fantasiPetualanganContract,
        storyId: 'catalog:test-kbm',
      })

      const contractWithKbm = {
        ...base,
        styleProfile: 'kbm_viral_v1',
      }

      const parsed = StoryContractSchema.safeParse(contractWithKbm)
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.styleProfile).toBe('kbm_viral_v1')
      }
    })

    it('applyPremiseOverlay applies kbm_viral_v1 by default to catalog novels', () => {
      const base = normalizeCatalogEndings({
        ...fantasiPetualanganContract,
        storyId: 'catalog:test-kbm',
      })

      const overlaid = applyPremiseOverlay(base, {
        title: 'Mertua Idaman',
        synopsis: 'Konflik warisan dan talak sepihak.',
        protagonistName: 'Siti',
        tagline: 'Jangan remehkan menantu pendiam.',
      })

      expect(overlaid.styleProfile).toBe('kbm_viral_v1')
      expect(overlaid.title).toBe('Mertua Idaman')
      expect(overlaid.mainCharacter.name).toBe('Siti')
    })
  })
})

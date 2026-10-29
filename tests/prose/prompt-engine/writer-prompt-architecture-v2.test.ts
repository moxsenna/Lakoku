import { describe, expect, it } from 'vitest'
import { buildWriterPrompt } from '@/lib/prose/prompt-engine/build-writer-prompt'
import type { PreProseChapterBrief } from '@/lib/story-engine/pre-prose-brief'

function createTestBrief(overrides: Partial<PreProseChapterBrief> = {}): PreProseChapterBrief {
  return {
    storyId: 'story-1',
    chapterNumber: 2,
    phase: 'rising',
    lockedEndingKey: null,
    lockedEndingClosure: [],
    chapterGoal: 'Uji sapaan dan ritme',
    mustInclude: [],
    mustNotInclude: [],
    mustNotReveal: [],
    forbiddenRevealIds: [],
    resolvedPlotDebtIds: [],
    scheduledReveals: [],
    plotDebtsToProgress: [],
    plotDebtsToClose: [],
    routeStateSummary: 'Rute tegang',
    previousChoiceSummary: '',
    previousChoiceApplied: false,
    ...overrides,
  }
}

describe('writer prompt architecture v2 - cultural honorifics and mobile rhythm', () => {
  it('includes character role and valid honorifics in P0 and P4 when language is id', () => {
    const brief = createTestBrief()
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      brief,
      language: 'id',
      characterDescriptors: [
        {
          name: 'Ragil',
          role: 'Ayah kandung',
          honorifics: ['Bapak', 'Pak', 'Ayah'],
        },
      ],
    })

    expect(prompt.user).toContain('Ragil (Peran: Ayah kandung, sapaan sah: Bapak / Pak / Ayah)')
    expect(prompt.user).toContain('Panggilan honorifik/kekerabatan di atas adalah sebutan sah untuk tokoh bersangkutan')
    expect(prompt.user).toContain('Tata Krama Sapaan Kultural Indonesia')
    expect(prompt.user).toContain('DILARANG menyebut nama telanjang untuk orang tua')
  })

  it('omits Indonesian cultural directives when language is en', () => {
    const brief = createTestBrief()
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      brief,
      language: 'en',
      characterDescriptors: [
        {
          name: 'Ragil',
          role: 'Father',
        },
      ],
    })

    expect(prompt.user).not.toContain('Tata Krama Sapaan Kultural Indonesia')
    expect(prompt.user).not.toContain('Panggilan honorifik/kekerabatan di atas adalah sebutan sah')
  })

  it('renders KBM viral directives in system and user prompts when styleProfile is kbm_viral_v1', () => {
    const brief = createTestBrief()
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      brief,
      styleProfile: 'kbm_viral_v1',
    })

    expect(prompt.styleProfileId).toBe('kbm_viral_v1')
    expect(prompt.system).toContain('Kamu penulis web novel viral Indonesia (gaya KBM / Fizzo: drama intens, emosi mentah, mobile-first).')
    expect(prompt.system).toContain('In Medias Res: Buka bab langsung di tengah masalah, adu mulut, atau aksi.')
    expect(prompt.system).toContain('Rasio dialog tinggi (45%–55%), percakapan saling membalas tajam.')
    expect(prompt.system).toContain('Paragraf mikro (1–2 kalimat pendek), ritme staccato untuk ketegangan.')
    expect(prompt.system).toContain('Reaksi fisik viseral (rahang mengeras, dada sesak, mata memanas, senyum dingin menahan diri).')
    expect(prompt.system).toContain('Deskripsi cuaca atau ruangan di awal bab')
    expect(prompt.system).toContain('Kata-kata: rute, AI, token, skor, bias, ending')

    expect(prompt.user).toContain('AWALI BAB DENGAN TINDAKAN ATAU DIALOG LANGSUNG (In Medias Res)')
    expect(prompt.user).toContain('Setiap adegan WAJIB memuat: interaksi dialog bolak-balik yang hidup, aksi fisik nyata, dan reaksi tubuh tokoh.')
    expect(prompt.user).toContain('Tekankan rasio dialog tinggi: minimal 16–20 pertukaran dialog bolak-balik per adegan')
    expect(prompt.user).toContain('=== KHUSUS GAYA KBM VIRAL ===')
    expect(prompt.user).toContain('Dialog sentris: jadikan percakapan sebagai penggerak utama cerita.')
    expect(prompt.user).toContain('Micro-injustice: angkat hal-hal sepele yang menyengat harga diri dan memicu amarah pembaca.')
    expect(prompt.user).toContain('Sikap tokoh utama: tidak merengek/cengeng; bersikap tenang, dingin, atau menyimpan pembalasan terencana.')
    expect(prompt.user).toContain('Ujung bab: akhiri dengan cliffhanger tajam yang menggantungkan nasib tokoh atau rahasia yang hampir terbongkar.')
  })

  it('renders modern drama directives when styleProfile is lakoku_mobile_drama_v2', () => {
    const brief = createTestBrief()
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      brief,
      styleProfile: 'lakoku_mobile_drama_v2',
    })

    expect(prompt.styleProfileId).toBe('lakoku_mobile_drama_v2')
    expect(prompt.system).toContain('Kamu penulis serial drama mobile / web novel modern Indonesia.')
    expect(prompt.system).toContain('Utamakan membuka bab langsung dengan tindakan atau dialog nyata')
    expect(prompt.system).toContain('Kalimat tunggal bertenaga: Utamakan kalimat tunggal yang lugas, padat, dan bertenaga.')
    expect(prompt.user).toContain('minimal 12–16 pertukaran dialog bolak-balik')
    expect(prompt.user).not.toContain('=== KHUSUS GAYA KBM VIRAL ===')
  })
})

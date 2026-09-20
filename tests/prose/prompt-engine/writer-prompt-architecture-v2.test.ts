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
})

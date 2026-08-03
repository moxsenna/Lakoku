import { describe, expect, it } from 'vitest'
import { createDeterministicProvider } from '../../lib/ai-gateway/provider'
import type { CanonSnapshot, ContinuationContext } from '@lakoku/narrative-core'
import type { ChapterPlan } from '@lakoku/ai-gateway'
import type { PreProseChapterBrief } from '../../lib/story-engine/pre-prose-brief'

describe('planWithContinuation / CC-aware planner', () => {
  const mockSnapshot: CanonSnapshot = {
    storyId: 'story-1',
    blueprints: [
      {
        chapterNumber: 2,
        version: 1,
        phase: 'Fase 2',
        chapterGoal: 'Tujuan Bab 2 dari Blueprint',
        mandatoryBeats: ['Beat 1', 'Beat 2'],
        introducesCharacters: [],
        forbiddenReveals: [],
        allowedStateDelta: {},
        reconciledFromVersion: null,
        reconciliationReason: null,
      },
    ],
    characters: [],
    aliases: [],
    voiceSheets: [],
    facts: [],
    knowledge: [],
    secrets: [],
    timeline: [],
    threads: [],
    actRollups: [],
  }

  const mockBlueprint = mockSnapshot.blueprints[0]

  const mockContinuation: ContinuationContext = {
    storyId: 'story-1',
    targetChapterNumber: 2,
    previousChapter: {
      number: 1,
      title: 'Bab 1 Galeri',
      endingParagraphs: [
        'Nadia menatap Raka di sudut galeri.',
        'Ia membuat keputusan berat.',
        'Malam semakin larut.',
      ],
    },
    previousChoice: {
      chapterNumber: 1,
      choiceId: 'choice-galeri-1',
      label: 'Konfrontasi Raka di galeri',
      consequence: ['Nadia menuduh Raka mencuri lukisan', 'Raka terpojok'],
      effectSummary: { flagsSet: ['tension_high'] },
      createdAt: new Date().toISOString(),
    },
    routeStateSummary: 'Hubungan tegang',
    openThreads: [],
    anchorFacts: [{ id: 'f1', statement: 'Lukisan galeri hilang', establishedChapter: 1, loadBearing: true }],
    recentTimeline: [{ chapterNumber: 1, ordinal: 1, description: 'Nadia bertemu Raka di galeri' }],
    mustNotReveal: [],
  }

  const mockPreProseBrief: PreProseChapterBrief = {
    storyId: 'story-1',
    chapterNumber: 2,
    phase: 'Fase 2',
    lockedEndingKey: null,
    chapterGoal: 'Tujuan Bab 2 dari Brief',
    mustInclude: ['Harus ada konfrontasi lukisan'],
    mustNotInclude: [],
    mustNotReveal: [],
    routeStateSummary: 'Hubungan tegang',
    previousChoiceSummary: 'Pilihan Bab 1',
    previousChoiceApplied: true,
  }

  it('menghasilkan goal dan beats yang merefleksikan pilihan pembaca bila ada continuation', async () => {
    const provider = createDeterministicProvider()
    const plan = (await provider.generatePlan({
      snapshot: mockSnapshot,
      blueprint: mockBlueprint,
      chapterNumber: 2,
      continuation: mockContinuation,
      brief: mockPreProseBrief,
    })) as ChapterPlan

    expect(plan.chapterGoal).toContain('Teruskan langsung dari Bab 1: "Konfrontasi Raka di galeri"')
    expect(plan.chapterGoal).toContain('Konsekuensi kanonik: Nadia menuduh Raka mencuri lukisan / Raka terpojok')

    expect(plan.plannedBeats[0]).toContain('Buka dengan akibat langsung dari keputusan: "Konfrontasi Raka di galeri".')
    expect(plan.plannedBeats[1]).toContain('Hormati titik akhir Bab 1: "Malam semakin larut."')
    expect(plan.plannedBeats).toContain('Beat 1')
    expect(plan.plannedBeats).toContain('Beat 1')
  })

  it('menggunakan goal blueprint bila tidak ada continuation', async () => {
    const provider = createDeterministicProvider()
    const plan = (await provider.generatePlan({
      snapshot: mockSnapshot,
      blueprint: mockBlueprint,
      chapterNumber: 1,
      continuation: null,
      brief: null,
    })) as ChapterPlan

    expect(plan.chapterGoal).toBe('Tujuan Bab 2 dari Blueprint')
    expect(plan.plannedBeats).toEqual(['Beat 1', 'Beat 2'])
  })
})

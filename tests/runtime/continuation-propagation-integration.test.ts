import { describe, expect, it, vi } from 'vitest'
import { generateChapter } from '../../lib/ai-gateway/generate'
import type { GenerationProvider } from '../../lib/ai-gateway/provider'
import type { ContinuationContext, CanonSnapshot, ChapterBlueprint } from '@lakoku/narrative-core'
import type { PreProseChapterBrief } from '../../lib/story-engine/pre-prose-brief'

describe('ContinuationContext Runtime Propagation Integration & Mutation Test', () => {
  const mockSnapshot: CanonSnapshot = {
    storyId: 'story-propagation-test',
    characters: [
      { id: 'nadia', storyId: 'story-propagation-test', canonicalName: 'Nadia', role: 'Protagonis', motivation: 'Mencari kebenaran', introducedChapter: 1, status: 'ALIVE' },
      { id: 'raka', storyId: 'story-propagation-test', canonicalName: 'Raka', role: 'Antagonis', motivation: 'Menyembunyikan rahasia', introducedChapter: 1, status: 'ALIVE' },
    ],
    aliases: [],
    voiceSheets: [],
    facts: [],
    knowledge: [],
    secrets: [],
    timeline: [],
    threads: [],
    actRollups: [],
    blueprints: [
      {
        chapterNumber: 2,
        phase: 'Fase 2',
        chapterGoal: 'Hadapi dampak pengadilan',
        mandatoryBeats: ['Beat 1'],
        introducesCharacters: [],
        forbiddenReveals: [],
        allowedStateDelta: {},
        version: 1,
        reconciledFromVersion: null,
        reconciliationReason: null,
      },
    ],
  }

  const blueprint: ChapterBlueprint = mockSnapshot.blueprints[0]

  const mockContinuation: ContinuationContext = {
    storyId: 'story-propagation-test',
    targetChapterNumber: 2,
    previousChapter: {
      number: 1,
      title: 'Galeri Seni',
      endingParagraphs: ['Nadia menatap Raka di galeri.'],
    },
    previousChoice: {
      chapterNumber: 1,
      choiceId: 'court-choice',
      label: 'Konfrontasi Raka di pengadilan',
      consequence: ['Nadia membawa kasus ke pengadilan'],
      effectSummary: { flagsSet: ['court_path'] },
      createdAt: new Date().toISOString(),
    },
    routeStateSummary: 'Rute pengadilan',
    openThreads: [],
    anchorFacts: [{ id: 'f1', statement: 'Kasus pengadilan diajukan', establishedChapter: 1, loadBearing: true }],
    recentTimeline: [{ chapterNumber: 1, ordinal: 1, description: 'Konfrontasi terjadi' }],
    mustNotReveal: [],
    storyAnchors: null,
    actRollups: [],
    lockedEndingKey: null,
  }

  const mockBrief: PreProseChapterBrief = {
    storyId: 'story-propagation-test',
    chapterNumber: 2,
    phase: 'Fase 2',
    lockedEndingKey: null,
    chapterGoal: 'Hadapi pengadilan',
    mustInclude: ['Beat 1'],
    mustNotInclude: [],
    mustNotReveal: [],
    forbiddenRevealIds: [],
    resolvedPlotDebtIds: [],
    scheduledReveals: [],
    plotDebtsToProgress: [],
    plotDebtsToClose: [],
    lockedEndingClosure: [],
    routeStateSummary: 'Rute pengadilan',
    previousChoiceSummary: 'Pilihan Bab 1',
    previousChoiceApplied: true,
  }

  it('memastikan provider.writeChapter menerima exact ContinuationContext (N=2, court-choice)', async () => {
    const mockProvider = {
      name: 'spy-provider',
      generatePlan: vi.fn().mockResolvedValue({
        storyId: 'story-propagation-test',
        chapterNumber: 2,
        phase: 'Fase 2',
        chapterGoal: 'Goal',
        plannedBeats: ['Beat 1'],
        usesReveals: [],
        proposedStateDelta: {},
        targetWordCount: 500,
        targetSceneCount: 2,
      }),
      writeChapter: vi.fn().mockResolvedValue({
        storyId: 'story-propagation-test',
        chapterNumber: 2,
        title: 'Bab 2 Pengadilan Galeri',
        paragraphs: [
          'Nadia melangkah ke ruang sidang pengadilan.',
          'Konfrontasi Raka di galeri membawanya ke sini.',
          'Sidang pengadilan dimulai.',
        ],
        wordCount: 25,
        sceneCount: 1,
        hasChoiceOrGate: false,
        events: [],
        knowledgeAssertions: [],
      }),
    } satisfies GenerationProvider

    await generateChapter(
      { provider: mockProvider },
      {
        snapshot: mockSnapshot,
        blueprint,
        chapterNumber: 2,
        continuation: mockContinuation,
        brief: mockBrief,
      },
    )

    expect(mockProvider.writeChapter).toHaveBeenCalled()
    const writeInput = mockProvider.writeChapter.mock.calls[0][0]

    expect(writeInput.continuation).toBeDefined()
    expect(writeInput.continuation?.previousChoice?.choiceId).toBe('court-choice')
    expect(writeInput.continuation?.previousChoice?.consequence).toContain('Nadia membawa kasus ke pengadilan')
  })

  it('MUTATION TEST: jika propagasi continuation diputus, provider tidak menerima continuation', async () => {
    const mockProvider = {
      name: 'spy-provider-mutated',
      generatePlan: vi.fn().mockResolvedValue({
        storyId: 'story-propagation-test',
        chapterNumber: 2,
        phase: 'Fase 2',
        chapterGoal: 'Goal',
        plannedBeats: ['Beat 1'],
        usesReveals: [],
        proposedStateDelta: {},
        targetWordCount: 500,
        targetSceneCount: 2,
      }),
      writeChapter: vi.fn().mockResolvedValue({
        storyId: 'story-propagation-test',
        chapterNumber: 2,
        title: 'Bab 2 Pengadilan',
        paragraphs: [
          'Nadia melangkah ke ruang sidang pengadilan.',
          'Konfrontasi Raka di galeri membawanya ke sini.',
          'Sidang pengadilan dimulai.',
        ],
        wordCount: 25,
        sceneCount: 1,
        hasChoiceOrGate: false,
        events: [],
        knowledgeAssertions: [],
      }),
    } satisfies GenerationProvider

    // Simulasi mutasi: panggil generateChapter TANPA meneruskan continuation
    await generateChapter(
      { provider: mockProvider },
      {
        snapshot: mockSnapshot,
        blueprint,
        chapterNumber: 2,
        continuation: null, // MUTATED
        brief: null,
      },
    )

    const writeInput = mockProvider.writeChapter.mock.calls[0][0]
    expect(writeInput.continuation).toBeNull()
  })
})

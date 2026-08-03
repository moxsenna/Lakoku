import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/ai-gateway/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ai-gateway/gateway')>()
  return {
    ...actual,
    generatePlan: vi.fn(),
    writeChapter: vi.fn(),
    evaluateSemanticContinuity: vi.fn(),
  }
})

import { generateChapter } from '../../lib/ai-gateway/generate'
import * as gateway from '../../lib/ai-gateway/gateway'
import type { CanonSnapshot } from '../../lib/narrative/types'
import type { ChapterPlan, ChapterDraftParsed } from '../../lib/ai-gateway/schemas'
import { SEMANTIC_JUDGE_UNAVAILABLE } from '../../lib/ai-gateway/semantic-continuation-judge'
import {
  NADIA_RAKA_BLUEPRINT,
  NADIA_RAKA_BRIEF_A,
  NADIA_RAKA_CONTINUATION_A,
  NADIA_RAKA_STORY_ID,
  nadiaRakaSnapshot,
} from '../../fixtures/narrative/nadia-raka-continuity'

const snapshot: CanonSnapshot = {
  ...nadiaRakaSnapshot(),
  facts: [
    {
      id: 'f-laporan',
      storyId: NADIA_RAKA_STORY_ID,
      statement: 'Laporan hukum diajukan terhadap Raka',
      subjectCharacterId: 'nadia',
      establishedChapter: 1,
      salience: 1,
      loadBearing: true,
      paidOff: false,
    },
  ],
}

function makePlan(): ChapterPlan {
  return {
    storyId: NADIA_RAKA_STORY_ID,
    chapterNumber: 2,
    phase: 'Fase 2',
    chapterGoal: 'Konfrontasi atau Pelarian',
    plannedBeats: ['Lanjutkan konflik di galeri'],
    targetWordCount: 600,
    targetSceneCount: 2,
    opensThreadId: null,
    usesReveals: [],
    proposedStateDelta: {},
    introducesCharacters: [],
  }
}

const filler = (base: string): string =>
  Array.from({ length: 150 }, (_, i) => `${base}-${i}`).join(' ')

function makeDraft(overrides: Partial<ChapterDraftParsed> = {}): ChapterDraftParsed {
  // Harus lolos batas keras Layer A: 500–1200 kata, 2–4 scene, ada choice/gate.
  return {
    storyId: NADIA_RAKA_STORY_ID,
    chapterNumber: 2,
    title: 'Bab 2',
    paragraphs: [
      `Nadia menahan Raka di galeri. ${filler('laporan pengadilan')}`,
      `Nadia memutuskan mengajukan laporan. ${filler('keputusan malam ini')}`,
      `Raka terdesak oleh tuduhan. ${filler('bukti di gudang')}`,
      `Konsekuensi laporan mulai terasa. ${filler('jalan terbuka')}`,
    ],
    wordCount: 600,
    sceneCount: 2,
    hasChoiceOrGate: true,
    events: [],
    knowledgeAssertions: [],
    reveals: [],
    proposedStateDelta: {},
    newNamedCharacters: [],
    dialogue: [],
    emotionBeats: [],
    softClaims: [],
    ...overrides,
  }
}

/** Soft claim kontradiktif atas fakta canon → Layer B MAJOR (SOFT_CONTRADICTION). */
function softContradictionDraft(): ChapterDraftParsed {
  return makeDraft({
    softClaims: [{ characterId: 'nadia', factId: 'f-laporan', agrees: false }],
  })
}

const deps = { provider: {} } as gateway.GatewayDeps
const generatePlanMock = vi.mocked(gateway.generatePlan)
const writeChapterMock = vi.mocked(gateway.writeChapter)
const evaluateSemanticContinuityMock = vi.mocked(gateway.evaluateSemanticContinuity)

afterEach(() => {
  // resetAllMocks (bukan clearAllMocks): hapus juga queue mockResolvedValueOnce
  // yang belum ter-consumed agar tidak bocor antar test.
  vi.resetAllMocks()
})

describe('generateChapter — Layer B repair seam & Layer C publish gate', () => {
  it('passes the SAME continuation + brief to writeChapter during Layer B repair', async () => {
    generatePlanMock.mockResolvedValueOnce(makePlan())
    writeChapterMock.mockResolvedValueOnce(softContradictionDraft()).mockResolvedValueOnce(makeDraft())
    evaluateSemanticContinuityMock.mockResolvedValueOnce({ verdict: 'PASS', codes: [] })

    const result = await generateChapter(deps, {
      snapshot,
      blueprint: NADIA_RAKA_BLUEPRINT,
      chapterNumber: 2,
      continuation: NADIA_RAKA_CONTINUATION_A,
      brief: NADIA_RAKA_BRIEF_A,
    })

    expect(result.status).toBe('PUBLISHED')
    expect(writeChapterMock).toHaveBeenCalledTimes(2)
    expect(evaluateSemanticContinuityMock).toHaveBeenCalledTimes(1)

    // Mutation-sensitive: Layer B repair (call #2) WAJIB menerima continuation
    // dan brief yang sama persis, bukan hanya repairFindings.
    const repairArgs = writeChapterMock.mock.calls[1][1]
    expect(repairArgs.continuation).toEqual(NADIA_RAKA_CONTINUATION_A)
    expect(repairArgs.brief).toEqual(NADIA_RAKA_BRIEF_A)
    expect(repairArgs.repairFindings?.length).toBeGreaterThan(0)
  })

  it('re-runs Layer A after Layer B repair — Layer A violation → FAILED_REVIEW_REQUIRED', async () => {
    generatePlanMock.mockResolvedValueOnce(makePlan())

    // Call #1: memicu Layer B repair. Call #2: lolos Layer B tapi melanggar
    // Layer A (mention tak dikenal) — regresi yang dulu lolos publish.
    writeChapterMock
      .mockResolvedValueOnce(softContradictionDraft())
      .mockResolvedValueOnce(
        makeDraft({
          events: [
            {
              characterMention: 'Sari',
              description: 'Orang tak dikenal muncul',
              ordinal: 1,
              occursAt: null,
              isFlashback: false,
            },
          ],
        }),
      )

    evaluateSemanticContinuityMock.mockResolvedValueOnce({ verdict: 'PASS', codes: [] })

    const result = await generateChapter(deps, {
      snapshot,
      blueprint: NADIA_RAKA_BLUEPRINT,
      chapterNumber: 2,
      continuation: NADIA_RAKA_CONTINUATION_A,
      brief: NADIA_RAKA_BRIEF_A,
    })

    expect(result.status).toBe('FAILED_REVIEW_REQUIRED')
    expect(result.failedLayer).toBe('A')
    expect(writeChapterMock).toHaveBeenCalledTimes(2)
    // Recheck terjadi SEBELUM judge — judge tidak boleh dijalankan atas draft
    // yang sudah gagal Layer A.
    expect(evaluateSemanticContinuityMock).toHaveBeenCalledTimes(0)
  })

  it('technical judge failure → throws SEMANTIC_JUDGE_UNAVAILABLE (retryable, no publish)', async () => {
    generatePlanMock.mockResolvedValueOnce(makePlan())
    writeChapterMock.mockResolvedValueOnce(makeDraft())
    evaluateSemanticContinuityMock.mockRejectedValueOnce(new Error('Model timeout'))

    await expect(
      generateChapter(deps, {
        snapshot,
        blueprint: NADIA_RAKA_BLUEPRINT,
        chapterNumber: 2,
        continuation: NADIA_RAKA_CONTINUATION_A,
        brief: NADIA_RAKA_BRIEF_A,
      }),
    ).rejects.toThrow(SEMANTIC_JUDGE_UNAVAILABLE)
  })

  it('semantic FAIL → maksimal 1 rewrite → judge #2 PASS → PUBLISHED', async () => {
    generatePlanMock.mockResolvedValueOnce(makePlan())

    writeChapterMock
      .mockResolvedValueOnce(makeDraft())
      .mockResolvedValueOnce(makeDraft({ title: 'Bab 2 (semantic repair)' }))

    evaluateSemanticContinuityMock
      .mockResolvedValueOnce({ verdict: 'FAIL', codes: ['CHOICE_CONSEQUENCE_REVERSED'] })
      .mockResolvedValueOnce({ verdict: 'PASS', codes: [] })

    const result = await generateChapter(deps, {
      snapshot,
      blueprint: NADIA_RAKA_BLUEPRINT,
      chapterNumber: 2,
      continuation: NADIA_RAKA_CONTINUATION_A,
      brief: NADIA_RAKA_BRIEF_A,
    })

    expect(result.status).toBe('PUBLISHED')
    expect(writeChapterMock).toHaveBeenCalledTimes(2) // 1 initial + 1 semantic rewrite
    expect(evaluateSemanticContinuityMock).toHaveBeenCalledTimes(2)

    // Judge menerima bounded POV context (Nadia, first-person) dari canon.
    const judgeArg = evaluateSemanticContinuityMock.mock.calls[0][1] as {
      povCharacter?: string
      povMode?: string
    }
    expect(judgeArg.povCharacter).toBe('Nadia')
    expect(judgeArg.povMode).toBe('first-person')

    const rewriteArgs = writeChapterMock.mock.calls[1][1]
    expect(rewriteArgs.continuation).toEqual(NADIA_RAKA_CONTINUATION_A)
    expect(rewriteArgs.brief).toEqual(NADIA_RAKA_BRIEF_A)
    const semanticCodes = (rewriteArgs.repairFindings ?? []).map((f) => f.code)
    expect(semanticCodes).toContain('SEMANTIC_CHOICE_CONSEQUENCE_REVERSED')

    // Cleanup: MAJOR semantic dari draft pra-rewrite TIDAK boleh masuk findings
    // final — sudah direpair dan diverifikasi judge #2 PASS.
    const finalCodes = result.findings.map((f) => f.code)
    expect(finalCodes).not.toContain('SEMANTIC_CHOICE_CONSEQUENCE_REVERSED')
  })

  it('post-semantic rewrite is VALIDATION-ONLY — Layer B fail → FAILED_REVIEW_REQUIRED, no extra loop', async () => {
    generatePlanMock.mockResolvedValueOnce(makePlan())

    // Call #2 (semantic rewrite) memicu Layer B MAJOR — validation-only berarti
    // TIDAK ada repair loop tambahan setelahnya.
    writeChapterMock.mockResolvedValueOnce(makeDraft()).mockResolvedValueOnce(softContradictionDraft())

    evaluateSemanticContinuityMock.mockResolvedValueOnce({
      verdict: 'FAIL',
      codes: ['UNEXPLAINED_TRANSITION'],
    })

    const result = await generateChapter(deps, {
      snapshot,
      blueprint: NADIA_RAKA_BLUEPRINT,
      chapterNumber: 2,
      continuation: NADIA_RAKA_CONTINUATION_A,
      brief: NADIA_RAKA_BRIEF_A,
    })

    expect(result.status).toBe('FAILED_REVIEW_REQUIRED')
    expect(result.failedLayer).toBe('B')
    expect(writeChapterMock).toHaveBeenCalledTimes(2) // persis 2, tidak ada loop tambahan
    expect(evaluateSemanticContinuityMock).toHaveBeenCalledTimes(1) // judge #2 tidak pernah dijalankan
  })
})

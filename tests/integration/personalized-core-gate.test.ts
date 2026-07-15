import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ adminFactory: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/ai-gateway', async () => {
  const { ChoiceEffectSchema } = await import('@/lib/ai-gateway/schemas')
  return { ChoiceEffectSchema }
})
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))

import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { validateChoiceBranch } from '@/lib/ai-gateway/schemas'
import { buildChapterBrief, ChapterBriefSchema } from '@/lib/story-engine/chapter-brief'
import { resolveEnding } from '@/lib/story-engine/ending-resolver'
import { mergeChoiceEffect } from '@/lib/story-engine/route-state'
import { parseStoryContract } from '@/lib/story-engine/story-contract'
import type { CanonSnapshot } from '@/lib/narrative/types'
import { ChapterSchema } from '@/packages/contracts/src/reader'

function snapshot(): CanonSnapshot {
  return {
    storyId: misteriDramaContract.storyId,
    characters: [],
    aliases: [],
    voiceSheets: [],
    facts: [],
    knowledge: [],
    secrets: [
      { id: 'secret-late', description: 'Rahasia terakhir.', revealGateChapter: 45, revealed: false },
    ],
    timeline: [],
    threads: [],
    actRollups: [],
    blueprints: Array.from({ length: 50 }, (_, index) => ({
      chapterNumber: index + 1,
      version: 1,
      phase: `Blueprint phase ${index + 1}`,
      chapterGoal: `Blueprint goal ${index + 1}`,
      mandatoryBeats: [`Blueprint beat ${index + 1}`],
      forbiddenReveals: index + 1 < 45 ? ['secret-late'] : [],
      allowedStateDelta: {},
      introducesCharacters: [],
      reconciledFromVersion: null,
      reconciliationReason: null,
    })),
  }
}

function validChoiceBranch(chapterNumber = 49) {
  return {
    choicePrompt: 'Apa yang Maya lakukan sekarang?',
    choices: [
      { id: 'publish-archive', label: 'Buka arsip kepada warga kota' },
      { id: 'protect-witness', label: 'Lindungi saksi sebelum bersaksi' },
    ],
    outcomes: [
      {
        choiceId: 'publish-archive',
        consequence: ['Maya menyerahkan salinan arsip kepada warga.'],
        nextChapterNumber: chapterNumber + 1,
        isEnding: false,
        effect: {},
      },
      {
        choiceId: 'protect-witness',
        consequence: ['Maya membawa para saksi menuju tempat aman.'],
        nextChapterNumber: chapterNumber + 1,
        isEnding: false,
        effect: {},
      },
    ],
  }
}

let rpc: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  rpc = vi.fn().mockResolvedValue({
    data: { ok: true, chapter_number: 50, seq: 50 },
    error: null,
  })
  mocks.adminFactory.mockReturnValue({ rpc })
})

function assertSnapshotUniform(snap: CanonSnapshot, expectedStoryId: string): void {
  for (const char of snap.characters) {
    expect(char.storyId, `character ${char.id} storyId`).toBe(expectedStoryId)
  }
  for (const fact of snap.facts) {
    expect(fact.storyId, `fact ${fact.id} storyId`).toBe(expectedStoryId)
  }
  for (const thread of snap.threads) {
    // CanonSnapshot story threads do not carry a storyId field; skip.
    void thread
  }
}

describe('personalized Phase 1-3 core gate', () => {
  it('carries a valid contract through route merge, ending lock, final brief, and final choice guard', () => {
    const contract = parseStoryContract(structuredClone(misteriDramaContract))
    const snap = structuredClone(snapshot())
    assertSnapshotUniform(snap, contract.storyId)

    const effect = {
      routeDeltas: { truth: 3 },
      trustDeltas: { 'Jurnalis Sekutu': 2 },
      flagsSet: { protectedWitnesses: true },
      evidenceAdded: ['salinan buku debit hujan'],
      endingBiasDeltas: { 'protect-witnesses': 8 },
      threadTouches: ['main_mystery'],
    }
    const initialState = {
      truth: 16,
      trust: { 'Jurnalis Sekutu': 7 },
      evidence: ['kunci pintu air'],
      endingBias: { 'publish-truth': 2 },
    }
    const before = structuredClone({ contract, snap, effect, initialState })

    const routeState = mergeChoiceEffect(initialState, effect)
    const ending = resolveEnding({
      routeState,
      storyContract: contract,
      chapterNumber: 45,
      lockedEndingKey: null,
    })
    const finalBrief = buildChapterBrief({
      storyContract: contract,
      snapshot: snap,
      readerState: {
        routeState,
        choiceHistory: [],
        lockedEndingKey: ending.key,
      },
      chapterNumber: 50,
      previousChoice: null,
    })

    expect(routeState).toMatchObject({
      truth: 19,
      trust: { 'Jurnalis Sekutu': 9 },
      evidence: ['kunci pintu air', 'salinan buku debit hujan'],
      flags: { protectedWitnesses: true },
      endingBias: { 'publish-truth': 2, 'protect-witnesses': 8 },
    })
    expect(ending).toEqual({
      key: 'protect-witnesses',
      name: 'Kebenaran yang Dijaga',
      requiredClosure: contract.endingCandidates[1].requiredClosure,
    })
    expect(finalBrief).toMatchObject({
      storyId: contract.storyId,
      chapterNumber: 50,
      lockedEndingKey: ending.key,
      endingRunway: 'final',
      allowsChoices: false,
      finalChapter: true,
    })
    expect(ChapterBriefSchema.safeParse(finalBrief).success).toBe(true)
    expect(() => validateChoiceBranch(validChoiceBranch(), 50)).toThrowError(
      expect.objectContaining({
        code: 'CHOICES_NOT_ALLOWED',
        message: 'Bab terakhir tidak memiliki pilihan.',
      }),
    )
    expect({ contract, snap, effect, initialState }).toEqual(before)
  })

  it.each([
    { name: 'null', choices: null },
    { name: 'empty', choices: [] },
  ])('publishes chapter 50 with $name choices without changing reader contract', async ({ choices }) => {
    const readerShapeBefore = Object.keys(ChapterSchema.shape)
    const input = {
      storyId: misteriDramaContract.storyId,
      chapterNumber: 50,
      title: 'Arsip Setelah Hujan',
      paragraphs: ['Maya menutup pintu arsip setelah seluruh kesaksian selesai.'],
      choicePrompt: null,
      choices,
      outcomes: [],
      leaseId: 'lease-final',
      idempotencyKey: `publish-final-${choices === null ? 'null' : 'empty'}`,
    }
    const before = structuredClone(input)
    const { publishChapterV2 } = await import('@/lib/runtime/lifecycle')

    await publishChapterV2(input)

    expect(mocks.adminFactory).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('publish_chapter_v2', {
      p_story_id: input.storyId,
      p_chapter_number: 50,
      p_title: input.title,
      p_paragraphs: input.paragraphs,
      p_choice_prompt: null,
      p_choices: choices,
      p_outcomes: [],
      p_lease_id: input.leaseId,
      p_idempotency_key: input.idempotencyKey,
    })
    expect(input).toEqual(before)
    expect(Object.keys(ChapterSchema.shape)).toEqual(readerShapeBefore)
    expect(readerShapeBefore).toEqual([
      'storyId',
      'number',
      'title',
      'paragraphs',
      'choicePrompt',
      'choices',
    ])
    expect(ChapterSchema.parse({
      storyId: input.storyId,
      number: input.chapterNumber,
      title: input.title,
      paragraphs: input.paragraphs,
    })).toEqual({
      storyId: input.storyId,
      number: 50,
      title: input.title,
      paragraphs: input.paragraphs,
    })
  })
})

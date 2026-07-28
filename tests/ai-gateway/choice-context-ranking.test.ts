import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { buildChapterBrief } from '@/lib/story-engine/chapter-brief'
import { normalizeRouteState } from '@/lib/story-engine/route-state'
import { __projectChoiceInputForTests } from '@/lib/ai-gateway/gateway'
import type { ChoiceInput } from '@/lib/ai-gateway/provider'
import type { ChapterDraftParsed } from '@/lib/ai-gateway/schemas'
import type { CanonSnapshot } from '@lakoku/narrative-core'

function fixtureDraft(chapterNumber: number, paragraphs: string[]): ChapterDraftParsed {
  return {
    storyId: 'fixture:warisan-terkubur',
    chapterNumber,
    title: `Bab ${chapterNumber}`,
    paragraphs,
    wordCount: 35,
    sceneCount: 1,
    hasChoiceOrGate: true,
    events: [],
    knowledgeAssertions: [],
    reveals: [],
    proposedStateDelta: {},
    newNamedCharacters: [],
    dialogue: [],
    emotionBeats: [],
    softClaims: [],
  } as ChapterDraftParsed
}

function baseChoiceInput(chapterNumber = 12): ChoiceInput {
  const snapshot = buildFixtureSnapshot() as CanonSnapshot
  const contractSnapshot = structuredClone(snapshot)
  contractSnapshot.storyId = misteriDramaContract.storyId
  const routeState = normalizeRouteState({ truth: 4, risk: 2, flags: {} })
  const chapterBrief = buildChapterBrief({
    storyContract: misteriDramaContract,
    snapshot: contractSnapshot,
    readerState: { routeState, choiceHistory: [], lockedEndingKey: null },
    chapterNumber,
    previousChoice: null,
  })
  const lastParagraphs = [
    'Ratna mendekat dari lorong yang gelap.',
    'Kunci kecil itu terasa dingin di telapak tangannya.',
    'Suara langkah berhenti tepat di balik pintu.',
  ]
  return {
    snapshot,
    chapterBrief,
    draft: fixtureDraft(chapterNumber, lastParagraphs),
    lastParagraphs: lastParagraphs as unknown as ChoiceInput['lastParagraphs'],
    routeState,
    choiceHistory: [],
    lockedEndingKey: chapterBrief.lockedEndingKey,
  }
}

describe('P1-4 choice context ranking + hard-constraint preservation', () => {
  it('caps active characters and threads to 6 each', () => {
    const input = baseChoiceInput()
    const projected = __projectChoiceInputForTests(input)
    expect(projected.canon.activeCharacters.length).toBeLessThanOrEqual(6)
    expect(projected.canon.activeThreads.length).toBeLessThanOrEqual(6)
  })

  it('preserves ALL unrevealed pending reveals (hard safety constraint, never ranked out)', () => {
    const input = baseChoiceInput()
    const unrevealed = input.snapshot.secrets.filter((s) => !s.revealed)
    const projected = __projectChoiceInputForTests(input)
    expect(projected.canon.pendingReveals.length).toBe(unrevealed.length)
    const projectedIds = new Set(projected.canon.pendingReveals.map((r) => r.id))
    for (const s of unrevealed) {
      expect(projectedIds.has(s.id)).toBe(true)
    }
  })

  it('keeps chapterBrief.mustNotReveal intact (not subject to ranking)', () => {
    const input = baseChoiceInput()
    const projected = __projectChoiceInputForTests(input)
    expect(projected.chapterBrief.mustNotReveal).toEqual(input.chapterBrief.mustNotReveal)
  })
})

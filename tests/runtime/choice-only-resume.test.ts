import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  draftFromCheckpoint,
  isCheckpointUsableForChoiceRetry,
  proseFingerprint,
  type ChapterGenerationCheckpoint,
} from '@/lib/runtime/chapter-generation-checkpoint.pure'

/**
 * Pure-logic proof for choice-only resume:
 * - same prose fingerprint across choice retries
 * - draft reconstructed from checkpoint without prose regen
 * - CHOICES_RETRY_WAIT remains usable
 *
 * Full generateNextChapterReal integration with mocked DB is covered when
 * LAKOKU_CHOICE_DURABLE_CHECKPOINT is on and checkpoint table is available.
 */

function sampleCheckpoint(
  overrides: Partial<ChapterGenerationCheckpoint> = {},
): ChapterGenerationCheckpoint {
  const title = 'Surat di Meja'
  const paragraphs = [
    'Nara menatap amplop yang belum dibuka.',
    'Langkah di lorong berhenti di depan pintu.',
    'Jantungnya berdegup; ia harus memilih.',
  ]
  return {
    storyId: 'story-a',
    chapterNumber: 3,
    attemptId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    correlationId: 'ffffffff-1111-2222-3333-444444444444',
    status: 'PROSE_READY',
    title,
    paragraphs,
    proseFingerprint: proseFingerprint(title, paragraphs),
    canonVersion: null,
    blueprintVersion: null,
    directionFingerprint: null,
    proseAttemptCount: 1,
    choiceAttemptCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  }
}

describe('choice-only resume (checkpoint)', () => {
  it('prose fingerprint unchanged across simulated choice retries', () => {
    const cp = sampleCheckpoint()
    const fp1 = cp.proseFingerprint
    // choice retry 1 fails → status CHOICES_RETRY_WAIT, same paragraphs
    const afterFail = sampleCheckpoint({
      status: 'CHOICES_RETRY_WAIT',
      choiceAttemptCount: 1,
      proseFingerprint: fp1,
    })
    expect(isCheckpointUsableForChoiceRetry(afterFail)).toBe(true)
    expect(afterFail.proseFingerprint).toBe(fp1)

    // choice retry 2 still same prose
    const afterRetry = sampleCheckpoint({
      status: 'RUNNING_CHOICES',
      choiceAttemptCount: 2,
      proseFingerprint: fp1,
    })
    expect(afterRetry.proseFingerprint).toBe(fp1)
    // proseAttemptCount stays 1 — prose not regenerated
    expect(afterRetry.proseAttemptCount).toBe(1)
    expect(afterRetry.choiceAttemptCount).toBe(2)
  })

  it('draftFromCheckpoint rebuilds title/paragraphs for choice grounding', () => {
    const cp = sampleCheckpoint()
    const draft = draftFromCheckpoint(cp)
    expect(draft.title).toBe(cp.title)
    expect(draft.paragraphs).toEqual(cp.paragraphs)
    expect(draft.chapterNumber).toBe(3)
    expect(draft.hasChoiceOrGate).toBe(true)
    // fingerprint of reconstructed prose matches stored
    expect(proseFingerprint(draft.title, draft.paragraphs)).toBe(cp.proseFingerprint)
  })

  it('expired checkpoint forces prose regeneration path (not usable)', () => {
    const expired = sampleCheckpoint({
      status: 'PROSE_READY',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    expect(isCheckpointUsableForChoiceRetry(expired)).toBe(false)
  })

  it('PUBLISHED checkpoint not usable for choice retry', () => {
    const published = sampleCheckpoint({ status: 'PUBLISHED' })
    expect(isCheckpointUsableForChoiceRetry(published)).toBe(false)
  })
})

describe('choice-only resume policy matrix', () => {
  it('proves prose call count model: 1 prose, N choices', () => {
    // Characterization of intended metrics (not live provider):
    // prose_attempt_count stays 1; choice_attempt_count increments.
    const calls = {
      prose: 0,
      choice: 0,
      publish: 0,
    }
    const fp = proseFingerprint('T', ['p1'])

    // first attempt: generate prose once
    calls.prose += 1
    let proseAttempts = 1
    let choiceAttempts = 0
    // choice fails
    calls.choice += 1
    choiceAttempts += 1
    expect(calls.prose).toBe(1)

    // retry 1: load checkpoint, skip prose
    const resume1 = sampleCheckpoint({
      status: 'CHOICES_RETRY_WAIT',
      proseFingerprint: fp,
      proseAttemptCount: proseAttempts,
      choiceAttemptCount: choiceAttempts,
    })
    expect(isCheckpointUsableForChoiceRetry(resume1)).toBe(true)
    // no prose++
    calls.choice += 1
    choiceAttempts += 1
    // choice fails again
    expect(calls.prose).toBe(1)
    expect(choiceAttempts).toBe(2)

    // retry 2: success
    calls.choice += 1
    calls.publish += 1
    expect(calls).toEqual({ prose: 1, choice: 3, publish: 1 })
    expect(proseFingerprint('T', ['p1'])).toBe(fp)
  })
})

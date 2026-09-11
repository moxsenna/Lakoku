/**
 * M10-C — branch-fork primitive (plan C.4.5, G.2.2).
 *
 * The harness must be able to clone/restore an isolated canonical snapshot at a
 * legal choice boundary and run two DIFFERENT accepted choices without
 * cross-story contamination.
 *
 * Production ownership model: a personalized story is private and its accepted
 * choices can only be applied for the OWNER (`applyPersonalizedChoiceAuthorized`
 * rejects any other user with NOT_PERSONALIZED_STORY). Two readers on ONE story
 * is therefore not a legal production shape. The fork instead materializes two
 * isolated canonical snapshots as two isolated STORIES, one per branch:
 *
 *   snapshot equivalence — both branches are seeded from the same fixture and
 *   driven through the production runtime with the identical deterministic
 *   choice policy up to the fork chapter. Because the provider and the policy
 *   are deterministic, the per-chapter captureHash of the two branches must be
 *   byte-identical through the fork chapter: that IS the proof that branch B
 *   starts from a canonical snapshot equivalent to branch A's (stronger than a
 *   row copier, because every row was produced by the production path).
 *
 *   divergence — at the fork chapter the two branches submit two DIFFERENT
 *   legal choices through the production accepted-choice seam, then continue
 *   through the next act boundary. Each branch's canon advances exactly once
 *   per chapter, each reader history records only its own fork choice, and no
 *   branch's commit ledger references the other story.
 *
 * Deterministic only (NARRATIVE_PROVIDER must not be 'gateway').
 */

import { randomUUID } from 'node:crypto'
import { createAdminClient } from '../../supabase/admin'
import { applyPersonalizedChoiceAuthorized } from '../../api/personalized-choice.server'
import { generateNextPersonalizedChapter } from '../../runtime/personalized-generation'
import type { LongHorizonFindingV1 } from '../contracts/evaluator-contract'
import { sortFindings } from '../scoring/canonical-serializer'
import { captureChapter } from './capture'
import { loadPublishedChoices, selectDeterministicChoice } from './choice'
import { ACT_PLAN, harnessProposalFor } from './fixture'
import {
  HARNESS_USER_ID,
  assertChapterUnlockPricingConfigured,
  assertHarnessStoryId,
  assertIsolatedTarget,
  cleanupHarnessStory,
  ensureHarnessUser,
  seedHarnessStory,
} from './seed'
import { assertDeterministicProvider } from './run'

type Admin = ReturnType<typeof createAdminClient>

export const FORK_STORY_A_ID = 'm10c-fork-a'
export const FORK_STORY_B_ID = 'm10c-fork-b'

export class HarnessForkError extends Error {
  constructor(message: string) {
    super(`HarnessForkError: ${message}`)
    this.name = 'HarnessForkError'
  }
}

export interface ForkBranchStateV1 {
  storyId: string
  userId: string
  forkChoiceId: string | null
  forkChoiceLabel: string
  currentChapter: number
  /** One commit per chapter 1..throughChapter inside THIS branch's story. */
  singleCanonSpine: boolean
  commitsPerChapter: Array<{ chapterNumber: number; commitCount: number }>
}

export interface ForkEvidenceV1 {
  schemaVersion: 1
  forkChapter: number
  throughChapter: number
  branchA: ForkBranchStateV1
  branchB: ForkBranchStateV1
  /**
   * Per-chapter captureHash identity between the two branches through the fork
   * chapter — the snapshot-equivalence proof.
   */
  preForkCaptureParity: boolean
  preForkParityMismatches: number[]
  /** A branch's reader history carrying the OTHER branch's fork choice. */
  crossLeakDetected: boolean
}

export interface RunForkProbeInput {
  admin?: Admin
  /** The chapter whose published choices the two branches diverge on. */
  forkChapter: number
  /**
   * Optional pin of the two fork choice ids (run-spec forkPlan). When given,
   * both ids must exist among the fork chapter's published choices and are
   * used verbatim; otherwise the probe derives the first two sorted ids.
   */
  choiceIds?: string[]
  reseed?: boolean
}

export async function runForkProbe(input: RunForkProbeInput): Promise<{
  evidence: ForkEvidenceV1
  findings: LongHorizonFindingV1[]
}> {
  assertDeterministicProvider()
  assertIsolatedTarget()
  const admin = input.admin ?? createAdminClient()
  const storyA = FORK_STORY_A_ID
  const storyB = FORK_STORY_B_ID
  assertHarnessStoryId(storyA)
  assertHarnessStoryId(storyB)

  const { forkChapter } = input
  const act = ACT_PLAN.find((a) => forkChapter >= a.fromChapter && forkChapter <= a.toChapter)
  if (!act) throw new HarnessForkError(`fork chapter ${forkChapter} is outside the act plan`)
  // C.4.5: both branches must run through the NEXT act boundary after the fork.
  const throughChapter = act.toChapter
  if (!Number.isInteger(forkChapter) || forkChapter < 1 || forkChapter >= throughChapter) {
    throw new HarnessForkError(
      `fork chapter ${forkChapter} must be < the act boundary ${throughChapter}`,
    )
  }

  const userId = HARNESS_USER_ID
  await assertChapterUnlockPricingConfigured(admin)
  await ensureHarnessUser(admin, userId)
  if (input.reseed !== false) {
    for (const storyId of [storyA, storyB]) {
      await cleanupHarnessStory(admin, storyId)
      await seedHarnessStory({ admin, storyId, userId })
    }
  }

  const generate = async (storyId: string, chapterNumber: number, triggerChoiceId: string | null) => {
    const result = await generateNextPersonalizedChapter({
      storyId,
      userId,
      chapterNumber,
      correlationId: randomUUID(),
      attemptId: randomUUID(),
      triggerChoiceId,
      stateProposal: harnessProposalFor(storyId, chapterNumber),
    })
    if (!result.ok || result.chapterNumber !== chapterNumber) {
      throw new HarnessForkError(
        `generation failed at Bab ${chapterNumber} for ${storyId}: ${JSON.stringify(result)}`,
      )
    }
  }

  const submit = async (storyId: string, chapterNumber: number, choiceId: string) => {
    // applyPersonalizedChoiceAuthorized throws on any rejected submission, so an
    // accepted return IS the success case; there is no `ok` flag to check.
    await applyPersonalizedChoiceAuthorized({
      userId,
      storyId,
      chapterNumber,
      choiceId,
      // Story-scoped key: idempotent replays of the same branch+chapter+choice
      // collide on purpose; the two branches are different stories.
      idempotencyKey: `m10c-fork:${storyId}:${chapterNumber}:${choiceId}`,
    })
  }

  const lastChoiceIdOf = async (storyId: string, chapterNumber: number): Promise<string | null> => {
    const history = await readerChoiceHistoryOf(admin, storyId, userId)
    const entry = history.find((h) => h.chapterNumber === chapterNumber)
    if (!entry) {
      throw new HarnessForkError(`no accepted choice recorded for ${storyId} at Bab ${chapterNumber}`)
    }
    return entry.choiceId
  }

  // ── Phase 1: both branches advance IDENTICALLY through the fork chapter with
  //    the deterministic policy. Branch A publishes first; branch B replays the
  //    same deterministic sequence on its own isolated story.
  for (const storyId of [storyA, storyB]) {
    for (let chapterNumber = 1; chapterNumber < forkChapter; chapterNumber += 1) {
      const trigger = chapterNumber > 1 ? await lastChoiceIdOf(storyId, chapterNumber - 1) : null
      await generate(storyId, chapterNumber, trigger)
      const chosen = selectDeterministicChoice(await loadPublishedChoices(admin, storyId, chapterNumber))
      await submit(storyId, chapterNumber, chosen.id)
    }
    await generate(storyId, forkChapter, await lastChoiceIdOf(storyId, forkChapter - 1))
  }

  // ── Snapshot-equivalence proof: identical deterministic inputs must give
  //    byte-identical per-chapter capture hashes through the fork chapter.
  const preForkParityMismatches: number[] = []
  for (let chapterNumber = 1; chapterNumber <= forkChapter; chapterNumber += 1) {
    const captureA = await captureChapter({
      admin, storyId: storyA, userId, chapterNumber,
      acceptedChoiceId: chapterNumber < forkChapter ? await lastChoiceIdOf(storyA, chapterNumber) : null,
    })
    const captureB = await captureChapter({
      admin, storyId: storyB, userId, chapterNumber,
      acceptedChoiceId: chapterNumber < forkChapter ? await lastChoiceIdOf(storyB, chapterNumber) : null,
    })
    if (captureA.capture.captureHash !== captureB.capture.captureHash) {
      preForkParityMismatches.push(chapterNumber)
    }
  }
  const preForkCaptureParity = preForkParityMismatches.length === 0

  // ── Fork: two DIFFERENT legal choices at the same canonical snapshot.
  const forkChoices = await loadPublishedChoices(admin, storyA, forkChapter)
  let choiceX: { id: string; label: string }
  let choiceY: { id: string; label: string }
  if (input.choiceIds && input.choiceIds.length >= 2) {
    const pinned = input.choiceIds.slice(0, 2).map((id) => forkChoices.find((c) => c.id === id))
    if (!pinned[0] || !pinned[1]) {
      throw new HarnessForkError(
        `pinned fork choice ids ${input.choiceIds.join(', ')} are not all published at Bab ${forkChapter}`,
      )
    }
    ;[choiceX, choiceY] = pinned
  } else {
    const sorted = [...forkChoices].sort((a, b) => a.id.localeCompare(b.id))
    if (sorted.length < 2) {
      throw new HarnessForkError(
        `fork chapter ${forkChapter} published only ${sorted.length} choice(s); a fork needs >= 2`,
      )
    }
    ;[choiceX, choiceY] = [sorted[0], sorted[1]]
  }
  if (choiceX.id === choiceY.id) {
    throw new HarnessForkError(`fork chapter ${forkChapter} fork choices are not distinct`)
  }

  await submit(storyA, forkChapter, choiceX.id)
  await submit(storyB, forkChapter, choiceY.id)

  // ── Phase 3: both branches through the next act boundary, each triggered by
  //    its OWN fork choice (the continuation loader must accept both legal
  //    triggers). After the fork, both converge on the deterministic policy.
  for (const storyId of [storyA, storyB]) {
    for (let chapterNumber = forkChapter + 1; chapterNumber <= throughChapter; chapterNumber += 1) {
      const trigger = await lastChoiceIdOf(storyId, chapterNumber - 1)
      await generate(storyId, chapterNumber, trigger)
      if (chapterNumber < throughChapter) {
        const chosen = selectDeterministicChoice(await loadPublishedChoices(admin, storyId, chapterNumber))
        await submit(storyId, chapterNumber, chosen.id)
      }
    }
  }

  // ── Verification ──────────────────────────────────────────────────────────
  const historyA = await readerChoiceHistoryOf(admin, storyA, userId)
  const historyB = await readerChoiceHistoryOf(admin, storyB, userId)
  const readerA = await readerStateOf(admin, storyA, userId)
  const readerB = await readerStateOf(admin, storyB, userId)

  const forkEntryA = historyA.find((h) => h.chapterNumber === forkChapter)
  const forkEntryB = historyB.find((h) => h.chapterNumber === forkChapter)
  const branchesForked = forkEntryA?.choiceId === choiceX.id && forkEntryB?.choiceId === choiceY.id
  const crossLeakDetected =
    historyA.some((h) => h.chapterNumber === forkChapter && h.choiceId === choiceY.id)
    || historyB.some((h) => h.chapterNumber === forkChapter && h.choiceId === choiceX.id)
  const bothReachedBoundary = readerA.currentChapter === throughChapter && readerB.currentChapter === throughChapter

  const spineA = await canonSpineOf(admin, storyA, throughChapter)
  const spineB = await canonSpineOf(admin, storyB, throughChapter)

  const evidence: ForkEvidenceV1 = {
    schemaVersion: 1,
    forkChapter,
    throughChapter,
    branchA: {
      storyId: storyA,
      userId,
      forkChoiceId: forkEntryA?.choiceId ?? null,
      forkChoiceLabel: forkEntryA?.label ?? '',
      currentChapter: readerA.currentChapter,
      singleCanonSpine: spineA.singleCanonSpine,
      commitsPerChapter: spineA.commitsPerChapter,
    },
    branchB: {
      storyId: storyB,
      userId,
      forkChoiceId: forkEntryB?.choiceId ?? null,
      forkChoiceLabel: forkEntryB?.label ?? '',
      currentChapter: readerB.currentChapter,
      singleCanonSpine: spineB.singleCanonSpine,
      commitsPerChapter: spineB.commitsPerChapter,
    },
    preForkCaptureParity,
    preForkParityMismatches,
    crossLeakDetected,
  }

  const findings: LongHorizonFindingV1[] = []
  if (
    !branchesForked
    || !bothReachedBoundary
    || !spineA.singleCanonSpine
    || !spineB.singleCanonSpine
    || crossLeakDetected
    || !preForkCaptureParity
  ) {
    findings.push({
      schemaVersion: 1,
      code: 'FORK_ISOLATION_BROKEN',
      severity: 'BLOCKER',
      domain: 'branch-fork',
      storyId: storyA,
      horizon: { fromChapter: forkChapter, toChapter: throughChapter },
      evidence: [
        {
          kind: 'canon',
          ref: `stories:${storyA},${storyB}`,
          detail: {
            branchesForked,
            bothReachedBoundary,
            branchASingleCanonSpine: spineA.singleCanonSpine,
            branchBSingleCanonSpine: spineB.singleCanonSpine,
            preForkCaptureParity,
            preForkParityMismatches,
            crossLeakDetected,
            branchAForkChoiceId: forkEntryA?.choiceId ?? null,
            branchBForkChoiceId: forkEntryB?.choiceId ?? null,
            readerACurrentChapter: readerA.currentChapter,
            readerBCurrentChapter: readerB.currentChapter,
          },
        },
      ],
      message:
        'Branch-fork isolation probe failed: the two branches did not start from equivalent '
        + 'canonical snapshots, diverged incorrectly at the fork choice, double-advanced a '
        + 'canon, or leaked a choice across branches.',
      remediationClass: 'runtime',
    })
  }

  return { evidence, findings: sortFindings(findings) }
}

// ── small read helpers (all fail closed) ─────────────────────────────────────

interface HistoryEntry {
  chapterNumber: number
  choiceId: string
  label: string
}

async function readerChoiceHistoryOf(admin: Admin, storyId: string, userId: string): Promise<HistoryEntry[]> {
  const { data, error } = await admin
    .from('reader_states')
    .select('choice_history')
    .eq('user_id', userId)
    .eq('story_id', storyId)
    .maybeSingle()
  if (error) throw new HarnessForkError(`reader_states read failed for ${storyId}: ${error.message}`)
  return (Array.isArray(data?.choice_history) ? data!.choice_history : [])
    .map((entry) => ({
      chapterNumber: Number((entry as Record<string, unknown>).chapterNumber ?? 0),
      choiceId: String((entry as Record<string, unknown>).choiceId ?? ''),
      label: String((entry as Record<string, unknown>).label ?? ''),
    }))
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
}

async function readerStateOf(admin: Admin, storyId: string, userId: string): Promise<{ currentChapter: number }> {
  const { data, error } = await admin
    .from('reader_states')
    .select('current_chapter')
    .eq('user_id', userId)
    .eq('story_id', storyId)
    .maybeSingle()
  if (error) throw new HarnessForkError(`reader_states read failed for ${storyId}: ${error.message}`)
  return { currentChapter: Number(data?.current_chapter ?? 0) }
}

async function canonSpineOf(
  admin: Admin,
  storyId: string,
  throughChapter: number,
): Promise<{ commitsPerChapter: Array<{ chapterNumber: number; commitCount: number }>; singleCanonSpine: boolean }> {
  const { data, error } = await admin
    .from('chapter_state_commits')
    .select('chapter_number')
    .eq('story_id', storyId)
    .lte('chapter_number', throughChapter)
  if (error) throw new HarnessForkError(`chapter_state_commits read failed for ${storyId}: ${error.message}`)
  const byChapter = new Map<number, number>()
  for (const row of data ?? []) {
    const n = Number(row.chapter_number)
    byChapter.set(n, (byChapter.get(n) ?? 0) + 1)
  }
  const commitsPerChapter = [...byChapter.entries()]
    .map(([chapterNumber, commitCount]) => ({ chapterNumber, commitCount }))
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
  const singleCanonSpine =
    commitsPerChapter.length === throughChapter
    && commitsPerChapter.every((c) => c.chapterNumber >= 1 && c.commitCount === 1)
  return { commitsPerChapter, singleCanonSpine }
}

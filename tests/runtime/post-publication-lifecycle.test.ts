// @vitest-environment node
/**
 * C-R1 regression tests (reviewer verdict 2026-08-08): G4-STALE enforcement
 * and act-boundary reconciliation derivation.
 *
 * Pure unit tests — no DB, no IO. The DB-backed enforcement path (mark → no
 * touch → THREAD_STALE_UNADDRESSED → FAILED_REVIEW_REQUIRED) is covered by
 * tests/db/m10-c-r1-g4-stale-enforcement.test.ts (LAKOKU_LOCAL_DB_TEST=1).
 *
 * What is proven here:
 *  1. The staleness mark predicate is the NCS §4.2 rule (gap >= 6), identical
 *     to refreshStaleness — the runtime marking hook cannot drift from the
 *     canonical rule silently.
 *  2. The harness authoring plan's main_mystery cadence keeps every gap
 *     below the mark threshold (consequence of enforcement becoming real),
 *     AND the pre-C-R1 legacy cadence demonstrably violated it — i.e. the
 *     touches are load-bearing, not cosmetic.
 *  3. deriveActBoundaryReconciliationInput maps the post-commit canon +
 *     contract honestly: boundary detection, latest-blueprint selection,
 *     UNFILTERED trajectory requirements (C-R2: a missing required thread is
 *     drift evidence, never filtered away), endings mapping.
 *  4. deriveRequiredClosureSatisfiability blocks an ending exactly when a
 *     required-closure debt's backing thread was abandoned.
 *  5. deriveEndingReachabilityEvidence (C-R2, reviewer Entry 6) proves only
 *     what the current contract model can prove and records the model gaps
 *     (secret path, flag blocking) as UNPROVEN — ncs14Proven stays false and
 *     no consumer may render the evidence as a reachability PASS.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  ENDING_RULES,
  STALE_AFTER_CHAPTERS,
  STALE_CALLBACK_WINDOW,
  computeDriftScore,
  debtBackedThreadId,
  refreshStaleness,
  type CanonSnapshot,
  type StoryThread,
} from '@lakoku/narrative-core'
import {
  FLAG_BLOCKING_PROVABLE_ON_CURRENT_MODEL,
  deriveActBoundaryReconciliationInput,
  deriveEndingReachabilityEvidence,
  deriveRequiredClosureSatisfiability,
  isStaleAtChapter,
} from '@/lib/runtime/post-publication-lifecycle.server'
import {
  MAIN_MYSTERY_CALLBACK_CHAPTERS,
  buildHarnessContract,
  mainMysteryTouchChapters,
} from '@/lib/narrative-qa/harness/fixture'

const STORY_ID = 'g4-stale-unit-story'

/** Mirror of the two threads seed.ts inserts for every harness story. */
function seededThreads(storyId: string): StoryThread[] {
  return [
    {
      id: debtBackedThreadId(storyId, 'main_mystery'),
      title: 'Misteri brankas',
      status: 'OPEN',
      openedChapter: 1,
      lastTouchedChapter: 1,
      payoffWindow: 48,
      isMainMystery: true,
    },
    {
      id: debtBackedThreadId(storyId, 'debt:a'),
      title: 'Surat di brankas',
      status: 'OPEN',
      openedChapter: 1,
      lastTouchedChapter: 1,
      payoffWindow: 8,
      isMainMystery: false,
    },
  ]
}

// ── 1. staleness predicate = NCS §4.2 ──────────────────────────────────────

describe('C-R1 G4: staleness mark predicate', () => {
  it('marks stale exactly at gap >= STALE_AFTER_CHAPTERS (mirror of refreshStaleness)', () => {
    const lastTouched = 10
    expect(isStaleAtChapter(lastTouched, lastTouched + STALE_AFTER_CHAPTERS - 1)).toBe(false)
    expect(isStaleAtChapter(lastTouched, lastTouched + STALE_AFTER_CHAPTERS)).toBe(true)
    expect(isStaleAtChapter(lastTouched, lastTouched + STALE_AFTER_CHAPTERS + 1)).toBe(true)
  })

  it('matches refreshStaleness decision for every gap in a 10-chapter sweep', () => {
    // Cross-check against the canonical rule instead of trusting the mirror.
    for (const lastTouched of [1, 6, 12, 30]) {
      for (let chapter = lastTouched; chapter <= lastTouched + 10; chapter++) {
        const refreshed = refreshStaleness(
          [{
            id: 't',
            title: 't',
            status: 'OPEN',
            openedChapter: 1,
            lastTouchedChapter: lastTouched,
            payoffWindow: null,
            isMainMystery: false,
          }],
          chapter,
        )
        expect(isStaleAtChapter(lastTouched, chapter)).toBe(refreshed[0].stale === true)
      }
    }
  })
})

// ── 2. harness cadence keeps main_mystery out of the stale window ──────────

describe('C-R1 G4: harness authoring-plan cadence', () => {
  it('keeps every main_mystery touch gap within the staleness window', () => {
    const touches = mainMysteryTouchChapters()
    expect(touches).toEqual([...touches].sort((a, b) => a - b))
    for (let i = 1; i < touches.length; i++) {
      const gap = touches[i] - touches[i - 1]
      // Gap == STALE_AFTER_CHAPTERS is still safe: the marking hook runs AFTER
      // the touch chapter's own delta is applied (applier updates
      // last_touched_chapter first), so the measured gap never reaches the
      // threshold between touch chapters. Gap > STALE_AFTER_CHAPTERS would be
      // marked stale and fail Layer A after the callback window.
      expect(gap, `gap ${touches[i - 1]}→${touches[i]}`).toBeLessThanOrEqual(STALE_AFTER_CHAPTERS)
      expect(gap, `gap ${touches[i - 1]}→${touches[i]}`).toBeGreaterThan(0)
    }
    // The evaluator derives staleness from lastTouchedChapter with findings at
    // untouchedFor > 6; the largest gap here must stay at or under 6 so the
    // clean rerun shows zero STALE_THREAD_* findings.
    const maxGap = Math.max(...touches.slice(1).map((c, i) => c - touches[i]))
    expect(maxGap).toBeLessThanOrEqual(STALE_AFTER_CHAPTERS)
  })

  it('the pre-C-R1 legacy cadence demonstrably violated NCS §4.2', () => {
    // Before C-R1 the plan only touched main_mystery at debt-progress chapters
    // (12/32/45) and Bab 46/47. The 12→32 gap is 20 chapters: once enforcement
    // became real that plan fails closed, proving the C-R1 callback touches are
    // load-bearing, not cosmetic.
    const legacy = [1, 12, 32, 45, 46, 47, 48]
    const maxGap = Math.max(...legacy.slice(1).map((c, i) => c - legacy[i]))
    expect(maxGap).toBeGreaterThan(STALE_AFTER_CHAPTERS)
    // And the C-R1 touches land inside the violated windows.
    expect(MAIN_MYSTERY_CALLBACK_CHAPTERS).toContain(18)
    expect(MAIN_MYSTERY_CALLBACK_CHAPTERS).toContain(24)
    expect(MAIN_MYSTERY_CALLBACK_CHAPTERS).toContain(30)
    expect(MAIN_MYSTERY_CALLBACK_CHAPTERS).toContain(38)
  })

  it('the callback window is shorter than the stale threshold (deadline math)', () => {
    // Once marked, Layer A gives STALE_CALLBACK_WINDOW chapters to address the
    // thread before THREAD_STALE_UNADDRESSED fires; both constants belong to
    // the same NCS §4.2 rule and the regression must notice if they drift.
    expect(STALE_CALLBACK_WINDOW).toBeGreaterThan(0)
    expect(STALE_CALLBACK_WINDOW).toBeLessThanOrEqual(STALE_AFTER_CHAPTERS)
  })
})

// ── 3. act-boundary reconciliation input derivation ────────────────────────

function snapshotFor(overrides: {
  threads?: CanonSnapshot['threads']
  blueprints?: CanonSnapshot['blueprints']
}): CanonSnapshot {
  return {
    storyId: STORY_ID,
    characters: [],
    aliases: [],
    voiceSheets: [],
    facts: [],
    knowledge: [],
    secrets: [],
    timeline: [],
    threads: overrides.threads ?? seededThreads(STORY_ID),
    actRollups: [],
    blueprints: overrides.blueprints ?? [],
  }
}

function blueprint(chapterNumber: number, version: number) {
  return {
    chapterNumber,
    version,
    phase: 'BABAK_2',
    chapterGoal: `goal ${chapterNumber} v${version}`,
    mandatoryBeats: [],
    forbiddenReveals: [],
    allowedStateDelta: {},
    introducesCharacters: [],
    reconciledFromVersion: null,
    reconciliationReason: null,
  }
}

describe('C-R1 G1: deriveActBoundaryReconciliationInput', () => {
  const contract = buildHarnessContract(STORY_ID)

  it('returns null for non-boundary chapters and the final boundary', () => {
    const snapshot = snapshotFor({})
    expect(deriveActBoundaryReconciliationInput({ storyId: STORY_ID, chapterNumber: 7, contract, snapshot })).toBeNull()
    // Bab 50 ends act 3; there is no next act.
    expect(deriveActBoundaryReconciliationInput({ storyId: STORY_ID, chapterNumber: 50, contract, snapshot })).toBeNull()
  })

  it('derives the next act, latest blueprints only, and intersected requirements at Bab 5', () => {
    const snapshot = snapshotFor({
      blueprints: [
        blueprint(6, 1),
        blueprint(6, 2), // newer version must win
        blueprint(7, 1),
        blueprint(12, 1),
        blueprint(13, 1), // act 3 — outside the next act window, excluded
      ],
    })
    const derived = deriveActBoundaryReconciliationInput({ storyId: STORY_ID, chapterNumber: 5, contract, snapshot })
    expect(derived).not.toBeNull()
    expect(derived!.actNumber).toBe(1)
    expect(derived!.nextAct).toEqual({ actNumber: 2, fromChapter: 6, toChapter: 12 })

    expect(derived!.blueprints.map((bp) => bp.chapterNumber)).toEqual([6, 7, 12])
    expect(derived!.blueprints.find((bp) => bp.chapterNumber === 6)?.version).toBe(2)

    // Requirements exist for every next-act chapter; the contract's
    // expectedThreadMovement (canonical main_mystery id after C-R1) intersects
    // the seeded threads.
    expect(derived!.requirements.map((r) => r.chapterNumber)).toEqual([6, 7, 8, 9, 10, 11, 12])
    const mainThreadId = debtBackedThreadId(STORY_ID, 'main_mystery')
    expect(derived!.requirements.every((r) => (r.requiredThreadsActive ?? []).includes(mainThreadId))).toBe(true)
  })

  it('keeps expectedThreadMovement ids that never materialized — missing requirement is drift evidence (C-R2)', () => {
    // Reviewer Entry 6: "Jangan filter missing requirement. Missing required
    // thread adalah evidence drift, bukan sesuatu yang harus di-ignore." The
    // pre-C-R2 derivation intersected requirements with materialized thread
    // ids, silently dropping trajectory requirements and masking drift.
    const ghostContract = {
      ...contract,
      chapterTargets: contract.chapterTargets.map((t) => ({
        ...t,
        expectedThreadMovement: [debtBackedThreadId(STORY_ID, 'main_mystery'), 'ghost-thread-id'],
      })),
    }
    const derived = deriveActBoundaryReconciliationInput({
      storyId: STORY_ID,
      chapterNumber: 5,
      contract: ghostContract,
      snapshot: snapshotFor({}),
    })
    expect(derived).not.toBeNull()
    for (const req of derived!.requirements) {
      expect(req.requiredThreadsActive).toContain('ghost-thread-id')
    }
    // The ghost thread has no entry in state.threadStatuses, so
    // computeDriftScore scores it unmet — the requirement survives into the
    // drift gate instead of being ignored (exactly one unmet: the ghost; the
    // main_mystery thread itself is OPEN and met).
    for (const req of derived!.requirements) {
      expect(computeDriftScore(req, derived!.state)).toBe(1)
    }
  })

  it('maps ending candidates as violation-detection input only — no secret, no flag blocking (C-R2)', () => {
    const derived = deriveActBoundaryReconciliationInput({
      storyId: STORY_ID,
      chapterNumber: 12,
      contract,
      snapshot: snapshotFor({}),
    })
    expect(derived).not.toBeNull()
    expect(derived!.actNumber).toBe(2)
    expect(derived!.nextAct).toEqual({ actNumber: 3, fromChapter: 13, toChapter: 50 })
    expect(derived!.endings.map((e) => e.id).sort()).toEqual(['ending-gelap', 'ending-open'])
    // Honesty guard: the mapping NEVER asserts a secret ending or flag
    // blocking — EndingCandidateSchema cannot express either. The limitation
    // is enforced downstream by deriveEndingReachabilityEvidence (asserted
    // below), not by pretending the model covers more than it does.
    expect(derived!.endings.every((e) => e.isSecret === false)).toBe(true)
    expect(derived!.endings.every((e) => (e.blockedByFlags ?? []).length === 0)).toBe(true)
  })
})

// ── 3b. honest ending-reachability evidence (C-R2, reviewer Entry 6) ───────

describe('C-R2 G1: deriveEndingReachabilityEvidence', () => {
  const contract = buildHarnessContract(STORY_ID)

  function evidenceAt(chapterNumber: number, snapshot: CanonSnapshot = snapshotFor({})) {
    const derived = deriveActBoundaryReconciliationInput({ storyId: STORY_ID, chapterNumber, contract, snapshot })
    expect(derived).not.toBeNull()
    const closure = deriveRequiredClosureSatisfiability({ storyId: STORY_ID, contract, snapshot })
    return deriveEndingReachabilityEvidence({
      actNumber: derived!.actNumber,
      checkpointChapter: chapterNumber,
      endings: derived!.endings,
      state: derived!.state,
      closure,
    })
  }

  it('proves the count + closure clauses but never NCS §1.4 on the current model', () => {
    const evidence = evidenceAt(12)
    expect(evidence.endingCandidateCount).toBe(2)
    expect(evidence.minRequiredMain).toBe(ENDING_RULES.minReachableEndings)
    expect(evidence.closureAllSatisfiable).toBe(true)
    // No violation detectable on the structured data that exists — but that
    // is explicitly NOT "reachability proven" (see the model-gap flags).
    expect(evidence.reachabilityViolationFindingCodes).toEqual([])
    expect(evidence.secretEndingModeled).toBe(false)
    expect(evidence.secretPathProven).toBe(false)
    expect(evidence.flagBlockingModeled).toBe(false)
    expect(evidence.ncs14Proven).toBe(false)
  })

  it('FLAG_BLOCKING_PROVABLE_ON_CURRENT_MODEL is a documented model fact, not a runtime reading', () => {
    expect(FLAG_BLOCKING_PROVABLE_ON_CURRENT_MODEL).toBe(false)
  })

  it('records closure blocking honestly when a backing thread is abandoned', () => {
    const snapshot = snapshotFor({
      threads: [
        {
          id: debtBackedThreadId(STORY_ID, 'main_mystery'),
          title: 'main',
          status: 'ABANDONED_APPROVED',
          openedChapter: 1,
          lastTouchedChapter: 1,
          payoffWindow: 48,
          isMainMystery: true,
        },
        {
          id: debtBackedThreadId(STORY_ID, 'debt:a'),
          title: 'a',
          status: 'OPEN',
          openedChapter: 1,
          lastTouchedChapter: 1,
          payoffWindow: 8,
          isMainMystery: false,
        },
      ],
    })
    const evidence = evidenceAt(12, snapshot)
    expect(evidence.closureAllSatisfiable).toBe(false)
    const gelap = evidence.requiredClosure.find((r) => r.endingId === 'ending-gelap')
    expect(gelap?.satisfiable).toBe(false)
    expect(evidence.ncs14Proven).toBe(false)
  })

  it('still proves nothing even when a secret ending is hand-modeled and reachable', () => {
    // m5-soak hand-writes a secret EndingDef; even feeding one in directly,
    // ncs14Proven must stay false while flag blocking is unprovable on the
    // current model (FLAG_BLOCKING_PROVABLE_ON_CURRENT_MODEL).
    const derived = deriveActBoundaryReconciliationInput({
      storyId: STORY_ID,
      chapterNumber: 12,
      contract,
      snapshot: snapshotFor({}),
    })!
    const closure = deriveRequiredClosureSatisfiability({
      storyId: STORY_ID,
      contract,
      snapshot: snapshotFor({}),
    })
    const evidence = deriveEndingReachabilityEvidence({
      actNumber: derived.actNumber,
      checkpointChapter: 12,
      endings: [
        ...derived.endings,
        { id: 'ending-rahasia', isMain: false, isSecret: true, blockedByFlags: [] },
      ],
      state: derived.state,
      closure,
    })
    expect(evidence.secretEndingModeled).toBe(true)
    expect(evidence.secretPathProven).toBe(true)
    expect(evidence.flagBlockingModeled).toBe(false)
    expect(evidence.ncs14Proven).toBe(false)
  })
})

// ── 4. requiredClosure satisfiability ──────────────────────────────────────

describe('C-R1 G1: deriveRequiredClosureSatisfiability', () => {
  const contract = buildHarnessContract(STORY_ID)

  it('endings stay satisfiable while backing threads are alive', () => {
    const result = deriveRequiredClosureSatisfiability({
      storyId: STORY_ID,
      contract,
      snapshot: snapshotFor({}),
    })
    expect(result.every((r) => r.satisfiable)).toBe(true)
  })

  it('an ending becomes unsatisfiable when its required debt thread was abandoned', () => {
    const abandonedMain = debtBackedThreadId(STORY_ID, 'main_mystery')
    const result = deriveRequiredClosureSatisfiability({
      storyId: STORY_ID,
      contract,
      snapshot: snapshotFor({
        threads: [
          {
            id: abandonedMain,
            title: 'main',
            status: 'ABANDONED_APPROVED',
            openedChapter: 1,
            lastTouchedChapter: 1,
            payoffWindow: 48,
            isMainMystery: true,
          },
          {
            id: debtBackedThreadId(STORY_ID, 'debt:a'),
            title: 'a',
            status: 'OPEN',
            openedChapter: 1,
            lastTouchedChapter: 1,
            payoffWindow: 8,
            isMainMystery: false,
          },
        ],
      }),
    })
    const gelap = result.find((r) => r.endingId === 'ending-gelap')
    const open = result.find((r) => r.endingId === 'ending-open')
    expect(gelap?.satisfiable).toBe(false)
    expect(gelap?.blockingThreadIds).toEqual([abandonedMain])
    expect(open?.satisfiable).toBe(true)
  })
})

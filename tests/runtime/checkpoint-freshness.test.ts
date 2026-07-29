import { describe, expect, it } from 'vitest'
import {
  CHECKPOINT_AUDIT_SIGNALS_REUSE_VERSION,
  CHECKPOINT_AUDIT_SIGNALS_VERSION,
  CHECKPOINT_AUDIT_SIGNALS_VERSION_V2,
  NO_CREATIVE_DIRECTION_FINGERPRINT,
  isCheckpointAuditSignalsV2,
  parseCheckpointAuditSignals,
  proseFingerprint,
  verifyCheckpointFreshness,
  type ChapterGenerationCheckpoint,
  type CheckpointAuditSignalsV2,
  type CheckpointFreshnessContext,
} from '@/lib/runtime/chapter-generation-checkpoint.pure'

function cp(overrides: Partial<ChapterGenerationCheckpoint> = {}): ChapterGenerationCheckpoint {
  return {
    storyId: 's1',
    chapterNumber: 3,
    attemptId: 'a1',
    correlationId: 'c1',
    status: 'PROSE_READY',
    title: 'T',
    paragraphs: ['p'],
    proseFingerprint: proseFingerprint('T', ['p']),
    auditSignals: null,
    auditSignalsVersion: null,
    canonVersion: 5,
    blueprintVersion: 2,
    directionFingerprint: 'dir',
    generationMode: 'standard',
    generationPolicyVersion: 2,
    promptContractVersion: 2,
    jobId: 'job-1',
    jobAttemptNumber: 1,
    schemaVersion: 2,
    proseAttemptCount: 1,
    choiceAttemptCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  }
}

function ctx(overrides: Partial<CheckpointFreshnessContext> = {}): CheckpointFreshnessContext {
  return {
    canonVersion: 5,
    blueprintVersion: 2,
    directionFingerprint: 'dir',
    generationMode: 'standard',
    generationPolicyVersion: 2,
    promptContractVersion: 2,
    requireJobProvenance: true,
    jobId: 'job-1',
    jobAttemptNumber: 1,
    ...overrides,
  }
}

function v2Signals(
  overrides: Partial<CheckpointAuditSignalsV2> = {},
): CheckpointAuditSignalsV2 {
  return {
    opensNewThread: false,
    opensMajorMystery: false,
    opensNewConflict: false,
    closesPlotDebts: [],
    ...overrides,
  }
}

describe('parseCheckpointAuditSignals (v1/v2)', () => {
  it('pins the stored write version and the reuse version', () => {
    expect(CHECKPOINT_AUDIT_SIGNALS_VERSION).toBe(2)
    expect(CHECKPOINT_AUDIT_SIGNALS_VERSION_V2).toBe(2)
    expect(CHECKPOINT_AUDIT_SIGNALS_REUSE_VERSION).toBe(2)
  })

  it('strictly parses exact V1 audit signals', () => {
    expect(parseCheckpointAuditSignals({
      opensNewThread: false,
      opensMajorMystery: true,
      opensNewConflict: false,
    }, 1)).toEqual({
      opensNewThread: false,
      opensMajorMystery: true,
      opensNewConflict: false,
    })
    expect(parseCheckpointAuditSignals({
      opensNewThread: false,
      opensMajorMystery: false,
      opensNewConflict: false,
      endingLocked: true,
    }, 1)).toBeNull()
    expect(parseCheckpointAuditSignals({
      opensNewThread: 0,
      opensMajorMystery: false,
      opensNewConflict: false,
    }, 1)).toBeNull()
  })

  it('rejects V1-shaped signals declared as version 2', () => {
    expect(parseCheckpointAuditSignals({
      opensNewThread: false,
      opensMajorMystery: false,
      opensNewConflict: false,
    }, 2)).toBeNull()
  })

  it('rejects V2-shaped signals declared as version 1', () => {
    expect(parseCheckpointAuditSignals(v2Signals(), 1)).toBeNull()
  })

  it('strictly parses exact V2 audit signals with closure records', () => {
    const signals = v2Signals({
      opensMajorMystery: true,
      closesPlotDebts: [
        { debtId: 'main_mystery', closureForm: 'RESOLVED' },
        { debtId: 'side_debt', closureForm: 'ABANDONED' },
      ],
    })

    expect(parseCheckpointAuditSignals(signals, 2)).toEqual(signals)
    expect(parseCheckpointAuditSignals(v2Signals(), 2)).toEqual(v2Signals())
  })

  it('rejects malformed V2 closure records', () => {
    expect(parseCheckpointAuditSignals(
      v2Signals({ closesPlotDebts: 'none' as never }),
      2,
    )).toBeNull()
    expect(parseCheckpointAuditSignals(
      v2Signals({ closesPlotDebts: [{ debtId: '', closureForm: 'RESOLVED' }] }),
      2,
    )).toBeNull()
    expect(parseCheckpointAuditSignals(
      v2Signals({
        closesPlotDebts: [{ debtId: 'd', closureForm: 'DROPPED' as never }],
      }),
      2,
    )).toBeNull()
    expect(parseCheckpointAuditSignals(
      v2Signals({
        closesPlotDebts: [
          { debtId: 'd', closureForm: 'RESOLVED', note: 'x' } as never,
        ],
      }),
      2,
    )).toBeNull()
    expect(parseCheckpointAuditSignals(
      v2Signals({
        closesPlotDebts: [
          { debtId: 'd', closureForm: 'RESOLVED' },
          { debtId: 'd', closureForm: 'SUBVERTED' },
        ],
      }),
      2,
    )).toBeNull()
    expect(parseCheckpointAuditSignals(
      v2Signals({
        closesPlotDebts: Array.from({ length: 21 }, (_, index) => ({
          debtId: `d${index}`,
          closureForm: 'RESOLVED' as const,
        })),
      }),
      2,
    )).toBeNull()
  })

  it('rejects unknown keys, unknown versions, and non-object values', () => {
    expect(parseCheckpointAuditSignals(
      { ...v2Signals(), extra: true },
      2,
    )).toBeNull()
    expect(parseCheckpointAuditSignals(v2Signals(), 3)).toBeNull()
    expect(parseCheckpointAuditSignals(v2Signals(), null)).toBeNull()
    expect(parseCheckpointAuditSignals(null, 2)).toBeNull()
    expect(parseCheckpointAuditSignals([], 2)).toBeNull()
    expect(parseCheckpointAuditSignals('x', 2)).toBeNull()
  })

  it('discriminates V2 signals from V1 signals', () => {
    const v1 = parseCheckpointAuditSignals({
      opensNewThread: false,
      opensMajorMystery: false,
      opensNewConflict: false,
    }, 1)
    const v2 = parseCheckpointAuditSignals(v2Signals(), 2)

    expect(v1).not.toBeNull()
    expect(v2).not.toBeNull()
    expect(isCheckpointAuditSignalsV2(v1)).toBe(false)
    expect(isCheckpointAuditSignalsV2(v2)).toBe(true)
    expect(isCheckpointAuditSignalsV2(null)).toBe(false)
  })

  it('does not alias the input object', () => {
    const input = v2Signals({
      closesPlotDebts: [{ debtId: 'side_debt', closureForm: 'RESOLVED' }],
    })
    const parsed = parseCheckpointAuditSignals(input, 2)

    expect(parsed).not.toBe(input)
    expect(isCheckpointAuditSignalsV2(parsed)).toBe(true)
    if (!isCheckpointAuditSignalsV2(parsed)) return
    expect(parsed.closesPlotDebts).not.toBe(input.closesPlotDebts)
    expect(parsed.closesPlotDebts).toEqual(input.closesPlotDebts)
  })
})

describe('verifyCheckpointFreshness (P1-2)', () => {
  it('v2: all matching → fresh', () => {
    expect(verifyCheckpointFreshness(cp(), ctx()).fresh).toBe(true)
  })

  it('v2: any null version → unusable (fail closed, not null===null)', () => {
    const r = verifyCheckpointFreshness(cp({ canonVersion: null }), ctx())
    expect(r.fresh).toBe(false)
    if (!r.fresh) expect(r.reason).toBe('NULL_canonVersion')
  })

  it('v2: canon/blueprint mismatch → rejected', () => {
    expect(verifyCheckpointFreshness(cp(), ctx({ blueprintVersion: 3 })).fresh).toBe(false)
    expect(verifyCheckpointFreshness(cp(), ctx({ directionFingerprint: 'other' })).fresh).toBe(false)
    expect(verifyCheckpointFreshness(cp(), ctx({ generationMode: 'personalized_ai' })).fresh).toBe(false)
  })

  it('provenance: jobAttemptNumber uses <= (re-claimed job keeps prose)', () => {
    // Checkpoint written on attempt 1, current job is on attempt 2 → still reusable.
    expect(verifyCheckpointFreshness(cp({ jobAttemptNumber: 1 }), ctx({ jobAttemptNumber: 2 })).fresh).toBe(true)
    // Checkpoint claims a HIGHER attempt than current → reject (impossible/stale).
    const ahead = verifyCheckpointFreshness(cp({ jobAttemptNumber: 3 }), ctx({ jobAttemptNumber: 2 }))
    expect(ahead.fresh).toBe(false)
    if (!ahead.fresh) expect(ahead.reason).toBe('ATTEMPT_AHEAD')
  })

  it('provenance: different jobId → reject', () => {
    const r = verifyCheckpointFreshness(cp({ jobId: 'job-1' }), ctx({ jobId: 'job-2' }))
    expect(r.fresh).toBe(false)
    if (!r.fresh) expect(r.reason).toBe('JOB_ID_MISMATCH')
  })

  it('v2 worker provenance requires non-null job identity and attempt', () => {
    const missingCheckpointJob = verifyCheckpointFreshness(cp({ jobId: null }), ctx())
    expect(missingCheckpointJob).toEqual({ fresh: false, reason: 'NULL_jobId' })

    const missingContextJob = verifyCheckpointFreshness(cp(), ctx({ jobId: null }))
    expect(missingContextJob).toEqual({ fresh: false, reason: 'NULL_jobId' })

    const missingCheckpointAttempt = verifyCheckpointFreshness(
      cp({ jobAttemptNumber: null }),
      ctx(),
    )
    expect(missingCheckpointAttempt).toEqual({
      fresh: false,
      reason: 'NULL_jobAttemptNumber',
    })
  })

  it('v2 durable worker rejects both null jobIds before checking attempt provenance', () => {
    const result = verifyCheckpointFreshness(
      cp({ jobId: null, jobAttemptNumber: null }),
      ctx({ jobId: null, jobAttemptNumber: null, requireJobProvenance: true }),
    )

    expect(result).toEqual({ fresh: false, reason: 'NULL_jobId' })
  })

  it('v2 explicit legacy worker-off context preserves nullable job provenance compatibility', () => {
    expect(verifyCheckpointFreshness(
      cp({ jobId: null, jobAttemptNumber: null }),
      ctx({ jobId: null, jobAttemptNumber: null, requireJobProvenance: false }),
    )).toEqual({ fresh: true })
  })

  it('uses a deterministic non-null creative-direction absence fingerprint', () => {
    expect(NO_CREATIVE_DIRECTION_FINGERPRINT).toMatch(/^[a-f0-9]{32}$/)
  })

  it('personalized checkpoint requires exact V2 audit metadata and recomputed prose binding', () => {
    expect(verifyCheckpointFreshness(cp({
      generationMode: 'personalized',
      auditSignals: v2Signals(),
      auditSignalsVersion: 2,
    }), ctx({ generationMode: 'personalized' }))).toEqual({ fresh: true })

    expect(verifyCheckpointFreshness(cp({
      generationMode: 'personalized',
      auditSignals: null,
      auditSignalsVersion: null,
    }), ctx({ generationMode: 'personalized' }))).toEqual({
      fresh: false,
      reason: 'INVALID_auditSignals',
    })
    expect(verifyCheckpointFreshness(cp({
      generationMode: 'personalized',
      auditSignals: v2Signals(),
      auditSignalsVersion: 3,
    }), ctx({ generationMode: 'personalized' }))).toEqual({
      fresh: false,
      reason: 'INVALID_auditSignals',
    })
    expect(verifyCheckpointFreshness(cp({
      generationMode: 'personalized',
      auditSignals: v2Signals(),
      auditSignalsVersion: 2,
      paragraphs: ['tampered'],
    }), ctx({ generationMode: 'personalized' }))).toEqual({
      fresh: false,
      reason: 'MISMATCH_proseFingerprint',
    })
  })

  it('personalized reuse rejects a parseable V1 checkpoint as stale', () => {
    const legacySignals = {
      opensNewThread: false,
      opensMajorMystery: false,
      opensNewConflict: false,
    }

    // Still parseable — terminal transitions keep working on legacy rows.
    expect(parseCheckpointAuditSignals(legacySignals, 1)).toEqual(legacySignals)

    expect(verifyCheckpointFreshness(cp({
      generationMode: 'personalized',
      auditSignals: legacySignals,
      auditSignalsVersion: 1,
    }), ctx({ generationMode: 'personalized' }))).toEqual({
      fresh: false,
      reason: 'STALE_auditSignalsVersion',
    })
  })

  it('standard checkpoint requires null audit metadata for both versions', () => {
    expect(verifyCheckpointFreshness(cp(), ctx())).toEqual({ fresh: true })
    expect(verifyCheckpointFreshness(cp({
      auditSignals: {
        opensNewThread: false,
        opensMajorMystery: false,
        opensNewConflict: false,
      },
      auditSignalsVersion: 1,
    }), ctx())).toEqual({ fresh: false, reason: 'UNEXPECTED_auditSignals' })
    expect(verifyCheckpointFreshness(cp({
      auditSignals: v2Signals(),
      auditSignalsVersion: 2,
    }), ctx())).toEqual({ fresh: false, reason: 'UNEXPECTED_auditSignals' })
  })

  it('legacy schemaVersion 1: only compares carried fields, tolerates null new fields', () => {
    const legacy = cp({
      schemaVersion: 1,
      generationMode: null,
      generationPolicyVersion: null,
      promptContractVersion: null,
    })
    expect(verifyCheckpointFreshness(legacy, ctx()).fresh).toBe(true)
    // But a legacy canon/blueprint mismatch is still rejected.
    expect(verifyCheckpointFreshness(legacy, ctx({ canonVersion: 99 })).fresh).toBe(false)
  })
})

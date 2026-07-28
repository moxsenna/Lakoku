/**
 * Pure checkpoint helpers (no server-only / DB). Safe for unit tests.
 */
import { createHash } from 'node:crypto'

export const NO_CREATIVE_DIRECTION_FINGERPRINT = createHash('sha256')
  .update('lakoku:creative-direction:absent:v1')
  .digest('hex')
  .slice(0, 32)

/**
 * Version stamped on rows written by the current writer path. Kept at 1 so
 * already-persisted rows stay parseable; the v2 writer lands in a later phase.
 */
export const CHECKPOINT_AUDIT_SIGNALS_VERSION = 1 as const

/** Audit-signal schema that additionally carries plot-debt closure records. */
export const CHECKPOINT_AUDIT_SIGNALS_VERSION_V2 = 2 as const

/**
 * Minimum audit-signal version a personalized checkpoint must carry to be reused
 * for choice-only retry. v1 rows remain parseable (terminal transitions, reader
 * status) but are never reused, because they cannot prove closure provenance.
 */
export const CHECKPOINT_AUDIT_SIGNALS_REUSE_VERSION = CHECKPOINT_AUDIT_SIGNALS_VERSION_V2

const CHECKPOINT_CLOSURE_FORMS = [
  'RESOLVED',
  'SUBVERTED',
  'TRANSFORMED',
  'ABANDONED',
] as const

const MAX_CHECKPOINT_CLOSURES = 20
const MAX_CHECKPOINT_DEBT_ID_LENGTH = 100

export type CheckpointPlotDebtClosureForm = (typeof CHECKPOINT_CLOSURE_FORMS)[number]

export type CheckpointPlotDebtClosure = {
  debtId: string
  closureForm: CheckpointPlotDebtClosureForm
}

export type CheckpointAuditSignalsV1 = {
  opensNewThread: boolean
  opensMajorMystery: boolean
  opensNewConflict: boolean
}

export type CheckpointAuditSignalsV2 = CheckpointAuditSignalsV1 & {
  closesPlotDebts: CheckpointPlotDebtClosure[]
}

export type CheckpointAuditSignals = CheckpointAuditSignalsV1 | CheckpointAuditSignalsV2

const V1_KEYS = 'opensMajorMystery,opensNewConflict,opensNewThread'
const V2_KEYS = 'closesPlotDebts,opensMajorMystery,opensNewConflict,opensNewThread'

export function isCheckpointAuditSignalsV2(
  signals: CheckpointAuditSignals | null | undefined,
): signals is CheckpointAuditSignalsV2 {
  return signals != null && Array.isArray((signals as CheckpointAuditSignalsV2).closesPlotDebts)
}

function parseAuditFlags(record: Record<string, unknown>): CheckpointAuditSignalsV1 | null {
  if (
    typeof record.opensNewThread !== 'boolean' ||
    typeof record.opensMajorMystery !== 'boolean' ||
    typeof record.opensNewConflict !== 'boolean'
  ) return null
  return {
    opensNewThread: record.opensNewThread,
    opensMajorMystery: record.opensMajorMystery,
    opensNewConflict: record.opensNewConflict,
  }
}

function parseClosureRecords(value: unknown): CheckpointPlotDebtClosure[] | null {
  if (!Array.isArray(value) || value.length > MAX_CHECKPOINT_CLOSURES) return null
  const closures: CheckpointPlotDebtClosure[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) return null
    const record = entry as Record<string, unknown>
    if (Object.keys(record).sort().join(',') !== 'closureForm,debtId') return null
    const { debtId, closureForm } = record
    if (typeof debtId !== 'string' || typeof closureForm !== 'string') return null
    const trimmed = debtId.trim()
    if (
      trimmed.length === 0 ||
      trimmed.length > MAX_CHECKPOINT_DEBT_ID_LENGTH ||
      trimmed !== debtId
    ) return null
    if (!(CHECKPOINT_CLOSURE_FORMS as readonly string[]).includes(closureForm)) return null
    if (seen.has(trimmed)) return null
    seen.add(trimmed)
    closures.push({ debtId: trimmed, closureForm: closureForm as CheckpointPlotDebtClosureForm })
  }
  return closures
}

/**
 * Strict parser for stored audit signals. Accepts exactly the v1 or v2 shape for
 * its declared version and returns a fresh object; anything else yields null.
 */
export function parseCheckpointAuditSignals(
  value: unknown,
  version: unknown,
): CheckpointAuditSignals | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort().join(',')

  if (version === CHECKPOINT_AUDIT_SIGNALS_VERSION) {
    if (keys !== V1_KEYS) return null
    return parseAuditFlags(record)
  }

  if (version === CHECKPOINT_AUDIT_SIGNALS_VERSION_V2) {
    if (keys !== V2_KEYS) return null
    const flags = parseAuditFlags(record)
    if (!flags) return null
    const closesPlotDebts = parseClosureRecords(record.closesPlotDebts)
    if (!closesPlotDebts) return null
    return { ...flags, closesPlotDebts }
  }

  return null
}

export type CheckpointStatus =
  | 'PROSE_READY'
  | 'QUEUED_CHOICES'
  | 'RUNNING_CHOICES'
  | 'CHOICES_RETRY_WAIT'
  | 'READY_TO_PUBLISH'
  | 'PUBLISHED'
  | 'EXPIRED'
  | 'FAILED'

export type ChapterGenerationCheckpoint = {
  storyId: string
  chapterNumber: number
  attemptId: string
  correlationId: string
  status: CheckpointStatus
  title: string
  paragraphs: string[]
  proseFingerprint: string
  auditSignals: CheckpointAuditSignals | null
  auditSignalsVersion: number | null
  canonVersion: number | null
  blueprintVersion: number | null
  directionFingerprint: string | null
  generationMode: string | null
  generationPolicyVersion: number | null
  promptContractVersion: number | null
  jobId: string | null
  jobAttemptNumber: number | null
  /** 1 = legacy compatibility, 2 = strict non-null versions required. */
  schemaVersion: number
  proseAttemptCount: number
  choiceAttemptCount: number
  createdAt: string
  updatedAt: string
  expiresAt: string
}

/** Current runtime versions/fingerprints a checkpoint must match to be reused. */
export type CheckpointFreshnessContext = {
  canonVersion: number | null
  blueprintVersion: number | null
  directionFingerprint: string | null
  generationMode: string | null
  generationPolicyVersion: number | null
  promptContractVersion: number | null
  /** Require strict durable worker job provenance, even when both job ids are null. */
  requireJobProvenance: boolean
  /** Current durable job id (worker path); null on legacy path. */
  jobId?: string | null
  /** Current job attempt_count; checkpoint provenance must be <= this. */
  jobAttemptNumber?: number | null
}

export type CheckpointFreshnessResult =
  | { fresh: true }
  | { fresh: false; reason: string }

/**
 * P1-2: decide whether a stored prose checkpoint may be reused for choice-only
 * retry under the CURRENT runtime context.
 *
 * Rules:
 *  - schemaVersion 2 (new): every version/fingerprint MUST be non-null AND match
 *    current (fail closed on any null — never treat null === null as fresh).
 *  - schemaVersion 1 (legacy): compatibility — match only the fields the legacy
 *    row actually carried (canon/blueprint/direction), skip newer fields.
 *  - jobAttemptNumber is PROVENANCE: checkpoint.jobAttemptNumber must be <=
 *    current attempt (never ===) so a re-claimed same job keeps its prose.
 *  - jobId (when both present) must match the current job.
 */
export function verifyCheckpointFreshness(
  cp: ChapterGenerationCheckpoint,
  ctx: CheckpointFreshnessContext,
): CheckpointFreshnessResult {
  const mismatch = (reason: string): CheckpointFreshnessResult => ({ fresh: false, reason })

  // Worker schema-v2 provenance is strict. Explicit non-worker contexts retain
  // nullable legacy compatibility below.
  const workerV2 = cp.schemaVersion >= 2 && (
    ctx.requireJobProvenance || cp.jobId != null || ctx.jobId != null
  )
  if (workerV2) {
    if (cp.jobId == null || ctx.jobId == null) return mismatch('NULL_jobId')
    if (cp.jobAttemptNumber == null || ctx.jobAttemptNumber == null) {
      return mismatch('NULL_jobAttemptNumber')
    }
    if (cp.jobId !== ctx.jobId) return mismatch('JOB_ID_MISMATCH')
    if (cp.jobAttemptNumber > ctx.jobAttemptNumber) return mismatch('ATTEMPT_AHEAD')
  } else {
    if (cp.jobId != null && ctx.jobId != null && cp.jobId !== ctx.jobId) {
      return mismatch('JOB_ID_MISMATCH')
    }
    if (
      cp.jobAttemptNumber != null &&
      ctx.jobAttemptNumber != null &&
      cp.jobAttemptNumber > ctx.jobAttemptNumber
    ) {
      return mismatch('ATTEMPT_AHEAD')
    }
  }

  if (cp.proseFingerprint !== proseFingerprint(cp.title, cp.paragraphs)) {
    return mismatch('MISMATCH_proseFingerprint')
  }

  if (cp.schemaVersion >= 2) {
    // Fail closed: any null on a v2 checkpoint means it was written without full
    // provenance and cannot be trusted for reuse.
    const required: Array<[string, unknown, unknown]> = [
      ['canonVersion', cp.canonVersion, ctx.canonVersion],
      ['blueprintVersion', cp.blueprintVersion, ctx.blueprintVersion],
      ['directionFingerprint', cp.directionFingerprint, ctx.directionFingerprint],
      ['generationMode', cp.generationMode, ctx.generationMode],
      ['generationPolicyVersion', cp.generationPolicyVersion, ctx.generationPolicyVersion],
      ['promptContractVersion', cp.promptContractVersion, ctx.promptContractVersion],
    ]
    for (const [field, cpVal, ctxVal] of required) {
      if (cpVal == null || ctxVal == null) return mismatch(`NULL_${field}`)
      if (cpVal !== ctxVal) return mismatch(`MISMATCH_${field}`)
    }
    if (ctx.generationMode === 'personalized') {
      const signals = parseCheckpointAuditSignals(cp.auditSignals, cp.auditSignalsVersion)
      if (!signals) return mismatch('INVALID_auditSignals')
      // Reuse demands closure provenance; parseable v1 rows are not enough.
      if (
        cp.auditSignalsVersion !== CHECKPOINT_AUDIT_SIGNALS_REUSE_VERSION ||
        !isCheckpointAuditSignalsV2(signals)
      ) {
        return mismatch('STALE_auditSignalsVersion')
      }
    } else if (cp.auditSignals != null || cp.auditSignalsVersion != null) {
      return mismatch('UNEXPECTED_auditSignals')
    }
    return { fresh: true }
  }

  // Legacy (schemaVersion 1): only compare fields legacy rows carried.
  if (cp.canonVersion != null && ctx.canonVersion != null && cp.canonVersion !== ctx.canonVersion) {
    return mismatch('MISMATCH_canonVersion')
  }
  if (
    cp.blueprintVersion != null &&
    ctx.blueprintVersion != null &&
    cp.blueprintVersion !== ctx.blueprintVersion
  ) {
    return mismatch('MISMATCH_blueprintVersion')
  }
  if (
    cp.directionFingerprint != null &&
    ctx.directionFingerprint != null &&
    cp.directionFingerprint !== ctx.directionFingerprint
  ) {
    return mismatch('MISMATCH_directionFingerprint')
  }
  return { fresh: true }
}

export function proseFingerprint(title: string, paragraphs: string[]): string {
  const payload = JSON.stringify({ title, paragraphs })
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export function choiceJobIdempotencyKey(args: {
  storyId: string
  chapterNumber: number
  proseFingerprint: string
}): string {
  return `choice:${args.storyId}:${args.chapterNumber}:${args.proseFingerprint}`
}

export function publishIdempotencyKey(args: {
  storyId: string
  chapterNumber: number
  proseFingerprint: string
  choiceFingerprint: string
}): string {
  return `publish:${args.storyId}:${args.chapterNumber}:${args.proseFingerprint}:${args.choiceFingerprint}`
}

export function choiceFingerprint(branch: {
  choicePrompt: string
  choices: Array<{ id: string; label: string }>
  outcomes: Array<{ choiceId: string; consequence: string[] }>
}): string {
  const payload = JSON.stringify({
    choicePrompt: branch.choicePrompt,
    choices: branch.choices.map((c) => ({ id: c.id, label: c.label })),
    outcomes: branch.outcomes.map((o) => ({
      choiceId: o.choiceId,
      consequence: o.consequence,
    })),
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export function defaultCheckpointExpiry(from = new Date()): string {
  return new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString()
}

export function isCheckpointUsableForChoiceRetry(
  checkpoint: Pick<ChapterGenerationCheckpoint, 'status' | 'expiresAt' | 'proseFingerprint'>,
  now = new Date(),
): boolean {
  if (
    checkpoint.status !== 'PROSE_READY' &&
    checkpoint.status !== 'CHOICES_RETRY_WAIT' &&
    checkpoint.status !== 'QUEUED_CHOICES' &&
    checkpoint.status !== 'RUNNING_CHOICES'
  ) {
    return false
  }
  if (!checkpoint.proseFingerprint) return false
  return new Date(checkpoint.expiresAt).getTime() > now.getTime()
}

export function readerStatusFromCheckpoint(
  status: CheckpointStatus | null | undefined,
): 'writing' | 'preparing_choices' | 'ready' | 'failed' | null {
  if (!status) return null
  switch (status) {
    case 'PROSE_READY':
    case 'QUEUED_CHOICES':
    case 'RUNNING_CHOICES':
    case 'CHOICES_RETRY_WAIT':
    case 'READY_TO_PUBLISH':
      return 'preparing_choices'
    case 'PUBLISHED':
      return 'ready'
    case 'FAILED':
    case 'EXPIRED':
      return 'failed'
    default:
      return null
  }
}

export const READER_STATUS_COPY = {
  queued: 'Babmu masuk antrean penulisan.',
  writing: 'Bab ini sedang ditulis.',
  preparing_choices: 'Babnya sudah terbentuk. Kami sedang menyiapkan pilihanmu.',
  ready: null as string | null,
  failed: 'Bab ini belum berhasil disiapkan.',
} as const

export function isChoiceDurableCheckpointEnabled(): boolean {
  const raw =
    typeof process !== 'undefined'
      ? process.env.LAKOKU_CHOICE_DURABLE_CHECKPOINT?.trim().toLowerCase()
      : undefined
  if (raw === undefined || raw === '') return true
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false
  return true
}

export function draftFromCheckpoint(checkpoint: ChapterGenerationCheckpoint): {
  storyId: string
  title: string
  paragraphs: string[]
  chapterNumber: number
  wordCount: number
  sceneCount: number
  hasChoiceOrGate: boolean
  events: []
  knowledgeAssertions: []
  reveals: []
  proposedStateDelta: Record<string, never>
  newNamedCharacters: []
  dialogue: []
  emotionBeats: []
  softClaims: []
} {
  const wordCount = checkpoint.paragraphs
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length
  return {
    storyId: checkpoint.storyId,
    title: checkpoint.title,
    paragraphs: checkpoint.paragraphs,
    chapterNumber: checkpoint.chapterNumber,
    wordCount,
    sceneCount: Math.max(1, checkpoint.paragraphs.length),
    hasChoiceOrGate: checkpoint.chapterNumber < 50,
    events: [],
    knowledgeAssertions: [],
    reveals: [],
    proposedStateDelta: {},
    newNamedCharacters: [],
    dialogue: [],
    emotionBeats: [],
    softClaims: [],
  }
}

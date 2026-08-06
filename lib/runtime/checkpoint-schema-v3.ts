/**
 * M10-A1d — Capability-aware schema-3 checkpoint + publisher wrappers (living v1).
 *
 * Pembungkus tipe-aman untuk RPC living-canon v1 (schema-3 checkpoint, delta
 * ber-tanda `state_delta_schema_version=1`, `committed_canon_revision`):
 *   - worker : upsert_generation_checkpoint_fenced_v2 → publish_generation_job_chapter_v5
 *   - sync   : upsert_generation_checkpoint_sync_v1  → publish_chapter_state_v3
 *
 * Service/worker only — request path tidak pernah menyentuh RPC ini. Model pada
 * pola `generation-jobs.ts` (callRpc / adaptFencedCheckpointResult), tetapi
 * schema dieksekusi dideklarasi lokal agar tak terikat schema privat file
 * pembungkus legacy.
 */
import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@lakoku/db'
import type { ChapterStateDeltaV1 } from '@lakoku/narrative-core'
import {
  GenerationJobError,
  extractGenerationJobRpcError,
} from './generation-job-error'
import type { CheckpointMutationResult } from './chapter-generation-checkpoint.pure'
import type { CheckpointAuditSignalsV2 } from './chapter-generation-checkpoint.pure'
import type { PublishOutcomeV2 } from './lifecycle'

const UuidSchema = z.string().uuid()
const StoryIdSchema = z.string().min(1).max(200)
const ChapterNumberSchema = z.number().int().min(1).max(50)
const NonnegativeIntegerSchema = z.number().int().nonnegative()
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]))
const StateDeltaJsonSchema = z.record(z.string(), JsonValueSchema)

const EndingLockSchema = z.object({
  key: z.string().min(1).max(80).refine((value) => value === value.trim()),
  name: z.string().min(1).max(160).refine((value) => value === value.trim()),
}).strict()

const AuditSignalsV2Schema = z.object({
  opensNewThread: z.boolean(),
  opensMajorMystery: z.boolean(),
  opensNewConflict: z.boolean(),
  closesPlotDebts: z.array(
    z.object({
      debtId: z.string().min(1).max(100)
        .refine((value) => value === value.trim())
        .refine((value) => !/[\x00-\x1F\x7F]/.test(value)),
      closureForm: z.enum(['RESOLVED', 'SUBVERTED', 'TRANSFORMED', 'ABANDONED']),
    }).strict(),
  ).max(20),
}).strict()

/** Outcomes passthrough V3/V5 — dinormalisasi ke snake_case di `wireOutcomes`. */
const OutcomeV2Schema = z.object({
  choiceId: z.string(),
  consequence: z.array(z.string()),
  nextChapterNumber: ChapterNumberSchema.nullable(),
  isEnding: z.boolean(),
  effect: JsonValueSchema,
  choiceKind: z.string(),
}).strict()

// ---------- Fenced checkpoint (worker) ----------

export interface UpsertGenerationCheckpointFencedV2Input {
  jobId: string
  workerId: string
  claimToken: string
  leaseId: string
  storyId: string
  chapterNumber: number
  title: string
  paragraphs: string[]
  proseFingerprint: string
  auditSignals: CheckpointAuditSignalsV2
  auditSignalsVersion: 1 | 2
  canonVersion: number
  blueprintVersion: number
  directionFingerprint: string
  generationMode: 'personalized'
  generationPolicyVersion: number
  promptContractVersion: number
  proseAttemptCount: number
  stateDelta: ChapterStateDeltaV1
  baseCanonRevision: number | null
}

const FencedV2InputSchema = z.object({
  jobId: UuidSchema,
  workerId: z.string().min(1).max(200),
  claimToken: UuidSchema,
  leaseId: UuidSchema,
  storyId: StoryIdSchema,
  chapterNumber: ChapterNumberSchema,
  title: z.string().trim().min(1),
  paragraphs: z.array(z.string()).min(1),
  proseFingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  auditSignals: AuditSignalsV2Schema,
  auditSignalsVersion: z.union([z.literal(1), z.literal(2)]),
  canonVersion: NonnegativeIntegerSchema,
  blueprintVersion: NonnegativeIntegerSchema,
  directionFingerprint: z.string().trim().min(1).max(256),
  generationMode: z.literal('personalized'),
  generationPolicyVersion: NonnegativeIntegerSchema,
  promptContractVersion: NonnegativeIntegerSchema,
  proseAttemptCount: NonnegativeIntegerSchema,
  stateDelta: StateDeltaJsonSchema,
  baseCanonRevision: NonnegativeIntegerSchema.nullable(),
}).strict()

export interface UpsertGenerationCheckpointSyncV1Input {
  storyId: string
  chapterNumber: number
  userId: string
  checkpointAttemptId: string
  correlationId: string
  title: string
  paragraphs: string[]
  proseFingerprint: string
  auditSignals: CheckpointAuditSignalsV2
  auditSignalsVersion: 1 | 2
  canonVersion: number
  blueprintVersion: number
  directionFingerprint: string
  generationPolicyVersion: number
  promptContractVersion: number
  stateDelta: ChapterStateDeltaV1
  baseCanonRevision: number | null
}

const SyncV1InputSchema = z.object({
  storyId: StoryIdSchema,
  chapterNumber: ChapterNumberSchema,
  userId: UuidSchema,
  checkpointAttemptId: UuidSchema,
  correlationId: UuidSchema,
  title: z.string().trim().min(1),
  paragraphs: z.array(z.string()).min(1),
  proseFingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  auditSignals: AuditSignalsV2Schema,
  auditSignalsVersion: z.union([z.literal(1), z.literal(2)]),
  canonVersion: NonnegativeIntegerSchema,
  blueprintVersion: NonnegativeIntegerSchema,
  directionFingerprint: z.string().trim().min(1).max(256),
  generationPolicyVersion: NonnegativeIntegerSchema,
  promptContractVersion: NonnegativeIntegerSchema,
  stateDelta: StateDeltaJsonSchema,
  baseCanonRevision: NonnegativeIntegerSchema.nullable(),
}).strict()

const LIVING_CP_RESULTS = [
  'UPDATED',
  'NOT_FOUND',
  'OWNERSHIP_LOST',
  'LEASE_INVALID',
  'ATTEMPT_AHEAD',
  'PROVENANCE_CONFLICT',
  'INVALID_TRANSITION',
  'LIVING_CANON_NOT_ACTIVE',
  'STALE_CANON_REVISION',
  'BASE_CANON_AHEAD',
] as const

const RawLivingCheckpointResultSchema = z.object({
  ok: z.boolean(),
  result: z.enum(LIVING_CP_RESULTS),
  changed: z.boolean().optional(),
  checkpoint_attempt_id: UuidSchema.optional(),
  checkpoint: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

type RawCheckpointRpcFailure = { message?: unknown; code?: unknown }

function checkpointWriteFailure(error: RawCheckpointRpcFailure): CheckpointMutationResult {
  const code = String(error.code ?? String(error.message ?? ''))
  const terminal = code === '42P01'
    || code === '42883'
    || code === '42501'
    || code === 'PGRST202'
    || code === 'PGRST204'
    || code === 'PGRST205'
  return {
    ok: false,
    outcome: 'WRITE_FAILED',
    errorCode: 'CHECKPOINT_WRITE_FAILED',
    disposition: terminal ? 'TERMINAL' : 'RETRYABLE',
  }
}

function adaptLivingCheckpointResult(
  raw: z.infer<typeof RawLivingCheckpointResultSchema>,
  successOutcome: 'CREATED' | 'UPDATED',
  expectedCheckpointAttemptId: string,
): CheckpointMutationResult {
  if (raw.ok === true) {
    // Attempt identity: fenced_v2 menaruh attempt_id = job id di dalam
    // `checkpoint`; sync_v1 mengekspos `checkpoint_attempt_id` level atas.
    const attemptRaw = raw.checkpoint_attempt_id ?? raw.checkpoint?.attempt_id
    const attempt = UuidSchema.safeParse(attemptRaw)
    if (!attempt.success || attempt.data !== expectedCheckpointAttemptId) {
      return {
        ok: false,
        outcome: 'WRITE_FAILED',
        errorCode: 'CHECKPOINT_WRITE_FAILED',
        disposition: 'TERMINAL',
      }
    }
    return { ok: true, outcome: successOutcome, checkpointAttemptId: attempt.data }
  }
  if (
    raw.result === 'OWNERSHIP_LOST'
    || raw.result === 'LEASE_INVALID'
    || raw.result === 'ATTEMPT_AHEAD'
  ) {
    return {
      ok: false,
      outcome: 'OWNERSHIP_LOST',
      errorCode: 'GENERATION_JOB_OWNERSHIP_LOST',
      disposition: 'OWNERSHIP_LOST',
    }
  }
  if (raw.result === 'NOT_FOUND') {
    return {
      ok: false,
      outcome: 'NOT_FOUND',
      errorCode: 'CHECKPOINT_NOT_FOUND',
      disposition: 'TERMINAL',
    }
  }
  if (raw.result === 'INVALID_TRANSITION') {
    return {
      ok: false,
      outcome: 'INVALID_TRANSITION',
      errorCode: 'INVALID_TRANSITION',
      disposition: 'TERMINAL',
    }
  }
  // LIVING_CANON_NOT_ACTIVE / STALE_CANON_REVISION / BASE_CANON_AHEAD /
  // PROVENANCE_CONFLICT → fail-closed terminal: konflik otoritas/canon,
  // bukan kondisi retry.
  return {
    ok: false,
    outcome: 'PROVENANCE_CONFLICT',
    errorCode: 'PROVENANCE_CONFLICT',
    disposition: 'TERMINAL',
  }
}

async function callCheckpointRpcV3(
  name: string,
  payload: Record<string, unknown>,
  successOutcome: 'CREATED' | 'UPDATED',
  expectedCheckpointAttemptId: string,
): Promise<CheckpointMutationResult> {
  const client = createAdminClient()
  const { data, error } = await client.rpc(name, payload)
  if (error) return checkpointWriteFailure(error)
  const raw = RawLivingCheckpointResultSchema.parse(data)
  return adaptLivingCheckpointResult(raw, successOutcome, expectedCheckpointAttemptId)
}

/**
 * Worker schema-3 writer. Identitas attempt DIAMBIL DARI JOB di DB (attempt_id
 * dan correlation_id = id job / correlation job) — wrapper tidak mengirim
 * checkpoint_attempt_id; expected identity = jobId.
 */
export async function upsertGenerationCheckpointFencedV2(
  input: UpsertGenerationCheckpointFencedV2Input,
): Promise<CheckpointMutationResult> {
  const parsed = FencedV2InputSchema.parse(input)
  return callCheckpointRpcV3(
    'upsert_generation_checkpoint_fenced_v2',
    {
      p_job_id: parsed.jobId,
      p_worker_id: parsed.workerId,
      p_claim_token: parsed.claimToken,
      p_lease_id: parsed.leaseId,
      p_story_id: parsed.storyId,
      p_chapter_number: parsed.chapterNumber,
      p_title: parsed.title,
      p_paragraphs: parsed.paragraphs,
      p_prose_fingerprint: parsed.proseFingerprint,
      p_audit_signals: parsed.auditSignals,
      p_audit_signals_version: parsed.auditSignalsVersion,
      p_canon_version: parsed.canonVersion,
      p_blueprint_version: parsed.blueprintVersion,
      p_direction_fingerprint: parsed.directionFingerprint,
      p_generation_mode: parsed.generationMode,
      p_generation_policy_version: parsed.generationPolicyVersion,
      p_prompt_contract_version: parsed.promptContractVersion,
      p_prose_attempt_count: parsed.proseAttemptCount,
      p_state_delta_json: parsed.stateDelta,
      p_state_delta_schema_version: 1,
      p_base_canon_revision: parsed.baseCanonRevision,
    },
    'UPDATED',
    parsed.jobId,
  )
}

/** Sync schema-3 writer (request path; checkpoint_attempt_id dari caller). */
export async function upsertGenerationCheckpointSyncV1(
  input: UpsertGenerationCheckpointSyncV1Input,
): Promise<CheckpointMutationResult> {
  const parsed = SyncV1InputSchema.parse(input)
  return callCheckpointRpcV3(
    'upsert_generation_checkpoint_sync_v1',
    {
      p_story_id: parsed.storyId,
      p_chapter_number: parsed.chapterNumber,
      p_user_id: parsed.userId,
      p_checkpoint_attempt_id: parsed.checkpointAttemptId,
      p_correlation_id: parsed.correlationId,
      p_title: parsed.title,
      p_paragraphs: parsed.paragraphs,
      p_prose_fingerprint: parsed.proseFingerprint,
      p_audit_signals: parsed.auditSignals,
      p_audit_signals_version: parsed.auditSignalsVersion,
      p_canon_version: parsed.canonVersion,
      p_blueprint_version: parsed.blueprintVersion,
      p_direction_fingerprint: parsed.directionFingerprint,
      p_generation_policy_version: parsed.generationPolicyVersion,
      p_prompt_contract_version: parsed.promptContractVersion,
      p_state_delta_json: parsed.stateDelta,
      p_base_canon_revision: parsed.baseCanonRevision,
    },
    'UPDATED',
    parsed.checkpointAttemptId,
  )
}

// ---------- Publishers (worker v5 / sync v3) ----------

export interface Schema3PublicationResult {
  ok: true
  chapterNumber: number
  seq: number
  checkpointAttemptId: string | null
  committedCanonRevision: number | null
  jobId: string | null
}

export interface PublishGenerationJobChapterV5Input {
  jobId: string
  workerId: string
  claimToken: string
  leaseId: string
  storyId: string
  chapterNumber: number
  choicePrompt: string | null
  choices: unknown[] | null
  outcomes: PublishOutcomeV2[]
  endingLock: { key: string; name: string } | null
}

const V5InputSchema = z.object({
  jobId: UuidSchema,
  workerId: z.string().min(1).max(200),
  claimToken: UuidSchema,
  leaseId: UuidSchema,
  storyId: StoryIdSchema,
  chapterNumber: ChapterNumberSchema,
  choicePrompt: z.string().nullable(),
  choices: z.array(JsonValueSchema).nullable(),
  outcomes: z.array(OutcomeV2Schema),
  endingLock: EndingLockSchema.nullable(),
}).strict()

export interface PublishChapterStateV3Input {
  storyId: string
  chapterNumber: number
  userId: string
  leaseId: string
  checkpointAttemptId: string
  choicePrompt: string | null
  choices: unknown[] | null
  outcomes: PublishOutcomeV2[]
  endingLock: { key: string; name: string } | null
}

const V3SyncInputSchema = z.object({
  storyId: StoryIdSchema,
  chapterNumber: ChapterNumberSchema,
  userId: UuidSchema,
  leaseId: UuidSchema,
  checkpointAttemptId: UuidSchema,
  choicePrompt: z.string().nullable(),
  choices: z.array(JsonValueSchema).nullable(),
  outcomes: z.array(OutcomeV2Schema),
  endingLock: EndingLockSchema.nullable(),
}).strict()

const RawPublishV3ResultSchema = z.object({
  ok: z.literal(true),
  chapter_number: ChapterNumberSchema,
  seq: NonnegativeIntegerSchema,
  checkpoint_attempt_id: UuidSchema.nullable().optional(),
  committed_canon_revision: NonnegativeIntegerSchema.nullable().optional(),
}).passthrough()

const RawPublishV5ResultSchema = RawPublishV3ResultSchema.extend({
  job_id: UuidSchema.nullable().optional(),
}).passthrough()

function normalizeV3Publication(
  raw: z.infer<typeof RawPublishV5ResultSchema>,
): Schema3PublicationResult {
  return {
    ok: raw.ok,
    chapterNumber: raw.chapter_number,
    seq: raw.seq,
    checkpointAttemptId: raw.checkpoint_attempt_id ?? null,
    committedCanonRevision: raw.committed_canon_revision ?? null,
    jobId: raw.job_id ?? null,
  }
}

function mapRpcError(error: { message?: unknown; code?: unknown }): GenerationJobError {
  const extracted = extractGenerationJobRpcError(error.message)
  return extracted
    ? new GenerationJobError(extracted.code, extracted.rpcToken)
    : new GenerationJobError('INTERNAL_ERROR')
}

/** RPC publisher helper — throw pada error RPC (classification di caller). */
async function callRpcSchema3(name: string, payload: Record<string, unknown>): Promise<unknown> {
  const client = createAdminClient()
  const { data, error } = await client.rpc(name, payload)
  if (error) throw mapRpcError(error)
  return data
}

/**
 * Outcomes variable → snake_case (`effect_json` / `choice_kind`) — bentuk yang
 * dipahami `publish_chapter_v2` di dalam V3/V5 (pola sama dengan V4 writer).
 */
function wireOutcomes(outcomes: PublishOutcomeV2[]): unknown[] {
  return outcomes.map((outcome) => ({
    choiceId: outcome.choiceId,
    consequence: outcome.consequence,
    nextChapterNumber: outcome.nextChapterNumber,
    isEnding: outcome.isEnding,
    effect_json: outcome.effect,
    choice_kind: outcome.choiceKind,
  }))
}

/** Worker living-canon publisher. V5 terminalisasi job + release lease sendiri. */
export async function publishGenerationJobChapterV5(
  input: PublishGenerationJobChapterV5Input,
): Promise<Schema3PublicationResult> {
  const parsed = V5InputSchema.parse(input)
  const raw = RawPublishV5ResultSchema.parse(await callRpcSchema3('publish_generation_job_chapter_v5', {
    p_job_id: parsed.jobId,
    p_worker_id: parsed.workerId,
    p_claim_token: parsed.claimToken,
    p_lease_id: parsed.leaseId,
    p_story_id: parsed.storyId,
    p_chapter_number: parsed.chapterNumber,
    p_choice_prompt: parsed.choicePrompt,
    p_choices: parsed.choices,
    p_outcomes: wireOutcomes(parsed.outcomes as unknown as PublishOutcomeV2[]),
    p_ending_key: parsed.endingLock?.key ?? null,
    p_ending_name: parsed.endingLock?.name ?? null,
  }))
  return normalizeV3Publication(raw)
}

/** Sync living-canon publisher. V3 menulis ending lock (ch45) + canon + commit atomik. */
export async function publishChapterStateV3(
  input: PublishChapterStateV3Input,
): Promise<Schema3PublicationResult> {
  const parsed = V3SyncInputSchema.parse(input)
  const raw = RawPublishV3ResultSchema.parse(await callRpcSchema3('publish_chapter_state_v3', {
    p_story_id: parsed.storyId,
    p_chapter_number: parsed.chapterNumber,
    p_user_id: parsed.userId,
    p_lease_id: parsed.leaseId,
    p_checkpoint_attempt_id: parsed.checkpointAttemptId,
    p_choice_prompt: parsed.choicePrompt,
    p_choices: parsed.choices,
    p_outcomes: wireOutcomes(parsed.outcomes as unknown as PublishOutcomeV2[]),
    p_ending_key: parsed.endingLock?.key ?? null,
    p_ending_name: parsed.endingLock?.name ?? null,
  }))
  return normalizeV3Publication(raw)
}

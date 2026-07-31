/**
 * Durable prose checkpoint persistence (PROSE_READY).
 * Service/worker only — never expose draft prose via Reader API.
 */
import 'server-only'
import { createAdminClient } from '@lakoku/db'
import type { GenerationJobExecutionContext } from './generation-job-execution'
import type { CheckpointMutationResult } from './chapter-generation-checkpoint.pure'
import {
  defaultCheckpointExpiry,
  draftFromCheckpoint,
  parseCheckpointAuditSignals,
  isCheckpointUsableForChoiceRetry,
  isChoiceDurableCheckpointEnabled,
  proseFingerprint,
  type ChapterGenerationCheckpoint,
  type CheckpointStatus,
} from './chapter-generation-checkpoint.pure'

export * from './chapter-generation-checkpoint.pure'

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  const message = String(error.message ?? '').toLowerCase()
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204') return true
  if (message.includes('does not exist')) return true
  if (message.includes('could not find the table')) return true
  return false
}

function checkpointWriteFailure(
  disposition: 'RETRYABLE' | 'TERMINAL',
): CheckpointMutationResult {
  return {
    ok: false,
    outcome: 'WRITE_FAILED',
    errorCode: 'CHECKPOINT_WRITE_FAILED',
    disposition,
  }
}

/** Baris checkpoint wajib ada; nol baris berarti target mutasi tidak ditemukan. */
function checkpointNotFound(): CheckpointMutationResult {
  return {
    ok: false,
    outcome: 'NOT_FOUND',
    errorCode: 'CHECKPOINT_NOT_FOUND',
    disposition: 'TERMINAL',
  }
}

function rowToCheckpoint(row: Record<string, unknown>): ChapterGenerationCheckpoint | null {
  const paragraphs = row.paragraphs_json
  if (!Array.isArray(paragraphs)) return null
  const status = String(row.status ?? '') as CheckpointStatus
  const auditSignalsVersion = row.audit_signals_version == null
    ? null
    : Number(row.audit_signals_version)
  const auditSignals = parseCheckpointAuditSignals(row.audit_signals_json, auditSignalsVersion)
  return {
    storyId: String(row.story_id),
    chapterNumber: Number(row.chapter_number),
    attemptId: String(row.attempt_id),
    correlationId: String(row.correlation_id),
    status,
    title: String(row.title ?? ''),
    paragraphs: paragraphs.map((p) => String(p)),
    proseFingerprint: String(row.prose_fingerprint ?? ''),
    auditSignals,
    auditSignalsVersion,
    canonVersion: row.canon_version == null ? null : Number(row.canon_version),
    blueprintVersion: row.blueprint_version == null ? null : Number(row.blueprint_version),
    directionFingerprint:
      row.direction_fingerprint == null ? null : String(row.direction_fingerprint),
    generationMode: row.generation_mode == null ? null : String(row.generation_mode),
    generationPolicyVersion:
      row.generation_policy_version == null ? null : Number(row.generation_policy_version),
    promptContractVersion:
      row.prompt_contract_version == null ? null : Number(row.prompt_contract_version),
    jobId: row.job_id == null ? null : String(row.job_id),
    jobAttemptNumber:
      row.job_attempt_number == null ? null : Number(row.job_attempt_number),
    schemaVersion:
      row.checkpoint_schema_version == null ? 1 : Number(row.checkpoint_schema_version),
    proseAttemptCount: Number(row.prose_attempt_count ?? 0),
    choiceAttemptCount: Number(row.choice_attempt_count ?? 0),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    expiresAt: String(row.expires_at ?? ''),
  }
}

/**
 * Load latest usable checkpoint for story+chapter (choice-only resume).
 * Prefer matching attemptId when provided.
 */
export async function loadUsableProseCheckpoint(args: {
  storyId: string
  chapterNumber: number
  attemptId?: string | null
  /**
   * P1-2: when provided, the loaded checkpoint must pass verifyCheckpointFreshness
   * against the current runtime versions or it is rejected (stale prose not reused).
   */
  freshness?: import('./chapter-generation-checkpoint.pure').CheckpointFreshnessContext
  jobContext?: GenerationJobExecutionContext | null
}): Promise<ChapterGenerationCheckpoint | null> {
  if (!isChoiceDurableCheckpointEnabled()) return null
  try {
    const db = createAdminClient()
    let query = db
      .from('chapter_generation_checkpoints')
      .select('*')
      .eq('story_id', args.storyId)
      .eq('chapter_number', args.chapterNumber)
      .in('status', [
        'PROSE_READY',
        'CHOICES_RETRY_WAIT',
        'QUEUED_CHOICES',
        'RUNNING_CHOICES',
      ])
      .gt('expires_at', new Date().toISOString())
      .order('updated_at', { ascending: false })
      .limit(1)

    if (args.attemptId) {
      query = db
        .from('chapter_generation_checkpoints')
        .select('*')
        .eq('story_id', args.storyId)
        .eq('chapter_number', args.chapterNumber)
        .eq('attempt_id', args.attemptId)
        .in('status', [
          'PROSE_READY',
          'CHOICES_RETRY_WAIT',
          'QUEUED_CHOICES',
          'RUNNING_CHOICES',
        ])
        .gt('expires_at', new Date().toISOString())
        .limit(1)
    }

    const { data, error } = await query.maybeSingle()
    if (error) {
      if (args.jobContext) throw new Error('WORKER_CHECKPOINT_LOAD_FAILED', { cause: error })
      if (isMissingRelation(error)) {
        console.log('CHECKPOINT_TABLE_UNAVAILABLE', {
          storyId: args.storyId,
          chapterNumber: args.chapterNumber,
        })
        return null
      }
      console.log('CHECKPOINT_LOAD_FAILED', {
        storyId: args.storyId,
        chapterNumber: args.chapterNumber,
        code: error.code,
      })
      return null
    }
    if (!data) return null
    const cp = rowToCheckpoint(data as Record<string, unknown>)
    if (!cp || !isCheckpointUsableForChoiceRetry(cp)) return null
    if (args.freshness) {
      const { verifyCheckpointFreshness } = await import(
        './chapter-generation-checkpoint.pure'
      )
      const verdict = verifyCheckpointFreshness(cp, args.freshness)
      if (!verdict.fresh) {
        console.log('CHECKPOINT_STALE_REJECTED', {
          storyId: args.storyId,
          chapterNumber: args.chapterNumber,
          reason: verdict.reason,
          schemaVersion: cp.schemaVersion,
        })
        return null
      }
    }
    return cp
  } catch (err) {
    if (args.jobContext) {
      if (err instanceof Error && err.message === 'WORKER_CHECKPOINT_LOAD_FAILED') throw err
      throw new Error('WORKER_CHECKPOINT_LOAD_FAILED', { cause: err })
    }
    console.log('CHECKPOINT_LOAD_EXCEPTION', {
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
      errorName: err instanceof Error ? err.name : 'unknown',
    })
    return null
  }
}

export async function persistProseReadyCheckpoint(args: {
  storyId: string
  chapterNumber: number
  attemptId: string
  correlationId: string
  title: string
  paragraphs: string[]
  proseAttemptCount?: number
  auditSignals?: import('./chapter-generation-checkpoint.pure').CheckpointAuditSignals | null
  auditSignalsVersion?: 1 | 2 | null
  directionFingerprint?: string | null
  canonVersion?: number | null
  blueprintVersion?: number | null
  generationMode?: string | null
  generationPolicyVersion?: number | null
  promptContractVersion?: number | null
  jobId?: string | null
  jobAttemptNumber?: number | null
  jobContext?: GenerationJobExecutionContext | null
}): Promise<CheckpointMutationResult> {
  if (!isChoiceDurableCheckpointEnabled()) {
    return checkpointWriteFailure('TERMINAL')
  }

  const fingerprint = proseFingerprint(args.title, args.paragraphs)
  const auditSignals = parseCheckpointAuditSignals(
    args.auditSignals ?? null,
    args.auditSignalsVersion ?? null,
  )
  if (
    (args.generationMode === 'personalized' && auditSignals == null) ||
    (args.generationMode !== 'personalized' && (
      args.auditSignals != null || args.auditSignalsVersion != null
    ))
  ) {
    throw new Error('CHECKPOINT_AUDIT_SIGNALS_INVALID')
  }
  if (args.jobContext) {
    if (
      args.canonVersion == null ||
      args.blueprintVersion == null ||
      args.directionFingerprint == null ||
      args.generationPolicyVersion == null ||
      args.promptContractVersion == null
    ) {
      throw new Error('WORKER_CHECKPOINT_PROVENANCE_INCOMPLETE')
    }
    const { upsertGenerationCheckpointFenced } = await import('./generation-jobs')
    return upsertGenerationCheckpointFenced({
      jobId: args.jobContext.jobId,
      workerId: args.jobContext.workerId,
      claimToken: args.jobContext.claimToken,
      leaseId: args.jobContext.leaseId,
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
      checkpointAttemptId: args.attemptId,
      title: args.title,
      paragraphs: args.paragraphs,
      proseFingerprint: fingerprint,
      auditSignals: args.auditSignals ?? null,
      auditSignalsVersion: args.auditSignalsVersion ?? null,
      canonVersion: args.canonVersion,
      blueprintVersion: args.blueprintVersion,
      directionFingerprint: args.directionFingerprint,
      generationMode: args.jobContext.generationKind,
      generationPolicyVersion: args.generationPolicyVersion,
      promptContractVersion: args.promptContractVersion,
      proseAttemptCount: args.proseAttemptCount ?? 1,
    })
  }
  const now = new Date()
  const canonVersion = args.canonVersion ?? null
  const blueprintVersion = args.blueprintVersion ?? null
  const generationMode = args.generationMode ?? null
  const generationPolicyVersion = args.generationPolicyVersion ?? null
  const promptContractVersion = args.promptContractVersion ?? null
  const jobId = args.jobId ?? null
  const jobAttemptNumber = args.jobAttemptNumber ?? null
  const row = {
    story_id: args.storyId,
    chapter_number: args.chapterNumber,
    attempt_id: args.attemptId,
    correlation_id: args.correlationId,
    status: 'PROSE_READY' as const,
    title: args.title,
    paragraphs_json: args.paragraphs,
    prose_fingerprint: fingerprint,
    audit_signals_json: args.auditSignals ?? null,
    audit_signals_version: args.auditSignalsVersion ?? null,
    canon_version: canonVersion,
    blueprint_version: blueprintVersion,
    direction_fingerprint: args.directionFingerprint ?? null,
    generation_mode: generationMode,
    generation_policy_version: generationPolicyVersion,
    prompt_contract_version: promptContractVersion,
    job_id: jobId,
    job_attempt_number: jobAttemptNumber,
    // New writes are schema version 2 (strict freshness).
    checkpoint_schema_version: 2,
    prose_attempt_count: args.proseAttemptCount ?? 1,
    choice_attempt_count: 0,
    updated_at: now.toISOString(),
    expires_at: defaultCheckpointExpiry(now),
  }

  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('chapter_generation_checkpoints')
      .upsert(row, { onConflict: 'story_id,chapter_number,attempt_id' })
      .select('story_id, chapter_number, attempt_id, correlation_id, status')
      .maybeSingle()
    if (error) {
      if (isMissingRelation(error)) {
        console.log('CHECKPOINT_TABLE_UNAVAILABLE', {
          storyId: args.storyId,
          chapterNumber: args.chapterNumber,
        })
        return checkpointWriteFailure('TERMINAL')
      }
      console.log('CHECKPOINT_WRITE_FAILED', {
        storyId: args.storyId,
        chapterNumber: args.chapterNumber,
        code: error.code,
      })
      return checkpointWriteFailure('RETRYABLE')
    }

    // Upsert wajib mengembalikan baris dengan identitas persis seperti yang ditulis.
    if (!data || typeof data !== 'object') return checkpointNotFound()
    const written = data as Record<string, unknown>
    const identityMatches = String(written.story_id ?? '') === args.storyId
      && Number(written.chapter_number) === args.chapterNumber
      && String(written.attempt_id ?? '') === args.attemptId
      && String(written.correlation_id ?? '') === args.correlationId
      && String(written.status ?? '') === 'PROSE_READY'
    if (!identityMatches) {
      console.log('CHECKPOINT_WRITE_UNVERIFIED', {
        storyId: args.storyId,
        chapterNumber: args.chapterNumber,
        status: 'PROSE_READY',
      })
      return checkpointWriteFailure('TERMINAL')
    }

    console.log('CHECKPOINT_PROSE_READY', {
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
      attemptId: args.attemptId,
      correlationId: args.correlationId,
      proseFingerprint: fingerprint,
    })

    return { ok: true, outcome: 'CREATED', checkpointAttemptId: args.attemptId }

  } catch {
    return checkpointWriteFailure('RETRYABLE')
  }
}

export async function markCheckpointStatus(args: {
  storyId: string
  chapterNumber: number
  attemptId: string
  status: CheckpointStatus
  choiceAttemptCount?: number
  jobContext?: GenerationJobExecutionContext | null
}): Promise<CheckpointMutationResult> {
  if (!isChoiceDurableCheckpointEnabled()) return checkpointWriteFailure('TERMINAL')
  if (args.jobContext) {
    const { transitionGenerationCheckpointFenced } = await import('./generation-jobs')
    return transitionGenerationCheckpointFenced({
      jobId: args.jobContext.jobId,
      workerId: args.jobContext.workerId,
      claimToken: args.jobContext.claimToken,
      leaseId: args.jobContext.leaseId,
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
      checkpointAttemptId: args.attemptId,
      newStatus: args.status,
    })
  }
  try {
    const db = createAdminClient()
    const patch: Record<string, unknown> = {
      status: args.status,
      updated_at: new Date().toISOString(),
    }
    if (args.choiceAttemptCount !== undefined) {
      patch.choice_attempt_count = args.choiceAttemptCount
    }
    if (args.status === 'PUBLISHED' || args.status === 'EXPIRED') {
      patch.expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }
    const { data, error } = await db
      .from('chapter_generation_checkpoints')
      .update(patch)
      .eq('story_id', args.storyId)
      .eq('chapter_number', args.chapterNumber)
      .eq('attempt_id', args.attemptId)
      .select('attempt_id, status')
      .maybeSingle()
    if (error) {
      console.log('CHECKPOINT_STATUS_UPDATE_FAILED', {
        storyId: args.storyId,
        chapterNumber: args.chapterNumber,
        status: args.status,
        code: error.code,
      })
      return checkpointWriteFailure(isMissingRelation(error) ? 'TERMINAL' : 'RETRYABLE')
    }
    // Nol baris terupdate bukan sukses: checkpoint target tidak ada.
    if (!data || typeof data !== 'object') return checkpointNotFound()
    const updated = data as Record<string, unknown>
    if (
      String(updated.attempt_id ?? '') !== args.attemptId
      || String(updated.status ?? '') !== args.status
    ) {
      console.log('CHECKPOINT_STATUS_UNVERIFIED', {
        storyId: args.storyId,
        chapterNumber: args.chapterNumber,
        status: args.status,
      })
      return checkpointWriteFailure('TERMINAL')
    }
    console.log('CHECKPOINT_STATUS', {
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
      attemptId: args.attemptId,
      status: args.status,
    })
    return { ok: true, outcome: 'UPDATED', checkpointAttemptId: args.attemptId }
  } catch {
    return checkpointWriteFailure('RETRYABLE')
  }
}

// re-export draftFromCheckpoint for server consumers that import this module
export { draftFromCheckpoint }

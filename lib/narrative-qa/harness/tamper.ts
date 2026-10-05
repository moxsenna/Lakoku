/**
 * M10-C — B2 negative-case probes (plan C.4.3 "altered provenance/delta fails
 * closed").
 *
 * Each probe resubmits a MUTATED identity or payload through the SAME
 * production publication RPC the runtime used (upsert_generation_checkpoint_
 * sync_v1 / upsert_generation_checkpoint_fenced_v2) and asserts the write is
 * REJECTED. A probe that production accepts is a REAL gap and is recorded as
 * `rejected: false` — it is never silently dropped or papered over.
 *
 * Read-only + no-commit by construction: every probe targets an already
 * published chapter whose commit ledger already exists, so the only honest
 * outcomes are fail-closed codes (PROVENANCE_CONFLICT / STALE_CANON_REVISION /
 * OWNERSHIP_LOST). The probes never fabricate evaluator input — they mutate a
 * REAL committed row and observe the runtime's response to it.
 */

import { randomUUID } from 'node:crypto'
import { getDb, rpcOne, single } from '@lakoku/db'
import type { FencingEvidenceV1 } from './run'

export interface TamperProbeInput {
  admin?: unknown
  storyId: string
  userId: string
  chapterNumber: number
  publicationMode: 'sync' | 'worker'
}

interface CheckpointRow {
  attempt_id: string
  correlation_id: string
  title: string
  paragraphs_json: unknown
  prose_fingerprint: string
  audit_signals_json: unknown
  audit_signals_version: number
  canon_version: number
  blueprint_version: number
  direction_fingerprint: string
  generation_mode: string
  generation_policy_version: number
  prompt_contract_version: number
  state_delta_json: Record<string, unknown>
  base_canon_revision: number
}

async function loadCommittedCheckpoint(
  _admin: unknown,
  storyId: string,
  chapterNumber: number,
): Promise<CheckpointRow> {
  const db = getDb()
  // RLS_AUDIT(chapter_generation_checkpoints): SERVICE_ROLE_BYPASS - harness tamper probe load checkpoint
  const rows = await db
    .selectFrom('chapter_generation_checkpoints')
    .select([
      'attempt_id',
      'correlation_id',
      'title',
      'paragraphs_json',
      'prose_fingerprint',
      'audit_signals_json',
      'audit_signals_version',
      'canon_version',
      'blueprint_version',
      'direction_fingerprint',
      'generation_mode',
      'generation_policy_version',
      'prompt_contract_version',
      'state_delta_json',
      'base_canon_revision',
    ])
    .where('story_id', '=', storyId)
    .where('chapter_number', '=', chapterNumber)
    .orderBy('updated_at', 'desc')
    .limit(1)
    .execute()
  if (rows.length === 0) {
    throw new Error(`tamper: no committed checkpoint for Bab ${chapterNumber}`)
  }
  return rows[0] as unknown as CheckpointRow
}

async function currentCanonRevision(_admin: unknown, storyId: string): Promise<number> {
  const db = getDb()
  // RLS_AUDIT(stories): SERVICE_ROLE_BYPASS - harness tamper probe read canon revision
  const { data, error } = await single(
    db
      .selectFrom('stories')
      .select('canon_state_revision')
      .where('id', '=', storyId)
      .execute()
  )
  if (error) throw new Error(`tamper: stories read failed: ${error.message}`)
  return Number(data?.canon_state_revision ?? 0)
}

/** Mutates one committed field; returns the SAME checkpoint payload otherwise. */
function tamperedDelta(row: CheckpointRow): Record<string, unknown> {
  return {
    ...row.state_delta_json,
    facts: {
      ...(typeof row.state_delta_json.facts === 'object' && row.state_delta_json.facts !== null
        ? (row.state_delta_json.facts as Record<string, unknown>)
        : {}),
      add: [
        {
          id: `${row.correlation_id}:fact:tamper:${randomUUID().slice(0, 8)}`,
          statement: 'TAMPERED FACT — must be rejected by provenance fencing.',
          subjectCharacterId: `${row.correlation_id}:char:hero`,
          salience: 0.9,
        },
      ],
    },
  }
}

function outcomeOf(raw: {
  ok?: boolean
  result?: string | null
  message?: string | null
}): {
  ok: boolean
  code: string
} {
  if (raw.ok === true) return { ok: true, code: String(raw.result ?? 'ACCEPTED') }
  const rpcMessage = raw.message ?? raw.result ?? ''
  return { ok: false, code: String(rpcMessage || 'REJECTED') }
}

/**
 * Runs all tamper probes for an already-published chapter and returns the
 * per-probe evidence. Never throws on a REJECTED probe; throws on a probe
 * production ACCEPTS (that is a genuine blocker-level gap).
 */
export async function probePublicationTamper(input: TamperProbeInput): Promise<FencingEvidenceV1[]> {
  const { admin, storyId, userId, chapterNumber, publicationMode } = input
  const db = getDb()
  const row = await loadCommittedCheckpoint(admin, storyId, chapterNumber)
  const base = await currentCanonRevision(admin, storyId)
  const evidence: FencingEvidenceV1[] = []

  const common = {
    p_story_id: storyId,
    p_chapter_number: chapterNumber,
    p_user_id: userId,
    p_checkpoint_attempt_id: row.attempt_id,
    p_correlation_id: row.correlation_id,
    p_title: row.title,
    p_paragraphs: row.paragraphs_json,
    p_prose_fingerprint: row.prose_fingerprint,
    p_audit_signals: row.audit_signals_json,
    p_audit_signals_version: row.audit_signals_version,
    p_canon_version: row.canon_version,
    p_blueprint_version: row.blueprint_version,
    p_direction_fingerprint: row.direction_fingerprint,
    p_generation_policy_version: row.generation_policy_version,
    p_prompt_contract_version: row.prompt_contract_version,
    p_state_delta_json: row.state_delta_json,
    p_base_canon_revision: base,
  }

  // ── 1. state_delta tamper: same attempt/correlation, MUTATED delta. The
  //    13-field replay compare must detect the delta change and fail closed.
  {
    // RLS_AUDIT(rpc): SERVICE_ROLE_BYPASS - harness tamper probe sync RPC state delta
    const { data: rawData, error } = await single(
      rpcOne(db, 'upsert_generation_checkpoint_sync_v1', {
        ...common,
        p_state_delta_json: tamperedDelta(row),
      }).execute()
    )
    const data = ((rawData as Record<string, unknown> | null)?.fn ?? rawData) as { ok?: boolean; result?: string | null } | null
    const { ok, code } = outcomeOf({ ok: data?.ok, result: data?.result, message: error?.message })
    evidence.push({
      chapterNumber,
      kind: 'state-delta-tamper',
      observedCode: code,
      rejected: !ok,
    })
  }

  // ── 2. attempt_id tamper: fresh attempt id, SAME correlation. The writer's
  //    symmetric provenance fence must reject the half-foreign identity.
  {
    // RLS_AUDIT(rpc): SERVICE_ROLE_BYPASS - harness tamper probe sync RPC attempt id
    const { data: rawData, error } = await single(
      rpcOne(db, 'upsert_generation_checkpoint_sync_v1', {
        ...common,
        p_checkpoint_attempt_id: randomUUID(),
      }).execute()
    )
    const data = ((rawData as Record<string, unknown> | null)?.fn ?? rawData) as { ok?: boolean; result?: string | null } | null
    const { ok, code } = outcomeOf({ ok: data?.ok, result: data?.result, message: error?.message })
    evidence.push({
      chapterNumber,
      kind: 'attempt-id-tamper',
      observedCode: code,
      rejected: !ok,
    })
  }

  // ── 3. job_id tamper (worker path only): a job that never existed must not
  //    be able to write a checkpoint for a published chapter.
  if (publicationMode === 'worker') {
    // RLS_AUDIT(rpc): SERVICE_ROLE_BYPASS - harness tamper probe fenced RPC job id
    const { data: rawData, error } = await single(
      rpcOne(db, 'upsert_generation_checkpoint_fenced_v2', {
        p_job_id: randomUUID(),
        p_worker_id: 'm10c-harness-tamper',
        p_claim_token: randomUUID(),
        p_lease_id: randomUUID(),
        p_story_id: storyId,
        p_chapter_number: chapterNumber,
        p_title: row.title,
        p_paragraphs: row.paragraphs_json,
        p_prose_fingerprint: row.prose_fingerprint,
        p_audit_signals: row.audit_signals_json,
        p_audit_signals_version: row.audit_signals_version,
        p_canon_version: row.canon_version,
        p_blueprint_version: row.blueprint_version,
        p_direction_fingerprint: row.direction_fingerprint,
        p_generation_mode: 'personalized',
        p_generation_policy_version: row.generation_policy_version,
        p_prompt_contract_version: row.prompt_contract_version,
        p_prose_attempt_count: 1,
        p_state_delta_json: row.state_delta_json,
        p_state_delta_schema_version: 1,
        p_base_canon_revision: base,
      }).execute()
    )
    const data = ((rawData as Record<string, unknown> | null)?.fn ?? rawData) as { ok?: boolean; result?: string | null } | null
    const { ok, code } = outcomeOf({ ok: data?.ok, result: data?.result, message: error?.message })
    evidence.push({
      chapterNumber,
      kind: 'job-id-tamper',
      observedCode: code,
      rejected: !ok,
    })
  }

  return evidence
}

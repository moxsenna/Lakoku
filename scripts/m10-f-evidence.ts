/**
 * M10-F post-run evidence collector.
 *
 * Read-only by construction: captures one already-complete isolated local story.
 * Never invokes generation/provider seams and never writes or repairs DB state.
 *
 * Run:
 *   LAKOKU_LOCAL_DB_TEST=1 M10F_PILOT_STORY_ID=m10c-m10f-... \
 *   M10F_PILOT_RUN_ID=m10-f-pilot-... M10F_PILOT_CORRELATION_ID=<uuid> \
 *   M10F_LIVE_CAPTURE_PATH=<chapter-captures.jsonl> \
 *     node scripts/run-smoke.cjs scripts/m10-f-evidence.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createAdminClient } from '../lib/supabase/admin'
import { scanForLeaks } from '@lakoku/ai-gateway'
import type {
  LongHorizonFindingV1,
  M10ArtifactManifestV1,
} from '../lib/narrative-qa/contracts/evaluator-contract'
import {
  computeFindingsHash,
  computeSha256,
  sortFindings,
} from '../lib/narrative-qa/scoring/canonical-serializer'
import { headShaOfWorkingTree } from '../lib/narrative-qa/git-sha'
import {
  captureActBoundary,
  captureChapter,
  captureEndingRunway,
  captureRepetition,
  type ChapterCaptureV1,
} from '../lib/narrative-qa/harness/capture'
import { evaluateEndingRunway } from '../lib/narrative-qa/evaluators/ending-evaluator'
import { evaluateRepetition } from '../lib/narrative-qa/evaluators/repetition-evaluator'
import { evaluateActBoundaryGate } from '../lib/narrative-qa/harness/act-boundary-evidence'
import {
  ACT_BOUNDARY_CHAPTERS,
  HARNESS_TOTAL_CHAPTERS,
} from '../lib/narrative-qa/harness/fixture'
import { assertIsolatedTarget } from '../lib/narrative-qa/harness/seed'
import {
  deriveM10FEvidenceResult,
  evidenceCaptureChapterNumbers,
  isE5ReviewRequiredEvent,
  scopeM10FTelemetryRows,
  validateM10FLiveChapterCaptures,
  type M10FLiveChapterCaptureRecord,
  type M10FPilotRunIdentity,
} from '../lib/narrative-qa/harness/m10-f-evidence-summary'
import {
  G5_NOCONFLICT_BLOCKER_REASON,
  G5_NOCONFLICT_DISPOSITION,
} from '../lib/narrative-qa/evaluators/fact-conflict-evaluator'
import { E0_R1_CEILINGS, E0_R1_DECISION_REF } from '../fixtures/m10-e/e0-budget-authority'
import { EVALUATOR_VERSIONS, M10A_CLOSURE_ANCHOR } from './m10-b-qa'
import {
  deriveM10FSemanticGateEvidence,
  validateM10FSemanticArtifact,
} from '../lib/narrative-qa/judges/m10-f-semantic-artifact'
import { buildM10FStorySurfaceFromIsolatedDatabase } from '../lib/narrative-qa/judges/m10-f-semantic-surface.server'
import {
  projectM10FStructuralContext,
  type M10FStructuralRows,
} from '../lib/narrative-qa/judges/m10-f-structural-context'
import { computeM10FStructuralContextHash } from '../lib/narrative-qa/judges/m10-f-semantic-assembly'
import { serializeM10FEvidenceArtifact } from './m10-f-evidence-artifact'

const STORY_ID_PATTERN = /^m10c-m10f-[a-z0-9-]+$/
const TERMINAL_CHECKPOINT_STATUSES = new Set(['PUBLISHED', 'EXPIRED', 'FAILED'])
const TERMINAL_JOB_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED'])
const USD_SCALE = 8
const LATENCY_WATCHPOINT_MS = 120_000

type Admin = ReturnType<typeof createAdminClient>
type ManifestWithEvidenceHashes = Omit<M10ArtifactManifestV1, 'schemaVersion' | 'artifactHashes'> & {
  schemaVersion: 2
  pilotIdentity: M10FPilotRunIdentity
  r1AuthorityId: string
  routeProfile: string[]
  artifactHashes: M10ArtifactManifestV1['artifactHashes'] & Record<string, string>
}

interface ProviderCallRow {
  story_id: string
  correlation_id: string
  chapter_number: number | null
  provider_call_id: string
  attempt_number: number | null
  fallback_index: number
  elapsed_ms: number
  outcome: string
  input_token_count: number | null
  output_token_count: number | null
  total_token_count: number | null
  cost_amount: number | string | null
  cost_currency: string | null
  cost_source: string
  route_version: string | null
}

function requireLiveCapturePath(): string | null {
  const path = process.env.M10F_LIVE_CAPTURE_PATH?.trim() ?? ''
  return path.length > 0 ? path : null
}

async function loadSemanticEvidence(identity: M10FPilotRunIdentity) {
  const artifactPathValue = process.env.M10F_SEMANTIC_ARTIFACT_PATH?.trim() ?? ''
  const expectedArtifactHash = process.env.M10F_SEMANTIC_ARTIFACT_SHA256?.trim() ?? ''
  const sourceManifestPathValue = process.env.M10F_SOURCE_EVIDENCE_MANIFEST_PATH?.trim() ?? ''
  const sourceCapturePathValue = process.env.M10F_SOURCE_CAPTURE_ARTIFACT_PATH?.trim() ?? ''
  const liveCapturePathValue = process.env.M10F_LIVE_CAPTURE_PATH?.trim() ?? ''
  const sourceManifestHash = process.env.M10F_SOURCE_EVIDENCE_MANIFEST_SHA256?.trim() ?? ''
  if (!artifactPathValue || !expectedArtifactHash || !sourceManifestPathValue || !sourceCapturePathValue || !liveCapturePathValue || !sourceManifestHash) return null
  const artifactPath = resolve(artifactPathValue)
  const sourcePaths = {
    sourceEvidenceManifestPath: resolve(sourceManifestPathValue),
    sourceCaptureArtifactPath: resolve(sourceCapturePathValue),
    liveCaptureArtifactPath: resolve(liveCapturePathValue),
  }
  const observedSourceManifestHash = computeSha256(readFileSync(sourcePaths.sourceEvidenceManifestPath, 'utf8'))
  if (observedSourceManifestHash !== sourceManifestHash) throw new Error('M10-F semantic source manifest byte hash mismatch')
  const surface = await buildM10FStorySurfaceFromIsolatedDatabase({ pilotIdentity: identity, sourcePaths })
  return validateM10FSemanticArtifact({
    artifact: JSON.parse(readFileSync(artifactPath, 'utf8')) as unknown,
    pilotIdentity: identity,
    expectedArtifactHash,
    ...sourcePaths,
    surface,
  })
}

function readLiveCaptures(path: string, expected: M10FPilotRunIdentity): M10FLiveChapterCaptureRecord[] {
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
  const records = lines.map((line, index) => {
    try {
      return JSON.parse(line) as M10FLiveChapterCaptureRecord
    } catch {
      throw new Error(`Invalid JSON in live capture line ${index + 1}`)
    }
  })
  validateM10FLiveChapterCaptures(records, expected, HARNESS_TOTAL_CHAPTERS)
  return records
}

function requirePilotRunIdentity(): M10FPilotRunIdentity {
  const storyId = process.env.M10F_PILOT_STORY_ID?.trim() ?? ''
  const runId = process.env.M10F_PILOT_RUN_ID?.trim() ?? ''
  const correlationId = process.env.M10F_PILOT_CORRELATION_ID?.trim() ?? ''
  if (!STORY_ID_PATTERN.test(storyId)) {
    throw new Error('M10F_PILOT_STORY_ID wajib namespace m10c-m10f-*')
  }
  if (!runId) throw new Error('M10F_PILOT_RUN_ID wajib diset eksplisit')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(correlationId)) {
    throw new Error('M10F_PILOT_CORRELATION_ID wajib UUID pilot yang valid')
  }
  return { storyId, runId, correlationId }
}

function decimalScaleFactor(scale: number): bigint {
  let factor = BigInt(1)
  for (let digit = 0; digit < scale; digit += 1) factor *= BigInt(10)
  return factor
}

function decimalToScaled(value: string, scale: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) throw new Error(`Nilai decimal telemetry tidak valid: ${value}`)
  const fraction = match[2] ?? ''
  if (fraction.length > scale) throw new Error(`Skala decimal telemetry melebihi ${scale}: ${value}`)
  return BigInt(match[1]) * decimalScaleFactor(scale) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale))
}

function scaledToDecimal(value: bigint, scale: number): string {
  const divisor = decimalScaleFactor(scale)
  return `${value / divisor}.${(value % divisor).toString().padStart(scale, '0')}`
}

function sumNullableIntegers(values: Array<number | null>): string | null {
  if (values.some((value) => value === null)) return null
  return values.reduce((sum, value) => sum + BigInt(value ?? 0), BigInt(0)).toString()
}

function percentile95(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null
}

function exactChapterSequence(numbers: number[]): boolean {
  return numbers.length === HARNESS_TOTAL_CHAPTERS
    && numbers.every((chapter, index) => chapter === index + 1)
}

function redactRawProviderText(findings: LongHorizonFindingV1[]): LongHorizonFindingV1[] {
  return findings.map((finding) => ({
    ...finding,
    message: finding.code === 'CHOICE_HISTORY_DUPLICATE_PREVIOUS'
      ? 'Choice history repeats previous choice; raw choice label redacted.'
      : finding.message,
    evidence: finding.evidence.map((evidence) => {
      const detail = { ...(evidence.detail ?? {}) }
      for (const key of ['snippet', 'choicePrompt', 'duplicateLabel']) {
        if (key in detail && detail[key] !== null) detail[key] = '<redacted:raw-provider-text>'
      }
      return { ...evidence, detail }
    }),
  }))
}

async function captureAudits(admin: Admin, storyId: string) {
  const [chaptersResult, readerResult, outcomesResult, eventsResult, leasesResult, checkpointsResult, jobsResult, contractResult, threadsResult] =
    await Promise.all([
      admin.from('chapters').select('number,title,paragraphs,choice_prompt,choices').eq('story_id', storyId).order('number'),
      admin.from('reader_states').select('user_id,status,current_chapter,choice_history,locked_ending_key').eq('story_id', storyId),
      admin.from('choice_outcomes').select('chapter_number').eq('story_id', storyId),
      admin.from('story_events').select('id,seq,type,payload').eq('story_id', storyId).order('seq'),
      admin.from('generation_leases').select('status').eq('story_id', storyId),
      admin.from('chapter_generation_checkpoints').select('chapter_number,status').eq('story_id', storyId),
      admin.from('generation_jobs').select('chapter_number,status').eq('story_id', storyId),
      admin.from('story_generation_contracts').select('story_contract_json,plot_debts_json,ending_lock_json').eq('story_id', storyId).single(),
      admin.from('story_threads').select('id,title,status,payoff_window').eq('story_id', storyId).order('id'),
    ])

  for (const [name, result] of [
    ['chapters', chaptersResult],
    ['reader_states', readerResult],
    ['choice_outcomes', outcomesResult],
    ['story_events', eventsResult],
    ['generation_leases', leasesResult],
    ['chapter_generation_checkpoints', checkpointsResult],
    ['generation_jobs', jobsResult],
    ['story_generation_contracts', contractResult],
    ['story_threads', threadsResult],
  ] as const) {
    if (result.error) throw new Error(`${name} read failed: ${result.error.message}`)
  }

  if ((readerResult.data ?? []).length !== 1) {
    throw new Error(`Expected exactly one reader_state for story; observed ${(readerResult.data ?? []).length}`)
  }
  const reader = readerResult.data![0]!
  const chapterNumbers = (chaptersResult.data ?? []).map((row) => Number(row.number))
  const distinctChapterNumbers = [...new Set(chapterNumbers)].sort((a, b) => a - b)
  const eventSeqs = (eventsResult.data ?? []).map((row) => Number(row.seq))
  const eventsMonotonic = eventSeqs.every((seq, index) => index === 0 || seq > eventSeqs[index - 1]!)
  const publishEventCount = (eventsResult.data ?? []).filter((row) => row.type === 'CHAPTER_PUBLISHED').length
  const generationFailureEventIds = (eventsResult.data ?? [])
    .filter(isE5ReviewRequiredEvent)
    .map((row) => String(row.id))
  const activeLeases = (leasesResult.data ?? []).filter((row) => row.status === 'ACTIVE').length
  const unresolvedCheckpoints = (checkpointsResult.data ?? []).filter(
    (row) => !TERMINAL_CHECKPOINT_STATUSES.has(String(row.status)),
  ).length
  const unresolvedJobs = (jobsResult.data ?? []).filter(
    (row) => !TERMINAL_JOB_STATUSES.has(String(row.status)),
  ).length
  const duplicateChapterNumbers = chapterNumbers.length - distinctChapterNumbers.length
  const brandLeakCount = (chaptersResult.data ?? []).reduce((count, row) => {
    const paragraphs = Array.isArray(row.paragraphs) ? row.paragraphs.map(String) : []
    const choiceLabels = Array.isArray(row.choices)
      ? row.choices.map((choice) => String((choice as { label?: unknown }).label ?? ''))
      : []
    const readerText = [String(row.title ?? ''), ...paragraphs, String(row.choice_prompt ?? ''), ...choiceLabels]
    return count + readerText.reduce((hits, text) => hits + scanForLeaks(text).length, 0)
  }, 0)

  const checks = [
    { code: 'EXACT_DISTINCT_CHAPTERS_1_TO_50', passed: exactChapterSequence(distinctChapterNumbers), detail: { chapterNumbers: distinctChapterNumbers } },
    { code: 'READER_SELESAI_AT_50', passed: reader.status === 'SELESAI' && Number(reader.current_chapter) === 50, detail: { status: reader.status, currentChapter: Number(reader.current_chapter) } },
    { code: 'CHOICE_OUTCOMES_EXACT_98', passed: (outcomesResult.data ?? []).length === 98, detail: { count: (outcomesResult.data ?? []).length } },
    { code: 'STORY_EVENTS_MONOTONIC', passed: eventsMonotonic, detail: { eventCount: eventSeqs.length } },
    { code: 'PUBLISH_EVENTS_EXACT_50', passed: publishEventCount === 50, detail: { count: publishEventCount } },
    { code: 'ACTIVE_LEASES_ZERO', passed: activeLeases === 0, detail: { count: activeLeases } },
    { code: 'UNRESOLVED_CHECKPOINTS_ZERO', passed: unresolvedCheckpoints === 0, detail: { count: unresolvedCheckpoints } },
    { code: 'UNRESOLVED_JOBS_ZERO', passed: unresolvedJobs === 0, detail: { count: unresolvedJobs } },
    { code: 'DUPLICATE_CHAPTER_NUMBERS_ZERO', passed: duplicateChapterNumbers === 0, detail: { count: duplicateChapterNumbers } },
    { code: 'BRAND_LEAK_ZERO', passed: brandLeakCount === 0, detail: { count: brandLeakCount } },
  ]

  const history = Array.isArray(reader.choice_history)
    ? reader.choice_history.map((entry) => entry as Record<string, unknown>)
    : []
  const acceptedChoiceByChapter = new Map<number, string>()
  for (const entry of history) {
    if (Number.isInteger(Number(entry.chapterNumber)) && typeof entry.choiceId === 'string') {
      acceptedChoiceByChapter.set(Number(entry.chapterNumber), entry.choiceId)
    }
  }
  const acceptedChoiceChapters = [...acceptedChoiceByChapter.keys()].sort((a, b) => a - b)
  checks.push({
    code: 'ACCEPTED_CHOICE_HISTORY_EXACT_1_TO_49',
    passed: acceptedChoiceChapters.length === 49
      && acceptedChoiceChapters.every((chapter, index) => chapter === index + 1),
    detail: { chapterNumbers: acceptedChoiceChapters },
  })

  const structuralRows: M10FStructuralRows = {
    storyContract: (contractResult.data!.story_contract_json ?? {}) as Record<string, unknown>,
    plotDebts: Array.isArray(contractResult.data!.plot_debts_json)
      ? contractResult.data!.plot_debts_json
      : [],
    endingLock: (contractResult.data!.ending_lock_json ?? {}) as Record<string, unknown>,
    lockedEndingKey: reader.locked_ending_key ? String(reader.locked_ending_key) : null,
    threads: (threadsResult.data ?? []).map((thread) => ({
      id: String(thread.id),
      title: String(thread.title),
      status: String(thread.status),
      payoffWindow: thread.payoff_window === null ? null : Number(thread.payoff_window),
    })),
  }
  const structuralContextPayload = projectM10FStructuralContext(structuralRows)

  return {
    readerUserId: String(reader.user_id),
    acceptedChoiceByChapter,
    generationFailureEventIds,
    structuralContext: {
      payload: structuralContextPayload,
      structuralContextHash: computeM10FStructuralContextHash(structuralContextPayload),
    },
    checks,
    passed: checks.every((check) => check.passed),
  }
}

async function captureTelemetry(admin: Admin, identity: M10FPilotRunIdentity) {
  const { data, error } = await admin
    .from('generation_provider_calls')
    .select('story_id,correlation_id,chapter_number,provider_call_id,attempt_number,fallback_index,elapsed_ms,outcome,input_token_count,output_token_count,total_token_count,cost_amount,cost_currency,cost_source,route_version')
    .eq('story_id', identity.storyId)
    .eq('correlation_id', identity.correlationId)
    .order('started_at', { ascending: true })
  if (error) throw new Error(`generation_provider_calls read failed: ${error.message}`)
  const rows = scopeM10FTelemetryRows((data ?? []) as unknown as ProviderCallRow[], {
    storyId: identity.storyId,
    correlationId: identity.correlationId,
    expectedChapterNumbers: evidenceCaptureChapterNumbers('LIVE_CHAPTER_LOCAL', HARNESS_TOTAL_CHAPTERS),
    rejectUnscopedRows: true,
  })

  const pricedRows = rows.filter((row) => row.cost_amount !== null)
  const costComplete = rows.length > 0
    && pricedRows.length === rows.length
    && rows.every((row) => row.cost_currency === 'USD' && row.cost_source !== 'unavailable')
  const totalCostScaled = pricedRows.reduce(
    (sum, row) => sum + decimalToScaled(String(row.cost_amount), USD_SCALE),
    BigInt(0),
  )
  const totalCostUsd = scaledToDecimal(totalCostScaled, USD_SCALE)
  const chapterCount = BigInt(HARNESS_TOTAL_CHAPTERS)
  // Cost rows carry 8 decimals. Dividing by 50 is exact at 10 decimals because
  // scaled10 = scaled8 * 100 / 50 = scaled8 * 2.
  const meanCostScale = USD_SCALE + 2
  const meanCostScaled = totalCostScaled * BigInt(100) / chapterCount
  const meanCostPerChapterUsd = scaledToDecimal(meanCostScaled, meanCostScale)
  const totalCeilingScaled = decimalToScaled(E0_R1_CEILINGS.maxExpectedCostPerNovel, USD_SCALE)
  const meanCeilingScaled = decimalToScaled(E0_R1_CEILINGS.maxExpectedCostPerChapter, USD_SCALE)
  const p95ElapsedMs = percentile95(rows.map((row) => Number(row.elapsed_ms)))

  return {
    pilotIdentity: identity,
    observedChapterNumbers: [...new Set(rows.map((row) => row.chapter_number as number))].sort((a, b) => a - b),
    expectedHorizon: { fromChapter: 1, toChapter: HARNESS_TOTAL_CHAPTERS },
    providerCallCount: rows.length,
    inputTokens: sumNullableIntegers(rows.map((row) => row.input_token_count)),
    outputTokens: sumNullableIntegers(rows.map((row) => row.output_token_count)),
    totalTokens: sumNullableIntegers(rows.map((row) => row.total_token_count)),
    totalCostUsd,
    meanCostPerChapterUsd,
    retryCount: rows.filter(
      (row) => (row.attempt_number !== null && row.attempt_number > 1) || row.fallback_index > 0,
    ).length,
    retrySemantics: 'provider calls with attempt_number > 1 or fallback_index > 0',
    p95ElapsedMs,
    latencyWatchpoint: {
      thresholdMs: LATENCY_WATCHPOINT_MS,
      status: p95ElapsedMs !== null && p95ElapsedMs >= LATENCY_WATCHPOINT_MS ? 'WATCH' : 'CLEAR',
      gating: false,
    },
    failedProviderCallCount: rows.filter((row) => row.outcome !== 'SUCCEEDED').length,
    failedProviderCallIds: rows.filter((row) => row.outcome !== 'SUCCEEDED').map((row) => row.provider_call_id),
    routeProfile: [...new Set(rows.map((row) => row.route_version ?? 'unversioned'))].sort(),
    costCoverage: { complete: costComplete, pricedCalls: pricedRows.length, totalCalls: rows.length },
    budgetGates: {
      authorityId: E0_R1_DECISION_REF,
      total: {
        observedUsd: totalCostUsd,
        ceilingUsd: E0_R1_CEILINGS.maxExpectedCostPerNovel,
        passed: costComplete && totalCostScaled <= totalCeilingScaled,
      },
      meanPerChapter: {
        observedUsd: meanCostPerChapterUsd,
        ceilingUsd: E0_R1_CEILINGS.maxExpectedCostPerChapter,
        passed: costComplete && totalCostScaled <= meanCeilingScaled * chapterCount,
      },
    },
  }
}

async function captureE5(admin: Admin, storyId: string, generationFailureEventIds: string[]) {
  const [queue, resolutions, audits, proofs] = await Promise.all([
    admin.from('blueprint_queue').select('status,source_event_id').eq('story_id', storyId),
    admin.from('blueprint_resolutions').select('disposition').eq('story_id', storyId),
    admin.from('blueprint_audit_log').select('id').eq('story_id', storyId),
    admin.from('blueprint_validator_proofs').select('id').eq('story_id', storyId),
  ])
  for (const [name, result] of [
    ['blueprint_queue', queue],
    ['blueprint_resolutions', resolutions],
    ['blueprint_audit_log', audits],
    ['blueprint_validator_proofs', proofs],
  ] as const) {
    if (result.error) throw new Error(`${name} read failed: ${result.error.message}`)
  }

  const queuedEventIds = new Set((queue.data ?? []).map((row) => String(row.source_event_id)))
  const unmappedFailureIds = generationFailureEventIds.filter((id) => !queuedEventIds.has(id))
  const limitation = unmappedFailureIds.length > 0
    ? 'Generation failure story_events exist without story-scoped blueprint_queue.source_event_id mapping; required E5 enqueue coverage cannot be proven.'
    : null

  return {
    rerunPerformed: false,
    queueCount: (queue.data ?? []).length,
    queueStatuses: (queue.data ?? []).map((row) => String(row.status)).sort(),
    resolutionCount: (resolutions.data ?? []).length,
    resolutionDispositions: (resolutions.data ?? []).map((row) => String(row.disposition)).sort(),
    auditCount: (audits.data ?? []).length,
    proofCount: (proofs.data ?? []).length,
    requiredFailureCount: generationFailureEventIds.length,
    honestlyMappedFailureCount: generationFailureEventIds.length - unmappedFailureIds.length,
    unmappedFailureIds,
    coveragePassed: unmappedFailureIds.length === 0,
    disposition: limitation ? 'EVIDENCE_LIMITATION' : generationFailureEventIds.length > 0 ? 'OBSERVED' : 'NOT_REQUIRED',
    evidenceLimitation: limitation,
  }
}

function writeArtifact(directory: string, name: string, value: unknown): string {
  const artifact = serializeM10FEvidenceArtifact(value)
  writeFileSync(join(directory, name), artifact.content, 'utf8')
  return artifact.sha256
}

async function main(): Promise<void> {
  if (process.env.LAKOKU_LOCAL_DB_TEST !== '1') {
    throw new Error('LAKOKU_LOCAL_DB_TEST=1 wajib diset (opt-in DB lokal).')
  }
  const pilotIdentity = requirePilotRunIdentity()
  const { storyId } = pilotIdentity
  assertIsolatedTarget()
  const admin = createAdminClient()
  const startedAt = new Date().toISOString()
  const { headSha, workingTreeDirty } = headShaOfWorkingTree()

  const auditCapture = await captureAudits(admin, storyId)
  const liveCapturePath = requireLiveCapturePath()
  const liveCaptureRecords = liveCapturePath
    ? readLiveCaptures(liveCapturePath, pilotIdentity)
    : null
  const captureMode = liveCaptureRecords ? 'LIVE_CHAPTER_LOCAL' as const : 'POST_HORIZON' as const
  const chapterCaptures: Array<ChapterCaptureV1 & { contentHash?: string }> = liveCaptureRecords
    ? liveCaptureRecords.map((record) => ({
        ...record.capture,
        contentHash: record.contentHash,
      }))
    : []
  const chapterFindings: LongHorizonFindingV1[] = liveCaptureRecords
    ? liveCaptureRecords.flatMap((record) => record.findings)
    : []
  for (const chapterNumber of liveCaptureRecords
    ? []
    : evidenceCaptureChapterNumbers('POST_HORIZON', HARNESS_TOTAL_CHAPTERS)) {
    const captured = await captureChapter({
      admin,
      storyId,
      userId: auditCapture.readerUserId,
      chapterNumber,
      acceptedChoiceId: chapterNumber < 50
        ? auditCapture.acceptedChoiceByChapter.get(chapterNumber) ?? null
        : null,
    })
    chapterCaptures.push({
      chapterNumber: captured.capture.chapterNumber,
      canonRevision: captured.capture.canonRevision,
      stateDeltaHash: captured.capture.stateDeltaHash,
      baseCanonRevision: captured.capture.baseCanonRevision,
      checkpointSchemaVersion: captured.capture.checkpointSchemaVersion,
      checkpointStatus: captured.capture.checkpointStatus,
      publishedTitle: captured.capture.publishedTitle,
      choiceIds: captured.capture.choiceIds,
      acceptedChoiceId: captured.capture.acceptedChoiceId,
      contextBudget: captured.capture.contextBudget,
      captureHash: captured.capture.captureHash,
    })
    chapterFindings.push(...captured.findings)
  }

  const repetitionEnvelope = await captureRepetition(admin, storyId, 50)
  const endingEnvelope = await captureEndingRunway(admin, storyId, auditCapture.readerUserId)
  const repetitionFindings = evaluateRepetition(repetitionEnvelope)
  const endingFindings = evaluateEndingRunway(endingEnvelope)
  const actBoundaries = []
  for (const chapterNumber of ACT_BOUNDARY_CHAPTERS) {
    actBoundaries.push(await captureActBoundary(admin, storyId, auditCapture.readerUserId, chapterNumber))
  }
  const actBoundaryGate = evaluateActBoundaryGate(actBoundaries)
  const findings = sortFindings(
    redactRawProviderText([...chapterFindings, ...repetitionFindings, ...endingFindings]),
  )
  const telemetry = await captureTelemetry(admin, pilotIdentity)
  const e5 = await captureE5(admin, storyId, auditCapture.generationFailureEventIds)
  const semanticEvidence = await loadSemanticEvidence(pilotIdentity)
  const semanticGate = deriveM10FSemanticGateEvidence(semanticEvidence)

  const endingGatePassed = endingFindings.every(
    (finding) => finding.severity !== 'BLOCKER' && finding.severity !== 'HIGH',
  )
  const repetitionGatePassed = repetitionFindings.every(
    (finding) => finding.severity !== 'BLOCKER' && finding.severity !== 'HIGH',
  )
  const gateResult = deriveM10FEvidenceResult({
    findings,
    completionAuditsPassed: auditCapture.passed,
    actBoundaryGatePassed: actBoundaryGate.passed,
    endingGatePassed,
    repetitionGatePassed,
    liveChapterCapturesPassed: liveCaptureRecords !== null,
    e5CoveragePassed: e5.unmappedFailureIds.length === 0,
    semanticEvidence,
    totalBudgetPassed: telemetry.budgetGates.total.passed,
    meanBudgetPassed: telemetry.budgetGates.meanPerChapter.passed,
  })

  const captures = {
    schemaVersion: 2 as const,
    ...pilotIdentity,
    captureMode,
    structuralContext: auditCapture.structuralContext,
    chapters: chapterCaptures,
    repetition: {
      evaluatorId: repetitionEnvelope.evaluatorId,
      evaluatorVersion: repetitionEnvelope.evaluatorVersion,
      horizon: repetitionEnvelope.horizon,
      chapterCount: repetitionEnvelope.input.chapters.length,
    },
    ending: {
      evaluatorId: endingEnvelope.evaluatorId,
      evaluatorVersion: endingEnvelope.evaluatorVersion,
      horizon: endingEnvelope.horizon,
      publicationCount: endingEnvelope.input.publications.length,
    },
    actBoundaries,
  }
  const audit = { checks: auditCapture.checks, passed: auditCapture.passed, e5 }
  const summary = {
    ...pilotIdentity,
    result: gateResult.result,
    failedGates: gateResult.failedGates,
    deterministicFindings: {
      total: findings.length,
      blockerOrHigh: gateResult.blockerOrHighFindingCount,
      ending: endingFindings.length,
      repetition: repetitionFindings.length,
    },
    gates: {
      completionAudits: auditCapture.passed,
      actBoundary: actBoundaryGate,
      ending: endingGatePassed,
      repetition: repetitionGatePassed,
      liveChapterCaptures: liveCaptureRecords !== null,
      e5ReviewEnqueueCoverage: e5.coveragePassed,
      semanticDR1R8: semanticGate,
      totalBudget: telemetry.budgetGates.total,
      meanBudget: telemetry.budgetGates.meanPerChapter,
    },
    g5NoConflict: {
      disposition: G5_NOCONFLICT_DISPOSITION,
      coverage: 'INERT_NOT_EVALUATED',
      reason: G5_NOCONFLICT_BLOCKER_REASON,
    },
    e5Disposition: e5,
  }

  const findingsHash = computeFindingsHash(findings)
  const runId = `m10-f-${startedAt.replace(/[:.]/g, '-').slice(0, 19)}-${findingsHash.slice(0, 8)}`
  const targetDir = join(process.cwd(), '.zcode', 'artifacts', 'm10-f-evidence', runId)
  mkdirSync(targetDir, { recursive: true })
  const hashes = {
    capturesHash: writeArtifact(targetDir, 'captures.json', captures),
    findingsHash: writeArtifact(targetDir, 'findings.json', findings),
    telemetryHash: writeArtifact(targetDir, 'telemetry.json', telemetry),
    auditHash: writeArtifact(targetDir, 'audit.json', audit),
    summaryHash: writeArtifact(targetDir, 'summary.json', summary),
  }
  const finishedAt = new Date().toISOString()
  const manifest: ManifestWithEvidenceHashes = {
    schemaVersion: 2,
    stage: 'F',
    baselineSha: headSha,
    headSha,
    workingTreeDirty,
    m10aClosureAnchor: M10A_CLOSURE_ANCHOR,
    pilotIdentity,
    runId,
    startedAt,
    finishedAt,
    environment: 'isolated-qa',
    storyIds: [storyId],
    routeProfiles: telemetry.routeProfile,
    routeProfile: telemetry.routeProfile,
    runtimePolicyVersions: {
      chapters: 50,
      evidenceCollector: '1.2.0',
      structuralContextCapture: '1.0.0',
      deterministicCaptureMode: captureMode,
    },
    evaluatorVersions: EVALUATOR_VERSIONS,
    r1AuthorityId: E0_R1_DECISION_REF,
    artifactHashes: hashes,
    result: gateResult.result,
  }
  writeArtifact(targetDir, 'manifest.json', manifest)

  console.log(`M10-F evidence: ${gateResult.result}`)
  console.log(`Story: ${storyId}`)
  console.log(`Artifacts: ${targetDir}`)
  if (gateResult.failedGates.length > 0) console.error(`Failed gates: ${gateResult.failedGates.join(', ')}`)
  if (e5.evidenceLimitation) console.error(`E5 evidence limitation: ${e5.evidenceLimitation}`)
  process.exitCode = gateResult.result === 'PASS' ? 0 : 1
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

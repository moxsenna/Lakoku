import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  E1_EXECUTABLE_SCENARIO_IDS,
  E2NormalizedArtifactEnvelopeSchema,
  E2RawArtifactEnvelopeSchema,
  E2_SCENARIO_IDS,
  assembleE2Evidence,
  createWorkingTreeGitReader,
  evaluateE1Gate,
  evaluateE2Gate,
  hashNormalizedE1Evidence,
  hashNormalizedE2Evidence,
  headShaOfWorkingTree,
  normalizeE1Evidence,
  normalizeE2Evidence,
  runFaultMatrix,
  stableStringify,
  type E1CoverageMetadata,
  type E1Evidence,
  type E2Evidence,
  type E2NormalizedArtifactEnvelope,
  type E2ProducerResult,
  type E2RawArtifactEnvelope,
} from '../lib/narrative-qa/fault'

export const E1_SEED = 'm10-e1-seed-v1'
export const E1_ARTIFACT_DIR = join('.zcode', 'artifacts', 'm10-e1')
export const E1_RAW_EVIDENCE_PATH = join(E1_ARTIFACT_DIR, 'm10-e1-fault-evidence.raw.json')
export const E1_NORMALIZED_EVIDENCE_PATH = join(E1_ARTIFACT_DIR, 'm10-e1-fault-evidence.normalized.json')
export const E2_ARTIFACT_DIR = join('.zcode', 'artifacts', 'm10-e2')
export const E2_RAW_EVIDENCE_PATH = join(E2_ARTIFACT_DIR, 'm10-e2-fault-evidence.raw.json')
export const E2_NORMALIZED_EVIDENCE_PATH = join(E2_ARTIFACT_DIR, 'm10-e2-fault-evidence.normalized.json')

export const E1_HISTORICAL_REFERENCES: E1CoverageMetadata[] = [
  { id: 'W2_EXACT_REPLAY_SAME_JOB', disposition: 'REPLACED_REFERENCE', reason: 'Current M10-C exact replay evidence is authority.' },
  { id: 'PB3_DUPLICATE_PUBLISH', disposition: 'REPLACED_REFERENCE', reason: 'Current M10-C replay/tamper evidence is authority.' },
  { id: 'PB4_SYNC_VS_WORKER_RACE', disposition: 'NOT_EXECUTABLE_E1', reason: 'Same-process E1 cannot execute the cross-process sync-vs-worker publication race because process-local withGenerationSlot blocks the second local contender before publishChapterSchema3; this does not make the runtime race inapplicable.' },
  { id: 'POST2_COMPLETION_AFTER_FAULTS', disposition: 'REPLACED_REFERENCE', reason: 'Completion check runs after schedule; it is not a fault scenario.' },
]

export const E1_E2_GAPS: E1CoverageMetadata[] = [
  { id: 'PUBLICATION_CONCURRENCY_SYNC_VS_WORKER', disposition: 'OPEN_E2', reason: 'Cross-process sync-vs-worker publication race requires an E2 concurrency harness.' },
  { id: 'TRANSACTION_ROLLBACK_AFTER_CHAPTER_INSERT_BEFORE_STATE_COMMIT', disposition: 'OPEN_E2', reason: 'PB2 is a pre-existing chapter conflict/residue proxy; transaction rollback at the internal SQL boundary remains open for E2.' },
  { id: 'MALFORMED_CHOICES_OUTPUT', disposition: 'MISSING', reason: 'Separate choice-provider fault seam required.' },
  { id: 'MALFORMED_STATE_PROPOSAL_DELTA', disposition: 'MISSING', reason: 'Materializer-level fault probe required.' },
  { id: 'PROVIDER_FALLBACK_SUCCEEDS', disposition: 'OPEN_E2', reason: 'A deterministic E2 fault seam required without real provider call.' },
  { id: 'STALE_LEASE_RECLAMATION', disposition: 'MISSING', reason: 'W3 proves ownership loss, not TTL reclamation.' },
  { id: 'CHECKPOINT_MISMATCH_CLASSES', disposition: 'NOT_EXECUTED_E1', reason: 'Related current M10-C reference only.' },
  { id: 'FAILURE_AFTER_APPLIER_BEFORE_TERMINALIZATION', disposition: 'MISSING', reason: 'No TypeScript seam inside atomic SQL publication.' },
  { id: 'NOTIFICATION_OUTBOX_FAILURE', disposition: 'N/A', reason: 'Current V3/V5 call path writes no notification/outbox row.' },
]

export function bootstrapLocalSupabaseEnv(): void {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL
    return
  }
  const output = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
  })
  const env = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/)
    if (match) env.set(match[1], match[2] ?? match[3] ?? '')
  }
  process.env.SUPABASE_URL = env.get('API_URL') ?? process.env.SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.get('SERVICE_ROLE_KEY') ?? process.env.SUPABASE_SERVICE_ROLE_KEY
}

export interface E1ExecutionResult {
  evidence: E1Evidence
  gate: ReturnType<typeof evaluateE1Gate>
  normalized: ReturnType<typeof normalizeE1Evidence>
  normalizedHash: string
  resetProof: E2Evidence['resetProof']
}

export async function executeM10E1(input: {
  baseGitSha?: string
  workingTreeDirty?: boolean
  runMatrix?: typeof runFaultMatrix
  now?: () => Date
} = {}): Promise<E1ExecutionResult> {
  const now = input.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const git = input.baseGitSha === undefined ? headShaOfWorkingTree() : {
    headSha: input.baseGitSha,
    workingTreeDirty: input.workingTreeDirty ?? false,
  }
  const run = await (input.runMatrix ?? runFaultMatrix)()
  const failedInvariants = run.scenarios.flatMap((scenario) => [
    ...scenario.invariantChecks.afterFault, ...(scenario.invariantChecks.afterRecovery ?? []),
  ]).filter((invariant) => !invariant.passed)
  const evidence: E1Evidence = {
    version: 'm10-e1-fault-evidence/v1', baseGitSha: git.headSha, workingTreeDirty: git.workingTreeDirty,
    seed: E1_SEED, faultSchedule: [...E1_EXECUTABLE_SCENARIO_IDS],
    scenarios: run.scenarios.map((scenario) => ({
      id: scenario.id, injectedBoundary: scenario.injectedBoundary, injectionReached: scenario.injectionReached,
      expectedDisposition: scenario.expectedDisposition, observedDisposition: scenario.observedDisposition,
      recoveryExpected: scenario.recoveryExpected, recovered: scenario.outcome.recovered,
      harnessRecoveryInvocations: scenario.harnessRecoveryInvocations, invariantChecks: scenario.invariantChecks,
      ...(scenario.runtimeProviderAttempts ? { runtimeProviderAttempts: scenario.runtimeProviderAttempts } : {}),
      ...(scenario.checkpointRecovery ? { checkpointRecovery: scenario.checkpointRecovery } : {}),
    })),
    historicalReferences: E1_HISTORICAL_REFERENCES, e2Gaps: E1_E2_GAPS,
    duplicatePublicationCount: failedInvariants.filter((item) => item.code === 'INV_CHAPTERS_COUNT' || item.code === 'INV_ONE_COMMIT_PER_CHAPTER').length,
    canonicalCorruptionCount: failedInvariants.filter((item) => ['INV_COMMITS_COUNT', 'INV_CANON_REVISION', 'INV_NO_STATE_BEYOND_CANON'].includes(item.code)).length,
    unboundedRetryCount: run.scenarios.filter((scenario) => scenario.runtimeProviderAttempts != null && scenario.runtimeProviderAttempts.writeAttempts > scenario.runtimeProviderAttempts.productionCeiling).length,
    runMetadata: { startedAt, finishedAt: now().toISOString(), rawAttemptIds: [], latenciesMs: run.cleanLatenciesMs },
  }
  return {
    evidence,
    gate: evaluateE1Gate(evidence),
    normalized: normalizeE1Evidence(evidence),
    normalizedHash: hashNormalizedE1Evidence(evidence),
    resetProof: run.resetProof,
  }
}

export async function runM10E1Cli(): Promise<number> {
  bootstrapLocalSupabaseEnv()
  const result = await executeM10E1()
  mkdirSync(E1_ARTIFACT_DIR, { recursive: true })
  writeFileSync(E1_RAW_EVIDENCE_PATH, `${stableStringify({ ...result.evidence, gate: result.gate, normalizedHash: result.normalizedHash })}\n`, 'utf8')
  writeFileSync(E1_NORMALIZED_EVIDENCE_PATH, `${stableStringify({ evidence: result.normalized, gate: result.gate, normalizedHash: result.normalizedHash })}\n`, 'utf8')
  console.log(`M10-E E1 result: ${result.gate.result}`)
  console.log(`scenarios: ${result.evidence.scenarios.length}/${E1_EXECUTABLE_SCENARIO_IDS.length}`)
  console.log(`baseGitSha: ${result.evidence.baseGitSha}`)
  console.log(`workingTreeDirty: ${result.evidence.workingTreeDirty}`)
  console.log(`seed: ${E1_SEED}`)
  console.log(`normalizedEvidenceHash: ${result.normalizedHash}`)
  for (const failure of result.gate.failures) console.error(`FAIL ${failure}`)
  return result.gate.result === 'PASS' ? 0 : 1
}

export interface E2ArtifactPair {
  raw: E2RawArtifactEnvelope
  normalized: E2NormalizedArtifactEnvelope
}

export function validateE2ArtifactPair(rawInput: unknown, normalizedInput: unknown): E2ArtifactPair {
  const raw = E2RawArtifactEnvelopeSchema.parse(rawInput)
  const normalized = E2NormalizedArtifactEnvelopeSchema.parse(normalizedInput)
  const expectedGate = evaluateE2Gate(raw.evidence)
  const expectedEvidence = normalizeE2Evidence(raw.evidence)
  const expectedHash = hashNormalizedE2Evidence(raw.evidence)
  if (stableStringify(raw.gate) !== stableStringify(expectedGate)
    || raw.normalizedHash !== expectedHash
    || stableStringify(normalized.evidence) !== stableStringify(expectedEvidence)
    || stableStringify(normalized.gate) !== stableStringify(expectedGate)
    || normalized.normalizedHash !== expectedHash
    || raw.evidence.rows.length !== E2_SCENARIO_IDS.length
    || stableStringify(raw.evidence.rows.map((row) => row.id)) !== stableStringify(E2_SCENARIO_IDS)) {
    throw new Error('E2_ARTIFACT_PAIR_MISMATCH')
  }
  return { raw, normalized }
}

export interface E2ExecutionDeps {
  git: { readHeadSha: () => Promise<string>; readWorkingTreeDirty: () => Promise<boolean> }
  executeE1: (baseGitSha: string) => Promise<E1ExecutionResult>
  runNonDbProofs: (baseGitSha: string) => Promise<E2ProducerResult>
  runTask3Proofs: () => Promise<E2ProducerResult>
  now?: () => Date
}

export async function executeM10E2(deps: E2ExecutionDeps): Promise<E2ArtifactPair> {
  const baseGitSha = await deps.git.readHeadSha()
  const workingTreeDirty = await deps.git.readWorkingTreeDirty()
  if (workingTreeDirty) throw new Error('E2_DIRTY_TREE_BEFORE_MUTABLE_PROOF')
  const now = deps.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const e1 = await deps.executeE1(baseGitSha)
  if (e1.evidence.baseGitSha !== baseGitSha) throw new Error('E2_E1_BASE_SHA_MISMATCH')
  const nonDb = await deps.runNonDbProofs(baseGitSha)
  const task3 = await deps.runTask3Proofs()
  const e1Producer: E2ProducerResult = { rows: [], resetProof: e1.resetProof }
  const evidence = assembleE2Evidence({
    baseGitSha, workingTreeDirty, producers: [nonDb, e1Producer, task3],
    e1Regression: { baseGitSha: e1.evidence.baseGitSha, result: e1.gate.result === 'PASS' ? 'PASS' : 'FAIL' },
    runMetadata: { startedAt, finishedAt: now().toISOString(), attemptIds: [], latenciesMs: [] },
  })
  const gate = evaluateE2Gate(evidence)
  const normalizedHash = hashNormalizedE2Evidence(evidence)
  const raw = { evidence, gate, normalizedHash }
  const normalized = { evidence: normalizeE2Evidence(evidence), gate, normalizedHash }
  return validateE2ArtifactPair(raw, normalized)
}

export async function runM10E2Cli(): Promise<number> {
  bootstrapLocalSupabaseEnv()
  const {
    createM10E2NonDbBindings,
    runM10E2NonDbProofs,
    runM10E2Task3LocalProofs,
  } = await import('../lib/narrative-qa/fault')
  const pair = await executeM10E2({
    git: createWorkingTreeGitReader(),
    executeE1: (sha) => executeM10E1({ baseGitSha: sha, workingTreeDirty: false }),
    runNonDbProofs: (sha) => runM10E2NonDbProofs(sha, createM10E2NonDbBindings()),
    runTask3Proofs: runM10E2Task3LocalProofs,
  })
  mkdirSync(E2_ARTIFACT_DIR, { recursive: true })
  writeFileSync(E2_RAW_EVIDENCE_PATH, `${stableStringify(pair.raw)}\n`, 'utf8')
  writeFileSync(E2_NORMALIZED_EVIDENCE_PATH, `${stableStringify(pair.normalized)}\n`, 'utf8')
  console.log(`M10-E E2 result: ${pair.normalized.gate.result}`)
  console.log(`rows: ${pair.raw.evidence.rows.length}/${E2_SCENARIO_IDS.length}`)
  console.log(`baseGitSha: ${pair.raw.evidence.baseGitSha}`)
  console.log(`normalizedEvidenceHash: ${pair.normalized.normalizedHash}`)
  for (const failure of pair.normalized.gate.failures) console.error(`${pair.normalized.gate.result} ${failure}`)
  return pair.normalized.gate.result === 'PASS' ? 0 : 1
}

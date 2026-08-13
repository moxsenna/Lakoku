import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  E1_EXECUTABLE_SCENARIO_IDS,
  evaluateE1Gate,
  hashNormalizedE1Evidence,
  normalizeE1Evidence,
  type E1CoverageMetadata,
  type E1Evidence,
} from '../lib/narrative-qa/fault/evidence'
import { runFaultMatrix } from '../lib/narrative-qa/fault/scenarios'
import { headShaOfWorkingTree } from '../lib/narrative-qa/git-sha'
import { stableStringify } from '../lib/narrative-qa/scoring/canonical-serializer'

export const E1_SEED = 'm10-e1-seed-v1'
export const E1_ARTIFACT_DIR = join('.zcode', 'artifacts', 'm10-e1')
export const E1_RAW_EVIDENCE_PATH = join(E1_ARTIFACT_DIR, 'm10-e1-fault-evidence.raw.json')
export const E1_NORMALIZED_EVIDENCE_PATH = join(E1_ARTIFACT_DIR, 'm10-e1-fault-evidence.normalized.json')

export const E1_HISTORICAL_REFERENCES: E1CoverageMetadata[] = [
  { id: 'W2_EXACT_REPLAY_SAME_JOB', disposition: 'REPLACED_REFERENCE', reason: 'Current M10-C exact replay evidence is authority.' },
  { id: 'PB3_DUPLICATE_PUBLISH', disposition: 'REPLACED_REFERENCE', reason: 'Current M10-C replay/tamper evidence is authority.' },
  {
    id: 'PB4_SYNC_VS_WORKER_RACE',
    disposition: 'NOT_EXECUTABLE_E1',
    reason:
      'Same-process E1 cannot execute the cross-process sync-vs-worker publication race because process-local '
      + 'withGenerationSlot blocks the second local contender before publishChapterSchema3; this does not make the runtime race inapplicable.',
  },
  { id: 'POST2_COMPLETION_AFTER_FAULTS', disposition: 'REPLACED_REFERENCE', reason: 'Completion check runs after schedule; it is not a fault scenario.' },
]

export const E1_E2_GAPS: E1CoverageMetadata[] = [
  {
    id: 'PUBLICATION_CONCURRENCY_SYNC_VS_WORKER',
    disposition: 'OPEN_E2',
    reason: 'Cross-process sync-vs-worker publication race requires an E2 concurrency harness.',
  },
  {
    id: 'TRANSACTION_ROLLBACK_AFTER_CHAPTER_INSERT_BEFORE_STATE_COMMIT',
    disposition: 'OPEN_E2',
    reason: 'PB2 is a pre-existing chapter conflict/residue proxy; transaction rollback at the internal SQL boundary remains open for E2.',
  },
  { id: 'MALFORMED_CHOICES_OUTPUT', disposition: 'MISSING', reason: 'Separate choice-provider fault seam required.' },
  { id: 'MALFORMED_STATE_PROPOSAL_DELTA', disposition: 'MISSING', reason: 'Materializer-level fault probe required.' },
  {
    id: 'PROVIDER_FALLBACK_SUCCEEDS',
    disposition: 'OPEN_E2',
    reason: 'A deterministic E2 fault seam required without real provider call.',
  },
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
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
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

export async function runM10E1Cli(): Promise<number> {
  bootstrapLocalSupabaseEnv()
  const startedAt = new Date().toISOString()
  const { headSha, workingTreeDirty } = headShaOfWorkingTree()
  const run = await runFaultMatrix()
  const finishedAt = new Date().toISOString()

  const failedInvariants = run.scenarios.flatMap((scenario) => [
    ...scenario.invariantChecks.afterFault,
    ...(scenario.invariantChecks.afterRecovery ?? []),
  ]).filter((invariant) => !invariant.passed)
  const duplicatePublicationCount = failedInvariants.filter((invariant) =>
    invariant.code === 'INV_CHAPTERS_COUNT' || invariant.code === 'INV_ONE_COMMIT_PER_CHAPTER').length
  const canonicalCorruptionCount = failedInvariants.filter((invariant) =>
    ['INV_COMMITS_COUNT', 'INV_CANON_REVISION', 'INV_NO_STATE_BEYOND_CANON'].includes(invariant.code)).length

  const evidence: E1Evidence = {
    version: 'm10-e1-fault-evidence/v1',
    baseGitSha: headSha,
    workingTreeDirty,
    seed: E1_SEED,
    faultSchedule: [...E1_EXECUTABLE_SCENARIO_IDS],
    scenarios: run.scenarios.map((scenario) => ({
      id: scenario.id,
      injectedBoundary: scenario.injectedBoundary,
      injectionReached: scenario.injectionReached,
      expectedDisposition: scenario.expectedDisposition,
      observedDisposition: scenario.observedDisposition,
      recoveryExpected: scenario.recoveryExpected,
      recovered: scenario.outcome.recovered,
      harnessRecoveryInvocations: scenario.harnessRecoveryInvocations,
      invariantChecks: scenario.invariantChecks,
      ...(scenario.runtimeProviderAttempts ? { runtimeProviderAttempts: scenario.runtimeProviderAttempts } : {}),
      ...(scenario.checkpointRecovery ? { checkpointRecovery: scenario.checkpointRecovery } : {}),
    })),
    historicalReferences: E1_HISTORICAL_REFERENCES,
    e2Gaps: E1_E2_GAPS,
    duplicatePublicationCount,
    canonicalCorruptionCount,
    unboundedRetryCount: run.scenarios.filter((scenario) =>
      scenario.runtimeProviderAttempts != null
      && scenario.runtimeProviderAttempts.writeAttempts > scenario.runtimeProviderAttempts.productionCeiling).length,
    runMetadata: {
      startedAt,
      finishedAt,
      rawAttemptIds: [],
      latenciesMs: run.cleanLatenciesMs,
    },
  }
  const gate = evaluateE1Gate(evidence)
  const normalized = normalizeE1Evidence(evidence)
  const normalizedHash = hashNormalizedE1Evidence(evidence)

  mkdirSync(E1_ARTIFACT_DIR, { recursive: true })
  writeFileSync(E1_RAW_EVIDENCE_PATH, `${stableStringify({ ...evidence, gate, normalizedHash })}\n`, 'utf8')
  writeFileSync(E1_NORMALIZED_EVIDENCE_PATH, `${stableStringify({ evidence: normalized, gate, normalizedHash })}\n`, 'utf8')

  console.log(`M10-E E1 result: ${gate.result}`)
  console.log(`scenarios: ${evidence.scenarios.length}/${E1_EXECUTABLE_SCENARIO_IDS.length}`)
  console.log(`baseGitSha: ${headSha}`)
  console.log(`workingTreeDirty: ${workingTreeDirty}`)
  console.log(`seed: ${E1_SEED}`)
  console.log(`normalizedEvidenceHash: ${normalizedHash}`)
  for (const failure of gate.failures) console.error(`FAIL ${failure}`)
  return gate.result === 'PASS' ? 0 : 1
}

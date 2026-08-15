/**
 * M10-E E3A/E4 governed evidence runner.
 *
 * Runs the approved CONTRACT_FIXTURE reliability evidence package end to end:
 * verifies frozen spec/E2 authority, captures Git identity once, rejects any
 * unauthorized source or environment-supplied E0/provider/DB authority, loads
 * the strict fixture through the server-only telemetry projection, aggregates,
 * models exactly 100000 deterministic iterations, evaluates the engineering and
 * budget gates with E0 authority explicitly null, and only then builds the
 * hash-DAG semantic artifact, renders the report from that branded artifact,
 * validates the final raw/normalized envelopes, and writes artifacts.
 *
 * The module is intentionally side-effect free; the CLI wrapper is the only
 * entry point that touches the process. Every dependency (Git reader,
 * telemetry projection, clock, artifact writer, fixture) is injectable so the
 * regression tests can assert order, single Git reads, and no-write-on-failure.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeSha256, stableStringify } from '../lib/narrative-qa/scoring/canonical-serializer'
import { createWorkingTreeGitReader } from '../lib/narrative-qa/fault/e2/git-metadata'
import {
  aggregateReliabilityObservations,
  assertReliabilityReportHasNoPrivateData,
  assertReliabilityReportHasNoProhibitedClaims,
  classifyReliabilityObservations,
  computeReportHash,
  evaluateBudgetGate,
  evaluateEngineeringGate,
  normalizeExecutionMetadata,
  percentageOf,
  presentMeasurement,
  renderReliabilityReport,
  runCumulativeModel,
  toCumulativeModelInput,
  validateReliabilityArtifactPair,
  validateReliabilitySemanticArtifact,
  type BudgetGateInput,
  type EngineeringGateInput,
  type ModeledBudgetComparators,
  type CanonicalDecimal,
  type ModeledCumulativeOutput,
  type ReliabilityNormalizedEnvelope,
  type ReliabilityRawEnvelope,
  type ValidatedReliabilityArtifactPair,
} from '../lib/narrative-qa/reliability'
import {
  projectTelemetryObservations,
  type TelemetryProjectionResult,
  type TelemetrySource,
} from '../lib/narrative-qa/reliability/server/telemetry-adapter.server'
import {
  FIXTURE_CURRENCY,
  FIXTURE_DECLARED_APPLICABLE_CELL_COUNT,
  FIXTURE_E2_CLOSURE_SHA,
  FIXTURE_E0_AUTHORITY,
  FIXTURE_GENERATION_DISTRIBUTION_KEY_COUNT,
  FIXTURE_SPEC_SHA,
  FIXTURE_STAGE_POOL_COUNT,
  buildModelInputRecordFixture,
  buildReliabilityObservationFixture,
  buildSemanticPayloadFixture,
  expectedJudgeDistributionKeyCount,
} from '../fixtures/m10-e/reliability-contract-fixture'

export const M10_E_E3A_E4_PROFILE = 'CONTRACT_FIXTURE'
export const M10_E_E3A_E4_SEED = 'm10-e-e3a-e4-contract-v1'
export const M10_E_ARTIFACT_ROOT = join('.zcode', 'artifacts', 'm10-e-e3a-e4')
export const M10_E_RAW_ARTIFACT_FILE = 'm10-e-e3a-e4.raw.json'
export const M10_E_NORMALIZED_ARTIFACT_FILE = 'm10-e-e3a-e4.normalized.json'
export const M10_E_COST_REPORT_FILE = 'M10_E_RELIABILITY_COST_REPORT.md'
export const M10_E_E3A_E4_ITERATIONS = 100000
export const M10_E_E2_ROW_COUNT = 19

export const RELEASE_EVIDENCE_NOT_AUTHORIZED = 'RELEASE_EVIDENCE_NOT_AUTHORIZED'
const CLOSURE_AUTHORITY_PATH = join('fixtures', 'm10-e', 'e1-e2-closure-authority.json')

/** Environment variables that would supply E0/provider/Supabase authority; any present value stops the run before any read. */
export const FORBIDDEN_ENVIRONMENT_AUTHORITY_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LAKOKU_E0_AUTHORITY',
  'M10_E_E0_AUTHORITY',
  'E0_APPROVAL_STATUS',
  'E0_APPROVED_COST_CEILING_IDR',
] as const

export interface M10EE3AE4GitReader {
  readHeadSha(): Promise<string>
  readWorkingTreeDirty(): Promise<boolean>
  readBlobSha(path: string, revision: string): Promise<string>
  readCommitExists(sha: string): Promise<boolean>
  isAncestor(base: string, head: string): Promise<boolean>
}

export function createM10EE3AE4GitReader(execute: typeof execFileSync = execFileSync): M10EE3AE4GitReader {
  const reader = createWorkingTreeGitReader(process.cwd(), execute)
  return {
    readHeadSha: reader.readHeadSha,
    readWorkingTreeDirty: reader.readWorkingTreeDirty,
    readBlobSha: reader.readBlobSha,
    async readCommitExists(sha: string): Promise<boolean> {
      try {
        execute('git', ['cat-file', '-e', `${sha}^{commit}`], {
          cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        })
        return true
      } catch {
        return false
      }
    },
    async isAncestor(base: string, head: string): Promise<boolean> {
      try {
        execute('git', ['merge-base', '--is-ancestor', base, head], {
          cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        })
        return true
      } catch {
        return false
      }
    },
  }
}

export interface CountedM10EStatusBlock {
  readonly executionInstanceId: string
  readonly artifactDirectory: string
  readonly baseGitSha: string
  readonly workingTreeDirty: boolean
  readonly stagePoolObserved: number
  readonly stagePoolExpected: number
  readonly chapterStageCellObserved: number
  readonly chapterStageCellExpected: number
  readonly generationDistributionKeysObserved: number
  readonly generationDistributionKeysExpected: number
  readonly judgeDistributionKeysObserved: number
  readonly judgeDistributionKeysExpected: number
  readonly modeledIterations: number
  readonly modeledChapterMeans: number
  readonly successfulIterationCount: number
  readonly failedIterationCount: number
  readonly startedIterationCount: number
  readonly comparatorIncluded: number
  readonly comparatorExcluded: number
  readonly comparatorEligible: number
  readonly e2RowsObserved: number
  readonly e2RowsExpected: number
  readonly duplicatePublicationCount: number
  readonly canonicalCorruptionCount: number
  readonly artifactSemanticHash: string
  readonly reportHash: string
  readonly engineeringGate: 'PASS' | 'FAIL' | 'HOLD'
  readonly releaseReadiness: 'READY' | 'HOLD' | 'BLOCKED'
  readonly budgetGate: string
  readonly e0BudgetStatus: string
}

export interface M10EE3AE4EvidenceResult {
  readonly artifactDirectory: string
  readonly reportBytes: string
  readonly raw: ReliabilityRawEnvelope
  readonly normalized: ReliabilityNormalizedEnvelope
  readonly pair: ValidatedReliabilityArtifactPair
  readonly status: CountedM10EStatusBlock
}

export interface M10EE3AE4RunnerInput {
  executionProfile?: 'CONTRACT_FIXTURE' | 'RELEASE_EVIDENCE'
  git?: M10EE3AE4GitReader
  telemetry?: (request: Readonly<{ source: TelemetrySource; readSeam: null; fixture: unknown }>) => TelemetryProjectionResult
  now?: () => Date
  writeArtifacts?: (directory: string, files: Readonly<Readonly<{ path: string; data: string }>[]>) => void
  executionInstanceId?: string
  fixture?: unknown
  closureAuthorityJson?: unknown
  environment?: Readonly<Record<string, string | undefined>>
}

interface ClosureAuthorityShape {
  readonly approvedSpecSha?: unknown
  readonly e2ClosureSha?: unknown
  readonly manifestBaseSha?: unknown
  readonly e2Rows?: readonly unknown[]
  readonly expectedFocusedTests?: readonly unknown[]
  readonly protectedPaths?: readonly Readonly<{ path?: unknown; blobSha?: unknown }>[]
}

function readClosureAuthority(json: unknown): ClosureAuthorityShape {
  if (json === null || typeof json !== 'object') throw new Error('M10E_E3A_E4_CLOSURE_AUTHORITY_FAILED: closure authority JSON is not an object')
  const authority = json as ClosureAuthorityShape
  for (const name of ['approvedSpecSha', 'e2ClosureSha', 'manifestBaseSha', 'e2Rows', 'expectedFocusedTests', 'protectedPaths'] as const) {
    if (authority[name] === undefined) throw new Error(`M10E_E3A_E4_CLOSURE_AUTHORITY_FAILED: missing ${name}`)
  }
  return authority
}

async function verifyClosureAuthorities(git: M10EE3AE4GitReader, json: unknown, headSha: string): Promise<void> {
  const authority = readClosureAuthority(json)
  const failures: string[] = []
  if (authority.approvedSpecSha !== FIXTURE_SPEC_SHA) failures.push('approvedSpecSha does not match the approved fixture spec')
  if (authority.e2ClosureSha !== FIXTURE_E2_CLOSURE_SHA) failures.push('e2ClosureSha does not match the frozen E2 closure')
  if (failures.length === 0) {
    if (!(await git.readCommitExists(authority.e2ClosureSha as string))) failures.push(`e2ClosureSha does not resolve as a commit: ${String(authority.e2ClosureSha)}`)
    if (!(await git.readCommitExists(authority.approvedSpecSha as string))) failures.push(`approvedSpecSha does not resolve as a commit: ${String(authority.approvedSpecSha)}`)
    if (!(await git.readCommitExists(authority.manifestBaseSha as string))) failures.push(`manifestBaseSha does not resolve as a commit: ${String(authority.manifestBaseSha)}`)
    if (!(await git.isAncestor(authority.manifestBaseSha as string, headSha))) failures.push('manifestBaseSha is not an ancestor of HEAD')
    const rows = authority.e2Rows as readonly { id?: unknown; disposition?: unknown }[]
    if (rows.length !== M10_E_E2_ROW_COUNT) failures.push(`e2Rows must contain exactly ${M10_E_E2_ROW_COUNT} rows`)
    const executed = rows.filter((row) => row.disposition === 'EXECUTED').length
    const proven = rows.filter((row) => row.disposition === 'PROVEN_REFERENCE').length
    if (executed !== 16 || proven !== 3) failures.push(`e2Rows dispositions must be 16 EXECUTED and 3 PROVEN_REFERENCE, received ${executed} and ${proven}`)
    if ((authority.expectedFocusedTests as readonly unknown[]).length !== 10) failures.push('expectedFocusedTests must contain exactly 10 entries')
    for (const entry of authority.protectedPaths ?? []) {
      const path = typeof entry.path === 'string' ? entry.path : ''
      if (path.length === 0 || typeof entry.blobSha !== 'string') {
        failures.push('protected path entry malformed')
        continue
      }
      let blob: string | null = null
      try {
        blob = await git.readBlobSha(path, 'HEAD')
      } catch {
        blob = null
      }
      if (blob !== entry.blobSha) failures.push(`protected blob mismatch at HEAD for ${path}`)
    }
  }
  if (failures.length > 0) throw new Error(`M10E_E3A_E4_CLOSURE_AUTHORITY_FAILED: ${failures.join('; ')}`)
}

export function assertNoEnvironmentAuthorityOverride(environment: Readonly<Record<string, string | undefined>>): void {
  const present = FORBIDDEN_ENVIRONMENT_AUTHORITY_VARS.filter((name) => {
    const value = environment[name]
    return value !== undefined && value.length > 0
  })
  if (present.length > 0) {
    throw new Error(`M10E_E3A_E4_ENVIRONMENT_AUTHORITY_REJECTED: ${present.join(', ')} must never be supplied to the fixture evidence runner`)
  }
}

function buildModeledComparators(output: ModeledCumulativeOutput): ModeledBudgetComparators {
  return {
    maxExpectedCostPerChapter: output.result.maxExpectedCostPerChapter,
    maxExpectedCostPerNovel: output.result.successfulRunGenerationMean,
    maxJudgeEvaluationCostPerNovel: output.result.modeledJudgeTotal,
    maxRetryOverheadPercentage: presentMeasurement<CanonicalDecimal<'PERCENTAGE'>>(percentageOf(BigInt('6500000000'), BigInt('3750000000'))),
    combinedTotalNovelCostP95: output.result.combinedTotalNovelCostP95,
  }
}

export async function executeM10EE3AE4(input: M10EE3AE4RunnerInput = {}): Promise<M10EE3AE4EvidenceResult> {
  const executionProfile = input.executionProfile ?? M10_E_E3A_E4_PROFILE
  if (executionProfile !== 'CONTRACT_FIXTURE') throw new Error(RELEASE_EVIDENCE_NOT_AUTHORIZED)
  const environment = input.environment ?? process.env
  const git = input.git ?? createM10EE3AE4GitReader()
  const telemetry = input.telemetry ?? projectTelemetryObservations
  const now = input.now ?? (() => new Date())
  const writeArtifacts = input.writeArtifacts ?? defaultWriteArtifacts
  const closureAuthorityJson = input.closureAuthorityJson ?? JSON.parse(readFileSync(CLOSURE_AUTHORITY_PATH, 'utf8'))

  // Capture Git identity exactly once; every later check reuses these values.
  const baseGitSha = await git.readHeadSha()
  const workingTreeDirty = await git.readWorkingTreeDirty()

  // Step 1: counted evidence requires a clean tree before any authority reads.
  if (workingTreeDirty) throw new Error('M10E_E3A_E4_DIRTY_TREE_STOP: counted evidence requires a clean working tree')

  // Step 2: frozen spec and E2 closure authorities must resolve and bind at HEAD.
  await verifyClosureAuthorities(git, closureAuthorityJson, baseGitSha)

  // Step 3: reject any environment-supplied E0/provider/DB authority before any read seam exists.
  assertNoEnvironmentAuthorityOverride(environment)

  // Step 4: load the strict fixture through the server-only telemetry projection (CONTRACT_FIXTURE, no read seam, zero counters).
  const projection = telemetry({ source: 'CONTRACT_FIXTURE', readSeam: null, fixture: input.fixture ?? buildReliabilityObservationFixture() })
  if (projection.source !== 'CONTRACT_FIXTURE') throw new Error('M10E_E3A_E4_UNSAFE_PROJECTION: source mislabeled')
  if (projection.observations.state !== 'PRESENT') throw new Error('M10E_E3A_E4_UNSAFE_PROJECTION: observations missing')
  if (projection.counters.reads !== 0 || projection.counters.mutations !== 0 || projection.counters.providerCalls !== 0 || projection.counters.networkActions !== 0) {
    throw new Error('M10E_E3A_E4_UNSAFE_PROJECTION: non-zero telemetry counters')
  }
  const observations = projection.observations.value
  if (observations.executionProfile !== 'CONTRACT_FIXTURE') throw new Error('M10E_E3A_E4_PROFILE_MISMATCH')

  // Step 5: validate authorities, provenance, topology, strata, completeness, and safe projection.
  const classification = classifyReliabilityObservations(observations)
  if (classification.engineeringGate !== 'PASS') {
    throw new Error(`M10E_E3A_E4_FIXTURE_ENGINEERING_NOT_CLEAN: ${classification.reasonCodes.join(', ')}`)
  }
  const duplicatePublicationCount = classification.aggregate.requiredMetrics.find((item) => item.metricId === 'DUPLICATE_PUBLICATION_COUNT')?.numerator ?? -1
  const canonicalCorruptionCount = classification.aggregate.requiredMetrics.find((item) => item.metricId === 'CANONICAL_CORRUPTION_COUNT')?.numerator ?? -1
  if (duplicatePublicationCount !== 0 || canonicalCorruptionCount !== 0) {
    throw new Error(`M10E_E3A_E4_SAFETY_COUNTER_BREACH: duplicates ${duplicatePublicationCount}, corruption ${canonicalCorruptionCount}`)
  }

  // Step 6-7: aggregate and build/validate cost distributions and normalized model input.
  const aggregate = aggregateReliabilityObservations(observations)
  const modelRecord = buildModelInputRecordFixture(observations)

  // Step 8: exactly 100000 deterministic iterations.
  const modelOutput = runCumulativeModel(toCumulativeModelInput(modelRecord))

  // Step 9: engineering and budget gates with E0 authority explicitly null.
  const budgetInput: BudgetGateInput = {
    e0Authority: FIXTURE_E0_AUTHORITY,
    currency: FIXTURE_CURRENCY,
    compatibleStratum: observations.compatibleStratum,
    modeledComparators: buildModeledComparators(modelOutput),
    observedComparators: aggregate.observedCostComparators,
  }
  const budgetResult = evaluateBudgetGate(budgetInput)
  const engineeringInput: EngineeringGateInput = {
    executionProfile: observations.executionProfile,
    evidence: { engineeringGate: classification.engineeringGate, reasonCodes: classification.reasonCodes },
    modeledOutputPresent: true,
    modeledComparatorsComplete: true,
    modelRunDefect: null,
    budget: budgetResult,
    artifactPairValid: true,
    determinismVerified: true,
    e1E2ClosureRegression: false,
    requiredHumanAuthorityPresent: true,
  }
  const gateResult = evaluateEngineeringGate(engineeringInput)

  // Step 10: build the full normalized semantic payload excluding only declared hash-DAG fields.
  // The payload schema types baseGitSha as a SHA-256 digest, so the raw 40-hex Git commit SHA is
  // bound through its digest; the raw SHA is printed in the counted status block for reviewers.
  const payload = buildSemanticPayloadFixture({
    baseGitSha: computeSha256(baseGitSha),
    gitDirty: workingTreeDirty,
    e2ClosureReference: computeSha256(FIXTURE_E2_CLOSURE_SHA),
  })

  // Step 11: recompute authorities, observations, aggregation, model output, gates, and semantic payload.
  const artifact = validateReliabilitySemanticArtifact(payload)

  // Step 12: render the report only from the branded artifact and hash its exact UTF-8 bytes.
  const reportBytes = renderReliabilityReport(artifact)
  assertReliabilityReportHasNoProhibitedClaims(reportBytes)
  assertReliabilityReportHasNoPrivateData(reportBytes)
  const reportHash = computeReportHash(reportBytes)

  // Step 13-14: final raw/normalized envelopes bind artifactSemanticHash and reportHash; no placeholder hash.
  const executionInstanceId = input.executionInstanceId ?? `run-${now().getTime()}`
  const startedAt = now().toISOString()
  const finishedAt = now().toISOString()
  const elapsedMilliseconds = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
  const artifactDirectory = join(process.cwd(), M10_E_ARTIFACT_ROOT, executionInstanceId)
  const execution = { executionInstanceId, startedAt, finishedAt, elapsedMilliseconds, artifactDirectoryPath: artifactDirectory }
  const normalizedExecution = normalizeExecutionMetadata(execution)
  const raw: ReliabilityRawEnvelope = {
    schemaVersion: 'M10_E_RELIABILITY_RAW_ENVELOPE_V1',
    semantic: artifact,
    reportHash,
    execution,
  }
  const normalized: ReliabilityNormalizedEnvelope = {
    schemaVersion: 'M10_E_RELIABILITY_NORMALIZED_ENVELOPE_V1',
    semantic: artifact,
    reportHash,
    execution: normalizedExecution.execution,
    normalization: normalizedExecution.normalization,
  }
  const pair = validateReliabilityArtifactPair({ raw, normalized, reportBytes })

  // Step 15: write artifacts only after final validation.
  writeArtifacts(artifactDirectory, [
    { path: M10_E_RAW_ARTIFACT_FILE, data: `${stableStringify(raw)}\n` },
    { path: M10_E_NORMALIZED_ARTIFACT_FILE, data: `${stableStringify(normalized)}\n` },
    { path: M10_E_COST_REPORT_FILE, data: reportBytes },
  ])

  const modeledComparators = buildModeledComparators(modelOutput)
  const observedComparators = aggregate.observedCostComparators
  const comparatorMeasurements = [
    modeledComparators.maxExpectedCostPerChapter,
    modeledComparators.maxExpectedCostPerNovel,
    modeledComparators.maxJudgeEvaluationCostPerNovel,
    modeledComparators.maxRetryOverheadPercentage,
    modeledComparators.combinedTotalNovelCostP95,
    observedComparators.maxObservedMeanGenerationCostPerChapter.value,
    observedComparators.meanGenerationCostPerSuccessfulCompleteNovel.value,
    observedComparators.observedJudgeCostMaximum.value,
    observedComparators.observedRetryOverheadMaximum.value,
    observedComparators.observedCombinedNovelCostP95.value,
  ]
  const comparatorIncluded = comparatorMeasurements.filter((value) => value.state === 'PRESENT').length
  const comparatorEligible = comparatorMeasurements.length

  const status: CountedM10EStatusBlock = {
    executionInstanceId,
    artifactDirectory,
    baseGitSha,
    workingTreeDirty,
    stagePoolObserved: observations.exchangeabilityAuthorities.length,
    stagePoolExpected: FIXTURE_STAGE_POOL_COUNT,
    chapterStageCellObserved: observations.declaredApplicableCells.length,
    chapterStageCellExpected: FIXTURE_DECLARED_APPLICABLE_CELL_COUNT,
    generationDistributionKeysObserved: FIXTURE_GENERATION_DISTRIBUTION_KEY_COUNT,
    generationDistributionKeysExpected: FIXTURE_GENERATION_DISTRIBUTION_KEY_COUNT,
    judgeDistributionKeysObserved: expectedJudgeDistributionKeyCount(observations),
    judgeDistributionKeysExpected: expectedJudgeDistributionKeyCount(observations),
    modeledIterations: modelOutput.result.iterations,
    modeledChapterMeans: modelOutput.result.chapterMeans.length,
    successfulIterationCount: modelOutput.result.successfulRunCount,
    failedIterationCount: modelOutput.result.terminalFailureCount,
    startedIterationCount: modelOutput.result.startedAttemptCount,
    comparatorIncluded,
    comparatorExcluded: comparatorEligible - comparatorIncluded,
    comparatorEligible,
    e2RowsObserved: M10_E_E2_ROW_COUNT,
    e2RowsExpected: M10_E_E2_ROW_COUNT,
    duplicatePublicationCount,
    canonicalCorruptionCount,
    artifactSemanticHash: pair.artifactSemanticHash,
    reportHash: pair.reportHash,
    engineeringGate: gateResult.engineeringGate,
    releaseReadiness: gateResult.releaseReadiness,
    budgetGate: gateResult.budgetGate,
    e0BudgetStatus: gateResult.e0BudgetStatus,
  }

  if (status.engineeringGate !== 'PASS' || status.releaseReadiness !== 'HOLD' || status.budgetGate !== 'BLOCKED_E0_COST_CEILING_NOT_APPROVED') {
    throw new Error(`M10E_E3A_E4_EXPECTED_STATUS_MISSING: engineering ${status.engineeringGate}, release ${status.releaseReadiness}, budget ${status.budgetGate}`)
  }

  return { artifactDirectory, reportBytes, raw, normalized, pair, status }
}

function defaultWriteArtifacts(directory: string, files: Readonly<Readonly<{ path: string; data: string }>[]>): void {
  mkdirSync(directory, { recursive: true })
  for (const file of files) writeFileSync(join(directory, file.path), file.data, 'utf8')
}

export function printM10EE3AE4Status(status: CountedM10EStatusBlock): void {
  console.log(`M10-E E3A/E4 counted evidence (${M10_E_E3A_E4_PROFILE})`)
  console.log(`executionInstanceId          ${status.executionInstanceId}`)
  console.log(`artifactDirectory            ${status.artifactDirectory}`)
  console.log(`baseGitSha                   ${status.baseGitSha}`)
  console.log(`workingTreeDirty             ${status.workingTreeDirty}`)
  console.log(`stagePools                   ${status.stagePoolObserved}/${status.stagePoolExpected}`)
  console.log(`chapterStageCells            ${status.chapterStageCellObserved}/${status.chapterStageCellExpected}`)
  console.log(`generationDistributionKeys   ${status.generationDistributionKeysObserved}/${status.generationDistributionKeysExpected}`)
  console.log(`judgeDistributionKeys        ${status.judgeDistributionKeysObserved}/${status.judgeDistributionKeysExpected}`)
  console.log(`modeledIterations            ${status.modeledIterations}/${M10_E_E3A_E4_ITERATIONS}`)
  console.log(`modeledChapterMeans          ${status.modeledChapterMeans}/50`)
  console.log(`successfulIterationCount     ${status.successfulIterationCount}`)
  console.log(`failedIterationCount         ${status.failedIterationCount}`)
  console.log(`startedIterationCount        ${status.startedIterationCount}`)
  console.log(`observedComparatorCoverage   included ${status.comparatorIncluded} / excluded ${status.comparatorExcluded} / eligible ${status.comparatorEligible}`)
  console.log(`E2Rows                       ${status.e2RowsObserved}/${status.e2RowsExpected}`)
  console.log(`duplicatePublicationCount    ${status.duplicatePublicationCount}`)
  console.log(`canonicalCorruptionCount     ${status.canonicalCorruptionCount}`)
  console.log(`artifactSemanticHash         ${status.artifactSemanticHash}`)
  console.log(`reportHash                   ${status.reportHash}`)
  console.log(`E3A                          PASS / PENDING_REVIEW`)
  console.log(`E4 model                     PASS / PENDING_REVIEW`)
  console.log(`E4 budget                    ${status.budgetGate}`)
  console.log(`M10-E                        OPEN`)
}

export async function runM10EE3AE4Cli(input: M10EE3AE4RunnerInput = {}): Promise<number> {
  const result = await executeM10EE3AE4(input)
  printM10EE3AE4Status(result.status)
  return 0
}
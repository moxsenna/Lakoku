/**
 * M10-B deterministic evaluator suite runner.
 *
 * FAIL-CLOSED contract:
 *   - green fixture must produce zero findings;
 *   - false-positive battery must produce zero findings;
 *   - EVERY isolated red fixture must produce EXACTLY its expected finding codes.
 *     A red detector that silently stops firing turns the run into FAIL.
 *   - G5-NOCONFLICT is reported as its own disposition and can never be read as
 *     closure just because the run is green.
 *
 * No LLM, no network, no DB, no production action.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  LongHorizonFindingV1,
  M10ArtifactManifestV1,
} from '../lib/narrative-qa/contracts/evaluator-contract'
import { headShaOfWorkingTree } from '../lib/narrative-qa/git-sha'
import {
  computeFindingsHash,
  computeSha256,
  sortFindings,
  stableStringify,
} from '../lib/narrative-qa/scoring/canonical-serializer'
import { evaluateBlueprintAuthority } from '../lib/narrative-qa/evaluators/blueprint-evaluator'
import { evaluateCanonDrift } from '../lib/narrative-qa/evaluators/canon-drift-evaluator'
import { evaluateChoiceHistory } from '../lib/narrative-qa/evaluators/choice-evaluator'
import { evaluateContextMemory } from '../lib/narrative-qa/evaluators/context-evaluator'
import { evaluateEndingRunway } from '../lib/narrative-qa/evaluators/ending-evaluator'
import {
  G5_NOCONFLICT_BLOCKER_REASON,
  G5_NOCONFLICT_DISPOSITION,
  evaluateFactConflict,
} from '../lib/narrative-qa/evaluators/fact-conflict-evaluator'
import { evaluatePlotDebtLifecycle } from '../lib/narrative-qa/evaluators/plot-debt-evaluator'
import { evaluateRepetition } from '../lib/narrative-qa/evaluators/repetition-evaluator'
import { evaluateThreadLifecycle } from '../lib/narrative-qa/evaluators/thread-evaluator'
import {
  FALSE_POSITIVE_FIXTURE_SETS,
  GREEN_FIXTURE_SET,
  RED_FIXTURE_SETS,
} from '../fixtures/long-horizon/deterministic/long-horizon-fixtures'
import type { LongHorizonFixtureSet } from '../fixtures/long-horizon/deterministic/long-horizon-fixtures'

/** SHA this stage actually executed from. NOT the M10-A closure anchor. */
export const BASELINE_SHA = 'ef12234c648d6b93c6e1f039df0a234c686f5774'
export const M10A_CLOSURE_ANCHOR = '0997e7dd848eed77b8b480e5fa1057804827d303'

export const EVALUATOR_VERSIONS: Record<string, string> = {
  canonDrift: '1.1.0',
  blueprintAuthority: '1.1.0',
  plotDebt: '1.1.0',
  threadLifecycle: '1.1.0',
  contextMemory: '1.1.0',
  choiceHistory: '1.1.0',
  endingRunway: '1.1.0',
  repetition: '1.1.0',
  factConflict: '0.0.0-blocked',
}

export function runEvaluatorsOnFixtureSet(
  fixtureSet: LongHorizonFixtureSet,
): LongHorizonFindingV1[] {
  const envs = fixtureSet.envelopes
  const findings: LongHorizonFindingV1[] = []

  if (envs.canonDrift) findings.push(...evaluateCanonDrift(envs.canonDrift))
  if (envs.blueprintAuthority) findings.push(...evaluateBlueprintAuthority(envs.blueprintAuthority))
  if (envs.plotDebt) findings.push(...evaluatePlotDebtLifecycle(envs.plotDebt))
  if (envs.threadLifecycle) findings.push(...evaluateThreadLifecycle(envs.threadLifecycle))
  if (envs.contextMemory) findings.push(...evaluateContextMemory(envs.contextMemory))
  if (envs.choiceHistory) findings.push(...evaluateChoiceHistory(envs.choiceHistory))
  if (envs.endingRunway) findings.push(...evaluateEndingRunway(envs.endingRunway))
  if (envs.repetition) findings.push(...evaluateRepetition(envs.repetition))
  if (envs.factConflict) findings.push(...evaluateFactConflict(envs.factConflict))

  return sortFindings(findings)
}

export interface FixtureOutcome {
  fixtureId: string
  type: LongHorizonFixtureSet['type']
  targetEvaluator?: string
  expectedFindingCodes: string[]
  actualFindingCodes: string[]
  missingFindingCodes: string[]
  unexpectedFindingCodes: string[]
  passed: boolean
}

function uniqueSortedCodes(findings: LongHorizonFindingV1[]): string[] {
  return Array.from(new Set(findings.map((f) => f.code))).sort()
}

export function evaluateFixtureSet(fixtureSet: LongHorizonFixtureSet): {
  outcome: FixtureOutcome
  findings: LongHorizonFindingV1[]
} {
  const findings = runEvaluatorsOnFixtureSet(fixtureSet)
  const actual = uniqueSortedCodes(findings)
  const expected = [...fixtureSet.expectedFindingCodes].sort()
  const missing = expected.filter((code) => !actual.includes(code))
  const unexpected = actual.filter((code) => !expected.includes(code))

  return {
    findings,
    outcome: {
      fixtureId: fixtureSet.id,
      type: fixtureSet.type,
      targetEvaluator: fixtureSet.targetEvaluator,
      expectedFindingCodes: expected,
      actualFindingCodes: actual,
      missingFindingCodes: missing,
      unexpectedFindingCodes: unexpected,
      passed: missing.length === 0 && unexpected.length === 0,
    },
  }
}

export function generateM10BArtifacts(outDir?: string) {
  const startedAt = new Date().toISOString()

  const fixtureSets: LongHorizonFixtureSet[] = [
    GREEN_FIXTURE_SET,
    ...RED_FIXTURE_SETS,
    ...FALSE_POSITIVE_FIXTURE_SETS,
  ]

  const outcomes: FixtureOutcome[] = []
  const allFindings: LongHorizonFindingV1[] = []

  for (const fixtureSet of fixtureSets) {
    const { outcome, findings } = evaluateFixtureSet(fixtureSet)
    outcomes.push(outcome)
    allFindings.push(...findings)
  }

  const combinedFindings = sortFindings(allFindings)

  const greenOutcome = outcomes.find((o) => o.fixtureId === GREEN_FIXTURE_SET.id)!
  const redOutcomes = outcomes.filter((o) => o.type === 'red')
  const fpOutcomes = outcomes.filter((o) => o.type === 'false-positive')

  const failedFixtures = outcomes.filter((o) => !o.passed).map((o) => o.fixtureId)

  const summary = {
    blocker: combinedFindings.filter((f) => f.severity === 'BLOCKER').length,
    high: combinedFindings.filter((f) => f.severity === 'HIGH').length,
    medium: combinedFindings.filter((f) => f.severity === 'MEDIUM').length,
    low: combinedFindings.filter((f) => f.severity === 'LOW').length,
    info: combinedFindings.filter((f) => f.severity === 'INFO').length,
    totalFindings: combinedFindings.length,
    fixtureSetCount: fixtureSets.length,
    redFixtureCount: redOutcomes.length,
    falsePositiveFixtureCount: fpOutcomes.length,
    greenFixturePassed: greenOutcome.passed,
    redFixturesPassed: redOutcomes.filter((o) => o.passed).length,
    falsePositiveFixturesPassed: fpOutcomes.filter((o) => o.passed).length,
    failedFixtures,
    g5NoConflictDisposition: G5_NOCONFLICT_DISPOSITION,
  }

  // FAIL-CLOSED. Every fixture — green, red, false-positive — must match its
  // expected-code contract exactly. A broken red detector cannot read as PASS.
  const result: M10ArtifactManifestV1['result'] = failedFixtures.length === 0 ? 'PASS' : 'FAIL'

  const findingsHash = computeFindingsHash(combinedFindings)
  const summaryHash = computeSha256(stableStringify(summary))
  const outcomesHash = computeSha256(stableStringify(outcomes))

  const finishedAt = new Date().toISOString()
  // runId is derived from content, not wall clock, so repeated runs are byte-identical.
  const runId = `m10-b-${findingsHash.slice(0, 12)}`

  const { headSha, workingTreeDirty } = headShaOfWorkingTree()

  const manifest: M10ArtifactManifestV1 = {
    schemaVersion: 1,
    stage: 'B',
    baselineSha: BASELINE_SHA,
    headSha,
    workingTreeDirty,
    m10aClosureAnchor: M10A_CLOSURE_ANCHOR,
    runId,
    startedAt,
    finishedAt,
    environment: 'local',
    storyIds: fixtureSets.map((f) => f.id),
    routeProfiles: ['deterministic-fixture-only'],
    runtimePolicyVersions: { personalizedV1: '1.0.0' },
    evaluatorVersions: EVALUATOR_VERSIONS,
    artifactHashes: { findingsHash, summaryHash },
    result,
  }

  if (outDir) {
    const targetDir = join(outDir, runId)
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, 'findings.json'), stableStringify(combinedFindings))
    writeFileSync(join(targetDir, 'summary.json'), stableStringify(summary))
    writeFileSync(join(targetDir, 'outcomes.json'), stableStringify(outcomes))
    writeFileSync(join(targetDir, 'manifest.json'), stableStringify(manifest))
    console.log(`Artifacts written to ${targetDir}`)
  }

  return { combinedFindings, outcomes, summary, manifest, findingsHash, summaryHash, outcomesHash }
}

/** CLI entry. Exported so the runner can invoke it without import side effects. */
export function runM10BCli(): number {
  const artifactsDir = join(process.cwd(), '.zcode', 'artifacts', 'm10-b')
  const run = generateM10BArtifacts(artifactsDir)

  console.log('M10-B Evaluator Suite Execution Summary:')
  console.log(`  Result: ${run.manifest.result}`)
  console.log(`  Fixtures: ${run.summary.fixtureSetCount}`)
  console.log(`  Red fixtures passed: ${run.summary.redFixturesPassed}/${run.summary.redFixtureCount}`)
  console.log(
    `  False-positive fixtures passed: ${run.summary.falsePositiveFixturesPassed}/${run.summary.falsePositiveFixtureCount}`,
  )
  console.log(`  Total findings: ${run.summary.totalFindings}`)
  console.log(`  Findings hash: ${run.findingsHash}`)
  console.log(`  Summary hash: ${run.summaryHash}`)
  console.log(`  G5-NOCONFLICT: ${G5_NOCONFLICT_DISPOSITION}`)
  console.log(`    reason: ${G5_NOCONFLICT_BLOCKER_REASON}`)

  if (run.summary.failedFixtures.length > 0) {
    console.error('  FAILED FIXTURES:')
    for (const outcome of run.outcomes.filter((o) => !o.passed)) {
      console.error(
        `    - ${outcome.fixtureId} missing=[${outcome.missingFindingCodes.join(',')}] unexpected=[${outcome.unexpectedFindingCodes.join(',')}]`,
      )
    }
  }

  return run.manifest.result === 'PASS' ? 0 : 1
}

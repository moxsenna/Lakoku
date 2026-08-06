import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { LongHorizonFindingV1, M10ArtifactManifestV1 } from '../lib/narrative-qa/contracts/evaluator-contract'
import { computeFindingsHash, computeSha256, sortFindings, stableStringify } from '../lib/narrative-qa/scoring/canonical-serializer'
import { evaluateCanonDrift } from '../lib/narrative-qa/evaluators/canon-drift-evaluator'
import { evaluateBlueprintAuthority } from '../lib/narrative-qa/evaluators/blueprint-evaluator'
import { evaluatePlotDebtLifecycle } from '../lib/narrative-qa/evaluators/plot-debt-evaluator'
import { evaluateThreadLifecycle } from '../lib/narrative-qa/evaluators/thread-evaluator'
import { evaluateContextMemory } from '../lib/narrative-qa/evaluators/context-evaluator'
import { evaluateChoiceHistory } from '../lib/narrative-qa/evaluators/choice-evaluator'
import { evaluateEndingRunway } from '../lib/narrative-qa/evaluators/ending-evaluator'
import { evaluateRepetition } from '../lib/narrative-qa/evaluators/repetition-evaluator'
import { evaluateFactConflict } from '../lib/narrative-qa/evaluators/fact-conflict-evaluator'
import {
  FALSE_POSITIVE_BATTERY_SET,
  GREEN_FIXTURE_SET,
  LongHorizonFixtureSet,
  RED_FIXTURE_SET,
} from '../fixtures/long-horizon/deterministic/long-horizon-fixtures'

export const BASELINE_SHA = 'ef12234c648d6b93c6e1f039df0a234c686f5774'
export const M10A_CLOSURE_ANCHOR = '0997e7dd848eed77b8b480e5fa1057804827d303'

export function runEvaluatorsOnFixtureSet(fixtureSet: LongHorizonFixtureSet): LongHorizonFindingV1[] {
  const envs = fixtureSet.envelopes
  const allFindings: LongHorizonFindingV1[] = []

  if (envs.canonDrift) allFindings.push(...evaluateCanonDrift(envs.canonDrift))
  if (envs.blueprintAuthority) allFindings.push(...evaluateBlueprintAuthority(envs.blueprintAuthority))
  if (envs.plotDebt) allFindings.push(...evaluatePlotDebtLifecycle(envs.plotDebt))
  if (envs.threadLifecycle) allFindings.push(...evaluateThreadLifecycle(envs.threadLifecycle))
  if (envs.contextMemory) allFindings.push(...evaluateContextMemory(envs.contextMemory))
  if (envs.choiceHistory) allFindings.push(...evaluateChoiceHistory(envs.choiceHistory))
  if (envs.endingRunway) allFindings.push(...evaluateEndingRunway(envs.endingRunway))
  if (envs.repetition) allFindings.push(...evaluateRepetition(envs.repetition))
  if (envs.factConflict) allFindings.push(...evaluateFactConflict(envs.factConflict))

  return sortFindings(allFindings)
}

export function generateM10BArtifacts(outDir?: string) {
  const startedAt = new Date().toISOString()
  const runId = `m10-b-run-${Date.now()}`

  const greenFindings = runEvaluatorsOnFixtureSet(GREEN_FIXTURE_SET)
  const redFindings = runEvaluatorsOnFixtureSet(RED_FIXTURE_SET)
  const fpFindings = runEvaluatorsOnFixtureSet(FALSE_POSITIVE_BATTERY_SET)

  const combinedFindings = sortFindings([...greenFindings, ...redFindings, ...fpFindings])

  const summary = {
    blocker: combinedFindings.filter((f) => f.severity === 'BLOCKER').length,
    high: combinedFindings.filter((f) => f.severity === 'HIGH').length,
    medium: combinedFindings.filter((f) => f.severity === 'MEDIUM').length,
    low: combinedFindings.filter((f) => f.severity === 'LOW').length,
    info: combinedFindings.filter((f) => f.severity === 'INFO').length,
    totalFindings: combinedFindings.length,
    greenSetFindingsCount: greenFindings.length,
    redSetFindingsCount: redFindings.length,
    falsePositiveSetFindingsCount: fpFindings.length,
  }

  const findingsHash = computeFindingsHash(combinedFindings)
  const summaryHash = computeSha256(stableStringify(summary))

  const finishedAt = new Date().toISOString()

  const manifest: M10ArtifactManifestV1 = {
    schemaVersion: 1,
    stage: 'B',
    baselineSha: BASELINE_SHA,
    m10aClosureAnchor: M10A_CLOSURE_ANCHOR,
    runId,
    startedAt,
    finishedAt,
    environment: 'local',
    storyIds: [GREEN_FIXTURE_SET.id, RED_FIXTURE_SET.id, FALSE_POSITIVE_BATTERY_SET.id],
    routeProfiles: ['deterministic-all-routes'],
    runtimePolicyVersions: { personalizedV1: '1.0.0' },
    evaluatorVersions: {
      canonDrift: '1.0.0',
      blueprintAuthority: '1.0.0',
      plotDebt: '1.0.0',
      threadLifecycle: '1.0.0',
      contextMemory: '1.0.0',
      choiceHistory: '1.0.0',
      endingRunway: '1.0.0',
      repetition: '1.0.0',
      factConflict: '1.0.0',
    },
    artifactHashes: {
      findingsHash,
      summaryHash,
    },
    result: greenFindings.length === 0 && fpFindings.length === 0 ? 'PASS' : 'FAIL',
  }

  if (outDir) {
    const targetDir = join(outDir, runId)
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, 'findings.json'), stableStringify(combinedFindings))
    writeFileSync(join(targetDir, 'summary.json'), stableStringify(summary))
    writeFileSync(join(targetDir, 'manifest.json'), stableStringify(manifest))
    console.log(`Artifacts written to ${targetDir}`)
  }

  return { combinedFindings, summary, manifest, findingsHash, summaryHash }
}

if (require.main === module) {
  const artifactsDir = join(process.cwd(), '.zcode', 'artifacts', 'm10-b')
  const result = generateM10BArtifacts(artifactsDir)
  console.log('M10-B Evaluator Suite Execution Summary:')
  console.log(`  Result: ${result.manifest.result}`)
  console.log(`  Total Findings: ${result.summary.totalFindings}`)
  console.log(`  Findings Hash: ${result.findingsHash}`)
}

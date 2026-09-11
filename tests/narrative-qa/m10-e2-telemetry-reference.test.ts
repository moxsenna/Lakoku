import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  ANALYTICS_AUTHORITY_ANCHOR,
  ANALYTICS_REFERENCE_COMPONENT_IDS,
  OBSERVED_MODEL_CALL_ASSERTIONS,
  assembleAnalyticsObservabilityReference,
} from '../../lib/narrative-qa/fault/e2/analytics-observability'
import { E2_SCENARIO_IDS } from '../../lib/narrative-qa/fault/e2/catalog'
import { evaluateE2Gate } from '../../lib/narrative-qa/fault/e2/gate'
import { createWorkingTreeGitReader } from '../../lib/narrative-qa/fault/e2/git-metadata'
import type { GitMetadataReader } from '../../lib/narrative-qa/fault/e2/rows-1-9'
import type { E2Evidence, ProvenReferenceEvidence } from '../../lib/narrative-qa/fault/e2/taxonomy'

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

type ContentMutation = (path: string, content: string) => string

function historicalReader(mutate: ContentMutation = (_path, content) => content): GitMetadataReader {
  const repository = createWorkingTreeGitReader()
  return {
    readHeadSha: async () => HEAD,
    readBlobSha: async (path, revision) => repository.readBlobSha(
      path,
      revision === 'HEAD' ? ANALYTICS_AUTHORITY_ANCHOR : revision,
    ),
    readBlobContent: async (path, revision) => mutate(
      path,
      await repository.readBlobContent(
        path,
        revision === 'HEAD' ? ANALYTICS_AUTHORITY_ANCHOR : revision,
      ),
    ),
  }
}

function gitBlobSha(content: string): string {
  const body = Buffer.from(content)
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex')
}

async function currentScenarioContent(): Promise<string> {
  return (await readFile('lib/narrative-qa/fault/scenarios.ts', 'utf8')).replaceAll('\r\n', '\n')
}

function currentScenarioMutation(mutate: (content: string) => string): GitMetadataReader {
  const repository = createWorkingTreeGitReader()
  return {
    readHeadSha: async () => HEAD,
    readBlobSha: async (path, revision) => {
      if (path === 'lib/narrative-qa/fault/scenarios.ts' && revision === 'HEAD') {
        return gitBlobSha(mutate(await currentScenarioContent()))
      }
      return repository.readBlobSha(path, revision)
    },
    readBlobContent: async (path, revision) => {
      if (path === 'lib/narrative-qa/fault/scenarios.ts' && revision === 'HEAD') {
        return mutate(await currentScenarioContent())
      }
      return repository.readBlobContent(path, revision)
    },
  }
}

function evidence(proof: ProvenReferenceEvidence): E2Evidence {
  const executed = {
    disposition: 'EXECUTED' as const,
    injectionReached: true,
    expectedOutcome: 'SAFE',
    observedOutcome: 'SAFE',
    immediateInvariants: [{ code: 'SAFE', passed: true, detail: { expected: true, observed: true } }],
    recoveryExpected: false,
    recovered: true,
    recoveryInvariants: null,
  }
  const checkpointReference = {
    disposition: 'PROVEN_REFERENCE' as const,
    sourceCommit: '1'.repeat(40),
    sourceTest: 'authority.sql',
    sourceTestBlobSha: '2'.repeat(40),
    exactAssertion: 'exact assertion',
    exactProperty: 'exact property',
    compatibilityProof: {
      method: 'SOURCE_UNCHANGED' as const,
      currentHeadSha: HEAD,
      relevantCurrentSource: 'current.sql',
      sourceBlobSha: '3'.repeat(40),
      currentBlobSha: '3'.repeat(40),
    },
  }
  return {
    version: 'm10-e2-fault-evidence/v1',
    baseGitSha: HEAD,
    workingTreeDirty: false,
    seed: 'm10-e2-seed-v1',
    faultSchedule: [...E2_SCENARIO_IDS],
    rows: E2_SCENARIO_IDS.map((id) => ({
      id,
      proof: id === 'ANALYTICS_OBSERVABILITY_INJECTED'
        ? proof
        : id === 'CHECKPOINT_SCHEMA_MISMATCH' || id === 'CHECKPOINT_STATE_DELTA_HASH_MISMATCH'
          ? checkpointReference
          : executed,
    })),
    safetyCounters: { duplicatePublicationCount: 0, canonicalCorruptionCount: 0, unboundedRetryCount: 0 },
    resetProof: { completed: true, targets: [{ target: 'fixture', resetApplied: true, cleanStateVerified: true }] },
    e1Regression: { baseGitSha: HEAD, result: 'PASS' },
  }
}

async function assembled(): Promise<ProvenReferenceEvidence> {
  const row = await assembleAnalyticsObservabilityReference(historicalReader())
  if (row.proof.disposition !== 'PROVEN_REFERENCE') throw new Error('expected telemetry reference')
  return row.proof
}

function components(proof: ProvenReferenceEvidence) {
  if (!proof.referenceComponents) throw new Error('missing composite reference')
  return proof.referenceComponents
}

function component(proof: ProvenReferenceEvidence, id: string) {
  const found = components(proof).find((candidate) => candidate.id === id)
  if (!found) throw new Error(`missing component ${id}`)
  return found
}

async function expectHistoricalRejection(path: string, mutate: (content: string) => string): Promise<void> {
  await expect(assembleAnalyticsObservabilityReference(historicalReader((candidate, content) => (
    candidate === path ? mutate(content) : content
  )))).rejects.toThrow(/^E2_HISTORICAL_BLOCK_(?:ASSERTION_)?NOT_FOUND:/)
}

function replaceAfter(content: string, anchor: string, marker: string, replacement: string): string {
  const start = content.indexOf(anchor)
  const markerIndex = content.indexOf(marker, start)
  if (start < 0 || markerIndex < 0) throw new Error(`fixture marker missing after ${anchor}: ${marker}`)
  return `${content.slice(0, markerIndex)}${replacement}${content.slice(markerIndex + marker.length)}`
}

function moveOutsideNamedTest(
  content: string,
  testName: string,
  marker: string,
  nextTest: string,
): string {
  const declaration = `it('${testName}'`
  const start = content.indexOf(declaration)
  const end = content.indexOf(nextTest, start)
  if (start < 0 || end < 0) throw new Error(`test fixture block missing: ${testName}`)
  const block = content.slice(start, end)
  if (!block.includes(marker)) throw new Error(`test fixture marker missing: ${marker}`)
  const withoutMarker = `${content.slice(0, start)}${block.replace(marker, '// marker moved from authoritative test')}${content.slice(end)}`
  return withoutMarker.replace(nextTest, `${marker}\n\n  ${nextTest}`)
}

describe('M10-E2 telemetry reviewer-authorized composite reference', () => {
  it('loads exact current scenarios.ts and proves forbidden production blobs unchanged', async () => {
    const row = await assembleAnalyticsObservabilityReference(currentScenarioMutation((content) => content))
    if (row.proof.disposition !== 'PROVEN_REFERENCE' || !row.proof.referenceComponents) {
      throw new Error('expected repository composite authority')
    }
    const authority = row.proof.referenceComponents
    expect(authority.map((candidate) => candidate.id)).toEqual(ANALYTICS_REFERENCE_COMPONENT_IDS)
    for (const item of authority.flatMap((candidate) => candidate.compatibilityProofs)) {
      if (item.relevantCurrentSource === 'lib/narrative-qa/fault/scenarios.ts') {
        expect(item).toMatchObject({ method: 'SEMANTIC_COMPARE', equivalent: true })
        expect(item.sourceBlobSha).not.toBe(item.currentBlobSha)
      } else {
        expect(item.sourceBlobSha).toBe(item.currentBlobSha)
      }
    }
    const observed = authority.find((candidate) => candidate.id === 'OBSERVED_MODEL_CALL_BEST_EFFORT')
    expect(observed?.sourceTestBlobSha).toBe('886e4abbc7f4f0eb746ffdf04d6202359b418ceb')
    expect(observed?.authorityBlobs).toEqual(expect.arrayContaining([
      { path: 'lib/ai-gateway/observed-model-call.server.ts', blobSha: '107b7413eeafac0335fe62907074a32aacf93f07' },
      { path: 'lib/ai-gateway/gateway-provider.ts', blobSha: 'a52e2483a20da5171fd54840a6a14832360c2999' },
    ]))
    const e1 = authority.find((candidate) => candidate.id === 'E1_POST1_AFTER_PUBLISH')
    expect(e1?.sourceTestBlobSha).toBe('e0f569a6bc57b9286d73cf09886b59f510f62310')
    expect(e1?.authorityBlobs).toEqual(expect.arrayContaining([
      { path: 'lib/narrative-qa/fault/evidence.ts', blobSha: '6a03b1911d98a8148057d0ce022e786ce487479b' },
      { path: 'lib/narrative-qa/fault/scenarios.ts', blobSha: '039280c7adbd660923847c5b1d856cfb3204083e' },
      { path: 'lib/runtime/personalized-generation.ts', blobSha: '39c245396c42a6e298ebd9a2fbe7b14dc8d7c103' },
    ]))
  })

  it('assembles dual exact authority at closure anchor with all source blobs unchanged', async () => {
    const proof = await assembled()
    expect(components(proof).map((candidate) => candidate.id)).toEqual(ANALYTICS_REFERENCE_COMPONENT_IDS)
    expect(components(proof).every((candidate) => candidate.sourceCommit === ANALYTICS_AUTHORITY_ANCHOR)).toBe(true)
    expect(component(proof, 'E1_POST1_AFTER_PUBLISH').exactAssertions).toContain('POST1_ANALYTICS_FAILURE_AFTER_PUBLISH')
    expect(component(proof, 'E1_POST1_AFTER_PUBLISH').compatibilityProofs.map((item) => item.relevantCurrentSource))
      .toEqual([
        'lib/narrative-qa/fault/evidence.ts',
        'lib/narrative-qa/fault/scenarios.ts',
        'tests/narrative-qa/m10-e1-fault-evidence.test.ts',
        'lib/runtime/personalized-generation.ts',
      ])
    expect(component(proof, 'OBSERVED_MODEL_CALL_BEST_EFFORT').exactAssertions).toEqual(OBSERVED_MODEL_CALL_ASSERTIONS)
    expect(component(proof, 'OBSERVED_MODEL_CALL_BEST_EFFORT').compatibilityProofs.map((item) => item.relevantCurrentSource))
      .toEqual([
        'tests/ai-gateway/observed-model-call.test.ts',
        'lib/ai-gateway/observed-model-call.server.ts',
        'lib/ai-gateway/gateway-provider.ts',
      ])
    expect(evaluateE2Gate(evidence(proof))).toEqual({ result: 'PASS', failures: [] })
  })

  it('rejects POST1 markers removed or moved outside exact scenario and gate blocks', async () => {
    await expectHistoricalRejection('lib/narrative-qa/fault/scenarios.ts', (content) => content.replace(
      "expectedDisposition: 'PUBLISHED',",
      "expectedDisposition: 'FAILED_CLOSED',",
    ))
    await expectHistoricalRejection('lib/narrative-qa/fault/scenarios.ts', (content) => content.replace(
      'post1Probe.reached = true',
      '// post1 probe marker removed',
    ))
    await expectHistoricalRejection('lib/narrative-qa/fault/scenarios.ts', (content) => content.replace(
      'if (post49.outcome.failedClosed) {',
      'if (false) {',
    ))
    await expectHistoricalRejection('tests/narrative-qa/m10-e1-fault-evidence.test.ts', (content) => moveOutsideNamedTest(
      content,
      'passes complete evidence and fails deliberately broken invariant evidence',
      "expect(evaluateE1Gate(evidence)).toEqual({ result: 'PASS', failures: [] })",
      "it('fails missing injection, disposition mismatch, missing recovery check, runtime retry overflow, W1 proof defects, and unbounded retry', () => {",
    ))
    await expectHistoricalRejection('lib/runtime/personalized-generation.ts', (content) => content.replace(
      'if (!published.ok) return { ok: false, reason: published.reason }\n\n    // Best-effort telemetry',
      '// Best-effort telemetry',
    ))
  })

  it('rejects current scenarios mutations to POST1 outcome and generic runScenario dependencies', async () => {
    const mutations = [
      (content: string) => content.replace(
        "expectedDisposition: 'PUBLISHED',",
        "expectedDisposition: 'FAILED_CLOSED',",
      ),
      (content: string) => content.replace(
        "const failedClosed = faultedOutcome !== 'PUBLISHED'",
        'const failedClosed = false',
      ),
      (content: string) => content.replace(
        'const invariants = recoveryInvariants ?? midFaultInvariants',
        'const invariants = midFaultInvariants',
      ),
    ]
    for (const mutate of mutations) {
      await expect(assembleAnalyticsObservabilityReference(currentScenarioMutation(mutate)))
        .rejects.toThrow('E2_CURRENT_AUTHORITY_DIFF_NOT_APPROVED:lib/narrative-qa/fault/scenarios.ts')
    }
  })

  it('rejects cleanup target, exact delete/verify, final wrapper, phase target, or unrelated drift', async () => {
    const mutations = [
      (content: string) => content.replace(
        "  'generation_job_attempts',",
        "  'generation_job_attempts-drift',",
      ),
      (content: string) => content.replace(
        "{ table: 'outbox', column: 'payload->>story_id', values: storyIds }",
        "{ table: 'outbox', column: 'payload->>other_id', values: storyIds }",
      ),
      (content: string) => content.replace(
        "  'credit_ledger',\n])\n\nasync function deleteAndVerifyExactTargets",
        '])\n\nasync function deleteAndVerifyExactTargets',
      ),
      (content: string) => content.replace(
        '): Promise<void> {\n  elevatedCleanup?.()\n  for (const target of targets) {',
        '): Promise<void> {\n  for (const target of targets) {',
      ),
      (content: string) => content.replace(
        'admin.from(target.table).delete().in(target.column, [...target.values])',
        'admin.from(target.table).delete().in(target.column, [])',
      ),
      (content: string) => content.replace(
        'admin.from(target.table).select(target.column).in(target.column, [...target.values])',
        'admin.from(target.table).select(target.column).in(target.column, [])',
      ),
      (content: string) => content.replace(
        'completed: result.resetProof.completed && resetProof.completed,',
        'completed: result.resetProof.completed,',
      ),
      (content: string) => content.replace(
        'cleanup: () => cleanupAndVerifyFaultHarnessStories(admin, userId),',
        'cleanup: async () => ({ completed: true, targets: [] }),',
      ),
      (content: string) => content.replace(
        '      targets: [],\n    },\n  }\n}\n\nexport async function runFaultMatrixWithCleanup',
        '      targets: resetTargets,\n    },\n  }\n}\n\nexport async function runFaultMatrixWithCleanup',
      ),
      (content: string) => content.replace(
        "export const PROVIDER_STORY_ID = 'm10c-e-provider'",
        "export const PROVIDER_STORY_ID = 'm10c-e-provider-drift'",
      ),
    ]
    for (const mutate of mutations) {
      await expect(assembleAnalyticsObservabilityReference(currentScenarioMutation(mutate)))
        .rejects.toThrow('E2_CURRENT_AUTHORITY_DIFF_NOT_APPROVED:lib/narrative-qa/fault/scenarios.ts')
    }
  })

  it('rejects observed-model-call setup or expectations removed and markers misplaced', async () => {
    await expectHistoricalRejection('tests/ai-gateway/observed-model-call.test.ts', (content) => moveOutsideNamedTest(
      content,
      'preserves success and original errors when recorder fails',
      'const successRecord = vi.fn().mockRejectedValue(recorderError)',
      "it('bounds recorder wait and preserves success when recorder never resolves', async () => {",
    ))
    await expectHistoricalRejection('tests/ai-gateway/observed-model-call.test.ts', (content) => moveOutsideNamedTest(
      content,
      'bounds recorder wait and preserves success when recorder never resolves',
      ".resolves.toBe('MODEL TEXT')",
      "it('bounds recorder wait and preserves original error when recorder never resolves', async () => {",
    ))
    await expectHistoricalRejection('tests/ai-gateway/observed-model-call.test.ts', (content) => content.replace(
      'const assertion = expect(pending).rejects.toBe(providerError)',
      'const assertion = expect(pending).rejects.toThrow()',
    ))
    await expectHistoricalRejection('tests/ai-gateway/observed-model-call.test.ts', (content) => content.replace(
      "rejectRecorder(new Error('late recorder secret'))",
      '// late rejection removed',
    ))
    await expectHistoricalRejection('lib/ai-gateway/observed-model-call.server.ts', (content) => content.replace(
      '.catch(() => undefined)',
      '.catch((error) => { throw error })',
    ))
    await expectHistoricalRejection('lib/ai-gateway/gateway-provider.ts', (content) => replaceAfter(
      content,
      'const parsed = await executeObservedModelCall({',
      "useCase: 'chapter_prose',",
      "useCase: 'unobserved_chapter_prose',",
    ))
  })

  it('fails missing A or B, wrong anchor, changed blobs, wrong test authority, and missing POST1', async () => {
    const baseline = await assembled()
    const mutations: Array<(proof: ProvenReferenceEvidence) => void> = [
      (proof) => { proof.referenceComponents = components(proof).filter((item) => item.id !== 'E1_POST1_AFTER_PUBLISH') },
      (proof) => { proof.referenceComponents = components(proof).filter((item) => item.id !== 'OBSERVED_MODEL_CALL_BEST_EFFORT') },
      (proof) => { component(proof, 'E1_POST1_AFTER_PUBLISH').sourceCommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      (proof) => { component(proof, 'E1_POST1_AFTER_PUBLISH').compatibilityProofs[1].currentBlobSha = '9999999999999999999999999999999999999999' },
      (proof) => { component(proof, 'OBSERVED_MODEL_CALL_BEST_EFFORT').compatibilityProofs[1].currentBlobSha = '9999999999999999999999999999999999999999' },
      (proof) => { component(proof, 'OBSERVED_MODEL_CALL_BEST_EFFORT').compatibilityProofs[2].currentBlobSha = '9999999999999999999999999999999999999999' },
      (proof) => { component(proof, 'OBSERVED_MODEL_CALL_BEST_EFFORT').sourceTestBlobSha = '9999999999999999999999999999999999999999' },
      (proof) => { component(proof, 'OBSERVED_MODEL_CALL_BEST_EFFORT').exactAssertions[0] = 'paraphrased assertion' },
      (proof) => { component(proof, 'E1_POST1_AFTER_PUBLISH').exactAssertions = component(proof, 'E1_POST1_AFTER_PUBLISH').exactAssertions.filter((value) => value !== 'POST1_ANALYTICS_FAILURE_AFTER_PUBLISH') },
    ]

    for (const mutate of mutations) {
      const proof = structuredClone(baseline)
      mutate(proof)
      expect(evaluateE2Gate(evidence(proof)).result).toBe('FAIL')
    }
  })
})

import { createHash } from 'node:crypto'
import type { GitMetadataReader } from './rows-1-9'
import {
  ANALYTICS_AUTHORITY_ANCHOR,
  ANALYTICS_REFERENCE_COMPONENT_IDS,
  OBSERVED_MODEL_CALL_ASSERTIONS,
  type E2EvidenceRow,
  type ProvenReferenceComponent,
} from './taxonomy'

export { ANALYTICS_AUTHORITY_ANCHOR, ANALYTICS_REFERENCE_COMPONENT_IDS, OBSERVED_MODEL_CALL_ASSERTIONS }

const E1_TEST = 'tests/narrative-qa/m10-e1-fault-evidence.test.ts'
const E1_EVIDENCE = 'lib/narrative-qa/fault/evidence.ts'
const E1_SCENARIO = 'lib/narrative-qa/fault/scenarios.ts'
const E1_PRODUCTION = 'lib/runtime/personalized-generation.ts'
const OBSERVED_TEST = 'tests/ai-gateway/observed-model-call.test.ts'
const OBSERVED_PRIMITIVE = 'lib/ai-gateway/observed-model-call.server.ts'
const OBSERVED_CONSUMER = 'lib/ai-gateway/gateway-provider.ts'
const E1_SCENARIO_ANCHOR_BLOB = '039280c7adbd660923847c5b1d856cfb3204083e' as const

const APPROVED_SCENARIO_REPLACEMENTS = [
  {
    source: "import { harnessProposalFor, HARNESS_TOTAL_CHAPTERS } from '../harness/fixture'",
    current: "import { CHARACTERS, harnessProposalFor, HARNESS_TOTAL_CHAPTERS } from '../harness/fixture'",
  },
  {
    source: '  cleanupHarnessStory,\n',
    current: '',
  },
  {
    source: "import { allInvariantsPassed, checkPostFaultInvariants } from './invariants'",
    current: "import { allInvariantsPassed, checkPostFaultInvariants } from './invariants'\nimport { cleanupM10E1GovernedDisposableResidue } from './e2/local-db'",
  },
  {
    source: '  cleanLatenciesMs: number[]\n}',
    current: `  cleanLatenciesMs: number[]
  resetProof: {
    completed: boolean
    targets: Array<{
      target: string
      resetApplied: boolean
      cleanStateVerified: boolean
    }>
  }
}`,
  },
  {
    source: `async function resetStory(admin: Admin, storyId: string, userId: string): Promise<void> {
  assertHarnessStoryId(storyId)
  trace(\`reset \${storyId}\`)
  await cleanupHarnessStory(admin, storyId)
  await seedHarnessStory({ admin, storyId, userId })
  trace(\`reset \${storyId} done\`)
}`,
    current: `interface ExactCleanupTarget {
  table: string
  column: string
  values: readonly string[]
}

const STORY_ID_CLEANUP_TABLES = [
  'generation_provider_calls',
  'generation_job_attempts',
  'story_events',
  'idempotency_keys',
  'commercial_generation_intents',
  'credit_reservations',
  'chapter_state_commits',
  'chapter_generation_checkpoints',
  'reader_plot_debt_closures',
  'reader_plot_debt_progress',
  'choice_outcomes',
  'chapters',
  'generation_leases',
  'generation_jobs',
  'retrieval_logs',
  'act_rollups',
  'timeline_events',
  'knowledge_scopes',
  'facts_ledger',
  'secrets_reveals',
  'story_threads',
  'character_aliases',
  'character_voice_sheets',
  'reader_states',
  'chapter_blueprints',
  'story_generation_contracts',
  'characters',
] as const

function exactCleanupTargets(
  storyIds: readonly string[],
  userId?: string,
): ExactCleanupTarget[] {
  const characterIds = storyIds.flatMap((storyId) => CHARACTERS.map((character) => \`\${storyId}:\${character.id}\`))
  return [
    ...STORY_ID_CLEANUP_TABLES.map((table) => ({ table, column: 'story_id', values: storyIds })),
    { table: 'character_states', column: 'character_id', values: characterIds },
    { table: 'outbox', column: 'payload->>story_id', values: storyIds },
    { table: 'stories', column: 'id', values: storyIds },
    ...(userId ? [{ table: 'credit_ledger', column: 'ref', values: [\`m10c:harness-grant:\${userId}\`] }] : []),
  ]
}

export const E1_EXACT_CLEANUP_TARGETS = exactCleanupTargets(FAULT_STORY_IDS, HARNESS_USER_ID)

const ELEVATED_ONLY_CLEANUP_TABLES = new Set([
  'generation_provider_calls',
  'generation_job_attempts',
  'generation_jobs',
  'chapter_state_commits',
  'reader_plot_debt_closures',
  'reader_plot_debt_progress',
  'credit_ledger',
])

async function deleteAndVerifyExactTargets(
  admin: Admin,
  targets: readonly ExactCleanupTarget[],
  elevatedCleanup?: () => void,
): Promise<void> {
  elevatedCleanup?.()
  for (const target of targets) {
    if (ELEVATED_ONLY_CLEANUP_TABLES.has(target.table)) continue
    const { error } = await admin.from(target.table).delete().in(target.column, [...target.values])
    if (error) throw new FaultScenarioError(\`\${target.table} cleanup failed: \${error.message}\`)
  }
  for (const target of targets) {
    const { data, error } = await admin.from(target.table).select(target.column).in(target.column, [...target.values])
    if (error) throw new FaultScenarioError(\`\${target.table} reset verification failed: \${error.message}\`)
    if ((data ?? []).length > 0) {
      throw new FaultScenarioError(\`reset verification found mutable story residue: \${target.table}\`)
    }
  }
}

export async function cleanupAndVerifyFaultHarnessStories(
  admin: Admin,
  userId = HARNESS_USER_ID,
  elevatedCleanup: (storyIds: readonly string[], exactUserId: string) => void = cleanupM10E1GovernedDisposableResidue,
): Promise<FaultRunResultV1['resetProof']> {
  assertIsolatedTarget()
  for (const storyId of FAULT_STORY_IDS) assertHarnessStoryId(storyId)
  await deleteAndVerifyExactTargets(
    admin,
    exactCleanupTargets(FAULT_STORY_IDS, userId),
    () => elevatedCleanup(FAULT_STORY_IDS, userId),
  )
  return {
    completed: true,
    targets: [
      ...FAULT_STORY_IDS.map((target) => ({ target, resetApplied: true, cleanStateVerified: true })),
      { target: 'outbox', resetApplied: true, cleanStateVerified: true },
    ],
  }
}

async function resetStory(admin: Admin, storyId: string, userId: string): Promise<{
  target: string
  resetApplied: boolean
  cleanStateVerified: boolean
}> {
  assertHarnessStoryId(storyId)
  trace(\`reset \${storyId}\`)
  await deleteAndVerifyExactTargets(admin, exactCleanupTargets([storyId]))
  const cleanStateVerified = true
  await seedHarnessStory({ admin, storyId, userId })
  trace(\`reset \${storyId} done\`)
  return { target: storyId, resetApplied: true, cleanStateVerified }
}`,
  },
  {
    source: 'export async function runFaultMatrix(input: RunFaultMatrixInput = {}): Promise<FaultRunResultV1> {',
    current: 'async function runFaultMatrixMutable(input: RunFaultMatrixInput): Promise<FaultRunResultV1> {',
  },
  {
    source: '  const uncovered: UncoveredFaultV1[] = []\n',
    current: "  const uncovered: UncoveredFaultV1[] = []\n  const resetTargets: FaultRunResultV1['resetProof']['targets'] = []\n",
  },
  ...[
    'PROVIDER_STORY_ID',
    'WORKER_STORY_ID',
    'PUBLICATION_STORY_ID',
  ].map((storyId) => ({
    source: `  await resetStory(admin, ${storyId}, userId)`,
    current: `  resetTargets.push(await resetStory(admin, ${storyId}, userId))`,
  })),
  {
    source: '  return { scenarios, uncovered, cleanLatenciesMs }\n}',
    current: `  return {
    scenarios,
    uncovered,
    cleanLatenciesMs,
    resetProof: {
      completed: resetTargets.length === 3
        && resetTargets.every((target) => target.resetApplied && target.cleanStateVerified),
      targets: [],
    },
  }
}

export async function runFaultMatrixWithCleanup(input: {
  runMutable: () => Promise<FaultRunResultV1>
  cleanup: () => Promise<FaultRunResultV1['resetProof']>
}): Promise<FaultRunResultV1> {
  let result: FaultRunResultV1 | undefined
  let primaryError: unknown
  try {
    result = await input.runMutable()
  } catch (error) {
    primaryError = error
  }

  let resetProof: FaultRunResultV1['resetProof'] | undefined
  try {
    resetProof = await input.cleanup()
  } catch (cleanupError) {
    if (primaryError !== undefined) {
      throw new AggregateError([primaryError, cleanupError], 'M10-E1 matrix and cleanup failed')
    }
    throw cleanupError
  }
  if (primaryError !== undefined) throw primaryError
  if (!result) throw new FaultScenarioError('matrix completed without result')
  return {
    ...result,
    resetProof: {
      completed: result.resetProof.completed && resetProof.completed,
      targets: resetProof.targets,
    },
  }
}

export async function runFaultMatrix(input: RunFaultMatrixInput = {}): Promise<FaultRunResultV1> {
  const admin = input.admin ?? createAdminClient()
  const userId = input.userId ?? HARNESS_USER_ID
  return runFaultMatrixWithCleanup({
    runMutable: () => runFaultMatrixMutable({ ...input, admin, userId }),
    cleanup: () => cleanupAndVerifyFaultHarnessStories(admin, userId),
  })
}`,
  },
] as const

const E1_ASSERTIONS = [
  'POST1_ANALYTICS_FAILURE_AFTER_PUBLISH',
  "injectedBoundary: 'recordGenerationAttempt after successful publication'",
  "it('passes complete evidence and fails deliberately broken invariant evidence', () => {",
  "expect(evaluateE1Gate(evidence)).toEqual({ result: 'PASS', failures: [] })",
] as const

type StructuralRequirement = {
  anchor: string
  blockStart: string
  required: readonly string[]
}

function codeMask(content: string): string {
  let result = ''
  let state: 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment' = 'code'
  let escaped = false
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]
    if (state === 'line-comment') {
      if (char === '\n') { state = 'code'; result += char } else result += ' '
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') { result += '  '; index += 1; state = 'code' }
      else result += char === '\n' ? '\n' : ' '
      continue
    }
    if (state !== 'code') {
      result += char === '\n' ? '\n' : ' '
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if ((state === 'single' && char === "'")
        || (state === 'double' && char === '"')
        || (state === 'template' && char === '`')) state = 'code'
      continue
    }
    if (char === '/' && next === '/') { result += '  '; index += 1; state = 'line-comment'; continue }
    if (char === '/' && next === '*') { result += '  '; index += 1; state = 'block-comment'; continue }
    if (char === "'") state = 'single'
    else if (char === '"') state = 'double'
    else if (char === '`') state = 'template'
    result += state === 'code' ? char : ' '
  }
  return result
}

function balancedBlock(content: string, start: number): string | null {
  const mask = codeMask(content)
  const brace = mask.indexOf('{', start)
  const bracket = mask.indexOf('[', start)
  const opening = brace < 0 ? bracket : bracket < 0 ? brace : Math.min(brace, bracket)
  if (opening < 0) return null
  const open = mask[opening]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  for (let index = opening; index < mask.length; index += 1) {
    if (mask[index] === open) depth += 1
    if (mask[index] === close) depth -= 1
    if (depth === 0) return content.slice(start, index + 1)
  }
  return null
}

function namedBlock(content: string, requirement: StructuralRequirement): string | null {
  const anchorIndexes: number[] = []
  let cursor = content.indexOf(requirement.anchor)
  while (cursor >= 0) {
    anchorIndexes.push(cursor)
    cursor = content.indexOf(requirement.anchor, cursor + requirement.anchor.length)
  }
  if (anchorIndexes.length !== 1) return null
  const start = content.lastIndexOf(requirement.blockStart, anchorIndexes[0])
  if (start < 0) return null
  const block = balancedBlock(content, start)
  if (!block || !block.includes(requirement.anchor)) return null
  return block
}

function requireNamedBlock(path: string, content: string, requirement: StructuralRequirement): void {
  const block = namedBlock(content, requirement)
  if (!block) throw new Error(`E2_HISTORICAL_BLOCK_NOT_FOUND:${path}:${requirement.anchor}`)
  for (const assertion of requirement.required) {
    if (!block.includes(assertion)) {
      throw new Error(`E2_HISTORICAL_BLOCK_ASSERTION_NOT_FOUND:${path}:${requirement.anchor}:${assertion}`)
    }
  }
}

function requireExactSequence(path: string, content: string, anchor: string, sequence: string): void {
  if (content.split(anchor).length !== 2 || !content.includes(sequence)) {
    throw new Error(`E2_HISTORICAL_BLOCK_ASSERTION_NOT_FOUND:${path}:${anchor}:exact sequence`)
  }
}

async function authorityBlobs(
  metadataReader: GitMetadataReader,
  paths: readonly string[],
): Promise<ProvenReferenceComponent['authorityBlobs']> {
  return Promise.all(paths.map(async (path) => ({
    path,
    blobSha: await metadataReader.readBlobSha(path, ANALYTICS_AUTHORITY_ANCHOR),
  })))
}

function gitBlobSha(content: string): string {
  const body = Buffer.from(content)
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex')
}

function applyApprovedScenarioReplacements(sourceContent: string): string | null {
  let computedCurrent = sourceContent
  for (const replacement of APPROVED_SCENARIO_REPLACEMENTS) {
    if (replacement.source.length === 0 || computedCurrent.split(replacement.source).length !== 2) return null
    computedCurrent = computedCurrent.replace(replacement.source, replacement.current)
  }
  return computedCurrent
}

function semanticDependencySlice(content: string): string | null {
  const runScenario = namedBlock(content, {
    anchor: 'async function runScenario(input: RunScenarioInput): Promise<FaultScenarioResultV1> {',
    blockStart: 'async function runScenario(input: RunScenarioInput): Promise<FaultScenarioResultV1> {',
    required: [],
  })
  const post1 = namedBlock(content, {
    anchor: "id: 'POST1_ANALYTICS_FAILURE_AFTER_PUBLISH'",
    blockStart: 'const post49 = await runScenario({',
    required: [],
  })
  const post1Gate = namedBlock(content, {
    anchor: "'POST1: a post-publish analytics failure prevented publication — plan E.2 requires publication to survive it'",
    blockStart: 'if (post49.outcome.failedClosed) {',
    required: [],
  })
  if (!runScenario || !post1 || !post1Gate) return null
  return [runScenario, post1, post1Gate].join('\n')
}

function validateApprovedScenarioTransition(input: {
  sourceContent: string
  currentContent: string
  sourceBlobSha: string
  currentBlobSha: string
}): boolean {
  const computedCurrent = applyApprovedScenarioReplacements(input.sourceContent)
  const sourceSlice = semanticDependencySlice(input.sourceContent)
  const currentSlice = semanticDependencySlice(input.currentContent)
  const exactReviewedTransition = computedCurrent === input.currentContent
  const sourceUnchanged = input.sourceContent === input.currentContent
    && input.sourceBlobSha === input.currentBlobSha
  return input.sourceBlobSha === E1_SCENARIO_ANCHOR_BLOB
    && gitBlobSha(input.sourceContent) === input.sourceBlobSha
    && gitBlobSha(input.currentContent) === input.currentBlobSha
    && (exactReviewedTransition || sourceUnchanged)
    && sourceSlice !== null
    && sourceSlice === currentSlice
}

async function validateHistoricalAuthority(metadataReader: GitMetadataReader): Promise<void> {
  const [
    evidence,
    scenario,
    currentScenario,
    scenarioSourceBlobSha,
    scenarioCurrentBlobSha,
    e1Test,
    production,
    observedTest,
    primitive,
    consumer,
  ] = await Promise.all([
    metadataReader.readBlobContent(E1_EVIDENCE, ANALYTICS_AUTHORITY_ANCHOR),
    metadataReader.readBlobContent(E1_SCENARIO, ANALYTICS_AUTHORITY_ANCHOR),
    metadataReader.readBlobContent(E1_SCENARIO, 'HEAD'),
    metadataReader.readBlobSha(E1_SCENARIO, ANALYTICS_AUTHORITY_ANCHOR),
    metadataReader.readBlobSha(E1_SCENARIO, 'HEAD'),
    metadataReader.readBlobContent(E1_TEST, ANALYTICS_AUTHORITY_ANCHOR),
    metadataReader.readBlobContent(E1_PRODUCTION, ANALYTICS_AUTHORITY_ANCHOR),
    metadataReader.readBlobContent(OBSERVED_TEST, ANALYTICS_AUTHORITY_ANCHOR),
    metadataReader.readBlobContent(OBSERVED_PRIMITIVE, ANALYTICS_AUTHORITY_ANCHOR),
    metadataReader.readBlobContent(OBSERVED_CONSUMER, ANALYTICS_AUTHORITY_ANCHOR),
  ])

  requireNamedBlock(E1_EVIDENCE, evidence, {
    anchor: "'POST1_ANALYTICS_FAILURE_AFTER_PUBLISH'",
    blockStart: 'export const E1_EXECUTABLE_SCENARIO_IDS = [',
    required: ["'POST1_ANALYTICS_FAILURE_AFTER_PUBLISH'"],
  })
  requireNamedBlock(E1_SCENARIO, scenario, {
    anchor: "id: 'POST1_ANALYTICS_FAILURE_AFTER_PUBLISH'",
    blockStart: 'const post49 = await runScenario({',
    required: [
      "injectedBoundary: 'recordGenerationAttempt after successful publication'",
      "expectedDisposition: 'PUBLISHED'",
      'recordGenerationAttempt: async () => {',
      'post1Probe.reached = true',
      "throw new InjectedProviderFault('injected analytics failure', 'ANALYTICS_DOWN', false)",
    ],
  })
  requireNamedBlock(E1_SCENARIO, scenario, {
    anchor: "'POST1: a post-publish analytics failure prevented publication — plan E.2 requires publication to survive it'",
    blockStart: 'if (post49.outcome.failedClosed) {',
    required: ['if (post49.outcome.failedClosed)', 'throw new FaultScenarioError('],
  })
  if (!validateApprovedScenarioTransition({
    sourceContent: scenario,
    currentContent: currentScenario,
    sourceBlobSha: scenarioSourceBlobSha,
    currentBlobSha: scenarioCurrentBlobSha,
  })) {
    throw new Error(`E2_CURRENT_AUTHORITY_DIFF_NOT_APPROVED:${E1_SCENARIO}`)
  }
  requireNamedBlock(E1_TEST, e1Test, {
    anchor: 'function passingEvidence(): E1Evidence {',
    blockStart: 'function passingEvidence(): E1Evidence {',
    required: [
      'faultSchedule: [...E1_EXECUTABLE_SCENARIO_IDS]',
      'scenarios: E1_EXECUTABLE_SCENARIO_IDS.map(passingScenario)',
      'canonicalCorruptionCount: 0',
    ],
  })
  requireNamedBlock(E1_TEST, e1Test, {
    anchor: E1_ASSERTIONS[2],
    blockStart: E1_ASSERTIONS[2],
    required: [
      'const evidence = passingEvidence()',
      E1_ASSERTIONS[3],
    ],
  })
  requireNamedBlock(E1_PRODUCTION, production, {
    anchor: 'Best-effort telemetry — never convert publish success into workflow failure.',
    blockStart: 'async function generateNextPersonalizedChapterInner(',
    required: [
      'await d.recordGenerationAttempt({',
      "outcome: 'PUBLISHED'",
      '} catch {',
      'chapterNumber: published.chapter_number',
      'seq: published.seq',
    ],
  })
  requireExactSequence(
    E1_PRODUCTION,
    production,
    'Best-effort telemetry — never convert publish success into workflow failure.',
    'if (!published.ok) return { ok: false, reason: published.reason }\n\n    // Best-effort telemetry — never convert publish success into workflow failure.',
  )

  const observedRequirements: Record<(typeof OBSERVED_MODEL_CALL_ASSERTIONS)[number], readonly string[]> = {
    'preserves success and original errors when recorder fails': [
      'const successRecord = vi.fn().mockRejectedValue(recorderError)',
      ".resolves.toBe('MODEL TEXT')",
      'call: () => { throw providerError }',
      'rejects.toBe(providerError)',
    ],
    'bounds recorder wait and preserves success when recorder never resolves': [
      'new Promise<void>(() => {})',
      'recorderTimeoutMs: 10',
      'await vi.advanceTimersByTimeAsync(10)',
      ".resolves.toBe('MODEL TEXT')",
    ],
    'bounds recorder wait and preserves original error when recorder never resolves': [
      'call: () => { throw providerError }',
      'new Promise<void>(() => {})',
      'recorderTimeoutMs: 10',
      'rejects.toBe(providerError)',
    ],
    'handles recorder rejection after timeout without exposing it': [
      'rejectRecorder = reject',
      'recorderTimeoutMs: 10',
      ".resolves.toBe('MODEL TEXT')",
      "rejectRecorder(new Error('late recorder secret'))",
    ],
  }
  for (const name of OBSERVED_MODEL_CALL_ASSERTIONS) {
    const declaration = `it('${name}', async () => {`
    requireNamedBlock(OBSERVED_TEST, observedTest, {
      anchor: declaration,
      blockStart: declaration,
      required: observedRequirements[name],
    })
  }
  requireNamedBlock(OBSERVED_PRIMITIVE, primitive, {
    anchor: 'async function recordBestEffort(',
    blockStart: 'async function recordBestEffort(',
    required: [
      '.then(() => deps.record(start, completion))',
      '.catch(() => undefined)',
      'await Promise.race([recorder, deadline])',
    ],
  })
  requireNamedBlock(OBSERVED_PRIMITIVE, primitive, {
    anchor: 'export async function executeObservedModelCall<T>(',
    blockStart: 'export async function executeObservedModelCall<T>(',
    required: [
      'await recordBestEffort(start, completion, deps)',
      'return value',
      'throw error',
    ],
  })
  requireNamedBlock(OBSERVED_CONSUMER, consumer, {
    anchor: 'const parsed = await executeObservedModelCall({',
    blockStart: 'try {',
    required: [
      'const parsed = await executeObservedModelCall({',
      "useCase: 'chapter_prose'",
      'call: () => executeCandidate(',
      'consume: (text) => {',
    ],
  })
}

async function compatibilityProofs(
  metadataReader: GitMetadataReader,
  currentHeadSha: string,
  paths: readonly string[],
): Promise<ProvenReferenceComponent['compatibilityProofs']> {
  return Promise.all(paths.map(async (path) => {
    const sourceBlobSha = await metadataReader.readBlobSha(path, ANALYTICS_AUTHORITY_ANCHOR)
    const currentBlobSha = await metadataReader.readBlobSha(path, 'HEAD')
    if (path === E1_SCENARIO && sourceBlobSha !== currentBlobSha) {
      const [sourceContent, currentContent] = await Promise.all([
        metadataReader.readBlobContent(path, ANALYTICS_AUTHORITY_ANCHOR),
        metadataReader.readBlobContent(path, 'HEAD'),
      ])
      const equivalent = validateApprovedScenarioTransition({
        sourceContent,
        currentContent,
        sourceBlobSha,
        currentBlobSha,
      })
      return {
        method: 'SEMANTIC_COMPARE' as const,
        currentHeadSha,
        relevantCurrentSource: path,
        sourceBlobSha,
        currentBlobSha,
        comparison: `Computed exact reviewed reset-proof cleanup/collection transition from ${E1_SCENARIO_ANCHOR_BLOB}; full POST1 runScenario, invariant, fault injection, and failure-gate dependency slice is byte-identical.`,
        equivalent,
      }
    }
    return {
      method: 'SOURCE_UNCHANGED' as const,
      currentHeadSha,
      relevantCurrentSource: path,
      sourceBlobSha,
      currentBlobSha,
    }
  }))
}

export async function assembleAnalyticsObservabilityReference(
  metadataReader: GitMetadataReader,
): Promise<E2EvidenceRow> {
  const currentHeadSha = await metadataReader.readHeadSha()
  await validateHistoricalAuthority(metadataReader)

  const e1AuthorityPaths = [E1_EVIDENCE, E1_SCENARIO, E1_TEST, E1_PRODUCTION] as const
  const observedAuthorityPaths = [OBSERVED_TEST, OBSERVED_PRIMITIVE, OBSERVED_CONSUMER] as const
  const referenceComponents: ProvenReferenceComponent[] = [
    {
      id: ANALYTICS_REFERENCE_COMPONENT_IDS[0],
      sourceCommit: ANALYTICS_AUTHORITY_ANCHOR,
      sourceTest: E1_TEST,
      sourceTestBlobSha: await metadataReader.readBlobSha(E1_TEST, ANALYTICS_AUTHORITY_ANCHOR),
      authorityBlobs: await authorityBlobs(metadataReader, e1AuthorityPaths),
      exactAssertions: [...E1_ASSERTIONS],
      exactProperty: 'POST1_ANALYTICS_FAILURE_AFTER_PUBLISH proves publication stays PUBLISHED and canonical when optional recordGenerationAttempt fails after successful publication.',
      compatibilityProofs: await compatibilityProofs(metadataReader, currentHeadSha, e1AuthorityPaths),
    },
    {
      id: ANALYTICS_REFERENCE_COMPONENT_IDS[1],
      sourceCommit: ANALYTICS_AUTHORITY_ANCHOR,
      sourceTest: OBSERVED_TEST,
      sourceTestBlobSha: await metadataReader.readBlobSha(OBSERVED_TEST, ANALYTICS_AUTHORITY_ANCHOR),
      authorityBlobs: await authorityBlobs(metadataReader, observedAuthorityPaths),
      exactAssertions: [...OBSERVED_MODEL_CALL_ASSERTIONS],
      exactProperty: 'executeObservedModelCall delegates telemetry to recordBestEffort; recorder rejection or timeout preserves success and original errors, including late rejection after timeout. gateway-provider.ts calls executeObservedModelCall.',
      compatibilityProofs: await compatibilityProofs(metadataReader, currentHeadSha, observedAuthorityPaths),
    },
  ]

  return {
    id: 'ANALYTICS_OBSERVABILITY_INJECTED',
    proof: { disposition: 'PROVEN_REFERENCE', referenceComponents },
  }
}

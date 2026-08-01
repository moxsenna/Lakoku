import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
let pass = 0
let fail = 0

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    pass++
    console.log(`  PASS ${name}`)
    return
  }
  fail++
  console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`)
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return extname(entry.name) === '.ts' || extname(entry.name) === '.tsx' ? [path] : []
  })
}

function sourceFile(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

function terminalCallName(call: ts.CallExpression): string | null {
  if (ts.isIdentifier(call.expression)) return call.expression.text
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text
  return null
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
  return null
}

function location(file: ts.SourceFile, node: ts.Node): string {
  const position = file.getLineAndCharacterOfPosition(node.getStart(file))
  return `${relative(root, file.fileName)}:${position.line + 1}:${position.character + 1}`
}

function observedCallOwner(call: ts.CallExpression): ts.CallExpression | null {
  let node: ts.Node | undefined = call.parent
  while (node) {
    if (ts.isPropertyAssignment(node) && propertyNameText(node.name) === 'call') {
      const owner = node.parent
      if (!ts.isObjectLiteralExpression(owner)) return null
      const execution = owner.parent
      return ts.isCallExpression(execution)
        && terminalCallName(execution) === 'executeObservedModelCall'
        && execution.arguments[0] === owner
        ? execution
        : null
    }
    node = node.parent
  }
  return null
}

function streamRetryViolation(call: ts.CallExpression): string | null {
  const options = call.arguments[0]
  if (!options || !ts.isObjectLiteralExpression(options)) {
    return 'streamText first argument must be an object literal'
  }

  let maxRetriesZeroIndex = -1
  let maxRetriesCount = 0
  for (const [index, property] of options.properties.entries()) {
    if (ts.isSpreadAssignment(property)) {
      if (maxRetriesZeroIndex >= 0) {
        return 'spread after maxRetries: 0 can overwrite retry lock'
      }
      continue
    }
    if (!('name' in property) || !property.name || propertyNameText(property.name) !== 'maxRetries') {
      continue
    }
    maxRetriesCount++
    if (!ts.isPropertyAssignment(property)) {
      return 'maxRetries must be an explicit property assignment'
    }
    if (!ts.isNumericLiteral(property.initializer) || property.initializer.text !== '0') {
      return `maxRetries must be numeric literal 0, received ${property.initializer.getText()}`
    }
    maxRetriesZeroIndex = index
  }

  if (maxRetriesCount === 0) return 'missing maxRetries: 0'
  if (maxRetriesCount > 1) return 'duplicate maxRetries properties can overwrite retry lock'
  return null
}

function analyzeStreamFixture(source: string): {
  observed: boolean
  retryViolation: string | null
} {
  const parsed = ts.createSourceFile(
    'stream-boundary-fixture.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  let streamCall: ts.CallExpression | null = null
  walk(parsed, (node) => {
    if (streamCall || !ts.isCallExpression(node) || terminalCallName(node) !== 'streamText') return
    streamCall = node
  })
  if (!streamCall) return { observed: false, retryViolation: 'missing streamText fixture call' }
  const call: ts.CallExpression = streamCall
  return {
    observed: observedCallOwner(call) !== null,
    retryViolation: streamRetryViolation(call),
  }
}

console.log('generation provider boundary inventory:')

const gatewayRoot = resolve(root, 'lib/ai-gateway')
const gatewayProvider = resolve(gatewayRoot, 'gateway-provider.ts')
const unaccountedStreamCalls: string[] = []
const retryLockViolations: string[] = []
let streamCallCount = 0

for (const file of sourceFiles(gatewayRoot)) {
  const parsed = sourceFile(file)
  walk(parsed, (node) => {
    if (!ts.isCallExpression(node) || terminalCallName(node) !== 'streamText') return
    streamCallCount++
    const callLocation = location(parsed, node)

    if (file !== gatewayProvider) {
      unaccountedStreamCalls.push(`${callLocation} streamText call is outside gateway-provider.ts`)
      return
    }
    if (!observedCallOwner(node)) {
      unaccountedStreamCalls.push(
        `${callLocation} streamText call is not owned by executeObservedModelCall({ call: ... })`,
      )
    }
    const retryViolation = streamRetryViolation(node)
    if (retryViolation) retryLockViolations.push(`${callLocation} ${retryViolation}`)
  })
}

check('gateway has actual streamText provider calls to inventory', streamCallCount > 0)
check(
  'every gateway streamText call is an executeObservedModelCall call closure (TypeScript AST)',
  unaccountedStreamCalls.length === 0,
  unaccountedStreamCalls.join('; '),
)
check(
  'every observed streamText call safely disables hidden SDK retries (TypeScript AST)',
  retryLockViolations.length === 0,
  retryLockViolations.join('; '),
)

const directFixture = analyzeStreamFixture('streamText({ maxRetries: 0 })')
const consumeFixture = analyzeStreamFixture(`executeObservedModelCall({
  call: () => Promise.resolve('not a provider call'),
  consume: () => streamText({ maxRetries: 0 }),
})`)
const missingRetryFixture = analyzeStreamFixture(`executeObservedModelCall({
  call: () => streamText({ model }),
})`)
const nonzeroRetryFixture = analyzeStreamFixture(`executeObservedModelCall({
  call: () => streamText({ model, maxRetries: 1 }),
})`)
const postZeroSpreadFixture = analyzeStreamFixture(`executeObservedModelCall({
  call: () => executeCandidate(() => streamText({ maxRetries: 0, ...options })),
})`)
const safeCandidateFixture = analyzeStreamFixture(`executeObservedModelCall({
  call: () => executeCandidate(() => streamText({ ...options, maxRetries: 0 })),
})`)

check(
  'AST boundary regression rejects direct unobserved streamText fixture',
  !directFixture.observed,
)
check(
  'AST boundary regression rejects streamText nested under consume property',
  !consumeFixture.observed,
)
check(
  'AST retry regression rejects missing maxRetries fixture',
  missingRetryFixture.retryViolation === 'missing maxRetries: 0',
  missingRetryFixture.retryViolation ?? undefined,
)
check(
  'AST retry regression rejects nonzero maxRetries fixture',
  nonzeroRetryFixture.retryViolation?.startsWith('maxRetries must be numeric literal 0') === true,
  nonzeroRetryFixture.retryViolation ?? undefined,
)
check(
  'AST retry regression rejects spread after maxRetries: 0 fixture',
  postZeroSpreadFixture.retryViolation === 'spread after maxRetries: 0 can overwrite retry lock',
  postZeroSpreadFixture.retryViolation ?? undefined,
)
check(
  'AST boundary regression allows executeCandidate and pre-lock spread fixture',
  safeCandidateFixture.observed && safeCandidateFixture.retryViolation === null,
  safeCandidateFixture.retryViolation ?? undefined,
)

const generationLogFiles = [
  resolve(root, 'lib/runtime/story-generation.ts'),
  resolve(root, 'lib/api/start-chapter.server.ts'),
  resolve(root, 'app/api/stories/[id]/generate/route.ts'),
]
const rawGenerationLogs = generationLogFiles.filter((file) => {
  const source = readFileSync(file, 'utf8')
  const calls = source.match(/console\.(?:log|error|warn)\((?:[^()]|\([^()]*\))*\)/g) ?? []
  return calls.some((call) => {
    const args = call.replace(/^console\.(?:log|error|warn)/, '')
    return /err(?:or)?\.message|\berr\b|\berror\b/.test(args)
  })
})
check(
  'changed generation paths log controlled codes only',
  rawGenerationLogs.length === 0,
  rawGenerationLogs.map((file) => relative(root, file)).join(', '),
)

const libRoot = resolve(root, 'lib')
const generateObjectImports = sourceFiles(libRoot).filter((file) => {
  const source = readFileSync(file, 'utf8')
  return /import\s*\{[^}]*\bgenerateObject\b[^}]*\}\s*from\s*['"]ai['"]/.test(source)
})
const authoringModel = resolve(root, 'lib/authoring/model.ts')
const authoringSource = readFileSync(authoringModel, 'utf8')

check(
  'authoring model is sole generateObject provider boundary excluded before story generation',
  generateObjectImports.length === 1 && generateObjectImports[0] === authoringModel,
  generateObjectImports.map((file) => relative(root, file)).join(', '),
)
check(
  'authoring exclusion explicitly delegates generation to generateObject',
  /generate\s*:\s*AuthorObjectGenerate\s*=\s*generateObject\s+as\s+AuthorObjectGenerate/.test(authoringSource)
    && /await\s+generate\s*\(/.test(authoringSource),
)

console.log('\nadmin generation dashboard boundaries:')

const generationLoader = readFileSync(resolve(root, 'lib/admin/generation.ts'), 'utf8')
const generationPage = readFileSync(resolve(root, 'app/admin/generation/page.tsx'), 'utf8')
const generationComponentsRoot = resolve(root, 'components/admin/generation')
const generationUiSource = [generationPage, ...sourceFiles(generationComponentsRoot).map((file) => readFileSync(file, 'utf8'))].join('\n')

check('generation loader does not read story_events directly', !/story_events/.test(generationLoader))
check('generation loader uses cookie-scoped client', /createClient/.test(generationLoader) && !/createAdminClient/.test(generationLoader))
for (const rpc of [
  'admin_generation_overview_v1',
  'admin_generation_timeseries_v1',
  'admin_model_performance_v1',
  'admin_generation_provider_calls_v1',
  'admin_generation_job_detail_v1',
  'admin_generation_data_quality_v1',
  'admin_generation_error_distribution_v1',
  'admin_generation_cost_breakdown_v1',
]) check(`generation loader includes ${rpc}`, generationLoader.includes(rpc))
check(
  'distribution renders full-range aggregate rows',
  /ErrorFallbackDistribution rows=\{dashboard\.errorDistribution\}/.test(generationPage),
)
check(
  'dashboard renders bounded cost breakdown',
  /GenerationCostBreakdown rows=\{dashboard\.costBreakdown\}/.test(generationPage),
)
for (const filter of [
  'errorCode', 'userId', 'storyId', 'generationKind', 'jobId',
  'correlationId', 'chapter',
]) check(`generation dashboard exposes ${filter} filter`, generationUiSource.includes(`name=\"${filter}\"`))
check('generation filter submission resets cursor', !/name=\"cursor(?:StartedAt|Id)\"/.test(generationUiSource))
const generationUiWithoutMaskedEmail = generationUiSource.replaceAll('masked_user_email', '')
check('generation dashboard renders masked identity only', !/\.email\b|raw_email|user_email/.test(generationUiWithoutMaskedEmail))
check('generation dashboard omits claim token', !/claim_?token/i.test(generationUiSource))
check('generation dashboard omits publication result fields', !/publication_?(result|json)|publication payload/i.test(generationUiSource))
check('generation dashboard has no mutation controls', !/retry job|cancel job|recover job|edit route/i.test(generationUiSource))
check('generation dashboard links authorized user detail', /\/admin\/users\//.test(generationUiSource))
check('generation dashboard has loading route', readFileSync(resolve(root, 'app/admin/generation/loading.tsx'), 'utf8').length > 0)

console.log(`\n${pass}/${pass + fail} PASS`)
if (fail > 0) process.exit(1)

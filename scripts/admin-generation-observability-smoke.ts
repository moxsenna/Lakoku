import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

function countMatches(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length
}

console.log('generation provider boundary inventory:')

const gatewayRoot = resolve(root, 'lib/ai-gateway')
const gatewayProvider = resolve(gatewayRoot, 'gateway-provider.ts')
const observedWrapper = resolve(gatewayRoot, 'observed-model-call.server.ts')
const streamCallPattern = /\bstreamText\s*\(/g
const observedClosurePattern = /\bcall\s*:\s*\(\s*\)\s*=>\s*streamText\s*\(/g
const unaccountedStreamCalls: string[] = []
let streamCallCount = 0

for (const file of sourceFiles(gatewayRoot)) {
  const source = readFileSync(file, 'utf8')
  const calls = countMatches(source, streamCallPattern)
  if (calls === 0) continue
  streamCallCount += calls

  if (file === observedWrapper) continue
  if (file === gatewayProvider) {
    const observedClosures = countMatches(source, observedClosurePattern)
    if (observedClosures === calls) continue
    unaccountedStreamCalls.push(
      `${relative(root, file)} has ${calls} streamText call(s), ${observedClosures} observed call closure(s)`,
    )
    continue
  }
  unaccountedStreamCalls.push(`${relative(root, file)} has ${calls} streamText call(s)`)
}

check('gateway has actual streamText provider calls to inventory', streamCallCount > 0)
check(
  'every gateway streamText call is an executeObservedModelCall call closure',
  unaccountedStreamCalls.length === 0,
  unaccountedStreamCalls.join('; '),
)
check(
  'every observed streamText call disables hidden SDK retries',
  countMatches(readFileSync(gatewayProvider, 'utf8'), /\bmaxRetries\s*:\s*0\b/g)
    === countMatches(readFileSync(gatewayProvider, 'utf8'), observedClosurePattern),
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

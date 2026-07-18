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

console.log(`\n${pass}/${pass + fail} PASS`)
if (fail > 0) process.exit(1)

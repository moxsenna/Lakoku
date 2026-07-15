import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import {
  ChapterStatusResponseSchema,
  GetChapterResponseSchema,
  GetStoryResponseSchema,
  ListChaptersResponseSchema,
  ListStoriesResponseSchema,
  SubmitChoiceResponseSchema,
} from '@lakoku/contracts'

const root = process.cwd()
let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1
    console.log(`  PASS ${name}`)
    return
  }
  failed += 1
  console.error(`  FAIL ${name}${detail === undefined ? '' : `: ${String(detail)}`}`)
}

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

function sourceFile(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    relativePath,
    source(relativePath),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
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

function staticString(expression: ts.Expression): string | null {
  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text
  }
  if (
    ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isParenthesizedExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    return staticString(expression.expression)
  }
  return null
}

function stringConstants(file: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>()
  walk(file, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return
    const value = staticString(node.initializer)
    if (value !== null) constants.set(node.name.text, value)
  })
  return constants
}

function selectedProjection(
  call: ts.CallExpression,
  constants: ReadonlyMap<string, string>,
): string | null {
  if (terminalCallName(call) !== 'select') return null
  const argument = call.arguments[0]
  if (!argument) return null
  const inlineValue = staticString(argument)
  if (inlineValue !== null) return inlineValue
  if (ts.isIdentifier(argument)) return constants.get(argument.text) ?? null
  return null
}

function containsWildcardProjection(projection: string): boolean {
  return /(^|[,(])\s*\*\s*(?=$|[,)])/.test(projection)
}

const readerSelectTargets = [
  'lib/api/queries.ts',
  'lib/api/user-state.ts',
  'lib/api/server.ts',
  'app/api/stories/route.ts',
  'app/api/stories/[id]/route.ts',
  'app/api/stories/[id]/chapters/route.ts',
  'app/api/stories/[id]/chapters/[number]/route.ts',
  'app/api/stories/[id]/choices/route.ts',
  'app/api/stories/[id]/chapters/[number]/status/route.ts',
  'app/api/stories/personalized/route.ts',
  'app/api/stories/premium/[templateId]/clone/route.ts',
] as const

const wildcardSelects: string[] = []
for (const relativePath of readerSelectTargets) {
  const file = sourceFile(relativePath)
  const constants = stringConstants(file)
  walk(file, (node) => {
    if (!ts.isCallExpression(node)) return
    const projection = selectedProjection(node, constants)
    if (!projection || !containsWildcardProjection(projection)) return
    const position = file.getLineAndCharacterOfPosition(node.getStart(file))
    wildcardSelects.push(`${relativePath}:${position.line + 1} select(${JSON.stringify(projection)})`)
  })
}
check(
  'reader-facing Supabase selects have no wildcard projections (TypeScript AST)',
  wildcardSelects.length === 0,
  wildcardSelects.join('; '),
)

const internalResponseFields = new Set([
  'effect',
  'effect_json',
  'effectJson',
  'choice_kind',
  'choiceKind',
  'route_state',
  'routeState',
  'choice_history',
  'choiceHistory',
  'story_contract_json',
  'storyContractJson',
  'plot_debts_json',
  'plotDebtsJson',
  'ending_candidates_json',
  'endingCandidatesJson',
  'ending_lock_json',
  'endingLockJson',
  'locked_ending_key',
  'lockedEndingKey',
  'owner_user_id',
  'ownerUserId',
  'user_id',
  'userId',
  'visibility',
  'story_mode',
  'storyMode',
  'generation_status',
  'generationStatus',
  'source_story_id',
  'sourceStoryId',
  'request_hash',
  'requestHash',
  'error_code',
  'errorCode',
  'lease_id',
  'leaseId',
  'failedLayer',
  'findings',
  'repairAttempts',
])

function internalPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => internalPaths(item, `${path}[${index}]`))
  }
  if (!value || typeof value !== 'object') return []

  const leaks: string[] = []
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path === '$' ? key : `${path}.${key}`
    if (internalResponseFields.has(key)) leaks.push(childPath)
    leaks.push(...internalPaths(child, childPath))
  }
  return leaks
}

const story = {
  id: 'ai:reader-safe',
  title: 'Jejak Senja',
  cover: '/placeholder.svg',
  tagline: 'Rahasia lama kembali.',
  role: 'Tokoh utama',
  tropes: ['Romance'] as const,
  totalChapters: 50,
  currentChapter: 2,
  status: 'BERJALAN' as const,
  synopsis: 'Satu janji lama mengubah perjalanan.',
  jejak: [{ chapter: 1, decision: 'Membuka surat', consequence: 'Rahasia pertama terlihat.' }],
}
const chapter = {
  storyId: story.id,
  number: 2,
  title: 'Surat Kedua',
  paragraphs: ['Hujan berhenti ketika surat itu dibuka.'],
  choicePrompt: 'Apa langkahmu?',
  choices: [{ id: 'baca', label: 'Baca sampai selesai', hint: 'Rahasia mungkin terungkap.' }],
}
const outcome = {
  storyId: story.id,
  chapterNumber: 2,
  choiceId: 'baca',
  consequence: ['Kebenaran mulai terlihat.'],
  nextChapterNumber: 3,
  isEnding: false,
}

const representativeReaderPayloads: Record<string, unknown> = {
  explore: ListStoriesResponseSchema.parse({ stories: [story] }),
  detail: GetStoryResponseSchema.parse({ story }),
  chapter: GetChapterResponseSchema.parse({ chapter }),
  chapterList: ListChaptersResponseSchema.parse({
    chapters: [{ number: 1, title: 'Awal' }, { number: 2, title: chapter.title }],
    maxReachedChapter: 2,
  }),
  choice: SubmitChoiceResponseSchema.parse({ outcome, nextChapterReady: false }),
  status: ChapterStatusResponseSchema.parse({ status: 'generating', chapterNumber: 3 }),
  personalizedCreate: { storyId: story.id, redirectUrl: '/baca/ai%3Areader-safe?bab=1' },
  premiumClone: {
    storyId: 'ai:premium:reader-safe:instance',
    redirectUrl: '/baca/ai%3Apremium%3Areader-safe%3Ainstance?bab=1',
    replayed: false,
  },
}

for (const [name, payload] of Object.entries(representativeReaderPayloads)) {
  const leaks = internalPaths(payload)
  check(`reader payload ${name} recursively excludes internal fields`, leaks.length === 0, leaks.join(', '))
}

const nestedLeakControl = internalPaths({ story: { chapter: { debug: { route_state: {} } } } })
check(
  'recursive leak control reports exact nested path',
  nestedLeakControl.length === 1 && nestedLeakControl[0] === 'story.chapter.debug.route_state',
  nestedLeakControl.join(', '),
)

function objectLiteralKeys(node: ts.ObjectLiteralExpression, keys: string[]): void {
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      const name = property.name
      if (name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name))) keys.push(name.text)
      if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) {
        objectLiteralKeys(property.initializer, keys)
      }
    }
  }
}

function responseBuilderKeys(relativePath: string): string[] {
  const file = sourceFile(relativePath)
  const keys: string[] = []
  walk(file, (node) => {
    if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
      objectLiteralKeys(node.expression, keys)
      return
    }
    if (!ts.isCallExpression(node)) return
    const callName = terminalCallName(node)
    const payloadIndex = callName === 'jsonWithETag' ? 1 : callName === 'json' ? 0 : -1
    if (payloadIndex < 0) return
    const payload = node.arguments[payloadIndex]
    if (payload && ts.isObjectLiteralExpression(payload)) objectLiteralKeys(payload, keys)
  })
  return keys
}

const responseBuilderLeaks = readerSelectTargets.flatMap((relativePath) =>
  responseBuilderKeys(relativePath)
    .filter((key) => internalResponseFields.has(key))
    .map((key) => `${relativePath}:${key}`),
)
check(
  'reader route response builders expose only reader-safe explicit fields (TypeScript AST)',
  responseBuilderLeaks.length === 0,
  responseBuilderLeaks.join(', '),
)

const personalizedRuntimePath = 'lib/runtime/personalized-generation.ts'
const personalizedRuntimeAst = sourceFile(personalizedRuntimePath)
const choiceBranches: ts.IfStatement[] = []
walk(personalizedRuntimeAst, (node) => {
  if (!ts.isIfStatement(node)) return
  const condition = node.expression.getText(personalizedRuntimeAst).replace(/\s+/g, '')
  if (condition === 'chapterNumber<TOTAL_PERSONALIZED_CHAPTERS') choiceBranches.push(node)
})
const finalChoiceBranch = choiceBranches[0]
const beforeFinalText = finalChoiceBranch?.thenStatement.getText(personalizedRuntimeAst) ?? ''
const finalText = finalChoiceBranch?.elseStatement?.getText(personalizedRuntimeAst) ?? ''
check(
  'personalized runtime generates choices only before final chapter',
  choiceBranches.length === 1 && beforeFinalText.includes('generateChoiceBranch') && !finalText.includes('generateChoiceBranch'),
)
check(
  'Chapter 50 publishes null choicePrompt, null choices, and empty outcomes',
  /choicePrompt\s*=\s*null/.test(finalText)
    && /choices\s*=\s*null/.test(finalText)
    && /outcomes\s*=\s*\[\s*\]/.test(finalText),
)

const personalizedChoice = source('lib/api/personalized-choice.server.ts')
check(
  'personalized choice input schema caps choices at Chapter 49',
  /PersonalizedChapterSchema\s*=\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(49\)/.test(personalizedChoice),
)

const readerView = source('components/reader-view.tsx')
check(
  'reader hides final choices and requires non-empty choices',
  readerView.includes('chapter.number < story.totalChapters')
    && readerView.includes('chapter.choices.length > 0'),
)
check(
  'reader shows final completion CTA',
  readerView.includes('chapter.number >= story.totalChapters')
    && readerView.includes('Kembali ke Library')
    && readerView.includes('Buat Cerita Baru'),
)

function calledNames(relativePath: string): Set<string> {
  const file = sourceFile(relativePath)
  const names = new Set<string>()
  walk(file, (node) => {
    if (ts.isCallExpression(node)) {
      const name = terminalCallName(node)
      if (name) names.add(name)
    }
  })
  return names
}

const standardGenerationPath = 'lib/runtime/story-generation.ts'
const standardCalls = calledNames(standardGenerationPath)
const standardGeneration = source(standardGenerationPath)
check(
  'legacy real generation path remains exported and uses buildChoices plus publishChapter',
  standardGeneration.includes('export async function generateNextChapterReal')
    && standardCalls.has('buildChoices')
    && standardCalls.has('publishChapter'),
)

const lifecyclePath = 'lib/runtime/lifecycle.ts'
const lifecycle = source(lifecyclePath)
check(
  'legacy publishChapter and publish_chapter remain preserved',
  lifecycle.includes('export async function publishChapter(')
    && lifecycle.includes(".rpc('publish_chapter'"),
)
check(
  'publishChapterV2 and publish_chapter_v2 remain additive',
  lifecycle.includes('export async function publishChapterV2(')
    && lifecycle.includes(".rpc('publish_chapter_v2'"),
)

const runtimeIndex = source('lib/runtime/index.ts')
check(
  'runtime exports standard and personalized generation modules',
  runtimeIndex.includes("export * from './story-generation'")
    && runtimeIndex.includes("export * from './personalized-generation'")
    && runtimeIndex.includes("export * from './lifecycle'"),
)

const generationRoute = source('app/api/stories/[id]/generate/route.ts')
check(
  'existing generation route still selects generateNextChapterReal',
  generationRoute.includes("from '@lakoku/runtime'")
    && generationRoute.includes('generateNextChapterReal')
    && generationRoute.includes('await generateNextChapterReal(id, n)'),
)

const personalizedSourcePaths = [
  personalizedRuntimePath,
  'lib/api/personalized-stories.server.ts',
  'lib/api/premium-clone.server.ts',
  'lib/api/personalized-choice.server.ts',
  'lib/api/generation-continuation.server.ts',
  'app/api/stories/personalized/route.ts',
  'app/api/stories/premium/[templateId]/clone/route.ts',
] as const
const forbiddenLegacyCalls = new Set(['generateNextChapterReal', 'publishChapter', 'buildChoices'])
const personalizedLegacyCalls = personalizedSourcePaths.flatMap((relativePath) =>
  [...calledNames(relativePath)]
    .filter((name) => forbiddenLegacyCalls.has(name))
    .map((name) => `${relativePath}:${name}`),
)
check(
  'personalized sources never call legacy generator, publisher, or buildChoices',
  personalizedLegacyCalls.length === 0,
  personalizedLegacyCalls.join(', '),
)
check(
  'personalized runtime uses dynamic choice generator and v2 publisher',
  calledNames(personalizedRuntimePath).has('generateChoiceBranch')
    && calledNames(personalizedRuntimePath).has('publishChapterV2'),
)

const premiumClone = source('lib/api/premium-clone.server.ts')
check(
  'premium clone creates distinct instance ID from template ID',
  premiumClone.includes('const uuid = randomUUID()')
    && premiumClone.includes('return `ai:premium:${slug}:${uuid}`')
    && premiumClone.includes('const storyId = targetStoryId(input.templateStoryId)'),
)
check(
  'premium instance enforces source template marker and private instance mode',
  premiumClone.includes('input.row.source_story_id !== input.templateStoryId')
    && premiumClone.includes("input.row.story_mode !== 'premium_instance'")
    && premiumClone.includes('p_template_story_id: input.templateStoryId')
    && premiumClone.includes('p_new_story_id: input.storyId'),
)
const premiumCloneAst = sourceFile('lib/api/premium-clone.server.ts')
const premiumGenerationTargets: string[] = []
walk(premiumCloneAst, (node) => {
  if (!ts.isCallExpression(node)) return
  if (terminalCallName(node) !== 'generateNextPersonalizedChapter') return
  const arg = node.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    premiumGenerationTargets.push('non-object-arg')
    return
  }
  for (const property of arg.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    if (!ts.isIdentifier(property.name) || property.name.text !== 'storyId') continue
    premiumGenerationTargets.push(property.initializer.getText(premiumCloneAst).replace(/\s+/g, ''))
  }
})
const forbiddenPremiumTargets = premiumGenerationTargets.filter(
  (target) => target !== 'reserved.row.story_id',
)
check(
  'premium chapter generation targets reserved instance, never template',
  premiumGenerationTargets.length > 0 && forbiddenPremiumTargets.length === 0,
  premiumGenerationTargets.join(', '),
)

const requiredMigrations = [
  'supabase/migrations/20260713000000_personalized_story_engine.sql',
  'supabase/migrations/20260713010000_publish_chapter_v2.sql',
  'supabase/migrations/20260713020000_bootstrap_personalized_story.sql',
  'supabase/migrations/20260713030000_apply_personalized_choice.sql',
  'supabase/migrations/20260713050000_clone_premium_story_instance.sql',
  'supabase/migrations/20260713060000_persist_ending_lock.sql',
  'supabase/migrations/20260713070000_harden_premium_story_clone.sql',
] as const
const missingMigrations = requiredMigrations.filter((relativePath) => !existsSync(join(root, relativePath)))
check(
  'required personalized migrations exist (offline; no DB execution)',
  missingMigrations.length === 0,
  missingMigrations.join(', '),
)

const packageJson = JSON.parse(source('package.json')) as { scripts?: Record<string, string> }
const scripts = packageJson.scripts ?? {}
const smokeCommand = 'node scripts/run-smoke.cjs scripts/personalized-story-smoke.ts'
check('package exposes smoke:personalized-story command', scripts['smoke:personalized-story'] === smokeCommand)
check(
  'aggregate smoke appends personalized story gate after existing commands',
  scripts.smoke?.endsWith('&& pnpm run smoke:personalized-story') === true,
)
check(
  'personalized DB command keeps premium clone SQL coverage',
  scripts['test:db:personalized']?.includes('supabase/tests/premium_story_clone_test.sql') === true,
)

console.log(`\npersonalized-story-smoke: ${passed}/${passed + failed} PASS`)
if (failed > 0) process.exit(1)

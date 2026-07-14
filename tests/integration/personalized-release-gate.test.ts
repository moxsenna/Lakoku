import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import pkg from '@/package.json'

const root = process.cwd()

// ---------------------------------------------------------------------------
// ScriptKind resolver
// ---------------------------------------------------------------------------

function scriptKindFromFileName(fileName: string): ts.ScriptKind {
  const ext = path.extname(fileName).toLowerCase()
  switch (ext) {
    case '.ts':
    case '.mts':
    case '.cts':
      return ts.ScriptKind.TS
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS
    case '.jsx':
      return ts.ScriptKind.JSX
    default:
      return ts.ScriptKind.TS
  }
}

// ---------------------------------------------------------------------------
// AST-based wildcard `.select('*')` detector
// ---------------------------------------------------------------------------

function wildcardSelectLines(source: string, fileName: string): number[] {
  const kind = scriptKindFromFileName(fileName)
  const sourceFile = ts.createSourceFile(
    path.basename(fileName),
    source,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    kind,
  )

  const results = new Set<number>()

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const prop = node.expression
      if (ts.isPropertyAccessExpression(prop) && prop.name.text === 'select') {
        const arg = node.arguments[0]
        if (arg) {
          let unwrapped = arg
          // unwrap: AsExpression, ParenthesizedExpression, TypeAssertionExpression, SatisfiesExpression
          for (let safety = 0; safety < 10; safety++) {
            if (
              ts.isAsExpression(unwrapped)
            ) {
              unwrapped = unwrapped.expression
            } else if (
              ts.isParenthesizedExpression(unwrapped)
            ) {
              unwrapped = unwrapped.expression
            } else if (
              ts.isTypeAssertionExpression(unwrapped)
            ) {
              unwrapped = unwrapped.expression
            } else if (
              ts.isSatisfiesExpression(unwrapped)
            ) {
              unwrapped = unwrapped.expression
            } else {
              break
            }
          }
          if (
            (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) &&
            unwrapped.text === '*'
          ) {
            const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            results.add(pos.line + 1)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...results].sort((a, b) => a - b)
}

/**
 * Test helper: scan a source snippet with an explicit file name
 * to control ScriptKind.
 */
function wildcardLinesInSnippet(snippet: string, fileName = 'scan.ts'): number[] {
  return wildcardSelectLines(snippet, fileName)
}

// ---------------------------------------------------------------------------
// File-system helpers
// ---------------------------------------------------------------------------

function sourceFiles(target: string): string[] {
  const absoluteTarget = path.join(root, target)
  const stat = fs.statSync(absoluteTarget)
  if (stat.isFile()) return [absoluteTarget]
  return fs.readdirSync(absoluteTarget, { withFileTypes: true }).flatMap((entry) => {
    const childTarget = path.join(target, entry.name)
    if (entry.isDirectory()) return sourceFiles(childTarget)
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path.join(root, childTarget)] : []
  })
}

function task28WildcardSelects(): string[] {
  const targets = ['lib/api', 'app/api/stories', 'packages/contracts/src/reader.ts']
  return targets.flatMap(sourceFiles).flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8')
    const lines = wildcardSelectLines(source, file)
    return lines.map(
      (line) => `${path.relative(root, file).split(path.sep).join('/')}:${line}`,
    )
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('personalized database release gate', () => {
  it('provides explicit local-only REST/Auth plus pgTAP command', () => {
    expect(pkg.scripts['test:db:publish-v2-race']).toBe(
      'node scripts/run-smoke.cjs scripts/publish-chapter-v2-race.ts',
    )
    expect(pkg.scripts['test:db:personalized']).toBe(
      'node scripts/run-smoke.cjs scripts/personalized-db-rest-integration.ts && supabase test db --local supabase/tests/personalized_story_schema_test.sql supabase/tests/personalized_story_rls_test.sql supabase/tests/publish_chapter_v2_test.sql supabase/tests/authoring_story_claim_test.sql supabase/tests/authoring_story_bible_replace_test.sql && pnpm run test:db:authoring-race-cleanup && node scripts/run-smoke.cjs scripts/authoring-story-claim-race.ts && node scripts/run-smoke.cjs scripts/authoring-story-bible-race.ts && pnpm run test:db:publish-v2-race',
    )
    expect(pkg.scripts['release:personalized']).toBe(
      'pnpm run typecheck && pnpm run test:unit && pnpm run test:db:personalized',
    )
    expect(pkg.scripts['test:db:personalized']).toContain('publish_chapter_v2_test.sql')
    expect(pkg.scripts['test:db:personalized']).toContain('authoring_story_claim_test.sql')
    expect(pkg.scripts['test:db:personalized']).toContain('test:db:authoring-race-cleanup')
    expect(pkg.scripts['test:db:personalized']).toContain('authoring-story-claim-race.ts')
    expect(pkg.scripts['test:db:personalized']).toContain('authoring_story_bible_replace_test.sql')
    expect(pkg.scripts['test:db:personalized']).toContain('authoring-story-bible-race.ts')
    expect(pkg.scripts['test:db:personalized']).toContain('test:db:publish-v2-race')
    expect(pkg.scripts['test:unit']).not.toContain('test:db:personalized')
  })

  it('rejects exact wildcard select calls in Task 28 production targets', () => {
    // Gate: no wildcard selects in production targets
    expect(task28WildcardSelects()).toEqual([])

    // ------- positives: AST correctly detects real wildcard calls -------

    // single-quoted (.ts)
    expect(wildcardLinesInSnippet(
      "query.select('*')",
    )).toEqual([1])

    // double-quoted (.ts)
    expect(wildcardLinesInSnippet(
      'query.select("*")',
    )).toEqual([1])

    // backtick-quoted (.ts)
    expect(wildcardLinesInSnippet(
      'query.select(`*`)',
    )).toEqual([1])

    // backtick with `as const` (.ts)
    expect(wildcardLinesInSnippet(
      'query.select(`*` as const)',
    )).toEqual([1])

    // parenthesized arg (.ts)
    expect(wildcardLinesInSnippet(
      'query.select((`*`))',
    )).toEqual([1])

    // angle-bracket type assertion (.ts) -- only valid in TS not TSX
    expect(wildcardLinesInSnippet(
      "query.select(<string>'*')",
      'scan.ts',
    )).toEqual([1])

    // satisfies expression (.ts)
    expect(wildcardLinesInSnippet(
      "query.select('*' satisfies string)",
      'scan.ts',
    )).toEqual([1])

    // after a URL containing "//" - AST not fooled by // in string
    expect(wildcardLinesInSnippet(
      "const url = 'https://example.com/path'; query.select('*')",
    )).toEqual([1])

    // after string containing "/*..." - AST not fooled by string contents
    expect(wildcardLinesInSnippet(
      "const hint = '/* block comment */'; query.select('*')",
    )).toEqual([1])

    // after a /* block comment */ - AST ignores comments natively
    expect(wildcardLinesInSnippet(
      '/* multi\n   line comment */ query.select(`*` as const)',
    )).toEqual([2])

    // TSX file (.tsx) still works correctly
    expect(wildcardLinesInSnippet(
      "query.select('*')",
      'component.tsx',
    )).toEqual([1])

    // ------- negatives: string/template data NOT detected -------

    // string literal containing query.select('*') text
    expect(wildcardLinesInSnippet(
      "const msg = \"query.select('*')\"",
    )).toEqual([])

    // template literal containing query.select('*') text
    expect(wildcardLinesInSnippet(
      'const msg = `query.select(\'*\')`',
    )).toEqual([])

    // explicit columns, no wildcard
    expect(wildcardLinesInSnippet(
      "query.select('id,title')",
    )).toEqual([])

    // compound, contains * but not lone
    expect(wildcardLinesInSnippet(
      "query.select('id,*')",
    )).toEqual([])

    // wildcard with options object (second arg) -- still a wildcard
    expect(wildcardLinesInSnippet(
      "query.select('*', { count: 'exact' })",
    )).toEqual([1])

    // wildcard with options and as const
    expect(wildcardLinesInSnippet(
      'query.select(`*` as const, { head: true })',
    )).toEqual([1])

    // explicit projection with options -- still not a wildcard
    expect(wildcardLinesInSnippet(
      "query.select('id,title', { count: 'exact' })",
    )).toEqual([])

    // select with no arguments
    expect(wildcardLinesInSnippet(
      'query.select()',
    )).toEqual([])
  })
})

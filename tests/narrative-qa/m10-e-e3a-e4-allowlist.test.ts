import { describe, expect, it } from 'vitest'
import {
  M10_E_E3A_E4_ALLOWLIST,
  M10_E_E3A_E4_BASE_SHA,
  M10_E_E3A_E4_REQUIRED_CHANGES,
  M10_E_PROTECTED_PATH_PREFIXES,
  auditM10EE3AE4Allowlist,
  type M10EE3AE4GitCommand,
} from '../../scripts/m10-e-e3a-e4-allowlist'

function gitCommand(script: (args: readonly string[]) => string): M10EE3AE4GitCommand {
  const calls: string[][] = []
  const command: M10EE3AE4GitCommand = (args) => {
    calls.push([...args])
    return script(args)
  }
  ;(command as M10EE3AE4GitCommand & { calls: string[][] }).calls = calls
  return command
}

function fakeGitScript(changes: Readonly<Readonly<{ status: string; path: string }>[]>): (args: readonly string[]) => string {
  return (args) => {
    const [verb] = args
    if (verb === 'cat-file') return ''
    if (verb === 'merge-base') return ''
    if (verb === 'diff') return changes.map((change) => `${change.status}\t${change.path}`).join('\n') + (changes.length > 0 ? '\n' : '')
    throw new Error(`unexpected git args ${args.join(' ')}`)
  }
}

const MOCKED_CHANGES: Readonly<Readonly<{ status: string; path: string }>[]> = Object.freeze(
  M10_E_E3A_E4_ALLOWLIST.map((path, index) => Object.freeze({ status: index === 0 ? 'M' : 'M', path })),
)

describe('M10-E E3A/E4 allowlist auditor', () => {
  it('accepts a diff that matches every P1-P11 allowlist path', () => {
    const command = gitCommand(fakeGitScript(MOCKED_CHANGES))
    const result = auditM10EE3AE4Allowlist('base', 'head', command)
    expect(result.failures).toEqual([])
    expect(result.changedPaths).toEqual([...M10_E_E3A_E4_ALLOWLIST])
    expect((command as M10EE3AE4GitCommand & { calls: string[][] }).calls.every((args) => args[0] !== undefined)).toBe(true)
  })

  it('rejects an unlisted path, protected paths, deletions, and renames', () => {
    const changes = [
      { status: 'M', path: 'lib/unlisted/mystery.ts' },
      { status: 'M', path: 'lib/narrative-qa/fault/mutated.ts' },
      { status: 'M', path: 'lib/ai-gateway/provider.ts' },
      { status: 'D', path: 'lib/narrative-qa/reliability/deleted.ts' },
      { status: 'R100', path: 'lib/narrative-qa/reliability/renamed.ts' },
    ]
    const result = auditM10EE3AE4Allowlist('base', 'head', gitCommand(fakeGitScript(changes)))
    expect(result.failures.filter((failure) => failure.startsWith('ALLOWLIST_UNLISTED_PATH'))).toHaveLength(1)
    expect(result.failures.filter((failure) => failure.startsWith('ALLOWLIST_PROTECTED_PATH'))).toHaveLength(2)
    expect(result.failures.some((failure) => failure.startsWith('ALLOWLIST_DELETED_OR_RENAMED_PATH') && failure.includes(' D '))).toBe(true)
    expect(result.failures.some((failure) => failure.startsWith('ALLOWLIST_DELETED_OR_RENAMED_PATH') && failure.includes(' R100 '))).toBe(true)
  })

  it('rejects a wrong or non-ancestor base', () => {
    const command = gitCommand((args) => {
      const [verb] = args
      if (verb === 'cat-file') throw new Error('no such commit')
      if (verb === 'merge-base') return ''
      throw new Error(`unexpected git args ${args.join(' ')}`)
    })
    const result = auditM10EE3AE4Allowlist('unknown', 'head', command)
    expect(result.failures.some((failure) => failure.startsWith('ALLOWLIST_BASE_NOT_RESOLVED'))).toBe(true)

    const notAncestor = gitCommand((args) => {
      const [verb] = args
      if (verb === 'cat-file') return ''
      if (verb === 'merge-base') throw new Error('not an ancestor')
      throw new Error(`unexpected git args ${args.join(' ')}`)
    })
    const result2 = auditM10EE3AE4Allowlist('base', 'head', notAncestor)
    expect(result2.failures.some((failure) => failure.startsWith('ALLOWLIST_BASE_NOT_ANCESTOR'))).toBe(true)
  })

  it('requires the package.json scripts and the cost report tracked changes', () => {
    const changes = MOCKED_CHANGES.filter((change) => change.path !== 'package.json' && change.path !== 'docs/qa/m10/M10_E_RELIABILITY_COST_REPORT.md')
    const result = auditM10EE3AE4Allowlist('base', 'head', gitCommand(fakeGitScript(changes)))
    expect(result.failures.some((failure) => failure.includes('ALLOWLIST_OMITTED_REQUIRED_CHANGE: package.json'))).toBe(true)
    expect(result.failures.some((failure) => failure.includes('ALLOWLIST_OMITTED_REQUIRED_CHANGE: docs/qa/m10/M10_E_RELIABILITY_COST_REPORT.md'))).toBe(true)
  })

  it('protects every declared protected path class from entering the allowlist', () => {
    for (const prefix of M10_E_PROTECTED_PATH_PREFIXES) {
      expect(M10_E_E3A_E4_ALLOWLIST.some((path) => path.startsWith(prefix))).toBe(false)
    }
  })
})

describe('M10-E E3A/E4 allowlist real-git audit of base..HEAD', () => {
  it('audits the actual implementation diff with the exact plan base and HEAD', () => {
    const result = auditM10EE3AE4Allowlist(M10_E_E3A_E4_BASE_SHA, 'HEAD')
    expect(result.failures).toEqual([])
    for (const required of M10_E_E3A_E4_REQUIRED_CHANGES) {
      expect(result.changedPaths).toContain(required)
    }
  }, 300_000)
})
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_DECLARED_APPLICABLE_CELL_COUNT,
  buildReliabilityObservationFixture,
} from '../../fixtures/m10-e/reliability-contract-fixture'

const ROOT = resolve(process.cwd())

function listLibFiles(): string[] {
  const { readdirSync } = require('node:fs') as typeof import('node:fs')
  const files: string[] = []
  const pending = [join(ROOT, 'lib', 'narrative-qa', 'reliability')]
  while (pending.length > 0) {
    const current = pending.pop()!
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) pending.push(full)
      else if (entry.name.endsWith('.ts')) files.push(full)
    }
  }
  return files
}

const RUNNER_SCRIPTS = [
  'scripts/m10-e-e3a-e4.ts',
  'scripts/m10-e-e3a-e4-cli.ts',
  'scripts/m10-e-e3a-e4-compare.ts',
  'scripts/m10-e-e3a-e4-compare-cli.ts',
  'scripts/m10-e-e3a-e4-allowlist.ts',
  'scripts/m10-e-e3a-e4-allowlist-cli.ts',
]

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('M10-E E3A/E4 security regression', () => {
  it('keeps the reliability libraries free of network, provider, mutation, and secret patterns', () => {
    const patterns: ReadonlyArray<{ label: string; regex: RegExp }> = [
      { label: 'network action', regex: /\bfetch\s*\(|new\s+WebSocket\s*\(|https?:\/\// },
      { label: 'provider call', regex: /\bcreateClient\s*\(|openai|anthropic|gemini|providerCalls?\.?call/i },
      { label: 'database mutation', regex: /\b(?:insert|update|delete)\s*\(.*(?:from|into)\b|\bdb\s*\.\s*(?:insert|update|delete|\$executeRaw)/i },
      { label: 'secret access', regex: /process\.env|API_KEY|SERVICE_ROLE|SUPABASE_URL/ },
    ]
    for (const file of listLibFiles()) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const { label, regex } of patterns) {
        const suspect = regex.test(source)
        expect(suspect, `${file} contains ${label} pattern`).toBe(false)
      }
    }
  })

  it('keeps the E3A/E4 runner scripts free of provider, database, and secret consumption', () => {
    const source = RUNNER_SCRIPTS.map((path) => stripComments(readFileSync(join(ROOT, path), 'utf8'))).join('\n')
    const forbidden = [
      { label: 'provider call', regex: /\bcreateClient\s*\(|openai|anthropic/i },
      { label: 'database mutation', regex: /\b(?:insert|update|delete)\s*\(.*\bfrom\b|\bdb\s*\.\s*(?:insert|update|delete)/i },
      { label: 'environment secret consumption', regex: /process\.env\.(?:SUPABASE|SERVICE_ROLE|OPENAI|ANTHROPIC|GEMINI)/ },
      { label: 'network client', regex: /\bfetch\s*\(|new\s+WebSocket\s*\(/ },
    ]
    for (const { label, regex } of forbidden) {
      expect(regex.test(source), `runner scripts must not contain ${label}`).toBe(false)
    }
  })

  it('keeps the contract fixture free of the RELEASE_EVIDENCE token and fault-frequency leakage', () => {
    const fixture = readFileSync(join(ROOT, 'fixtures/m10-e/reliability-contract-fixture.ts'), 'utf8')
    const report = readFileSync(join(ROOT, 'lib/narrative-qa/reliability/report.ts'), 'utf8')
    expect(fixture).not.toContain('RELEASE_EVIDENCE')
    expect(fixture).not.toContain('E1_FAULT_INJECTION_FREQUENCY')
    expect(fixture).not.toContain('E2_FAULT_INJECTION_FREQUENCY')
    // Only the report's prohibited-claims guard prose may name the token.
    expect(report).toContain('RELEASE_EVIDENCE')
  })

  it('binds the closure manifest restriction that fault schedule frequencies never enter observations or model inputs', () => {
    const authority = JSON.parse(readFileSync(join(ROOT, 'fixtures/m10-e/e1-e2-closure-authority.json'), 'utf8')) as {
      faultFrequencyProhibition?: unknown
      replacementSemantics?: unknown
    }
    expect(typeof authority.faultFrequencyProhibition).toBe('string')
    expect(String(authority.faultFrequencyProhibition)).toContain('E1_FAULT_INJECTION_FREQUENCY')
    expect(String(authority.faultFrequencyProhibition)).toContain('E2_FAULT_INJECTION_FREQUENCY')
    expect(typeof authority.replacementSemantics).toBe('string')
    expect(String(authority.replacementSemantics)).toContain('FAIL and STOP')
    const observations = buildReliabilityObservationFixture()
    // The prohibition is enforced by declaring both fault-frequency classes as
    // excluded observation sources; no frequency value may appear anywhere.
    expect(observations.observationSourceAuthority.excludedSources).toEqual(['E1_FAULT_INJECTION_FREQUENCY', 'E2_FAULT_INJECTION_FREQUENCY'])
    const serialized = JSON.stringify(observations)
    expect(serialized).not.toContain('"faultFrequency"')
    expect(serialized).not.toContain('"injectionFrequency"')
    expect(observations.declaredApplicableCells.length).toBe(FIXTURE_DECLARED_APPLICABLE_CELL_COUNT)
  })
})
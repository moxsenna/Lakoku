/**
 * Allowlist auditor for the M10-E E3A/E4 implementation.
 *
 * Computes the Git diff from the exact plan base
 * 143a01a0b0b2f0848ade235fd6bdc3dc3588f01d to the implementation HEAD and
 * requires every changed path to match the explicit P1–P11 create/modify
 * allowlist plus this plan file's reviewer-authorized plan-only amendment
 * commit. It rejects deletions/renames and any protected path class,
 * verifies the base resolves and is an ancestor of HEAD, and requires the
 * generated tracked changes (package.json scripts and the cost report) to be
 * present in the diff.
 */

import { execFileSync } from 'node:child_process'

export const M10_E_E3A_E4_BASE_SHA = '143a01a0b0b2f0848ade235fd6bdc3dc3588f01d'

export const M10_E_E3A_E4_ALLOWLIST: readonly string[] = Object.freeze([
  // Plan file (reviewer-authorized plan-only amendment commit).
  'docs/superpowers/plans/2026-08-15-m10-e-e3a-e4-implementation-plan.md',
  // P1-P3 contracts, decimals, authorities, topology.
  'lib/narrative-qa/reliability/contracts.ts',
  'lib/narrative-qa/reliability/decimal.ts',
  'lib/narrative-qa/reliability/authorities.ts',
  'lib/narrative-qa/reliability/topology.ts',
  'lib/narrative-qa/reliability/index.ts',
  // P4-P5 measurements, aggregation, pricing, cost distributions.
  'lib/narrative-qa/reliability/measurements.ts',
  'lib/narrative-qa/reliability/aggregation.ts',
  'lib/narrative-qa/reliability/pricing.ts',
  'lib/narrative-qa/reliability/cost-distributions.ts',
  // P6-P7 model and gates.
  'lib/narrative-qa/reliability/seeded-rng.ts',
  'lib/narrative-qa/reliability/cumulative-model.ts',
  'lib/narrative-qa/reliability/budget-policy.ts',
  'lib/narrative-qa/reliability/gate.ts',
  // P8 normalization, artifacts, report.
  'lib/narrative-qa/reliability/normalization.ts',
  'lib/narrative-qa/reliability/artifacts.ts',
  'lib/narrative-qa/reliability/report.ts',
  // P9 server-only telemetry boundary.
  'lib/narrative-qa/reliability/server.ts',
  'lib/narrative-qa/reliability/server/telemetry-adapter.server.ts',
  // P1-P9 tests (m10-e-reliability-artifact-fixture.ts is the shared P8 test-support helper).
  'tests/narrative-qa/m10-e-reliability-contracts.test.ts',
  'tests/narrative-qa/m10-e-reliability-types.test.ts',
  'tests/narrative-qa/m10-e-reliability-decimal.test.ts',
  'tests/narrative-qa/m10-e-reliability-authorities.test.ts',
  'tests/narrative-qa/m10-e-reliability-topology.test.ts',
  'tests/narrative-qa/m10-e-reliability-measurements.test.ts',
  'tests/narrative-qa/m10-e-reliability-aggregation.test.ts',
  'tests/narrative-qa/m10-e-reliability-profile-thresholds.test.ts',
  'tests/narrative-qa/m10-e-reliability-pricing.test.ts',
  'tests/narrative-qa/m10-e-reliability-cost-distributions.test.ts',
  'tests/narrative-qa/m10-e-reliability-seeded-rng.test.ts',
  'tests/narrative-qa/m10-e-reliability-model.test.ts',
  'tests/narrative-qa/m10-e-reliability-model-determinism.test.ts',
  'tests/narrative-qa/m10-e-reliability-budget.test.ts',
  'tests/narrative-qa/m10-e-reliability-gate.test.ts',
  'tests/narrative-qa/m10-e-reliability-normalization.test.ts',
  'tests/narrative-qa/m10-e-reliability-artifacts.test.ts',
  'tests/narrative-qa/m10-e-reliability-report.test.ts',
  'tests/narrative-qa/m10-e-reliability-telemetry-adapter.test.ts',
  'tests/narrative-qa/m10-e-reliability-artifact-fixture.ts',
  // P10 fixture and fixture regressions.
  'fixtures/m10-e/reliability-contract-fixture.ts',
  'fixtures/m10-e/pricing-snapshot.json',
  'fixtures/m10-e/model-authorities.json',
  'fixtures/m10-e/judge-plan.json',
  'fixtures/m10-e/e1-e2-closure-authority.json',
  'tests/narrative-qa/m10-e-reliability-fixture.test.ts',
  'tests/narrative-qa/m10-e-e1-e2-closure-regression.test.ts',
  // P11 orchestration, comparison, allowlist, security regression.
  'scripts/m10-e-e3a-e4.ts',
  'scripts/m10-e-e3a-e4-cli.ts',
  'scripts/m10-e-e3a-e4-compare.ts',
  'scripts/m10-e-e3a-e4-compare-cli.ts',
  'scripts/m10-e-e3a-e4-allowlist.ts',
  'scripts/m10-e-e3a-e4-allowlist-cli.ts',
  'tests/narrative-qa/m10-e-e3a-e4-runner.test.ts',
  'tests/narrative-qa/m10-e-e3a-e4-counted-comparison.test.ts',
  'tests/narrative-qa/m10-e-e3a-e4-allowlist.test.ts',
  'tests/narrative-qa/m10-e-reliability-security-regression.test.ts',
  // P11 modified tracked deliverables.
  'package.json',
  'docs/qa/m10/M10_E_RELIABILITY_COST_REPORT.md',
])

/** Generated tracked changes that must appear in the implementation diff. */
export const M10_E_E3A_E4_REQUIRED_CHANGES: readonly string[] = Object.freeze([
  'package.json',
  'docs/qa/m10/M10_E_RELIABILITY_COST_REPORT.md',
])

/** Protected path classes that can never enter the implementation diff. */
export const M10_E_PROTECTED_PATH_PREFIXES: readonly string[] = Object.freeze([
  'lib/narrative-qa/fault/',
  'lib/ai-gateway/',
  'lib/runtime/',
  'supabase/',
])

export type M10EE3AE4GitCommand = (args: readonly string[]) => string

export interface M10EE3AE4AllowlistResult {
  readonly failures: readonly string[]
  readonly changedPaths: readonly string[]
}

export function auditM10EE3AE4Allowlist(
  base: string,
  head: string,
  execute: M10EE3AE4GitCommand = (args) => execFileSync('git', [...args], {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }),
): M10EE3AE4AllowlistResult {
  const failures: string[] = []
  try {
    execute(['cat-file', '-e', `${base}^{commit}`])
  } catch {
    failures.push(`ALLOWLIST_BASE_NOT_RESOLVED: ${base} does not resolve as a commit`)
  }
  try {
    execute(['merge-base', '--is-ancestor', base, head])
  } catch {
    failures.push(`ALLOWLIST_BASE_NOT_ANCESTOR: ${base} is not an ancestor of ${head}`)
  }
  const allowed = new Set(M10_E_E3A_E4_ALLOWLIST)
  const changedPaths: string[] = []
  let diffOutput = ''
  try {
    diffOutput = execute(['diff', '--name-status', base, head])
  } catch (error) {
    failures.push(`ALLOWLIST_DIFF_FAILED: ${error instanceof Error ? error.message : String(error)}`)
    return { failures, changedPaths }
  }
  for (const line of diffOutput.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const parts = line.split('\t')
    const status = parts[0] ?? ''
    const path = parts[parts.length - 1] ?? ''
    if (path.length === 0) {
      failures.push('ALLOWLIST_DIFF_MALFORMED: empty path in diff output')
      continue
    }
    changedPaths.push(path)
    if (status.startsWith('D') || status.startsWith('R')) {
      failures.push(`ALLOWLIST_DELETED_OR_RENAMED_PATH: ${status} ${path}`)
      continue
    }
    if (!allowed.has(path)) {
      const protectedPrefix = M10_E_PROTECTED_PATH_PREFIXES.find((prefix) => path.startsWith(prefix))
      failures.push(protectedPrefix !== undefined
        ? `ALLOWLIST_PROTECTED_PATH: ${path} lies under ${protectedPrefix}`
        : `ALLOWLIST_UNLISTED_PATH: ${path}`)
    }
  }
  const changedSet = new Set(changedPaths)
  for (const required of M10_E_E3A_E4_REQUIRED_CHANGES) {
    if (!changedSet.has(required)) failures.push(`ALLOWLIST_OMITTED_REQUIRED_CHANGE: ${required} missing from the implementation diff`)
  }
  return { failures, changedPaths }
}

export async function runM10EE3AE4AllowlistCli(base: string | undefined, head: string | undefined): Promise<number> {
  const baseSha = base ?? M10_E_E3A_E4_BASE_SHA
  const headSha = head ?? 'HEAD'
  const result = auditM10EE3AE4Allowlist(baseSha, headSha)
  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`ALLOWLIST_FAIL ${failure}`)
    return 1
  }
  console.log(`M10-E E3A/E4 allowlist audit PASS: ${result.changedPaths.length} changed path(s) from base ${baseSha} to ${headSha} all match the P1-P11 allowlist.`)
  return 0
}
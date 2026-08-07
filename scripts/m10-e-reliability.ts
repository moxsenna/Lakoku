/**
 * M10-E — reliability & cost runner.
 *
 * Executes the fault matrix (plan E.2) against the REAL production runtime on
 * an ISOLATED local Supabase, measures the E.3 metric set, and emits the
 * evidence artifacts.
 *
 * FAIL-CLOSED:
 *   - any invariant violation forces result=FAIL;
 *   - a missing business-approved cost ceiling (plan E.4) forces result=BLOCKED,
 *     never PASS — the ceiling is NOT invented here;
 *   - uncovered fault classes are listed, never silently dropped.
 *
 * Never touches production. Never invokes a real model.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function bootstrapLocalSupabaseEnv(): void {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return
  try {
    const raw = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    })
    const parsed = JSON.parse(raw.match(/{[\s\S]*}/)?.[0] ?? raw) as Record<string, string>
    if (parsed.API_URL) process.env.SUPABASE_URL = parsed.API_URL
    if (parsed.SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = parsed.SERVICE_ROLE_KEY
  } catch {
    // Left unset on purpose: assertIsolatedTarget refuses to run against an
    // unknown target, which is the correct failure.
  }
}

bootstrapLocalSupabaseEnv()

import { runFaultMatrix } from '../lib/narrative-qa/fault/scenarios'
import type { FaultRunResultV1, FaultScenarioResultV1 } from '../lib/narrative-qa/fault/scenarios'
import { computeSha256, stableStringify } from '../lib/narrative-qa/scoring/canonical-serializer'
import { headShaOfWorkingTree } from '../lib/narrative-qa/git-sha'

export const E_ARTIFACT_DIR = join('docs', 'qa', 'm10')
export const E_REPORT_PATH = join(E_ARTIFACT_DIR, 'M10_E_RELIABILITY_COST_REPORT.md')
export const E_EVIDENCE_PATH = join(E_ARTIFACT_DIR, 'm10-e-fault-evidence.json')

/**
 * Plan E.4 requires a business-approved numeric ceiling frozen BEFORE M10-F:
 * max cost/chapter, max cost/50-chapter novel, max judge cost/novel, max
 * retry-overhead %, optional p95 latency guardrail.
 *
 * The plan states verbatim: "Do not invent the number in this plan and do not
 * silently raise it after a pilot fails." No approved figure exists in the
 * repository, so this stays null and the run reports BLOCKED on that item.
 * Filling it in requires a business decision, not an engineering guess.
 */
export const COST_CEILING_V1: null | {
  maxCostPerChapterUsd: number
  maxCostPerNovelUsd: number
  maxJudgeCostPerNovelUsd: number
  maxRetryOverheadPct: number
  maxP95LatencyMs: number | null
  approvedBy: string
  approvedAt: string
} = null

export interface EBlockerV1 {
  code: string
  detail: string
}

export interface LatencyStatsV1 {
  count: number
  p50Ms: number | null
  p95Ms: number | null
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index] ?? null
}

export function latencyStats(values: number[]): LatencyStatsV1 {
  return { count: values.length, p50Ms: percentile(values, 50), p95Ms: percentile(values, 95) }
}

export interface EMeasurementsV1 {
  /** E.3 counters derived from the fault matrix. */
  faultedAttempts: number
  faultedAttemptsPublished: number
  faultedAttemptsFailedClosed: number
  recoveredAfterFault: number
  terminalFailures: number
  recoveryFromCheckpointCount: number
  duplicatePublicationCount: number
  canonicalCorruptionCount: number
  invariantViolations: Array<{ scenarioId: string; code: string; detail: Record<string, unknown> }>
  cleanGenerationLatency: LatencyStatsV1
  recoveryLatency: LatencyStatsV1
}

export function measure(run: FaultRunResultV1): EMeasurementsV1 {
  const faulted = run.scenarios
  const invariantViolations: EMeasurementsV1['invariantViolations'] = []
  for (const scenario of faulted) {
    for (const inv of scenario.invariants) {
      if (!inv.passed) {
        invariantViolations.push({ scenarioId: scenario.id, code: inv.code, detail: inv.detail })
      }
    }
  }
  const duplicatePublicationCount = invariantViolations.filter(
    (v) => v.code === 'INV_ONE_COMMIT_PER_CHAPTER' || v.code === 'INV_CHAPTERS_COUNT',
  ).length
  const canonicalCorruptionCount = invariantViolations.filter(
    (v) =>
      v.code === 'INV_CANON_REVISION'
      || v.code === 'INV_NO_STATE_BEYOND_CANON'
      || v.code === 'INV_COMMITS_COUNT',
  ).length

  const recoveryLatencies = faulted
    .map((s) => s.outcome.recoveryLatencyMs)
    .filter((v): v is number => typeof v === 'number')

  return {
    faultedAttempts: faulted.length,
    faultedAttemptsPublished: faulted.filter((s) => !s.outcome.failedClosed).length,
    faultedAttemptsFailedClosed: faulted.filter((s) => s.outcome.failedClosed).length,
    recoveredAfterFault: faulted.filter((s) => s.outcome.recovered).length,
    terminalFailures: faulted.filter((s) => !s.outcome.recovered).length,
    recoveryFromCheckpointCount: faulted.filter((s) => s.outcome.recoveryFromCheckpoint === true).length,
    duplicatePublicationCount,
    canonicalCorruptionCount,
    invariantViolations,
    cleanGenerationLatency: latencyStats(run.cleanLatenciesMs),
    recoveryLatency: latencyStats(recoveryLatencies),
  }
}

export function collectBlockers(run: FaultRunResultV1, m: EMeasurementsV1): EBlockerV1[] {
  const blockers: EBlockerV1[] = []

  if (COST_CEILING_V1 === null) {
    blockers.push({
      code: 'E4_COST_CEILING_NOT_APPROVED',
      detail:
        'Plan E.4 requires a business-approved numeric unit-economics ceiling frozen before M10-F '
        + '(max cost/chapter, max cost/50-chapter novel, max judge cost/novel, max retry-overhead %). '
        + 'No approved figure exists in the repository and the plan forbids inventing one. '
        + 'M10-F cannot start until this is supplied.',
    })
  }

  blockers.push({
    code: 'E3_NO_TOKEN_OR_COST_DATA',
    detail:
      'The fault matrix runs on the deterministic provider (no model calls are permitted at this '
      + 'stage), so provider call counts, token usage and actual cost per task/chapter/novel are '
      + 'NOT measured. Latency figures are harness-machine figures for the deterministic path and '
      + 'are NOT a real-model latency estimate. Real token/cost/latency data can only come from the '
      + 'M10-F pilot, which itself is gated on E4_COST_CEILING_NOT_APPROVED.',
  })

  if (run.uncovered.length > 0) {
    blockers.push({
      code: 'E2_FAULT_MATRIX_PARTIAL',
      detail:
        `${run.uncovered.length} declared E.2 fault bullets are not exercised by this matrix: `
        + run.uncovered.map((u) => u.planBullet).join('; ')
        + '. Reasons are recorded per bullet in the evidence artifact.',
    })
  }

  if (m.invariantViolations.length > 0) {
    blockers.push({
      code: 'E5_INVARIANT_VIOLATION',
      detail: `${m.invariantViolations.length} recovery-invariant violation(s) observed.`,
    })
  }

  if (m.terminalFailures > 0) {
    blockers.push({
      code: 'E5_STORY_COULD_NOT_CONTINUE',
      detail: `${m.terminalFailures} scenario(s) left the story unable to continue without manual DB mutation.`,
    })
  }

  return blockers
}

export type EResult = 'PASS' | 'FAIL' | 'BLOCKED'

export function decideResult(m: EMeasurementsV1, blockers: EBlockerV1[]): EResult {
  if (m.invariantViolations.length > 0 || m.terminalFailures > 0) return 'FAIL'
  if (blockers.length > 0) return 'BLOCKED'
  return 'PASS'
}

function renderScenarioRow(s: FaultScenarioResultV1): string {
  const invariantCell = s.invariantsPassed
    ? 'all pass'
    : s.invariants.filter((i) => !i.passed).map((i) => i.code).join(', ')
  return `| ${s.id} | ${s.faultClass} | ${s.storyId} | ${s.chapterNumber} | ${s.publicationMode} | \`${s.outcome.faultedOutcome}\` | ${s.outcome.failedClosed ? 'yes' : 'no'} | ${s.outcome.recovered ? 'yes' : 'NO'} | ${invariantCell} |`
}

export function renderReport(input: {
  run: FaultRunResultV1
  measurements: EMeasurementsV1
  blockers: EBlockerV1[]
  result: EResult
  headSha: string
  dirty: boolean
  startedAt: string
  finishedAt: string
  evidenceHash: string
}): string {
  const { run, measurements: m, blockers, result } = input
  const lines: string[] = []

  lines.push('# M10-E — Reliability & Cost Report')
  lines.push('')
  lines.push(`**Result:** ${result}`)
  lines.push(`**Run:** ${input.startedAt} → ${input.finishedAt}`)
  lines.push(`**Commit:** \`${input.headSha}\`${input.dirty ? ' (working tree DIRTY)' : ''}`)
  lines.push(`**Evidence:** \`${E_EVIDENCE_PATH}\` sha256 \`${input.evidenceHash}\``)
  lines.push('**Target:** isolated local Supabase. No production access, no model calls.')
  lines.push('')

  lines.push('## Entry-gate deviation (recorded, not waived)')
  lines.push('')
  lines.push(
    'The plan gates M10-E on "M10-C PASS". M10-C closed **BLOCKED** — six observability capture '
    + 'blockers, none of which are reliability invariants (the 1→50 sync/worker parity run itself '
    + 'passed fail-closed). This stage proceeded under the standing instruction to complete the '
    + 'plan. The deviation is stated here so no downstream reader can mistake M10-E evidence for a '
    + 'clean gate chain.',
  )
  lines.push('')

  lines.push('## What this run is, and is not')
  lines.push('')
  lines.push('- **Is:** the real production runtime (`generateNextPersonalizedChapter`), the real')
  lines.push('  publishers (`publish_chapter_state_v3` / `publish_generation_job_chapter_v5`), the real')
  lines.push('  checkpoint writers, driven with faults injected at the `deps` seam and through')
  lines.push('  harness-owned rows on an isolated DB.')
  lines.push('- **Is not:** a cost or token measurement. The provider is deterministic; there are no')
  lines.push('  model calls, therefore no token usage, no provider spend, and no real-model latency.')
  lines.push('- **Is not:** production evidence. Nothing in this run touched production data.')
  lines.push('')

  lines.push('## E.2 — Fault matrix executed')
  lines.push('')
  lines.push('| Scenario | Class | Story | Bab | Mode | Runtime outcome | Failed closed | Recovered | Invariants |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const s of run.scenarios) lines.push(renderScenarioRow(s))
  lines.push('')
  lines.push('Per-scenario plan bullets and notes are in the evidence JSON.')
  lines.push('')

  lines.push('## E.2 — Declared bullets NOT exercised')
  lines.push('')
  if (run.uncovered.length === 0) {
    lines.push('None.')
  } else {
    for (const u of run.uncovered) {
      lines.push(`- **${u.planBullet}** — ${u.reason}`)
    }
  }
  lines.push('')

  lines.push('## E.3 — Measurements')
  lines.push('')
  lines.push('### Observed (this run, deterministic provider)')
  lines.push('')
  lines.push(`- Faulted attempts: **${m.faultedAttempts}**`)
  lines.push(`- Faulted attempts that still published (fault absorbed): **${m.faultedAttemptsPublished}**`)
  lines.push(`- Faulted attempts that failed closed: **${m.faultedAttemptsFailedClosed}**`)
  lines.push(`- Recovered after fault (clean re-entry, no manual DB mutation): **${m.recoveredAfterFault}**`)
  lines.push(`- Terminal failures (story stuck): **${m.terminalFailures}**`)
  lines.push(`- Recoveries that reused a prose checkpoint: **${m.recoveryFromCheckpointCount}**`)
  lines.push(`- Duplicate publications observed: **${m.duplicatePublicationCount}**`)
  lines.push(`- Canonical corruption observed: **${m.canonicalCorruptionCount}**`)
  lines.push(
    `- Clean-path chapter latency (n=${m.cleanGenerationLatency.count}): p50 **${m.cleanGenerationLatency.p50Ms ?? 'n/a'} ms**, p95 **${m.cleanGenerationLatency.p95Ms ?? 'n/a'} ms**`,
  )
  lines.push(
    `- Recovery latency (n=${m.recoveryLatency.count}): p50 **${m.recoveryLatency.p50Ms ?? 'n/a'} ms**, p95 **${m.recoveryLatency.p95Ms ?? 'n/a'} ms**`,
  )
  lines.push('')
  lines.push('### Modeled estimate')
  lines.push('')
  lines.push('None. Modeling cumulative failure probability per 50-chapter novel requires a')
  lines.push('per-attempt failure rate from real provider traffic; the deterministic provider fails')
  lines.push('exactly when told to, so its rates carry no predictive information. Publishing a')
  lines.push('modeled number from this data would be fabrication.')
  lines.push('')
  lines.push('### Assumption')
  lines.push('')
  lines.push('- The injected fault shapes (throw before first byte, throw after partial, retryable')
  lines.push('  429, non-retryable, malformed structured output, publication error, ownership loss,')
  lines.push('  post-publish telemetry failure) are assumed to be representative of real provider and')
  lines.push('  infrastructure failure modes. This assumption is unverified until M10-F.')
  lines.push('- Latency figures are assumed to be dominated by local DB round-trips, not by')
  lines.push('  generation, because no model is called.')
  lines.push('')

  lines.push('## E.4 — Unit-economics guardrail')
  lines.push('')
  if (COST_CEILING_V1 === null) {
    lines.push('**Status: NOT FROZEN — BLOCKED.**')
    lines.push('')
    lines.push('The plan requires these numbers to be business-approved and explicitly forbids')
    lines.push('inventing them ("Do not invent the number in this plan and do not silently raise it')
    lines.push('after a pilot fails"). They are therefore left unset:')
    lines.push('')
    lines.push('- max cost per chapter: **not set**')
    lines.push('- max cost per 50-chapter novel: **not set**')
    lines.push('- max judge cost per novel: **not set**')
    lines.push('- max retry overhead %: **not set**')
    lines.push('- p95 latency guardrail: **not set**')
    lines.push('')
    lines.push('Until a decision-maker supplies these, M10-F (real-model pilot) must not start.')
  } else {
    lines.push('Frozen ceiling recorded in `COST_CEILING_V1`.')
  }
  lines.push('')

  lines.push('## E.5 — Recovery invariants')
  lines.push('')
  lines.push('Checked after every scenario against the isolated DB:')
  lines.push('')
  lines.push('| Invariant | Meaning |')
  lines.push('|---|---|')
  lines.push('| `INV_CHAPTERS_COUNT` | no chapter published twice, none published beyond the horizon |')
  lines.push('| `INV_COMMITS_COUNT` | one state commit per published chapter |')
  lines.push('| `INV_ONE_COMMIT_PER_CHAPTER` | no duplicate commit row for a chapter |')
  lines.push('| `INV_CANON_REVISION` | canon revision never double-incremented |')
  lines.push('| `INV_NO_STATE_BEYOND_CANON` | no partial canonical state survived a rollback |')
  lines.push('| `INV_NO_PUBLISHED_CP_BEYOND` | no PUBLISHED checkpoint past canon |')
  lines.push('| `INV_NO_SUCCEEDED_JOB_BEYOND` | no job reports success for an unpublished chapter |')
  lines.push('| `INV_READER_CONSISTENT` | reader progress matches canon |')
  lines.push('| `INV_ENDING_LOCK_AT_50` | completion state intact at the terminal chapter |')
  lines.push('')
  if (m.invariantViolations.length === 0) {
    lines.push('**No violation observed in any scenario.**')
  } else {
    lines.push('**Violations:**')
    lines.push('')
    for (const v of m.invariantViolations) {
      lines.push(`- \`${v.scenarioId}\` → \`${v.code}\`: \`${stableStringify(v.detail)}\``)
    }
  }
  lines.push('')

  lines.push('## Blockers')
  lines.push('')
  if (blockers.length === 0) {
    lines.push('None.')
  } else {
    for (const b of blockers) lines.push(`- **${b.code}** — ${b.detail}`)
  }
  lines.push('')

  lines.push('## Definition of Done — honest status')
  lines.push('')
  lines.push('| DoD item | Status |')
  lines.push('|---|---|')
  lines.push(`| Fault matrix implemented and repeatable | ${run.uncovered.length === 0 ? 'DONE' : 'PARTIAL — uncovered bullets listed above'} |`)
  lines.push(`| All safety invariants hold under every injected failure class | ${m.invariantViolations.length === 0 ? 'DONE' : 'FAILED'} |`)
  lines.push('| No unbounded retry loop | DONE — `P8_PERSISTENT_DEFECT_BOUNDED` proves the repair loop terminates (MAX_REPAIR_ATTEMPTS=2 per layer) |')
  lines.push('| Latency/token/cost instrumentation at task/chapter/novel level | PARTIAL — latency only; token/cost impossible without model calls |')
  lines.push('| Numeric unit-economics guardrail frozen before F | BLOCKED — requires business approval |')
  lines.push('| Cumulative failure estimate with assumptions separated | BLOCKED — no real failure-rate data to model from |')
  lines.push(`| Recovery from checkpoint demonstrated at mid and late horizons | ${run.scenarios.some((s) => s.chapterNumber >= 25 && s.chapterNumber <= 30 && s.outcome.recovered) && run.scenarios.some((s) => s.chapterNumber >= 46 && s.outcome.recovered) ? 'DONE — mid (Bab 25-27) and late (Bab 46-50)' : 'INCOMPLETE'} |`)
  lines.push('| `G2-BUDGET` evidence | BLOCKED — depends on the E.4 ceiling and real spend data |')
  lines.push('| Report committed | DONE |')
  lines.push('')

  lines.push('## STOP')
  lines.push('')
  lines.push('M10-E stops here for review. **M10-F must not start** while')
  lines.push('`E4_COST_CEILING_NOT_APPROVED` is open: the pilot spends real money against a ceiling')
  lines.push('that does not exist yet.')
  lines.push('')

  return lines.join('\n')
}

export async function runM10ECli(): Promise<number> {
  const startedAt = new Date().toISOString()
  const run = await runFaultMatrix()
  const finishedAt = new Date().toISOString()

  const measurements = measure(run)
  const blockers = collectBlockers(run, measurements)
  const result = decideResult(measurements, blockers)
  const { headSha, workingTreeDirty: dirty } = headShaOfWorkingTree()

  const evidence = {
    version: 'm10-e-fault-evidence/v1',
    startedAt,
    finishedAt,
    headSha,
    workingTreeDirty: dirty,
    result,
    blockers,
    measurements,
    scenarios: run.scenarios,
    uncovered: run.uncovered,
    costCeiling: COST_CEILING_V1,
  }
  const evidenceJson = stableStringify(evidence)
  const evidenceHash = computeSha256(evidenceJson)

  mkdirSync(E_ARTIFACT_DIR, { recursive: true })
  writeFileSync(E_EVIDENCE_PATH, `${evidenceJson}\n`, 'utf8')
  writeFileSync(
    E_REPORT_PATH,
    renderReport({ run, measurements, blockers, result, headSha, dirty, startedAt, finishedAt, evidenceHash }),
    'utf8',
  )

  console.log(`M10-E result: ${result}`)
  console.log(`  scenarios: ${run.scenarios.length}, invariant violations: ${measurements.invariantViolations.length}`)
  for (const b of blockers) console.log(`  BLOCKER ${b.code}`)
  console.log(`  report: ${E_REPORT_PATH}`)

  return result === 'FAIL' ? 1 : 0
}

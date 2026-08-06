/**
 * M10-A Task 4 — Story Bible dataflow audit CLI (synthetic inputs, pure detectors).
 *
 * Assembles synthetic inputs from fixtures/long-horizon/story-bible-pressure.ts
 * (49 choice-history entries, canon snapshots at milestones 10/20/30/40/45/50,
 * the 50-chapter story contract) plus the post-closure production hypothesis
 * flags (retrievalLogInvoked: false INFO; validator receives delta-derived
 * thread signals; brief consults the effective plot-debt ledger; act rollups
 * reach the writer; canon writeback exists via the v1 applier) into the input
 * groups of runStoryBibleAudit, then prints the audit result and writes the
 * full AuditReportArtifact to .zcode/artifacts/m10-a/audit.json.
 *
 * Exit contract: 0 on executionStatus SUCCESS (BLOCKER/HIGH findings are VALID
 * audit output — auditVerdict HOLD is not a script failure); 1 only on auditor
 * failure (detector throw / schema / artifact write failure).
 *
 * Pure + deterministic: no DB, no env, no network, no real model calls.
 */
import fs from 'node:fs'
import path from 'node:path'

import { runStoryBibleAudit } from '../lib/narrative-qa/story-bible-audit'
import type { AuditReportArtifact } from '../lib/narrative-qa/story-bible-audit-contract'
import type { ChoiceHistoryItem } from '../lib/narrative-qa/choice-history-audit'
import type { CanonContextSample } from '../lib/narrative-qa/context-pressure-audit'
import type { BlueprintVersionEntry } from '../lib/narrative-qa/blueprint-audit'
import type { ThreadAuditSample } from '../lib/narrative-qa/thread-audit'
import type { PlotDebtAuditSample, PlotDebtState } from '../lib/narrative-qa/plot-debt-audit'
import type { EndingFixtureEntry } from '../lib/narrative-qa/ending-audit'
import type { ActRollupLifecycleSample } from '../lib/narrative-qa/act-rollup-audit'
import type { FinalizationSample } from '../lib/narrative-qa/chapter50-audit'
import { DEFAULT_CONTRACT_FIELD_TRACES } from '../lib/narrative-qa/propagation-audit'
import {
  buildSyntheticCanonSnapshot,
  buildSyntheticStoryContract,
  generateSyntheticChoices,
} from '../fixtures/long-horizon/story-bible-pressure'

const ROOT = process.cwd()
const ARTIFACT_PATH = path.join(ROOT, '.zcode', 'artifacts', 'm10-a', 'audit.json')

const DEFAULT_BUDGET = 4000
const CANON_MILESTONES = [10, 20, 30, 40, 45, 50]

// ---------------------------------------------------------------------------
// Input assembly (fixtures -> detector interfaces)
// ---------------------------------------------------------------------------

/** generateSyntheticChoices(n) adapted to ChoiceHistoryItem (consequence: string[]). */
function syntheticChoiceItems(count: number): ChoiceHistoryItem[] {
  return generateSyntheticChoices(count).map((c) => ({
    chapterNumber: c.chapterNumber,
    label: c.label,
    consequence: [c.consequence],
    effectSummary: c.effectSummary,
    flags: c.flags,
  }))
}

/** buildSyntheticCanonSnapshot(chapter) adapted to CanonContextSample. */
function canonContextSample(chapter: number): CanonContextSample {
  const snap = buildSyntheticCanonSnapshot(chapter)
  return {
    chapter,
    declaredBudget: DEFAULT_BUDGET,
    facts: snap.facts.map((f) => ({
      id: f.id,
      statement: f.statement,
      isLoadBearing: f.loadBearing,
      paidOff: f.paidOff,
      establishedChapter: f.establishedChapter,
    })),
    threads: snap.threads.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    timeline: snap.timeline.map((e) => ({
      chapterNumber: e.chapterNumber,
      ordinal: e.ordinal,
      description: e.description,
      isFlashback: e.isFlashback,
    })),
    actRollups: snap.actRollups.map((r) => ({ actNumber: r.actNumber, summary: r.summary })),
    choiceHistory: [],
  }
}

/**
 * Blueprint resolution entries for chapter 20 (two versions in the fixture).
 * Post-M10-A closure: runtime AND compiler AND brief all resolve through
 * latestBlueprintForChapter (highest version wins) — all three entries report
 * v2, so BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE stays silent.
 */
function blueprintVersionEntries(): BlueprintVersionEntry[] {
  const snap = buildSyntheticCanonSnapshot(20)
  const byVersion = new Map(snap.blueprints.map((b) => [b.version, b]))
  const v2 = byVersion.get(2)
  if (!v2) {
    throw new Error('fixture blueprint v2 missing at canon milestone 20')
  }
  return [
    { chapterNumber: 20, version: v2.version, source: 'runtime', beats: v2.mandatoryBeats },
    { chapterNumber: 20, version: v2.version, source: 'compiler', beats: v2.mandatoryBeats },
    { chapterNumber: 20, version: v2.version, source: 'brief', beats: v2.mandatoryBeats },
  ]
}

/** Thread sample at canon milestone 50 with post-closure production hypothesis:
 *  the personalized v1 path derives advancedThreadIds from the validated state
 *  delta (delta.threads.touches + transitions) and the validator receives those
 *  real signals via the ThreadContext bridge. */
function threadAuditSample(): ThreadAuditSample {
  const snap = buildSyntheticCanonSnapshot(50)
  const advancing = snap.threads.find((t) => t.status !== 'RESOLVED')?.id ?? 'thread_2'
  return {
    chapter: 50,
    threads: snap.threads.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      openedChapter: t.openedChapter,
      lastTouchedChapter: t.lastTouchedChapter,
      isMainMystery: t.isMainMystery,
      stale: t.stale,
      staleSinceChapter: t.staleSinceChapter,
    })),
    // Post-closure reality (v1): advancedThreadIds = validatedStateDelta
    // touches + transition threadIds; validator consumes them verbatim.
    threadContextAdvancedThreadIds: [advancing],
    threadContextOpensNewThread: false,
    validatorReceivesDraftSignals: true,
  }
}

/** Plot debt sample at chapter 50 from the synthetic story contract (both debts
 *  contract-open). Post-M10-A closure (v1): the brief consults the effective
 *  plot-debt state (ledger projection loaded before generation), main_mystery is
 *  closed in the ledger, and progress on remaining milestones is recorded — so
 *  PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED and PLOT_DEBT_PROGRESS_NOT_PERSISTED
 *  stay silent. PLOT_DEBT_NEXT_CHAPTER_STATE_STALE (MEDIUM) remains for
 *  traceability (contract row still says open while ledger says closed).
 */
function plotDebtAuditSample(): PlotDebtAuditSample {
  const contract = buildSyntheticStoryContract()
  const debts: PlotDebtState[] = contract.plotDebts.map((d) => ({
    id: d.id,
    introducedAt: d.introducedAt,
    mustProgressBy: d.mustProgressBy,
    mustCloseBy: d.mustCloseBy,
    status: d.status,
  }))
  return {
    chapter: 50,
    debts,
    // Ledger at publish-time (v1 applier): main_mystery closure persisted at ch 35;
    // debt_2 progress recorded at its milestone ch 25 (reader_plot_debt_progress).
    ledgerClosedIds: ['main_mystery'],
    closesProposed: [], // chapter-50 audit itself does not propose new closures
    auditSignalsClosesPlotDebts: [],
    progressRecordedThisChapter: ['debt_2'],
    progressedMilestones: [{ debtId: 'debt_2', milestoneIndex: 0, progressedAt: 25 }],
    // v1 closure: effectivePlotDebtState (ledger projection) is an input to
    // buildChapterBrief (personalized-generation.ts:887-889 -> chapter-brief.ts:268).
    briefConsultsLedger: true,
  }
}

/** Ending fixture sequence: lock chapter via legacy path (persisted then
 *  published, two transactions) + durable post-lock chapter. */
function endingFixtureEntries(): EndingFixtureEntry[] {
  return [
    { chapterNumber: 44, resolvedEndingId: null, lockedEndingId: null },
    // Sync path persists lock BEFORE publish (durable) — non-atomic window only.
    { chapterNumber: 45, resolvedEndingId: 'ending_A', lockedEndingId: 'ending_A', publishPath: 'v2' },
    { chapterNumber: 50, resolvedEndingId: 'ending_A', lockedEndingId: 'ending_A' },
  ]
}

/** Act rollup lifecycle sample from canon milestone 50. Post-M10-A closure:
 *  the v1 applier upserts rollups at act boundaries (act1 at ch 10, act2 at
 *  ch 25) and the writer layer 3 renders them ("Ringkasan Babak Terlewati"), so
 *  DEAD_PATH_CANDIDATE stays silent. */
function actRollupLifecycleSample(): ActRollupLifecycleSample {
  const snap = buildSyntheticCanonSnapshot(50)
  return {
    rollups: snap.actRollups.map((r) => ({
      actNumber: r.actNumber,
      summary: r.summary,
      coversFromChapter: r.coversFromChapter,
      coversToChapter: r.coversToChapter,
      updatedAtChapter: r.coversToChapter,
    })),
    snapshotReadsRollups: true,
    compilerIncludesRollups: true,
    writerPromptIncludesRollups: true,
    seededAtAuthoring: true,
  }
}

/** Chapter 50 finalization sample: published once, SELESAI marked deterministically. */
function chapter50FinalizationSample(): FinalizationSample {
  return {
    chapter: 50,
    attempts: [{ attempt: 1, success: true, reason: 'PUBLISHED' }],
    readerStateMarkedSelesai: true,
    selesaiMarkDeterministic: true,
  }
}

function buildInputs() {
  return {
    choiceHistory: {
      items: syntheticChoiceItems(49),
      // Correction (M10-A/R1): Bab 50 target -> expected latest visible = 49
      // (memory N-1), so the corrected baseline no longer emits the
      // false-positive CHOICE_HISTORY_RECENT_LOSS. Production behavior:
      // summarizeChoiceHistory appends previousChoice -> duplicate at tail.
      targetChapter: 50,
      summaryAppendsPreviousChoice: true,
    },
    contextSamples: CANON_MILESTONES.map(canonContextSample),
    blueprintVersions: blueprintVersionEntries(),
    threadSample: threadAuditSample(),
    plotDebtSample: plotDebtAuditSample(),
    endingFixtures: endingFixtureEntries(),
    propagation: {
      traces: DEFAULT_CONTRACT_FIELD_TRACES,
      retrievalLogInvoked: false,
      retrievalLogConsumers: [],
      contextPacketConsumerProven: false,
    },
    actRollupSample: actRollupLifecycleSample(),
    chapter50Sample: chapter50FinalizationSample(),
    // Post-closure (v1): the shared applier writes canon (facts/knowledge/
    // timeline/characters/threads/act rollups/debt ledger) behind
    // publish_chapter_state_v3 (sync) and publish_generation_job_chapter_v5
    // (worker); the v0/legacy publish payloads (v2/v4) carry no canon delta.
    canonWriteback: {
      v2CarriesCanonDelta: false,
      v4CarriesCanonDelta: false,
      canonRuntimeWriterExists: true,
    },
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printReport(report: AuditReportArtifact): void {
  const { summary } = report
  console.log('M10-A Story Bible audit (synthetic fixtures)')
  console.log(`executionStatus: ${report.executionStatus}`)
  console.log(`auditVerdict: ${report.auditVerdict}`)
  console.log(
    `summary: blocker=${summary.blocker} high=${summary.high} medium=${summary.medium} ` +
      `low=${summary.low} info=${summary.info} total=${summary.totalFindings}`,
  )
  console.log(`findings (${report.findings.length}):`)
  for (const f of report.findings) {
    console.log(
      `  [${f.severity.padEnd(7)}] ${f.code.padEnd(42)} domain=${f.domain.padEnd(14)} status=${f.status}`,
    )
  }
}

function writeArtifact(report: AuditReportArtifact): string {
  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true })
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return `${ARTIFACT_PATH} (${fs.statSync(ARTIFACT_PATH).size} bytes)`
}

function main(): void {
  const report = runStoryBibleAudit(buildInputs(), { now: new Date('2026-08-04T00:00:00.000Z') })
  printReport(report)
  console.log(`artifact: ${writeArtifact(report)}`)

  if (report.executionStatus !== 'SUCCESS') {
    console.error(`m10-story-bible-audit: executionStatus=${report.executionStatus} (auditor failure)`)
    process.exit(1)
  }
  console.log('m10-story-bible-audit: SUCCESS (auditVerdict HOLD/PASS is audit output, not a script failure)')
}

try {
  main()
} catch (err) {
  console.error('m10-story-bible-audit: auditor failure:', err instanceof Error ? err.message : err)
  process.exit(1)
}

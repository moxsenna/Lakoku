/**
 * M10-A Task 4 — Story Bible dataflow audit CLI (synthetic inputs, pure detectors).
 *
 * Assembles synthetic inputs from fixtures/long-horizon/story-bible-pressure.ts
 * (49 choice-history entries, canon snapshots at milestones 10/20/30/40/45/50,
 * the 50-chapter story contract) plus the audit hypothesis flags
 * (retrievalLogInvoked: false, validatorReceivesDraftSignals: false) into the
 * input groups of runStoryBibleAudit, then prints the audit result and writes
 * the full AuditReportArtifact to .zcode/artifacts/m10-a/audit.json.
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
 * The fixture array order is [v1, v2]: buildChapterBrief takes the FIRST array
 * match (v1) while resolveBlueprint/latestBlueprint take the highest version
 * (v2) — the same divergence the production detector characterizes.
 */
function blueprintVersionEntries(): BlueprintVersionEntry[] {
  const snap = buildSyntheticCanonSnapshot(20)
  const byVersion = new Map(snap.blueprints.map((b) => [b.version, b]))
  const v1 = byVersion.get(1)
  const v2 = byVersion.get(2)
  if (!v1 || !v2) {
    throw new Error('fixture blueprint v1/v2 missing at canon milestone 20')
  }
  return [
    { chapterNumber: 20, version: v2.version, source: 'runtime', beats: v2.mandatoryBeats },
    { chapterNumber: 20, version: v2.version, source: 'compiler', beats: v2.mandatoryBeats },
    { chapterNumber: 20, version: v1.version, source: 'brief', beats: v1.mandatoryBeats },
  ]
}

/** Thread sample at canon milestone 50 with production hypothesis flags. */
function threadAuditSample(): ThreadAuditSample {
  const snap = buildSyntheticCanonSnapshot(50)
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
    // Production hypothesis (code-reading): runtime hardcodes empty signals and
    // the draft validator never receives them.
    threadContextAdvancedThreadIds: [],
    threadContextOpensNewThread: false,
    validatorReceivesDraftSignals: false,
  }
}

/** Plot debt sample at chapter 50 from the synthetic story contract (both debts open).
 *  Reviewer correction (M10-A/R1): ledger has closures persisted at publish
 *  (v4 RPC), but the brief never consults the ledger (briefConsultsLedger:
 *  false) — the baseline must surface PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED.
 *  We simulate the real production shape: main_mystery closes at 35 and is in
 *  the ledger at chapter 50, debt_2 closes at 48 (ledger too), yet the brief
 *  still sees contract status 'open'.
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
    // Ledger at publish-time (v4): main_mystery closure persisted at ch 35;
    // debt_2 is NOT in the ledger (progress memory gap persists to ch 50).
    ledgerClosedIds: ['main_mystery'],
    closesProposed: [], // chapter-50 audit itself does not propose new closures
    auditSignalsClosesPlotDebts: [],
    progressRecordedThisChapter: [],
    progressedMilestones: [],
    // Brief ignores the ledger (buildChapterBrief reads contract status only).
    briefConsultsLedger: false,
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

/** Act rollup lifecycle sample from canon milestone 50 (seeded, never updated). */
function actRollupLifecycleSample(): ActRollupLifecycleSample {
  const snap = buildSyntheticCanonSnapshot(50)
  return {
    rollups: snap.actRollups.map((r) => ({
      actNumber: r.actNumber,
      summary: r.summary,
      coversFromChapter: r.coversFromChapter,
      coversToChapter: r.coversToChapter,
      updatedAtChapter: null,
    })),
    snapshotReadsRollups: true,
    compilerIncludesRollups: true,
    writerPromptIncludesRollups: false,
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

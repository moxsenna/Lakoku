/**
 * M10-A Task 4 — Context pressure audit CLI (synthetic canon growth + budget stress).
 *
 * Builds CanonContextSample inputs from fixtures/long-horizon/story-bible-pressure.ts
 * (canon growth at milestones 1/10/20/30/35/40/45/48/49/50), stress cases at
 * totalBudget=4000 with load-bearing cost 900/1500/2500/3100 (all within budget,
 * granular layer-3 trim recorded — post-M10-A closure shape), and choice-history
 * pressure rows at 10/20/30/40/50 over 49 choices. Prints a per-milestone table +
 * choice pressure rows + verdict, and writes the ContextPressureReportArtifact to
 * .zcode/artifacts/m10-a/context-pressure.json.
 *
 * Exit contract: 0 on SUCCESS (HOLD is valid audit output); 1 only on auditor
 * failure (throw / artifact write failure).
 *
 * Pure + deterministic: no DB, no env, no network, no real model calls.
 */
import fs from 'node:fs'
import path from 'node:path'

import { buildContextPressureReport } from '../lib/narrative-qa/story-bible-audit'
import type { ContextPressureReportArtifact } from '../lib/narrative-qa/story-bible-audit-contract'
import type {
  CanonContextSample,
  ContextActRollupSample,
  ContextFact,
  ContextThreadSample,
  ContextTimelineSample,
} from '../lib/narrative-qa/context-pressure-audit'
import type { ChoiceHistoryItem } from '../lib/narrative-qa/choice-history-audit'
import {
  buildSyntheticCanonSnapshot,
  generateSyntheticChoices,
} from '../fixtures/long-horizon/story-bible-pressure'

const ROOT = process.cwd()
const ARTIFACT_PATH = path.join(ROOT, '.zcode', 'artifacts', 'm10-a', 'context-pressure.json')

const DEFAULT_BUDGET = 4000
const CANON_MILESTONES = [1, 10, 20, 30, 35, 40, 45, 48, 49, 50]
// Post-closure stress envelope: every row fits the declared 4000 budget (like a
// compileContext-trimmed packet); 1500/2500/3100 cross the 25% load-bearing cap
// (LOAD_BEARING_PRESSURE MEDIUM), 3100 also crosses 90% usage (fact/rollup
// eviction MEDIUM). The >budget adversarial case lives in unit tests.
const STRESS_LOAD_BEARING_COSTS = [900, 1500, 2500, 3100]
const CHOICE_PRESSURE_CHAPTERS = [10, 20, 30, 40, 50]
const TOTAL_CHOICES = 49

// ---------------------------------------------------------------------------
// Sample builders (mirror tests/narrative-qa/sample-builder.ts approach)
// ---------------------------------------------------------------------------

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
 * Stress sample at totalBudget=4000: load-bearing facts cost `loadBearingCost`
 * (400-char statement = 100 tokens each), 26 regular facts (100 chars = 25 tokens
 * each) with 4 excluded, 5 threads, 8 timeline events, 2 act rollups with act 1
 * excluded. Post-M10-A closure shapes:
 *  - compiler-level: every row stays within the declared budget (like a packet
 *    compileContext would trim to fit) — CONTEXT_DECLARED_BUDGET_OVERSHOOT stays
 *    silent; LOAD_BEARING_PRESSURE (MEDIUM) fires from cost >= 1000 (25% cap).
 *  - writer layer-3: the 4800-char TRIM_BUDGET is enforced GRANULARLY per entry
 *    (timeline -> facts -> threads -> rollups) and the layerEviction record is
 *    present with trimmedToLimit: true, so WRITER_CONTEXT_GRANULAR_TRIM_NOT_RECORDED
 *    stays silent. (The adversarial load-bearing > budget case is covered in
 *    tests/narrative-qa/context-pressure.test.ts, not the PASS-gated artifact.)
 */
function stressContextSample(loadBearingCost: number, chapter = 50): CanonContextSample {
  const loadBearingFacts: ContextFact[] = []
  const loadBearingCount = Math.ceil(loadBearingCost / 100)
  for (let i = 1; i <= loadBearingCount; i++) {
    loadBearingFacts.push({
      id: `lb_${i}`,
      statement: 'x'.repeat(400),
      isLoadBearing: true,
      paidOff: false,
    })
  }
  const regularFacts: ContextFact[] = []
  for (let i = 1; i <= 26; i++) {
    regularFacts.push({
      id: `fact_${i}`,
      statement: 'y'.repeat(100),
      isLoadBearing: false,
      paidOff: false,
      included: i <= 4 ? false : undefined,
    })
  }
  const threads: ContextThreadSample[] = []
  for (let i = 1; i <= 5; i++) {
    threads.push({ id: `thread_${i}`, title: 't'.repeat(40), status: 'DEVELOPING' })
  }
  const timeline: ContextTimelineSample[] = []
  for (let i = 1; i <= 8; i++) {
    timeline.push({ chapterNumber: i, ordinal: 1, description: 't'.repeat(40), isFlashback: false })
  }
  const actRollups: ContextActRollupSample[] = [
    { actNumber: 1, summary: 'r'.repeat(60), included: false },
    { actNumber: 2, summary: 'r'.repeat(60) },
  ]
  // Writer layer-3 block (chars) exactly as buildWriterPrompt assembles it:
  // timeline + facts + threads + rollups against the fixed 4800 TRIM_BUDGET.
  // Granular trimming priority: timeline -> facts -> threads -> rollups, so the
  // timeline (320) and threads (200) and rollups (120) fit and only facts are
  // trimmed per entry until the block fits — recorded in layerEviction.
  const timelineChars = 8 * 40
  const factsChars = [...loadBearingFacts, ...regularFacts].length * 400
  const threadsChars = 5 * 40
  const rollupsChars = 2 * 60
  const charLimit = 4800
  const factsBudget = charLimit - timelineChars - threadsChars - rollupsChars
  const factsFit = Math.max(0, Math.floor(factsBudget / 400))
  const totalFacts = [...loadBearingFacts, ...regularFacts].length
  return {
    chapter,
    declaredBudget: DEFAULT_BUDGET,
    facts: [...loadBearingFacts, ...regularFacts],
    threads,
    timeline,
    actRollups,
    choiceHistory: [],
    writerLayer3: {
      timelineChars,
      factsChars,
      threadsChars,
      rollupsChars,
      charLimit,
      layerEviction: {
        timeline: 0,
        facts: Math.max(0, totalFacts - factsFit),
        threads: 0,
        rollups: 0,
        trimmedToLimit: true,
      },
    },
  }
}

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

function buildSamplesAndChoiceGroups() {
  const samples: CanonContextSample[] = [
    ...CANON_MILESTONES.map(canonContextSample),
    ...STRESS_LOAD_BEARING_COSTS.map((cost) => stressContextSample(cost)),
  ]
  const choiceHistoryGroups = CHOICE_PRESSURE_CHAPTERS.map((chapter) => ({
    chapter,
    items: syntheticChoiceItems(TOTAL_CHOICES),
  }))
  return { samples, choiceHistoryGroups }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function pad(value: string | number | boolean, width: number): string {
  return String(value).padEnd(width)
}

function printMilestoneTable(report: ContextPressureReportArtifact): void {
  console.log('M10-A Context pressure — milestones (canon growth + stress, totalBudget=4000)')
  console.log(
    `${pad('chapter', 8)}${pad('declared', 9)}${pad('used', 7)}${pad('factsI', 7)}` +
      `${pad('factsX', 7)}${pad('lbInc', 6)}${pad('rollI', 6)}${pad('rollX', 6)}` +
      `${pad('thr', 4)}${pad('tln', 4)}${pad('layer3', 7)}detectorsTriggered`,
  )
  for (const m of report.milestones) {
    console.log(
      `${pad(m.chapter, 8)}${pad(m.declaredBudget, 9)}${pad(m.actualUsed, 7)}` +
        `${pad(m.factsIncluded, 7)}${pad(m.factsExcluded, 7)}${pad(m.loadBearingIncluded, 6)}` +
        `${pad(m.rollupsIncluded, 6)}${pad(m.rollupsExcluded, 6)}${pad(m.threadsRetained, 4)}` +
        `${pad(m.timelineRetained, 4)}${pad(m.writerLayer3CharLength, 7)}` +
        `${m.detectorsTriggered.length > 0 ? m.detectorsTriggered.join(',') : '-'}`,
    )
  }
}

function printChoicePressure(report: ContextPressureReportArtifact): void {
  console.log(`choice-history pressure (${TOTAL_CHOICES} choices per chapter):`)
  console.log(
    `${pad('chapter', 8)}${pad('total', 6)}${pad('visible', 8)}${pad('trunc', 6)}` +
      `${pad('dupPrev', 8)}${pad('estTokens', 10)}detectorsTriggered`,
  )
  for (const c of report.choiceHistoryPressure) {
    console.log(
      `${pad(c.chapter, 8)}${pad(c.totalChoicesAvailable, 6)}${pad(c.visibleChoicesCount, 8)}` +
        `${pad(c.truncatedChoicesCount, 6)}${pad(c.duplicatePreviousDetected, 8)}` +
        `${pad(c.estimatedTokenPressure, 10)}` +
        `${c.detectorsTriggered.length > 0 ? c.detectorsTriggered.join(',') : '-'}`,
    )
  }
}

function writeArtifact(report: ContextPressureReportArtifact): string {
  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true })
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return `${ARTIFACT_PATH} (${fs.statSync(ARTIFACT_PATH).size} bytes)`
}

function main(): void {
  const { samples, choiceHistoryGroups } = buildSamplesAndChoiceGroups()
  const report = buildContextPressureReport(samples, choiceHistoryGroups, {
    now: new Date('2026-08-04T00:00:00.000Z'),
  })

  printMilestoneTable(report)
  printChoicePressure(report)
  console.log(`executionStatus: ${report.executionStatus}`)
  console.log(`auditVerdict: ${report.auditVerdict}`)
  console.log(`artifact: ${writeArtifact(report)}`)

  if (report.executionStatus !== 'SUCCESS') {
    console.error(`m10-context-pressure-audit: executionStatus=${report.executionStatus} (auditor failure)`)
    process.exit(1)
  }
  console.log('m10-context-pressure-audit: SUCCESS (auditVerdict HOLD/PASS is audit output, not a script failure)')
}

try {
  main()
} catch (err) {
  console.error('m10-context-pressure-audit: auditor failure:', err instanceof Error ? err.message : err)
  process.exit(1)
}

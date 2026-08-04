/**
 * M10-A Task 3 — shared sample builders untuk test detector narrative-qa.
 *
 * Semua builder menghasilkan input minimal yang sesuai dengan interface ekspor
 * ASLI tiap modul detector (bukan tipe produksi lain). Fixture
 * fixtures/long-horizon/story-bible-pressure.ts dipakai hanya di mana bentuknya
 * sejajar (choice history — dengan adaptasi consequence: string -> string[]).
 */
import type { ChoiceHistoryItem } from '../../lib/narrative-qa/choice-history-audit'
import type {
  CanonContextSample,
  ContextActRollupSample,
  ContextFact,
  ContextThreadSample,
  ContextTimelineSample,
} from '../../lib/narrative-qa/context-pressure-audit'
import type {
  BlueprintResolutionSource,
  BlueprintVersionEntry,
} from '../../lib/narrative-qa/blueprint-audit'
import type { ThreadAuditSample, ThreadSample } from '../../lib/narrative-qa/thread-audit'
import type {
  PlotDebtAuditSample,
  PlotDebtState,
} from '../../lib/narrative-qa/plot-debt-audit'
import type { EndingFixtureEntry } from '../../lib/narrative-qa/ending-audit'
import type {
  ActRollupEntry,
  ActRollupLifecycleSample,
} from '../../lib/narrative-qa/act-rollup-audit'
import type {
  FinalizationSample,
  PublishAttempt,
} from '../../lib/narrative-qa/chapter50-audit'
import type { ContractFieldTrace } from '../../lib/narrative-qa/propagation-audit'
import type { StoryBibleAuditFinding } from '../../lib/narrative-qa/story-bible-audit-contract'
import { generateSyntheticChoices } from '../../fixtures/long-horizon/story-bible-pressure'

/**
 * Detail finding tidak diekspos sebagai field (contract StoryBibleAuditFinding
 * tidak punya `detail`); detail hidup di observation evidence
 * PURE_CHARACTERIZATION sebagai JSON. Helper ini mengekstraknya agar test bisa
 * memeriksa nilai detail tanpa bergantung pada bentuk non-kontrak.
 */
export function detailOf(finding: StoryBibleAuditFinding): Record<string, unknown> {
  const observation = finding.evidence.find(
    (e) => e.evidenceClass === 'PURE_CHARACTERIZATION',
  )?.observation
  if (!observation) return {}
  const json = observation.slice(observation.indexOf(':') + 1).trim()
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Choice history (interface: ChoiceHistoryItem — consequence adalah string[])
// ---------------------------------------------------------------------------

export function choiceItem(
  chapterNumber: number,
  label: string,
  consequence: string[],
  effectSummary = '',
  flags: string[] = [],
): ChoiceHistoryItem {
  return { chapterNumber, label, consequence, effectSummary, flags }
}

/** Adaptasi generateSyntheticChoices(n): consequence string -> string[]. */
export function syntheticChoiceItems(count: number): ChoiceHistoryItem[] {
  return generateSyntheticChoices(count).map((c) => ({
    chapterNumber: c.chapterNumber,
    label: c.label,
    consequence: [c.consequence],
    effectSummary: c.effectSummary,
    flags: c.flags,
  }))
}

// ---------------------------------------------------------------------------
// Context pressure (interface: CanonContextSample)
// ---------------------------------------------------------------------------

export function fact(
  id: string,
  statement: string,
  isLoadBearing: boolean,
  included?: boolean,
): ContextFact {
  return { id, statement, isLoadBearing, paidOff: false, included }
}

export function threadSample(
  id: string,
  title: string,
  status = 'DEVELOPING',
): ContextThreadSample {
  return { id, title, status }
}

export function timelineSample(chapterNumber: number, description: string): ContextTimelineSample {
  return { chapterNumber, ordinal: 1, description, isFlashback: false }
}

export function rollupSample(
  actNumber: number,
  summary: string,
  included?: boolean,
): ContextActRollupSample {
  return { actNumber, summary, included }
}

export function contextSample(overrides: Partial<CanonContextSample>): CanonContextSample {
  return {
    chapter: 10,
    declaredBudget: 4000,
    facts: [],
    threads: [],
    timeline: [],
    actRollups: [],
    choiceHistory: [],
    ...overrides,
  }
}

/**
 * Sample canon yang tumbuh seiring chapter: fakta, load-bearing, thread,
 * timeline, dan rollup bertambah. Tidak ada exclusion, tidak ada overshoot —
 * dipakai untuk karakterisasi pertumbuhan lintas milestone.
 */
export function growingContextSample(chapter: number): CanonContextSample {
  const facts: ContextFact[] = []
  const factCount = chapter * 2
  for (let i = 1; i <= factCount; i++) {
    facts.push(fact(`fact_${i}`, `Fakta penting nomor ${i} yang sudah terbentuk`, i % 4 === 0))
  }
  const threads: ContextThreadSample[] = []
  const threadCount = Math.min(10, Math.floor(chapter / 5) + 2)
  for (let i = 1; i <= threadCount; i++) {
    threads.push(threadSample(`thread_${i}`, `Alur Konflik Utama ${i}`))
  }
  const timeline: ContextTimelineSample[] = []
  const timelineCount = Math.min(chapter, 20)
  for (let i = 1; i <= timelineCount; i++) {
    timeline.push(timelineSample(i, `Peristiwa utama di bab ${i}`))
  }
  const actRollups: ContextActRollupSample[] = []
  if (chapter > 10) {
    actRollups.push(rollupSample(1, 'Keluarga kerajaan runtuh akibat pengkhianatan penasihat utama.'))
  }
  if (chapter > 25) {
    actRollups.push(rollupSample(2, 'Perjalanan pengasingan dan pengumpulan sekutu rahasia di perbatasan.'))
  }
  return contextSample({
    chapter,
    facts,
    threads,
    timeline,
    actRollups,
  })
}

/**
 * Sample stress dengan totalBudget=4000: biaya load-bearing bervariasi
 * (900/1500/3000/4500) dan ada fakta/rollup yang ter-exclude sehingga detector
 * eviction menembak (budget >= 90% terpakai).
 *
 * Konstanta biaya: statement 400 char = 100 token, thread 40 char = 10 token,
 * timeline 40 char = 10 token, rollup 60 char = 15 token.
 * Biaya non-load-bearing tetap = 2600 (fakta) + 50 (thread) + 80 (timeline) +
 * 30 (rollup) = 2760.
 */
export function stressContextSample(
  loadBearingCost: number,
  declaredBudget = 4000,
): CanonContextSample {
  const loadBearingFacts: ContextFact[] = []
  const loadBearingCount = Math.ceil(loadBearingCost / 100)
  for (let i = 1; i <= loadBearingCount; i++) {
    loadBearingFacts.push(fact(`lb_${i}`, 'x'.repeat(400), true))
  }
  const regularFacts: ContextFact[] = []
  for (let i = 1; i <= 26; i++) {
    regularFacts.push(fact(`fact_${i}`, 'x'.repeat(400), false, i <= 4 ? false : undefined))
  }
  const threads: ContextThreadSample[] = []
  for (let i = 1; i <= 5; i++) {
    threads.push(threadSample(`thread_${i}`, 't'.repeat(40)))
  }
  const timeline: ContextTimelineSample[] = []
  for (let i = 1; i <= 8; i++) {
    timeline.push(timelineSample(i, 't'.repeat(40)))
  }
  const actRollups: ContextActRollupSample[] = [
    rollupSample(1, 'r'.repeat(60), false),
    rollupSample(2, 'r'.repeat(60)),
  ]
  return contextSample({
    chapter: 50,
    declaredBudget,
    facts: [...loadBearingFacts, ...regularFacts],
    threads,
    timeline,
    actRollups,
  })
}

// ---------------------------------------------------------------------------
// Blueprint (interface: BlueprintVersionEntry)
// ---------------------------------------------------------------------------

export function blueprintEntry(
  chapterNumber: number,
  version: number,
  source: BlueprintResolutionSource,
): BlueprintVersionEntry {
  return { chapterNumber, version, source, beats: [`beat_${chapterNumber}_${version}`] }
}

// ---------------------------------------------------------------------------
// Thread (interface: ThreadAuditSample)
// ---------------------------------------------------------------------------

export function thread(
  id: string,
  openedChapter: number,
  lastTouchedChapter: number,
  stale = false,
  status = 'DEVELOPING',
): ThreadSample {
  return {
    id,
    title: `Thread ${id}`,
    status,
    openedChapter,
    lastTouchedChapter,
    isMainMystery: false,
    stale,
    staleSinceChapter: stale ? lastTouchedChapter : null,
  }
}

export function threadAuditSample(overrides: Partial<ThreadAuditSample>): ThreadAuditSample {
  return {
    chapter: 41,
    threads: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Plot debt (interface: PlotDebtAuditSample)
// ---------------------------------------------------------------------------

export function plotDebtState(
  id: string,
  introducedAt: number,
  mustProgressBy: number[],
  mustCloseBy: number,
  status: PlotDebtState['status'] = 'open',
): PlotDebtState {
  return { id, introducedAt, mustProgressBy, mustCloseBy, status }
}

/** Debt utama sesuai plan §10: diperkenalkan Bab 5, progress [10, 20], close 35. */
export function mainMysteryDebt(): PlotDebtState {
  return plotDebtState('main_mystery', 5, [10, 20], 35)
}

export function plotDebtSample(overrides: Partial<PlotDebtAuditSample>): PlotDebtAuditSample {
  return {
    chapter: 10,
    debts: [],
    ledgerClosedIds: [],
    closesProposed: [],
    auditSignalsClosesPlotDebts: [],
    progressRecordedThisChapter: [],
    progressedMilestones: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Ending (interface: EndingFixtureEntry)
// ---------------------------------------------------------------------------

export function endingEntry(
  chapterNumber: number,
  resolvedEndingId: string | null,
  lockedEndingId: string | null,
  publishPath?: 'v4' | 'v2',
): EndingFixtureEntry {
  return { chapterNumber, resolvedEndingId, lockedEndingId, publishPath }
}

// ---------------------------------------------------------------------------
// Act rollup (interface: ActRollupLifecycleSample)
// ---------------------------------------------------------------------------

export function rollupEntry(
  actNumber: number,
  coversFromChapter: number,
  coversToChapter: number,
  updatedAtChapter: number | null,
): ActRollupEntry {
  return {
    actNumber,
    summary: `Ringkasan act ${actNumber}`,
    coversFromChapter,
    coversToChapter,
    updatedAtChapter,
  }
}

export function actRollupSample(overrides: Partial<ActRollupLifecycleSample>): ActRollupLifecycleSample {
  return {
    rollups: [],
    snapshotReadsRollups: true,
    compilerIncludesRollups: true,
    writerPromptIncludesRollups: false,
    seededAtAuthoring: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Chapter 50 (interface: FinalizationSample)
// ---------------------------------------------------------------------------

export function attempt(n: number, success: boolean, reason?: string): PublishAttempt {
  return reason == null ? { attempt: n, success } : { attempt: n, success, reason }
}

export function finalizationSample(overrides: Partial<FinalizationSample>): FinalizationSample {
  return {
    chapter: 50,
    attempts: [],
    readerStateMarkedSelesai: false,
    selesaiMarkDeterministic: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Propagation (interface: ContractFieldTrace)
// ---------------------------------------------------------------------------

export function contractTrace(
  field: string,
  persisted: boolean,
  inChapterBrief: boolean,
  inPreProseBrief: boolean,
  inContinuation: boolean,
  inWriterPrompt: boolean,
  note = '',
): ContractFieldTrace {
  return {
    field,
    persisted,
    inChapterBrief,
    inPreProseBrief,
    inContinuation,
    inWriterPrompt,
    note,
  }
}

/** Trace ideal: field terpropagasi contract -> brief -> prompt. */
export function fullyPropagatedTrace(field: string): ContractFieldTrace {
  return contractTrace(field, true, true, true, true, true)
}

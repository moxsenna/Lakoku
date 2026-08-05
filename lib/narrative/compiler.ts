/**
 * G2 — Context compiler (T0–T3) + budget policy + load-bearing protection.
 *
 * Menghasilkan Chapter Context Packet (ARCH §12.2) yang ringkas & versioned
 * dari CanonSnapshot untuk target bab tertentu. Menerapkan hierarki memori
 * NCS §2.1 dan kebijakan budget NCS §2.2, dengan aturan keras:
 *   - Safety, T0 canon core, blueprint goal/forbidden reveals TIDAK dipangkas.
 *   - Fakta LOAD_BEARING yang belum dibayar TIDAK PERNAH dipangkas (§2.3).
 *   - Setiap yang dipangkas dicatat ke exclusion list (→ retrieval_logs).
 *
 * Estimasi "token" memakai proxy deterministik (≈ jumlah kata) agar dapat
 * diuji tanpa tokenizer model.
 */

import type {
  CanonSnapshot,
  Fact,
  StoryThread,
  ActRollup,
  VoiceSheet,
} from './types'
import { latestBlueprintForChapter } from './blueprint'

/** Proxy token deterministik: jumlah kata (kasar tapi konsisten). */
export function estimateTokens(text: string): number {
  const t = text.trim()
  if (!t) return 0
  return t.split(/\s+/).length
}

export const BUDGET_ALLOCATION = {
  safety: 0.05,
  t0Canon: 0.15,
  blueprint: 0.1,
  currentState: 0.2,
  rollupsSummaries: 0.25,
  facts: 0.15,
  retrievalInstructions: 0.1,
} as const

export interface CompileOptions {
  /** Total budget token untuk packet (per model policy version). */
  totalBudget?: number
}

export interface BudgetReport {
  totalBudget: number
  used: number
  perSection: Record<string, { used: number; cap: number; trimmed: boolean }>
}

export interface ChapterContextPacket {
  contextVersion: number
  storyId: string
  targetChapterNo: number
  phase: string
  storyContractSummary: Record<string, unknown>
  chapterGoal: string
  mandatoryBeats: string[]
  forbiddenReveals: string[]
  currentState: {
    activeThreads: StoryThread[]
  }
  loadBearingFacts: Fact[]
  relevantFacts: Fact[]
  actRollups: ActRollup[]
  voiceSheets: VoiceSheet[]
  contextBudgetReport: BudgetReport
  styleContractRef: string
  /** Audit: apa yang dimasukkan & dikeluarkan (→ retrieval_logs). */
  includedIds: string[]
  excludedIds: string[]
}

const DEFAULT_BUDGET = 4000

/**
 * Skor relevansi fakta untuk target bab (proxy salience §2.3):
 * lebih tinggi bila baru ditetapkan, salience tinggi, atau subjek thread aktif.
 */
function factRelevance(
  fact: Fact,
  targetChapter: number,
  activeThreadChars: Set<string>,
): number {
  let score = fact.salience
  const recency = 1 / (1 + Math.max(0, targetChapter - fact.establishedChapter))
  score += recency * 0.5
  if (fact.subjectCharacterId && activeThreadChars.has(fact.subjectCharacterId)) {
    score += 0.5
  }
  return score
}

/**
 * Kompilasi packet untuk target bab. Deterministik: input sama → output sama.
 */
export function compileContext(
  snapshot: CanonSnapshot,
  targetChapter: number,
  opts: CompileOptions = {},
): ChapterContextPacket {
  const totalBudget = opts.totalBudget ?? DEFAULT_BUDGET
  const blueprint = latestBlueprintForChapter(snapshot, targetChapter)

  // --- Current state: thread aktif (bukan RESOLVED/ABANDONED). Urut deterministik.
  const activeThreads = snapshot.threads
    .filter(
      (t) => t.status !== 'RESOLVED' && t.status !== 'ABANDONED_APPROVED',
    )
    .sort((a, b) => a.id.localeCompare(b.id))

  const activeThreadChars = new Set<string>()
  // (thread→karakter tak dimodelkan langsung; gunakan subjek fakta yang load-bearing
  //  sebagai proksi keterkaitan; cukup untuk skor relevansi.)

  // --- Fakta: LOAD_BEARING belum dibayar SELALU masuk (tak dihitung untuk trim).
  const loadBearing = snapshot.facts
    .filter((f) => f.loadBearing && !f.paidOff && f.establishedChapter <= targetChapter)
    .sort((a, b) => a.id.localeCompare(b.id))

  for (const f of loadBearing) {
    if (f.subjectCharacterId) activeThreadChars.add(f.subjectCharacterId)
  }

  // --- Fakta relevan lain (dapat dipangkas): urut skor menurun, deterministik.
  const otherFacts = snapshot.facts
    .filter(
      (f) =>
        f.establishedChapter <= targetChapter &&
        !(f.loadBearing && !f.paidOff),
    )
    .map((f) => ({
      fact: f,
      score: factRelevance(f, targetChapter, activeThreadChars),
    }))
    .sort((a, b) => b.score - a.score || a.fact.id.localeCompare(b.fact.id))

  // --- Rollups T1: semua act sebelum bab target.
  const actRollups = snapshot.actRollups
    .filter((r) => r.coversToChapter < targetChapter)
    .sort((a, b) => a.actNumber - b.actNumber)

  // --- Voice sheets: hanya karakter yang muncul (introduced ≤ target & aktif).
  const appearingChars = new Set(
    snapshot.characters
      .filter((c) => c.introducedChapter <= targetChapter && c.status !== 'INACTIVE')
      .map((c) => c.id),
  )
  const voiceSheets = snapshot.voiceSheets
    .filter((v) => appearingChars.has(v.characterId))
    .sort((a, b) => a.characterId.localeCompare(b.characterId))

  // --- Budgeting: seksi keras tak dipotong; fakta relevan & rollup dipangkas
  //     bila melebihi cap. Load-bearing tak pernah dipangkas.
  const excludedIds: string[] = []
  const includedIds: string[] = []

  const factsCap = Math.floor(totalBudget * BUDGET_ALLOCATION.facts)
  const loadBearingCost = loadBearing.reduce(
    (n, f) => n + estimateTokens(f.statement),
    0,
  )
  let factsUsed = loadBearingCost
  loadBearing.forEach((f) => includedIds.push(f.id))

  const keptFacts: Fact[] = []
  let factsTrimmed = false
  for (const { fact } of otherFacts) {
    const cost = estimateTokens(fact.statement)
    if (factsUsed + cost <= factsCap) {
      keptFacts.push(fact)
      includedIds.push(fact.id)
      factsUsed += cost
    } else {
      excludedIds.push(fact.id)
      factsTrimmed = true
    }
  }

  // Rollups + summaries cap: kompres T2 tertua dulu (di sini T1 rollups saja;
  // bila melebihi cap, buang rollup tertua).
  const rollupCap = Math.floor(totalBudget * BUDGET_ALLOCATION.rollupsSummaries)
  const keptRollups: ActRollup[] = []
  let rollupUsed = 0
  let rollupsTrimmed = false
  // Pertahankan yang terbaru dulu (paling relevan), buang tertua bila overflow.
  for (const r of [...actRollups].reverse()) {
    const cost = estimateTokens(r.summary)
    if (rollupUsed + cost <= rollupCap) {
      keptRollups.unshift(r)
      includedIds.push(`rollup:act${r.actNumber}`)
      rollupUsed += cost
    } else {
      excludedIds.push(`rollup:act${r.actNumber}`)
      rollupsTrimmed = true
    }
  }

  const safetyUsed = estimateTokens('safety hard rules baseline')
  const t0Used =
    estimateTokens(JSON.stringify(snapshot.storyId)) +
    snapshot.characters
      .filter((c) => c.role.toLowerCase().includes('protagonis') || c.introducedChapter === 1)
      .reduce((n, c) => n + estimateTokens(c.motivation), 0)
  const blueprintUsed = blueprint
    ? estimateTokens(blueprint.chapterGoal) +
      blueprint.forbiddenReveals.reduce((n, r) => n + estimateTokens(r), 0)
    : 0
  const stateUsed = activeThreads.reduce((n, t) => n + estimateTokens(t.title), 0)
  const voiceUsed = voiceSheets.reduce(
    (n, v) => n + estimateTokens(v.register) + v.sampleLines.reduce((m, s) => m + estimateTokens(s), 0),
    0,
  )

  const budgetReport: BudgetReport = {
    totalBudget,
    used: safetyUsed + t0Used + blueprintUsed + stateUsed + factsUsed + rollupUsed + voiceUsed,
    perSection: {
      safety: { used: safetyUsed, cap: Math.floor(totalBudget * BUDGET_ALLOCATION.safety), trimmed: false },
      t0Canon: { used: t0Used, cap: Math.floor(totalBudget * BUDGET_ALLOCATION.t0Canon), trimmed: false },
      blueprint: { used: blueprintUsed, cap: Math.floor(totalBudget * BUDGET_ALLOCATION.blueprint), trimmed: false },
      currentState: { used: stateUsed, cap: Math.floor(totalBudget * BUDGET_ALLOCATION.currentState), trimmed: false },
      rollupsSummaries: { used: rollupUsed, cap: rollupCap, trimmed: rollupsTrimmed },
      facts: { used: factsUsed, cap: factsCap, trimmed: factsTrimmed },
      retrievalInstructions: { used: 0, cap: Math.floor(totalBudget * BUDGET_ALLOCATION.retrievalInstructions), trimmed: false },
    },
  }

  return {
    contextVersion: 1,
    storyId: snapshot.storyId,
    targetChapterNo: targetChapter,
    phase: blueprint?.phase ?? '',
    storyContractSummary: { storyId: snapshot.storyId },
    chapterGoal: blueprint?.chapterGoal ?? '',
    mandatoryBeats: blueprint?.mandatoryBeats ?? [],
    forbiddenReveals: blueprint?.forbiddenReveals ?? [],
    currentState: { activeThreads },
    loadBearingFacts: loadBearing,
    relevantFacts: keptFacts,
    actRollups: keptRollups,
    voiceSheets,
    contextBudgetReport: budgetReport,
    styleContractRef: 'lakoku_mobile_drama_v1',
    includedIds,
    excludedIds,
  }
}

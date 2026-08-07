/**
 * M10-C — deterministic story fixture for the isolated 50-chapter harness.
 *
 * Ported from the A1d.3b parity fixture and parametrized by `storyId` so the
 * same canonical sequence can be run in sync mode, worker mode, and forked
 * branch clones without cross-contamination.
 *
 * This module is pure data + pure functions. It performs no IO and holds no
 * runtime authority: it only describes the story contract, the typed blueprint
 * policy per chapter, and the deterministic structured state proposal per
 * chapter. Canonical state still advances exclusively through the production
 * publication path.
 */

import {
  buildBaselinePolicyForChapter,
  debtBackedThreadId,
  runtimeFactId,
  type AllowedChapterStatePolicyV1,
  type StructuredStateProposalV1,
} from '@lakoku/narrative-core'
import type { StoryContract } from '../../story-engine/story-contract'

export const HARNESS_FIXTURE_ID = 'm10c-brankas-50' as const
export const HARNESS_TOTAL_CHAPTERS = 50 as const

export const ACT_PLAN = [
  { actNumber: 1, fromChapter: 1, toChapter: 5, goal: 'Etablish dunia + misteri utama.' },
  { actNumber: 2, fromChapter: 6, toChapter: 12, goal: 'Eskalasi konflik + utang plot.' },
  { actNumber: 3, fromChapter: 13, toChapter: 50, goal: 'Resolusi + kunci babak akhir.' },
] as const

export const ACT_BOUNDARY_CHAPTERS: readonly number[] = ACT_PLAN.map((act) => act.toChapter)

export const PLOT_DEBTS = [
  {
    id: 'main_mystery',
    question: 'Siapa yang membuka brankas rahasia di lantai basement?',
    introducedAt: 1,
    mustProgressBy: [12, 32, 45],
    mustCloseBy: 48,
    status: 'open' as const,
  },
  {
    id: 'debt:a',
    question: 'Apa isi surat yang baru ditemukan di brankas?',
    introducedAt: 1,
    mustProgressBy: [1, 3],
    mustCloseBy: 8,
    status: 'open' as const,
  },
]

export const ENDINGS = [
  { key: 'ending-open', name: 'Jalan Terbuka', condition: 'Surat terbaca', requiredClosure: ['debt:a'] },
  { key: 'ending-gelap', name: 'Rahasia Terkubur', condition: 'Surat ditutup', requiredClosure: ['main_mystery'] },
]

export const REVEALS = [{ secretId: 'secret:brankas', revealGateChapter: 3 }]

export const CHARACTERS = [
  { id: 'char:hero', name: 'Aku', role: 'Protagonis', introducedChapter: 1 },
  { id: 'char:rival', name: 'Raka', role: 'Rival', introducedChapter: 1 },
]

export const CH1_FACT_STATEMENT = 'Surat tak bernama ditemukan di balik brankas basemen.'

/** Chapters whose deterministic proposal carries a LOAD_BEARING payoff. */
export const CH1_FACT_PAYOFF_CHAPTER = 2

/**
 * C-R1 G4-STALE (NCS §4.2): explicit main_mystery callback touches.
 *
 * Now that the production runtime MARKS staleness (post-publication lifecycle
 * hook) and Layer A enforcement can bite (THREAD_STALE_UNADDRESSED MAJOR →
 * FAILED_REVIEW_REQUIRED), the authoring plan must keep every active thread
 * referenced at least once every STALE_AFTER_CHAPTERS chapters. Debt-driven
 * progress already touches at Bab 12/32/45 and Bab 46/47 advance the
 * PAYOFF_DUE thread (G4 no-new-thread rule); these callback touches close the
 * remaining gaps so the largest gap is exactly 6 (1→6→12→18→24→30→32→38→44→
 * 45→46→47→48). This is the planner discipline NCS §6 step 2 demands — a
 * CONSEQUENCE of enforcement becoming real, proven necessary by the
 * staleness regression test (without it the run fails closed at Bab 22).
 */
export const MAIN_MYSTERY_CALLBACK_CHAPTERS: readonly number[] = [6, 18, 24, 30, 38, 44]

/** Debt-driven progress chapters also touch the backing thread (applier). */
export const MAIN_MYSTERY_PROGRESS_CHAPTERS: readonly number[] = [12, 32, 45]

/** All main_mystery touch sources, for the staleness-cadence regression test. */
export function mainMysteryTouchChapters(): number[] {
  return [
    1, // seeded: thread opens at Bab 1
    ...MAIN_MYSTERY_CALLBACK_CHAPTERS,
    ...MAIN_MYSTERY_PROGRESS_CHAPTERS,
    46,
    47,
    48, // closure resolves the thread (terminal — cadence ends)
  ].sort((a, b) => a - b)
}

export function harnessFactId(storyId: string, chapterNumber = 1): string {
  return runtimeFactId({
    storyId,
    chapterNumber,
    subjectCharacterId: `${storyId}:char:hero`,
    statement: CH1_FACT_STATEMENT,
  })
}

export function buildHarnessContract(storyId: string): StoryContract {
  const chapterTargets = Array.from({ length: HARNESS_TOTAL_CHAPTERS }, (_, i) => ({
    chapterNumber: i + 1,
    phase: i < 5 ? 'BABAK_1' : i < 12 ? 'BABAK_2' : 'BABAK_3',
    goal: `Babat ${i + 1}: gerak maju misteri brankas.`,
    mustInclude: ['beat-utama'],
    mustNotReveal: [],
    emotionalTurn: 'Ketegangan naik.',
    expectedThreadMovement: [debtBackedThreadId(storyId, 'main_mystery')],
  }))
  return {
    storyId,
    totalChapters: HARNESS_TOTAL_CHAPTERS,
    title: 'Brankas Rahasia 50 Bab',
    genre: 'misteri',
    tone: 'gelap',
    styleProfile: 'lakoku_mobile_drama_v1',
    mainCharacter: {
      name: 'Aku',
      role: 'penjaga brankas',
      wound: 'kehilangan saudara',
      desire: 'tahu isi brankas',
    },
    mainConflict: 'Brankas menyimpan rahasia yang mengubur masa lalu.',
    finalQuestion: 'Siapa yang menutup surat terakhir?',
    corePromise: 'Satu surat, satu kebenaran bab-per-bab.',
    actPlan: ACT_PLAN.map((act) => ({ ...act })),
    chapterTargets,
    endingCandidates: ENDINGS,
    plotDebts: PLOT_DEBTS,
    revealRunway: REVEALS,
    closureRunway: {
      noNewMajorConflictAfter: 35,
      noNewThreadAfter: 40,
      endingLockChapter: 45,
      mainMysteryResolveBy: 48,
      emotionalResolutionChapter: 49,
      finalEndingChapter: 50,
    },
  }
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

function deepMerge<T>(base: T, override?: DeepPartial<T>): T {
  if (override === undefined) return base
  if (Array.isArray(base) || Array.isArray(override)) {
    return (override as unknown) as T
  }
  if (base && typeof base === 'object' && override && typeof override === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      out[k] = v !== undefined ? deepMerge(out[k], v as never) : out[k]
    }
    return out as T
  }
  return (override as unknown) as T
}

export function harnessBlueprintOverrides(
  storyId: string,
  n: number,
): DeepPartial<AllowedChapterStatePolicyV1> | undefined {
  if (n === 1) {
    // Thread touches/transitions come from the baseline policy (both threads are
    // debt-backed and inside their windows); only facts/knowledge/characters need
    // widening for the chapter-1 proposal.
    return {
      facts: { allowAdd: true, payableFactIds: [] },
      knowledge: { allowGrants: true },
      characters: { statusChangeCharacterIds: [`${storyId}:char:rival`] },
    }
  }
  if (n === 2) {
    return {
      facts: { allowAdd: false, payableFactIds: [harnessFactId(storyId)] },
    }
  }
  if (n === 8) return { plotDebts: { closureIds: ['debt:a'] } }
  if (n === 48) return { plotDebts: { closureIds: ['main_mystery'] } }
  return undefined
}

export function harnessPolicyForChapter(
  storyId: string,
  chapterNumber: number,
): AllowedChapterStatePolicyV1 {
  const base = buildBaselinePolicyForChapter({
    storyContract: buildHarnessContract(storyId),
    chapterNumber,
  })
  return deepMerge(base, harnessBlueprintOverrides(storyId, chapterNumber))
}

export function harnessProposalFor(
  storyId: string,
  chapterNumber: number,
): StructuredStateProposalV1 {
  const isActBoundary = ACT_BOUNDARY_CHAPTERS.includes(chapterNumber)
  const base: StructuredStateProposalV1 = {
    schemaVersion: 1,
    storyId,
    chapterNumber,
    facts: { add: [], markPaidOff: [] },
    knowledge: { grants: [] },
    secrets: { revealIds: [] },
    timeline: { append: [] },
    characters: { statusChanges: [] },
    threads: { touches: [], transitions: [] },
    plotDebts: { progress: [], closures: [] },
    actRollup: isActBoundary ? { summary: null } : null,
  }

  if (chapterNumber === 1) {
    return {
      ...base,
      facts: {
        add: [{ statement: CH1_FACT_STATEMENT, subjectCharacterId: `${storyId}:char:hero`, salience: 0.8 }],
        markPaidOff: [],
      },
      knowledge: {
        grants: [{ characterId: `${storyId}:char:hero`, factId: harnessFactId(storyId) }],
      },
      timeline: {
        append: [{
          ordinal: 0,
          description: 'Brankas terbuka dan surat ditemukan di lantai basement.',
          characterId: `${storyId}:char:hero`,
          occursAt: 10,
          isFlashback: false,
        }],
      },
      characters: { statusChanges: [{ characterId: `${storyId}:char:rival`, to: 'INACTIVE' }] },
      threads: { touches: [], transitions: [] },
      plotDebts: { progress: [{ debtId: 'debt:a', milestoneChapter: 1 }], closures: [] },
    }
  }
  if (chapterNumber === 2) {
    return {
      ...base,
      facts: { add: [], markPaidOff: [harnessFactId(storyId)] },
      threads: { touches: [], transitions: [] },
    }
  }
  if (chapterNumber === 3) {
    return {
      ...base,
      secrets: { revealIds: [`${storyId}:secret:brankas`] },
      plotDebts: { progress: [{ debtId: 'debt:a', milestoneChapter: 3 }], closures: [] },
    }
  }
  if (chapterNumber === 8) {
    return {
      ...base,
      plotDebts: { progress: [], closures: [{ debtId: 'debt:a', closureForm: 'RESOLVED' }] },
    }
  }
  if (chapterNumber === 12 || chapterNumber === 32 || chapterNumber === 45) {
    return {
      ...base,
      plotDebts: { progress: [{ debtId: 'main_mystery', milestoneChapter: chapterNumber }], closures: [] },
    }
  }
  // C-R1 G4-STALE callback touches (see MAIN_MYSTERY_CALLBACK_CHAPTERS): keep
  // the main mystery thread referenced within the 6-chapter staleness window.
  if (MAIN_MYSTERY_CALLBACK_CHAPTERS.includes(chapterNumber)) {
    return {
      ...base,
      threads: { touches: [debtBackedThreadId(storyId, 'main_mystery')], transitions: [] },
    }
  }
  // Bab 46-47: main_mystery already PAYOFF_DUE (final progress at Bab 45).
  // G4 requires chapters >= 41 to advance >= 1 PAYOFF_DUE thread.
  if (chapterNumber === 46 || chapterNumber === 47) {
    return {
      ...base,
      threads: { touches: [debtBackedThreadId(storyId, 'main_mystery')], transitions: [] },
    }
  }
  if (chapterNumber === 48) {
    return {
      ...base,
      plotDebts: { progress: [], closures: [{ debtId: 'main_mystery', closureForm: 'RESOLVED' }] },
    }
  }
  return base
}

import type { D1RubricId, D1Tier } from './corpus'

/** Semantic scenario directions. Fixture prose is generated from these frozen directions. */
export interface D1Scenario {
  focus: string
  strong: string
  weak: string
  borderline: string
  setup: string
  payoff: string
}

export const D1_SCENARIOS: Readonly<Record<D1RubricId, D1Scenario>> = {
  'D-R1': {
    focus: 'pacing between pressure, decision, and consequence',
    strong: 'Each beat changes available action; quiet moment sharpens coming decision.',
    weak: 'Scene circles same worry while deadline and situation remain unchanged.',
    borderline: 'Reflection has some pressure, but movement arrives late and lightly.',
    setup: 'At Bab 18, Sari learns bridge seals will close at dawn.',
    payoff: 'At Bab 20, Sari commits before patrol reaches bridge.',
  },
  'D-R2': {
    focus: 'traceable character progression under cost',
    strong: 'Protagonist makes a costly choice that differs from early defensive habit.',
    weak: 'Protagonist declares growth then repeats old avoidance without reckoning.',
    borderline: 'Protagonist attempts new conduct but explanation and consequence remain thin.',
    setup: 'At Bab 9, Sari hid evidence to avoid blame.',
    payoff: 'At Bab 22, Sari names her role publicly despite losing protection.',
  },
  'D-R3': {
    focus: 'conflict escalation and pressure contraction',
    strong: 'Opposition narrows options and makes delay costly without inventing a new feud.',
    weak: 'Threat is restated at same level; antagonist pressure does not alter choices.',
    borderline: 'A deadline appears, but opposition and stakes remain only partly concrete.',
    setup: 'At Bab 41, Regent takes control of city gates.',
    payoff: 'At Bab 46, Sari must cross one guarded gate before evidence is destroyed.',
  },
  'D-R4': {
    focus: 'semantic repetition across local and broader horizons',
    strong: 'Later scene changes tactic, setting, information, and emotional result.',
    weak: 'Later scene paraphrases prior confrontation and repeats revelation with no new meaning.',
    borderline: 'Later return deliberately echoes earlier scene but adds one modest new consequence.',
    setup: 'At Bab 14, Sari confronts Damar in archive; at Bab 16, they meet again.',
    payoff: 'At Bab 32, archive clue gains a different meaning during tribunal.',
  },
  'D-R5': {
    focus: 'material chapter purpose',
    strong: 'Chapter advances route, clue, relationship, or payoff in a visible way.',
    weak: 'Atmosphere and dialogue consume chapter without changing plot or character position.',
    borderline: 'Chapter gives emotional color and a small clue, yet central movement is slight.',
    setup: 'At Bab 24, Sari needs courier ledger to identify gate captain.',
    payoff: 'At Bab 25, one page identifies captain and closes safe route.',
  },
  'D-R6': {
    focus: 'proportional, understandable payoff after setup',
    strong: 'Payoff uses setup detail, requires choice, and changes relationship or future.',
    weak: 'Debt closes by declaration; setup detail and cost are ignored.',
    borderline: 'Payoff references setup but causal bridge or emotional cost is compressed.',
    setup: 'At Bab 6, Sari promises her brother she will return his compass after clearing his name.',
    payoff: 'At Bab 34, compass opens hidden ledger and Sari returns it only after admitting her silence.',
  },
  'D-R7': {
    focus: 'Bab 49 emotional resolution',
    strong: 'Full Bab 49 lets protagonist name changed wound and choose relationship or value.',
    weak: 'Full Bab 49 reaches logistics only; emotional beat is absent despite structural closure.',
    borderline: 'Full Bab 49 includes apology or feeling, but scene ends before emotional consequence lands.',
    setup: 'At Bab 45, Sari learns mother protected Regent to keep family alive.',
    payoff: 'At Bab 49, Sari decides whether to preserve bond after truth is spoken.',
  },
  'D-R8': {
    focus: 'ending satisfaction answering final dramatic question',
    strong: 'Runway prepares final choice; Bab 50 answers question and shows earned aftermath.',
    weak: 'Runway does not prepare answer; Bab 50 stops after victory or departure.',
    borderline: 'Bab 50 answers question, but runway or aftermath leaves answer under-earned.',
    setup: 'At Bab 44, Sari can expose Regent and trigger riots or reveal truth with witnesses.',
    payoff: 'At Bab 50, Sari chooses witnessed truth and accepts a slower justice.',
  },
}

export function paragraphForTier(
  rubricId: D1RubricId,
  tier: D1Tier,
  chapterNumber: number,
  variant: number,
): string {
  const scenario = D1_SCENARIOS[rubricId]
  const direction = tier === 'STRONG' ? scenario.strong : tier === 'WEAK' ? scenario.weak : scenario.borderline
  return `Bab ${chapterNumber}. ${direction} Sari menghitung bunyi lonceng ke-${variant + 1}, lalu memilih kata yang tidak bisa ia tarik kembali.`
}

import type { CanonSnapshot } from '../../lib/narrative/types'
import type { StoryContract, PlotDebt } from '../../lib/story-engine/story-contract'

/**
 * Fixture sintetis long-horizon untuk audit M10-A.
 * Pure data — tidak menyentuh DB, tidak ada import server-only.
 */

export interface ChoiceHistoryItemFixture {
  chapterNumber: number
  choiceId: string
  label: string
  consequence: string
  effectSummary: string
  flags: string[]
}

export function generateSyntheticChoices(count: number): ChoiceHistoryItemFixture[] {
  const choices: ChoiceHistoryItemFixture[] = []
  for (let i = 1; i <= count; i++) {
    choices.push({
      chapterNumber: i,
      choiceId: `choice_ch_${i}`,
      label: `Pilihan realistis Bab ${i}`,
      consequence: `Konsekuensi naratif nyata untuk keputusan Bab ${i}`,
      effectSummary: `Efek jangka panjang Bab ${i}`,
      flags: [`flag_ch_${i}`],
    })
  }
  return choices
}

/** CanonSnapshot yang tumbuh seiring chapter — fakta, thread, timeline, rollup bertambah. */
export function buildSyntheticCanonSnapshot(chapterNumber: number): CanonSnapshot {
  const factsCount = Math.floor(chapterNumber * 1.5)
  const facts = []
  for (let i = 1; i <= factsCount; i++) {
    facts.push({
      id: `fact_${i}`,
      storyId: 'synthetic_story_audit',
      statement: `Fakta penting nomor ${i} yang sudah terbentuk`,
      subjectCharacterId: i % 2 === 0 ? 'char_mc' : null,
      establishedChapter: Math.max(1, Math.floor(i / 1.5)),
      salience: i % 3 === 0 ? 3 : 2,
      loadBearing: i % 4 === 0,
      paidOff: false,
    })
  }

  const threadCount = Math.min(10, Math.floor(chapterNumber / 5) + 2)
  const threads: CanonSnapshot['threads'] = []
  for (let i = 1; i <= threadCount; i++) {
    threads.push({
      id: `thread_${i}`,
      title: `Alur Konflik Utama ${i}`,
      status: i === 1 ? 'RESOLVED' : 'DEVELOPING',
      openedChapter: Math.max(1, chapterNumber - (i % 5) - 2),
      lastTouchedChapter: Math.max(1, chapterNumber - (i % 5)),
      payoffWindow: null,
      isMainMystery: i === 1,
      stale: chapterNumber - Math.max(1, chapterNumber - (i % 5)) > 6,
      staleSinceChapter: chapterNumber - Math.max(1, chapterNumber - (i % 5)) > 6
        ? Math.max(1, chapterNumber - (i % 5))
        : null,
    })
  }

  const actRollups = []
  if (chapterNumber > 10) {
    actRollups.push({
      actNumber: 1,
      summary: 'Keluarga kerajaan runtuh akibat pengkhianatan penasihat utama.',
      stateDelta: { reputasiProtagonist: 'hancur' },
      coversFromChapter: 1,
      coversToChapter: 10,
    })
  }
  if (chapterNumber > 25) {
    actRollups.push({
      actNumber: 2,
      summary: 'Perjalanan pengasingan dan pengumpulan sekutu rahasia di perbatasan.',
      stateDelta: { dukunganFraksi: 'bayangan' },
      coversFromChapter: 11,
      coversToChapter: 25,
    })
  }

  const blueprints = []
  if (chapterNumber >= 20) {
    blueprints.push({
      chapterNumber: 20,
      version: 1,
      phase: 'RISING',
      chapterGoal: 'Versi pertama blueprint bab 20',
      mandatoryBeats: ['Beat awal'],
      forbiddenReveals: [],
      allowedStateDelta: {},
      introducesCharacters: [],
      reconciledFromVersion: null,
      reconciliationReason: null,
    })
    blueprints.push({
      chapterNumber: 20,
      version: 2,
      phase: 'RISING',
      chapterGoal: 'Versi kedua blueprint bab 20 (rekon)',
      mandatoryBeats: ['Beat awal', 'Beat rekon'],
      forbiddenReveals: ['secret_1'],
      allowedStateDelta: {},
      introducesCharacters: [],
      reconciledFromVersion: 1,
      reconciliationReason: 'Reconciliation setelah kontrak cerita diperbarui',
    })
  }

  return {
    storyId: 'synthetic_story_audit',
    characters: [
      {
        id: 'char_mc',
        storyId: 'synthetic_story_audit',
        canonicalName: 'Arya',
        role: 'Protagonist',
        motivation: 'Merebut kembali keadilan keluarga',
        introducedChapter: 1,
        status: 'ALIVE',
      },
      {
        id: 'char_antagonist',
        storyId: 'synthetic_story_audit',
        canonicalName: 'Patih Brama',
        role: 'Antagonist',
        motivation: 'Mempertahankan kekuasaan absolut',
        introducedChapter: 1,
        status: 'ALIVE',
      },
    ],
    aliases: [
      { characterId: 'char_mc', alias: 'Sang Bayangan', aliasType: 'TITLE' },
      { characterId: 'char_antagonist', alias: 'Patih Tangan Besi', aliasType: 'NICKNAME' },
    ],
    voiceSheets: [
      {
        characterId: 'char_mc',
        register: 'FORMAL_RESERVED',
        speechHabits: ['Bicara singkat', 'Menggunakan metafora alam'],
        forbiddenWords: ['gaul', 'santai'],
        sampleLines: ['"Keadilan tidak pernah datang sendiri."'],
      },
    ],
    facts,
    knowledge: [
      { characterId: 'char_mc', factId: 'fact_1', knownFromChapter: 1 },
      { characterId: 'char_antagonist', factId: 'fact_2', knownFromChapter: 2 },
    ],
    secrets: [
      {
        id: 'secret_1',
        description: 'Identitas asli Arya adalah pewaris tahta sah',
        revealGateChapter: 35,
        revealed: chapterNumber >= 35,
      },
    ],
    timeline: Array.from({ length: Math.min(chapterNumber, 20) }, (_, idx) => ({
      chapterNumber: idx + 1,
      ordinal: 1,
      description: `Peristiwa utama di bab ${idx + 1}`,
      isFlashback: false,
      occursAt: null,
    })),
    threads,
    actRollups,
    blueprints,
  }
}

/** StoryContract sintetis 50 bab dengan plot debt yang sesuai PlotDebtSchema asli. */
export function buildSyntheticStoryContract(): StoryContract {
  const plotDebts: PlotDebt[] = [
    {
      id: 'main_mystery',
      question: 'Misteri cincin stempel mendiang Raja',
      introducedAt: 5,
      mustProgressBy: [10, 20],
      mustCloseBy: 35,
      status: 'open',
    },
    {
      id: 'debt_2',
      question: 'Penindasan rakyat oleh pasukan penjaga',
      introducedAt: 12,
      mustProgressBy: [25],
      mustCloseBy: 45,
      status: 'open',
    },
  ]

  const chapterTargets = Array.from({ length: 50 }, (_, i) => ({
    chapterNumber: i + 1,
    phase: i + 1 <= 10 ? 'SETUP' : i + 1 <= 25 ? 'RISING' : i + 1 <= 40 ? 'CLIMAX' : 'RESOLUTION',
    goal: `Tujuan naratif bab ${i + 1}`,
    mustInclude: [`Elemen wajib bab ${i + 1}`],
    mustNotReveal: i + 1 < 35 ? ['secret_1'] : [],
    emotionalTurn: `Perubahan emosi bab ${i + 1}`,
    expectedThreadMovement: [`Pergerakan alur bab ${i + 1}`],
  }))

  return {
    storyId: 'synthetic_story_audit',
    totalChapters: 50,
    title: 'Bayangan Tahta',
    genre: 'NARRATIVE_FANTASY',
    tone: 'DRAMATIC',
    styleProfile: 'lakoku_mobile_drama_v2' as const,
    mainCharacter: {
      name: 'Arya',
      role: 'Pewaris tahta yang bersembunyi',
      wound: 'Dikhianati orang kepercayaan keluarga',
      desire: 'Mengembalikan keadilan atas nama mendiang ayah',
    },
    corePromise: 'Perjuangan membongkar kebenaran pengkhianatan istana.',
    mainConflict: 'Arya vs Patih Brama dalam perebutan bukti pengkhianatan.',
    finalQuestion: 'Apakah Arya akan mengorbankan dendam pribadi demi kedamaian negeri?',
    plotDebts,
    actPlan: [
      { actNumber: 1, fromChapter: 1, toChapter: 10, goal: 'Pengkhianatan terbongkar' },
      { actNumber: 2, fromChapter: 11, toChapter: 25, goal: 'Pengasingan & sekutu' },
      { actNumber: 3, fromChapter: 26, toChapter: 40, goal: 'Kembali merebut istana' },
      { actNumber: 4, fromChapter: 41, toChapter: 50, goal: 'Resolusi & takhta' },
    ],
    chapterTargets,
    endingCandidates: [
      {
        key: 'ending_A',
        name: 'Keadilan dan Mahkota',
        kind: 'main' as const,
        isSecret: false,
        condition: 'Arya merebut takhta dan menghukum Patih Brama',
        requiredClosure: ['main_mystery'],
        blockingConditions: [],
      },
      {
        key: 'ending_B',
        name: 'Pengasingan Sukarela',
        kind: 'main' as const,
        isSecret: false,
        condition: 'Arya memilih kedamaian dan menyerahkan takhta',
        requiredClosure: ['main_mystery'],
        blockingConditions: [],
      },
    ],
    revealRunway: [{ secretId: 'secret_1', revealGateChapter: 35 }],
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

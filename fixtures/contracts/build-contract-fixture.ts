import type {
  EndingCandidate,
  MainCharacter,
  PlotDebt,
  RevealRunwayEntry,
  StoryContract,
} from '@/lib/story-engine/story-contract'
import { parseStoryContract } from '@/lib/story-engine/story-contract'

interface FixtureMotifs {
  stakes: string
  relationship: string
  mystery: string
}

export interface BuildContractFixtureInput {
  storyId: string
  title: string
  genre: string
  tone: string
  mainCharacter: MainCharacter
  mainConflict: string
  finalQuestion: string
  corePromise: string
  endingCandidates: EndingCandidate[]
  plotDebts: PlotDebt[]
  revealRunway: RevealRunwayEntry[]
  motifs: FixtureMotifs
}

const ACT_DEFINITIONS = [
  { actNumber: 1, phase: 'Pijakan', fromChapter: 1, toChapter: 5, goal: 'Bangun dunia, luka tokoh, dan taruhan awal.' },
  { actNumber: 2, phase: 'Retak', fromChapter: 6, toChapter: 12, goal: 'Pecahkan rasa aman melalui benturan pertama.' },
  { actNumber: 3, phase: 'Terseret', fromChapter: 13, toChapter: 20, goal: 'Tarik tokoh lebih dalam menuju rahasia berbahaya.' },
  { actNumber: 4, phase: 'Titik Balik', fromChapter: 21, toChapter: 32, goal: 'Balik pemahaman tokoh dan arah perjuangannya.' },
  { actNumber: 5, phase: 'Menanjak', fromChapter: 33, toChapter: 40, goal: 'Naikkan taruhan dan uji aliansi utama.' },
  { actNumber: 6, phase: 'Krisis', fromChapter: 41, toChapter: 45, goal: 'Paksa pilihan yang tidak dapat ditarik kembali.' },
  { actNumber: 7, phase: 'Puncak', fromChapter: 46, toChapter: 48, goal: 'Bayar konflik utama melalui konfrontasi puncak.' },
  { actNumber: 8, phase: 'Bangkit', fromChapter: 49, toChapter: 50, goal: 'Tutup akibat pilihan dan tunjukkan hidup baru.' },
] as const

const GOAL_ACTIONS = [
  'menemukan petunjuk yang mengubah dugaan awal tentang',
  'menguji keberanian saat berhadapan dengan',
  'menghadapi konsekuensi baru dari',
  'membuat pilihan aktif untuk melindungi',
  'membongkar pertentangan di balik',
  'mempertaruhkan kepercayaan demi memahami',
] as const

const EMOTIONAL_TURNS = [
  'ragu menjadi tekad yang rapuh',
  'lega berubah menjadi curiga',
  'marah melunak menjadi empati yang tidak nyaman',
  'takut berubah menjadi keberanian terbuka',
  'percaya runtuh menjadi rasa dikhianati',
  'putus asa menemukan secercah kendali',
] as const

const THREAD_MOVEMENTS = [
  'petunjuk baru mempersempit sumber ancaman',
  'hubungan utama bergerak dari kerja sama menuju gesekan',
  'konsekuensi pilihan lama menaikkan taruhan pribadi',
  'kesaksian baru menghubungkan luka tokoh dengan konflik utama',
  'motif lawan terlihat, tetapi bukti penentu masih tertahan',
  'tokoh menukar rasa aman dengan kemajuan yang dapat diuji',
] as const

export function buildContractFixture(input: BuildContractFixtureInput): StoryContract {
  const actPlan = ACT_DEFINITIONS.map(({ phase: _phase, ...act }) => ({ ...act }))
  const chapterTargets = Array.from({ length: 50 }, (_, index) => {
    const chapterNumber = index + 1
    const act = ACT_DEFINITIONS.find((entry) => (
      chapterNumber >= entry.fromChapter && chapterNumber <= entry.toChapter
    ))!
    const revealHere = input.revealRunway.find((entry) => (
      entry.revealGateChapter === chapterNumber
    ))
    const action = GOAL_ACTIONS[index % GOAL_ACTIONS.length]
    const emotionalTurn = EMOTIONAL_TURNS[(index + act.actNumber) % EMOTIONAL_TURNS.length]
    const threadMovement = THREAD_MOVEMENTS[(index + act.actNumber * 2) % THREAD_MOVEMENTS.length]
    const actGate = chapterNumber === act.toChapter

    return {
      chapterNumber,
      phase: act.phase,
      goal: `${input.mainCharacter.name} ${action} ${input.motifs.mystery}, sambil menghadapi ${input.motifs.stakes}.`,
      mustInclude: [
        `Adegan konkret yang menguji ${input.motifs.relationship}.`,
        actGate
          ? `Keputusan gate fase ${act.phase} yang mengubah langkah berikutnya.`
          : `Bukti atau tindakan yang memajukan konflik fase ${act.phase}.`,
        ...(revealHere ? [`Buka rahasia terjadwal ${revealHere.secretId} melalui sebab-akibat yang terlihat.`] : []),
      ],
      mustNotReveal: input.revealRunway
        .filter((entry) => entry.revealGateChapter > chapterNumber)
        .map((entry) => entry.secretId),
      emotionalTurn: `${input.mainCharacter.name} bergerak dari ${emotionalTurn} karena pilihan bab ini.`,
      expectedThreadMovement: [
        `${threadMovement}; benang ${input.motifs.mystery} bergerak menuju pembayaran fase ${act.phase}.`,
      ],
    }
  })

  return parseStoryContract({
    storyId: input.storyId,
    totalChapters: 50,
    title: input.title,
    genre: input.genre,
    tone: input.tone,
    styleProfile: 'lakoku_mobile_drama_v1',
    mainCharacter: { ...input.mainCharacter },
    mainConflict: input.mainConflict,
    finalQuestion: input.finalQuestion,
    corePromise: input.corePromise,
    actPlan,
    chapterTargets,
    endingCandidates: input.endingCandidates.map((ending) => ({
      ...ending,
      requiredClosure: [...ending.requiredClosure],
    })),
    plotDebts: input.plotDebts.map((debt) => ({
      ...debt,
      mustProgressBy: [...debt.mustProgressBy],
    })),
    revealRunway: input.revealRunway.map((reveal) => ({ ...reveal })),
    closureRunway: {
      noNewMajorConflictAfter: 35,
      noNewThreadAfter: 40,
      endingLockChapter: 45,
      mainMysteryResolveBy: 48,
      emotionalResolutionChapter: 49,
      finalEndingChapter: 50,
    },
  })
}

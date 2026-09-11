/**
 * Fixture deterministik cerita 50 bab untuk simulasi Layer A (M3, Exit Criteria).
 *
 * Membangun CanonSnapshot yang konsisten + generator ChapterDraft yang valid
 * per bab. Drama keluarga "Warisan yang Terkubur" — 8 act, reveal gate di
 * Bab 12/20/32/45, karakter baru terencana (Bab 33) via blueprint.
 */

import type {
  CanonSnapshot,
  ChapterDraft,
  Character,
  ChapterBlueprint,
} from '@/lib/narrative/types'

export const FIXTURE_STORY_ID = 'fixture:warisan-terkubur'

const characters: Character[] = [
  { id: 'char:rani', storyId: FIXTURE_STORY_ID, canonicalName: 'Rani', role: 'protagonis', motivation: 'Mengungkap kebenaran warisan ayahnya', introducedChapter: 1, status: 'ALIVE' },
  { id: 'char:bu-ratna', storyId: FIXTURE_STORY_ID, canonicalName: 'Ratna', role: 'antagonis', motivation: 'Melindungi rahasia keluarga', introducedChapter: 1, status: 'ALIVE' },
  { id: 'char:dimas', storyId: FIXTURE_STORY_ID, canonicalName: 'Dimas', role: 'pendukung', motivation: 'Membantu Rani sambil menyimpan agenda', introducedChapter: 2, status: 'ALIVE' },
  { id: 'char:pak-hendra', storyId: FIXTURE_STORY_ID, canonicalName: 'Hendra', role: 'pendukung', motivation: 'Notaris yang menyimpan wasiat', introducedChapter: 5, status: 'ALIVE' },
  // Karakter baru terencana muncul di Bab 33 (harus ada di blueprint bab 33).
  { id: 'char:sari', storyId: FIXTURE_STORY_ID, canonicalName: 'Sari', role: 'pendukung', motivation: 'Saksi masa lalu yang kembali', introducedChapter: 33, status: 'ALIVE' },
]

const aliases = [
  { characterId: 'char:bu-ratna', alias: 'Bu Ratna', aliasType: 'NAME' as const },
  { characterId: 'char:bu-ratna', alias: 'ibu mertua', aliasType: 'RELATION' as const },
  { characterId: 'char:bu-ratna', alias: 'mama', aliasType: 'RELATION' as const },
  { characterId: 'char:pak-hendra', alias: 'Pak Hendra', aliasType: 'NAME' as const },
  { characterId: 'char:pak-hendra', alias: 'notaris', aliasType: 'TITLE' as const },
  { characterId: 'char:rani', alias: 'Ran', aliasType: 'NICKNAME' as const },
]

const secrets = [
  { id: 'secret:wasiat-palsu', description: 'Wasiat asli dipalsukan Ratna', revealGateChapter: 12, revealed: false },
  { id: 'secret:ayah-hidup', description: 'Ayah Rani ternyata masih hidup', revealGateChapter: 20, revealed: false },
  { id: 'secret:dimas-anak', description: 'Dimas adalah anak tersembunyi', revealGateChapter: 32, revealed: false },
  { id: 'secret:pembunuhan', description: 'Kematian kakek bukan kecelakaan', revealGateChapter: 45, revealed: false },
]

// Fakta canon; sebagian LOAD_BEARING (prasyarat reveal gate).
const facts = [
  { id: 'fact:surat-wasiat', storyId: FIXTURE_STORY_ID, statement: 'Ada surat wasiat di brankas notaris', subjectCharacterId: 'char:pak-hendra', establishedChapter: 5, salience: 0.8, loadBearing: true, paidOff: false },
  { id: 'fact:cincin-ayah', storyId: FIXTURE_STORY_ID, statement: 'Cincin ayah hilang saat pemakaman', subjectCharacterId: 'char:rani', establishedChapter: 3, salience: 0.6, loadBearing: true, paidOff: false },
  { id: 'fact:rumah-tua', storyId: FIXTURE_STORY_ID, statement: 'Rumah tua di desa milik keluarga', subjectCharacterId: null, establishedChapter: 2, salience: 0.4, loadBearing: false, paidOff: false },
  { id: 'fact:foto-lama', storyId: FIXTURE_STORY_ID, statement: 'Foto lama menunjukkan orang tak dikenal', subjectCharacterId: 'char:bu-ratna', establishedChapter: 8, salience: 0.5, loadBearing: false, paidOff: false },
]

// Knowledge scope: Rani tahu tentang surat wasiat & cincin sejak diperkenalkan.
const knowledge = [
  { characterId: 'char:rani', factId: 'fact:cincin-ayah', knownFromChapter: 3 },
  { characterId: 'char:rani', factId: 'fact:surat-wasiat', knownFromChapter: 6 },
  { characterId: 'char:rani', factId: 'fact:rumah-tua', knownFromChapter: 2 },
  { characterId: 'char:bu-ratna', factId: 'fact:foto-lama', knownFromChapter: 8 },
  { characterId: 'char:pak-hendra', factId: 'fact:surat-wasiat', knownFromChapter: 5 },
]

const threads = [
  { id: 'thread:warisan', title: 'Misteri warisan keluarga', status: 'OPEN' as const, openedChapter: 1, lastTouchedChapter: 1, payoffWindow: 45, isMainMystery: true },
  { id: 'thread:cinta', title: 'Hubungan Rani dan Dimas', status: 'OPEN' as const, openedChapter: 2, lastTouchedChapter: 2, payoffWindow: 40, isMainMystery: false },
]

const voiceSheets = [
  { characterId: 'char:rani', register: 'informal, emosional', speechHabits: ['sering bertanya balik'], forbiddenWords: ['sumpah'], sampleLines: ['Aku nggak akan berhenti sampai tahu kebenarannya.'] },
  { characterId: 'char:bu-ratna', register: 'formal, dingin', speechHabits: ['kalimat pendek menusuk'], forbiddenWords: [], sampleLines: ['Kamu tidak akan mengerti pengorbanan ini.'] },
]

// 8 act × ~6-7 bab. Act rollups untuk act yang sudah selesai (dipakai compiler).
const actRanges = [
  { act: 1, from: 1, to: 6 },
  { act: 2, from: 7, to: 12 },
  { act: 3, from: 13, to: 19 },
  { act: 4, from: 20, to: 25 },
  { act: 5, from: 26, to: 32 },
  { act: 6, from: 33, to: 39 },
  { act: 7, from: 40, to: 45 },
  { act: 8, from: 46, to: 50 },
]

const actRollups = actRanges.slice(0, 7).map((r) => ({
  actNumber: r.act,
  summary: `Rangkuman act ${r.act}: perkembangan konflik warisan dari Bab ${r.from} sampai ${r.to}.`,
  stateDelta: { [`act${r.act}_done`]: true },
  coversFromChapter: r.from,
  coversToChapter: r.to,
}))

function phaseFor(chapter: number): string {
  const r = actRanges.find((x) => chapter >= x.from && chapter <= x.to)
  return `ACT_${r?.act ?? 1}`
}

/** Blueprint per bab: allowed_state_delta konsisten dengan yang diusulkan draft. */
function buildBlueprints(): ChapterBlueprint[] {
  const bps: ChapterBlueprint[] = []
  for (let n = 1; n <= 50; n++) {
    const introduces: string[] = []
    if (n === 33) introduces.push('char:sari') // karakter baru terencana pasca Bab 30
    bps.push({
      chapterNumber: n,
      version: 1,
      phase: phaseFor(n),
      chapterGoal: `Mengembangkan konflik menuju titik bab ${n}.`,
      mandatoryBeats: [`beat utama bab ${n}`],
      forbiddenReveals: secrets.filter((s) => s.revealGateChapter > n).map((s) => s.id),
      allowedStateDelta: { [`chapter${n}_progress`]: true, tension: true },
      introducesCharacters: introduces,
      reconciledFromVersion: null,
      reconciliationReason: null,
    })
  }
  return bps
}

export function buildFixtureSnapshot(): CanonSnapshot {
  return {
    storyId: FIXTURE_STORY_ID,
    characters,
    aliases,
    voiceSheets,
    facts,
    knowledge,
    secrets,
    timeline: [],
    threads,
    actRollups,
    blueprints: buildBlueprints(),
  }
}

/**
 * Hasilkan draft VALID deterministik untuk sebuah bab.
 * Mematuhi seluruh 8 cek Layer A.
 */
export function buildValidDraft(
  snapshot: CanonSnapshot,
  chapter: number,
): ChapterDraft {
  // Karakter yang boleh muncul: sudah diperkenalkan & tidak INACTIVE.
  const available = snapshot.characters.filter(
    (c) => c.introducedChapter <= chapter && c.status !== 'DEAD',
  )
  // Pilih hingga 2 karakter secara deterministik.
  const cast = available.slice(0, 2)

  // Event non-flashback dengan occursAt monoton.
  const events = cast.map((c, i) => ({
    characterMention: i === 0 ? c.canonicalName : (snapshot.aliases.find((a) => a.characterId === c.id)?.alias ?? c.canonicalName),
    description: `${c.canonicalName} melakukan aksi di bab ${chapter}`,
    ordinal: i,
    occursAt: chapter * 10 + i,
    isFlashback: false,
  }))

  // Knowledge assertion hanya untuk fakta yang benar-benar diketahui.
  const knowledgeAssertions = snapshot.knowledge
    .filter((k) => k.knownFromChapter <= chapter && cast.some((c) => c.id === k.characterId))
    .slice(0, 1)
    .map((k) => ({
      characterMention:
        snapshot.characters.find((c) => c.id === k.characterId)?.canonicalName ?? k.characterId,
      factId: k.factId,
    }))

  // Reveal hanya bila gate sudah terbuka pada bab ini.
  const reveals = snapshot.secrets
    .filter((s) => s.revealGateChapter === chapter)
    .map((s) => ({ secretId: s.id }))

  // Karakter baru bernama: hanya Bab 33 memperkenalkan Sari (ada di blueprint).
  const newNamedCharacters = chapter === 33 ? ['char:sari'] : []

  // Paragraf ~900 kata (soft 850–950; hard 800–1000), 3 scene.
  const paragraphs = [
    fillWords(`Scene satu bab ${chapter}.`, 300),
    fillWords(`Scene dua bab ${chapter}.`, 300),
    fillWords(`Scene tiga bab ${chapter}.`, 300),
  ]
  const wordCount = paragraphs.reduce((n, p) => n + p.trim().split(/\s+/).length, 0)

  return {
    storyId: snapshot.storyId,
    chapterNumber: chapter,
    title: `Bab ${chapter}`,
    paragraphs,
    wordCount,
    sceneCount: 3,
    hasChoiceOrGate: true,
    events,
    knowledgeAssertions,
    reveals,
    proposedStateDelta: { [`chapter${chapter}_progress`]: true },
    newNamedCharacters,
  }
}

function fillWords(seed: string, target: number): string {
  const words = seed.split(/\s+/)
  while (words.length < target) words.push('kata')
  return words.join(' ')
}

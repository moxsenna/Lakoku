/**
 * Compile story bible draft → CanonSnapshot (T7.4).
 *
 * Merakit konten AI (premis/cast/mystery/world) menjadi snapshot canon lengkap,
 * lalu MENURUNKAN blueprint 50 bab secara DETERMINISTIK via buildBlueprints()
 * dari template. Posisi reveal gate & struktur act TIDAK berasal dari AI.
 */
import {
  buildBlueprints,
  actForChapter,
  ACTS,
  type CanonSnapshot,
  type Character,
  type CharacterAlias,
  type VoiceSheet,
  type Fact,
  type KnowledgeScope,
  type SecretReveal,
  type StoryThread,
  type ActRollup,
} from '@lakoku/narrative-core'
import type { StoryBibleDraft } from './schema'

/** Slugify Bahasa Indonesia sederhana untuk id stabil. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48) || 'item'
}

export interface CompileResult {
  storyId: string
  snapshot: CanonSnapshot
  meta: {
    title: string
    tagline: string
    role: string
    synopsis: string
    tropes: string[]
  }
}

export function compileStoryBible(draft: StoryBibleDraft, storyIdInput?: string): CompileResult {
  const { premise, cast, mystery, world } = draft
  const storyId = storyIdInput?.trim() || slugify(premise.title)

  // --- Karakter + id stabil (dedup slug). ---
  const idByName = new Map<string, string>()
  const usedIds = new Set<string>()
  const characters: Character[] = cast.characters.map((c) => {
    // Id di-scope per-story: pkey global tabel canon, cegah tabrakan lintas cerita.
    const slug = slugify(c.canonicalName)
    let id = `${storyId}:char:${slug}`
    let n = 2
    while (usedIds.has(id)) id = `${storyId}:char:${slug}-${n++}`
    usedIds.add(id)
    idByName.set(c.canonicalName, id)
    return {
      id,
      storyId,
      canonicalName: c.canonicalName,
      role: c.role,
      motivation: c.motivation,
      introducedChapter: c.introducedChapter,
      status: 'ALIVE',
    }
  })

  const aliases: CharacterAlias[] = cast.characters.flatMap((c) =>
    c.aliases.map((a) => ({
      characterId: idByName.get(c.canonicalName)!,
      alias: a.alias,
      aliasType: a.aliasType,
    })),
  )

  const voiceSheets: VoiceSheet[] = cast.characters.map((c) => ({
    characterId: idByName.get(c.canonicalName)!,
    register: c.voice.register,
    speechHabits: c.voice.speechHabits,
    forbiddenWords: c.voice.forbiddenWords,
    sampleLines: c.voice.sampleLines,
  }))

  // --- Fakta + knowledge scope (subjek tahu faktanya sejak established). ---
  const facts: Fact[] = world.facts.map((f, i) => ({
    id: `${storyId}:fact-${i + 1}`,
    storyId,
    statement: f.statement,
    subjectCharacterId: f.subjectName ? idByName.get(f.subjectName) ?? null : null,
    establishedChapter: f.establishedChapter,
    salience: f.salience,
    loadBearing: f.loadBearing,
    paidOff: false,
  }))

  const knowledge: KnowledgeScope[] = facts
    .filter((f) => f.subjectCharacterId)
    .map((f) => ({
      characterId: f.subjectCharacterId as string,
      factId: f.id,
      knownFromChapter: f.establishedChapter,
    }))

  // --- Rahasia terjadwal (gate dari AI, sudah divalidasi ⊆ template gates). ---
  const secrets: SecretReveal[] = mystery.secrets.map((s, i) => ({
    id: `${storyId}:secret-${i + 1}`,
    description: s.description,
    revealGateChapter: s.revealGateChapter,
    revealed: false,
  }))

  // --- Threads: misteri utama + thread tambahan. ---
  const threads: StoryThread[] = [
    {
      id: `${storyId}:thread-main`,
      title: mystery.mainMystery.title,
      status: 'OPEN',
      openedChapter: 1,
      lastTouchedChapter: 1,
      payoffWindow: mystery.mainMystery.payoffWindow,
      isMainMystery: true,
      stale: false,
      staleSinceChapter: null,
    },
    ...world.threads.map((t, i) => ({
      id: `${storyId}:thread-${i + 1}`,
      title: t.title,
      status: 'OPEN' as const,
      openedChapter: t.openedChapter,
      lastTouchedChapter: t.openedChapter,
      payoffWindow: t.payoffWindow,
      isMainMystery: false,
      stale: false,
      staleSinceChapter: null,
    })),
  ]

  // --- Seed act rollup (act 1) agar rollup chain punya titik awal. ---
  const act1 = ACTS[0]
  const actRollups: ActRollup[] = [
    {
      actNumber: act1.actNumber,
      summary: `${premise.synopsis} (fase ${act1.phase})`,
      stateDelta: {},
      coversFromChapter: act1.fromChapter,
      coversToChapter: act1.toChapter,
    },
  ]

  // --- Blueprint 50 bab: DETERMINISTIK dari template. ---
  const plannedIntroductions: Record<number, string[]> = {}
  for (const c of characters) {
    const ch = c.introducedChapter
    ;(plannedIntroductions[ch] ??= []).push(c.id)
  }
  const blueprints = buildBlueprints({ storyId, secrets, plannedIntroductions })

  // Timeline seed kosong (diisi saat generasi bab).
  const snapshot: CanonSnapshot = {
    storyId,
    characters,
    aliases,
    voiceSheets,
    facts,
    knowledge,
    secrets,
    timeline: [],
    threads,
    actRollups,
    blueprints,
  }

  // Sentuh actForChapter agar konsistensi rentang tervalidasi sejak awal.
  actForChapter(1)

  return {
    storyId,
    snapshot,
    meta: {
      title: premise.title,
      tagline: premise.tagline,
      role: premise.role,
      synopsis: premise.synopsis,
      tropes: premise.tropes,
    },
  }
}

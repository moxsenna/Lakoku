/**
 * M10-A1 — In-memory state preview (plan §27), pure.
 *
 * `applyChapterStateDeltaToSnapshot()` menerapkan delta yang sudah tervalidasi
 * ke CanonSnapshot dan mengembalikan SNAPSHOT BARU (input tidak pernah
 * dimutasi). Dipakai sebagai preview deterministik dan oracle pengujian:
 *
 *   snapshot N + delta N = expected snapshot N+1
 *
 * Jika semantics SQL (A1c) dan preview ini berbeda, test wajib gagal.
 *
 * Plot-debt progress/closure BUKAN bagian CanonSnapshot (state-nya hidup di
 * reader_plot_debt_progress/reader_plot_debt_closures); kategori tersebut
 * diterapkan di lapisan DB via CommittedChapterStateDelta.
 */

import type { CanonSnapshot, CharacterStatus } from './types'
import {
  canonicalizeChapterStateDelta,
  type ChapterStateDeltaV1,
} from './chapter-state-delta'
import { canTransition } from './threads'

// ---------- Transisi status karakter (plan §16) ----------

/** DEAD terminal — tidak ada resurrection. */
const LEGAL_CHARACTER_TRANSITIONS: Record<CharacterStatus, readonly CharacterStatus[]> = {
  ALIVE: ['INACTIVE', 'DEAD'],
  INACTIVE: ['ALIVE', 'DEAD'],
  DEAD: [],
}

export function canTransitionCharacterStatus(
  from: CharacterStatus,
  to: CharacterStatus,
): boolean {
  return from !== to && LEGAL_CHARACTER_TRANSITIONS[from].includes(to)
}

/** Guard fail-closed: kondisi tidak mungkin bila resolver sudah benar. */
export class StateApplyError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'StateApplyError'
    this.code = code
  }
}

/**
 * Terapkan delta ke snapshot. Returns new immutable snapshot.
 * Throws StateApplyError (kode STATE_*_CONFLICT) bila delta bertabrakan
 * dengan state snapshot — mencegah korupsi canon.
 */
export function applyChapterStateDeltaToSnapshot(
  snapshot: CanonSnapshot,
  deltaInput: ChapterStateDeltaV1,
): CanonSnapshot {
  const delta = canonicalizeChapterStateDelta(deltaInput)
  const chapter = delta.chapterNumber

  if (delta.storyId !== snapshot.storyId) {
    throw new StateApplyError(
      'STATE_DELTA_INVALID',
      `Delta storyId "${delta.storyId}" tidak cocok dengan snapshot "${snapshot.storyId}".`,
    )
  }

  const characterIds = new Set(snapshot.characters.map((character) => character.id))

  // ---------- facts ----------

  const existingFactIds = new Set(snapshot.facts.map((fact) => fact.id))
  const addedFactIds = new Set(delta.facts.add.map((added) => added.id))
  for (const addedId of addedFactIds) {
    if (existingFactIds.has(addedId)) {
      throw new StateApplyError(
        'STATE_FACT_CONFLICT',
        `Fakta "${addedId}" sudah ada — add bertabrakan.`,
      )
    }
  }
  for (const paidOffId of delta.facts.markPaidOff) {
    if (!existingFactIds.has(paidOffId)) {
      throw new StateApplyError(
        'STATE_FACT_CONFLICT',
        `markPaidOff menyebut fakta tak dikenal "${paidOffId}".`,
      )
    }
    if (addedFactIds.has(paidOffId)) {
      throw new StateApplyError(
        'STATE_FACT_CONFLICT',
        `Fakta "${paidOffId}" ditambahkan dan ditandai paid-off di delta yang sama.`,
      )
    }
  }

  const facts: CanonSnapshot['facts'] = []
  for (const fact of snapshot.facts) {
    if (delta.facts.markPaidOff.includes(fact.id)) {
      facts.push({ ...fact, paidOff: true })
    } else {
      facts.push(fact)
    }
  }
  for (const added of delta.facts.add) {
    facts.push({
      id: added.id,
      storyId: snapshot.storyId,
      statement: added.statement,
      subjectCharacterId: added.subjectCharacterId,
      establishedChapter: chapter,
      salience: added.salience,
      // Fakta buatan runtime tidak pernah load-bearing (bootstrap saja).
      loadBearing: false,
      paidOff: false,
    })
  }

  // ---------- knowledge ----------

  const knowledge: CanonSnapshot['knowledge'] = [...snapshot.knowledge]
  const grantKeys = new Set(knowledge.map((grant) => `${grant.characterId}\u0000${grant.factId}`))
  for (const grant of delta.knowledge.grants) {
    if (!existingFactIds.has(grant.factId) && !addedFactIds.has(grant.factId)) {
      throw new StateApplyError(
        'STATE_KNOWLEDGE_CONFLICT',
        `Grant pengetahuan menyebut fakta tak dikenal "${grant.factId}".`,
      )
    }
    if (!characterIds.has(grant.characterId)) {
      throw new StateApplyError(
        'STATE_KNOWLEDGE_CONFLICT',
        `Grant pengetahuan menyebut karakter tak dikenal "${grant.characterId}".`,
      )
    }
    const key = `${grant.characterId}\u0000${grant.factId}`
    if (grantKeys.has(key)) {
      throw new StateApplyError(
        'STATE_KNOWLEDGE_CONFLICT',
        `Grant pengetahuan "${grant.characterId} mengetahui ${grant.factId}" sudah ada.`,
      )
    }
    grantKeys.add(key)
    knowledge.push({
      characterId: grant.characterId,
      factId: grant.factId,
      knownFromChapter: chapter,
    })
  }

  // ---------- secrets ----------

  const secretById = new Map(snapshot.secrets.map((secret) => [secret.id, secret]))
  const revealSet = new Set(delta.secrets.revealIds)
  for (const revealId of revealSet) {
    const secret = secretById.get(revealId)
    if (!secret) {
      throw new StateApplyError(
        'STATE_SECRET_CONFLICT',
        `Reveal menyebut rahasia tak dikenal "${revealId}".`,
      )
    }
    if (secret.revealGateChapter > chapter) {
      throw new StateApplyError(
        'STATE_SECRET_CONFLICT',
        `Rahasia "${revealId}" gate-nya Bab ${secret.revealGateChapter}, belum boleh dibuka di Bab ${chapter}.`,
      )
    }
  }
  const secrets: CanonSnapshot['secrets'] = snapshot.secrets.map((secret) => (
    revealSet.has(secret.id) ? { ...secret, revealed: true } : secret
  ))

  // ---------- timeline ----------

  const timeline: CanonSnapshot['timeline'] = [
    ...snapshot.timeline,
    ...delta.timeline.append.map((event) => ({
      chapterNumber: chapter,
      ordinal: event.ordinal,
      description: event.description,
      isFlashback: event.isFlashback,
      occursAt: event.occursAt,
    })),
  ]

  // ---------- characters ----------

  const characters: CanonSnapshot['characters'] = []
  const characterIndex = new Map<string, number>()
  snapshot.characters.forEach((character, index) => {
    characterIndex.set(character.id, index)
    characters.push(character)
  })
  const statusById = new Map(
    snapshot.characters.map((character) => [character.id, character.status]),
  )
  for (const change of delta.characters.statusChanges) {
    const index = characterIndex.get(change.characterId)
    if (index === undefined) {
      throw new StateApplyError(
        'STATE_CHARACTER_CONFLICT',
        `Status change menyebut karakter tak dikenal "${change.characterId}".`,
      )
    }
    if (statusById.get(change.characterId) !== change.from) {
      throw new StateApplyError(
        'STATE_CHARACTER_CONFLICT',
        `Status "${change.characterId}" saat ini ${statusById.get(change.characterId)}, delta menyatakan from=${change.from}.`,
      )
    }
    if (!canTransitionCharacterStatus(change.from, change.to)) {
      throw new StateApplyError(
        'STATE_CHARACTER_CONFLICT',
        `Transisi status karakter ilegal: ${change.characterId} ${change.from} → ${change.to}.`,
      )
    }
    characters[index] = { ...characters[index], status: change.to }
    statusById.set(change.characterId, change.to)
  }

  // ---------- threads ----------

  const threads: CanonSnapshot['threads'] = [...snapshot.threads]
  const threadIndex = new Map(threads.map((thread, index) => [thread.id, index]))
  const threadStatusById = new Map(threads.map((thread) => [thread.id, thread.status]))
  for (const touchId of delta.threads.touches) {
    const index = threadIndex.get(touchId)
    if (index === undefined) {
      throw new StateApplyError(
        'STATE_THREAD_CONFLICT',
        `Touch menyebut thread tak dikenal "${touchId}".`,
      )
    }
    const current = threads[index]
    threads[index] = {
      ...current,
      lastTouchedChapter: Math.max(current.lastTouchedChapter, chapter),
      stale: false,
      staleSinceChapter: null,
    }
  }
  for (const transition of delta.threads.transitions) {
    const index = threadIndex.get(transition.threadId)
    if (index === undefined) {
      throw new StateApplyError(
        'STATE_THREAD_CONFLICT',
        `Transisi menyebut thread tak dikenal "${transition.threadId}".`,
      )
    }
    if (threadStatusById.get(transition.threadId) !== transition.from) {
      throw new StateApplyError(
        'STATE_THREAD_CONFLICT',
        `Status thread "${transition.threadId}" saat ini ${threadStatusById.get(transition.threadId)}, delta menyatakan from=${transition.from}.`,
      )
    }
    if (!canTransition(transition.from, transition.to)) {
      throw new StateApplyError(
        'STATE_THREAD_CONFLICT',
        `Transisi thread ilegal: ${transition.threadId} ${transition.from} → ${transition.to}.`,
      )
    }
    threads[index] = {
      ...threads[index],
      status: transition.to,
      // R3 HIGH: setiap thread transition = thread dianggap touched (semantics
      // sama dengan debt ops via touches & SQL A1c nanti).
      lastTouchedChapter: Math.max(threads[index].lastTouchedChapter, chapter),
      stale: false,
      staleSinceChapter: null,
    }
    threadStatusById.set(transition.threadId, transition.to)
  }

  // ---------- act rollup ----------

  const actRollups: CanonSnapshot['actRollups'] = [...snapshot.actRollups]
  if (delta.actRollup !== null) {
    const rollup = delta.actRollup
    if (actRollups.some((item) => item.actNumber === rollup.actNumber)) {
      throw new StateApplyError(
        'STATE_ACT_ROLLUP_CONFLICT',
        `Act rollup ${rollup.actNumber} sudah ada di snapshot.`,
      )
    }
    actRollups.push({
      actNumber: rollup.actNumber,
      summary: rollup.summary,
      stateDelta: rollup.stateDelta,
      coversFromChapter: rollup.coversFromChapter,
      coversToChapter: rollup.coversToChapter,
    })
  }

  return {
    storyId: snapshot.storyId,
    characters,
    aliases: snapshot.aliases,
    voiceSheets: snapshot.voiceSheets,
    facts,
    knowledge,
    secrets,
    timeline,
    threads,
    actRollups,
    blueprints: snapshot.blueprints,
  }
}

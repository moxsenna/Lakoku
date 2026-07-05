/**
 * Persist story bible terkompilasi → Supabase (T7.4).
 *
 * Mengikuti pola seed-canon: upsert shell `stories`, lalu delete-then-insert
 * seluruh tabel canon untuk story tsb (idempoten). Memakai service-role admin
 * client (server-only).
 */
import 'server-only'
import { createAdminClient } from '@lakoku/db'
import type { CanonSnapshot } from '@lakoku/narrative-core'
import type { CompileResult } from './compile'

const CANON_TABLES = [
  'chapter_blueprints',
  'act_rollups',
  'story_threads',
  'timeline_events',
  'secrets_reveals',
  'knowledge_scopes',
  'facts_ledger',
  'character_voice_sheets',
  'character_aliases',
  'characters',
] as const

export async function persistStoryBible(result: CompileResult): Promise<{ storyId: string }> {
  const db = createAdminClient()
  const { storyId, snapshot, meta } = result

  // 0) Shell story (FK target). Upsert idempoten.
  const { error: eStory } = await db.from('stories').upsert({
    id: storyId,
    title: meta.title,
    cover: '/placeholder.svg?height=400&width=300',
    tagline: meta.tagline,
    role: meta.role,
    tropes: meta.tropes,
    total_chapters: 50,
    synopsis: meta.synopsis,
    status: 'BARU',
    current_chapter: 0,
    jejak: [],
    ending_name: null,
  })
  if (eStory) throw new Error(`stories: ${eStory.message}`)

  // 1) Bersihkan canon lama story ini.
  for (const t of CANON_TABLES) {
    const { error } = await db.from(t).delete().eq('story_id', storyId)
    if (error) throw new Error(`delete ${t}: ${error.message}`)
  }
  const charIds = snapshot.characters.map((c) => c.id)
  if (charIds.length) {
    const { error } = await db.from('character_states').delete().in('character_id', charIds)
    if (error) throw new Error(`delete character_states: ${error.message}`)
  }

  // 2) Insert canon.
  await insertAll(db, storyId, snapshot)

  return { storyId }
}

async function ins(
  db: ReturnType<typeof createAdminClient>,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (!rows.length) return
  const { error } = await db.from(table).insert(rows)
  if (error) throw new Error(`insert ${table}: ${error.message}`)
}

async function insertAll(
  db: ReturnType<typeof createAdminClient>,
  storyId: string,
  s: CanonSnapshot,
): Promise<void> {
  await ins(db, 'characters', s.characters.map((c) => ({
    id: c.id,
    story_id: storyId,
    canonical_name: c.canonicalName,
    role: c.role,
    motivation: c.motivation,
    introduced_chapter: c.introducedChapter,
  })))

  await ins(db, 'character_states', s.characters.map((c) => ({
    character_id: c.id,
    as_of_chapter: c.introducedChapter,
    status: c.status,
    attributes: {},
  })))

  await ins(db, 'character_aliases', s.aliases.map((a) => ({
    story_id: storyId,
    character_id: a.characterId,
    alias: a.alias,
    alias_type: a.aliasType,
  })))

  await ins(db, 'character_voice_sheets', s.voiceSheets.map((v) => ({
    story_id: storyId,
    character_id: v.characterId,
    register: v.register,
    speech_habits: v.speechHabits,
    forbidden_words: v.forbiddenWords,
    sample_lines: v.sampleLines,
  })))

  await ins(db, 'facts_ledger', s.facts.map((f) => ({
    id: f.id,
    story_id: storyId,
    statement: f.statement,
    subject_character_id: f.subjectCharacterId,
    established_chapter: f.establishedChapter,
    salience: f.salience,
    load_bearing: f.loadBearing,
    paid_off: f.paidOff,
  })))

  await ins(db, 'knowledge_scopes', s.knowledge.map((k) => ({
    story_id: storyId,
    character_id: k.characterId,
    fact_id: k.factId,
    known_from_chapter: k.knownFromChapter,
  })))

  await ins(db, 'secrets_reveals', s.secrets.map((x) => ({
    id: x.id,
    story_id: storyId,
    description: x.description,
    reveal_gate_chapter: x.revealGateChapter,
    revealed: x.revealed,
  })))

  await ins(db, 'story_threads', s.threads.map((t) => ({
    id: t.id,
    story_id: storyId,
    title: t.title,
    status: t.status,
    opened_chapter: t.openedChapter,
    last_touched_chapter: t.lastTouchedChapter,
    payoff_window: t.payoffWindow,
    is_main_mystery: t.isMainMystery,
    stale: t.stale ?? false,
    stale_since_chapter: t.staleSinceChapter ?? null,
  })))

  await ins(db, 'act_rollups', s.actRollups.map((r) => ({
    story_id: storyId,
    act_number: r.actNumber,
    summary: r.summary,
    state_delta: r.stateDelta,
    covers_from_chapter: r.coversFromChapter,
    covers_to_chapter: r.coversToChapter,
  })))

  await ins(db, 'chapter_blueprints', s.blueprints.map((b) => ({
    story_id: storyId,
    chapter_number: b.chapterNumber,
    version: b.version,
    phase: b.phase,
    chapter_goal: b.chapterGoal,
    mandatory_beats: b.mandatoryBeats,
    forbidden_reveals: b.forbiddenReveals,
    allowed_state_delta: b.allowedStateDelta,
    introduces_characters: b.introducesCharacters,
    reconciled_from_version: b.reconciledFromVersion,
    reconciliation_reason: b.reconciliationReason,
  })))
}

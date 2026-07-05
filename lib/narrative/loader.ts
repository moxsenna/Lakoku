import 'server-only'
import { createAdminClient } from '@lakoku/db'
import type {
  ActRollup,
  CanonSnapshot,
  Character,
  CharacterAlias,
  CharacterStatus,
  ChapterBlueprint,
  Fact,
  KnowledgeScope,
  SecretReveal,
  StoryThread,
  TimelineEvent,
  VoiceSheet,
} from './types'
import type { ChapterContextPacket } from './compiler'

/**
 * Canon loader (M3) — mengisi CanonSnapshot dari Supabase.
 *
 * Snapshot bersifat READ-ONLY untuk pipeline generasi: compiler & validator
 * hanya membacanya, tak pernah memutasinya (invarian dijaga di generate.ts).
 * Semua baca lewat service-role admin client (server-only).
 *
 * Status karakter tinggal di `character_states` (bukan `characters`); kita ambil
 * status pada as_of_chapter tertinggi yang <= target bab. Default ALIVE.
 */

const VALID_STATUS: CharacterStatus[] = ['ALIVE', 'DEAD', 'INACTIVE']

function normStatus(v: unknown): CharacterStatus {
  const s = String(v ?? '').toUpperCase()
  return (VALID_STATUS as string[]).includes(s) ? (s as CharacterStatus) : 'ALIVE'
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

/**
 * Muat snapshot canon lengkap untuk sebuah story. `throughChapter` membatasi
 * resolusi status karakter agar deterministik terhadap bab target (opsional).
 */
export async function loadCanonSnapshot(
  storyId: string,
  throughChapter = Number.MAX_SAFE_INTEGER,
): Promise<CanonSnapshot> {
  const db = createAdminClient()

  const [
    charactersRes,
    statesRes,
    aliasesRes,
    voiceRes,
    factsRes,
    knowledgeRes,
    secretsRes,
    timelineRes,
    threadsRes,
    rollupsRes,
    blueprintsRes,
  ] = await Promise.all([
    db.from('characters').select('*').eq('story_id', storyId),
    db.from('character_states').select('*'),
    db.from('character_aliases').select('*').eq('story_id', storyId),
    db.from('character_voice_sheets').select('*').eq('story_id', storyId),
    db.from('facts_ledger').select('*').eq('story_id', storyId),
    db.from('knowledge_scopes').select('*').eq('story_id', storyId),
    db.from('secrets_reveals').select('*').eq('story_id', storyId),
    db.from('timeline_events').select('*').eq('story_id', storyId),
    db.from('story_threads').select('*').eq('story_id', storyId),
    db.from('act_rollups').select('*').eq('story_id', storyId),
    db.from('chapter_blueprints').select('*').eq('story_id', storyId),
  ])

  const firstError = [
    charactersRes,
    statesRes,
    aliasesRes,
    voiceRes,
    factsRes,
    knowledgeRes,
    secretsRes,
    timelineRes,
    threadsRes,
    rollupsRes,
    blueprintsRes,
  ].find((r) => r.error)
  if (firstError?.error) {
    throw new Error(`loadCanonSnapshot: ${firstError.error.message}`)
  }

  // --- Status karakter: pilih as_of_chapter tertinggi (<= throughChapter). ---
  const statusByChar = new Map<string, { chapter: number; status: CharacterStatus }>()
  for (const s of statesRes.data ?? []) {
    const cid = String(s.character_id)
    const asOf = Number(s.as_of_chapter ?? 0)
    if (asOf > throughChapter) continue
    const prev = statusByChar.get(cid)
    if (!prev || asOf >= prev.chapter) {
      statusByChar.set(cid, { chapter: asOf, status: normStatus(s.status) })
    }
  }

  const characters: Character[] = (charactersRes.data ?? []).map((c) => ({
    id: String(c.id),
    storyId,
    canonicalName: String(c.canonical_name),
    role: String(c.role ?? ''),
    motivation: String(c.motivation ?? ''),
    introducedChapter: Number(c.introduced_chapter ?? 1),
    status: statusByChar.get(String(c.id))?.status ?? 'ALIVE',
  }))

  const aliases: CharacterAlias[] = (aliasesRes.data ?? []).map((a) => ({
    characterId: String(a.character_id),
    alias: String(a.alias),
    aliasType: String(a.alias_type ?? 'NAME') as CharacterAlias['aliasType'],
  }))

  const voiceSheets: VoiceSheet[] = (voiceRes.data ?? []).map((v) => ({
    characterId: String(v.character_id),
    register: String(v.register ?? ''),
    speechHabits: asArray<string>(v.speech_habits),
    forbiddenWords: asArray<string>(v.forbidden_words),
    sampleLines: asArray<string>(v.sample_lines),
  }))

  const facts: Fact[] = (factsRes.data ?? []).map((f) => ({
    id: String(f.id),
    storyId,
    statement: String(f.statement ?? ''),
    subjectCharacterId: f.subject_character_id ? String(f.subject_character_id) : null,
    establishedChapter: Number(f.established_chapter ?? 1),
    salience: Number(f.salience ?? 0),
    loadBearing: Boolean(f.load_bearing),
    paidOff: Boolean(f.paid_off),
  }))

  const knowledge: KnowledgeScope[] = (knowledgeRes.data ?? []).map((k) => ({
    characterId: String(k.character_id),
    factId: String(k.fact_id),
    knownFromChapter: Number(k.known_from_chapter ?? 1),
  }))

  const secrets: SecretReveal[] = (secretsRes.data ?? []).map((s) => ({
    id: String(s.id),
    description: String(s.description ?? ''),
    revealGateChapter: Number(s.reveal_gate_chapter ?? 0),
    revealed: Boolean(s.revealed),
  }))

  const timeline: TimelineEvent[] = (timelineRes.data ?? []).map((t) => ({
    chapterNumber: Number(t.chapter_number ?? 0),
    ordinal: Number(t.ordinal ?? 0),
    description: String(t.description ?? ''),
    isFlashback: Boolean(t.is_flashback),
    occursAt: t.occurs_at === null || t.occurs_at === undefined ? null : Number(t.occurs_at),
  }))

  const threads: StoryThread[] = (threadsRes.data ?? []).map((t) => ({
    id: String(t.id),
    title: String(t.title ?? ''),
    status: String(t.status ?? 'OPEN') as StoryThread['status'],
    openedChapter: Number(t.opened_chapter ?? 1),
    lastTouchedChapter: Number(t.last_touched_chapter ?? 1),
    payoffWindow: t.payoff_window === null || t.payoff_window === undefined ? null : Number(t.payoff_window),
    isMainMystery: Boolean(t.is_main_mystery),
    stale: Boolean(t.stale),
    staleSinceChapter:
      t.stale_since_chapter === null || t.stale_since_chapter === undefined
        ? null
        : Number(t.stale_since_chapter),
  }))

  const actRollups: ActRollup[] = (rollupsRes.data ?? []).map((r) => ({
    actNumber: Number(r.act_number ?? 0),
    summary: String(r.summary ?? ''),
    stateDelta: (r.state_delta ?? {}) as Record<string, unknown>,
    coversFromChapter: Number(r.covers_from_chapter ?? 0),
    coversToChapter: Number(r.covers_to_chapter ?? 0),
  }))

  const blueprints: ChapterBlueprint[] = (blueprintsRes.data ?? []).map((b) => ({
    chapterNumber: Number(b.chapter_number),
    version: Number(b.version ?? 1),
    phase: String(b.phase ?? ''),
    chapterGoal: String(b.chapter_goal ?? ''),
    mandatoryBeats: asArray<string>(b.mandatory_beats),
    forbiddenReveals: asArray<string>(b.forbidden_reveals),
    allowedStateDelta: (b.allowed_state_delta ?? {}) as Record<string, unknown>,
    introducesCharacters: asArray<string>(b.introduces_characters),
    reconciledFromVersion:
      b.reconciled_from_version === null || b.reconciled_from_version === undefined
        ? null
        : Number(b.reconciled_from_version),
    reconciliationReason: b.reconciliation_reason ? String(b.reconciliation_reason) : null,
  }))

  return {
    storyId,
    characters,
    aliases,
    voiceSheets,
    facts,
    knowledge,
    secrets,
    timeline,
    threads,
    actRollups,
    blueprints,
  }
}

/**
 * Simpan jejak retrieval (audit budget & inklusi/eksklusi konteks) untuk satu
 * kompilasi. Append-only; kegagalan di sini TIDAK boleh menggagalkan generasi
 * (observability best-effort).
 */
export async function persistRetrievalLog(
  storyId: string,
  targetChapter: number,
  packet: Pick<
    ChapterContextPacket,
    'includedIds' | 'excludedIds' | 'contextBudgetReport'
  >,
): Promise<void> {
  const db = createAdminClient()
  const { error } = await db.from('retrieval_logs').insert({
    story_id: storyId,
    target_chapter: targetChapter,
    included_ids: packet.includedIds,
    excluded_ids: packet.excludedIds,
    budget_report: packet.contextBudgetReport,
  })
  if (error) {
    console.log('[v0] persistRetrievalLog gagal (diabaikan):', error.message)
  }
}

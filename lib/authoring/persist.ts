/**
 * Persist compiled story bible through one transaction-safe service-role RPC.
 */
import 'server-only'
import { createAdminClient } from '@lakoku/db'
import type { CanonSnapshot } from '@lakoku/narrative-core'
import type { CompileResult } from './compile'

type ReplaceResult =
  | { ok: true; status: 'REPLACED' }
  | { ok: false; status: 'OWNER_MISMATCH' }

export async function persistStoryBible(
  result: CompileResult,
  ownerUserId: string,
): Promise<{ storyId: string }> {
  if (!ownerUserId) throw new Error('persistStoryBible: trusted owner user required')

  const db = createAdminClient()
  const { storyId, snapshot, meta } = result
  const { data, error } = await db.rpc('replace_authoring_story_bible_v1', {
    p_story_id: storyId,
    p_owner_user_id: ownerUserId,
    p_title: meta.title,
    p_cover: '/placeholder.svg?height=400&width=300',
    p_tagline: meta.tagline,
    p_role: meta.role,
    p_tropes: meta.tropes,
    p_total_chapters: 50,
    p_synopsis: meta.synopsis,
    p_canon: buildCanonPayload(snapshot),
  })

  if (error) throw new Error(`replace authoring story bible: ${error.message}`)

  const replaced = data as ReplaceResult | null
  if (replaced?.ok === false && replaced.status === 'OWNER_MISMATCH') {
    throw new Error('persistStoryBible: story owner mismatch')
  }
  if (replaced?.ok !== true || replaced.status !== 'REPLACED') {
    throw new Error('persistStoryBible: invalid replacement response')
  }

  return { storyId }
}

function buildCanonPayload(s: CanonSnapshot) {
  return {
    characters: s.characters.map((c) => ({
      id: c.id,
      canonical_name: c.canonicalName,
      role: c.role,
      motivation: c.motivation,
      introduced_chapter: c.introducedChapter,
      status: c.status,
    })),
    character_aliases: s.aliases.map((a) => ({
      character_id: a.characterId,
      alias: a.alias,
      alias_type: a.aliasType,
    })),
    character_voice_sheets: s.voiceSheets.map((v) => ({
      character_id: v.characterId,
      register: v.register,
      speech_habits: v.speechHabits,
      forbidden_words: v.forbiddenWords,
      sample_lines: v.sampleLines,
    })),
    facts_ledger: s.facts.map((f) => ({
      id: f.id,
      statement: f.statement,
      subject_character_id: f.subjectCharacterId,
      established_chapter: f.establishedChapter,
      salience: f.salience,
      load_bearing: f.loadBearing,
      paid_off: f.paidOff,
    })),
    knowledge_scopes: s.knowledge.map((k) => ({
      character_id: k.characterId,
      fact_id: k.factId,
      known_from_chapter: k.knownFromChapter,
    })),
    secrets_reveals: s.secrets.map((x) => ({
      id: x.id,
      description: x.description,
      reveal_gate_chapter: x.revealGateChapter,
      revealed: x.revealed,
    })),
    timeline_events: s.timeline.map((event) => ({
      chapter_number: event.chapterNumber,
      ordinal: event.ordinal,
      description: event.description,
      is_flashback: event.isFlashback,
      occurs_at: event.occursAt,
    })),
    story_threads: s.threads.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      opened_chapter: t.openedChapter,
      last_touched_chapter: t.lastTouchedChapter,
      payoff_window: t.payoffWindow,
      is_main_mystery: t.isMainMystery,
      stale: t.stale ?? false,
      stale_since_chapter: t.staleSinceChapter ?? null,
    })),
    act_rollups: s.actRollups.map((r) => ({
      act_number: r.actNumber,
      summary: r.summary,
      state_delta: r.stateDelta,
      covers_from_chapter: r.coversFromChapter,
      covers_to_chapter: r.coversToChapter,
    })),
    chapter_blueprints: s.blueprints.map((b) => ({
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
    })),
  }
}

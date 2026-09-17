/**
 * Share Ending Card (AMENDMENTS v0.5 LD-SHARE-MVP / LD-SHARE-PRIVACY).
 * Public surface = sanitized teaser only. Never return source chapter prose.
 */
import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/api/user-state'
import { resolveStoryCover } from '@/lib/api/queries'
import type { JejakItem } from '@/lib/api/types'

export type ShareVisibility = 'unlisted' | 'public'
export type ShareType = 'ending_card' | 'story_seed' | 'challenge'

export interface ShareTeaserCharacter {
  name: string
  role: string
}

export interface ShareTeaser {
  title: string
  tagline?: string
  tropes: string[]
  cover?: string
  endingName?: string
  bigChoices: string[]
  cta: string
  seedVersion: number
  synopsis?: string
  cast?: ShareTeaserCharacter[]
}

export interface SharedStoryLink {
  id: string
  shareSlug: string
  shareType: ShareType
  visibility: ShareVisibility
  title: string
  teaser: ShareTeaser
  createdAt: string
  /** Never send to public client as a read capability. Internal only. */
  sourceStoryId?: string
  ownerUserId?: string
}

export const SHARE_PUBLIC_COLUMNS =
  'id,share_slug,share_type,visibility,title,teaser_json,expires_at,revoked_at,created_at'

type SharePublicRow = {
  id: string
  share_slug: string
  share_type: ShareType
  visibility: ShareVisibility
  title: string
  teaser_json: ShareTeaser
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

type ShareRow = SharePublicRow & {
  owner_user_id: string
  source_story_id: string
  spoiler_level: string
}

function shortSlug(len = 10): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length]
  return out
}

/**
 * Pilihan awal non-spoiler (hanya bab 1–15, urut kronologis).
 * Menampilkan bagaimana cerita mulai bercabang tanpa membocorkan klimaks bab 40–50.
 */
export function pickBigChoices(jejak: JejakItem[]): string[] {
  if (!jejak.length) return []
  const early = jejak.filter((j) => j.chapter <= 15)
  const candidatePool = early.length > 0 ? early : jejak.slice(0, 3)

  const priorityChapters = [1, 3, 5, 8, 12]
  const sorted = [...candidatePool].sort((a, b) => {
    const aPriority = priorityChapters.includes(a.chapter) ? 1 : 0
    const bPriority = priorityChapters.includes(b.chapter) ? 1 : 0
    if (aPriority !== bPriority) return bPriority - aPriority
    return a.chapter - b.chapter
  })

  const seen = new Set<string>()
  const selected: JejakItem[] = []
  for (const j of sorted) {
    const label = j.decision.trim()
    if (!label || seen.has(label)) continue
    seen.add(label)
    selected.push(j)
    if (selected.length >= 3) break
  }

  return selected
    .sort((a, b) => a.chapter - b.chapter)
    .map((j) => j.decision.trim())
}

function toPublicLink(
  row: SharePublicRow | ShareRow,
  includeInternal = false,
): SharedStoryLink {
  const teaser = (row.teaser_json ?? {}) as ShareTeaser
  return {
    id: row.id,
    shareSlug: row.share_slug,
    shareType: row.share_type,
    visibility: row.visibility,
    title: row.title,
    teaser: {
      title: teaser.title ?? row.title,
      tagline: teaser.tagline,
      tropes: Array.isArray(teaser.tropes) ? teaser.tropes : [],
      cover: resolveStoryCover(teaser.cover),
      endingName: teaser.endingName,
      bigChoices: Array.isArray(teaser.bigChoices) ? teaser.bigChoices : [],
      cta: teaser.cta ?? 'Coba jalurmu sendiri',
      seedVersion: typeof teaser.seedVersion === 'number' ? teaser.seedVersion : 1,
      synopsis: typeof teaser.synopsis === 'string' ? teaser.synopsis : undefined,
      cast: Array.isArray(teaser.cast)
        ? teaser.cast
            .filter((c): c is ShareTeaserCharacter => typeof c?.name === 'string' && typeof c?.role === 'string')
            .map((c) => ({ name: c.name, role: c.role }))
        : undefined,
    },
    createdAt: row.created_at,
    ...(includeInternal && 'source_story_id' in row && 'owner_user_id' in row
      ? { sourceStoryId: row.source_story_id, ownerUserId: row.owner_user_id }
      : {}),
  }
}

export async function createEndingCardShare(input: {
  storyId: string
  title: string
  tagline?: string
  tropes: string[]
  cover?: string
  endingName?: string
  jejak: JejakItem[]
  visibility?: ShareVisibility
}): Promise<{ shareSlug: string; path: string }> {
  const user = await getSessionUser()
  if (!user) throw new Error('Harus masuk untuk membagikan ending card.')

  const supabase = await createClient()
  // Owner must have personal SELESAI state (not global demo status).
  const { data: state, error: stateErr } = await supabase
    .from('reader_states')
    .select('status, ending_name, jejak')
    .eq('story_id', input.storyId)
    .maybeSingle()
  if (stateErr) throw new Error(`createEndingCardShare state: ${stateErr.message}`)
  if (!state || state.status !== 'SELESAI') {
    throw new Error('Hanya cerita yang sudah kamu selesaikan yang bisa dibagikan.')
  }

  const bigChoices = pickBigChoices(
    (state.jejak as JejakItem[] | null) ?? input.jejak ?? [],
  )
  const endingName =
    input.endingName ??
    (typeof state.ending_name === 'string' ? state.ending_name : undefined)

  // Ambil sinopsis cerita untuk pengantar pembaca baru
  let synopsis: string | undefined
  try {
    const { data: storyRow } = await supabase
      .from('stories')
      .select('synopsis')
      .eq('id', input.storyId)
      .maybeSingle()
    if (typeof storyRow?.synopsis === 'string' && storyRow.synopsis.trim()) {
      synopsis = storyRow.synopsis.trim()
    }
  } catch {
    // Non-fatal jika sinopsis tidak terbaca
  }

  // Ambil maksimal 3 tokoh awal (bab 1–3) tanpa motivasi rahasia
  let cast: ShareTeaserCharacter[] | undefined
  try {
    const admin = createAdminClient()
    const { data: charRows } = await admin
      .from('characters')
      .select('canonical_name, role, introduced_chapter')
      .eq('story_id', input.storyId)
      .lte('introduced_chapter', 3)
      .order('introduced_chapter', { ascending: true })
      .limit(3)

    if (charRows && charRows.length > 0) {
      cast = charRows
        .filter((c) => typeof c.canonical_name === 'string' && c.canonical_name.trim())
        .map((c) => ({
          name: c.canonical_name.trim(),
          role: typeof c.role === 'string' && c.role.trim() ? c.role.trim() : 'Tokoh Cerita',
        }))
    }
  } catch {
    // Non-fatal jika tabel characters tidak terbaca
  }

  const teaser: ShareTeaser = {
    title: input.title,
    tagline: input.tagline,
    tropes: input.tropes ?? [],
    cover: input.cover,
    endingName,
    bigChoices,
    cta: 'Coba jalurmu sendiri',
    seedVersion: 1,
    synopsis,
    cast,
  }

  // Prefer user-scoped client so RLS owner check applies; admin fallback if needed.
  let shareSlug = shortSlug()
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from('shared_story_links')
      .insert({
        owner_user_id: user.id,
        source_story_id: input.storyId,
        share_slug: shareSlug,
        share_type: 'ending_card',
        visibility: input.visibility ?? 'unlisted',
        title: input.title,
        teaser_json: teaser,
        spoiler_level: 'none',
      })
      .select('share_slug')
      .single()

    if (!error && data) {
      return { shareSlug: data.share_slug, path: `/s/${data.share_slug}` }
    }
    // unique violation → retry slug
    if (error?.code === '23505') {
      shareSlug = shortSlug()
      continue
    }
    throw new Error(`createEndingCardShare: ${error?.message ?? 'gagal'}`)
  }
  throw new Error('createEndingCardShare: gagal membuat slug unik')
}

export const getShareBySlug = cache(async function getShareBySlug(
  slug: string,
): Promise<SharedStoryLink | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('shared_story_links')
    .select(SHARE_PUBLIC_COLUMNS)
    .eq('share_slug', slug)
    .maybeSingle()
  if (error) throw new Error(`getShareBySlug: ${error.message}`)
  if (!data) return null
  const row = data as SharePublicRow
  if (row.revoked_at) return null
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null
  // Public payload only — strip source id
  return toPublicLink(row, false)
})

export async function listPublicShareTeasers(limit = 20): Promise<SharedStoryLink[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('shared_story_links')
    .select(SHARE_PUBLIC_COLUMNS)
    .eq('visibility', 'public')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listPublicShareTeasers: ${error.message}`)
  return ((data ?? []) as SharePublicRow[])
    .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > Date.now())
    .map((r) => toPublicLink(r, false))
}

/**
 * Catat bahwa user B memulai jalur baru dari share (sebelum story baru ada).
 * new_story_id diisi nanti saat lock bible.
 */
export async function recordShareStart(shareSlug: string): Promise<{ startId: string }> {
  const user = await getSessionUser()
  if (!user) throw new Error('Harus masuk untuk mencoba jalur sendiri.')

  const share = await getShareBySlug(shareSlug)
  if (!share) throw new Error('Tautan share tidak ditemukan atau sudah dicabut.')

  // Need link id — fetch once with admin to get id without exposing source to client.
  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('shared_story_links')
    .select('id')
    .eq('share_slug', shareSlug)
    .is('revoked_at', null)
    .maybeSingle()
  if (error || !row) throw new Error('Tautan share tidak valid.')

  const supabase = await createClient()
  const { data: start, error: startErr } = await supabase
    .from('shared_story_starts')
    .insert({
      shared_link_id: row.id,
      new_user_id: user.id,
      new_story_id: null,
    })
    .select('id')
    .single()
  if (startErr || !start) {
    throw new Error(`recordShareStart: ${startErr?.message ?? 'gagal'}`)
  }
  return { startId: start.id as string }
}

/** Ikat story baru ke share start setelah lock. */
export async function attachStoryToShareStart(
  startId: string,
  newStoryId: string,
): Promise<void> {
  const user = await getSessionUser()
  if (!user) return
  const supabase = await createClient()
  const { error } = await supabase
    .from('shared_story_starts')
    .update({ new_story_id: newStoryId })
    .eq('id', startId)
    .eq('new_user_id', user.id)
  if (error) throw new Error(`attachStoryToShareStart: ${error.message}`)
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 48) || 'cerita'
  )
}

function remapValue(val: unknown, idMap: Map<string, string>): unknown {
  if (val === null || val === undefined) return val
  if (typeof val === 'string') {
    return idMap.get(val) ?? val
  }
  if (Array.isArray(val)) {
    return val.map((item) => remapValue(item, idMap))
  }
  if (typeof val === 'object') {
    const res: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      res[k] = remapValue(v, idMap)
    }
    return res
  }
  return val
}

/**
 * Clone instance cerita dari share link (T-SHARE-4).
 * Menyalin fondasi cerita (meta, kanon, kontrak, dan Bab 1) ke instance baru
 * milik penerima, sehingga penerima langsung masuk ke Bab 1 tanpa lewat /mulai.
 */
export async function cloneStoryFromShare(
  shareSlug: string,
): Promise<{ storyId: string; startId: string }> {
  const user = await getSessionUser()
  if (!user) throw new Error('Harus masuk untuk mencoba jalur sendiri.')

  const admin = createAdminClient()
  const { data: link, error: linkErr } = await admin
    .from('shared_story_links')
    .select('id, source_story_id, title, revoked_at, expires_at')
    .eq('share_slug', shareSlug)
    .maybeSingle()
  if (linkErr || !link) throw new Error('Tautan share tidak ditemukan.')
  if (link.revoked_at) throw new Error('Tautan share sudah dicabut.')
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
    throw new Error('Tautan share sudah kedaluwarsa.')
  }
  if (!link.source_story_id) throw new Error('Cerita sumber tidak ditemukan.')

  // Catat start row
  const { data: startRow, error: startErr } = await admin
    .from('shared_story_starts')
    .insert({
      shared_link_id: link.id,
      new_user_id: user.id,
      new_story_id: null,
    })
    .select('id')
    .single()
  if (startErr || !startRow) throw new Error('Gagal mencatat share start.')

  // Jika penerima sudah punya kloningan yang belum dimainkan (bab 1, jejak kosong, bukan SELESAI), reuse:
  const { data: existingStarts } = await admin
    .from('shared_story_starts')
    .select('new_story_id')
    .eq('shared_link_id', link.id)
    .eq('new_user_id', user.id)
    .not('new_story_id', 'is', null)
    .order('started_at', { ascending: false })
    .limit(5)

  if (existingStarts && existingStarts.length > 0) {
    for (const st of existingStarts) {
      if (!st.new_story_id) continue
      const { data: stStory } = await admin
        .from('stories')
        .select('id, current_chapter, jejak, status')
        .eq('id', st.new_story_id)
        .eq('owner_user_id', user.id)
        .maybeSingle()
      if (
        stStory &&
        stStory.current_chapter === 1 &&
        (!stStory.jejak || (Array.isArray(stStory.jejak) && stStory.jejak.length === 0)) &&
        stStory.status !== 'SELESAI'
      ) {
        await admin
          .from('shared_story_starts')
          .update({ new_story_id: stStory.id })
          .eq('id', startRow.id)
        return { storyId: stStory.id, startId: startRow.id }
      }
    }
  }

  // Ambil data cerita sumber
  const { data: sourceStory, error: storyErr } = await admin
    .from('stories')
    .select('*')
    .eq('id', link.source_story_id)
    .maybeSingle()
  if (storyErr || !sourceStory) throw new Error('Cerita sumber tidak ditemukan.')

  const base = slugify(sourceStory.title || link.title || 'cerita')
  const newStoryId = `${base}-${shortSlug(6)}`
  const now = new Date().toISOString()

  // Ambil seluruh relasi kanon sumber secara paralel
  const [
    charactersRes,
    aliasesRes,
    voiceRes,
    factsRes,
    knowledgeRes,
    secretsRes,
    timelineRes,
    threadsRes,
    rollupsRes,
    blueprintsRes,
    contractRes,
    directionRes,
    chapter1Res,
    outcomes1Res,
  ] = await Promise.all([
    admin.from('characters').select('*').eq('story_id', link.source_story_id),
    admin.from('character_aliases').select('*').eq('story_id', link.source_story_id),
    admin.from('character_voice_sheets').select('*').eq('story_id', link.source_story_id),
    admin.from('facts_ledger').select('*').eq('story_id', link.source_story_id),
    admin.from('knowledge_scopes').select('*').eq('story_id', link.source_story_id),
    admin.from('secrets_reveals').select('*').eq('story_id', link.source_story_id),
    admin.from('timeline_events').select('*').eq('story_id', link.source_story_id),
    admin.from('story_threads').select('*').eq('story_id', link.source_story_id),
    admin.from('act_rollups').select('*').eq('story_id', link.source_story_id),
    admin.from('chapter_blueprints').select('*').eq('story_id', link.source_story_id),
    admin.from('story_generation_contracts').select('*').eq('story_id', link.source_story_id).maybeSingle(),
    admin.from('story_creative_directions').select('*').eq('story_id', link.source_story_id).maybeSingle(),
    admin.from('chapters').select('*').eq('story_id', link.source_story_id).eq('number', 1).maybeSingle(),
    admin.from('choice_outcomes').select('*').eq('story_id', link.source_story_id).eq('chapter_number', 1),
  ])

  // Bangun id maps
  const charIdMap = new Map<string, string>()
  for (const c of charactersRes.data ?? []) {
    const slug = slugify(c.canonical_name || 'tokoh')
    charIdMap.set(c.id, `${newStoryId}:char:${slug}-${shortSlug(4)}`)
  }

  const factIdMap = new Map<string, string>()
  for (const f of factsRes.data ?? []) {
    factIdMap.set(f.id, `${newStoryId}:fact:${shortSlug(6)}`)
  }

  const secretIdMap = new Map<string, string>()
  for (const s of secretsRes.data ?? []) {
    secretIdMap.set(s.id, `${newStoryId}:secret:${shortSlug(6)}`)
  }

  const threadIdMap = new Map<string, string>()
  for (const t of threadsRes.data ?? []) {
    threadIdMap.set(t.id, `${newStoryId}:thread:${shortSlug(6)}`)
  }

  const idMap = new Map([...charIdMap, ...factIdMap, ...secretIdMap, ...threadIdMap])

  // Ambil character_states untuk karakter yang ada
  const oldCharIds = Array.from(charIdMap.keys())
  const { data: charStateRows } = oldCharIds.length > 0
    ? await admin.from('character_states').select('*').in('character_id', oldCharIds)
    : { data: [] }

  const storyMode =
    sourceStory.story_mode === 'premium_template'
      ? 'premium_instance'
      : (sourceStory.story_mode || 'personalized_ai')

  // Buat row story baru
  const { error: insStoryErr } = await admin.from('stories').insert({
    id: newStoryId,
    title: sourceStory.title,
    cover: sourceStory.cover,
    tagline: sourceStory.tagline,
    role: sourceStory.role,
    tropes: Array.isArray(sourceStory.tropes) ? sourceStory.tropes : [],
    total_chapters: sourceStory.total_chapters ?? 50,
    synopsis: sourceStory.synopsis,
    status: 'BERJALAN',
    current_chapter: 1,
    jejak: [],
    ending_name: null,
    owner_user_id: user.id,
    visibility: 'private',
    source_story_id: link.source_story_id,
    story_mode: storyMode,
    generation_status: 'ready',
    story_contract_version: sourceStory.story_contract_version ?? 1,
    created_at: now,
  })
  if (insStoryErr) throw new Error(`Gagal membuat cerita baru: ${insStoryErr.message}`)

  try {
    // 1. characters
    const charRows = charactersRes.data ?? []
    if (charRows.length > 0) {
      await admin.from('characters').insert(
        charRows.map((c) => ({
          id: charIdMap.get(c.id)!,
          story_id: newStoryId,
          canonical_name: c.canonical_name,
          role: c.role,
          motivation: c.motivation,
          introduced_chapter: c.introduced_chapter,
          created_at: now,
        })),
      )
    }

    // 2. character_states
    if (charStateRows && charStateRows.length > 0) {
      await admin.from('character_states').insert(
        charStateRows.map((cs) => ({
          character_id: charIdMap.get(cs.character_id)!,
          status: cs.status,
          as_of_chapter: cs.as_of_chapter,
          attributes: remapValue(cs.attributes, idMap),
          updated_at: now,
        })),
      )
    }

    // 3. character_aliases
    const aliasRows = aliasesRes.data ?? []
    if (aliasRows.length > 0) {
      await admin.from('character_aliases').insert(
        aliasRows.map((a) => ({
          story_id: newStoryId,
          character_id: charIdMap.get(a.character_id)!,
          alias: a.alias,
          alias_type: a.alias_type,
          created_at: now,
        })),
      )
    }

    // 4. character_voice_sheets
    const voiceRows = voiceRes.data ?? []
    if (voiceRows.length > 0) {
      await admin.from('character_voice_sheets').insert(
        voiceRows.map((v) => ({
          story_id: newStoryId,
          character_id: charIdMap.get(v.character_id)!,
          register: v.register,
          speech_habits: v.speech_habits,
          forbidden_words: v.forbidden_words,
          sample_lines: v.sample_lines,
          created_at: now,
        })),
      )
    }

    // 5. facts_ledger
    const factRows = factsRes.data ?? []
    if (factRows.length > 0) {
      await admin.from('facts_ledger').insert(
        factRows.map((f) => ({
          id: factIdMap.get(f.id)!,
          story_id: newStoryId,
          statement: f.statement,
          subject_character_id: f.subject_character_id ? (charIdMap.get(f.subject_character_id) ?? null) : null,
          established_chapter: f.established_chapter,
          salience: f.salience,
          load_bearing: f.load_bearing,
          paid_off: f.paid_off,
          created_at: now,
        })),
      )
    }

    // 6. knowledge_scopes
    const knowRows = knowledgeRes.data ?? []
    if (knowRows.length > 0) {
      await admin.from('knowledge_scopes').insert(
        knowRows.map((k) => ({
          story_id: newStoryId,
          character_id: charIdMap.get(k.character_id)!,
          fact_id: factIdMap.get(k.fact_id)!,
          known_from_chapter: k.known_from_chapter,
          created_at: now,
        })),
      )
    }

    // 7. secrets_reveals
    const secretRows = secretsRes.data ?? []
    if (secretRows.length > 0) {
      await admin.from('secrets_reveals').insert(
        secretRows.map((s) => ({
          id: secretIdMap.get(s.id)!,
          story_id: newStoryId,
          description: s.description,
          reveal_gate_chapter: s.reveal_gate_chapter,
          revealed: false,
          created_at: now,
        })),
      )
    }

    // 8. story_threads
    const threadRows = threadsRes.data ?? []
    if (threadRows.length > 0) {
      await admin.from('story_threads').insert(
        threadRows.map((t) => ({
          id: threadIdMap.get(t.id)!,
          story_id: newStoryId,
          title: t.title,
          status: 'OPEN',
          opened_chapter: t.opened_chapter,
          last_touched_chapter: t.last_touched_chapter,
          payoff_window: t.payoff_window,
          is_main_mystery: t.is_main_mystery,
          stale: false,
          stale_since_chapter: null,
          created_at: now,
        })),
      )
    }

    // 9. chapter_blueprints
    const blueprintRows = blueprintsRes.data ?? []
    if (blueprintRows.length > 0) {
      await admin.from('chapter_blueprints').insert(
        blueprintRows.map((b) => ({
          story_id: newStoryId,
          chapter_number: b.chapter_number,
          version: b.version,
          phase: b.phase,
          chapter_goal: b.chapter_goal,
          mandatory_beats: remapValue(b.mandatory_beats, idMap),
          forbidden_reveals: remapValue(b.forbidden_reveals, idMap),
          allowed_state_delta: remapValue(b.allowed_state_delta, idMap),
          introduces_characters: remapValue(b.introduces_characters, idMap),
          reconciled_from_version: b.reconciled_from_version,
          reconciliation_reason: b.reconciliation_reason,
          created_at: now,
        })),
      )
    }

    // 10. timeline_events
    const timelineRows = timelineRes.data ?? []
    if (timelineRows.length > 0) {
      await admin.from('timeline_events').insert(
        timelineRows.map((t) => ({
          story_id: newStoryId,
          chapter_number: t.chapter_number,
          ordinal: t.ordinal,
          description: t.description,
          is_flashback: t.is_flashback,
          occurs_at: t.occurs_at,
          created_at: now,
        })),
      )
    }

    // 11. act_rollups
    const rollupRows = rollupsRes.data ?? []
    if (rollupRows.length > 0) {
      await admin.from('act_rollups').insert(
        rollupRows.map((r) => ({
          story_id: newStoryId,
          act_number: r.act_number,
          summary: r.summary,
          state_delta: remapValue(r.state_delta, idMap),
          covers_from_chapter: r.covers_from_chapter,
          covers_to_chapter: r.covers_to_chapter,
          created_at: now,
        })),
      )
    }

    // 12. story_generation_contracts
    const contractRow = contractRes.data
    if (contractRow) {
      const remappedContract = (remapValue(contractRow.story_contract_json, idMap) ?? {}) as Record<string, unknown>
      await admin.from('story_generation_contracts').insert({
        story_id: newStoryId,
        mode: contractRow.mode,
        total_chapters: contractRow.total_chapters,
        contract_source: contractRow.contract_source,
        onboarding_json: remapValue(contractRow.onboarding_json, idMap),
        story_contract_json: { ...remappedContract, storyId: newStoryId },
        route_schema_json: remapValue(contractRow.route_schema_json, idMap),
        plot_debts_json: remapValue(contractRow.plot_debts_json, idMap),
        ending_candidates_json: remapValue(contractRow.ending_candidates_json, idMap),
        ending_lock_json: null,
        quality_profile: contractRow.quality_profile,
        story_contract_version: contractRow.story_contract_version,
        created_at: now,
        updated_at: now,
      })
    }

    // 13. story_creative_directions
    const dirRow = directionRes.data
    if (dirRow) {
      await admin.from('story_creative_directions').insert({
        story_id: newStoryId,
        owner_user_id: user.id,
        direction: dirRow.direction,
        fingerprint: dirRow.fingerprint,
        storage: dirRow.storage,
        created_at: now,
        updated_at: now,
      })
    }

    // 14. chapters (Chapter 1)
    const chapter1 = chapter1Res.data
    if (chapter1) {
      await admin.from('chapters').insert({
        story_id: newStoryId,
        number: 1,
        title: chapter1.title,
        paragraphs: remapValue(chapter1.paragraphs, idMap),
        choice_prompt: chapter1.choice_prompt,
        choices: remapValue(chapter1.choices, idMap),
        created_at: now,
      })
    }

    // 15. choice_outcomes (Chapter 1)
    const outcomes1 = outcomes1Res.data ?? []
    if (outcomes1.length > 0) {
      await admin.from('choice_outcomes').insert(
        outcomes1.map((o) => ({
          story_id: newStoryId,
          chapter_number: 1,
          choice_id: o.choice_id,
          consequence: remapValue(o.consequence, idMap),
          next_chapter_number: o.next_chapter_number,
          is_ending: o.is_ending,
          effect_json: remapValue(o.effect_json, idMap),
          choice_kind: o.choice_kind,
          created_at: now,
        })),
      )
    }

    // 16. reader_states
    await admin.from('reader_states').insert({
      user_id: user.id,
      story_id: newStoryId,
      status: 'BERJALAN',
      current_chapter: 1,
      jejak: [],
      ending_name: null,
      updated_at: now,
      created_at: now,
      route_state: {
        truth: 0,
        risk: 0,
        secrecy: 0,
        empathy: 0,
        trust: {},
        evidence: [],
        flags: {},
        endingBias: {},
      },
      choice_history: [],
      locked_ending_key: null,
    })

    // 17. Tautkan new_story_id ke shared_story_starts
    await admin
      .from('shared_story_starts')
      .update({ new_story_id: newStoryId })
      .eq('id', startRow.id)

    return { storyId: newStoryId, startId: startRow.id }
  } catch (err) {
    // Rollback story row on fatal failure
    await admin.from('stories').delete().eq('id', newStoryId)
    throw err
  }
}

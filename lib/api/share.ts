/**
 * Share Ending Card (AMENDMENTS v0.5 LD-SHARE-MVP / LD-SHARE-PRIVACY).
 * Public surface = sanitized teaser only. Never return source chapter prose.
 */
import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/api/user-state'
import type { JejakItem } from '@/lib/api/types'

export type ShareVisibility = 'unlisted' | 'public'
export type ShareType = 'ending_card' | 'story_seed' | 'challenge'

export interface ShareTeaser {
  title: string
  tagline?: string
  tropes: string[]
  cover?: string
  endingName?: string
  bigChoices: string[]
  cta: string
  seedVersion: number
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

type ShareRow = {
  id: string
  owner_user_id: string
  source_story_id: string
  share_slug: string
  share_type: ShareType
  visibility: ShareVisibility
  title: string
  teaser_json: ShareTeaser
  spoiler_level: string
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

function shortSlug(len = 10): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length]
  return out
}

/** 3–5 big decision labels, non-spoiler (no consequence text). */
export function pickBigChoices(jejak: JejakItem[]): string[] {
  if (!jejak.length) return []
  const ranked = [...jejak].sort((a, b) => {
    const weight = (c: number) =>
      [12, 20, 32, 40, 45, 48, 50].includes(c) ? 2 : c >= 30 ? 1 : 0
    return weight(b.chapter) - weight(a.chapter) || b.chapter - a.chapter
  })
  const seen = new Set<string>()
  const out: string[] = []
  for (const j of ranked) {
    const label = j.decision.trim()
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push(label)
    if (out.length >= 5) break
  }
  return out.slice(0, Math.max(3, Math.min(5, out.length)))
}

function toPublicLink(row: ShareRow, includeInternal = false): SharedStoryLink {
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
      cover: teaser.cover,
      endingName: teaser.endingName,
      bigChoices: Array.isArray(teaser.bigChoices) ? teaser.bigChoices : [],
      cta: teaser.cta ?? 'Coba jalurmu sendiri',
      seedVersion: typeof teaser.seedVersion === 'number' ? teaser.seedVersion : 1,
    },
    createdAt: row.created_at,
    ...(includeInternal
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

  const teaser: ShareTeaser = {
    title: input.title,
    tagline: input.tagline,
    tropes: input.tropes ?? [],
    cover: input.cover,
    endingName,
    bigChoices,
    cta: 'Coba jalurmu sendiri',
    seedVersion: 1,
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
    .select('*')
    .eq('share_slug', slug)
    .maybeSingle()
  if (error) throw new Error(`getShareBySlug: ${error.message}`)
  if (!data) return null
  const row = data as ShareRow
  if (row.revoked_at) return null
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null
  // Public payload only — strip source id
  return toPublicLink(row, false)
})

export async function listPublicShareTeasers(limit = 20): Promise<SharedStoryLink[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('shared_story_links')
    .select('*')
    .eq('visibility', 'public')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listPublicShareTeasers: ${error.message}`)
  return ((data ?? []) as ShareRow[])
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

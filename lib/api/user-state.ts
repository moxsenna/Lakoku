/**
 * Reader-state per-user (Supabase Auth + RLS).
 *
 * Semua akses memakai client ber-cookies (sesi pengguna), sehingga RLS
 * `reader_states` (pemilik-saja) yang menegakkan keamanan — bukan kode ini.
 *
 * Aturan progres: MONOTONIC. current_chapter tidak pernah mundur.
 * Tamu (tanpa sesi) tidak tersentuh file ini — mereka pakai state demo global.
 */
import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { createClient as createSupabaseJsClient, type User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSupabaseAnonKey, requireSupabaseUrl } from '@/lib/supabase/env'
import { ChoiceHistoryEntrySchema, type ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'
import { mergeChoiceEffect, RouteChoiceEffectSchema } from '@/lib/story-engine/route-state'
import type { JejakItem, ChoiceOutcome } from './types'

export const READER_STATE_PUBLIC_COLUMNS = 'user_id,story_id,status,current_chapter,jejak,ending_name,updated_at' as const

export interface ReaderState {
  storyId: string
  status: 'BARU' | 'BERJALAN' | 'SELESAI'
  currentChapter: number
  jejak: JejakItem[]
  endingName?: string
}

type ReaderStateRow = {
  story_id: string
  status: ReaderState['status']
  current_chapter: number
  jejak: JejakItem[]
  ending_name: string | null
}

/** Urutan status untuk aturan monotonic: tak boleh mundur. */
const STATUS_RANK: Record<ReaderState['status'], number> = {
  BARU: 0,
  BERJALAN: 1,
  SELESAI: 2,
}

function maxStatus(
  a: ReaderState['status'],
  b: ReaderState['status'],
): ReaderState['status'] {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b
}

function toState(r: ReaderStateRow): ReaderState {
  return {
    storyId: r.story_id,
    status: r.status,
    currentChapter: r.current_chapter,
    jejak: r.jejak,
    ...(r.ending_name ? { endingName: r.ending_name } : {}),
  }
}

const getSessionContext = cache(async function getSessionContext() {
  const supabase = await createClient()
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error) throw error
    return { supabase, user: data.user }
  } catch {
    // Refresh token mati (dicabut / diputar di klien lain / sesi dihapus):
    // perlakukan sebagai tamu, jangan crash RSC. Cookie mati dibersihkan
    // oleh middleware (penulisan cookie dari RSC tidak diizinkan Next).
    return { supabase, user: null }
  }
})

/**
 * Resolve user from Authorization: Bearer <access_token> (Android / API clients).
 * Cookie session remains primary for web via getSessionContext.
 */
async function getUserFromBearerAuthorization(): Promise<User | null> {
  try {
    const headerStore = await headers()
    const auth = headerStore.get('authorization') ?? headerStore.get('Authorization')
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) return null
    const token = auth.slice(7).trim()
    if (!token) return null
    const supabase = createSupabaseJsClient(
      requireSupabaseUrl(),
      requireSupabaseAnonKey(),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token)
    if (error || !user) return null
    return user
  } catch {
    return null
  }
}

/**
 * User dari sesi cookie (web) atau Bearer JWT (Android/API), atau null untuk tamu.
 */
export const getSessionUser = cache(async function getSessionUser(): Promise<User | null> {
  const { user } = await getSessionContext()
  if (user) return user
  return getUserFromBearerAuthorization()
})

/** Seluruh reader-state milik user saat ini (RLS membatasi ke pemiliknya). */
export const getReaderStates = cache(async function getReaderStates(): Promise<Map<string, ReaderState>> {
  const { supabase, user } = await getSessionContext()
  if (!user) return new Map()

  const { data, error } = await supabase.from('reader_states').select(READER_STATE_PUBLIC_COLUMNS)
  if (error) throw new Error(`getReaderStates: ${error.message}`)
  return new Map(
    (data as ReaderStateRow[]).map((r) => [r.story_id, toState(r)]),
  )
})

/** Reader-state user saat ini untuk satu cerita, atau null. */
export const getReaderState = cache(async function getReaderState(
  storyId: string,
): Promise<ReaderState | null> {
  const { supabase, user } = await getSessionContext()
  if (!user) return null

  const { data, error } = await supabase
    .from('reader_states')
    .select(READER_STATE_PUBLIC_COLUMNS)
    .eq('story_id', storyId)
    .maybeSingle()
  if (error) throw new Error(`getReaderState: ${error.message}`)
  return data ? toState(data as ReaderStateRow) : null
})

/**
 * `choiceId` yang pernah dipilih pembaca pada satu bab, atau null.
 *
 * Dipakai mode baca-ulang: label pada `jejak` bisa usang bila bab pernah
 * ditulis ulang, sedangkan `choiceId` (`chapter-N-choice-M`) stabil.
 */
export const getPreviousChoiceId = cache(async function getPreviousChoiceId(
  storyId: string,
  chapterNumber: number,
): Promise<string | null> {
  const { supabase, user } = await getSessionContext()
  if (!user) return null

  const { data, error } = await supabase
    .from('reader_states')
    .select('choice_history')
    .eq('story_id', storyId)
    .maybeSingle()
  if (error || !data) return null

  const history = Array.isArray(data.choice_history)
    ? (data.choice_history as { chapterNumber?: number; choiceId?: string }[])
    : []
  const entry = history.find((h) => h.chapterNumber === chapterNumber)
  return typeof entry?.choiceId === 'string' ? entry.choiceId : null
})

/**
 * Seed / advance progress personal (login only).
 * Monotonic: tidak menurunkan status/chapter yang sudah lebih maju.
 * Default mulai: BERJALAN bab 1. Pakai status 'BARU' + chapter 1 saat lock bible.
 */
export async function ensureReaderStateStarted(
  storyId: string,
  chapterNumber = 1,
  statusHint: ReaderState['status'] = 'BERJALAN',
): Promise<void> {
  const { supabase, user } = await getSessionContext()
  if (!user) return

  const existing = await getReaderState(storyId)
  const status = maxStatus(existing?.status ?? 'BARU', statusHint)
  const currentChapter = Math.max(existing?.currentChapter ?? 0, chapterNumber)
  const { error } = await supabase.from('reader_states').upsert(
    {
      user_id: user.id,
      story_id: storyId,
      status,
      current_chapter: currentChapter,
      jejak: existing?.jejak ?? [],
      ending_name: existing?.endingName ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,story_id' },
  )
  if (error) throw new Error(`ensureReaderStateStarted: ${error.message}`)
}

function buildEffectSummary(effect: unknown) {
  const parsed = RouteChoiceEffectSchema.safeParse(effect ?? {})
  if (!parsed.success) return { flagsSet: [] }
  const deltas: Record<string, number> = {}
  for (const [k, v] of Object.entries(parsed.data.routeDeltas ?? {})) {
    if (typeof v === 'number' && Number.isInteger(v)) {
      deltas[k] = Math.min(20, Math.max(-20, v))
    }
  }
  return {
    ...deltas,
    flagsSet: Object.entries(parsed.data.flagsSet ?? {})
      .filter(([, value]) => value)
      .map(([key]) => key)
      .sort(),
  }
}

/**
 * Catat hasil pilihan ke state user saat ini (jika login).
 * - current_chapter maju monotonic (tidak pernah mundur).
 * - jejak di-append hanya jika bab itu belum tercatat (anti duplikat repeat-tap).
 * - isEnding => status SELESAI + endingName dari konsekuensi.
 * - choice_history & route_state diperbarui via admin client (service_role)
 *   agar loadContinuationContextForChapter menemukan triggerChoiceId pada bab N>1.
 * No-op untuk tamu.
 */
export async function applyChoiceToUserState(
  storyId: string,
  chapterNumber: number,
  decision: string,
  outcome: ChoiceOutcome,
): Promise<void> {
  const { user } = await getSessionContext()
  if (!user) return

  const admin = createAdminClient()
  const { data: stateData, error: stateError } = await admin
    .from('reader_states')
    .select('status, current_chapter, jejak, ending_name, route_state, choice_history')
    .eq('user_id', user.id)
    .eq('story_id', storyId)
    .maybeSingle()
  if (stateError) throw new Error(`applyChoiceToUserState: ${stateError.message}`)

  // --- Rekonsiliasi jejak: gabung per-bab, keputusan terbaru menang, urut naik.
  const existingJejak = Array.isArray(stateData?.jejak) ? (stateData.jejak as JejakItem[]) : []
  const byChapter = new Map<number, JejakItem>()
  for (const j of existingJejak) byChapter.set(j.chapter, j)
  byChapter.set(chapterNumber, {
    chapter: chapterNumber,
    decision,
    consequence: outcome.consequence[0] ?? '',
  })
  const jejak: JejakItem[] = [...byChapter.values()].sort(
    (a, b) => a.chapter - b.chapter,
  )

  // --- Rekonsiliasi choice_history & route_state
  const { data: outcomeData } = await admin
    .from('choice_outcomes')
    .select('effect_json')
    .eq('story_id', storyId)
    .eq('chapter_number', chapterNumber)
    .eq('choice_id', outcome.choiceId)
    .maybeSingle()

  const effectJson = outcomeData?.effect_json ?? {}
  const nextRouteState = mergeChoiceEffect(stateData?.route_state, effectJson)

  const summary = buildEffectSummary(effectJson)
  const rawConsequence = Array.isArray(outcome.consequence) && outcome.consequence.length > 0
    ? outcome.consequence
    : ['']
  const consequence = rawConsequence
    .slice(0, 2)
    .map((c) => (typeof c === 'string' ? c.trim().slice(0, 160) : ''))
    .filter((c) => c.length > 0)
  const safeConsequence = consequence.length > 0 ? consequence : ['Pilihan tercatat.']
  const safeLabel = (typeof decision === 'string' ? decision.trim().slice(0, 240) : '') || outcome.choiceId.slice(0, 100)

  const historyEntry = ChoiceHistoryEntrySchema.parse({
    chapterNumber,
    choiceId: outcome.choiceId.slice(0, 100),
    label: safeLabel,
    consequence: safeConsequence,
    effectSummary: summary,
    createdAt: new Date().toISOString(),
  })

  const existingHistory = Array.isArray(stateData?.choice_history)
    ? (stateData.choice_history as ChoiceHistoryEntry[])
    : []
  const historyByChapter = new Map<number, ChoiceHistoryEntry>()
  for (const h of existingHistory) {
    if (h && typeof h.chapterNumber === 'number') {
      historyByChapter.set(h.chapterNumber, h)
    }
  }
  historyByChapter.set(chapterNumber, historyEntry)
  const choiceHistory = [...historyByChapter.values()].sort((a, b) => a.chapterNumber - b.chapterNumber)

  // --- Progres MONOTONIC: current_chapter tak pernah mundur.
  const advanceTo = outcome.isEnding
    ? chapterNumber
    : (outcome.nextChapterNumber ?? chapterNumber + 1)
  const nextChapter = Math.max(stateData?.current_chapter ?? 1, advanceTo)

  // --- Status MONOTONIC: tak boleh turun dari SELESAI ke BERJALAN.
  const incomingStatus: ReaderState['status'] = outcome.isEnding
    ? 'SELESAI'
    : 'BERJALAN'
  const status = maxStatus((stateData?.status as ReaderState['status']) ?? 'BARU', incomingStatus)

  // --- Ending name: pertahankan bila cerita sudah/menjadi SELESAI.
  const endingName =
    status === 'SELESAI'
      ? (outcome.isEnding
          ? (outcome.consequence[0] ?? stateData?.ending_name ?? null)
          : (stateData?.ending_name ?? null))
      : null

  const { error } = await admin.from('reader_states').upsert(
    {
      user_id: user.id,
      story_id: storyId,
      status,
      current_chapter: nextChapter,
      jejak,
      ending_name: endingName,
      route_state: nextRouteState,
      choice_history: choiceHistory,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,story_id' },
  )
  if (error) throw new Error(`applyChoiceToUserState: ${error.message}`)
}

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
import { createClient } from '@/lib/supabase/server'
import type { JejakItem, ChoiceOutcome } from './types'

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

/** User dari sesi cookie saat ini, atau null untuk tamu. */
export async function getSessionUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/** Seluruh reader-state milik user saat ini (RLS membatasi ke pemiliknya). */
export async function getReaderStates(): Promise<Map<string, ReaderState>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Map()

  const { data, error } = await supabase.from('reader_states').select('*')
  if (error) throw new Error(`getReaderStates: ${error.message}`)
  return new Map(
    (data as ReaderStateRow[]).map((r) => [r.story_id, toState(r)]),
  )
}

/** Reader-state user saat ini untuk satu cerita, atau null. */
export async function getReaderState(
  storyId: string,
): Promise<ReaderState | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('reader_states')
    .select('*')
    .eq('story_id', storyId)
    .maybeSingle()
  if (error) throw new Error(`getReaderState: ${error.message}`)
  return data ? toState(data as ReaderStateRow) : null
}

/**
 * Catat hasil pilihan ke state user saat ini (jika login).
 * - current_chapter maju monotonic (tidak pernah mundur).
 * - jejak di-append hanya jika bab itu belum tercatat (anti duplikat repeat-tap).
 * - isEnding => status SELESAI + endingName dari konsekuensi.
 * No-op untuk tamu.
 */
export async function applyChoiceToUserState(
  storyId: string,
  chapterNumber: number,
  decision: string,
  outcome: ChoiceOutcome,
): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const existing = await getReaderState(storyId)

  // --- Rekonsiliasi jejak: gabung per-bab, keputusan terbaru menang, urut naik.
  // Aman untuk tulisan lintas-perangkat yang tiba tak berurutan.
  const byChapter = new Map<number, JejakItem>()
  for (const j of existing?.jejak ?? []) byChapter.set(j.chapter, j)
  byChapter.set(chapterNumber, {
    chapter: chapterNumber,
    decision,
    consequence: outcome.consequence[0] ?? '',
  })
  const jejak: JejakItem[] = [...byChapter.values()].sort(
    (a, b) => a.chapter - b.chapter,
  )

  // --- Progres MONOTONIC: current_chapter tak pernah mundur.
  const advanceTo = outcome.isEnding
    ? chapterNumber
    : (outcome.nextChapterNumber ?? chapterNumber + 1)
  const nextChapter = Math.max(existing?.currentChapter ?? 1, advanceTo)

  // --- Status MONOTONIC: tak boleh turun dari SELESAI ke BERJALAN.
  const incomingStatus: ReaderState['status'] = outcome.isEnding
    ? 'SELESAI'
    : 'BERJALAN'
  const status = maxStatus(existing?.status ?? 'BARU', incomingStatus)

  // --- Ending name: pertahankan bila cerita sudah/menjadi SELESAI.
  const endingName =
    status === 'SELESAI'
      ? (outcome.isEnding
          ? (outcome.consequence[0] ?? existing?.endingName ?? null)
          : (existing?.endingName ?? null))
      : null

  const { error } = await supabase.from('reader_states').upsert(
    {
      user_id: user.id,
      story_id: storyId,
      status,
      current_chapter: nextChapter,
      jejak,
      ending_name: endingName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,story_id' },
  )
  if (error) throw new Error(`applyChoiceToUserState: ${error.message}`)
}

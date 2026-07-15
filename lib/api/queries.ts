/**
 * Query server-side ke Supabase (sumber kebenaran konten published).
 *
 * INTERNAL seam: hanya dipakai oleh route handlers /api/* dan lib/api/client.ts
 * (sisi server). Komponen UI tetap hanya berbicara dengan lib/api/client.ts.
 *
 * Saat migrasi ke Cloudflare Workers, file ini pindah ke Workers dan
 * client.ts cukup menunjuk base URL baru — UI tidak berubah.
 */
import { cache } from 'react'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { requireSupabaseAnonKey, requireSupabaseUrl } from '@/lib/supabase/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createCookieClient } from '@/lib/supabase/server'
import type {
  StorySummary,
  StoryDetail,
  Chapter,
  ChoiceOutcome,
  JejakItem,
  ChoiceOption,
} from './types'

export const STORY_READER_COLUMNS = 'id,title,cover,tagline,role,tropes,total_chapters,synopsis,status,current_chapter,jejak,ending_name' as const
export const CHAPTER_READER_COLUMNS = 'story_id,number,title,paragraphs,choice_prompt,choices' as const
export const OUTCOME_READER_COLUMNS = 'story_id,chapter_number,choice_id,consequence,next_chapter_number,is_ending' as const
export const EXPLORE_STORY_FILTER = 'id.like.demo:%,id.like.premium:%' as const

type StoryRow = {
  id: string
  title: string
  cover: string
  tagline: string
  role: string
  tropes: StorySummary['tropes']
  total_chapters: number
  synopsis: string
  status: StorySummary['status']
  current_chapter: number
  jejak: JejakItem[]
  ending_name: string | null
}

type ChapterRow = {
  story_id: string
  number: number
  title: string
  paragraphs: string[]
  choice_prompt: string | null
  choices: ChoiceOption[] | null
}

type OutcomeRow = {
  story_id: string
  chapter_number: number
  choice_id: string
  consequence: string[]
  next_chapter_number: number | null
  is_ending: boolean
}

/**
 * Konten published bersifat publik (RLS read-only anon) dan tidak butuh sesi
 * pengguna, jadi kita pakai client anon tanpa cookies. Ini juga membuat query
 * aman dipanggil dari generateStaticParams (build time, tanpa HTTP request).
 * Saat reader-state per-user hadir (auth), query state akan pakai client
 * ber-cookies terpisah.
 */
function createClient() {
  return createSupabaseClient(requireSupabaseUrl(), requireSupabaseAnonKey())
}

function toDetail(r: StoryRow): StoryDetail {
  return {
    id: r.id,
    title: r.title,
    cover: r.cover,
    tagline: r.tagline,
    role: r.role,
    tropes: r.tropes,
    totalChapters: r.total_chapters,
    synopsis: r.synopsis,
    status: r.status,
    currentChapter: r.current_chapter,
    jejak: r.jejak,
    ...(r.ending_name ? { endingName: r.ending_name } : {}),
  }
}

export const queryStories = cache(async function queryStories(): Promise<StorySummary[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('stories')
    .select(STORY_READER_COLUMNS)
    .order('id', { ascending: true })
  if (error) throw new Error(`queryStories: ${error.message}`)
  return (data as StoryRow[]).map(toDetail)
})

export const queryStory = cache(async function queryStory(id: string): Promise<StoryDetail | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('stories')
    .select(STORY_READER_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`queryStory: ${error.message}`)
  return data ? toDetail(data as StoryRow) : null
})

/**
 * Reads trusted user library rows with service role, but only after exact ID and
 * explicit public/owner constraints. Internal filter fields never enter result.
 */
export async function queryStoriesByIdsForUser(
  storyIds: string[],
  userId: string,
): Promise<StorySummary[]> {
  if (storyIds.length === 0) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('stories')
    .select(STORY_READER_COLUMNS)
    .in('id', storyIds)
    .or(`visibility.eq.public,owner_user_id.eq.${userId}`)
    .order('id', { ascending: true })
  if (error) throw new Error(`queryStoriesByIdsForUser: ${error.message}`)
  return (data as StoryRow[]).map(toDetail)
}

/** Public detail or exact trusted owner only. */
export async function queryStoryForUser(
  id: string,
  userId: string | null,
): Promise<StoryDetail | null> {
  const supabase = createAdminClient()
  let query = supabase
    .from('stories')
    .select(STORY_READER_COLUMNS)
    .eq('id', id)

  query = userId
    ? query.or(`visibility.eq.public,owner_user_id.eq.${userId}`)
    : query.eq('visibility', 'public')

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`queryStoryForUser: ${error.message}`)
  return data ? toDetail(data as StoryRow) : null
}

/** Public official demos and premium templates only. */
export async function queryExploreStories(): Promise<StorySummary[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('stories')
    .select(STORY_READER_COLUMNS)
    .eq('visibility', 'public')
    .or(EXPLORE_STORY_FILTER)
    .order('id', { ascending: true })
  if (error) throw new Error(`queryExploreStories: ${error.message}`)
  return (data as StoryRow[]).map(toDetail)
}

export const queryChapter = cache(async function queryChapter(
  storyId: string,
  number: number,
): Promise<Chapter | null> {
  const supabase = await createCookieClient()
  const { data, error } = await supabase
    .from('chapters')
    .select(CHAPTER_READER_COLUMNS)
    .eq('story_id', storyId)
    .eq('number', number)
    .maybeSingle()
  if (error) throw new Error(`queryChapter: ${error.message}`)
  if (!data) return null
  const r = data as ChapterRow
  return {
    storyId: r.story_id,
    number: r.number,
    title: r.title,
    paragraphs: r.paragraphs,
    choicePrompt: r.choice_prompt ?? '',
    choices: r.choices ?? [],
  }
})

/**
 * Bab terakhir yang SUDAH ADA isinya untuk sebuah cerita, dengan nomor <= atMost.
 * Dipakai sebagai fallback reader-safe: bila bab yang diminta belum tersedia
 * (mis. reader-state terlanjur maju melewati konten yang ada), pembaca dijatuhkan
 * ke bab terakhir yang benar-benar bisa dibaca, bukan layar kosong permanen.
 * Mengembalikan null bila tak ada bab <= atMost.
 */
export const queryLatestAvailableChapter = cache(async function queryLatestAvailableChapter(
  storyId: string,
  atMost: number,
): Promise<Chapter | null> {
  const supabase = await createCookieClient()
  const { data, error } = await supabase
    .from('chapters')
    .select(CHAPTER_READER_COLUMNS)
    .eq('story_id', storyId)
    .lte('number', atMost)
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`queryLatestAvailableChapter: ${error.message}`)
  if (!data) return null
  const r = data as ChapterRow
  return {
    storyId: r.story_id,
    number: r.number,
    title: r.title,
    paragraphs: r.paragraphs,
    choicePrompt: r.choice_prompt ?? '',
    choices: r.choices ?? [],
  }
})

/**
 * Metadata bab (hanya number + title) untuk daftar bab, dibatasi sampai maxNumber.
 * Tidak mengambil paragraphs/choices utk menghindari data boros di list.
 */
export const queryChapterMetadatas = cache(async function queryChapterMetadatas(
  storyId: string,
  maxNumber: number,
): Promise<{ number: number; title: string }[]> {
  const supabase = await createCookieClient()
  const { data, error } = await supabase
    .from('chapters')
    .select('number,title')
    .eq('story_id', storyId)
    .lte('number', maxNumber)
    .order('number', { ascending: true })
  if (error) throw new Error(`queryChapterMetadatas: ${error.message}`)
  return (data ?? []) as { number: number; title: string }[]
})

export async function queryChoiceOutcome(
  storyId: string,
  chapterNumber: number,
  choiceId: string,
): Promise<ChoiceOutcome | null> {
  const supabase = await createCookieClient()
  const { data, error } = await supabase
    .from('choice_outcomes')
    .select(OUTCOME_READER_COLUMNS)
    .eq('story_id', storyId)
    .eq('chapter_number', chapterNumber)
    .eq('choice_id', choiceId)
    .maybeSingle()
  if (error) throw new Error(`queryChoiceOutcome: ${error.message}`)
  if (!data) return null
  const r = data as OutcomeRow
  return {
    storyId: r.story_id,
    chapterNumber: r.chapter_number,
    choiceId: r.choice_id,
    consequence: r.consequence,
    nextChapterNumber: r.next_chapter_number,
    isEnding: r.is_ending,
  }
}

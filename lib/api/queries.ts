/**
 * Query server-side ke Supabase (sumber kebenaran konten published).
 *
 * INTERNAL seam: hanya dipakai oleh route handlers /api/* dan lib/api/client.ts
 * (sisi server). Komponen UI tetap hanya berbicara dengan lib/api/client.ts.
 *
 * Saat migrasi ke Cloudflare Workers, file ini pindah ke Workers dan
 * client.ts cukup menunjuk base URL baru — UI tidak berubah.
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type {
  StorySummary,
  StoryDetail,
  Chapter,
  ChoiceOutcome,
  JejakItem,
  ChoiceOption,
} from './types'

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
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
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

export async function queryStories(): Promise<StorySummary[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`queryStories: ${error.message}`)
  return (data as StoryRow[]).map(toDetail)
}

export async function queryStory(id: string): Promise<StoryDetail | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`queryStory: ${error.message}`)
  return data ? toDetail(data as StoryRow) : null
}

export async function queryChapter(
  storyId: string,
  number: number,
): Promise<Chapter | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('chapters')
    .select('*')
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
}

export async function queryChoiceOutcome(
  storyId: string,
  chapterNumber: number,
  choiceId: string,
): Promise<ChoiceOutcome | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('choice_outcomes')
    .select('*')
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

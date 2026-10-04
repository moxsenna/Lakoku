/**
 * Query server-side ke Neon database via Kysely (sumber kebenaran konten published).
 *
 * INTERNAL seam: hanya dipakai oleh route handlers /api/* dan lib/api/client.ts
 * (sisi server). Komponen UI tetap hanya berbicara dengan lib/api/client.ts.
 */
import { cache } from 'react'
import { getDb, result, single } from '@lakoku/db'
import { resolveStoryCover } from '@/lib/cover/url'
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

const STORY_SELECT_COLS = [
  'id',
  'title',
  'cover',
  'tagline',
  'role',
  'tropes',
  'total_chapters',
  'synopsis',
  'status',
  'current_chapter',
  'jejak',
  'ending_name',
] as const

/**
 * Sampul default + resolver URL publik kini tinggal di modul rakitan URL
 * (lib/cover/url.ts) supaya jalur tulis (putCover/apply) memakai definisi
 * yang sama persis. Re-export di sini demi konsumen existing.
 */
export { DEFAULT_STORY_COVER, resolveStoryCover } from '@/lib/cover/url'

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

function toDetail(r: StoryRow): StoryDetail {
  return {
    id: r.id,
    title: r.title,
    cover: resolveStoryCover(r.cover),
    tagline: r.tagline,
    role: r.role,
    tropes: (typeof r.tropes === 'string' ? JSON.parse(r.tropes) : r.tropes) as StorySummary['tropes'],
    totalChapters: r.total_chapters,
    synopsis: r.synopsis,
    status: r.status,
    currentChapter: r.current_chapter,
    jejak: (typeof r.jejak === 'string' ? JSON.parse(r.jejak) : r.jejak) as JejakItem[],
    ...(r.ending_name ? { endingName: r.ending_name } : {}),
  }
}

export const queryStories = cache(async function queryStories(
  userId?: string | null,
): Promise<StorySummary[]> {
  const db = getDb()
  let query = db.selectFrom('stories').select(STORY_SELECT_COLS)
  // RLS_AUDIT: stories_public_read, stories_owner_read
  if (userId) {
    query = query.where((eb) =>
      eb.or([
        eb('visibility', '=', 'public'),
        eb('owner_user_id', '=', userId),
      ]),
    )
  } else {
    query = query.where('visibility', '=', 'public')
  }
  const { data, error } = await result(query.orderBy('id', 'asc').execute())
  if (error) throw new Error(`queryStories: ${error.message}`)
  return ((data ?? []) as unknown as StoryRow[]).map(toDetail)
})

export const queryStory = cache(async function queryStory(
  id: string,
  userId: string | null = null,
): Promise<StoryDetail | null> {
  // RLS_AUDIT: stories_public_read, stories_owner_read (delegates to queryStoryForUser)
  return queryStoryForUser(id, userId)
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

  const db = getDb()
  // RLS_AUDIT: stories_public_read, stories_owner_read
  const { data, error } = await result(
    db
      .selectFrom('stories')
      .select(STORY_SELECT_COLS)
      .where('id', 'in', storyIds)
      .where((eb) =>
        eb.or([
          eb('visibility', '=', 'public'),
          eb('owner_user_id', '=', userId),
        ]),
      )
      .orderBy('id', 'asc')
      .execute(),
  )
  if (error) throw new Error(`queryStoriesByIdsForUser: ${error.message}`)
  return ((data ?? []) as unknown as StoryRow[]).map(toDetail)
}

/** Public detail or exact trusted owner only. */
export async function queryStoryForUser(
  id: string,
  userId: string | null = null,
): Promise<StoryDetail | null> {
  const db = getDb()
  let query = db
    .selectFrom('stories')
    .select(STORY_SELECT_COLS)
    .where('id', '=', id)

  // RLS_AUDIT: stories_public_read, stories_owner_read
  query = userId
    ? query.where((eb) =>
        eb.or([
          eb('visibility', '=', 'public'),
          eb('owner_user_id', '=', userId),
        ]),
      )
    : query.where('visibility', '=', 'public')

  const { data, error } = await single(query.limit(1).execute())
  if (error) throw new Error(`queryStoryForUser: ${error.message}`)
  return data ? toDetail(data as unknown as StoryRow) : null
}

/** Public official demos and premium templates only. */
export async function queryExploreStories(): Promise<StorySummary[]> {
  const db = getDb()
  // RLS_AUDIT: stories_public_read
  const { data, error } = await result(
    db
      .selectFrom('stories')
      .select(STORY_SELECT_COLS)
      .where('visibility', '=', 'public')
      .where((eb) =>
        eb.or([
          eb('id', 'like', 'demo:%'),
          eb('id', 'like', 'premium:%'),
        ]),
      )
      .orderBy('id', 'asc')
      .execute(),
  )
  if (error) throw new Error(`queryExploreStories: ${error.message}`)
  return ((data ?? []) as unknown as StoryRow[]).map(toDetail)
}

/**
 * Cerita publik buatan pembaca/penulis lain (bukan demo/premium bawaan).
 * Menggunakan admin client, visibility public, owner tidak null, bukan demo/premium.
 * Memanfaatkan index stories_visibility_idx.
 */
export async function queryPublicUserStories(limit = 12): Promise<StorySummary[]> {
  const db = getDb()
  // RLS_AUDIT: stories_public_read
  const { data, error } = await result(
    db
      .selectFrom('stories')
      .select(STORY_SELECT_COLS)
      .where('visibility', '=', 'public')
      .where('owner_user_id', 'is not', null)
      .where('id', 'not like', 'demo:%')
      .where('id', 'not like', 'premium:%')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute(),
  )
  if (error) throw new Error(`queryPublicUserStories: ${error.message}`)
  return ((data ?? []) as unknown as StoryRow[]).map(toDetail)
}

function mapChapterRow(r: ChapterRow): Chapter {
  return {
    storyId: r.story_id,
    number: r.number,
    title: r.title,
    paragraphs: (typeof r.paragraphs === 'string' ? JSON.parse(r.paragraphs) : r.paragraphs) as string[],
    choicePrompt: r.choice_prompt ?? '',
    choices: (typeof r.choices === 'string' ? JSON.parse(r.choices) : (r.choices ?? [])) as ChoiceOption[],
  }
}

/**
 * Read one chapter after story authorization.
 * Callers MUST authorize parent story first (getStory / queryStoryForUser).
 */
export const queryChapter = cache(async function queryChapter(
  storyId: string,
  number: number,
): Promise<Chapter | null> {
  const db = getDb()
  // RLS_AUDIT: chapters_owner_read, chapters_public_read (caller authorizes parent story)
  const { data, error } = await single(
    db
      .selectFrom('chapters')
      .select([
        'story_id',
        'number',
        'title',
        'paragraphs',
        'choice_prompt',
        'choices',
      ])
      .where('story_id', '=', storyId)
      .where('number', '=', number)
      .limit(1)
      .execute(),
  )
  if (error) throw new Error(`queryChapter: ${error.message}`)
  if (!data) return null
  return mapChapterRow(data as unknown as ChapterRow)
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
  const db = getDb()
  // RLS_AUDIT: chapters_owner_read, chapters_public_read (caller authorizes parent story)
  const { data, error } = await single(
    db
      .selectFrom('chapters')
      .select([
        'story_id',
        'number',
        'title',
        'paragraphs',
        'choice_prompt',
        'choices',
      ])
      .where('story_id', '=', storyId)
      .where('number', '<=', atMost)
      .orderBy('number', 'desc')
      .limit(1)
      .execute(),
  )
  if (error) throw new Error(`queryLatestAvailableChapter: ${error.message}`)
  if (!data) return null
  return mapChapterRow(data as unknown as ChapterRow)
})

/**
 * Metadata bab (hanya number + title) untuk daftar bab, dibatasi sampai maxNumber.
 * Tidak mengambil paragraphs/choices utk menghindari data boros di list.
 */
export const queryChapterMetadatas = cache(async function queryChapterMetadatas(
  storyId: string,
  maxNumber: number,
): Promise<{ number: number; title: string }[]> {
  const db = getDb()
  // RLS_AUDIT: chapters_owner_read, chapters_public_read (caller authorizes parent story)
  const { data, error } = await result(
    db
      .selectFrom('chapters')
      .select(['number', 'title'])
      .where('story_id', '=', storyId)
      .where('number', '<=', maxNumber)
      .orderBy('number', 'asc')
      .execute(),
  )
  if (error) throw new Error(`queryChapterMetadatas: ${error.message}`)
  return (data ?? []) as { number: number; title: string }[]
})

export async function queryChoiceOutcome(
  storyId: string,
  chapterNumber: number,
  choiceId: string,
): Promise<ChoiceOutcome | null> {
  const db = getDb()
  // RLS_AUDIT: choice_outcomes_owner_read, choice_outcomes_public_read (caller authorizes parent story)
  const { data, error } = await single(
    db
      .selectFrom('choice_outcomes')
      .select([
        'story_id',
        'chapter_number',
        'choice_id',
        'consequence',
        'next_chapter_number',
        'is_ending',
      ])
      .where('story_id', '=', storyId)
      .where('chapter_number', '=', chapterNumber)
      .where('choice_id', '=', choiceId)
      .limit(1)
      .execute(),
  )
  if (error) throw new Error(`queryChoiceOutcome: ${error.message}`)
  if (!data) return null
  const r = data as unknown as OutcomeRow
  return {
    storyId: r.story_id,
    chapterNumber: r.chapter_number,
    choiceId: r.choice_id,
    consequence: (typeof r.consequence === 'string' ? JSON.parse(r.consequence) : r.consequence) as string[],
    nextChapterNumber: r.next_chapter_number,
    isEnding: r.is_ending,
  }
}

import 'server-only'
import { getDb, single, result } from '@lakoku/db'
import type { Chapter, ChoiceOutcome, ChoiceOption } from '@/lib/api/types'
import { sanitizeDirectionHint } from '@/lib/catalog/reader-safe-hint'

export async function isCatalogStory(storyId: string): Promise<boolean> {
  const db = getDb()
  const { data, error } = await single(
    db
      .selectFrom('stories')
      .select('story_mode')
      .where('id', '=', storyId)
      .limit(1)
      .execute(),
  )
  if (error || !data) return false
  return data.story_mode === 'catalog'
}

export async function getReaderLockedEndingKey(
  storyId: string,
  userId: string | null,
): Promise<string | null> {
  if (!userId) return null
  const db = getDb()
  const { data } = await single(
    db
      .selectFrom('reader_states')
      .select('locked_ending_key')
      .where('user_id', '=', userId)
      .where('story_id', '=', storyId)
      .limit(1)
      .execute(),
  )
  return data?.locked_ending_key ?? null
}

export async function getCatalogVariantChapter(
  storyId: string,
  chapterNumber: number,
  endingKey: string,
): Promise<Chapter | null> {
  const db = getDb()
  const { data, error } = await single(
    db
      .selectFrom('catalog_ending_chapters')
      .select([
        'story_id',
        'number',
        'title',
        'paragraphs',
        'choice_prompt',
        'choices',
      ])
      .where('story_id', '=', storyId)
      .where('ending_key', '=', endingKey)
      .where('number', '=', chapterNumber)
      .limit(1)
      .execute(),
  )

  if (error || !data) return null

  const rawParagraphs = data.paragraphs
  const paragraphs = (
    typeof rawParagraphs === 'string'
      ? JSON.parse(rawParagraphs)
      : (rawParagraphs ?? [])
  ) as string[]

  const rawChoices = data.choices
  const choices = (
    typeof rawChoices === 'string'
      ? JSON.parse(rawChoices)
      : (rawChoices ?? [])
  ) as ChoiceOption[]

  return {
    storyId: data.story_id,
    number: data.number,
    title: data.title,
    paragraphs,
    choicePrompt: data.choice_prompt ?? '',
    choices,
  }
}

export async function getCatalogVariantOutcome(
  storyId: string,
  chapterNumber: number,
  choiceId: string,
  endingKey: string,
): Promise<ChoiceOutcome | null> {
  const db = getDb()
  const { data, error } = await single(
    db
      .selectFrom('catalog_ending_chapters')
      .select('outcomes_json')
      .where('story_id', '=', storyId)
      .where('ending_key', '=', endingKey)
      .where('number', '=', chapterNumber)
      .limit(1)
      .execute(),
  )

  if (error || !data || !data.outcomes_json) return null

  const rawOutcomes = (
    typeof data.outcomes_json === 'string'
      ? JSON.parse(data.outcomes_json)
      : data.outcomes_json
  ) as Array<Record<string, unknown>>

  if (!Array.isArray(rawOutcomes)) return null

  const matched = rawOutcomes.find((o) => {
    const cid = o.choiceId ?? o.choice_id
    return cid === choiceId
  })
  if (!matched) return null

  const rawConsequence = matched.consequence
  const consequence: string[] = Array.isArray(rawConsequence)
    ? rawConsequence.map(String)
    : typeof rawConsequence === 'string'
      ? (rawConsequence.startsWith('[') ? JSON.parse(rawConsequence) : [rawConsequence])
      : []

  const nextChRaw = matched.nextChapterNumber ?? matched.next_chapter_number
  const nextChapterNumber =
    typeof nextChRaw === 'number'
      ? nextChRaw
      : chapterNumber >= 50
        ? null
        : chapterNumber + 1

  const isEnding =
    typeof matched.isEnding === 'boolean'
      ? matched.isEnding
      : typeof matched.is_ending === 'boolean'
        ? matched.is_ending
        : chapterNumber >= 50

  const directionHintRaw = matched.directionHint ?? matched.direction_hint
  const directionHint = sanitizeDirectionHint(
    typeof directionHintRaw === 'string' ? directionHintRaw : undefined,
  )

  return {
    storyId,
    chapterNumber,
    choiceId,
    consequence: consequence.length > 0 ? consequence : ['...'],
    nextChapterNumber,
    isEnding,
    ...(directionHint ? { directionHint } : {}),
  }
}

export async function getCatalogVariantMetadatas(
  storyId: string,
  minNumber: number,
  maxNumber: number,
  endingKey: string,
): Promise<{ number: number; title: string }[]> {
  const db = getDb()
  const { data, error } = await result(
    db
      .selectFrom('catalog_ending_chapters')
      .select(['number', 'title'])
      .where('story_id', '=', storyId)
      .where('ending_key', '=', endingKey)
      .where('number', '>=', minNumber)
      .where('number', '<=', maxNumber)
      .orderBy('number', 'asc')
      .execute(),
  )

  if (error || !data) return []
  return (data as Array<{ number: number; title: string }>).map((r) => ({
    number: r.number,
    title: r.title,
  }))
}

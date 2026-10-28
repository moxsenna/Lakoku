import 'server-only'
import { getDb, result, single, type Json } from '@lakoku/db'
import { CatalogContractSnapshotSchema } from './contract-snapshot'

export type CatalogReviewStatus = 'pending' | 'approved' | 'rewrite_requested'

export type CatalogAdminErrorCode =
  | 'NOT_FOUND'
  | 'NOT_CATALOG'
  | 'INVALID_INPUT'
  | 'CHAPTER_NOT_FOUND'
  | 'NOT_READY'

export class CatalogAdminError extends Error {
  constructor(public readonly code: CatalogAdminErrorCode) {
    super(code)
    this.name = 'CatalogAdminError'
  }
}

export interface CatalogAdminSummary {
  storyId: string
  title: string
  status: string
  chapterPrice: number
  bundlePrice: number
  generationProgress: number
  publishedAt: string | null
  visibility: string
  totalUnits: number
  approvedUnits: number
  rewriteUnits: number
  pendingUnits: number
}

export interface CatalogChapterUnit {
  chapterNumber: number
  variantKey: string
  variantName: string | null
  title: string
  paragraphs: string[]
  choices: Array<{ id: string; label: string }>
  paragraphCount: number
  wordCount: number
  choiceCount: number
  status: CatalogReviewStatus
  note: string | null
  reviewedAt: string | null
}

export interface CatalogAdminDetail extends CatalogAdminSummary {
  synopsis: string
  tagline: string
  totalChapters: number
  contractError: string | null
  units: CatalogChapterUnit[]
  canPublish: boolean
  blockers: string[]
}

const SPINE_VARIANT_KEY = 'spine'
const SPINE_LAST_CHAPTER = 44
const VARIANT_FIRST_CHAPTER = 45
const VARIANT_LAST_CHAPTER = 50

function toParagraphs(value: Json | null): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function toChoices(value: Json | null): Array<{ id: string; label: string }> {
  if (!Array.isArray(value)) return []
  const choices: Array<{ id: string; label: string }> = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.id === 'string' && typeof record.label === 'string') {
      choices.push({ id: record.id, label: record.label })
    }
  }
  return choices
}

function wordCount(paragraphs: string[]): number {
  return paragraphs.join(' ').split(/\s+/).filter(Boolean).length
}

function reviewKey(variantKey: string, chapterNumber: number): string {
  return `${variantKey}:${chapterNumber}`
}

export function parseCatalogContract(contractJson: Json | null): {
  endingKeys: Array<{ key: string; name: string }>
  error: string | null
} {
  if (!contractJson) return { endingKeys: [], error: 'CONTRACT_MISSING' }
  const raw = typeof contractJson === 'string' ? safeJsonParse(contractJson) : contractJson
  const parsed = CatalogContractSnapshotSchema.safeParse(raw)
  if (!parsed.success) return { endingKeys: [], error: 'CONTRACT_INVALID' }
  return {
    endingKeys: parsed.data.endingCandidates.map((candidate) => ({
      key: candidate.key,
      name: candidate.name,
    })),
    error: null,
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export interface CatalogChapterRow {
  number: number
  title: string
  paragraphs: Json
  choices: Json | null
}

export interface CatalogVariantChapterRow extends CatalogChapterRow {
  ending_key: string
}

export interface CatalogReviewRow {
  chapter_number: number
  variant_key: string
  status: string
  note: string | null
  updated_at: Date
}

export interface CatalogEndingKey {
  key: string
  name: string
}

function toReviewStatus(value: string): CatalogReviewStatus {
  return value === 'approved' || value === 'rewrite_requested' ? value : 'pending'
}

export function buildCatalogUnits(input: {
  spineChapters: CatalogChapterRow[]
  variantChapters: CatalogVariantChapterRow[]
  endingKeys: CatalogEndingKey[]
  reviews: CatalogReviewRow[]
}): CatalogChapterUnit[] {
  const reviewMap = new Map<string, CatalogReviewRow>()
  for (const review of input.reviews) {
    reviewMap.set(reviewKey(review.variant_key, review.chapter_number), review)
  }

  const build = (
    chapter: CatalogChapterRow,
    variantKey: string,
    variantName: string | null,
  ): CatalogChapterUnit => {
    const paragraphs = toParagraphs(chapter.paragraphs)
    const choices = toChoices(chapter.choices)
    const review = reviewMap.get(reviewKey(variantKey, chapter.number))
    return {
      chapterNumber: chapter.number,
      variantKey,
      variantName,
      title: chapter.title,
      paragraphs,
      choices,
      paragraphCount: paragraphs.length,
      wordCount: wordCount(paragraphs),
      choiceCount: choices.length,
      status: toReviewStatus(review?.status ?? 'pending'),
      note: review?.note ?? null,
      reviewedAt: review?.updated_at ? review.updated_at.toISOString() : null,
    }
  }

  const units: CatalogChapterUnit[] = []
  for (const chapter of [...input.spineChapters].sort((a, b) => a.number - b.number)) {
    units.push(build(chapter, SPINE_VARIANT_KEY, null))
  }
  for (const ending of input.endingKeys) {
    const chapters = input.variantChapters
      .filter((row) => row.ending_key === ending.key)
      .sort((a, b) => a.number - b.number)
    for (const chapter of chapters) {
      units.push(build(chapter, ending.key, ending.name))
    }
  }
  return units
}

function countStatus(units: CatalogChapterUnit[], status: CatalogReviewStatus): number {
  return units.filter((unit) => unit.status === status).length
}

export function computeCatalogBlockers(input: {
  spineChapters: CatalogChapterRow[]
  variantChapters: CatalogVariantChapterRow[]
  endingKeys: Array<{ key: string }>
  contractError: string | null
  units: CatalogChapterUnit[]
}): string[] {
  const blockers: string[] = []
  if (input.contractError) blockers.push(input.contractError)

  const spineNumbers = new Set(input.spineChapters.map((row) => row.number))
  for (let n = 1; n <= SPINE_LAST_CHAPTER; n++) {
    if (!spineNumbers.has(n)) {
      blockers.push('SPINE_INCOMPLETE')
      break
    }
  }

  let variantsComplete = input.endingKeys.length > 0
  for (const ending of input.endingKeys) {
    const numbers = new Set(
      input.variantChapters.filter((row) => row.ending_key === ending.key).map((row) => row.number),
    )
    for (let n = VARIANT_FIRST_CHAPTER; n <= VARIANT_LAST_CHAPTER; n++) {
      if (!numbers.has(n)) {
        variantsComplete = false
        break
      }
    }
    if (!variantsComplete) break
  }
  if (!variantsComplete) blockers.push('ENDING_VARIANTS_INCOMPLETE')

  if (input.units.length === 0) blockers.push('CHAPTERS_MISSING')
  else if (input.units.some((unit) => unit.status !== 'approved')) blockers.push('UNITS_NOT_APPROVED')

  return blockers
}

async function loadCatalogStory(storyId: string) {
  const db = getDb()
  const { data, error } = await single(
    db
      .selectFrom('catalog_stories')
      .innerJoin('stories', 'stories.id', 'catalog_stories.story_id')
      .select([
        'catalog_stories.story_id',
        'catalog_stories.status',
        'catalog_stories.chapter_price',
        'catalog_stories.bundle_price',
        'catalog_stories.generation_progress',
        'catalog_stories.published_at',
        'catalog_stories.contract_json',
        'stories.title',
        'stories.synopsis',
        'stories.tagline',
        'stories.total_chapters',
        'stories.visibility',
        'stories.story_mode',
      ])
      .where('catalog_stories.story_id', '=', storyId)
      .limit(1)
      .execute(),
  )
  if (error) throw new Error(`loadCatalogStory: ${error.message}`)
  if (!data) return null
  if (data.story_mode !== 'catalog') throw new CatalogAdminError('NOT_CATALOG')
  return data
}

export async function listCatalogStoriesForAdmin(): Promise<CatalogAdminSummary[]> {
  const db = getDb()
  const { data, error } = await result(
    db
      .selectFrom('catalog_stories')
      .innerJoin('stories', 'stories.id', 'catalog_stories.story_id')
      .select([
        'catalog_stories.story_id',
        'catalog_stories.status',
        'catalog_stories.chapter_price',
        'catalog_stories.bundle_price',
        'catalog_stories.generation_progress',
        'catalog_stories.published_at',
        'stories.title',
        'stories.visibility',
      ])
      .where('stories.story_mode', '=', 'catalog')
      .orderBy('catalog_stories.updated_at', 'desc')
      .execute(),
  )
  if (error) throw new Error(`listCatalogStoriesForAdmin: ${error.message}`)

  const summaries: CatalogAdminSummary[] = []
  for (const row of data ?? []) {
    const detail = await getCatalogStoryForAdmin(row.story_id)
    summaries.push({
      storyId: row.story_id,
      title: row.title,
      status: row.status,
      chapterPrice: row.chapter_price,
      bundlePrice: row.bundle_price,
      generationProgress: row.generation_progress,
      publishedAt: row.published_at ? String(row.published_at) : null,
      visibility: row.visibility,
      totalUnits: detail?.totalUnits ?? 0,
      approvedUnits: detail?.approvedUnits ?? 0,
      rewriteUnits: detail?.rewriteUnits ?? 0,
      pendingUnits: detail?.pendingUnits ?? 0,
    })
  }
  return summaries
}

export async function getCatalogStoryForAdmin(
  storyId: string,
): Promise<CatalogAdminDetail | null> {
  const story = await loadCatalogStory(storyId)
  if (!story) return null

  const db = getDb()
  const spineResult = await result(
    db
      .selectFrom('chapters')
      .select(['number', 'title', 'paragraphs', 'choices'])
      .where('story_id', '=', storyId)
      .where('number', '<=', SPINE_LAST_CHAPTER)
      .orderBy('number', 'asc')
      .execute(),
  )
  if (spineResult.error) throw new Error(`getCatalogStoryForAdmin: ${spineResult.error.message}`)

  const variantResult = await result(
    db
      .selectFrom('catalog_ending_chapters')
      .select(['ending_key', 'number', 'title', 'paragraphs', 'choices'])
      .where('story_id', '=', storyId)
      .where('number', '>=', VARIANT_FIRST_CHAPTER)
      .orderBy('number', 'asc')
      .execute(),
  )
  if (variantResult.error) {
    throw new Error(`getCatalogStoryForAdmin: ${variantResult.error.message}`)
  }

  const reviewResult = await result(
    db
      .selectFrom('catalog_chapter_reviews')
      .select(['chapter_number', 'variant_key', 'status', 'note', 'updated_at'])
      .where('story_id', '=', storyId)
      .execute(),
  )
  if (reviewResult.error) throw new Error(`getCatalogStoryForAdmin: ${reviewResult.error.message}`)

  const contract = parseCatalogContract(story.contract_json)
  const spineChapters = (spineResult.data ?? []) as unknown as CatalogChapterRow[]
  const variantChapters = (variantResult.data ?? []) as unknown as CatalogVariantChapterRow[]
  const reviews = (reviewResult.data ?? []) as unknown as CatalogReviewRow[]

  const units = buildCatalogUnits({
    spineChapters,
    variantChapters,
    endingKeys: contract.endingKeys,
    reviews,
  })
  const blockers = computeCatalogBlockers({
    spineChapters,
    variantChapters,
    endingKeys: contract.endingKeys,
    contractError: contract.error,
    units,
  })

  return {
    storyId,
    title: story.title,
    status: story.status,
    chapterPrice: story.chapter_price,
    bundlePrice: story.bundle_price,
    generationProgress: story.generation_progress,
    publishedAt: story.published_at ? String(story.published_at) : null,
    visibility: story.visibility,
    synopsis: story.synopsis,
    tagline: story.tagline,
    totalChapters: story.total_chapters,
    contractError: contract.error,
    units,
    canPublish: blockers.length === 0,
    blockers,
    totalUnits: units.length,
    approvedUnits: countStatus(units, 'approved'),
    rewriteUnits: countStatus(units, 'rewrite_requested'),
    pendingUnits: countStatus(units, 'pending'),
  }
}

function assertValidReviewStatus(status: string): asserts status is CatalogReviewStatus {
  if (status !== 'pending' && status !== 'approved' && status !== 'rewrite_requested') {
    throw new CatalogAdminError('INVALID_INPUT')
  }
}

async function assertUnitExists(input: {
  storyId: string
  chapterNumber: number
  variantKey: string
}): Promise<void> {
  const db = getDb()
  const table = input.variantKey === SPINE_VARIANT_KEY ? 'chapters' : 'catalog_ending_chapters'

  const query = table === 'chapters'
    ? db
        .selectFrom('chapters')
        .select('number')
        .where('story_id', '=', input.storyId)
        .where('number', '=', input.chapterNumber)
        .limit(1)
    : db
        .selectFrom('catalog_ending_chapters')
        .select('number')
        .where('story_id', '=', input.storyId)
        .where('ending_key', '=', input.variantKey)
        .where('number', '=', input.chapterNumber)
        .limit(1)

  const { data, error } = await single(query.execute())
  if (error) throw new Error(`assertUnitExists: ${error.message}`)
  if (!data) throw new CatalogAdminError('CHAPTER_NOT_FOUND')
}

export async function saveChapterReview(input: {
  storyId: string
  chapterNumber: number
  variantKey: string
  status: string
  note?: string | null
  adminUserId: string
}): Promise<void> {
  assertValidReviewStatus(input.status)
  await loadCatalogStory(input.storyId)
  await assertUnitExists(input)

  const db = getDb()
  const { error } = await result(
    db
      .insertInto('catalog_chapter_reviews')
      .values({
        story_id: input.storyId,
        chapter_number: input.chapterNumber,
        variant_key: input.variantKey,
        status: input.status,
        note: input.note?.trim() ? input.note.trim().slice(0, 2000) : null,
        reviewed_by: input.adminUserId,
        updated_at: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.columns(['story_id', 'chapter_number', 'variant_key']).doUpdateSet({
          status: input.status,
          note: input.note?.trim() ? input.note.trim().slice(0, 2000) : null,
          reviewed_by: input.adminUserId,
          updated_at: new Date().toISOString(),
        }),
      )
      .execute(),
  )
  if (error) throw new Error(`saveChapterReview: ${error.message}`)
}

export interface ChapterContentUpdate {
  title?: string
  paragraphs?: string[]
  choices?: Array<{ id: string; label: string }>
}

function assertContentUpdate(update: ChapterContentUpdate): void {
  if (update.title !== undefined) {
    const title = update.title.trim()
    if (title.length < 1 || title.length > 200) throw new CatalogAdminError('INVALID_INPUT')
  }
  if (update.paragraphs !== undefined) {
    if (update.paragraphs.length < 1 || update.paragraphs.length > 40) {
      throw new CatalogAdminError('INVALID_INPUT')
    }
    for (const paragraph of update.paragraphs) {
      if (paragraph.trim().length < 1 || paragraph.length > 6000) {
        throw new CatalogAdminError('INVALID_INPUT')
      }
    }
  }
  if (update.choices !== undefined) {
    if (update.choices.length < 2 || update.choices.length > 4) {
      throw new CatalogAdminError('INVALID_INPUT')
    }
    for (const choice of update.choices) {
      if (!choice.id.trim() || !choice.label.trim() || choice.label.length > 160) {
        throw new CatalogAdminError('INVALID_INPUT')
      }
    }
  }
  if (
    update.title === undefined
    && update.paragraphs === undefined
    && update.choices === undefined
  ) {
    throw new CatalogAdminError('INVALID_INPUT')
  }
}

export async function updateCatalogChapterContent(input: {
  storyId: string
  chapterNumber: number
  variantKey: string
  update: ChapterContentUpdate
  adminUserId: string
}): Promise<void> {
  assertContentUpdate(input.update)
  await loadCatalogStory(input.storyId)
  await assertUnitExists(input)

  const db = getDb()
  const values: Record<string, unknown> = {}
  if (input.update.title !== undefined) values.title = input.update.title.trim()
  if (input.update.paragraphs !== undefined) {
    values.paragraphs = JSON.stringify(
      input.update.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean),
    )
  }
  if (input.update.choices !== undefined) {
    values.choices = JSON.stringify(
      input.update.choices.map((choice) => ({ id: choice.id.trim(), label: choice.label.trim() })),
    )
  }

  const table = input.variantKey === SPINE_VARIANT_KEY ? 'chapters' : 'catalog_ending_chapters'
  const query = table === 'chapters'
    ? db.updateTable('chapters').set(values as never).where('story_id', '=', input.storyId).where('number', '=', input.chapterNumber)
    : db
        .updateTable('catalog_ending_chapters')
        .set(values as never)
        .where('story_id', '=', input.storyId)
        .where('ending_key', '=', input.variantKey)
        .where('number', '=', input.chapterNumber)

  const { error } = await result(query.execute())
  if (error) throw new Error(`updateCatalogChapterContent: ${error.message}`)

  // Teks berubah berarti persetujuan lama tidak lagi berlaku.
  await saveChapterReview({
    storyId: input.storyId,
    chapterNumber: input.chapterNumber,
    variantKey: input.variantKey,
    status: 'pending',
    note: null,
    adminUserId: input.adminUserId,
  })
}

export async function publishCatalogStory(input: {
  storyId: string
  adminUserId: string
}): Promise<CatalogAdminDetail> {
  const detail = await getCatalogStoryForAdmin(input.storyId)
  if (!detail) throw new CatalogAdminError('NOT_FOUND')
  if (!detail.canPublish) throw new CatalogAdminError('NOT_READY')

  const db = getDb()
  const publishedAt = new Date().toISOString()
  const catalogUpdate = await result(
    db
      .updateTable('catalog_stories')
      .set({
        status: 'published',
        published_at: publishedAt,
        published_by: input.adminUserId,
        updated_at: publishedAt,
      })
      .where('story_id', '=', input.storyId)
      .execute(),
  )
  if (catalogUpdate.error) throw new Error(`publishCatalogStory: ${catalogUpdate.error.message}`)

  const storyUpdate = await result(
    db
      .updateTable('stories')
      .set({ visibility: 'public' })
      .where('id', '=', input.storyId)
      .execute(),
  )
  if (storyUpdate.error) throw new Error(`publishCatalogStory: ${storyUpdate.error.message}`)

  const published = await getCatalogStoryForAdmin(input.storyId)
  if (!published) throw new CatalogAdminError('NOT_FOUND')
  return published
}

/**
 * Tarik dari Beranda. `stories.visibility` sengaja tetap `public` supaya pembaca
 * yang sudah membeli tetap bisa membuka bab; status katalog yang menyembunyikan
 * novel dari Explore dan menutup pembelian baru.
 */
export async function archiveCatalogStory(input: {
  storyId: string
  adminUserId: string
}): Promise<void> {
  await loadCatalogStory(input.storyId)
  const db = getDb()
  const now = new Date().toISOString()
  const { error } = await result(
    db
      .updateTable('catalog_stories')
      .set({ status: 'archived', updated_at: now })
      .where('story_id', '=', input.storyId)
      .execute(),
  )
  if (error) throw new Error(`archiveCatalogStory: ${error.message}`)
}

import 'server-only'
import { getDb, result, single, type DbResult, type Json } from '@lakoku/db'
import { createResilientStoryContract, type ContractSource } from '@/lib/story-engine/contract-generation.server'
import { contractToCanonBootstrap } from '@/lib/story-engine/contract-persistence.server'
import { loadCanonSnapshot } from '@/lib/narrative/loader'
import type { GenerationProvider } from '@lakoku/ai-gateway'
import type { StoryContract } from '@/lib/story-engine/story-contract'
import { assertCatalogStoryId } from '@/lib/catalog/catalog-contract'
import type {
  CatalogChapterRef,
  CatalogGeneratorStoryState,
  CatalogGeneratorWriter,
} from '@/lib/catalog/generator.server'

/** `pg` mengirim array JS sebagai literal array Postgres, bukan JSON; jsonb wajib teks JSON. */
function jsonValue(value: unknown): Json {
  return JSON.stringify(value) as unknown as Json
}

function assertOk(res: DbResult<unknown>, label: string): void {
  if (res.error) throw new Error(`[catalog-generate] ${label} gagal: ${res.error.message}`)
}

export interface CreateCatalogDraftInput {
  storyId: string
  title: string
  tagline: string
  synopsis: string
  protagonistName: string
  tropes: string[]
  genreId: string | null
  provider: GenerationProvider
}

export interface CreateCatalogDraftResult {
  contract: StoryContract
  contractSource: ContractSource
}

/**
 * Buat draf novel katalog: kontrak cerita dari mesin authoring (LLM dengan
 * fallback template), lalu simpan stories + catalog_stories + canon bootstrap
 * (karakter, fakta, thread, blueprint) yang dipakai pipeline generasi produksi.
 */
export async function createCatalogDraft(input: CreateCatalogDraftInput): Promise<CreateCatalogDraftResult> {
  assertCatalogStoryId(input.storyId)
  const db = getDb()

  const existing = await single(
    db.selectFrom('stories').select('id').where('id', '=', input.storyId).limit(1).execute(),
  )
  if (existing.error) throw new Error(`[catalog-generate] cek draf gagal: ${existing.error.message}`)
  if (existing.data) throw new Error(`CATALOG_STORY_EXISTS:${input.storyId}`)

  const { normalizeTasteProfile } = await import('@/lib/taste-profile/schema')
  const taste = normalizeTasteProfile({
    version: 1,
    likedTropes: input.tropes
      .map((trope) => trope.trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 16),
    dramaIntensity: 'tinggi',
  })
  taste.primaryGenreId = (input.genreId ?? null) as typeof taste.primaryGenreId

  const { contract: rawContract, contractSource } = await createResilientStoryContract({
    storyId: input.storyId,
    tasteJson: taste,
    provider: input.provider,
  })
  const canon = contractToCanonBootstrap(rawContract)

  assertOk(await result(
    db.insertInto('stories').values({
      id: input.storyId,
      title: input.title,
      tagline: input.tagline,
      role: input.protagonistName,
      tropes: jsonValue(input.tropes.slice(0, 8)),
      total_chapters: 50,
      synopsis: input.synopsis,
      status: 'BARU',
      current_chapter: 0,
      visibility: 'private',
      story_mode: 'catalog',
      owner_user_id: null,
      jejak: jsonValue([]),
    }).execute(),
  ), 'insert stories')

  assertOk(await result(
    db.insertInto('catalog_stories').values({
      story_id: input.storyId,
      status: 'draft',
      chapter_price: 5,
      bundle_price: 150,
      contract_json: jsonValue(rawContract),
      generation_progress: 0,
    }).execute(),
  ), 'insert catalog_stories')

  if (canon.characters.length > 0) {
    assertOk(await result(db.insertInto('characters').values(canon.characters).execute()), 'insert characters')
  }
  if (canon.characterAliases.length > 0) {
    assertOk(await result(db.insertInto('character_aliases').values(canon.characterAliases).execute()), 'insert character_aliases')
  }
  if (canon.voiceSheets.length > 0) {
    assertOk(await result(db.insertInto('character_voice_sheets').values(
      canon.voiceSheets.map((sheet) => ({
        ...sheet,
        speech_habits: jsonValue(sheet.speech_habits),
        forbidden_words: jsonValue(sheet.forbidden_words),
        sample_lines: jsonValue(sheet.sample_lines),
      })),
    ).execute()), 'insert voice_sheets')
  }
  if (canon.facts.length > 0) {
    assertOk(await result(db.insertInto('facts_ledger').values(canon.facts).execute()), 'insert facts')
  }
  if (canon.knowledge.length > 0) {
    assertOk(await result(db.insertInto('knowledge_scopes').values(canon.knowledge).execute()), 'insert knowledge')
  }
  if (canon.secrets.length > 0) {
    assertOk(await result(db.insertInto('secrets_reveals').values(canon.secrets).execute()), 'insert secrets')
  }
  if (canon.threads.length > 0) {
    assertOk(await result(db.insertInto('story_threads').values(canon.threads).execute()), 'insert threads')
  }
  if (canon.blueprints.length > 0) {
    assertOk(await result(db.insertInto('chapter_blueprints').values(
      canon.blueprints.map((blueprint) => ({
        ...blueprint,
        mandatory_beats: jsonValue(blueprint.mandatory_beats),
        forbidden_reveals: jsonValue(blueprint.forbidden_reveals),
        allowed_state_delta: jsonValue(blueprint.allowed_state_delta),
        introduces_characters: jsonValue(blueprint.introduces_characters),
      })),
    ).execute()), 'insert blueprints')
  }

  return { contract: rawContract, contractSource }
}

function toChapterRef(paragraphs: unknown, fallbackTitle: string): CatalogChapterRef {
  const parsed = typeof paragraphs === 'string' ? JSON.parse(paragraphs) : paragraphs
  return {
    title: fallbackTitle,
    paragraphs: Array.isArray(parsed) ? parsed.map(String) : [],
  }
}

/** Writer katalog di atas DB produksi: chapters, choice_outcomes, catalog_ending_chapters. */
export function createDbCatalogWriter(): CatalogGeneratorWriter {
  return {
    async loadState(storyId): Promise<CatalogGeneratorStoryState | null> {
      const db = getDb()
      const row = await single(
        db
          .selectFrom('catalog_stories')
          .innerJoin('stories', 'stories.id', 'catalog_stories.story_id')
          .select([
            'catalog_stories.status',
            'catalog_stories.contract_json',
          ])
          .where('catalog_stories.story_id', '=', storyId)
          .limit(1)
          .execute(),
      )
      if (row.error) throw new Error(`[catalog-generate] loadState gagal: ${row.error.message}`)
      if (!row.data) return null
      const rawContract = typeof row.data.contract_json === 'string'
        ? JSON.parse(row.data.contract_json)
        : row.data.contract_json

      const spineResult = await result(
        db
          .selectFrom('chapters')
          .select(['number', 'title', 'paragraphs'])
          .where('story_id', '=', storyId)
          .orderBy('number', 'asc')
          .execute(),
      )
      assertOk(spineResult, 'loadState chapters')
      const spine = new Map<number, CatalogChapterRef>()
      for (const chapter of spineResult.data ?? []) {
        spine.set(Number(chapter.number), toChapterRef(chapter.paragraphs, String(chapter.title)))
      }

      const variantResult = await result(
        db
          .selectFrom('catalog_ending_chapters')
          .select(['ending_key', 'number', 'title', 'paragraphs'])
          .where('story_id', '=', storyId)
          .orderBy('number', 'asc')
          .execute(),
      )
      assertOk(variantResult, 'loadState variants')
      const variants = new Map<string, Map<number, CatalogChapterRef>>()
      for (const chapter of variantResult.data ?? []) {
        const key = String(chapter.ending_key)
        const map = variants.get(key) ?? new Map<number, CatalogChapterRef>()
        map.set(Number(chapter.number), toChapterRef(chapter.paragraphs, String(chapter.title)))
        variants.set(key, map)
      }

      return {
        status: String(row.data.status),
        contract: rawContract as StoryContract,
        spine,
        variants,
      }
    },

    async loadCanon(storyId) {
      return loadCanonSnapshot(storyId)
    },

    async markGenerating(storyId) {
      const db = getDb()
      assertOk(await result(
        db.updateTable('catalog_stories')
          .set({ status: 'generating', updated_at: new Date().toISOString() })
          .where('story_id', '=', storyId)
          .execute(),
      ), 'markGenerating')
    },

    async writeSpineChapter(storyId, chapter): Promise<void> {
      const db = getDb()
      assertOk(await result(
        db.deleteFrom('choice_outcomes')
          .where('story_id', '=', storyId)
          .where('chapter_number', '=', chapter.chapterNumber)
          .execute(),
      ), 'delete outcomes')
      assertOk(await result(
        db.deleteFrom('chapters')
          .where('story_id', '=', storyId)
          .where('number', '=', chapter.chapterNumber)
          .execute(),
      ), 'delete chapter')
      assertOk(await result(
        db.insertInto('chapters').values({
          story_id: storyId,
          number: chapter.chapterNumber,
          title: chapter.title,
          paragraphs: jsonValue(chapter.paragraphs),
          choice_prompt: chapter.choicePrompt,
          choices: chapter.choices.length > 0 ? jsonValue(chapter.choices) : null,
        }).execute(),
      ), 'insert chapter')
      if (chapter.outcomes.length > 0) {
        assertOk(await result(
          db.insertInto('choice_outcomes').values(chapter.outcomes.map((outcome) => ({
            story_id: storyId,
            chapter_number: chapter.chapterNumber,
            choice_id: outcome.choiceId,
            consequence: jsonValue(outcome.consequence),
            next_chapter_number: outcome.nextChapterNumber,
            is_ending: outcome.isEnding,
            direction_hint: outcome.directionHint ?? null,
            effect_json: jsonValue(outcome.effect),
          }))).execute(),
        ), 'insert outcomes')
      }
    },

    async writeVariantChapter(storyId, endingKey, chapter): Promise<void> {
      const db = getDb()
      assertOk(await result(
        db.deleteFrom('catalog_ending_chapters')
          .where('story_id', '=', storyId)
          .where('ending_key', '=', endingKey)
          .where('number', '=', chapter.chapterNumber)
          .execute(),
      ), 'delete variant chapter')
      assertOk(await result(
        db.insertInto('catalog_ending_chapters').values({
          story_id: storyId,
          ending_key: endingKey,
          number: chapter.chapterNumber,
          title: chapter.title,
          paragraphs: jsonValue(chapter.paragraphs),
          choice_prompt: chapter.choicePrompt,
          choices: chapter.choices.length > 0 ? jsonValue(chapter.choices) : null,
          outcomes_json: jsonValue(chapter.outcomes.map((outcome) => ({
            choiceId: outcome.choiceId,
            consequence: outcome.consequence,
            nextChapterNumber: outcome.nextChapterNumber,
            isEnding: outcome.isEnding,
            effect: outcome.effect,
            ...(outcome.directionHint ? { directionHint: outcome.directionHint } : {}),
          }))),
        }).execute(),
      ), 'insert variant chapter')
    },

    async deleteSpineChapter(storyId, chapterNumber): Promise<void> {
      const db = getDb()
      assertOk(await result(
        db.deleteFrom('choice_outcomes')
          .where('story_id', '=', storyId)
          .where('chapter_number', '=', chapterNumber)
          .execute(),
      ), 'delete outcomes (regenerate)')
      assertOk(await result(
        db.deleteFrom('catalog_chapter_reviews')
          .where('story_id', '=', storyId)
          .where('chapter_number', '=', chapterNumber)
          .execute(),
      ), 'delete review (regenerate)')
      assertOk(await result(
        db.deleteFrom('chapters')
          .where('story_id', '=', storyId)
          .where('number', '=', chapterNumber)
          .execute(),
      ), 'delete chapter (regenerate)')
    },

    async setProgress(storyId, progress): Promise<void> {
      const db = getDb()
      assertOk(await result(
        db.updateTable('catalog_stories')
          .set({ generation_progress: progress, updated_at: new Date().toISOString() })
          .where('story_id', '=', storyId)
          .execute(),
      ), 'setProgress')
    },

    async markReview(storyId): Promise<void> {
      const db = getDb()
      assertOk(await result(
        db.updateTable('catalog_stories')
          .set({ status: 'review', updated_at: new Date().toISOString() })
          .where('story_id', '=', storyId)
          .execute(),
      ), 'markReview catalog')
      assertOk(await result(
        db.updateTable('stories')
          .set({ status: 'SELESAI', current_chapter: 50 })
          .where('id', '=', storyId)
          .execute(),
      ), 'markReview stories')
    },
  }
}

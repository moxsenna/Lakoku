/**
 * Seed cerita demo SELESAI untuk replay UX dan TestSprite.
 *
 * Jalankan:
 *   npx tsx scripts/seed-selasa-demo.ts
 *
 * Idempotent: bersihkan semua row untuk story ID konstan, lalu insert ulang.
 * Memakai service role key. Jangan pernah jalankan dari browser/client.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  buildFixtureSnapshot,
  buildValidDraft,
} from '../fixtures/narrative/fixture-50'

export const DEMO_STORY_ID = 'demo:selasa-akhir'
const TOTAL_CHAPTERS = 50
const ENDING_NAME = 'Rekonsiliasi Bersyarat'

type StoryRow = {
  id: string
  title: string
  cover: string
  tagline: string
  role: string
  tropes: string[]
  total_chapters: number
  synopsis: string
  status: 'SELESAI'
  current_chapter: number
  jejak: Array<{
    chapter: number
    decision: string
    consequence: string
  }>
  ending_name: string
}

type ChapterRow = {
  story_id: string
  number: number
  title: string
  paragraphs: string[]
  choice_prompt: string
  choices: Array<{
    id: string
    label: string
  }>
}

type ChoiceOutcomeRow = {
  story_id: string
  chapter_number: number
  choice_id: string
  consequence: string[]
  next_chapter_number: number | null
  is_ending: boolean
}

export type SelasaDemoSeedRows = {
  stories: StoryRow[]
  chapters: ChapterRow[]
  choiceOutcomes: ChoiceOutcomeRow[]
}

function buildChoices(): ChapterRow['choices'] {
  return [
    { id: 'maju', label: 'Melangkah maju menghadapi keadaan' },
    { id: 'tahan', label: 'Menahan diri dan mengamati' },
  ]
}

function buildOutcomes(chapterNumber: number): ChoiceOutcomeRow[] {
  const isEnding = chapterNumber >= TOTAL_CHAPTERS
  const nextChapterNumber = isEnding ? null : chapterNumber + 1

  return [
    {
      story_id: DEMO_STORY_ID,
      chapter_number: chapterNumber,
      choice_id: 'maju',
      consequence: isEnding
        ? [
            ENDING_NAME,
            'Kau memilih bicara jujur, lalu keluarga itu mulai berdamai dengan kebenaran.',
          ]
        : ['Kau maju; langkah itu membuka jalan ke bab berikutnya.'],
      next_chapter_number: nextChapterNumber,
      is_ending: isEnding,
    },
    {
      story_id: DEMO_STORY_ID,
      chapter_number: chapterNumber,
      choice_id: 'tahan',
      consequence: isEnding
        ? [
            'Kemenangan Pahit',
            'Kau memilih menahan diri, dan kebenaran tetap menang dengan harga yang berat.',
          ]
        : ['Kau menahan diri; arus cerita tetap membawamu ke bab berikutnya.'],
      next_chapter_number: nextChapterNumber,
      is_ending: isEnding,
    },
  ]
}

export function buildSelasaDemoSeedRows(): SelasaDemoSeedRows {
  const snapshot = buildFixtureSnapshot()
  const chapters: ChapterRow[] = []
  const choiceOutcomes: ChoiceOutcomeRow[] = []

  for (let chapterNumber = 1; chapterNumber <= TOTAL_CHAPTERS; chapterNumber++) {
    const draft = buildValidDraft(snapshot, chapterNumber)

    chapters.push({
      story_id: DEMO_STORY_ID,
      number: chapterNumber,
      title: draft.title,
      paragraphs: draft.paragraphs,
      choice_prompt: 'Apa yang kaulakukan sekarang?',
      choices: buildChoices(),
    })

    choiceOutcomes.push(...buildOutcomes(chapterNumber))
  }

  return {
    stories: [
      {
        id: DEMO_STORY_ID,
        title: 'Selasa Terakhir di Rumah Kaca',
        cover: '/placeholder.svg?height=400&width=300',
        tagline: 'Satu keluarga, satu warisan, dan satu Selasa yang mengubah segalanya.',
        role: 'Rani, pewaris yang pulang terlambat',
        tropes: ['Rahasia Keluarga', 'Warisan', 'Pengkhianatan'],
        total_chapters: TOTAL_CHAPTERS,
        synopsis:
          'Rani pulang setelah kematian ayahnya dan menemukan rumah kaca keluarga menyimpan kunci wasiat yang diperebutkan semua orang.',
        status: 'SELESAI',
        current_chapter: TOTAL_CHAPTERS,
        jejak: [
          {
            chapter: 12,
            decision: 'Membuka brankas tua',
            consequence: 'Rani menemukan salinan wasiat yang tidak pernah diumumkan.',
          },
          {
            chapter: 32,
            decision: 'Mempercayai Dimas',
            consequence: 'Rahasia hubungan Dimas dengan keluarga mulai terkuak.',
          },
          {
            chapter: 50,
            decision: 'Mengungkap kebenaran di depan keluarga',
            consequence: ENDING_NAME,
          },
        ],
        ending_name: ENDING_NAME,
      },
    ],
    chapters,
    choiceOutcomes,
  }
}

function admin() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di env.')
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function deleteByStoryId(
  db: SupabaseClient,
  table: string,
  column = 'story_id',
) {
  const { error } = await db.from(table).delete().eq(column, DEMO_STORY_ID)
  if (error) throw new Error(`delete ${table}: ${error.message}`)
}

async function deleteCharacterStates(db: SupabaseClient) {
  const characterIds = buildFixtureSnapshot().characters.map((character) => character.id)
  if (!characterIds.length) return

  const { error } = await db
    .from('character_states')
    .delete()
    .in('character_id', characterIds)
  if (error) throw new Error(`delete character_states: ${error.message}`)
}

async function insertRows(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
) {
  if (!rows.length) return

  const { error } = await db.from(table).insert(rows)
  if (error) throw new Error(`insert ${table}: ${error.message}`)
  console.log(`[seed-selasa-demo] ${table}: ${rows.length} baris`)
}

async function assertCount(
  db: SupabaseClient,
  table: string,
  expected: number,
  column = 'story_id',
) {
  const { count, error } = await db
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, DEMO_STORY_ID)
  if (error) throw new Error(`count ${table}: ${error.message}`)
  if (count !== expected) {
    throw new Error(`count ${table}: expected ${expected}, got ${count ?? 'null'}`)
  }
}

export async function seedSelasaDemo() {
  const db = admin()
  const rows = buildSelasaDemoSeedRows()

  for (const table of [
    'content_reports',
    'story_events',
    'retrieval_logs',
    'generation_leases',
    'idempotency_keys',
    'reader_states',
    'choice_outcomes',
    'chapters',
    'chapter_blueprints',
    'act_rollups',
    'story_threads',
    'timeline_events',
    'secrets_reveals',
    'knowledge_scopes',
    'facts_ledger',
    'character_voice_sheets',
    'character_aliases',
    'characters',
  ]) {
    await deleteByStoryId(db, table)
  }
  await deleteCharacterStates(db)
  await deleteByStoryId(db, 'stories', 'id')

  await insertRows(db, 'stories', rows.stories)
  await insertRows(db, 'chapters', rows.chapters)
  await insertRows(db, 'choice_outcomes', rows.choiceOutcomes)

  await assertCount(db, 'stories', 1, 'id')
  await assertCount(db, 'chapters', TOTAL_CHAPTERS)
  await assertCount(db, 'choice_outcomes', TOTAL_CHAPTERS * 2)

  console.log(`[seed-selasa-demo] selesai untuk story "${DEMO_STORY_ID}".`)
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/seed-selasa-demo.ts')) {
  seedSelasaDemo().catch((error) => {
    console.error('[seed-selasa-demo] gagal:', error.message)
    process.exit(1)
  })
}

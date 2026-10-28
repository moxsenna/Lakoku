import { Client } from 'pg'
import { createDeterministicProvider, DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway'
import { assertLoopbackDatabaseUrl } from './personalized-db-safety'
import { createCatalogDraft, createDbCatalogWriter } from '../lib/catalog/generator-db.server'
import {
  generateCatalogNovel,
  regenerateCatalogSpineChapter,
} from '../lib/catalog/generator.server'
import { assertCatalogContract } from '../lib/catalog/catalog-contract'
import { getCatalogStoryForAdmin } from '../lib/catalog/admin.server'

const STORY_ID = 'catalog:plan2-live-check'
const TITLE = 'Uji Generator Plan 2'
const SYNOPSIS = 'Sebuah uji end-to-end generator novel katalog di database lokal tanpa biaya inferensi.'
const PROTAGONIST = 'Laras'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[plan2-live] ${message}`)
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

async function cleanup(client: Client): Promise<void> {
  const tables = [
    'catalog_chapter_reviews',
    'choice_outcomes',
    'chapters',
    'catalog_ending_chapters',
    'catalog_stories',
    'chapter_blueprints',
    'story_threads',
    'secrets_reveals',
    'knowledge_scopes',
    'facts_ledger',
    'character_voice_sheets',
    'character_aliases',
    'characters',
    'stories',
  ]
  for (const table of tables) {
    await client.query(`delete from ${table} where ${table === 'stories' ? 'id' : 'story_id'} = $1`, [STORY_ID])
  }
}

async function main(): Promise<void> {
  const host = assertLoopbackDatabaseUrl(process.env.DATABASE_URL)
  check(process.env.CATALOG_GENERATE_DB === '1', 'CATALOG_GENERATE_DB=1 wajib')
  check(process.env.LAKOKU_ALLOW_DETERMINISTIC_PROVIDER === '1', 'provider deterministik wajib disetujui untuk live check')
  console.log(`[plan2-live] Target database host: ${host}`)

  const provider = createDeterministicProvider(DEFAULT_RUNTIME_POLICY)
  const writer = createDbCatalogWriter()
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await cleanup(client)

    const draft = await createCatalogDraft({
      storyId: STORY_ID,
      title: TITLE,
      tagline: 'Uji generator katalog.',
      synopsis: SYNOPSIS,
      protagonistName: PROTAGONIST,
      tropes: ['Rahasia Keluarga', 'Kebangkitan Diri'],
      genreId: null,
      provider,
    })
    console.log(`[plan2-live] Draf dibuat dengan kontrak: ${draft.contractSource}`)
    check(draft.contractSource === 'template_fallback', 'provider deterministik harus memakai fallback template')
    assertCatalogContract(draft.contract)

    const draftRow = await client.query<{ status: string; generation_progress: number; contract_json: unknown }>(
      'select status, generation_progress, contract_json from catalog_stories where story_id = $1',
      [STORY_ID],
    )
    check(draftRow.rows[0]?.status === 'draft', 'status awal harus draft')
    check(draftRow.rows[0]?.generation_progress === 0, 'progres awal harus 0')

    const storyRow = await client.query<{ status: string; visibility: string; story_mode: string; owner_user_id: string | null; role: string }>(
      'select status, visibility, story_mode, owner_user_id, role from stories where id = $1',
      [STORY_ID],
    )
    check(storyRow.rows[0]?.status === 'BARU', 'stories.status awal BARU')
    check(storyRow.rows[0]?.visibility === 'private', 'draf katalog tidak publik')
    check(storyRow.rows[0]?.story_mode === 'catalog', 'story_mode harus catalog')
    check(storyRow.rows[0]?.owner_user_id === null, 'owner harus null')
    check(storyRow.rows[0]?.role === PROTAGONIST, 'nama tokoh utama tersimpan')

    const canonCounts = await client.query<{ characters: string; blueprints: string }>(
      `select
         (select count(*) from characters where story_id = $1)::text as characters,
         (select count(*) from chapter_blueprints where story_id = $1)::text as blueprints`,
      [STORY_ID],
    )
    check(Number(canonCounts.rows[0]?.characters) > 0, 'canon karakter harus terisi')
    check(Number(canonCounts.rows[0]?.blueprints) === 50, 'blueprint harus 50 bab')

    const result = await generateCatalogNovel({ provider, writer }, { storyId: STORY_ID, runId: 'plan2-live', log: () => {} })
    check(result.completed, 'generasi harus lengkap')
    check(result.spineWritten === 44, `spine harus +44, dapat ${result.spineWritten}`)
    check(result.variantsWritten === 18, `varian harus +18, dapat ${result.variantsWritten}`)

    const spineCount = await client.query<{ count: string }>(
      "select count(*)::text as count from chapters where story_id = $1 and number <= 44",
      [STORY_ID],
    )
    check(spineCount.rows[0]?.count === '44', 'harus ada 44 bab spine')

    const bab44 = await client.query<{ choice_id: string; direction_hint: string | null; effect_json: Record<string, Record<string, number>>; consequence: unknown }>(
      'select choice_id, direction_hint, effect_json, consequence from choice_outcomes where story_id = $1 and chapter_number = 44 order by choice_id',
      [STORY_ID],
    )
    check(bab44.rows.length === 3, `bab 44 harus 3 pilihan, dapat ${bab44.rows.length}`)
    const candidateKeys = new Set(draft.contract.endingCandidates.map((candidate) => candidate.key))
    for (const row of bab44.rows) {
      const deltas = row.effect_json?.endingBiasDeltas ?? {}
      check(Object.keys(deltas).length === 1 && candidateKeys.has(Object.keys(deltas)[0]!), `bab 44 ${row.choice_id} harus membiaskan satu kandidat`)
      check(Object.values(deltas)[0] === 10, 'bias bab 44 harus 10')
      check(typeof row.direction_hint === 'string' && row.direction_hint.length > 0, 'bab 44 harus punya penanda arah')
      const consequence = typeof row.consequence === 'string' ? JSON.parse(row.consequence) : row.consequence
      const words = (consequence as string[]).reduce((sum, p) => sum + countWords(p), 0)
      check(words >= 40, `reaksi bab 44 ${row.choice_id} harus >= 40 kata, dapat ${words}`)
    }

    const spineOutcomeCounts = await client.query<{ number: number; outcomes: string; choices: unknown }>(
      `select c.number,
              (select count(*) from choice_outcomes o where o.story_id = c.story_id and o.chapter_number = c.number)::text as outcomes,
              c.choices
         from chapters c
        where c.story_id = $1 and c.number <= 44
        order by c.number`,
      [STORY_ID],
    )
    check(spineOutcomeCounts.rows.length === 44, 'spine harus 44 baris bab')
    for (const row of spineOutcomeCounts.rows) {
      const choiceCount = Array.isArray(row.choices) ? row.choices.length : (typeof row.choices === 'string' ? JSON.parse(row.choices).length : 0)
      check(Number(row.outcomes) === choiceCount, `bab ${row.number}: outcome (${row.outcomes}) harus sama dengan pilihan (${choiceCount})`)
      check(Number(row.outcomes) >= 2, `bab ${row.number} minimal 2 pilihan`)
    }
    const allSpineOutcomes = await client.query<{ consequence: unknown; direction_hint: string | null }>(
      'select consequence, direction_hint from choice_outcomes where story_id = $1 and chapter_number <= 44',
      [STORY_ID],
    )
    for (const row of allSpineOutcomes.rows) {
      const consequence = typeof row.consequence === 'string' ? JSON.parse(row.consequence) : row.consequence
      const words = (consequence as string[]).reduce((sum, p) => sum + countWords(p), 0)
      check(words >= 40, 'semua reaksi spine harus >= 40 kata')
      if (row.direction_hint !== null) {
        check(!/\b(ai|narraza|rag|token|skor|bias|ending|rute|pembaca)\b/i.test(row.direction_hint), 'penanda arah harus bebas istilah internal')
      }
    }

    const variantCounts = await client.query<{ ending_key: string; chapters: string; finals: string }>(
      `select ending_key,
              count(*)::text as chapters,
              count(*) filter (where number = 50)::text as finals
         from catalog_ending_chapters
        where story_id = $1
        group by ending_key`,
      [STORY_ID],
    )
    check(variantCounts.rows.length === 3, 'harus ada 3 varian ending')
    for (const row of variantCounts.rows) {
      check(row.chapters === '6', `varian ${row.ending_key} harus 6 bab, dapat ${row.chapters}`)
      check(row.finals === '1', `varian ${row.ending_key} harus punya bab 50`)
    }

    const finalChapters = await client.query<{ choices: unknown; outcomes_json: unknown }>(
      'select choices, outcomes_json from catalog_ending_chapters where story_id = $1 and number = 50',
      [STORY_ID],
    )
    for (const row of finalChapters.rows) {
      check(row.choices === null, 'bab 50 tidak boleh punya pilihan')
      const outcomes = typeof row.outcomes_json === 'string' ? JSON.parse(row.outcomes_json) : row.outcomes_json
      check(Array.isArray(outcomes) && outcomes.length === 0, 'bab 50 tidak boleh punya outcome')
    }

    const reviewRow = await client.query(
      `insert into catalog_chapter_reviews (story_id, chapter_number, variant_key, status)
       values ($1, 12, 'spine', 'approved') returning chapter_number`,
      [STORY_ID],
    )
    check(reviewRow.rowCount === 1, 'gagal menyiapkan review tiruan')

    await regenerateCatalogSpineChapter({ provider, writer }, { storyId: STORY_ID, chapterNumber: 12, runId: 'plan2-regen', log: () => {} })
    const reviewAfter = await client.query<{ count: string }>(
      "select count(*)::text as count from catalog_chapter_reviews where story_id = $1 and chapter_number = 12 and variant_key = 'spine'",
      [STORY_ID],
    )
    check(reviewAfter.rows[0]?.count === '0', 'regenerate harus menghapus status tinjauan bab itu')
    const chapter12 = await client.query<{ count: string }>(
      "select count(*)::text as count from chapters where story_id = $1 and number = 12",
      [STORY_ID],
    )
    check(chapter12.rows[0]?.count === '1', 'bab 12 harus ditulis ulang')

    const resume = await generateCatalogNovel({ provider, writer }, { storyId: STORY_ID, runId: 'plan2-resume', log: () => {} })
    check(resume.spineWritten === 0 && resume.variantsWritten === 0 && resume.completed, 'resume tidak boleh menulis ulang')

    const finalState = await client.query<{ status: string; generation_progress: number }>(
      'select status, generation_progress from catalog_stories where story_id = $1',
      [STORY_ID],
    )
    check(finalState.rows[0]?.status === 'review', 'status akhir harus review')
    check(finalState.rows[0]?.generation_progress === 50, 'progres akhir harus 50')

    const storiesFinal = await client.query<{ status: string; current_chapter: number }>(
      'select status, current_chapter from stories where id = $1',
      [STORY_ID],
    )
    check(storiesFinal.rows[0]?.status === 'SELESAI', 'stories.status akhir SELESAI')
    check(storiesFinal.rows[0]?.current_chapter === 50, 'current_chapter akhir 50')

    const adminView = await getCatalogStoryForAdmin(STORY_ID)
    check(adminView !== null, 'admin harus melihat novel hasil generator')
    check(adminView.totalUnits === 62, `unit admin harus 62, dapat ${adminView.totalUnits}`)
    check(adminView.canPublish === false, 'belum disetujui admin, terbit harus terkunci')
    check(adminView.blockers.includes('UNITS_NOT_APPROVED'), 'blocker QC harus muncul')

    await cleanup(client)
    console.log('[plan2-live] Fixture uji dibersihkan.')
    console.log('CATALOG_PLAN2_LIVE_CHECK_OK')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('[plan2-live] GAGAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})

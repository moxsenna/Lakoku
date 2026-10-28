import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { assertLoopbackDatabaseUrl } from './personalized-db-safety'
import { FIXTURE_CATALOG_STORY_ID, seedCatalogFixture } from './seed-catalog-fixture'
import {
  CatalogAdminError,
  archiveCatalogStory,
  getCatalogStoryForAdmin,
  publishCatalogStory,
  saveChapterReview,
  updateCatalogChapterContent,
} from '@/lib/catalog/admin.server'
import { resolveChapterAccess } from '@/lib/credits/access-resolver.server'
import { queryExploreStories } from '@/lib/api/queries'
import { readerUnlockRef } from '@/lib/credits/policy'

const STORY_ID = FIXTURE_CATALOG_STORY_ID
const ADMIN_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const READER_ID = '11111111-1111-4111-8111-111111111111'
const MIGRATION_PATH = 'neon/migrations/20261028120000_catalog_admin_review.sql'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[plan3-live] ${message}`)
  }
}

async function expectErrorCode(
  run: () => Promise<unknown>,
  expected: string,
  label: string,
): Promise<void> {
  let actual: string | null = null
  try {
    await run()
  } catch (err) {
    actual = err instanceof CatalogAdminError ? err.code : 'UNEXPECTED_ERROR'
  }
  check(actual === expected, `${label}: harus ${expected}, dapat ${actual}`)
}

async function resetToReview(client: Client): Promise<void> {
  await client.query('delete from catalog_chapter_reviews where story_id = $1', [STORY_ID])
  await client.query(
    `update catalog_stories
        set status = 'review', published_at = null, published_by = null, updated_at = now()
      where story_id = $1`,
    [STORY_ID],
  )
  await client.query('update stories set visibility = $2 where id = $1', [STORY_ID, 'private'])
}

async function main(): Promise<void> {
  const host = assertLoopbackDatabaseUrl(process.env.DATABASE_URL)
  console.log(`[plan3-live] Target database host: ${host}`)

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const migrationSql = readFileSync(path.resolve(process.cwd(), MIGRATION_PATH), 'utf8')
    await client.query(migrationSql)
    console.log('[plan3-live] Migrasi catalog_chapter_reviews diterapkan.')

    await client.query('delete from credit_ledger where user_id = $1', [READER_ID])
    await seedCatalogFixture()
    await resetToReview(client)

    const initial = await getCatalogStoryForAdmin(STORY_ID)
    check(initial !== null, 'detail awal tidak ditemukan')
    check(initial.status === 'review', `status awal harus review, dapat ${initial.status}`)
    check(initial.contractError === null, `kontrak harus valid, dapat ${initial.contractError}`)
    check(initial.totalUnits === 62, `unit awal harus 62, dapat ${initial.totalUnits}`)
    check(initial.approvedUnits === 0, `unit disetujui awal harus 0, dapat ${initial.approvedUnits}`)
    check(initial.pendingUnits === 62, `unit pending awal harus 62, dapat ${initial.pendingUnits}`)
    check(initial.canPublish === false, 'novel belum boleh terbit tanpa QC')
    check(
      initial.blockers.includes('UNITS_NOT_APPROVED'),
      `blocker UNITS_NOT_APPROVED hilang: ${initial.blockers.join(',')}`,
    )
    for (const mustBeAbsent of [
      'SPINE_INCOMPLETE',
      'ENDING_VARIANTS_INCOMPLETE',
      'CHAPTERS_MISSING',
      'CONTRACT_INVALID',
      'CONTRACT_MISSING',
    ]) {
      check(
        !initial.blockers.includes(mustBeAbsent),
        `fixture lengkap tapi blocker ${mustBeAbsent} muncul`,
      )
    }

    await expectErrorCode(
      () => publishCatalogStory({ storyId: STORY_ID, adminUserId: ADMIN_ID }),
      'NOT_READY',
      'publish sebelum QC',
    )

    await saveChapterReview({
      storyId: STORY_ID,
      chapterNumber: 1,
      variantKey: 'spine',
      status: 'approved',
      adminUserId: ADMIN_ID,
    })
    const afterApprove = await getCatalogStoryForAdmin(STORY_ID)
    check(afterApprove !== null, 'detail setelah setujui tidak ditemukan')
    check(afterApprove.approvedUnits === 1, `unit disetujui harus 1, dapat ${afterApprove.approvedUnits}`)
    check(afterApprove.pendingUnits === 61, `unit pending harus 61, dapat ${afterApprove.pendingUnits}`)
    const approvedUnit = afterApprove.units.find(
      (unit) => unit.variantKey === 'spine' && unit.chapterNumber === 1,
    )
    check(approvedUnit?.status === 'approved', 'unit Bab 1 spine harus approved')

    await saveChapterReview({
      storyId: STORY_ID,
      chapterNumber: 1,
      variantKey: 'spine',
      status: 'approved',
      note: 'cek ulang',
      adminUserId: ADMIN_ID,
    })
    const reviewRows = await client.query<{ count: string; note: string | null }>(
      `select count(*)::text as count, max(note) as note
         from catalog_chapter_reviews
        where story_id = $1 and chapter_number = 1 and variant_key = 'spine'`,
      [STORY_ID],
    )
    check(reviewRows.rows[0]?.count === '1', 'setujui ulang harus upsert, bukan duplikat')
    check(reviewRows.rows[0]?.note === 'cek ulang', 'catatan tinjauan tidak tersimpan')

    const editedParagraphs = [
      'Satu paragraf hasil suntingan admin.',
      'Paragraf kedua hasil suntingan admin.',
    ]
    await updateCatalogChapterContent({
      storyId: STORY_ID,
      chapterNumber: 1,
      variantKey: 'spine',
      update: {
        title: 'Bab 1: Suntingan QC',
        paragraphs: editedParagraphs,
        choices: [
          { id: 'qc-opt-1', label: 'Pilihan QC satu' },
          { id: 'qc-opt-2', label: 'Pilihan QC dua' },
        ],
      },
      adminUserId: ADMIN_ID,
    })
    const afterEdit = await getCatalogStoryForAdmin(STORY_ID)
    check(afterEdit !== null, 'detail setelah edit tidak ditemukan')
    const editedUnit = afterEdit.units.find(
      (unit) => unit.variantKey === 'spine' && unit.chapterNumber === 1,
    )
    check(editedUnit !== undefined, 'unit Bab 1 hilang setelah edit')
    check(editedUnit.title === 'Bab 1: Suntingan QC', 'judul bab tidak tersunting')
    check(editedUnit.paragraphs.length === 2, 'jumlah paragraf tersunting salah')
    check(
      editedUnit.paragraphs[0] === editedParagraphs[0],
      'isi paragraf pertama tidak tersunting',
    )
    check(editedUnit.choiceCount === 2, `jumlah pilihan harus 2, dapat ${editedUnit.choiceCount}`)
    check(
      editedUnit.choices[1]?.label === 'Pilihan QC dua',
      'label pilihan kedua tidak tersunting',
    )
    check(
      editedUnit.status === 'pending',
      `edit teks harus mengembalikan status ke pending, dapat ${editedUnit.status}`,
    )

    const beforeBulk = await getCatalogStoryForAdmin(STORY_ID)
    check(beforeBulk !== null, 'detail sebelum bulk approve tidak ditemukan')
    for (const unit of beforeBulk.units) {
      await saveChapterReview({
        storyId: STORY_ID,
        chapterNumber: unit.chapterNumber,
        variantKey: unit.variantKey,
        status: 'approved',
        adminUserId: ADMIN_ID,
      })
    }
    const ready = await getCatalogStoryForAdmin(STORY_ID)
    check(ready !== null, 'detail siap terbit tidak ditemukan')
    check(ready.approvedUnits === 62, `semua 62 unit harus disetujui, dapat ${ready.approvedUnits}`)
    check(ready.pendingUnits === 0, `unit pending harus 0, dapat ${ready.pendingUnits}`)
    check(ready.canPublish === true, `canPublish harus true, blocker: ${ready.blockers.join(',')}`)
    check(ready.blockers.length === 0, `blocker harus kosong, dapat ${ready.blockers.join(',')}`)

    const exploreBeforePublish = await queryExploreStories()
    check(
      !exploreBeforePublish.some((story) => story.id === STORY_ID),
      'novel review tidak boleh muncul di Jelajah sebelum terbit',
    )

    const published = await publishCatalogStory({ storyId: STORY_ID, adminUserId: ADMIN_ID })
    check(published.status === 'published', `status terbit harus published, dapat ${published.status}`)
    check(published.visibility === 'public', `visibilitas harus public, dapat ${published.visibility}`)
    check(published.publishedAt !== null, 'published_at harus terisi')

    const publishedRow = await client.query<{ published_by: string | null }>(
      'select published_by from catalog_stories where story_id = $1',
      [STORY_ID],
    )
    check(
      publishedRow.rows[0]?.published_by === ADMIN_ID,
      'published_by harus mencatat admin yang menerbitkan',
    )

    const exploreAfterPublish = await queryExploreStories()
    check(
      exploreAfterPublish.some((story) => story.id === STORY_ID),
      'novel terbit harus muncul di Jelajah',
    )

    await archiveCatalogStory({ storyId: STORY_ID, adminUserId: ADMIN_ID })
    const archived = await getCatalogStoryForAdmin(STORY_ID)
    check(archived !== null, 'detail setelah tarik tidak ditemukan')
    check(archived.status === 'archived', `status tarik harus archived, dapat ${archived.status}`)
    check(archived.visibility === 'public', 'visibilitas pembeli lama harus tetap public')

    const exploreAfterArchive = await queryExploreStories()
    check(
      !exploreAfterArchive.some((story) => story.id === STORY_ID),
      'novel ditarik harus hilang dari Jelajah',
    )

    const guestAccess = await resolveChapterAccess({
      userId: null,
      storyId: STORY_ID,
      chapterNumber: 10,
    })
    check(
      guestAccess.readable === false && guestAccess.reason === 'STORY_PENDING' && guestAccess.cost === 0,
      `tamu di novel ditarik harus STORY_PENDING tanpa biaya, dapat ${JSON.stringify(guestAccess)}`,
    )

    const guestFree = await resolveChapterAccess({
      userId: null,
      storyId: STORY_ID,
      chapterNumber: 2,
    })
    check(
      guestFree.readable === true && guestFree.reason === 'FREE_STANDARD',
      `bab gratis tetap terbaca, dapat ${JSON.stringify(guestFree)}`,
    )

    await client.query(
      `insert into credit_ledger (user_id, delta, reason, ref)
       values ($1, -5, 'unlock_chapter', $2)`,
      [READER_ID, readerUnlockRef(STORY_ID, 10, READER_ID)],
    )
    const buyerAccess = await resolveChapterAccess({
      userId: READER_ID,
      storyId: STORY_ID,
      chapterNumber: 10,
    })
    check(
      buyerAccess.readable === true && buyerAccess.reason === 'LEDGER_UNLOCKED',
      `pembeli lama harus tetap terbaca saat ditarik, dapat ${JSON.stringify(buyerAccess)}`,
    )

    await resetToReview(client)
    await client.query('delete from credit_ledger where user_id = $1', [READER_ID])
    console.log('[plan3-live] Fixture dikembalikan ke status review tanpa tinjauan.')
    console.log('CATALOG_PLAN3_LIVE_CHECK_OK')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('[plan3-live] GAGAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})

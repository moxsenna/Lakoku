import { getDb, result, countOf } from '@lakoku/db'

/**
 * Script read-only untuk mengaudit keberadaan kontinuitas pada cerita yang ada.
 * Tidak mengubah atau menghapus data produksi.
 */
async function auditContinuity() {
  console.log('=== LAKOKU CONTINUITY AUDIT (READ-ONLY) ===')
  const db = getDb()

  const { data: stories, error } = await result(
    db.selectFrom('stories').select(['id', 'title', 'story_mode as mode']).limit(50).execute(),
  )
  if (error || !stories) {
    console.error('Gagal mengambil daftar story:', error?.message)
    process.exit(1)
  }

  console.log(`Ditemukan ${stories.length} story untuk diaudit.`)

  for (const story of stories) {
    const count = await countOf(
      db
        .selectFrom('chapters')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('story_id', '=', story.id)
        .execute(),
    )

    console.log(`- Story [${story.id}] "${story.title}" (${story.mode}): ${count ?? 0} bab.`)
  }

  console.log('Audit selesai. Tidak ada mutasi DB yang dilakukan.')
}

auditContinuity().catch((err) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})

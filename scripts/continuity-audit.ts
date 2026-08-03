import { createAdminClient } from '@lakoku/db'

/**
 * Script read-only untuk mengaudit keberadaan kontinuitas pada cerita yang ada.
 * Tidak mengubah atau menghapus data produksi.
 */
async function auditContinuity() {
  console.log('=== LAKOKU CONTINUITY AUDIT (READ-ONLY) ===')
  const db = createAdminClient()

  const { data: stories, error } = await db.from('stories').select('id, title, mode').limit(50)
  if (error) {
    console.error('Gagal mengambil daftar story:', error.message)
    process.exit(1)
  }

  console.log(`Ditemukan ${stories.length} story untuk diaudit.`)

  for (const story of stories) {
    const { count } = await db
      .from('chapters')
      .select('number', { count: 'exact', head: true })
      .eq('story_id', story.id)

    console.log(`- Story [${story.id}] "${story.title}" (${story.mode}): ${count ?? 0} bab.`)
  }

  console.log('Audit selesai. Tidak ada mutasi DB yang dilakukan.')
}

auditContinuity().catch((err) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})

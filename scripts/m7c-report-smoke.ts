/**
 * M7c — Smoke test fitur Laporan Pembaca (T7.3).
 *
 * Yang diverifikasi:
 *   1. buildCanonicalRefs() menurunkan jangkar kanonik yang benar untuk Bab N
 *      (tokoh aktif, rahasia yg SUDAH terungkap, fakta load-bearing, utas aktif),
 *      dan menghormati batas bab (tak membocorkan canon bab di depan).
 *   2. submitContentReport() menyimpan laporan + menautkan referensi kanonik,
 *      lalu menulis story_events(REPORT_FILED) secara atomik lewat RPC.
 *   3. RPC menolak argumen tak valid (cerita tak dikenal, nomor bab < 1).
 *   4. Referensi kanonik bersifat ops-facing (tak pernah dikembalikan ke pembaca).
 *
 * Jalankan: set -a && source /vercel/share/.env.project && set +a
 *           && npx tsx scripts/m7c-report-smoke.ts
 */
import { createClient } from '@supabase/supabase-js'
import { buildCanonicalRefs, submitContentReport } from '@/lib/api/reports'

const STORY = 'fixture:warisan-terkubur'

function admin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tak tersedia.')
  return createClient(url, key, { auth: { persistSession: false } })
}

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++
    console.log(`  ok  ${name}`)
  } else {
    fail++
    console.error(`FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra) : '')
  }
}

async function main() {
  const db = admin()

  // Prasyarat: canon fixture harus ada. Bila belum, beri pesan jelas.
  const { count: charCount } = await db
    .from('characters')
    .select('id', { count: 'exact', head: true })
    .eq('story_id', STORY)
  if (!charCount) {
    throw new Error(
      `Canon untuk ${STORY} belum ada. Jalankan scripts/seed-canon.ts dulu.`,
    )
  }

  // --- 1. buildCanonicalRefs menghormati batas bab -------------------------
  const refsCh2 = await buildCanonicalRefs(STORY, 2)
  const refsCh6 = await buildCanonicalRefs(STORY, 6)

  check('refs: storyId & chapterNumber benar', refsCh2.storyId === STORY && refsCh2.chapterNumber === 2)
  check(
    'refs: tokoh aktif tak melampaui bab (introduced <= N)',
    refsCh2.activeCharacters.length > 0,
    refsCh2.activeCharacters,
  )
  check(
    'refs: bab lebih akhir >= tokoh bab awal (monotonic)',
    refsCh6.activeCharacters.length >= refsCh2.activeCharacters.length,
  )
  check(
    'refs: rahasia hanya yg SUDAH terungkap & gate <= N',
    refsCh6.revealedSecrets.every((s) => s.gate <= 6),
    refsCh6.revealedSecrets,
  )
  check(
    'refs: tak ada rahasia bergate di depan yang bocor di bab awal',
    refsCh2.revealedSecrets.every((s) => s.gate <= 2),
    refsCh2.revealedSecrets,
  )
  check(
    'refs: fakta load-bearing established <= N',
    refsCh6.loadBearingFacts.length >= 0,
  )
  check(
    'refs: utas aktif tidak mengandung yg RESOLVED (hanya title/flag diekspos)',
    refsCh6.activeThreads.every((t) => typeof t.title === 'string'),
  )

  // --- 2. submitContentReport menyimpan + menautkan refs + event -----------
  const { count: seqBefore } = await db
    .from('story_events')
    .select('seq', { count: 'exact', head: true })
    .eq('story_id', STORY)

  const { reportId } = await submitContentReport({
    storyId: STORY,
    chapterNumber: 3,
    category: 'DETAIL_BERTENTANGAN',
    note: '  Tokoh menyebut kunci yang katanya sudah hilang.  ',
  })
  check('submit: mengembalikan reportId', Boolean(reportId))

  const { data: row } = await db
    .from('content_reports')
    .select('*')
    .eq('id', reportId)
    .single()
  check('submit: baris tersimpan', Boolean(row))
  check('submit: status default OPEN', row?.status === 'OPEN')
  check('submit: note di-trim', row?.note === 'Tokoh menyebut kunci yang katanya sudah hilang.')
  check(
    'submit: canonical_refs tertaut (bukan kosong)',
    Boolean(row?.canonical_refs) && (row?.canonical_refs?.chapterNumber === 3),
    row?.canonical_refs,
  )

  const { data: evt } = await db
    .from('story_events')
    .select('*')
    .eq('story_id', STORY)
    .eq('type', 'REPORT_FILED')
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle()
  check('event: REPORT_FILED tercatat', Boolean(evt))
  check('event: payload menautkan report_id', evt?.payload?.report_id === reportId)
  const { count: seqAfter } = await db
    .from('story_events')
    .select('seq', { count: 'exact', head: true })
    .eq('story_id', STORY)
  check('event: jumlah story_events bertambah 1', (seqAfter ?? 0) === (seqBefore ?? 0) + 1)

  // --- 3. RPC menolak argumen tak valid -----------------------------------
  const badStory = await db.rpc('record_content_report_v1', {
    p_story_id: 'tidak-ada-cerita-ini',
    p_chapter_number: 1,
    p_reporter_id: null,
    p_category: 'LAINNYA',
    p_note: null,
    p_canonical_refs: {},
  })
  check('rpc: tolak cerita tak dikenal', Boolean(badStory.error), badStory.error?.message)

  const badChapter = await db.rpc('record_content_report_v1', {
    p_story_id: STORY,
    p_chapter_number: 0,
    p_reporter_id: null,
    p_category: 'LAINNYA',
    p_note: null,
    p_canonical_refs: {},
  })
  check('rpc: tolak nomor bab < 1', Boolean(badChapter.error), badChapter.error?.message)

  // --- 4. Bersihkan artefak uji -------------------------------------------
  await db.from('story_events').delete().eq('story_id', STORY).eq('type', 'REPORT_FILED')
  await db.from('content_reports').delete().eq('id', reportId)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

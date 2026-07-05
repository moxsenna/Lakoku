/**
 * Harness invariant runtime (M2/T2.1–T2.2).
 *
 * Menguji end-to-end terhadap Supabase nyata (service role):
 *  1. Idempotensi: generate bab yang sama 2x tidak menduplikasi (chapter/outcomes/event).
 *  2. Atomicity: publish menulis chapter + outcomes + event bersamaan (konsisten).
 *  3. Lease: hanya satu lease ACTIVE per story pada satu waktu.
 *  4. No double-advance: retry publish tidak menambah event/bab kedua.
 *
 * Memakai story uji terisolasi ('rt-selftest') yang dibuat & dihapus sendiri.
 */
import { createClient } from '@supabase/supabase-js'
import { generateNextChapter, generationKey } from '@lakoku/runtime'

const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const STORY = 'rt-selftest'
let failures = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  PASS  ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : '')
  }
}

async function cleanup() {
  // Hapus jejak uji (urutan menghormati FK).
  await db.from('story_events').delete().eq('story_id', STORY)
  await db.from('generation_leases').delete().eq('story_id', STORY)
  await db.from('idempotency_keys').delete().eq('story_id', STORY)
  await db.from('choice_outcomes').delete().eq('story_id', STORY)
  await db.from('chapters').delete().eq('story_id', STORY)
  await db.from('stories').delete().eq('id', STORY)
}

async function main() {
  await cleanup()
  await db.from('stories').insert({
    id: STORY,
    title: 'Runtime Self-Test',
    total_chapters: 50,
  })

  // 1) Generate bab 1.
  const r1 = await generateNextChapter(STORY, 1)
  check('generate bab 1 sukses', r1.ok === true, r1)

  // 2) Idempotensi: generate bab 1 LAGI (retry). Tidak boleh double-publish.
  const r2 = await generateNextChapter(STORY, 1)
  // Idempotency key sama → RPC mengembalikan hasil pertama (ok:true, seq sama).
  check('retry bab 1 idempoten (ok true, seq sama)', r2.ok === true && r1.ok === true && r2.seq === r1.seq, { r1, r2 })

  // 3) Hanya ada SATU baris chapter untuk bab 1.
  const { count: chCount } = await db
    .from('chapters')
    .select('*', { count: 'exact', head: true })
    .eq('story_id', STORY)
    .eq('number', 1)
  check('tepat 1 baris chapter untuk bab 1', chCount === 1, { chCount })

  // 4) Outcomes bab 1 ada (atomicity: ditulis bersama chapter).
  const { count: ocCount } = await db
    .from('choice_outcomes')
    .select('*', { count: 'exact', head: true })
    .eq('story_id', STORY)
    .eq('chapter_number', 1)
  check('outcomes bab 1 tertulis (>=2)', (ocCount ?? 0) >= 2, { ocCount })

  // 5) Tepat SATU event CHAPTER_PUBLISHED untuk bab 1 (no double-advance).
  const { data: events } = await db
    .from('story_events')
    .select('seq, type, payload')
    .eq('story_id', STORY)
    .order('seq', { ascending: true })
  const publishEvents = (events ?? []).filter(
    (e) => e.type === 'CHAPTER_PUBLISHED' && (e.payload as { chapter_number?: number }).chapter_number === 1,
  )
  check('tepat 1 event CHAPTER_PUBLISHED bab 1', publishEvents.length === 1, { events })

  // 6) Lease bab 1 sudah RELEASED (bukan menggantung ACTIVE).
  const { data: leases } = await db
    .from('generation_leases')
    .select('status, chapter_number')
    .eq('story_id', STORY)
  const active = (leases ?? []).filter((l) => l.status === 'ACTIVE')
  check('tak ada lease ACTIVE menggantung', active.length === 0, { leases })

  // 7) Generate bab 2 → sequence event bertambah monotonic.
  const r3 = await generateNextChapter(STORY, 2)
  check('generate bab 2 sukses', r3.ok === true, r3)
  const { data: events2 } = await db
    .from('story_events')
    .select('seq')
    .eq('story_id', STORY)
    .order('seq', { ascending: true })
  const seqs = (events2 ?? []).map((e) => e.seq)
  const monotonic = seqs.every((s, i) => i === 0 || s > seqs[i - 1])
  check('sequence event monotonic naik', monotonic, { seqs })

  // 8) Idempotency key stabil (bentuk terdokumentasi).
  check(
    'idempotency key stabil & deterministik',
    generationKey(STORY, 1, 'publish') === `gen:publish:${STORY}:1`,
  )

  await cleanup()

  console.log('')
  if (failures === 0) {
    console.log('SEMUA INVARIANT LULUS')
    process.exit(0)
  } else {
    console.log(`${failures} INVARIANT GAGAL`)
    process.exit(1)
  }
}

main().catch(async (err) => {
  console.error('HARNESS ERROR:', err)
  await cleanup().catch(() => {})
  process.exit(1)
})

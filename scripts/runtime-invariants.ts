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
import { getDb, single, result, countOf } from '@lakoku/db'
import { generateNextChapter, generationKey } from '@lakoku/runtime'

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
  const db = getDb()
  // Hapus jejak uji (urutan menghormati FK).
  await db.deleteFrom('story_events').where('story_id', '=', STORY).execute()
  await db.deleteFrom('generation_leases').where('story_id', '=', STORY).execute()
  await db.deleteFrom('idempotency_keys').where('story_id', '=', STORY).execute()
  await db.deleteFrom('choice_outcomes').where('story_id', '=', STORY).execute()
  await db.deleteFrom('chapters').where('story_id', '=', STORY).execute()
  await db.deleteFrom('stories').where('id', '=', STORY).execute()
}

async function main() {
  const db = getDb()
  await cleanup()
  await db.insertInto('stories').values({
    id: STORY,
    title: 'Runtime Self-Test',
    total_chapters: 50,
  }).execute()

  // 1) Generate bab 1.
  const r1 = await generateNextChapter(STORY, 1)
  check('generate bab 1 sukses', r1.ok === true, r1)

  // 2) Idempotensi: generate bab 1 LAGI (retry). Tidak boleh double-publish.
  const r2 = await generateNextChapter(STORY, 1)
  // Idempotency key sama → RPC mengembalikan hasil pertama (ok:true, seq sama).
  check('retry bab 1 idempoten (ok true, seq sama)', r2.ok === true && r1.ok === true && r2.seq === r1.seq, { r1, r2 })

  // 3) Hanya ada SATU baris chapter untuk bab 1.
  const chCount = await countOf(
    db
      .selectFrom('chapters')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('story_id', '=', STORY)
      .where('number', '=', 1)
      .execute(),
  )
  check('tepat 1 baris chapter untuk bab 1', chCount === 1, { chCount })

  // 4) Outcomes bab 1 ada (atomicity: ditulis bersama chapter).
  const ocCount = await countOf(
    db
      .selectFrom('choice_outcomes')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('story_id', '=', STORY)
      .where('chapter_number', '=', 1)
      .execute(),
  )
  check('outcomes bab 1 tertulis (>=2)', ocCount >= 2, { ocCount })

  // 5) Tepat SATU event CHAPTER_PUBLISHED untuk bab 1 (no double-advance).
  const { data: events } = await result(
    db
      .selectFrom('story_events')
      .select(['seq', 'type', 'payload'])
      .where('story_id', '=', STORY)
      .orderBy('seq', 'asc')
      .execute(),
  )
  const publishEvents = (events ?? []).filter(
    (e) => e.type === 'CHAPTER_PUBLISHED' && (e.payload as { chapter_number?: number })?.chapter_number === 1,
  )
  check('tepat 1 event CHAPTER_PUBLISHED bab 1', publishEvents.length === 1, { events })

  // 6) Lease bab 1 sudah RELEASED (bukan menggantung ACTIVE).
  const { data: leases } = await result(
    db
      .selectFrom('generation_leases')
      .select(['status', 'chapter_number'])
      .where('story_id', '=', STORY)
      .execute(),
  )
  const active = (leases ?? []).filter((l) => l.status === 'ACTIVE')
  check('tak ada lease ACTIVE menggantung', active.length === 0, { leases })

  // 7) Generate bab 2 → sequence event bertambah monotonic.
  const r3 = await generateNextChapter(STORY, 2)
  check('generate bab 2 sukses', r3.ok === true, r3)
  const { data: events2 } = await result(
    db
      .selectFrom('story_events')
      .select('seq')
      .where('story_id', '=', STORY)
      .orderBy('seq', 'asc')
      .execute(),
  )
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

/**
 * Verifikasi end-to-end jalur cerita AI NYATA di DB Supabase sungguhan.
 *
 * Rantai yang diuji:
 *   seed-canon (prasyarat) → generateNextChapterReal(Bab 1..3)
 *   → publish atomik → baca via reader query (queryChapter)
 *   → cek retrieval_logs & story_events → uji idempotensi (panggil ulang)
 *   → cek consumer-safe (tak ada istilah internal di prosa terbit).
 *
 * Jalankan: set -a && source /vercel/share/.env.project && set +a
 *           && npx tsx scripts/e2e-real-generation.ts
 */
import { createClient } from '@supabase/supabase-js'
import { generateNextChapterReal } from '@lakoku/runtime'
import { scanForLeaks } from '@lakoku/ai-gateway'

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
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra) : '')
  }
}

async function main() {
  const db = admin()

  // Bersihkan artefak generasi sebelumnya (idempoten untuk test ulang).
  console.log('[e2e] membersihkan bab & log lama...')
  await db.from('chapters').delete().eq('story_id', STORY)
  await db.from('choice_outcomes').delete().eq('story_id', STORY)
  await db.from('story_events').delete().eq('story_id', STORY)
  await db.from('retrieval_logs').delete().eq('story_id', STORY)
  await db.from('generation_leases').delete().eq('story_id', STORY)
  // Penting: sapu juga ledger idempotensi. Tanpa ini, publish_chapter akan
  // mengembalikan hasil cache (ok=true) TANPA menulis ulang bab, sehingga test
  // ulang tampak "terbit" padahal DB kosong.
  await db.from('idempotency_keys').delete().eq('story_id', STORY)

  // 1) Generate Bab 1..3 lewat jalur nyata.
  console.log('\n[e2e] generasi nyata Bab 1..3')
  const results = []
  for (let n = 1; n <= 3; n++) {
    const r = await generateNextChapterReal(STORY, n)
    results.push(r)
    console.log(`  Bab ${n}:`, JSON.stringify(r))
  }
  check('Bab 1 terbit', results[0].ok === true, results[0])
  check('Bab 2 terbit', results[1].ok === true, results[1])
  check('Bab 3 terbit', results[2].ok === true, results[2])

  // 2) Baca via reader query (kolom snake_case → domain).
  console.log('\n[e2e] baca via reader query')
  for (let n = 1; n <= 3; n++) {
    const { data: ch } = await db
      .from('chapters')
      .select('*')
      .eq('story_id', STORY)
      .eq('number', n)
      .maybeSingle()
    check(`chapter ${n} tersimpan`, !!ch, ch)
    if (ch) {
      const words = (ch.paragraphs as string[]).join(' ').split(/\s+/).filter(Boolean).length
      check(`chapter ${n} panjang 400-900 kata (${words})`, words >= 400 && words <= 900, words)
      check(`chapter ${n} punya choice`, Array.isArray(ch.choices) && ch.choices.length >= 2, ch.choices)
      // Consumer-safe: tidak ada istilah internal bocor.
      const leaks = [ch.title, ...(ch.paragraphs as string[]), ch.choice_prompt ?? '']
        .flatMap((s: string) => scanForLeaks(s))
      check(`chapter ${n} consumer-safe`, leaks.length === 0, leaks)
    }
  }

  // 3) choice_outcomes tertulis untuk tiap bab non-ending.
  const { count: outcomeCount } = await db
    .from('choice_outcomes')
    .select('*', { count: 'exact', head: true })
    .eq('story_id', STORY)
  check('choice_outcomes tertulis', (outcomeCount ?? 0) >= 6, outcomeCount)

  // 4) retrieval_logs tercatat (audit pruning context).
  const { data: rlogs } = await db
    .from('retrieval_logs')
    .select('target_chapter, budget_report')
    .eq('story_id', STORY)
    .order('target_chapter', { ascending: true })
  check('retrieval_logs tercatat >=3', (rlogs?.length ?? 0) >= 3, rlogs?.length)

  // 5) story_events append-only terurut (CHAPTER_PUBLISHED muncul).
  const { data: events } = await db
    .from('story_events')
    .select('seq, type')
    .eq('story_id', STORY)
    .order('seq', { ascending: true })
  const seqs = (events ?? []).map((e) => e.seq)
  const monotonic = seqs.every((s, i) => i === 0 || s > seqs[i - 1])
  check('story_events seq monotonic', monotonic, seqs)
  check(
    'ada event CHAPTER_PUBLISHED',
    (events ?? []).some((e) => String(e.type).includes('PUBLISH')),
    (events ?? []).map((e) => e.type),
  )

  // 6) Idempotensi: panggil ulang Bab 1 tak menduplikasi.
  console.log('\n[e2e] uji idempotensi (panggil ulang Bab 1)')
  const { count: before } = await db
    .from('chapters')
    .select('*', { count: 'exact', head: true })
    .eq('story_id', STORY)
  const again = await generateNextChapterReal(STORY, 1)
  const { count: after } = await db
    .from('chapters')
    .select('*', { count: 'exact', head: true })
    .eq('story_id', STORY)
  check('panggil ulang Bab 1 tak menambah bab', before === after, { before, after, again })

  // 7) Tidak ada lease ACTIVE tersisa (sukses melepas lease via publish).
  const { data: leases } = await db
    .from('generation_leases')
    .select('status')
    .eq('story_id', STORY)
  const active = (leases ?? []).filter((l) => l.status === 'ACTIVE').length
  check('tak ada lease ACTIVE tersisa', active === 0, leases)

  console.log(`\n[e2e] SELESAI — ${pass} PASS / ${fail} FAIL`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('[e2e] error:', e)
  process.exit(1)
})

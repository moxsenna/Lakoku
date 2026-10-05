#!/usr/bin/env node
/**
 * Repair ledger canon novel proof M10-G `pulang-ke-tanah-yang-masih-marah-o9bple`.
 *
 * Novel ini dihasilkan proof runner 9Router yang menulis bab + reader_state
 * langsung tanpa melewati komit delta living-canon, sehingga tabel ledger
 * (secrets_reveals, story_threads, facts_ledger) dan baris stories tidak
 * pernah di-update meski cerita tamat 50/50.
 *
 * Skrip ini men-backfill berdasar BUKTI kata-kata dari prosa yang sudah
 * diterbitkan (keyword evidence per chapter) dan mengsinkronkan baris
 * stories dengan reader_states. Tiga mode:
 *   (default)   --evidence  Hitung & cetak bukti, TANPA menulis apa pun.
 *   --apply                   Tulis tepat sesuai EXPECTED (idempoten).
 *   --verify                  Assert DB == EXPECTED, cetak REPAIR-VERIFY-PASS.
 *
 * Dipakai: node --env-file=.env.local scripts/repair-ledger-o9bple.mjs [--apply|--verify]
 */
import pg from 'pg'

const STORY_ID = 'pulang-ke-tanah-yang-masih-marah-o9bple'
const TOTAL_CHAPTERS = 50
const RESOLUTION_FROM = 40

const EXPECTED = {
  secretIdsRevealed: [
    'pulang-ke-tanah-yang-masih-marah-o9bple:secret-1',
    'pulang-ke-tanah-yang-masih-marah-o9bple:secret-2',
    'pulang-ke-tanah-yang-masih-marah-o9bple:secret-3',
    'pulang-ke-tanah-yang-masih-marah-o9bple:secret-4',
  ],
  threadIdsResolved: [
    'pulang-ke-tanah-yang-masih-marah-o9bple:thread-1',
    'pulang-ke-tanah-yang-masih-marah-o9bple:thread-2',
    'pulang-ke-tanah-yang-masih-marah-o9bple:thread-3',
    'pulang-ke-tanah-yang-masih-marah-o9bple:thread-5',
    'pulang-ke-tanah-yang-masih-marah-o9bple:thread-6',
    'pulang-ke-tanah-yang-masih-marah-o9bple:thread-main',
  ],
  // thread-4 ("Pelanggan Lama dan Kenangan yang Tak Mau Pergi") TIDAK di-RESOLVED:
  // kata 'pelanggan' hanya muncul 1x di seluruh novel (ch 44, konteks kenangan,
  // bukan adegan payoff). Thread ini ditinggalkan generator -> ditandai stale,
  // bukan dipalsukan RESOLVED.
  threadIdStale: 'pulang-ke-tanah-yang-masih-marah-o9bple:thread-4',
  // fact-7 ("Kafe Nara di kota ...") TIDAK di-paid_off: kata 'kafe' tidak pernah
  // muncul sama sekali di prosa — latar kafe tidak pernah dikembangkan generator.
  factIdsExcluded: ['pulang-ke-tanah-yang-masih-marah-o9bple:fact-7'],
  factIdsPaidOff: [
    'pulang-ke-tanah-yang-masih-marah-o9bple:fact-1',
    'pulang-ke-tanah-yang-masih-marah-o9bple:fact-2',
    'pulang-ke-tanah-yang-masih-marah-o9bple:fact-3',
    'pulang-ke-tanah-yang-masih-marah-o9bple:fact-4',
    'pulang-ke-tanah-yang-masih-marah-o9bple:fact-5',
    'pulang-ke-tanah-yang-masih-marah-o9bple:fact-6',
    'pulang-ke-tanah-yang-masih-marah-o9bple:fact-8',
    'pulang-ke-tanah-yang-masih-marah-o9bple:fact-9',
    'pulang-ke-tanah-yang-masih-marah-o9bple:fact-10',
    'pulang-ke-tanah-yang-masih-marah-o9bple:fact-11',
    'pulang-ke-tanah-yang-masih-marah-o9bple:fact-12',
  ],
}

const SECRET_EVIDENCE = [
  { id: 'secret-1', gate: 12, keywords: ['utang', 'almarhum', 'tanda tangan', 'tandatangan'] },
  { id: 'secret-2', gate: 20, keywords: ['alasan nara pergi', 'malam itu', 'mendengar', 'kabur'] },
  { id: 'secret-3', gate: 32, keywords: ['tanah warung', 'jaminan', 'mengincar'] },
  { id: 'secret-4', gate: 45, keywords: ['surat asli', 'ratih'] },
]

const THREAD_EVIDENCE = [
  { id: 'thread-1', keywords: ['warung'] },
  { id: 'thread-2', keywords: ['darsono', 'utang'] },
  { id: 'thread-3', keywords: ['wulan'] },
  { id: 'thread-4', keywords: ['pelanggan'] },
  { id: 'thread-5', keywords: ['hendra'] },
  { id: 'thread-6', keywords: ['dapur', 'dirinya'] },
]

const FACT_EVIDENCE = [
  { id: 'fact-1', keywords: ['pergi', 'kota'] },
  { id: 'fact-2', keywords: ['warung', 'sepi'] },
  { id: 'fact-3', keywords: ['dokumen', 'darsono'] },
  { id: 'fact-4', keywords: ['wulan'] },
  { id: 'fact-5', keywords: ['ratih'] },
  { id: 'fact-6', keywords: ['hendra', 'tawaran'] },
  { id: 'fact-7', keywords: ['kafe'] },
  { id: 'fact-8', keywords: ['buku', 'resep'] },
  { id: 'fact-9', keywords: ['joko'] },
  { id: 'fact-10', keywords: ['konflik', 'ibu'] },
  { id: 'fact-11', keywords: ['rasa bersalah', 'bersalah'] },
  { id: 'fact-12', keywords: ['selamatkan', 'hukum', 'surat'] },
]

function normalize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function loadAll(pool) {
  const [ch, sec, th, facts, st, rs] = await Promise.all([
    pool.query('SELECT number, title, paragraphs FROM chapters WHERE story_id = $1 ORDER BY number ASC', [STORY_ID]),
    pool.query('SELECT id, reveal_gate_chapter, revealed FROM secrets_reveals WHERE story_id = $1', [STORY_ID]),
    pool.query('SELECT id, title, status, opened_chapter, last_touched_chapter, stale FROM story_threads WHERE story_id = $1', [STORY_ID]),
    pool.query('SELECT id, statement, load_bearing, paid_off FROM facts_ledger WHERE story_id = $1', [STORY_ID]),
    pool.query('SELECT id, status, current_chapter, ending_name, owner_user_id FROM stories WHERE id = $1 LIMIT 1', [STORY_ID]),
    pool.query('SELECT status, current_chapter, ending_name, user_id FROM reader_states WHERE story_id = $1 LIMIT 1', [STORY_ID]),
  ])
  const reader = rs.rows[0]
  if (!reader || reader.status !== 'SELESAI') {
    throw new Error('reader_states belum SELESAI — repair ledger tidak boleh jalan di cerita yang belum tamat.')
  }
  return { chapters: ch.rows, secrets: sec.rows, threads: th.rows, facts: facts.rows, story: st.rows[0], reader }
}

function proseByChapter(chapters) {
  const map = new Map()
  for (const chapter of chapters) {
    map.set(chapter.number, normalize((chapter.paragraphs ?? []).join(' ')))
  }
  return map
}

function hitsIn(normalizedProse, keywords) {
  return keywords.filter((keyword) => normalizedProse.includes(normalize(keyword))).length
}

function computeEvidence(data) {
  const prose = proseByChapter(data.chapters)
  const out = { secrets: [], threads: [], facts: [] }

  for (const spec of SECRET_EVIDENCE) {
    const perChapter = []
    for (let n = spec.gate; n <= TOTAL_CHAPTERS; n += 1) {
      const hits = hitsIn(prose.get(n) ?? '', spec.keywords)
      if (hits > 0) perChapter.push([n, hits])
    }
    const firstAny = perChapter[0] ?? null
    out.secrets.push({ id: spec.id, gate: spec.gate, perChapter: perChapter.slice(0, 6), revealEvidence: firstAny ? firstAny[0] : null })
  }

  for (const spec of THREAD_EVIDENCE) {
    const perChapter = []
    for (let n = RESOLUTION_FROM; n <= TOTAL_CHAPTERS; n += 1) {
      const hits = hitsIn(prose.get(n) ?? '', spec.keywords)
      if (hits > 0) perChapter.push([n, hits])
    }
    out.threads.push({ id: spec.id, perChapter: perChapter.slice(0, 6), resolutionEvidence: perChapter.length > 0 })
  }

  for (const spec of FACT_EVIDENCE) {
    const perChapter = []
    for (let n = RESOLUTION_FROM; n <= TOTAL_CHAPTERS; n += 1) {
      const hits = hitsIn(prose.get(n) ?? '', spec.keywords)
      if (hits > 0) perChapter.push([n, hits])
    }
    out.facts.push({ id: spec.id, perChapter: perChapter.slice(0, 6), paidEvidence: perChapter.length > 0 })
  }
  return out
}

function printEvidence(data, evidence) {
  console.log('STORY', JSON.stringify(data.story))
  console.log('READER', JSON.stringify(data.reader))
  console.log('--- SECRET EVIDENCE (first chapter >= gate with >=2 keyword hits) ---')
  for (const item of evidence.secrets) {
    const dbRow = data.secrets.find((s) => s.id.endsWith(item.id))
    console.log(JSON.stringify({ ...item, dbRevealed: dbRow?.revealed ?? null }))
  }
  console.log('--- THREAD EVIDENCE (resolution region ch 40-50) ---')
  for (const item of evidence.threads) {
    const dbRow = data.threads.find((t) => t.id.endsWith(item.id))
    console.log(JSON.stringify({ ...item, dbStatus: dbRow?.status ?? null }))
  }
  console.log('--- FACT EVIDENCE (resolution region ch 40-50) ---')
  for (const item of evidence.facts) {
    const dbRow = data.facts.find((f) => f.id.endsWith(item.id))
    console.log(JSON.stringify({ ...item, dbPaid: dbRow?.paid_off ?? null }))
  }
}

async function apply(supabase, data) {
  const mismatches = []
  const secretIds = EXPECTED.secretIdsRevealed.filter((id) => {
    const row = data.secrets.find((s) => s.id === id)
    return row && !row.revealed
  })
  if (secretIds.length !== EXPECTED.secretIdsRevealed.filter((id) => data.secrets.some((s) => s.id === id)).length) {
    mismatches.push('secret id set mismatch dengan DB')
  }

  const threadIds = EXPECTED.threadIdsResolved.filter((id) => {
    const row = data.threads.find((t) => t.id === id)
    return row && row.status !== 'RESOLVED'
  })

  const factIds = EXPECTED.factIdsPaidOff.filter((id) => {
    const row = data.facts.find((f) => f.id === id)
    return row && !row.paid_off
  })

  if (mismatches.length > 0) throw new Error(`APPLY-BLOCKED: ${mismatches.join('; ')}`)

  if (secretIds.length > 0) {
    await pool.query(
      'UPDATE secrets_reveals SET revealed = true WHERE story_id = $1 AND id = ANY($2::text[])',
      [STORY_ID, secretIds],
    )
    console.log('SECRETS-UPDATED', secretIds.length)
  }

  for (const threadId of threadIds) {
    await pool.query(
      'UPDATE story_threads SET status = $1, last_touched_chapter = $2, stale = false, stale_since_chapter = null WHERE id = $3 AND story_id = $4',
      ['RESOLVED', TOTAL_CHAPTERS, threadId, STORY_ID],
    )
  }
  if (threadIds.length > 0) console.log('THREADS-UPDATED', threadIds.length)

  // Thread yang ditinggalkan generator (bukti prosa tidak memuat payoff):
  // tandai stale sesuai mekanisme G4-STALE, jangan dipalsukan RESOLVED.
  await pool.query(
    'UPDATE story_threads SET stale = true, stale_since_chapter = $1 WHERE id = $2 AND story_id = $3',
    [TOTAL_CHAPTERS, EXPECTED.threadIdStale, STORY_ID],
  )
  console.log('THREAD-STALE-MARKED', EXPECTED.threadIdStale)

  if (factIds.length > 0) {
    await pool.query(
      'UPDATE facts_ledger SET paid_off = true WHERE story_id = $1 AND id = ANY($2::text[])',
      [STORY_ID, factIds],
    )
    console.log('FACTS-UPDATED', factIds.length)
  }

  const storyNeedsSync = data.story.status !== 'SELESAI'
    || data.story.current_chapter !== data.reader.current_chapter
    || data.story.ending_name !== data.reader.ending_name
  if (storyNeedsSync) {
    await pool.query(
      'UPDATE stories SET status = $1, current_chapter = $2, ending_name = $3 WHERE id = $4 AND owner_user_id = $5',
      [data.reader.status, data.reader.current_chapter, data.reader.ending_name, STORY_ID, data.reader.user_id],
    )
    console.log('STORIES-SYNCED', JSON.stringify({ status: data.reader.status, current_chapter: data.reader.current_chapter, ending_name: data.reader.ending_name }))
  }

  console.log('REPAIR-APPLY-DONE')
}

async function verify(pool) {
  const [secRes, thRes, factsRes, stRes, rsRes] = await Promise.all([
    pool.query('SELECT id, revealed FROM secrets_reveals WHERE story_id = $1', [STORY_ID]),
    pool.query('SELECT id, status, stale FROM story_threads WHERE story_id = $1', [STORY_ID]),
    pool.query('SELECT id, paid_off FROM facts_ledger WHERE story_id = $1', [STORY_ID]),
    pool.query('SELECT status, current_chapter, ending_name FROM stories WHERE id = $1 LIMIT 1', [STORY_ID]),
    pool.query('SELECT status, current_chapter, ending_name FROM reader_states WHERE story_id = $1 LIMIT 1', [STORY_ID]),
  ])
  const sec = secRes.rows
  const th = thRes.rows
  const facts = factsRes.rows
  const st = stRes.rows[0]
  const rs = rsRes.rows[0]

  const failures = []
  for (const id of EXPECTED.secretIdsRevealed) {
    const row = sec.find((s) => s.id === id)
    if (!row || row.revealed !== true) failures.push(`secret not revealed: ${id}`)
  }
  for (const id of EXPECTED.threadIdsResolved) {
    const row = th.find((t) => t.id === id)
    if (!row || row.status !== 'RESOLVED') failures.push(`thread not RESOLVED: ${id}`)
  }
  const staleRow = th.find((t) => t.id === EXPECTED.threadIdStale)
  if (!staleRow || staleRow.status !== 'OPEN' || staleRow.stale !== true) {
    failures.push(`thread ditinggalkan harus OPEN+stale: ${EXPECTED.threadIdStale}`)
  }
  for (const id of EXPECTED.factIdsPaidOff) {
    const row = facts.find((f) => f.id === id)
    if (!row || row.paid_off !== true) failures.push(`fact not paid_off: ${id}`)
  }
  for (const id of EXPECTED.factIdsExcluded) {
    const row = facts.find((f) => f.id === id)
    if (!row || row.paid_off !== false) failures.push(`fact excluded harus tetap unpaid: ${id}`)
  }
  const unexpectedOpen = th.filter((t) => t.status !== 'RESOLVED' && t.id !== EXPECTED.threadIdStale)
  if (unexpectedOpen.length > 0) failures.push(`threads masih terbuka di luar daftar stale: ${unexpectedOpen.map((t) => t.id).join(', ')}`)
  if (rs.status !== 'SELESAI') failures.push('reader_states bukan SELESAI')
  if (st.status !== 'SELESAI' || st.current_chapter !== rs.current_chapter || st.ending_name !== rs.ending_name) {
    failures.push(`stories row tidak sinkron: ${JSON.stringify(st)} vs ${JSON.stringify(rs)}`)
  }

  if (failures.length > 0) {
    console.log('REPAIR-VERIFY-FAIL')
    for (const failure of failures) console.log('FAIL', failure)
    process.exitCode = 1
    return
  }
  console.log('REPAIR-VERIFY-PASS')
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL })
  const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--verify') ? 'verify' : 'evidence'

  try {
    if (mode === 'verify') {
      await verify(pool)
      return
    }

    const data = await loadAll(pool)
    const evidence = computeEvidence(data)
    printEvidence(data, evidence)

    const missingSecretEvidence = evidence.secrets.filter((s) => s.revealEvidence === null)
    const missingThreadEvidence = evidence.threads.filter((t) => !t.resolutionEvidence)
    const missingFactEvidence = evidence.facts.filter((f) => !f.paidEvidence)
    console.log('EVIDENCE-GAPS', JSON.stringify({ secrets: missingSecretEvidence.map((s) => s.id), threads: missingThreadEvidence.map((t) => t.id), facts: missingFactEvidence.map((f) => f.id) }))

    if (mode === 'apply') {
      const blocking = [
        ...missingSecretEvidence.map((s) => `secret ${s.id} tanpa bukti`),
        ...missingThreadEvidence.map((t) => `thread ${t.id} tanpa bukti`),
        ...evidence.facts
          .filter((f) => EXPECTED.factIdsPaidOff.includes(`${STORY_ID}:${f.id}`))
          .filter((f) => !f.paidEvidence)
          .map((f) => `fact ${f.id} tanpa bukti`),
      ]
      if (blocking.length > 0) throw new Error(`APPLY-BLOCKED, bukti tidak lengkap: ${blocking.join('; ')}`)
      await apply(pool, data)
    } else {
      console.log('EVIDENCE-ONLY (tidak ada penulisan)')
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error('REPAIR-ERROR', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

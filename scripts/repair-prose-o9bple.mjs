#!/usr/bin/env node
/**
 * Perbaikan prosa terbit novel proof M10-G `pulang-ke-tanah-yang-masih-marah-o9bple`
 * (T-NOVEL-QC1, item 3): data prosa final tidak tersentuh perbaikan pipeline,
 * jadi dibenahi langsung tanpa inferensi:
 *
 *   1. Judul duplikat lintas bab -> bab kemunculan PERTAMA dipertahankan,
 *      kemunculan berikutnya diganti judul baru yang dirancang dari isi bab
 *      (bukan hasil inferensi; ditinjau manusia, dicek keunikannya).
 *   2. Echo transition verbatim (paragraf pertama Bab N+1 identik dengan
 *      paragraf penutup Bab N) -> paragraf echo dihapus, HANYA bila jumlah
 *      kata bab tetap dalam kontrak 800–1000.
 *
 * Mode: (default) evidence | --apply | --verify (REPAIR-PROSE-VERIFY-PASS).
 * Dipakai: node --env-file=.env.local scripts/repair-prose-o9bple.mjs [--apply|--verify]
 */
import { createClient } from '@supabase/supabase-js'

const STORY_ID = 'pulang-ke-tanah-yang-masih-marah-o9bple'
const HARD_MIN_WORDS = 800
const HARD_MAX_WORDS = 1000

/** Judul pengganti hasil tinjauan manusia atas isi bab (blueprint + prosa). */
const TITLE_RENAMES = [
  { chapter: 14, from: 'Bayang-Bayang di Ujung Lorong', to: 'Debu Jalanan dan Nama yang Kucejar' },
  { chapter: 24, from: 'Jejak Hitam di Bawah Meja', to: 'Amplop Cokelat dari Joko' },
  { chapter: 35, from: 'Bayang-Bayang di Balik Daun Pintu', to: 'Aroma Karat di Dalam Gelap' },
  { chapter: 38, from: 'Bayang-Bayang di Balik Daun Pintu', to: 'Benteng Kecil di Teras' },
]

function normalize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function countWords(paragraphs) {
  return paragraphs.join(' ').split(/\s+/).filter(Boolean).length
}

async function loadAll(supabase) {
  const { data: chapters, error } = await supabase
    .from('chapters')
    .select('number, title, paragraphs')
    .eq('story_id', STORY_ID)
    .order('number')
  if (error) throw new Error(`load chapters: ${error.message}`)
  if (!chapters || chapters.length !== 50) throw new Error(`bab tidak lengkap: ${chapters?.length ?? 0}`)
  return chapters
}

function findEchoTransitions(chapters) {
  const echoes = []
  for (let i = 1; i < chapters.length; i += 1) {
    const previous = chapters[i - 1]
    const current = chapters[i]
    const previousEndings = previous.paragraphs.slice(-5).map(normalize).filter(Boolean)
    const first = normalize(current.paragraphs[0] ?? '')
    if (first && previousEndings.includes(first)) {
      const before = countWords(current.paragraphs)
      const after = countWords(current.paragraphs.slice(1))
      echoes.push({
        chapter: current.number,
        echoedFrom: previous.number,
        wordsBefore: before,
        wordsAfterRemoval: after,
        safeToRemove: after >= HARD_MIN_WORDS && after <= HARD_MAX_WORDS,
      })
    }
  }
  return echoes
}

function findDuplicateTitles(chapters) {
  const byTitle = new Map()
  for (const chapter of chapters) {
    const list = byTitle.get(chapter.title) ?? []
    list.push(chapter.number)
    byTitle.set(chapter.title, list)
  }
  return [...byTitle.entries()].filter(([, list]) => list.length > 1)
}

function printEvidence(chapters) {
  console.log('DUPLICATE-TITLES', JSON.stringify(findDuplicateTitles(chapters)))
  const echoes = findEchoTransitions(chapters)
  for (const echo of echoes) {
    console.log('ECHO', JSON.stringify(echo))
  }
  console.log('ECHO-TOTAL', echoes.length)
}

async function apply(supabase, chapters) {
  // 1) Judul: pastikan judul baru unik terhadap SEMUA judul lain.
  const allTitles = new Set(chapters.map((chapter) => chapter.title))
  for (const rename of TITLE_RENAMES) {
    if (allTitles.has(rename.to)) throw new Error(`judul baru sudah dipakai: ${rename.to}`)
  }
  for (const rename of TITLE_RENAMES) {
    const chapter = chapters.find((c) => c.number === rename.chapter)
    if (!chapter || chapter.title !== rename.from) {
      throw new Error(`bab ${rename.chapter} tidak cocok dengan judul harapan: ${chapter?.title}`)
    }
    const { error } = await supabase
      .from('chapters')
      .update({ title: rename.to })
      .eq('story_id', STORY_ID)
      .eq('number', rename.chapter)
    if (error) throw new Error(`rename bab ${rename.chapter}: ${error.message}`)
    allTitles.delete(rename.from)
    allTitles.add(rename.to)
  }
  console.log('TITLES-UPDATED', TITLE_RENAMES.length)

  // 2) Echo: hapus hanya yang aman terhadap kontrak panjang.
  const echoes = findEchoTransitions(chapters)
  let removed = 0
  for (const echo of echoes) {
    if (!echo.safeToRemove) {
      console.log('ECHO-SKIPPED-WORD-BUDGET', JSON.stringify(echo))
      continue
    }
    const current = chapters.find((c) => c.number === echo.chapter)
    const { error } = await supabase
      .from('chapters')
      .update({ paragraphs: current.paragraphs.slice(1) })
      .eq('story_id', STORY_ID)
      .eq('number', echo.chapter)
    if (error) throw new Error(`echo bab ${echo.chapter}: ${error.message}`)
    current.paragraphs = current.paragraphs.slice(1)
    removed += 1
  }
  console.log('ECHO-REMOVED', removed, 'OF', echoes.length)
  console.log('REPAIR-PROSE-APPLY-DONE')
}

async function verify(supabase) {
  const chapters = await loadAll(supabase)
  const failures = []

  const duplicates = findDuplicateTitles(chapters)
  if (duplicates.length > 0) failures.push(`judul masih duplikat: ${JSON.stringify(duplicates)}`)

  for (const rename of TITLE_RENAMES) {
    const chapter = chapters.find((c) => c.number === rename.chapter)
    if (!chapter || chapter.title !== rename.to) failures.push(`bab ${rename.chapter} judul tidak terupdate`)
  }

  const remainingEchoes = findEchoTransitions(chapters)
  const baselineEchoes = remainingEchoes.filter((echo) => !echo.safeToRemove)
  if (baselineEchoes.length > 0) {
    // Echo yang dibiarkan karena anggaran kata harus tetap terdokumentasi.
    console.log('ECHO-REMAINING-WORD-BUDGET', JSON.stringify(baselineEchoes))
  }
  const unsafeLeft = remainingEchoes.filter((echo) => echo.safeToRemove)
  if (unsafeLeft.length > 0) failures.push(`echo aman masih tersisa: ${JSON.stringify(unsafeLeft)}`)

  for (const chapter of chapters) {
    const words = countWords(chapter.paragraphs)
    if (words < HARD_MIN_WORDS || words > HARD_MAX_WORDS) {
      failures.push(`bab ${chapter.number} di luar kontrak panjang: ${words}`)
    }
  }

  if (failures.length > 0) {
    console.log('REPAIR-PROSE-VERIFY-FAIL')
    for (const failure of failures) console.log('FAIL', failure)
    process.exitCode = 1
    return
  }
  console.log('REPAIR-PROSE-VERIFY-PASS')
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('ENV missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  const supabase = createClient(url, key)
  const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--verify') ? 'verify' : 'evidence'

  if (mode === 'verify') {
    await verify(supabase)
    return
  }

  const chapters = await loadAll(supabase)
  printEvidence(chapters)
  if (mode === 'apply') {
    await apply(supabase, chapters)
  } else {
    console.log('EVIDENCE-ONLY (tidak ada penulisan)')
  }
}

main().catch((error) => {
  console.error('REPAIR-PROSE-ERROR', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

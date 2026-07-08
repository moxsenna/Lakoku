/**
 * Smoke aturan harga baca (kredit) — LOGIKA MURNI, tanpa I/O.
 * Memastikan gerbang gratis/berbayar & biaya per bab konsisten dengan kebijakan.
 */
import { isChapterFree, chapterCost, unlockRef, DEFAULT_READING_POLICY } from '@/lib/credits/policy'

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  PASS ', name) }
  else { fail++; console.error('  FAIL ', name) }
}

const P = { freeChapters: 3, creditsPerChapter: 5 }

// Default policy = 3 gratis, 5/bab.
check('default 3 gratis / 5 per bab', DEFAULT_READING_POLICY.freeChapters === 3 && DEFAULT_READING_POLICY.creditsPerChapter === 5)

// Bab 1..3 gratis, biaya 0.
for (const n of [1, 2, 3]) {
  check(`bab ${n} gratis`, isChapterFree(n, P) === true)
  check(`bab ${n} biaya 0`, chapterCost(n, P) === 0)
}
// Bab 4+ berbayar, biaya = creditsPerChapter.
for (const n of [4, 5, 50]) {
  check(`bab ${n} berbayar`, isChapterFree(n, P) === false)
  check(`bab ${n} biaya 5`, chapterCost(n, P) === 5)
}

// Kebijakan bisa diubah (mis. 1 gratis, 10/bab).
const P2 = { freeChapters: 1, creditsPerChapter: 10 }
check('policy custom: bab 2 berbayar', !isChapterFree(2, P2) && chapterCost(2, P2) === 10)
check('policy custom: bab 1 gratis', isChapterFree(1, P2) && chapterCost(1, P2) === 0)

// Ref ledger idempoten & stabil.
check('unlockRef stabil', unlockRef('kisah-a', 7) === 'unlock:kisah-a:7')

console.log(`\ncredits-policy-smoke: ${pass}/${pass + fail} PASS`)
if (fail > 0) process.exit(1)

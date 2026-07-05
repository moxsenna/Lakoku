/**
 * Harness M3 (Exit Criteria): simulasi deterministik ke Bab 50 (fixture)
 * harus lolos Layer A, plus uji negatif membuktikan tiap cek menyala.
 *
 * Jalankan:
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/narrative-layer-a.ts
 */

import {
  validateLayerA,
  compileContext,
  type ChapterDraft,
  type Finding,
} from '@lakoku/narrative-core'
import {
  buildFixtureSnapshot,
  buildValidDraft,
} from '@/fixtures/narrative/fixture-50'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, extra?: unknown) {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}`, extra ? JSON.stringify(extra) : '')
  }
}

function hasCode(findings: Finding[], code: string): boolean {
  return findings.some((f) => f.code === code)
}

const snapshot = buildFixtureSnapshot()

console.log('== POSITIF: simulasi 50 bab lolos Layer A ==')
let allClean = true
for (let n = 1; n <= 50; n++) {
  const draft = buildValidDraft(snapshot, n)
  const res = validateLayerA(snapshot, draft)
  // Compiler harus jalan tanpa error & mempertahankan load-bearing facts.
  const packet = compileContext(snapshot, n)
  const lbKept = packet.loadBearingFacts.every(
    (f) => !packet.excludedIds.includes(f.id),
  )
  if (!res.ok || !lbKept) {
    allClean = false
    console.log(`  Bab ${n} findings:`, JSON.stringify(res.findings))
  }
}
check('50 bab valid → 0 finding & load-bearing tak terpangkas', allClean)

console.log('\n== NEGATIF: tiap cek Layer A menyala ==')

// Cek 1: karakter mati beraksi.
{
  const s = buildFixtureSnapshot()
  s.characters.find((c) => c.id === 'char:dimas')!.status = 'DEAD'
  const d = buildValidDraft(s, 10)
  d.events.push({ characterMention: 'Dimas', description: 'Dimas bicara', ordinal: 5, occursAt: 999, isFlashback: false })
  const r = validateLayerA(s, d)
  check('Cek1 CHARACTER_DEAD_ACTING', hasCode(r.findings, 'CHARACTER_DEAD_ACTING'))
}

// Cek 2: reveal sebelum gate.
{
  const d = buildValidDraft(snapshot, 5)
  d.reveals.push({ secretId: 'secret:wasiat-palsu' }) // gate bab 12
  const r = validateLayerA(snapshot, d)
  check('Cek2 REVEAL_BEFORE_GATE', hasCode(r.findings, 'REVEAL_BEFORE_GATE'))
}

// Cek 3: knowledge di luar scope.
{
  const d = buildValidDraft(snapshot, 4)
  d.knowledgeAssertions.push({ characterMention: 'Rani', factId: 'fact:foto-lama' }) // Rani tak tahu foto-lama
  const r = validateLayerA(snapshot, d)
  check('Cek3 KNOWLEDGE_OUT_OF_SCOPE', hasCode(r.findings, 'KNOWLEDGE_OUT_OF_SCOPE'))
}

// Cek 4: state delta di luar allowed.
{
  const d = buildValidDraft(snapshot, 10)
  d.proposedStateDelta = { hal_yang_tak_diizinkan: true }
  const r = validateLayerA(snapshot, d)
  check('Cek4 STATE_DELTA_NOT_ALLOWED', hasCode(r.findings, 'STATE_DELTA_NOT_ALLOWED'))
}

// Cek 5: timeline mundur tanpa flashback.
{
  const d = buildValidDraft(snapshot, 10)
  d.events = [
    { characterMention: 'Rani', description: 'awal', ordinal: 0, occursAt: 100, isFlashback: false },
    { characterMention: 'Rani', description: 'mundur', ordinal: 1, occursAt: 50, isFlashback: false },
  ]
  const r = validateLayerA(snapshot, d)
  check('Cek5 TIMELINE_NON_MONOTONIC', hasCode(r.findings, 'TIMELINE_NON_MONOTONIC'))
}

// Cek 5b: mundur DENGAN flashback marker → tidak menyala.
{
  const d = buildValidDraft(snapshot, 10)
  d.events = [
    { characterMention: 'Rani', description: 'awal', ordinal: 0, occursAt: 100, isFlashback: false },
    { characterMention: 'Rani', description: 'kenangan', ordinal: 1, occursAt: 50, isFlashback: true },
  ]
  const r = validateLayerA(snapshot, d)
  check('Cek5b flashback tidak memicu timeline finding', !hasCode(r.findings, 'TIMELINE_NON_MONOTONIC'))
}

// Cek 6: struktur bab (panjang & scene & choice).
{
  const d: ChapterDraft = { ...buildValidDraft(snapshot, 10), wordCount: 120, sceneCount: 1, hasChoiceOrGate: false }
  const r = validateLayerA(snapshot, d)
  check(
    'Cek6 struktur (length+scene+choice)',
    hasCode(r.findings, 'CHAPTER_LENGTH_OUT_OF_RANGE') &&
      hasCode(r.findings, 'SCENE_COUNT_OUT_OF_RANGE') &&
      hasCode(r.findings, 'MISSING_CHOICE_OR_GATE'),
  )
}

// Cek 7: alias tak ter-resolve.
{
  const d = buildValidDraft(snapshot, 10)
  d.events.push({ characterMention: 'Orang Asing', description: 'muncul', ordinal: 9, occursAt: 500, isFlashback: false })
  const r = validateLayerA(snapshot, d)
  check('Cek7 ALIAS_UNRESOLVED', hasCode(r.findings, 'ALIAS_UNRESOLVED'))
}

// Cek 7b: alias relasi ("ibu mertua") ter-resolve ke Ratna.
{
  const d = buildValidDraft(snapshot, 10)
  d.events = [{ characterMention: 'ibu mertua', description: 'Ratna hadir', ordinal: 0, occursAt: 100, isFlashback: false }]
  const r = validateLayerA(snapshot, d)
  check('Cek7b alias relasi ter-resolve (tanpa ALIAS_UNRESOLVED)', !hasCode(r.findings, 'ALIAS_UNRESOLVED'))
}

// Cek 8: karakter baru bernama pasca Bab 30 tanpa blueprint.
{
  const d = buildValidDraft(snapshot, 35)
  d.newNamedCharacters = ['Tokoh Kejutan']
  const r = validateLayerA(snapshot, d)
  check('Cek8 UNPLANNED_NEW_CHARACTER', hasCode(r.findings, 'UNPLANNED_NEW_CHARACTER'))
}

// Cek 8b: karakter baru terencana (Sari, Bab 33) → tidak menyala.
{
  const d = buildValidDraft(snapshot, 33)
  const r = validateLayerA(snapshot, d)
  check('Cek8b karakter terencana (Sari) tidak memicu finding', !hasCode(r.findings, 'UNPLANNED_NEW_CHARACTER'))
}

// Budget: load-bearing tak pernah dipangkas walau budget kecil.
{
  const packet = compileContext(snapshot, 45, { totalBudget: 40 })
  const lbKept = packet.loadBearingFacts.length > 0 &&
    packet.loadBearingFacts.every((f) => !packet.excludedIds.includes(f.id))
  check('Budget ketat: load-bearing tetap dipertahankan', lbKept, { excluded: packet.excludedIds })
}

console.log(`\n== HASIL: ${pass} PASS, ${fail} FAIL ==`)
process.exit(fail === 0 ? 0 : 1)

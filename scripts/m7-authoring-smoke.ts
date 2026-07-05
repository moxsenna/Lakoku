/**
 * Harness M7 — authoring story bible (T7.4).
 *
 * Menguji jalur "Fixed Spine + Adaptive Trajectory" secara MURNI-LOGIKA
 * (tanpa jaringan): validate → compile → tangga kegagalan (repair/transform).
 * Tambahan opsional (butuh env):
 *   - AUTHORING live check: proposePremises 1x bila ada OPENROUTER/GATEWAY key.
 *   - Roundtrip persist/load bila AUTHORING_SMOKE_PERSIST=1 (butuh Supabase).
 *
 * Jalankan:
 *   npx tsx scripts/m7-authoring-smoke.ts
 *   AUTHORING_SMOKE_PERSIST=1 npx tsx scripts/m7-authoring-smoke.ts
 */
import {
  validateStoryBible,
  hasCritical,
  compileStoryBible,
  runLockLadder,
  deterministicTransform,
  type StoryBibleDraft,
} from '../lib/authoring'
import { REVEAL_GATE_CHAPTERS, TOTAL_CHAPTERS } from '@lakoku/narrative-core'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra) : '') }
}

/** Draft valid (protagonis bab 1, gate legal, subjek fakta dikenal). */
function validDraft(): StoryBibleDraft {
  return {
    premise: {
      title: 'Warisan yang Terkubur',
      tagline: 'Sebuah surat wasiat membuka luka yang dikira sudah sembuh.',
      role: 'Rani, sang pewaris yang tak pernah diberi tahu',
      synopsis: 'Rani kembali ke rumah keluarga setelah kematian ayahnya, menemukan warisan tersembunyi dan janji yang mengubah nasib banyak orang. Ia harus memilih antara kebenaran dan kedamaian.',
      tropes: ['Rahasia Keluarga', 'Kebangkitan Diri'],
    },
    cast: {
      characters: [
        { canonicalName: 'Rani', role: 'protagonis', motivation: 'Membongkar kebenaran di balik warisan ayahnya.', introducedChapter: 1, aliases: [{ alias: 'Bu Rani', aliasType: 'TITLE' }], voice: { register: 'tenang namun tajam', speechHabits: ['bicara terukur'], forbiddenWords: ['sumpah'], sampleLines: ['Aku tidak akan diam kali ini.'] } },
        { canonicalName: 'Damar', role: 'antagonis', motivation: 'Menyembunyikan isi wasiat demi kuasa.', introducedChapter: 3, aliases: [], voice: { register: 'licin dan berwibawa', speechHabits: ['banyak berdalih'], forbiddenWords: [], sampleLines: ['Semua ini demi keluarga.'] } },
        { canonicalName: 'Sena', role: 'sekutu', motivation: 'Melindungi Rani dari masa lalunya sendiri.', introducedChapter: 2, aliases: [], voice: { register: 'hangat dan setia', speechHabits: ['sering menenangkan'], forbiddenWords: [], sampleLines: ['Aku di sini, apa pun yang terjadi.'] } },
      ],
    },
    mystery: {
      mainMystery: { title: 'Siapa yang memalsukan wasiat itu?', payoffWindow: 45 },
      secrets: [
        { description: 'Wasiat asli menyebut Rani sebagai pewaris tunggal.', revealGateChapter: 12 },
        { description: 'Damar terlibat pemalsuan dokumen.', revealGateChapter: 32 },
      ],
    },
    world: {
      threads: [{ title: 'Perseteruan warisan keluarga', openedChapter: 1, payoffWindow: 45 }],
      facts: [
        { statement: 'Ayah Rani menyimpan wasiat kedua secara diam-diam.', subjectName: 'Rani', establishedChapter: 1, salience: 0.9, loadBearing: true },
        { statement: 'Damar mengelola aset keluarga sejak lama.', subjectName: 'Damar', establishedChapter: 3, salience: 0.6, loadBearing: false },
        { statement: 'Rumah keluarga terletak di kota kecil dekat pesisir.', subjectName: null, establishedChapter: 1, salience: 0.3, loadBearing: false },
      ],
    },
  }
}

async function main() {
  // ---- 1) Validate + compile draft valid ----
  console.log('== Draft valid: validate + compile ==')
  const good = validDraft()
  const gf = validateStoryBible(good)
  check('0 temuan CRITICAL', !hasCritical(gf), gf)

  const compiled = compileStoryBible(good, 'm7-smoke-valid')
  check('50 blueprint', compiled.snapshot.blueprints.length === TOTAL_CHAPTERS, compiled.snapshot.blueprints.length)

  // forbidden_reveals: bab 1 harus melarang semua secret (gate 12 & 32 > 1).
  const bp1 = compiled.snapshot.blueprints.find((b) => b.chapterNumber === 1)!
  check('forbidden_reveals bab 1 = semua secret', bp1.forbiddenReveals.length === good.mystery.secrets.length, bp1.forbiddenReveals)
  // bab 40 hanya melarang secret gate > 40 (yakni tak ada, karena 12 & 32 ≤ 40).
  const bp40 = compiled.snapshot.blueprints.find((b) => b.chapterNumber === 40)!
  check('forbidden_reveals bab 40 kosong', bp40.forbiddenReveals.length === 0, bp40.forbiddenReveals)
  // Mandatory reveal muncul di bab gate 12.
  const bp12 = compiled.snapshot.blueprints.find((b) => b.chapterNumber === 12)!
  check('bab 12 punya mandatory reveal', bp12.mandatoryBeats.some((b) => b.toLowerCase().includes('rahasia')), bp12.mandatoryBeats)

  // ---- 2) Tangga: transform deterministik memperbaiki gate ilegal ----
  console.log('\n== Tangga kegagalan: transform deterministik ==')
  const bad = validDraft()
  bad.mystery.secrets[0].revealGateChapter = 13 // ilegal → harus snap ke 12
  bad.world.facts[1].subjectName = 'HantuTakDikenal' // subjek tak dikenal → null
  bad.cast.characters[0].introducedChapter = 4 // protagonis → harus 1
  const bf = validateStoryBible(bad)
  check('draft rusak terdeteksi CRITICAL', hasCritical(bf), bf.map((f) => f.code))

  const t = deterministicTransform(bad)
  check('transform menerapkan ≥1 perbaikan', t.applied.length >= 1, t.applied)
  check('gate 13 → gate legal', REVEAL_GATE_CHAPTERS.includes(t.draft.mystery.secrets[0].revealGateChapter), t.draft.mystery.secrets[0].revealGateChapter)

  const ladder = await runLockLadder(bad) // tanpa aiRepair → langsung transform
  check('ladder → LOCKED via transform', ladder.status === 'LOCKED' && ladder.resolvedBy === 'DETERMINISTIC_TRANSFORM', { status: ladder.status, by: ladder.status === 'LOCKED' ? ladder.resolvedBy : undefined })

  // ---- 3) Tangga: kebocoran istilah tak bisa auto-fix → NEEDS_AUTHOR ----
  console.log('\n== Tangga kegagalan: escalate NEEDS_AUTHOR ==')
  const leaky = validDraft()
  leaky.premise.synopsis = 'Rani meminta AI membuat prompt token untuk membongkar model sistem ini.'
  const ladder2 = await runLockLadder(leaky)
  check('ladder → NEEDS_AUTHOR (kebocoran)', ladder2.status === 'NEEDS_AUTHOR', ladder2.status)

  // ---- 4) Live LLM check (opsional) ----
  if (process.env.OPENROUTER_API_KEY || process.env.AI_GATEWAY_API_KEY) {
    console.log('\n== Live: proposePremises (opsional) ==')
    try {
      const { proposePremises } = await import('../lib/authoring/server')
      const { proposals, usedModel } = await proposePremises('seorang guru desa yang mewarisi rahasia')
      check('AI mengembalikan 3 premis', proposals.length === 3, { usedModel, n: proposals.length })
      const live = validateStoryBible({ ...validDraft(), premise: proposals[0] })
      check('premis AI lolos leak-scan', !live.some((f) => f.code === 'AUTH_LEAK'))
    } catch (e) {
      console.log('  SKIP  live check gagal:', (e as Error).message)
    }
  } else {
    console.log('\n  (lewati live LLM check — tak ada OPENROUTER/GATEWAY key)')
  }

  // ---- 5) Roundtrip persist/load (opsional, butuh Supabase) ----
  if (process.env.AUTHORING_SMOKE_PERSIST === '1') {
    console.log('\n== Roundtrip persist → load ==')
    try {
      const { persistStoryBible } = await import('../lib/authoring/server')
      const { loadCanonSnapshot } = await import('@lakoku/narrative-core/server')
      const c = compileStoryBible(validDraft(), `m7-smoke-${Date.now()}`)
      const { storyId } = await persistStoryBible(c)
      const back = await loadCanonSnapshot(storyId)
      check('roundtrip: 50 blueprint', back.blueprints.length === TOTAL_CHAPTERS, back.blueprints.length)
      check('roundtrip: jumlah karakter sama', back.characters.length === c.snapshot.characters.length)
      check('roundtrip: jumlah secret sama', back.secrets.length === c.snapshot.secrets.length)
      console.log(`  (story uji "${storyId}" tertinggal di DB — hapus manual bila perlu)`) 
    } catch (e) {
      console.log('  SKIP  roundtrip gagal:', (e as Error).message)
    }
  } else {
    console.log('\n  (lewati roundtrip — set AUTHORING_SMOKE_PERSIST=1 untuk uji DB)')
  }

  console.log(`\nHASIL M7: ${pass} PASS / ${fail} FAIL`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })

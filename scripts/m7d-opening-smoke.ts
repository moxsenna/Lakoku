/**
 * Harness M7 (T7.2) — Opening Package + Voice Sheets (NTM G5-VOICE).
 *
 * Menguji jalur MURNI-LOGIKA (tanpa jaringan) paket pembuka:
 *   - selectOpeningCharacters memilih tokoh introducedChapter ≤ 1;
 *   - enrichOpeningVoiceSheets memperkaya voice via author (di-mock DI);
 *   - validateAuthoredVoice menolak voice bocor/kurang substansi (→ fallback);
 *   - voice tokoh non-pembuka tak disentuh; snapshot lain utuh (immutable);
 *   - author gagal/null → semua tokoh pembuka fallback ke voice dasar.
 *
 * Tambahan opsional (butuh env): live voice authoring bila ada OPENROUTER/GATEWAY key.
 *
 * Jalankan:
 *   npx tsx scripts/m7d-opening-smoke.ts
 */
import {
  compileStoryBible,
  selectOpeningCharacters,
  validateAuthoredVoice,
  enrichOpeningVoiceSheets,
  type StoryBibleDraft,
  type VoiceSheetAuthorFn,
  type AuthoredVoice,
} from '../lib/authoring'
import type { VoiceSheet } from '@lakoku/narrative-core'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra) : '') }
}

/** Draft valid: protagonis bab 1, sekutu bab 2, antagonis bab 3. */
function validDraft(): StoryBibleDraft {
  return {
    premise: {
      title: 'Warisan yang Terkubur',
      tagline: 'Sebuah surat wasiat membuka luka yang dikira sudah sembuh.',
      role: 'Rani, sang pewaris yang tak pernah diberi tahu',
      synopsis: 'Rani kembali ke rumah keluarga setelah kematian ayahnya. Ia menemukan warisan tersembunyi. Janji lama mengubah nasib banyak orang. Ia harus memilih antara kebenaran dan kedamaian.',
      tropes: ['Rahasia Keluarga', 'Kebangkitan Diri'],
    },
    cast: {
      characters: [
        { canonicalName: 'Rani', role: 'protagonis', motivation: 'Membongkar kebenaran di balik warisan ayahnya.', introducedChapter: 1, aliases: [{ alias: 'Bu Rani', aliasType: 'TITLE' }], voice: { register: 'tenang namun tajam', speechHabits: ['bicara terukur'], forbiddenWords: ['sumpah'], sampleLines: ['Aku tidak akan diam kali ini.'] } },
        { canonicalName: 'Sena', role: 'sekutu', motivation: 'Melindungi Rani dari masa lalunya sendiri.', introducedChapter: 2, aliases: [], voice: { register: 'hangat dan setia', speechHabits: ['sering menenangkan'], forbiddenWords: [], sampleLines: ['Aku di sini, apa pun yang terjadi.'] } },
        { canonicalName: 'Damar', role: 'antagonis', motivation: 'Menyembunyikan isi wasiat demi kuasa.', introducedChapter: 3, aliases: [], voice: { register: 'licin dan berwibawa', speechHabits: ['banyak berdalih'], forbiddenWords: [], sampleLines: ['Semua ini demi keluarga.'] } },
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
  const compiled = compileStoryBible(validDraft(), 'm7d-opening')
  const idRani = compiled.snapshot.characters.find((c) => c.canonicalName === 'Rani')!.id
  const idSena = compiled.snapshot.characters.find((c) => c.canonicalName === 'Sena')!.id
  const idDamar = compiled.snapshot.characters.find((c) => c.canonicalName === 'Damar')!.id

  // ---- 1) Seleksi tokoh pembuka (introducedChapter ≤ 1) ----
  console.log('== Seleksi tokoh pembuka ==')
  const opening = selectOpeningCharacters(compiled)
  const openingIds = opening.map((c) => c.characterId)
  check('hanya Rani (bab 1) jadi tokoh pembuka', openingIds.length === 1 && openingIds[0] === idRani, openingIds)
  check('konteks pembuka membawa voice dasar', !!opening[0]?.baseVoice?.register, opening[0]?.baseVoice)

  // ---- 2) validateAuthoredVoice: terima yang kaya, tolak yang cacat ----
  console.log('\n== validateAuthoredVoice ==')
  const base: VoiceSheet = compiled.snapshot.voiceSheets.find((v) => v.characterId === idRani)!
  const richOk: AuthoredVoice = { characterId: idRani, register: 'tenang tapi menusuk, hemat kata', speechHabits: ['kalimat pendek', 'jeda menekan'], forbiddenWords: ['sumpah'], sampleLines: ['Aku sudah selesai menunggu.', 'Katakan sekali lagi.'] }
  check('voice kaya diterima', validateAuthoredVoice(richOk, base) !== null)
  const leaky: AuthoredVoice = { ...richOk, sampleLines: ['Tolong perbaiki prompt token ini.'] }
  check('voice bocor istilah teknis ditolak', validateAuthoredVoice(leaky, base) === null)
  const thin: AuthoredVoice = { characterId: idRani, register: 'ok', speechHabits: [], forbiddenWords: [], sampleLines: [] }
  check('voice kurang substansi ditolak', validateAuthoredVoice(thin, base) === null)

  // ---- 3) enrich: author sukses hanya memperkaya tokoh pembuka ----
  console.log('\n== enrichOpeningVoiceSheets: author sukses ==')
  const goodAuthor: VoiceSheetAuthorFn = async (ctx) =>
    ctx.characters.map((c) => ({
      characterId: c.characterId,
      register: `${c.baseVoice.register}, diperkaya khas`,
      speechHabits: [...c.baseVoice.speechHabits, 'ritme khas pembuka'],
      forbiddenWords: c.baseVoice.forbiddenWords,
      sampleLines: [...c.baseVoice.sampleLines, 'Dialog pembuka yang otentik.'],
    }))
  const r1 = await enrichOpeningVoiceSheets(compiled, goodAuthor)
  check('Rani diperkaya', r1.enrichedIds.includes(idRani), r1.enrichedIds)
  check('tidak ada fallback', r1.fallbackIds.length === 0, r1.fallbackIds)
  const raniVoice = r1.compiled.snapshot.voiceSheets.find((v) => v.characterId === idRani)!
  check('voice Rani berubah (diperkaya)', raniVoice.register.includes('diperkaya'), raniVoice.register)
  const senaVoice = r1.compiled.snapshot.voiceSheets.find((v) => v.characterId === idSena)!
  const damarVoice = r1.compiled.snapshot.voiceSheets.find((v) => v.characterId === idDamar)!
  check('voice Sena (non-pembuka) tak disentuh', senaVoice.register === 'hangat dan setia', senaVoice.register)
  check('voice Damar (non-pembuka) tak disentuh', damarVoice.register === 'licin dan berwibawa', damarVoice.register)
  check('immutable: snapshot asal tak berubah', compiled.snapshot.voiceSheets.find((v) => v.characterId === idRani)!.register === 'tenang namun tajam')
  check('bab/karakter/secret utuh', r1.compiled.snapshot.blueprints.length === compiled.snapshot.blueprints.length && r1.compiled.snapshot.characters.length === 3)

  // ---- 4) enrich: author null → fallback ke voice dasar ----
  console.log('\n== enrichOpeningVoiceSheets: author null (fallback) ==')
  const nullAuthor: VoiceSheetAuthorFn = async () => null
  const r2 = await enrichOpeningVoiceSheets(compiled, nullAuthor)
  check('author null → Rani fallback', r2.fallbackIds.includes(idRani), r2.fallbackIds)
  check('author null → tak ada yang diperkaya', r2.enrichedIds.length === 0, r2.enrichedIds)
  check('fallback: voice Rani = dasar', r2.compiled.snapshot.voiceSheets.find((v) => v.characterId === idRani)!.register === 'tenang namun tajam')

  // ---- 5) enrich: author throw → fallback (tak buntu) ----
  console.log('\n== enrichOpeningVoiceSheets: author throw (fallback) ==')
  const throwAuthor: VoiceSheetAuthorFn = async () => { throw new Error('boom') }
  const r3 = await enrichOpeningVoiceSheets(compiled, throwAuthor)
  check('author throw → fallback (tak lempar)', r3.fallbackIds.includes(idRani), r3.fallbackIds)

  // ---- 6) enrich: author kembalikan voice cacat → fallback tokoh itu ----
  console.log('\n== enrichOpeningVoiceSheets: voice cacat (fallback) ==')
  const badAuthor: VoiceSheetAuthorFn = async (ctx) =>
    ctx.characters.map((c) => ({ characterId: c.characterId, register: 'x', speechHabits: [], forbiddenWords: [], sampleLines: [] }))
  const r4 = await enrichOpeningVoiceSheets(compiled, badAuthor)
  check('voice cacat → fallback', r4.fallbackIds.includes(idRani) && r4.enrichedIds.length === 0, { f: r4.fallbackIds, e: r4.enrichedIds })

  // ---- 7) Live voice authoring (opsional) ----
  if (process.env.OPENROUTER_API_KEY || process.env.AI_GATEWAY_API_KEY) {
    console.log('\n== Live: makeVoiceSheetAuthor (opsional) ==')
    try {
      const { makeVoiceSheetAuthor } = await import('../lib/authoring/server')
      const live = await enrichOpeningVoiceSheets(compiled, makeVoiceSheetAuthor())
      check('live: Rani diperkaya ATAU fallback aman', live.enrichedIds.includes(idRani) || live.fallbackIds.includes(idRani), { e: live.enrichedIds, f: live.fallbackIds })
    } catch (e) {
      console.log('  SKIP  live check gagal:', (e as Error).message)
    }
  } else {
    console.log('\n  (lewati live voice authoring — tak ada OPENROUTER/GATEWAY key)')
  }

  console.log(`\nHASIL M7 T7.2: ${pass} PASS / ${fail} FAIL`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })

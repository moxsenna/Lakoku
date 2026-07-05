/**
 * Harness M4 — membuktikan Exit Criteria:
 *  - generasi 1 bab (plan→write→Layer A→repair) lolos,
 *  - repair menyembuhkan MAJOR; gagal terus → FAILED_REVIEW_REQUIRED,
 *  - schema menolak output tak valid,
 *  - boundary consumer-safe menangkap kebocoran istilah internal,
 *  - template lakoku_drama_bangkit_v1 menurunkan blueprint konsisten.
 *
 * Jalankan: NODE_OPTIONS='--conditions=react-server' npx tsx scripts/m4-generation.ts
 */

import { buildFixtureSnapshot } from '../fixtures/narrative/fixture-50'
import {
  createDeterministicProvider,
  generateChapter,
  toReaderSafe,
  assertConsumerSafe,
  scanForLeaks,
  GatewayError,
  type GenerationProvider,
  type GatewayDeps,
} from '@lakoku/ai-gateway'
import {
  buildBlueprints,
  ACT_GATES,
  REVEAL_GATE_CHAPTERS,
  TOTAL_CHAPTERS,
  type StorySpine,
  type ChapterBlueprint,
} from '@lakoku/narrative-core'

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

function blueprintFor(snapshotBps: ChapterBlueprint[], n: number): ChapterBlueprint {
  const bp = snapshotBps.find((b) => b.chapterNumber === n)
  if (!bp) throw new Error(`blueprint bab ${n} tak ada`)
  return bp
}

async function main() {
  const snapshot = buildFixtureSnapshot()
  const deps: GatewayDeps = { provider: createDeterministicProvider() }

  console.log('== 1. Happy path (Bab 6) ==')
  {
    const r = await generateChapter(deps, {
      snapshot,
      blueprint: blueprintFor(snapshot.blueprints, 6),
      chapterNumber: 6,
    })
    check('status PUBLISHED', r.status === 'PUBLISHED', r)
    check('0 repair attempt', r.attempts === 0, r.attempts)
    check('tak ada CRITICAL/MAJOR', !r.findings.some((f) => f.severity !== 'MINOR'), r.findings)
    check('wordCount 500–800', !!r.draft && r.draft.wordCount >= 500 && r.draft.wordCount <= 800, r.draft?.wordCount)
  }

  console.log('== 2. Reveal gate (Bab 12) ==')
  {
    const r = await generateChapter(deps, {
      snapshot,
      blueprint: blueprintFor(snapshot.blueprints, 12),
      chapterNumber: 12,
    })
    check('PUBLISHED dgn reveal tergated', r.status === 'PUBLISHED', r)
    check('reveal secret:wasiat-palsu ada', !!r.draft?.reveals.some((x) => x.secretId === 'secret:wasiat-palsu'))
  }

  console.log('== 3. Karakter baru terencana (Bab 33) ==')
  {
    const r = await generateChapter(deps, {
      snapshot,
      blueprint: blueprintFor(snapshot.blueprints, 33),
      chapterNumber: 33,
    })
    check('PUBLISHED', r.status === 'PUBLISHED', r)
    check('Sari diperkenalkan', !!r.draft?.newNamedCharacters.includes('char:sari'))
  }

  console.log('== 4. Repair menyembuhkan MAJOR (SHORT) ==')
  {
    const r = await generateChapter(deps, {
      snapshot,
      blueprint: blueprintFor(snapshot.blueprints, 6),
      chapterNumber: 6,
      injectDefects: ['SHORT'],
    })
    check('PUBLISHED setelah repair', r.status === 'PUBLISHED', r)
    check('tepat 1 repair attempt', r.attempts === 1, r.attempts)
  }

  console.log('== 5. Repair beberapa cacat sekaligus ==')
  {
    const r = await generateChapter(deps, {
      snapshot,
      blueprint: blueprintFor(snapshot.blueprints, 6),
      chapterNumber: 6,
      injectDefects: ['SHORT', 'NO_CHOICE', 'TOO_MANY_SCENES'],
    })
    check('PUBLISHED', r.status === 'PUBLISHED', r)
    check('1 attempt (semua cacat sembuh sekali repair)', r.attempts === 1, r.attempts)
  }

  console.log('== 6. FAILED_REVIEW_REQUIRED (provider bandel) ==')
  {
    const base = createDeterministicProvider()
    const stubborn: GenerationProvider = {
      name: base.name,
      generatePlan: (i) => base.generatePlan(i),
      // Selalu pendek, abaikan repairFindings → tak pernah sembuh.
      writeChapter: (i) =>
        base.writeChapter({ ...i, repairFindings: undefined, injectDefects: ['SHORT'] }),
    }
    const r = await generateChapter(
      { provider: stubborn },
      { snapshot, blueprint: blueprintFor(snapshot.blueprints, 6), chapterNumber: 6 },
    )
    check('status FAILED_REVIEW_REQUIRED', r.status === 'FAILED_REVIEW_REQUIRED', r.status)
    check('draft null (tak dipaksa publish)', r.draft === null)
    check('mentok 2 attempt', r.attempts === 2, r.attempts)
  }

  console.log('== 7. Schema menolak plan tak valid (thread baru Bab 42) ==')
  {
    const badPlan: GenerationProvider = {
      name: 'bad',
      generatePlan: async () => ({
        storyId: snapshot.storyId,
        chapterNumber: 42,
        phase: 'Krisis',
        chapterGoal: 'x',
        plannedBeats: ['a'],
        targetWordCount: 650,
        targetSceneCount: 3,
        opensThreadId: 'thread:baru', // dilarang ≥ Bab 41
        usesReveals: [],
        proposedStateDelta: {},
        introducesCharacters: [],
      }),
      writeChapter: async () => ({}),
    }
    let threw = false
    let code = ''
    try {
      await generateChapter(
        { provider: badPlan },
        { snapshot, blueprint: blueprintFor(snapshot.blueprints, 42), chapterNumber: 42 },
      )
    } catch (e) {
      threw = true
      code = e instanceof GatewayError ? e.code : String(e)
    }
    check('plan invalid ditolak (PLAN_INVALID)', threw && code === 'PLAN_INVALID', code)
  }

  console.log('== 8. Schema menolak draft tak valid ==')
  {
    const badDraft: GenerationProvider = {
      name: 'bad',
      generatePlan: (i) => createDeterministicProvider().generatePlan(i),
      writeChapter: async () => ({ storyId: snapshot.storyId, chapterNumber: 6 }), // tanpa title/paragraphs
    }
    let threw = false
    let code = ''
    try {
      await generateChapter(
        { provider: badDraft },
        { snapshot, blueprint: blueprintFor(snapshot.blueprints, 6), chapterNumber: 6 },
      )
    } catch (e) {
      threw = true
      code = e instanceof GatewayError ? e.code : String(e)
    }
    check('draft invalid ditolak (DRAFT_INVALID)', threw && code === 'DRAFT_INVALID', code)
  }

  console.log('== 9. Boundary consumer-safe ==')
  {
    const r = await generateChapter(deps, {
      snapshot,
      blueprint: blueprintFor(snapshot.blueprints, 6),
      chapterNumber: 6,
    })
    const safe = toReaderSafe(r.draft!)
    let noThrow = true
    try {
      assertConsumerSafe(safe)
    } catch {
      noThrow = false
    }
    check('draft bersih lolos consumer-safe', noThrow)
    check('reader-safe tanpa field internal', !('events' in (safe as object)) && !('proposedStateDelta' in (safe as object)))

    // Kebocoran: sisipkan istilah internal.
    const leaky = {
      chapterNumber: 6,
      title: 'Bab 6',
      paragraphs: ['Cerita biasa.', 'Ini dihasilkan oleh model gpt-4 dengan prompt rahasia.'],
      hasChoiceOrGate: true,
    }
    check('scanForLeaks menangkap kebocoran', scanForLeaks(leaky.paragraphs.join(' ')).length >= 2, scanForLeaks(leaky.paragraphs.join(' ')))
    let caught = false
    let lcode = ''
    try {
      assertConsumerSafe(leaky)
    } catch (e) {
      caught = true
      lcode = e instanceof GatewayError ? e.code : String(e)
    }
    check('assertConsumerSafe melempar CONSUMER_LEAK', caught && lcode === 'CONSUMER_LEAK', lcode)
  }

  console.log('== 10. Template lakoku_drama_bangkit_v1 ==')
  {
    const spine: StorySpine = { storyId: snapshot.storyId, secrets: snapshot.secrets }
    const bps = buildBlueprints(spine)
    check('menghasilkan 50 blueprint', bps.length === TOTAL_CHAPTERS, bps.length)
    check('act gate = 5/12/20/32/40/45/48/50', JSON.stringify(ACT_GATES) === JSON.stringify([5, 12, 20, 32, 40, 45, 48, 50]), ACT_GATES)
    check('reveal gate kanonik = 12/20/32/45', JSON.stringify(REVEAL_GATE_CHAPTERS) === JSON.stringify([12, 20, 32, 45]))
    // Bab 11: semua secret (gate 12,20,32,45) masih terlarang.
    const bp11 = bps.find((b) => b.chapterNumber === 11)!
    check('Bab 11 melarang 4 reveal', bp11.forbiddenReveals.length === 4, bp11.forbiddenReveals)
    // Bab 12: secret gate 12 tak lagi terlarang (boleh dibuka).
    const bp12 = bps.find((b) => b.chapterNumber === 12)!
    check('Bab 12 tak larang secret:wasiat-palsu', !bp12.forbiddenReveals.includes('secret:wasiat-palsu'), bp12.forbiddenReveals)
    // Bab 46 (act 7) melarang 0 secret (semua gate sudah lewat).
    const bp46 = bps.find((b) => b.chapterNumber === 46)!
    check('Bab 46 tak larang reveal apa pun', bp46.forbiddenReveals.length === 0, bp46.forbiddenReveals)
  }

  console.log(`\nHASIL M4: ${pass} PASS / ${fail} FAIL`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

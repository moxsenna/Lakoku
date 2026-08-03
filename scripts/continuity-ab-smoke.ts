import { runContinuityChecks } from '@lakoku/narrative-core'
import { generateChapter, createDeterministicProvider } from '@lakoku/ai-gateway'
import { createGatewayProvider } from '@lakoku/ai-gateway/server'
import type { CanonSnapshot, ChapterBlueprint, ContinuationContext } from '@lakoku/narrative-core'
import type { PreProseChapterBrief } from '../lib/story-engine/pre-prose-brief'

function isProductionSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false
  return url.includes('supabase.co') || url.includes('prod')
}

async function runABSmoke() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (isProductionSupabaseUrl(supabaseUrl)) {
    console.error('REFUSING_PRODUCTION_SEED: A/B Smoke hanya boleh dijalankan di DB local/staging terisolasi!')
    process.exit(1)
  }

  const envTarget = process.env.LAKOKU_CONTINUITY_SMOKE_DB
  if (!envTarget || (envTarget !== 'local' && envTarget !== 'staging')) {
    console.error('Harap tetapkan LAKOKU_CONTINUITY_SMOKE_DB=local atau staging')
    process.exit(1)
  }

  console.log(`=== STARTING CONTINUITY A/B SMOKE (ENV: ${envTarget}) ===`)

  const mockSnapshot: CanonSnapshot = {
    storyId: 'story-ab-test',
    characters: [
      { id: 'nadia', storyId: 'story-ab-test', canonicalName: 'Nadia', role: 'Protagonis', motivation: 'Mencari kebenaran', introducedChapter: 1, status: 'ALIVE' },
      { id: 'raka', storyId: 'story-ab-test', canonicalName: 'Raka', role: 'Antagonis', motivation: 'Menyembunyikan rahasia', introducedChapter: 1, status: 'ALIVE' },
    ],
    aliases: [],
    voiceSheets: [],
    facts: [],
    knowledge: [],
    secrets: [],
    timeline: [],
    threads: [],
    actRollups: [],
    blueprints: [
      {
        chapterNumber: 2,
        phase: 'Fase 2',
        chapterGoal: 'Konfrontasi atau Pelarian',
        mandatoryBeats: ['Lanjutkan konflik dari galeri seni'],
        introducesCharacters: [],
        forbiddenReveals: [],
        allowedStateDelta: {},
        version: 1,
        reconciledFromVersion: null,
        reconciliationReason: null,
      },
    ],
  }

  const blueprint: ChapterBlueprint = mockSnapshot.blueprints[0]

  const contextA: ContinuationContext = {
    storyId: 'story-ab-test',
    targetChapterNumber: 2,
    previousChapter: {
      number: 1,
      title: 'Galeri Seni Malam Hari',
      endingParagraphs: [
        'Nadia menatap Raka dengan tajam di galeri seni malam itu.',
        'Lukisan tua yang hancur tergeletak di lantai.',
        'Keputusan harus diambil sekarang juga.',
      ],
    },
    previousChoice: {
      chapterNumber: 1,
      choiceId: 'choice-a',
      label: 'Konfrontasi dan hadapi pengadilan',
      consequence: ['Nadia membawa kasus ke pengadilan', 'Raka terdesak hukum'],
      effectSummary: { flagsSet: ['court_path'] },
      createdAt: new Date().toISOString(),
    },
    routeStateSummary: 'Rute pengadilan',
    openThreads: [],
    anchorFacts: [{ id: 'f1', statement: 'Lukisan galeri rusak', establishedChapter: 1, loadBearing: true }],
    recentTimeline: [{ chapterNumber: 1, ordinal: 1, description: 'Nadia menemui Raka di galeri' }],
    mustNotReveal: [],
  }

  const briefA: PreProseChapterBrief = {
    storyId: 'story-ab-test',
    chapterNumber: 2,
    phase: 'Fase 2',
    lockedEndingKey: null,
    chapterGoal: 'Hadapi pengadilan secara terbuka',
    mustInclude: ['Lanjutkan konflik dari galeri seni'],
    mustNotInclude: [],
    mustNotReveal: [],
    routeStateSummary: 'Rute pengadilan',
    previousChoiceSummary: 'Pilihan Bab 1: Konfrontasi dan hadapi pengadilan',
    previousChoiceApplied: true,
  }

  const contextB: ContinuationContext = {
    storyId: 'story-ab-test',
    targetChapterNumber: 2,
    previousChapter: {
      number: 1,
      title: 'Galeri Seni Malam Hari',
      endingParagraphs: [
        'Nadia menatap Raka dengan tajam di galeri seni malam itu.',
        'Lukisan tua yang hancur tergeletak di lantai.',
        'Keputusan harus diambil sekarang juga.',
      ],
    },
    previousChoice: {
      chapterNumber: 1,
      choiceId: 'choice-b',
      label: 'Melarikan diri dan cari bukti rahasia',
      consequence: ['Nadia melarikan diri dari galeri', 'Nadia mencari bukti di gudang tua'],
      effectSummary: { flagsSet: ['secret_proof_path'] },
      createdAt: new Date().toISOString(),
    },
    routeStateSummary: 'Rute pencarian bukti',
    openThreads: [],
    anchorFacts: [{ id: 'f1', statement: 'Lukisan galeri rusak', establishedChapter: 1, loadBearing: true }],
    recentTimeline: [{ chapterNumber: 1, ordinal: 1, description: 'Nadia menemui Raka di galeri' }],
    mustNotReveal: [],
  }

  const briefB: PreProseChapterBrief = {
    storyId: 'story-ab-test',
    chapterNumber: 2,
    phase: 'Fase 2',
    lockedEndingKey: null,
    chapterGoal: 'Melarikan diri ke gudang tua',
    mustInclude: ['Lanjutkan konflik dari galeri seni'],
    mustNotInclude: [],
    mustNotReveal: [],
    routeStateSummary: 'Rute pencarian bukti',
    previousChoiceSummary: 'Pilihan Bab 1: Melarikan diri dan cari bukti rahasia',
    previousChoiceApplied: true,
  }

  // Real-model A/B only when NARRATIVE_PROVIDER=gateway; default stays
  // deterministic (gratis, harness-only) agar dry-run tanpa LLM tetap jalan.
  const provider =
    process.env.NARRATIVE_PROVIDER === 'gateway'
      ? createGatewayProvider()
      : createDeterministicProvider()

  const genResultA = await generateChapter(
    { provider },
    {
      snapshot: mockSnapshot,
      blueprint,
      chapterNumber: 2,
      continuation: contextA,
      brief: briefA,
    },
  )

  const genResultB = await generateChapter(
    { provider },
    {
      snapshot: mockSnapshot,
      blueprint,
      chapterNumber: 2,
      continuation: contextB,
      brief: briefB,
    },
  )

  console.log('Result Status Cabang A:', genResultA.status)
  console.log('Result Status Cabang B:', genResultB.status)

  if (!genResultA.draft || !genResultB.draft) {
    console.error('Generasi draft gagal pada salah satu cabang!')
    process.exit(1)
  }

  const paragraphsA = genResultA.draft.paragraphs
  const paragraphsB = genResultB.draft.paragraphs

  console.log('\n--- HASIL GENERASI NYATA CABANG A (Pengadilan) ---')
  console.log(paragraphsA.slice(0, 3).join('\n'))

  console.log('\n--- HASIL GENERASI NYATA CABANG B (Pencarian Bukti) ---')
  console.log(paragraphsB.slice(0, 3).join('\n'))

  const findingsA = runContinuityChecks(mockSnapshot, { chapterNumber: 2, paragraphs: paragraphsA }, contextA)
  const findingsB = runContinuityChecks(mockSnapshot, { chapterNumber: 2, paragraphs: paragraphsB }, contextB)

  console.log('\nFindings Continuity Cabang A:', findingsA)
  console.log('Findings Continuity Cabang B:', findingsB)

  const passA = !findingsA.some((f) => f.severity === 'CRITICAL' || f.severity === 'MAJOR')
  const passB = !findingsB.some((f) => f.severity === 'CRITICAL' || f.severity === 'MAJOR')

  if (passA && passB) {
    console.log('\nPROGRAMMATIC GATE: PASS')
  } else {
    console.error('\nPROGRAMMATIC GATE: FAILED')
    process.exit(1)
  }
}

runABSmoke().catch((err) => {
  console.error(err)
  process.exit(1)
})

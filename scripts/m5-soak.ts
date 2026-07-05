/**
 * M5 — Soak test 50 bab + validator konsistensi (NCS §8).
 *
 * Menjalankan generasi 50 bab pada 3 jalur (high-trust, low-trust, mixed) dan
 * membuktikan Exit Criteria M5:
 *   - 0 kontradiksi CRITICAL pada bab yang dipublish;
 *   - semua ending reachable di tiap reconciliation checkpoint;
 *   - biaya/bab dalam guardrail (jumlah panggilan provider terbatas);
 *   - repair protocol (Lapis A & B) & thread lifecycle (G4) & reconciliation (G1) benar.
 *
 * Jalankan: npx tsx scripts/m5-soak.ts
 */

import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import {
  relationshipKey,
  validateLayerB,
  transitionThread,
  touchThread,
  refreshStaleness,
  validateThreadLifecycle,
  checkChapter48Block,
  canOpenNewThread,
  runReconciliation,
  computeDriftScore,
  checkEndingReachability,
  checkSpineIntegrity,
  ACT_GATES,
  type CanonSnapshot,
  type Finding,
  type StoryThread,
  type LayerBContext,
  type RelationshipScores,
  type EndingDef,
  type ActualState,
  type TrajectoryRequirement,
} from '@lakoku/narrative-core'
import {
  createDeterministicProvider,
  generateChapter,
  type GenerationProvider,
  type PlanInput,
  type WriteInput,
  type ThreadContext,
} from '@lakoku/ai-gateway'

// ---------- Test harness ----------
let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push(name + (extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''))
    console.error(`✗ ${name}`, extra ?? '')
  }
}

function hasCritical(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'CRITICAL')
}

/** Provider penghitung biaya: membungkus adapter deterministik. */
function countingProvider(): { provider: GenerationProvider; calls: () => number; reset: () => void } {
  const inner = createDeterministicProvider()
  let n = 0
  const provider: GenerationProvider = {
    name: inner.name,
    async generatePlan(i: PlanInput) {
      n++
      return inner.generatePlan(i)
    },
    async writeChapter(i: WriteInput) {
      n++
      return inner.writeChapter(i)
    },
  }
  return { provider, calls: () => n, reset: () => (n = 0) }
}

// ---------- Definisi ending & jalur ----------
const ENDINGS: EndingDef[] = [
  { id: 'ending:tegar', isMain: true, isSecret: false, blockedByFlags: [] },
  { id: 'ending:damai', isMain: true, isSecret: false, blockedByFlags: ['rani.balas_dendam'] },
  { id: 'ending:pahit', isMain: true, isSecret: false, blockedByFlags: [] },
  { id: 'ending:rahasia', isMain: false, isSecret: true, blockedByFlags: ['sari.tak_ditemukan'] },
]

type PathName = 'high-trust' | 'low-trust' | 'mixed'

interface PathDef {
  name: PathName
  relationships: RelationshipScores
  /** flag yang aktif di jalur ini (memengaruhi reachability). */
  flags: Set<string>
}

function makePaths(): PathDef[] {
  const rd = relationshipKey('char:rani', 'char:dimas')
  const rr = relationshipKey('char:rani', 'char:bu-ratna')
  return [
    {
      name: 'high-trust',
      relationships: { [rd]: 65, [rr]: -20 },
      flags: new Set<string>(),
    },
    {
      name: 'low-trust',
      // low-trust menaruh dendam → memblok ending:damai (masih 2 main reachable).
      relationships: { [rd]: -55, [rr]: -70 },
      flags: new Set<string>(['rani.balas_dendam']),
    },
    {
      name: 'mixed',
      relationships: { [rd]: 20, [rr]: -40 },
      flags: new Set<string>(),
    },
  ]
}

// ---------- Jalur thread lifecycle deterministik ----------
/** Kloning thread awal dari fixture menjadi state yang bisa berevolusi. */
function initThreads(snapshot: CanonSnapshot): StoryThread[] {
  return snapshot.threads.map((t) => ({ ...t, stale: false, staleSinceChapter: null }))
}

/**
 * Terapkan transisi lifecycle terjadwal pada bab tertentu.
 * warisan (main): DEVELOPING@7, PAYOFF_DUE@41, RESOLVED@46.
 * cinta:          DEVELOPING@8, PAYOFF_DUE@36, RESOLVED@40.
 */
function advanceLifecycle(threads: StoryThread[], chapter: number): StoryThread[] {
  return threads.map((t) => {
    if (t.id === 'thread:warisan') {
      if (chapter === 7) return transitionThread(t, 'DEVELOPING')
      if (chapter === 41) return transitionThread(t, 'PAYOFF_DUE')
      if (chapter === 46) return transitionThread(t, 'RESOLVED')
    }
    if (t.id === 'thread:cinta') {
      if (chapter === 8) return transitionThread(t, 'DEVELOPING')
      if (chapter === 36) return transitionThread(t, 'PAYOFF_DUE')
      if (chapter === 40) return transitionThread(t, 'RESOLVED')
    }
    return t
  })
}

/** thread aktif yang dimajukan bab ini (semua aktif disentuh → tak pernah stale). */
function activeIds(threads: StoryThread[]): string[] {
  return threads
    .filter((t) => t.status === 'OPEN' || t.status === 'DEVELOPING' || t.status === 'PAYOFF_DUE')
    .map((t) => t.id)
}

// ---------- Soak 50 bab per jalur ----------
async function runSoakPath(path: PathDef): Promise<void> {
  const snapshot = buildFixtureSnapshot()
  const { provider, calls, reset } = countingProvider()
  const layerBCtx: LayerBContext = { relationships: path.relationships }

  let threads = initThreads(snapshot)
  let maxCallsPerChapter = 0
  let totalCalls = 0
  let criticalCount = 0

  for (let chapter = 1; chapter <= 50; chapter++) {
    threads = advanceLifecycle(threads, chapter)
    threads = refreshStaleness(threads, chapter)

    const advancedThreadIds = activeIds(threads)
    const threadContext: ThreadContext = {
      threads,
      advancedThreadIds,
      opensNewThread: false,
    }

    reset()
    const result = await generateChapter(
      { provider },
      {
        snapshot,
        blueprint: snapshot.blueprints[chapter - 1],
        chapterNumber: chapter,
        threadContext,
        layerBContext: layerBCtx,
      },
    )
    const c = calls()
    totalCalls += c
    maxCallsPerChapter = Math.max(maxCallsPerChapter, c)

    check(
      `[${path.name}] Bab ${chapter} PUBLISHED`,
      result.status === 'PUBLISHED',
      { status: result.status, reason: result.reason, findings: result.findings },
    )
    if (hasCritical(result.findings)) criticalCount++

    // Sentuh thread aktif yang dimajukan (reset staleness).
    threads = threads.map((t) =>
      advancedThreadIds.includes(t.id) ? touchThread(t, chapter) : t,
    )

    // Reconciliation checkpoint di akhir tiap act.
    if (ACT_GATES.includes(chapter)) {
      const state = buildActualState(threads, path)
      const rec = runReconciliation({
        storyId: snapshot.storyId,
        blueprints: snapshot.blueprints.slice(chapter, chapter + 6),
        requirements: trajectoryRequirements(chapter),
        state,
        secrets: snapshot.secrets,
        endings: ENDINGS,
        checkpointChapter: chapter,
      })
      check(
        `[${path.name}] checkpoint Bab ${chapter}: ending reachable`,
        !hasCritical(rec.findings),
        rec.findings,
      )
      check(
        `[${path.name}] checkpoint Bab ${chapter}: status != FAILED`,
        rec.status !== 'FAILED_REVIEW_REQUIRED',
        rec.status,
      )
    }
  }

  // Exit criteria per jalur.
  check(`[${path.name}] 0 CRITICAL sepanjang 50 bab`, criticalCount === 0, criticalCount)
  // Guardrail biaya: happy-path = 1 plan + 1 write = 2 panggilan/bab.
  check(
    `[${path.name}] biaya/bab dalam guardrail (≤ 6 panggilan)`,
    maxCallsPerChapter <= 6,
    { maxCallsPerChapter },
  )
  const avg = totalCalls / 50
  check(`[${path.name}] rata-rata biaya/bab ≈ 2 (≤ 2.5)`, avg <= 2.5, { avg })
}

function buildActualState(threads: StoryThread[], path: PathDef): ActualState {
  const threadStatuses: Record<string, string> = {}
  for (const t of threads) threadStatuses[t.id] = t.status
  return {
    storyFlags: path.flags,
    clues: new Set<string>(['clue:wasiat', 'clue:cincin']),
    threadStatuses,
  }
}

/** Requirement trajectory ringan (drift rendah) untuk act berikutnya. */
function trajectoryRequirements(gate: number): TrajectoryRequirement[] {
  const reqs: TrajectoryRequirement[] = []
  for (let n = gate + 1; n <= gate + 6; n++) {
    reqs.push({
      chapterNumber: n,
      requiredClues: ['clue:wasiat'],
      requiredThreadsActive: n < 46 ? ['thread:warisan'] : [],
    })
  }
  return reqs
}

// ---------- Targeted tests ----------
async function targetedTests(): Promise<void> {
  const snapshot = buildFixtureSnapshot()
  const provider = createDeterministicProvider()
  const bp = (n: number) => snapshot.blueprints[n - 1]

  // Lapis A: repair menyembuhkan cacat SHORT (1 attempt).
  {
    const r = await generateChapter(
      { provider },
      { snapshot, blueprint: bp(6), chapterNumber: 6, injectDefects: ['SHORT'] },
    )
    check('LayerA repair SHORT → PUBLISHED', r.status === 'PUBLISHED', r.reason)
    check('LayerA repair SHORT: attempts=1', r.attempts === 1, r.attempts)
  }

  // Lapis B: repair voice/soft/emotion.
  {
    const rd = relationshipKey('char:rani', 'char:dimas')
    const r = await generateChapter(
      { provider },
      {
        snapshot,
        blueprint: bp(6),
        chapterNumber: 6,
        injectDefects: ['VOICE_BAD', 'SOFT_CONTRA', 'EMOTION_BAD'],
        layerBContext: { relationships: { [rd]: -60 } },
      },
    )
    check('LayerB repair voice/soft/emotion → PUBLISHED', r.status === 'PUBLISHED', r.reason)
    check('LayerB repair: attempts≥1', r.attempts >= 1, r.attempts)
  }

  // Layer B mendeteksi voice forbidden word (unit).
  {
    const draft = {
      storyId: snapshot.storyId,
      chapterNumber: 6,
      title: 'Bab 6',
      paragraphs: ['x'],
      wordCount: 1,
      sceneCount: 3,
      hasChoiceOrGate: true,
      events: [],
      knowledgeAssertions: [],
      reveals: [],
      proposedStateDelta: {},
      newNamedCharacters: [],
      dialogue: [{ characterId: 'char:rani', text: 'Aku sumpah tidak tahu.' }],
    }
    const res = validateLayerB(snapshot, draft)
    check(
      'LayerB unit: deteksi VOICE_FORBIDDEN_WORD',
      res.findings.some((f) => f.code === 'VOICE_FORBIDDEN_WORD'),
      res.findings,
    )
  }

  // Layer B: emosi warm vs skor negatif → mismatch.
  {
    const rr = relationshipKey('char:rani', 'char:bu-ratna')
    const draft = {
      storyId: snapshot.storyId,
      chapterNumber: 6,
      title: 'Bab 6',
      paragraphs: ['x'],
      wordCount: 1,
      sceneCount: 3,
      hasChoiceOrGate: true,
      events: [],
      knowledgeAssertions: [],
      reveals: [],
      proposedStateDelta: {},
      newNamedCharacters: [],
      emotionBeats: [
        { characterId: 'char:rani', targetCharacterId: 'char:bu-ratna', valence: 'warm' as const },
      ],
    }
    const res = validateLayerB(snapshot, draft, { relationships: { [rr]: -70 } })
    check(
      'LayerB unit: EMOTION_RELATIONSHIP_MISMATCH',
      res.findings.some((f) => f.code === 'EMOTION_RELATIONSHIP_MISMATCH'),
      res.findings,
    )
  }

  // Thread lifecycle: budget maks 7.
  {
    const many: StoryThread[] = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      title: `thread ${i}`,
      status: 'OPEN',
      openedChapter: 1,
      lastTouchedChapter: 10,
      payoffWindow: null,
      isMainMystery: false,
    }))
    const f = validateThreadLifecycle({ threads: many, chapter: 10, advancedThreadIds: [] })
    check(
      'G4: THREAD_BUDGET_EXCEEDED (>7 aktif)',
      f.some((x) => x.code === 'THREAD_BUDGET_EXCEEDED'),
      f,
    )
    check('G4: canOpenNewThread false saat penuh', !canOpenNewThread(many.slice(0, 7), 10).ok)
  }

  // Thread lifecycle: dilarang buka thread baru ≥ Bab 41.
  {
    check('G4: no new thread ≥ Bab 41', !canOpenNewThread([], 41).ok)
    check('G4: boleh buka thread < Bab 41', canOpenNewThread([], 40).ok)
    const f = validateThreadLifecycle({
      threads: [],
      chapter: 42,
      advancedThreadIds: [],
      opensNewThread: true,
    })
    check('G4: THREAD_NEW_FORBIDDEN saat open ≥41', f.some((x) => x.code === 'THREAD_NEW_FORBIDDEN'), f)
  }

  // Thread lifecycle: stale tak di-callback → MAJOR.
  {
    let threads: StoryThread[] = [
      { id: 'ta', title: 'a', status: 'OPEN', openedChapter: 1, lastTouchedChapter: 4, payoffWindow: null, isMainMystery: false },
    ]
    threads = refreshStaleness(threads, 10) // gap 6 → stale @10
    check('G4: thread jadi stale setelah 6 bab', threads[0].stale === true, threads[0])
    const f = validateThreadLifecycle({ threads, chapter: 13, advancedThreadIds: [] })
    check('G4: THREAD_STALE_UNADDRESSED (overdue callback)', f.some((x) => x.code === 'THREAD_STALE_UNADDRESSED'), f)
    // Callback tepat waktu membersihkan.
    const touched = threads.map((t) => touchThread(t, 12))
    const f2 = validateThreadLifecycle({ threads: touched, chapter: 13, advancedThreadIds: ['ta'] })
    check('G4: callback membersihkan stale', !f2.some((x) => x.code === 'THREAD_STALE_UNADDRESSED'), f2)
  }

  // Thread lifecycle: Bab 48 diblokir bila mystery utama non-RESOLVED.
  {
    const threads: StoryThread[] = [
      { id: 'thread:warisan', title: 'main', status: 'PAYOFF_DUE', openedChapter: 1, lastTouchedChapter: 47, payoffWindow: 45, isMainMystery: true },
    ]
    const f = checkChapter48Block(threads, 48)
    check('G4: MAIN_MYSTERY_UNRESOLVED_AT_48 (CRITICAL)', f.some((x) => x.code === 'MAIN_MYSTERY_UNRESOLVED_AT_48' && x.severity === 'CRITICAL'), f)
    const resolved = threads.map((t) => ({ ...t, status: 'RESOLVED' as const }))
    check('G4: Bab 48 lolos bila mystery RESOLVED', checkChapter48Block(resolved, 48).length === 0)
  }

  // Status machine: transisi ilegal ditolak; ABANDONED butuh checkpoint.
  {
    const t: StoryThread = { id: 'x', title: 'x', status: 'RESOLVED', openedChapter: 1, lastTouchedChapter: 1, payoffWindow: null, isMainMystery: false }
    let threw = false
    try { transitionThread(t, 'OPEN') } catch { threw = true }
    check('G4: transisi RESOLVED→OPEN ditolak', threw)
    let threw2 = false
    const o: StoryThread = { ...t, status: 'OPEN' }
    try { transitionThread(o, 'ABANDONED_APPROVED') } catch { threw2 = true }
    check('G4: ABANDONED tanpa checkpoint ditolak', threw2)
    check('G4: ABANDONED via checkpoint ok', transitionThread(o, 'ABANDONED_APPROVED', { approvedByCheckpoint: true }).status === 'ABANDONED_APPROVED')
  }

  // Reconciliation: drift score & regenerasi versioned.
  {
    const state: ActualState = { storyFlags: new Set(), clues: new Set(), threadStatuses: {} }
    const drift = computeDriftScore(
      { chapterNumber: 10, requiredFlags: ['a', 'b'], requiredClues: ['c'] },
      state,
    )
    check('G1: drift score = 3 (semua unmet, capped)', drift === 3, drift)

    const rec = runReconciliation({
      storyId: snapshot.storyId,
      blueprints: [bp(13), bp(14)],
      requirements: [
        { chapterNumber: 13, requiredFlags: ['x', 'y'] }, // drift 2 → regen
        { chapterNumber: 14 }, // drift 0
      ],
      state,
      secrets: snapshot.secrets,
      endings: ENDINGS,
      checkpointChapter: 12,
    })
    check('G1: status RECONCILED', rec.status === 'RECONCILED', rec.status)
    check('G1: bab 13 diregenerasi (versioned)', rec.reconciledChapters.includes(13), rec.reconciledChapters)
    const b13 = rec.blueprints.find((b) => b.chapterNumber === 13)!
    check('G1: version naik & reconciledFromVersion terisi', b13.version === 2 && b13.reconciledFromVersion === 1, b13)
    check('G1: event BLUEPRINT_RECONCILED ditulis', rec.events.some((e) => e.type === 'BLUEPRINT_RECONCILED' && e.chapterNumber === 13), rec.events)
    check('G1: bab 14 tak berubah (drift<2)', rec.blueprints.find((b) => b.chapterNumber === 14)!.version === 1)
  }

  // Reconciliation: ending unreachable → FAILED_REVIEW_REQUIRED.
  {
    const state: ActualState = {
      storyFlags: new Set(['rani.balas_dendam', 'sari.tak_ditemukan']), // blok damai + secret
      clues: new Set(),
      threadStatuses: {},
    }
    // Tambah blok agar main reachable < 2.
    const endings: EndingDef[] = [
      { id: 'e1', isMain: true, isSecret: false, blockedByFlags: ['rani.balas_dendam'] },
      { id: 'e2', isMain: true, isSecret: false, blockedByFlags: ['sari.tak_ditemukan'] },
      { id: 'e3', isMain: false, isSecret: true, blockedByFlags: ['sari.tak_ditemukan'] },
    ]
    const f = checkEndingReachability(endings, state)
    check('G1: ENDING_UNREACHABLE terdeteksi', f.some((x) => x.code === 'ENDING_UNREACHABLE'), f)
    const rec = runReconciliation({
      storyId: snapshot.storyId,
      blueprints: [bp(20)],
      requirements: [],
      state,
      secrets: snapshot.secrets,
      endings,
      checkpointChapter: 20,
    })
    check('G1: FAILED_REVIEW_REQUIRED saat ending unreachable', rec.status === 'FAILED_REVIEW_REQUIRED', rec.status)
    check('G1: blueprint tak diubah saat FAILED', rec.reconciledChapters.length === 0, rec.reconciledChapters)
  }

  // Reconciliation: spine guard menolak penghapusan mandatory reveal.
  {
    const tampered = {
      ...bp(12),
      chapterNumber: 12,
      mandatoryBeats: ['beat tanpa reveal'], // hapus mandatory reveal secret gate 12
      forbiddenReveals: snapshot.secrets.filter((s) => s.revealGateChapter > 12).map((s) => s.id),
    }
    const f = checkSpineIntegrity(tampered, snapshot.secrets)
    check('G1: SPINE_MANDATORY_REVEAL_DROPPED', f.some((x) => x.code === 'SPINE_MANDATORY_REVEAL_DROPPED'), f)
  }
}

async function main() {
  for (const path of makePaths()) {
    await runSoakPath(path)
  }
  await targetedTests()

  console.log(`\nM5 soak: ${passed} PASS, ${failed} FAIL`)
  if (failed > 0) {
    console.error('\nKegagalan:')
    for (const f of failures) console.error(' - ' + f)
    process.exit(1)
  }
  console.log('Semua cek M5 lolos.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

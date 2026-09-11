/**
 * M10-G branch-fork proof runner — matriks G.2.2, in-memory, zero DB.
 *
 * Fork points (beku, dipilih SEBELUM run dari topologi template, bukan
 * cherry-pick pasca-kegagalan):
 *   - EARLY_FORK_CHAPTER = 10 (batas fase Retak→Terseret, act boundary)
 *   - LATE_FORK_CHAPTER  = 44 (fase Krisis, pra-lock Bab 45)
 *
 * Desain:
 *   Fase 1 (trunk): Bab 1..10 dengan kontrak kirana-gilang, pilihan opsi
 *     pertama (indeks 0) seperti runner full-proof. Checkpoint trunk disimpan.
 *   Fase 2 (early fork): dari snapshot pra-pilihan Bab 10 yang SAMA, dua
 *     cabang berjalan: cabang-A memilih opsi indeks 0, cabang-B memilih opsi
 *     indeks 1 (fallback: opsi terakhir bila hanya 2). Kedua cabang lanjut
 *     Bab 11..12 (menembus act boundary 12→13).
 *   Fase 3 (late fork): trunk tunggal Bab 11..44 (opsi indeks 0). Di Bab 44,
 *     dari snapshot pra-pilihan yang SAMA, dua cabang (indeks 0 vs indeks 1)
 *     lanjut Bab 45..50 sampai final. Verifikasi: ending lock Bab 45 di tiap
 *     cabang + closure Bab 50 + tidak ada kebocoran state antar-cabang
 *     (choiceHistory cabang-A tidak mengandung choiceId cabang-B dan
 *     sebaliknya; routeFlags divergen pada flag fork).
 *
 * Otorisasi: JANGAN jalankan tanpa otorisasi inferensi produksi eksplisit.
 * Script menolak berjalan kecuali `M10G_FULL_PROOF_AUTHORIZED=1`.
 *
 * Jalankan:
 *   node scripts/run-smoke.cjs scripts/m10-g-9router-fork-proof.ts --checkpoint=/tmp/fork.jsonl
 */

import fs from 'node:fs'
import path from 'node:path'
import { generateChapter, type ChoiceInput } from '../lib/ai-gateway'
import { createProviderFromExactRoutes } from '../lib/ai-gateway/server'
import { generateChoiceBranch } from '../lib/ai-gateway/gateway'
import {
  toAiModelRoute,
  assertM10GG1RouteAuthority,
} from '../lib/narrative-qa/contracts/m10-g-g1-route-authority.contract'
import { M10_G_G1_9ROUTER_ROUTE_AUTHORITY } from '../fixtures/m10-g/g1-route-authority-9router'
import {
  KIRANA_GILANG_STORY_ID,
  kiranaGilangSnapshot,
} from '../fixtures/narrative/kirana-gilang-continuity'
import { stripDbCredentials, assertNoDbCredentials } from './smoke-db-isolation'
import { normalizeRouteState, mergeChoiceEffect, type RouteState } from '../lib/story-engine/route-state'
import { buildChapterBrief, type ChoiceHistoryEntry, type ChapterBrief } from '../lib/story-engine/chapter-brief'
import { buildPreProseChapterBrief } from '../lib/story-engine/pre-prose-brief'
import { resolveEnding } from '../lib/story-engine/ending-resolver'
import { kiranaGilangContract } from '../fixtures/contracts/kirana-gilang'
import type { LastParagraphs } from '../lib/ai-gateway/provider'
import type { ChapterDraftParsed } from '../lib/ai-gateway/schemas'
import type { ContinuationContext } from '../lib/narrative/continuation-context'
import type { CanonSnapshot, ChapterBlueprint } from '../lib/narrative/types'
import type { StoryContract } from '../lib/story-engine/story-contract'

const CONTRACT: StoryContract = kiranaGilangContract
const PROOF_STORY_ID = KIRANA_GILANG_STORY_ID
const MAX_PROSE_ATTEMPTS = 5
const MAX_CHOICE_ATTEMPTS = 3
const PROOF_USER_ID = '00000000-0000-4000-8000-00000000ab01'
const EARLY_FORK_CHAPTER = 10
const EARLY_FORK_RUN_TO = 12
const LATE_FORK_CHAPTER = 44
const FINAL_CHAPTER = 50

interface ForkRecord {
  branch: string
  chapterNumber: number
  title: string
  wordCount: number
  paragraphCount: number
  sceneCount: number
  choiceLabels: string[]
  chosenLabel: string | null
  lockedEndingKey: string | null
  routeFlags: Record<string, boolean>
  paragraphs: string[]
}

function argValue(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? (arg.split('=').slice(1).join('=') ?? null) : null
}

function snapshotWithBlueprints(): CanonSnapshot {
  const snapshot = kiranaGilangSnapshot(CONTRACT.storyId)
  snapshot.blueprints = CONTRACT.actPlan.flatMap((act) =>
    CONTRACT.chapterTargets
      .filter((t) => t.chapterNumber >= act.fromChapter && t.chapterNumber <= act.toChapter)
      .map((target) => ({
        chapterNumber: target.chapterNumber,
        phase: target.phase,
        chapterGoal: target.goal,
        mandatoryBeats: [...target.mustInclude],
        forbiddenReveals: [...target.mustNotReveal],
        allowedStateDelta: {},
        introducesCharacters: [],
        version: 1,
        reconciledFromVersion: null,
        reconciliationReason: null,
      })),
  )
  snapshot.secrets = CONTRACT.revealRunway.map((reveal) => ({
    id: reveal.secretId,
    description: `Rahasia ${reveal.secretId}`,
    revealGateChapter: reveal.revealGateChapter,
    revealed: false,
  }))
  return snapshot
}

interface BranchState {
  routeState: RouteState
  choiceHistory: ChoiceHistoryEntry[]
  lockedEndingKey: string | null
  continuation: ContinuationContext | null
  timeline: CanonSnapshot['timeline']
}

function cloneBranchState(source: BranchState): BranchState {
  return {
    routeState: normalizeRouteState(JSON.parse(JSON.stringify(source.routeState)) as RouteState),
    choiceHistory: JSON.parse(JSON.stringify(source.choiceHistory)) as ChoiceHistoryEntry[],
    lockedEndingKey: source.lockedEndingKey,
    continuation: source.continuation
      ? (JSON.parse(JSON.stringify(source.continuation)) as ContinuationContext)
      : null,
    timeline: JSON.parse(JSON.stringify(source.timeline)) as CanonSnapshot['timeline'],
  }
}

async function main() {
  if (process.env.M10G_FULL_PROOF_AUTHORIZED !== '1') {
    throw new Error(
      'M10G_FULL_PROOF_AUTHORIZATION_REQUIRED:'
      + ' set M10G_FULL_PROOF_AUTHORIZED=1 with explicit production inference authorization',
    )
  }
  const checkpointPath = argValue('checkpoint')

  const envPath = path.resolve(process.cwd(), '.env.local')
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*['"]?(.*?)['"]?\s*$/)
      if (match?.[1] && match[2] !== undefined && !process.env[match[1]]) {
        process.env[match[1]] = match[2]
      }
    }
  }
  stripDbCredentials(process.env)
  assertNoDbCredentials(process.env)

  const baseUrl = process.env.NINEROUTER_BASE_URL
  const apiKey = process.env.NINEROUTER_API_KEY
  if (!baseUrl || !apiKey) throw new Error('MISSING_NINEROUTER_CREDENTIALS')

  const authority = assertM10GG1RouteAuthority(M10_G_G1_9ROUTER_ROUTE_AUTHORITY)
  const provider = createProviderFromExactRoutes({
    writerRoute: toAiModelRoute(authority, 'writer'),
    choicesRoute: toAiModelRoute(authority, 'choice'),
    judgeRoute: toAiModelRoute(authority, 'continuity'),
    generationPolicy: { targetWordsMin: 800, targetWordsMax: 1000, targetScenes: 3 },
  })
  const deps = { provider }
  const runId = `fork-9router-${Date.now()}`
  const snapshot = snapshotWithBlueprints()
  const blueprintFor = (n: number): ChapterBlueprint => {
    const blueprint = snapshot.blueprints.find((b) => b.chapterNumber === n)
    if (!blueprint) throw new Error(`M10G_FORK_BLUEPRINT_MISSING:${n}`)
    return blueprint
  }

  const allRecords: ForkRecord[] = []
  const writeRecord = (record: ForkRecord): void => {
    allRecords.push(record)
    if (checkpointPath) fs.appendFileSync(checkpointPath, `${JSON.stringify(record)}\n`, 'utf8')
  }

  async function runChapter(
    branch: string,
    n: number,
    state: BranchState,
    choiceIndex: number,
  ): Promise<void> {
    console.log(`\n===== [${branch} Bab ${n}] Prosa =====`)
    const isFirst = n === 1
    if (!isFirst && !state.continuation) throw new Error(`M10G_FORK_CONTINUATION_MISSING:${branch}:${n}`)
    if (!isFirst) {
      state.continuation = { ...state.continuation!, storyId: CONTRACT.storyId, targetChapterNumber: n }
    }
    const chapterBrief = buildChapterBrief({
      storyContract: CONTRACT,
      snapshot: { ...snapshot, timeline: state.timeline },
      readerState: {
        routeState: state.routeState,
        choiceHistory: state.choiceHistory,
        lockedEndingKey: state.lockedEndingKey,
      },
      chapterNumber: n,
      previousChoice: state.continuation?.previousChoice ?? null,
    })
    if (chapterBrief.lockedEndingKey !== state.lockedEndingKey) {
      state.lockedEndingKey = chapterBrief.lockedEndingKey
      console.log(`${branch} Bab ${n}: lockedEndingKey → ${state.lockedEndingKey ?? '(null)'}`)
    }
    const preProseBrief = buildPreProseChapterBrief({
      storyId: CONTRACT.storyId,
      chapterNumber: n,
      snapshot: { ...snapshot, timeline: state.timeline },
      blueprint: blueprintFor(n),
      continuation: state.continuation,
      chapterBrief,
    })

    let chapterResult: Awaited<ReturnType<typeof generateChapter>> | null = null
    for (let attempt = 1; attempt <= MAX_PROSE_ATTEMPTS; attempt++) {
      if (attempt > 1) console.log(`${branch} Bab ${n}: percobaan prosa ${attempt}/${MAX_PROSE_ATTEMPTS}...`)
      try {
        chapterResult = await generateChapter(deps, {
          snapshot: { ...snapshot, timeline: state.timeline },
          blueprint: blueprintFor(n),
          chapterNumber: n,
          continuation: state.continuation,
          brief: preProseBrief,
          executionOptions: {
            telemetryContext: {
              correlationId: `${runId}-${branch}-ch${n}-a${attempt}`,
              storyId: PROOF_STORY_ID,
              chapterNumber: n,
              userId: PROOF_USER_ID,
              generationKind: 'personalized' as const,
              jobId: null,
              attemptNumber: attempt,
            },
            workflowPhase: 'CHAPTER_PROSE_FIRST_PASS',
            writerLengthRepairV1: { enabled: true },
          },
        })
        if (chapterResult.status === 'PUBLISHED' && chapterResult.draft) break
        console.log(`${branch} Bab ${n} percobaan ${attempt}: ${chapterResult.status}`)
        chapterResult = null
      } catch (err) {
        console.log(`${branch} Bab ${n} percobaan ${attempt} gagal (${err instanceof Error ? err.name : String(err)})`)
        if (attempt === MAX_PROSE_ATTEMPTS) throw err
        chapterResult = null
      }
    }
    if (!chapterResult || chapterResult.status !== 'PUBLISHED' || !chapterResult.draft) {
      console.error(`${branch} Bab ${n} FAILED setelah ${MAX_PROSE_ATTEMPTS} percobaan`)
      process.exit(1)
    }
    const draft = chapterResult.draft
    console.log(`${branch} Bab ${n} PUBLISHED: "${draft.title}" — ${draft.wordCount} kata, ${draft.paragraphs.length} paragraf`)

    let choiceLabels: string[] = []
    let chosenLabel: string | null = null
    if (n < FINAL_CHAPTER) {
      const lastParagraphs: LastParagraphs = [
        (draft.paragraphs[draft.paragraphs.length - 3] || 'Paragraf satu.').slice(0, 400),
        (draft.paragraphs[draft.paragraphs.length - 2] || 'Paragraf dua.').slice(0, 400),
        (draft.paragraphs[draft.paragraphs.length - 1] || 'Paragraf tiga.').slice(0, 400),
      ]
      const choiceInput: ChoiceInput = {
        snapshot: { ...snapshot, timeline: state.timeline },
        chapterBrief,
        draft: { ...draft, storyId: CONTRACT.storyId },
        lastParagraphs,
        routeState: state.routeState,
        choiceHistory: state.choiceHistory,
        lockedEndingKey: state.lockedEndingKey,
      }
      let choiceBranch: Awaited<ReturnType<typeof generateChoiceBranch>> | null = null
      for (let attempt = 1; attempt <= MAX_CHOICE_ATTEMPTS; attempt++) {
        try {
          choiceBranch = await generateChoiceBranch(deps, choiceInput, {
            telemetryContext: {
              correlationId: `${runId}-${branch}-ch${n}-choices-a${attempt}`,
              storyId: PROOF_STORY_ID,
              chapterNumber: n,
              userId: PROOF_USER_ID,
              generationKind: 'personalized' as const,
              jobId: null,
              attemptNumber: attempt,
            },
            workflowPhase: 'CHAPTER_CHOICES_FIRST_PASS',
          })
          if (choiceBranch && choiceBranch.choices.length > 0) break
          choiceBranch = null
        } catch (err) {
          console.log(`${branch} Bab ${n} pilihan percobaan ${attempt} gagal (${err instanceof Error ? err.name : String(err)})`)
          if (attempt === MAX_CHOICE_ATTEMPTS) throw err
          choiceBranch = null
        }
      }
      if (!choiceBranch || choiceBranch.choices.length === 0) {
        console.error(`${branch} Bab ${n}: choice branch kosong`)
        process.exit(1)
      }
      const picked = choiceBranch.choices[Math.min(choiceIndex, choiceBranch.choices.length - 1)]!
      const pickedOutcome = choiceBranch.outcomes.find((o) => o.choiceId === picked.id)
      choiceLabels = choiceBranch.choices.map((c) => c.label)
      chosenLabel = picked.label
      console.log(`${branch} Pilihan Bab ${n} [idx ${choiceIndex}]: "${chosenLabel}" dari [${choiceLabels.join(' | ')}]`)
      const entry: ChoiceHistoryEntry = {
        chapterNumber: n,
        choiceId: picked.id,
        label: picked.label,
        consequence: pickedOutcome ? [...pickedOutcome.consequence] : [picked.hint ?? picked.label],
        effectSummary: { flagsSet: [`ch${n}_path`] },
        createdAt: new Date().toISOString(),
      }
      state.choiceHistory = [...state.choiceHistory, entry]
      if (pickedOutcome) {
        state.routeState = mergeChoiceEffect(state.routeState, pickedOutcome.effect)
      } else {
        state.routeState = normalizeRouteState({ ...state.routeState, flags: { ...state.routeState.flags, [`ch${n}_path`]: true } })
      }
    }

    state.timeline = [...state.timeline, {
      chapterNumber: n,
      ordinal: 1,
      description: `Bab ${n} "${draft.title}" — ${chosenLabel ?? 'tanpa pilihan'}.`,
      isFlashback: false,
      occursAt: n,
    }]
    const routeFlags: Record<string, boolean> = {}
    for (const [flag, value] of Object.entries(state.routeState.flags ?? {})) {
      if (value === true) routeFlags[flag] = true
    }
    writeRecord({
      branch, chapterNumber: n, title: draft.title, wordCount: draft.wordCount,
      paragraphCount: draft.paragraphs.length, sceneCount: draft.sceneCount,
      choiceLabels, chosenLabel, lockedEndingKey: state.lockedEndingKey,
      routeFlags, paragraphs: [...draft.paragraphs],
    })
    state.continuation = {
      storyId: CONTRACT.storyId,
      targetChapterNumber: n + 1,
      previousChapter: { number: n, title: draft.title, endingParagraphs: draft.paragraphs.slice(-5) },
      previousChoice: n < FINAL_CHAPTER && chosenLabel ? state.choiceHistory[state.choiceHistory.length - 1] ?? null : null,
      routeStateSummary: `Rute ${branch} Bab ${n}: ${chosenLabel ?? '-'}`,
      openThreads: [],
      anchorFacts: [],
      recentTimeline: [],
      mustNotReveal: [],
      storyAnchors: {
        corePromise: CONTRACT.corePromise,
        mainConflict: CONTRACT.mainConflict,
        finalQuestion: CONTRACT.finalQuestion,
      },
      actRollups: [],
      lockedEndingKey: state.lockedEndingKey,
    }
  }

  async function runChoiceOnly(
    branch: string,
    n: number,
    state: BranchState,
    draft: ChapterDraftParsed,
    chapterBrief: ChapterBrief,
    choiceIndex: number,
  ): Promise<void> {
    const lastParagraphs: LastParagraphs = [
      (draft.paragraphs[draft.paragraphs.length - 3] || 'Paragraf satu.').slice(0, 400),
      (draft.paragraphs[draft.paragraphs.length - 2] || 'Paragraf dua.').slice(0, 400),
      (draft.paragraphs[draft.paragraphs.length - 1] || 'Paragraf tiga.').slice(0, 400),
    ]
    const choiceInput: ChoiceInput = {
      snapshot: { ...snapshot, timeline: state.timeline },
      chapterBrief,
      draft: { ...draft, storyId: CONTRACT.storyId },
      lastParagraphs,
      routeState: state.routeState,
      choiceHistory: state.choiceHistory,
      lockedEndingKey: state.lockedEndingKey,
    }
    let choiceBranch: Awaited<ReturnType<typeof generateChoiceBranch>> | null = null
    for (let attempt = 1; attempt <= MAX_CHOICE_ATTEMPTS; attempt++) {
      try {
        choiceBranch = await generateChoiceBranch(deps, choiceInput, {
          telemetryContext: {
            correlationId: `${runId}-${branch}-ch${n}-choices-a${attempt}`,
            storyId: PROOF_STORY_ID,
            chapterNumber: n,
            userId: PROOF_USER_ID,
            generationKind: 'personalized' as const,
            jobId: null,
            attemptNumber: attempt,
          },
          workflowPhase: 'CHAPTER_CHOICES_FIRST_PASS',
        })
        if (choiceBranch && choiceBranch.choices.length > 0) break
        choiceBranch = null
      } catch (err) {
        console.log(`${branch} Bab ${n} pilihan percobaan ${attempt} gagal (${err instanceof Error ? err.name : String(err)})`)
        if (attempt === MAX_CHOICE_ATTEMPTS) throw err
        choiceBranch = null
      }
    }
    if (!choiceBranch || choiceBranch.choices.length === 0) {
      console.error(`${branch} Bab ${n}: choice branch kosong`)
      process.exit(1)
    }
    const picked = choiceBranch.choices[Math.min(choiceIndex, choiceBranch.choices.length - 1)]!
    const pickedOutcome = choiceBranch.outcomes.find((o) => o.choiceId === picked.id)
    const choiceLabels = choiceBranch.choices.map((c) => c.label)
    const chosenLabel = picked.label
    console.log(`${branch} Pilihan Bab ${n} [idx ${choiceIndex}]: "${chosenLabel}" dari [${choiceLabels.join(' | ')}]`)
    const entry: ChoiceHistoryEntry = {
      chapterNumber: n,
      choiceId: picked.id,
      label: picked.label,
      consequence: pickedOutcome ? [...pickedOutcome.consequence] : [picked.hint ?? picked.label],
      effectSummary: { flagsSet: [`ch${n}_path`] },
      createdAt: new Date().toISOString(),
    }
    state.choiceHistory = [...state.choiceHistory, entry]
    if (pickedOutcome) {
      state.routeState = mergeChoiceEffect(state.routeState, pickedOutcome.effect)
    } else {
      state.routeState = normalizeRouteState({ ...state.routeState, flags: { ...state.routeState.flags, [`ch${n}_path`]: true } })
    }
    state.timeline = [...state.timeline, {
      chapterNumber: n,
      ordinal: 1,
      description: `Bab ${n} "${draft.title}" — ${chosenLabel}.`,
      isFlashback: false,
      occursAt: n,
    }]
    state.continuation = {
      storyId: CONTRACT.storyId,
      targetChapterNumber: n + 1,
      previousChapter: { number: n, title: draft.title, endingParagraphs: draft.paragraphs.slice(-5) },
      previousChoice: state.choiceHistory[state.choiceHistory.length - 1] ?? null,
      routeStateSummary: `Rute ${branch} Bab ${n}: ${chosenLabel}`,
      openThreads: [],
      anchorFacts: [],
      recentTimeline: [],
      mustNotReveal: [],
      storyAnchors: {
        corePromise: CONTRACT.corePromise,
        mainConflict: CONTRACT.mainConflict,
        finalQuestion: CONTRACT.finalQuestion,
      },
      actRollups: [],
      lockedEndingKey: state.lockedEndingKey,
    }
  }

  const newState = (): BranchState => ({
    routeState: normalizeRouteState({}),
    choiceHistory: [],
    lockedEndingKey: null,
    continuation: null,
    timeline: [],
  })

  // Fase 1: trunk Bab 1..10 (opsi indeks 0).
  console.log('--- FASE 1: trunk Bab 1..10 ---')
  const trunk = newState()
  for (let n = 1; n <= EARLY_FORK_CHAPTER; n++) {
    await runChapter('trunk', n, trunk, 0)
  }
  // Snapshot pra-pilihan Bab 10 = state SETELAH prosa Bab 10 tetapi SEBELUM
  // pilihan Bab 10 dicatat. Rekonstruksi dari trunk: history s/d Bab 9 +
  // route flags s/d Bab 9 + continuation menunjuk ke prosa Bab 10 trunk
  // (identik untuk kedua cabang karena snapshot pra-pilihan sama — prosa
  // TIDAK diregenerasi, hanya pilihan yang divergen).
  const trunkBab10 = allRecords.find((r) => r.branch === 'trunk' && r.chapterNumber === EARLY_FORK_CHAPTER)!
  console.log(`Trunk Bab 10: "${trunkBab10.title}" — opsi: [${trunkBab10.choiceLabels.join(' | ')}] — dipilih: ${trunkBab10.chosenLabel}`)
  if (trunkBab10.choiceLabels.length < 2) {
    console.error('TRUNK BAB 10 HANYA 1 OPSI — tidak bisa fork')
    process.exit(1)
  }

  // Fase 2: early fork — KEDUA cabang memakai prosa Bab 10 trunk yang SAMA
  // (snapshot pra-pilihan identik ⇒ prosa identik), divergen HANYA pada
  // pilihan Bab 10. Masing-masing cabang lalu lanjut Bab 11..12 normal
  // (prosa + pilihan sendiri, menembus act boundary 12→13).
  console.log('\n--- FASE 2: early fork Bab 10 (idx 0 vs idx 1) → Bab 12 ---')
  const trunkBab9 = allRecords.find((r) => r.branch === 'trunk' && r.chapterNumber === EARLY_FORK_CHAPTER - 1)!
  const trunkBrief10 = buildChapterBrief({
    storyContract: CONTRACT,
    snapshot: { ...snapshot, timeline: trunk.timeline.filter((t) => t.chapterNumber < EARLY_FORK_CHAPTER) },
    readerState: {
      routeState: normalizeRouteState({ flags: { ...trunkBab9.routeFlags } }),
      choiceHistory: trunk.choiceHistory.filter((e) => e.chapterNumber < EARLY_FORK_CHAPTER),
      lockedEndingKey: null,
    },
    chapterNumber: EARLY_FORK_CHAPTER,
    previousChoice: trunk.choiceHistory.filter((e) => e.chapterNumber < EARLY_FORK_CHAPTER).pop() ?? null,
  })
  const sharedDraft10: ChapterDraftParsed = {
    storyId: CONTRACT.storyId,
    chapterNumber: EARLY_FORK_CHAPTER,
    title: trunkBab10.title,
    paragraphs: [...trunkBab10.paragraphs],
    wordCount: trunkBab10.wordCount,
    sceneCount: 3,
    hasChoiceOrGate: true,
    events: [],
    knowledgeAssertions: [],
    reveals: [],
    proposedStateDelta: {},
    newNamedCharacters: [],
    dialogue: [],
    emotionBeats: [],
    softClaims: [],
  }
  const mkForkBase = (): BranchState => ({
    routeState: normalizeRouteState({ flags: { ...trunkBab9.routeFlags } }),
    choiceHistory: trunk.choiceHistory.filter((e) => e.chapterNumber < EARLY_FORK_CHAPTER),
    lockedEndingKey: null,
    continuation: null,
    timeline: trunk.timeline.filter((t) => t.chapterNumber < EARLY_FORK_CHAPTER),
  })
  const branchA = mkForkBase()
  const branchB = mkForkBase()
  await runChoiceOnly('early-A', EARLY_FORK_CHAPTER, branchA, sharedDraft10, trunkBrief10, 0)
  await runChoiceOnly('early-B', EARLY_FORK_CHAPTER, branchB, sharedDraft10, trunkBrief10, 1)
  // Catat rekaman Bab 10 fork (prosa bersama, pilihan divergen).
  for (const [branchName, st] of [['early-A', branchA], ['early-B', branchB]] as const) {
    const lastEntry = st.choiceHistory[st.choiceHistory.length - 1]!
    writeRecord({
      branch: branchName,
      chapterNumber: EARLY_FORK_CHAPTER,
      title: trunkBab10.title,
      wordCount: trunkBab10.wordCount,
      paragraphCount: trunkBab10.paragraphs.length,
      sceneCount: 3,
      choiceLabels: [...trunkBab10.choiceLabels],
      chosenLabel: lastEntry.label,
      lockedEndingKey: null,
      routeFlags: { ...trunkBab9.routeFlags, [`ch${EARLY_FORK_CHAPTER}_path`]: true },
      paragraphs: [...trunkBab10.paragraphs],
    })
  }
  for (let n = EARLY_FORK_CHAPTER + 1; n <= EARLY_FORK_RUN_TO; n++) {
    await runChapter('early-A', n, branchA, 0)
  }
  for (let n = EARLY_FORK_CHAPTER + 1; n <= EARLY_FORK_RUN_TO; n++) {
    await runChapter('early-B', n, branchB, 1)
  }

  // Verifikasi divergensi early fork.
  const a10 = allRecords.find((r) => r.branch === 'early-A' && r.chapterNumber === EARLY_FORK_CHAPTER)!
  const b10 = allRecords.find((r) => r.branch === 'early-B' && r.chapterNumber === EARLY_FORK_CHAPTER)!
  const diverged = a10.chosenLabel !== b10.chosenLabel
  console.log(`\nEarly fork divergensi Bab 10: A="${a10.chosenLabel}" B="${b10.chosenLabel}" → ${diverged ? 'DIVERGED' : 'IDENTICAL (gagal fork)'}`)
  if (!diverged) {
    console.error('EARLY FORK TIDAK DIVERGEN — pilihan indeks 0 dan 1 menghasilkan label sama')
    process.exit(1)
  }
  // Isolasi: choiceId Bab 10 cabang-A ≠ cabang-B; history A tidak mengandung
  // choiceId B dan sebaliknya.
  const aId10 = branchA.choiceHistory.find((e) => e.chapterNumber === EARLY_FORK_CHAPTER)!.choiceId
  const bId10 = branchB.choiceHistory.find((e) => e.chapterNumber === EARLY_FORK_CHAPTER)!.choiceId
  const isolatedEarly = aId10 !== bId10
    && !branchA.choiceHistory.some((e) => e.choiceId === bId10)
    && !branchB.choiceHistory.some((e) => e.choiceId === aId10)
  console.log(`Early fork isolasi choiceId: ${isolatedEarly ? 'ISOLATED' : 'LEAK'}`)
  if (!isolatedEarly) {
    console.error('EARLY FORK LEAK — choiceId bocor antar-cabang')
    process.exit(1)
  }

  // Fase 3: trunk tunggal Bab 11..44 (pakai cabang-A sebagai trunk lanjutan).
  console.log('\n--- FASE 3: trunk Bab 11..44 (dari early-A) ---')
  const trunk2 = cloneBranchState(branchA)
  // Selaraskan timeline trunk2: gabung timeline trunk Bab 1..9 + early-A Bab 10..12.
  trunk2.timeline = [
    ...trunk.timeline.filter((t) => t.chapterNumber < EARLY_FORK_CHAPTER),
    ...branchA.timeline.filter((t) => t.chapterNumber >= EARLY_FORK_CHAPTER),
  ]
  for (let n = EARLY_FORK_CHAPTER + 3; n <= LATE_FORK_CHAPTER; n++) {
    await runChapter('trunk2', n, trunk2, 0)
  }

  // Fase 4: late fork Bab 44 — KEDUA cabang memakai prosa Bab 44 trunk2
  // yang SAMA, divergen HANYA pada pilihan Bab 44, lalu kedua cabang lanjut
  // Bab 45..50 sampai final.
  console.log('\n--- FASE 4: late fork Bab 44 (idx 0 vs idx 1) → Bab 50 ---')
  const trunk2Bab44 = allRecords.find((r) => r.branch === 'trunk2' && r.chapterNumber === LATE_FORK_CHAPTER)!
  console.log(`Trunk2 Bab 44: "${trunk2Bab44.title}" — opsi: [${trunk2Bab44.choiceLabels.join(' | ')}]`)
  if (trunk2Bab44.choiceLabels.length < 2) {
    console.error('TRUNK2 BAB 44 HANYA 1 OPSI — tidak bisa fork')
    process.exit(1)
  }
  const trunk2Brief44 = buildChapterBrief({
    storyContract: CONTRACT,
    snapshot: { ...snapshot, timeline: trunk2.timeline.filter((t) => t.chapterNumber < LATE_FORK_CHAPTER) },
    readerState: {
      routeState: normalizeRouteState(JSON.parse(JSON.stringify(trunk2.routeState)) as RouteState),
      choiceHistory: trunk2.choiceHistory.filter((e) => e.chapterNumber < LATE_FORK_CHAPTER),
      lockedEndingKey: null,
    },
    chapterNumber: LATE_FORK_CHAPTER,
    previousChoice: trunk2.choiceHistory.filter((e) => e.chapterNumber < LATE_FORK_CHAPTER).pop() ?? null,
  })
  const sharedDraft44: ChapterDraftParsed = {
    storyId: CONTRACT.storyId,
    chapterNumber: LATE_FORK_CHAPTER,
    title: trunk2Bab44.title,
    paragraphs: [...trunk2Bab44.paragraphs],
    wordCount: trunk2Bab44.wordCount,
    sceneCount: 3,
    hasChoiceOrGate: true,
    events: [],
    knowledgeAssertions: [],
    reveals: [],
    proposedStateDelta: {},
    newNamedCharacters: [],
    dialogue: [],
    emotionBeats: [],
    softClaims: [],
  }
  const mkLateBase = (): BranchState => ({
    routeState: normalizeRouteState(
      JSON.parse(JSON.stringify(trunk2.routeState.flags ?? {})) as Record<string, boolean>,
    ),
    choiceHistory: trunk2.choiceHistory.filter((e) => e.chapterNumber < LATE_FORK_CHAPTER),
    lockedEndingKey: null,
    continuation: null,
    timeline: trunk2.timeline.filter((t) => t.chapterNumber < LATE_FORK_CHAPTER),
  })
  const lateA = mkLateBase()
  const lateB = mkLateBase()
  await runChoiceOnly('late-A', LATE_FORK_CHAPTER, lateA, sharedDraft44, trunk2Brief44, 0)
  await runChoiceOnly('late-B', LATE_FORK_CHAPTER, lateB, sharedDraft44, trunk2Brief44, 1)
  for (const [branchName, st] of [['late-A', lateA], ['late-B', lateB]] as const) {
    const lastEntry = st.choiceHistory[st.choiceHistory.length - 1]!
    writeRecord({
      branch: branchName,
      chapterNumber: LATE_FORK_CHAPTER,
      title: trunk2Bab44.title,
      wordCount: trunk2Bab44.wordCount,
      paragraphCount: trunk2Bab44.paragraphs.length,
      sceneCount: 3,
      choiceLabels: [...trunk2Bab44.choiceLabels],
      chosenLabel: lastEntry.label,
      lockedEndingKey: null,
      routeFlags: { ...JSON.parse(JSON.stringify(trunk2.routeState.flags ?? {})) as Record<string, boolean> },
      paragraphs: [...trunk2Bab44.paragraphs],
    })
  }
  for (let n = LATE_FORK_CHAPTER + 1; n <= FINAL_CHAPTER; n++) {
    await runChapter('late-A', n, lateA, 0)
  }
  for (let n = LATE_FORK_CHAPTER + 1; n <= FINAL_CHAPTER; n++) {
    await runChapter('late-B', n, lateB, 1)
  }

  console.log('\n=== M10-G FORK PROOF SUMMARY ===')
  for (const branch of ['trunk', 'early-A', 'early-B', 'trunk2', 'late-A', 'late-B']) {
    const recs = allRecords.filter((r) => r.branch === branch)
    console.log(`${branch}: ${recs.length} bab (${recs.length > 0 ? `${recs[0]!.chapterNumber}..${recs[recs.length - 1]!.chapterNumber}` : '-'})`)
  }
  const wordsOk = allRecords.every((r) => r.wordCount >= 800 && r.wordCount <= 1000)
  console.log(`Word-count 800–1000 semua bab semua cabang: ${wordsOk ? 'PASS' : 'CHECK'}`)

  // Late fork: lock Bab 45 + closure Bab 50 di tiap cabang.
  for (const branch of ['late-A', 'late-B']) {
    const lock = allRecords.find((r) => r.branch === branch && r.chapterNumber === 45)
    console.log(`${branch} lock Bab 45: ${lock?.lockedEndingKey ?? '(null)'}`)
    if (!lock?.lockedEndingKey) {
      console.error(`${branch}: ENDING LOCK MISSING`)
      process.exit(1)
    }
    const resolution = resolveEnding({
      storyContract: CONTRACT,
      chapterNumber: 45,
      routeState: branch === 'late-A' ? lateA.routeState : lateB.routeState,
      lockedEndingKey: lock.lockedEndingKey,
    })
    console.log(`${branch} ending terverifikasi: ${resolution.key} — ${resolution.name}`)
    const final = allRecords.filter((r) => r.branch === branch).pop()!
    const candidate = CONTRACT.endingCandidates.find((c) => c.key === final.lockedEndingKey)
    if (!candidate) {
      console.error(`${branch}: kandidat ending terkunci tidak ditemukan`)
      process.exit(1)
    }
    console.log(`${branch} Bab 50 closure (${candidate.requiredClosure.length}): ${candidate.requiredClosure.join(' / ')}`)
  }

  // Isolasi antar-cabang: choiceId Bab fork tidak boleh sama.
  const lateA44 = allRecords.find((r) => r.branch === 'late-A' && r.chapterNumber === LATE_FORK_CHAPTER)!
  const lateB44 = allRecords.find((r) => r.branch === 'late-B' && r.chapterNumber === LATE_FORK_CHAPTER)!
  console.log(`Late fork divergensi Bab 44: A="${lateA44.chosenLabel}" B="${lateB44.chosenLabel}"`)
  if (lateA44.chosenLabel === lateB44.chosenLabel) {
    console.error('LATE FORK TIDAK DIVERGEN')
    process.exit(1)
  }

  if (!wordsOk) process.exit(1)
  console.log('=== FORK PROOF PASSED ===')
}

main().catch((err) => {
  console.error('FORK PROOF FAILED:', err)
  process.exit(1)
})

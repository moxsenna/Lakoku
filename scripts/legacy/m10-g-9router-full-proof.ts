/**
 * M10-G 9Router VPS full proof runner — Bab 1..50, in-memory, zero DB.
 *
 * Perluasan runner staged (`m10-g-9router-staged-proof.ts`) yang menutup 6 celah:
 *   1. Bab 1 nyata (previousChapter null, previousChoice null, brief dari kontrak).
 *   2. Blueprint per bab dari `chapterTargets` kontrak nadia-raka.
 *   3. Akumulasi state: choiceHistory (maks 49), routeState berevolusi, timeline.
 *   4. Ending lock: lockedEndingKey diteruskan antarbab, diverifikasi di Bab 45.
 *   5. Bab 50 tanpa pilihan; verifikasi closure ending kandidat terkunci.
 *   6. `--chapters` s/d 50.
 *
 * Checkpoint JSONL per bab + `--resume=<path>` agar run 30+ menit tidak mengulang
 * dari Bab 1 bila bab akhir gagal. Tidak ada tulis ke DB (kredensial di-strip).
 *
 * Otorisasi: JANGAN jalankan tanpa otorisasi inferensi produksi eksplisit.
 * Script menolak berjalan kecuali `M10G_FULL_PROOF_AUTHORIZED=1`.
 *
 * Jalankan:
 *   node scripts/run-smoke.cjs scripts/m10-g-9router-full-proof.ts --chapters=10
 *   node scripts/run-smoke.cjs scripts/m10-g-9router-full-proof.ts --chapters=50 --checkpoint=/tmp/full-proof.jsonl
 *   node scripts/run-smoke.cjs scripts/m10-g-9router-full-proof.ts --resume=/tmp/full-proof.jsonl --chapters=50
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
  NADIA_RAKA_STORY_ID,
  nadiaRakaSnapshot,
} from '../fixtures/narrative/nadia-raka-continuity'
import {
  SINTA_BAGAS_STORY_ID,
  sintaBagasSnapshot,
} from '../fixtures/narrative/sinta-bagas-continuity'
import {
  KIRANA_GILANG_STORY_ID,
  kiranaGilangSnapshot,
} from '../fixtures/narrative/kirana-gilang-continuity'
import { stripDbCredentials, assertNoDbCredentials } from './smoke-db-isolation'
import { normalizeRouteState, mergeChoiceEffect, type RouteState } from '../lib/story-engine/route-state'
import { buildChapterBrief, type ChoiceHistoryEntry } from '../lib/story-engine/chapter-brief'
import { buildPreProseChapterBrief } from '../lib/story-engine/pre-prose-brief'
import { resolveEnding } from '../lib/story-engine/ending-resolver'
import { nadiaRakaContract } from '../fixtures/contracts/nadia-raka'
import { sintaBagasContract } from '../fixtures/contracts/sinta-bagas'
import { kiranaGilangContract } from '../fixtures/contracts/kirana-gilang'
import type { StoryContract } from '../lib/story-engine/story-contract'
import type { LastParagraphs } from '../lib/ai-gateway/provider'
import type { ContinuationContext } from '../lib/narrative/continuation-context'
import type { CanonSnapshot, ChapterBlueprint } from '../lib/narrative/types'

const MAX_PROSE_ATTEMPTS = 5
const MAX_CHOICE_ATTEMPTS = 3
const PROOF_USER_ID = '00000000-0000-4000-8000-00000000ab01'

interface FullProofCheckpoint {
  chapterNumber: number
  title: string
  wordCount: number
  paragraphCount: number
  sceneCount: number
  proseSeconds: number
  choiceSeconds: number
  paragraphs: string[]
  choicePrompt: string | null
  choiceLabels: string[]
  chosenLabel: string | null
  chosenConsequence: string[]
  lockedEndingKey: string | null
  routeFlags: Record<string, boolean>
}

let ACTIVE_CONTRACT: StoryContract = nadiaRakaContract
let ACTIVE_PROOF_STORY_ID: string = NADIA_RAKA_STORY_ID

function argValue(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? (arg.split('=').slice(1).join('=') ?? null) : null
}

function parseChapters(): number {
  const raw = argValue('chapters') ?? '10'
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new Error(`M10G_FULL_PROOF_CHAPTERS_INVALID:${raw}`)
  }
  return n
}

const CONTRACTS = {
  'nadia-raka': {
    contract: nadiaRakaContract,
    snapshot: nadiaRakaSnapshot,
    proofStoryId: NADIA_RAKA_STORY_ID,
  },
  'sinta-bagas': {
    contract: sintaBagasContract,
    snapshot: sintaBagasSnapshot,
    proofStoryId: SINTA_BAGAS_STORY_ID,
  },
  'kirana-gilang': {
    contract: kiranaGilangContract,
    snapshot: kiranaGilangSnapshot,
    proofStoryId: KIRANA_GILANG_STORY_ID,
  },
} as const

type ContractKey = keyof typeof CONTRACTS

function parseContract(): ContractKey {
  const raw = argValue('contract') ?? 'nadia-raka'
  if (!(raw in CONTRACTS)) {
    throw new Error(`M10G_FULL_PROOF_CONTRACT_INVALID:${raw}`)
  }
  return raw as ContractKey
}

function snapshotWithBlueprints(contract: StoryContract): CanonSnapshot {
  const snapshot = contract.storyId === sintaBagasContract.storyId
    ? sintaBagasSnapshot(contract.storyId)
    : nadiaRakaSnapshot(contract.storyId)
  snapshot.blueprints = contract.actPlan.flatMap((act) =>
    contract.chapterTargets
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
  snapshot.secrets = contract.revealRunway.map((reveal) => ({
    id: reveal.secretId,
    description: `Rahasia ${reveal.secretId}`,
    revealGateChapter: reveal.revealGateChapter,
    revealed: false,
  }))
  return snapshot
}

function blueprintForChapter(snapshot: CanonSnapshot, n: number): ChapterBlueprint {
  const blueprint = snapshot.blueprints.find((b) => b.chapterNumber === n)
  if (!blueprint) throw new Error(`M10G_FULL_PROOF_BLUEPRINT_MISSING:${n}`)
  return blueprint
}

function readCheckpoints(resumePath: string): FullProofCheckpoint[] {
  const content = fs.readFileSync(resumePath, 'utf8')
  const records: FullProofCheckpoint[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    records.push(JSON.parse(trimmed) as FullProofCheckpoint)
  }
  records.sort((a, b) => a.chapterNumber - b.chapterNumber)
  return records
}

function writeCheckpoint(checkpointPath: string, record: FullProofCheckpoint): void {
  fs.appendFileSync(checkpointPath, `${JSON.stringify(record)}\n`, 'utf8')
}

async function main() {
  if (process.env.M10G_FULL_PROOF_AUTHORIZED !== '1') {
    throw new Error(
      'M10G_FULL_PROOF_AUTHORIZATION_REQUIRED:'
      + ' set M10G_FULL_PROOF_AUTHORIZED=1 with explicit production inference authorization',
    )
  }

  const lastChapter = parseChapters()
  const contractKey = parseContract()
  ACTIVE_CONTRACT = CONTRACTS[contractKey].contract
  ACTIVE_PROOF_STORY_ID = CONTRACTS[contractKey].proofStoryId
  console.log(`Kontrak: ${contractKey} (${ACTIVE_CONTRACT.storyId})`)
  const checkpointPath = argValue('checkpoint')
  const resumePath = argValue('resume')
  console.log(`--- M10-G 9Router VPS Full Proof (Bab 1..${lastChapter}) ---`)

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
  console.log('DB isolation: credentials stripped, zero DB writes enforced')

  const baseUrl = process.env.NINEROUTER_BASE_URL
  const apiKey = process.env.NINEROUTER_API_KEY
  if (!baseUrl || !apiKey) throw new Error('MISSING_NINEROUTER_CREDENTIALS')
  console.log('Provider endpoint:', baseUrl)

  const authority = assertM10GG1RouteAuthority(M10_G_G1_9ROUTER_ROUTE_AUTHORITY)
  const writerRoute = toAiModelRoute(authority, 'writer')
  const choicesRoute = toAiModelRoute(authority, 'choice')
  const judgeRoute = toAiModelRoute(authority, 'continuity')
  console.log('Frozen routes:', {
    writer: `${writerRoute.provider}:${writerRoute.modelId}`,
    choices: `${choicesRoute.provider}:${choicesRoute.modelId}`,
    judge: `${judgeRoute.provider}:${judgeRoute.modelId}`,
  })

  const provider = createProviderFromExactRoutes({
    writerRoute,
    choicesRoute,
    judgeRoute,
    generationPolicy: { targetWordsMin: 800, targetWordsMax: 1000, targetScenes: 3 },
  })
  const deps = { provider }

  const runId = `full-9router-${Date.now()}`
  const snapshot = snapshotWithBlueprints(ACTIVE_CONTRACT)

  // State akumulatif antarbab.
  let routeState: RouteState = normalizeRouteState({})
  let choiceHistory: ChoiceHistoryEntry[] = []
  let lockedEndingKey: string | null = null
  let continuation: ContinuationContext | null = null
  const records: FullProofCheckpoint[] = []

  // Resume: bangun ulang state dari checkpoint.
  let startChapter = 1
  if (resumePath) {
    const prior = readCheckpoints(resumePath)
    for (const record of prior) {
      if (record.chapterNumber > lastChapter) break
      records.push(record)
      snapshot.timeline.push({
        chapterNumber: record.chapterNumber,
        ordinal: 1,
        description: `Bab ${record.chapterNumber} "${record.title}" — ${record.chosenLabel ?? 'tanpa pilihan'}.`,
        isFlashback: false,
        occursAt: record.chapterNumber,
      })
      routeState = normalizeRouteState({ ...routeState, flags: { ...routeState.flags, ...record.routeFlags } })
      if (record.chapterNumber < 50 && record.chosenLabel) {
        choiceHistory.push({
          chapterNumber: record.chapterNumber,
          choiceId: `resume-ch${record.chapterNumber}`,
          label: record.chosenLabel,
          consequence: record.chosenConsequence.length > 0 ? [...record.chosenConsequence] : [record.chosenLabel],
          effectSummary: { flagsSet: [`ch${record.chapterNumber}_path`] },
          createdAt: new Date().toISOString(),
        })
      }
      if (record.lockedEndingKey) lockedEndingKey = record.lockedEndingKey
      continuation = {
        storyId: ACTIVE_CONTRACT.storyId,
        targetChapterNumber: record.chapterNumber + 1,
        previousChapter: {
          number: record.chapterNumber,
          title: record.title,
          endingParagraphs: record.paragraphs.slice(-5),
        },
        previousChoice: record.chapterNumber < 50 && record.chosenLabel
          ? choiceHistory[choiceHistory.length - 1] ?? null
          : null,
        routeStateSummary: `Rute Bab ${record.chapterNumber}: ${record.chosenLabel ?? '-'}`,
        openThreads: [],
        anchorFacts: [],
        recentTimeline: [],
        mustNotReveal: [],
        storyAnchors: {
          corePromise: ACTIVE_CONTRACT.corePromise,
          mainConflict: ACTIVE_CONTRACT.mainConflict,
          finalQuestion: ACTIVE_CONTRACT.finalQuestion,
        },
        actRollups: [],
        lockedEndingKey,
      }
    }
    startChapter = (prior.length > 0 ? prior[prior.length - 1]!.chapterNumber : 0) + 1
    console.log(`Resume dari ${resumePath}: ${prior.length} bab, lanjut Bab ${startChapter}`)
  }

  for (let n = startChapter; n <= lastChapter; n++) {
    console.log(`\n===== [Bab ${n}/${lastChapter}] Prosa =====`)
    const isFirst = n === 1
    if (!isFirst && !continuation) throw new Error(`M10G_FULL_PROOF_CONTINUATION_MISSING:${n}`)
    if (!isFirst) continuation = { ...continuation!, storyId: ACTIVE_CONTRACT.storyId, targetChapterNumber: n }

    const blueprint = blueprintForChapter(snapshot, n)
    const chapterBrief = buildChapterBrief({
      storyContract: ACTIVE_CONTRACT,
      snapshot,
      readerState: { routeState, choiceHistory, lockedEndingKey },
      chapterNumber: n,
      previousChoice: continuation?.previousChoice ?? null,
    })
    if (chapterBrief.lockedEndingKey !== lockedEndingKey) {
      lockedEndingKey = chapterBrief.lockedEndingKey
      console.log(`Bab ${n}: lockedEndingKey → ${lockedEndingKey ?? '(null)'}`)
    }
    const preProseBrief = buildPreProseChapterBrief({
      storyId: ACTIVE_CONTRACT.storyId,
      chapterNumber: n,
      snapshot,
      blueprint,
      continuation,
      chapterBrief,
    })

    let chapterResult: Awaited<ReturnType<typeof generateChapter>> | null = null
    let proseSeconds = 0
    for (let attempt = 1; attempt <= MAX_PROSE_ATTEMPTS; attempt++) {
      if (attempt > 1) console.log(`Bab ${n}: percobaan prosa ${attempt}/${MAX_PROSE_ATTEMPTS}...`)
      const proseStart = Date.now()
      try {
        chapterResult = await generateChapter(deps, {
          snapshot,
          blueprint,
          chapterNumber: n,
          continuation,
          brief: preProseBrief,
          executionOptions: {
            telemetryContext: {
              correlationId: `${runId}-ch${n}-a${attempt}`,
              storyId: ACTIVE_PROOF_STORY_ID,
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
        proseSeconds = Number((((Date.now() - proseStart) / 1000).toFixed(1)))
        if (chapterResult.status === 'PUBLISHED' && chapterResult.draft) break
        console.log(`Bab ${n} percobaan ${attempt}: ${chapterResult.status} — ${chapterResult.reason ?? ''}`)
        chapterResult = null
      } catch (err) {
        proseSeconds = Number((((Date.now() - proseStart) / 1000).toFixed(1)))
        const code = err instanceof Error ? err.name : String(err)
        console.log(`Bab ${n} percobaan ${attempt} gagal (${code}, ${proseSeconds}s)`)
        if (attempt === MAX_PROSE_ATTEMPTS) throw err
        chapterResult = null
      }
    }

    if (!chapterResult || chapterResult.status !== 'PUBLISHED' || !chapterResult.draft) {
      console.error(`Bab ${n} FAILED setelah ${MAX_PROSE_ATTEMPTS} percobaan`)
      process.exit(1)
    }
    const draft = chapterResult.draft
    console.log(`Bab ${n} PUBLISHED: "${draft.title}" — ${draft.wordCount} kata, ${draft.paragraphs.length} paragraf, ${draft.sceneCount} scenes, ${proseSeconds}s`)

    // Pilihan pembaca (Bab 50: tidak ada pilihan).
    let choicePrompt: string | null = null
    let choiceLabels: string[] = []
    let chosenLabel: string | null = null
    let chosenConsequence: string[] = []
    let choiceSeconds = 0
    if (n < 50) {
      console.log(`\n----- [Bab ${n}/${lastChapter}] Pilihan -----`)
      const lastParagraphs: LastParagraphs = [
        (draft.paragraphs[draft.paragraphs.length - 3] || 'Paragraf satu.').slice(0, 400),
        (draft.paragraphs[draft.paragraphs.length - 2] || 'Paragraf dua.').slice(0, 400),
        (draft.paragraphs[draft.paragraphs.length - 1] || 'Paragraf tiga.').slice(0, 400),
      ]
      const choiceInput: ChoiceInput = {
        snapshot,
        chapterBrief,
        draft: { ...draft, storyId: ACTIVE_CONTRACT.storyId },
        lastParagraphs,
        routeState,
        choiceHistory,
        lockedEndingKey,
      }
      const choiceStart = Date.now()
      let choiceBranch: Awaited<ReturnType<typeof generateChoiceBranch>> | null = null
      for (let attempt = 1; attempt <= MAX_CHOICE_ATTEMPTS; attempt++) {
        if (attempt > 1) console.log(`Bab ${n}: percobaan pilihan ${attempt}/${MAX_CHOICE_ATTEMPTS}...`)
        try {
          choiceBranch = await generateChoiceBranch(deps, choiceInput, {
            telemetryContext: {
              correlationId: `${runId}-ch${n}-choices-a${attempt}`,
              storyId: ACTIVE_PROOF_STORY_ID,
              chapterNumber: n,
              userId: PROOF_USER_ID,
              generationKind: 'personalized' as const,
              jobId: null,
              attemptNumber: attempt,
            },
            workflowPhase: 'CHAPTER_CHOICES_FIRST_PASS',
          })
          if (choiceBranch && choiceBranch.choices.length > 0) break
          console.log(`Bab ${n} pilihan percobaan ${attempt}: branch kosong`)
          choiceBranch = null
        } catch (err) {
          const code = err instanceof Error ? err.name : String(err)
          console.log(`Bab ${n} pilihan percobaan ${attempt} gagal (${code})`)
          if (attempt === MAX_CHOICE_ATTEMPTS) throw err
          choiceBranch = null
        }
      }
      choiceSeconds = Number((((Date.now() - choiceStart) / 1000).toFixed(1)))
      if (!choiceBranch || choiceBranch.choices.length === 0) {
        console.error(`Bab ${n}: choice branch kosong`)
        process.exit(1)
      }
      const first = choiceBranch.choices[0]!
      const firstOutcome = choiceBranch.outcomes.find((o) => o.choiceId === first.id)
      choicePrompt = choiceBranch.choicePrompt
      choiceLabels = choiceBranch.choices.map((c) => c.label)
      chosenLabel = first.label
      chosenConsequence = firstOutcome ? [...firstOutcome.consequence] : [first.hint ?? first.label]
      console.log(`Pilihan Bab ${n}: "${choicePrompt}" → [${choiceLabels.join(' | ')}] (${choiceSeconds}s)`)

      const entry: ChoiceHistoryEntry = {
        chapterNumber: n,
        choiceId: first.id,
        label: first.label,
        consequence: chosenConsequence,
        effectSummary: { flagsSet: [`ch${n}_path`] },
        createdAt: new Date().toISOString(),
      }
      choiceHistory = [...choiceHistory, entry]
      if (firstOutcome) {
        routeState = mergeChoiceEffect(routeState, firstOutcome.effect)
      } else {
        routeState = normalizeRouteState({ ...routeState, flags: { ...routeState.flags, [`ch${n}_path`]: true } })
      }
    } else {
      console.log(`Bab 50: tanpa pilihan (final). Verifikasi closure ending "${lockedEndingKey ?? '(belum terkunci)'}".`)
    }

    // Timeline kumulatif untuk konteks bab berikut.
    snapshot.timeline.push({
      chapterNumber: n,
      ordinal: 1,
      description: `Bab ${n} "${draft.title}" — ${chosenLabel ?? 'tanpa pilihan'}.`,
      isFlashback: false,
      occursAt: n,
    })

    const routeFlags: Record<string, boolean> = {}
    for (const [flag, value] of Object.entries(routeState.flags ?? {})) {
      if (value === true) routeFlags[flag] = true
    }
    const record: FullProofCheckpoint = {
      chapterNumber: n,
      title: draft.title,
      wordCount: draft.wordCount,
      paragraphCount: draft.paragraphs.length,
      sceneCount: draft.sceneCount,
      proseSeconds,
      choiceSeconds,
      paragraphs: [...draft.paragraphs],
      choicePrompt,
      choiceLabels,
      chosenLabel,
      chosenConsequence,
      lockedEndingKey,
      routeFlags,
    }
    records.push(record)
    if (checkpointPath) writeCheckpoint(checkpointPath, record)

    // Sambung rantai ke bab berikut.
    continuation = {
      storyId: ACTIVE_CONTRACT.storyId,
      targetChapterNumber: n + 1,
      previousChapter: {
        number: n,
        title: draft.title,
        endingParagraphs: draft.paragraphs.slice(-5),
      },
      previousChoice: n < 50 && chosenLabel ? choiceHistory[choiceHistory.length - 1] ?? null : null,
      routeStateSummary: `Rute Bab ${n}: ${chosenLabel ?? '-'}`,
      openThreads: [],
      anchorFacts: [],
      recentTimeline: [],
      mustNotReveal: [],
      storyAnchors: {
        corePromise: ACTIVE_CONTRACT.corePromise,
        mainConflict: ACTIVE_CONTRACT.mainConflict,
        finalQuestion: ACTIVE_CONTRACT.finalQuestion,
      },
      actRollups: [],
      lockedEndingKey,
    }
  }

  console.log('\n=== M10-G 9ROUTER FULL PROOF SUMMARY ===')
  for (const r of records) {
    console.log(`Bab ${r.chapterNumber}: "${r.title}" — ${r.wordCount} kata / ${r.paragraphCount} par / ${r.sceneCount} scenes — prosa ${r.proseSeconds}s, pilihan ${r.choiceSeconds}s — dipilih: ${r.chosenLabel ?? '-'}`)
  }
  const wordsOk = records.every((r) => r.wordCount >= 800 && r.wordCount <= 1000)
  console.log(`Word-count 800–1000 semua bab: ${wordsOk ? 'PASS' : 'CHECK'}`)

  // Verifikasi ending lock bila run mencapai/melewati Bab 45.
  if (lastChapter >= ACTIVE_CONTRACT.closureRunway.endingLockChapter) {
    const lockRecord = records.find((r) => r.chapterNumber === ACTIVE_CONTRACT.closureRunway.endingLockChapter)
    console.log(`Ending lock Bab ${ACTIVE_CONTRACT.closureRunway.endingLockChapter}: ${lockRecord?.lockedEndingKey ?? '(null)'}`)
    if (!lockRecord?.lockedEndingKey) {
      console.error('ENDING LOCK MISSING pada bab kunci')
      process.exit(1)
    }
    const resolution = resolveEnding({
      storyContract: ACTIVE_CONTRACT,
      chapterNumber: lockRecord.chapterNumber,
      routeState,
      lockedEndingKey: lockRecord.lockedEndingKey,
    })
    console.log(`Ending terverifikasi: ${resolution.key} — ${resolution.name}`)
  }
  if (lastChapter === 50) {
    const final = records[records.length - 1]!
    const candidate = ACTIVE_CONTRACT.endingCandidates.find((c) => c.key === final.lockedEndingKey)
    if (!candidate) {
      console.error('Bab 50 tanpa kandidat ending terkunci')
      process.exit(1)
    }
    console.log(`Bab 50 closure requirements (${candidate.requiredClosure.length}): ${candidate.requiredClosure.join(' / ')}`)
  }

  if (!wordsOk) process.exit(1)
  console.log('=== FULL PROOF PASSED ===')
}

main().catch((err) => {
  console.error('FULL PROOF FAILED:', err)
  process.exit(1)
})

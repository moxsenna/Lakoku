/**
 * M10-G 9Router VPS staged proof runner — multi-bab bertahap, in-memory, zero DB.
 *
 * Menjalankan Bab 2..N berurutan via otoritas rute beku 9Router:
 *   writer   = gweb/gemini-3.1-pro  (prosa + length-repair V1)
 *   choices  = gweb/gemini-3.8-flash (cabang pilihan)
 *
 * Setiap bab: generateChapter (prosa + validasi Lapis A/B/C) → generateChoiceBranch
 * → pilihan pertama dipakai sebagai previousChoice bab berikut (rantai kontinuitas).
 * Snapshot canon di-clone per bab; tidak ada tulis ke DB (kredensial DB di-strip).
 *
 * Jalankan:
 *   node scripts/run-smoke.cjs scripts/m10-g-9router-staged-proof.ts --chapters=3
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
  NADIA_RAKA_BLUEPRINT,
  NADIA_RAKA_BRIEF_A,
  NADIA_RAKA_CONTINUATION_A,
  NADIA_RAKA_STORY_ID,
  nadiaRakaSnapshot,
} from '../fixtures/narrative/nadia-raka-continuity'
import { stripDbCredentials, assertNoDbCredentials } from './smoke-db-isolation'
import { normalizeRouteState } from '../lib/story-engine/route-state'
import { buildChapterBrief } from '../lib/story-engine/chapter-brief'
import { nadiaRakaContract } from '../fixtures/contracts/nadia-raka'
import type { LastParagraphs } from '../lib/ai-gateway/provider'
import type { ContinuationContext } from '../lib/narrative/continuation-context'
import type { PreProseChapterBrief } from '../lib/story-engine/pre-prose-brief'
import type { ChapterBlueprint } from '../lib/narrative/types'

interface StagedChapterRecord {
  chapterNumber: number
  title: string
  wordCount: number
  paragraphCount: number
  sceneCount: number
  proseSeconds: number
  choiceSeconds: number
  choicePrompt: string
  choiceLabels: string[]
  chosenLabel: string
}

function parseChaptersArg(fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith('--chapters='))
  if (!arg) return fallback
  const n = Number(arg.split('=')[1])
  if (!Number.isInteger(n) || n < 2 || n > 5) {
    throw new Error(`M10G_STAGED_PROOF_CHAPTERS_INVALID:${arg}`)
  }
  return n
}

function blueprintForChapter(n: number): ChapterBlueprint {
  if (n === 2) return { ...NADIA_RAKA_BLUEPRINT }
  return {
    ...NADIA_RAKA_BLUEPRINT,
    chapterNumber: n,
    phase: n <= 10 ? 'Fase 2' : 'Fase 3',
    chapterGoal: `Lanjutkan akibat pilihan pembaca dari Bab ${n - 1} tanpa mereset konflik galeri`,
    mandatoryBeats: ['Sambung langsung dari paragraf akhir bab sebelumnya', 'Tunjukkan akibat pilihan pembaca'],
  }
}

function briefForChapter(n: number, continuation: ContinuationContext): PreProseChapterBrief {
  if (n === 2) return { ...NADIA_RAKA_BRIEF_A }
  return {
    ...NADIA_RAKA_BRIEF_A,
    chapterNumber: n,
    chapterGoal: `Lanjutkan akibat pilihan pembaca dari Bab ${n - 1}`,
    previousChoiceSummary: `Pilihan Bab ${n - 1}: ${continuation.previousChoice?.label ?? '-'}`,
    routeStateSummary: continuation.routeStateSummary,
    previousChoiceApplied: true,
  }
}

async function main() {
  const lastChapter = parseChaptersArg(3)
  console.log(`--- M10-G 9Router VPS Staged Proof (Bab 2..${lastChapter}) ---`)

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

  const runId = `staged-9router-${Date.now()}`
  const records: StagedChapterRecord[] = []

  // Rantai kontinuitas: mulai dari cabang A Bab 1→2, lalu sambung per bab.
  let continuation: ContinuationContext = { ...NADIA_RAKA_CONTINUATION_A }

  for (let n = 2; n <= lastChapter; n++) {
    console.log(`\n===== [Bab ${n}/${lastChapter}] Prosa =====`)
    continuation = { ...continuation, storyId: NADIA_RAKA_STORY_ID, targetChapterNumber: n }

    // Retry per-bab yang wajar: writer 9Router berfluktuasi (kadang over-length
    // >1000 kata). Produksi menolaknya secara fail-closed; runner proof mencoba
    // ulang dengan korelasi berbeda sebelum menyerah. Batas produksi tetap.
    const MAX_PROSE_ATTEMPTS = 5
    let chapterResult: Awaited<ReturnType<typeof generateChapter>> | null = null
    let proseSeconds = 0
    for (let attempt = 1; attempt <= MAX_PROSE_ATTEMPTS; attempt++) {
      if (attempt > 1) console.log(`Bab ${n}: percobaan prosa ${attempt}/${MAX_PROSE_ATTEMPTS}...`)
      const proseStart = Date.now()
      try {
        chapterResult = await generateChapter(deps, {
          snapshot: nadiaRakaSnapshot(),
          blueprint: blueprintForChapter(n),
          chapterNumber: n,
          continuation,
          brief: briefForChapter(n, continuation),
          executionOptions: {
            telemetryContext: {
              correlationId: `${runId}-ch${n}-a${attempt}`,
              storyId: NADIA_RAKA_STORY_ID,
              chapterNumber: n,
              userId: '00000000-0000-4000-8000-00000000ab01',
              generationKind: 'personalized' as const,
              jobId: null,
              attemptNumber: attempt,
            },
            workflowPhase: 'CHAPTER_PROSE_FIRST_PASS',
            writerLengthRepairV1: { enabled: true },
            observeWriterEvaluation: (evalResult: {
              completenessPassed: boolean
              completenessCodes: string[]
              wordCount: number
              paragraphCount?: number
            }) => {
              console.log(
                `   [eval] words=${evalResult.wordCount} pars=${evalResult.paragraphCount ?? '-'} ` +
                `passed=${evalResult.completenessPassed} codes=${evalResult.completenessCodes.join(',') || '-'}`,
              )
            },
            observeWriterLengthRepair: (telemetry: {
              firstPassOutcome?: string
              repairAttempted?: boolean
              repairOutcome?: string
            }) => {
              console.log(
                `   [repair] first=${telemetry.firstPassOutcome ?? '-'} ` +
                `attempted=${telemetry.repairAttempted ?? false} outcome=${telemetry.repairOutcome ?? '-'}`,
              )
            },
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

    // Pilihan pembaca (kecuali bab terakhir bila hanya prosa yang diuji).
    console.log(`\n----- [Bab ${n}/${lastChapter}] Pilihan -----`)
    // Batas skema: tiap paragraf penutup ≤400 karakter (ChoiceInputSchema).
    const lastParagraphs: LastParagraphs = [
      (draft.paragraphs[draft.paragraphs.length - 3] || 'Paragraf satu.').slice(0, 400),
      (draft.paragraphs[draft.paragraphs.length - 2] || 'Paragraf dua.').slice(0, 400),
      (draft.paragraphs[draft.paragraphs.length - 1] || 'Paragraf tiga.').slice(0, 400),
    ]

    const snapshot = nadiaRakaSnapshot(nadiaRakaContract.storyId)
    snapshot.blueprints = nadiaRakaContract.actPlan.flatMap((act) =>
      nadiaRakaContract.chapterTargets
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
    const chapterBrief = buildChapterBrief({
      storyContract: nadiaRakaContract,
      snapshot,
      readerState: { routeState: normalizeRouteState({}), choiceHistory: [], lockedEndingKey: null },
      chapterNumber: n,
      previousChoice: null,
    })

    const choiceInput: ChoiceInput = {
      snapshot,
      chapterBrief,
      draft: { ...draft, storyId: nadiaRakaContract.storyId },
      lastParagraphs,
      routeState: normalizeRouteState({}),
      choiceHistory: [],
      lockedEndingKey: null,
    }

    const choiceStart = Date.now()
    const choiceBranch = await generateChoiceBranch(deps, choiceInput, {
      telemetryContext: {
        correlationId: `${runId}-ch${n}-choices`,
        storyId: NADIA_RAKA_STORY_ID,
        chapterNumber: n,
        userId: '00000000-0000-4000-8000-00000000ab01',
        generationKind: 'personalized' as const,
        jobId: null,
        attemptNumber: 1,
      },
      workflowPhase: 'CHAPTER_CHOICES_FIRST_PASS',
    })
    const choiceSeconds = Number((((Date.now() - choiceStart) / 1000).toFixed(1)))
    if (!choiceBranch || choiceBranch.choices.length === 0) {
      console.error(`Bab ${n}: choice branch kosong`)
      process.exit(1)
    }

    const first = choiceBranch.choices[0]!
    const firstOutcome = choiceBranch.outcomes.find((o) => o.choiceId === first.id)
    console.log(`Pilihan Bab ${n}: "${choiceBranch.choicePrompt}" → [${choiceBranch.choices.map((c) => c.label).join(' | ')}] (${choiceSeconds}s)`)

    records.push({
      chapterNumber: n,
      title: draft.title,
      wordCount: draft.wordCount,
      paragraphCount: draft.paragraphs.length,
      sceneCount: draft.sceneCount,
      proseSeconds,
      choiceSeconds,
      choicePrompt: choiceBranch.choicePrompt,
      choiceLabels: choiceBranch.choices.map((c) => c.label),
      chosenLabel: first.label,
    })

    // Sambung rantai: ending bab ini + pilihan pertama → konteks bab berikut.
    continuation = {
      ...continuation,
      targetChapterNumber: n + 1,
      previousChapter: {
        number: n,
        title: draft.title,
        endingParagraphs: draft.paragraphs.slice(-5),
      },
      previousChoice: {
        chapterNumber: n,
        choiceId: first.id,
        label: first.label,
        consequence: firstOutcome ? [...firstOutcome.consequence] : [first.hint ?? first.label],
        effectSummary: { flagsSet: [`ch${n}_path`] },
        createdAt: new Date().toISOString(),
      },
      routeStateSummary: `Rute Bab ${n}: ${first.label}`,
    }
  }

  console.log('\n=== M10-G 9ROUTER STAGED PROOF SUMMARY ===')
  for (const r of records) {
    console.log(`Bab ${r.chapterNumber}: "${r.title}" — ${r.wordCount} kata / ${r.paragraphCount} par / ${r.sceneCount} scenes — prosa ${r.proseSeconds}s, pilihan ${r.choiceSeconds}s — dipilih: ${r.chosenLabel}`)
  }
  const wordsOk = records.every((r) => r.wordCount >= 800 && r.wordCount <= 1000)
  console.log(`Word-count 800–1000 semua bab: ${wordsOk ? 'PASS' : 'CHECK'}`)
  if (!wordsOk) process.exit(1)
  console.log('=== STAGED PROOF PASSED ===')
}

main().catch((err) => {
  console.error('STAGED PROOF FAILED:', err)
  process.exit(1)
})

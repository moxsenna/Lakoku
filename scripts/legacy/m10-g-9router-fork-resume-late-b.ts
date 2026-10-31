/**
 * Resume khusus late-B fork proof — Bab 48..50 saja, in-memory, zero DB.
 *
 * Membangun ulang state late-B dari checkpoint fork (`branch=late-B` s/d
 * Bab 47) lalu melanjutkan Bab 48..50 dengan prosa retry-5 + pilihan retry-3.
 * Dipakai karena run fork utama gugur di late-B Bab 48 (5×
 * AI_NoOutputGeneratedError berurutan — gangguan provider sesaat, bukan
 * kegagalan validasi).
 *
 * Otorisasi: butuh M10G_FULL_PROOF_AUTHORIZED=1.
 *
 * Jalankan:
 *   node scripts/run-smoke.cjs scripts/m10-g-9router-fork-resume-late-b.ts --checkpoint=/tmp/fork.jsonl --resume=/tmp/fork.jsonl
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
import { buildChapterBrief, type ChoiceHistoryEntry } from '../lib/story-engine/chapter-brief'
import { buildPreProseChapterBrief } from '../lib/story-engine/pre-prose-brief'
import { resolveEnding } from '../lib/story-engine/ending-resolver'
import { kiranaGilangContract } from '../fixtures/contracts/kirana-gilang'
import type { LastParagraphs } from '../lib/ai-gateway/provider'
import type { ContinuationContext } from '../lib/narrative/continuation-context'
import type { CanonSnapshot, ChapterBlueprint } from '../lib/narrative/types'
import type { StoryContract } from '../lib/story-engine/story-contract'

const CONTRACT: StoryContract = kiranaGilangContract
const MAX_PROSE_ATTEMPTS = 5
const MAX_CHOICE_ATTEMPTS = 3
const PROOF_USER_ID = '00000000-0000-4000-8000-00000000ab01'
const BRANCH = 'late-B'
const FINAL_CHAPTER = 50

function argValue(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? (arg.split('=').slice(1).join('=') ?? null) : null
}

async function main() {
  if (process.env.M10G_FULL_PROOF_AUTHORIZED !== '1') {
    throw new Error('M10G_FULL_PROOF_AUTHORIZATION_REQUIRED')
  }
  const resumePath = argValue('resume')
  const checkpointPath = argValue('checkpoint')
  if (!resumePath) throw new Error('MISSING_RESUME_PATH')

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
  if (!process.env.NINEROUTER_BASE_URL || !process.env.NINEROUTER_API_KEY) {
    throw new Error('MISSING_NINEROUTER_CREDENTIALS')
  }

  const authority = assertM10GG1RouteAuthority(M10_G_G1_9ROUTER_ROUTE_AUTHORITY)
  const provider = createProviderFromExactRoutes({
    writerRoute: toAiModelRoute(authority, 'writer'),
    choicesRoute: toAiModelRoute(authority, 'choice'),
    judgeRoute: toAiModelRoute(authority, 'continuity'),
    generationPolicy: { targetWordsMin: 800, targetWordsMax: 1000, targetScenes: 3 },
  })
  const deps = { provider }
  const runId = `fork-resume-${Date.now()}`

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
  const blueprintFor = (n: number): ChapterBlueprint => {
    const blueprint = snapshot.blueprints.find((b) => b.chapterNumber === n)
    if (!blueprint) throw new Error(`M10G_FORK_RESUME_BLUEPRINT_MISSING:${n}`)
    return blueprint
  }

  // Bangun ulang state late-B dari checkpoint.
  const prior = fs.readFileSync(resumePath, 'utf8').split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as {
      branch: string
      chapterNumber: number
      title: string
      wordCount: number
      paragraphs: string[]
      chosenLabel: string | null
      lockedEndingKey: string | null
      routeFlags: Record<string, boolean>
    })
    .filter((r) => r.branch === BRANCH)
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
  if (prior.length === 0) throw new Error('M10G_FORK_RESUME_NO_LATE_B')
  const lastPrior = prior[prior.length - 1]!
  console.log(`Resume ${BRANCH}: ${prior.length} bab, lanjut Bab ${lastPrior.chapterNumber + 1}`)

  let routeState: RouteState = normalizeRouteState({})
  let choiceHistory: ChoiceHistoryEntry[] = []
  for (const record of prior) {
    routeState = normalizeRouteState({ flags: { ...routeState.flags, ...record.routeFlags } })
    if (record.chosenLabel) {
      choiceHistory.push({
        chapterNumber: record.chapterNumber,
        choiceId: `resume-${BRANCH}-ch${record.chapterNumber}`,
        label: record.chosenLabel,
        consequence: [record.chosenLabel],
        effectSummary: { flagsSet: [`ch${record.chapterNumber}_path`] },
        createdAt: new Date().toISOString(),
      })
    }
  }
  let lockedEndingKey: string | null = lastPrior.lockedEndingKey
  let continuation: ContinuationContext = {
    storyId: CONTRACT.storyId,
    targetChapterNumber: lastPrior.chapterNumber + 1,
    previousChapter: {
      number: lastPrior.chapterNumber,
      title: lastPrior.title,
      endingParagraphs: lastPrior.paragraphs.slice(-5),
    },
    previousChoice: lastPrior.chosenLabel
      ? choiceHistory[choiceHistory.length - 1] ?? null
      : null,
    routeStateSummary: `Rute ${BRANCH} Bab ${lastPrior.chapterNumber}`,
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
    lockedEndingKey,
  }
  const timeline: CanonSnapshot['timeline'] = prior.map((r) => ({
    chapterNumber: r.chapterNumber,
    ordinal: 1,
    description: `Bab ${r.chapterNumber} "${r.title}" — ${r.chosenLabel ?? 'tanpa pilihan'}.`,
    isFlashback: false,
    occursAt: r.chapterNumber,
  }))

  for (let n = lastPrior.chapterNumber + 1; n <= FINAL_CHAPTER; n++) {
    console.log(`\n===== [${BRANCH} Bab ${n}] Prosa =====`)
    continuation = { ...continuation, storyId: CONTRACT.storyId, targetChapterNumber: n }
    const chapterBrief = buildChapterBrief({
      storyContract: CONTRACT,
      snapshot: { ...snapshot, timeline },
      readerState: { routeState, choiceHistory, lockedEndingKey },
      chapterNumber: n,
      previousChoice: continuation.previousChoice ?? null,
    })
    if (chapterBrief.lockedEndingKey !== lockedEndingKey) {
      lockedEndingKey = chapterBrief.lockedEndingKey
      console.log(`${BRANCH} Bab ${n}: lockedEndingKey → ${lockedEndingKey ?? '(null)'}`)
    }
    const preProseBrief = buildPreProseChapterBrief({
      storyId: CONTRACT.storyId,
      chapterNumber: n,
      snapshot: { ...snapshot, timeline },
      blueprint: blueprintFor(n),
      continuation,
      chapterBrief,
    })
    let chapterResult: Awaited<ReturnType<typeof generateChapter>> | null = null
    for (let attempt = 1; attempt <= MAX_PROSE_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        console.log(`${BRANCH} Bab ${n}: percobaan prosa ${attempt}/${MAX_PROSE_ATTEMPTS}...`)
        await new Promise((resolve) => setTimeout(resolve, 15000))
      }
      try {
        chapterResult = await generateChapter(deps, {
          snapshot: { ...snapshot, timeline },
          blueprint: blueprintFor(n),
          chapterNumber: n,
          continuation,
          brief: preProseBrief,
          executionOptions: {
            telemetryContext: {
              correlationId: `${runId}-${BRANCH}-ch${n}-a${attempt}`,
              storyId: KIRANA_GILANG_STORY_ID,
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
        chapterResult = null
      } catch (err) {
        console.log(`${BRANCH} Bab ${n} percobaan ${attempt} gagal (${err instanceof Error ? err.name : String(err)})`)
        if (attempt === MAX_PROSE_ATTEMPTS) throw err
        chapterResult = null
      }
    }
    if (!chapterResult || chapterResult.status !== 'PUBLISHED' || !chapterResult.draft) {
      console.error(`${BRANCH} Bab ${n} FAILED`)
      process.exit(1)
    }
    const draft = chapterResult.draft
    console.log(`${BRANCH} Bab ${n} PUBLISHED: "${draft.title}" — ${draft.wordCount} kata`)

    let choiceLabels: string[] = []
    let chosenLabel: string | null = null
    if (n < FINAL_CHAPTER) {
      const lastParagraphs: LastParagraphs = [
        (draft.paragraphs[draft.paragraphs.length - 3] || 'Paragraf satu.').slice(0, 400),
        (draft.paragraphs[draft.paragraphs.length - 2] || 'Paragraf dua.').slice(0, 400),
        (draft.paragraphs[draft.paragraphs.length - 1] || 'Paragraf tiga.').slice(0, 400),
      ]
      let choiceBranch: Awaited<ReturnType<typeof generateChoiceBranch>> | null = null
      for (let attempt = 1; attempt <= MAX_CHOICE_ATTEMPTS; attempt++) {
        try {
          choiceBranch = await generateChoiceBranch(deps, {
            snapshot: { ...snapshot, timeline },
            chapterBrief,
            draft: { ...draft, storyId: CONTRACT.storyId },
            lastParagraphs,
            routeState,
            choiceHistory,
            lockedEndingKey,
          }, {
            telemetryContext: {
              correlationId: `${runId}-${BRANCH}-ch${n}-choices-a${attempt}`,
              storyId: KIRANA_GILANG_STORY_ID,
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
          if (attempt === MAX_CHOICE_ATTEMPTS) throw err
          choiceBranch = null
        }
      }
      if (!choiceBranch || choiceBranch.choices.length === 0) {
        console.error(`${BRANCH} Bab ${n}: choice branch kosong`)
        process.exit(1)
      }
      const picked = choiceBranch.choices[Math.min(1, choiceBranch.choices.length - 1)]!
      const pickedOutcome = choiceBranch.outcomes.find((o) => o.choiceId === picked.id)
      choiceLabels = choiceBranch.choices.map((c) => c.label)
      chosenLabel = picked.label
      console.log(`${BRANCH} Pilihan Bab ${n} [idx 1]: "${chosenLabel}"`)
      choiceHistory = [...choiceHistory, {
        chapterNumber: n,
        choiceId: picked.id,
        label: picked.label,
        consequence: pickedOutcome ? [...pickedOutcome.consequence] : [picked.hint ?? picked.label],
        effectSummary: { flagsSet: [`ch${n}_path`] },
        createdAt: new Date().toISOString(),
      }]
      if (pickedOutcome) routeState = mergeChoiceEffect(routeState, pickedOutcome.effect)
    }

    timeline.push({
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
    if (checkpointPath) {
      fs.appendFileSync(checkpointPath, `${JSON.stringify({
        branch: BRANCH, chapterNumber: n, title: draft.title, wordCount: draft.wordCount,
        paragraphCount: draft.paragraphs.length, sceneCount: draft.sceneCount,
        choiceLabels, chosenLabel, lockedEndingKey, routeFlags, paragraphs: [...draft.paragraphs],
      })}\n`, 'utf8')
    }
    continuation = {
      storyId: CONTRACT.storyId,
      targetChapterNumber: n + 1,
      previousChapter: { number: n, title: draft.title, endingParagraphs: draft.paragraphs.slice(-5) },
      previousChoice: chosenLabel ? choiceHistory[choiceHistory.length - 1] ?? null : null,
      routeStateSummary: `Rute ${BRANCH} Bab ${n}`,
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
      lockedEndingKey,
    }
  }

  const resolution = resolveEnding({
    storyContract: CONTRACT,
    chapterNumber: 45,
    routeState,
    lockedEndingKey,
  })
  console.log(`${BRANCH} ending terverifikasi: ${resolution.key} — ${resolution.name}`)
  console.log('=== FORK RESUME LATE-B PASSED ===')
}

main().catch((err) => {
  console.error('FORK RESUME FAILED:', err)
  process.exit(1)
})

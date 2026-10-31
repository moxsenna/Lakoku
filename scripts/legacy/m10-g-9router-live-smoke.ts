import fs from 'node:fs'
import path from 'node:path'
import { generateChapter, type ChoiceInput } from '../lib/ai-gateway'
import { createProviderFromExactRoutes } from '../lib/ai-gateway/server'
import { generateChoiceBranch } from '../lib/ai-gateway/gateway'
import {
  toAiModelRoute,
  assertM10GG1RouteAuthority,
} from '../lib/narrative-qa/contracts/m10-g-g1-route-authority.contract'
import {
  M10_G_G1_9ROUTER_ROUTE_AUTHORITY,
} from '../fixtures/m10-g/g1-route-authority-9router'
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
import { misteriDramaContract } from '../fixtures/contracts/misteri-drama'
import type { LastParagraphs } from '../lib/ai-gateway/provider'

async function main() {
  console.log('--- M10-G 9Router VPS E2E Integration Smoke ---')

  // 1. Load env from .env.local
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*['"]?(.*?)['"]?\s*$/)
      if (match && match[1] && match[2] !== undefined) {
        if (!process.env[match[1]]) {
          process.env[match[1]] = match[2]
        }
      }
    }
  }

  // 2. Strict DB isolation: strip DB credentials to enforce 0 DB writes
  stripDbCredentials(process.env)
  assertNoDbCredentials(process.env)

  const baseUrl = process.env.NINEROUTER_BASE_URL
  const apiKey = process.env.NINEROUTER_API_KEY
  console.log('Provider endpoint:', baseUrl)
  console.log('API key present:', Boolean(apiKey))
  if (!baseUrl || !apiKey) {
    throw new Error('MISSING_NINEROUTER_CREDENTIALS')
  }

  // 3. Verify route authority snapshot
  const authority = assertM10GG1RouteAuthority(M10_G_G1_9ROUTER_ROUTE_AUTHORITY)
  const writerRoute = toAiModelRoute(authority, 'writer')
  const choicesRoute = toAiModelRoute(authority, 'choice')
  const judgeRoute = toAiModelRoute(authority, 'continuity')

  console.log('Frozen routes:', {
    writer: `${writerRoute.provider}:${writerRoute.modelId}`,
    choices: `${choicesRoute.provider}:${choicesRoute.modelId}`,
    judge: `${judgeRoute.provider}:${judgeRoute.modelId}`,
  })

  // 4. Create provider from exact frozen routes
  const provider = createProviderFromExactRoutes({
    writerRoute,
    choicesRoute,
    judgeRoute,
    generationPolicy: {
      targetWordsMin: 800,
      targetWordsMax: 1000,
      targetScenes: 3,
    },
  })

  const deps = { provider }
  const executionOptions = {
    telemetryContext: {
      correlationId: `smoke-9router-${Date.now()}`,
      storyId: NADIA_RAKA_STORY_ID,
      chapterNumber: 2,
      userId: '00000000-0000-4000-8000-00000000ab01',
      generationKind: 'personalized' as const,
      jobId: null,
      attemptNumber: 1,
    },
    workflowPhase: 'CHAPTER_PROSE_FIRST_PASS',
    writerLengthRepairV1: { enabled: true },
    observeWriterEvaluation: (evalResult: any) => {
      console.log('--- Writer Evaluation Observed ---', evalResult)
    },
    observeWriterParserOutcome: (outcome: any) => {
      console.log('--- Writer Parser Outcome ---', outcome)
    },
    observeWriterLengthRepair: (telemetry: any) => {
      console.log('--- Writer Length Repair Telemetry ---', telemetry)
    },
  }

  // 5. Generate Chapter Prose + Layer A/B/C validation
  console.log('\n[1/2] Generating Chapter 2 with gweb/gemini-3.1-pro...')
  const startProse = Date.now()
  const chapterResult = await generateChapter(deps, {
    snapshot: nadiaRakaSnapshot(),
    blueprint: NADIA_RAKA_BLUEPRINT,
    chapterNumber: 2,
    continuation: NADIA_RAKA_CONTINUATION_A,
    brief: NADIA_RAKA_BRIEF_A,
    executionOptions,
  })
  const proseDuration = ((Date.now() - startProse) / 1000).toFixed(1)
  console.log(`Prose generation completed in ${proseDuration}s`)
  console.log('Chapter status:', chapterResult.status)
  console.log('Attempts:', chapterResult.attempts)
  console.log('Findings:', chapterResult.findings.length)

  if (chapterResult.status !== 'PUBLISHED' || !chapterResult.draft) {
    console.error('Chapter failed:', chapterResult.reason, chapterResult.findings)
    process.exit(1)
  }

  const draft = chapterResult.draft
  console.log('Title:', draft.title)
  console.log('Word count:', draft.wordCount)
  console.log('Paragraphs:', draft.paragraphs.length)
  console.log('Scene count:', draft.sceneCount)
  console.log('\n--- Excerpt (first 2 paragraphs) ---')
  console.log(draft.paragraphs.slice(0, 2).join('\n\n'))
  console.log('\n--- Excerpt (last 2 paragraphs) ---')
  console.log(draft.paragraphs.slice(-2).join('\n\n'))

  // 6. Generate Choice Branch
  console.log('\n[2/2] Generating choices with gweb/gemini-3.8-flash...')
  const startChoices = Date.now()
  const lastParagraphs: LastParagraphs = [
    draft.paragraphs[draft.paragraphs.length - 3] || 'Paragraf satu.',
    draft.paragraphs[draft.paragraphs.length - 2] || 'Paragraf dua.',
    draft.paragraphs[draft.paragraphs.length - 1] || 'Paragraf tiga.',
  ]

  const snapshot = nadiaRakaSnapshot(misteriDramaContract.storyId)
  snapshot.blueprints = misteriDramaContract.actPlan.flatMap((act) =>
    misteriDramaContract.chapterTargets
      .filter((target) => target.chapterNumber >= act.fromChapter && target.chapterNumber <= act.toChapter)
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
      }))
  )

  const chapterBrief = buildChapterBrief({
    storyContract: misteriDramaContract,
    snapshot,
    readerState: {
      routeState: normalizeRouteState({}),
      choiceHistory: [],
      lockedEndingKey: null,
    },
    chapterNumber: 2,
    previousChoice: null,
  })

  const choiceInput: ChoiceInput = {
    snapshot,
    chapterBrief,
    draft: {
      ...draft,
      storyId: misteriDramaContract.storyId,
    },
    lastParagraphs,
    routeState: normalizeRouteState({}),
    choiceHistory: [],
    lockedEndingKey: null,
  }

  const choiceBranch = await generateChoiceBranch(deps, choiceInput, {
    telemetryContext: executionOptions.telemetryContext,
    workflowPhase: 'CHAPTER_CHOICES_FIRST_PASS',
  })
  const choicesDuration = ((Date.now() - startChoices) / 1000).toFixed(1)
  console.log(`Choice generation completed in ${choicesDuration}s`)

  if (!choiceBranch) {
    console.error('Choice branch generation returned null')
    process.exit(1)
  }

  console.log('Choice prompt/question:', choiceBranch.choicePrompt)
  console.log('Total choices:', choiceBranch.choices.length)
  for (let i = 0; i < choiceBranch.choices.length; i++) {
    const opt = choiceBranch.choices[i]!
    const outcome = choiceBranch.outcomes.find((o) => o.choiceId === opt.id)
    console.log(`Choice ${i + 1} [${opt.id}]: ${opt.label}`)
    if (opt.hint) console.log(`   Hint: ${opt.hint}`)
    if (outcome) console.log(`   Consequence: ${outcome.consequence.join('; ')}`)
  }

  console.log('\n=== ALL 9ROUTER VPS E2E TESTS PASSED ===')
}

main().catch((err) => {
  console.error('E2E SMOKE FAILED:', err)
  process.exit(1)
})

import {
  classifyChoiceProviderError,
  choiceRetryAction,
  proseFingerprint,
  type ChoiceProviderErrorCode,
} from '@lakoku/runtime'

type FailureCode = Exclude<ChoiceProviderErrorCode, 'CONTENT_REJECTED' | 'QUALITY_NOT_ACTIONABLE' | 'UNKNOWN'>
type CheckpointStatus = 'PROSE_READY' | 'RUNNING_CHOICES' | 'CHOICES_RETRY_WAIT' | 'PUBLISHED'

type Job = {
  id: string
  userId: string
  storyId: string
  chapterNumber: number
  failures: FailureCode[]
  restart: boolean
  checkpoint: {
    status: CheckpointStatus
    proseFingerprint: string
    proseAttempts: number
    choiceAttempts: number
  } | null
  retries: number
  repairs: number
  fallbacks: number
  publications: number
  stalePublications: number
  startedAt: number
  choiceStartedAt: number | null
  choiceEndedAt: number | null
  endedAt: number | null
}

type Metrics = {
  maxGenerationActive: number
  maxChoiceActive: number
  maxChoiceQueued: number
  queuedChoiceCount: number
  duplicateRecoveryTicks: number
  restartAttempts: number
  restartRecoveries: number
  manualInterventions: number
}

const FAILURE_MATRIX: FailureCode[] = [
  'TIMEOUT',
  'RATE_LIMITED',
  'HTTP_5XX',
  'NETWORK_ERROR',
  'INVALID_JSON',
  'SCHEMA_INVALID',
  'QUALITY_UNGROUNDED',
  'QUALITY_NOT_DISTINCT',
]

function integerArg(name: string, fallback: number): number {
  const prefix = `--${name}=`
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  const parsed = raw ? Number.parseInt(raw, 10) : fallback
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid --${name}`)
  return parsed
}

function percentile(samples: number[], percentileValue: number): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.ceil((percentileValue / 100) * sorted.length) - 1] ?? 0
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function failureError(code: FailureCode): Error {
  const messages: Record<FailureCode, string> = {
    TIMEOUT: 'choice provider timeout',
    RATE_LIMITED: '429 rate limited',
    HTTP_5XX: '503 bad gateway',
    NETWORK_ERROR: 'network fetch failed',
    INVALID_JSON: 'invalid JSON parse',
    SCHEMA_INVALID: 'choice schema validation failed',
    QUALITY_UNGROUNDED: 'choice ungrounded',
    QUALITY_NOT_DISTINCT: 'choices not distinct',
  }
  return new Error(messages[code])
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`SOAK_ASSERTION_FAILED: ${message}`)
}

/**
 * Process-local programmable workload simulation.
 *
 * This does NOT exercise generation_jobs, checkpoint/lease RPCs, production worker
 * dispatch, recovery RPC, or V4 publication. Database lifecycle/fencing proof lives
 * in supabase/tests/generation_job_recovery_test.sql and race scripts. Keep output
 * labelled SIMULATION so it cannot be cited as approved production-seam soak.
 */
async function main(): Promise<void> {
  const jobsCount = integerArg('jobs', 10)
  const generationConcurrency = integerArg('generation-concurrency', 1)
  const choiceConcurrency = integerArg('choice-concurrency', 1)

  process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS = String(generationConcurrency)
  process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER = '1'
  process.env.LAKOKU_GENERATION_MAX_QUEUE = String(Math.max(40, jobsCount))
  process.env.LAKOKU_CHOICE_MAX_ACTIVE = String(choiceConcurrency)
  process.env.LAKOKU_CHOICE_MAX_ACTIVE_9ROUTER = String(choiceConcurrency)
  process.env.LAKOKU_CHOICE_MAX_QUEUE = String(Math.max(50, jobsCount * 4))
  process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '0'
  process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '0'

  const generationGate = await import('@/lib/runtime/generation-concurrency')
  const choiceGate = await import('@/lib/runtime/choice-concurrency')
  choiceGate.__resetChoiceConcurrencyForTests()

  const runId = `soak-${jobsCount}-${crypto.randomUUID()}`
  const jobs: Job[] = Array.from({ length: jobsCount }, (_, index) => ({
    id: `${runId}-job-${index + 1}`,
    userId: `${runId}-user-${index + 1}`,
    storyId: `${runId}-story-${index + 1}`,
    chapterNumber: (index % 49) + 1,
    failures: index < FAILURE_MATRIX.length ? [FAILURE_MATRIX[index]!] : [],
    restart: index === Math.min(FAILURE_MATRIX.length, jobsCount - 1),
    checkpoint: null,
    retries: 0,
    repairs: 0,
    fallbacks: 0,
    publications: 0,
    stalePublications: 0,
    startedAt: performance.now(),
    choiceStartedAt: null,
    choiceEndedAt: null,
    endedAt: null,
  }))
  assert(new Set(jobs.map((job) => `${job.storyId}:${job.chapterNumber}`)).size === jobsCount, 'topology must be unique per job')

  const metrics: Metrics = {
    maxGenerationActive: 0,
    maxChoiceActive: 0,
    maxChoiceQueued: 0,
    queuedChoiceCount: 0,
    duplicateRecoveryTicks: 0,
    restartAttempts: 0,
    restartRecoveries: 0,
    manualInterventions: 0,
  }
  const recoveryQueue: Job[] = []
  let monitor = true
  const monitorTask = (async () => {
    while (monitor) {
      const generation = generationGate.getGenerationConcurrencyStats()
      const choice = choiceGate.__choiceConcurrencySnapshot('9router')
      metrics.maxGenerationActive = Math.max(metrics.maxGenerationActive, generation.active)
      metrics.maxChoiceActive = Math.max(metrics.maxChoiceActive, choice.active)
      metrics.maxChoiceQueued = Math.max(metrics.maxChoiceQueued, choice.queued)
      await delay(1)
    }
  })()

  async function callChoiceProvider(job: Job, code: FailureCode | null): Promise<void> {
    const before = choiceGate.__choiceConcurrencySnapshot('9router')
    if (before.active >= choiceConcurrency) metrics.queuedChoiceCount += 1
    await choiceGate.withChoiceGenerationSlot(
      { providerId: '9router', storyId: job.storyId, chapterNumber: job.chapterNumber, correlationId: job.id },
      async () => {
        await delay(8)
        if (code) throw failureError(code)
      },
    )
  }

  async function publish(job: Job, workerToken: 'current' | 'stale'): Promise<void> {
    if (workerToken === 'stale') {
      job.stalePublications += 1
      return
    }
    if (job.checkpoint?.status === 'PUBLISHED') return
    assert(job.checkpoint != null, `${job.id} checkpoint missing at publish`)
    job.checkpoint.status = 'PUBLISHED'
    job.publications += 1
  }

  async function runChoices(job: Job): Promise<void> {
    assert(job.checkpoint != null, `${job.id} checkpoint missing before choices`)
    job.choiceStartedAt ??= performance.now()
    job.checkpoint.status = 'RUNNING_CHOICES'
    for (let index = 0; index <= job.failures.length; index += 1) {
      const programmed = job.failures[index] ?? null
      job.checkpoint.choiceAttempts += 1
      try {
        await callChoiceProvider(job, programmed)
        await publish(job, 'current')
        job.choiceEndedAt = performance.now()
        job.endedAt = performance.now()
        return
      } catch (error) {
        assert(programmed != null, `${job.id} unexpected choice failure`)
        const classified = classifyChoiceProviderError(error)
        assert(classified === programmed, `${job.id} classified ${classified}, expected ${programmed}`)
        const action = choiceRetryAction(classified)
        job.retries += 1
        if (action === 'structural_repair' || action === 'quality_repair') job.repairs += 1
        else job.fallbacks += 1
        job.checkpoint.status = 'CHOICES_RETRY_WAIT'
      }
    }
    metrics.manualInterventions += 1
  }

  async function initialWorker(job: Job): Promise<void> {
    await generationGate.withGenerationSlot(
      { userId: job.userId, storyId: job.storyId, chapterNumber: job.chapterNumber },
      async () => {
        await delay(12)
        const title = `Chapter ${job.chapterNumber}`
        const paragraphs = [`Deterministic prose for ${job.storyId}`]
        job.checkpoint = {
          status: 'PROSE_READY',
          proseFingerprint: proseFingerprint(title, paragraphs),
          proseAttempts: 1,
          choiceAttempts: 0,
        }
        if (job.restart) {
          metrics.restartAttempts += 1
          recoveryQueue.push(job)
          return
        }
        await runChoices(job)
      },
      (reason) => { throw new Error(`${job.id} generation capacity rejected: ${reason}`) },
    )
  }

  try {
    await Promise.all(jobs.map(initialWorker))
    const recoveryClaims = new Set<string>()
    const recoveryPass = async () => Promise.all(recoveryQueue.map(async (job) => {
      if (job.checkpoint?.status === 'PUBLISHED' || recoveryClaims.has(job.id)) return
      recoveryClaims.add(job.id)
      const fingerprint = job.checkpoint?.proseFingerprint
      await runChoices(job)
      assert(job.checkpoint?.proseFingerprint === fingerprint, `${job.id} recovery changed prose fingerprint`)
      metrics.restartRecoveries += 1
      await publish(job, 'stale')
    }))
    await Promise.all([recoveryPass(), recoveryPass()])
    metrics.duplicateRecoveryTicks = 2
  } finally {
    monitor = false
    await monitorTask
    choiceGate.__resetChoiceConcurrencyForTests()
  }

  const published = jobs.filter((job) => job.checkpoint?.status === 'PUBLISHED').length
  const initialPublished = jobs.filter((job) => !job.restart && job.checkpoint?.status === 'PUBLISHED').length
  const proseRegenerated = jobs.filter((job) => (job.checkpoint?.proseAttempts ?? 0) !== 1).length
  const duplicatePublications = jobs.filter((job) => job.publications !== 1).length
  const stalePublications = jobs.reduce((sum, job) => sum + job.stalePublications, 0)
  const choiceLatency = jobs.map((job) => (job.choiceEndedAt ?? 0) - (job.choiceStartedAt ?? 0))
  const endToEndLatency = jobs.map((job) => (job.endedAt ?? 0) - job.startedAt)

  assert(published === jobsCount, `${published}/${jobsCount} eventual publish`)
  assert(proseRegenerated === 0, `${proseRegenerated} prose regenerations`)
  assert(duplicatePublications === 0, `${duplicatePublications} duplicate/missing publications`)
  assert(stalePublications === metrics.restartAttempts, 'stale workers must be rejected once per restart fixture')
  assert(metrics.manualInterventions === 0, `${metrics.manualInterventions} manual interventions`)
  assert(metrics.restartRecoveries === metrics.restartAttempts, `${metrics.restartRecoveries}/${metrics.restartAttempts} restart recovery`)
  assert(metrics.maxGenerationActive === generationConcurrency, `observed generation max ${metrics.maxGenerationActive}, expected ${generationConcurrency}`)
  assert(metrics.maxChoiceActive === choiceConcurrency, `observed choice max ${metrics.maxChoiceActive}, expected ${choiceConcurrency}`)
  if (jobsCount >= 30) assert(metrics.queuedChoiceCount > 0 && metrics.maxChoiceQueued > 0, 'reliability run must queue choices')

  const report = {
    profile: { jobs: jobsCount, generationConcurrency, choiceConcurrency },
    reliability: {
      initialPublished: `${initialPublished}/${jobsCount}`,
      eventualPublished: `${published}/${jobsCount}`,
      proseRegeneratedDueChoiceFailure: proseRegenerated,
      duplicatePublications,
      stalePublishAccepted: 0,
      stalePublishRejected: stalePublications,
      manualInterventions: metrics.manualInterventions,
      restartRecovery: `${metrics.restartRecoveries}/${metrics.restartAttempts}`,
      duplicateRecoveryTicks: metrics.duplicateRecoveryTicks,
    },
    observedConcurrency: {
      generationMaxActive: metrics.maxGenerationActive,
      choiceMaxActive: metrics.maxChoiceActive,
      choiceMaxQueued: metrics.maxChoiceQueued,
      queuedChoiceCount: metrics.queuedChoiceCount,
    },
    retry: {
      retries: jobs.reduce((sum, job) => sum + job.retries, 0),
      repairs: jobs.reduce((sum, job) => sum + job.repairs, 0),
      fallbacks: jobs.reduce((sum, job) => sum + job.fallbacks, 0),
    },
    latencyMs: {
      choiceP50: Math.round(percentile(choiceLatency, 50)),
      choiceP95: Math.round(percentile(choiceLatency, 95)),
      endToEndP50: Math.round(percentile(endToEndLatency, 50)),
      endToEndP95: Math.round(percentile(endToEndLatency, 95)),
    },
    failureMatrix: FAILURE_MATRIX,
  }
  console.log(`FULL_GENERATION_PROCESS_LOCAL_SIMULATION_PASS ${JSON.stringify(report, null, 2)}`)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

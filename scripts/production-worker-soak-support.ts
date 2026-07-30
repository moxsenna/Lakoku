import type { ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ProviderCandidateTransport } from '@lakoku/ai-gateway'

export type ProgrammedCandidate = Readonly<{
  outcome: 'valid' | 'HANG' | 'TIMEOUT' | 'RATE_LIMITED' | 'HTTP_5XX' | 'NETWORK_ERROR' | 'INVALID_JSON' | 'SCHEMA_INVALID' | 'UNGROUNDED' | 'NON_DISTINCT'
  text?: string
}>

export type ProductionJobScript = Readonly<{
  prose: readonly ProgrammedCandidate[]
  choices: readonly ProgrammedCandidate[]
}>

export function immutableProductionJobScript(input: {
  prose: ProgrammedCandidate[]
  choices: ProgrammedCandidate[]
}): ProductionJobScript {
  return Object.freeze({
    prose: Object.freeze(input.prose.map((candidate) => Object.freeze({ ...candidate }))),
    choices: Object.freeze(input.choices.map((candidate) => Object.freeze({ ...candidate }))),
  })
}

function programmedError(outcome: Exclude<ProgrammedCandidate['outcome'], 'valid' | 'HANG'>): Error {
  if (outcome === 'TIMEOUT') return new DOMException('TIMEOUT: programmed candidate', 'TimeoutError')
  const messages = {
    RATE_LIMITED: '429 rate limited',
    HTTP_5XX: '503 upstream unavailable',
    NETWORK_ERROR: 'network fetch failed',
    INVALID_JSON: 'invalid JSON',
    SCHEMA_INVALID: 'schema invalid',
    UNGROUNDED: 'choice ungrounded',
    NON_DISTINCT: 'choices non-distinct',
  } as const
  return new Error(messages[outcome])
}

export function createProgrammableCandidateTransport(
  script: ProductionJobScript,
  observed: (text: string) => unknown,
): ProviderCandidateTransport {
  const offsets = { prose: 0, choice: 0 }
  return (candidate) => {
    const sequence = script[candidate.kind === 'choice' ? 'choices' : 'prose']
    const offset = offsets[candidate.kind]
    offsets[candidate.kind] += 1
    const programmed = sequence[offset]
    if (!programmed) {
      throw new Error(`PROGRAMMED_${candidate.kind.toUpperCase()}_EXHAUSTED_AT_${offset}`)
    }
    if (programmed.outcome === 'HANG') {
      return {
        text: new Promise<never>(() => undefined),
        usage: Promise.resolve({}),
        finalStep: Promise.resolve({ response: {}, providerMetadata: {} }),
      }
    }
    if (programmed.outcome !== 'valid') {
      if (['INVALID_JSON', 'SCHEMA_INVALID', 'UNGROUNDED', 'NON_DISTINCT'].includes(programmed.outcome)) {
        if (typeof programmed.text !== 'string') throw new Error('PROGRAMMED_INVALID_TEXT_REQUIRED')
        return observed(programmed.text)
      }
      throw programmedError(programmed.outcome)
    }
    if (typeof programmed.text !== 'string') throw new Error('PROGRAMMED_VALID_TEXT_REQUIRED')
    return observed(programmed.text)
  }
}

function loopbackUrl(input: RequestInfo | URL): boolean {
  const raw = input instanceof Request ? input.url : String(input)
  const host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

export function createOutboundNetworkSentinel(delegate: typeof fetch): typeof fetch {
  return (async (input, init) => {
    if (!loopbackUrl(input)) throw new Error('outbound network blocked: production worker soak')
    return delegate(input, init)
  }) as typeof fetch
}

export function createLocalRpcDiagnosticFetch(
  delegate: typeof fetch,
  report: (detail: { code: string | null; message: string }) => void,
): typeof fetch {
  return (async (input, init) => {
    const response = await delegate(input, init)
    const raw = input instanceof Request ? input.url : String(input)
    const url = new URL(raw)
    if (
      response.ok
      || !loopbackUrl(input)
      || url.pathname !== '/rest/v1/rpc/publish_generation_job_chapter_v4'
    ) return response

    try {
      const payload = await response.clone().json() as { code?: unknown; message?: unknown }
      report({
        code: typeof payload.code === 'string' ? payload.code.slice(0, 40) : null,
        message: typeof payload.message === 'string' ? payload.message.slice(0, 400) : 'unknown local RPC failure',
      })
    } catch {
      report({ code: null, message: 'unparseable local RPC failure' })
    }
    return response
  }) as typeof fetch
}

export function restartFixtureIndex(jobs: number): number {
  if (!Number.isSafeInteger(jobs) || jobs < 2) throw new Error('at least two jobs required')
  return 0
}

export type ChildTerminationResult = Readonly<{
  exitCode: number | null
  signal: NodeJS.Signals | null
  forced: boolean
}>

export async function terminateChildBounded(child: ChildProcess, timeoutMs: number): Promise<ChildTerminationResult> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Object.freeze({ exitCode: child.exitCode, signal: child.signalCode, forced: false })
  }
  return new Promise<ChildTerminationResult>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child termination timed out')), timeoutMs)
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer)
      resolve(Object.freeze({ exitCode, signal, forced: true }))
    })
    if (!child.kill('SIGKILL')) {
      clearTimeout(timer)
      reject(new Error('child termination signal failed'))
    }
  })
}

export function createChoiceGateMetrics() {
  const maxima = new Map<string, { maxActive: number; maxQueued: number }>()
  return Object.freeze({
    observe(observation: { providerId: string; active: number; queued: number }): void {
      const current = maxima.get(observation.providerId) ?? { maxActive: 0, maxQueued: 0 }
      current.maxActive = Math.max(current.maxActive, observation.active)
      current.maxQueued = Math.max(current.maxQueued, observation.queued)
      maxima.set(observation.providerId, current)
    },
    snapshot() {
      return Object.fromEntries([...maxima].map(([provider, value]) => [provider, { ...value }]))
    },
  })
}

export function sanitizeEvidenceValue(value: unknown, maxLength = 200): string {
  const bounded = String(value ?? '').replace(/[\r\n\t]+/g, ' ')
    .replace(/(?:bearer\s+|token\s*=\s*)[^\s,;]+/gi, '[REDACTED]')
  return bounded.slice(0, Math.max(0, Math.min(maxLength, 400)))
}

export function deterministicFailureSchedule(
  validProse: string,
  validChoices: string,
  restart = false,
): ProductionJobScript {
  return immutableProductionJobScript({
    prose: [
      { outcome: 'TIMEOUT' }, { outcome: 'RATE_LIMITED' }, { outcome: 'HTTP_5XX' },
      { outcome: 'NETWORK_ERROR' }, { outcome: 'valid', text: validProse },
    ],
    choices: restart ? [{ outcome: 'HANG' }] : [
      { outcome: 'INVALID_JSON', text: '{not-json' },
      { outcome: 'SCHEMA_INVALID', text: '{}' },
      { outcome: 'UNGROUNDED', text: validChoices },
      { outcome: 'NON_DISTINCT', text: validChoices },
      { outcome: 'valid', text: validChoices },
    ],
  })
}

export function productionScriptFor(
  _storyId: string,
  index: number,
  restart: boolean,
  validProse: string,
  validChoices: string,
): ProductionJobScript {
  if (restart) return immutableProductionJobScript({ prose: [{ outcome: 'valid', text: validProse }], choices: [{ outcome: 'HANG' }] })
  const proseFailures = ['TIMEOUT', 'RATE_LIMITED', 'HTTP_5XX', 'NETWORK_ERROR'] as const
  const choiceFailures = ['INVALID_JSON', 'SCHEMA_INVALID', 'UNGROUNDED', 'NON_DISTINCT'] as const
  const proseFailure = proseFailures[index % proseFailures.length]
  const choiceFailure = choiceFailures[index % choiceFailures.length]
  let invalidChoiceText = validChoices
  if (choiceFailure === 'INVALID_JSON') invalidChoiceText = '{not-json'
  else if (choiceFailure === 'SCHEMA_INVALID') invalidChoiceText = '{}'
  else {
    const parsed = JSON.parse(validChoices) as { actions?: unknown[] }
    if (!Array.isArray(parsed.actions) || parsed.actions.length < 2) throw new Error('PROGRAMMED_QUALITY_FIXTURE_REQUIRES_TWO_ACTIONS')
    if (choiceFailure === 'UNGROUNDED') {
      Object.assign(parsed, { question: 'Apakah Maya terbang ke Mars sekarang?' })
    } else {
      const first = parsed.actions[0] as Record<string, unknown>
      const second = parsed.actions[1] as Record<string, unknown>
      parsed.actions = [first, { ...second, intent: first.intent, consequence: first.consequence }]
    }
    invalidChoiceText = JSON.stringify(parsed)
  }
  return immutableProductionJobScript({
    prose: [{ outcome: proseFailure }, { outcome: 'valid', text: validProse }],
    choices: [{ outcome: choiceFailure, text: invalidChoiceText }, { outcome: 'valid', text: validChoices }],
  })
}

export async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type ScenarioMetadata = Readonly<{
  provider: string
  candidate: string
  phase: 'prose' | 'choice'
  attempt: number
  timing: Readonly<{ startedAt: number; finishedAt: number }>
  programmedResult: ProgrammedCandidate['outcome']
  observedResult: 'TEXT_RETURNED' | 'TRANSPORT_ERROR' | 'HANGING'
  fallback: number
}>

export function createProviderLoadMetrics() {
  type Load = { active: number; maxActive: number }
  type Event = { provider: string; phase: 'prose' | 'choice'; fallback: number; outcome: 'success' | 'error'; startedAt: number; finishedAt: number }
  const loads = new Map<string, Load>()
  const observedEvents: Event[] = []
  const load = (provider: string) => {
    let current = loads.get(provider)
    if (!current) {
      current = { active: 0, maxActive: 0 }
      loads.set(provider, current)
    }
    return current
  }
  return Object.freeze({
    run<T>(provider: string, task: () => T, metadata: { phase: 'prose' | 'choice'; fallback: number } = { phase: 'choice', fallback: 0 }): T {
      const state = load(provider)
      const startedAt = Date.now()
      state.active += 1
      state.maxActive = Math.max(state.maxActive, state.active)
      const finish = (outcome: Event['outcome']) => {
        state.active -= 1
        observedEvents.push({ provider, ...metadata, outcome, startedAt, finishedAt: Date.now() })
      }
      try {
        const result = task()
        const completion = result && typeof result === 'object' && 'text' in result
          ? (result as { text?: unknown }).text
          : result
        if (completion instanceof Promise) completion.then(() => finish('success'), () => finish('error'))
        else finish('success')
        return result
      } catch (error) {
        finish('error')
        throw error
      }
    },
    snapshot() {
      return Object.fromEntries([...loads].map(([provider, state]) => [provider, { ...state }]))
    },
    events() {
      return [...observedEvents]
    },
  })
}

export function createScenarioRegistry(runId: string, metadataLimit: number, artifactDir?: string) {
  if (!runId || !Number.isSafeInteger(metadataLimit) || metadataLimit < 1) throw new Error('invalid scenario registry')
  type State = { storyId: string; jobId: string; script: ProductionJobScript; cursor: { prose: number; choice: number }; metadata: ScenarioMetadata[] }
  const states = new Map<string, State>()
  const key = (storyId: string, jobId: string) => `${runId}\u0000${storyId}\u0000${jobId}`
  if (artifactDir) fs.mkdirSync(artifactDir, { recursive: true })
  const appendToArtifact = (storyId: string, jobId: string, item: ScenarioMetadata) => {
    if (!artifactDir) return
    const filename = path.join(artifactDir, `soak-evidence-${runId}-${process.pid}.jsonl`)
    const line = JSON.stringify({ runId, storyId, jobId, item }) + '\n'
    const fd = fs.openSync(filename, 'a')
    try {
      fs.writeSync(fd, line, undefined, 'utf8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  }

  return Object.freeze({
    add(input: { storyId: string; jobId: string; script: ProductionJobScript }) {
      const id = key(input.storyId, input.jobId)
      if (states.has(id)) throw new Error('duplicate scenario identity')
      states.set(id, { ...input, cursor: { prose: 0, choice: 0 }, metadata: [] })
    },
    transport(storyId: string, jobId: string, observed: (text: string) => unknown): ProviderCandidateTransport {
      const state = states.get(key(storyId, jobId))
      if (!state) throw new Error('scenario not found')
      return (candidate) => {
        const phase = candidate.kind
        const sequence = state.script[phase === 'choice' ? 'choices' : 'prose']
        const offset = state.cursor[phase]++
        const programmed = sequence[offset]
        if (!programmed) throw new Error(`PROGRAMMED_${phase.toUpperCase()}_EXHAUSTED_AT_${offset}`)
        const startedAt = Date.now()
        const invalidTextOutcome = ['INVALID_JSON', 'SCHEMA_INVALID', 'UNGROUNDED', 'NON_DISTINCT'].includes(programmed.outcome)
        const observedResult: ScenarioMetadata['observedResult'] = programmed.outcome === 'HANG'
          ? 'HANGING'
          : programmed.outcome === 'valid' || invalidTextOutcome ? 'TEXT_RETURNED' : 'TRANSPORT_ERROR'
        const metadataEntry = Object.freeze({
          provider: candidate.providerId, candidate: candidate.modelId, phase, attempt: offset + 1,
          timing: Object.freeze({ startedAt, finishedAt: Date.now() }), programmedResult: programmed.outcome, observedResult, fallback: candidate.fallbackIndex,
        })
        if (state.metadata.length >= metadataLimit) state.metadata.shift()
        state.metadata.push(metadataEntry)
        appendToArtifact(storyId, jobId, metadataEntry)
        if (programmed.outcome === 'HANG') return { text: new Promise<never>(() => undefined), usage: Promise.resolve({}), finalStep: Promise.resolve({ response: {}, providerMetadata: {} }) }
        if (invalidTextOutcome) {
          if (typeof programmed.text !== 'string') throw new Error('PROGRAMMED_INVALID_TEXT_REQUIRED')
          return observed(programmed.text)
        }
        if (programmed.outcome !== 'valid') throw programmedError(programmed.outcome)
        if (typeof programmed.text !== 'string') throw new Error('PROGRAMMED_VALID_TEXT_REQUIRED')
        return observed(programmed.text)
      }
    },
    snapshot() {
      return Object.freeze([...states.values()].map((state) => Object.freeze({
        runId, storyId: state.storyId, jobId: state.jobId,
        cursor: Object.freeze({ ...state.cursor }), metadata: Object.freeze([...state.metadata]),
      })))
    },
  })
}

export function readAndValidateEvidence(
  artifactDir: string,
  runId: string,
  requiredKeys: ReadonlySet<string>,
): { path: string; recordCount: number; sha256: string } {
  const prefix = `soak-evidence-${runId}-`
  const files = fs.readdirSync(artifactDir).filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl')).sort()
  if (files.length === 0) throw new Error('invalid evidence: no process files')
  const records: string[] = []
  const seen = new Set<string>()
  for (const file of files) {
    const raw = fs.readFileSync(path.join(artifactDir, file), 'utf8')
    if (!raw.endsWith('\n')) throw new Error(`invalid evidence: truncated ${file}`)
    for (const line of raw.slice(0, -1).split('\n')) {
      let record: unknown
      try { record = JSON.parse(line) } catch { throw new Error(`invalid evidence: corrupt JSON in ${file}`) }
      if (!record || typeof record !== 'object') throw new Error(`invalid evidence: record in ${file}`)
      const value = record as { runId?: unknown; storyId?: unknown; jobId?: unknown; item?: unknown }
      if (value.runId !== runId || typeof value.storyId !== 'string' || typeof value.jobId !== 'string' || !value.item || typeof value.item !== 'object') {
        throw new Error(`invalid evidence: identity in ${file}`)
      }
      const key = `${value.storyId}\u0000${value.jobId}`
      if (!requiredKeys.has(key)) throw new Error(`invalid evidence: unknown key in ${file}`)
      seen.add(key)
      records.push(JSON.stringify(value))
    }
  }
  for (const key of requiredKeys) if (!seen.has(key)) throw new Error(`invalid evidence: missing key ${key}`)
  const merged = `${records.sort().join('\n')}\n`
  const mergedPath = path.join(artifactDir, `soak-evidence-${runId}.jsonl`)
  const fd = fs.openSync(mergedPath, 'w')
  try {
    fs.writeSync(fd, merged, undefined, 'utf8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  return { path: mergedPath, recordCount: records.length, sha256: crypto.createHash('sha256').update(merged).digest('hex') }
}

export async function pollUntilBounded<T>(
  read: () => T | null | Promise<T | null>,
  options: { timeoutMs: number; intervalMs: number; label: string },
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs
  while (true) {
    const value = await read()
    if (value !== null) return value
    if (Date.now() >= deadline) throw new Error(`${options.label} timed out`)
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs))
  }
}

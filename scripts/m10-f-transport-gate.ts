/**
 * TRANSPORT_PREQUALIFICATION_GATE_V1 runner.
 *
 * Executes exactly 20 fresh sequential writer-shaped calls against the frozen
 * pin and emits a metadata-only verdict. This is a TRANSPORT gate: it proves
 * route identity and transport reliability. It is NOT a narrative-quality gate,
 * so word-band / completeness observations are recorded as separate metadata and
 * never alter the transport verdict.
 *
 * Frozen contract (must not be edited to force a PASS):
 *   model              deepseek/deepseek-v4-flash-0731
 *   canonical expected deepseek/deepseek-v4-flash-20260731
 *   provider.only      ["open-inference"]
 *   allow_fallbacks    false
 *   require_parameters true
 *   maxOutputTokens    4096
 *   retry              0
 *   DB                 none
 *   publication        none
 *   prose retention    none
 *
 * PASS  >= 19/20 completed AND <= 1 ordinary transport/response failure.
 * Immediate qualification FAIL for any hard invariant violation:
 *   wrong model, wrong canonical identity, wrong provider, provider fallback,
 *   >1 provider attempt, route identity cannot be proven.
 *
 * The denominator is raw attempts. There is no retry path anywhere in this file.
 *
 * Deliberately dependency-free: this script imports nothing from lib/, so it is
 * structurally incapable of touching Supabase, publishing a chapter, or reaching
 * the narrative runtime. "DB: none" is enforced by construction, not convention.
 *
 * Usage:
 *   node scripts/run-smoke.cjs scripts/m10-f-transport-gate.ts
 *   node scripts/run-smoke.cjs scripts/m10-f-transport-gate.ts --preflight-only
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'

// ── Frozen contract constants ────────────────────────────────────────────────

const REQUESTED_MODEL = 'deepseek/deepseek-v4-flash-0731'
const CANONICAL_EXPECTED = 'deepseek/deepseek-v4-flash-20260731'
const PINNED_PROVIDER = 'open-inference'
const EXPECTED_PROVIDER_DISPLAY = 'OpenInference'
const MAX_OUTPUT_TOKENS = 4096
const SAMPLE_SIZE = 20
const MAX_ORDINARY_FAILURES = 1
const MIN_COMPLETED = 19

/** Runaway spend stop. Not a qualification threshold; aborts the run if tripped. */
const RUNAWAY_COST_CEILING_USD = 1.0

/** Per-call wall clock ceiling. A breach is an ordinary TimeoutError, never a retry. */
const CALL_TIMEOUT_MS = 180_000

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

/**
 * Fixed writer-shaped instruction. Neutral, self-contained, no story fixture, no
 * reader data, no DB read. Sized to exercise the 4096 cap at the applied word
 * band (hard 800-1000, soft 850-950, midpoint 900).
 */
const WRITER_PROMPT = [
  'Tulis satu bab novel interaktif berbahasa Indonesia.',
  '',
  'Aturan keluaran:',
  '- Baris pertama: "JUDUL: " diikuti judul bab.',
  '- Lalu satu baris kosong.',
  '- Lalu prosa naratif, antar paragraf dipisah satu baris kosong.',
  '- Panjang prosa 850-950 kata.',
  '- Sudut pandang orang kedua ("kamu").',
  '- Akhiri bab dengan kalimat yang utuh dan tuntas.',
  '',
  'Premis bab: seorang pengelola gudang pelabuhan menemukan satu peti yang tidak',
  'tercatat di manifes malam itu, dan harus memutuskan apakah melaporkannya',
  'sebelum kapal berikutnya berangkat.',
].join('\n')

// ── Types ────────────────────────────────────────────────────────────────────

type FailureClass =
  | 'TimeoutError'
  | 'ECONNRESET'
  | 'TypeError: terminated'
  | 'non-200'
  | 'provider error'
  | 'empty content'

type CallOutcome = 'completed' | 'ordinary_failure' | 'hard_invariant_violation'

interface GenerationRecord {
  provider_name: string | null
  model: string | null
  total_cost: number | null
  tokens_prompt: number | null
  tokens_completion: number | null
  finish_reason: string | null
  native_finish_reason: string | null
  latency_ms: number | null
}

interface CallMetadata {
  index: number
  attempt_id: string
  started_at: string
  latency_ms: number
  http_status: number | null
  transport_outcome: string
  generation_id: string | null
  requested_model: string
  canonical_expected: string
  canonical_observed: string | null
  serving_provider: string | null
  provider_attempts: number | null
  fallback_detected: boolean | null
  route_identity_proven: boolean
  finish_reason: string | null
  native_finish_reason: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  content_present: boolean
  content_chars: number
  content_words: number
  sse_event_count: number
  exact_cost_usd: number | null
  outcome: CallOutcome
  failure_class: FailureClass | null
  hard_violations: string[]
  /** Separate, non-verdict observation. Never feeds the transport verdict. */
  writer_observation: {
    finish_is_length: boolean
    within_hard_band_800_1000: boolean | null
    within_soft_band_850_950: boolean | null
  }
}

// ── Credential handling (never printed, never persisted) ─────────────────────

function loadApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null
}

/**
 * Metadata-only credential check. Hits GET /api/v1/key, which performs zero
 * model inference and consumes zero credit. Aborts before any sampling call so
 * a dead or capped key can never burn part of the 20-call denominator.
 */
async function preflight(apiKey: string): Promise<{ ok: boolean; detail: Record<string, unknown> }> {
  const response = await fetch(`${OPENROUTER_BASE}/key`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const text = await response.text()
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    parsed = null
  }
  const data = (parsed?.data ?? null) as Record<string, unknown> | null
  const error = (parsed?.error ?? null) as Record<string, unknown> | null
  return {
    ok: response.ok,
    detail: {
      http_status: response.status,
      credential_present: typeof data?.label === 'string',
      limit: data?.limit ?? null,
      usage: data?.usage ?? null,
      limit_remaining: data?.limit_remaining ?? null,
      is_free_tier: data?.is_free_tier ?? null,
      error_code: error?.code ?? null,
      error_message: error?.message ?? null,
    },
  }
}

// ── Failure classification (no retry, ever) ──────────────────────────────────

function classifyThrown(error: unknown): FailureClass {
  const name = (error as { name?: string } | null)?.name ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  const code = (error as { code?: string } | null)?.code ?? ''
  const cause = (error as { cause?: { code?: string; message?: string } } | null)?.cause
  const causeCode = cause?.code ?? ''
  if (name === 'TimeoutError' || name === 'AbortError' || message.includes('timed out')) {
    return 'TimeoutError'
  }
  if (code === 'ECONNRESET' || causeCode === 'ECONNRESET') return 'ECONNRESET'
  if (name === 'TypeError' && message.includes('terminated')) return 'TypeError: terminated'
  if (message.includes('terminated')) return 'TypeError: terminated'
  return 'provider error'
}

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

// ── Generation record (authoritative route identity, metadata-only) ──────────

async function fetchGenerationRecord(
  apiKey: string,
  generationId: string,
): Promise<GenerationRecord | null> {
  // OpenRouter's generation record lags the stream slightly. Bounded polling of a
  // free metadata endpoint. This is not a call retry and never touches the
  // sampling denominator.
  for (let poll = 0; poll < 8; poll++) {
    await new Promise((resolve) => setTimeout(resolve, poll === 0 ? 900 : 1200))
    let response: Response
    try {
      response = await fetch(`${OPENROUTER_BASE}/generation?id=${encodeURIComponent(generationId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
    } catch {
      continue
    }
    if (response.status === 404) continue
    if (!response.ok) continue
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(await response.text()) as Record<string, unknown>
    } catch {
      continue
    }
    const data = (parsed.data ?? null) as Record<string, unknown> | null
    if (!data) continue
    const num = (key: string): number | null =>
      typeof data[key] === 'number' ? (data[key] as number) : null
    const str = (key: string): string | null =>
      typeof data[key] === 'string' ? (data[key] as string) : null
    return {
      provider_name: str('provider_name'),
      model: str('model'),
      total_cost: num('total_cost'),
      tokens_prompt: num('tokens_prompt'),
      tokens_completion: num('tokens_completion'),
      finish_reason: str('finish_reason'),
      native_finish_reason: str('native_finish_reason'),
      latency_ms: num('latency'),
    }
  }
  return null
}

// ── One raw attempt. No retry. Always counts toward the denominator. ─────────

async function runOneCall(apiKey: string, index: number): Promise<CallMetadata> {
  const attemptId = randomUUID()
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  const meta: CallMetadata = {
    index,
    attempt_id: attemptId,
    started_at: startedAt,
    latency_ms: 0,
    http_status: null,
    transport_outcome: 'unknown',
    generation_id: null,
    requested_model: REQUESTED_MODEL,
    canonical_expected: CANONICAL_EXPECTED,
    canonical_observed: null,
    serving_provider: null,
    provider_attempts: null,
    fallback_detected: null,
    route_identity_proven: false,
    finish_reason: null,
    native_finish_reason: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    content_present: false,
    content_chars: 0,
    content_words: 0,
    sse_event_count: 0,
    exact_cost_usd: null,
    outcome: 'ordinary_failure',
    failure_class: null,
    hard_violations: [],
    writer_observation: {
      finish_is_length: false,
      within_hard_band_800_1000: null,
      within_soft_band_850_950: null,
    },
  }

  const body = JSON.stringify({
    model: REQUESTED_MODEL,
    stream: true,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.7,
    messages: [{ role: 'user', content: WRITER_PROMPT }],
    provider: {
      only: [PINNED_PROVIDER],
      allow_fallbacks: false,
      require_parameters: true,
    },
    usage: { include: true },
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)

  // Prose buffer is local-only. Length and word count are extracted, then the
  // buffer goes out of scope. Nothing textual is written to disk.
  let content = ''

  try {
    const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    })
    meta.http_status = response.status

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = ''
      try {
        const parsed = JSON.parse(errorText) as { error?: { message?: string } }
        errorMessage = parsed.error?.message ?? ''
      } catch {
        errorMessage = errorText.slice(0, 200)
      }
      meta.transport_outcome = `http_${response.status}`
      meta.failure_class = 'non-200'
      meta.outcome = 'ordinary_failure'
      meta.latency_ms = Date.now() - t0
      if (errorMessage) meta.transport_outcome += `:${errorMessage.slice(0, 160)}`
      return meta
    }

    if (!response.body) {
      meta.transport_outcome = 'no_body'
      meta.failure_class = 'empty content'
      meta.latency_ms = Date.now() - t0
      return meta
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    let usagePrompt: number | null = null
    let usageCompletion: number | null = null
    let usageTotal: number | null = null
    let streamCost: number | null = null

    const inspect = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') return
      meta.sse_event_count++
      let value: Record<string, unknown>
      try {
        value = JSON.parse(payload) as Record<string, unknown>
      } catch {
        return
      }
      if (!meta.generation_id && typeof value.id === 'string') meta.generation_id = value.id
      if (!meta.canonical_observed && typeof value.model === 'string') {
        meta.canonical_observed = value.model
      }
      if (!meta.serving_provider && typeof value.provider === 'string') {
        meta.serving_provider = value.provider
      }
      const usage = value.usage as Record<string, unknown> | undefined
      if (usage) {
        if (typeof usage.prompt_tokens === 'number') usagePrompt = usage.prompt_tokens
        if (typeof usage.completion_tokens === 'number') usageCompletion = usage.completion_tokens
        if (typeof usage.total_tokens === 'number') usageTotal = usage.total_tokens
        if (typeof usage.cost === 'number') streamCost = usage.cost
      }
      const choices = Array.isArray(value.choices) ? value.choices : []
      for (const choice of choices) {
        if (!choice || typeof choice !== 'object') continue
        const record = choice as Record<string, unknown>
        if (typeof record.finish_reason === 'string') meta.finish_reason = record.finish_reason
        if (typeof record.native_finish_reason === 'string') {
          meta.native_finish_reason = record.native_finish_reason
        }
        const delta = record.delta as Record<string, unknown> | undefined
        if (delta && typeof delta.content === 'string') content += delta.content
      }
    }

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) inspect(line)
    }
    buffered += decoder.decode()
    if (buffered) inspect(buffered)

    meta.latency_ms = Date.now() - t0
    meta.prompt_tokens = usagePrompt
    meta.completion_tokens = usageCompletion
    meta.total_tokens = usageTotal
    meta.exact_cost_usd = streamCost
    meta.content_chars = content.length
    meta.content_words = countWords(content)
    meta.content_present = content.trim().length > 0
    meta.transport_outcome = 'stream_complete'
  } catch (error) {
    meta.latency_ms = Date.now() - t0
    meta.failure_class = classifyThrown(error)
    meta.transport_outcome = `threw:${meta.failure_class}`
    meta.outcome = 'ordinary_failure'
    return meta
  } finally {
    clearTimeout(timer)
  }

  // Authoritative route identity from OpenRouter's own generation record.
  if (meta.generation_id) {
    const record = await fetchGenerationRecord(apiKey, meta.generation_id)
    if (record) {
      meta.serving_provider = record.provider_name ?? meta.serving_provider
      meta.canonical_observed = record.model ?? meta.canonical_observed
      meta.exact_cost_usd = record.total_cost ?? meta.exact_cost_usd
      meta.prompt_tokens = record.tokens_prompt ?? meta.prompt_tokens
      meta.completion_tokens = record.tokens_completion ?? meta.completion_tokens
      meta.finish_reason = record.finish_reason ?? meta.finish_reason
      meta.native_finish_reason = record.native_finish_reason ?? meta.native_finish_reason
      meta.route_identity_proven = Boolean(record.provider_name && record.model)
    }
  }

  // Hard invariants. Any single violation fails the whole qualification.
  if (meta.canonical_observed && meta.canonical_observed !== CANONICAL_EXPECTED) {
    if (meta.canonical_observed === REQUESTED_MODEL) {
      // Requested alias echoed back; canonical identity still unproven.
      meta.hard_violations.push('canonical_identity_unproven')
    } else {
      meta.hard_violations.push(`wrong_canonical_identity:${meta.canonical_observed}`)
    }
  }
  if (!meta.canonical_observed) meta.hard_violations.push('canonical_identity_unproven')
  const providerMatchesPin = meta.serving_provider === PINNED_PROVIDER
    || meta.serving_provider === EXPECTED_PROVIDER_DISPLAY
  if (meta.serving_provider && !providerMatchesPin) {
    meta.hard_violations.push(`wrong_provider:${meta.serving_provider}`)
    meta.fallback_detected = true
  } else if (providerMatchesPin) {
    meta.fallback_detected = false
    meta.provider_attempts = 1
  }
  if (!meta.route_identity_proven) meta.hard_violations.push('route_identity_unproven')

  // Separate writer observation. Recorded, never promoted into the verdict.
  meta.writer_observation.finish_is_length = meta.finish_reason === 'length'
  if (meta.content_present) {
    meta.writer_observation.within_hard_band_800_1000
      = meta.content_words >= 800 && meta.content_words <= 1000
    meta.writer_observation.within_soft_band_850_950
      = meta.content_words >= 850 && meta.content_words <= 950
  }

  if (meta.hard_violations.length > 0) {
    meta.outcome = 'hard_invariant_violation'
    return meta
  }
  if (!meta.content_present) {
    meta.failure_class = 'empty content'
    meta.outcome = 'ordinary_failure'
    return meta
  }

  meta.outcome = 'completed'
  return meta
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const preflightOnly = process.argv.includes('--preflight-only')
  const resumeArg = process.argv.find((value) => value.startsWith('--resume-run='))
  const resumeRunId = resumeArg?.slice('--resume-run='.length).trim() || null
  const runId = resumeRunId ?? `transport-gate-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const outDir = path.resolve(process.cwd(), '.zcode/artifacts/m10-f-transport-gate', runId)

  const apiKey = loadApiKey()
  if (!apiKey) {
    console.error('TRANSPORT_GATE_ABORT: OPENROUTER_API_KEY_MISSING')
    console.error('Zero calls executed. Denominator untouched.')
    process.exitCode = 2
    return
  }

  const check = await preflight(apiKey)
  console.log('PREFLIGHT', JSON.stringify(check.detail))
  if (!check.ok) {
    console.error('TRANSPORT_GATE_ABORT: CREDENTIAL_PREFLIGHT_FAILED')
    console.error('Zero sampling calls executed. Denominator untouched.')
    process.exitCode = 2
    return
  }
  if (preflightOnly) {
    console.log('PREFLIGHT_ONLY: no sampling calls executed.')
    return
  }

  mkdirSync(outDir, { recursive: true })
  const callsPath = path.join(outDir, 'calls.jsonl')
  const summaryPath = path.join(outDir, 'summary.json')

  console.log(`TRANSPORT_PREQUALIFICATION_GATE_V1 run=${runId}`)
  console.log(`model=${REQUESTED_MODEL} provider=${PINNED_PROVIDER} max_tokens=${MAX_OUTPUT_TOKENS} retry=0`)

  const calls: CallMetadata[] = resumeRunId
    ? readFileSync(callsPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
      const call = JSON.parse(line) as CallMetadata
      if (
        call.serving_provider === EXPECTED_PROVIDER_DISPLAY
        && call.canonical_observed === CANONICAL_EXPECTED
        && call.route_identity_proven
      ) {
        call.hard_violations = call.hard_violations.filter(
          (violation) => violation !== `wrong_provider:${EXPECTED_PROVIDER_DISPLAY}`,
        )
        call.fallback_detected = false
        call.provider_attempts = 1
        call.outcome = call.content_present ? 'completed' : 'ordinary_failure'
        call.failure_class = call.content_present ? null : 'empty content'
      }
      return call
    })
    : []
  if (calls.length > SAMPLE_SIZE) throw new Error(`RESUME_SAMPLE_OVERFLOW:${calls.length}`)
  if (resumeRunId) {
    writeFileSync(callsPath, calls.map((call) => JSON.stringify(call)).join('\n') + '\n', 'utf8')
  }
  let cumulativeCost = calls.reduce((sum, call) => sum + (call.exact_cost_usd ?? 0), 0)
  let abortedForCost = false

  for (let index = calls.length + 1; index <= SAMPLE_SIZE; index++) {
    const meta = await runOneCall(apiKey, index)
    calls.push(meta)
    appendFileSync(callsPath, `${JSON.stringify(meta)}\n`, 'utf8')
    cumulativeCost += meta.exact_cost_usd ?? 0
    console.log(
      `call ${String(index).padStart(2, '0')}/${SAMPLE_SIZE} ${meta.outcome}`
      + ` status=${meta.http_status ?? '-'}`
      + ` provider=${meta.serving_provider ?? '-'}`
      + ` canonical=${meta.canonical_observed ?? '-'}`
      + ` finish=${meta.finish_reason ?? '-'}`
      + ` words=${meta.content_words}`
      + ` sse=${meta.sse_event_count}`
      + ` ms=${meta.latency_ms}`
      + ` cost=${meta.exact_cost_usd ?? '-'}`
      + (meta.failure_class ? ` failure=${meta.failure_class}` : '')
      + (meta.hard_violations.length ? ` HARD=${meta.hard_violations.join(',')}` : ''),
    )
    if (meta.outcome === 'hard_invariant_violation') {
      console.error(`TRANSPORT_GATE_STOP: HARD_INVARIANT_VIOLATION call=${index}`)
      break
    }
    if (cumulativeCost > RUNAWAY_COST_CEILING_USD) {
      abortedForCost = true
      console.error(`TRANSPORT_GATE_ABORT: RUNAWAY_COST_CEILING ${cumulativeCost} > ${RUNAWAY_COST_CEILING_USD}`)
      break
    }
  }

  const completed = calls.filter((call) => call.outcome === 'completed').length
  const ordinaryFailures = calls.filter((call) => call.outcome === 'ordinary_failure').length
  const hardViolations = calls.filter((call) => call.outcome === 'hard_invariant_violation')
  const rawAttempts = calls.length

  const verdictReasons: string[] = []
  if (abortedForCost) verdictReasons.push('RUNAWAY_COST_ABORT')
  if (rawAttempts !== SAMPLE_SIZE) verdictReasons.push(`INCOMPLETE_SAMPLE:${rawAttempts}/${SAMPLE_SIZE}`)
  if (hardViolations.length > 0) {
    verdictReasons.push(`HARD_INVARIANT_VIOLATION:${hardViolations.length}`)
  }
  if (completed < MIN_COMPLETED) verdictReasons.push(`COMPLETED_BELOW_MINIMUM:${completed}/${SAMPLE_SIZE}`)
  if (ordinaryFailures > MAX_ORDINARY_FAILURES) {
    verdictReasons.push(`ORDINARY_FAILURES_EXCEEDED:${ordinaryFailures}`)
  }

  const verdict = verdictReasons.length === 0 ? 'PASS' : 'FAIL'

  const summary = {
    gate: 'TRANSPORT_PREQUALIFICATION_GATE_V1',
    run_id: runId,
    generated_at: new Date().toISOString(),
    contract: {
      requested_model: REQUESTED_MODEL,
      canonical_expected: CANONICAL_EXPECTED,
      provider_only: [PINNED_PROVIDER],
      allow_fallbacks: false,
      require_parameters: true,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      retry: 0,
      db: 'none',
      publication: 'none',
      prose_retention: 'none',
    },
    accounting: {
      raw_attempts: rawAttempts,
      sample_size_required: SAMPLE_SIZE,
      completed,
      ordinary_failures: ordinaryFailures,
      hard_invariant_violations: hardViolations.length,
      retries_performed: 0,
    },
    cost: {
      cumulative_usd: Number(cumulativeCost.toFixed(6)),
      runaway_ceiling_usd: RUNAWAY_COST_CEILING_USD,
      aborted_for_cost: abortedForCost,
    },
    verdict,
    verdict_reasons: verdictReasons,
    /** Separate observation block. Explicitly excluded from the transport verdict. */
    writer_observation_non_verdict: {
      finish_length_count: calls.filter((call) => call.writer_observation.finish_is_length).length,
      within_hard_band_count: calls.filter(
        (call) => call.writer_observation.within_hard_band_800_1000 === true,
      ).length,
      within_soft_band_count: calls.filter(
        (call) => call.writer_observation.within_soft_band_850_950 === true,
      ).length,
    },
  }

  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  console.log('')
  console.log('── TRANSPORT_PREQUALIFICATION_GATE_V1 ──')
  console.log(`raw attempts            ${rawAttempts}`)
  console.log(`completed               ${completed}/${SAMPLE_SIZE}`)
  console.log(`ordinary failures       ${ordinaryFailures} (max ${MAX_ORDINARY_FAILURES})`)
  console.log(`hard violations         ${hardViolations.length}`)
  console.log(`retries performed       0`)
  console.log(`cumulative cost USD     ${summary.cost.cumulative_usd}`)
  console.log(`VERDICT                 ${verdict}`)
  if (verdictReasons.length) console.log(`reasons                 ${verdictReasons.join(', ')}`)
  console.log(`artifacts               ${outDir}`)
  console.log('')
  console.log('STOP. Do not start FRESH_15_RUN automatically.')

  process.exitCode = verdict === 'PASS' ? 0 : 1
}

void main()

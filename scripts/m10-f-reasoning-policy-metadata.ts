/**
 * M10-F reasoning-policy metadata probe (READ-ONLY).
 *
 * Performs exactly ONE authenticated GET against OpenRouter's public model
 * catalog and reports the reasoning-related metadata for two pinned ids.
 *
 * Hard invariants (must not be edited to make a run "work"):
 *   - Endpoint            GET https://openrouter.ai/api/v1/models  (metadata only)
 *   - Inference calls     none. No /chat/completions, no /completions, no stream.
 *   - Token spend         zero. The catalog endpoint bills nothing.
 *   - DB                  none. This file imports nothing from lib/.
 *   - Credentials         read from process.env.OPENROUTER_API_KEY, never printed,
 *                         never persisted into the artifact.
 *   - Fail closed         missing key => abort with process.exitCode, zero requests.
 *
 * Reported per pinned id: id, context_length, top_provider.max_completion_tokens,
 * supported_parameters, and every field present on the model's `reasoning`
 * object (default_enabled, default_effort, mandatory, supported_efforts,
 * supports_max_tokens) plus the raw reasoning-related JSON subset.
 *
 * If a pinned id is absent from the catalog, the run reports it as ABSENT and
 * lists the closest matching ids instead of guessing a substitute.
 *
 * Usage:
 *   node scripts/run-smoke.cjs scripts/m10-f-reasoning-policy-metadata.ts
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

const TARGET_IDS = [
  'deepseek/deepseek-v4-pro-0813',
  'meta/muse-spark-1.2-contributor',
] as const

/** Reasoning-object fields the policy work cares about, in report order. */
const REASONING_FIELDS = [
  'default_enabled',
  'default_effort',
  'mandatory',
  'supported_efforts',
  'supports_max_tokens',
] as const

const ARTIFACT_DIR = path.resolve(
  process.cwd(),
  '.zcode/artifacts/m10-f-reasoning-policy/2026-09-01-openrouter-models-metadata',
)

type Json = Record<string, unknown>

type ModelReport = {
  requested_id: string
  present: boolean
  id: string | null
  context_length: number | null
  top_provider_max_completion_tokens: number | null
  supported_parameters: string[] | null
  reasoning_object_present: boolean
  reasoning_fields: Record<string, unknown>
  reasoning_extra_fields: string[]
  raw_reasoning_subset: Json | null
  closest_ids: string[]
}

// ── Credential handling (never printed, never persisted) ─────────────────────

function loadApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/** Cheap similarity for absent-id reporting: shared slash/dash/dot tokens. */
function tokenize(id: string): string[] {
  return id.toLowerCase().split(/[/\-_.]+/).filter(Boolean)
}

function similarity(a: string, b: string): number {
  const left = new Set(tokenize(a))
  const right = new Set(tokenize(b))
  let shared = 0
  for (const token of left) if (right.has(token)) shared++
  const union = new Set([...left, ...right]).size
  return union === 0 ? 0 : shared / union
}

function closestIds(requested: string, allIds: string[], limit = 5): string[] {
  return allIds
    .map((id) => ({ id, score: similarity(requested, id) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((entry) => entry.id)
}

function buildReport(requestedId: string, model: Json | null, allIds: string[]): ModelReport {
  if (!model) {
    return {
      requested_id: requestedId,
      present: false,
      id: null,
      context_length: null,
      top_provider_max_completion_tokens: null,
      supported_parameters: null,
      reasoning_object_present: false,
      reasoning_fields: {},
      reasoning_extra_fields: [],
      raw_reasoning_subset: null,
      closest_ids: closestIds(requestedId, allIds),
    }
  }

  const topProvider = asRecord(model.top_provider)
  const reasoning = asRecord(model.reasoning)
  const reasoningFields: Record<string, unknown> = {}
  for (const field of REASONING_FIELDS) {
    reasoningFields[field] = reasoning && field in reasoning ? reasoning[field] : null
  }
  const extraFields = reasoning
    ? Object.keys(reasoning).filter(
      (key) => !(REASONING_FIELDS as readonly string[]).includes(key),
    )
    : []

  return {
    requested_id: requestedId,
    present: true,
    id: typeof model.id === 'string' ? model.id : null,
    context_length: asNumber(model.context_length),
    top_provider_max_completion_tokens: asNumber(topProvider?.max_completion_tokens),
    supported_parameters: asStringArray(model.supported_parameters),
    reasoning_object_present: reasoning !== null,
    reasoning_fields: reasoningFields,
    reasoning_extra_fields: extraFields,
    raw_reasoning_subset: {
      id: model.id ?? null,
      context_length: model.context_length ?? null,
      top_provider: topProvider
        ? { max_completion_tokens: topProvider.max_completion_tokens ?? null }
        : null,
      supported_parameters: model.supported_parameters ?? null,
      reasoning: reasoning ?? null,
    },
    closest_ids: [],
  }
}

function printReport(report: ModelReport): void {
  console.log('')
  console.log(`── ${report.requested_id}`)
  if (!report.present) {
    console.log('status                             ABSENT')
    console.log(
      `closest_ids                        ${report.closest_ids.length ? report.closest_ids.join(', ') : '(none)'}`,
    )
    return
  }
  console.log('status                             PRESENT')
  console.log(`id                                 ${report.id ?? 'null'}`)
  console.log(`context_length                     ${report.context_length ?? 'null'}`)
  console.log(
    `top_provider.max_completion_tokens ${report.top_provider_max_completion_tokens ?? 'null'}`,
  )
  console.log(
    `supported_parameters               ${report.supported_parameters ? JSON.stringify(report.supported_parameters) : 'null'}`,
  )
  console.log(`reasoning object present           ${report.reasoning_object_present}`)
  for (const field of REASONING_FIELDS) {
    const value = report.reasoning_fields[field]
    console.log(`reasoning.${field.padEnd(23)} ${value === null ? 'ABSENT' : JSON.stringify(value)}`)
  }
  if (report.reasoning_extra_fields.length > 0) {
    console.log(`reasoning extra fields             ${report.reasoning_extra_fields.join(', ')}`)
  }
  console.log('raw reasoning-related JSON subset:')
  console.log(JSON.stringify(report.raw_reasoning_subset, null, 2))
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = loadApiKey()
  if (!apiKey) {
    console.error('REASONING_METADATA_ABORT: OPENROUTER_API_KEY_MISSING')
    console.error('Zero requests executed.')
    process.exitCode = 2
    return
  }

  console.log('M10-F_REASONING_POLICY_METADATA_V1')
  console.log(`endpoint GET ${OPENROUTER_MODELS_URL} (metadata only, zero tokens)`)
  console.log(`targets  ${TARGET_IDS.join(', ')}`)

  let response: Response
  try {
    response = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch (error) {
    console.error('REASONING_METADATA_ABORT: REQUEST_FAILED')
    console.error(String((error as { message?: string } | null)?.message ?? error))
    process.exitCode = 2
    return
  }

  const bodyText = await response.text()
  if (!response.ok) {
    console.error(`REASONING_METADATA_ABORT: HTTP_${response.status}`)
    process.exitCode = 2
    return
  }

  let parsed: Json
  try {
    parsed = JSON.parse(bodyText) as Json
  } catch {
    console.error('REASONING_METADATA_ABORT: RESPONSE_NOT_JSON')
    process.exitCode = 2
    return
  }

  const models = Array.isArray(parsed.data) ? (parsed.data as unknown[]) : []
  if (models.length === 0) {
    console.error('REASONING_METADATA_ABORT: EMPTY_CATALOG')
    process.exitCode = 2
    return
  }

  const byId = new Map<string, Json>()
  for (const entry of models) {
    const model = asRecord(entry)
    if (model && typeof model.id === 'string') byId.set(model.id, model)
  }
  const allIds = [...byId.keys()]

  console.log(`http_status                        ${response.status}`)
  console.log(`catalog_models                     ${allIds.length}`)

  const reports = TARGET_IDS.map((id) => buildReport(id, byId.get(id) ?? null, allIds))
  for (const report of reports) printReport(report)

  const artifact = {
    probe: 'M10-F_REASONING_POLICY_METADATA_V1',
    generated_at: new Date().toISOString(),
    endpoint: OPENROUTER_MODELS_URL,
    method: 'GET',
    inference_calls: 0,
    tokens_spent: 0,
    http_status: response.status,
    catalog_models: allIds.length,
    requested_ids: [...TARGET_IDS],
    models: reports,
  }

  const artifactJson = `${JSON.stringify(artifact, null, 2)}\n`
  const sha256 = createHash('sha256').update(artifactJson, 'utf8').digest('hex')
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const artifactPath = path.join(ARTIFACT_DIR, 'raw-result.json')
  writeFileSync(artifactPath, artifactJson, 'utf8')
  writeFileSync(
    path.join(ARTIFACT_DIR, 'raw-result.json.sha256'),
    `${sha256}  raw-result.json\n`,
    'utf8',
  )

  console.log('')
  console.log(`artifact                           ${artifactPath}`)
  console.log(`artifact_sha256                    ${sha256}`)

  const missing = reports.filter((report) => !report.present)
  process.exitCode = missing.length === 0 ? 0 : 1
}

void main()

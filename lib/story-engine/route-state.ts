import { z } from 'zod'

export const ENDING_BIAS_BOUND = 100
export const MAX_EVIDENCE_ITEMS = 32

const MAX_RECORD_KEYS = 32
const MAX_KEY_LENGTH = 80
const MAX_EVIDENCE_LENGTH = 240
const MAX_THREAD_TOUCHES = 24
const MAX_THREAD_TOUCH_LENGTH = 120
const MAX_PROMPT_SUMMARY_LENGTH = 4096
const ROUTE_KEYS = ['truth', 'risk', 'secrecy', 'empathy'] as const
const FORBIDDEN_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const routeScoreSchema = z.number().int().min(0).max(20)
const routeDeltaSchema = z.number().int().min(-20).max(20)
const trustValueSchema = z.number().int().min(-10).max(10)
const trustDeltaSchema = z.number().int().min(-10).max(10)
const endingBiasValueSchema = z.number().int().min(-ENDING_BIAS_BOUND).max(ENDING_BIAS_BOUND)
const endingBiasDeltaSchema = z.number().int().min(-ENDING_BIAS_BOUND).max(ENDING_BIAS_BOUND)
const boundedNonEmptyString = (maxLength: number) => z.string().trim().min(1).max(maxLength)

function normalizedRecordSchema<T extends z.ZodType>(valueSchema: T) {
  return z.record(z.string(), valueSchema)
    .superRefine((record, context) => {
      const entries = Object.entries(record)
      if (entries.length > MAX_RECORD_KEYS) {
        context.addIssue({
          code: 'too_big',
          maximum: MAX_RECORD_KEYS,
          origin: 'object',
          inclusive: true,
          path: [],
          message: `Record cannot contain more than ${MAX_RECORD_KEYS} keys.`,
        })
      }

      const normalizedKeys = new Set<string>()
      for (const [rawKey] of entries) {
        const key = rawKey.trim()
        if (key.length === 0 || key.length > MAX_KEY_LENGTH || FORBIDDEN_RECORD_KEYS.has(key)) {
          context.addIssue({
            code: 'custom',
            path: [rawKey],
            message: `Record key must be 1..${MAX_KEY_LENGTH} safe characters after trimming.`,
          })
          continue
        }
        if (normalizedKeys.has(key)) {
          context.addIssue({
            code: 'custom',
            path: [rawKey],
            message: `Duplicate normalized record key: ${key}`,
          })
        }
        normalizedKeys.add(key)
      }
    })
    .transform((record) => Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key.trim(), value]),
    ) as Record<string, z.output<T>>)
}

const trustRecordSchema = normalizedRecordSchema(trustValueSchema)
const flagsRecordSchema = normalizedRecordSchema(z.boolean())
const endingBiasRecordSchema = normalizedRecordSchema(endingBiasValueSchema)

export const RouteStateSchema = z.object({
  truth: routeScoreSchema.default(0),
  risk: routeScoreSchema.default(0),
  secrecy: routeScoreSchema.default(0),
  empathy: routeScoreSchema.default(0),
  trust: trustRecordSchema.default({}),
  evidence: z.array(boundedNonEmptyString(MAX_EVIDENCE_LENGTH)).max(MAX_EVIDENCE_ITEMS).default([]),
  flags: flagsRecordSchema.default({}),
  endingBias: endingBiasRecordSchema.default({}),
}).strict()

const routeDeltasSchema = z.object({
  truth: routeDeltaSchema.optional(),
  risk: routeDeltaSchema.optional(),
  secrecy: routeDeltaSchema.optional(),
  empathy: routeDeltaSchema.optional(),
}).strict().default({})

export const RouteChoiceEffectSchema = z.object({
  routeDeltas: routeDeltasSchema,
  trustDeltas: normalizedRecordSchema(trustDeltaSchema).default({}),
  flagsSet: normalizedRecordSchema(z.boolean()).default({}),
  evidenceAdded: z.array(boundedNonEmptyString(MAX_EVIDENCE_LENGTH)).max(MAX_EVIDENCE_ITEMS).default([]),
  endingBiasDeltas: normalizedRecordSchema(endingBiasDeltaSchema).default({}),
  threadTouches: z.array(boundedNonEmptyString(MAX_THREAD_TOUCH_LENGTH)).max(MAX_THREAD_TOUCHES).default([]),
}).strict()

export type RouteState = z.infer<typeof RouteStateSchema>
export type RouteChoiceEffect = z.infer<typeof RouteChoiceEffectSchema>

const DEFAULT_ROUTE_STATE: RouteState = RouteStateSchema.parse({})

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizeInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
    ? clamp(value, minimum, maximum)
    : fallback
}

function normalizeRecord<T>(
  value: unknown,
  normalizeValue: (item: unknown) => T | undefined,
): Record<string, T> {
  if (!isPlainRecord(value)) return {}

  const normalizedEntries: Array<[string, T]> = []
  const seen = new Set<string>()
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (normalizedEntries.length >= MAX_RECORD_KEYS) break
    const key = rawKey.trim()
    if (
      key.length === 0
      || key.length > MAX_KEY_LENGTH
      || FORBIDDEN_RECORD_KEYS.has(key)
      || seen.has(key)
    ) continue

    const normalizedValue = normalizeValue(rawValue)
    if (normalizedValue === undefined) continue
    seen.add(key)
    normalizedEntries.push([key, normalizedValue])
  }
  return Object.fromEntries(normalizedEntries)
}

function normalizeEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const evidence: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const normalized = item.trim()
    if (
      normalized.length === 0
      || normalized.length > MAX_EVIDENCE_LENGTH
      || seen.has(normalized)
    ) continue
    seen.add(normalized)
    evidence.push(normalized)
    if (evidence.length >= MAX_EVIDENCE_ITEMS) break
  }
  return evidence
}

export function normalizeRouteState(input: unknown): RouteState {
  if (!isPlainRecord(input)) return structuredClone(DEFAULT_ROUTE_STATE)

  return RouteStateSchema.parse({
    truth: normalizeInteger(input.truth, 0, 20, 0),
    risk: normalizeInteger(input.risk, 0, 20, 0),
    secrecy: normalizeInteger(input.secrecy, 0, 20, 0),
    empathy: normalizeInteger(input.empathy, 0, 20, 0),
    trust: normalizeRecord(input.trust, (value) => (
      typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
        ? clamp(value, -10, 10)
        : undefined
    )),
    evidence: normalizeEvidence(input.evidence),
    flags: normalizeRecord(input.flags, (value) => typeof value === 'boolean' ? value : undefined),
    endingBias: normalizeRecord(input.endingBias, (value) => (
      typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
        ? clamp(value, -ENDING_BIAS_BOUND, ENDING_BIAS_BOUND)
        : undefined
    )),
  })
}

export function mergeChoiceEffect(state: unknown, effect: unknown): RouteState {
  const current = normalizeRouteState(state)
  const parsedEffect = RouteChoiceEffectSchema.parse(effect)

  const trust = { ...current.trust }
  for (const [key, delta] of Object.entries(parsedEffect.trustDeltas)) {
    trust[key] = clamp((trust[key] ?? 0) + delta, -10, 10)
  }

  const endingBias = { ...current.endingBias }
  for (const [key, delta] of Object.entries(parsedEffect.endingBiasDeltas)) {
    endingBias[key] = clamp(
      (endingBias[key] ?? 0) + delta,
      -ENDING_BIAS_BOUND,
      ENDING_BIAS_BOUND,
    )
  }

  const routeScores = Object.fromEntries(ROUTE_KEYS.map((key) => [
    key,
    clamp(current[key] + (parsedEffect.routeDeltas[key] ?? 0), 0, 20),
  ])) as Pick<RouteState, typeof ROUTE_KEYS[number]>

  return normalizeRouteState({
    ...routeScores,
    trust,
    evidence: [...current.evidence, ...parsedEffect.evidenceAdded],
    flags: { ...current.flags, ...parsedEffect.flagsSet },
    endingBias,
  })
}

function compareKeys([left]: [string, unknown], [right]: [string, unknown]): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedRecordSummary(record: Record<string, string | number | boolean>): string {
  const entries = Object.entries(record).sort(compareKeys)
  return entries.length > 0
    ? entries.map(([key, value]) => `${key}=${String(value)}`).join(', ')
    : '-'
}

export function summarizeRouteStateForPrompt(state: unknown): string {
  const normalized = normalizeRouteState(state)
  const summary = [
    `Skor rute: truth=${normalized.truth}, risk=${normalized.risk}, secrecy=${normalized.secrecy}, empathy=${normalized.empathy}`,
    `Kepercayaan: ${sortedRecordSummary(normalized.trust)}`,
    `Flag: ${sortedRecordSummary(normalized.flags)}`,
    `Bias akhir: ${sortedRecordSummary(normalized.endingBias)}`,
    `Bukti (urutan penemuan): ${normalized.evidence.length > 0 ? normalized.evidence.join(' | ') : '-'}`,
  ].join('\n')

  return summary.length <= MAX_PROMPT_SUMMARY_LENGTH
    ? summary
    : `${summary.slice(0, MAX_PROMPT_SUMMARY_LENGTH - 1)}…`
}

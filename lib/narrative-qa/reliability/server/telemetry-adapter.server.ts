import 'server-only'
import { z } from 'zod'
import { validateReliabilityObservationSet, type ReliabilityObservationSet } from '../measurements'

/**
 * Server-only telemetry boundary for M10-E. Accepts only a declared
 * discriminated source (CONTRACT_FIXTURE or GOVERNED_DISPOSABLE_LOCAL),
 * rejects production/shared/linked/unknown identities before any read seam
 * can exist, and never constructs a client, opens a socket, mutates data, or
 * calls a provider. Governed local telemetry requires an explicit isolated
 * read seam; none is authorized in this implementation, so that branch
 * reports MISSING(EXISTING_READ_SEAM_UNAVAILABLE) with zero counters.
 */

export const TELEMETRY_SOURCES = ['CONTRACT_FIXTURE', 'GOVERNED_DISPOSABLE_LOCAL'] as const
export type TelemetrySource = (typeof TELEMETRY_SOURCES)[number]

export const GOVERNED_LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', '::1', 'localhost'] as const)

const READ_SEAM_CONFIG_SCHEMA = z.strictObject({
  host: z.enum(GOVERNED_LOOPBACK_HOSTS),
  port: z.number().int().min(1024).max(65535),
  projectId: z.string().regex(/^[a-z][a-z0-9_-]{0,127}$/),
  authorizationReference: z.string().min(1),
  capabilityDeclaration: z.string().min(1),
  linked: z.literal(false),
})
export type TelemetryReadSeamConfig = z.infer<typeof READ_SEAM_CONFIG_SCHEMA>

export interface TelemetrySourceRequest {
  readonly source: TelemetrySource
  readonly readSeam: TelemetryReadSeamConfig | null
  readonly fixture: unknown
}

export interface TelemetryReadCounters {
  readonly reads: number
  readonly mutations: number
  readonly providerCalls: number
  readonly networkActions: number
}

export type TelemetryObservations =
  | Readonly<{ state: 'PRESENT'; value: ReliabilityObservationSet }>
  | Readonly<{ state: 'MISSING'; reasonCode: 'TELEMETRY_UNAVAILABLE'; detail: string }>

export interface TelemetryProjectionResult {
  readonly source: TelemetrySource
  readonly observations: TelemetryObservations
  readonly counters: TelemetryReadCounters
}

const ZERO_COUNTERS: TelemetryReadCounters = Object.freeze({ reads: 0, mutations: 0, providerCalls: 0, networkActions: 0 })

export function projectTelemetryObservations(request: TelemetrySourceRequest): TelemetryProjectionResult {
  const source = parseSource(request.source)
  const readSeam = parseReadSeam(request.readSeam)
  if (source === 'CONTRACT_FIXTURE') {
    if (readSeam !== null) throw new Error('CONTRACT_FIXTURE source never opens a read seam')
    const value = validateReliabilityObservationSet(request.fixture)
    return Object.freeze({ source, observations: Object.freeze({ state: 'PRESENT' as const, value }), counters: ZERO_COUNTERS })
  }
  if (readSeam === null) throw new Error('Governed disposable-local source requires an explicit isolated read seam')
  return Object.freeze({
    source,
    observations: Object.freeze({
      state: 'MISSING' as const,
      reasonCode: 'TELEMETRY_UNAVAILABLE' as const,
      detail: 'EXISTING_READ_SEAM_UNAVAILABLE: no authorized isolated disposable-local read seam exists in this implementation; zero reads performed',
    }),
    counters: ZERO_COUNTERS,
  })
}

function parseSource(source: TelemetrySource): TelemetrySource {
  if (source === 'CONTRACT_FIXTURE' || source === 'GOVERNED_DISPOSABLE_LOCAL') return source
  throw new Error('Unsupported telemetry source rejected before read: only CONTRACT_FIXTURE or GOVERNED_DISPOSABLE_LOCAL may be read')
}

function parseReadSeam(readSeam: TelemetryReadSeamConfig | null): TelemetryReadSeamConfig | null {
  if (readSeam === null) return null
  const parsed = READ_SEAM_CONFIG_SCHEMA.parse(readSeam)
  if (/lakoku[-_]?v2|shared|prod|production|main/i.test(parsed.projectId)) {
    throw new Error('Shared or production project identity rejected before read')
  }
  return parsed
}
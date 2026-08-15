import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { buildReliabilityObservationFixture } from './m10-e-reliability-artifact-fixture'
import {
  projectTelemetryObservations,
  type TelemetryReadSeamConfig,
} from '../../lib/narrative-qa/reliability/server'

const fixtureObservations = buildReliabilityObservationFixture()

function governed(readSeam: Record<string, unknown> = {}): TelemetryReadSeamConfig {
  return {
    host: '127.0.0.1',
    port: 54329,
    projectId: 'disposable_m10_e_evidence',
    authorizationReference: 'docs/superpowers/plans/2026-08-15-m10-e-e3a-e4-implementation-plan.md',
    capabilityDeclaration: 'READ_ONLY_OBSERVATION_QUERY',
    linked: false,
    ...readSeam,
  } as unknown as TelemetryReadSeamConfig
}

describe('M10-E telemetry adapter (server-only)', () => {
  it('accepts the contract fixture and projects strictly with zero counters', () => {
    const result = projectTelemetryObservations({ source: 'CONTRACT_FIXTURE', readSeam: null, fixture: fixtureObservations })
    expect(result.source).toBe('CONTRACT_FIXTURE')
    expect(result.observations).toEqual({ state: 'PRESENT', value: fixtureObservations })
    expect(result.counters).toEqual({ reads: 0, mutations: 0, providerCalls: 0, networkActions: 0 })
  })

  it('rejects unknown or release sources before any read', () => {
    expect(() => projectTelemetryObservations({ source: 'PRODUCTION_TELEMETRY' as never, readSeam: null, fixture: null }))
      .toThrow(/Unsupported telemetry source rejected before read/)
    expect(() => projectTelemetryObservations({ source: 'RELEASE_EVIDENCE' as never, readSeam: null, fixture: null }))
      .toThrow(/Unsupported telemetry source rejected before read/)
    expect(() => projectTelemetryObservations({ source: 'SHARED_DATABASE' as never, readSeam: null, fixture: null }))
      .toThrow(/Unsupported telemetry source rejected before read/)
  })

  it('never opens a read seam for the contract fixture', () => {
    expect(() => projectTelemetryObservations({ source: 'CONTRACT_FIXTURE', readSeam: governed(), fixture: fixtureObservations }))
      .toThrow(/CONTRACT_FIXTURE source never opens a read seam/)
  })

  it('rejects production/non-loopback read seams before read', () => {
    expect(() => projectTelemetryObservations({ source: 'GOVERNED_DISPOSABLE_LOCAL', readSeam: governed({ host: 'db.lakoku.production.internal' }), fixture: null }))
      .toThrow()
    expect(() => projectTelemetryObservations({ source: 'GOVERNED_DISPOSABLE_LOCAL', readSeam: governed({ host: '192.168.1.10' }), fixture: null }))
      .toThrow()
  })

  it('rejects shared or production project identities before read', () => {
    expect(() => projectTelemetryObservations({ source: 'GOVERNED_DISPOSABLE_LOCAL', readSeam: governed({ projectId: 'lakoku-v2' }), fixture: null }))
      .toThrow(/project identity rejected before read/)
    expect(() => projectTelemetryObservations({ source: 'GOVERNED_DISPOSABLE_LOCAL', readSeam: governed({ projectId: 'shared_ref_dev' }), fixture: null }))
      .toThrow(/project identity rejected before read/)
  })

  it('rejects linked read seams before read', () => {
    expect(() => projectTelemetryObservations({ source: 'GOVERNED_DISPOSABLE_LOCAL', readSeam: governed({ linked: true }), fixture: null }))
      .toThrow()
  })

  it('rejects generic URL/key read-seam fields before read', () => {
    expect(() => projectTelemetryObservations({ source: 'GOVERNED_DISPOSABLE_LOCAL', readSeam: { ...(governed() as Record<string, unknown>), serviceKey: 'sb-secret' } as never, fixture: null }))
      .toThrow()
    expect(() => projectTelemetryObservations({ source: 'GOVERNED_DISPOSABLE_LOCAL', readSeam: { ...(governed() as Record<string, unknown>), url: 'https://db.supabase.co' } as never, fixture: null }))
      .toThrow()
  })

  it('requires an explicit authorization reference and capability declaration', () => {
    expect(() => projectTelemetryObservations({ source: 'GOVERNED_DISPOSABLE_LOCAL', readSeam: governed({ authorizationReference: '' }), fixture: null }))
      .toThrow()
    expect(() => projectTelemetryObservations({ source: 'GOVERNED_DISPOSABLE_LOCAL', readSeam: governed({ capabilityDeclaration: '' }), fixture: null }))
      .toThrow()
  })

  it('reports MISSING(EXISTING_READ_SEAM_UNAVAILABLE) with zero counters when no authorized seam exists', () => {
    const result = projectTelemetryObservations({ source: 'GOVERNED_DISPOSABLE_LOCAL', readSeam: governed(), fixture: null })
    expect(result.observations).toEqual({
      state: 'MISSING',
      reasonCode: 'TELEMETRY_UNAVAILABLE',
      detail: expect.stringContaining('EXISTING_READ_SEAM_UNAVAILABLE') as unknown as string,
    })
    expect(result.counters).toEqual({ reads: 0, mutations: 0, providerCalls: 0, networkActions: 0 })
  })

  it('rejects raw payload fields that strict schemas cannot prove (user/story/job/correlation ids)', () => {
    const leaked = { ...fixtureObservations, userId: 'usr_01HXKZ' }
    expect(() => projectTelemetryObservations({ source: 'CONTRACT_FIXTURE', readSeam: null, fixture: leaked }))
      .toThrow()
  })

  it('rejects missing fields inferred from outcome or converted to zero', () => {
    const inferred = structuredClone(fixtureObservations)
    const chapter = inferred.chapterExecutions[0]!
    chapter.generationCost = { state: 'PRESENT', value: '0.00000000' } as never
    expect(() => projectTelemetryObservations({ source: 'CONTRACT_FIXTURE', readSeam: null, fixture: inferred }))
      .toThrow()
  })

  it('never returns aggregate, gate, model, or payloadeable artifacts', () => {
    const result = projectTelemetryObservations({ source: 'CONTRACT_FIXTURE', readSeam: null, fixture: fixtureObservations })
    expect(Object.keys(result).sort()).toEqual(['counters', 'observations', 'source'])
    expect(result.observations.state === 'PRESENT' ? Object.keys(result.observations.value) : []).not.toContain('aggregate')
    expect(JSON.stringify(result)).not.toMatch(/aggregate|engineeringGate|budgetGate|modelOutput/)
  })

  it('source guard: server-only boundary without gate/aggregate/model/provider/runtime/client dependencies', () => {
    const adapterPath = resolve(__dirname, '../../lib/narrative-qa/reliability/server/telemetry-adapter.server.ts')
    const source = readFileSync(adapterPath, 'utf8')
    expect(source).toContain("import 'server-only'")
    for (const forbidden of [
      "'../gate'",
      "'../aggregation'",
      "'../cumulative-model'",
      "'../pricing'",
      "'../cost-distributions'",
      "ai-gateway",
      "runtime",
      "createClient",
      "supabase",
      ".insert(",
      ".update(",
      ".delete(",
      ".upsert(",
      "rpc(",
      "fetch(",
      "require(",
    ]) {
      expect(source, `adapter must not reference ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('barrel re-exports only the server-only telemetry boundary', () => {
    const serverSource = readFileSync(resolve(__dirname, '../../lib/narrative-qa/reliability/server.ts'), 'utf8')
    expect(serverSource).toContain("./server/telemetry-adapter.server")
    expect(serverSource).not.toMatch(/from '\.\/(gate|aggregation|artifacts|report|index|model)/)
  })

  it('barrel projection determinism: identical requests produce identical results', () => {
    const first = projectTelemetryObservations({ source: 'CONTRACT_FIXTURE', readSeam: null, fixture: fixtureObservations })
    const second = projectTelemetryObservations({ source: 'CONTRACT_FIXTURE', readSeam: null, fixture: fixtureObservations })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first.observations.state === 'PRESENT' ? first.observations.value : null)
      .toEqual(second.observations.state === 'PRESENT' ? second.observations.value : null)
  })
})
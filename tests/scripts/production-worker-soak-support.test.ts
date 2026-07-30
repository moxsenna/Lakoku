import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createLocalRpcDiagnosticFetch,
  createOutboundNetworkSentinel,
  createProgrammableCandidateTransport,
  immutableProductionJobScript,
  pollUntilBounded,
  restartFixtureIndex,
  terminateChildBounded,
  createScenarioRegistry,
  withDeadline,
  createProviderLoadMetrics,
  createChoiceGateMetrics,
  deterministicFailureSchedule,
  productionScriptFor,
  readAndValidateEvidence,
  sanitizeEvidenceValue,
} from '../../scripts/production-worker-soak-support'

function observed(text: string) {
  return { text: Promise.resolve(text), usage: Promise.resolve({}), finalStep: Promise.resolve({ response: {}, providerMetadata: {} }) }
}

describe('production worker soak support', () => {
  it('never delegates candidate execution and returns scripted observed responses', async () => {
    const execute = vi.fn(() => { throw new Error('outbound forbidden') })
    const script = immutableProductionJobScript({
      prose: [{ outcome: 'valid', text: 'JUDUL: Bab Uji\n\nIsi.' }],
      choices: [{ outcome: 'TIMEOUT' }, { outcome: 'valid', text: '{"question":"Pilihan apa yang harus diambil sekarang?","actions":[]}' }],
    })
    const transport = createProgrammableCandidateTransport(script, observed)

    const prose = transport({ kind: 'prose', providerId: 'gateway', modelId: 'local/prose', fallbackIndex: 0, execute }) as ReturnType<typeof observed>
    await expect(prose.text).resolves.toContain('Bab Uji')
    expect(() => transport({ kind: 'choice', providerId: 'gateway', modelId: 'local/choice-a', fallbackIndex: 0, execute })).toThrow(/TIMEOUT/)
    expect(execute).not.toHaveBeenCalled()
  })

  it('reports exhausted candidate kind and offset', () => {
    const transport = createProgrammableCandidateTransport(
      immutableProductionJobScript({ prose: [], choices: [] }),
      observed,
    )

    expect(() => transport({
      kind: 'choice',
      providerId: 'gateway',
      modelId: 'local/choice-a',
      fallbackIndex: 0,
      execute: vi.fn(),
    })).toThrow('PROGRAMMED_CHOICE_EXHAUSTED_AT_0')
  })

  it('freezes scripts recursively', () => {
    const script = immutableProductionJobScript({ prose: [{ outcome: 'valid', text: 'x' }], choices: [] })
    expect(Object.isFrozen(script)).toBe(true)
    expect(Object.isFrozen(script.prose)).toBe(true)
    expect(Object.isFrozen(script.prose[0])).toBe(true)
  })

  it('outbound sentinel allows loopback and rejects external fetch', async () => {
    const localFetch = vi.fn(async () => new Response('ok'))
    const sentinel = createOutboundNetworkSentinel(localFetch)
    await expect(sentinel('http://127.0.0.1:55321/rest/v1/')).resolves.toBeInstanceOf(Response)
    await expect(sentinel('https://api.openai.com/v1/chat')).rejects.toThrow(/outbound network blocked/i)
    expect(localFetch).toHaveBeenCalledTimes(1)
  })

  it('captures bounded V4 RPC error details only for loopback responses', async () => {
    const report = vi.fn()
    const delegate = vi.fn(async () => new Response(JSON.stringify({
      code: 'XX000',
      message: 'operator does not exist: uuid = text',
      details: 'x'.repeat(800),
      hint: 'secret hint',
    }), { status: 400, headers: { 'content-type': 'application/json' } }))
    const diagnosticFetch = createLocalRpcDiagnosticFetch(delegate, report)

    await diagnosticFetch('http://127.0.0.1:55321/rest/v1/rpc/publish_generation_job_chapter_v4', { method: 'POST' })

    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      code: 'XX000',
      message: 'operator does not exist: uuid = text',
    }))
    expect(JSON.stringify(report.mock.calls)).not.toContain('secret hint')
    expect(JSON.stringify(report.mock.calls).length).toBeLessThan(700)
  })

  it('does not inspect successful, external, or unrelated RPC responses', async () => {
    const report = vi.fn()
    const delegate = vi.fn(async () => new Response('{"message":"hidden"}', { status: 400 }))
    const diagnosticFetch = createLocalRpcDiagnosticFetch(delegate, report)

    await diagnosticFetch('https://example.com/rest/v1/rpc/publish_generation_job_chapter_v4')
    await diagnosticFetch('http://127.0.0.1:55321/rest/v1/rpc/other_rpc')

    expect(report).not.toHaveBeenCalled()
  })

  it('reserves restart fixture outside ordinary publication workers', () => {
    expect(restartFixtureIndex(2)).toBe(0)
    expect(restartFixtureIndex(10)).toBe(0)
  })

  it('returns measured child exit signal and forced termination state', async () => {
    let exit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined
    const child = {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
      once: vi.fn((event: string, callback: typeof exit) => { if (event === 'exit') exit = callback }),
    }

    const pending = terminateChildBounded(child as never, 100)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(exit).toBeTypeOf('function')
    exit?.(null, 'SIGKILL')
    await expect(pending).resolves.toEqual({ signal: 'SIGKILL', exitCode: null, forced: true })
  })

  it('defines full deterministic failures with eventual success paths', () => {
    const schedule = deterministicFailureSchedule('JUDUL: Bab\n\nIsi.', '{"question":"Pilih?","actions":[]}', false)
    const outcomes = [...schedule.prose, ...schedule.choices].map((candidate) => candidate.outcome)
    expect(outcomes).toEqual(expect.arrayContaining([
      'TIMEOUT', 'RATE_LIMITED', 'HTTP_5XX', 'NETWORK_ERROR', 'INVALID_JSON',
      'SCHEMA_INVALID', 'UNGROUNDED', 'NON_DISTINCT', 'valid',
    ]))
    expect(schedule.prose.at(-1)?.outcome).toBe('valid')
    expect(schedule.choices.at(-1)?.outcome).toBe('valid')
  })

  it('exports production scriptFor with every required failure and eventual valid fallback', () => {
    const validChoices = JSON.stringify({
      question: 'Pilih?',
      actions: [
        { label: 'Periksa arsip', intent: 'INVESTIGATE' },
        { label: 'Temui ayah', intent: 'CONNECT' },
      ],
    })
    const schedule = productionScriptFor('story-a', 3, false, 'JUDUL: Bab\n\nIsi.', validChoices)
    expect([...schedule.prose, ...schedule.choices].map((candidate) => candidate.outcome)).toEqual([
      'NETWORK_ERROR', 'valid', 'NON_DISTINCT', 'valid',
    ])
    expect(schedule.prose.at(-1)).toEqual(expect.objectContaining({ outcome: 'valid' }))
    expect(schedule.choices.at(-1)).toEqual(expect.objectContaining({ outcome: 'valid' }))
    const invalid = JSON.parse(schedule.choices[0]?.text ?? '{}') as { actions: unknown[] }
    expect(invalid.actions).toHaveLength(2)
    expect((invalid.actions[0] as { intent: string }).intent).toBe((invalid.actions[1] as { intent: string }).intent)
    expect((invalid.actions[0] as { consequence: string }).consequence).toBe((invalid.actions[1] as { consequence: string }).consequence)
    expect(schedule.choices[0]?.text).not.toBe(validChoices)
  })

  it('registry returns invalid candidate text to downstream validators and throws only transport failures', async () => {
    const registry = createScenarioRegistry('run-validator', 20)
    registry.add({
      storyId: 'story-a',
      jobId: 'job-a',
      script: immutableProductionJobScript({
        prose: [],
        choices: [
          { outcome: 'INVALID_JSON', text: '{not-json' },
          { outcome: 'SCHEMA_INVALID', text: '{}' },
          { outcome: 'UNGROUNDED', text: '{"question":"Q?","actions":[]}' },
          { outcome: 'NON_DISTINCT', text: '{"question":"Q?","actions":[]}' },
          { outcome: 'RATE_LIMITED' },
        ],
      }),
    })
    const transport = registry.transport('story-a', 'job-a', observed)
    const candidate = { kind: 'choice' as const, providerId: 'provider-a', modelId: 'model-a', fallbackIndex: 0, execute: vi.fn() }

    for (const expected of ['{not-json', '{}', '{"question":"Q?","actions":[]}', '{"question":"Q?","actions":[]}']) {
      const result = transport(candidate) as ReturnType<typeof observed>
      await expect(result.text).resolves.toBe(expected)
    }
    expect(() => transport(candidate)).toThrow(/429 rate limited/)
    expect(candidate.execute).not.toHaveBeenCalled()
    expect(registry.snapshot()[0]?.metadata).toEqual(expect.arrayContaining([
      expect.objectContaining({ programmedResult: 'INVALID_JSON', observedResult: 'TEXT_RETURNED' }),
      expect.objectContaining({ programmedResult: 'RATE_LIMITED', observedResult: 'TRANSPORT_ERROR' }),
    ]))
  })

  it('persists validated evidence and fails closed on corruption or write failure', () => {
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakoku-evidence-'))
    const registry = createScenarioRegistry('run-a', 2, artifactDir)
    registry.add({ storyId: 'story-a', jobId: 'job-a', script: immutableProductionJobScript({ prose: [], choices: [{ outcome: 'valid', text: 'a' }] }) })
    registry.transport('story-a', 'job-a', observed)({ kind: 'choice', providerId: 'provider-a', modelId: 'model-a', fallbackIndex: 0, execute: vi.fn() })
    const evidence = readAndValidateEvidence(artifactDir, 'run-a', new Set(['story-a\u0000job-a']))
    expect(evidence.recordCount).toBe(1)
    expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/)

    const processEvidence = fs.readdirSync(artifactDir).find((name) => name.startsWith('soak-evidence-run-a-'))!
    fs.appendFileSync(path.join(artifactDir, processEvidence), '{broken\n')
    expect(() => readAndValidateEvidence(artifactDir, 'run-a', new Set(['story-a\u0000job-a']))).toThrow(/invalid evidence/i)

    const blocked = path.join(artifactDir, 'blocked')
    fs.writeFileSync(blocked, 'not a directory')
    expect(() => createScenarioRegistry('run-b', 1, blocked)).toThrow()
  })

  it('tracks real choice gate active and queued maxima per provider', () => {
    const metrics = createChoiceGateMetrics()
    metrics.observe({ providerId: 'custom', active: 2, queued: 3 })
    metrics.observe({ providerId: 'custom', active: 1, queued: 0 })
    metrics.observe({ providerId: '9router', active: 1, queued: 0 })
    expect(metrics.snapshot()).toEqual({
      custom: { maxActive: 2, maxQueued: 3 },
      '9router': { maxActive: 1, maxQueued: 0 },
    })
  })

  it('bounds and sanitizes evidence fields', () => {
    const sanitized = sanitizeEvidenceValue('token=secret\nBearer abcdefghijklmnopqrstuvwxyz', 24)
    expect(sanitized.length).toBeLessThanOrEqual(24)
    expect(sanitized).not.toMatch(/secret|Bearer|abcdef/i)
  })

  it('bounds production polling', async () => {
    await expect(pollUntilBounded(async () => null, { timeoutMs: 20, intervalMs: 2, label: 'terminal job' }))
      .rejects.toThrow('terminal job timed out')
  })

  it('enforces hard operation deadlines', async () => {
    await expect(withDeadline(new Promise(() => undefined), 20, 'job x')).rejects.toThrow('job x timed out')
  })

  it('keys immutable scenarios by run, story, and job with independent cursors and bounded metadata', () => {
    const registry = createScenarioRegistry('run-a', 2, undefined)
    registry.add({ storyId: 'story-a', jobId: 'job-a', script: immutableProductionJobScript({ prose: [], choices: [{ outcome: 'valid', text: 'a' }] }) })
    registry.add({ storyId: 'story-b', jobId: 'job-b', script: immutableProductionJobScript({ prose: [], choices: [{ outcome: 'valid', text: 'b' }] }) })
    const a = registry.transport('story-a', 'job-a', observed)
    const b = registry.transport('story-b', 'job-b', observed)
    const candidate = { kind: 'choice' as const, providerId: 'provider-a', modelId: 'model-a', fallbackIndex: 0, execute: vi.fn() }
    a(candidate)
    b({ ...candidate, providerId: 'provider-b' })

    expect(registry.snapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: 'run-a', storyId: 'story-a', jobId: 'job-a', cursor: { prose: 0, choice: 1 } }),
      expect.objectContaining({ runId: 'run-a', storyId: 'story-b', jobId: 'job-b', cursor: { prose: 0, choice: 1 } }),
    ]))
    expect(Object.isFrozen(registry.snapshot()[0])).toBe(true)
    expect(registry.snapshot()[0]?.metadata).toHaveLength(1)
    expect(registry.snapshot()[0]?.metadata[0]).toEqual(expect.objectContaining({ provider: 'provider-a', candidate: 'model-a', phase: 'choice', attempt: 1, programmedResult: 'valid', observedResult: 'TEXT_RETURNED', fallback: 0 }))
  })

  it('observes concurrent provider load without imposing scheduling', async () => {
    const metrics = createProviderLoadMetrics()
    let releaseA!: () => void
    const delayedA = new Promise<void>((resolve) => { releaseA = resolve })
    const a1 = metrics.run('provider-a', () => delayedA, { phase: 'choice', fallback: 0 })
    const a2 = metrics.run('provider-a', () => delayedA, { phase: 'choice', fallback: 0 })
    const b = metrics.run('provider-b', async () => undefined, { phase: 'choice', fallback: 1 })
    await Promise.resolve()
    expect(metrics.snapshot()).toEqual(expect.objectContaining({
      'provider-a': expect.objectContaining({ active: 2, maxActive: 2 }),
      'provider-b': expect.objectContaining({ maxActive: 1 }),
    }))
    releaseA()
    await Promise.all([a1, a2, b])
    expect(metrics.snapshot()['provider-a']).toEqual(expect.objectContaining({ active: 0, maxActive: 2 }))
    expect(metrics.events()).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'provider-b', phase: 'choice', fallback: 1, outcome: 'success' }),
    ]))
  })


  it('bounds scenario metadata', () => {
    const registry = createScenarioRegistry('run-a', 1, undefined)
    registry.add({ storyId: 'story-a', jobId: 'job-a', script: immutableProductionJobScript({ prose: [], choices: [{ outcome: 'valid', text: 'a' }, { outcome: 'valid', text: 'b' }] }) })
    const transport = registry.transport('story-a', 'job-a', observed)
    const base = { kind: 'choice' as const, providerId: 'provider-a', modelId: 'model-a', fallbackIndex: 0, execute: vi.fn() }
    transport(base)
    transport(base)
    expect(registry.snapshot()[0]?.metadata).toHaveLength(1)
  })
})

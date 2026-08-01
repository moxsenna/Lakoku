import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ adminFactory: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))

const JOB_ID = '11111111-1111-4111-8111-111111111111'
const CLAIM_TOKEN = '22222222-2222-4222-8222-222222222222'
const LEASE_ID = '33333333-3333-4333-8333-333333333333'
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444'
const CORRELATION_ID = '55555555-5555-4555-8555-555555555555'

function jobContext() {
  return {
    jobId: JOB_ID,
    workerId: 'worker-a',
    claimToken: CLAIM_TOKEN,
    leaseId: LEASE_ID,
    attemptNumber: 2,
    correlationId: CORRELATION_ID,
    generationKind: 'standard' as const,
    deadlineAt: '2099-01-01T00:00:00.000Z',
    deadlineAtMs: Date.parse('2099-01-01T00:00:00.000Z'),
    signal: new AbortController().signal,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('worker checkpoint persistence', () => {
  it('upserts through exact fenced RPC with current ownership identity', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        result: 'UPDATED',
        changed: true,
        checkpoint: { attempt_id: ATTEMPT_ID, prose_fingerprint: 'fp' },
      },
      error: null,
    })
    const from = vi.fn()
    mocks.adminFactory.mockReturnValue({ rpc, from })
    const { persistProseReadyCheckpoint } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    await expect(persistProseReadyCheckpoint({
      storyId: 'story-a',
      chapterNumber: 3,
      attemptId: ATTEMPT_ID,
      correlationId: CORRELATION_ID,
      title: 'Bab Tiga',
      paragraphs: ['Paragraf.'],
      proseAttemptCount: 2,
      canonVersion: 7,
      blueprintVersion: 4,
      directionFingerprint: '0123456789abcdef0123456789abcdef',
      generationMode: 'standard',
      generationPolicyVersion: 2,
      promptContractVersion: 2,
      jobId: JOB_ID,
      jobAttemptNumber: 1,
      jobContext: jobContext(),
    })).resolves.toEqual({
      ok: true,
      outcome: 'CREATED',
      checkpointAttemptId: ATTEMPT_ID,
    })

    expect(from).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('upsert_generation_checkpoint_fenced_v1', {
      p_job_id: JOB_ID,
      p_worker_id: 'worker-a',
      p_claim_token: CLAIM_TOKEN,
      p_lease_id: LEASE_ID,
      p_story_id: 'story-a',
      p_chapter_number: 3,
      p_title: 'Bab Tiga',
      p_paragraphs: ['Paragraf.'],
      p_prose_fingerprint: expect.stringMatching(/^[a-f0-9]{32}$/),
      p_audit_signals: null,
      p_audit_signals_version: null,
      p_canon_version: 7,
      p_blueprint_version: 4,
      p_direction_fingerprint: '0123456789abcdef0123456789abcdef',
      p_generation_mode: 'standard',
      p_generation_policy_version: 2,
      p_prompt_contract_version: 2,
      p_prose_attempt_count: 2,
    })
  })

  it('persists personalized audit V2 closures unchanged through fenced RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, result: 'UPDATED', changed: true },
      error: null,
    })
    mocks.adminFactory.mockReturnValue({ rpc, from: vi.fn() })
    const { persistProseReadyCheckpoint } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )
    const context = { ...jobContext(), generationKind: 'personalized' as const }
    const auditSignals = {
      opensNewThread: false,
      opensMajorMystery: false,
      opensNewConflict: false,
      closesPlotDebts: [{ debtId: 'main_mystery', closureForm: 'RESOLVED' as const }],
    }

    await persistProseReadyCheckpoint({
      storyId: 'story-a',
      chapterNumber: 48,
      attemptId: JOB_ID,
      correlationId: CORRELATION_ID,
      title: 'Bab Empat Puluh Delapan',
      paragraphs: ['Maya menutup utang misteri utama.'],
      auditSignals,
      auditSignalsVersion: 2,
      canonVersion: 7,
      blueprintVersion: 4,
      directionFingerprint: '0123456789abcdef0123456789abcdef',
      generationMode: 'personalized',
      generationPolicyVersion: 2,
      promptContractVersion: 2,
      jobId: JOB_ID,
      jobAttemptNumber: 2,
      jobContext: context,
    })

    expect(rpc).toHaveBeenCalledWith('upsert_generation_checkpoint_fenced_v1', expect.objectContaining({
      p_audit_signals: auditSignals,
      p_audit_signals_version: 2,
      p_generation_mode: 'personalized',
    }))
  })

  it.each([
    ['UPDATED', {
      ok: true,
      outcome: 'UPDATED',
      checkpointAttemptId: ATTEMPT_ID,
    }],
    ['OWNERSHIP_LOST', {
      ok: false,
      outcome: 'OWNERSHIP_LOST',
      errorCode: 'GENERATION_JOB_OWNERSHIP_LOST',
      disposition: 'OWNERSHIP_LOST',
    }],
    ['LEASE_INVALID', {
      ok: false,
      outcome: 'OWNERSHIP_LOST',
      errorCode: 'GENERATION_JOB_OWNERSHIP_LOST',
      disposition: 'OWNERSHIP_LOST',
    }],
    ['ATTEMPT_AHEAD', {
      ok: false,
      outcome: 'PROVENANCE_CONFLICT',
      errorCode: 'PROVENANCE_CONFLICT',
      disposition: 'TERMINAL',
    }],
    ['PROVENANCE_CONFLICT', {
      ok: false,
      outcome: 'PROVENANCE_CONFLICT',
      errorCode: 'PROVENANCE_CONFLICT',
      disposition: 'TERMINAL',
    }],
    ['INVALID_TRANSITION', {
      ok: false,
      outcome: 'INVALID_TRANSITION',
      errorCode: 'INVALID_TRANSITION',
      disposition: 'TERMINAL',
    }],
  ] as const)('adapts fenced transition outcome %s without leaking transport vocabulary', async (result, expected) => {
    const response = result === 'UPDATED'
      ? { ok: true, result, changed: false, checkpoint: { attempt_id: ATTEMPT_ID } }
      : { ok: false, result }
    const rpc = vi.fn().mockResolvedValue({ data: response, error: null })
    const from = vi.fn()
    mocks.adminFactory.mockReturnValue({ rpc, from })
    const { markCheckpointStatus } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    await expect(markCheckpointStatus({
      storyId: 'story-a',
      chapterNumber: 3,
      attemptId: ATTEMPT_ID,
      status: 'RUNNING_CHOICES',
      jobContext: jobContext(),
    })).resolves.toEqual(expected)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('transition_generation_checkpoint_fenced_v1', {
      p_job_id: JOB_ID,
      p_worker_id: 'worker-a',
      p_claim_token: CLAIM_TOKEN,
      p_lease_id: LEASE_ID,
      p_story_id: 'story-a',
      p_chapter_number: 3,
      p_checkpoint_attempt_id: ATTEMPT_ID,
      p_new_status: 'RUNNING_CHOICES',
    })
  })

  it.each([
    { code: 'PGRST205', message: 'table missing' },
    { code: 'XX000', message: 'database query failed' },
  ])('fails closed on worker checkpoint load DB error $code', async (error) => {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      gt: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      then: vi.fn((resolve: (value: unknown) => unknown) => resolve({ data: null, error })),
    }
    for (const method of ['select', 'eq', 'in', 'gt', 'order', 'limit'] as const) {
      chain[method].mockReturnValue(chain)
    }
    mocks.adminFactory.mockReturnValue({ from: vi.fn().mockReturnValue(chain), rpc: vi.fn() })
    const { loadUsableProseCheckpoint } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    await expect(loadUsableProseCheckpoint({
      storyId: 'story-a',
      chapterNumber: 3,
      jobContext: jobContext(),
    })).rejects.toThrow('WORKER_CHECKPOINT_LOAD_FAILED')
  })

  it('keeps generic checkpoint load DB errors best-effort on legacy flow', async () => {
    const error = { code: 'XX000', message: 'database query failed' }
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      gt: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      then: vi.fn((resolve: (value: unknown) => unknown) => resolve({ data: null, error })),
    }
    for (const method of ['select', 'eq', 'in', 'gt', 'order', 'limit'] as const) {
      chain[method].mockReturnValue(chain)
    }
    mocks.adminFactory.mockReturnValue({ from: vi.fn().mockReturnValue(chain), rpc: vi.fn() })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { loadUsableProseCheckpoint } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    await expect(loadUsableProseCheckpoint({
      storyId: 'story-a',
      chapterNumber: 3,
    })).resolves.toBeNull()
    expect(log).toHaveBeenCalledWith('CHECKPOINT_LOAD_FAILED', {
      storyId: 'story-a',
      chapterNumber: 3,
      code: 'XX000',
    })
    log.mockRestore()
  })

  it.each([
    ['missing', undefined],
    ['invalid', 'not-a-uuid'],
    ['mismatched', '66666666-6666-4666-8666-666666666666'],
  ] as const)('fails closed when fenced success has %s attempt_id', async (_case, attemptId) => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        result: 'UPDATED',
        changed: true,
        checkpoint: attemptId === undefined ? {} : { attempt_id: attemptId },
      },
      error: null,
    })
    mocks.adminFactory.mockReturnValue({ rpc, from: vi.fn() })
    const { markCheckpointStatus } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    await expect(markCheckpointStatus({
      storyId: 'story-a',
      chapterNumber: 3,
      attemptId: ATTEMPT_ID,
      status: 'RUNNING_CHOICES',
      jobContext: jobContext(),
    })).resolves.toEqual({
      ok: false,
      outcome: 'WRITE_FAILED',
      errorCode: 'CHECKPOINT_WRITE_FAILED',
      disposition: 'TERMINAL',
    })
  })

  it.each([
    [{ code: '08006', message: 'connection failure' }, {
      ok: false,
      outcome: 'WRITE_FAILED',
      errorCode: 'CHECKPOINT_WRITE_FAILED',
      disposition: 'RETRYABLE',
    }],
    [{ code: 'PGRST202', message: 'missing RPC' }, {
      ok: false,
      outcome: 'WRITE_FAILED',
      errorCode: 'CHECKPOINT_WRITE_FAILED',
      disposition: 'TERMINAL',
    }],
    [{ code: '42501', message: 'permission denied' }, {
      ok: false,
      outcome: 'WRITE_FAILED',
      errorCode: 'CHECKPOINT_WRITE_FAILED',
      disposition: 'TERMINAL',
    }],
  ] as const)('classifies fenced RPC error $0.code', async (error, expected) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error })
    mocks.adminFactory.mockReturnValue({ rpc, from: vi.fn() })
    const { markCheckpointStatus } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )

    await expect(markCheckpointStatus({
      storyId: 'story-a',
      chapterNumber: 3,
      attemptId: ATTEMPT_ID,
      status: 'RUNNING_CHOICES',
      jobContext: jobContext(),
    })).resolves.toEqual(expected)
  })

  it('rejects malformed fenced outcome', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { ok: false, result: 'UNKNOWN' }, error: null })
    mocks.adminFactory.mockReturnValue({ rpc, from: vi.fn() })
    const { markCheckpointStatus } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )
    const input = {
      storyId: 'story-a',
      chapterNumber: 3,
      attemptId: ATTEMPT_ID,
      status: 'RUNNING_CHOICES' as const,
      jobContext: jobContext(),
    }

    await expect(markCheckpointStatus(input)).rejects.toThrow()
  })
})

describe('legacy checkpoint persistence verifies written rows', () => {
  const LEGACY_ARGS = {
    storyId: 'story-a',
    chapterNumber: 3,
    attemptId: ATTEMPT_ID,
    correlationId: CORRELATION_ID,
  }

  function legacyUpsertClient(response: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn().mockResolvedValue(response)
    const select = vi.fn(() => ({ maybeSingle }))
    const upsert = vi.fn(() => ({ select }))
    const from = vi.fn(() => ({ upsert }))
    return { client: { from, rpc: vi.fn() }, upsert, select }
  }

  function legacyUpdateClient(response: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn().mockResolvedValue(response)
    const select = vi.fn(() => ({ maybeSingle }))
    const eq3 = vi.fn(() => ({ select }))
    const eq2 = vi.fn(() => ({ eq: eq3 }))
    const eq1 = vi.fn(() => ({ eq: eq2 }))
    const update = vi.fn(() => ({ eq: eq1 }))
    const from = vi.fn(() => ({ update }))
    return { client: { from, rpc: vi.fn() }, update, select }
  }

  async function persistLegacyProse() {
    const { persistProseReadyCheckpoint } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )
    return persistProseReadyCheckpoint({
      ...LEGACY_ARGS,
      title: 'Bab Tiga',
      paragraphs: ['Paragraf.'],
      proseAttemptCount: 1,
      canonVersion: 7,
      blueprintVersion: 4,
      directionFingerprint: '0123456789abcdef0123456789abcdef',
      generationMode: 'standard',
      generationPolicyVersion: 2,
      promptContractVersion: 2,
      jobId: null,
      jobAttemptNumber: null,
      jobContext: null,
    })
  }

  async function markLegacyStatus(status: 'RUNNING_CHOICES' | 'CHOICES_RETRY_WAIT') {
    const { markCheckpointStatus } = await import(
      '@/lib/runtime/chapter-generation-checkpoint'
    )
    return markCheckpointStatus({
      storyId: LEGACY_ARGS.storyId,
      chapterNumber: LEGACY_ARGS.chapterNumber,
      attemptId: ATTEMPT_ID,
      status,
      jobContext: null,
    })
  }

  it('treats zero-row legacy status update as terminal NOT_FOUND', async () => {
    const { client, select } = legacyUpdateClient({ data: null, error: null })
    mocks.adminFactory.mockReturnValue(client)

    await expect(markLegacyStatus('RUNNING_CHOICES')).resolves.toEqual({
      ok: false,
      outcome: 'NOT_FOUND',
      errorCode: 'CHECKPOINT_NOT_FOUND',
      disposition: 'TERMINAL',
    })
    expect(select).toHaveBeenCalled()
  })

  it('rejects legacy status update whose returned row does not match request', async () => {
    const { client } = legacyUpdateClient({
      data: { attempt_id: ATTEMPT_ID, status: 'PROSE_READY' },
      error: null,
    })
    mocks.adminFactory.mockReturnValue(client)

    await expect(markLegacyStatus('CHOICES_RETRY_WAIT')).resolves.toEqual({
      ok: false,
      outcome: 'WRITE_FAILED',
      errorCode: 'CHECKPOINT_WRITE_FAILED',
      disposition: 'TERMINAL',
    })
  })

  it('accepts legacy status update only when returned row matches exactly', async () => {
    const { client } = legacyUpdateClient({
      data: { attempt_id: ATTEMPT_ID, status: 'RUNNING_CHOICES' },
      error: null,
    })
    mocks.adminFactory.mockReturnValue(client)

    await expect(markLegacyStatus('RUNNING_CHOICES')).resolves.toEqual({
      ok: true,
      outcome: 'UPDATED',
      checkpointAttemptId: ATTEMPT_ID,
    })
  })

  it('treats legacy PROSE_READY upsert returning no row as terminal NOT_FOUND', async () => {
    const { client, select } = legacyUpsertClient({ data: null, error: null })
    mocks.adminFactory.mockReturnValue(client)

    await expect(persistLegacyProse()).resolves.toEqual({
      ok: false,
      outcome: 'NOT_FOUND',
      errorCode: 'CHECKPOINT_NOT_FOUND',
      disposition: 'TERMINAL',
    })
    expect(select).toHaveBeenCalled()
  })

  it('rejects legacy PROSE_READY upsert whose returned identity differs', async () => {
    const { client } = legacyUpsertClient({
      data: {
        story_id: LEGACY_ARGS.storyId,
        chapter_number: LEGACY_ARGS.chapterNumber,
        attempt_id: JOB_ID,
        correlation_id: CORRELATION_ID,
        status: 'PROSE_READY',
      },
      error: null,
    })
    mocks.adminFactory.mockReturnValue(client)

    await expect(persistLegacyProse()).resolves.toEqual({
      ok: false,
      outcome: 'WRITE_FAILED',
      errorCode: 'CHECKPOINT_WRITE_FAILED',
      disposition: 'TERMINAL',
    })
  })

  it('accepts legacy PROSE_READY upsert only when returned identity matches exactly', async () => {
    const { client } = legacyUpsertClient({
      data: {
        story_id: LEGACY_ARGS.storyId,
        chapter_number: LEGACY_ARGS.chapterNumber,
        attempt_id: ATTEMPT_ID,
        correlation_id: CORRELATION_ID,
        status: 'PROSE_READY',
      },
      error: null,
    })
    mocks.adminFactory.mockReturnValue(client)

    await expect(persistLegacyProse()).resolves.toEqual({
      ok: true,
      outcome: 'CREATED',
      checkpointAttemptId: ATTEMPT_ID,
    })
  })
})

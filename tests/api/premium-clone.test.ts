import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookieFactory: vi.fn(),
  adminFactory: vi.fn(),
  generate: vi.fn(),
  randomUUID: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookieFactory }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.adminFactory }))
vi.mock('@/lib/runtime/personalized-generation', () => ({
  generateNextPersonalizedChapter: mocks.generate,
}))
vi.mock('node:crypto', async () => ({
  ...await vi.importActual<typeof import('node:crypto')>('node:crypto'),
  randomUUID: mocks.randomUUID,
}))

type DbError = { message: string; code?: string }
type DbResult = { data: unknown; error: DbError | null }
type Call = {
  table?: string
  method: string
  args: unknown[]
  filters?: Array<{ method: string; args: unknown[] }>
}
type DbInput = {
  reserves?: DbResult[]
  reservation?: DbResult
  reservationSelects?: DbResult[]
  stories?: DbResult[]
  chapters?: DbResult[]
  rpcs?: DbResult[]
  updates?: DbResult[]
}

const userId = '10000000-0000-4000-8000-000000000001'
const attackerId = '20000000-0000-4000-8000-000000000002'
const templateStoryId = 'premium:rain-archive'
const idempotencyKey = 'premium-clone:nonce-1'
const uuid1 = '11111111-1111-4111-8111-111111111111'
const uuid2 = '22222222-2222-4222-8222-222222222222'
const storyId = `ai:premium:rain-archive:${uuid1}`

function hash(template = templateStoryId, owner = userId) {
  return createHash('sha256').update(JSON.stringify({
    kind: 'premium_clone', userId: owner, templateStoryId: template,
  })).digest('hex')
}
function reservation(status: 'RESERVED' | 'READY' | 'FAILED' = 'READY', requestHash = hash()) {
  return { story_id: storyId, request_hash: requestHash, status }
}
function target(overrides: Record<string, unknown> = {}) {
  return {
    id: storyId,
    owner_user_id: userId,
    visibility: 'private',
    source_story_id: templateStoryId,
    story_mode: 'premium_instance',
    ...overrides,
  }
}
function duplicate(message = 'duplicate key') : DbResult {
  return { data: null, error: { code: '23505', message } }
}
function cookie(user: { id: string } | null = { id: userId }, error: DbError | null = null) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user }, error })) } }
}

function db(input: DbInput = {}) {
  const calls: Call[] = []
  const reserves = [...(input.reserves ?? [])]
  const stories = [...(input.stories ?? [])]
  const chapters = [...(input.chapters ?? [])]
  const rpcs = [...(input.rpcs ?? [])]
  const updates = [...(input.updates ?? [])]
  const reservationSelects = [...(input.reservationSelects ?? [])]
  let existing = input.reservation

  function result(table: string, operation: string, payload: unknown): DbResult {
    if (table === 'story_creation_requests' && operation === 'insert') {
      const value = reserves.shift() ?? { data: null, error: null }
      if (!value.error) {
        const row = payload as Record<string, unknown>
        existing = { data: {
          story_id: row.story_id, request_hash: row.request_hash, status: row.status,
        }, error: null }
      }
      return value
    }
    if (table === 'story_creation_requests' && operation === 'select') {
      return reservationSelects.shift() ?? existing ?? { data: null, error: null }
    }
    if (table === 'stories' && operation === 'select') {
      return stories.shift() ?? { data: null, error: null }
    }
    if (table === 'chapters' && operation === 'select') {
      return chapters.shift() ?? { data: { story_id: storyId, number: 1 }, error: null }
    }
    if (operation === 'update') {
      const queued = updates.shift()
      if (queued) return queued
      const current = existing?.data as Record<string, unknown> | undefined
      const changed = payload as Record<string, unknown>
      const data = current ? {
        story_id: current.story_id,
        request_hash: current.request_hash,
        status: changed.status,
      } : null
      existing = { data, error: null }
      return { data, error: null }
    }
    return { data: null, error: null }
  }

  const client = {
    from: vi.fn((table: string) => {
      calls.push({ table, method: 'from', args: [] })
      let operation = 'select'
      let payload: unknown
      const filters: Array<{ method: string; args: unknown[] }> = []
      const builder: Record<string, unknown> = {}
      builder.select = vi.fn((...args: unknown[]) => {
        if (operation !== 'update') operation = 'select'
        calls.push({ table, method: 'select', args }); return builder
      })
      builder.insert = vi.fn((value: unknown) => {
        operation = 'insert'; payload = value; calls.push({ table, method: 'insert', args: [value] }); return builder
      })
      builder.update = vi.fn((value: unknown) => {
        operation = 'update'; payload = value; calls.push({ table, method: 'update', args: [value] }); return builder
      })
      for (const method of ['eq', 'in']) {
        builder[method] = vi.fn((...args: unknown[]) => {
          filters.push({ method, args }); calls.push({ table, method, args }); return builder
        })
      }
      builder.maybeSingle = vi.fn(async () => {
        calls.push({ table, method: 'execute', args: [payload], filters: [...filters] })
        return result(table, operation, payload)
      })
      builder.then = (
        ok?: (value: DbResult) => unknown,
        fail?: (reason: unknown) => unknown,
      ) => {
        calls.push({ table, method: 'execute', args: [payload], filters: [...filters] })
        return Promise.resolve(result(table, operation, payload)).then(ok, fail)
      }
      return builder
    }),
    rpc: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: 'rpc', args })
      return rpcs.shift() ?? { data: { ok: true, story_id: storyId }, error: null }
    }),
  }
  return { client, calls }
}

function req(input?: { key?: string | null; body?: unknown; raw?: string }) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (input?.key !== null) headers.set('Idempotency-Key', input?.key ?? idempotencyKey)
  return new Request(`http://localhost/api/stories/premium/${encodeURIComponent(templateStoryId)}/clone`, {
    method: 'POST', headers, body: input?.raw ?? JSON.stringify(input?.body ?? {}),
  })
}
function updatesFor(fixture: ReturnType<typeof db>, status: string) {
  return fixture.calls.filter((call) => call.table === 'story_creation_requests'
    && call.method === 'execute'
    && (JSON.stringify(call.args[0]) ?? '').includes(`"status":"${status}"`))
}
function expectConstraints(call: Call | undefined) {
  expect(call?.filters).toEqual(expect.arrayContaining([
    { method: 'eq', args: ['owner_user_id', userId] },
    { method: 'eq', args: ['request_kind', 'premium_clone'] },
    { method: 'eq', args: ['idempotency_key', idempotencyKey] },
    { method: 'eq', args: ['request_hash', hash()] },
    { method: 'eq', args: ['story_id', storyId] },
    { method: 'in', args: ['status', ['RESERVED', 'FAILED']] },
  ]))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.randomUUID.mockReturnValue(uuid1)
  mocks.cookieFactory.mockResolvedValue(cookie())
  mocks.adminFactory.mockReturnValue(db().client)
  mocks.generate.mockResolvedValue({ ok: true, chapterNumber: 1, seq: 1, repairAttempts: 0 })
})

describe('clonePremiumStoryForUser', () => {
  it('reserves exact fields and deterministic hash', async () => {
    const fixture = db(); mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })).resolves.toEqual({
      storyId, redirectUrl: `/baca/${encodeURIComponent(storyId)}?bab=1`, replayed: false,
    })
    expect(fixture.calls.find((c) => c.table === 'story_creation_requests' && c.method === 'insert')?.args[0]).toEqual({
      owner_user_id: userId, request_kind: 'premium_clone', idempotency_key: idempotencyKey,
      request_hash: hash(), story_id: storyId, status: 'RESERVED', error_code: null,
    })
  })

  it('calls clone RPC with exact named args and session user', async () => {
    const fixture = db(); mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })
    expect(fixture.client.rpc).toHaveBeenCalledWith('clone_premium_story_instance', {
      p_template_story_id: templateStoryId, p_user_id: userId, p_new_story_id: storyId,
    })
  })

  it('READY replay returns stored target and skips all work', async () => {
    const fixture = db({ reserves: [duplicate()], reservation: { data: reservation(), error: null } })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })).resolves.toMatchObject({ storyId, replayed: true })
    expect(fixture.client.rpc).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(fixture.calls.some((c) => c.table === 'stories')).toBe(false)
  })

  it('same key with changed template hash conflicts', async () => {
    const fixture = db({ reserves: [duplicate()], reservation: { data: reservation(), error: null } })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId: 'premium:other', idempotencyKey }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect(fixture.client.rpc).not.toHaveBeenCalled()
  })

  it('retries generated story ID collision when composite reservation absent', async () => {
    mocks.randomUUID.mockReturnValueOnce(uuid1).mockReturnValueOnce(uuid2)
    const second = `ai:premium:rain-archive:${uuid2}`
    const fixture = db({
      reserves: [duplicate(), { data: null, error: null }],
      reservation: { data: null, error: null },
      rpcs: [{ data: { ok: true, story_id: second }, error: null }],
      chapters: [{ data: { story_id: second, number: 1 }, error: null }],
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })).resolves.toMatchObject({ storyId: second })
    expect(mocks.randomUUID).toHaveBeenCalledTimes(2)
  })

  it.each(['RESERVED', 'FAILED'] as const)('%s replay resumes same target ID', async (status) => {
    const fixture = db({ reserves: [duplicate()], reservation: { data: reservation(status), error: null } })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })).resolves.toMatchObject({ storyId, replayed: true })
    expect(fixture.client.rpc).toHaveBeenCalledWith('clone_premium_story_instance', expect.objectContaining({ p_new_story_id: storyId }))
  })

  it('maps INVALID_TEMPLATE to narrow typed error', async () => {
    const fixture = db({ rpcs: [{ data: { ok: false, reason: 'INVALID_TEMPLATE', secret: 'row dump' }, error: null }] })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey }))
      .rejects.toMatchObject({ code: 'INVALID_TEMPLATE', message: 'INVALID_TEMPLATE' })
  })

  it.each([
    ['owner', { owner_user_id: attackerId }],
    ['visibility', { visibility: 'public' }],
    ['source', { source_story_id: 'premium:other' }],
    ['mode', { story_mode: 'personalized_ai' }],
  ])('rejects target collision with mismatched %s metadata', async (_label, mismatch) => {
    const fixture = db({
      stories: [{ data: null, error: null }, { data: target(mismatch), error: null }],
      rpcs: [duplicate('TARGET_STORY_EXISTS raw database detail')],
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', message: 'INTERNAL_ERROR' })
    expect(fixture.calls.filter((c) => c.table === 'stories' && c.method === 'select').map((c) => c.args[0]))
      .toEqual(['id,owner_user_id,visibility,source_story_id,story_mode', 'id,owner_user_id,visibility,source_story_id,story_mode'])
  })

  it('accepts exact target after TARGET_STORY_EXISTS', async () => {
    const fixture = db({
      stories: [{ data: null, error: null }, { data: target(), error: null }],
      rpcs: [duplicate('TARGET_STORY_EXISTS')],
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })).resolves.toMatchObject({ storyId })
  })

  it('curated Chapter 1 skips generator with explicit projection', async () => {
    const fixture = db(); mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(fixture.calls.find((c) => c.table === 'chapters' && c.method === 'select')?.args).toEqual(['story_id,number'])
  })

  it('absent Chapter 1 generates only target Chapter 1', async () => {
    const fixture = db({ chapters: [{ data: null, error: null }] }); mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })
    expect(mocks.generate).toHaveBeenCalledOnce()
    expect(mocks.generate).toHaveBeenCalledWith({ storyId, userId, chapterNumber: 1 })
    expect(mocks.generate.mock.calls[0]?.[0].storyId).not.toBe(templateStoryId)
  })

  it('CHAPTER_EXISTS rechecks exact row before READY', async () => {
    mocks.generate.mockResolvedValue({ ok: false, reason: 'CHAPTER_EXISTS' })
    const fixture = db({ chapters: [{ data: null, error: null }, { data: { story_id: storyId, number: 1 }, error: null }] })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })
    expect(fixture.calls.filter((c) => c.table === 'chapters' && c.method === 'select')).toHaveLength(2)
    expect(updatesFor(fixture, 'READY')).toHaveLength(1)
  })

  it('CHAPTER_EXISTS without rechecked row never marks READY', async () => {
    mocks.generate.mockResolvedValue({ ok: false, reason: 'CHAPTER_EXISTS' })
    const fixture = db({ chapters: [{ data: null, error: null }, { data: null, error: null }] })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(updatesFor(fixture, 'READY')).toHaveLength(0)
  })

  it('LEASE_HELD carries safe identity and leaves reservation nonterminal', async () => {
    mocks.generate.mockResolvedValue({ ok: false, reason: 'LEASE_HELD', lease_id: 'secret' })
    const fixture = db({ chapters: [{ data: null, error: null }] }); mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })).rejects.toMatchObject({
      code: 'GENERATION_IN_PROGRESS', result: { storyId, redirectUrl: `/baca/${encodeURIComponent(storyId)}?bab=1`, replayed: false },
    })
    expect(updatesFor(fixture, 'READY')).toHaveLength(0)
    expect(updatesFor(fixture, 'FAILED')).toHaveLength(0)
  })

  it.each(['CANON_MISSING', 'FAILED_REVIEW_REQUIRED'] as const)('%s marks safe FAILED and throws typed terminal error', async (reason) => {
    mocks.generate.mockResolvedValue({ ok: false, reason, detail: { sqlstate: 'XX999', secret: 'runtime' } })
    const fixture = db({ chapters: [{ data: null, error: null }] }); mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey }))
      .rejects.toMatchObject({ code: 'GENERATION_FAILED', message: 'GENERATION_FAILED' })
    expect(updatesFor(fixture, 'FAILED')[0]?.args[0]).toEqual(expect.objectContaining({ status: 'FAILED', error_code: 'GENERATION_FAILED' }))
    expect(JSON.stringify(updatesFor(fixture, 'FAILED')[0]?.args[0])).not.toMatch(/XX999|runtime|CANON_MISSING|FAILED_REVIEW_REQUIRED/)
  })

  it('terminal FAILED transition losing to READY returns safe replay', async () => {
    mocks.generate.mockResolvedValue({ ok: false, reason: 'FAILED_REVIEW_REQUIRED' })
    const fixture = db({
      chapters: [{ data: null, error: null }],
      updates: [{ data: null, error: null }],
      reservationSelects: [{ data: reservation('READY'), error: null }],
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })).resolves.toEqual({
      storyId, redirectUrl: `/baca/${encodeURIComponent(storyId)}?bab=1`, replayed: true,
    })
    expectConstraints(updatesFor(fixture, 'FAILED')[0])
  })

  it('READY transition losing to READY returns replayed success', async () => {
    const fixture = db({
      updates: [{ data: null, error: null }],
      reservationSelects: [{ data: reservation('READY'), error: null }],
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })).resolves.toEqual({
      storyId, redirectUrl: `/baca/${encodeURIComponent(storyId)}?bab=1`, replayed: true,
    })
    expectConstraints(updatesFor(fixture, 'READY')[0])
  })

  it.each([
    ['missing', null],
    ['non-READY', reservation('RESERVED')],
    ['malformed', { story_id: storyId, request_hash: hash(), status: 'BROKEN' }],
    ['hash mismatch', reservation('READY', hash('premium:other'))],
  ])('zero-row READY transition with %s exact reload returns INTERNAL_ERROR', async (_case, reloaded) => {
    const fixture = db({
      updates: [{ data: null, error: null }],
      reservationSelects: [{ data: reloaded, error: null }],
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', message: 'INTERNAL_ERROR' })
  })

  it('READY and FAILED updates use full constraints and cannot downgrade READY', async () => {
    const ready = db(); mocks.adminFactory.mockReturnValue(ready.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })
    expectConstraints(updatesFor(ready, 'READY')[0])

    mocks.generate.mockResolvedValue({ ok: false, reason: 'CANON_MISSING' })
    const failed = db({ chapters: [{ data: null, error: null }] }); mocks.adminFactory.mockReturnValue(failed.client)
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })).rejects.toBeTruthy()
    expectConstraints(updatesFor(failed, 'FAILED')[0])
  })

  it('crash recovery finds exact target and never clones twice', async () => {
    const fixture = db({
      reserves: [duplicate()], reservation: { data: reservation('RESERVED'), error: null },
      stories: [{ data: target(), error: null }],
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey })).resolves.toMatchObject({ storyId, replayed: true })
    expect(fixture.client.rpc).not.toHaveBeenCalled()
  })

  it('rejects invalid key and template before admin access', async () => {
    const { clonePremiumStoryForUser } = await import('@/lib/api/premium-clone.server')
    for (const template of ['other', 'premium:', ' premium:x', `premium:${'x'.repeat(201)}`]) {
      await expect(clonePremiumStoryForUser({ userId, templateStoryId: template, idempotencyKey }))
        .rejects.toMatchObject({ code: 'INVALID_TEMPLATE_ID' })
    }
    await expect(clonePremiumStoryForUser({ userId, templateStoryId, idempotencyKey: 'bad key' }))
      .rejects.toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY' })
    expect(mocks.adminFactory).not.toHaveBeenCalled()
  })
})

describe('POST premium clone route', () => {
  async function post(templateId = templateStoryId, request = req()) {
    const { POST } = await import('@/app/api/stories/premium/[templateId]/clone/route')
    return POST(request, { params: Promise.resolve({ templateId }) })
  }

  it('auth required before admin/service work', async () => {
    mocks.cookieFactory.mockResolvedValue(cookie(null))
    const response = await post()
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Tidak diizinkan.' })
    expect(mocks.adminFactory).not.toHaveBeenCalled()
    expect(mocks.randomUUID).not.toHaveBeenCalled()
  })

  it.each([null, '', ' ', 'has space', 'tab\tkey', 'x'.repeat(241)])('rejects invalid key %j', async (key) => {
    const response = await post(templateStoryId, req({ key }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Idempotency-Key tidak valid.' })
    expect(mocks.adminFactory).not.toHaveBeenCalled()
  })

  it('rejects body userId and never trusts attacker', async () => {
    const response = await post(templateStoryId, req({ body: { userId: attackerId } }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Permintaan tidak valid.' })
    expect(mocks.adminFactory).not.toHaveBeenCalled()
  })

  it('normalizes route ID and uses session as sole p_user_id', async () => {
    const fixture = db(); mocks.adminFactory.mockReturnValue(fixture.client)
    const response = await post('premium%3Arain-archive', req({ body: { displayName: 'reader' } }))
    expect(response.status).toBe(201)
    expect(fixture.client.rpc).toHaveBeenCalledWith('clone_premium_story_instance', {
      p_template_story_id: templateStoryId, p_user_id: userId, p_new_story_id: storyId,
    })
  })

  it('invalid template returns generic 404 without leakage', async () => {
    const fixture = db({ rpcs: [{ data: { ok: false, reason: 'INVALID_TEMPLATE', internal: 'blueprint 49' }, error: null }] })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const response = await post(); const body = await response.json()
    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Template premium tidak ditemukan.' })
    expect(JSON.stringify(body)).not.toMatch(/INVALID_TEMPLATE|blueprint|49/)
  })

  it('LEASE_HELD returns only safe identity with 202 and no READY', async () => {
    mocks.generate.mockResolvedValue({ ok: false, reason: 'LEASE_HELD', lease_id: 'secret', detail: { sqlstate: 'P0001' } })
    const fixture = db({ chapters: [{ data: null, error: null }] }); mocks.adminFactory.mockReturnValue(fixture.client)
    const response = await post(); const body = await response.json()
    expect(response.status).toBe(202)
    expect(body).toEqual({ storyId, redirectUrl: `/baca/${encodeURIComponent(storyId)}?bab=1`, replayed: false })
    expect(JSON.stringify(body)).not.toMatch(/lease|sqlstate|status|request_hash|owner_user_id/i)
    expect(updatesFor(fixture, 'READY')).toHaveLength(0)
  })

  it('terminal generation returns sanitized 422 and marks FAILED', async () => {
    mocks.generate.mockResolvedValue({ ok: false, reason: 'FAILED_REVIEW_REQUIRED', detail: { findings: ['private prompt'] } })
    const fixture = db({ chapters: [{ data: null, error: null }] }); mocks.adminFactory.mockReturnValue(fixture.client)
    const response = await post(); const body = await response.json()
    expect(response.status).toBe(422)
    expect(body).toEqual({ error: 'Bab pertama gagal dibuat.' })
    expect(JSON.stringify(body)).not.toMatch(/FAILED_REVIEW_REQUIRED|private prompt/)
    expect(updatesFor(fixture, 'FAILED')).toHaveLength(1)
  })

  it('terminal generation losing FAILED transition to READY returns 200 replay', async () => {
    mocks.generate.mockResolvedValue({ ok: false, reason: 'FAILED_REVIEW_REQUIRED' })
    const fixture = db({
      chapters: [{ data: null, error: null }],
      updates: [{ data: null, error: null }],
      reservationSelects: [{ data: reservation('READY'), error: null }],
    })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      storyId, redirectUrl: `/baca/${encodeURIComponent(storyId)}?bab=1`, replayed: true,
    })
  })

  it('first completion is 201 and READY replay is 200 with exact bodies', async () => {
    const firstFixture = db(); mocks.adminFactory.mockReturnValue(firstFixture.client)
    const first = await post()
    expect(first.status).toBe(201)
    expect(await first.json()).toEqual({ storyId, redirectUrl: `/baca/${encodeURIComponent(storyId)}?bab=1`, replayed: false })

    const replayFixture = db({ reserves: [duplicate()], reservation: { data: reservation(), error: null } })
    mocks.adminFactory.mockReturnValue(replayFixture.client)
    const replay = await post()
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({ storyId, redirectUrl: `/baca/${encodeURIComponent(storyId)}?bab=1`, replayed: true })
  })

  it('hash conflict returns sanitized 409', async () => {
    const fixture = db({ reserves: [duplicate('23505 private constraint')], reservation: { data: reservation('READY', hash('premium:other')), error: null } })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const response = await post(); const body = await response.json()
    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'Permintaan berkonflik dengan kunci idempotensi.' })
    expect(JSON.stringify(body)).not.toMatch(/23505|constraint|request_hash/)
  })

  it('invalid route input is 400; unknown DB failure is generic 500', async () => {
    const invalid = await post('not-premium')
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: 'Template premium tidak valid.' })

    const fixture = db({ rpcs: [{ data: null, error: { code: 'XX000', message: 'database host secret' } }] })
    mocks.adminFactory.mockReturnValue(fixture.client)
    const failed = await post(); const body = await failed.json()
    expect(failed.status).toBe(500)
    expect(body).toEqual({ error: 'Gagal menyalin cerita premium.' })
    expect(JSON.stringify(body)).not.toMatch(/XX000|database|secret/)
  })

  it('recursively exposes no forbidden internal keys', async () => {
    const fixture = db(); mocks.adminFactory.mockReturnValue(fixture.client)
    const response = await post(); const body = await response.json()
    const forbidden = /owner_user_id|request_hash|request_kind|idempotency_key|status|error_code|generation_status|source_story_id|story_mode|lease|sqlstate|details|hint/i
    const paths: string[] = []
    const walk = (value: unknown, path = '$') => {
      if (!value || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (forbidden.test(key)) paths.push(`${path}.${key}`)
        walk(child, `${path}.${key}`)
      }
    }
    walk(body)
    expect(paths).toEqual([])
    expect(body).toEqual({ storyId, redirectUrl: `/baca/${encodeURIComponent(storyId)}?bab=1`, replayed: false })
  })
})

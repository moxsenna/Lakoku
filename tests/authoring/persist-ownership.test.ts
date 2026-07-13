import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ adminFactory: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))

type Claim = { ownerId: string; title: string } | null

function makeAtomicDb() {
  let claim: Claim = null
  const canonDeletes: Array<{ ownerId: string; table: string }> = []

  function client(ownerId: string) {
    return {
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        expect(name).toBe('claim_authoring_story_shell_v1')
        await Promise.resolve()
        if (!claim) {
          claim = { ownerId: String(args.p_owner_user_id), title: String(args.p_title) }
          return { data: true, error: null }
        }
        if (claim.ownerId !== args.p_owner_user_id) return { data: false, error: null }
        claim.title = String(args.p_title)
        return { data: true, error: null }
      }),
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {}
        builder.delete = vi.fn(() => {
          canonDeletes.push({ ownerId, table })
          return builder
        })
        builder.eq = vi.fn(async () => ({ error: null }))
        builder.in = vi.fn(async () => ({ error: null }))
        builder.insert = vi.fn(async () => ({ error: null }))
        return builder
      }),
    }
  }

  return { client, getClaim: () => claim, canonDeletes }
}

function compiled(title: string) {
  return {
    storyId: 'story-a',
    meta: { title, tagline: 'Tagline', role: 'Role', tropes: [], synopsis: 'Synopsis' },
    snapshot: {
      characters: [], aliases: [], voiceSheets: [], facts: [], knowledge: [],
      secrets: [], threads: [], actRollups: [], blueprints: [],
    },
  } as never
}

beforeEach(() => vi.clearAllMocks())

describe('persistStoryBible atomic ownership', () => {
  it('claims shell through service-role RPC before any canon write', async () => {
    const fixture = makeAtomicDb()
    const db = fixture.client('user-a')
    mocks.adminFactory.mockReturnValue(db)
    const { persistStoryBible } = await import('@/lib/authoring/persist')

    await persistStoryBible(compiled('Owner A'), 'user-a')

    expect(db.rpc).toHaveBeenCalledWith('claim_authoring_story_shell_v1', {
      p_story_id: 'story-a',
      p_owner_user_id: 'user-a',
      p_title: 'Owner A',
      p_cover: '/placeholder.svg?height=400&width=300',
      p_tagline: 'Tagline',
      p_role: 'Role',
      p_tropes: [],
      p_total_chapters: 50,
      p_synopsis: 'Synopsis',
    })
    expect(fixture.getClaim()).toEqual({ ownerId: 'user-a', title: 'Owner A' })
  })

  it('allows only first of two concurrent owners and blocks loser canon writes', async () => {
    const fixture = makeAtomicDb()
    mocks.adminFactory
      .mockReturnValueOnce(fixture.client('user-a'))
      .mockReturnValueOnce(fixture.client('user-b'))
    const { persistStoryBible } = await import('@/lib/authoring/persist')

    const results = await Promise.allSettled([
      persistStoryBible(compiled('Owner A'), 'user-a'),
      persistStoryBible(compiled('Owner B'), 'user-b'),
    ])

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'persistStoryBible: story owner mismatch' }),
    })
    expect(fixture.getClaim()).toEqual({ ownerId: 'user-a', title: 'Owner A' })
    expect(fixture.canonDeletes.some((write) => write.ownerId === 'user-b')).toBe(false)
    expect(fixture.canonDeletes.some((write) => write.ownerId === 'user-a')).toBe(true)
  })
})

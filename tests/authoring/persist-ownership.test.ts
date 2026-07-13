import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  adminFactory: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))

function makeDb(existingOwner: string | null | undefined) {
  const upserts: Record<string, unknown>[] = []
  const tables: string[] = []
  const db = {
    from: vi.fn((table: string) => {
      tables.push(table)
      const builder: Record<string, unknown> = {}
      builder.select = vi.fn(() => builder)
      builder.eq = vi.fn(() => builder)
      builder.maybeSingle = vi.fn(async () => ({
        data: existingOwner === undefined ? null : { owner_user_id: existingOwner },
        error: null,
      }))
      builder.upsert = vi.fn(async (payload: Record<string, unknown>) => {
        upserts.push(payload)
        return { error: null }
      })
      builder.delete = vi.fn(() => builder)
      builder.in = vi.fn(async () => ({ error: null }))
      builder.insert = vi.fn(async () => ({ error: null }))
      builder.then = (
        resolve: (value: { error: null }) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve({ error: null }).then(resolve, reject)
      return builder
    }),
  }
  return { db, tables, upserts }
}

const compiled = {
  storyId: 'story-a',
  meta: {
    title: 'Story A',
    tagline: 'Tagline',
    role: 'Role',
    tropes: [],
    synopsis: 'Synopsis',
  },
  snapshot: {
    characters: [],
    aliases: [],
    voiceSheets: [],
    facts: [],
    knowledge: [],
    secrets: [],
    threads: [],
    actRollups: [],
    blueprints: [],
  },
} as never

beforeEach(() => vi.clearAllMocks())

describe('persistStoryBible ownership', () => {
  it('rejects overwrite when existing story belongs to another user', async () => {
    const fixture = makeDb('user-b')
    mocks.adminFactory.mockReturnValue(fixture.db)
    const { persistStoryBible } = await import('@/lib/authoring/persist')

    await expect(persistStoryBible(compiled, 'user-a')).rejects.toThrow(
      'persistStoryBible: story owner mismatch',
    )
    expect(fixture.upserts).toEqual([])
  })

  it('sets exact trusted owner on new story shell', async () => {
    const fixture = makeDb(undefined)
    mocks.adminFactory.mockReturnValue(fixture.db)
    const { persistStoryBible } = await import('@/lib/authoring/persist')

    await persistStoryBible(compiled, 'user-a')

    expect(fixture.upserts[0]).toMatchObject({
      id: 'story-a',
      owner_user_id: 'user-a',
      visibility: 'private',
    })
  })
})

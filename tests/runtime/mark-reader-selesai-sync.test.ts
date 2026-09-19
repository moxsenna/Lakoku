import { beforeEach, describe, expect, it, vi } from 'vitest'

type RecordedWrite = {
  table: string
  payload: Record<string, unknown>
  eqs: Array<[string, unknown]>
}

const mocks = vi.hoisted(() => ({
  adminFactory: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({
  createAdminClient: mocks.adminFactory,
}))

/**
 * Admin client stub dengan update chain yang bisa di-await:
 * `from(t).update(p).eq(k,v).eq(k,v)` → Promise<{ error }> (dengan then di
 * setiap tingkat eq), dan tiap write tercatat untuk assertion.
 */
function makeAdmin(
  writes: RecordedWrite[],
  errorsByTable: Record<string, { message: string }> = {},
): { from: (table: string) => unknown } {
  return {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        const record: RecordedWrite = { table, payload, eqs: [] }
        writes.push(record)
        const then = (resolve: (value: { error: { message: string } | null }) => void) =>
          resolve({ error: errorsByTable[table] ?? null })
        type EqChain = {
          eq: (key: string, value: unknown) => EqChain
          then: typeof then
        }
        const eq = (key: string, value: unknown): EqChain => {
          record.eqs.push([key, value])
          return { eq, then }
        }
        return { eq, then }
      },
    }),
  }
}

function makeInput() {
  return {
    userId: 'user-1',
    storyId: 'story-1',
    endingName: 'Bayang Dokumen di Bawah Lampu Temaram',
    endingKey: 'ending-justice',
  }
}

describe('defaultMarkReaderStateSelesai sinkron baris stories (T-NOVEL-QC1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('menandai reader SELESAI dan menyinkronkan baris stories dengan guard owner', async () => {
    const writes: RecordedWrite[] = []
    mocks.adminFactory.mockReturnValue(makeAdmin(writes))

    const { __testDefaultMarkReaderStateSelesai } = await import('../../lib/runtime/personalized-generation')
    await __testDefaultMarkReaderStateSelesai(makeInput())

    const readerWrite = writes.find((w) => w.table === 'reader_states')
    expect(readerWrite).toBeDefined()
    expect(readerWrite?.payload).toMatchObject({
      status: 'SELESAI',
      current_chapter: 50,
      ending_name: 'Bayang Dokumen di Bawah Lampu Temaram',
      locked_ending_key: 'ending-justice',
    })
    expect(readerWrite?.eqs).toEqual([
      ['user_id', 'user-1'],
      ['story_id', 'story-1'],
    ])

    const storyWrite = writes.find((w) => w.table === 'stories')
    expect(storyWrite).toBeDefined()
    expect(storyWrite?.payload).toMatchObject({
      status: 'SELESAI',
      current_chapter: 50,
      ending_name: 'Bayang Dokumen di Bawah Lampu Temaram',
    })
    // Guard owner: tanpa ini, cerita demo bersama bisa ikut terflip.
    expect(storyWrite?.eqs).toEqual([
      ['id', 'story-1'],
      ['owner_user_id', 'user-1'],
    ])
  })

  it('kegagalan sinkron stories tidak menggagalkan penyelesaian yang sudah terkomit', async () => {
    const writes: RecordedWrite[] = []
    mocks.adminFactory.mockReturnValue(makeAdmin(writes, {
      stories: { message: 'STORIES_SYNC_DOWN' },
    }))

    const { __testDefaultMarkReaderStateSelesai } = await import('../../lib/runtime/personalized-generation')
    await expect(__testDefaultMarkReaderStateSelesai(makeInput())).resolves.toBeUndefined()
    expect(console.log).toHaveBeenCalledWith(
      'STORIES_COMPLETION_SYNC_FAILED',
      expect.objectContaining({ storyId: 'story-1', userId: 'user-1' }),
    )
  })

  it('gagal update reader_state tetap melempar (sumber kebenaran progres)', async () => {
    const writes: RecordedWrite[] = []
    mocks.adminFactory.mockReturnValue(makeAdmin(writes, {
      reader_states: { message: 'READER_DOWN' },
    }))

    const { __testDefaultMarkReaderStateSelesai } = await import('../../lib/runtime/personalized-generation')
    await expect(__testDefaultMarkReaderStateSelesai(makeInput())).rejects.toThrow(
      'markReaderStateSelesai: READER_DOWN',
    )
  })
})

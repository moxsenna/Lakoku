import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  countOf,
  result,
  rpcOne,
  rpcRows,
  single,
  singleOrThrow,
} from './compat'

// Load DATABASE_URL from .env.local if present (matches db.test.ts pattern)
if (!process.env.DATABASE_URL) {
  const envPath = resolve(process.cwd(), '.env.local')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && m[1] === 'DATABASE_URL') {
        process.env.DATABASE_URL = m[2].replace(/^["']|["']$/g, '')
        break
      }
    }
  }
}

const hasDb = Boolean(process.env.DATABASE_URL)

function stubDb() {
  return new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
}

describe('compat: result', () => {
  it('success -> returns { data, error: null }', async () => {
    const payload = { id: 'test-1', title: 'Test Title' }
    const r = await result(Promise.resolve(payload))
    expect(r).toEqual({ data: payload, error: null })
  })

  it('rejection with Error -> returns { data: null, error: { message } }, never throws', async () => {
    const r = await result(Promise.reject(new Error('db connection failed')))
    expect(r).toEqual({
      data: null,
      error: { message: 'db connection failed' },
    })
  })

  it('rejection with non-Error -> stringifies message, never throws', async () => {
    const r = await result(Promise.reject('raw failure string'))
    expect(r).toEqual({
      data: null,
      error: { message: 'raw failure string' },
    })
  })
})

describe('compat: single (maybeSingle semantics)', () => {
  it('empty array -> returns { data: null, error: null }', async () => {
    const r = await single(Promise.resolve([]))
    expect(r).toEqual({ data: null, error: null })
  })

  it('1 row -> returns first row in data with error: null', async () => {
    const row = { id: 'row-1', name: 'Alif' }
    const r = await single(Promise.resolve([row]))
    expect(r).toEqual({ data: row, error: null })
  })

  it('>1 rows -> returns first row (documented first-row-wins divergence)', async () => {
    const row1 = { id: 'row-1', name: 'Alif' }
    const row2 = { id: 'row-2', name: 'Bima' }
    const r = await single(Promise.resolve([row1, row2]))
    expect(r).toEqual({ data: row1, error: null })
  })

  it('rejection -> returns { data: null, error: { message } }, never throws', async () => {
    const r = await single(Promise.reject(new Error('timeout')))
    expect(r).toEqual({
      data: null,
      error: { message: 'timeout' },
    })
  })
})

describe('compat: singleOrThrow (single semantics)', () => {
  it('empty array -> throws error with clear message', async () => {
    await expect(singleOrThrow(Promise.resolve([]))).rejects.toThrow(
      'singleOrThrow: expected at least one row, received empty result'
    )
  })

  it('1 row -> returns first row', async () => {
    const row = { id: 'row-1', value: 42 }
    const r = await singleOrThrow(Promise.resolve([row]))
    expect(r).toEqual(row)
  })

  it('>1 rows -> returns first row (matches Kysely executeTakeFirst, accepted divergence)', async () => {
    const row1 = { id: 'row-1', value: 10 }
    const row2 = { id: 'row-2', value: 20 }
    const r = await singleOrThrow(Promise.resolve([row1, row2]))
    expect(r).toEqual(row1)
  })

  it('rejection -> propagates original error', async () => {
    await expect(singleOrThrow(Promise.reject(new Error('foreign key violation')))).rejects.toThrow(
      'foreign key violation'
    )
  })
})

describe('compat: countOf', () => {
  it('extracts n from first row when n is number', async () => {
    const total = await countOf(Promise.resolve([{ n: 42 }]))
    expect(total).toBe(42)
  })

  it('coerces string n to number (pg bigint string return)', async () => {
    const rows = [{ n: '128' as unknown as number }]
    const total = await countOf(Promise.resolve(rows))
    expect(total).toBe(128)
  })

  it('empty array -> returns 0', async () => {
    const total = await countOf(Promise.resolve([]))
    expect(total).toBe(0)
  })

  it('rejection -> propagates error', async () => {
    await expect(countOf(Promise.reject(new Error('table not found')))).rejects.toThrow(
      'table not found'
    )
  })
})

describe('compat: rpcOne and rpcRows', () => {
  it('rpcOne: binds parameters, sorts keys alphabetically, and adds limit(1)', () => {
    const db = stubDb()
    const q = rpcOne(db, 'reserve_story_cover_v1', {
      p_user_id: 'u1',
      p_story_id: 's1',
    })
    const c = q.compile()

    // Alphabetical order: p_story_id ('s1'), then p_user_id ('u1').
    // limit(1) adds 1 as parameter $3 in PostgresDialect.
    expect(c.sql).toContain('public.reserve_story_cover_v1')
    expect(c.sql).toMatch(/limit \$\d+/i)
    expect(c.parameters).toEqual(['s1', 'u1', 1])
  })

  it('rpcRows: binds parameters, sorts keys alphabetically, without limit', () => {
    const db = stubDb()
    const q = rpcRows(db, 'get_user_story_progress_v1', {
      p_user_id: 'user-99',
      p_story_id: 'story-12',
    })
    const c = q.compile()

    expect(c.sql).toContain('public.get_user_story_progress_v1')
    expect(c.sql).not.toMatch(/limit/i)
    expect(c.parameters).toEqual(['story-12', 'user-99'])
  })

  it('rpcOne with empty params compiles cleanly with ()', () => {
    const db = stubDb()
    const q = rpcOne(db, 'ping_v1', {})
    const c = q.compile()

    expect(c.sql).toContain('public.ping_v1()')
    expect(c.parameters).toEqual([1])
  })

  it('rpcRows with empty params compiles cleanly with ()', () => {
    const db = stubDb()
    const q = rpcRows(db, 'get_active_genres_v1', {})
    const c = q.compile()

    expect(c.sql).toContain('public.get_active_genres_v1()')
    expect(c.parameters).toEqual([])
  })

  it('rpcOne rejects unsafe function name (SQL injection guard)', () => {
    const db = stubDb()
    expect(() => rpcOne(db, 'drop table stories; --', {})).toThrow(
      'Invalid RPC function name'
    )
  })

  it('rpcRows rejects unsafe function name (SQL injection guard)', () => {
    const db = stubDb()
    expect(() => rpcRows(db, 'invalid function name!', {})).toThrow(
      'Invalid RPC function name'
    )
  })

  it('exports all compat helpers from @lakoku/db barrel', async () => {
    const barrel = await import('@lakoku/db')
    expect(barrel.result).toBeTypeOf('function')
    expect(barrel.single).toBeTypeOf('function')
    expect(barrel.singleOrThrow).toBeTypeOf('function')
    expect(barrel.countOf).toBeTypeOf('function')
    expect(barrel.rpcOne).toBeTypeOf('function')
    expect(barrel.rpcRows).toBeTypeOf('function')
  })
})

describe.skipIf(!hasDb)('compat live queries (requires DATABASE_URL)', () => {
  it('wraps real live queries with result, single, singleOrThrow, and countOf', async () => {
    // Dynamic import to honor server-only and avoid loading if no DB
    const { getDb } = await import('@lakoku/db')
    const db = getDb()

    // 1. single over reading_policy
    const policyResult = await single(
      db.selectFrom('reading_policy').selectAll().limit(1).execute()
    )
    expect(policyResult.error).toBeNull()
    if (policyResult.data) {
      expect(policyResult.data).toHaveProperty('id')
    }

    // 2. single on non-existent id
    const emptyResult = await single(
      db
        .selectFrom('reading_policy')
        .selectAll()
        .where('id', '=', -999999)
        .execute()
    )
    expect(emptyResult).toEqual({ data: null, error: null })

    // 3. singleOrThrow on non-existent id
    await expect(
      singleOrThrow(
        db
          .selectFrom('reading_policy')
          .selectAll()
          .where('id', '=', -999999)
          .execute()
      )
    ).rejects.toThrow('singleOrThrow: expected at least one row, received empty result')

    // 4. countOf with real count
    const totalCount = await countOf(
      db
        .selectFrom('reading_policy')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .execute()
    )
    expect(typeof totalCount).toBe('number')
    expect(totalCount).toBeGreaterThanOrEqual(0)
  })
})

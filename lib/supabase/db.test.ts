import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'kysely'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

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

import { getDb } from '@lakoku/db'

const hasDb = !!process.env.DATABASE_URL

describe('getDb tanpa DATABASE_URL', () => {
  it('melempar error jika DATABASE_URL belum diset', async () => {
    vi.resetModules()
    const orig = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      const { getDb: getDbNoEnv } = await import('./db')
      expect(() => getDbNoEnv()).toThrow('getDb: DATABASE_URL belum diset.')
    } finally {
      if (orig) {
        process.env.DATABASE_URL = orig
      }
      vi.resetModules()
    }
  })
})

describe.skipIf(!hasDb)('getDb (butuh DATABASE_URL)', () => {
  it('menjalankan select sederhana dan singleton per proses', async () => {
    const db1 = getDb()
    const db2 = getDb()
    expect(db1).toBe(db2)

    const r = await sql<{ one: number }>`select 1 as one`.execute(db1)
    expect(r.rows).toHaveLength(1)
    expect(Number(r.rows[0].one)).toBe(1)

    const policyRows = await db1.selectFrom('reading_policy').selectAll().limit(1).execute()
    expect(Array.isArray(policyRows)).toBe(true)
  })
})

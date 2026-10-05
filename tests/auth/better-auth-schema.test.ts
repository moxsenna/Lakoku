import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import pg from 'pg'

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

const hasDb = !!process.env.DATABASE_URL

describe.skipIf(!hasDb)('Better Auth Database Schema on Neon', () => {
  it('memiliki tabel user, session, account, dan verification', async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('user', 'session', 'account', 'verification') ORDER BY table_name"
    )
    await pool.end()
    const tables = rows.map((r) => r.table_name)
    expect(tables).toEqual(['account', 'session', 'user', 'verification'])
  })
})

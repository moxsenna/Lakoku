import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import pg from 'pg'
import bcrypt from 'bcryptjs'

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

describe.skipIf(!hasDb)('User import fidelity', () => {
  it('pengguna uji moxsenna+monkeytest1@gmail.com ada di tabel user & account dengan password valid', async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    try {
      const { rows: userRows } = await pool.query<{ id: string; email: string }>(
        'SELECT id, email FROM public."user" WHERE email = $1',
        ['moxsenna+monkeytest1@gmail.com']
      )
      expect(userRows).toHaveLength(1)
      const userId = userRows[0].id

      const { rows: accountRows } = await pool.query<{ password: string }>(
        'SELECT password FROM public."account" WHERE "userId" = $1 AND "providerId" = $2',
        [userId, 'credential']
      )

      expect(accountRows).toHaveLength(1)
      const valid = await bcrypt.compare('lakoku-uji-123', accountRows[0].password)
      expect(valid).toBe(true)
    } finally {
      await pool.end()
    }
  })
})

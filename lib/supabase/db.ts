import 'server-only'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { Database } from './db-types'

/**
 * Kysely instance untuk Neon (Full Exit Supabase — Fase A).
 * Singleton per proses; kredensial hanya dari DATABASE_URL (server env).
 * Pool kecil: endpoint pooled Neon free tier.
 */
let instance: Kysely<Database> | null = null

export function getDb(): Kysely<Database> {
  if (!instance) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('getDb: DATABASE_URL belum diset.')
    const pool = new Pool({ connectionString: url, max: 10 })
    pool.on('error', (err) => {
      // Cegah crash uncaughtException pada idle client disconnect (mis. Neon pooler drop / ECONNRESET)
      console.warn('[db-pool] Idle client error caught:', err.message)
    })
    instance = new Kysely<Database>({
      dialect: new PostgresDialect({ pool }),
    })
  }
  return instance
}

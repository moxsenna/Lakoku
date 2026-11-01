import 'server-only'
import { Kysely, PostgresDialect } from 'kysely'
import pg, { Pool } from 'pg'
import type { Database } from './db-types'

/**
 * Serialisasi jsonb yang benar untuk param array.
 *
 * Driver pg mengirim JS array sebagai literal array Postgres (`{a,b}` /
 * `{"{\"x\":1}"}`), yang untuk kolom/param jsonb berarti: array kosong
 * tersimpan KORUP sebagai `{}` (object) secara senyap, dan array berisi
 * objek gagal keras `invalid input syntax for type json`. Jalur PostgREST
 * lama men-encode array sebagai JSON body sehingga korupsi ini baru tampak
 * setelah transisi Kysely — dibongkar oleh test komersial Real-DB.
 *
 * Patch: array JS dikirim sebagai teks JSON (valid untuk jsonb). Tidak ada
 * pemakaian param array Postgres yang sah di runtime lib (kolom `text[]`/
 * `uuid[]` tidak ada di skema; `.in()` Kysely mengekspansi jadi multi-param).
 * Script luar (mis. neon-clone) yang memakai pg langsung tidak lewat sini.
 */
const pgUtils = (pg as unknown as {
  utils: { prepareValue: (value: unknown) => unknown }
}).utils
const originalPrepareValue = pgUtils.prepareValue
pgUtils.prepareValue = (value: unknown) => {
  if (Array.isArray(value)) return JSON.stringify(value)
  return originalPrepareValue(value)
}

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

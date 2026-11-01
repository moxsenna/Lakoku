import 'server-only'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { Database } from './db-types'

/**
 * Kysely instance untuk Neon (Full Exit Supabase — Fase A).
 * Singleton per proses; kredensial hanya dari DATABASE_URL (server env).
 * Pool kecil: endpoint pooled Neon free tier.
 *
 * PENTING (jsonb vs array Postgres): driver pg mengirim JS array sebagai
 * literal array Postgres — array kosong tersimpan KORUP `{}` (object) di
 * kolom jsonb, dan array berisi objek gagal `invalid input syntax for type
 * json`. Setiap insert/update kolom jsonb yang membawa array WAJIB di-
 * `JSON.stringify` di titik tulis (lihat jejak/choice_history/tropes), dan
 * param array RPC jsonb juga dikirim sebagai teks JSON. Jangan gunakan patch
 * global prepareValue — kolom array Postgres yang sah (blueprint_queue.
 * chapter_numbers int4[], generation_provider_calls.validation_codes text[])
 * justru rusak olehnya.
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

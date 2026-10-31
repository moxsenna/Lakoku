/**
 * Public API paket @lakoku/db (ARCH §5.1).
 *
 * Pemilik: akses database (repository/RPC) via Kysely (getDb) dan compat helpers.
 * Satu-satunya paket yang boleh membuat teks perintah SQL.
 */
/**
 * @deprecated LEGACY (QA/test-seeding era Supabase). SATU-SATUNYA konsumen yang
 * tersisa adalah file test/diagnostik era M10 yang belum di-port ke Kysely.
 * JANGAN dipakai untuk kode produksi baru — produksi memakai getDb() (Neon
 * via DATABASE_URL). Penghapusan total = port test estate beku M10 ke Kysely.
 */
export { createAdminClient } from './admin'
export { getDb } from './db'
export type { Database, Json } from './db-types'
export {
  countOf,
  result,
  rpcOne,
  rpcRows,
  single,
  singleOrThrow,
} from './compat'
export type { DbResult } from './compat'


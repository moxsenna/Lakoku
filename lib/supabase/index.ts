/**
 * Public API paket @lakoku/db (ARCH §5.1).
 *
 * Pemilik: akses database (repository/RPC) via Kysely (getDb) dan compat helpers.
 * Satu-satunya paket yang boleh membuat teks perintah SQL.
 */
/** @deprecated Gunakan getDb() dari @lakoku/db; createAdminClient peninggalan Supabase lama untuk QA seed */
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


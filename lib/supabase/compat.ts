import { sql, type Kysely, type SelectQueryBuilder } from 'kysely'

/**
 * Helper kompatibilitas transisi supabase-js -> Kysely (Neon Phase A).
 *
 * Reproduces { data, error } ergonomics to minimize caller-side divergence
 * across ~150 call sites during bulk migration.
 *
 * ## DIVERGENSI SEMANTIK PENTING (>1 Row Handling)
 * Pada PostgREST / supabase-js:
 * - `.maybeSingle()` mengembalikan error jika query menghasilkan >1 baris.
 * - `.single()` mengembalikan error jika query menghasilkan 0 baris ATAU >1 baris.
 *
 * Pada helper Kysely ini:
 * - `single` (maybeSingle semantics): kosong -> { data: null, error: null };
 *   1 baris -> { data: row, error: null };
 *   >1 baris -> first-row-wins ({ data: rows[0], error: null }).
 * - `singleOrThrow` (single semantics): kosong -> melempar Error;
 *   1 baris -> rows[0];
 *   >1 baris -> first-row-wins (rows[0]).
 * Rationale: Selaras dengan perilaku `executeTakeFirst()` pada Kysely. Mayoritas
 * pemanggil di codebase Lakoku menyertakan `.limit(1)` atau memanggil RPC berbaris
 * tunggal deterministik. Divergensi ini diterima demi keamanan dan kesederhanaan bulk-rewrite.
 *
 * ## KOERSI COUNT (`countOf`)
 * Driver Postgres (`pg`) mengembalikan nilai bigint count sebagai string di JavaScript
 * untuk mencegah precision loss. Helper `countOf` mengekstrak `n` dan selalu
 * melakukan koersi eksplisit via `Number(row.n)` sehingga pemanggil menerima tipe `number`.
 *
 * ## GUARD RPC (`rpcOne` / `rpcRows`)
 * Nama fungsi SQL RPC di-guard ketat: hanya menerima identifier SQL aman
 * (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`) yang berasal dari literal kode.
 * Parameter selalu diurutkan alfabetis berdasarkan nama key demi SQL deterministik,
 * dan seluruh nilai di-bind via parameter Kysely (`sql\`\${v}\``) tanpa interpolasi teks mentah.
 */

export type DbResult<T> = {
  data: T
  error: { message: string } | null
}

/**
 * Membungkus promise Kysely.
 * Awaited success -> { data, error: null }
 * Rejection -> { data: null, error: { message } } (tidak pernah melempar).
 */
export async function result<T>(p: Promise<T>): Promise<DbResult<T>> {
  try {
    const data = await p
    return { data, error: null }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { data: null as unknown as T, error: { message } }
  }
}

/**
 * Semantik maybeSingle supabase-js.
 * Array kosong -> { data: null, error: null }
 * 1+ baris -> baris pertama ({ data: rows[0], error: null })
 * Rejection -> { data: null, error: { message } } (tidak pernah melempar).
 */
export async function single<T>(p: Promise<T[]>): Promise<DbResult<T>> {
  try {
    const rows = await p
    const data = (rows.length > 0 ? rows[0] : null) as unknown as T
    return { data, error: null }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { data: null as unknown as T, error: { message } }
  }
}

/**
 * Semantik single supabase-js.
 * Array kosong -> melempar Error.
 * 1+ baris -> mengembalikan baris pertama.
 * Rejection -> melempar ulang (propagate).
 */
export async function singleOrThrow<T>(p: Promise<T[]>): Promise<T> {
  const rows = await p
  if (rows.length === 0) {
    throw new Error('singleOrThrow: expected at least one row, received empty result')
  }
  return rows[0]
}

/**
 * Mengekstrak agregat count dari baris pertama.
 * Mengkoersi string pg bigint menjadi number via Number(row.n).
 * Array kosong -> 0.
 * Rejection -> melempar ulang (propagate).
 */
export async function countOf(p: Promise<{ n: number }[]>): Promise<number> {
  const rows = await p
  if (rows.length === 0) {
    return 0
  }
  return Number(rows[0].n ?? 0)
}

const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function assertSafeIdentifier(name: string): void {
  if (!IDENTIFIER_REGEX.test(name)) {
    throw new Error(
      `Invalid RPC function name: "${name}". Function names must be valid SQL identifiers matching /^[a-zA-Z_][a-zA-Z0-9_]*$/ and should only originate from code literals.`
    )
  }
}

function buildRpcQuery<DB, TB extends keyof DB, Row>(
  db: Kysely<DB>,
  name: string,
  params: Record<string, unknown> = {}
): SelectQueryBuilder<DB, TB, Row> {
  assertSafeIdentifier(name)

  const sortedKeys = Object.keys(params).sort()
  const sortedParamValues = sortedKeys.map((k) => params[k])

  const fnCall =
    sortedParamValues.length === 0
      ? sql`public.${sql.raw(name)}()`.as('fn')
      : sql`public.${sql.raw(name)}(${sql.join(
          sortedParamValues.map((v) => sql`${v}`),
          sql`, `
        )})`.as('fn')

  return db.selectFrom(fnCall).selectAll() as unknown as SelectQueryBuilder<DB, TB, Row>
}

/**
 * Membangun SelectQueryBuilder untuk RPC baris jamak.
 * Parameter diurutkan alfabetis demi SQL deterministik dan selalu ter-bound.
 */
export function rpcRows<DB = unknown, TB extends keyof DB = never, Row = Record<string, unknown>>(
  db: Kysely<DB>,
  name: string,
  params: Record<string, unknown> = {}
): SelectQueryBuilder<DB, TB, Row> {
  return buildRpcQuery<DB, TB, Row>(db, name, params)
}

/**
 * Membangun SelectQueryBuilder untuk RPC baris tunggal (menambahkan .limit(1)).
 * Parameter diurutkan alfabetis demi SQL deterministik dan selalu ter-bound.
 */
export function rpcOne<DB = unknown, TB extends keyof DB = never, Row = Record<string, unknown>>(
  db: Kysely<DB>,
  name: string,
  params: Record<string, unknown> = {}
): SelectQueryBuilder<DB, TB, Row> {
  return buildRpcQuery<DB, TB, Row>(db, name, params).limit(1) as unknown as SelectQueryBuilder<DB, TB, Row>
}

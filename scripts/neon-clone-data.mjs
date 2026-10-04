/**
 * Clone data produksi Supabase -> Neon (data-only, schema sudah dibuat migrasi).
 * Usage: node scripts/neon-clone-data.mjs [--tables a,b]
 *
 * Menggunakan driver pure-JS 'pg' (tanpa pg_dump/psql).
 * Preserves UUIDs, round-trips JSONB, bytea, arrays, timestamps.
 * Topological order insertion with cycle resolution for deferrable FKs.
 * Full row-count parity gate writing to neon/CLONE_PARITY.txt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'

// 1. Load environment variables
const env = { ...process.env }
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

if (!env.SUPABASE_DB_URL) {
  console.error('[FATAL] SUPABASE_DB_URL tidak ditemukan di process.env atau .env.local')
  process.exit(1)
}
if (!env.DATABASE_URL) {
  console.error('[FATAL] DATABASE_URL tidak ditemukan di process.env atau .env.local')
  process.exit(1)
}

function maskUrl(connStr) {
  try {
    const u = new URL(connStr)
    return `${u.protocol}//${u.username ? '***' : ''}@${u.host}${u.pathname}`
  } catch {
    return 'postgres://***'
  }
}

console.log(`[INIT] Supabase target: ${maskUrl(env.SUPABASE_DB_URL)}`)
console.log(`[INIT] Neon target:     ${maskUrl(env.DATABASE_URL)}`)

// 2. Configure PG type parsers: keep JSON/JSONB as raw strings for exact lossless transfer
pg.types.setTypeParser(114, (s) => s) // json
pg.types.setTypeParser(3802, (s) => s) // jsonb

// Known supported PostgreSQL data types
const SUPPORTED_DATA_TYPES = new Set([
  'ARRAY',
  'boolean',
  'bytea',
  'date',
  'real',
  'smallint',
  'integer',
  'bigint',
  'jsonb',
  'json',
  'numeric',
  'text',
  'timestamp with time zone',
  'timestamp without time zone',
  'uuid',
  'character varying',
  'character',
])

// 3. Parse CLI arguments
const onlyArg = process.argv.includes('--tables')
  ? process.argv[process.argv.indexOf('--tables') + 1]
  : null
const filterTables = onlyArg
  ? new Set(
      onlyArg.split(',').map((t) => {
        const trimmed = t.trim()
        return trimmed.includes('.') ? trimmed : `public.${trimmed}`
      }),
    )
  : null

if (filterTables) {
  console.log(`[CONFIG] Filter tables: ${Array.from(filterTables).join(', ')}`)
}

// 4. auth.users 11 explicit columns per neon/bootstrap/001-auth-compat.sql
const AUTH_USERS_COLUMNS = [
  'id',
  'instance_id',
  'email',
  'encrypted_password',
  'email_confirmed_at',
  'raw_app_meta_data',
  'raw_user_meta_data',
  'role',
  'aud',
  'created_at',
  'updated_at',
]

const supaPool = new pg.Pool({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const neonPool = new pg.Pool({
  connectionString: env.DATABASE_URL,
})

async function run() {
  const supaClient = await supaPool.connect()
  const neonClient = await neonPool.connect()

  try {
    // 5. Preflight check: Ensure public.content_reports exists on Neon if in Supabase
    await neonClient.query(`
      CREATE TABLE IF NOT EXISTS public.content_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        story_id text NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
        chapter_number integer NOT NULL CHECK (chapter_number >= 1),
        reporter_id uuid,
        category text NOT NULL,
        note text,
        canonical_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'OPEN'::text,
        created_at timestamp with time zone NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS content_reports_story_chapter_idx
        ON public.content_reports USING btree (story_id, chapter_number);
    `)

    // 6. Introspect Supabase base tables
    const supaTablesRes = await supaClient.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE (table_schema IN ('public', 'private') OR (table_schema = 'auth' AND table_name = 'users'))
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name
    `)

    let allTargetTables = supaTablesRes.rows.map((r) => `${r.table_schema}.${r.table_name}`)
    if (filterTables) {
      allTargetTables = allTargetTables.filter((t) => filterTables.has(t))
      if (allTargetTables.length === 0) {
        console.error('[FATAL] Tidak ada tabel yang cocok dengan filter --tables')
        process.exit(1)
      }
    }

    console.log(`[SCHEMA] Total target tables in scope: ${allTargetTables.length}`)

    // 7. Verify column data types across all target tables
    const supaColsRes = await supaClient.query(`
      SELECT table_schema, table_name, column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE (table_schema IN ('public', 'private') OR (table_schema = 'auth' AND table_name = 'users'))
      ORDER BY table_schema, table_name, ordinal_position
    `)

    for (const c of supaColsRes.rows) {
      const fqn = `${c.table_schema}.${c.table_name}`
      if (!allTargetTables.includes(fqn)) continue
      if (!SUPPORTED_DATA_TYPES.has(c.data_type)) {
        throw new Error(`[FATAL] Exotic/unsupported data type detected: ${fqn}.${c.column_name} (${c.data_type} / ${c.udt_name})`)
      }
    }

    // 8. Build Neon FK graph for topological ordering
    const fkRes = await neonClient.query(`
      SELECT
        tc.table_schema || '.' || tc.table_name AS from_table,
        ccu.table_schema || '.' || ccu.table_name AS to_table,
        kcu.column_name,
        c.condeferrable
      FROM information_schema.table_constraints AS tc
      JOIN pg_constraint c ON c.conname = tc.constraint_name
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
    `)

    const targetSet = new Set(allTargetTables)
    const adj = new Map()
    const inDegree = new Map()
    const selfRefs = new Map()

    for (const t of allTargetTables) {
      adj.set(t, new Set())
      inDegree.set(t, 0)
    }

    for (const fk of fkRes.rows) {
      const { from_table, to_table, column_name } = fk
      if (!targetSet.has(from_table) || !targetSet.has(to_table)) continue

      if (from_table === to_table) {
        if (!selfRefs.has(from_table)) selfRefs.set(from_table, [])
        selfRefs.get(from_table).push(column_name)
        continue
      }

      // Break known deferrable circular dependency between blueprint_resolutions & blueprint_validator_proofs
      if (
        from_table === 'public.blueprint_resolutions' &&
        to_table === 'public.blueprint_validator_proofs'
      ) {
        continue
      }

      if (!adj.get(to_table).has(from_table)) {
        adj.get(to_table).add(from_table)
        inDegree.set(from_table, inDegree.get(from_table) + 1)
      }
    }

    // Kahn's algorithm
    const queue = []
    for (const [t, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(t)
    }
    queue.sort()

    const topoOrder = []
    while (queue.length > 0) {
      const u = queue.shift()
      topoOrder.push(u)
      for (const v of adj.get(u)) {
        inDegree.set(v, inDegree.get(v) - 1)
        if (inDegree.get(v) === 0) {
          queue.push(v)
          queue.sort()
        }
      }
    }

    if (topoOrder.length !== allTargetTables.length) {
      const remaining = [...inDegree.entries()].filter(([_, deg]) => deg > 0)
      console.error('[FATAL] Unresolvable cycle detected in foreign key graph!')
      console.error('Remaining cyclic tables:', remaining)
      process.exit(1)
    }

    console.log(`[TOPO] Topological order computed (${topoOrder.length} tables)`)

    // Identify identity columns on Neon so explicit IDs are accepted (OVERRIDING SYSTEM VALUE)
    const identityRes = await neonClient.query(`
      SELECT table_schema || '.' || table_name AS fqn, column_name
      FROM information_schema.columns
      WHERE is_identity = 'YES'
        AND table_schema IN ('public', 'private', 'auth')
    `)
    const identityColsByTable = new Map()
    for (const r of identityRes.rows) {
      if (!identityColsByTable.has(r.fqn)) identityColsByTable.set(r.fqn, [])
      identityColsByTable.get(r.fqn).push(r.column_name)
    }

    // Identify tables with user triggers on Neon so immutable/audit triggers do not block data load
    const trgRes = await neonClient.query(`
      SELECT DISTINCT n.nspname AS schema_name, c.relname AS table_name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal
        AND n.nspname IN ('public', 'private', 'auth')
    `)
    const tablesWithTriggers = trgRes.rows.filter((r) =>
      targetSet.has(`${r.schema_name}.${r.table_name}`)
    )

    console.log(`[TRIGGERS] Temporarily disabling user triggers on ${tablesWithTriggers.length} tables...`)
    for (const r of tablesWithTriggers) {
      await neonClient.query(`ALTER TABLE "${r.schema_name}"."${r.table_name}" DISABLE TRIGGER USER`)
    }

    try {
      // 9. TRUNCATE target tables in one statement with CASCADE
      console.log('[TRUNCATE] Truncating target tables on Neon...')
      const truncateList = allTargetTables
        .map((t) => {
          const [s, n] = t.split('.')
          return `"${s}"."${n}"`
        })
        .join(', ')

      await neonClient.query(`TRUNCATE TABLE ${truncateList} CASCADE`)
      console.log('[TRUNCATE] Truncate completed successfully.')

      // 10. Clone data table by table in topological order inside a transaction
      await neonClient.query('BEGIN')
      console.log('[CLONE] Beginning data transfer...')

      let totalRowsCloned = 0
      for (let i = 0; i < topoOrder.length; i++) {
        const fqn = topoOrder[i]
        const [schema, table] = fqn.split('.')

        let selectCols = '*'
        let insertCols = []

        if (fqn === 'auth.users') {
          selectCols = AUTH_USERS_COLUMNS.map((c) => `"${c}"`).join(', ')
          insertCols = [...AUTH_USERS_COLUMNS]
        } else {
          // Query column list from Neon table
          const colsRes = await neonClient.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
          `, [schema, table])
          insertCols = colsRes.rows.map((r) => r.column_name)
          selectCols = insertCols.map((c) => `"${c}"`).join(', ')
        }

        // Read from Supabase
        const rowsRes = await supaClient.query(`SELECT ${selectCols} FROM "${schema}"."${table}"`)
        let rows = rowsRes.rows

        // Handle self-referencing FKs if any: parent-first (null FK column first)
        if (selfRefs.has(fqn)) {
          const refCols = selfRefs.get(fqn)
          rows.sort((a, b) => {
            for (const col of refCols) {
              const aNull = a[col] === null || a[col] === undefined
              const bNull = b[col] === null || b[col] === undefined
              if (aNull && !bNull) return -1
              if (!aNull && bNull) return 1
            }
            return 0
          })
        }

        if (rows.length === 0) {
          process.stdout.write(`  [${String(i + 1).padStart(2)}/${topoOrder.length}] ${fqn.padEnd(45)}: 0 rows\n`)
          continue
        }

        const overridingClause = identityColsByTable.has(fqn) ? 'OVERRIDING SYSTEM VALUE' : ''

        // Batch insert into Neon (max 500 rows or max 30000 params)
        const maxBatchSize = Math.max(1, Math.min(500, Math.floor(30000 / insertCols.length)))
        for (let offset = 0; offset < rows.length; offset += maxBatchSize) {
          const batch = rows.slice(offset, offset + maxBatchSize)
          const placeholders = []
          const params = []
          let paramIdx = 1

          for (const row of batch) {
            const rowPlaceholders = []
            for (const col of insertCols) {
              rowPlaceholders.push(`$${paramIdx++}`)
              params.push(row[col])
            }
            placeholders.push(`(${rowPlaceholders.join(', ')})`)
          }

          const insertSql = `
            INSERT INTO "${schema}"."${table}" (${insertCols.map((c) => `"${c}"`).join(', ')})
            ${overridingClause}
            VALUES ${placeholders.join(', ')}
          `
          await neonClient.query(insertSql, params)
        }

        // Advance identity sequences so subsequent inserts won't conflict
        if (identityColsByTable.has(fqn)) {
          for (const col of identityColsByTable.get(fqn)) {
            await neonClient.query(`
              SELECT setval(
                pg_get_serial_sequence($1, $2),
                coalesce((SELECT max("${col}") FROM "${schema}"."${table}"), 1)
              )
            `, [`"${schema}"."${table}"`, col])
          }
        }

        totalRowsCloned += rows.length
        process.stdout.write(`  [${String(i + 1).padStart(2)}/${topoOrder.length}] ${fqn.padEnd(45)}: ${rows.length} rows inserted\n`)
      }

      await neonClient.query('COMMIT')
      console.log(`[CLONE] All tables inserted successfully. Total rows cloned: ${totalRowsCloned}`)
    } catch (err) {
      await neonClient.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      console.log(`[TRIGGERS] Re-enabling user triggers on ${tablesWithTriggers.length} tables...`)
      for (const r of tablesWithTriggers) {
        await neonClient.query(`ALTER TABLE "${r.schema_name}"."${r.table_name}" ENABLE TRIGGER USER`).catch((e) => {
          console.error(`[WARN] Failed to re-enable triggers on ${r.schema_name}.${r.table_name}:`, e.message)
        })
      }
    }

    // 11. Row-count parity gate
    console.log('\n[GATE] Running row-count parity check between Supabase and Neon...')
    const parityLines = []
    parityLines.push('========================================================================================')
    parityLines.push('ROW-COUNT PARITY GATE REPORT: Supabase (source) vs Neon (target)')
    parityLines.push(`Generated: ${new Date().toISOString()}`)
    parityLines.push('========================================================================================')
    parityLines.push('Table                                        | Supabase   | Neon       | Status')
    parityLines.push('---------------------------------------------+------------+------------+----------')

    let allMatch = true
    let supaTotal = 0
    let neonTotal = 0

    // Compare all tables in alphabetical order
    const checkTables = [...allTargetTables].sort()
    for (const fqn of checkTables) {
      const [schema, table] = fqn.split('.')
      const sCountRes = await supaClient.query(`SELECT count(*) FROM "${schema}"."${table}"`)
      const nCountRes = await neonClient.query(`SELECT count(*) FROM "${schema}"."${table}"`)

      const sCount = parseInt(sCountRes.rows[0].count, 10)
      const nCount = parseInt(nCountRes.rows[0].count, 10)
      supaTotal += sCount
      neonTotal += nCount

      const status = sCount === nCount ? 'MATCH' : 'MISMATCH'
      if (status === 'MISMATCH') {
        allMatch = false
      }

      const line = `${fqn.padEnd(44)} | ${String(sCount).padStart(10)} | ${String(nCount).padStart(10)} | ${status}`
      parityLines.push(line)
      console.log(`  ${line}`)
    }

    parityLines.push('---------------------------------------------+------------+------------+----------')
    parityLines.push(`${'TOTAL'.padEnd(44)} | ${String(supaTotal).padStart(10)} | ${String(neonTotal).padStart(10)} | ${allMatch ? 'ALL MATCH' : 'MISMATCH'}`)
    parityLines.push('========================================================================================')
    parityLines.push(`Verdict: ${allMatch ? 'PASS - Parity verified across all tables' : 'FAIL - Row count mismatch detected'}`)
    parityLines.push('========================================================================================\n')

    writeFileSync('neon/CLONE_PARITY.txt', parityLines.join('\n'), 'utf8')
    console.log('[GATE] Parity report written to neon/CLONE_PARITY.txt')

    if (!allMatch) {
      console.error('[GATE FAIL] One or more tables failed parity check!')
      process.exit(1)
    }

    console.log('[GATE PASS] All tables match 100%! Cloner completed successfully.')
  } catch (err) {
    await neonClient.query('ROLLBACK').catch(() => {})
    console.error('[ERROR] Fatal error during cloning:', err)
    process.exit(1)
  } finally {
    supaClient.release()
    neonClient.release()
    await supaPool.end()
    await neonPool.end()
  }
}

run()

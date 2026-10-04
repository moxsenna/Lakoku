/**
 * Runner migrasi Neon. Usage: node scripts/neon-migrate.mjs [--dry-run]
 * Membaca DATABASE_URL dari process.env atau .env.local. Idempoten: file tercatat dilewati.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const dry = process.argv.includes('--dry-run')
let databaseUrl = process.env.DATABASE_URL
if (!databaseUrl && existsSync('.env.local')) {
  const env = {}
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  databaseUrl = env.DATABASE_URL
}
if (!databaseUrl) {
  console.error('DATABASE_URL tidak ada (env atau .env.local)')
  process.exit(1)
}
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 })
await pool.query('create table if not exists neon_schema_migrations (version text primary key, applied_at timestamptz not null default now())')
const { rows } = await pool.query('select version from neon_schema_migrations')
const done = new Set(rows.map((r) => r.version))

const bootstrapDir = 'neon/bootstrap'
const bootstrap = existsSync(bootstrapDir) ? readdirSync(bootstrapDir).filter((f) => f.endsWith('.sql')).sort() : []
const migrations = readdirSync('neon/migrations').filter((f) => f.endsWith('.sql')).sort()
const allFiles = [...bootstrap, ...migrations]
for (const f of allFiles) {
  if (done.has(f)) { console.log('skip', f); continue }
  const dir = bootstrap.includes(f) ? bootstrapDir : 'neon/migrations'
  const sqlText = readFileSync(join(dir, f), 'utf8')
  if (dry) { console.log('AKAN JALAN', f, `(${sqlText.length} bytes)`); continue }
  process.stdout.write('apply ' + f + ' ... ')
  try {
    await pool.query('begin')
    await pool.query(sqlText)
    await pool.query('insert into neon_schema_migrations (version) values ($1)', [f])
    await pool.query('commit')
    console.log('OK')
  } catch (e) {
    await pool.query('rollback')
    console.log('GAGAL:', e.message.slice(0, 300))
    process.exit(1)
  }
}
console.log('selesai. total tercatat:', done.size + (dry ? 0 : allFiles.filter((f) => !done.has(f)).length))
await pool.end()

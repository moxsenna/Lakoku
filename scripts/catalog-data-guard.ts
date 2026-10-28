import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}

const STORY_ID = 'catalog:kamar-304'
const BACKUP_DIR = '.verify-tmp/catalog-backup'

const STORY_SCOPED_TABLES = [
  'catalog_stories',
  'catalog_ending_chapters',
  'catalog_chapter_reviews',
  'choice_outcomes',
  'chapters',
  'chapter_blueprints',
  'story_threads',
  'secrets_reveals',
  'knowledge_scopes',
  'facts_ledger',
  'character_voice_sheets',
  'character_aliases',
  'characters',
]

const EXTRA_TABLES = [
  { table: 'stories', where: 'id = $1', column: 'id' },
  { table: 'generation_provider_calls', where: 'story_id = $1', column: 'story_id' },
]

const RESTORE_ORDER = [
  'stories',
  'characters',
  'character_aliases',
  'character_voice_sheets',
  'facts_ledger',
  'knowledge_scopes',
  'secrets_reveals',
  'story_threads',
  'chapter_blueprints',
  'catalog_stories',
  'chapters',
  'choice_outcomes',
  'catalog_ending_chapters',
  'catalog_chapter_reviews',
  'generation_provider_calls',
]

function pgTextArray(items: string[]): string {
  return '{' + items.map((item) => `"${item.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',') + '}'
}

async function backup(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  mkdirSync(BACKUP_DIR, { recursive: true })
  let total = 0
  for (const table of STORY_SCOPED_TABLES) {
    const res = await pool.query(`select * from ${table} where story_id = $1`, [STORY_ID])
    writeFileSync(join(BACKUP_DIR, `${table}.json`), JSON.stringify(res.rows))
    total += res.rows.length
    console.log(`backup ${table}: ${res.rows.length} rows`)
  }
  for (const extra of EXTRA_TABLES) {
    const res = await pool.query(`select * from ${extra.table} where ${extra.where}`, [STORY_ID])
    writeFileSync(join(BACKUP_DIR, `${extra.table}.json`), JSON.stringify(res.rows))
    total += res.rows.length
    console.log(`backup ${extra.table}: ${res.rows.length} rows`)
  }
  await pool.end()
  console.log(`BACKUP_OK total=${total}`)
}

async function restore(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  let total = 0
  for (const table of RESTORE_ORDER) {
    const file = join(BACKUP_DIR, `${table}.json`)
    if (!existsSync(file)) {
      console.log(`restore ${table}: backup tidak ada, lewati`)
      continue
    }
    const rows: Array<Record<string, unknown>> = JSON.parse(readFileSync(file, 'utf8'))
    for (const row of rows) {
      const cols = Object.keys(row)
      const values = cols.map((c) => {
        const v = row[c]
        if (c === 'validation_codes' && Array.isArray(v)) return pgTextArray(v.map(String))
        if (v !== null && typeof v === 'object') return JSON.stringify(v)
        return v
      })
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
      await pool.query(
        `insert into ${table} (${cols.map((c) => `"${c}"`).join(', ')}) OVERRIDING SYSTEM VALUE values (${placeholders}) on conflict do nothing`,
        values,
      )
    }
    total += rows.length
    console.log(`restore ${table}: ${rows.length} rows`)
  }
  const check = await pool.query(
    "select (select count(*) from chapters where story_id = $1 and number <= 44)::int as spine, (select count(*) from catalog_ending_chapters where story_id = $1)::int as variants, (select status from catalog_stories where story_id = $1) as status",
    [STORY_ID],
  )
  await pool.end()
  console.log('post-restore:', JSON.stringify(check.rows[0]))
  console.log(`RESTORE_OK total=${total}`)
}

async function main(): Promise<void> {
  const mode = process.argv.find((arg) => arg === 'backup' || arg === 'restore')
  if (mode === 'backup') await backup()
  else if (mode === 'restore') await restore()
  else { console.error('Usage: node scripts/run-smoke.cjs scripts/catalog-data-guard.ts <backup|restore>'); process.exit(1) }
}
main().catch((err) => { console.error('[catalog-data-guard] GAGAL:', err instanceof Error ? err.message : err); process.exit(1) })

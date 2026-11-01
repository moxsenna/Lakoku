#!/usr/bin/env node
/**
 * Runner test ber-DB nyata memakai database uji Neon `lakoku_test`.
 *
 * Jalur produksi TIDAK PERNAH disentuh: guard menolak bila DATABASE_URL_TEST
 * kosong, identik dengan DATABASE_URL produksi, bukan host Neon, atau bukan
 * database `lakoku_test`.
 *
 * Isolasi: skema `public` di-drop dan di-migrate ulang dari kit `neon/` sebelum
 * setiap run — setara DB ephermal ala `supabase test db` era lama. Lewati dengan
 * `--no-reset` (cepat, tapi residu run sebelumnya menempel).
 *
 * Pakai: pnpm test:db:neon [-- <pattern vitest tambahan>]
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function readEnv(name) {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', f)
    if (!fs.existsSync(p)) continue
    const line = fs.readFileSync(p, 'utf8').split('\n').find((l) => l.startsWith(name + '='))
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '')
  }
  return undefined
}

const prodUrl = process.env.DATABASE_URL ?? readEnv('DATABASE_URL')
const testUrl = process.env.DATABASE_URL_TEST ?? readEnv('DATABASE_URL_TEST')

function guard() {
  if (!testUrl) {
    console.error('[GUARD] DATABASE_URL_TEST belum diset di .env.local (database uji lakoku_test).')
    process.exit(1)
  }
  const t = new URL(testUrl)
  if (testUrl === prodUrl) {
    console.error('[GUARD] DATABASE_URL_TEST identik dengan DATABASE_URL produksi — ditolak.')
    process.exit(1)
  }
  if (!t.hostname.includes('neon.tech')) {
    console.error('[GUARD] DATABASE_URL_TEST bukan host Neon — ditolak.')
    process.exit(1)
  }
  if (t.pathname.replace('/', '') !== 'lakoku_test') {
    console.error(`[GUARD] Database uji harus lakoku_test (diterima: ${t.pathname}) — ditolak.`)
    process.exit(1)
  }
}

const DB_TEST_FILES = [
  'tests/e5-blueprint-workflow.test.ts',
  'tests/api/apply-choice-to-user-state.test.ts',
  'tests/db/anti-abuse-db-integration.test.ts',
  'tests/narrative-qa/m10-e2-reset-cleanup.test.ts',
  'tests/tinta/explore.test.ts',
  'tests/integration/commercial-failure-no-burn.test.ts',
  'tests/integration/commercial-story2-e2e-real.test.ts',
]

async function resetSchema() {
  console.log('[reset] drop schema public + re-migrate dari kit neon/ ...')
  const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'))
  const c = new Client({ connectionString: testUrl, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('drop schema if exists public cascade')
  await c.query('drop schema if exists private cascade')
  await c.query('create schema public')
  await c.query('alter schema public owner to neondb_owner')
  await c.query('grant all on schema public to neondb_owner')
  await c.end()
  const mig = spawnSync(process.execPath, [path.join(__dirname, 'neon-migrate.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
  })
  if (mig.status !== 0) {
    console.error('[reset] neon-migrate gagal.')
    process.exit(1)
  }
}

function runVitest() {
  const extra = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  // Argumen file MENGGANTI daftar bawaan; tanpa argumen = seluruh daftar DB test.
  const targets = extra.length > 0 ? extra : DB_TEST_FILES
  const vitestEntry = path.join(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs')
  const result = spawnSync(
    process.execPath,
    [vitestEntry, 'run', '--project', 'unit', ...targets],
    {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: testUrl, LAKOKU_LOCAL_DB_TEST: '1' },
    },
  )
  process.exit(result.status ?? 1)
}

async function main() {
  guard()
  if (!process.argv.includes('--no-reset')) await resetSchema()
  else console.log('[reset] dilewati (--no-reset)')
  runVitest()
}

main().catch((err) => {
  console.error('test-db-neon FATAL: ' + err.message)
  process.exit(1)
})

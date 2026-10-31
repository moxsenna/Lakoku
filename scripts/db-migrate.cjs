#!/usr/bin/env node
/**
 * Migration runner Neon — pengganti tunggal `supabase db push` (yang pernah
 * salah target: menulis ke project Supabase lama, bukan DB produksi).
 *
 * Target: DATABASE_URL (produksi = Neon). Tidak menyentuh Supabase sama sekali.
 *
 * Pakai:
 *   pnpm db:migrate                 # terapkan semua migration db/migrations yang belum tercatat (urut nama file)
 *   pnpm db:migrate -- <file.sql>   # terapkan satu file (tetap tercatat di schema_migrations)
 *   pnpm db:migrate:status          # tampilkan applied vs pending
 *
 * Riwayat: tabel public.schema_migrations (dibuat otomatis, version = prefix 14 digit).
 * Setiap file dijalankan dalam SATU transaksi: gagal = rollback utuh, tidak tercatat.
 */
const fs = require('fs')
const path = require('path')
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'))

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations')
const VERSION_RE = /^(\d{14})_.+\.sql$/i

function readDatabaseUrl() {
  for (const name of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', name)
    if (!fs.existsSync(p)) continue
    const line = fs.readFileSync(p, 'utf-8').split('\n').find((l) => l.startsWith('DATABASE_URL='))
    if (line) return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
  }
  console.error('DATABASE_URL tidak ditemukan di .env.local/.env')
  process.exit(1)
}

async function main() {
  const statusOnly = process.argv.includes('--status')
  const fileArg = process.argv.find((a) => a.endsWith('.sql'))
  const dbUrl = readDatabaseUrl()

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(`create table if not exists public.schema_migrations (
      version text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    )`)
    const appliedRows = await client.query('select version, name from public.schema_migrations order by version')
    const applied = new Map(appliedRows.rows.map((r) => [r.version, r.name]))

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => VERSION_RE.test(f)).sort()
    const pending = files.filter((f) => !applied.has(f.match(VERSION_RE)[1]))

    // Baseline: tandai seluruh pending sebagai applied TANPA mengeksekusi —
    // dipakai sekali saat DB sudah berisi skema (hasil clone) tetapi tabel
    // riwayat masih kosong. WAJIB disertai --yes.
    if (process.argv.includes('--baseline')) {
      if (!process.argv.includes('--yes')) {
        console.error(`baseline menandai ${pending.length} migration sebagai applied TANPA menjalankan SQL. Tambahkan --yes untuk konfirmasi.`)
        process.exit(1)
      }
      for (const f of pending) {
        await client.query('insert into public.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing', [f.match(VERSION_RE)[1], f])
      }
      console.log(`baseline: ${pending.length} migration ditandai applied (tidak dieksekusi)`)
      return
    }

    if (statusOnly) {
      console.log(`target=${new URL(dbUrl).host}/${new URL(dbUrl).pathname.replace('/', '')}`)
      for (const f of files) {
        const v = f.match(VERSION_RE)[1]
        console.log(`${applied.has(v) ? 'applied' : 'pending'}  ${f}`)
      }
      console.log(`total=${files.length} applied=${files.length - pending.length} pending=${pending.length}`)
      return
    }

    const targets = fileArg
      ? files.filter((f) => f === path.basename(fileArg))
      : pending
    if (targets.length === 0) {
      console.log('db-migrate: tidak ada migration pending. Tidak ada yang dijalankan.')
      return
    }
    for (const file of targets) {
      const version = file.match(VERSION_RE)[1]
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
      console.log(`menerapkan ${file} ...`)
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('insert into public.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing', [version, file])
        await client.query('COMMIT')
        console.log(`  OK ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        console.error(`  GAGAL ${file}: ${err.message}`)
        process.exit(1)
      }
    }
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('db-migrate FATAL: ' + err.message)
  process.exit(1)
})

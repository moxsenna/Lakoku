import { readFileSync, appendFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

execSync(
  `npx kysely-codegen --url "${env.DATABASE_URL}" --out-file lib/supabase/db-types.ts --dialect postgres`,
  { stdio: 'inherit' },
)

appendFileSync('lib/supabase/db-types.ts', '\nexport type Database = DB\n')


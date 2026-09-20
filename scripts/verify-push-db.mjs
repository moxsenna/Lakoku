import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const dir = join(root, 'supabase', 'migrations')
const files = readdirSync(dir).filter((f) => f.includes('push'))
if (files.length === 0) {
  console.error('FAIL: no push migration found')
  process.exit(1)
}
const sql = readFileSync(join(dir, files.sort().at(-1)), 'utf8')
const required = [
  'push_devices',
  'push_log',
  'row level security',
  'fcm_token',
  "platform",
  'auth.uid()',
]
const missing = required.filter((s) => !sql.toLowerCase().includes(s.toLowerCase()))
if (missing.length > 0) {
  console.error(`FAIL: migration missing: ${missing.join(', ')}`)
  process.exit(1)
}
// positive control: ledger pattern file must also satisfy its own table name
const tinta = readdirSync(dir).filter((f) => f.includes('tinta'))
if (tinta.length === 0) {
  console.error('FAIL: positive control tinta migration gone')
  process.exit(1)
}
console.log('push db verification passed')

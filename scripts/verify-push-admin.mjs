import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const mustExist = [
  'app/admin/push/page.tsx',
  'app/api/admin/push/send/route.ts',
  'app/api/admin/push/devices/summary/route.ts',
]
const missing = mustExist.filter((p) => !existsSync(join(root, p)))
if (missing.length > 0) {
  console.error(`FAIL: missing admin files: ${missing.join(', ')}`)
  process.exit(1)
}
const send = readFileSync(join(root, 'app/api/admin/push/send/route.ts'), 'utf8')
if (!send.includes('guardAdminToken')) {
  console.error('FAIL: admin send route missing guardAdminToken')
  process.exit(1)
}
const page = readFileSync(join(root, 'app/admin/push/page.tsx'), 'utf8')
for (const banned of ['as any', '@ts-ignore', 'Narraza']) {
  if (page.includes(banned) || send.includes(banned)) {
    console.error(`FAIL: banned pattern in admin surface: ${banned}`)
    process.exit(1)
  }
}
console.log('push admin verification passed')

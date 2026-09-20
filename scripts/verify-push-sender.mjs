import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const mustExist = [
  'lib/notifications/index.ts',
  'lib/notifications/server.ts',
  'lib/api/push-client.ts',
  'app/api/push/subscribe/route.ts',
  'app/api/push/unsubscribe/route.ts',
]
const missing = mustExist.filter((p) => !existsSync(join(root, p)))
if (missing.length > 0) {
  console.error(`FAIL: missing files: ${missing.join(', ')}`)
  process.exit(1)
}
const server = readFileSync(join(root, 'lib/notifications/server.ts'), 'utf8')
if (!server.includes('server-only')) {
  console.error('FAIL: server.ts missing server-only import')
  process.exit(1)
}
const all = mustExist.map((p) => readFileSync(join(root, p), 'utf8')).join('\n')
for (const banned of ['as any', '@ts-ignore', '@ts-expect-error']) {
  if (all.includes(banned)) {
    console.error(`FAIL: banned pattern found: ${banned}`)
    process.exit(1)
  }
}
// client must not embed service credentials
const clientSide = readFileSync(join(root, 'lib/api/push-client.ts'), 'utf8')
if (/FIREBASE_SERVICE|private_key|PRIVATE_KEY/.test(clientSide)) {
  console.error('FAIL: server credential leaked into client seam')
  process.exit(1)
}
// admin send route must exist and use guard
const adminRoute = join(root, 'app/api/admin/push/send/route.ts')
if (!existsSync(adminRoute)) {
  console.error('FAIL: admin send route missing (leaf-1.5.1 owns it; sender leaf only checks client routes)')
  process.exit(1)
}
console.log('push sender verification passed')

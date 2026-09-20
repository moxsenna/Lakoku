import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
// hooks must call the central sender with idempotency keys, never raw fetch to FCM
const hookFiles = [
  'app/api/missions/claim/route.ts',
  'lib/notifications/server.ts',
]
let hits = 0
for (const f of hookFiles) {
  const src = readFileSync(join(root, f), 'utf8')
  if (/notifyChapterReady|notifyMissionComplete|notifyTopupResult|queuePush/.test(src)) hits += 1
  if (/fcm\.googleapis\.com/.test(src) && f !== 'lib/notifications/server.ts') {
    console.error(`FAIL: raw FCM call outside sender: ${f}`)
    process.exit(1)
  }
  for (const banned of ['as any', '@ts-ignore']) {
    if (src.includes(banned)) {
      console.error(`FAIL: banned pattern in ${f}: ${banned}`)
      process.exit(1)
    }
  }
}
if (hits < 2) {
  console.error('FAIL: transactional triggers not wired (expected sender + at least one caller)')
  process.exit(1)
}
console.log('push hooks verification passed')

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const mustExist = [
  'public/firebase-messaging-sw.js',
  'public/manifest.webmanifest',
  'components/push/push-prompt.tsx',
]
const missing = mustExist.filter((p) => !existsSync(join(root, p)))
if (missing.length > 0) {
  console.error(`FAIL: missing web files: ${missing.join(', ')}`)
  process.exit(1)
}
const prompt = readFileSync(join(root, 'components/push/push-prompt.tsx'), 'utf8')
if (!prompt.includes("'use client'") && !prompt.includes('"use client"')) {
  console.error('FAIL: push-prompt must be a client component')
  process.exit(1)
}
for (const banned of ['as any', '@ts-ignore', 'FIREBASE_SERVICE', 'private_key']) {
  if (prompt.includes(banned)) {
    console.error(`FAIL: banned pattern in prompt: ${banned}`)
    process.exit(1)
  }
}
// brand guard: no tech-leak strings to readers
for (const leak of ['Narraza', 'RAG', 'token']) {
  if (prompt.includes(leak)) {
    console.error(`FAIL: brand-guard leak in prompt: ${leak}`)
    process.exit(1)
  }
}
const sw = readFileSync(join(root, 'public/firebase-messaging-sw.js'), 'utf8')
if (!sw.includes('notificationclick') || !sw.includes('firebase-messaging')) {
  console.error('FAIL: service worker missing messaging/click handler')
  process.exit(1)
}
console.log('push web verification passed')

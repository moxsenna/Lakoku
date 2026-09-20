import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const manifest = readFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
if (!manifest.includes('POST_NOTIFICATIONS')) {
  console.error('FAIL: POST_NOTIFICATIONS permission missing')
  process.exit(1)
}
const gradle = readFileSync(join(root, 'android/app/build.gradle'), 'utf8')
const m = gradle.match(/versionCode\s+(\d+)/)
if (!m || Number(m[1]) < 4) {
  console.error('FAIL: versionCode must be >= 4 for this native change')
  process.exit(1)
}
const pkg = readFileSync(join(root, 'package.json'), 'utf8')
if (!pkg.includes('@capacitor/push-notifications')) {
  console.error('FAIL: @capacitor/push-notifications dependency missing')
  process.exit(1)
}
if (!existsSync(join(root, 'lib/android/push-bridge.ts'))) {
  console.error('FAIL: lib/android/push-bridge.ts missing')
  process.exit(1)
}
console.log('push android verification passed')
